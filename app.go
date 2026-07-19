package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	ai "luminssh-go/internal/ai"
	runtimebundle "luminssh-go/module/runtimebundle"
	runtimeenv "luminssh-go/module/runtimeenv"
	runtimeinstaller "luminssh-go/module/runtimeinstaller"

	"github.com/gorilla/websocket"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx                       context.Context
	sshManager                *SSHManager
	configManager             *ConfigManager
	wsPort                    int
	wsToken                   string
	wsMu                      sync.Mutex
	wsConns                   map[string]*wsEntry // sessionId -> active WebSocket
	wsServer                  *http.Server        // WebSocket HTTP 服务器，用于优雅关闭
	wsListener                net.Listener        // WebSocket 监听器，用于关闭时释放端口
	mainLivenessLockPath      string
	mainLivenessLockRelease   func()
	builtinProcessMu          sync.Mutex
	builtinProcesses          map[string]*exec.Cmd
	builtinBundleMu           sync.Mutex
	builtinBundleReady        map[string]bool
	builtinInitMu             sync.Mutex
	builtinInitCommands       map[string]*exec.Cmd
	builtinInitCancelRequests map[string]bool
	quitting                  atomic.Bool // 标记用户确认退出，OnBeforeClose 放行（跨 goroutine 访问需原子操作）
	closeAck                  atomic.Bool // 前端已响应关闭弹窗（tray/cancel），取消 5s 兜底强制退出
	onBeforeQuit              func()      // 退出前回调，由 main 设置用于清理托盘等
	aiChatReqMu               sync.Mutex
	aiChatReqCancel           map[string]context.CancelFunc
	aiPendingToolMu           sync.Mutex
	aiPendingToolBatches      map[string]*ai.PendingToolBatch
	aiToolExecMu              sync.Mutex
	aiToolExecutions          map[string]*ai.ToolExecutionState
	aiSkipNextAutoReqMu       sync.Mutex
	aiSkipNextAutomaticReqMap map[string]bool
	liveWorkspaceStateMu      sync.RWMutex
	liveWorkspaceState        string
}

// wsEntry 包装一个 WebSocket 连接及其独立写锁。
// wsMu 仅保护 map 增删改查；写消息时用每连接独立锁，避免慢客户端阻塞其他 session。
type wsEntry struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

type BuiltinProviderRuntimeStatus struct {
	ProviderID string `json:"providerId"`
	State      string `json:"state"`
	Ready      bool   `json:"ready"`
}

type GitHubContributorAuthor struct {
	Login  string `json:"login"`
	Avatar string `json:"avatar"`
	Path   string `json:"path"`
}

type GitHubContributorWeek struct {
	W int `json:"w"`
	A int `json:"a"`
	D int `json:"d"`
	C int `json:"c"`
}

type GitHubContributor struct {
	Author GitHubContributorAuthor `json:"author"`
	Total  int                     `json:"total"`
	Weeks  []GitHubContributorWeek `json:"weeks"`
}

const githubContributorsAPIURL = "https://github.com/wmwlwmwl/Lumin-SSH/graphs/contributors-data"

const githubContributorsRefererURL = "https://github.com/wmwlwmwl/Lumin-SSH/graphs/contributors"

const githubContributorsRequestTimeout = 10 * time.Second

const githubContributorsMaxRetries = 5

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sshManager:                NewSSHManager(),
		configManager:             NewConfigManager(),
		wsConns:                   make(map[string]*wsEntry),
		builtinProcesses:          make(map[string]*exec.Cmd),
		builtinBundleReady:        make(map[string]bool),
		builtinInitCommands:       make(map[string]*exec.Cmd),
		builtinInitCancelRequests: make(map[string]bool),
		aiChatReqCancel:           make(map[string]context.CancelFunc),
		aiPendingToolBatches:      make(map[string]*ai.PendingToolBatch),
		aiToolExecutions:          make(map[string]*ai.ToolExecutionState),
		aiSkipNextAutomaticReqMap: make(map[string]bool),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.sshManager.ctx = ctx // Give SSH manager access to Wails events
	a.sshManager.app = a   // Give SSH manager access to WebSocket registry
	a.configManager.wailsCtx = ctx
	if err := a.ensureMainLivenessLock(); err != nil {
		log.Printf("failed to acquire main liveness lock: %v", err)
	}

	// ── 启动本地 WebSocket 终端服务器 ─────────────────────────────────
	// 不经过 Wails IPC，直接走 TCP loopback，延迟极低
	// 生成随机 token，要求连接时通过 ?token=xxx 携带，防止本机恶意进程注入命令
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Fatalf("生成 WebSocket Token 失败: %v", err)
	}
	a.wsToken = hex.EncodeToString(tokenBytes)

	mux := http.NewServeMux()
	// 仅允许 Wails WebView 的 Origin（防止本机恶意网页通过 DNS rebinding 连接）
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return false
			}
			if origin == "wails://wails" ||
				origin == "http://wails.localhost" ||
				origin == "https://wails.localhost" ||
				strings.HasPrefix(origin, "http://wails.localhost:") ||
				strings.HasPrefix(origin, "https://wails.localhost:") {
				return true
			}
			return strings.HasPrefix(origin, "http://localhost:") ||
				strings.HasPrefix(origin, "http://127.0.0.1:") ||
				strings.HasPrefix(origin, "http://[::1]:")
		},
		ReadBufferSize:  4096,
		WriteBufferSize: 32768,
	}
	mux.HandleFunc("/ws/", func(w http.ResponseWriter, r *http.Request) {
		// 校验 token，拒绝未携带正确 token 的连接
		if r.URL.Query().Get("token") != a.wsToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		sessionId := strings.TrimPrefix(r.URL.Path, "/ws/")
		if sessionId == "" {
			http.Error(w, "missing sessionId", http.StatusBadRequest)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// 注册当前 WebSocket 连接
		entry := &wsEntry{conn: conn}
		a.wsMu.Lock()
		if old := a.wsConns[sessionId]; old != nil {
			go old.conn.Close() // 同 session 重连时关闭被覆盖的旧连接，避免 fd 泄漏
		}
		a.wsConns[sessionId] = entry
		a.wsMu.Unlock()
		defer func() {
			a.wsMu.Lock()
			// 仅删除自己的 entry：若已被新连接覆盖，cur != entry，不能误删新连接
			if cur, ok := a.wsConns[sessionId]; ok && cur == entry {
				delete(a.wsConns, sessionId)
			}
			a.wsMu.Unlock()
		}()

		// 读取 WebSocket 消息，直通 SSH stdin
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			a.sshManager.WriteBytes(sessionId, msg)
		}
	})

	// 监听随机端口
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err == nil {
		a.wsPort = listener.Addr().(*net.TCPAddr).Port
		a.wsListener = listener
		a.wsServer = &http.Server{Handler: mux}
		go func() {
			if err := a.wsServer.Serve(listener); err != nil && err != http.ErrServerClosed {
				log.Printf("WebSocket server stopped: %v", err)
			}
		}()
	}

	// Clean up old executable from a previous auto-update
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		files, err := os.ReadDir(dir)
		if err == nil {
			for _, file := range files {
				if !file.IsDir() && strings.HasSuffix(file.Name(), ".old") {
					os.Remove(filepath.Join(dir, file.Name()))
				}
			}
		}
	}

	a.configManager.CleanupOrphanedHistory()
	go a.configManager.AutoSync()
	applyMCPOutputCompressionSettings(a.configManager.GetMCPOutputCompressionSettings())
	initializeMCPClientHub(a)
	startMCPServer(a)
}

// AckClose 前端响应了关闭弹窗（tray/cancel），取消 5s 兜底强制退出
func (a *App) AckClose() {
	a.closeAck.Store(true)
}

// DoQuit 用户确认退出，设标记让 OnBeforeClose 放行
// 同时清理资源：断开所有 SSH 会话、关闭 WebSocket 监听器
func (a *App) DoQuit() {
	a.quitting.Store(true)
	// 在 runtime.Quit 之前清理托盘，确保 Windows 消息循环仍在运行
	if a.onBeforeQuit != nil {
		a.onBeforeQuit()
	}
	// 断开所有 SSH 会话，避免服务器侧遗留僵尸会话
	if a.sshManager != nil {
		a.sshManager.DisconnectAll()
	}
	// 关闭 WebSocket 监听器，释放端口并停止 goroutine
	if a.wsServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = a.wsServer.Shutdown(ctx)
		a.wsServer = nil
	}
	if a.wsListener != nil {
		_ = a.wsListener.Close()
		a.wsListener = nil
	}
	a.releaseMainLivenessLock()
	runtime.Quit(a.ctx)
}

// GetWsPort 返回本地 WebSocket 服务器端口，前端用于连接终端
func (a *App) GetWsPort() int {
	return a.wsPort
}

// GetWsToken 返回 WebSocket 鉴权 token，前端连接时通过 ?token=xxx 携带
func (a *App) GetWsToken() string {
	return a.wsToken
}

// WriteWsToSession 将 WebSocket 输出写入给指定 session 的 WS 连接
func (a *App) WriteWsOutput(sessionId string, data []byte) {
	// 仅在 wsMu 下取出 entry，写消息时用每连接独立锁，避免慢客户端阻塞其他 session
	a.wsMu.Lock()
	entry, ok := a.wsConns[sessionId]
	a.wsMu.Unlock()
	if !ok || entry == nil {
		return
	}

	entry.writeMu.Lock()
	defer entry.writeMu.Unlock()
	// 设置写超时，防止前端停止读取后 goroutine 永久阻塞
	entry.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err := entry.conn.WriteMessage(websocket.BinaryMessage, data)
	if err != nil {
		// 写失败（超时/连接断开），关闭并移除该连接
		a.wsMu.Lock()
		// 二次校验：可能已被其他 goroutine 替换或移除
		if cur, ok := a.wsConns[sessionId]; ok && cur == entry {
			delete(a.wsConns, sessionId)
		}
		a.wsMu.Unlock()
		entry.conn.Close()
	}
}

// IsPortableVersion checks if the current executable is the portable version
// 开发构建默认视为便携版（exe 名不含 installer/setup）
func (a *App) IsPortableVersion() bool {
	exePath, err := os.Executable()
	if err != nil {
		return true // 无法确定时默认便携版
	}
	exeName := strings.ToLower(filepath.Base(exePath))
	if strings.Contains(exeName, "installer") || strings.Contains(exeName, "setup") {
		return false
	}
	// 安装在 Program Files 下的一定是安装版
	exeDir := strings.ToLower(filepath.Dir(exePath))
	if strings.Contains(exeDir, "program files") {
		return false
	}
	return true
}

// GetArch returns the current executable's CPU architecture (amd64, arm64, etc.)
func (a *App) GetArch() string {
	return goruntime.GOARCH
}

// GetConnections returns all saved SSH connections
func (a *App) GetConnections() []Connection {
	return a.configManager.GetConnections()
}

// GetConnectionsMasked 返回掩码后的连接列表，用于前端显示
func (a *App) GetConnectionsMasked() []Connection {
	return a.configManager.GetConnectionsMasked()
}

