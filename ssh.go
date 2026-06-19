package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// ErrHostKeyChanged 在远程主机密钥发生变化时返回，需要用户确认
var ErrHostKeyChanged = errors.New("host key has changed")

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
	Client *ssh.Client
	SFTP   *sftp.Client
}

type SessionData struct {
	ConnKey             string // 共享客户端查找键: user@host:port
	Session             *ssh.Session
	Stdin               io.WriteCloser
	HistoryStream       *commandHistoryStream
	RemoteHistoryActive bool
	GroupSessionId      string // 对子终端有效：父会话 sessionId（用于历史事件归组）
}

type SSHManager struct {
	ctx              context.Context
	app              *App                       // reference to App for WebSocket output delivery
	sessions         map[string]*SessionData    // terminalId -> terminal session
	clients          map[string]*sshClientEntry // connKey -> shared client+SFTP
	connTerminals    map[string][]string        // connKey -> terminal sessionIds
	probeDeployed    map[string]bool            // connKey -> probe.sh deployed
	pendingHostKeys  map[string]*PendingHostKey // sessionId -> pending host key info
	tempAcceptedKeys map[string]string          // sessionId -> fingerprint (accept this time only)
	mu               sync.RWMutex
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
		pendingHostKeys:  make(map[string]*PendingHostKey),
		tempAcceptedKeys: make(map[string]string),
	}
}

