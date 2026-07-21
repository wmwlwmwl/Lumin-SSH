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
	externalEditMaxSize      = 5 * 1024 * 1024
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
	cancel     chan struct{}
	watcher    *fsnotify.Watcher
}

type ExternalEditManager struct {
	mu       sync.Mutex
	sessions map[string]*externalEditSession
	app      *App
}

func NewExternalEditManager(app *App) *ExternalEditManager {
	return &ExternalEditManager{
		sessions: make(map[string]*externalEditSession),
		app:      app,
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

func (m *ExternalEditManager) Open(sessionID, remotePath, content, editorPath string) (map[string]interface{}, error) {
	sessionID = strings.TrimSpace(sessionID)
	remotePath = strings.TrimSpace(remotePath)
	if sessionID == "" || remotePath == "" {
		return nil, fmt.Errorf("missing session or remote path")
	}
	if m.app == nil || m.app.sshManager == nil {
		return nil, fmt.Errorf("app not ready")
	}

	var data []byte
	if content != "" {
		data = []byte(content)
	} else {
		text, err := m.app.sshManager.ReadFile(sessionID, remotePath)
		if err != nil {
			return nil, err
		}
		data = []byte(text)
	}
	if len(data) > externalEditMaxSize {
		return nil, fmt.Errorf("文件过大 (%.1f MB)，最大支持 5MB 外置编辑", float64(len(data))/(1024*1024))
	}

	localPath, err := m.localPathFor(sessionID, remotePath)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(localPath, data, 0o600); err != nil {
		return nil, err
	}
	contentHash := hashBytes(data)

	key := externalEditKey(sessionID, remotePath)
	m.mu.Lock()
	if existing, ok := m.sessions[key]; ok {
		m.stopSessionLocked(existing, false)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	watchDir := filepath.Dir(localPath)
	if err := watcher.Add(watchDir); err != nil {
		_ = watcher.Close()
		m.mu.Unlock()
		return nil, err
	}

	sess := &externalEditSession{
		key:        key,
		sessionID:  sessionID,
		remotePath: remotePath,
		localPath:  localPath,
		lastHash:   contentHash,
		cancel:     make(chan struct{}),
		watcher:    watcher,
	}
	m.sessions[key] = sess
	m.mu.Unlock()

	go m.watchSession(sess)

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
	}
	m.emit(externalEditEventStarted, payload)
	return payload, nil
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
	if len(data2) > externalEditMaxSize {
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
	defer m.mu.Unlock()
	for _, sess := range m.sessions {
		m.stopSessionLocked(sess, true)
	}
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