// GetConnectionByID 返回指定连接的真实数据（含解密密码），供克隆等场景使用
func (a *App) GetConnectionByID(id string) (Connection, error) {
	conn, ok := a.configManager.GetConnectionByID(id)
	if !ok {
		return Connection{}, fmt.Errorf("connection not found")
	}
	return conn, nil
}

func (a *App) GetConnectionPassword(id string) (string, error) {
	conn, ok := a.configManager.GetConnectionByID(id)
	if !ok {
		return "", fmt.Errorf("connection not found")
	}
	resolvedConn, err := a.configManager.ResolveConnectionRuntime(conn)
	if err != nil {
		return "", err
	}
	if resolvedConn.AuthMethod != "password" {
		return "", fmt.Errorf("current connection does not use password auth")
	}
	if strings.TrimSpace(resolvedConn.Password) == "" {
		return "", fmt.Errorf("password is empty")
	}
	return resolvedConn.Password, nil
}

// SaveConnection saves a new or existing connection
func (a *App) SaveConnection(conn Connection, noSync bool) Connection {
	return a.configManager.SaveConnection(conn, noSync)
}

// DeleteConnection removes a connection by ID
func (a *App) DeleteConnection(id string) bool {
	return a.configManager.DeleteConnection(id)
}

// BatchDeleteConnections removes multiple connections at once
func (a *App) BatchDeleteConnections(ids []string) {
	a.configManager.BatchDeleteConnections(ids)
}

// ExportConnections 导出全部节点到用户选择的文件。
// useEncryption=false 导出明文 .json（含真实密码/私钥）；true 导出密文 .lumin2。
// password 非空时用于 LUMIN2 PBKDF2 派生；空则用本机恢复密码（与云端同步加密口径一致）。
// 弹出保存对话框；用户取消时返回 ("", nil)。返回写入的文件路径。
func (a *App) ExportConnections(useEncryption bool, password string) (string, error) {
	if useEncryption && strings.TrimSpace(password) == "" {
		password = a.configManager.GetRecoveryPassword()
		if password == "" {
			return "", fmt.Errorf("未设置恢复密码，请输入自定义密码或先在同步设置中设置恢复密码")
		}
	}

	// 保存对话框
	ext := ".json"
	title := "导出节点"
	if useEncryption {
		ext = ".lumin2"
	}
	timestamp := time.Now().Format("20060102_150405.000_-0700")
	defaultName := fmt.Sprintf("lumin-ssh-connections-%s%s", timestamp, ext)
	filters := []runtime.FileFilter{
		{DisplayName: fmt.Sprintf("Lumin-SSH (*%s)", ext), Pattern: "*" + ext},
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: defaultName,
		Filters:         filters,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		// 用户取消，非错误
		return "", nil
	}

	conns := a.configManager.GetConnections()
	creds := a.configManager.GetCredentials()
	proxyNodes := a.configManager.GetAIProxyNodes()
	exp := buildConnectionsExportWithProxyNodes(conns, creds, proxyNodes)

	if !useEncryption {
		// 明文：序列化后直接写文件
		data, err := json.MarshalIndent(exp, "", "  ")
		if err != nil {
			return "", fmt.Errorf("导出失败: %w", err)
		}
		if err := atomicWriteFile(path, data, 0600); err != nil {
			return "", fmt.Errorf("导出失败: %w", err)
		}
		return path, nil
	}

	// 密文：序列化 → LUMIN2 加密
	encrypted, err := a.configManager.encryptExportData(exp, password)
	if err != nil {
		return "", fmt.Errorf("导出失败: %w", err)
	}
	if err := atomicWriteFile(path, []byte(encrypted), 0600); err != nil {
		return "", fmt.Errorf("导出失败: %w", err)
	}
	return path, nil
}

// ExportConnectionsByIDs 按 ID 列表导出节点到用户选择的文件。
// ids 为空时等同导出全部（向后兼容 ExportConnections）。
// useEncryption=false 导出明文 .json；true 导出密文 .lumin2。
// password 非空时用于 LUMIN2 PBKDF2 派生；空则用本机恢复密码。
func (a *App) ExportConnectionsByIDs(ids []string, useEncryption bool, password string) (string, error) {
	if useEncryption && strings.TrimSpace(password) == "" {
		password = a.configManager.GetRecoveryPassword()
		if password == "" {
			return "", fmt.Errorf("未设置恢复密码，请输入自定义密码或先在同步设置中设置恢复密码")
		}
	}

	// 保存对话框
	ext := ".json"
	title := "导出节点"
	if useEncryption {
		ext = ".lumin2"
	}
	timestamp := time.Now().Format("20060102_150405.000_-0700")
	defaultName := fmt.Sprintf("lumin-ssh-connections-%s%s", timestamp, ext)
	filters := []runtime.FileFilter{
		{DisplayName: fmt.Sprintf("Lumin-SSH (*%s)", ext), Pattern: "*" + ext},
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: defaultName,
		Filters:         filters,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}

	allConns := a.configManager.GetConnections()

	// 按 ID 过滤（空列表 = 全部）
	var conns []Connection
	if len(ids) == 0 {
		conns = allConns
	} else {
		idSet := make(map[string]struct{}, len(ids))
		for _, id := range ids {
			idSet[id] = struct{}{}
		}
		for _, c := range allConns {
			if _, ok := idSet[c.ID]; ok {
				conns = append(conns, c)
			}
		}
	}

	creds := a.configManager.GetCredentials()
	proxyNodes := a.configManager.GetAIProxyNodes()
	exp := buildConnectionsExportWithProxyNodes(conns, creds, proxyNodes)

	if !useEncryption {
		data, err := json.MarshalIndent(exp, "", "  ")
		if err != nil {
			return "", fmt.Errorf("导出失败: %w", err)
		}
		if err := atomicWriteFile(path, data, 0600); err != nil {
			return "", fmt.Errorf("导出失败: %w", err)
		}
		return path, nil
	}

	// 密文：序列化 → LUMIN2 加密
	encrypted, err := a.configManager.encryptExportData(exp, password)
	if err != nil {
		return "", fmt.Errorf("导出失败: %w", err)
	}
	if err := atomicWriteFile(path, []byte(encrypted), 0600); err != nil {
		return "", fmt.Errorf("导出失败: %w", err)
	}
	return path, nil
}

