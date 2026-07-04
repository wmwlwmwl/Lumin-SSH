package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx           context.Context
	sshManager    *SSHManager
	configManager *ConfigManager
	wsPort        int
	wsToken       string
	wsMu          sync.Mutex
	wsConns       map[string]*wsEntry // sessionId -> active WebSocket
	wsServer      *http.Server        // WebSocket HTTP 服务器，用于优雅关闭
	wsListener    net.Listener        // WebSocket 监听器，用于关闭时释放端口
	quitting      atomic.Bool         // 标记用户确认退出，OnBeforeClose 放行（跨 goroutine 访问需原子操作）
	closeAck      atomic.Bool         // 前端已响应关闭请求（tray/cancel），取消 5s 兜底强制退出
}

// wsEntry 包装一个 WebSocket 连接及其独立写锁。
// wsMu 仅保护 map 增删改查；写消息时用每连接独立锁，避免慢客户端阻塞其他 session。
type wsEntry struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sshManager:    NewSSHManager(),
		configManager: NewConfigManager(),
		wsConns:       make(map[string]*wsEntry),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.sshManager.ctx = ctx // Give SSH manager access to Wails events
	a.sshManager.app = a   // Give SSH manager access to WebSocket registry
	a.configManager.wailsCtx = ctx

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
			// 精确匹配 Wails WebView Origin，防止 DNS rebinding 攻击
			return origin == "wails://wails" ||
				origin == "http://wails.localhost" ||
				origin == "https://wails.localhost"
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

// SaveConnection saves a new or existing connection
func (a *App) SaveConnection(conn Connection, noSync bool) Connection {
	return a.configManager.SaveConnection(conn, noSync)
}

// DeleteConnection removes a connection by ID
func (a *App) DeleteConnection(id string) bool {
	return a.configManager.DeleteConnection(id)
}

// SetConnectionGroup 仅更新服务器分组
func (a *App) SetConnectionGroup(id string, group string) error {
	return a.configManager.SetConnectionGroup(id, group)
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
	conn = a.configManager.ResolveConnectionAuth(conn)
	return a.sshManager.Connect(sessionId, conn)
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

	resolved := a.configManager.ResolveConnectionAuth(conn)
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

// ChmodFile changes file permissions via SFTP
func (a *App) ChmodFile(sessionId string, path string, mode string) error {
	return a.sshManager.ChmodFile(sessionId, path, mode)
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

func (a *App) DownloadFile(sessionId string, remotePath string) error {
	filename := filepath.Base(remotePath)
	destPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save File",
		DefaultFilename: filename,
	})
	if err != nil || destPath == "" {
		return err
	}
	return a.sshManager.DownloadFile(sessionId, remotePath, destPath)
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

// FTP Methods
func (a *App) GetFTPConfig() map[string]interface{} {
	conf := a.configManager.GetFTPConfig()
	if conf == nil {
		return nil
	}
	return map[string]interface{}{
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

func (a *App) TestFTPConnection(host string, port int, username, password string) error {
	return a.configManager.TestFTPConnection(host, port, username, password)
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

func (a *App) TestSFTPConnection(host string, port int, username, password, authMethod, privateKey, passphrase string) error {
	return a.configManager.TestSFTPConnection(host, port, username, password, authMethod, privateKey, passphrase)
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

// PingServer pings a server
func (a *App) PingServer(host string, port int) map[string]interface{} {
	return PingServer(host, port)
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
	ghProxies := []string{"https://ghfast.top/", "https://proxy.gitwarp.top/"}
	var tryUrls []string
	if strings.Contains(downloadUrl, "github.com") {
		if proxyFirst {
			tryUrls = []string{ghProxies[0] + downloadUrl, ghProxies[1] + downloadUrl, downloadUrl}
		} else {
			tryUrls = []string{downloadUrl, ghProxies[0] + downloadUrl, ghProxies[1] + downloadUrl}
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
		resp, err := client.Get(u)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil {
				resp.Body.Close()
			}
			fmt.Printf("[UpdateApp] download from %s failed: err=%v, trying next\n", u, err)
			lastErr = err
			continue
		}

		pr := &progressReader{
			Reader:    resp.Body,
			ctx:       a.ctx,
			eventName: "app-update-progress",
			total:     resp.ContentLength,
			lastEmit:  time.Now(),
		}

		out, createErr := os.Create(targetPath)
		if createErr != nil {
			resp.Body.Close()
			return fmt.Errorf("could not create update file: %w", createErr)
		}

		_, copyErr := io.Copy(out, pr)
		out.Close()
		resp.Body.Close()

		if copyErr != nil {
			os.Remove(targetPath)
			fmt.Printf("[UpdateApp] save from %s failed: err=%v, trying next\n", u, copyErr)
			lastErr = copyErr
			continue
		}

		downloadUrl = u // 记录实际成功的 URL，后续 .sha256 也走同源
		lastErr = nil
		break
	}
	if lastErr != nil {
		return fmt.Errorf("failed to download update from all sources: %w", lastErr)
	}

	// 2.5 校验下载文件的 SHA256（如果发布方提供了 .sha256 文件）
	// 防止下载文件被篡改或损坏后直接替换可执行文件
	shaResp, shaErr := client.Get(downloadUrl + ".sha256")
	if shaErr != nil {
		// .sha256 文件获取失败（如 404），跳过校验但记录警告
		fmt.Printf("[UpdateApp] warning: failed to fetch .sha256 file, skipping verification: %v\n", shaErr)
	} else {
		if shaResp.StatusCode != http.StatusOK {
			shaResp.Body.Close()
			fmt.Printf("[UpdateApp] warning: .sha256 file returned %d, skipping verification\n", shaResp.StatusCode)
		} else {
			shaBody, shaReadErr := io.ReadAll(shaResp.Body)
			shaResp.Body.Close()
			if shaReadErr != nil {
				fmt.Printf("[UpdateApp] warning: failed to read .sha256 file, skipping verification: %v\n", shaReadErr)
			} else {
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

				// .sha256 文件内容通常是 "<hash>  <filename>" 格式，取第一个字段
				expectedHash := strings.Fields(strings.TrimSpace(string(shaBody)))
				if len(expectedHash) == 0 {
					fmt.Printf("[UpdateApp] warning: empty .sha256 file, skipping verification\n")
				} else {
					if !strings.EqualFold(actualHashHex, expectedHash[0]) {
						os.Remove(targetPath)
						return fmt.Errorf("SHA256 mismatch: expected %s, got %s", expectedHash[0], actualHashHex)
					}
				}
			}
		}
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
