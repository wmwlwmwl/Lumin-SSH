package sshmanager

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	ai "luminssh-go/internal/ai"
	"luminssh-go/internal/config"
	"luminssh-go/internal/localsftp"
	"luminssh-go/internal/localsysinfo"
	"luminssh-go/internal/mcpserver"
	"luminssh-go/internal/terminalstream"
	"luminssh-go/internal/transfer"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/ianaindex"
	"golang.org/x/text/transform"
)

// ─── 类型别名：引用 config 包类型 ──────────────────────────
type (
	Connection             = config.Connection
	TransferTuningSettings = config.TransferTuningSettings
	PersistedPortForward   = config.PersistedPortForward
)

// ErrHostKeyChanged 在远程主机密钥发生变化时返回，需要用户确认
var ErrHostKeyChanged = errors.New("host key has changed")

// ErrAuthFailed 在 SSH 认证失败时返回。此时连接本身是通的、主机密钥已校验过，
// 用户补上正确密码即可重试，因此不应连带丢弃「只接受本次」的临时密钥授权。
var ErrAuthFailed = errors.New("认证失败")

var sshHostKeyAlgorithms = []string{
	"ssh-ed25519",
	"ecdsa-sha2-nistp256",
	"ecdsa-sha2-nistp384",
	"ecdsa-sha2-nistp521",
	"rsa-sha2-512",
	"rsa-sha2-256",
}

func hostKeyAlgorithmsForConnection(conn Connection) []string {
	algorithms := append([]string(nil), sshHostKeyAlgorithms...)
	if conn.AllowLegacySSHRSA {
		algorithms = append(algorithms, ssh.KeyAlgoRSA)
	}
	return algorithms
}

const (
	postAuthSlowNoticeTimeout = 10 * time.Second
	postAuthChannelTimeout    = 30 * time.Second
	sftpInitWaitTimeout       = 5 * time.Second
	// ponytail: pkg/sftp 无 per-op deadline,SFTP subsystem 慢时会永久阻塞 getSystemInfo,
	// 致前端递归 setTimeout 链断裂(数据不刷新)。用 goroutine+timer 兜底放弃等待,
	// 残留 goroutine 随 keepalive 关连时退出。15s < 命令超时 30s,先暴露部署问题。
	probeDeployTimeout = 15 * time.Second
	// 保活略松：单次超时不立刻拆线，连续失败达阈值才清理共享连接。
	sshKeepaliveInterval = 15 * time.Second
	sshKeepaliveTimeout  = 20 * time.Second
	sshKeepaliveFailMax  = 3
)

// PendingHostKey 保存等待用户确认的主机密钥变更信息
type PendingHostKey struct {
	Conn           Connection
	Hostname       string
	NewKey         ssh.PublicKey
	NewFingerprint string
	OldKeys        []knownhosts.KnownKey
}

// sshClientEntry 保存单个 SSH 连接共享的 client 和 sftp 实例
// 同一服务器的多个终端复用同一 TCP 连接
type sshClientEntry struct {
	Client        *ssh.Client
	NetConn       net.Conn
	SFTP          *sftp.Client
	SFTPReady     chan struct{}
	SFTPReadyOnce sync.Once
	SFTPInitErr   error
}

type SessionData struct {
	ConnKey             string // 共享客户端查找键: user@host:port
	Session             *ssh.Session
	Stdin               io.WriteCloser
	HistoryStream       *terminalstream.CommandHistoryParser
	RemoteHistoryActive bool
	GroupSessionId      string // 对子终端有效：父会话 sessionId（用于历史事件归组）
	ShellPath           string
	TerminalInitPath    string
	TerminalEncoding    string
	CurrentCwd          string
	PromptReady         bool
	// Local terminal & Serial support
	IsLocal         bool
	IsSerial        bool
	LocalPTYWindows any
	LocalPTYUnix    *os.File
	SerialPort      io.ReadWriteCloser
	Cmd             *exec.Cmd
	WSLDistro       string
	LocalSFTPSrv    *localsftp.Server            // embedded SFTP server; non-nil when file manager is available
	OSCCwdParser    *terminalstream.OSCCWDParser // WSL-only: parses ESC]733;<b64>BEL CWD markers from the ConPTY stream
	// Gen is a per-session-instance generation counter incremented each time a
	// local/serial session reuses the same sessionId (fast reconnect). Background
	// goroutines (the serial read loop, the local cmd-waiter, pipeLocalOutput)
	// capture gen at startup and, on teardown, only clean up if the entry still
	// carries the same gen — otherwise a newer instance has replaced it and the
	// old goroutine must leave the map alone to avoid killing the new session.
	Gen uint64
}

type transferBackend struct {
	manager *SSHManager
}

func (b transferBackend) ClientEntry(sessionID string) (*ssh.Client, *sftp.Client, error) {
	return b.manager.GetClientEntry(sessionID)
}

func (b transferBackend) SFTPClient(sessionID string) (*sftp.Client, error) {
	return b.manager.GetSFTPClient(sessionID)
}

func (b transferBackend) ExecuteCommand(ctx context.Context, client *ssh.Client, command string) (string, error) {
	return b.manager.ExecuteCmdWithClientContext(ctx, client, command)
}

func (b transferBackend) DeleteRemote(ctx context.Context, sessionID string, remotePath string, isDir bool) error {
	return b.manager.DeleteItemContext(ctx, sessionID, remotePath, isDir)
}

func (b transferBackend) MkdirRemote(ctx context.Context, sessionID string, remotePath string) error {
	return b.manager.MkdirContext(ctx, sessionID, remotePath)
}

func (b transferBackend) RenameRemote(ctx context.Context, sessionID string, oldPath string, newPath string) error {
	return b.manager.RenameItemContext(ctx, sessionID, oldPath, newPath)
}

func (b transferBackend) UpdateUploadChannels(sessionID string, delta int) {
	b.manager.trackUploadChannelDelta(sessionID, delta)
}

type transferSink struct {
	manager *SSHManager
}

func (s transferSink) Emit(event string, payload any) {
	switch progress := payload.(type) {
	case transfer.DownloadProgress:
		s.manager.transferService.UpdateMCPTransferFromDownloadEvent(
			progress.SessionID,
			progress.DownloadID,
			progress.Mode,
			progress.Phase,
			progress.Status,
			progress.Progress,
			progress.BytesDone,
			progress.BytesTotal,
			progress.Current,
			progress.Detail,
		)
		payload = map[string]interface{}{
			"downloadId": progress.DownloadID,
			"mode":       progress.Mode,
			"phase":      progress.Phase,
			"status":     progress.Status,
			"progress":   progress.Progress,
			"bytesDone":  progress.BytesDone,
			"bytesTotal": progress.BytesTotal,
			"current":    progress.Current,
			"detail":     progress.Detail,
		}
	case transfer.CompressedUploadProgress:
		s.manager.transferService.UpdateMCPTransferFromCompressedUploadEvent(
			progress.SessionID,
			progress.UploadID,
			progress.Phase,
			progress.Progress,
			progress.PhaseProgress,
			progress.BytesDone,
			progress.BytesTotal,
			progress.Current,
			progress.Detail,
		)
		payload = map[string]interface{}{
			"uploadId":      progress.UploadID,
			"phase":         progress.Phase,
			"progress":      progress.Progress,
			"phaseProgress": progress.PhaseProgress,
			"bytesDone":     progress.BytesDone,
			"bytesTotal":    progress.BytesTotal,
			"current":       progress.Current,
			"detail":        progress.Detail,
		}
	}
	if s.manager != nil && s.manager.ctx != nil {
		runtime.EventsEmit(s.manager.ctx, event, payload)
	}
}

// SSHAppBackend 抽象 SSHManager 对 App 的依赖（WebSocket 输出 + 缓冲清理）。
type SSHAppBackend interface {
	WriteWsOutput(sessionId string, data []byte)
	CleanupWsPending(sessionId string)
}

type SSHManager struct {
	ctx              context.Context
	app              SSHAppBackend                 // reference to App for WebSocket output delivery
	configManager    *config.ConfigManager        // 端口转发持久化等配置管理
	sessions         map[string]*SessionData       // terminalId -> terminal session
	clients          map[string]*sshClientEntry    // connKey -> shared client+SFTP
	connTerminals    map[string][]string           // connKey -> terminal sessionIds
	probeDeployed    map[string]bool               // connKey -> probe.sh deployed
	probeFailed      map[string]int                // connKey -> probe.sh deploy fail count (max 3)
	probeRunFailed   map[string]int                // connKey -> probe script run fail count (reset on success)
	pendingHostKeys  map[string]*PendingHostKey    // sessionId -> pending host key info
	tempAcceptedKeys map[string]string             // sessionId -> fingerprint (accept this time only)
	pendingCancels   map[string]context.CancelFunc // sessionId -> cancel func for in-progress Connect
	transferService  *transfer.Service
	portForwards     map[string]*managedPortForward
	mu               sync.RWMutex
	pendingMu        sync.Mutex
	bufPool          sync.Pool
	// nextGen is the monotonic source of SessionData.Gen values, used to tell
	// apart two local/serial sessions that reused the same sessionId (fast
	// reconnect). Guarded by mu.
	nextGen uint64
}

// dialAddr 拼接 host:port，自动处理 IPv6 地址
// 如果 host 本身已带 [] 会先去除，避免 net.JoinHostPort 重复包裹
func dialAddr(host string, port int) string {
	host = strings.TrimSpace(host)
	host = strings.Trim(host, "[]")
	return net.JoinHostPort(host, strconv.Itoa(port))
}

// DialAddr 导出包装器
func DialAddr(host string, port int) string { return dialAddr(host, port) }

// ─── 导出包装器：供 package main 通过 ssh_alias.go 调用的工具函数 ──

func ShellQuotePath(path string) string { return shellQuotePath(path) }

func RunCommandWithSessionContext(ctx context.Context, session *ssh.Session, cmd string, timeout time.Duration) (string, error) {
	return runCommandWithSessionContext(ctx, session, cmd, timeout)
}

func EnsureContextActive(ctx context.Context) error { return ensureContextActive(ctx) }

func WriteStringChunksWithContext(ctx context.Context, writer io.Writer, content string) error {
	return writeStringChunksWithContext(ctx, writer, content)
}

const RemoteCmdLongTimeout = remoteCmdLongTimeout

func NewCommandExecutionToken() string { return newCommandExecutionToken() }

func NewSSHManager() *SSHManager {
	manager := &SSHManager{
		sessions:         make(map[string]*SessionData),
		clients:          make(map[string]*sshClientEntry),
		connTerminals:    make(map[string][]string),
		probeDeployed:    make(map[string]bool),
		probeFailed:      make(map[string]int),
		probeRunFailed:   make(map[string]int),
		pendingHostKeys:  make(map[string]*PendingHostKey),
		tempAcceptedKeys: make(map[string]string),
		pendingCancels:   make(map[string]context.CancelFunc),
		portForwards:     make(map[string]*managedPortForward),
		bufPool: sync.Pool{
			New: func() any {
				buf := make([]byte, 32768)
				return &buf
			},
		},
	}
	manager.transferService = transfer.NewService(transferBackend{manager: manager}, transferSink{manager: manager})
	return manager
}

// SetApp 注入 App 后端（用于 WebSocket 输出和缓冲清理）
func (m *SSHManager) SetApp(app SSHAppBackend) {
	m.app = app
}

// SetConfigManager 注入配置管理器（用于端口转发持久化等）
func (m *SSHManager) SetConfigManager(cm *config.ConfigManager) {
	m.configManager = cm
}

// SetCtx 注入 Wails 上下文（用于事件发射等）
func (m *SSHManager) SetCtx(ctx context.Context) {
	m.ctx = ctx
}

// GetSession 返回指定会话的 SessionData（只读快照，调用方不得修改内部字段）。
func (m *SSHManager) GetSession(sessionId string) (*SessionData, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[sessionId]
	return s, ok
}

// SnapshotSessionsAndSftpAvailability 返回会话表快照和各 connKey 的 SFTP 可用性。
// 用于 mcp_bridge 列举会话描述符，避免外部直接访问 mu/sessions/clients。
func (m *SSHManager) SnapshotSessionsAndSftpAvailability() (map[string]*SessionData, map[string]bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sessions := make(map[string]*SessionData, len(m.sessions))
	for k, v := range m.sessions {
		sessions[k] = v
	}
	sftpAvail := make(map[string]bool, len(m.clients))
	for k, v := range m.clients {
		if v != nil && v.SFTP != nil {
			sftpAvail[k] = true
		}
	}
	return sessions, sftpAvail
}

func terminalEncodingCodec(terminalEncoding string) encoding.Encoding {
	normalized := config.NormalizeTerminalEncoding(terminalEncoding)
	if normalized == "utf-8" {
		return nil
	}
	codec, err := ianaindex.IANA.Encoding(normalized)
	if err != nil || codec == nil {
		return nil
	}
	return codec
}

func wrapTerminalOutputReader(reader io.Reader, terminalEncoding string) io.Reader {
	codec := terminalEncodingCodec(terminalEncoding)
	if reader == nil || codec == nil {
		return reader
	}
	return transform.NewReader(reader, codec.NewDecoder())
}

func decodeTerminalBytesToUTF8(data []byte, terminalEncoding string) ([]byte, error) {
	codec := terminalEncodingCodec(terminalEncoding)
	if len(data) == 0 || codec == nil {
		return data, nil
	}
	decoded, _, err := transform.Bytes(codec.NewDecoder(), data)
	if err != nil {
		return nil, err
	}
	return decoded, nil
}

func decodeTerminalText(data []byte, terminalEncoding string) string {
	decoded, err := decodeTerminalBytesToUTF8(data, terminalEncoding)
	if err != nil {
		return ""
	}
	return string(decoded)
}

func encodeTerminalInputBytes(data []byte, terminalEncoding string) ([]byte, error) {
	codec := terminalEncodingCodec(terminalEncoding)
	if len(data) == 0 || codec == nil {
		return data, nil
	}
	encoded, _, err := transform.Bytes(codec.NewEncoder(), data)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

// ponytail: 判断是否为瞬态网络错误（连接重置、EOF、超时等），这类错误可重试
func isTransientNetError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "forcibly closed") ||
		strings.Contains(s, "connection reset") ||
		strings.Contains(s, "EOF") ||
		strings.Contains(s, "i/o timeout") ||
		strings.Contains(s, "wsarecv") ||
		strings.Contains(s, "wsasend") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "unexpected EOF")
}

func (m *SSHManager) runPostAuthStep(ctx context.Context, cancel context.CancelFunc, sessionId string, client *ssh.Client, closeClientOnStop bool, fn func() error) error {
	done := make(chan error, 1)
	go func() {
		done <- fn()
	}()

	noticeTimer := time.NewTimer(postAuthSlowNoticeTimeout)
	defer noticeTimer.Stop()
	timeoutTimer := time.NewTimer(postAuthChannelTimeout)
	defer timeoutTimer.Stop()

	for {
		select {
		case err := <-done:
			return err
		case <-ctx.Done():
			if closeClientOnStop && client != nil {
				client.Close()
			}
			return fmt.Errorf("连接已取消")
		case <-noticeTimer.C:
			if m != nil && m.ctx != nil {
				runtime.EventsEmit(m.ctx, "ssh-status", map[string]interface{}{
					"sessionId": sessionId,
					"status":    "post-auth-slow",
					"message":   "SSH 已认证，但打开终端通道响应较慢，服务器可能正在恢复或负载较高。",
				})
			}
		case <-timeoutTimer.C:
			if cancel != nil {
				cancel()
			}
			if closeClientOnStop && client != nil {
				client.Close()
			}
			return fmt.Errorf("SSH 已认证，但打开终端通道超时。服务器可能暂时无法创建终端会话，请稍后重试")
		}
	}
}

