package main

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
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	ai "luminssh-go/internal/ai"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// ErrHostKeyChanged 在远程主机密钥发生变化时返回，需要用户确认
var ErrHostKeyChanged = errors.New("host key has changed")

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
	SFTP          *sftp.Client
	SFTPReady     chan struct{}
	SFTPReadyOnce sync.Once
	SFTPInitErr   error
}

type SessionData struct {
	ConnKey             string // 共享客户端查找键: user@host:port
	Session             *ssh.Session
	Stdin               io.WriteCloser
	HistoryStream       *commandHistoryStream
	RemoteHistoryActive bool
	GroupSessionId      string // 对子终端有效：父会话 sessionId（用于历史事件归组）
	ShellPath           string
	TerminalInitPath    string
	CurrentCwd          string
	PromptReady         bool
}

type SSHManager struct {
	ctx              context.Context
	app              *App                          // reference to App for WebSocket output delivery
	sessions         map[string]*SessionData       // terminalId -> terminal session
	clients          map[string]*sshClientEntry    // connKey -> shared client+SFTP
	connTerminals    map[string][]string           // connKey -> terminal sessionIds
	probeDeployed    map[string]bool               // connKey -> probe.sh deployed
	probeFailed      map[string]int                // connKey -> probe.sh deploy fail count (max 3)
	pendingHostKeys  map[string]*PendingHostKey    // sessionId -> pending host key info
	tempAcceptedKeys map[string]string             // sessionId -> fingerprint (accept this time only)
	pendingCancels   map[string]context.CancelFunc // sessionId -> cancel func for in-progress Connect
	uploadTasks      map[string]*chunkedUploadTask
	mu               sync.RWMutex
	pendingMu        sync.Mutex
	uploadMu         sync.Mutex
	bufPool          sync.Pool
}