func (m *SSHManager) Connect(sessionId string, conn Connection) error {
	// 去除密码首尾空白（防止复制粘贴带入不可见字符）
	conn.Password = strings.TrimSpace(conn.Password)
	connKey := fmt.Sprintf("%s@%s", conn.Username, dialAddr(conn.Host, conn.Port))

	m.mu.RLock()
	existingEntry, clientExists := m.clients[connKey]
	m.mu.RUnlock()

	var client *ssh.Client
	var sftpClient *sftp.Client

	if clientExists {
		client = existingEntry.Client
		sftpClient = existingEntry.SFTP
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

		knownHostsPath := getKnownHostsPath()
		if err := os.MkdirAll(filepath.Dir(knownHostsPath), 0700); err != nil {
			log.Printf("[Connect] MkdirAll for known_hosts dir failed: %v", err)
		}
		if _, err := os.Stat(knownHostsPath); os.IsNotExist(err) {
			if err := os.WriteFile(knownHostsPath, []byte(""), 0600); err != nil {
				log.Printf("[Connect] failed to create known_hosts file: %v", err)
			}
		}

		hostKeyCallback, err := knownhosts.New(knownHostsPath)
		if err != nil {
			// 创建空 known_hosts 文件后重试，而非禁用校验
			if err := os.WriteFile(knownHostsPath, []byte(""), 0600); err != nil {
				log.Printf("[Connect] failed to recreate known_hosts file: %v", err)
			}
			hostKeyCallback, err = knownhosts.New(knownHostsPath)
			if err != nil {
				return fmt.Errorf("无法初始化主机密钥校验: %w", err)
			}
		}

		customHostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			err := hostKeyCallback(hostname, remote, key)
			if err == nil {
				return nil
			}

			var keyErr *knownhosts.KeyError
			if errors.As(err, &keyErr) {
				if len(keyErr.Want) == 0 {
					fingerprint := ssh.FingerprintSHA256(key)

					// 检查是否为临时接受的密钥（仅本次会话，按 sessionId 匹配）
					m.mu.RLock()
					if fp, ok := m.tempAcceptedKeys[sessionId]; ok && fp == fingerprint {
						m.mu.RUnlock()
						return nil
					}
					m.mu.RUnlock()

					// 新主机密钥 —— 需要用户确认
					m.mu.Lock()
					m.pendingHostKeys[sessionId] = &PendingHostKey{
						Conn:           conn,
						Hostname:       hostname,
						NewKey:         key,
						NewFingerprint: fingerprint,
						OldKeys:        nil, // nil 表示首次连接
					}
					m.mu.Unlock()
					return ErrHostKeyChanged
				} else {
					fingerprint := ssh.FingerprintSHA256(key)

					// 检查是否为临时接受的密钥（仅本次会话，按 sessionId 匹配）
					m.mu.RLock()
					if fp, ok := m.tempAcceptedKeys[sessionId]; ok && fp == fingerprint {
						m.mu.RUnlock()
						return nil // 本次接受该密钥
					}
					m.mu.RUnlock()

					m.mu.Lock()
					m.pendingHostKeys[sessionId] = &PendingHostKey{
						Conn:           conn,
						Hostname:       hostname,
						NewKey:         key,
						NewFingerprint: fingerprint,
						OldKeys:        keyErr.Want,
					}
					m.mu.Unlock()
					return ErrHostKeyChanged
				}
			}
			return err
		}

		config := &ssh.ClientConfig{
			User:            conn.Username,
			Auth:            authMethods,
			HostKeyCallback: customHostKeyCallback,
			Timeout:         10 * time.Second,
			HostKeyAlgorithms: []string{
				"ssh-ed25519",
				"ecdsa-sha2-nistp256",
				"ecdsa-sha2-nistp384",
				"ecdsa-sha2-nistp521",
				"rsa-sha2-512",
				"rsa-sha2-256",
				"ssh-rsa",
				"ssh-dss",
			},
		}

		target := dialAddr(conn.Host, conn.Port)
		var dialErr error
		client, dialErr = ssh.Dial("tcp", target, config)
		if dialErr != nil {
			if errors.Is(dialErr, ErrHostKeyChanged) {
				if m.ctx != nil {
					// 在锁内读取 pendingHostKeys，避免与 AcceptHostKeyChange 并发写入竞争
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

			// 认证失败或连接被拒绝，立即返回错误
			errStr := dialErr.Error()
			if strings.Contains(errStr, "unable to authenticate") ||
				strings.Contains(errStr, "no supported methods remain") ||
				strings.Contains(errStr, "EOF") ||
				strings.Contains(errStr, "connection reset") ||
				strings.Contains(errStr, "connection refused") {
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

			return dialErr
		}

		var sftpErr error
		sftpClient, sftpErr = sftp.NewClient(client)
		if sftpErr != nil {
			// SFTP 不可用（如部分嵌入式系统不支持 sftp subsystem），文件管理功能不可用但不影响终端
			runtime.EventsEmit(m.ctx, "ssh-status", map[string]interface{}{
				"sessionId": sessionId,
				"status":    "sftp-unavailable",
				"host":      conn.Host,
				"port":      conn.Port,
				"username":  conn.Username,
				"error":     sftpErr.Error(),
			})
			sftpClient = nil
		}

		// 重新检查 connKey 是否已被并发 Connect 写入；若是则丢弃新连接，复用已有连接
		m.mu.Lock()
		if existing, ok := m.clients[connKey]; ok && existing.Client != nil {
			m.mu.Unlock()
			// 关闭刚刚新建的连接和 sftp，改用已存在的连接
			if sftpClient != nil {
				sftpClient.Close()
			}
			client.Close()
			client = existing.Client
			sftpClient = existing.SFTP
		} else {
			m.clients[connKey] = &sshClientEntry{Client: client, SFTP: sftpClient}
			m.connTerminals[connKey] = []string{}
			m.mu.Unlock()

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
				}
				m.mu.Unlock()

				type closeItem struct {
					stdin   io.WriteCloser
					session *ssh.Session
				}
				var items []closeItem
				for _, tid := range terminalIds {
					m.mu.Lock()
					ts, tsOk := m.sessions[tid]
					if tsOk {
						items = append(items, closeItem{stdin: ts.Stdin, session: ts.Session})
						delete(m.sessions, tid)
					}
					m.mu.Unlock()
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

	session, err := client.NewSession()
	if err != nil {
		return err
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

	shellPath := detectRemoteShell(client)
	launchCmd, remoteHistoryActive := buildShellLaunchCommand(shellPath)

	if remoteHistoryActive {
		err = session.Start(launchCmd)
	} else {
		err = session.Shell()
	}
	if err != nil {
		session.Close()
		return err
	}

	var historyStream *commandHistoryStream
	if remoteHistoryActive {
		historyStream = newCommandHistoryStream()
	}

	m.mu.Lock()
	m.sessions[sessionId] = &SessionData{
		ConnKey:             connKey,
		Session:             session,
		Stdin:               stdin,
		HistoryStream:       historyStream,
		RemoteHistoryActive: remoteHistoryActive,
	}
	m.connTerminals[connKey] = append(m.connTerminals[connKey], sessionId)
	m.mu.Unlock()

	go m.pipeOutput(sessionId, stdout, historyStream)
	go m.pipeOutput(sessionId, stderr, nil)

	return nil
}

func (m *SSHManager) pipeOutput(sessionId string, r io.Reader, historyStream *commandHistoryStream) {
	buf := make([]byte, 32768)

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
				data = make([]byte, n)
				copy(data, buf[:n])
				visible, commands := historyStream.Process(data)
				data = visible
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
			if m.app != nil {
				m.app.WriteWsOutput(sessionId, data)
			} else if m.ctx != nil {
				// fallback: WebSocket 未初始化时用 Events
				runtime.EventsEmit(m.ctx, "terminal-data-"+sessionId, string(data))
			}
		}
		if err != nil {
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

// getSFTPClient 查找 session 对应的 SFTP 客户端，不可用时返回 error
func (m *SSHManager) getSFTPClient(sessionId string) (*sftp.Client, error) {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return nil, err
	}
	if sftpClient == nil {
		return nil, fmt.Errorf("SFTP not available")
	}
	return sftpClient, nil
}

func (m *SSHManager) Disconnect(sessionId string) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("[Disconnect] panic recovered: %v\n", r)
		}
	}()

	// 1. 在锁内完成 map 清理，收集需要关闭的资源
	m.mu.Lock()
	s, ok := m.sessions[sessionId]
	if !ok {
		m.mu.Unlock()
		return
	}
	connKey := s.ConnKey
	delete(m.sessions, sessionId)
	// 清理该会话临时接受的主机密钥记录，避免无限累积
	delete(m.tempAcceptedKeys, sessionId)

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
		sftpToClose.Close()
	}
	if clientToClose != nil {
		clientToClose.Close()
	}
}

// DisconnectAll 断开所有 SSH 连接，用于应用退出时清理资源
func (m *SSHManager) DisconnectAll() {
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

	session, err := entry.Client.NewSession()
	if err != nil {
		return "", err
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
	}

	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		return "", err
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return "", err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return "", err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		return "", err
	}

	if remoteHistoryActive {
		shellPath := detectRemoteShell(entry.Client)
		launchCmd, _ := buildShellLaunchCommand(shellPath)
		if launchCmd != "" {
			err = session.Start(launchCmd)
		} else {
			err = session.Shell()
		}
	} else {
		err = session.Shell()
	}
	if err != nil {
		session.Close()
		return "", err
	}

	var historyStream *commandHistoryStream
	if remoteHistoryActive {
		historyStream = newCommandHistoryStream()
	}

	newId := fmt.Sprintf("term_%d", time.Now().UnixNano())

	m.mu.Lock()
	m.sessions[newId] = &SessionData{
		ConnKey:             connKey,
		Session:             session,
		Stdin:               stdin,
		HistoryStream:       historyStream,
		RemoteHistoryActive: remoteHistoryActive,
		GroupSessionId:      sessionId, // 使用父会话 ID 用于历史事件归组
	}
	m.connTerminals[connKey] = append(m.connTerminals[connKey], newId)
	m.mu.Unlock()

	go m.pipeOutput(newId, stdout, historyStream)
	go m.pipeOutput(newId, stderr, nil)

	return newId, nil
}

