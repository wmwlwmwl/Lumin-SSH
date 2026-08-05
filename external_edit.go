package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	externalEditDebounce     = 800 * time.Millisecond
	externalEditStableWait   = 200 * time.Millisecond
	externalEditEventStarted = "external-edit-started"
	externalEditEventSynced  = "external-edit-synced"
	externalEditEventError   = "external-edit-error"
	externalEditEventStopped = "external-edit-stopped"
)

type externalEditSession struct {
	key        string
	sessionID  string
	remotePath string
	localPath  string
	lastHash   string
	readOnly   bool
	maxBytes   int64
	cancel     chan struct{}
	watcher    *fsnotify.Watcher
}

type ExternalEditManager struct {
	mu       sync.Mutex
	sessions map[string]*externalEditSession
	app      *App
}

func NewExternalEditManager(app *App) *ExternalEditManager {
	m := &ExternalEditManager{
		sessions: make(map[string]*externalEditSession),
		app:      app,
	}
	// Best-effort: clear leftover temp files from previous crashed runs.
	go m.pruneOrphanTemp(0)
	return m
}

// pruneOrphanTemp removes temp dirs that are not tracked by active sessions.
// maxAge=0 means remove all untracked dirs immediately.
func (m *ExternalEditManager) pruneOrphanTemp(maxAge time.Duration) {
	root, err := m.tempRoot()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	activeDirs := map[string]struct{}{}
	m.mu.Lock()
	for _, sess := range m.sessions {
		activeDirs[filepath.Dir(sess.localPath)] = struct{}{}
	}
	m.mu.Unlock()
	now := time.Now()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirPath := filepath.Join(root, entry.Name())
		if _, ok := activeDirs[dirPath]; ok {
			continue
		}
		if maxAge > 0 {
			info, statErr := entry.Info()
			if statErr != nil {
				continue
			}
			if now.Sub(info.ModTime()) < maxAge {
				continue
			}
		}
		_ = os.RemoveAll(dirPath)
	}
}

