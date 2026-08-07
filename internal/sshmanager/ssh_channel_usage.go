package sshmanager

import (
	"strconv"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const defaultSSHMaxSessions = 10

type sshChannelUsage struct {
	Terminals   int `json:"terminals"`
	SharedSFTP  int `json:"sharedSftp"`
	UploadPool  int `json:"uploadPool"`
	Total       int `json:"total"`
	MaxSessions int `json:"maxSessions"`
}

type sshChannelUsageTracker struct {
	mu           sync.Mutex
	uploadPool   map[string]int
	maxSessions  map[string]int
	probedLimits map[string]bool
}

var globalSSHChannelUsage = &sshChannelUsageTracker{
	uploadPool:   make(map[string]int),
	maxSessions:  make(map[string]int),
	probedLimits: make(map[string]bool),
}

func (t *sshChannelUsageTracker) addUploadChannels(connKey string, delta int) {
	if connKey == "" || delta == 0 {
		return
	}
	t.mu.Lock()
	next := t.uploadPool[connKey] + delta
	if next <= 0 {
		delete(t.uploadPool, connKey)
	} else {
		t.uploadPool[connKey] = next
	}
	t.mu.Unlock()
}

func (t *sshChannelUsageTracker) uploadChannels(connKey string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.uploadPool[connKey]
}

func (t *sshChannelUsageTracker) setMaxSessions(connKey string, limit int) {
	if connKey == "" || limit <= 0 {
		return
	}
	t.mu.Lock()
	t.maxSessions[connKey] = limit
	t.mu.Unlock()
}

func (t *sshChannelUsageTracker) getMaxSessions(connKey string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	if limit, ok := t.maxSessions[connKey]; ok && limit > 0 {
		return limit
	}
	return defaultSSHMaxSessions
}

func (t *sshChannelUsageTracker) markLimitProbed(connKey string) bool {
	if connKey == "" {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.probedLimits[connKey] {
		return false
	}
	t.probedLimits[connKey] = true
	return true
}

func (t *sshChannelUsageTracker) forget(connKey string) {
	if connKey == "" {
		return
	}
	t.mu.Lock()
	delete(t.uploadPool, connKey)
	delete(t.maxSessions, connKey)
	delete(t.probedLimits, connKey)
	t.mu.Unlock()
}

func parseSSHMaxSessionsOutput(output string) int {
	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		lower := strings.ToLower(line)
		if !strings.HasPrefix(lower, "maxsessions") {
			continue
		}
		fields := strings.FieldsFunc(line, func(r rune) bool {
			return r == ' ' || r == '\t' || r == '='
		})
		if len(fields) < 2 {
			continue
		}
		if parsed, err := strconv.Atoi(strings.TrimSpace(fields[len(fields)-1])); err == nil && parsed > 0 {
			return parsed
		}
	}
	return 0
}

func (m *SSHManager) collectSSHChannelUsage(connKey string) sshChannelUsage {
	usage := sshChannelUsage{}
	if connKey == "" {
		usage.MaxSessions = defaultSSHMaxSessions
		return usage
	}
	m.mu.RLock()
	usage.Terminals = len(m.connTerminals[connKey])
	if entry, ok := m.clients[connKey]; ok && entry.SFTP != nil {
		usage.SharedSFTP = 1
	}
	m.mu.RUnlock()
	usage.UploadPool = globalSSHChannelUsage.uploadChannels(connKey)
	usage.Total = usage.Terminals + usage.SharedSFTP + usage.UploadPool
	usage.MaxSessions = globalSSHChannelUsage.getMaxSessions(connKey)
	return usage
}

func (m *SSHManager) ConnKeyForSession(sessionId string) string {
	if strings.TrimSpace(sessionId) == "" {
		return ""
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if session, ok := m.sessions[sessionId]; ok && session != nil {
		return session.ConnKey
	}
	return ""
}

func (m *SSHManager) sessionIdsForConnKey(connKey string) []string {
	if connKey == "" {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	terminals := m.connTerminals[connKey]
	result := make([]string, len(terminals))
	copy(result, terminals)
	return result
}

func (m *SSHManager) emitSSHChannelUsage(connKey string) {
	if m.ctx == nil || connKey == "" {
		return
	}
	usage := m.collectSSHChannelUsage(connKey)
	sessionIds := m.sessionIdsForConnKey(connKey)
	runtime.EventsEmit(m.ctx, "ssh-channel-usage", map[string]interface{}{
		"connKey":     connKey,
		"sessionIds":  sessionIds,
		"terminals":   usage.Terminals,
		"sharedSftp":  usage.SharedSFTP,
		"uploadPool":  usage.UploadPool,
		"total":       usage.Total,
		"maxSessions": usage.MaxSessions,
	})
}

func (m *SSHManager) emitSSHChannelUsageForSession(sessionId string) {
	m.emitSSHChannelUsage(m.ConnKeyForSession(sessionId))
}

func (m *SSHManager) trackUploadChannelDelta(sessionId string, delta int) {
	connKey := m.ConnKeyForSession(sessionId)
	if connKey == "" {
		return
	}
	globalSSHChannelUsage.addUploadChannels(connKey, delta)
	m.emitSSHChannelUsage(connKey)
}

func (m *SSHManager) probeSSHMaxSessions(connKey string) {
	if !globalSSHChannelUsage.markLimitProbed(connKey) {
		return
	}
	m.mu.RLock()
	entry, ok := m.clients[connKey]
	m.mu.RUnlock()
	if !ok || entry == nil || entry.Client == nil {
		return
	}
	command := "sshd -T 2>/dev/null | grep -i '^maxsessions' || grep -iE '^[[:space:]]*MaxSessions' /etc/ssh/sshd_config 2>/dev/null || true"
	output, err := m.executeCmdWithClient(entry.Client, command)
	if err != nil {
		return
	}
	if limit := parseSSHMaxSessionsOutput(output); limit > 0 {
		globalSSHChannelUsage.setMaxSessions(connKey, limit)
		m.emitSSHChannelUsage(connKey)
	}
}

func (m *SSHManager) GetSSHChannelUsage(sessionId string) map[string]interface{} {
	usage := m.collectSSHChannelUsage(m.ConnKeyForSession(sessionId))
	return map[string]interface{}{
		"terminals":   usage.Terminals,
		"sharedSftp":  usage.SharedSFTP,
		"uploadPool":  usage.UploadPool,
		"total":       usage.Total,
		"maxSessions": usage.MaxSessions,
	}
}