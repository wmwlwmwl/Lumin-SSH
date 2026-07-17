package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
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

func TestClientKeepaliveTimeoutCleansSharedConnection(t *testing.T) {
	client, netConn := newTestSSHClient(t, nil)
	manager := NewSSHManager()
	manager.clients["server"] = &sshClientEntry{Client: client, NetConn: netConn}
	manager.connTerminals["server"] = []string{"terminal-1", "terminal-2"}
	manager.sessions["terminal-1"] = &SessionData{ConnKey: "server"}
	manager.sessions["terminal-2"] = &SessionData{ConnKey: "server"}

	started := time.Now()
	if manager.checkClientKeepalive("server", client, 50*time.Millisecond) {
		t.Fatal("无响应的保活不应被判定为存活")
	}
	if time.Since(started) > time.Second {
		t.Fatal("保活超时未在限定时间内结束")
	}
	if len(manager.clients) != 0 || len(manager.connTerminals) != 0 || len(manager.sessions) != 0 {
		t.Fatalf("连接清理不完整: clients=%d terminals=%d sessions=%d", len(manager.clients), len(manager.connTerminals), len(manager.sessions))
	}
}

func TestClientKeepaliveRejectionKeepsConnection(t *testing.T) {
	reply := false
	client, netConn := newTestSSHClient(t, &reply)
	manager := NewSSHManager()
	manager.clients["server"] = &sshClientEntry{Client: client, NetConn: netConn}
	manager.connTerminals["server"] = []string{"terminal"}
	manager.sessions["terminal"] = &SessionData{ConnKey: "server"}

	if !manager.checkClientKeepalive("server", client, time.Second) {
		t.Fatal("服务端拒绝未知保活请求仍应证明 SSH 传输存活")
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
	if err := manager.setupSession(context.Background(), client, "server", "terminal", "", "", false, "", ""); err != nil {
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

	manager.cleanupClientTransport("server", oldClient)
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