func externalEditKey(sessionID, remotePath string) string {
	return strings.TrimSpace(sessionID) + "\x00" + strings.TrimSpace(remotePath)
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (m *ExternalEditManager) tempRoot() (string, error) {
	root := filepath.Join(os.TempDir(), "lumin-ssh-external-edit")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	return root, nil
}

func (m *ExternalEditManager) localPathFor(sessionID, remotePath string) (string, error) {
	root, err := m.tempRoot()
	if err != nil {
		return "", err
	}
	base := filepath.Base(strings.TrimSpace(remotePath))
	if base == "" || base == "." || base == string(filepath.Separator) {
		base = "untitled.txt"
	}
	// Keep original extension for editor language detection.
	hash := hashBytes([]byte(sessionID + "|" + remotePath))[:16]
	dir := filepath.Join(root, hash)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(dir, base), nil
}

func (m *ExternalEditManager) emit(event string, payload map[string]interface{}) {
	if m == nil || m.app == nil || m.app.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(m.app.ctx, event, payload)
}

func openWithSystemEditor(localPath string) error {
	return openLocalDocument(localPath)
}

func openWithSpecifiedEditor(editorPath, localPath string) error {
	cleanedEditor := filepath.Clean(strings.TrimSpace(editorPath))
	cleanedFile := filepath.Clean(strings.TrimSpace(localPath))
	if cleanedEditor == "" {
		return fmt.Errorf("missing editor path")
	}
	if _, err := os.Stat(cleanedEditor); err != nil {
		return err
	}
	if _, err := os.Stat(cleanedFile); err != nil {
		return err
	}

	switch runtime.GOOS {
	case "darwin":
		if strings.HasSuffix(strings.ToLower(cleanedEditor), ".app") {
			return exec.Command("open", "-a", cleanedEditor, cleanedFile).Start()
		}
		return exec.Command(cleanedEditor, cleanedFile).Start()
	case "windows":
		return exec.Command(cleanedEditor, cleanedFile).Start()
	default:
		return exec.Command(cleanedEditor, cleanedFile).Start()
	}
}

func (m *ExternalEditManager) Open(sessionID, remotePath, content, editorPath string, readOnly bool, maxBytes int64) (map[string]interface{}, error) {
	sessionID = strings.TrimSpace(sessionID)
	remotePath = strings.TrimSpace(remotePath)
	if sessionID == "" || remotePath == "" {
		return nil, fmt.Errorf("missing session or remote path")
	}
	if m.app == nil || m.app.sshManager == nil {
		return nil, fmt.Errorf("app not ready")
	}
	// 兜底：调用方未传上限时用默认 5MB，避免 0 导致所有文件被拒。
	if maxBytes <= 0 {
		maxBytes = 5 * 1024 * 1024
	}

	var data []byte
	if content != "" {
		data = []byte(content)
	} else {
		// 下载前先 stat 拦截大文件，避免把整个大文件（如几 GB 的 mp4）读进内存后才报错。
		if size, err := m.remoteSize(sessionID, remotePath); err == nil && size > maxBytes {
			return nil, fmt.Errorf("文件过大 (%.1f MB)，最大支持 %.0f MB", float64(size)/(1024*1024), float64(maxBytes)/(1024*1024))
		}
		// 用原始字节而非 ReadFile：ReadFile 会经 b.String() 把非 UTF-8 字节（如 GBK
		// 编码的中文 lua/配置文件）强解为乱码，写入本地临时文件后编辑器打开即乱码。
		// 直接读原始字节，本地文件与远程字节一致，编辑器自己会做编码检测。
		rawBytes, err := m.app.sshManager.ReadFileBytes(sessionID, remotePath)
		if err != nil {
			return nil, err
		}
		data = rawBytes
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("文件过大 (%.1f MB)，最大支持 %.0f MB", float64(len(data))/(1024*1024), float64(maxBytes)/(1024*1024))
	}

	localPath, err := m.localPathFor(sessionID, remotePath)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(localPath, data, 0o600); err != nil {
		return nil, err
	}

	key := externalEditKey(sessionID, remotePath)
	m.mu.Lock()
	if existing, ok := m.sessions[key]; ok {
		m.stopSessionLocked(existing, false)
	}

	// readOnly（媒体类：只下载用系统程序查看，不监听修改、不回写远程）：
	// 不创建 watcher、不启动监听协程。会话仍登记到 sessions 以便统一 Stop/清理临时文件。
	var watcher *fsnotify.Watcher
	if !readOnly {
		w, werr := fsnotify.NewWatcher()
		if werr != nil {
			m.mu.Unlock()
			return nil, werr
		}
		watchDir := filepath.Dir(localPath)
		if err := w.Add(watchDir); err != nil {
			_ = w.Close()
			m.mu.Unlock()
			return nil, err
		}
		watcher = w
	}

	sess := &externalEditSession{
		key:        key,
		sessionID:  sessionID,
		remotePath: remotePath,
		localPath:  localPath,
		lastHash:   hashBytes(data),
		readOnly:   readOnly,
		maxBytes:   maxBytes,
		cancel:     make(chan struct{}),
		watcher:    watcher,
	}
	m.sessions[key] = sess
	m.mu.Unlock()

	if !readOnly {
		go m.watchSession(sess)
	}

	if strings.TrimSpace(editorPath) != "" {
		err = openWithSpecifiedEditor(editorPath, localPath)
	} else {
		err = openWithSystemEditor(localPath)
	}
	if err != nil {
		_ = m.Stop(sessionID, remotePath)
		return nil, fmt.Errorf("打开编辑器失败: %w", err)
	}

	payload := map[string]interface{}{
		"sessionId":  sessionID,
		"remotePath": remotePath,
		"localPath":  localPath,
		"readOnly":   readOnly,
	}
	m.emit(externalEditEventStarted, payload)
	return payload, nil
}

// remoteSize 返回远程文件大小（字节）；stat 失败时返回 0 和错误，调用方可忽略错误走原下载流程。
func (m *ExternalEditManager) remoteSize(sessionID, remotePath string) (int64, error) {
	client, err := m.app.sshManager.getSFTPClient(sessionID)
	if err != nil {
		return 0, err
	}
	info, err := client.Stat(remotePath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func (m *ExternalEditManager) watchSession(sess *externalEditSession) {
	baseName := filepath.Base(sess.localPath)
	var (
		timerMu sync.Mutex
		timer   *time.Timer
	)
	schedule := func() {
		timerMu.Lock()
		defer timerMu.Unlock()
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(externalEditDebounce, func() {
			m.trySync(sess)
		})
	}

	for {
		select {
		case <-sess.cancel:
			timerMu.Lock()
			if timer != nil {
				timer.Stop()
			}
			timerMu.Unlock()
			return
		case err, ok := <-sess.watcher.Errors:
			if !ok {
				return
			}
			if err != nil {
				m.emit(externalEditEventError, map[string]interface{}{
					"sessionId":  sess.sessionID,
					"remotePath": sess.remotePath,
					"error":      err.Error(),
				})
			}
		case event, ok := <-sess.watcher.Events:
			if !ok {
				return
			}
			name := filepath.Base(event.Name)
			// Match target file and common atomic-save side files that end up as the target.
			if name != baseName && !strings.HasPrefix(name, baseName) {
				// Some editors write "file.tmp" then rename to file; also watch rename targets.
				if event.Op&(fsnotify.Rename|fsnotify.Create|fsnotify.Write) == 0 {
					continue
				}
				// If rename creates our target path, still handle.
				if filepath.Clean(event.Name) != filepath.Clean(sess.localPath) {
					continue
				}
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) != 0 {
				schedule()
			}
		}
	}
}

func (m *ExternalEditManager) trySync(sess *externalEditSession) {
	select {
	case <-sess.cancel:
		return
	default:
	}

	// Require two stable reads to avoid half-written files.
	data1, err := os.ReadFile(sess.localPath)
	if err != nil {
		return
	}
	time.Sleep(externalEditStableWait)
	select {
	case <-sess.cancel:
		return
	default:
	}
	data2, err := os.ReadFile(sess.localPath)
	if err != nil {
		return
	}
	if hashBytes(data1) != hashBytes(data2) {
		// Still changing; wait for next event / debounce.
		return
	}
	if int64(len(data2)) > sess.maxBytes {
		m.emit(externalEditEventError, map[string]interface{}{
			"sessionId":  sess.sessionID,
			"remotePath": sess.remotePath,
			"error":      fmt.Sprintf("本地文件过大 (%.1f MB)，跳过回传", float64(len(data2))/(1024*1024)),
		})
		return
	}

	nextHash := hashBytes(data2)
	m.mu.Lock()
	current, ok := m.sessions[sess.key]
	if !ok || current != sess {
		m.mu.Unlock()
		return
	}
	if current.lastHash == nextHash {
		m.mu.Unlock()
		return
	}
	current.lastHash = nextHash
	sessionID := current.sessionID
	remotePath := current.remotePath
	m.mu.Unlock()

	if m.app == nil || m.app.sshManager == nil {
		return
	}
	if err := m.app.sshManager.WriteFile(sessionID, remotePath, string(data2)); err != nil {
		m.emit(externalEditEventError, map[string]interface{}{
			"sessionId":  sessionID,
			"remotePath": remotePath,
			"error":      err.Error(),
		})
		return
	}
	m.emit(externalEditEventSynced, map[string]interface{}{
		"sessionId":  sessionID,
		"remotePath": remotePath,
		"bytes":      len(data2),
	})
}

func (m *ExternalEditManager) stopSessionLocked(sess *externalEditSession, removeFiles bool) {
	if sess == nil {
		return
	}
	select {
	case <-sess.cancel:
	default:
		close(sess.cancel)
	}
	if sess.watcher != nil {
		_ = sess.watcher.Close()
	}
	delete(m.sessions, sess.key)
	if removeFiles {
		_ = os.Remove(sess.localPath)
		_ = os.Remove(filepath.Dir(sess.localPath))
	}
	m.emit(externalEditEventStopped, map[string]interface{}{
		"sessionId":  sess.sessionID,
		"remotePath": sess.remotePath,
		"localPath":  sess.localPath,
	})
}

func (m *ExternalEditManager) Stop(sessionID, remotePath string) error {
	key := externalEditKey(sessionID, remotePath)
	m.mu.Lock()
	defer m.mu.Unlock()
	sess, ok := m.sessions[key]
	if !ok {
		return nil
	}
	m.stopSessionLocked(sess, true)
	return nil
}

func (m *ExternalEditManager) StopSession(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, sess := range m.sessions {
		if sess.sessionID == sessionID {
			m.stopSessionLocked(sess, true)
			_ = key
		}
	}
}

func (m *ExternalEditManager) StopAll() {
	m.mu.Lock()
	for _, sess := range m.sessions {
		m.stopSessionLocked(sess, true)
	}
	m.mu.Unlock()
	m.pruneOrphanTemp(0)
}

func (m *ExternalEditManager) List() []map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]map[string]interface{}, 0, len(m.sessions))
	for _, sess := range m.sessions {
		out = append(out, map[string]interface{}{
			"sessionId":  sess.sessionID,
			"remotePath": sess.remotePath,
			"localPath":  sess.localPath,
		})
	}
	return out
}