func (m *SSHManager) Connect(sessionId string, conn Connection) error {
	// 去除密码首尾空白（防止复制粘贴带入不可见字符）
	conn.Password = strings.TrimSpace(conn.Password)
	conn.TerminalEncoding = config.NormalizeTerminalEncoding(conn.TerminalEncoding)
	// 诊断：密码为空时记录日志，帮助定位"记住密码后重启密码错误"问题
	if conn.AuthMethod == "password" && conn.Password == "" {
		log.Printf("[Connect] WARNING: password is empty for %s@%s:%d (connId=%s)", conn.Username, conn.Host, conn.Port, conn.ID)
	}
	// ponytail: connKey 包含服务器 ID，防止不同服务器条目共享连接
	connKey := conn.ID
	if connKey == "" {
		connKey = fmt.Sprintf("%s@%s", conn.Username, dialAddr(conn.Host, conn.Port))
	}

	m.mu.RLock()
	existingEntry, clientExists := m.clients[connKey]
	m.mu.RUnlock()

	var client *ssh.Client
	var transportConn net.Conn
	clientCreated := false

	if clientExists {
		client = existingEntry.Client
	} else {
		// Setup auth methods
		// keyboard-interactive 优先，因为部分服务器不提供 password 方法
		var authMethods []ssh.AuthMethod
		if conn.AuthMethod == "password" {
			authMethods = append(authMethods, ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) (answers []string, err error) {
				answers = make([]string, len(questions))
				for i := range answers {
					answers[i] = conn.Password
				}
				return answers, nil
			}))
			authMethods = append(authMethods, ssh.Password(conn.Password))
		} else if conn.AuthMethod == "privateKey" {
			var signer ssh.Signer
			var err error
			if conn.Passphrase != "" {
				signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(conn.PrivateKey), []byte(conn.Passphrase))
			} else {
				signer, err = ssh.ParsePrivateKey([]byte(conn.PrivateKey))
			}
			if err != nil {
				return fmt.Errorf("invalid private key: %w", err)
			}
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}

		hostKeyCallback, err := initKnownHostsCallback()
		if err != nil {
			return err
		}

		customHostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			err := hostKeyCallback(hostname, remote, key)
			if err == nil {
				return nil
			}

			var keyErr *knownhosts.KeyError
			if !errors.As(err, &keyErr) {
				return err
			}

			fingerprint := ssh.FingerprintSHA256(key)
			// ponytail: 临时密钥检查统一放在分支前
			m.mu.RLock()
			if fp, ok := m.tempAcceptedKeys[sessionId]; ok && fp == fingerprint {
				m.mu.RUnlock()
				return nil
			}
			m.mu.RUnlock()

			m.mu.Lock()
			m.pendingHostKeys[sessionId] = &PendingHostKey{
				Conn:           conn,
				Hostname:       hostname,
				NewKey:         key,
				NewFingerprint: fingerprint,
				OldKeys:        keyErr.Want, // nil when first connection
			}
			m.mu.Unlock()
			return ErrHostKeyChanged
		}

		sshConfig := &ssh.ClientConfig{
			User:              conn.Username,
			Auth:              authMethods,
			HostKeyCallback:   customHostKeyCallback,
			Timeout:           10 * time.Second,
			HostKeyAlgorithms: hostKeyAlgorithmsForConnection(conn),
		}

		target := dialAddr(conn.Host, conn.Port)

		// 创建可取消 context，支持 Disconnect 中断正在进行的连接
		// 派生自 m.ctx（若存在），确保应用关闭时所有进行中的握手也能被取消
		parent := context.Background()
		if m.ctx != nil {
			parent = m.ctx
		}
		cancelCtx, cancelConnect := context.WithCancel(parent)
		m.pendingMu.Lock()
		m.pendingCancels[sessionId] = cancelConnect
		m.pendingMu.Unlock()
		defer func() {
			m.pendingMu.Lock()
			delete(m.pendingCancels, sessionId)
			m.pendingMu.Unlock()
		}()

		// ponytail: 瞬态网络错误自动重试最多2次
		const maxRetries = 2
		for attempt := 0; attempt <= maxRetries; attempt++ {
			if attempt > 0 {
				time.Sleep(time.Duration(attempt) * time.Second)
				log.Printf("[Connect] 瞬态网络错误重试 %d/%d: %s", attempt, maxRetries, conn.Host)
			}

			netConn, dialErr := config.DialConnectionTargetContext(cancelCtx, conn, target, sshConfig.Timeout)
			if dialErr != nil {
				if errors.Is(dialErr, context.Canceled) || cancelCtx.Err() != nil {
					return fmt.Errorf("连接已取消")
				}
				errStr := dialErr.Error()
				if strings.Contains(errStr, "connection refused") {
					if m.ctx != nil {
						runtime.EventsEmit(m.ctx, "ssh-connection-failed", map[string]interface{}{
							"sessionId": sessionId,
							"connId":    conn.ID,
							"host":      conn.Host,
							"port":      conn.Port,
							"username":  conn.Username,
							"error":     errStr,
						})
					}
					return fmt.Errorf("连接被拒绝")
				}
				if attempt < maxRetries && isTransientNetError(dialErr) {
					continue
				}
				return dialErr
			}

			if cancelCtx.Err() != nil {
				netConn.Close()
				return fmt.Errorf("连接已取消")
			}

			handshakeDone := make(chan struct{})
			go func() {
				select {
				case <-cancelCtx.Done():
					netConn.Close()
				case <-handshakeDone:
				}
			}()

			sshConn, chans, reqs, handshakeErr := ssh.NewClientConn(netConn, target, sshConfig)
			close(handshakeDone)

			if handshakeErr != nil {
				if cancelCtx.Err() != nil {
					netConn.Close()
					return fmt.Errorf("连接已取消")
				}
				if errors.Is(handshakeErr, ErrHostKeyChanged) {
					netConn.Close()
					if m.ctx != nil {
						m.mu.RLock()
						pending, ok := m.pendingHostKeys[sessionId]
						if !ok || pending == nil {
							m.mu.RUnlock()
							return fmt.Errorf("主机密钥已变更，但未找到待确认信息")
						}
						hostname := pending.Hostname
						newFingerprint := pending.NewFingerprint
						oldFingerprints := make([]string, 0, len(pending.OldKeys))
						for _, k := range pending.OldKeys {
							oldFingerprints = append(oldFingerprints, ssh.FingerprintSHA256(k.Key))
						}
						isNew := len(pending.OldKeys) == 0
						m.mu.RUnlock()
						runtime.EventsEmit(m.ctx, "ssh-host-key-changed", map[string]interface{}{
							"sessionId":       sessionId,
							"hostname":        hostname,
							"host":            conn.Host,
							"port":            conn.Port,
							"newFingerprint":  newFingerprint,
							"oldFingerprints": oldFingerprints,
							"isNew":           isNew,
						})
					}
					return fmt.Errorf("主机密钥已变更，请在弹窗中确认")
				}

				errStr := handshakeErr.Error()
				if strings.Contains(errStr, "unable to authenticate") ||
					strings.Contains(errStr, "no supported methods remain") {
					if m.ctx != nil {
						runtime.EventsEmit(m.ctx, "ssh-auth-failed", map[string]interface{}{
							"sessionId": sessionId,
							"connId":    conn.ID,
							"host":      conn.Host,
							"port":      conn.Port,
							"username":  conn.Username,
							"error":     errStr,
						})
					}
					return ErrAuthFailed
				}

				// 瞬态错误关闭连接后重试
				if attempt < maxRetries && isTransientNetError(handshakeErr) {
					netConn.Close()
					continue
				}
				netConn.Close()
				return handshakeErr
			}

			// 握手成功
			client = ssh.NewClient(sshConn, chans, reqs)
			transportConn = netConn
			clientCreated = true
			break
		}

		// 重新检查 connKey 是否已被并发 Connect 写入；若是则丢弃新连接，复用已有连接
		m.mu.Lock()
		if existing, ok := m.clients[connKey]; ok && existing.Client != nil {
			m.mu.Unlock()
			// 关闭刚刚新建的连接，改用已存在的连接
			transportConn.Close()
			client.Close()
			client = existing.Client
			transportConn = existing.NetConn
			clientCreated = false
		} else {
			m.clients[connKey] = &sshClientEntry{Client: client, NetConn: transportConn, SFTPReady: make(chan struct{})}
			m.connTerminals[connKey] = []string{}
			m.mu.Unlock()

			go m.watchClient(connKey, client)
			go func() {
				_ = client.Wait()
				m.cleanupClientTransport(connKey, client, "transport")
			}()
		}
	}

	parent := context.Background()
	if m.ctx != nil {
		parent = m.ctx
	}
	postAuthCtx, cancelPostAuth := context.WithCancel(parent)
	m.pendingMu.Lock()
	m.pendingCancels[sessionId] = cancelPostAuth
	m.pendingMu.Unlock()

	var shellPath string
	err := m.runPostAuthStep(postAuthCtx, cancelPostAuth, sessionId, client, clientCreated, func() error {
		shellPath = detectRemoteShell(client)
		launchCmd, remoteHistoryActive := buildShellLaunchCommand(shellPath, conn.TerminalInitPath)
		return m.setupSession(postAuthCtx, client, connKey, sessionId, "", launchCmd, remoteHistoryActive, shellPath, conn.TerminalInitPath, conn.TerminalEncoding)
	})
	if err != nil {
		// setupSession 失败（如 PTY 请求失败）：仅清理本路径创建的 session；
		// 新建的 client 已被并发复用时不能关闭，否则会级联断开其他终端。
		m.mu.Lock()
		if sd, ok := m.sessions[sessionId]; ok {
			if sd.Stdin != nil {
				sd.Stdin.Close()
			}
			if sd.Session != nil {
				sd.Session.Close()
			}
			delete(m.sessions, sessionId)
		}
		if terminals, ok := m.connTerminals[connKey]; ok {
			next := terminals[:0]
			for _, tid := range terminals {
				if tid != sessionId {
					next = append(next, tid)
				}
			}
			m.connTerminals[connKey] = next
		}
		closeClient := false
		if clientCreated {
			if entry, ok := m.clients[connKey]; ok && entry.Client == client && len(m.connTerminals[connKey]) == 0 {
				if entry.SFTPReady != nil {
					entry.SFTPReadyOnce.Do(func() { close(entry.SFTPReady) })
				}
				delete(m.clients, connKey)
				delete(m.connTerminals, connKey)
				closeClient = true
			}
		}
		m.mu.Unlock()
		if closeClient {
			_ = transportConn.Close()
			_ = client.Close()
		}
		return err
	}
	if clientCreated {
		go m.initSFTPClient(sessionId, connKey, conn, client)
	}
	return nil
}

// setupSession 创建 shell session 的共享逻辑
func (m *SSHManager) setupSession(ctx context.Context, client *ssh.Client, connKey, sessionId, groupSessionId, launchCmd string, remoteHistoryActive bool, shellPath string, terminalInitPath string, terminalEncoding string) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	if ctx != nil && ctx.Err() != nil {
		session.Close()
		return ctx.Err()
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
	}

	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		return err
	}
	if ctx != nil && ctx.Err() != nil {
		session.Close()
		return ctx.Err()
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		return err
	}

	if launchCmd != "" {
		err = session.Start(launchCmd)
	} else {
		err = session.Shell()
	}
	if err != nil {
		session.Close()
		return err
	}
	if ctx != nil && ctx.Err() != nil {
		session.Close()
		return ctx.Err()
	}

	var historyStream *terminalstream.CommandHistoryParser
	if remoteHistoryActive {
		encoding := config.NormalizeTerminalEncoding(terminalEncoding)
		historyStream = terminalstream.NewCommandHistoryParser(func(data []byte) string {
			return decodeTerminalText(data, encoding)
		})
	}

	m.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		m.mu.Unlock()
		session.Close()
		return ctx.Err()
	}
	entry, ok := m.clients[connKey]
	if !ok || entry.Client != client {
		m.mu.Unlock()
		session.Close()
		return fmt.Errorf("SSH 连接已关闭")
	}
	sd := &SessionData{
		ConnKey:             connKey,
		Session:             session,
		Stdin:               stdin,
		HistoryStream:       historyStream,
		RemoteHistoryActive: remoteHistoryActive,
		ShellPath:           strings.TrimSpace(shellPath),
		TerminalInitPath:    strings.TrimSpace(terminalInitPath),
		TerminalEncoding:    config.NormalizeTerminalEncoding(terminalEncoding),
		PromptReady:         !remoteHistoryActive,
	}
	if groupSessionId != "" {
		sd.GroupSessionId = groupSessionId
	}
	m.sessions[sessionId] = sd
	m.connTerminals[connKey] = append(m.connTerminals[connKey], sessionId)
	m.mu.Unlock()
	m.emitSSHChannelUsage(connKey)

	go m.pipeOutput(sessionId, stdout, historyStream)
	go m.pipeOutput(sessionId, stderr, nil)
	go func() {
		_ = session.Wait()
		m.disconnectAndNotify(sessionId, "session_end")
	}()

	return nil
}

func (m *SSHManager) ApplyTransferTuning(settings TransferTuningSettings) {
	m.transferService.SetTuning(transfer.Tuning{
		MaxPacketKiB:        settings.MaxPacketKiB,
		MaxRequestsPerFile:  settings.MaxRequestsPerFile,
		ConcurrentWrites:    settings.ConcurrentWrites,
		ApplyToSharedClient: settings.ApplyToSharedClient,
		Configured:          settings.Configured,
	})
}

func (m *SSHManager) newSharedSFTPClient(client *ssh.Client) (*sftp.Client, error) {
	if m.transferService.Tuning().ApplyToSharedClient {
		return m.transferService.NewSFTPClient(client)
	}
	return sftp.NewClient(client)
}

func (m *SSHManager) initSFTPClient(sessionId string, connKey string, conn Connection, client *ssh.Client) {
	sftpClient, err := m.newSharedSFTPClient(client)
	m.mu.Lock()
	entry, ok := m.clients[connKey]
	if !ok || entry.Client != client {
		m.mu.Unlock()
		if sftpClient != nil {
			sftpClient.Close()
		}
		return
	}
	entry.SFTP = sftpClient
	entry.SFTPInitErr = err
	if entry.SFTPReady != nil {
		entry.SFTPReadyOnce.Do(func() { close(entry.SFTPReady) })
	}
	m.mu.Unlock()
	m.emitSSHChannelUsage(connKey)
	if err == nil {
		go m.probeSSHMaxSessions(connKey)
	}

	if err != nil && m.ctx != nil {
		runtime.EventsEmit(m.ctx, "ssh-status", map[string]interface{}{
			"sessionId": sessionId,
			"status":    "sftp-unavailable",
			"host":      conn.Host,
			"port":      conn.Port,
			"username":  conn.Username,
			"error":     err.Error(),
		})
	}
}

func (m *SSHManager) watchClient(connKey string, client *ssh.Client) {
	ticker := time.NewTicker(sshKeepaliveInterval)
	defer ticker.Stop()
	fails := 0
	for range ticker.C {
		tracked, probeOK := m.checkClientKeepalive(connKey, client, sshKeepaliveTimeout)
		var stop bool
		fails, stop = m.handleKeepaliveProbeResult(connKey, client, fails, tracked, probeOK)
		if stop {
			return
		}
	}
}

// handleKeepaliveProbeResult 根据单次探活结果更新连续失败计数。
// 返回 (新失败次数, 是否结束 watch)。达 sshKeepaliveFailMax 才拆共享连接。
func (m *SSHManager) handleKeepaliveProbeResult(connKey string, client *ssh.Client, fails int, tracked, probeOK bool) (int, bool) {
	if !tracked {
		return fails, true
	}
	if probeOK {
		return 0, false
	}
	fails++
	if fails >= sshKeepaliveFailMax {
		m.cleanupClientTransport(connKey, client, "keepalive")
		return fails, true
	}
	return fails, false
}

// checkClientKeepalive 发起一次 SSH 层探活。
// tracked=false：该 client 已不在 map（停止 watch，勿重复 cleanup）。
// tracked=true 且 probeOK=true：通路正常（含服务端拒绝未知 keepalive 名但仍有响应）。
// tracked=true 且 probeOK=false：超时或传输错误——不在此处拆线，由 watch 累计失败。
func (m *SSHManager) checkClientKeepalive(connKey string, client *ssh.Client, timeout time.Duration) (tracked bool, probeOK bool) {
	m.mu.RLock()
	entry, ok := m.clients[connKey]
	if !ok || entry.Client != client || entry.NetConn == nil {
		m.mu.RUnlock()
		return false, false
	}
	m.mu.RUnlock()

	done := make(chan error, 1)
	go func() {
		_, _, err := client.SendRequest("keepalive@lumin-ssh", true, nil)
		done <- err
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-done:
		if err == nil {
			m.mu.RLock()
			current, currentOK := m.clients[connKey]
			alive := currentOK && current.Client == client
			m.mu.RUnlock()
			if !alive {
				return false, false
			}
			return true, true
		}
		// 有响应但 request 失败（如未知类型被拒）：golang.org/x/crypto/ssh 对 want-reply
		// 被拒通常仍 err==nil 且 reply=false；若将来变成 err，仍视为通路可达。
		m.mu.RLock()
		current, currentOK := m.clients[connKey]
		alive := currentOK && current.Client == client
		m.mu.RUnlock()
		if !alive {
			return false, false
		}
		// 传输层错误（连接已断）→ 计失败；纯协议拒绝在 SendRequest 成功路径已覆盖。
		if isSSHKeepaliveTransportError(err) {
			return true, false
		}
		return true, true
	case <-timer.C:
		m.mu.RLock()
		current, currentOK := m.clients[connKey]
		alive := currentOK && current.Client == client
		m.mu.RUnlock()
		if !alive {
			return false, false
		}
		return true, false
	}
}

func isSSHKeepaliveTransportError(err error) bool {
	if err == nil {
		return false
	}
	// 连接已死、reset、EOF 等：算探活失败。其它错误偏协议层，保守当通路仍在。
	return isTransientNetError(err) ||
		errors.Is(err, io.EOF) ||
		strings.Contains(err.Error(), "connection lost") ||
		strings.Contains(err.Error(), "use of closed network connection")
}

func (m *SSHManager) cleanupClientTransport(connKey string, client *ssh.Client, reason string) {
	m.mu.Lock()
	entry, ok := m.clients[connKey]
	if !ok || entry.Client != client {
		m.mu.Unlock()
		return
	}
	terminalIds := append([]string(nil), m.connTerminals[connKey]...)
	netConn := entry.NetConn
	sftpClient := entry.SFTP
	if entry.SFTPReady != nil {
		entry.SFTPReadyOnce.Do(func() { close(entry.SFTPReady) })
	}
	delete(m.clients, connKey)
	delete(m.connTerminals, connKey)
	delete(m.probeDeployed, connKey)
	delete(m.probeFailed, connKey)
	delete(m.probeRunFailed, connKey)
	m.mu.Unlock()
	globalSSHChannelUsage.forget(connKey)
	// 连接级断开: 该连接下的端口转发全部转为已停止态, 关闭监听器释放本地端口。
	// 此路径已从 m.clients 删除 connKey, 下面循环里的 Disconnect 不会再进连接级删除分支,
	// 故端口转发清理必须在此独立触发, 不能只依赖 Disconnect。
	m.stopPortForwardsForConnKey(connKey)

	if reason == "" {
		reason = "transport"
	}
	if netConn != nil {
		_ = netConn.Close()
	}
	// 静默拆各终端 session，再发一次「整机连接断开」事件，避免 N 次误报
	parentSessionId := ""
	for _, terminalId := range terminalIds {
		if parentSessionId == "" {
			parentSessionId = m.sessionParentID(terminalId)
		}
		_ = m.Disconnect(terminalId)
	}
	if sftpClient != nil {
		closeWithTimeout(sftpClient, 3*time.Second)
	}
	closeWithTimeout(client, 3*time.Second)

	if m.ctx != nil && len(terminalIds) > 0 {
		if parentSessionId == "" {
			parentSessionId = terminalIds[0]
		}
		runtime.EventsEmit(m.ctx, "ssh-disconnected", map[string]interface{}{
			"sessionId":        terminalIds[0],
			"parentSessionId":  parentSessionId,
			"terminalIds":      terminalIds,
			"reason":           reason,
			"connectionClosed": true,
		})
	}
}

// sessionParentID 返回前端 tab 用的父会话 id（子终端用 GroupSessionId）。
func (m *SSHManager) sessionParentID(sessionId string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.sessions[sessionId]; ok {
		if s.GroupSessionId != "" {
			return s.GroupSessionId
		}
		return sessionId
	}
	return sessionId
}

// disconnectAndNotify 结束单个 terminal 并通知前端。
// reason=session_end：shell 正常/异常退出；connectionClosed 表示是否同时拆掉了共享 TCP。
func (m *SSHManager) disconnectAndNotify(sessionId string, reason string) {
	if reason == "" {
		reason = "session_end"
	}
	parentSessionId := m.sessionParentID(sessionId)

	m.mu.RLock()
	s, ok := m.sessions[sessionId]
	connKey := ""
	terminalsBefore := 0
	if ok {
		connKey = s.ConnKey
		terminalsBefore = len(m.connTerminals[connKey])
	}
	m.mu.RUnlock()

	if !m.Disconnect(sessionId) {
		return
	}
	if m.ctx == nil {
		return
	}

	connectionClosed := false
	if ok && connKey != "" {
		m.mu.RLock()
		_, clientAlive := m.clients[connKey]
		terminalsAfter := len(m.connTerminals[connKey])
		m.mu.RUnlock()
		// 断开前是该连接上最后一个终端，或 client 已不在
		connectionClosed = !clientAlive || (terminalsBefore > 0 && terminalsAfter == 0)
	}

	runtime.EventsEmit(m.ctx, "ssh-disconnected", map[string]interface{}{
		"sessionId":        sessionId,
		"parentSessionId":  parentSessionId,
		"terminalIds":      []string{sessionId},
		"reason":           reason,
		"connectionClosed": connectionClosed,
	})
}

// disconnectCurrentGen tears down the session for sessionId, but only if the
// entry currently in the map is still the same generation (gen) the caller
// started with. Local/serial sessions reuse the same sessionId on fast
// reconnect, so a stale background goroutine (e.g. the previous serial read
// loop) would otherwise find the *new* session under that id and kill it.
// If a newer instance has taken over, this is a no-op.
//
// 事件载荷与 disconnectAndNotify 对齐（对象而非纯 string）：本地/串口单会话，
// connectionClosed 恒 true；reason=session_end，避免前端把 string 兼容路径
// 当成 transport 误报「SSH 连接已意外断开」。
func (m *SSHManager) disconnectCurrentGen(sessionId string, gen uint64) {
	m.mu.RLock()
	cur, ok := m.sessions[sessionId]
	if !ok || cur.Gen != gen {
		m.mu.RUnlock()
		return
	}
	parentSessionId := sessionId
	if cur.GroupSessionId != "" {
		parentSessionId = cur.GroupSessionId
	}
	m.mu.RUnlock()

	if !m.Disconnect(sessionId) || m.ctx == nil {
		return
	}
	runtime.EventsEmit(m.ctx, "ssh-disconnected", map[string]interface{}{
		"sessionId":        sessionId,
		"parentSessionId":  parentSessionId,
		"terminalIds":      []string{sessionId},
		"reason":           "session_end",
		"connectionClosed": true,
	})
}

func (m *SSHManager) pipeOutput(sessionId string, r io.Reader, historyStream *terminalstream.CommandHistoryParser) {
	bufPtr := m.bufPool.Get().(*[]byte)
	defer m.bufPool.Put(bufPtr)
	buf := *bufPtr

	eventSessionId := sessionId
	terminalEncoding := "utf-8"
	m.mu.RLock()
	if s, ok := m.sessions[sessionId]; ok {
		if s.GroupSessionId != "" {
			eventSessionId = s.GroupSessionId
		}
		terminalEncoding = config.NormalizeTerminalEncoding(s.TerminalEncoding)
	}
	m.mu.RUnlock()

	reader := wrapTerminalOutputReader(r, terminalEncoding)

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			var data []byte
			if historyStream != nil {
				visible, commands, cwd, promptSeen := historyStream.Process(buf[:n])
				data = visible
				if cwd != "" || promptSeen {
					shouldEmitCwd := false
					m.mu.Lock()
					if s, ok := m.sessions[sessionId]; ok {
						if cwd != "" && s.CurrentCwd != cwd {
							s.CurrentCwd = cwd
							shouldEmitCwd = true
						}
						if promptSeen && s.RemoteHistoryActive {
							s.PromptReady = true
						}
					}
					m.mu.Unlock()
					if shouldEmitCwd && m.ctx != nil {
						runtime.EventsEmit(m.ctx, "ssh-terminal-cwd-"+sessionId, cwd)
					}
				}
				for _, command := range commands {
					if command == "" || m.ctx == nil {
						continue
					}
					runtime.EventsEmit(m.ctx, "ssh-command-executed", map[string]string{
						"sessionId": eventSessionId,
						"command":   command,
						"time":      time.Now().Format(time.RFC3339),
						"source":    "remote",
					})
				}
			} else {
				data = buf[:n]
			}
			if len(data) == 0 {
				if err != nil {
					return
				}
				continue
			}
			m.emitSessionOutput(sessionId, data)
			if m.app != nil {
				m.app.WriteWsOutput(sessionId, data)
			} else if m.ctx != nil {
				runtime.EventsEmit(m.ctx, "terminal-data-"+sessionId, string(data))
			}
		}
		if err != nil {
			return
		}
	}
}