// SelectImportFile 弹出打开对话框让用户选择导入文件，返回文件路径（用户取消返回空串）。
// 与 ImportConnections 分离，便于密文导入需要密码时无需重新选文件。
func (a *App) SelectImportFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "导入节点",
		Filters: []runtime.FileFilter{
			{DisplayName: "Lumin-SSH (*.json;*.lumin2;*.enc)", Pattern: "*.json;*.lumin2;*.enc"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// ImportConnections 从指定文件导入节点（合并，跳过重复）。
// filePath 由前端通过 SelectImportFile 获取；password 为弹窗输入的自定义解密密码（可空）。
// 智能识别明文 JSON / 恢复密码密文 / 旧版云端 .enc / 自定义密码密文：
//   - 明文直接解析
//   - 密文自动先试恢复密码和旧版云同步密钥
//   - 自动解密失败返回 errNeedPassword，前端弹窗输入自定义密码后再试
func (a *App) ImportConnections(filePath string, password string) (ImportResult, error) {
	if filePath == "" {
		return ImportResult{}, nil
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return ImportResult{}, fmt.Errorf("导入失败: %w", err)
	}

	if strings.TrimSpace(password) == "" {
		password = a.configManager.GetRecoveryPassword()
	}
	candidateKeys := a.configManager.CandidateSyncKeys()

	exp, err := a.configManager.parseImportData(data, candidateKeys, password)
	if err != nil {
		if errors.Is(err, errNeedPassword) {
			// 原样返回，前端识别此 sentinel 并弹密码框
			return ImportResult{}, err
		}
		return ImportResult{}, fmt.Errorf("导入失败: %w", err)
	}
	return a.configManager.ImportConnections(exp.Connections, exp.Credentials, exp.ProxyNodes)
}

// DownloadImportTemplate 下载导入模板（含样例的明文 JSON），方便用户批量录入。
// 弹出保存对话框；用户取消时返回 ("", nil)。返回写入的文件路径。
func (a *App) DownloadImportTemplate(lang string) (string, error) {
	title := "保存导入模板"
	if lang == "en-US" {
		title = "Save Import Template"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: "lumin-ssh-import-template.json",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	tmpl := buildImportTemplate(lang)
	data, err := json.MarshalIndent(tmpl, "", "  ")
	if err != nil {
		if lang == "en-US" {
			return "", fmt.Errorf("failed to generate template: %w", err)
		}
		return "", fmt.Errorf("生成模板失败: %w", err)
	}
	if err := atomicWriteFile(path, data, 0600); err != nil {
		if lang == "en-US" {
			return "", fmt.Errorf("failed to save template: %w", err)
		}
		return "", fmt.Errorf("保存模板失败: %w", err)
	}
	return path, nil
}

// HasCloudSyncConfigured 返回本机是否配置了任意云同步后端（供前端 UI 决定是否提示输入密码）。
// TODO(deprecated, 预计 v1.2.0+ 移除): 旧版逻辑，新版用 HasRecoveryPassword 判断。
func (a *App) HasCloudSyncConfigured() bool {
	key, _ := a.configManager.GetActiveSyncKey()
	return key != nil
}

// HasRecoveryPassword 返回是否设置了恢复密码（供前端导出 UI 决定是否允许"复用恢复密码"）。
func (a *App) HasRecoveryPassword() bool {
	return a.configManager.GetRecoveryPassword() != ""
}

// SetConnectionGroup 仅更新服务器分组
func (a *App) SetConnectionGroup(id string, group string) error {
	return a.configManager.SetConnectionGroup(id, group)
}

// BatchSetConnectionGroup 批量更新服务器分组
func (a *App) BatchSetConnectionGroup(ids []string, group string) error {
	return a.configManager.BatchSetConnectionGroup(ids, group)
}

// SetConnectionOS 仅更新服务器操作系统
func (a *App) SetConnectionOS(id string, os string) error {
	return a.configManager.SetConnectionOS(id, os)
}

// ConnectSSH establishes an SSH connection
func (a *App) ConnectSSH(sessionId string, connId string) error {
	conn, ok := a.configManager.GetConnectionByID(connId)
	if !ok {
		return fmt.Errorf("connection not found")
	}
	resolvedConn, err := a.configManager.ResolveConnectionRuntime(conn)
	if err != nil {
		return err
	}
	return a.sshManager.Connect(sessionId, resolvedConn)
}

// ReconnectWithPassword 更新密码并重连（认证失败后使用）
// persist: true=保存密码, false=仅本次会话使用
func (a *App) ReconnectWithPassword(sessionId string, connId string, newPassword string, persist bool) error {
	conn, ok := a.configManager.GetConnectionByID(connId)
	if !ok {
		return fmt.Errorf("connection not found")
	}

	// 持久化：凭据连接更新凭据，内联连接更新服务器
	if persist && conn.CredentialID != "" {
		cred, credOk := a.configManager.GetCredentialByID(conn.CredentialID)
		if credOk {
			cred.Password = newPassword
			a.configManager.SaveCredential(cred)
		}
	}

	resolved, err := a.configManager.ResolveConnectionRuntime(conn)
	if err != nil {
		return err
	}
	resolved.Password = newPassword

	if persist && conn.CredentialID == "" {
		conn.Password = newPassword
		a.configManager.SaveConnection(conn, true)
	}

	// 清理旧会话
	a.sshManager.Disconnect(sessionId)

	// 重新连接
	return a.sshManager.Connect(sessionId, resolved)
}

// DisconnectSSH closes an SSH connection
func (a *App) DisconnectSSH(sessionId string) {
	a.sshManager.Disconnect(sessionId)
}

// AcceptHostKeyChange 用户确认主机密钥变更
// action: 0=取消, 1=仅本次接受, 2=接受并保存
func (a *App) AcceptHostKeyChange(sessionId string, action int) error {
	return a.sshManager.AcceptHostKeyChange(sessionId, action)
}

// OpenTerminal 在当前服务器连接上打开新的终端标签页
func (a *App) OpenTerminal(sessionId string) (string, error) {
	return a.sshManager.OpenTerminal(sessionId)
}

// WriteTerminal sends input to the SSH PTY (fallback, primary path is WebSocket)
func (a *App) WriteTerminal(sessionId string, data string) {
	a.sshManager.WriteBytes(sessionId, []byte(data))
}

// ResizeTerminal resizes the SSH PTY
func (a *App) ResizeTerminal(sessionId string, cols, rows int) {
	a.sshManager.Resize(sessionId, cols, rows)
}

// SystemInfo retrieves basic system probe info
func (a *App) SystemInfo(sessionId string) (map[string]interface{}, error) {
	return a.sshManager.GetSystemInfo(sessionId)
}

// NetworkInfo retrieves full network probe info including connection details.
func (a *App) NetworkInfo(sessionId string) (map[string]interface{}, error) {
	return a.sshManager.GetNetworkInfo(sessionId)
}

// GetServerStaticInfo retrieves static server info (OS/timezone/hostname/CPU model)
func (a *App) GetServerStaticInfo(sessionId string) (map[string]interface{}, error) {
	return a.sshManager.GetServerStaticInfo(sessionId)
}

// GetFullProcessList retrieves all process list from the remote server
func (a *App) GetFullProcessList(sessionId string) ([]map[string]interface{}, error) {
	return a.sshManager.GetFullProcessList(sessionId)
}

// KillProcess kills a process by PID on the remote server
func (a *App) KillProcess(sessionId string, pid string) error {
	return a.sshManager.KillProcess(sessionId, pid)
}

// GetProcessEnv returns environment variables of a remote process
func (a *App) GetProcessEnv(sessionId string, pid string) ([]string, error) {
	return a.sshManager.GetProcessEnv(sessionId, pid)
}

// GetTerminalCwd retrieves current working directory of the shell
func (a *App) GetTerminalCwd(sessionId string) (string, error) {
	return a.sshManager.GetTerminalCwd(sessionId)
}

// ListDir lists directory contents via SFTP
func (a *App) ListDir(sessionId string, path string) ([]map[string]interface{}, error) {
	return a.sshManager.ListDir(sessionId, path)
}

// ReadFile reads a file's content via SFTP
func (a *App) ReadFile(sessionId string, path string) (string, error) {
	return a.sshManager.ReadFile(sessionId, path)
}

// WriteFile writes content to a file via SFTP
func (a *App) WriteFile(sessionId string, path string, content string) error {
	return a.sshManager.WriteFile(sessionId, path, content)
}

// DeleteItem deletes a file or directory via SFTP
func (a *App) DeleteItem(sessionId string, path string, isDir bool) error {
	return a.sshManager.DeleteItem(sessionId, path, isDir)
}

// DeleteItemShell 用 rm -rf 删除（和 FinalShell 一致）
func (a *App) DeleteItemShell(sessionId string, path string) error {
	return a.sshManager.DeleteItemShell(sessionId, path)
}

// Mkdir creates a directory via SFTP
func (a *App) Mkdir(sessionId string, path string) error {
	return a.sshManager.Mkdir(sessionId, path)
}

// RenameItem renames a file or directory via SFTP
func (a *App) RenameItem(sessionId string, oldPath string, newPath string) error {
	return a.sshManager.RenameItem(sessionId, oldPath, newPath)
}

// CopyItem copies a file or directory within the same server (server-local cp -a).
func (a *App) CopyItem(sessionId string, srcPath string, dstPath string) error {
	return a.sshManager.CopyItem(sessionId, srcPath, dstPath)
}

// MoveItem moves a file or directory within the same server (server-local mv).
func (a *App) MoveItem(sessionId string, srcPath string, dstPath string) error {
	return a.sshManager.MoveItem(sessionId, srcPath, dstPath)
}

// GetChmodDialogSettings returns remembered chmod dialog preferences
func (a *App) GetChmodDialogSettings() map[string]interface{} {
	return a.configManager.GetChmodDialogSettings()
}

// SaveChmodDialogSettings persists chmod dialog preferences
func (a *App) SaveChmodDialogSettings(mode string, includeSubdirectories bool) error {
	return a.configManager.SaveChmodDialogSettings(mode, includeSubdirectories)
}

func (a *App) ListOwnershipCandidates(sessionId string) (OwnershipCandidates, error) {
	return a.sshManager.ListOwnershipCandidates(sessionId)
}

func (a *App) GetPathOwnership(sessionId string, path string) (PathOwnershipInfo, error) {
	return a.sshManager.GetPathOwnership(sessionId, path)
}

func (a *App) ResolveDirectoryPath(sessionId string, path string) (string, error) {
	return a.sshManager.ResolveDirectoryPath(sessionId, path)
}

func (a *App) ChownFile(sessionId string, path string, owner string, group string, recursive bool) error {
	return a.sshManager.ChownFile(sessionId, path, owner, group, recursive)
}

// ChmodFile changes file permissions via SFTP or recursively via chmod -R
func (a *App) ChmodFile(sessionId string, path string, mode string, recursive bool) error {
	return a.sshManager.ChmodFile(sessionId, path, mode, recursive)
}

// CompressItem archives a file or directory on the remote server
func (a *App) CompressItem(sessionId string, remotePath string) error {
	return a.sshManager.CompressItem(sessionId, remotePath)
}

// UncompressItem extracts an archive on the remote server
func (a *App) UncompressItem(sessionId string, remotePath string) error {
	return a.sshManager.UncompressItem(sessionId, remotePath)
}

// UploadLocalFile uploads a local file to a remote directory (no dialog)
func (a *App) UploadLocalFile(sessionId string, localFile string, remoteDir string) error {
	return a.sshManager.UploadFile(sessionId, localFile, remoteDir)
}

// UploadLocalDir recursively uploads a local directory to a remote directory (no dialog)
func (a *App) UploadLocalDir(sessionId string, localDir string, remoteDir string) error {
	return a.sshManager.UploadDir(sessionId, localDir, remoteDir)
}

// UploadFileContent uploads file content from memory to a remote path
func (a *App) UploadFileContent(sessionId string, fileName string, remoteDir string, content []byte) error {
	return a.sshManager.UploadFileContent(sessionId, fileName, remoteDir, content)
}

// UploadFileContentBase64 通过 base64 编码上传文件内容，避免前端内存爆炸
func (a *App) UploadFileContentBase64(sessionId string, fileName string, remoteDir string, base64Content string) error {
	return a.sshManager.UploadFileContentBase64(sessionId, fileName, remoteDir, base64Content)
}

func (a *App) BeginChunkedUploadTask(sessionId string, remoteDir string, maxClients int) (string, error) {
	return a.sshManager.BeginChunkedUploadTask(sessionId, remoteDir, maxClients)
}

func (a *App) BeginChunkedUploadFile(taskID string, relativePath string, size int64, totalChunks int) (string, error) {
	return a.sshManager.BeginChunkedUploadFile(taskID, relativePath, size, totalChunks)
}

func (a *App) UploadChunkBase64(taskID string, fileID string, chunkIndex int, offset int64, base64Content string) error {
	return a.sshManager.UploadChunkBase64(taskID, fileID, chunkIndex, offset, base64Content)
}

func (a *App) CompleteChunkedUploadFile(taskID string, fileID string) error {
	return a.sshManager.CompleteChunkedUploadFile(taskID, fileID)
}

func (a *App) AbortChunkedUploadFile(taskID string, fileID string) error {
	return a.sshManager.AbortChunkedUploadFile(taskID, fileID)
}

func (a *App) FinishChunkedUploadTask(taskID string) error {
	return a.sshManager.FinishChunkedUploadTask(taskID)
}

func (a *App) AbortChunkedUploadTask(taskID string) error {
	return a.sshManager.AbortChunkedUploadTask(taskID)
}

// UploadFile opens a file dialog to select a local file and uploads it to the remote path
func (a *App) UploadFile(sessionId string, remotePath string) error {
	filepaths, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select File to Upload",
	})
	if err != nil || filepaths == "" {
		return err
	}
	return a.sshManager.UploadFile(sessionId, filepaths, remotePath)
}

func (a *App) SelectUploadFiles() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Files to Upload",
	})
}

func (a *App) SelectUploadDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Folder to Upload",
	})
}

func (a *App) SelectDownloadFilePath(remotePath string, defaultDir string) (string, error) {
	filename := filepath.Base(remotePath)
	options := runtime.SaveDialogOptions{
		Title:           "Save File",
		DefaultFilename: filename,
	}
	defaultDirectory := resolveDownloadDefaultDirectory(defaultDir)
	if defaultDirectory != "" {
		_ = os.MkdirAll(defaultDirectory, 0o755)
		options.DefaultDirectory = defaultDirectory
	}
	return runtime.SaveFileDialog(a.ctx, options)
}

func (a *App) SelectDownloadDirectory(defaultDir string) (string, error) {
	options := runtime.OpenDialogOptions{
		Title: "Select Download Directory",
	}
	defaultDirectory := resolveDownloadDefaultDirectory(defaultDir)
	if defaultDirectory != "" {
		_ = os.MkdirAll(defaultDirectory, 0o755)
		options.DefaultDirectory = defaultDirectory
	}
	return runtime.OpenDirectoryDialog(a.ctx, options)
}

func (a *App) UploadLocalPathsCompressed(sessionId string, uploadID string, maxConcurrent int, localPaths []string, remoteDir string) error {
	return a.sshManager.UploadLocalPathsCompressed(sessionId, uploadID, maxConcurrent, localPaths, remoteDir)
}

func (a *App) AutoRepairCompressedUploadTargets(sessionId string, localPaths []string, remoteDir string) error {
	return a.sshManager.AutoRepairCompressedUploadTargets(sessionId, localPaths, remoteDir)
}