// dialAddr 拼接 host:port，自动处理 IPv6 地址
// 如果 host 本身已带 [] 会先去除，避免 net.JoinHostPort 重复包裹
func dialAddr(host string, port int) string {
	host = strings.TrimSpace(host)
	host = strings.Trim(host, "[]")
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func NewSSHManager() *SSHManager {
	return &SSHManager{
		sessions:         make(map[string]*SessionData),
		clients:          make(map[string]*sshClientEntry),
		connTerminals:    make(map[string][]string),
		probeDeployed:    make(map[string]bool),
		probeFailed:      make(map[string]int),
		pendingHostKeys:  make(map[string]*PendingHostKey),
		tempAcceptedKeys: make(map[string]string),
		pendingCancels:   make(map[string]context.CancelFunc),
		uploadTasks:      make(map[string]*chunkedUploadTask),
		bufPool: sync.Pool{
			New: func() any {
				buf := make([]byte, 32768)
				return &buf
			},
		},
	}
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

		config := &ssh.ClientConfig{
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

			netConn, dialErr := dialConnectionTargetContext(cancelCtx, conn, target, config.Timeout)
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

			sshConn, chans, reqs, handshakeErr := ssh.NewClientConn(netConn, target, config)
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
					return fmt.Errorf("认证失败")
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
			clientCreated = true
			break
		}

		// 重新检查 connKey 是否已被并发 Connect 写入；若是则丢弃新连接，复用已有连接
		m.mu.Lock()
		if existing, ok := m.clients[connKey]; ok && existing.Client != nil {
			m.mu.Unlock()
			// 关闭刚刚新建的连接，改用已存在的连接
			client.Close()
			client = existing.Client
			clientCreated = false
		} else {
			m.clients[connKey] = &sshClientEntry{Client: client, SFTPReady: make(chan struct{})}
			m.connTerminals[connKey] = []string{}
			m.mu.Unlock()

			go m.watchClient(connKey, client)
			go func() {
				_ = client.Wait()
				m.mu.Lock()
				terminalIds := append([]string{}, m.connTerminals[connKey]...)
				var sftpC *sftp.Client
				var cli *ssh.Client
				if entry, ok := m.clients[connKey]; ok {
					// 校验是否还是同一个 client 实例，避免误删快速重连后的新连接
					if entry.Client != client {
						m.mu.Unlock()
						return // 已被新连接替换，不再清理
					}
					sftpC = entry.SFTP
					cli = entry.Client
					delete(m.clients, connKey)
					delete(m.connTerminals, connKey)
					delete(m.probeDeployed, connKey)
					delete(m.probeFailed, connKey)
				}
				m.mu.Unlock()

				type closeItem struct {
					stdin   io.WriteCloser
					session *ssh.Session
				}
				// ponytail: 批量锁，减少 N 次 lock/unlock 为 1 次
				m.mu.Lock()
				var items []closeItem
				for _, tid := range terminalIds {
					if ts, ok := m.sessions[tid]; ok {
						items = append(items, closeItem{stdin: ts.Stdin, session: ts.Session})
						delete(m.sessions, tid)
					}
				}
				m.mu.Unlock()
				for _, tid := range terminalIds {
					if m.ctx != nil {
						runtime.EventsEmit(m.ctx, "ssh-disconnected", tid)
					}
				}

				for _, item := range items {
					if item.stdin != nil {
						item.stdin.Close()
					}
					if item.session != nil {
						item.session.Close()
					}
				}
				if sftpC != nil {
					sftpC.Close()
				}
				if cli != nil {
					cli.Close()
				}
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
		return m.setupSession(postAuthCtx, client, connKey, sessionId, "", launchCmd, remoteHistoryActive, shellPath, conn.TerminalInitPath)
	})
	if err != nil {
		// setupSession 失败（如 PTY 请求失败）：仅清理本路径新建的 client/sftp，
		// 复用的共享 client 不能关，否则会级联断开同连接的其他终端
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
		if clientCreated {
			if entry, ok := m.clients[connKey]; ok && entry.Client == client {
				delete(m.clients, connKey)
				delete(m.connTerminals, connKey)
			}
		} else if terminals, ok := m.connTerminals[connKey]; ok {
			next := terminals[:0]
			for _, tid := range terminals {
				if tid != sessionId {
					next = append(next, tid)
				}
			}
			m.connTerminals[connKey] = next
		}
		m.mu.Unlock()
		if clientCreated {
			client.Close()
		}
		return err
	}
	if clientCreated {
		go m.initSFTPClient(sessionId, connKey, conn, client)
	}
	return nil
}

// setupSession 创建 shell session 的共享逻辑
func (m *SSHManager) setupSession(ctx context.Context, client *ssh.Client, connKey, sessionId, groupSessionId, launchCmd string, remoteHistoryActive bool, shellPath string, terminalInitPath string) error {
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

	var historyStream *commandHistoryStream
	if remoteHistoryActive {
		historyStream = newCommandHistoryStream()
	}

	m.mu.Lock()
	if ctx != nil && ctx.Err() != nil {
		m.mu.Unlock()
		session.Close()
		return ctx.Err()
	}
	sd := &SessionData{
		ConnKey:             connKey,
		Session:             session,
		Stdin:               stdin,
		HistoryStream:       historyStream,
		RemoteHistoryActive: remoteHistoryActive,
		ShellPath:           strings.TrimSpace(shellPath),
		TerminalInitPath:    strings.TrimSpace(terminalInitPath),
		PromptReady:         !remoteHistoryActive,
	}
	if groupSessionId != "" {
		sd.GroupSessionId = groupSessionId
	}
	m.sessions[sessionId] = sd
	m.connTerminals[connKey] = append(m.connTerminals[connKey], sessionId)
	m.mu.Unlock()

	go m.pipeOutput(sessionId, stdout, historyStream)
	go m.pipeOutput(sessionId, stderr, nil)

	return nil
}

func (m *SSHManager) initSFTPClient(sessionId string, connKey string, conn Connection, client *ssh.Client) {
	sftpClient, err := sftp.NewClient(client)
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
	entry.SFTPReadyOnce.Do(func() { close(entry.SFTPReady) })
	m.mu.Unlock()

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
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		m.mu.RLock()
		entry, ok := m.clients[connKey]
		if !ok || entry.Client != client {
			m.mu.RUnlock()
			return
		}
		terminalIds := append([]string{}, m.connTerminals[connKey]...)
		m.mu.RUnlock()
		_, _, err := client.SendRequest("keepalive@lumin-ssh", true, nil)
		if err == nil {
			continue
		}
		for _, tid := range terminalIds {
			if m.Disconnect(tid) && m.ctx != nil {
				runtime.EventsEmit(m.ctx, "ssh-disconnected", tid)
			}
		}
		return
	}
}