// pipeLocalOutput pumps bytes from a local PTY/pipe to the frontend. For WSL
// sessions it runs the bytes through the terminalstream OSC CWD parser (which strips the OSC 733
// CWD markers emitted by the PROMPT_COMMAND hook and decodes the CWD), so the
// file manager can follow the shell's working directory. cptyHandle is the
// Windows ConPTY handle (opaque); stdoutPipe is the fallback non-ConPTY reader.
// Exactly one of them is non-nil.
func (m *SSHManager) pipeLocalOutput(sessionId string, cptyHandle any, stdoutPipe io.Reader) {
	go func() {
		bufPtr := m.bufPool.Get().(*[]byte)
		defer m.bufPool.Put(bufPtr)
		buf := *bufPtr

		for {
			var n int
			var err error
			if c, ok := cptyHandle.(interface{ Read([]byte) (int, error) }); ok && c != nil {
				n, err = c.Read(buf)
			} else {
				if stdoutPipe == nil {
					return
				}
				n, err = stdoutPipe.Read(buf)
			}
			if n <= 0 {
				if err != nil {
					return
				}
				continue
			}

			m.mu.RLock()
			// Disconnect removes the session from the map; guard against the
			// pipe goroutine still reading after teardown (nil map value panic).
			curSd, hasSd := m.sessions[sessionId]
			m.mu.RUnlock()
			if !hasSd {
				return
			}
			oscParser := curSd.OSCCwdParser

			var data []byte
			if oscParser != nil {
				visible, cwd, promptSeen := oscParser.Process(buf[:n])
				data = visible
				if cwd != "" || promptSeen {
					shouldEmitCwd := false
					m.mu.Lock()
					if s, ok := m.sessions[sessionId]; ok {
						if cwd != "" && s.CurrentCwd != cwd {
							s.CurrentCwd = cwd
							shouldEmitCwd = true
						}
						if promptSeen && s.RemoteHistoryActive {
							s.PromptReady = true
						}
					}
					m.mu.Unlock()
					if shouldEmitCwd && m.ctx != nil {
						runtime.EventsEmit(m.ctx, "ssh-terminal-cwd-"+sessionId, cwd)
					}
				}
			} else {
				data = make([]byte, n)
				copy(data, buf[:n])
			}

			if len(data) == 0 {
				if err != nil {
					return
				}
				continue
			}
			m.emitSessionOutput(sessionId, data)
			if m.app != nil {
				m.app.WriteWsOutput(sessionId, data)
			} else if m.ctx != nil {
				runtime.EventsEmit(m.ctx, "terminal-data-"+sessionId, string(data))
			}
			if err != nil {
				return
			}
		}
	}()
}

// getClientEntry 查找 session 对应的共享客户端
func (m *SSHManager) GetClientEntry(sessionId string) (*ssh.Client, *sftp.Client, error) {
	m.mu.RLock()
	s, ok := m.sessions[sessionId]
	if !ok {
		m.mu.RUnlock()
		return nil, nil, fmt.Errorf("session not found")
	}
	entry, ok := m.clients[s.ConnKey]
	m.mu.RUnlock()
	if !ok {
		return nil, nil, fmt.Errorf("client not found for session")
	}
	return entry.Client, entry.SFTP, nil
}

// getSFTPClient 查找 session 对应的 SFTP 客户端；初始化中时短暂等待。
func (m *SSHManager) GetSFTPClient(sessionId string) (*sftp.Client, error) {
	m.mu.RLock()
	s, ok := m.sessions[sessionId]
	if !ok {
		m.mu.RUnlock()
		return nil, fmt.Errorf("session not found")
	}
	entry, ok := m.clients[s.ConnKey]
	if !ok {
		m.mu.RUnlock()
		return nil, fmt.Errorf("client not found for session")
	}
	if entry.SFTP != nil {
		sftpClient := entry.SFTP
		m.mu.RUnlock()
		return sftpClient, nil
	}
	ready := entry.SFTPReady
	m.mu.RUnlock()

	if ready == nil {
		return nil, fmt.Errorf("SFTP not available")
	}
	select {
	case <-ready:
	case <-time.After(sftpInitWaitTimeout):
		return nil, fmt.Errorf("SFTP initialization timed out")
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	entry, ok = m.clients[s.ConnKey]
	if !ok || entry.SFTP == nil {
		if ok && entry.SFTPInitErr != nil {
			return nil, fmt.Errorf("SFTP not available: %w", entry.SFTPInitErr)
		}
		return nil, fmt.Errorf("SFTP not available")
	}
	return entry.SFTP, nil
}

func (m *SSHManager) abortUploadsForSession(sessionId string) {
	_ = m.AbortCompressedUpload(sessionId)
	m.transferService.CancelSession(sessionId)
}

func (m *SSHManager) Disconnect(sessionId string) bool {
	disconnected := false
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Disconnect] panic recovered: %v\n%s", r, debug.Stack())
		}
	}()

	// 先取消正在进行的连接（Connect 还没完成的情况）
	m.pendingMu.Lock()
	if cancel, ok := m.pendingCancels[sessionId]; ok {
		cancel()
		delete(m.pendingCancels, sessionId)
	}
	m.pendingMu.Unlock()

	_ = m.AbortDownloadTransfer(sessionId)
	m.abortUploadsForSession(sessionId)

	// 1. 在锁内完成 map 清理，收集需要关闭的资源
	m.mu.Lock()
	// 临时密钥与待确认条目的生命周期不依赖 m.sessions：握手失败（认证错误、
	// 用户取消主机密钥确认）的会话从未进入 m.sessions，若放在下面的提前返回
	// 之后清理就会永久残留。故先于 ok 判断清掉。
	delete(m.tempAcceptedKeys, sessionId)
	delete(m.pendingHostKeys, sessionId)
	s, ok := m.sessions[sessionId]
	if !ok {
		m.mu.Unlock()
		return false
	}
	disconnected = true
	connKey := s.ConnKey
	delete(m.sessions, sessionId)

	isLocal := s.IsLocal
	isSerial := s.IsSerial

	// 收集需要关闭的资源（避免在锁内执行可能阻塞的 Close 操作）
	stdin := s.Stdin
	sshSess := s.Session

	// 从 connTerminals 中移除
	terminals := m.connTerminals[connKey]
	for i, t := range terminals {
		if t == sessionId {
			m.connTerminals[connKey] = append(terminals[:i], terminals[i+1:]...)
			break
		}
	}
	defer m.emitSSHChannelUsage(connKey)

	var netConnToClose net.Conn
	var sftpToClose *sftp.Client
	var clientToClose *ssh.Client
	stopForwardsConnKey := ""

	if len(m.connTerminals[connKey]) == 0 {
		if entry, ok := m.clients[connKey]; ok {
			netConnToClose = entry.NetConn
			sftpToClose = entry.SFTP
			clientToClose = entry.Client
			if entry.SFTPReady != nil {
				entry.SFTPReadyOnce.Do(func() { close(entry.SFTPReady) })
			}
			delete(m.clients, connKey)
			delete(m.connTerminals, connKey)
			delete(m.probeDeployed, connKey)
			delete(m.probeFailed, connKey)
			delete(m.probeRunFailed, connKey)
			// 本次是该连接最后一个终端的连接级断开: 标记锁外回收端口转发。
			// cleanupClientTransport 路径下 client 已被删, 到这里 ok=false 不会置此标记,
			// 由 cleanupClientTransport 自身的 stopPortForwardsForConnKey 兜底, 二者互斥不重复。
			stopForwardsConnKey = connKey
		}
	}
	m.mu.Unlock() // 尽早释放锁，避免 Close 阻塞影响其他操作
	if stopForwardsConnKey != "" {
		m.stopPortForwardsForConnKey(stopForwardsConnKey)
	}
	// 会话彻底销毁：清理其 WS 注册前缓冲，避免 wsPending map 残留泄漏
	// （PTY 在 WS 断开后可能缓冲过数据；此时 session 已删，再无 flush 机会）。
	if m.app != nil {
		m.app.CleanupWsPending(sessionId)
	}

	// 2. 在锁外关闭资源（服务器挂了时这些操作可能阻塞，但不会锁住其他 goroutine）
	if isLocal {
		// Close the embedded SFTP server and remove its client entry from the map.
		// The sshClientEntry's SFTP client and underlying ssh.Client were dialed
		// into the in-process server; LocalSFTPSrv.Close only stops the listener,
		// so we must also close them or the per-session TCP conn + goroutines leak.
		if s.ConnKey != "" {
			m.mu.Lock()
			localEntry, entryOk := m.clients[s.ConnKey]
			if entryOk {
				delete(m.clients, s.ConnKey)
			}
			m.mu.Unlock()
			if entryOk {
				if localEntry.SFTP != nil {
					closeWithTimeout(localEntry.SFTP, 3*time.Second)
				}
				if localEntry.Client != nil {
					closeWithTimeout(localEntry.Client, 3*time.Second)
				}
			}
		}
		if s.LocalSFTPSrv != nil {
			_ = s.LocalSFTPSrv.Close()
		}
		m.CloseLocal(s)
	} else if isSerial {
		if s.SerialPort != nil {
			_ = s.SerialPort.Close()
			s.SerialPort = nil
		}
	}

	if stdin != nil && !isLocal && !isSerial {
		stdin.Close()
	}
	if sshSess != nil {
		sshSess.Close()
	}
	if netConnToClose != nil {
		_ = netConnToClose.Close()
	}
	if sftpToClose != nil {
		closeWithTimeout(sftpToClose, 3*time.Second)
	}
	if clientToClose != nil {
		closeWithTimeout(clientToClose, 3*time.Second)
	}
	m.closeSessionOutputTaps(sessionId)
	return disconnected
}

// closeWithTimeout 关闭资源，最多等待 timeout，超时放弃避免半死服务端卡住调用方
// ponytail: 超时后底层 goroutine 仍在 Close 上阻塞，等连接真正断开或进程退出才回收；
// SSH client 无 CloseWithDeadline，这是唯一能保证调用方不卡死的轻量手段
func closeWithTimeout(c io.Closer, timeout time.Duration) {
	done := make(chan struct{})
	go func() { c.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(timeout):
	}
}

// DisconnectAll 断开所有 SSH 连接，用于应用退出时清理资源
func (m *SSHManager) DisconnectAll() {
	// 先取消所有正在进行的连接
	m.pendingMu.Lock()
	for id, cancel := range m.pendingCancels {
		cancel()
		delete(m.pendingCancels, id)
	}
	m.pendingMu.Unlock()

	m.mu.RLock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		m.Disconnect(id)
	}
	m.transferService.Close()
}

// OpenTerminal 为已有连接创建新的终端通道
// 复用同一个 SSH 客户端，创建新的 shell session
func (m *SSHManager) OpenTerminal(sessionId string) (string, error) {
	m.mu.RLock()
	existing, ok := m.sessions[sessionId]
	if !ok {
		m.mu.RUnlock()
		return "", fmt.Errorf("session not found")
	}
	entry, ok := m.clients[existing.ConnKey]
	if !ok {
		m.mu.RUnlock()
		return "", fmt.Errorf("client not found for session")
	}
	connKey := existing.ConnKey
	remoteHistoryActive := existing.RemoteHistoryActive
	terminalEncoding := existing.TerminalEncoding
	m.mu.RUnlock()

	// 生成新 session ID
	randomId := make([]byte, 8)
	if _, err := rand.Read(randomId); err != nil {
		return "", fmt.Errorf("生成 session ID 失败: %w", err)
	}
	newId := fmt.Sprintf("term_%x", randomId)

	launchCmd, remoteHistoryActive := buildShellLaunchCommand(existing.ShellPath, existing.TerminalInitPath)

	err := m.setupSession(context.Background(), entry.Client, connKey, newId, sessionId, launchCmd, remoteHistoryActive, existing.ShellPath, existing.TerminalInitPath, terminalEncoding)
	if err != nil {
		return "", err
	}

	return newId, nil
}

// getKnownHostsPath 返回跨平台的 known_hosts 文件路径
func getKnownHostsPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ssh", "known_hosts")
}

// GetKnownHostsPath 导出包装器
func GetKnownHostsPath() string { return getKnownHostsPath() }

// initKnownHostsCallback 初始化 known_hosts 文件并返回 HostKeyCallback
func initKnownHostsCallback() (ssh.HostKeyCallback, error) {
	knownHostsPath := getKnownHostsPath()
	if err := os.MkdirAll(filepath.Dir(knownHostsPath), 0700); err != nil {
		log.Printf("[initKnownHosts] MkdirAll failed: %v", err)
	}
	if _, err := os.Stat(knownHostsPath); os.IsNotExist(err) {
		if err := os.WriteFile(knownHostsPath, []byte(""), 0600); err != nil {
			log.Printf("[initKnownHosts] failed to create known_hosts: %v", err)
		}
	}
	cb, err := knownhosts.New(knownHostsPath)
	if err != nil {
		return nil, fmt.Errorf("无法初始化主机密钥校验，请检查 %s: %w", knownHostsPath, err)
	}
	return cb, nil
}

// TempAcceptedKey 读取该会话「只接受本次」记录的指纹。
// 供 ReconnectWithPassword 在 Disconnect 前后跨重连保留授权。
func (m *SSHManager) TempAcceptedKey(sessionId string) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	fp, ok := m.tempAcceptedKeys[sessionId]
	return fp, ok
}

// RestoreTempAcceptedKey 恢复该会话的临时密钥授权。
func (m *SSHManager) RestoreTempAcceptedKey(sessionId string, fingerprint string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tempAcceptedKeys[sessionId] = fingerprint
}

// ClearTempAcceptedKey 清除该会话的临时密钥授权。
func (m *SSHManager) ClearTempAcceptedKey(sessionId string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.tempAcceptedKeys, sessionId)
}

// AcceptHostKeyChange 处理用户对主机密钥变更的确认
// action: 0=取消, 1=仅本次接受, 2=接受并保存至 known_hosts
func (m *SSHManager) AcceptHostKeyChange(sessionId string, action int) error {
	m.mu.Lock()
	pending, exists := m.pendingHostKeys[sessionId]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("no pending host key change for session %s", sessionId)
	}
	delete(m.pendingHostKeys, sessionId)
	m.mu.Unlock()

	switch action {
	case 0: // 取消
		return fmt.Errorf("用户取消了主机密钥验证")

	case 1: // 仅本次接受 —— 不写 known_hosts，仅临时放行
		m.mu.Lock()
		m.tempAcceptedKeys[sessionId] = pending.NewFingerprint
		m.mu.Unlock()
		err := m.Connect(sessionId, pending.Conn)
		// Connect 失败时清除临时密钥，避免下次连接静默绕过主机密钥校验。
		// 认证失败除外：主机密钥此刻已校验通过，用户补对密码就会走
		// ReconnectWithPassword 重连，此时清掉会导致主机密钥确认二次弹出。
		if err != nil && !errors.Is(err, ErrAuthFailed) {
			m.mu.Lock()
			delete(m.tempAcceptedKeys, sessionId)
			m.mu.Unlock()
		}
		return err

	case 2: // 接受并保存到 known_hosts
		knownHostsPath := getKnownHostsPath()
		if err := os.MkdirAll(filepath.Dir(knownHostsPath), 0700); err != nil {
			log.Printf("[AcceptHostKeyChange] MkdirAll for known_hosts dir failed: %v", err)
		}

		newLine := knownhosts.Line([]string{pending.Hostname}, pending.NewKey)

		if len(pending.OldKeys) > 0 {
			// 密钥已变更：删除旧条目后追加新条目（原子写入：临时文件 + rename）
			data, err := os.ReadFile(knownHostsPath)
			if err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("无法读取 known_hosts: %w", err)
			}

			var newLines []string
			// ponytail: 预计算旧密钥字符串，避免循环内重复 MarshalAuthorizedKey
			oldKeyStrs := make([]string, len(pending.OldKeys))
			for i, k := range pending.OldKeys {
				oldKeyStrs[i] = strings.TrimSpace(string(ssh.MarshalAuthorizedKey(k.Key)))
			}
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					newLines = append(newLines, line)
					continue
				}
				isOld := false
				for _, oldStr := range oldKeyStrs {
					if strings.Contains(line, oldStr) {
						isOld = true
						break
					}
				}
				if !isOld {
					newLines = append(newLines, line)
				}
			}
			newLines = append(newLines, newLine)

			// 原子写入：写临时文件后直接 rename 覆盖。
			// ponytail: os.Rename 在 Unix 上是原子替换，在 Windows 上用 MoveFileEx+MOVEFILE_REPLACE_EXISTING 同样替换。
			// 旧实现先 rename 原文件到 .bak 再 rename tmp→原路径，当第二步失败且回滚也失败时原文件丢失。
			// 直接 rename 失败时原文件未被移动，始终完整，无数据丢失风险。
			tmpPath := knownHostsPath + ".tmp"
			if err := os.WriteFile(tmpPath, []byte(strings.Join(newLines, "\n")+"\n"), 0600); err != nil {
				return fmt.Errorf("无法写入 known_hosts: %w", err)
			}
			if err := os.Rename(tmpPath, knownHostsPath); err != nil {
				os.Remove(tmpPath)
				return fmt.Errorf("无法写入 known_hosts: %w", err)
			}
		} else {
			// 首次连接：直接追加新条目
			f, err := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
			if err != nil {
				return fmt.Errorf("无法写入 known_hosts: %w", err)
			}
			if _, err := f.WriteString(newLine + "\n"); err != nil {
				f.Close()
				return fmt.Errorf("无法写入 known_hosts: %w", err)
			}
			if err := f.Close(); err != nil {
				return fmt.Errorf("无法关闭 known_hosts: %w", err)
			}
		}

		return m.Connect(sessionId, pending.Conn)

	default:
		return fmt.Errorf("无效的操作")
	}
}

func (m *SSHManager) GetTerminalCwd(sessionId string) (string, error) {
	m.mu.RLock()
	sessionData, ok := m.sessions[sessionId]
	if !ok {
		m.mu.RUnlock()
		return "", fmt.Errorf("session not found")
	}
	if strings.TrimSpace(sessionData.CurrentCwd) != "" {
		cwd := strings.TrimSpace(sessionData.CurrentCwd)
		m.mu.RUnlock()
		return cwd, nil
	}
	// For local sessions, query OS process tree instead of SSH.
	if sessionData.IsLocal {
		m.mu.RUnlock()
		return m.getLocalCwdForSession(sessionData)
	}
	m.mu.RUnlock()

	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return "", err
	}

	localAddr := client.LocalAddr().String()
	_, portStr, err := net.SplitHostPort(localAddr)
	if err != nil || portStr == "" {
		return "", fmt.Errorf("invalid local address format")
	}
	if _, err := strconv.Atoi(portStr); err != nil {
		return "", fmt.Errorf("invalid local port: %s", portStr)
	}

	cmd := fmt.Sprintf(`gp(){ awk '/^PPid:/{print $2}' /proc/$1/status 2>/dev/null; }; gn(){ cat /proc/$1/comm 2>/dev/null | tr -d '\n'; }; gc(){ for f in /proc/[0-9]*/status; do p=${f#/proc/}; p=${p%%/*}; awk -v t="$1" '/^PPid:/{if($2==t)f=1} END{exit f?0:1}' "$f" 2>/dev/null && echo "$p"; done; }; CUR_PID=$$; SSHD_PID=""; while [ -n "$CUR_PID" ] && [ "$CUR_PID" -gt 1 ]; do CUR_PID=$(gp $CUR_PID); [ -z "$CUR_PID" ] && break; [ "$(gn $CUR_PID)" = "sshd" ] && SSHD_PID=$CUR_PID && break; done; SHELL_PID=""; MY_MNT=$(readlink /proc/$$/ns/mnt 2>/dev/null); ISS(){ echo "$1" | grep -qE '^(sh|bash|zsh|dash|ash|ksh)$'; }; FCS(){ for child in $(gc "$1"); do [ "$child" = "$$" ] || [ "$child" = "$PPID" ] && continue; ISS "$(gn $child)" || continue; PID_MNT=$(readlink /proc/$child/ns/mnt 2>/dev/null); if [ -z "$MY_MNT" ] || [ -z "$PID_MNT" ] || [ "$MY_MNT" = "$PID_MNT" ]; then echo "$child"; return; fi; done; }; if [ -n "$SSHD_PID" ]; then SHELL_PID=$(FCS "$SSHD_PID"); fi; if [ -z "$SHELL_PID" ]; then PORT=%s; SSHD_PID_PORT=$(ss -ntp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | head -n1); [ -z "$SSHD_PID_PORT" ] && SSHD_PID_PORT=$(netstat -ntp 2>/dev/null | grep ":$PORT " | grep -oE '[0-9]+/sshd' | cut -d/ -f1 | head -n1); if [ -n "$SSHD_PID_PORT" ]; then SHELL_PID=$(FCS "$SSHD_PID_PORT"); fi; fi; if [ -z "$SHELL_PID" ]; then MY_UID=$(id -u 2>/dev/null); SHELL_PID=$(for f in /proc/[0-9]*/status; do p=${f#/proc/}; p=${p%%/*}; [ "$p" = "$$" ] || [ "$p" = "$PPID" ] && continue; awk -v u="$MY_UID" '/^Uid:/{if($2==u)f=1} END{exit f?0:1}' "$f" 2>/dev/null || continue; ISS "$(gn $p)" || continue; PID_MNT=$(readlink /proc/$p/ns/mnt 2>/dev/null); if [ -z "$MY_MNT" ] || [ -z "$PID_MNT" ] || [ "$MY_MNT" = "$PID_MNT" ]; then echo "$p"; fi; done | tail -n1); fi; if [ -n "$SHELL_PID" ]; then readlink /proc/$SHELL_PID/cwd 2>/dev/null || echo "/"; else echo "/"; fi`, portStr)

	out, err := m.executeCmdWithClient(client, cmd)
	if err != nil {
		return "", err
	}
	cwd := strings.TrimSpace(out)
	if cwd == "" || cwd == "/" {
		homeOut, homeErr := m.executeCmdWithClient(client, "echo $HOME")
		if homeErr == nil {
			homeDir := strings.TrimSpace(homeOut)
			if homeDir != "" && homeDir != "/" {
				return homeDir, nil
			}
		}
	}
	if cwd == "" {
		cwd = "/"
	}
	return cwd, nil
}