func (a *App) AbortCompressedUpload(sessionId string) error {
	return a.sshManager.AbortCompressedUpload(sessionId)
}

func getProgramDirectory() string {
	exePath, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Dir(exePath)
}

func (a *App) ensureMainLivenessLock() error {
	if a == nil || a.configManager == nil {
		return fmt.Errorf("config manager unavailable")
	}
	if a.mainLivenessLockRelease != nil && strings.TrimSpace(a.mainLivenessLockPath) != "" {
		return nil
	}
	lockPath := filepath.Join(a.configManager.configDir, "luminssh-main.lock")
	release, err := acquireMainLivenessLock(lockPath)
	if err != nil {
		return err
	}
	a.mainLivenessLockPath = lockPath
	a.mainLivenessLockRelease = release
	return nil
}

func (a *App) releaseMainLivenessLock() {
	if a == nil || a.mainLivenessLockRelease == nil {
		return
	}
	a.mainLivenessLockRelease()
	a.mainLivenessLockRelease = nil
}

func isBuiltinProcessRunning(process *exec.Cmd) bool {
	return process != nil && process.Process != nil && process.ProcessState == nil
}

func (a *App) getBuiltinProcess(providerID string) *exec.Cmd {
	if a == nil {
		return nil
	}
	a.builtinProcessMu.Lock()
	defer a.builtinProcessMu.Unlock()
	return a.builtinProcesses[providerID]
}

func builtinProviderBundleFileMatches(targetRoot string, relativePath string) bool {
	normalizedPath := strings.TrimSpace(strings.ReplaceAll(relativePath, "\\", "/"))
	if normalizedPath == "" {
		return false
	}
	embeddedContent, err := embeddedModuleFS.ReadFile("module/kimiapi/" + normalizedPath)
	if err != nil {
		return false
	}
	targetContent, err := os.ReadFile(filepath.Join(targetRoot, filepath.FromSlash(normalizedPath)))
	if err != nil {
		return false
	}
	return bytes.Equal(embeddedContent, targetContent)
}

func builtinProviderBundleNeedsRelease(providerID string, targetRoot string) bool {
	switch strings.TrimSpace(providerID) {
	case "", "builtin-kimi":
		if _, err := os.Stat(filepath.Join(targetRoot, "python-version")); err == nil {
			return true
		}
		requiredFiles := []string{
			"pyproject.toml",
			"run.py",
			".python-version",
			"requirements.lock.txt",
			"builtin-kimi.md",
		}
		for _, relativePath := range requiredFiles {
			if !builtinProviderBundleFileMatches(targetRoot, relativePath) {
				return true
			}
		}
		return false
	default:
		return true
	}
}

func (a *App) ensureBuiltinProviderBundle(providerID string) error {
	if a == nil {
		return fmt.Errorf("app unavailable")
	}
	normalizedProviderID := strings.TrimSpace(providerID)
	if normalizedProviderID == "" {
		normalizedProviderID = "builtin-kimi"
	}
	if normalizedProviderID != "builtin-kimi" {
		return fmt.Errorf("unsupported builtin provider: %s", normalizedProviderID)
	}
	programDirectory := getProgramDirectory()
	targetRoot := filepath.Join(programDirectory, "modules", "kimiapi")

	a.builtinBundleMu.Lock()
	defer a.builtinBundleMu.Unlock()

	if a.builtinBundleReady == nil {
		a.builtinBundleReady = make(map[string]bool)
	}
	if a.builtinBundleReady[normalizedProviderID] {
		return nil
	}
	if !builtinProviderBundleNeedsRelease(normalizedProviderID, targetRoot) {
		a.builtinBundleReady[normalizedProviderID] = true
		return nil
	}
	if err := runtimebundle.ReleaseEmbeddedDirectory(embeddedModuleFS, "module/kimiapi", targetRoot); err != nil {
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "释放 kimiapi 资源失败", err)
	}
	a.builtinBundleReady[normalizedProviderID] = true
	return nil
}

func builtinProviderPreferredPython(moduleDirectory string) string {
	data, err := os.ReadFile(filepath.Join(moduleDirectory, ".python-version"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func builtinProviderVenvPythonPath(moduleDirectory string) string {
	if goruntime.GOOS == "windows" {
		return filepath.Join(moduleDirectory, ".venv", "Scripts", "python.exe")
	}
	return filepath.Join(moduleDirectory, ".venv", "bin", "python")
}

func builtinProviderHasValidVenv(moduleDirectory string) bool {
	pythonBinaryPath := builtinProviderVenvPythonPath(moduleDirectory)
	if strings.TrimSpace(pythonBinaryPath) == "" {
		return false
	}
	if _, err := os.Stat(filepath.Join(moduleDirectory, ".venv", "pyvenv.cfg")); err != nil {
		return false
	}
	if _, err := os.Stat(pythonBinaryPath); err != nil {
		return false
	}
	return true
}

var errBuiltinProviderInitializationCancelled = errors.New("内置 Kimi 初始化已终止")

type builtinProviderInitEventWriter struct {
	app        *App
	providerID string
}

func (w builtinProviderInitEventWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if w.app != nil {
		w.app.emitBuiltinProviderInitLog(w.providerID, string(p))
	}
	return len(p), nil
}

func (a *App) setBuiltinProviderInitCommand(providerID string, command *exec.Cmd) {
	if a == nil {
		return
	}
	a.builtinInitMu.Lock()
	defer a.builtinInitMu.Unlock()
	if a.builtinInitCommands == nil {
		a.builtinInitCommands = make(map[string]*exec.Cmd)
	}
	if command == nil {
		delete(a.builtinInitCommands, providerID)
		return
	}
	a.builtinInitCommands[providerID] = command
}

func (a *App) clearBuiltinProviderInitCommand(providerID string, command *exec.Cmd) {
	if a == nil {
		return
	}
	a.builtinInitMu.Lock()
	defer a.builtinInitMu.Unlock()
	if current := a.builtinInitCommands[providerID]; current == command {
		delete(a.builtinInitCommands, providerID)
	}
}

func (a *App) setBuiltinProviderInitCancelled(providerID string, cancelled bool) {
	if a == nil {
		return
	}
	a.builtinInitMu.Lock()
	defer a.builtinInitMu.Unlock()
	if a.builtinInitCancelRequests == nil {
		a.builtinInitCancelRequests = make(map[string]bool)
	}
	a.builtinInitCancelRequests[providerID] = cancelled
}

func (a *App) isBuiltinProviderInitCancelled(providerID string) bool {
	if a == nil {
		return false
	}
	a.builtinInitMu.Lock()
	defer a.builtinInitMu.Unlock()
	return a.builtinInitCancelRequests[providerID]
}

func (a *App) emitBuiltinProviderInitLog(providerID string, text string) {
	if a == nil || a.ctx == nil || strings.TrimSpace(providerID) == "" || text == "" {
		return
	}
	runtime.EventsEmit(a.ctx, "builtin-provider-init-log", map[string]interface{}{
		"providerId": providerID,
		"text":       text,
	})
}

func builtinProviderUsesChineseMirror(language string) bool {
	normalizedLanguage := strings.ToLower(strings.TrimSpace(language))
	return strings.HasPrefix(normalizedLanguage, "zh")
}

func (a *App) appendBuiltinProviderLog(logFile *os.File, providerID string, lines ...string) {
	if logFile == nil && a == nil {
		return
	}
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			if logFile != nil {
				_, _ = logFile.WriteString("\n")
			}
			if a != nil {
				a.emitBuiltinProviderInitLog(providerID, "\n")
			}
			continue
		}
		if logFile != nil {
			_, _ = logFile.WriteString(line + "\n")
		}
		if a != nil {
			a.emitBuiltinProviderInitLog(providerID, line+"\n")
		}
	}
}

func (a *App) runBuiltinProviderLoggedCommand(providerID string, binaryPath string, args []string, moduleDirectory string, env []string, logFile *os.File) error {
	commandParts := append([]string{filepath.Base(strings.TrimSpace(binaryPath))}, args...)
	a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] Running: "+strings.TrimSpace(strings.Join(commandParts, " ")))
	cmd := exec.Command(binaryPath, args...)
	cmd.Dir = moduleDirectory
	cmd.Env = env
	outputWriter := io.Writer(logFile)
	if outputWriter == nil {
		outputWriter = builtinProviderInitEventWriter{app: a, providerID: providerID}
	} else {
		outputWriter = io.MultiWriter(logFile, builtinProviderInitEventWriter{app: a, providerID: providerID})
	}
	cmd.Stdout = outputWriter
	cmd.Stderr = outputWriter
	a.setBuiltinProviderInitCommand(providerID, cmd)
	defer a.clearBuiltinProviderInitCommand(providerID, cmd)
	if err := cmd.Run(); err != nil {
		if a.isBuiltinProviderInitCancelled(providerID) {
			return errBuiltinProviderInitializationCancelled
		}
		return err
	}
	if a.isBuiltinProviderInitCancelled(providerID) {
		return errBuiltinProviderInitializationCancelled
	}
	return nil
}

func (a *App) ensureBuiltinProviderVenv(providerID string, binaryPath string, moduleDirectory string, env []string, logFile *os.File) error {
	if builtinProviderHasValidVenv(moduleDirectory) {
		return nil
	}

	venvDirectory := filepath.Join(moduleDirectory, ".venv")
	if err := os.RemoveAll(venvDirectory); err != nil && !os.IsNotExist(err) {
		return err
	}

	preferredPython := builtinProviderPreferredPython(moduleDirectory)
	if preferredPython != "" {
		a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] Creating .venv with preferred Python "+preferredPython+"...")
		if err := a.runBuiltinProviderLoggedCommand(providerID, binaryPath, []string{"venv", "--seed", "--python", preferredPython, ".venv"}, moduleDirectory, env, logFile); err == nil {
			return nil
		} else if errors.Is(err, errBuiltinProviderInitializationCancelled) {
			return err
		} else {
			a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] Preferred Python create failed, retrying with default Python.", "")
		}
	}

	a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] Creating .venv with default Python...")
	return a.runBuiltinProviderLoggedCommand(providerID, binaryPath, []string{"venv", "--seed", ".venv"}, moduleDirectory, env, logFile)
}

func (a *App) ensureBuiltinProviderPip(providerID string, moduleDirectory string, pythonBinaryPath string, env []string, logFile *os.File) error {
	if err := a.runBuiltinProviderLoggedCommand(providerID, pythonBinaryPath, []string{"-m", "pip", "--version"}, moduleDirectory, env, logFile); err == nil {
		return nil
	} else if errors.Is(err, errBuiltinProviderInitializationCancelled) {
		return err
	}
	a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] pip is missing, bootstrapping with ensurepip...")
	if err := a.runBuiltinProviderLoggedCommand(providerID, pythonBinaryPath, []string{"-m", "ensurepip", "--upgrade"}, moduleDirectory, env, logFile); err != nil {
		return err
	}
	return a.runBuiltinProviderLoggedCommand(providerID, pythonBinaryPath, []string{"-m", "pip", "--version"}, moduleDirectory, env, logFile)
}

