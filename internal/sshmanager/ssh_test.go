package sshmanager

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"slices"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestHostKeyAlgorithmsForConnection(t *testing.T) {
	defaultAlgorithms := hostKeyAlgorithmsForConnection(Connection{})
	if slices.Contains(defaultAlgorithms, ssh.KeyAlgoRSA) {
		t.Fatal("默认连接不应启用旧版 ssh-rsa 主机密钥算法")
	}

	legacyAlgorithms := hostKeyAlgorithmsForConnection(Connection{AllowLegacySSHRSA: true})
	if legacyAlgorithms[len(legacyAlgorithms)-1] != ssh.KeyAlgoRSA {
		t.Fatalf("启用兼容选项后应在现代算法之后追加 ssh-rsa，实际为 %#v", legacyAlgorithms)
	}
	if slices.Contains(sshHostKeyAlgorithms, ssh.KeyAlgoRSA) {
		t.Fatal("单服务器兼容选项不应修改全局默认算法")
	}
}

func newTestSSHClient(t *testing.T, reply *bool) (*ssh.Client, net.Conn) {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig := &ssh.ServerConfig{NoClientAuth: true}
	serverConfig.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		server, channels, requests, serverErr := ssh.NewServerConn(conn, serverConfig)
		if serverErr != nil {
			conn.Close()
			return
		}
		defer server.Close()
		go func() {
			for newChannel := range channels {
				if newChannel.ChannelType() != "session" {
					newChannel.Reject(ssh.UnknownChannelType, "测试服务不支持通道")
					continue
				}
				channel, channelRequests, acceptErr := newChannel.Accept()
				if acceptErr != nil {
					continue
				}
				go func() {
					defer channel.Close()
					for request := range channelRequests {
						_ = request.Reply(true, nil)
						if request.Type == "shell" || request.Type == "exec" {
							return
						}
					}
				}()
			}
		}()
		for request := range requests {
			if reply != nil {
				_ = request.Reply(*reply, nil)
			}
		}
	}()
	clientConn, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err != nil {
		listener.Close()
		t.Fatal(err)
	}
	config := &ssh.ClientConfig{
		User:            "test",
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         time.Second,
	}
	sshConn, channels, requests, err := ssh.NewClientConn(clientConn, listener.Addr().String(), config)
	if err != nil {
		clientConn.Close()
		listener.Close()
		t.Fatal(err)
	}
	client := ssh.NewClient(sshConn, channels, requests)
	t.Cleanup(func() {
		client.Close()
		clientConn.Close()
		listener.Close()
		select {
		case <-serverDone:
		case <-time.After(time.Second):
			t.Error("测试 SSH 服务未退出")
		}
	})
	return client, clientConn
}

func TestClientKeepaliveTimeoutDoesNotCleanOnSingleFailure(t *testing.T) {
	client, netConn := newTestSSHClient(t, nil)
	manager := NewSSHManager()
	manager.clients["server"] = &sshClientEntry{Client: client, NetConn: netConn}
	manager.connTerminals["server"] = []string{"terminal-1", "terminal-2"}
	manager.sessions["terminal-1"] = &SessionData{ConnKey: "server"}
	manager.sessions["terminal-2"] = &SessionData{ConnKey: "server"}

	started := time.Now()
	tracked, probeOK := manager.checkClientKeepalive("server", client, 50*time.Millisecond)
	if time.Since(started) > time.Second {
		t.Fatal("保活超时未在限定时间内结束")
	}
	if !tracked || probeOK {
		t.Fatalf("无响应超时应 tracked=true probeOK=false，实际 tracked=%v probeOK=%v", tracked, probeOK)
	}
	fails, stop := manager.handleKeepaliveProbeResult("server", client, 0, tracked, probeOK)
	if stop || fails != 1 {
		t.Fatalf("单次失败不应拆线: fails=%d stop=%v", fails, stop)
	}
	if len(manager.clients) != 1 || len(manager.sessions) != 2 {
		t.Fatalf("单次超时不应清理连接: clients=%d sessions=%d", len(manager.clients), len(manager.sessions))
	}
}