func (m *SSHManager) pipeOutput(sessionId string, r io.Reader, historyStream *commandHistoryStream) {
	bufPtr := m.bufPool.Get().(*[]byte)
	defer m.bufPool.Put(bufPtr)
	buf := *bufPtr

	// 查找 GroupSessionId（子终端时使用父会话 ID 归组历史事件）
	eventSessionId := sessionId
	m.mu.RLock()
	if s, ok := m.sessions[sessionId]; ok && s.GroupSessionId != "" {
		eventSessionId = s.GroupSessionId
	}
	m.mu.RUnlock()

	// 直接读取并通过 WebSocket 发送，不再批处理缓冲
	// WebSocket 过 TCP loopback 延迟极低，无需批处理
	for {
		n, err := r.Read(buf)
		if n > 0 {
			var data []byte
			if historyStream != nil {
				visible, commands, cwd := historyStream.Process(buf[:n])
				data = visible
				if cwd != "" {
					shouldEmitCwd := false
					m.mu.Lock()
					if s, ok := m.sessions[sessionId]; ok {
						if s.CurrentCwd != cwd {
							s.CurrentCwd = cwd
							shouldEmitCwd = true
						}
						if s.RemoteHistoryActive {
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
			if m.Disconnect(sessionId) && m.ctx != nil {
				runtime.EventsEmit(m.ctx, "ssh-disconnected", sessionId)
			}
			return
		}
	}
}

// getClientEntry 查找 session 对应的共享客户端
func (m *SSHManager) getClientEntry(sessionId string) (*ssh.Client, *sftp.Client, error) {
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
func (m *SSHManager) getSFTPClient(sessionId string) (*sftp.Client, error) {
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

	taskIDs := make([]string, 0)
	m.uploadMu.Lock()
	for taskID, task := range m.uploadTasks {
		if task != nil && task.sessionId == sessionId {
			taskIDs = append(taskIDs, taskID)
		}
	}
	m.uploadMu.Unlock()

	for _, taskID := range taskIDs {
		_ = m.AbortChunkedUploadTask(taskID)
	}
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
	s, ok := m.sessions[sessionId]
	if !ok {
		m.mu.Unlock()
		return false
	}
	disconnected = true
	connKey := s.ConnKey
	delete(m.sessions, sessionId)
	// 清理该会话临时接受的主机密钥记录，避免无限累积
	delete(m.tempAcceptedKeys, sessionId)
	// 清理可能残留的主机密钥变更待确认条目（用户关掉弹窗未响应时）
	delete(m.pendingHostKeys, sessionId)

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

	var sftpToClose *sftp.Client
	var clientToClose *ssh.Client
	if len(m.connTerminals[connKey]) == 0 {
		if entry, ok := m.clients[connKey]; ok {
			sftpToClose = entry.SFTP
			clientToClose = entry.Client
			delete(m.clients, connKey)
			delete(m.connTerminals, connKey)
			delete(m.probeDeployed, connKey)
			delete(m.probeFailed, connKey)
		}
	}
	m.mu.Unlock() // 尽早释放锁，避免 Close 阻塞影响其他操作

	// 2. 在锁外关闭资源（服务器挂了时这些操作可能阻塞，但不会锁住其他 goroutine）
	if stdin != nil {
		stdin.Close()
	}
	if sshSess != nil {
		sshSess.Close()
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
	m.mu.RUnlock()

	// 生成新 session ID
	randomId := make([]byte, 8)
	if _, err := rand.Read(randomId); err != nil {
		return "", fmt.Errorf("生成 session ID 失败: %w", err)
	}
	newId := fmt.Sprintf("term_%x", randomId)

	launchCmd, remoteHistoryActive := buildShellLaunchCommand(existing.ShellPath, existing.TerminalInitPath)

	err := m.setupSession(context.Background(), entry.Client, connKey, newId, sessionId, launchCmd, remoteHistoryActive, existing.ShellPath, existing.TerminalInitPath)
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
		// Connect 失败时清除临时密钥，避免下次连接静默绕过主机密钥校验
		if err != nil {
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
	m.mu.RUnlock()

	client, _, err := m.getClientEntry(sessionId)
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

	cmd := fmt.Sprintf(`PORT=%s; SSHD_PID=$(ss -ntp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | head -n1); [ -z "$SSHD_PID" ] && SSHD_PID=$(netstat -ntp 2>/dev/null | grep ":$PORT " | grep -oE '[0-9]+/sshd' | cut -d/ -f1 | head -n1); if [ -n "$SSHD_PID" ]; then SHELL_PID=$(pgrep -P $SSHD_PID | head -n1); fi; [ -z "$SHELL_PID" ] && SHELL_PID=$(pgrep -u $USER -f "sh|bash|zsh" | tail -n1); if [ -n "$SHELL_PID" ]; then readlink /proc/$SHELL_PID/cwd 2>/dev/null || echo "/"; else echo "/"; fi`, portStr)

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

// WriteBytes sends raw bytes to the SSH PTY stdin (used by WebSocket handler)
func (m *SSHManager) WriteBytes(sessionId string, data []byte) {
	m.mu.Lock()
	s, ok := m.sessions[sessionId]
	var stdin io.WriteCloser
	if ok && s != nil {
		if s.RemoteHistoryActive && len(data) > 0 {
			s.PromptReady = false
		}
		stdin = s.Stdin
	}
	m.mu.Unlock()
	if stdin != nil {
		_, _ = stdin.Write(data)
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
		if err := s.Session.WindowChange(rows, cols); err != nil {
			log.Printf("[Resize] WindowChange failed for %s: %v", sessionId, err)
		}
	}
}

// executeCmdWithClient executes a command on a separate temporary session using the given client
func (m *SSHManager) executeCmdWithClient(client *ssh.Client, cmd string) (string, error) {
	return m.executeCmdWithClientContext(context.Background(), client, cmd)
}

func (m *SSHManager) executeCmdWithClientContext(ctx context.Context, client *ssh.Client, cmd string) (string, error) {
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
	session.Stdout = &stdoutBuf

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
		return stdoutBuf.String(), err
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

	if err := sftpClient.MkdirAll(".lumin"); err != nil {
		_ = sftpClient.MkdirAll("/tmp/.lumin")
	}

	scriptPath := ".lumin/probe.sh"
	f, err := sftpClient.Create(scriptPath)
	if err != nil {
		scriptPath = "/tmp/.lumin/probe.sh"
		f, err = sftpClient.Create(scriptPath)
		if err != nil {
			m.mu.Lock()
			m.probeFailed[connKey]++
			m.mu.Unlock()
			return fmt.Errorf("cannot write probe script: %w", err)
		}
	}
	_, err = f.Write([]byte(dynamicProbeScript))
	// Close 错误也要检查：SFTP 写缓冲刷新失败会导致脚本不完整
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		m.mu.Lock()
		m.probeFailed[connKey]++
		m.mu.Unlock()
		return err
	}

	_ = sftpClient.Chmod(scriptPath, 0755)

	m.mu.Lock()
	m.probeDeployed[connKey] = true
	delete(m.probeFailed, connKey) // 成功后重置失败计数，避免历史累计误判永久禁用
	m.mu.Unlock()
	return nil
}

// extractSection 从 lines 中提取 startMarker（不含）到 endMarker（不含）之间的内容。
// startMarker 为空时从开头开始收集；endMarker 为空时收集到末尾。
// GetSystemInfo 与 GetServerStaticInfo 共用此实现，避免重复定义。
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
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return nil, err
	}
	sftpClient, err := m.getSFTPClient(sessionId)
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
	out, err := m.executeCmdWithClient(client, fmt.Sprintf(`sh -c 'f=~/.lumin/probe.sh; [ -f "$f" ] && sh "$f"%s || sh /tmp/.lumin/probe.sh%s'`, probeArg, probeArg))
	if err != nil || len(strings.TrimSpace(out)) == 0 {
		// 执行失败（文件被删除或不可用），清除标记以便下次重新部署
		m.mu.Lock()
		delete(m.probeDeployed, connKey)
		m.mu.Unlock()
		return nil, fmt.Errorf("probe script execution failed")
	}

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
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return nil, err
	}

	out, err := m.executeCmdWithClient(client, `ps -eo pid,pcpu,rss,user,comm,stat,nlwp,etime,args --sort=-pcpu 2>/dev/null`)
	if err != nil {
		return nil, err
	}

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
	client, _, err := m.getClientEntry(sessionId)
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
	client, _, err := m.getClientEntry(sessionId)
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
	client, _, err := m.getClientEntry(sessionId)
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

func (m *SSHManager) ListDir(sessionId string, path string) ([]map[string]interface{}, error) {
	return m.ListDirContext(context.Background(), sessionId, path)
}

func (m *SSHManager) ListDirContext(ctx context.Context, sessionId string, path string) ([]map[string]interface{}, error) {
	if err := ensureContextActive(ctx); err != nil {
		return nil, err
	}
	sftpClient, err := m.getSFTPClient(sessionId)
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

		results = append(results, map[string]interface{}{
			"name":        f.Name(),
			"isDirectory": f.IsDir(),
			"size":        f.Size(),
			"modifyTime":  f.ModTime().Format(time.RFC3339),
			"permission":  permStr,
			"mode":        modeNumeric,
			"uid":         uid,
			"gid":         gid,
		})
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

func (m *SSHManager) ChmodFile(sessionId string, path string, modeStr string, recursive bool) error {
	modeValue := strings.TrimSpace(modeStr)
	modeInt, err := strconv.ParseInt(modeValue, 8, 32)
	if err != nil {
		return fmt.Errorf("invalid mode: %w", err)
	}
	if !recursive {
		sftpClient, err := m.getSFTPClient(sessionId)
		if err != nil {
			return err
		}
		return sftpClient.Chmod(path, os.FileMode(modeInt))
	}
	client, _, err := m.getClientEntry(sessionId)
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
	sftpClient, err := m.getSFTPClient(sessionId)
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

func (m *SSHManager) WriteFile(sessionId string, path string, content string) error {
	return m.WriteFileContext(context.Background(), sessionId, path, content)
}

func (m *SSHManager) WriteFileContext(ctx context.Context, sessionId string, path string, content string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	sftpClient, err := m.getSFTPClient(sessionId)
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
	client, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if isDir {
		if sftpClient != nil {
			if err := sftpClient.RemoveAll(path); err == nil {
				return ensureContextActive(ctx)
			}
		}
		_, err := m.executeCmdWithClientContext(ctx, client, rmRfCmd(path))
		return err
	}
	if sftpClient == nil {
		sftpClient, err = m.getSFTPClient(sessionId)
		if err != nil {
			return err
		}
	}
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	return sftpClient.Remove(path)
}

// DeleteItemShell 用 rm -rf 删除（和 FinalShell 一致）
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
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	_, err = m.executeCmdWithClientContext(ctx, client, rmRfCmd(path))
	return err
}

func (m *SSHManager) Mkdir(sessionId string, path string) error {
	return m.MkdirContext(context.Background(), sessionId, path)
}

func (m *SSHManager) MkdirContext(ctx context.Context, sessionId string, path string) error {
	if err := ensureContextActive(ctx); err != nil {
		return err
	}
	sftpClient, err := m.getSFTPClient(sessionId)
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
	sftpClient, err := m.getSFTPClient(sessionId)
	if err != nil {
		return err
	}
	return sftpClient.Rename(oldPath, newPath)
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
		p.current += int64(n)
		now := time.Now()
		if now.Sub(p.lastEmit) > 200*time.Millisecond || p.current >= p.total {
			pct := float64(0)
			if p.total > 0 {
				pct = float64(p.current) / float64(p.total) * 100
				if pct > 100 {
					pct = 100
				}
			}
			if p.ctx != nil {
				runtime.EventsEmit(p.ctx, p.eventName, pct)
			}
			p.lastEmit = now
		}
	}
	return n, err
}

// copyWithProgress 复制数据并通过 Wails 事件报告进度
func (m *SSHManager) copyWithProgress(dst io.Writer, src io.Reader, sessionId string, totalSize int64) error {
	pr := &progressReader{
		Reader:    src,
		ctx:       m.ctx,
		eventName: "transfer-progress-" + sessionId,
		total:     totalSize,
		lastEmit:  time.Now(),
	}
	buf := make([]byte, 2*1024*1024)
	_, err := io.CopyBuffer(dst, pr, buf)
	return err
}

func (m *SSHManager) UploadFile(sessionId string, localPath string, remotePath string) error {
	sftpClient, err := m.getSFTPClient(sessionId)
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
	sftpClient, err := m.getSFTPClient(sessionId)
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
	sftpClient, err := m.getSFTPClient(sessionId)
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
	sftpClient, err := m.getSFTPClient(sessionId)
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
	sftpClient, err := m.getSFTPClient(sessionId)
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
	client, _, err := m.getClientEntry(sessionId)
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

func (m *SSHManager) UncompressItem(sessionId string, remotePath string) error {
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}

	dir := filepath.Dir(remotePath)
	base := filepath.Base(remotePath)
	dir = strings.ReplaceAll(dir, "\\", "/")
	safeDir := shellQuotePath(dir)
	safeBase := shellQuotePath(base)

	var cmd string
	lowerBase := strings.ToLower(base)
	// 注意：解压在远程服务器执行，无法在客户端校验归档成员路径。
	// tar slip 路径穿越风险由用户在信任的服务器上自行评估。
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
		return fmt.Errorf("uncompress failed: %w, output: %s", err, out)
	}
	return nil
}