// getLocalCwdForSession returns the CWD for a local terminal session by
// querying the OS process tree (platform-specific implementation).
func (m *SSHManager) getLocalCwdForSession(s *SessionData) (string, error) {
	if s == nil {
		home, _ := os.UserHomeDir()
		return home, nil
	}
	m.mu.RLock()
	wslDistro := s.WSLDistro
	pid := 0
	if s.Cmd != nil && s.Cmd.Process != nil {
		pid = s.Cmd.Process.Pid
	}
	m.mu.RUnlock()
	return localsftp.CurrentWorkingDirectory(wslDistro, pid)
}

func localSysinfoDependencies() localsysinfo.Dependencies {
	return localsysinfo.Dependencies{
		ProbeScript:      dynamicProbeScript,
		ParseProbe:       parseProbeOutput,
		ParseProcessList: parseFullProcessListOutput,
		ParseStaticInfo:  parseServerStaticInfoOutput,
	}
}

func localSysinfoSession(session *SessionData) localsysinfo.Session {
	if session == nil {
		return localsysinfo.Session{}
	}
	return localsysinfo.Session{WSLDistro: session.WSLDistro}
}

// On Unix/WSL it runs ps; on Windows-native shells it is not yet supported.
func getLocalFullProcessList(s *SessionData) ([]map[string]interface{}, error) {
	return localsysinfo.FullProcessList(localSysinfoSession(s), localSysinfoDependencies())
}

// StartLocalCwdMonitor starts a background polling loop to track the CWD of local sessions
// (WSL and Unix shells) and notify the frontend of updates.
func (m *SSHManager) StartLocalCwdMonitor(sessionId string) {
	go func() {
		ticker := time.NewTicker(1200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-m.ctx.Done():
				return
			case <-ticker.C:
				m.mu.RLock()
				s, ok := m.sessions[sessionId]
				m.mu.RUnlock()
				// Sessions that report CWD via a marker stream (WSL via
				// RemoteHistoryActive, PowerShell via an OSCCwdParser) are driven by
				// pipeLocalOutput instead of this poll loop. Without this guard the
				// poller would overwrite their CurrentCwd with the home-dir fallback.
				// CMD/Unix-local still rely on this poll loop.
				if !ok || !s.IsLocal || s.RemoteHistoryActive || s.OSCCwdParser != nil {
					return
				}
				cwd, err := m.getLocalCwdForSession(s)
				if err != nil {
					continue
				}
				cwd = strings.TrimSpace(cwd)
				if cwd == "" {
					continue
				}
				m.mu.Lock()
				// Re-verify session is still active
				s, ok = m.sessions[sessionId]
				if !ok {
					m.mu.Unlock()
					return
				}
				changed := s.CurrentCwd != cwd
				if changed {
					s.CurrentCwd = cwd
				}
				m.mu.Unlock()
				if changed && m.ctx != nil {
					runtime.EventsEmit(m.ctx, "ssh-terminal-cwd-"+sessionId, cwd)
				}
			}
		}
	}()
}

// WriteBytes sends raw bytes to the SSH PTY stdin (used by WebSocket handler)
func (m *SSHManager) WriteBytes(sessionId string, data []byte) {
	m.mu.Lock()
	s, ok := m.sessions[sessionId]
	var stdin io.WriteCloser
	terminalEncoding := "utf-8"
	if ok && s != nil {
		if s.RemoteHistoryActive && len(data) > 0 {
			s.PromptReady = false
		}
		stdin = s.Stdin
		terminalEncoding = config.NormalizeTerminalEncoding(s.TerminalEncoding)
	}
	m.mu.Unlock()
	if stdin != nil {
		payload := data
		encoded, err := encodeTerminalInputBytes(data, terminalEncoding)
		if err != nil {
			log.Printf("[WriteBytes] encode terminal input failed for %s: %v", sessionId, err)
		} else {
			payload = encoded
		}
		_, _ = stdin.Write(payload)
	}
}

func isBetterAIChatTerminalCandidate(left ai.AIChatCommandTerminalCandidate, right ai.AIChatCommandTerminalCandidate, currentCwd string) bool {
	leftMatchesCurrentCwd := currentCwd != "" && strings.TrimSpace(left.Cwd) == currentCwd
	rightMatchesCurrentCwd := currentCwd != "" && strings.TrimSpace(right.Cwd) == currentCwd
	if left.Busy != right.Busy {
		return !left.Busy
	}
	if leftMatchesCurrentCwd != rightMatchesCurrentCwd {
		return leftMatchesCurrentCwd
	}
	leftHasCwd := strings.TrimSpace(left.Cwd) != ""
	rightHasCwd := strings.TrimSpace(right.Cwd) != ""
	if leftHasCwd != rightHasCwd {
		return leftHasCwd
	}
	return strings.Compare(left.SessionID, right.SessionID) < 0
}

func (m *SSHManager) ListSiblingTerminalCandidates(sessionId string) ([]ai.AIChatCommandTerminalCandidate, error) {
	trimmedSessionID := strings.TrimSpace(sessionId)
	if trimmedSessionID == "" {
		return nil, fmt.Errorf("session not found")
	}

	m.mu.RLock()
	sessionData, ok := m.sessions[trimmedSessionID]
	if !ok || sessionData == nil {
		m.mu.RUnlock()
		return nil, fmt.Errorf("session not found")
	}

	connKey := sessionData.ConnKey
	currentCwd := strings.TrimSpace(sessionData.CurrentCwd)
	if currentCwd == "" {
		currentCwd = strings.TrimSpace(sessionData.TerminalInitPath)
	}

	siblingSessionIDs := append([]string{}, m.connTerminals[connKey]...)
	candidates := make([]ai.AIChatCommandTerminalCandidate, 0, len(siblingSessionIDs))
	for _, siblingSessionID := range siblingSessionIDs {
		if siblingSessionID == trimmedSessionID {
			continue
		}
		siblingSession := m.sessions[siblingSessionID]
		if siblingSession == nil || siblingSession.Session == nil || siblingSession.Stdin == nil {
			continue
		}

		candidateCwd := strings.TrimSpace(siblingSession.CurrentCwd)
		if candidateCwd == "" {
			candidateCwd = strings.TrimSpace(siblingSession.TerminalInitPath)
		}

		candidates = append(candidates, ai.AIChatCommandTerminalCandidate{
			SessionID: strings.TrimSpace(siblingSessionID),
			Busy:      siblingSession.RemoteHistoryActive && !siblingSession.PromptReady,
			Cwd:       candidateCwd,
		})
	}
	m.mu.RUnlock()

	if len(candidates) == 0 {
		return []ai.AIChatCommandTerminalCandidate{}, nil
	}

	recommendedIndex := 0
	for index := 1; index < len(candidates); index++ {
		if isBetterAIChatTerminalCandidate(candidates[index], candidates[recommendedIndex], currentCwd) {
			recommendedIndex = index
		}
	}
	for index := range candidates {
		candidates[index].Recommended = index == recommendedIndex
	}

	sort.SliceStable(candidates, func(i int, j int) bool {
		if candidates[i].Recommended != candidates[j].Recommended {
			return candidates[i].Recommended
		}
		if candidates[i].Busy != candidates[j].Busy {
			return !candidates[i].Busy
		}
		leftMatchesCurrentCwd := currentCwd != "" && strings.TrimSpace(candidates[i].Cwd) == currentCwd
		rightMatchesCurrentCwd := currentCwd != "" && strings.TrimSpace(candidates[j].Cwd) == currentCwd
		if leftMatchesCurrentCwd != rightMatchesCurrentCwd {
			return leftMatchesCurrentCwd
		}
		return strings.Compare(candidates[i].SessionID, candidates[j].SessionID) < 0
	})
	return candidates, nil
}

func (m *SSHManager) Resize(sessionId string, cols, rows int) {
	m.mu.RLock()
	s, ok := m.sessions[sessionId]
	m.mu.RUnlock()
	if ok {
		if s.IsLocal {
			m.ResizeLocal(s, cols, rows)
		} else if s.IsSerial {
			// No resize for serial port
		} else if s.Session != nil {
			if err := s.Session.WindowChange(rows, cols); err != nil {
				log.Printf("[Resize] WindowChange failed for %s: %v", sessionId, err)
			}
		}
	}
}

// executeCmdWithClient executes a command on a separate temporary session using the given client
func (m *SSHManager) executeCmdWithClient(client *ssh.Client, cmd string) (string, error) {
	return m.ExecuteCmdWithClientContext(context.Background(), client, cmd)
}

func (m *SSHManager) ExecuteCmdWithClientContext(ctx context.Context, client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	return runCommandWithSessionContext(ctx, session, cmd, 30*time.Second)
}

// runCommandWithSession 在 session 上执行命令，带超时控制
func runCommandWithSession(session *ssh.Session, cmd string, timeout time.Duration) (string, error) {
	return runCommandWithSessionContext(context.Background(), session, cmd, timeout)
}

func runCommandWithSessionContext(ctx context.Context, session *ssh.Session, cmd string, timeout time.Duration) (string, error) {
	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	session.Stdout = &stdoutBuf
	session.Stderr = &stderrBuf

	errCh := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errCh <- fmt.Errorf("panic in session.Run: %v", r)
			}
		}()
		errCh <- session.Run(cmd)
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	var ctxDone <-chan struct{}
	if ctx != nil {
		ctxDone = ctx.Done()
	}

	select {
	case err := <-errCh:
		stdout := stdoutBuf.String()
		stderr := strings.TrimSpace(stderrBuf.String())
		if err != nil && stderr != "" {
			return stdout, fmt.Errorf("%w: %s", err, stderr)
		}
		return stdout, err
	case <-ctxDone:
		go session.Close()
		return "", ctx.Err()
	case <-timer.C:
		go session.Close()
		return "", fmt.Errorf("command timed out after %v", timeout)
	}
}

const dynamicProbeScript = `#!/bin/sh
# LuminSSH Dynamic Probe - auto generated
# Collects dynamic metrics via /proc

cat /proc/uptime
echo ---LOAD---
cat /proc/loadavg 2>/dev/null
echo ---MEM---
grep -E '^MemTotal:|^MemFree:|^MemAvailable:|^Buffers:|^Cached:|^SReclaimable:|^SwapTotal:|^SwapFree:' /proc/meminfo
echo ---DF---
df -k | grep -vE '^tmpfs|^udev|^devtmpfs|Filesystem'
echo ---CPU1---
grep '^cpu' /proc/stat
echo ---NET1---
if [ -r /proc/net/dev ]; then cat /proc/net/dev; elif command -v ifconfig >/dev/null 2>&1; then ifconfig -a; elif command -v ip >/dev/null 2>&1; then ip -s link; fi
echo ---NETCONN1---
if [ "$1" = "network" ]; then if command -v ss >/dev/null 2>&1; then out=$(ss -H -tnapni 2>/dev/null); if [ -n "$out" ]; then printf '%s\n' "$out"; elif command -v netstat >/dev/null 2>&1; then netstat -tnapn 2>/dev/null | tail -n +3; fi; elif command -v netstat >/dev/null 2>&1; then netstat -tnapn 2>/dev/null | tail -n +3; fi; fi
echo ---DISKIO1---
cat /proc/diskstats
sleep 1
echo ---CPU2---
grep '^cpu' /proc/stat
echo ---NET2---
if [ -r /proc/net/dev ]; then cat /proc/net/dev; elif command -v ifconfig >/dev/null 2>&1; then ifconfig -a; elif command -v ip >/dev/null 2>&1; then ip -s link; fi
echo ---NETCONN2---
if [ "$1" = "network" ]; then if command -v ss >/dev/null 2>&1; then out=$(ss -H -tnapni 2>/dev/null); if [ -n "$out" ]; then printf '%s\n' "$out"; elif command -v netstat >/dev/null 2>&1; then netstat -tnapn 2>/dev/null | tail -n +3; fi; elif command -v netstat >/dev/null 2>&1; then netstat -tnapn 2>/dev/null | tail -n +3; fi; fi
echo ---DISKIO2---
cat /proc/diskstats
echo ---PROC---
ps -eo pid,pcpu,rss,comm --sort=-pcpu 2>/dev/null | head -6
echo ---DONE---
`

// deployProbeScript writes probe.sh to ~/.lumin/ on the remote server via SFTP.
// ponytail: SFTP 操作无 per-op deadline,用 select+timer 兜底 probeDeployTimeout,
// 避免 SFTP subsystem 慢时永久阻塞 getSystemInfo 致前端定时器链断裂(数据不刷新)。
// 超时后 goroutine 仍在后台等待 IO,随 keepalive 关连时退出(可接受临时泄漏)。
func (m *SSHManager) deployProbeScript(sftpClient *sftp.Client, connKey string) error {
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
	}
	m.mu.RLock()
	already := m.probeDeployed[connKey]
	failCount := m.probeFailed[connKey]
	m.mu.RUnlock()
	if already {
		return nil
	}
	if failCount >= 3 {
		return fmt.Errorf("probe deploy failed %d times, giving up", failCount)
	}

	done := make(chan error, 1)
	go func() { done <- m.deployProbeScriptIO(sftpClient) }()

	timer := time.NewTimer(probeDeployTimeout)
	defer timer.Stop()

	select {
	case err := <-done:
		if err != nil {
			m.mu.Lock()
			m.probeFailed[connKey]++
			m.mu.Unlock()
			return err
		}
		m.mu.Lock()
		m.probeDeployed[connKey] = true
		delete(m.probeFailed, connKey) // 成功后重置失败计数，避免历史累计误判永久禁用
		m.mu.Unlock()
		return nil
	case <-timer.C:
		// ponytail: 超时多因服务器慢而非部署逻辑错误,不在此自增 probeFailed:
		// 自增会快速触达 ≥3 永久放弃,反而失去恢复机会。下次重试仍走部署。
		return fmt.Errorf("probe script deploy timed out after %v", probeDeployTimeout)
	}
}

// deployProbeScriptIO 执行 probe.sh 的 SFTP 写入,无超时(由调用方 deployProbeScript 兜底)。
func (m *SSHManager) deployProbeScriptIO(sftpClient *sftp.Client) error {
	if err := sftpClient.MkdirAll(".lumin"); err != nil {
		_ = sftpClient.MkdirAll("/tmp/.lumin")
	}

	scriptPath := ".lumin/probe.sh"
	f, err := sftpClient.Create(scriptPath)
	if err != nil {
		scriptPath = "/tmp/.lumin/probe.sh"
		f, err = sftpClient.Create(scriptPath)
		if err != nil {
			return fmt.Errorf("cannot write probe script: %w", err)
		}
	}
	_, err = f.Write([]byte(dynamicProbeScript))
	// Close 错误也要检查：SFTP 写缓冲刷新失败会导致脚本不完整
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}

	_ = sftpClient.Chmod(scriptPath, 0755)
	return nil
}

// extractSection 从 lines 中提取 startMarker（不含）到 endMarker（不含）之间的内容。
// startMarker 为空时从开头开始收集；endMarker 为空时收集到末尾。
// GetSystemInfo 与 GetServerStaticInfo 共用此实现，避免重复定义。
func buildProbeScriptRunCommand(probeArg string) string {
	return fmt.Sprintf(`sh -c 'f=~/.lumin/probe.sh; [ -f "$f" ] && sh "$f"%s || sh /tmp/.lumin/probe.sh%s'`, probeArg, probeArg)
}

func (m *SSHManager) diagnoseProbeScriptFailure(client *ssh.Client, probeArg string) string {
	diagCmd := fmt.Sprintf(`sh -c 'f=~/.lumin/probe.sh; alt=/tmp/.lumin/probe.sh; if [ -f "$f" ]; then target="$f"; elif [ -f "$alt" ]; then target="$alt"; else echo "probe script not found"; echo "home candidate:$f"; echo "tmp candidate:$alt"; exit 0; fi; echo "target:$target"; ls -ld "$(dirname "$target")" 2>&1; ls -l "$target" 2>&1; command -v sh 2>&1; sh "$target"%s 2>&1 | head -n 20'`, probeArg)
	out, err := m.executeCmdWithClient(client, diagCmd)
	parts := make([]string, 0, 2)
	if trimmedOut := strings.TrimSpace(out); trimmedOut != "" {
		parts = append(parts, trimmedOut)
	}
	if err != nil {
		errText := strings.TrimSpace(err.Error())
		if errText != "" {
			parts = append(parts, errText)
		}
	}
	return strings.Join(parts, " | ")
}

func extractSection(lines []string, startMarker, endMarker string) []string {
	var out []string
	// BUG FIX: if startMarker is empty, strings.Contains(l,"") is always true
	// causing every line to be skipped via `continue`. Fix: start collecting immediately.
	inside := (startMarker == "")
	for _, l := range lines {
		if startMarker != "" && strings.Contains(l, startMarker) {
			inside = true
			continue
		}
		if endMarker != "" && strings.Contains(l, endMarker) {
			break
		}
		if inside {
			out = append(out, l)
		}
	}
	return out
}

func (m *SSHManager) GetSystemInfo(sessionId string) (map[string]interface{}, error) {
	return m.getSystemInfo(sessionId, false)
}

func (m *SSHManager) GetNetworkInfo(sessionId string) (map[string]interface{}, error) {
	return m.getSystemInfo(sessionId, true)
}

func (m *SSHManager) getSystemInfo(sessionId string, includeNetworkConnections bool) (result map[string]interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in GetSystemInfo: %v", r)
			log.Printf("[GetSystemInfo] panic: %v\n%s", r, debug.Stack())
			result = nil
		}
	}()
	// Local sessions (WSL/PowerShell/native terminal) run the probe script directly.
	m.mu.RLock()
	localSd, localOk := m.sessions[sessionId]
	m.mu.RUnlock()
	if localOk && localSd.IsLocal {
		return localsysinfo.SystemInfo(localSysinfoSession(localSd), includeNetworkConnections, localSysinfoDependencies())
	}
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return nil, err
	}
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return nil, err
	}

	m.mu.RLock()
	s, ok := m.sessions[sessionId]
	if !ok {
		m.mu.RUnlock()
		return nil, fmt.Errorf("session not found")
	}
	connKey := s.ConnKey
	m.mu.RUnlock()

	if err := m.deployProbeScript(sftpClient, connKey); err != nil {
		return nil, fmt.Errorf("probe script deploy failed: %w", err)
	}

	probeArg := ""
	if includeNetworkConnections {
		probeArg = " network"
	}
	out, err := m.executeCmdWithClient(client, buildProbeScriptRunCommand(probeArg))
	if err != nil || len(strings.TrimSpace(out)) == 0 {
		// ponytail: 偶发失败(服务器慢/30s 超时)不立即删 probeDeployed 重走 SFTP 部署,
		// 避免每次重试都触发 SFTP 往返。连续失败 3 次才怀疑脚本损坏,强制重新部署。
		m.mu.Lock()
		m.probeRunFailed[connKey]++
		if m.probeRunFailed[connKey] >= 3 {
			delete(m.probeDeployed, connKey)
			delete(m.probeRunFailed, connKey)
		}
		m.mu.Unlock()
		detailParts := make([]string, 0, 3)
		if err != nil {
			detailParts = append(detailParts, err.Error())
		}
		if trimmedOut := strings.TrimSpace(out); trimmedOut != "" {
			detailParts = append(detailParts, "stdout: "+trimmedOut)
		}
		if diagnostic := m.diagnoseProbeScriptFailure(client, probeArg); diagnostic != "" {
			detailParts = append(detailParts, "diagnostics: "+diagnostic)
		}
		if len(detailParts) == 0 {
			return nil, fmt.Errorf("probe script execution failed")
		}
		return nil, fmt.Errorf("probe script execution failed: %s", strings.Join(detailParts, " | "))
	}

	// 成功:重置执行失败计数
	m.mu.Lock()
	delete(m.probeRunFailed, connKey)
	m.mu.Unlock()
	return parseProbeOutput(out, includeNetworkConnections)
}