func (a *App) installBuiltinProviderRequirements(providerID string, moduleDirectory string, pythonBinaryPath string, language string, env []string, logFile *os.File) error {
	requirementsPath := filepath.Join(moduleDirectory, "requirements.lock.txt")
	if _, err := os.Stat(requirementsPath); err != nil {
		return err
	}

	a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] Installing Python dependencies from requirements.lock.txt...")
	defaultArgs := []string{
		"-m", "pip", "install",
		"--disable-pip-version-check",
		"--require-hashes",
		"-r", "requirements.lock.txt",
	}

	if builtinProviderUsesChineseMirror(language) {
		mirrorArgs := []string{
			"-m", "pip", "install",
			"--disable-pip-version-check",
			"--index-url", "https://pypi.tuna.tsinghua.edu.cn/simple",
			"--trusted-host", "pypi.tuna.tsinghua.edu.cn",
			"--require-hashes",
			"-r", "requirements.lock.txt",
		}
		a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] Chinese UI detected, trying Tsinghua PyPI mirror first.")
		if err := a.runBuiltinProviderLoggedCommand(providerID, pythonBinaryPath, mirrorArgs, moduleDirectory, env, logFile); err == nil {
			return nil
		} else if errors.Is(err, errBuiltinProviderInitializationCancelled) {
			return err
		} else {
			a.appendBuiltinProviderLog(logFile, providerID, "[Lumin] Mirror install failed, retrying with official PyPI.", "")
		}
	}

	return a.runBuiltinProviderLoggedCommand(providerID, pythonBinaryPath, defaultArgs, moduleDirectory, env, logFile)
}

func (a *App) builtinKimiServiceRunning() bool {
	preset, ok := ai.GetAIBuiltinProviderPreset("builtin-kimi")
	if !ok {
		return false
	}
	parsedURL, err := url.Parse(strings.TrimSpace(preset.BaseURL))
	if err != nil || strings.TrimSpace(parsedURL.Host) == "" {
		return false
	}
	conn, err := net.DialTimeout("tcp", parsedURL.Host, 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func builtinProviderLogPath(programDirectory string, providerID string) string {
	switch strings.TrimSpace(providerID) {
	case "", "builtin-kimi":
		return filepath.Join(programDirectory, "modules", "kimiapi", "data", "luminssh-kimiapi.log")
	default:
		return ""
	}
}

func readBuiltinProviderLogTail(programDirectory string, providerID string, maxLines int) string {
	logPath := builtinProviderLogPath(programDirectory, providerID)
	if strings.TrimSpace(logPath) == "" {
		return ""
	}
	data, err := os.ReadFile(logPath)
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return ""
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if maxLines > 0 && len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func wrapBuiltinProviderError(programDirectory string, providerID string, prefix string, err error) error {
	logTail := readBuiltinProviderLogTail(programDirectory, providerID, 20)
	if logTail == "" {
		if err != nil {
			return fmt.Errorf("%s: %w", prefix, err)
		}
		return fmt.Errorf("%s", prefix)
	}
	if err != nil {
		return fmt.Errorf("%s: %w\n\n最近日志:\n%s", prefix, err, logTail)
	}
	return fmt.Errorf("%s\n\n最近日志:\n%s", prefix, logTail)
}

func (a *App) GetBuiltinProviderRuntimeStatus(providerID string) BuiltinProviderRuntimeStatus {
	normalizedProviderID := strings.TrimSpace(providerID)
	if normalizedProviderID == "" {
		normalizedProviderID = "builtin-kimi"
	}
	status := BuiltinProviderRuntimeStatus{
		ProviderID: normalizedProviderID,
		State:      "idle",
		Ready:      false,
	}
	if normalizedProviderID != "builtin-kimi" {
		return status
	}
	if a.builtinKimiServiceRunning() {
		status.State = "running"
		status.Ready = true
		return status
	}
	if isBuiltinProcessRunning(a.getBuiltinProcess(normalizedProviderID)) {
		status.State = "starting"
	}
	return status
}

func (a *App) waitBuiltinProviderReady(providerID string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	programDirectory := getProgramDirectory()
	for time.Now().Before(deadline) {
		status := a.GetBuiltinProviderRuntimeStatus(providerID)
		if status.State == "running" {
			return nil
		}
		if status.State == "idle" {
			return wrapBuiltinProviderError(programDirectory, providerID, "kimiapi 启动失败", nil)
		}
		time.Sleep(250 * time.Millisecond)
	}
	return wrapBuiltinProviderError(programDirectory, providerID, "kimiapi 启动超时", nil)
}

func resolveDownloadDefaultDirectory(template string) string {
	programDir := getProgramDirectory()
	trimmed := strings.TrimSpace(template)
	if trimmed == "" {
		trimmed = "${APP_DIR}\\download"
	}
	resolved := strings.ReplaceAll(trimmed, "${APP_DIR}", programDir)
	resolved = strings.ReplaceAll(resolved, "%APP_DIR%", programDir)
	resolved = strings.ReplaceAll(resolved, "\\", string(os.PathSeparator))
	resolved = strings.ReplaceAll(resolved, "/", string(os.PathSeparator))
	if !filepath.IsAbs(resolved) && programDir != "" {
		resolved = filepath.Join(programDir, resolved)
	}
	absolutePath, err := filepath.Abs(resolved)
	if err == nil {
		resolved = absolutePath
	}
	return filepath.Clean(resolved)
}

func resolveDownloadBasePath(remotePath string, defaultDir string, isDirectory bool) string {
	defaultDirectory := resolveDownloadDefaultDirectory(defaultDir)
	if defaultDirectory == "" {
		return ""
	}
	baseName := filepath.Base(strings.TrimSpace(remotePath))
	if isDirectory {
		baseName = remoteDownloadBaseName(remotePath)
	}
	return filepath.Join(defaultDirectory, baseName)
}

func resolveDownloadLocalPath(localPath string, isDirectory bool, optionsJSON string) string {
	cleaned := filepath.Clean(strings.TrimSpace(localPath))
	if cleaned == "" {
		return ""
	}
	options := parseDownloadConflictOptions(optionsJSON)
	if options.strategyFor(".") != downloadConflictStrategyAutoRename {
		return cleaned
	}
	if _, err := os.Stat(cleaned); os.IsNotExist(err) {
		return cleaned
	}
	renamedPath, err := buildDownloadRenamedPath(cleaned, options.RenameSuffixMode, isDirectory)
	if err != nil {
		return cleaned
	}
	return renamedPath
}

func resolveDownloadTargetPath(remotePath string, defaultDir string, isDirectory bool, optionsJSON string) string {
	basePath := resolveDownloadBasePath(remotePath, defaultDir, isDirectory)
	if basePath == "" {
		return ""
	}
	return resolveDownloadLocalPath(basePath, isDirectory, optionsJSON)
}

func (a *App) GetProgramDirectory() string {
	return getProgramDirectory()
}

func getGitHubContributorsOnce(client *http.Client) ([]GitHubContributor, error) {
	request, err := http.NewRequest(http.MethodGet, githubContributorsAPIURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Lumin-SSH")
	request.Header.Set("X-Requested-With", "XMLHttpRequest")
	request.Header.Set("Referer", githubContributorsRefererURL)

	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github contributors request failed: %s", response.Status)
	}

	var contributors []GitHubContributor
	if err := json.NewDecoder(response.Body).Decode(&contributors); err != nil {
		return nil, err
	}
	if contributors == nil {
		return []GitHubContributor{}, nil
	}
	return contributors, nil
}

func (a *App) GetGitHubContributors() ([]GitHubContributor, error) {
	client := &http.Client{Timeout: githubContributorsRequestTimeout}
	var lastErr error
	for attempt := 0; attempt <= githubContributorsMaxRetries; attempt++ {
		contributors, err := getGitHubContributorsOnce(client)
		if err == nil {
			return contributors, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("github contributors request failed")
	}
	return nil, lastErr
}

func (a *App) ListProgramFonts() ([]ProgramFontInfo, error) {
	return listProgramFontsFromDirectory()
}

func (a *App) SelectProgramFontFiles() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择字体文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "字体文件 (*.ttf;*.otf;*.ttc;*.woff;*.woff2)", Pattern: "*.ttf;*.otf;*.ttc;*.woff;*.woff2"},
		},
	})
}

func (a *App) ImportProgramFontFiles(paths []string) ([]ProgramFontInfo, error) {
	fontsDirectory, err := ensureProgramFontsDirectory()
	if err != nil {
		return nil, err
	}
	imported := make([]ProgramFontInfo, 0, len(paths))
	seen := map[string]bool{}
	for _, path := range paths {
		fontInfo, copyErr := copyProgramFontFile(path, fontsDirectory)
		if copyErr != nil {
			return nil, copyErr
		}
		if seen[fontInfo.FileName] {
			continue
		}
		seen[fontInfo.FileName] = true
		imported = append(imported, fontInfo)
	}
	return imported, nil
}

func (a *App) GetProgramFontDataURL(fileName string) (string, error) {
	return buildProgramFontDataURL(fileName)
}

func (a *App) ResolveDownloadPath(remotePath string, defaultDir string, isDirectory bool, optionsJSON string) string {
	return resolveDownloadTargetPath(remotePath, defaultDir, isDirectory, optionsJSON)
}

func (a *App) ResolveDownloadLocalPath(localPath string, isDirectory bool, optionsJSON string) string {
	return resolveDownloadLocalPath(localPath, isDirectory, optionsJSON)
}

func (a *App) PreviewDownloadConflicts(sessionId string, remotePath string, localPath string, isDirectory bool) ([]map[string]interface{}, error) {
	return a.sshManager.PreviewDownloadConflicts(sessionId, remotePath, localPath, isDirectory)
}

func (a *App) DownloadFile(sessionId string, remotePath string, defaultDir string) error {
	localPath := resolveDownloadTargetPath(remotePath, defaultDir, false, "")
	if localPath == "" {
		return fmt.Errorf("failed to resolve download path")
	}
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return err
	}
	return a.sshManager.DownloadFile(sessionId, remotePath, localPath)
}

func (a *App) DownloadFileToLocal(sessionId string, downloadID string, remotePath string, localPath string, optionsJSON string) error {
	return a.sshManager.DownloadFileToLocal(sessionId, downloadID, remotePath, localPath, optionsJSON)
}

func (a *App) DownloadDirectoryToLocal(sessionId string, downloadID string, remotePath string, localDir string, optionsJSON string) error {
	return a.sshManager.DownloadDirectoryToLocal(sessionId, downloadID, remotePath, localDir, optionsJSON)
}

func (a *App) DownloadDirectoryCompressed(sessionId string, downloadID string, remotePath string, localDir string, optionsJSON string) error {
	return a.sshManager.DownloadDirectoryCompressed(sessionId, downloadID, remotePath, localDir, optionsJSON)
}

func (a *App) AbortDownloadTransfer(identifier string) error {
	return a.sshManager.AbortDownloadTransfer(identifier)
}

