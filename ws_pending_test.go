package main

import (
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newWsPair 建立一对真实 WebSocket 连接：服务端 conn 包装成 wsEntry 供被测代码写入，
// 客户端 conn 用于接收断言。
func newWsPair(t *testing.T) (*wsEntry, *websocket.Conn, func()) {
	t.Helper()
	upgrader := websocket.Upgrader{}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	serverCh := make(chan *websocket.Conn, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		c, upErr := upgrader.Upgrade(w, r, nil)
		if upErr != nil {
			return
		}
		serverCh <- c
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()

	client, _, err := websocket.DefaultDialer.Dial("ws://"+ln.Addr().String()+"/", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	var server *websocket.Conn
	select {
	case server = <-serverCh:
	case <-time.After(2 * time.Second):
		t.Fatal("server side upgrade timeout")
	}
	cleanup := func() {
		_ = client.Close()
		_ = server.Close()
		_ = srv.Close()
		_ = ln.Close()
	}
	return &wsEntry{conn: server}, client, cleanup
}

func newTestAppWithWs() *App {
	return &App{
		wsConns:   make(map[string]*wsEntry),
		wsPending: make(map[string]*wsPendingBuf),
	}
}

// 首帧在 WS 注册前到达时必须缓冲而不是丢弃（本地终端首屏空白根因）。
func TestWriteWsOutputBuffersBeforeRegistration(t *testing.T) {
	a := newTestAppWithWs()
	a.WriteWsOutput("s1", []byte("prompt$ "))

	a.wsMu.Lock()
	p := a.wsPending["s1"]
	a.wsMu.Unlock()
	if p == nil || string(p.data) != "prompt$ " {
		t.Fatalf("首帧未缓冲, got %+v", p)
	}
}

// 注册后 flush：客户端必须先收到缓冲首帧、再收到实时数据，顺序不能乱。
func TestWriteWsOutputFlushPendingOnRegistration(t *testing.T) {
	a := newTestAppWithWs()
	a.WriteWsOutput("s1", []byte("first-frame"))

	entry, client, cleanup := newWsPair(t)
	defer cleanup()

	// 模拟 startup handler 的注册顺序：先写 map，再 flush
	a.wsMu.Lock()
	a.wsConns["s1"] = entry
	a.wsMu.Unlock()
	a.flushPendingWsOutput("s1")
	a.WriteWsOutput("s1", []byte("live"))

	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, m1, err := client.ReadMessage()
	if err != nil || string(m1) != "first-frame" {
		t.Fatalf("第 1 帧应为缓冲首帧, got %q err=%v", m1, err)
	}
	_, m2, err := client.ReadMessage()
	if err != nil || string(m2) != "live" {
		t.Fatalf("第 2 帧应为实时数据, got %q err=%v", m2, err)
	}

	// flush 后缓冲应被清空
	a.wsMu.Lock()
	_, still := a.wsPending["s1"]
	a.wsMu.Unlock()
	if still {
		t.Fatal("flush 后 wsPending 未清理")
	}
}

// 缓冲必须有上限，防止前端永不连接时无限增长。
func TestBufferPendingWsOutputCap(t *testing.T) {
	a := newTestAppWithWs()
	big := make([]byte, wsPendingMaxBytes+1024)
	a.bufferPendingWsOutput("s1", big)

	a.wsMu.Lock()
	n := len(a.wsPending["s1"].data)
	a.wsMu.Unlock()
	if n != wsPendingMaxBytes {
		t.Fatalf("缓冲应截断到 %d, got %d", wsPendingMaxBytes, n)
	}
}

// 会话彻底销毁时必须清理其 pending 缓冲，避免 map 残留泄漏。
func TestCleanupWsPendingRemovesEntry(t *testing.T) {
	a := newTestAppWithWs()
	a.WriteWsOutput("s1", []byte("orphaned-frame"))

	a.CleanupWsPending("s1")

	a.wsMu.Lock()
	_, still := a.wsPending["s1"]
	a.wsMu.Unlock()
	if still {
		t.Fatal("CleanupWsPending 后 wsPending 仍残留")
	}
}