// getKnownHostsPath 返回跨平台的 known_hosts 文件路径
func getKnownHostsPath() string {
	home := os.Getenv("HOME")
	if home == "" {
		home = os.Getenv("USERPROFILE") // Windows
	}
	return filepath.Join(home, ".ssh", "known_hosts")
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
		return m.Connect(sessionId, pending.Conn)

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
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					newLines = append(newLines, line)
					continue
				}
				isOld := false
				for _, oldKey := range pending.OldKeys {
					if strings.Contains(line, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(oldKey.Key)))) {
						isOld = true
						break
					}
				}
				if !isOld {
					newLines = append(newLines, line)
				}
			}
			newLines = append(newLines, newLine)

			// 原子写入：先写临时文件，再 rename 覆盖，避免中断损坏原文件
			tmpPath := knownHostsPath + ".tmp"
			if err := os.WriteFile(tmpPath, []byte(strings.Join(newLines, "\n")+"\n"), 0600); err != nil {
				return fmt.Errorf("无法写入 known_hosts: %w", err)
			}
			os.Rename(knownHostsPath, knownHostsPath+".bak")
			if err := os.Rename(tmpPath, knownHostsPath); err != nil {
				os.Rename(knownHostsPath+".bak", knownHostsPath) // 回滚
				return fmt.Errorf("无法写入 known_hosts: %w", err)
			}
			os.Remove(knownHostsPath + ".bak")
		} else {
			// 首次连接：直接追加新条目
			f, err := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
			if err != nil {
				return fmt.Errorf("无法写入 known_hosts: %w", err)
			}
			defer f.Close()
			f.WriteString(newLine + "\n")
		}

		return m.Connect(sessionId, pending.Conn)

	default:
		return fmt.Errorf("无效的操作")
	}
}