func openLocalDocument(path string) error {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned == "" {
		return fmt.Errorf("missing local path")
	}
	if _, err := os.Stat(cleaned); err != nil {
		return err
	}
	switch goruntime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", cleaned).Start()
	case "darwin":
		return exec.Command("open", cleaned).Start()
	default:
		return exec.Command("xdg-open", cleaned).Start()
	}
}

func (a *App) OpenBuiltinProviderDoc(providerID string) error {
	normalizedProviderID := strings.TrimSpace(providerID)
	if normalizedProviderID == "" {
		normalizedProviderID = "builtin-kimi"
	}
	fileName := ""
	switch normalizedProviderID {
	case "builtin-kimi":
		fileName = "builtin-kimi.md"
	default:
		return fmt.Errorf("unsupported builtin provider: %s", normalizedProviderID)
	}
	if err := a.ensureBuiltinProviderBundle(normalizedProviderID); err != nil {
		return err
	}
	docPath := filepath.Join(getProgramDirectory(), "modules", "kimiapi", fileName)
	return openLocalDocument(docPath)
}

func (a *App) OpenLocalPathInExplorer(localPath string, isDirectory bool) error {
	return openLocalPathInExplorer(localPath, isDirectory)
}

// ReadPrivateKeyFile opens a file dialog to read a private key file
func (a *App) ReadPrivateKeyFile() (string, error) {
	keyPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择私钥文件",
	})
	if err != nil || keyPath == "" {
		return "", err
	}
	content, err := os.ReadFile(keyPath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

// WebDAV Methods
func (a *App) GetWebdavConfig() map[string]string {
	return a.configManager.GetWebdavConfig()
}

func (a *App) SaveWebdavConfig(config map[string]string) error {
	return a.configManager.SaveWebdavConfig(config)
}

func (a *App) TestWebdavConnection(url, username, password string) error {
	return a.configManager.TestWebdavConnection(url, username, password)
}

func (a *App) BackupToWebdav() (map[string]interface{}, error) {
	return a.configManager.BackupToWebdav()
}

func (a *App) ListWebdavBackups() ([]map[string]interface{}, error) {
	return a.configManager.ListWebdavBackups()
}

func (a *App) RestoreFromWebdavFile(filename string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromWebdavFile(filename)
}

func (a *App) RestoreFromWebdavFileWithPassword(filename string, password string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromWebdavFileWithPassword(filename, password)
}

func (a *App) SyncFromWebdav() (map[string]interface{}, error) {
	return a.configManager.SyncFromWebdav()
}

// R2 Methods
func (a *App) GetR2Config() map[string]interface{} {
	conf := a.configManager.GetR2Config()
	if conf == nil {
		return nil
	}
	return map[string]interface{}{
		"accessKeyId":     conf.AccessKeyID,
		"secretAccessKey": conf.SecretAccessKey,
		"bucket":          conf.Bucket,
		"endpoint":        conf.Endpoint,
		"region":          conf.Region,
		"prefix":          conf.Prefix,
		"maxBackups":      conf.MaxBackups,
	}
}

func (a *App) SaveR2Config(config map[string]string) error {
	return a.configManager.SaveR2Config(config)
}

func (a *App) TestR2Connection(accessKeyId, secretAccessKey, bucket, endpoint string) error {
	return a.configManager.TestR2Connection(accessKeyId, secretAccessKey, bucket, endpoint)
}

func (a *App) BackupToR2() (map[string]interface{}, error) {
	return a.configManager.BackupToR2()
}

func (a *App) ListR2Backups() ([]map[string]interface{}, error) {
	return a.configManager.ListR2Backups()
}

func (a *App) RestoreFromR2File(objectKey string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromR2File(objectKey)
}

func (a *App) RestoreFromR2FileWithPassword(objectKey string, password string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromR2FileWithPassword(objectKey, password)
}

func (a *App) SyncFromR2() (map[string]interface{}, error) {
	return a.configManager.SyncFromR2()
}

// SyncMode methods
func (a *App) GetSyncMode() string {
	return a.configManager.GetSyncMode()
}

func (a *App) SetSyncMode(mode string) error {
	return a.configManager.SetSyncMode(mode)
}

func (a *App) GetAutoSyncEnabled() bool {
	return a.configManager.GetAutoSyncEnabled()
}

func (a *App) GetLastSyncTime() int64 {
	if a == nil || a.configManager == nil {
		return 0
	}
	return a.configManager.loadLastSyncTimeMax()
}

// GetSyncTombstoneStats 返回本地同步删除记录条数。
func (a *App) GetSyncTombstoneStats() SyncTombstoneStats {
	if a == nil || a.configManager == nil {
		return SyncTombstoneStats{}
	}
	return a.configManager.GetSyncTombstoneStats()
}

// PruneSyncTombstones 按天数清理删除记录并上传到已配置云端。
// days <= 0 表示清理全部。
func (a *App) PruneSyncTombstones(days int) (SyncTombstonePruneResult, error) {
	if a == nil || a.configManager == nil {
		return SyncTombstonePruneResult{}, fmt.Errorf("配置未初始化")
	}
	return a.configManager.PruneSyncTombstones(days)
}

func (a *App) SetAutoSyncEnabled(enabled bool) error {
	return a.configManager.SetAutoSyncEnabled(enabled)
}

// RecoveryPassword methods
func (a *App) GetRecoveryPassword() string {
	return a.configManager.GetRecoveryPassword()
}

func (a *App) SetRecoveryPassword(password string) error {
	return a.configManager.SetRecoveryPassword(password)
}

func (a *App) ChangeRecoveryPassword(newPassword string) error {
	return a.configManager.ChangeRecoveryPassword(newPassword)
}

func (a *App) ResetRecoveryPassword(newPassword string) error {
	return a.configManager.ResetRecoveryPassword(newPassword)
}

func (a *App) SyncWithRecoveryPassword(password string) (map[string]interface{}, error) {
	return a.configManager.SyncWithRecoveryPassword(password)
}

func (a *App) GetProxyNodes() []ai.AIProxyNode {
	if a == nil || a.configManager == nil {
		return []ai.AIProxyNode{}
	}
	return a.configManager.GetAIProxyNodes()
}

func (a *App) SaveProxyNodes(jsonStr string) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	var nodes []ai.AIProxyNode
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &nodes); err != nil {
			return err
		}
	}
	if err := a.configManager.SaveAIProxyNodes(nodes); err != nil {
		return err
	}
	a.configManager.bumpSnapshotTime()
	go a.configManager.AutoSync()
	return nil
}

func (a *App) SyncAllProviders() (map[string]interface{}, error) {
	return a.configManager.SyncAllProviders()
}

// FTP Methods
func (a *App) GetFTPConfig() map[string]interface{} {
	conf := a.configManager.GetFTPConfig()
	if conf == nil {
		return nil
	}
	return map[string]interface{}{
		"mode":       conf.Mode,
		"host":       conf.Host,
		"port":       conf.Port,
		"username":   conf.Username,
		"password":   conf.Password,
		"remoteDir":  conf.RemoteDir,
		"maxBackups": conf.MaxBackups,
	}
}

func (a *App) SaveFTPConfig(config map[string]string) error {
	return a.configManager.SaveFTPConfig(config)
}

func (a *App) TestFTPConnection(host string, port int, username, password, mode string) (*FTPConnectionTestResult, error) {
	return a.configManager.TestFTPConnection(host, port, username, password, mode)
}

func (a *App) TestFTPConnectionWithCertificateApproval(host string, port int, username, password, mode, approvedFingerprint, expectedPinnedFingerprint string) (*FTPConnectionTestResult, error) {
	return a.configManager.TestFTPConnectionWithCertificateApproval(host, port, username, password, mode, approvedFingerprint, expectedPinnedFingerprint)
}

func (a *App) BackupToFTP() (map[string]interface{}, error) {
	return a.configManager.BackupToFTP()
}

func (a *App) ListFTPBackups() ([]map[string]interface{}, error) {
	return a.configManager.ListFTPBackups()
}

func (a *App) RestoreFromFTPFile(filename string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromFTPFile(filename)
}

func (a *App) RestoreFromFTPFileWithPassword(filename string, password string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromFTPFileWithPassword(filename, password)
}

func (a *App) SyncFromFTP() (map[string]interface{}, error) {
	return a.configManager.SyncFromFTP()
}

// SFTP Methods
func (a *App) GetSFTPConfig() map[string]interface{} {
	conf := a.configManager.GetSFTPConfig()
	if conf == nil {
		return nil
	}
	return map[string]interface{}{
		"host":       conf.Host,
		"port":       conf.Port,
		"username":   conf.Username,
		"authMethod": conf.AuthMethod,
		"password":   conf.Password,
		"privateKey": conf.PrivateKey,
		"remoteDir":  conf.RemoteDir,
		"maxBackups": conf.MaxBackups,
	}
}

func (a *App) SaveSFTPConfig(config map[string]string) error {
	return a.configManager.SaveSFTPConfig(config)
}

func (a *App) TestSFTPConnection(host string, port int, username, password, authMethod, privateKey, passphrase string) (*SFTPConnectionTestResult, error) {
	return a.configManager.TestSFTPConnection(host, port, username, password, authMethod, privateKey, passphrase)
}

func (a *App) TestSFTPConnectionWithHostKeyApproval(host string, port int, username, password, authMethod, privateKey, passphrase, approvedFingerprint string) (*SFTPConnectionTestResult, error) {
	return a.configManager.TestSFTPConnectionWithHostKeyApproval(host, port, username, password, authMethod, privateKey, passphrase, approvedFingerprint)
}

func (a *App) BackupToSFTP() (map[string]interface{}, error) {
	return a.configManager.BackupToSFTP()
}

func (a *App) ListSFTPBackups() ([]map[string]interface{}, error) {
	return a.configManager.ListSFTPBackups()
}

func (a *App) RestoreFromSFTPFile(filename string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromSFTPFile(filename)
}

func (a *App) RestoreFromSFTPFileWithPassword(filename string, password string) (map[string]interface{}, error) {
	return a.configManager.RestoreFromSFTPFileWithPassword(filename, password)
}

func (a *App) SyncFromSFTP() (map[string]interface{}, error) {
	return a.configManager.SyncFromSFTP()
}

// RetrySync 手动重试云端同步，返回空字符串表示成功，非空为错误信息
func (a *App) RetrySync() string {
	return a.configManager.RetrySync()
}

// GetQuickCommands 获取快捷命令列表
func (a *App) GetQuickCommands() string {
	return a.configManager.GetQuickCommands()
}

// SaveQuickCommands 保存快捷命令列表
func (a *App) SaveQuickCommands(jsonStr string) error {
	return a.configManager.SaveQuickCommands(jsonStr)
}

// SaveQuickCommandsLocal 保存快捷命令列表到本地，不触发云端同步
func (a *App) SaveQuickCommandsLocal(jsonStr string) error {
	return a.configManager.SaveQuickCommandsLocal(jsonStr)
}

