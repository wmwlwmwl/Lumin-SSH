package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
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
	wsMu          sync.Mutex
	wsConns       map[string]*websocket.Conn // sessionId -> active WebSocket
	quitting      bool                       // 标记用户确认退出，OnBeforeClose 放行
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sshManager:    NewSSHManager(),
		configManager: NewConfigManager(),
		wsConns:       make(map[string]*websocket.Conn),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.sshManager.ctx = ctx // Give SSH manager access to Wails events
	a.sshManager.app = a   // Give SSH manager access to WebSocket registry

	// ── 启动本地 WebSocket 终端服务器 ─────────────────────────────────
	// 不经过 Wails IPC，直接走 TCP loopback，延迟极低
	mux := http.NewServeMux()
	// 仅允许 Wails WebView 的 Origin（防止本机恶意网页通过 DNS rebinding 连接）
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			// Wails WebView 的 Origin 通常是 wails:// 或 http://wails.localhost
			return origin == "" ||
				strings.HasPrefix(origin, "wails://") ||
				strings.HasPrefix(origin, "http://wails.") ||
				strings.HasPrefix(origin, "https://wails.")
		},
		ReadBufferSize:  4096,
		WriteBufferSize: 32768,
	}
	mux.HandleFunc("/ws/", func(w http.ResponseWriter, r *http.Request) {
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
		a.wsMu.Lock()
		a.wsConns[sessionId] = conn
		a.wsMu.Unlock()
		defer func() {
			a.wsMu.Lock()
			delete(a.wsConns, sessionId)
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
		go func() {
			_ = http.Serve(listener, mux)
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

	// 启动时清理孤儿历史文件 + 后台同步
	a.configManager.CleanupOrphanedHistory()
	go a.configManager.AutoSync()
}

// DoQuit 用户确认退出，设标记让 OnBeforeClose 放行
func (a *App) DoQuit() {
	a.quitting = true
	runtime.Quit(a.ctx)
}

// GetWsPort 返回本地 WebSocket 服务器端口，前端用于连接终端
func (a *App) GetWsPort() int {
	return a.wsPort
}

// WriteWsToSession 将 WebSocket 输出写入给指定 session 的 WS 连接
func (a *App) WriteWsOutput(sessionId string, data []byte) {
	a.wsMu.Lock()
	conn, ok := a.wsConns[sessionId]
	a.wsMu.Unlock()
	if ok {
		// 设置写超时，防止前端停止读取后 goroutine 永久阻塞
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		err := conn.WriteMessage(websocket.BinaryMessage, data)
		if err != nil {
			// 写失败（超时/连接断开），关闭并移除该连接
			a.wsMu.Lock()
			delete(a.wsConns, sessionId)
			a.wsMu.Unlock()
			conn.Close()
		}
	}
}

// IsPortableVersion checks if the current executable is the portable version
func (a *App) IsPortableVersion() bool {
	exePath, err := os.Executable()
	if err != nil {
		return false
	}
	exeName := strings.ToLower(filepath.Base(exePath))
	return strings.Contains(exeName, "portable")
}

// GetConnections returns all saved SSH connections
func (a *App) GetConnections() []Connection {
	return a.configManager.GetConnections()
}

// SaveConnection saves a new or existing connection
func (a *App) SaveConnection(conn Connection) Connection {
	return a.configManager.SaveConnection(conn)
}

// DeleteConnection removes a connection by ID
func (a *App) DeleteConnection(id string) bool {
	return a.configManager.DeleteConnection(id)
}

// ConnectSSH establishes an SSH connection
func (a *App) ConnectSSH(sessionId string, connId string) error {
	conn := a.configManager.GetConnectionByID(connId)
	if conn == nil {
		return fmt.Errorf("connection not found")
	}
	return a.sshManager.Connect(sessionId, *conn)
}

// ReconnectWithPassword 更新密码并重连（认证失败后使用）
// persist: true=保存到已知主机列表, false=仅本次会话使用
func (a *App) ReconnectWithPassword(sessionId string, connId string, newPassword string, persist bool) error {
	conn := a.configManager.GetConnectionByID(connId)
	if conn == nil {
		return fmt.Errorf("connection not found")
	}
	conn.Password = newPassword
	if persist {
		a.configManager.SaveConnection(*conn)
	}

	// 清理旧会话
	a.sshManager.Disconnect(sessionId)

	// 重新连接
	return a.sshManager.Connect(sessionId, *conn)
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

// Mkdir creates a directory via SFTP
func (a *App) Mkdir(sessionId string, path string) error {
	return a.sshManager.Mkdir(sessionId, path)
}

// RenameItem renames a file or directory via SFTP
func (a *App) RenameItem(sessionId string, oldPath string, newPath string) error {
	return a.sshManager.RenameItem(sessionId, oldPath, newPath)
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
	filepath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择私钥文件",
	})
	if err != nil || filepath == "" {
		return "", err
	}
	content, err := os.ReadFile(filepath)
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

func (a *App) TestSFTPConnection(host string, port int, username, password, authMethod, privateKey string) error {
	return a.configManager.TestSFTPConnection(host, port, username, password, authMethod, privateKey)
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

// downloadProgressReader wraps an io.Reader to track download progress and emit Wails events
type downloadProgressReader struct {
	io.Reader
	ctx        context.Context
	total      int64
	downloaded int64
	lastEmit   time.Time
}

func (pr *downloadProgressReader) Read(p []byte) (int, error) {
	n, err := pr.Reader.Read(p)
	pr.downloaded += int64(n)

	if pr.total > 0 {
		now := time.Now()
		if now.Sub(pr.lastEmit) >= 200*time.Millisecond || pr.downloaded == pr.total {
			progress := int(float64(pr.downloaded) / float64(pr.total) * 100)
			runtime.EventsEmit(pr.ctx, "app-update-progress", progress)
			pr.lastEmit = now
		}
	}
	return n, err
}

// UpdateApp downloads the new exe from the given url, replaces the current running exe, and restarts the app.
func (a *App) UpdateApp(downloadUrl string, filename string) error {
	// 1. 强制 HTTPS，防止明文下载可执行文件被篡改
	if !strings.HasPrefix(downloadUrl, "https://") {
		return fmt.Errorf("更新地址必须使用 HTTPS")
	}
	// 2. 发起请求下载新文件（带超时，防止慢网络永久阻塞）
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Get(downloadUrl)
	if err != nil {
		return fmt.Errorf("failed to download update: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", resp.Status)
	}

	isSetup := strings.Contains(strings.ToLower(filename), "installer") || strings.Contains(strings.ToLower(filename), "setup")
	var targetPath string
	var exePath string

	if isSetup {
		targetPath = filepath.Join(os.TempDir(), filename)
	} else {
		exe, err := os.Executable()
		if err != nil {
			return fmt.Errorf("could not determine executable path: %w", err)
		}
		exePath = exe
		targetPath = exePath + ".update"
	}

	out, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("could not create temporary update file: %w", err)
	}

	progressReader := &downloadProgressReader{
		Reader: resp.Body,
		ctx:    a.ctx,
		total:  resp.ContentLength,
	}

	// 2. 写入到带有进度的缓冲并存入 .update 临时文件
	_, err = io.Copy(out, progressReader)
	out.Close() // Ensure the file is completely flushed and closed
	if err != nil {
		os.Remove(targetPath) // Cleanup on failure
		return fmt.Errorf("failed to save update file: %w", err)
	}

	// 3. 区分 Setup 还是 Portable 替换
	if isSetup {
		// 启动 Setup 安装向导，隐藏黑框
		cmd := exec.Command("cmd.exe", "/C", "start", "", targetPath)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("failed to start setup: %w", err)
		}
		// 退出当前应用以解除目录锁定
		os.Exit(0)
		return nil
	}

	// Portable 热更替换逻辑
	oldPath := exePath + ".old"
	if err := os.Rename(exePath, oldPath); err != nil {
		os.Remove(targetPath)
		return fmt.Errorf("failed to rename current executable: %w", err)
	}

	if err := os.Rename(targetPath, exePath); err != nil {
		os.Rename(oldPath, exePath)
		return fmt.Errorf("failed to apply update file: %w", err)
	}

	cmd := exec.Command(exePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to restart application: %w", err)
	}

	os.Exit(0)
	return nil
}