func (m *SSHManager) GetTerminalCwd(sessionId string) (string, error) {
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return "", err
	}

	localAddr := client.LocalAddr().String()
	parts := strings.Split(localAddr, ":")
	if len(parts) < 2 {
		return "", fmt.Errorf("invalid local address format")
	}
	port := parts[len(parts)-1]

	cmd := fmt.Sprintf(`PORT=%s; SSHD_PID=$(ss -ntp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | head -n1); [ -z "$SSHD_PID" ] && SSHD_PID=$(netstat -ntp 2>/dev/null | grep ":$PORT " | grep -oE '[0-9]+/sshd' | cut -d/ -f1 | head -n1); if [ -n "$SSHD_PID" ]; then SHELL_PID=$(pgrep -P $SSHD_PID | head -n1); fi; [ -z "$SHELL_PID" ] && SHELL_PID=$(pgrep -u $USER -f "sh|bash|zsh" | tail -n1); if [ -n "$SHELL_PID" ]; then readlink /proc/$SHELL_PID/cwd 2>/dev/null || echo "/"; else echo "/"; fi`, port)

	out, err := m.executeCmdWithClient(client, cmd)
	if err != nil {
		return "", err
	}
	cwd := strings.TrimSpace(out)
	if cwd == "" || cwd == "/" {
		// 复杂探测失败，用 $HOME 作为回退
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
	m.mu.RLock()
	s, ok := m.sessions[sessionId]
	m.mu.RUnlock()
	if ok && s.Stdin != nil {
		_, _ = s.Stdin.Write(data)
	}
}

func (m *SSHManager) Resize(sessionId string, cols, rows int) {
	m.mu.RLock()
	s, ok := m.sessions[sessionId]
	m.mu.RUnlock()
	if ok {
		s.Session.WindowChange(rows, cols)
	}
}

// executeCmdWithClient executes a command on a separate temporary session using the given client
func (m *SSHManager) executeCmdWithClient(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	var stdoutBuf bytes.Buffer
	session.Stdout = &stdoutBuf

	// 防止服务器无响应时 goroutine/调用方永久阻塞
	errCh := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errCh <- fmt.Errorf("panic in session.Run: %v", r)
			}
		}()
		errCh <- session.Run(cmd)
	}()

	select {
	case err := <-errCh:
		return stdoutBuf.String(), err
	case <-time.After(30 * time.Second):
		// 超时后由 defer session.Close() 统一关闭，无需在此重复 Close
		return "", fmt.Errorf("command timed out after 30 seconds")
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
cat /proc/net/dev
echo ---DISKIO1---
cat /proc/diskstats
sleep 1
echo ---CPU2---
grep '^cpu' /proc/stat
echo ---NET2---
cat /proc/net/dev
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
	m.mu.RUnlock()
	if already {
		return nil
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
			return fmt.Errorf("cannot write probe script: %w", err)
		}
	}
	_, err = f.Write([]byte(dynamicProbeScript))
	f.Close()
	if err != nil {
		return err
	}

	_ = sftpClient.Chmod(scriptPath, 0755)

	m.mu.Lock()
	m.probeDeployed[connKey] = true
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