func (a *App) GetRememberWorkspace() bool {
	return a.configManager.GetRememberWorkspace()
}

func (a *App) SetRememberWorkspace(enabled bool) error {
	return a.configManager.SetRememberWorkspace(enabled)
}

func (a *App) GetWorkspacePersistenceLevel() string {
	return a.configManager.GetWorkspacePersistenceLevel()
}

func (a *App) SetWorkspacePersistenceLevel(level string) error {
	return a.configManager.SetWorkspacePersistenceLevel(level)
}

func (a *App) SupportsWebviewGpuDisable() bool {
	return goruntime.GOOS == "windows"
}

func (a *App) GetWebviewGpuDisabled() bool {
	if !a.SupportsWebviewGpuDisable() || a.configManager == nil {
		return false
	}
	return a.configManager.GetWebviewGpuDisabled()
}

func (a *App) SetWebviewGpuDisabled(enabled bool) error {
	if !a.SupportsWebviewGpuDisable() || a.configManager == nil {
		return fmt.Errorf("current platform does not support disabling webview gpu acceleration")
	}
	return a.configManager.SetWebviewGpuDisabled(enabled)
}

func (a *App) GetRuntimeEnvironmentSettings() runtimeenv.Settings {
	if a == nil || a.configManager == nil {
		return runtimeenv.DefaultSettings()
	}
	return a.configManager.GetRuntimeEnvironmentSettings()
}

func (a *App) SaveRuntimeEnvironmentSettings(jsonStr string) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	settings := runtimeenv.DefaultSettings()
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &settings); err != nil {
			return err
		}
	}
	return a.configManager.SaveRuntimeEnvironmentSettings(settings)
}

func (a *App) GetRuntimeEnvironmentStatus() runtimeenv.Status {
	settings := a.GetRuntimeEnvironmentSettings()
	return runtimeenv.DetectStatus(getProgramDirectory(), settings)
}

func (a *App) InstallRuntimeEnvironment(language string) (runtimeenv.Status, error) {
	settings := a.GetRuntimeEnvironmentSettings()
	return runtimeinstaller.InstallRuntimeEnvironment(getProgramDirectory(), settings, language)
}

func (a *App) InjectAIBuiltinLoginBridge(jsonStr string) error {
	if a == nil || a.ctx == nil {
		return nil
	}
	payload := map[string]interface{}{}
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &payload); err != nil {
			return err
		}
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	script := `(function(){try{const payload=` + string(payloadBytes) + `;const frames=Array.from(document.querySelectorAll("iframe"));const frame=frames.find((item)=>{const expectedSrc=typeof payload.frameSrc==="string"?payload.frameSrc:"";const expectedTitle=typeof payload.frameTitle==="string"?payload.frameTitle:"";return(expectedSrc&&typeof item.src==="string"&&item.src.indexOf(expectedSrc)===0)||(expectedTitle&&item.title===expectedTitle)})||frames[0];if(!frame||!frame.contentWindow||!payload.message){return;}frame.contentWindow.postMessage(payload.message,payload.targetOrigin||"*");window.__luminBuiltinLoginBridgeLastPayload=payload;}catch(_){}})();`
	runtime.WindowExecJS(a.ctx, script)
	return nil
}

func (a *App) InitializeBuiltinProvider(providerID string, language string) error {
	normalizedProviderID := strings.TrimSpace(providerID)
	if normalizedProviderID == "" {
		normalizedProviderID = "builtin-kimi"
	}
	if normalizedProviderID != "builtin-kimi" {
		return fmt.Errorf("unsupported builtin provider: %s", normalizedProviderID)
	}
	a.setBuiltinProviderInitCancelled(normalizedProviderID, false)
	defer a.setBuiltinProviderInitCancelled(normalizedProviderID, false)
	if err := a.ensureMainLivenessLock(); err != nil {
		return err
	}
	if a.builtinKimiServiceRunning() {
		return nil
	}
	if err := a.ensureBuiltinProviderBundle(normalizedProviderID); err != nil {
		return err
	}

	a.builtinProcessMu.Lock()
	existingProcess := a.builtinProcesses[normalizedProviderID]
	if isBuiltinProcessRunning(existingProcess) {
		a.builtinProcessMu.Unlock()
		return a.waitBuiltinProviderReady(normalizedProviderID, 20*time.Second)
	}

	programDirectory := getProgramDirectory()
	runtimeSettings := runtimeenv.DefaultSettings()
	if a != nil && a.configManager != nil {
		runtimeSettings = a.configManager.GetRuntimeEnvironmentSettings()
	}
	runtimeStatus := runtimeenv.DetectStatus(programDirectory, runtimeSettings)
	if !runtimeStatus.Ready || strings.TrimSpace(runtimeStatus.BinaryPath) == "" {
		a.builtinProcessMu.Unlock()
		return fmt.Errorf("uv 运行环境未就绪，请先在运行环境页面完成安装")
	}

	moduleDirectory := filepath.Join(programDirectory, "modules", "kimiapi")
	if _, err := os.Stat(filepath.Join(moduleDirectory, "pyproject.toml")); err != nil {
		a.builtinProcessMu.Unlock()
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "缺少 kimiapi 项目文件", err)
	}
	if _, err := os.Stat(filepath.Join(moduleDirectory, "requirements.lock.txt")); err != nil {
		a.builtinProcessMu.Unlock()
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "缺少 kimiapi 依赖锁定文件", err)
	}
	if err := os.MkdirAll(filepath.Join(moduleDirectory, "data"), 0o755); err != nil {
		a.builtinProcessMu.Unlock()
		return err
	}

	logFile, err := os.OpenFile(filepath.Join(moduleDirectory, "data", "luminssh-kimiapi.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		a.builtinProcessMu.Unlock()
		return err
	}

	baseEnv := append(os.Environ(),
		"LUMINSSH_MAIN_LOCK_PATH="+a.mainLivenessLockPath,
		"LUMINSSH_MAIN_LOCK_POLL_INTERVAL=1",
		"PYTHONUTF8=1",
		"HTTP_PROXY=",
		"HTTPS_PROXY=",
		"ALL_PROXY=",
		"NO_PROXY=",
		"http_proxy=",
		"https_proxy=",
		"all_proxy=",
		"no_proxy=",
	)

	a.builtinProcessMu.Unlock()

	if err := a.ensureBuiltinProviderVenv(normalizedProviderID, runtimeStatus.BinaryPath, moduleDirectory, baseEnv, logFile); err != nil {
		_ = logFile.Close()
		if errors.Is(err, errBuiltinProviderInitializationCancelled) {
			return err
		}
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "kimiapi Python 环境准备失败", err)
	}

	pythonBinaryPath := builtinProviderVenvPythonPath(moduleDirectory)
	if _, err := os.Stat(pythonBinaryPath); err != nil {
		_ = logFile.Close()
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "未找到 kimiapi 虚拟环境 Python", err)
	}

	if err := a.ensureBuiltinProviderPip(normalizedProviderID, moduleDirectory, pythonBinaryPath, baseEnv, logFile); err != nil {
		_ = logFile.Close()
		if errors.Is(err, errBuiltinProviderInitializationCancelled) {
			return err
		}
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "kimiapi pip 环境准备失败", err)
	}

	if err := a.installBuiltinProviderRequirements(normalizedProviderID, moduleDirectory, pythonBinaryPath, language, baseEnv, logFile); err != nil {
		_ = logFile.Close()
		if errors.Is(err, errBuiltinProviderInitializationCancelled) {
			return err
		}
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "kimiapi 依赖安装失败", err)
	}

	a.builtinProcessMu.Lock()
	existingProcess = a.builtinProcesses[normalizedProviderID]
	if isBuiltinProcessRunning(existingProcess) {
		a.builtinProcessMu.Unlock()
		_ = logFile.Close()
		return a.waitBuiltinProviderReady(normalizedProviderID, 20*time.Second)
	}

	cmd := exec.Command(pythonBinaryPath, "run.py", "--main-liveness-lock-path", a.mainLivenessLockPath)
	cmd.Dir = moduleDirectory
	cmd.Env = baseEnv
	outputWriter := io.MultiWriter(logFile, builtinProviderInitEventWriter{app: a, providerID: normalizedProviderID})
	cmd.Stdout = outputWriter
	cmd.Stderr = outputWriter
	a.setBuiltinProviderInitCommand(normalizedProviderID, cmd)
	if err := cmd.Start(); err != nil {
		a.clearBuiltinProviderInitCommand(normalizedProviderID, cmd)
		_ = logFile.Close()
		a.builtinProcessMu.Unlock()
		return wrapBuiltinProviderError(programDirectory, normalizedProviderID, "kimiapi 进程启动失败", err)
	}

	a.builtinProcesses[normalizedProviderID] = cmd
	a.builtinProcessMu.Unlock()

	go func(expectedProviderID string, expectedCmd *exec.Cmd, file *os.File) {
		_ = expectedCmd.Wait()
		_ = file.Close()
		a.builtinProcessMu.Lock()
		if currentProcess := a.builtinProcesses[expectedProviderID]; currentProcess == expectedCmd {
			delete(a.builtinProcesses, expectedProviderID)
		}
		a.builtinProcessMu.Unlock()
		a.clearBuiltinProviderInitCommand(expectedProviderID, expectedCmd)
	}(normalizedProviderID, cmd, logFile)

	if err := a.waitBuiltinProviderReady(normalizedProviderID, 20*time.Second); err != nil {
		a.builtinProcessMu.Lock()
		currentProcess := a.builtinProcesses[normalizedProviderID]
		if currentProcess == cmd {
			delete(a.builtinProcesses, normalizedProviderID)
		}
		a.builtinProcessMu.Unlock()
		if currentProcess == cmd && cmd.Process != nil && cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
		}
		a.clearBuiltinProviderInitCommand(normalizedProviderID, cmd)
		if a.isBuiltinProviderInitCancelled(normalizedProviderID) {
			return errBuiltinProviderInitializationCancelled
		}
		return err
	}

	a.clearBuiltinProviderInitCommand(normalizedProviderID, cmd)
	return nil
}

func (a *App) CancelBuiltinProviderInitialization(providerID string) error {
	normalizedProviderID := strings.TrimSpace(providerID)
	if normalizedProviderID == "" {
		normalizedProviderID = "builtin-kimi"
	}
	a.setBuiltinProviderInitCancelled(normalizedProviderID, true)

	a.builtinInitMu.Lock()
	command := a.builtinInitCommands[normalizedProviderID]
	a.builtinInitMu.Unlock()
	if command != nil && command.Process != nil && command.ProcessState == nil {
		if err := command.Process.Kill(); err != nil && !strings.Contains(strings.ToLower(err.Error()), "already finished") {
			return err
		}
	}
	return nil
}

func (a *App) GetLiveWorkspaceState() string {
	if a == nil {
		return ""
	}
	a.liveWorkspaceStateMu.RLock()
	defer a.liveWorkspaceStateMu.RUnlock()
	return a.liveWorkspaceState
}