func TestClientKeepaliveConsecutiveFailuresCleanSharedConnection(t *testing.T) {
	client, netConn := newTestSSHClient(t, nil)
	manager := NewSSHManager()
	manager.clients["server"] = &sshClientEntry{Client: client, NetConn: netConn}
	manager.connTerminals["server"] = []string{"terminal-1", "terminal-2"}
	manager.sessions["terminal-1"] = &SessionData{ConnKey: "server"}
	manager.sessions["terminal-2"] = &SessionData{ConnKey: "server"}

	fails := 0
	for i := 0; i < sshKeepaliveFailMax; i++ {
		tracked, probeOK := manager.checkClientKeepalive("server", client, 50*time.Millisecond)
		if !tracked || probeOK {
			t.Fatalf("第 %d 次超时期望 tracked=true probeOK=false", i+1)
		}
		var stop bool
		fails, stop = manager.handleKeepaliveProbeResult("server", client, fails, tracked, probeOK)
		if i < sshKeepaliveFailMax-1 {
			if stop {
				t.Fatalf("第 %d 次失败不应结束 watch", i+1)
			}
			continue
		}
		if !stop || fails < sshKeepaliveFailMax {
			t.Fatalf("达到失败阈值应拆线: fails=%d stop=%v", fails, stop)
		}
	}
	if len(manager.clients) != 0 || len(manager.connTerminals) != 0 || len(manager.sessions) != 0 {
		t.Fatalf("连接清理不完整: clients=%d terminals=%d sessions=%d", len(manager.clients), len(manager.connTerminals), len(manager.sessions))
	}
}

func TestHandleKeepaliveProbeResultResetsOnSuccess(t *testing.T) {
	manager := NewSSHManager()
	fails, stop := manager.handleKeepaliveProbeResult("server", nil, 2, true, true)
	if stop || fails != 0 {
		t.Fatalf("探活成功应清零失败计数: fails=%d stop=%v", fails, stop)
	}
	fails, stop = manager.handleKeepaliveProbeResult("server", nil, 1, false, false)
	if !stop {
		t.Fatal("未跟踪的 client 应结束 watch")
	}
	_ = fails
}

func TestClientKeepaliveRejectionKeepsConnection(t *testing.T) {
	reply := false
	client, netConn := newTestSSHClient(t, &reply)
	manager := NewSSHManager()
	manager.clients["server"] = &sshClientEntry{Client: client, NetConn: netConn}
	manager.connTerminals["server"] = []string{"terminal"}
	manager.sessions["terminal"] = &SessionData{ConnKey: "server"}

	tracked, probeOK := manager.checkClientKeepalive("server", client, time.Second)
	if !tracked || !probeOK {
		t.Fatalf("服务端拒绝未知保活请求仍应证明 SSH 传输存活: tracked=%v probeOK=%v", tracked, probeOK)
	}
	fails, stop := manager.handleKeepaliveProbeResult("server", client, 2, tracked, probeOK)
	if stop || fails != 0 {
		t.Fatalf("成功探活后不应拆线: fails=%d stop=%v", fails, stop)
	}
	if manager.clients["server"].Client != client || manager.sessions["terminal"] == nil {
		t.Fatal("成功收到保活响应后不应清理连接")
	}
}