func (m *SSHManager) GetSystemInfo(sessionId string) (result map[string]interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in GetSystemInfo: %v", r)
			result = nil
		}
	}()
	client, sftpClient, err := m.getClientEntry(sessionId)
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

	_ = m.deployProbeScript(sftpClient, connKey)

	out, err := m.executeCmdWithClient(client, `sh -c 'f=~/.lumin/probe.sh; [ -f "$f" ] && sh "$f" || sh /tmp/.lumin/probe.sh'`)
	if err != nil || len(strings.TrimSpace(out)) == 0 {
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
	// 确保 used + cache + free = total，避免甜甜圈图溢出
	memUsedMB := memTotalMB - memFreeMB - memCacheMB
	if memUsedMB < 0 {
		// cache 比 total-free 还大时，压缩 cache
		memCacheMB = memTotalMB - memFreeMB
		if memCacheMB < 0 {
			memCacheMB = 0
		}
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
	parseNetDev2 := func(lines []string) map[string][]uint64 {
		res := make(map[string][]uint64)
		for _, l := range lines {
			if !strings.Contains(l, ":") {
				continue
			}
			parts := strings.SplitN(l, ":", 2)
			name := strings.TrimSpace(parts[0])
			if name == "lo" {
				continue
			}
			fields := strings.Fields(parts[1])
			if len(fields) < 9 {
				continue
			}
			rx, _ := strconv.ParseUint(fields[0], 10, 64)
			tx, _ := strconv.ParseUint(fields[8], 10, 64)
			res[name] = []uint64{rx, tx}
		}
		return res
	}

	netLines1 := extractSection(lines1, "---NET1---", "---DISKIO1---")
	netLines2 := extractSection(lines2, "---NET2---", "---DISKIO2---")
	nets1 := parseNetDev2(netLines1)
	nets2 := parseNetDev2(netLines2)

	var netUpSpeed, netDownSpeed, netUpTotal, netDownTotal float64
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
		if rxSpeed > netDownSpeed {
			netDownSpeed = rxSpeed
		}
		if txSpeed > netUpSpeed {
			netUpSpeed = txSpeed
		}
	}

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
			"swapFree":  swapFreeMB,
		},
		"disk": map[string]interface{}{
			"device":     diskDevice,
			"type":       "ext4",
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
		},
		"processes": processes,
	}, nil
}