// parseProbeOutput parses the stdout of dynamicProbeScript and returns the
// structured data map used by the frontend panels. Shared by SSH and local sessions.
func parseProbeOutput(out string, includeNetworkConnections bool) (map[string]interface{}, error) {
	// ── Split on ---CPU2--- to get two halves ──────────────────────────
	halves := strings.SplitN(out, "---CPU2---", 2)
	if len(halves) < 2 {
		return nil, fmt.Errorf("unexpected output format")
	}
	part1 := halves[0]
	part2 := halves[1] // everything after ---CPU2---

	lines1 := strings.Split(part1, "\n")
	lines2 := strings.Split(part2, "\n")

	// ── Parse uptime ──────────────────────────────────────────────────
	uptimeSeconds := 0.0
	uptimeDays := 0
	uptimeHours := 0
	uptimeMins := 0
	if len(lines1) > 0 {
		fmt.Sscanf(strings.TrimSpace(lines1[0]), "%f", &uptimeSeconds)
		uptimeDays = int(uptimeSeconds / 86400)
		uptimeHours = int((uptimeSeconds - float64(uptimeDays*86400)) / 3600)
		uptimeMins = int((uptimeSeconds - float64(uptimeDays*86400) - float64(uptimeHours*3600)) / 60)
	}

	// ── Parse load average ───────────────────────────────────────────
	loadLines := extractSection(lines1, "---LOAD---", "---MEM---")
	var load1, load5, load15 float64
	if len(loadLines) > 0 {
		fmt.Sscanf(strings.TrimSpace(loadLines[0]), "%f %f %f", &load1, &load5, &load15)
	}

	// ── Parse memory ──────────────────────────────────────────────────
	var memTotal, memFree, memAvailable, memBuffers, memCached, memSReclaimable uint64
	var swapTotal, swapFree uint64
	for _, l := range lines1 {
		switch {
		case strings.HasPrefix(l, "MemTotal:"):
			fmt.Sscanf(l, "MemTotal: %d", &memTotal)
		case strings.HasPrefix(l, "MemFree:"):
			fmt.Sscanf(l, "MemFree: %d", &memFree)
		case strings.HasPrefix(l, "MemAvailable:"):
			fmt.Sscanf(l, "MemAvailable: %d", &memAvailable)
		case strings.HasPrefix(l, "Buffers:"):
			fmt.Sscanf(l, "Buffers: %d", &memBuffers)
		case strings.HasPrefix(l, "Cached:"):
			fmt.Sscanf(l, "Cached: %d", &memCached)
		case strings.HasPrefix(l, "SReclaimable:"):
			fmt.Sscanf(l, "SReclaimable: %d", &memSReclaimable)
		case strings.HasPrefix(l, "SwapTotal:"):
			fmt.Sscanf(l, "SwapTotal: %d", &swapTotal)
		case strings.HasPrefix(l, "SwapFree:"):
			fmt.Sscanf(l, "SwapFree: %d", &swapFree)
		}
	}
	memTotalMB := float64(memTotal) / 1024.0
	memFreeMB := float64(memFree) / 1024.0
	memCacheMB := float64(memBuffers+memCached+memSReclaimable) / 1024.0
	// 用 MemAvailable 计算已用（与 free 命令一致）
	var memUsedMB float64
	if memAvailable > 0 {
		memUsedMB = float64(memTotal-memAvailable) / 1024.0
	} else {
		memUsedMB = float64(memTotal-memFree-memBuffers-memCached-memSReclaimable) / 1024.0
	}
	if memUsedMB < 0 {
		memUsedMB = 0
	}
	swapTotalMB := float64(swapTotal) / 1024.0
	swapFreeMB := float64(swapFree) / 1024.0
	swapUsedMB := swapTotalMB - swapFreeMB
	if swapUsedMB < 0 {
		swapUsedMB = 0
	}

	// ── Parse df (all partitions) ─────────────────────────────────────
	dfLines := extractSection(lines1, "---DF---", "---CPU1---")
	var diskTotalKB, diskUsedKB uint64
	var diskPercent float64
	diskDevice := "disk"
	type partition struct {
		Mount   string
		Size    string
		Avail   string
		UsedPct int
	}
	var partitions []partition
	for _, l := range dfLines {
		fields := strings.Fields(l)
		if len(fields) < 6 {
			continue
		}
		totalKB, _ := strconv.ParseUint(fields[1], 10, 64)
		usedKB, _ := strconv.ParseUint(fields[2], 10, 64)
		availKB, _ := strconv.ParseUint(fields[3], 10, 64)
		pctStr := strings.TrimSuffix(fields[4], "%")
		pct, _ := strconv.Atoi(pctStr)
		mount := fields[5]
		if mount == "/" {
			diskDevice = filepath.Base(fields[0])
			diskTotalKB = totalKB
			diskUsedKB = usedKB
			if totalKB > 0 {
				diskPercent = float64(usedKB) / float64(totalKB) * 100.0
			}
		}
		formatGB := func(kb uint64) string {
			gb := float64(kb) / (1024.0 * 1024.0)
			if gb < 1 {
				return fmt.Sprintf("%.0fM", float64(kb)/1024.0)
			}
			return fmt.Sprintf("%.1fG", gb)
		}
		partitions = append(partitions, partition{
			Mount:   mount,
			Size:    formatGB(totalKB),
			Avail:   formatGB(availKB),
			UsedPct: pct,
		})
	}
	diskTotalGB := float64(diskTotalKB) / (1024.0 * 1024.0)
	diskUsedGB := float64(diskUsedKB) / (1024.0 * 1024.0)

	// ── Parse CPU (/proc/stat delta, XTerminal method) ────────────────
	cpuLines1 := extractSection(lines1, "---CPU1---", "---NET1---")
	cpuLines2 := extractSection(lines2, "", "---NET2---") // empty startMarker = collect from beginning

	parseStat := func(lines []string) map[string][]uint64 {
		res := make(map[string][]uint64)
		for _, l := range lines {
			if !strings.HasPrefix(l, "cpu") {
				continue
			}
			parts := strings.Fields(l)
			if len(parts) < 5 {
				continue
			}
			// /proc/stat fields: user nice system idle iowait irq softirq steal ...
			getU := func(i int) uint64 {
				if i+1 < len(parts) {
					v, _ := strconv.ParseUint(parts[i+1], 10, 64)
					return v
				}
				return 0
			}
			userN := getU(0) + getU(1)                    // user + nice
			sysN := getU(2) + getU(5) + getU(6) + getU(7) // system + irq + softirq + steal
			idleN := getU(3) + getU(4)                    // idle + iowait
			total := userN + sysN + idleN
			res[parts[0]] = []uint64{userN, sysN, idleN, total}
		}
		return res
	}

	cpus1 := parseStat(cpuLines1)
	cpus2 := parseStat(cpuLines2)

	computeUsage := func(name string) float64 {
		v1, ok1 := cpus1[name]
		v2, ok2 := cpus2[name]
		if !ok1 || !ok2 || len(v1) < 4 || len(v2) < 4 {
			return 0
		}
		// v = [user+nice, system+irq+softirq+steal, idle+iowait, total]
		dTotal := float64(v2[3]) - float64(v1[3])
		dIdle := float64(v2[2]) - float64(v1[2])
		if dTotal <= 0 {
			return 0
		}
		usage := 100.0 * (1.0 - dIdle/dTotal)
		if usage < 0 {
			return 0
		}
		if usage > 100 {
			return 100
		}
		return usage
	}

	cpuTotalUsage := computeUsage("cpu")

	// Collect core names, sort them (cpu0, cpu1, cpu2...)
	var coreNames []string
	for name := range cpus2 {
		if name != "cpu" && strings.HasPrefix(name, "cpu") {
			coreNames = append(coreNames, name)
		}
	}
	sort.Strings(coreNames)

	var cpuCoreUsages []float64
	for _, name := range coreNames {
		cpuCoreUsages = append(cpuCoreUsages, computeUsage(name))
	}

	// ── Parse Network ─────────────────────────────────────────────────
	shouldIgnoreNetIf := func(name string) bool {
		name = strings.TrimSpace(name)
		return name == "" || name == "lo" || strings.HasPrefix(name, "lo:") ||
			strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "br-") ||
			strings.HasPrefix(name, "veth") || strings.HasPrefix(name, "virbr") ||
			strings.HasPrefix(name, "vmnet") || strings.HasPrefix(name, "tun") ||
			strings.HasPrefix(name, "tap") || strings.HasPrefix(name, "wg")
	}

	parseNetworkStats := func(lines []string) map[string][]uint64 {
		res := make(map[string][]uint64)
		for i := 0; i < len(lines); i++ {
			l := strings.TrimSpace(lines[i])
			if l == "" {
				continue
			}

			// /proc/net/dev: eth0: rx ... tx
			if strings.Contains(l, ":") {
				parts := strings.SplitN(l, ":", 2)
				name := strings.TrimSpace(parts[0])
				fields := strings.Fields(parts[1])
				if !shouldIgnoreNetIf(name) && len(fields) >= 16 {
					rx, _ := strconv.ParseUint(fields[0], 10, 64)
					tx, _ := strconv.ParseUint(fields[8], 10, 64)
					res[name] = []uint64{rx, tx}
					continue
				}
			}

			// ifconfig: eth0 ... / RX bytes ... TX bytes ...
			if fields := strings.Fields(l); len(fields) > 0 && !strings.HasPrefix(fields[0], "RX") && !strings.HasPrefix(fields[0], "TX") {
				name := strings.TrimSuffix(fields[0], ":")
				if _, err := strconv.Atoi(name); err == nil {
					name = ""
				}
				if shouldIgnoreNetIf(name) {
					continue
				}
				var rx, tx uint64
				for j := i + 1; j < len(lines) && j < i+10; j++ {
					ll := strings.TrimSpace(lines[j])
					parts := strings.Fields(ll)
					for k, token := range parts {
						var v uint64
						var ok bool
						if strings.HasPrefix(token, "bytes:") {
							v, _ = strconv.ParseUint(strings.TrimPrefix(token, "bytes:"), 10, 64)
							ok = true
						} else if token == "bytes" && k+1 < len(parts) {
							v, _ = strconv.ParseUint(parts[k+1], 10, 64)
							ok = true
						}
						if ok && strings.HasPrefix(ll, "RX") {
							rx = v
						} else if ok && strings.HasPrefix(ll, "TX") {
							tx = v
						}
					}
				}
				if rx > 0 || tx > 0 {
					res[name] = []uint64{rx, tx}
				}
			}

			// ip -s link: iface line followed by RX/TX blocks.
			if strings.Contains(l, ": ") {
				parts := strings.SplitN(l, ": ", 3)
				if len(parts) >= 2 {
					name := strings.TrimSpace(strings.Split(parts[1], "@")[0])
					if shouldIgnoreNetIf(name) || i+5 >= len(lines) {
						continue
					}
					rxFields := strings.Fields(lines[i+3])
					txFields := strings.Fields(lines[i+5])
					if len(rxFields) > 0 && len(txFields) > 0 {
						rx, _ := strconv.ParseUint(rxFields[0], 10, 64)
						tx, _ := strconv.ParseUint(txFields[0], 10, 64)
						if rx > 0 || tx > 0 {
							res[name] = []uint64{rx, tx}
						}
					}
				}
			}
		}
		return res
	}

	netLines1 := extractSection(lines1, "---NET1---", "---NETCONN1---")
	netLines2 := extractSection(lines2, "---NET2---", "---NETCONN2---")
	nets1 := parseNetworkStats(netLines1)
	nets2 := parseNetworkStats(netLines2)

	var netUpSpeed, netDownSpeed, netUpTotal, netDownTotal float64
	var networkInterfaces []map[string]interface{}
	for ifName, v2 := range nets2 {
		v1, ok := nets1[ifName]
		if !ok {
			continue
		}
		netDownTotal += float64(v2[0]) / (1024.0 * 1024.0)
		netUpTotal += float64(v2[1]) / (1024.0 * 1024.0)
		// 防止 v2 < v1 时 uint64 减法下溢（计数器回绕/重置）
		var rxSpeed, txSpeed float64
		if v2[0] >= v1[0] {
			rxSpeed = float64(v2[0]-v1[0]) / 1024.0 // KB/s over 1s
		}
		if v2[1] >= v1[1] {
			txSpeed = float64(v2[1]-v1[1]) / 1024.0
		}
		netDownSpeed += rxSpeed
		netUpSpeed += txSpeed
		networkInterfaces = append(networkInterfaces, map[string]interface{}{
			"name":          ifName,
			"uploadSpeed":   txSpeed,
			"downloadSpeed": rxSpeed,
			"uploadTotal":   float64(v2[1]) / (1024.0 * 1024.0),
			"downloadTotal": float64(v2[0]) / (1024.0 * 1024.0),
		})
	}
	sort.Slice(networkInterfaces, func(i, j int) bool {
		return networkInterfaces[i]["name"].(string) < networkInterfaces[j]["name"].(string)
	})

	// ── Parse Disk IO ─────────────────────────────────────────────────
	parseDiskIO := func(lines []string) map[string][]uint64 {
		res := make(map[string][]uint64)
		for _, l := range lines {
			fields := strings.Fields(l)
			if len(fields) < 10 {
				continue
			}
			name := fields[2]
			if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") {
				continue
			}
			r, _ := strconv.ParseUint(fields[5], 10, 64)
			w, _ := strconv.ParseUint(fields[9], 10, 64)
			res[name] = []uint64{r, w}
		}
		return res
	}

	diskIO1 := parseDiskIO(extractSection(lines1, "---DISKIO1---", "---CPU2---"))
	diskIO2 := parseDiskIO(extractSection(lines2, "---DISKIO2---", "---PROC---"))

	var diskReadSpeed, diskWriteSpeed float64
	for dName, v2 := range diskIO2 {
		v1, ok := diskIO1[dName]
		if !ok {
			continue
		}
		// 防止 v2 < v1 时 uint64 减法下溢（计数器回绕/重置）
		var rKB, wKB float64
		if v2[0] >= v1[0] {
			rKB = float64(v2[0]-v1[0]) * 0.5 // 512-byte sectors → KB over 1s
		}
		if v2[1] >= v1[1] {
			wKB = float64(v2[1]-v1[1]) * 0.5
		}
		if rKB > diskReadSpeed {
			diskReadSpeed = rKB
		}
		if wKB > diskWriteSpeed {
			diskWriteSpeed = wKB
		}
	}

	// Convert partitions to []map for JSON
	var partMaps []map[string]interface{}
	for _, p := range partitions {
		partMaps = append(partMaps, map[string]interface{}{
			"mount":   p.Mount,
			"size":    p.Size,
			"avail":   p.Avail,
			"usedPct": p.UsedPct,
		})
	}

	// ── Parse Network Connections ─────────────────────────────────────
	connLines1 := extractSection(lines1, "---NETCONN1---", "---DISKIO1---")
	connLines := extractSection(lines2, "---NETCONN2---", "---DISKIO2---")
	type netConnAgg struct {
		PID        string
		Name       string
		ListenIP   string
		Port       string
		IPs        map[string]struct{}
		ConnCount  int
		UploadMB   float64
		DownloadMB float64
		Peers      []map[string]interface{}
	}
	connAgg := make(map[string]*netConnAgg)
	extractPIDName := func(line string) (string, string) {
		pid := "-"
		name := "-"
		if idx := strings.Index(line, "pid="); idx >= 0 {
			rest := line[idx+4:]
			end := strings.IndexAny(rest, ",) ")
			if end < 0 {
				end = len(rest)
			}
			pid = strings.Trim(rest[:end], "\"")
		}
		if idx := strings.Index(line, "users:((\""); idx >= 0 {
			rest := line[idx+9:]
			if end := strings.Index(rest, "\""); end >= 0 {
				name = rest[:end]
			}
		} else if idx := strings.LastIndex(line, "/"); idx >= 0 {
			rest := strings.TrimSpace(line[idx+1:])
			if rest != "" && !strings.Contains(rest, ":") {
				name = strings.Fields(rest)[0]
			}
		}
		return pid, name
	}
	splitHostPort := func(addr string) (string, string) {
		addr = strings.Trim(addr, "[]")
		if addr == "" || addr == "*" {
			return "*", "-"
		}
		idx := strings.LastIndex(addr, ":")
		if idx < 0 {
			return addr, "-"
		}
		host := strings.Trim(addr[:idx], "[]")
		port := addr[idx+1:]
		if host == "" {
			host = "*"
		}
		return host, port
	}
	addrFamily := func(host string) string {
		if strings.Contains(host, ":") || host == "::" {
			return "6"
		}
		return "4"
	}
	peerLocation := func(host string) string {
		ip := net.ParseIP(strings.Trim(host, "[]"))
		if ip == nil {
			return "-"
		}
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return "reserved"
		}
		return "-"
	}
	parseSSBytesMB := func(line string) (float64, float64) {
		var sent, received uint64
		for _, token := range strings.Fields(line) {
			if strings.HasPrefix(token, "bytes_sent:") {
				sent, _ = strconv.ParseUint(strings.TrimPrefix(token, "bytes_sent:"), 10, 64)
			} else if strings.HasPrefix(token, "bytes_received:") {
				received, _ = strconv.ParseUint(strings.TrimPrefix(token, "bytes_received:"), 10, 64)
			}
		}
		return float64(sent) / (1024.0 * 1024.0), float64(received) / (1024.0 * 1024.0)
	}
	connByteKey := func(pid, name, local, peer string) string {
		return pid + "|" + name + "|" + local + "|" + peer
	}
	isConnHeader := func(fields []string) bool {
		if len(fields) < 5 {
			return false
		}
		proto := strings.ToLower(fields[0])
		if strings.HasPrefix(proto, "tcp") {
			return true
		}
		_, err1 := strconv.Atoi(fields[1])
		_, err2 := strconv.Atoi(fields[2])
		return err1 == nil && err2 == nil
	}
	parseConnBytes := func(lines []string) map[string][2]float64 {
		res := make(map[string][2]float64)
		for i, l := range lines {
			fields := strings.Fields(l)
			if len(fields) < 5 {
				continue
			}
			if !isConnHeader(fields) {
				continue
			}
			localIdx := 3
			if len(fields) >= 6 {
				if _, err := strconv.Atoi(fields[1]); err != nil {
					localIdx = 4
				}
			}
			peerIdx := localIdx + 1
			if len(fields) <= peerIdx || i+1 >= len(lines) {
				continue
			}
			nextFields := strings.Fields(lines[i+1])
			if isConnHeader(nextFields) {
				continue
			}
			sent, received := parseSSBytesMB(lines[i+1])
			pid, name := extractPIDName(l)
			res[connByteKey(pid, name, fields[localIdx], fields[peerIdx])] = [2]float64{sent, received}
		}
		return res
	}
	connBytes1 := parseConnBytes(connLines1)
	for i, l := range connLines {
		fields := strings.Fields(l)
		if len(fields) < 5 {
			continue
		}
		if isConnHeader(fields) {
			localIdx := 3
			if len(fields) >= 6 {
				if _, err := strconv.Atoi(fields[1]); err != nil {
					localIdx = 4
				}
			}
			peerIdx := localIdx + 1
			if len(fields) <= peerIdx {
				continue
			}
			local := fields[localIdx]
			peer := fields[peerIdx]
			listenIP, port := splitHostPort(local)
			peerIP, peerPort := splitHostPort(peer)
			pid, name := extractPIDName(l)
			uploadMB, downloadMB := 0.0, 0.0
			if i+1 < len(connLines) {
				nextFields := strings.Fields(connLines[i+1])
				if !isConnHeader(nextFields) {
					uploadNow, downloadNow := parseSSBytesMB(connLines[i+1])
					if prev, ok := connBytes1[connByteKey(pid, name, local, peer)]; ok {
						if uploadNow >= prev[0] {
							uploadMB = uploadNow - prev[0]
						}
						if downloadNow >= prev[1] {
							downloadMB = downloadNow - prev[1]
						}
					}
				}
			}
			key := pid + "|" + name + "|" + listenIP + "|" + port
			item := connAgg[key]
			if item == nil {
				item = &netConnAgg{PID: pid, Name: name, ListenIP: listenIP, Port: port, IPs: map[string]struct{}{}}
				connAgg[key] = item
			}
			isRealPeer := peerIP != "" && peerIP != "*" && peerIP != "0.0.0.0" && peerIP != "::"
			if isRealPeer {
				item.IPs[peerIP] = struct{}{}
				item.ConnCount++
				item.Peers = append(item.Peers, map[string]interface{}{
					"location": peerLocation(peerIP),
					"ip":       peerIP,
					"port":     peerPort,
					"upload":   uploadMB,
					"download": downloadMB,
				})
			}
			item.UploadMB += uploadMB
			item.DownloadMB += downloadMB
		}
	}
	listenerByPortFamily := make(map[string]*netConnAgg)
	for _, item := range connAgg {
		if item.Port == "-" {
			continue
		}
		if item.ListenIP == "0.0.0.0" || item.ListenIP == "::" || item.ListenIP == "*" {
			listenerByPortFamily[item.Port+"|"+addrFamily(item.ListenIP)] = item
		}
	}
	for key, item := range connAgg {
		if target := listenerByPortFamily[item.Port+"|"+addrFamily(item.ListenIP)]; target != nil && target != item {
			for ip := range item.IPs {
				target.IPs[ip] = struct{}{}
			}
			target.ConnCount += item.ConnCount
			target.UploadMB += item.UploadMB
			target.DownloadMB += item.DownloadMB
			target.Peers = append(target.Peers, item.Peers...)
			delete(connAgg, key)
		}
	}

	var networkConnections []map[string]interface{}
	for _, item := range connAgg {
		networkConnections = append(networkConnections, map[string]interface{}{
			"pid":       item.PID,
			"name":      item.Name,
			"listenIP":  item.ListenIP,
			"port":      item.Port,
			"ipCount":   len(item.IPs),
			"connCount": item.ConnCount,
			"upload":    item.UploadMB,
			"download":  item.DownloadMB,
			"peers":     item.Peers,
		})
	}
	sort.Slice(networkConnections, func(i, j int) bool {
		ci := networkConnections[i]["connCount"].(int)
		cj := networkConnections[j]["connCount"].(int)
		if ci == cj {
			return fmt.Sprint(networkConnections[i]["port"]) < fmt.Sprint(networkConnections[j]["port"])
		}
		return ci > cj
	})
	if len(networkConnections) > 200 {
		networkConnections = networkConnections[:200]
	}

	// ── Parse Processes ───────────────────────────────────────────────
	procLines := extractSection(lines2, "---PROC---", "---DONE---")
	var processes []map[string]interface{}
	for _, l := range procLines {
		fields := strings.Fields(l)
		if len(fields) < 4 {
			continue
		}
		// skip header line
		if fields[0] == "PID" {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[1], 64)
		rss, _ := strconv.ParseUint(fields[2], 10, 64)
		processes = append(processes, map[string]interface{}{
			"pid": fields[0],
			"cpu": cpu,
			"mem": float64(rss) / 1024.0, // MB
			"cmd": fields[3],
		})
	}

	return map[string]interface{}{
		"uptime": map[string]int{"days": uptimeDays, "hours": uptimeHours, "mins": uptimeMins},
		"load":   map[string]float64{"load1": load1, "load5": load5, "load15": load15},
		"cpu": map[string]interface{}{
			"usage": cpuTotalUsage,
			"cores": cpuCoreUsages,
		},
		"memory": map[string]interface{}{
			"total":     memTotalMB,
			"used":      memUsedMB,
			"cache":     memCacheMB,
			"free":      memFreeMB,
			"swapTotal": swapTotalMB,
			"swapUsed":  swapUsedMB,
		},
		"disk": map[string]interface{}{
			"device":     diskDevice,
			"type":       "",
			"total":      diskTotalGB,
			"used":       diskUsedGB,
			"usage":      diskPercent,
			"readSpeed":  diskReadSpeed,
			"writeSpeed": diskWriteSpeed,
			"partitions": partMaps,
		},
		"network": map[string]interface{}{
			"uploadSpeed":   netUpSpeed,
			"downloadSpeed": netDownSpeed,
			"uploadTotal":   netUpTotal,
			"downloadTotal": netDownTotal,
			"interfaces":    networkInterfaces,
			"connections":   networkConnections,
		},
		"processes": processes,
	}, nil
}

