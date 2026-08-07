package wsbuffer

import (
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newWsPair 建立一对真实 WebSocket 连接：服务端 conn 包装成 Entry 供被测代码写入，
// 客户端 conn 用于接收断言。
func newWsPair(t *testing.T) (*Entry, *websocket.Conn, func()) {
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
	return &Entry{conn: server}, client, cleanup
}

// 首帧在 WS 注册前到达时必须缓冲而不是丢弃（本地终端首屏空白根因）。
func TestWriteOutputBuffersBeforeRegistration(t *testing.T) {
	m := NewManager()
	m.WriteOutput("s1", []byte("prompt$ "))

	m.mu.Lock()
	p := m.pending["s1"]
	m.mu.Unlock()
	if p == nil || string(p.data) != "prompt$ " {
		t.Fatalf("首帧未缓冲, got %+v", p)
	}
}

// 注册后 flush：客户端必须先收到缓冲首帧、再收到实时数据，顺序不能乱。
func TestWriteOutputFlushPendingOnRegistration(t *testing.T) {
	m := NewManager()
	m.WriteOutput("s1", []byte("first-frame"))

	entry, client, cleanup := newWsPair(t)
	defer cleanup()

	// 模拟 startup handler 的注册顺序：先写 map，再 flush
	m.mu.Lock()
	m.conns["s1"] = entry
	m.mu.Unlock()
	m.FlushPending("s1")
	m.WriteOutput("s1", []byte("live"))

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
	m.mu.Lock()
	_, still := m.pending["s1"]
	m.mu.Unlock()
	if still {
		t.Fatal("flush 后 pending 未清理")
	}
}

// 缓冲必须有上限，防止前端永不连接时无限增长。
func TestBufferPendingCap(t *testing.T) {
	m := NewManager()
	big := make([]byte, MaxPendingBytes+1024)
	m.bufferPending("s1", big)

	m.mu.Lock()
	n := len(m.pending["s1"].data)
	m.mu.Unlock()
	if n != MaxPendingBytes {
		t.Fatalf("缓冲应截断到 %d, got %d", MaxPendingBytes, n)
	}
}

// 会话彻底销毁时必须清理其 pending 缓冲，避免 map 残留泄漏。
func TestCleanupPendingRemovesEntry(t *testing.T) {
	m := NewManager()
	m.WriteOutput("s1", []byte("orphaned-frame"))

	m.CleanupPending("s1")

	m.mu.Lock()
	_, still := m.pending["s1"]
	m.mu.Unlock()
	if still {
		t.Fatal("CleanupPending 后 pending 仍残留")
	}
}