func TestSessionWaitDisconnectsSession(t *testing.T) {
	reply := false
	client, netConn := newTestSSHClient(t, &reply)
	manager := NewSSHManager()
	manager.clients["server"] = &sshClientEntry{Client: client, NetConn: netConn}
	manager.connTerminals["server"] = []string{}
	if err := manager.setupSession(context.Background(), client, "server", "terminal", "", "", false, "", "", ""); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(time.Second)
	for {
		manager.mu.RLock()
		_, exists := manager.sessions["terminal"]
		manager.mu.RUnlock()
		if !exists {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("远端 session 结束后未及时清理终端")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestStaleClientCleanupKeepsReplacement(t *testing.T) {
	manager := NewSSHManager()
	oldClient := &ssh.Client{}
	newClient := &ssh.Client{}
	manager.clients["server"] = &sshClientEntry{Client: newClient}
	manager.connTerminals["server"] = []string{"terminal"}
	manager.sessions["terminal"] = &SessionData{ConnKey: "server"}

	manager.cleanupClientTransport("server", oldClient, "transport")
	if manager.clients["server"].Client != newClient || manager.sessions["terminal"] == nil {
		t.Fatal("旧连接的迟到清理不应删除快速重连后的新连接")
	}
}

func TestDisconnectPreservesSharedClient(t *testing.T) {
	manager := NewSSHManager()
	client := &ssh.Client{}
	manager.clients["server"] = &sshClientEntry{Client: client}
	manager.connTerminals["server"] = []string{"terminal-1", "terminal-2"}
	manager.sessions["terminal-1"] = &SessionData{ConnKey: "server"}
	manager.sessions["terminal-2"] = &SessionData{ConnKey: "server"}

	if !manager.Disconnect("terminal-1") {
		t.Fatal("首次断开已登记终端应成功")
	}
	if manager.Disconnect("terminal-1") {
		t.Fatal("重复断开同一终端应保持幂等")
	}
	if manager.clients["server"].Client != client || manager.sessions["terminal-2"] == nil {
		t.Fatal("断开一个终端不应关闭仍被其他终端复用的 client")
	}
}

func TestOutputTapConcurrentClose(t *testing.T) {
	manager := NewSSHManager()
	_, channel, cancel := manager.registerSessionOutputTap("terminal")
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		for i := 0; i < 1000; i++ {
			manager.emitSessionOutput("terminal", []byte("output"))
		}
	}()
	go func() {
		defer wait.Done()
		manager.closeSessionOutputTaps("terminal")
		cancel()
	}()
	wait.Wait()
	for range channel {
	}
}

// 复现「只接受本次 → 密码错误 → 填对密码 → 主机密钥确认二次弹出」。
// Disconnect 会清掉临时密钥授权，但换密码重连仍是同一会话，须跨重连保留。
func TestTempAcceptedKeySurvivesPasswordReconnect(t *testing.T) {
	manager := NewSSHManager()
	const sessionId = "terminal"
	const fingerprint = "SHA256:test-fingerprint"

	// 用户选了「只接受本次」
	manager.RestoreTempAcceptedKey(sessionId, fingerprint)

	// 登记会话让 Disconnect 走到真正的清理分支。留一个兄弟终端占用同一
	// client，避免走到关闭共享连接的分支（空 ssh.Client 无法 Close）。
	manager.clients["server"] = &sshClientEntry{Client: &ssh.Client{}}
	manager.connTerminals["server"] = []string{sessionId, "sibling"}
	manager.sessions[sessionId] = &SessionData{ConnKey: "server"}
	manager.sessions["sibling"] = &SessionData{ConnKey: "server"}

	// ReconnectWithPassword 的做法：Disconnect 前后保存并恢复
	saved, had := manager.TempAcceptedKey(sessionId)
	if !had || saved != fingerprint {
		t.Fatalf("应能读回临时密钥，实际 had=%v fp=%q", had, saved)
	}
	manager.Disconnect(sessionId)

	if _, stillThere := manager.TempAcceptedKey(sessionId); stillThere {
		t.Fatal("Disconnect 应清掉临时密钥（这正是需要跨重连恢复的原因）")
	}
	manager.RestoreTempAcceptedKey(sessionId, saved)

	// 重连后主机密钥校验应仍被临时授权放行，不再二次要求确认
	got, ok := manager.TempAcceptedKey(sessionId)
	if !ok || got != fingerprint {
		t.Fatalf("换密码重连后临时密钥授权应保留，实际 ok=%v fp=%q", ok, got)
	}

	// 重连最终失败（非认证失败）时须清除，避免残留静默绕过校验
	manager.ClearTempAcceptedKey(sessionId)
	if _, leaked := manager.TempAcceptedKey(sessionId); leaked {
		t.Fatal("清除后不应残留临时密钥")
	}
}

// 握手失败的会话从未进入 m.sessions，Disconnect 会在 ok 判断处提前返回。
// 临时密钥与待确认条目必须先于该返回清理，否则「只接受本次 → 密码错误 →
// 取消」这条路径会永久残留条目。
func TestDisconnectClearsTempKeyForNeverEstablishedSession(t *testing.T) {
	manager := NewSSHManager()
	const sessionId = "never-established"

	manager.tempAcceptedKeys[sessionId] = "SHA256:test-fingerprint"
	manager.pendingHostKeys[sessionId] = &PendingHostKey{Hostname: "example.com"}

	// 没有 m.sessions 条目，Disconnect 返回 false（幂等语义不变）
	if manager.Disconnect(sessionId) {
		t.Fatal("未建立的会话断开应返回 false")
	}

	manager.mu.RLock()
	_, tempLeaked := manager.tempAcceptedKeys[sessionId]
	_, pendingLeaked := manager.pendingHostKeys[sessionId]
	manager.mu.RUnlock()

	if tempLeaked {
		t.Fatal("未建立的会话断开后临时密钥泄漏")
	}
	if pendingLeaked {
		t.Fatal("未建立的会话断开后待确认条目泄漏")
	}
}

// 认证失败必须是可判定的 sentinel，否则「只接受本次」会在密码输错时
// 连带丢弃临时授权，导致主机密钥确认二次弹出。
func TestAuthFailedIsIdentifiableSentinel(t *testing.T) {
	if !errors.Is(ErrAuthFailed, ErrAuthFailed) {
		t.Fatal("ErrAuthFailed 应可被 errors.Is 判定")
	}
	// 前端按文案 includes('认证失败') 分流，文案不能改
	if ErrAuthFailed.Error() != "认证失败" {
		t.Fatalf("文案变更会破坏前端认证失败分流，实际 %q", ErrAuthFailed.Error())
	}
	if errors.Is(ErrHostKeyChanged, ErrAuthFailed) {
		t.Fatal("主机密钥变更不应被判定为认证失败")
	}
}