// GetFullProcessList 获取服务器上所有进程列表（无 head 限制）
func (m *SSHManager) GetFullProcessList(sessionId string) ([]map[string]interface{}, error) {
	// For local sessions run ps directly.
	m.mu.RLock()
	sd, sdOk := m.sessions[sessionId]
	m.mu.RUnlock()
	if sdOk && sd.IsLocal {
		return getLocalFullProcessList(sd)
	}

	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return nil, err
	}

	out, err := m.executeCmdWithClient(client, `ps -eo pid,pcpu,rss,user,comm,stat,nlwp,etime,args --sort=-pcpu 2>/dev/null`)
	if err != nil {
		return nil, err
	}

	return parseFullProcessListOutput(out)
}

// parseFullProcessListOutput parses ps output into structured process maps.
func parseFullProcessListOutput(out string) ([]map[string]interface{}, error) {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	var processes []map[string]interface{}
	for _, l := range lines {
		fields := strings.Fields(l)
		if len(fields) < 9 {
			continue
		}
		if fields[0] == "PID" {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[1], 64)
		rss, _ := strconv.ParseUint(fields[2], 10, 64)
		nlwp, _ := strconv.ParseUint(fields[6], 10, 64)

		name := fields[4]
		stat := fields[5]
		etime := fields[7]
		args := strings.Join(fields[8:], " ")

		// "位置" 取 args 的第一个词（可执行路径）
		var loc string
		if idx := strings.Index(args, " "); idx > 0 {
			loc = args[:idx]
		} else {
			loc = args
		}

		processes = append(processes, map[string]interface{}{
			"pid":   fields[0],
			"cpu":   cpu,
			"mem":   float64(rss) / 1024.0,
			"user":  fields[3],
			"name":  name,
			"cmd":   args,
			"loc":   loc,
			"stat":  stat,
			"nlwp":  nlwp,
			"etime": etime,
		})
	}
	return processes, nil
}

// KillProcess 终止指定 PID 的进程
func (m *SSHManager) KillProcess(sessionId string, pid string) error {
	if _, err := strconv.Atoi(pid); err != nil {
		return fmt.Errorf("invalid pid: %s", pid)
	}
	m.mu.RLock()
	sd, hasSd := m.sessions[sessionId]
	m.mu.RUnlock()
	if hasSd && sd.IsLocal {
		m.mu.RLock()
		wslDistro := sd.WSLDistro
		m.mu.RUnlock()
		return localsysinfo.KillProcess(localsysinfo.Session{WSLDistro: wslDistro}, pid)
	}

	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	_, err = m.executeCmdWithClient(client, "kill -9 "+pid+" 2>/dev/null")
	return err
}

// GetProcessEnv 获取指定进程的环境变量列表
func (m *SSHManager) GetProcessEnv(sessionId string, pid string) ([]string, error) {
	if _, err := strconv.Atoi(pid); err != nil {
		return nil, fmt.Errorf("invalid pid: %s", pid)
	}
	m.mu.RLock()
	sd, hasSd := m.sessions[sessionId]
	m.mu.RUnlock()
	if hasSd && sd.IsLocal {
		m.mu.RLock()
		wslDistro := sd.WSLDistro
		m.mu.RUnlock()
		return localsysinfo.ProcessEnvironment(localsysinfo.Session{WSLDistro: wslDistro}, pid)
	}

	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return nil, err
	}
	out, err := m.executeCmdWithClient(client, "cat /proc/"+pid+"/environ 2>/dev/null | tr '\\0' '\\n'")
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	// 过滤掉空行
	var result []string
	for _, l := range lines {
		if l != "" {
			result = append(result, l)
		}
	}
	return result, nil
}

// GetServerStaticInfo 获取服务器静态信息（OS/时区/主机名/CPU 型号），只在连接时调用一次
func (m *SSHManager) GetServerStaticInfo(sessionId string) (result map[string]interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in GetServerStaticInfo: %v", r)
			log.Printf("[GetServerStaticInfo] panic: %v\n%s", r, debug.Stack())
			result = nil
		}
	}()
	m.mu.RLock()
	sd, hasSd := m.sessions[sessionId]
	m.mu.RUnlock()
	if hasSd && sd.IsLocal {
		m.mu.RLock()
		wslDistro := sd.WSLDistro
		m.mu.RUnlock()
		return localsysinfo.StaticInfo(localsysinfo.Session{WSLDistro: wslDistro}, localSysinfoDependencies())
	}

	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return nil, err
	}

	out, err := m.executeCmdWithClient(client, `echo ---OS---
grep PRETTY_NAME /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/issue 2>/dev/null | head -1 || uname -s -r
echo ---TZ---
timedatectl show -p Timezone --value 2>/dev/null || readlink -f /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || cat /etc/timezone 2>/dev/null || date +'%z'
echo ---CPUINFO---
grep 'model name' /proc/cpuinfo | head -1
echo ---IP---
ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' || hostname -I 2>/dev/null | awk '{print $1}'`)
	if err != nil {
		return nil, err
	}

	return parseServerStaticInfoOutput(out)
}

// parseServerStaticInfoOutput parses static query outputs into OS details map.
func parseServerStaticInfoOutput(out string) (map[string]interface{}, error) {
	lines := strings.Split(strings.TrimSpace(out), "\n")

	osName := "Linux"
	for _, l := range extractSection(lines, "---OS---", "---TZ---") {
		t := strings.TrimSpace(l)
		if t == "" {
			continue
		}
		if strings.HasPrefix(t, "PRETTY_NAME=") {
			osName = strings.Trim(strings.TrimPrefix(t, "PRETTY_NAME="), "\"")
			break
		}
		osName = t
		break
	}
	tzStr := "UTC"
	for _, l := range extractSection(lines, "---TZ---", "---CPUINFO---") {
		t := strings.TrimSpace(l)
		if t != "" {
			tzStr = t
			break
		}
	}
	cpuModel := ""
	for _, l := range extractSection(lines, "---CPUINFO---", "---IP---") {
		t := strings.TrimSpace(l)
		if t != "" {
			if idx := strings.Index(t, ":"); idx >= 0 {
				cpuModel = strings.TrimSpace(t[idx+1:])
			}
			break
		}
	}
	ipAddr := ""
	for _, l := range extractSection(lines, "---IP---", "") {
		t := strings.TrimSpace(l)
		if t != "" {
			ipAddr = t
			break
		}
	}

	return map[string]interface{}{
		"os":       osName,
		"timezone": tzStr,
		"ip":       ipAddr,
		"cpu": map[string]interface{}{
			"model": cpuModel,
		},
	}, nil
}

// SFTP Methods

func ensureContextActive(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func writeStringChunksWithContext(ctx context.Context, writer io.Writer, content string) error {
	const chunkSize = 32768
	for offset := 0; offset < len(content); {
		if err := ensureContextActive(ctx); err != nil {
			return err
		}
		end := offset + chunkSize
		if end > len(content) {
			end = len(content)
		}
		written, err := writer.Write([]byte(content[offset:end]))
		if err != nil {
			return err
		}
		offset += written
	}
	return ensureContextActive(ctx)
}

func normalizeRemotePath(input string) string {
	trimmed := strings.TrimSpace(strings.ReplaceAll(input, "\\", "/"))
	if trimmed == "" {
		return "/"
	}
	cleaned := pathpkg.Clean(trimmed)
	if cleaned == "." || cleaned == "" {
		return "/"
	}
	if !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + strings.TrimLeft(cleaned, "/")
	}
	return cleaned
}

func remoteParentPath(input string) string {
	normalized := normalizeRemotePath(input)
	parent := pathpkg.Dir(normalized)
	if parent == "." || parent == "" {
		return "/"
	}
	return normalizeRemotePath(parent)
}

func isRemotePathNotFound(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "no such file") || strings.Contains(lower, "not found") || strings.Contains(lower, "does not exist")
}

func (m *SSHManager) ResolveDirectoryPath(sessionId string, inputPath string) (string, error) {
	normalizedPath := normalizeRemotePath(inputPath)
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return "", err
	}

	if info, statErr := sftpClient.Stat(normalizedPath); statErr == nil && info != nil {
		if info.IsDir() {
			return normalizedPath, nil
		}
		return remoteParentPath(normalizedPath), nil
	} else if !isRemotePathNotFound(statErr) {
		return normalizedPath, nil
	}

	candidate := remoteParentPath(normalizedPath)
	for candidate != normalizedPath {
		info, statErr := sftpClient.Stat(candidate)
		if statErr == nil && info != nil {
			if info.IsDir() {
				return candidate, nil
			}
			return remoteParentPath(candidate), nil
		}
		if !isRemotePathNotFound(statErr) {
			return candidate, nil
		}
		nextCandidate := remoteParentPath(candidate)
		if nextCandidate == candidate {
			break
		}
		candidate = nextCandidate
	}

	return "/", nil
}

func (m *SSHManager) ListDir(sessionId string, path string) ([]map[string]interface{}, error) {
	return m.ListDirContext(context.Background(), sessionId, path)
}

func (m *SSHManager) ListDirContext(ctx context.Context, sessionId string, path string) ([]map[string]interface{}, error) {
	if err := ensureContextActive(ctx); err != nil {
		return nil, err
	}
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return nil, err
	}

	files, err := sftpClient.ReadDir(path)
	if err != nil {
		return nil, err
	}
	if err := ensureContextActive(ctx); err != nil {
		return nil, err
	}

	var results []map[string]interface{}
	// 目录型符号链接目标解析任务: 先收集, 再并发补判. 密集符号链接目录(如 busybox/Alpine
	// 的 /bin /sbin, 可能数百个指向 busybox 的链接)若串行 Stat 会造成成倍往返延迟.
	type symlinkDirResolveTarget struct {
		index    int
		fullPath string
	}
	var pendingSymlinkTargets []symlinkDirResolveTarget
	for _, f := range files {
		if err := ensureContextActive(ctx); err != nil {
			return nil, err
		}
		permStr := f.Mode().String()
		modeNumeric := fmt.Sprintf("%o", f.Mode().Perm())

		uid := "-"
		gid := "-"
		if stat, ok := f.Sys().(interface{ GetUID() uint32 }); ok {
			uid = fmt.Sprintf("%d", stat.GetUID())
		}
		if stat, ok := f.Sys().(interface{ GetGID() uint32 }); ok {
			gid = fmt.Sprintf("%d", stat.GetGID())
		}

		isSymlink := f.Mode()&os.ModeSymlink != 0
		results = append(results, map[string]interface{}{
			"name":        f.Name(),
			"isDirectory": f.IsDir(),
			"isSymlink":   isSymlink,
			"size":        f.Size(),
			"modifyTime":  f.ModTime().Format(time.RFC3339),
			"permission":  permStr,
			"mode":        modeNumeric,
			"uid":         uid,
			"gid":         gid,
		})
		// 符号链接先入列表, isDirectory 暂用链接自身类型(恒为 false), 稍后并发跟随链接补判.
		// permission/mode 保留链接原值, 前端据此显示链接图标.
		if isSymlink && !f.IsDir() {
			pendingSymlinkTargets = append(pendingSymlinkTargets, symlinkDirResolveTarget{
				index:    len(results) - 1,
				fullPath: pathpkg.Join(path, f.Name()),
			})
		}
	}
	// 并发补判目录型符号链接: sftp.Client 支持并发调用, 用带上限的信号量控制并发度, 把 N 次
	// 串行往返压成 N/并发 批次. 每个 worker 只写各自 results[index] 这一个独立 map, 无共享
	// map 竞态. 目标是目录才改 isDirectory; broken/无权限链接 Stat 失败保持非目录. 纯 SFTP,
	// 不依赖 shell, 跨所有 Unix SSH 系统语义一致, 未来 SFTP-only 模式同样兼容.
	if len(pendingSymlinkTargets) > 0 {
		const maxConcurrentSymlinkResolves = 8
		concurrency := maxConcurrentSymlinkResolves
		if len(pendingSymlinkTargets) < concurrency {
			concurrency = len(pendingSymlinkTargets)
		}
		semaphore := make(chan struct{}, concurrency)
		var wg sync.WaitGroup
		for _, target := range pendingSymlinkTargets {
			if ensureContextActive(ctx) != nil {
				break
			}
			wg.Add(1)
			semaphore <- struct{}{}
			go func(resolveTarget symlinkDirResolveTarget) {
				defer wg.Done()
				defer func() { <-semaphore }()
				if info, statErr := sftpClient.Stat(resolveTarget.fullPath); statErr == nil && info != nil && info.IsDir() {
					results[resolveTarget.index]["isDirectory"] = true
				}
			}(target)
		}
		wg.Wait()
	}
	sort.Slice(results, func(i, j int) bool {
		iDir := results[i]["isDirectory"].(bool)
		jDir := results[j]["isDirectory"].(bool)
		if iDir != jDir {
			return iDir
		}
		return results[i]["name"].(string) < results[j]["name"].(string)
	})
	return results, nil
}

type OwnershipCandidateEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type OwnershipCandidates struct {
	Users  []OwnershipCandidateEntry `json:"users"`
	Groups []OwnershipCandidateEntry `json:"groups"`
}

type PathOwnershipInfo struct {
	UID        string `json:"uid"`
	GID        string `json:"gid"`
	Mode       string `json:"mode"`
	Permission string `json:"permission"`
}

func normalizeOwnershipCandidateEntries(entries []OwnershipCandidateEntry) []OwnershipCandidateEntry {
	seen := make(map[string]struct{}, len(entries))
	result := make([]OwnershipCandidateEntry, 0, len(entries))
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name)
		id := strings.TrimSpace(entry.ID)
		if name == "" || id == "" || id == "-" {
			continue
		}
		key := id + "\x00" + name
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, OwnershipCandidateEntry{
			ID:   id,
			Name: name,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		leftID, leftErr := strconv.Atoi(result[i].ID)
		rightID, rightErr := strconv.Atoi(result[j].ID)
		if leftErr == nil && rightErr == nil && leftID != rightID {
			return leftID < rightID
		}
		if result[i].Name != result[j].Name {
			return result[i].Name < result[j].Name
		}
		return result[i].ID < result[j].ID
	})
	return result
}

func (m *SSHManager) ListOwnershipCandidates(sessionId string) (OwnershipCandidates, error) {
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return OwnershipCandidates{}, err
	}
	out, err := m.executeCmdWithClient(client, `printf '__LUMIN_USERS__\n'; (getent passwd 2>/dev/null || cat /etc/passwd 2>/dev/null || true); printf '__LUMIN_GROUPS__\n'; (getent group 2>/dev/null || cat /etc/group 2>/dev/null || true)`)
	if err != nil {
		return OwnershipCandidates{}, err
	}
	result := OwnershipCandidates{}
	currentSection := ""
	for _, line := range strings.Split(out, "\n") {
		trimmed := strings.TrimSpace(line)
		switch trimmed {
		case "__LUMIN_USERS__":
			currentSection = "users"
			continue
		case "__LUMIN_GROUPS__":
			currentSection = "groups"
			continue
		}
		if trimmed == "" {
			continue
		}
		parts := strings.Split(trimmed, ":")
		if len(parts) < 3 {
			continue
		}
		entry := OwnershipCandidateEntry{
			ID:   strings.TrimSpace(parts[2]),
			Name: strings.TrimSpace(parts[0]),
		}
		switch currentSection {
		case "users":
			result.Users = append(result.Users, entry)
		case "groups":
			result.Groups = append(result.Groups, entry)
		}
	}
	result.Users = normalizeOwnershipCandidateEntries(result.Users)
	result.Groups = normalizeOwnershipCandidateEntries(result.Groups)
	return result, nil
}