// GetServerStaticInfo 获取服务器静态信息（OS/时区/主机名/CPU 型号），只在连接时调用一次
func (m *SSHManager) GetServerStaticInfo(sessionId string) (result map[string]interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in GetServerStaticInfo: %v", r)
			result = nil
		}
	}()
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return nil, err
	}

	out, err := m.executeCmdWithClient(client, `echo ---OS---
grep PRETTY_NAME /etc/os-release 2>/dev/null || echo 'PRETTY_NAME="Linux"'
grep ^VERSION_ID= /etc/os-release 2>/dev/null
echo ---TZ---
cat /etc/timezone 2>/dev/null || date +'%Z'
echo ---HOSTNAME---
hostname
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
		if strings.HasPrefix(l, "PRETTY_NAME=") {
			osName = strings.Trim(strings.TrimPrefix(l, "PRETTY_NAME="), "\"")
		}
	}
	tzStr := "UTC"
	for _, l := range extractSection(lines, "---TZ---", "---HOSTNAME---") {
		t := strings.TrimSpace(l)
		if t != "" {
			tzStr = t
			break
		}
	}
	hostname := ""
	for _, l := range extractSection(lines, "---HOSTNAME---", "---CPUINFO---") {
		t := strings.TrimSpace(l)
		if t != "" {
			hostname = t
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
		"hostname": hostname,
		"ip":       ipAddr,
		"cpu": map[string]interface{}{
			"model": cpuModel,
		},
	}, nil
}

// SFTP Methods

func formatFileMode(mode os.FileMode) string {
	return mode.String()
}

func fileModeNumeric(mode os.FileMode) string {
	return fmt.Sprintf("%o", mode.Perm())
}

func (m *SSHManager) ListDir(sessionId string, path string) ([]map[string]interface{}, error) {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return nil, err
	}
	if sftpClient == nil {
		return nil, fmt.Errorf("SFTP not available")
	}

	files, err := sftpClient.ReadDir(path)
	if err != nil {
		return nil, err
	}

	var results []map[string]interface{}
	for _, f := range files {
		permStr := formatFileMode(f.Mode())
		modeNumeric := fileModeNumeric(f.Mode())

		// 尝试从 Sys() 获取 UID/GID（*sftp.FileStat），非 sftp 环境可能为 nil
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

func (m *SSHManager) ChmodFile(sessionId string, path string, modeStr string) error {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
	}

	// 解析八进制权限字符串（如 "0755"、"644"）
	modeInt, err := strconv.ParseInt(modeStr, 8, 32)
	if err != nil {
		return fmt.Errorf("invalid mode: %w", err)
	}
	return sftpClient.Chmod(path, os.FileMode(modeInt))
}

func (m *SSHManager) ReadFile(sessionId string, path string) (string, error) {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return "", err
	}
	if sftpClient == nil {
		return "", fmt.Errorf("SFTP not available")
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

	const maxFileSize = 50 * 1024 * 1024 // 50MB
	if stat.Size() > maxFileSize {
		return "", fmt.Errorf("文件过大 (%.1f MB)，请使用终端命令查看", float64(stat.Size())/(1024*1024))
	}

	var b bytes.Buffer
	b.Grow(int(stat.Size()))
	_, err = io.Copy(&b, f)
	if err != nil {
		return "", err
	}
	return b.String(), nil
}

func (m *SSHManager) WriteFile(sessionId string, path string, content string) error {
	sftpClient, err := m.getSFTPClient(sessionId)
	if err != nil {
		return err
	}

	f, err := sftpClient.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.Write([]byte(content))
	return err
}

func (m *SSHManager) DeleteItem(sessionId string, path string, isDir bool) error {
	// 拒绝删除危险路径，防止 rm -rf 误删根目录或家目录
	if path == "" || path == "/" || path == "/*" || path == "~" || path == "~/*" {
		return fmt.Errorf("refusing to delete dangerous path: %q", path)
	}
	client, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if isDir {
		_, err := m.executeCmdWithClient(client, fmt.Sprintf("rm -rf '%s'", strings.ReplaceAll(path, "'", "'\\''")))
		return err
	}
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
	}
	return sftpClient.Remove(path)
}

func (m *SSHManager) Mkdir(sessionId string, path string) error {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
	}
	return sftpClient.MkdirAll(path)
}

func (m *SSHManager) RenameItem(sessionId string, oldPath string, newPath string) error {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
	}
	return sftpClient.Rename(oldPath, newPath)
}

// progressReader wraps an io.Reader and emits progress events via Wails.
type progressReader struct {
	io.Reader
	ctx       context.Context
	sessionId string
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
				runtime.EventsEmit(p.ctx, "transfer-progress-"+p.sessionId, pct)
			}
			p.lastEmit = now
		}
	}
	return n, err
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

	var totalSize int64 = 0
	if stat, err := src.Stat(); err == nil {
		totalSize = stat.Size()
	}

	pr := &progressReader{
		Reader:    src,
		ctx:       m.ctx,
		sessionId: sessionId,
		total:     totalSize,
		lastEmit:  time.Now(),
	}

	buf := make([]byte, 2*1024*1024)
	_, err = io.CopyBuffer(dst, pr, buf)
	return err
}

// UploadDir recursively uploads a local directory to a remote path
func (m *SSHManager) UploadDir(sessionId string, localDir string, remoteDir string) error {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
	}

	remoteDir = filepath.ToSlash(remoteDir)

	buf := make([]byte, 2*1024*1024)
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
		defer src.Close()

		dst, err := sftpClient.Create(remotePath)
		if err != nil {
			return err
		}
		defer dst.Close()

		var totalSize int64 = 0
		if stat, err := src.Stat(); err == nil {
			totalSize = stat.Size()
		}

		pr := &progressReader{
			Reader:    src,
			ctx:       m.ctx,
			sessionId: sessionId,
			total:     totalSize,
			lastEmit:  time.Now(),
		}

		_, err = io.CopyBuffer(dst, pr, buf)
		return err
	})
}

// UploadFileContent uploads file content from memory to a remote path
func (m *SSHManager) UploadFileContent(sessionId string, fileName string, remoteDir string, content []byte) error {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
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

	_, err = dst.Write(content)
	return err
}

func (m *SSHManager) DownloadFile(sessionId string, remotePath string, localPath string) error {
	_, sftpClient, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	if sftpClient == nil {
		return fmt.Errorf("SFTP not available")
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

	var totalSize int64 = 0
	if stat, err := src.Stat(); err == nil {
		totalSize = stat.Size()
	}

	pr := &progressReader{
		Reader:    src,
		ctx:       m.ctx,
		sessionId: sessionId,
		total:     totalSize,
		lastEmit:  time.Now(),
	}

	buf := make([]byte, 2*1024*1024)
	_, err = io.CopyBuffer(dst, pr, buf)
	return err
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
	safeDir := strings.ReplaceAll(dir, "'", "'\\''")
	safeBase := strings.ReplaceAll(base, "'", "'\\''")
	safeArchive := strings.ReplaceAll(archiveName, "'", "'\\''")
	cmd := fmt.Sprintf("cd '%s' && tar -czf '%s' '%s'", safeDir, safeArchive, safeBase)

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
	safeDir := strings.ReplaceAll(dir, "'", "'\\''")
	safeBase := strings.ReplaceAll(base, "'", "'\\''")

	var cmd string
	lowerBase := strings.ToLower(base)
	// 注意：解压在远程服务器执行，无法在客户端校验归档成员路径。
	// 对 tar 命令追加 --no-unsafe-paths（GNU tar 支持，可拒绝包含 .. 或绝对路径的成员，
	// 缓解 tar slip 路径穿越风险；BSD tar 不识别该选项会报错，但多数 Linux 发行版默认为 GNU tar）。
	if strings.HasSuffix(lowerBase, ".zip") {
		// unzip 无等价选项，无法在命令行层面防御路径穿越
		cmd = fmt.Sprintf("cd '%s' && unzip -o '%s'", safeDir, safeBase)
	} else if strings.HasSuffix(lowerBase, ".tar.gz") || strings.HasSuffix(lowerBase, ".tgz") {
		cmd = fmt.Sprintf("cd '%s' && tar --no-unsafe-paths -xzf '%s'", safeDir, safeBase)
	} else if strings.HasSuffix(lowerBase, ".tar") {
		cmd = fmt.Sprintf("cd '%s' && tar --no-unsafe-paths -xf '%s'", safeDir, safeBase)
	} else if strings.HasSuffix(lowerBase, ".tar.bz2") || strings.HasSuffix(lowerBase, ".tbz2") {
		cmd = fmt.Sprintf("cd '%s' && tar --no-unsafe-paths -xjf '%s'", safeDir, safeBase)
	} else if strings.HasSuffix(lowerBase, ".gz") {
		cmd = fmt.Sprintf("cd '%s' && gunzip -f -k '%s'", safeDir, safeBase)
	} else {
		return fmt.Errorf("unsupported archive format")
	}

	out, err := m.executeCmdWithClient(client, cmd)
	if err != nil {
		return fmt.Errorf("uncompress failed: %w, output: %s", err, out)
	}
	return nil
}
