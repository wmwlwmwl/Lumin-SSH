package wsbuffer

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// 每 session 首帧缓冲上限与过期时间
const MaxPendingBytes = 256 * 1024
const MaxPendingAge = 30 * time.Second

// Entry 包装一个 WebSocket 连接及其独立写锁。
// mu 仅保护 map 增删改查；写消息时用每连接独立锁，避免慢客户端阻塞其他 session。
type Entry struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

// pendingBuf 缓冲 WS 注册前到达的输出（本地终端启动极快，PTY 首帧提示符
// 往往早于前端 WS 注册到达；直接丢弃会表现为「首屏空白，回车才出提示符」）。
// firstAt 用于过期：前端始终不连接时过期作废，避免陈旧数据在之后误 flush。
type pendingBuf struct {
	data    []byte
	firstAt time.Time
}

// Manager 管理 WebSocket 连接注册与注册前输出缓冲。
type Manager struct {
	mu      sync.Mutex
	conns   map[string]*Entry
	pending map[string]*pendingBuf
}

func NewManager() *Manager {
	return &Manager{
		conns:   make(map[string]*Entry),
		pending: make(map[string]*pendingBuf),
	}
}

// Register 注册一个 WebSocket 连接，返回 Entry 供后续 Unregister 使用。
// 同 session 重连时自动关闭被覆盖的旧连接。
func (m *Manager) Register(sessionId string, conn *websocket.Conn) *Entry {
	entry := &Entry{conn: conn}
	m.mu.Lock()
	if old := m.conns[sessionId]; old != nil {
		go old.conn.Close()
	}
	m.conns[sessionId] = entry
	m.mu.Unlock()
	return entry
}

// Unregister 移除会话连接，仅当 entry 匹配时生效（避免误删新连接）。
func (m *Manager) Unregister(sessionId string, entry *Entry) {
	m.mu.Lock()
	if cur, ok := m.conns[sessionId]; ok && cur == entry {
		delete(m.conns, sessionId)
	}
	m.mu.Unlock()
}

// FlushPending 在 WS 注册时把注册前缓冲 flush 给新连接。
// 与 WriteOutput 的取缓冲操作同在 mu 下原子完成，二者只会有一方取到，
// 因此「flush 路径」与「注册后首条实时数据路径」不会重复或乱序。
func (m *Manager) FlushPending(sessionId string) {
	m.mu.Lock()
	entry, ok := m.conns[sessionId]
	var pending []byte
	if ok && entry != nil {
		if p := m.pending[sessionId]; p != nil {
			pending = p.data
			delete(m.pending, sessionId)
		}
	}
	m.mu.Unlock()
	if !ok || entry == nil || len(pending) == 0 {
		return
	}
	m.writeFrame(sessionId, entry, pending)
}

// WriteOutput 将数据写入指定 session 的 WS 连接；连接未注册时缓冲而非丢弃。
func (m *Manager) WriteOutput(sessionId string, data []byte) {
	m.mu.Lock()
	entry, ok := m.conns[sessionId]
	var pending []byte
	if ok && entry != nil {
		if p := m.pending[sessionId]; p != nil {
			pending = p.data
			delete(m.pending, sessionId)
		}
	}
	m.mu.Unlock()

	if !ok || entry == nil {
		if len(data) > 0 {
			m.bufferPending(sessionId, data)
		}
		return
	}

	// 先写缓冲首帧再写当前数据，保证前端帧顺序
	if len(pending) > 0 {
		m.writeFrame(sessionId, entry, pending)
	}
	if len(data) > 0 {
		m.writeFrame(sessionId, entry, data)
	}
}

// CleanupPending 在会话彻底销毁时清理其注册前缓冲，避免 pending map 残留。
// 注意：不能在单条 WS 重连时调用——重连期间 PTY 可能仍在向 pending 缓冲首帧，
// 那些数据需要留给新连接 flush。仅在 session 彻底断开时调用。
func (m *Manager) CleanupPending(sessionId string) {
	m.mu.Lock()
	delete(m.pending, sessionId)
	m.mu.Unlock()
}

// bufferPending 在 mu 下累积注册前输出，带上限与过期保护。
func (m *Manager) bufferPending(sessionId string, data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.pending[sessionId]
	if p == nil || time.Since(p.firstAt) > MaxPendingAge {
		p = &pendingBuf{firstAt: time.Now()}
		m.pending[sessionId] = p
	}
	if len(p.data) >= MaxPendingBytes {
		return // 已达上限：只保留头部首帧数据
	}
	if remain := MaxPendingBytes - len(p.data); len(data) > remain {
		data = data[:remain]
	}
	p.data = append(p.data, data...)
}

// writeFrame 在连接独立写锁下写一帧二进制消息；写失败时移除并关闭连接。
func (m *Manager) writeFrame(sessionId string, entry *Entry, data []byte) {
	entry.writeMu.Lock()
	defer entry.writeMu.Unlock()
	entry.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err := entry.conn.WriteMessage(websocket.BinaryMessage, data)
	if err != nil {
		m.mu.Lock()
		// 二次校验：可能已被其他 goroutine 替换或移除
		if cur, ok := m.conns[sessionId]; ok && cur == entry {
			delete(m.conns, sessionId)
		}
		m.mu.Unlock()
		entry.conn.Close()
	}
}