func buildChownSpec(owner string, group string) string {
	trimmedOwner := strings.TrimSpace(owner)
	trimmedGroup := strings.TrimSpace(group)
	if trimmedOwner == "" && trimmedGroup == "" {
		return ""
	}
	if trimmedOwner == "" {
		return ":" + trimmedGroup
	}
	if trimmedGroup == "" {
		return trimmedOwner
	}
	return trimmedOwner + ":" + trimmedGroup
}

func hasPathOwnershipInfo(info PathOwnershipInfo) bool {
	return strings.TrimSpace(info.Permission) != "" || strings.TrimSpace(info.Mode) != "" || strings.TrimSpace(info.UID) != "" && strings.TrimSpace(info.UID) != "-" || strings.TrimSpace(info.GID) != "" && strings.TrimSpace(info.GID) != "-"
}

func mergePathOwnershipInfo(base PathOwnershipInfo, candidate PathOwnershipInfo) PathOwnershipInfo {
	if strings.TrimSpace(base.UID) == "" || strings.TrimSpace(base.UID) == "-" {
		base.UID = strings.TrimSpace(candidate.UID)
	}
	if strings.TrimSpace(base.GID) == "" || strings.TrimSpace(base.GID) == "-" {
		base.GID = strings.TrimSpace(candidate.GID)
	}
	if strings.TrimSpace(base.Mode) == "" {
		base.Mode = strings.TrimSpace(candidate.Mode)
	}
	if strings.TrimSpace(base.Permission) == "" {
		base.Permission = strings.TrimSpace(candidate.Permission)
	}
	return base
}

func (m *SSHManager) GetPathOwnership(sessionId string, path string) (PathOwnershipInfo, error) {
	info := PathOwnershipInfo{
		UID: "-",
		GID: "-",
	}
	sftpClient, sftpErr := m.GetSFTPClient(sessionId)
	if sftpErr == nil && sftpClient != nil {
		if fileInfo, statErr := sftpClient.Stat(path); statErr == nil && fileInfo != nil {
			info.Permission = fileInfo.Mode().String()
			info.Mode = fmt.Sprintf("%o", fileInfo.Mode().Perm())
			if stat, ok := fileInfo.Sys().(interface{ GetUID() uint32 }); ok {
				info.UID = fmt.Sprintf("%d", stat.GetUID())
			}
			if stat, ok := fileInfo.Sys().(interface{ GetGID() uint32 }); ok {
				info.GID = fmt.Sprintf("%d", stat.GetGID())
			}
			if info.Permission != "" && info.Mode != "" && info.UID != "-" && info.GID != "-" {
				return info, nil
			}
		}
	}

	client, _, clientErr := m.GetClientEntry(sessionId)
	if clientErr != nil {
		if hasPathOwnershipInfo(info) {
			return info, nil
		}
		if sftpErr != nil {
			return info, sftpErr
		}
		return info, clientErr
	}

	out, err := m.executeCmdWithClient(client, "stat -Lc '%u\t%g\t%a\t%A' -- "+shellQuotePath(path)+" 2>/dev/null || stat -f '%u\t%g\t%Lp\t%Sp' -- "+shellQuotePath(path)+" 2>/dev/null")
	if err != nil {
		if hasPathOwnershipInfo(info) {
			return info, nil
		}
		return info, err
	}

	fields := strings.SplitN(strings.TrimSpace(out), "\t", 4)
	if len(fields) == 4 {
		info = mergePathOwnershipInfo(info, PathOwnershipInfo{
			UID:        fields[0],
			GID:        fields[1],
			Mode:       fields[2],
			Permission: fields[3],
		})
	}
	return info, nil
}

func (m *SSHManager) ChownFile(sessionId string, path string, owner string, group string, recursive bool) error {
	spec := buildChownSpec(owner, group)
	if spec == "" {
		return nil
	}
	prefix := ""
	if recursive {
		prefix = "-R "
	}
	return m.execRemoteCmdLong(context.Background(), sessionId, fmt.Sprintf("chown %s-- %s %s", prefix, shellQuotePath(spec), shellQuotePath(path)))
}

func (m *SSHManager) ChmodFile(sessionId string, path string, modeStr string, recursive bool) error {
	modeValue := strings.TrimSpace(modeStr)
	modeInt, err := strconv.ParseInt(modeValue, 8, 32)
	if err != nil {
		return fmt.Errorf("invalid mode: %w", err)
	}
	if !recursive {
		sftpClient, err := m.GetSFTPClient(sessionId)
		if err != nil {
			return err
		}
		return sftpClient.Chmod(path, os.FileMode(modeInt))
	}
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	_, err = m.executeCmdWithClient(client, "chmod -R "+modeValue+" -- "+shellQuotePath(path))
	return err
}

func (m *SSHManager) ReadFile(sessionId string, path string) (string, error) {
	return m.ReadFileContext(context.Background(), sessionId, path)
}

func (m *SSHManager) ReadFileContext(ctx context.Context, sessionId string, path string) (string, error) {
	if err := ensureContextActive(ctx); err != nil {
		return "", err
	}
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return "", err
	}

	f, err := sftpClient.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return "", err
	}

	const maxFileSize = 50 * 1024 * 1024
	if stat.Size() > maxFileSize {
		return "", fmt.Errorf("文件过大 (%.1f MB)，请使用终端命令查看", float64(stat.Size())/(1024*1024))
	}

	var b bytes.Buffer
	b.Grow(int(stat.Size()))
	buf := make([]byte, 32768)
	for {
		if err := ensureContextActive(ctx); err != nil {
			return "", err
		}
		n, readErr := f.Read(buf)
		if n > 0 {
			b.Write(buf[:n])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	return b.String(), nil
}

// ReadFileBytes reads a file's raw bytes via SFTP without any string/encoding
// conversion. Use this when the caller needs the original bytes (e.g. writing
// to a local temp file for an external editor, so the editor can do its own
// encoding detection instead of getting UTF-8-mangled bytes from b.String()).
func (m *SSHManager) ReadFileBytes(sessionId string, path string) ([]byte, error) {
	return m.ReadFileBytesContext(context.Background(), sessionId, path)
}

func (m *SSHManager) ReadFileBytesContext(ctx context.Context, sessionId string, path string) ([]byte, error) {
	if err := ensureContextActive(ctx); err != nil {
		return nil, err
	}
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return nil, err
	}

	f, err := sftpClient.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return nil, err
	}

	const maxFileSize = 50 * 1024 * 1024
	if stat.Size() > maxFileSize {
		return nil, fmt.Errorf("文件过大 (%.1f MB)，请使用终端命令查看", float64(stat.Size())/(1024*1024))
	}

	var b bytes.Buffer
	b.Grow(int(stat.Size()))
	buf := make([]byte, 32768)
	for {
		if err := ensureContextActive(ctx); err != nil {
			return nil, err
		}
		n, readErr := f.Read(buf)
		if n > 0 {
			b.Write(buf[:n])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, readErr
		}
	}
	return b.Bytes(), nil
}

func (m *SSHManager) WriteFile(sessionId string, path string, content string) error {
	return m.WriteFileContext(context.Background(), sessionId, path, content)
}

func (m *SSHManager) WriteFileContext(ctx context.Context, sessionId string, path string, content string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}
	var originalMode os.FileMode
	hasOriginalMode := false
	if info, statErr := sftpClient.Stat(path); statErr == nil {
		originalMode = info.Mode().Perm()
		hasOriginalMode = true
	}
	token := newCommandExecutionToken()
	tempPath := path + ".lumin_tmp_" + token
	f, err := sftpClient.Create(tempPath)
	if err != nil {
		return err
	}
	if writeErr := writeStringChunksWithContext(ctx, f, content); writeErr != nil {
		f.Close()
		_ = sftpClient.Remove(tempPath)
		return writeErr
	}
	if err := f.Close(); err != nil {
		_ = sftpClient.Remove(tempPath)
		return err
	}
	if err := ensureContextActive(ctx); err != nil {
		_ = sftpClient.Remove(tempPath)
		return err
	}
	if hasOriginalMode {
		if chmodErr := sftpClient.Chmod(tempPath, originalMode); chmodErr != nil {
			_ = sftpClient.Remove(tempPath)
			return chmodErr
		}
	}
	if err := sftpClient.PosixRename(tempPath, path); err != nil {
		_ = sftpClient.Remove(tempPath)
		return fmt.Errorf("replace failed: %w", err)
	}
	if hasOriginalMode {
		_ = sftpClient.Chmod(path, originalMode)
	}
	return nil
}

// isDangerousPath 检查是否为危险路径（根目录、家目录等），防止误删
func isDangerousPath(path string) bool {
	return path == "" || path == "/" || path == "/*" || path == "~" || path == "~/*"
}

// shellQuotePath 用单引号包裹路径并转义内部单引号，用于安全构造 shell 命令
func shellQuotePath(path string) string {
	return "'" + strings.ReplaceAll(path, "'", "'\\''") + "'"
}

// rmRfCmd 构造 rm -rf 删除命令
func rmRfCmd(path string) string {
	return "rm -rf " + shellQuotePath(path)
}

// remoteCmdLongTimeout 是文件复制/移动这类可能很耗时操作（大文件 cp/mv）的超时上限。
// executeCmdWithClientContext 固定 30 秒，对大文件 cp 会过早超时，故这里使用更长上限。
const remoteCmdLongTimeout = 30 * time.Minute

const (
	smartUncompressConflictStrategyOverwrite  = "overwrite"
	smartUncompressConflictStrategyAutoRename = "auto_rename"
	smartUncompressConflictStrategyPrompt     = "prompt"
	smartUncompressModeDirect                 = "direct"
	smartUncompressModeFolder                 = "folder"
)

type smartUncompressPlan struct {
	Mode         string
	Reason       string
	TargetName   string
	TargetPath   string
	TargetKind   string
	TargetExists bool
}

func normalizeSmartUncompressConflictStrategy(value string) string {
	switch strings.TrimSpace(value) {
	case smartUncompressConflictStrategyOverwrite:
		return smartUncompressConflictStrategyOverwrite
	case smartUncompressConflictStrategyPrompt:
		return smartUncompressConflictStrategyPrompt
	default:
		return smartUncompressConflictStrategyAutoRename
	}
}

func smartUncompressTargetBaseName(base string) string {
	lowerBase := strings.ToLower(base)
	switch {
	case strings.HasSuffix(lowerBase, ".tar.gz"):
		return base[:len(base)-len(".tar.gz")]
	case strings.HasSuffix(lowerBase, ".tar.bz2"):
		return base[:len(base)-len(".tar.bz2")]
	case strings.HasSuffix(lowerBase, ".tgz"):
		return base[:len(base)-len(".tgz")]
	case strings.HasSuffix(lowerBase, ".tbz2"):
		return base[:len(base)-len(".tbz2")]
	case strings.HasSuffix(lowerBase, ".zip"):
		return base[:len(base)-len(".zip")]
	case strings.HasSuffix(lowerBase, ".tar"):
		return base[:len(base)-len(".tar")]
	case strings.HasSuffix(lowerBase, ".gz"):
		return base[:len(base)-len(".gz")]
	default:
		return base
	}
}

func buildSmartUncompressListCommand(dir string, base string) (string, error) {
	safeDir := shellQuotePath(dir)
	safeBase := shellQuotePath(base)
	lowerBase := strings.ToLower(base)
	switch {
	case strings.HasSuffix(lowerBase, ".zip"):
		return fmt.Sprintf("cd %s && unzip -Z1 %s", safeDir, safeBase), nil
	case strings.HasSuffix(lowerBase, ".tar.gz") || strings.HasSuffix(lowerBase, ".tgz"):
		return fmt.Sprintf("cd %s && tar -tzf %s", safeDir, safeBase), nil
	case strings.HasSuffix(lowerBase, ".tar"):
		return fmt.Sprintf("cd %s && tar -tf %s", safeDir, safeBase), nil
	case strings.HasSuffix(lowerBase, ".tar.bz2") || strings.HasSuffix(lowerBase, ".tbz2"):
		return fmt.Sprintf("cd %s && tar -tjf %s", safeDir, safeBase), nil
	case strings.HasSuffix(lowerBase, ".gz"):
		return "", nil
	default:
		return "", fmt.Errorf("unsupported archive format")
	}
}

func parseSmartUncompressArchiveMembers(output string) []string {
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	result := make([]string, 0, len(lines))
	seen := make(map[string]struct{}, len(lines))
	for _, line := range lines {
		member := strings.TrimSpace(strings.ReplaceAll(line, "\\", "/"))
		for strings.HasPrefix(member, "./") {
			member = strings.TrimPrefix(member, "./")
		}
		member = strings.TrimLeft(member, "/")
		if member == "" {
			continue
		}
		if _, ok := seen[member]; ok {
			continue
		}
		seen[member] = struct{}{}
		result = append(result, member)
	}
	return result
}

func buildSmartUncompressPlan(remoteDir string, base string, members []string, sftpClient *sftp.Client) smartUncompressPlan {
	normalizedMembers := members
	if len(normalizedMembers) == 0 {
		normalizedMembers = []string{smartUncompressTargetBaseName(base)}
	}
	if len(normalizedMembers) == 1 && !strings.HasSuffix(normalizedMembers[0], "/") {
		return smartUncompressPlan{
			Mode:   smartUncompressModeDirect,
			Reason: "single_file",
		}
	}
	topLevelName := ""
	allInSingleTopLevelDir := true
	sawEntry := false
	for _, member := range normalizedMembers {
		normalizedMember := strings.TrimSpace(member)
		if normalizedMember == "" {
			continue
		}
		sawEntry = true
		normalizedMember = strings.TrimSuffix(normalizedMember, "/")
		if normalizedMember == "" {
			continue
		}
		topLevelPart := strings.SplitN(normalizedMember, "/", 2)[0]
		if topLevelPart == "" {
			allInSingleTopLevelDir = false
			break
		}
		if topLevelName == "" {
			topLevelName = topLevelPart
			continue
		}
		if topLevelName != topLevelPart {
			allInSingleTopLevelDir = false
			break
		}
	}
	if sawEntry && allInSingleTopLevelDir && topLevelName != "" {
		return smartUncompressPlan{
			Mode:   smartUncompressModeDirect,
			Reason: "single_root_dir",
		}
	}
	targetName := strings.TrimSpace(smartUncompressTargetBaseName(base))
	if targetName == "" {
		targetName = strings.TrimSpace(base)
	}
	targetPath := pathpkg.Join(remoteDir, targetName)
	plan := smartUncompressPlan{
		Mode:       smartUncompressModeFolder,
		Reason:     "archive_name_folder",
		TargetName: targetName,
		TargetPath: targetPath,
		TargetKind: "directory",
	}
	if sftpClient != nil {
		if info, err := sftpClient.Stat(targetPath); err == nil && info != nil {
			plan.TargetExists = true
			if !info.IsDir() {
				plan.TargetKind = "file"
			}
		}
	}
	return plan
}

func resolveSmartUncompressUniqueTargetPath(sftpClient *sftp.Client, remoteDir string, targetName string) (string, string, error) {
	if sftpClient == nil {
		return "", "", fmt.Errorf("SFTP not available")
	}
	if strings.TrimSpace(targetName) == "" {
		return "", "", fmt.Errorf("missing target name")
	}
	for index := 2; index < 10000; index++ {
		candidateName := fmt.Sprintf("%s (%d)", targetName, index)
		candidatePath := pathpkg.Join(remoteDir, candidateName)
		if _, err := sftpClient.Stat(candidatePath); err != nil {
			if isRemotePathNotFound(err) {
				return candidateName, candidatePath, nil
			}
			return "", "", err
		}
	}
	return "", "", fmt.Errorf("unable to find available smart extract target")
}

// execRemoteCmdLong 在 sessionId 对应服务器上执行命令，使用长超时，
// 适用于 cp/mv 等可能耗时较久的文件操作。返回命令的退出错误。
func (m *SSHManager) execRemoteCmdLong(ctx context.Context, sessionId string, cmd string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	_, err = runCommandWithSessionContext(ctx, session, cmd, remoteCmdLongTimeout)
	return err
}

func (m *SSHManager) DeleteItem(sessionId string, path string, isDir bool) error {
	return m.DeleteItemContext(context.Background(), sessionId, path, isDir)
}

func (m *SSHManager) DeleteItemContext(ctx context.Context, sessionId string, path string, isDir bool) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	if isDangerousPath(path) {
		return fmt.Errorf("refusing to delete dangerous path: %q", path)
	}
	client, sftpClient, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	if isDir {
		if sftpClient != nil {
			if err := sftpClient.RemoveAll(path); err == nil {
				return ensureContextActive(ctx)
			}
		}
		_, err := m.ExecuteCmdWithClientContext(ctx, client, rmRfCmd(path))
		return err
	}
	if sftpClient == nil {
		sftpClient, err = m.GetSFTPClient(sessionId)
		if err != nil {
			return err
		}
	}
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	return sftpClient.Remove(path)
}

// DeleteItemShell 用 rm -rf 删除
func (m *SSHManager) DeleteItemShell(sessionId string, path string) error {
	return m.DeleteItemShellContext(context.Background(), sessionId, path)
}

func (m *SSHManager) DeleteItemShellContext(ctx context.Context, sessionId string, path string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	if isDangerousPath(path) {
		return fmt.Errorf("refusing to delete dangerous path: %q", path)
	}
	// Local sessions (WSL/PowerShell) have an embedded SFTP-only server with no
	// shell channel, so the rm -rf command below would fail. Delete via SFTP
	// (RemoveAll handles both files and directories) instead.
	m.mu.RLock()
	sd, hasSd := m.sessions[sessionId]
	m.mu.RUnlock()
	if hasSd && sd.IsLocal {
		sftpClient, err := m.GetSFTPClient(sessionId)
		if err != nil {
			return err
		}
		return sftpClient.RemoveAll(path)
	}
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	_, err = m.ExecuteCmdWithClientContext(ctx, client, rmRfCmd(path))
	return err
}

func batchRmRfCmd(paths []string) string {
	parts := make([]string, 0, len(paths)+2)
	parts = append(parts, "rm", "-rf")
	for _, p := range paths {
		parts = append(parts, shellQuotePath(p))
	}
	return strings.Join(parts, " ")
}

func (m *SSHManager) BatchDeleteItemShell(sessionId string, paths []string) error {
	return m.BatchDeleteItemShellContext(context.Background(), sessionId, paths)
}

func (m *SSHManager) BatchDeleteItemShellContext(ctx context.Context, sessionId string, paths []string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	safePaths := make([]string, 0, len(paths))
	for _, p := range paths {
		if !isDangerousPath(p) {
			safePaths = append(safePaths, p)
		}
	}
	if len(safePaths) == 0 {
		return nil
	}
	// Local sessions (WSL/PowerShell) have an embedded SFTP-only server with no
	// shell channel; delete each path via SFTP RemoveAll instead of rm -rf.
	m.mu.RLock()
	sd, hasSd := m.sessions[sessionId]
	m.mu.RUnlock()
	if hasSd && sd.IsLocal {
		sftpClient, err := m.GetSFTPClient(sessionId)
		if err != nil {
			return err
		}
		var firstErr error
		for _, p := range safePaths {
			if err := sftpClient.RemoveAll(p); err != nil && firstErr == nil {
				firstErr = err
			}
		}
		return firstErr
	}
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	_, err = m.ExecuteCmdWithClientContext(ctx, client, batchRmRfCmd(safePaths))
	return err
}

func (m *SSHManager) Mkdir(sessionId string, path string) error {
	return m.MkdirContext(context.Background(), sessionId, path)
}

func (m *SSHManager) MkdirContext(ctx context.Context, sessionId string, path string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}
	return sftpClient.MkdirAll(path)
}

func (m *SSHManager) RenameItem(sessionId string, oldPath string, newPath string) error {
	return m.RenameItemContext(context.Background(), sessionId, oldPath, newPath)
}

func (m *SSHManager) RenameItemContext(ctx context.Context, sessionId string, oldPath string, newPath string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}
	return sftpClient.Rename(oldPath, newPath)
}

func (m *SSHManager) BeginChunkedUploadTask(sessionId string, remoteDir string, maxClients int) (string, error) {
	return m.transferService.BeginChunkedUploadTask(sessionId, remoteDir, maxClients)
}

func (m *SSHManager) BeginChunkedUploadFile(taskID string, relativePath string, size int64, totalChunks int) (string, error) {
	return m.transferService.BeginChunkedUploadFile(taskID, relativePath, size, totalChunks)
}

func (m *SSHManager) UploadChunkBase64(taskID string, fileID string, chunkIndex int, offset int64, base64Content string) error {
	return m.transferService.UploadChunkBase64(taskID, fileID, chunkIndex, offset, base64Content)
}

func (m *SSHManager) CompleteChunkedUploadFile(taskID string, fileID string) error {
	return m.transferService.CompleteChunkedUploadFile(taskID, fileID)
}