func (a *App) SetLiveWorkspaceState(jsonStr string) error {
	if a == nil {
		return nil
	}
	trimmed := strings.TrimSpace(jsonStr)
	if trimmed != "" && !json.Valid([]byte(trimmed)) {
		return fmt.Errorf("invalid live workspace state")
	}
	a.liveWorkspaceStateMu.Lock()
	a.liveWorkspaceState = trimmed
	a.liveWorkspaceStateMu.Unlock()
	return nil
}

func (a *App) GetWorkspaceState() string {
	if liveState := a.GetLiveWorkspaceState(); liveState != "" {
		return liveState
	}
	if a == nil || a.configManager == nil {
		return ""
	}
	return a.configManager.GetWorkspaceState()
}

func (a *App) SaveWorkspaceState(jsonStr string) error {
	return a.configManager.SaveWorkspaceState(jsonStr)
}

func (a *App) GetWorkspaceSessionState(serverId string) string {
	return a.configManager.GetWorkspaceSessionState(serverId)
}

func (a *App) SaveWorkspaceSessionState(serverId string, jsonStr string) error {
	return a.configManager.SaveWorkspaceSessionState(serverId, jsonStr)
}

func (a *App) ClearWorkspaceState() error {
	return a.configManager.ClearWorkspaceState()
}

// GetParamHistory 获取参数历史
func (a *App) GetParamHistory() string {
	return a.configManager.GetParamHistory()
}

// SaveParamHistory 保存参数历史
func (a *App) SaveParamHistory(jsonStr string) error {
	return a.configManager.SaveParamHistory(jsonStr)
}

// GetCommandHistory 获取指定会话的命令历史
func (a *App) GetCommandHistory(sessionId string) string {
	return a.configManager.GetCommandHistory(sessionId)
}

// SaveCommandHistory 保存指定会话的命令历史
func (a *App) SaveCommandHistory(sessionId, jsonStr string) error {
	return a.configManager.SaveCommandHistory(sessionId, jsonStr)
}

// GetGlobalCommandHistory 获取全局命令历史
func (a *App) GetGlobalCommandHistory() string {
	return a.configManager.GetGlobalCommandHistory()
}

// SaveGlobalCommandHistory 保存全局命令历史
func (a *App) SaveGlobalCommandHistory(jsonStr string) error {
	return a.configManager.SaveGlobalCommandHistory(jsonStr)
}

// PingServer pings a server. mode 为延迟检测方式：auto / banner / tcp（见 ping.go normalizePingMode）。
func (a *App) PingServer(connId string, mode string) map[string]interface{} {
	conn, ok := a.configManager.GetConnectionByID(connId)
	if !ok {
		return map[string]interface{}{
			"online":  false,
			"latency": 0,
		}
	}
	resolvedConn, err := a.configManager.ResolveConnectionProxy(conn)
	if err != nil {
		return map[string]interface{}{
			"online":  false,
			"latency": 0,
		}
	}
	return PingServer(resolvedConn, mode)
}

// UpdateApp downloads a platform update package, verifies it, and starts the
// platform-specific installation or executable replacement flow.
func (a *App) UpdateApp(downloadUrl string, filename string, proxyFirst bool) error {
	// 1. 强制 HTTPS，防止明文下载可执行文件被篡改
	if !strings.HasPrefix(downloadUrl, "https://") {
		return fmt.Errorf("更新地址必须使用 HTTPS")
	}
	// Release asset names must not escape the temporary/download directory.
	filename = filepath.Base(strings.TrimSpace(filename))
	if filename == "." || filename == "" {
		return fmt.Errorf("更新文件名无效")
	}
	// 2. 下载新文件（带超时，防止慢网络永久阻塞）
	// ponytail: 对每个 URL 尝试完整的 下载→写入磁盘 流程，失败再试下一个。
	// 旧实现只在 Get() 阶段切换 URL，io.Copy 阶段超时直接放弃（"failed to save update file"），
	// 不会重试代理 URL。大文件 + 慢网络下直连极易在 body 读取阶段超时。
	client := &http.Client{Timeout: 10 * time.Minute}
	ghProxies := []string{"https://ghproxy.net/", "https://gh-proxy.com/", "https://proxy.gitwarp.top/"}
	var tryUrls []string
	if strings.Contains(downloadUrl, "github.com") {
		if proxyFirst {
			tryUrls = []string{ghProxies[0] + downloadUrl, ghProxies[1] + downloadUrl, ghProxies[2] + downloadUrl, downloadUrl}
		} else {
			tryUrls = []string{downloadUrl, ghProxies[0] + downloadUrl, ghProxies[1] + downloadUrl, ghProxies[2] + downloadUrl}
		}
	} else {
		tryUrls = []string{downloadUrl}
	}

	isDeb := strings.HasSuffix(strings.ToLower(filename), ".deb")
	isRpm := strings.HasSuffix(strings.ToLower(filename), ".rpm")
	isDmg := strings.HasSuffix(strings.ToLower(filename), ".dmg")
	isSetup := strings.Contains(strings.ToLower(filename), "installer") || strings.Contains(strings.ToLower(filename), "setup")
	var targetPath string
	var exePath string
	var needsElevated bool

	// 获取可执行文件路径，后续 deb 安装和便携版替换都可能需要
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not determine executable path: %w", err)
	}
	exePath = exe

	if isSetup || isDeb || isRpm || isDmg {
		// 安装包、.deb、.rpm 和 .dmg 都下载到临时目录
		targetPath = filepath.Join(os.TempDir(), filename)
	} else {
		// 便携版：下载到 exe 同级目录，或权限不足时降级到临时目录
		targetPath = exePath + ".update"

		// Test write access to exe directory upfront.
		// On Linux the app may be installed in /usr/bin/ where regular users
		// lack write permission, so we fall back to the temp directory.
		testFile, err := os.Create(targetPath)
		if err != nil {
			if os.IsPermission(err) {
				targetPath = filepath.Join(os.TempDir(), filepath.Base(exePath)+".update")
				needsElevated = true
			} else {
				return fmt.Errorf("could not create temporary update file: %w", err)
			}
		} else {
			testFile.Close()
			os.Remove(targetPath)
		}
	}

	var lastErr error
	for _, u := range tryUrls {
		err := downloadUpdatePackageWithFallback(client, a.ctx, u, targetPath, "app-update-progress")
		if err != nil {
			_ = os.Remove(targetPath)
			fmt.Printf("[UpdateApp] download from %s failed: err=%v, trying next\n", u, err)
			lastErr = err
			continue
		}

		downloadUrl = u
		lastErr = nil
		break
	}
	if lastErr != nil {
		return fmt.Errorf("failed to download update from all sources: %w", lastErr)
	}

	// 2.5 强制校验下载文件的 SHA256，校验失败不得继续安装/替换。
	shaResp, shaErr := client.Get(downloadUrl + ".sha256")
	if shaErr != nil {
		os.Remove(targetPath)
		return fmt.Errorf("failed to fetch .sha256 file: %w", shaErr)
	}
	defer shaResp.Body.Close()
	if shaResp.StatusCode != http.StatusOK {
		os.Remove(targetPath)
		return fmt.Errorf(".sha256 file returned %d", shaResp.StatusCode)
	}

	shaBody, shaReadErr := io.ReadAll(shaResp.Body)
	if shaReadErr != nil {
		os.Remove(targetPath)
		return fmt.Errorf("failed to read .sha256 file: %w", shaReadErr)
	}

	// .sha256 文件内容通常是 "<hash>  <filename>" 格式，取第一个字段。
	expectedHashFields := strings.Fields(strings.TrimSpace(string(shaBody)))
	if len(expectedHashFields) == 0 {
		os.Remove(targetPath)
		return fmt.Errorf("empty .sha256 file")
	}
	expectedHash := expectedHashFields[0]
	if len(expectedHash) != sha256.Size*2 {
		os.Remove(targetPath)
		return fmt.Errorf("invalid SHA256 length: %d", len(expectedHash))
	}
	if _, decodeErr := hex.DecodeString(expectedHash); decodeErr != nil {
		os.Remove(targetPath)
		return fmt.Errorf("invalid SHA256 hex: %w", decodeErr)
	}

	// 计算下载文件的 SHA256（流式读取，避免将整个安装包读入内存）
	f, openErr := os.Open(targetPath)
	if openErr != nil {
		os.Remove(targetPath)
		return fmt.Errorf("failed to open downloaded file for verification: %w", openErr)
	}
	h := sha256.New()
	if _, copyErr := io.Copy(h, f); copyErr != nil {
		f.Close()
		os.Remove(targetPath)
		return fmt.Errorf("failed to hash downloaded file: %w", copyErr)
	}
	f.Close()
	actualHashHex := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(actualHashHex, expectedHash) {
		os.Remove(targetPath)
		return fmt.Errorf("SHA256 mismatch: expected %s, got %s", expectedHash, actualHashHex)
	}

	// 3. 处理 .deb 包安装（Linux）
	if isDeb {
		if err := installDebPackage(targetPath); err != nil {
			return err
		}
		// dpkg -i 已替换 /usr/bin/lumin，重启为新版本
		if err := restartApp(exePath); err != nil {
			return err
		}
		os.Exit(0)
		return nil
	}

	// 3.5 处理 .rpm 包安装（Linux）
	if isRpm {
		if err := installRpmPackage(targetPath); err != nil {
			return err
		}
		if err := restartApp(exePath); err != nil {
			return err
		}
		os.Exit(0)
		return nil
	}

	// 4. macOS DMG 由独立更新进程替换 .app，并在旧进程退出后重启。
	if isDmg {
		if err := installDmgPackage(targetPath, exePath); err != nil {
			return err
		}
		os.Exit(0)
		return nil
	}

	// Windows 安装包交给系统安装器处理；其他文件走 Portable 替换。
	if isSetup {
		if err := launchInstaller(targetPath); err != nil {
			return err
		}
		// 退出当前应用以解除目录锁定
		os.Exit(0)
		return nil
	}

	// Portable 热更替换逻辑
	if needsElevated {
		if err := applyUpdateElevated(targetPath, exePath); err != nil {
			return err
		}
		os.Exit(0)
		return nil
	}

	oldPath := exePath + ".old"
	// 清理上次更新残留的 .old 文件
	os.Remove(oldPath)
	if err := os.Rename(exePath, oldPath); err != nil {
		os.Remove(targetPath)
		return fmt.Errorf("failed to rename current executable: %w", err)
	}

	if err := os.Rename(targetPath, exePath); err != nil {
		os.Rename(oldPath, exePath)
		return fmt.Errorf("failed to apply update file: %w", err)
	}

	if err := restartApp(exePath); err != nil {
		return err
	}

	os.Exit(0)
	return nil
}

// ── Credential 凭据管理 ──────────────────────────────────────────

func (a *App) GetCredentials() []Credential {
	return a.configManager.GetCredentialsMasked()
}

func (a *App) SaveCredential(cred Credential) Credential {
	return a.configManager.SaveCredential(cred)
}

func (a *App) DeleteCredential(id string) error {
	return a.configManager.DeleteCredential(id)
}