func (m *SSHManager) AbortChunkedUploadFile(taskID string, fileID string) error {
	return m.transferService.AbortChunkedUploadFile(taskID, fileID)
}

func (m *SSHManager) FinishChunkedUploadTask(taskID string) error {
	return m.transferService.FinishChunkedUploadTask(taskID)
}

func (m *SSHManager) AbortChunkedUploadTask(taskID string) error {
	return m.transferService.AbortChunkedUploadTask(taskID)
}

func (m *SSHManager) DownloadFileToLocal(sessionId string, downloadID string, remotePath string, localPath string, optionsJSON string) error {
	return m.transferService.DownloadFileToLocal(sessionId, downloadID, remotePath, localPath, optionsJSON)
}

func (m *SSHManager) DownloadDirectoryToLocal(sessionId string, downloadID string, remotePath string, localRoot string, optionsJSON string) error {
	return m.transferService.DownloadDirectoryToLocal(sessionId, downloadID, remotePath, localRoot, optionsJSON)
}

func (m *SSHManager) DownloadDirectoryCompressed(sessionId string, downloadID string, remotePath string, localRoot string, optionsJSON string) error {
	return m.transferService.DownloadDirectoryCompressed(sessionId, downloadID, remotePath, localRoot, optionsJSON)
}

func (m *SSHManager) AbortDownloadTransfer(identifier string) error {
	return m.transferService.AbortDownloadTransfer(identifier)
}

func (m *SSHManager) UploadLocalPathsCompressed(sessionId string, uploadID string, maxConcurrent int, localPaths []string, remoteDir string) error {
	return m.transferService.UploadLocalPathsCompressed(sessionId, uploadID, maxConcurrent, localPaths, remoteDir)
}

func (m *SSHManager) AutoRepairCompressedUploadTargets(sessionId string, localPaths []string, remoteDir string) error {
	return m.transferService.AutoRepairCompressedUploadTargets(sessionId, localPaths, remoteDir)
}

func (m *SSHManager) AbortCompressedUpload(identifier string) error {
	return m.transferService.AbortCompressedUpload(identifier)
}

func (m *SSHManager) TransferFileContext(ctx context.Context, sessionID string, request mcpserver.TransferFileRequest) (mcpserver.TransferTaskSnapshot, error) {
	return m.transferService.TransferFileContext(ctx, sessionID, request)
}

func (m *SSHManager) ListTransfersContext(ctx context.Context, sessionID string) ([]mcpserver.TransferTaskSnapshot, error) {
	return m.transferService.ListTransfersContext(ctx, sessionID)
}

func (m *SSHManager) PreviewDownloadConflicts(sessionId string, remotePath string, localPath string, isDirectory bool) ([]map[string]interface{}, error) {
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return nil, err
	}
	return transfer.PreviewDownloadConflicts(sftpClient, remotePath, localPath, isDirectory)
}

func (m *SSHManager) CopyItem(sessionId string, srcPath string, dstPath string) error {
	return m.CopyItemContext(context.Background(), sessionId, srcPath, dstPath)
}

// CopyItemContext 在同一台服务器内复制文件或目录。
// 优先走 shell：直接在服务器执行 cp -a，数据只在远端本地磁盘流动，不走网络，
// 远快于 SFTP 逐块读写。-a 保留权限/属主/时间戳，递归复制目录，并保留符号链接（不跟随）。
// 无 shell 会话时（未来纯 SFTP 连接）进入 SFTP 预留分支：SFTP 无原生递归复制，当前版本尚未实现，返回错误占位。
func (m *SSHManager) CopyItemContext(ctx context.Context, sessionId string, srcPath string, dstPath string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	if isDangerousPath(srcPath) || isDangerousPath(dstPath) {
		return fmt.Errorf("refusing to copy dangerous path")
	}
	// Local sessions (WSL/PowerShell) have an embedded SFTP-only server with no
	// shell channel, so cp -a would fail. Copy via SFTP instead.
	m.mu.RLock()
	sd, hasSd := m.sessions[sessionId]
	m.mu.RUnlock()
	if hasSd && sd.IsLocal {
		sftpClient, err := m.GetSFTPClient(sessionId)
		if err != nil {
			return err
		}
		return transfer.CopyViaSFTP(sftpClient, srcPath, dstPath)
	}
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	if client != nil {
		return m.execRemoteCmdLong(ctx, sessionId, fmt.Sprintf("cp -a %s %s", shellQuotePath(srcPath), shellQuotePath(dstPath)))
	}
	return fmt.Errorf("当前连接暂不支持复制操作(无可用 shell 会话)")
}

func (m *SSHManager) MoveItem(sessionId string, srcPath string, dstPath string) error {
	return m.MoveItemContext(context.Background(), sessionId, srcPath, dstPath)
}

// MoveItemContext 在同一台服务器内移动文件或目录。
// 优先走 shell：直接在服务器执行 mv，同文件系统上仅改 inode 引用（瞬时），跨文件系统时
// 由 mv 自动完成 cp + rm，数据只在远端本地流动。
// 无 shell 会话时（未来纯 SFTP 连接）进入 SFTP 预留分支：可用 sftpClient.Rename 兜底同文件系统移动，当前版本尚未实现，返回错误占位。
func (m *SSHManager) MoveItemContext(ctx context.Context, sessionId string, srcPath string, dstPath string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	if isDangerousPath(srcPath) || isDangerousPath(dstPath) {
		return fmt.Errorf("refusing to move dangerous path")
	}
	// Local sessions (WSL/PowerShell) have an embedded SFTP-only server with no
	// shell channel, so mv would fail. Move via SFTP Rename instead.
	m.mu.RLock()
	sd, hasSd := m.sessions[sessionId]
	m.mu.RUnlock()
	if hasSd && sd.IsLocal {
		sftpClient, err := m.GetSFTPClient(sessionId)
		if err != nil {
			return err
		}
		// Prefer PosixRename (atomic); fall back to Rename if unsupported.
		if err := sftpClient.PosixRename(srcPath, dstPath); err != nil {
			return sftpClient.Rename(srcPath, dstPath)
		}
		return nil
	}
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	if client != nil {
		return m.execRemoteCmdLong(ctx, sessionId, fmt.Sprintf("mv %s %s", shellQuotePath(srcPath), shellQuotePath(dstPath)))
	}
	return fmt.Errorf("当前连接暂不支持移动操作(无可用 shell 会话)")
}

// progressReader wraps an io.Reader and emits progress events via Wails.
type progressReader struct {
	io.Reader
	ctx       context.Context
	eventName string
	total     int64
	current   int64
	lastEmit  time.Time
}

func (p *progressReader) Read(data []byte) (int, error) {
	n, err := p.Reader.Read(data)
	if n > 0 {
		p.advance(int64(n))
	}
	return n, err
}

func (p *progressReader) advance(delta int64) {
	p.current += delta
	now := time.Now()
	if now.Sub(p.lastEmit) > 200*time.Millisecond || p.current >= p.total {
		p.emit(p.current)
		p.lastEmit = now
	}
}

func (p *progressReader) emit(current int64) {
	pct := float64(0)
	if p.total > 0 {
		pct = float64(current) / float64(p.total) * 100
		if pct > 100 {
			pct = 100
		}
	}
	if p.ctx != nil {
		runtime.EventsEmit(p.ctx, p.eventName, pct)
	}
}

// progressWriter 只累加原子计数，不在 Write 内触发 Wails 事件。
// 传输数据流水线（尤其 sftp 的 File.WriteTo 串行 Reduce 阶段）以此 Write 为唯一出口，
// 在其中做同步 IPC 会冻结整条流水线。
type progressWriter struct {
	io.Writer
	copied atomic.Int64
}

func (p *progressWriter) Write(data []byte) (int, error) {
	n, err := p.Writer.Write(data)
	if n > 0 {
		p.copied.Add(int64(n))
	}
	return n, err
}

// copyWithProgress 复制数据并通过 Wails 事件报告进度
func (m *SSHManager) copyWithProgress(dst io.Writer, src io.Reader, sessionId string, totalSize int64) error {
	tracker := &progressReader{
		ctx:       m.ctx,
		eventName: "transfer-progress-" + sessionId,
		total:     totalSize,
		lastEmit:  time.Now(),
	}
	writer := &progressWriter{Writer: dst}
	reporterDone := make(chan struct{})
	reporterFinished := make(chan struct{})
	go func() {
		defer close(reporterFinished)
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		lastReported := int64(-1)
		for {
			select {
			case <-reporterDone:
				return
			case <-ticker.C:
				current := writer.copied.Load()
				if current == lastReported {
					continue
				}
				lastReported = current
				tracker.emit(current)
			}
		}
	}()
	_, err := io.Copy(writer, src)
	close(reporterDone)
	<-reporterFinished
	tracker.emit(writer.copied.Load())
	return err
}

func (m *SSHManager) UploadFile(sessionId string, localPath string, remotePath string) error {
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}

	src, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer src.Close()

	destPath := filepath.ToSlash(filepath.Join(remotePath, filepath.Base(localPath)))
	dst, err := sftpClient.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	var totalSize int64
	if stat, err := src.Stat(); err == nil {
		totalSize = stat.Size()
	}
	return m.copyWithProgress(dst, src, sessionId, totalSize)
}

// UploadDir recursively uploads a local directory to a remote path
func (m *SSHManager) UploadDir(sessionId string, localDir string, remoteDir string) error {
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}

	remoteDir = filepath.ToSlash(remoteDir)

	return filepath.Walk(localDir, func(localPath string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(localDir, localPath)
		if err != nil {
			return err
		}

		remotePath := filepath.ToSlash(filepath.Join(remoteDir, relPath))

		if info.IsDir() {
			return sftpClient.MkdirAll(remotePath)
		}

		src, err := os.Open(localPath)
		if err != nil {
			return err
		}

		dst, err := sftpClient.Create(remotePath)
		if err != nil {
			src.Close()
			return err
		}

		var totalSize int64
		if stat, err := src.Stat(); err == nil {
			totalSize = stat.Size()
		}

		copyErr := m.copyWithProgress(dst, src, sessionId, totalSize)
		closeSrcErr := src.Close()
		closeDstErr := dst.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeSrcErr != nil {
			return closeSrcErr
		}
		return closeDstErr
	})
}

// UploadFileContent uploads file content from memory to a remote path
func (m *SSHManager) UploadFileContent(sessionId string, fileName string, remoteDir string, content []byte) error {
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}

	destPath := filepath.ToSlash(filepath.Join(remoteDir, fileName))
	dst, err := sftpClient.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = dst.Write(content)
	return err
}

// UploadFileContentBase64 通过 base64 编码上传文件内容，避免前端将 Uint8Array
// 展开为普通 Array 导致的内存爆炸（8-16 倍开销）。base64 仅 1.33 倍开销。
func (m *SSHManager) UploadFileContentBase64(sessionId string, fileName string, remoteDir string, base64Content string) error {
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}

	content, err := base64.StdEncoding.DecodeString(base64Content)
	if err != nil {
		return fmt.Errorf("base64 解码失败: %w", err)
	}

	destPath := filepath.ToSlash(filepath.Join(remoteDir, fileName))
	dst, err := sftpClient.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	return m.copyWithProgress(dst, bytes.NewReader(content), sessionId, int64(len(content)))
}

func (m *SSHManager) DownloadFile(sessionId string, remotePath string, localPath string) error {
	sftpClient, err := m.GetSFTPClient(sessionId)
	if err != nil {
		return err
	}

	src, err := sftpClient.Open(remotePath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	var totalSize int64
	if stat, err := src.Stat(); err == nil {
		totalSize = stat.Size()
	}
	return m.copyWithProgress(dst, src, sessionId, totalSize)
}

func (m *SSHManager) CompressItem(sessionId string, remotePath string) error {
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}

	dir := filepath.Dir(remotePath)
	base := filepath.Base(remotePath)
	archiveName := base + ".tar.gz"

	dir = strings.ReplaceAll(dir, "\\", "/")
	cmd := fmt.Sprintf("cd %s && tar -czf %s %s", shellQuotePath(dir), shellQuotePath(archiveName), shellQuotePath(base))

	out, err := m.executeCmdWithClient(client, cmd)
	if err != nil {
		return fmt.Errorf("compress failed: %w, output: %s", err, out)
	}
	return nil
}

func (m *SSHManager) previewSmartUncompressItem(client *ssh.Client, sftpClient *sftp.Client, remotePath string) (smartUncompressPlan, string, string, error) {
	if client == nil {
		return smartUncompressPlan{}, "", "", fmt.Errorf("client not found")
	}
	remoteDir := strings.ReplaceAll(filepath.Dir(remotePath), "\\", "/")
	base := filepath.Base(remotePath)
	listCmd, err := buildSmartUncompressListCommand(remoteDir, base)
	if err != nil {
		return smartUncompressPlan{}, "", "", err
	}
	members := []string{smartUncompressTargetBaseName(base)}
	if listCmd != "" {
		out, runErr := m.executeCmdWithClient(client, listCmd)
		if runErr != nil {
			return smartUncompressPlan{}, "", "", fmt.Errorf("list archive members failed: %w, output: %s", runErr, out)
		}
		members = parseSmartUncompressArchiveMembers(out)
	}
	return buildSmartUncompressPlan(remoteDir, base, members, sftpClient), remoteDir, base, nil
}

func (m *SSHManager) PreviewSmartUncompressItem(sessionId string, remotePath string) (map[string]interface{}, error) {
	client, sftpClient, err := m.GetClientEntry(sessionId)
	if err != nil {
		return nil, err
	}
	if sftpClient == nil {
		sftpClient, err = m.GetSFTPClient(sessionId)
		if err != nil {
			return nil, err
		}
	}
	plan, _, _, err := m.previewSmartUncompressItem(client, sftpClient, remotePath)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"mode":         plan.Mode,
		"reason":       plan.Reason,
		"targetName":   plan.TargetName,
		"targetPath":   plan.TargetPath,
		"targetKind":   plan.TargetKind,
		"targetExists": plan.TargetExists,
	}, nil
}

func (m *SSHManager) UncompressItem(sessionId string, remotePath string) error {
	return m.UncompressItemWithStrategy(sessionId, remotePath, smartUncompressConflictStrategyAutoRename)
}

func (m *SSHManager) InstallUnzip(sessionId string) error {
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	cmd := `if command -v unzip >/dev/null 2>&1; then exit 0; fi
if [ "$(id -u)" -eq 0 ]; then SUDO="";
elif command -v sudo >/dev/null 2>&1; then SUDO="sudo -n";
else echo "root privileges or passwordless sudo are required" >&2; exit 1;
fi
if command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive $SUDO apt-get update && DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y unzip
elif command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y unzip
elif command -v yum >/dev/null 2>&1; then $SUDO yum install -y unzip
elif command -v apk >/dev/null 2>&1; then $SUDO apk add unzip
elif command -v zypper >/dev/null 2>&1; then $SUDO zypper --non-interactive install unzip
elif command -v pacman >/dev/null 2>&1; then $SUDO pacman -Sy --noconfirm unzip
else echo "no supported package manager found" >&2; exit 1
fi
command -v unzip >/dev/null 2>&1`
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	out, err := runCommandWithSessionContext(context.Background(), session, cmd, 5*time.Minute)
	if err != nil {
		return fmt.Errorf("install unzip failed: %w, output: %s", err, out)
	}
	return nil
}

func (m *SSHManager) UncompressUploadedArchive(sessionId string, remotePath string) error {
	client, _, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}

	remotePath = strings.TrimSpace(remotePath)
	if remotePath == "" {
		return fmt.Errorf("missing remote path")
	}
	remoteDir := pathpkg.Dir(remotePath)
	base := pathpkg.Base(remotePath)
	safeDir := shellQuotePath(remoteDir)
	safeBase := shellQuotePath(base)

	var cmd string
	lowerBase := strings.ToLower(base)
	switch {
	case strings.HasSuffix(lowerBase, ".zip"):
		cmd = fmt.Sprintf("cd %s && unzip -o %s", safeDir, safeBase)
	case strings.HasSuffix(lowerBase, ".tar.gz") || strings.HasSuffix(lowerBase, ".tgz"):
		cmd = fmt.Sprintf("cd %s && tar -xzf %s", safeDir, safeBase)
	case strings.HasSuffix(lowerBase, ".tar"):
		cmd = fmt.Sprintf("cd %s && tar -xf %s", safeDir, safeBase)
	case strings.HasSuffix(lowerBase, ".tar.bz2") || strings.HasSuffix(lowerBase, ".tbz2"):
		cmd = fmt.Sprintf("cd %s && tar -xjf %s", safeDir, safeBase)
	case strings.HasSuffix(lowerBase, ".gz"):
		cmd = fmt.Sprintf("cd %s && gunzip -f -k %s", safeDir, safeBase)
	default:
		return fmt.Errorf("unsupported archive format")
	}

	out, err := m.executeCmdWithClient(client, cmd)
	if err != nil {
		return fmt.Errorf("uncompress uploaded archive failed: %w, output: %s", err, out)
	}
	return nil
}

func (m *SSHManager) UncompressItemWithStrategy(sessionId string, remotePath string, conflictStrategy string) error {
	client, sftpClient, err := m.GetClientEntry(sessionId)
	if err != nil {
		return err
	}
	if sftpClient == nil {
		sftpClient, err = m.GetSFTPClient(sessionId)
		if err != nil {
			return err
		}
	}

	plan, remoteDir, base, err := m.previewSmartUncompressItem(client, sftpClient, remotePath)
	if err != nil {
		return err
	}

	effectiveStrategy := normalizeSmartUncompressConflictStrategy(conflictStrategy)
	targetPath := plan.TargetPath
	if plan.Mode == smartUncompressModeFolder {
		if plan.TargetExists {
			switch effectiveStrategy {
			case smartUncompressConflictStrategyOverwrite:
				if plan.TargetKind != "directory" {
					return fmt.Errorf("smart uncompress target exists and is not a directory")
				}
			case smartUncompressConflictStrategyAutoRename:
				_, nextTargetPath, renameErr := resolveSmartUncompressUniqueTargetPath(sftpClient, remoteDir, plan.TargetName)
				if renameErr != nil {
					return renameErr
				}
				targetPath = nextTargetPath
			default:
				return fmt.Errorf("smart uncompress target exists")
			}
		}
		if err := sftpClient.MkdirAll(targetPath); err != nil {
			return err
		}
	}

	safeDir := shellQuotePath(remoteDir)
	safeBase := shellQuotePath(base)
	safeTargetPath := shellQuotePath(targetPath)

	var cmd string
	lowerBase := strings.ToLower(base)
	switch {
	case strings.HasSuffix(lowerBase, ".zip"):
		if plan.Mode == smartUncompressModeFolder {
			cmd = fmt.Sprintf("cd %s && unzip -o %s -d %s", safeDir, safeBase, safeTargetPath)
		} else {
			cmd = fmt.Sprintf("cd %s && unzip -o %s", safeDir, safeBase)
		}
	case strings.HasSuffix(lowerBase, ".tar.gz") || strings.HasSuffix(lowerBase, ".tgz"):
		if plan.Mode == smartUncompressModeFolder {
			cmd = fmt.Sprintf("cd %s && tar -xzf %s -C %s", safeDir, safeBase, safeTargetPath)
		} else {
			cmd = fmt.Sprintf("cd %s && tar -xzf %s", safeDir, safeBase)
		}
	case strings.HasSuffix(lowerBase, ".tar"):
		if plan.Mode == smartUncompressModeFolder {
			cmd = fmt.Sprintf("cd %s && tar -xf %s -C %s", safeDir, safeBase, safeTargetPath)
		} else {
			cmd = fmt.Sprintf("cd %s && tar -xf %s", safeDir, safeBase)
		}
	case strings.HasSuffix(lowerBase, ".tar.bz2") || strings.HasSuffix(lowerBase, ".tbz2"):
		if plan.Mode == smartUncompressModeFolder {
			cmd = fmt.Sprintf("cd %s && tar -xjf %s -C %s", safeDir, safeBase, safeTargetPath)
		} else {
			cmd = fmt.Sprintf("cd %s && tar -xjf %s", safeDir, safeBase)
		}
	case strings.HasSuffix(lowerBase, ".gz"):
		cmd = fmt.Sprintf("cd %s && gunzip -f -k %s", safeDir, safeBase)
	default:
		return fmt.Errorf("unsupported archive format")
	}

	out, err := m.executeCmdWithClient(client, cmd)
	if err != nil {
		return fmt.Errorf("uncompress failed: %w, output: %s", err, out)
	}
	return nil
}
