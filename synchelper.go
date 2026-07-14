package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

	ai "luminssh-go/internal/ai"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ─── 通用接口 ─────────────────────────────────────────────

// RemoteFile 远端文件元信息
type RemoteFile struct {
	Name    string
	ModTime time.Time
	IsDir   bool
	Size    int64
}

// RemoteStorage 远端存储接口，各提供商只需实现这四个方法 + 提供加密密钥
type RemoteStorage interface {
	ListFiles() ([]RemoteFile, error)
	ReadFile(name string) ([]byte, error)
	WriteFile(name string, data []byte) error
	DeleteFile(name string) error
	EncryptKey() []byte
}

// maxBackupsProvider 是可选接口：后端若实现 MaxBackups()，syncFromProvider 在
// 同步后触发备份时会使用该值清理旧备份。未实现者（如 webdavStorage）保持原行为（不清理）。
type maxBackupsProvider interface {
	MaxBackups() int
}

// storageCloser 是可选接口：后端若持有需要显式释放的底层连接（如 SFTP/FTP），
// 调用方应在使用完毕后 defer Close() 以避免连接泄漏。webdav/r2 等基于 HTTP 的后端无需实现。
type storageCloser interface {
	Close() error
}

// ─── 同步快照 ─────────────────────────────────────────────

// SyncSnapshot 同步快照，包含连接和快捷命令等所有可同步数据
type SyncSnapshot struct {
	Connections         []Connection           `json:"connections"`
	Credentials         []Credential           `json:"credentials"`
	QuickCommands       string                 `json:"quick_commands"`
	AIProviders         []ai.AIProviderProfile `json:"ai_providers"`
	AIGlobalSettings    *ai.AIGlobalSettings   `json:"ai_global_settings"`
	ProxyNodes          []ai.AIProxyNode       `json:"proxy_nodes"`
	SnapshotTime        int64                  `json:"snapshot_time,omitempty"` // 快照总时间戳（Unix 毫秒），用于判断同步方向
	HasCredentials      bool                   `json:"-"`
	HasQuickCommands    bool                   `json:"-"`
	HasAIProviders      bool                   `json:"-"`
	HasAIGlobalSettings bool                   `json:"-"`
	HasProxyNodes       bool                   `json:"-"`
}

func (s *SyncSnapshot) UnmarshalJSON(data []byte) error {
	type alias SyncSnapshot
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var snap alias
	if err := json.Unmarshal(data, &snap); err != nil {
		return err
	}
	*s = SyncSnapshot(snap)
	_, s.HasCredentials = raw["credentials"]
	_, s.HasQuickCommands = raw["quick_commands"]
	_, s.HasAIProviders = raw["ai_providers"]
	_, s.HasAIGlobalSettings = raw["ai_global_settings"]
	_, s.HasProxyNodes = raw["proxy_nodes"]
	return nil
}

// ─── 共享解密/解析 ─────────────────────────────────────────

// decryptAndParseSnapshot 解析同步备份：先试明文 JSON，失败后按 extraKey（恢复密码）→ key（旧版后端派生密钥）解密。
// extraKey 通常为恢复密码派生密钥，可为 nil；key 仅用于旧版云端 .enc 兼容。
func (c *ConfigManager) decryptAndParseSnapshot(data string, key []byte, password string) (*SyncSnapshot, error) {
	// ponytail: 先试明文（新默认），不行再按密文解密
	var snap SyncSnapshot
	if err := json.Unmarshal([]byte(data), &snap); err == nil && snap.Connections != nil {
		return &snap, nil
	}
	var conns []Connection
	if err := json.Unmarshal([]byte(data), &conns); err == nil && len(conns) > 0 {
		return &SyncSnapshot{Connections: conns}, nil
	}
	decrypted := ""
	if strings.HasPrefix(strings.TrimSpace(data), lumin2Prefix) {
		if password == "" {
			return nil, fmt.Errorf("LUMIN2 备份需要恢复密码")
		}
		var err error
		decrypted, err = decryptLUMIN2(strings.TrimSpace(data), password)
		if err != nil {
			return nil, fmt.Errorf("LUMIN2 解密失败，请确认密码是否正确或文件是否损坏: %w", err)
		}
	} else {
		// 1.2.0+ 删除旧 hex 兼容：以下分支仅读取旧 .enc/hex。
		if password != "" {
			decrypted = c.decryptWithKey(data, sha256Key(password))
		}
		if decrypted == "" && key != nil {
			decrypted = c.decryptWithKey(data, key)
		}
	}
	if decrypted == "" {
		return nil, fmt.Errorf("解密失败：如果这是旧版本产生的备份，且云端凭据已变更，则受 AES-256 高强加密保护，资料已永久无法恢复。")
	}
	// 尝试新格式（快照）
	if err := json.Unmarshal([]byte(decrypted), &snap); err == nil && snap.Connections != nil {
		return &snap, nil
	}
	// 回退旧格式（纯连接列表）
	if err := json.Unmarshal([]byte(decrypted), &conns); err != nil {
		return nil, fmt.Errorf("解析备份文件出错：%w", err)
	}
	return &SyncSnapshot{Connections: conns}, nil
}

// ─── 共享合并/比较 ─────────────────────────────────────────

// connsEqual 比较两个连接列表是否内容一致（按 ID 建 map 逐字段比较）
func connsEqual(a, b []Connection) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]Connection, len(a))
	for _, c := range a {
		m[c.ID] = c
	}
	for _, c := range b {
		e, ok := m[c.ID]
		if !ok {
			return false
		}
		if e != c {
			return false
		}
	}
	return true
}

// snapshotEqual 比较本地快照和远端快照是否一致
func snapshotEqual(s1, s2 *SyncSnapshot) bool {
	if !connsEqual(s1.Connections, s2.Connections) {
		return false
	}
	if !credsEqual(s1.Credentials, s2.Credentials) {
		return false
	}
	if s1.QuickCommands != s2.QuickCommands {
		return false
	}
	if !aiProvidersEqual(s1.AIProviders, s2.AIProviders) {
		return false
	}
	if !aiGlobalSettingsEqual(s1.AIGlobalSettings, s2.AIGlobalSettings) {
		return false
	}
	if !aiProxyNodesEqual(s1.ProxyNodes, s2.ProxyNodes) {
		return false
	}
	return true
}

// credsEqual 比较两个凭据列表是否内容一致
func credsEqual(a, b []Credential) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]Credential, len(a))
	for _, c := range a {
		m[c.ID] = c
	}
	for _, c := range b {
		e, ok := m[c.ID]
		if !ok {
			return false
		}
		if e != c {
			return false
		}
	}
	return true
}

func aiProvidersEqual(a, b []ai.AIProviderProfile) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]ai.AIProviderProfile, len(a))
	for _, p := range a {
		m[p.ID] = p
	}
	for _, p := range b {
		e, ok := m[p.ID]
		if !ok || !reflect.DeepEqual(e, p) {
			return false
		}
	}
	return true
}

func normalizeAIGlobalSettingsForCompare(settings ai.AIGlobalSettings) ai.AIGlobalSettings {
	settings.CurrentProviderID = strings.TrimSpace(settings.CurrentProviderID)
	settings.AIRequestProxyID = strings.TrimSpace(settings.AIRequestProxyID)
	settings.ProxyNodes = nil
	settings.UpdatedAt = 0
	if settings.AllowedCommands == nil {
		settings.AllowedCommands = []string{}
	}
	if settings.DeniedCommands == nil {
		settings.DeniedCommands = []string{}
	}
	if settings.SlashCommands == nil {
		settings.SlashCommands = []ai.AISlashCommand{}
	}
	return settings
}

func aiGlobalSettingsEqual(a, b *ai.AIGlobalSettings) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	aa := normalizeAIGlobalSettingsForCompare(*a)
	bb := normalizeAIGlobalSettingsForCompare(*b)
	return reflect.DeepEqual(aa, bb)
}

func aiGlobalSettingsDiffSummary(a, b *ai.AIGlobalSettings) string {
	if a == nil || b == nil {
		return fmt.Sprintf("nil a=%v b=%v", a == nil, b == nil)
	}
	aa := normalizeAIGlobalSettingsForCompare(*a)
	bb := normalizeAIGlobalSettingsForCompare(*b)
	parts := []string{}
	if aa.UpdatedAt != bb.UpdatedAt {
		parts = append(parts, fmt.Sprintf("updatedAt local=%d remote=%d", aa.UpdatedAt, bb.UpdatedAt))
	}
	if aa.CurrentProviderID != bb.CurrentProviderID {
		parts = append(parts, fmt.Sprintf("provider local=%q remote=%q", aa.CurrentProviderID, bb.CurrentProviderID))
	}
	if aa.AIRequestProxyID != bb.AIRequestProxyID {
		parts = append(parts, fmt.Sprintf("proxyId local=%q remote=%q", aa.AIRequestProxyID, bb.AIRequestProxyID))
	}
	if aa.AutoApprovalEnabled != bb.AutoApprovalEnabled || aa.AlwaysAllowReadOnly != bb.AlwaysAllowReadOnly || aa.AlwaysAllowWrite != bb.AlwaysAllowWrite || aa.AlwaysAllowExecute != bb.AlwaysAllowExecute {
		parts = append(parts, "approval flags differ")
	}
	if !reflect.DeepEqual(aa.AllowedCommands, bb.AllowedCommands) || !reflect.DeepEqual(aa.DeniedCommands, bb.DeniedCommands) || !reflect.DeepEqual(aa.SlashCommands, bb.SlashCommands) {
		parts = append(parts, fmt.Sprintf("commands allowed=%d/%d denied=%d/%d slash=%d/%d", len(aa.AllowedCommands), len(bb.AllowedCommands), len(aa.DeniedCommands), len(bb.DeniedCommands), len(aa.SlashCommands), len(bb.SlashCommands)))
	}
	if len(parts) == 0 && !reflect.DeepEqual(aa, bb) {
		parts = append(parts, "other fields differ")
	}
	return strings.Join(parts, "; ")
}

func aiProxyNodesEqual(a, b []ai.AIProxyNode) bool {
	if len(a) != len(b) {
		return false
	}
	m := make(map[string]ai.AIProxyNode, len(a))
	for _, n := range a {
		m[n.ID] = n
	}
	for _, n := range b {
		e, ok := m[n.ID]
		if !ok || !reflect.DeepEqual(e, n) {
			return false
		}
	}
	return true
}

func (c *ConfigManager) aiProviderRegistryPath() string {
	return filepath.Join(c.configDir, "ai_providers.json")
}

func (c *ConfigManager) aiGlobalSettingsPath() string {
	return filepath.Join(c.configDir, "ai_global_settings.json")
}

func (c *ConfigManager) aiProxyNodesPath() string {
	return filepath.Join(c.configDir, "proxy_nodes.json")
}

func (c *ConfigManager) GetAIProviderRegistry() ai.AIProviderRegistry {
	registry := ai.AIProviderRegistry{Providers: []ai.AIProviderProfile{}}
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.aiProviderRegistryPath())
	if err == nil {
		_ = json.Unmarshal(data, &registry)
	}
	if registry.Providers == nil {
		registry.Providers = []ai.AIProviderProfile{}
	}
	return registry
}

func (c *ConfigManager) SaveAIProviderRegistry(registry ai.AIProviderRegistry) error {
	registry.Providers = normalizeSyncAIProviders(registry.Providers)
	data, err := json.MarshalIndent(registry, "", "  ")
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.aiProviderRegistryPath(), data, 0600)
}

func (c *ConfigManager) GetAIGlobalSettings() ai.AIGlobalSettings {
	settings := ai.LoadAIGlobalSettings(c.configDir)
	settings.ProxyNodes = nil
	return settings
}

func (c *ConfigManager) SaveAIGlobalSettings(settings ai.AIGlobalSettings) error {
	settings.ProxyNodes = nil
	if settings.UpdatedAt <= 0 {
		settings.UpdatedAt = time.Now().UnixMilli()
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.aiGlobalSettingsPath(), data, 0600)
}

func (c *ConfigManager) clearAIGlobalSettings() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := os.Remove(c.aiGlobalSettingsPath()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (c *ConfigManager) GetAIProxyNodes() []ai.AIProxyNode {
	return ai.LoadAIProxyNodes(c.configDir)
}

func (c *ConfigManager) SaveAIProxyNodes(nodes []ai.AIProxyNode) error {
	nodes = normalizeSyncAIProxyNodes(nodes)
	data, err := json.MarshalIndent(nodes, "", "  ")
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.aiProxyNodesPath(), data, 0600)
}

func normalizeSyncAIProviders(providers []ai.AIProviderProfile) []ai.AIProviderProfile {
	if providers == nil {
		return []ai.AIProviderProfile{}
	}
	now := time.Now().UnixMilli()
	normalized := make([]ai.AIProviderProfile, 0, len(providers))
	seen := make(map[string]struct{}, len(providers))
	for i, provider := range providers {
		provider.ID = strings.TrimSpace(provider.ID)
		if provider.ID == "" {
			provider.ID = fmt.Sprintf("ai-provider-%d-%d", now, i)
		}
		if _, ok := seen[provider.ID]; ok {
			continue
		}
		seen[provider.ID] = struct{}{}
		provider.Name = strings.TrimSpace(provider.Name)
		if provider.Name == "" {
			provider.Name = "未命名供应商"
		}
		provider.BaseURL = strings.TrimSpace(provider.BaseURL)
		provider.APIKey = strings.TrimSpace(provider.APIKey)
		provider.DedicatedProxyID = strings.TrimSpace(provider.DedicatedProxyID)
		if provider.UpdatedAt <= 0 {
			provider.UpdatedAt = now
		}
		normalized = append(normalized, provider)
	}
	return normalized
}

func normalizeSyncAIProxyNodes(nodes []ai.AIProxyNode) []ai.AIProxyNode {
	if nodes == nil {
		return []ai.AIProxyNode{}
	}
	now := time.Now().UnixMilli()
	normalized := make([]ai.AIProxyNode, 0, len(nodes))
	seen := make(map[string]struct{}, len(nodes))
	for i, node := range nodes {
		node.Host = strings.TrimSpace(node.Host)
		if node.Host == "" {
			continue
		}
		node.ID = strings.TrimSpace(node.ID)
		if node.ID == "" {
			node.ID = fmt.Sprintf("proxy-%d-%d", now, i)
		}
		if _, ok := seen[node.ID]; ok {
			continue
		}
		seen[node.ID] = struct{}{}
		node.Name = strings.TrimSpace(node.Name)
		node.Type = strings.ToLower(strings.TrimSpace(node.Type))
		if node.Type != "http" {
			node.Type = "socks5"
		}
		if node.Port <= 0 || node.Port > 65535 {
			node.Port = 1080
		}
		node.Username = strings.TrimSpace(node.Username)
		if node.UpdatedAt <= 0 {
			node.UpdatedAt = now
		}
		normalized = append(normalized, node)
	}
	return normalized
}

// ─── 共享远端操作 ─────────────────────────────────────────

func isBackupName(name string) bool {
	// 1.2.0+ 删除旧 hex 兼容：.enc 仅用于读取/清理旧备份，新写入使用 .lumin2。
	return strings.HasPrefix(name, "connections_backup_") && (strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".lumin2") || strings.HasSuffix(name, ".enc"))
}

func isNoBackupError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "云端没有备份文件")
}

func onlyNoBackupErrors(errs []string) bool {
	if len(errs) == 0 {
		return false
	}
	for _, err := range errs {
		if !strings.Contains(err, "云端没有备份文件") {
			return false
		}
	}
	return true
}

// fetchLatestBackup 从远端下载最新备份并解密为快照
func (c *ConfigManager) fetchLatestBackup(s RemoteStorage) (*SyncSnapshot, error) {
	files, err := s.ListFiles()
	if err != nil {
		return nil, fmt.Errorf("读取远程目录失败：%w", err)
	}

	// 按文件名（含毫秒精度时间戳）降序排列，跨平台一致性优于 ModTime
	var backups []string
	for _, f := range files {
		if !f.IsDir && isBackupName(f.Name) {
			backups = append(backups, f.Name)
		}
	}
	if len(backups) == 0 {
		return nil, fmt.Errorf("云端没有备份文件")
	}
	sort.Sort(sort.Reverse(sort.StringSlice(backups)))

	// 取最新有效快照；若缺少 credentials 则遍历旧文件补充
	var snap *SyncSnapshot
	for _, name := range backups {
		data, err := s.ReadFile(name)
		if err != nil {
			log.Printf("fetchLatestBackup: read %s: %v (skipping)", name, err)
			continue
		}
		parsed, err := c.decryptAndParseSnapshot(string(data), s.EncryptKey(), c.GetRecoveryPassword()) // key 仅为旧版 .enc 兼容；新版走明文或恢复密码
		if err != nil {
			log.Printf("fetchLatestBackup: decrypt %s: %v (skipping)", name, err)
			continue
		}
		if parsed.Connections == nil {
			continue
		}
		if snap == nil {
			snap = parsed
		}
		// 最新快照缺凭据时，从旧文件中补充
		if snap.Credentials == nil && parsed.Credentials != nil {
			snap.Credentials = parsed.Credentials
			log.Printf("fetchLatestBackup: recovered %d credentials from older backup %s", len(parsed.Credentials), name)
		}
		if snap.Connections != nil && snap.Credentials != nil {
			break
		}
	}
	if snap == nil {
		return nil, fmt.Errorf("无法解析任何备份文件")
	}
	return snap, nil
}

func (c *ConfigManager) localAIGlobalSettingsForSync() *ai.AIGlobalSettings {
	raw := strings.TrimSpace(c.loadRawFile(c.aiGlobalSettingsPath()))
	if raw == "" {
		return nil
	}
	settings := c.GetAIGlobalSettings()
	settings.ProxyNodes = nil
	return &settings
}

// backupConnections 上传本地所有可同步数据到远端，同时清理超出 maxBackups 的旧备份。
// 加密策略（与导出一致）：设置了恢复密码则上传 LUMIN2 .lumin2；否则明文 JSON 上传 .json。
//
// 1.2.0+ 删除旧 hex 兼容：旧版用后端派生密钥加密上传 .enc，新版不再产生此类备份，
// 但 decryptAndParseSnapshot 仍保留读取兼容。
func (c *ConfigManager) backupConnections(s RemoteStorage, maxBackups int) (map[string]interface{}, error) {
	snap := SyncSnapshot{
		Connections:         c.GetConnections(),
		Credentials:         c.GetCredentials(),
		QuickCommands:       c.loadRawFile(c.quickCmdFile),
		AIProviders:         c.GetAIProviderRegistry().Providers,
		AIGlobalSettings:    c.localAIGlobalSettingsForSync(),
		ProxyNodes:          c.GetAIProxyNodes(),
		SnapshotTime:        c.loadSnapshotTime(),
		HasCredentials:      true,
		HasQuickCommands:    true,
		HasAIProviders:      true,
		HasAIGlobalSettings: true,
		HasProxyNodes:       true,
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal snapshot: %w", err)
	}

	timestamp := time.Now().Format("20060102_150405.000_-0700")
	// ponytail: 有恢复密码才加密，默认明文；与导出入口径一致
	var payload []byte
	var fileName string
	if password := c.GetRecoveryPassword(); password != "" {
		encrypted, err := encryptLUMIN2(string(data), password)
		if err != nil {
			return nil, fmt.Errorf("encrypt snapshot: %w", err)
		}
		payload = []byte(encrypted)
		fileName = fmt.Sprintf("connections_backup_%s.lumin2", timestamp)
	} else {
		payload = data
		fileName = fmt.Sprintf("connections_backup_%s.json", timestamp)
	}
	if err := s.WriteFile(fileName, payload); err != nil {
		return nil, err
	}

	if maxBackups > 0 {
		if err := c.pruneOldBackups(s, maxBackups); err != nil {
			return nil, err
		}
	}

	return map[string]interface{}{
		"path":  fileName,
		"time":  time.Now().Format("2006-01-02 15:04:05 -0700"),
		"count": len(snap.Connections),
	}, nil
}

// pruneOldBackups 删除超出数量的最旧备份文件
func (c *ConfigManager) pruneOldBackups(s RemoteStorage, maxBackups int) error {
	files, err := s.ListFiles()
	if err != nil {
		return fmt.Errorf("读取备份列表失败: %w", err)
	}

	type backupEntry struct {
		name string
	}
	var backups []backupEntry
	for _, f := range files {
		if !f.IsDir && isBackupName(f.Name) {
			backups = append(backups, backupEntry{f.Name})
		}
	}
	if len(backups) <= maxBackups {
		return nil
	}
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].name < backups[j].name
	})
	for i := 0; i < len(backups)-maxBackups; i++ {
		if err := s.DeleteFile(backups[i].name); err != nil {
			return fmt.Errorf("删除旧备份 %s 失败: %w", backups[i].name, err)
		}
	}
	return nil
}

// listBackupFiles 列出远端备份文件及其元信息
func (c *ConfigManager) listBackupFiles(s RemoteStorage) ([]map[string]interface{}, error) {
	files, err := s.ListFiles()
	if err != nil {
		return nil, err
	}

	var backups []map[string]interface{}
	for _, f := range files {
		if !f.IsDir && isBackupName(f.Name) {
			// 从文件名解析时间：优先新格式（带时区），fallback 旧格式（无时区用本地时间），支持 .lumin2/.enc/.json
			timeStr := ""
			base := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(f.Name, ".lumin2"), ".enc"), ".json")
			if t, err := time.Parse("connections_backup_20060102_150405.000_-0700", base); err == nil {
				timeStr = t.Local().Format("2006-01-02 15:04:05 -0700")
			} else if t, err := time.ParseInLocation("connections_backup_20060102_150405.000", base, time.Local); err == nil {
				timeStr = t.Format("2006-01-02 15:04:05 -0700")
			} else {
				timeStr = f.ModTime.In(time.Local).Format("2006-01-02 15:04:05 -0700")
			}
			backups = append(backups, map[string]interface{}{
				"name": f.Name,
				"size": f.Size,
				"time": timeStr,
			})
		}
	}

	sort.Slice(backups, func(i, j int) bool {
		return backups[i]["name"].(string) > backups[j]["name"].(string)
	})
	return backups, nil
}

// ─── 同步入口 ─────────────────────────────────────────────

// syncFromProvider 手动合并同步：下载远端 → 合并连接+命令 → 保存本地 → 条件上传
func (c *ConfigManager) syncFromProvider(s RemoteStorage, maxBackups int) (map[string]interface{}, error) {
	remoteSnap, err := c.fetchLatestBackup(s)
	if err != nil {
		return nil, err
	}

	// 合并连接（重叠按 LastModified 取最新，单侧独有按 lastSyncTime 判断删除）
	localConns := c.GetConnections()
	lastSyncTime := c.loadLastSyncTime()
	deduped := c.mergeWithDeletionPropagation(localConns, remoteSnap.Connections, lastSyncTime)
	// 加锁保存并失效缓存（saveConnectionsFile 要求调用方持有 c.mu）
	c.mu.Lock()
	if err := c.saveConnectionsFile(deduped); err != nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("保存连接失败: %w", err)
	}
	c.connCacheDirty = true

	// 合并凭据
	var mergedCreds []Credential
	if remoteSnap.HasCredentials {
		localCreds := c.getCredentialsLocked()
		mergedCreds = c.mergeCredentials(localCreds, remoteSnap.Credentials, lastSyncTime)
		if err := c.saveCredentialsFile(mergedCreds); err != nil {
			c.mu.Unlock()
			return nil, fmt.Errorf("保存凭据失败: %w", err)
		}
		c.credCacheDirty = true
	}
	c.mu.Unlock()
	c.CleanupOrphanedHistory() // 清理已不存在的连接的历史文件

	// 合并快捷命令（按 last_modified 取最新，单侧独有按 lastSyncTime 判断删除）
	localQuickCmds := c.loadRawFile(c.quickCmdFile)
	mergedQuickCmds := localQuickCmds
	if remoteSnap.HasQuickCommands {
		mergedQuickCmds = c.mergeQuickCommands(localQuickCmds, remoteSnap.QuickCommands, lastSyncTime)
		if err := atomicWriteFile(c.quickCmdFile, []byte(mergedQuickCmds), 0600); err != nil {
			log.Printf("[syncFromProvider] failed to write quick commands: %v", err)
		}
	}

	localAIProviders := c.GetAIProviderRegistry().Providers
	mergedAIProviders := c.mergeAIProviders(localAIProviders, remoteSnap.AIProviders, lastSyncTime)
	if remoteSnap.HasAIProviders {
		if err := c.SaveAIProviderRegistry(ai.AIProviderRegistry{Providers: mergedAIProviders}); err != nil {
			log.Printf("[syncFromProvider] failed to save AI providers: %v", err)
		}
	}
	localAIGlobalSettings := c.localAIGlobalSettingsForSync()
	var mergedAIGlobalSettings ai.AIGlobalSettings
	if localAIGlobalSettings != nil {
		mergedAIGlobalSettings = *localAIGlobalSettings
	}
	if remoteSnap.HasAIGlobalSettings {
		mergedAIGlobalSettings = mergeAIGlobalSettings(mergedAIGlobalSettings, remoteSnap.AIGlobalSettings)
		if err := c.SaveAIGlobalSettings(mergedAIGlobalSettings); err != nil {
			log.Printf("[syncFromProvider] failed to save AI global settings: %v", err)
		}
	}
	localProxyNodes := c.GetAIProxyNodes()
	mergedProxyNodes := c.mergeAIProxyNodes(localProxyNodes, remoteSnap.ProxyNodes, lastSyncTime)
	if remoteSnap.HasProxyNodes {
		if err := c.SaveAIProxyNodes(mergedProxyNodes); err != nil {
			log.Printf("[syncFromProvider] failed to save AI proxy nodes: %v", err)
		}
	}

	var backupResult interface{}
	changed := !connsEqual(deduped, remoteSnap.Connections) ||
		(remoteSnap.HasQuickCommands && !quickCmdsEqual(mergedQuickCmds, remoteSnap.QuickCommands)) ||
		(mergedCreds != nil && !credsEqual(mergedCreds, remoteSnap.Credentials)) ||
		(remoteSnap.HasAIProviders && !aiProvidersEqual(mergedAIProviders, remoteSnap.AIProviders)) ||
		(remoteSnap.HasAIGlobalSettings && !aiGlobalSettingsEqual(&mergedAIGlobalSettings, remoteSnap.AIGlobalSettings)) ||
		(remoteSnap.HasProxyNodes && !aiProxyNodesEqual(mergedProxyNodes, remoteSnap.ProxyNodes))
	if changed {
		c.bumpSnapshotTime() // 手动同步后更新总时间戳，确保下次自动同步方向正确
		br, berr := c.backupConnections(s, maxBackups)
		if berr != nil {
			return nil, fmt.Errorf("上传合并快照失败: %w", berr)
		}
		backupResult = br
	} else if maxBackups > 0 {
		if err := c.pruneOldBackups(s, maxBackups); err != nil {
			return nil, fmt.Errorf("清理旧备份失败: %w", err)
		}
	}
	c.saveLastSyncTime(time.Now().UnixMilli())

	return map[string]interface{}{
		"success":     true,
		"localCount":  len(localConns),
		"remoteCount": len(remoteSnap.Connections),
		"mergedCount": len(deduped),
		"backup":      backupResult,
	}, nil
}

func snapshotHasQuickCommands(snap *SyncSnapshot) bool {
	return snap.HasQuickCommands
}

func latestSnapshotHasItem(itemUpdatedAt int64, snaps []*SyncSnapshot, hasField func(*SyncSnapshot) bool, contains func(*SyncSnapshot) bool) bool {
	if itemUpdatedAt <= 0 {
		return true
	}
	var latest *SyncSnapshot
	for _, snap := range snaps {
		if hasField(snap) && snap.SnapshotTime > itemUpdatedAt && (latest == nil || snap.SnapshotTime > latest.SnapshotTime) {
			latest = snap
		}
	}
	return latest == nil || contains(latest)
}

func filterRemoteDeletedConnections(conns []Connection, snaps []*SyncSnapshot) []Connection {
	out := conns[:0]
	for _, conn := range conns {
		if latestSnapshotHasItem(conn.LastModified, snaps, func(*SyncSnapshot) bool { return true }, func(snap *SyncSnapshot) bool { return connectionInSnapshot(snap.Connections, conn.ID) }) {
			out = append(out, conn)
		}
	}
	return out
}

func connectionInSnapshot(conns []Connection, id string) bool {
	for _, conn := range conns {
		if conn.ID == id {
			return true
		}
	}
	return false
}

func filterRemoteDeletedCredentials(creds []Credential, snaps []*SyncSnapshot) []Credential {
	out := creds[:0]
	for _, cred := range creds {
		if latestSnapshotHasItem(cred.LastModified, snaps, func(snap *SyncSnapshot) bool { return snap.HasCredentials }, func(snap *SyncSnapshot) bool { return credentialInSnapshot(snap.Credentials, cred.ID) }) {
			out = append(out, cred)
		}
	}
	return out
}

func credentialInSnapshot(creds []Credential, id string) bool {
	for _, cred := range creds {
		if cred.ID == id {
			return true
		}
	}
	return false
}

func filterRemoteDeletedAIProviders(providers []ai.AIProviderProfile, snaps []*SyncSnapshot) []ai.AIProviderProfile {
	out := providers[:0]
	for _, provider := range providers {
		if latestSnapshotHasItem(provider.UpdatedAt, snaps, func(snap *SyncSnapshot) bool { return snap.HasAIProviders }, func(snap *SyncSnapshot) bool { return aiProviderInSnapshot(snap.AIProviders, provider.ID) }) {
			out = append(out, provider)
		}
	}
	return out
}

func aiProviderInSnapshot(providers []ai.AIProviderProfile, id string) bool {
	for _, provider := range providers {
		if provider.ID == id {
			return true
		}
	}
	return false
}

func filterRemoteDeletedAIProxyNodes(nodes []ai.AIProxyNode, snaps []*SyncSnapshot) []ai.AIProxyNode {
	out := nodes[:0]
	for _, node := range nodes {
		if latestSnapshotHasItem(node.UpdatedAt, snaps, func(snap *SyncSnapshot) bool { return snap.HasProxyNodes }, func(snap *SyncSnapshot) bool { return aiProxyNodeInSnapshot(snap.ProxyNodes, node.ID) }) {
			out = append(out, node)
		}
	}
	return out
}

func aiProxyNodeInSnapshot(nodes []ai.AIProxyNode, id string) bool {
	for _, node := range nodes {
		if node.ID == id {
			return true
		}
	}
	return false
}

func (c *ConfigManager) filterRemoteDeletedQuickCommands(raw string, snaps []*SyncSnapshot) string {
	if strings.TrimSpace(raw) == "" {
		return raw
	}
	var arr []interface{}
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return raw
	}
	filtered := filterQuickCommandArray(arr, snaps)
	data, err := json.MarshalIndent(filtered, "", "  ")
	if err != nil {
		return raw
	}
	return string(data)
}

func filterQuickCommandArray(arr []interface{}, snaps []*SyncSnapshot) []interface{} {
	out := arr[:0]
	for _, item := range arr {
		cmd, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if children, ok := cmd["children"].([]interface{}); ok {
			cmd["children"] = filterQuickCommandArray(children, snaps)
		}
		key := cmdKey(cmd)
		if latestSnapshotHasItem(cmdLastModified(cmd), snaps, snapshotHasQuickCommands, func(snap *SyncSnapshot) bool { return quickCommandInSnapshot(snap.QuickCommands, key) }) {
			out = append(out, cmd)
		}
	}
	return out
}

func quickCommandInSnapshot(raw, key string) bool {
	var arr []interface{}
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return false
	}
	return quickCommandInArray(arr, key)
}

func quickCommandInArray(arr []interface{}, key string) bool {
	for _, item := range arr {
		cmd, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if cmdKey(cmd) == key {
			return true
		}
		if children, ok := cmd["children"].([]interface{}); ok && quickCommandInArray(children, key) {
			return true
		}
	}
	return false
}

func (c *ConfigManager) syncAllProviders(entries []providerEntry) (map[string]interface{}, error) {
	if len(entries) == 0 {
		return nil, errors.New("没有可用同步目标")
	}
	defer func() {
		for _, p := range entries {
			if cl, ok := p.storage.(storageCloser); ok {
				cl.Close()
			}
		}
	}()

	lastSyncTime := c.loadLastSyncTime()
	localConns := c.GetConnections()
	localCreds := c.GetCredentials()
	localQuickCmds := c.loadRawFile(c.quickCmdFile)
	localAIProviders := c.GetAIProviderRegistry().Providers
	localAIGlobalSettings := c.localAIGlobalSettingsForSync()
	localProxyNodes := c.GetAIProxyNodes()

	remoteConns := []Connection{}
	var remoteCreds []Credential
	remoteQuickCmds := ""
	var remoteAIProviders []ai.AIProviderProfile
	var remoteAIGlobalSettings ai.AIGlobalSettings
	var remoteProxyNodes []ai.AIProxyNode
	remoteHasCreds := false
	remoteHasQuick := false
	remoteHasAIProviders := false
	remoteHasAIGlobalSettings := false
	remoteHasProxyNodes := false
	var errs []string
	downloaded := 0
	var remoteSnaps []*SyncSnapshot

	for _, p := range entries {
		remoteSnap, err := c.fetchLatestBackup(p.storage)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%T 下载失败: %v", p.storage, err))
			continue
		}
		downloaded++
		remoteSnaps = append(remoteSnaps, remoteSnap)
		remoteConns = c.mergeWithDeletionPropagation(remoteConns, remoteSnap.Connections, -1)
		if remoteSnap.HasCredentials {
			remoteHasCreds = true
			remoteCreds = c.mergeCredentials(remoteCreds, remoteSnap.Credentials, -1)
		}
		if remoteSnap.HasQuickCommands {
			remoteHasQuick = true
			remoteQuickCmds = c.mergeQuickCommands(remoteQuickCmds, remoteSnap.QuickCommands, -1)
		}
		if remoteSnap.HasAIProviders {
			remoteHasAIProviders = true
			remoteAIProviders = c.mergeAIProviders(remoteAIProviders, remoteSnap.AIProviders, -1)
		}
		if remoteSnap.HasAIGlobalSettings {
			remoteHasAIGlobalSettings = true
			remoteAIGlobalSettings = mergeAIGlobalSettings(remoteAIGlobalSettings, remoteSnap.AIGlobalSettings)
		}
		if remoteSnap.HasProxyNodes {
			remoteHasProxyNodes = true
			remoteProxyNodes = c.mergeAIProxyNodes(remoteProxyNodes, remoteSnap.ProxyNodes, -1)
		}
	}

	if downloaded == 0 && len(errs) > 0 && !onlyNoBackupErrors(errs) {
		return nil, errors.New(strings.Join(errs, "; "))
	}
	remoteConns = filterRemoteDeletedConnections(remoteConns, remoteSnaps)
	remoteCreds = filterRemoteDeletedCredentials(remoteCreds, remoteSnaps)
	remoteQuickCmds = c.filterRemoteDeletedQuickCommands(remoteQuickCmds, remoteSnaps)
	remoteAIProviders = filterRemoteDeletedAIProviders(remoteAIProviders, remoteSnaps)
	remoteProxyNodes = filterRemoteDeletedAIProxyNodes(remoteProxyNodes, remoteSnaps)

	mergedConns := localConns
	if downloaded > 0 {
		mergedConns = c.mergeWithDeletionPropagation(localConns, remoteConns, lastSyncTime)
	}
	mergedCreds := localCreds
	if remoteHasCreds {
		mergedCreds = c.mergeCredentials(localCreds, remoteCreds, lastSyncTime)
	}
	mergedQuickCmds := localQuickCmds
	if remoteHasQuick {
		mergedQuickCmds = c.mergeQuickCommands(localQuickCmds, remoteQuickCmds, lastSyncTime)
	}
	mergedAIProviders := localAIProviders
	if remoteHasAIProviders {
		mergedAIProviders = c.mergeAIProviders(localAIProviders, remoteAIProviders, lastSyncTime)
	}
	var mergedAIGlobalSettings ai.AIGlobalSettings
	if localAIGlobalSettings != nil {
		mergedAIGlobalSettings = *localAIGlobalSettings
	}
	if remoteHasAIGlobalSettings {
		mergedAIGlobalSettings = mergeAIGlobalSettings(mergedAIGlobalSettings, &remoteAIGlobalSettings)
	}
	mergedProxyNodes := localProxyNodes
	if remoteHasProxyNodes {
		mergedProxyNodes = c.mergeAIProxyNodes(localProxyNodes, remoteProxyNodes, lastSyncTime)
	}
	if downloaded > 0 {
		mergedConns = filterRemoteDeletedConnections(mergedConns, remoteSnaps)
		mergedCreds = filterRemoteDeletedCredentials(mergedCreds, remoteSnaps)
		mergedQuickCmds = c.filterRemoteDeletedQuickCommands(mergedQuickCmds, remoteSnaps)
		mergedAIProviders = filterRemoteDeletedAIProviders(mergedAIProviders, remoteSnaps)
		mergedProxyNodes = filterRemoteDeletedAIProxyNodes(mergedProxyNodes, remoteSnaps)
	}

	localAIGlobalEqual := localAIGlobalSettings == nil
	if localAIGlobalSettings != nil {
		localAIGlobalEqual = aiGlobalSettingsEqual(&mergedAIGlobalSettings, localAIGlobalSettings)
	}
	localChanged := !connsEqual(mergedConns, localConns) ||
		(remoteHasCreds && !credsEqual(mergedCreds, localCreds)) ||
		(remoteHasQuick && !quickCmdsEqual(mergedQuickCmds, localQuickCmds)) ||
		(remoteHasAIProviders && !aiProvidersEqual(mergedAIProviders, localAIProviders)) ||
		(remoteHasAIGlobalSettings && !localAIGlobalEqual) ||
		(remoteHasProxyNodes && !aiProxyNodesEqual(mergedProxyNodes, localProxyNodes))
	cloudChanged := downloaded == 0
	if downloaded > 0 {
		remoteAIGlobalEqual := !remoteHasAIGlobalSettings || aiGlobalSettingsEqual(&mergedAIGlobalSettings, &remoteAIGlobalSettings)
		cloudChanged = !connsEqual(mergedConns, remoteConns) ||
			(remoteHasCreds && !credsEqual(mergedCreds, remoteCreds)) ||
			(remoteHasQuick && !quickCmdsEqual(mergedQuickCmds, remoteQuickCmds)) ||
			(remoteHasAIProviders && !aiProvidersEqual(mergedAIProviders, remoteAIProviders)) ||
			(remoteHasAIGlobalSettings && !remoteAIGlobalEqual) ||
			(remoteHasProxyNodes && !aiProxyNodesEqual(mergedProxyNodes, remoteProxyNodes))
	}
	log.Printf("[syncAllProviders] decision downloaded=%d lastSync=%d localChanged=%v cloudChanged=%v partsLocal={conns:%v creds:%v quick:%v ai:%v aiGlobal:%v proxy:%v} partsCloud={conns:%v creds:%v quick:%v ai:%v aiGlobal:%v proxy:%v}", downloaded, lastSyncTime, localChanged, cloudChanged, !connsEqual(mergedConns, localConns), remoteHasCreds && !credsEqual(mergedCreds, localCreds), remoteHasQuick && !quickCmdsEqual(mergedQuickCmds, localQuickCmds), remoteHasAIProviders && !aiProvidersEqual(mergedAIProviders, localAIProviders), remoteHasAIGlobalSettings && !localAIGlobalEqual, remoteHasProxyNodes && !aiProxyNodesEqual(mergedProxyNodes, localProxyNodes), downloaded == 0 || !connsEqual(mergedConns, remoteConns), remoteHasCreds && !credsEqual(mergedCreds, remoteCreds), remoteHasQuick && !quickCmdsEqual(mergedQuickCmds, remoteQuickCmds), remoteHasAIProviders && !aiProvidersEqual(mergedAIProviders, remoteAIProviders), remoteHasAIGlobalSettings && !(!remoteHasAIGlobalSettings || aiGlobalSettingsEqual(&mergedAIGlobalSettings, &remoteAIGlobalSettings)), remoteHasProxyNodes && !aiProxyNodesEqual(mergedProxyNodes, remoteProxyNodes))
	if !localChanged && !cloudChanged {
		c.saveLastSyncTime(time.Now().UnixMilli())
		return map[string]interface{}{"success": true, "localCount": len(localConns), "remoteCount": downloaded, "mergedCount": len(mergedConns), "uploaded": 0, "skipped": true}, nil
	}

	c.mu.Lock()
	if err := c.saveConnectionsFile(mergedConns); err != nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("保存连接失败: %w", err)
	}
	c.connCacheDirty = true
	if err := c.saveCredentialsFile(mergedCreds); err != nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("保存凭据失败: %w", err)
	}
	c.credCacheDirty = true
	if err := atomicWriteFile(c.quickCmdFile, []byte(mergedQuickCmds), 0600); err != nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("保存快捷命令失败: %w", err)
	}
	c.mu.Unlock()
	if err := c.SaveAIProviderRegistry(ai.AIProviderRegistry{Providers: mergedAIProviders}); err != nil {
		log.Printf("[syncAllProviders] save AI providers: %v", err)
	}
	if remoteHasAIGlobalSettings {
		if err := c.SaveAIGlobalSettings(mergedAIGlobalSettings); err != nil {
			log.Printf("[syncAllProviders] save AI global settings: %v", err)
		}
	}
	if err := c.SaveAIProxyNodes(mergedProxyNodes); err != nil {
		log.Printf("[syncAllProviders] save AI proxy nodes: %v", err)
	}
	c.CleanupOrphanedHistory()
	c.bumpSnapshotTime()

	uploaded := 0
	for _, p := range entries {
		if _, err := c.backupConnections(p.storage, p.maxBackups); err != nil {
			errs = append(errs, fmt.Sprintf("%T 上传失败: %v", p.storage, err))
		} else {
			uploaded++
		}
	}
	result := map[string]interface{}{
		"success":     uploaded > 0 && len(errs) == 0,
		"localCount":  len(localConns),
		"remoteCount": downloaded,
		"mergedCount": len(mergedConns),
		"uploaded":    uploaded,
	}
	if uploaded > 0 {
		c.saveLastSyncTime(time.Now().UnixMilli())
	}
	if uploaded == 0 || len(errs) > 0 {
		return result, errors.New(strings.Join(errs, "; "))
	}
	return result, nil
}

// emitSyncEvent 向前端发送同步状态事件（ponytail: wailsCtx 可能为 nil，静默跳过）
func (c *ConfigManager) emitSyncEvent(event string, data map[string]interface{}) {
	if c.wailsCtx != nil {
		runtime.EventsEmit(c.wailsCtx, event, data)
	}
}

// autoSyncProvider 自动同步：
// - 所有方向：重叠连接/快捷命令按 per-item last_modified 取最新，单侧独有按 lastSyncTime 判断删除
// - 无变化 → 静默跳过
func (c *ConfigManager) autoSyncProvider(s RemoteStorage, maxBackups int) error {
	remoteSnap, err := c.fetchLatestBackup(s)
	if err != nil {
		if !isNoBackupError(err) {
			return err
		}
		if _, berr := c.backupConnections(s, maxBackups); berr != nil {
			return fmt.Errorf("云端访问失败: %w", berr)
		}
		c.emitSyncEvent("sync-status", map[string]interface{}{
			"action": "upload",
			"reason": "no_remote_backup",
		})
		return nil
	}

	localSnapTime := c.loadSnapshotTime()
	remoteSnapTime := remoteSnap.SnapshotTime
	lastSyncTime := c.loadLastSyncTime()

	localConns := c.GetConnections()

	// 连接合并：重叠按 LastModified 取最新，单侧独有按 lastSyncTime 判断删除
	merged := c.mergeWithDeletionPropagation(localConns, remoteSnap.Connections, lastSyncTime)

	// 凭据合并
	var mergedCreds []Credential
	localCreds := c.GetCredentials()
	if remoteSnap.HasCredentials {
		mergedCreds = c.mergeCredentials(localCreds, remoteSnap.Credentials, lastSyncTime)
	} else {
		mergedCreds = localCreds
	}

	// 快捷命令合并：重叠按 last_modified 取最新，单侧独有按 lastSyncTime 判断删除
	localQuickCmds := c.loadRawFile(c.quickCmdFile)
	mergedQuickCmds := localQuickCmds
	if remoteSnap.HasQuickCommands {
		mergedQuickCmds = c.mergeQuickCommands(localQuickCmds, remoteSnap.QuickCommands, lastSyncTime)
	}

	localAIProviders := c.GetAIProviderRegistry().Providers
	mergedAIProviders := localAIProviders
	if remoteSnap.HasAIProviders {
		mergedAIProviders = c.mergeAIProviders(localAIProviders, remoteSnap.AIProviders, lastSyncTime)
	}
	localAIGlobalSettings := c.localAIGlobalSettingsForSync()
	var mergedAIGlobalSettings ai.AIGlobalSettings
	var mergedAIGlobalSettingsPtr *ai.AIGlobalSettings
	if localAIGlobalSettings != nil {
		mergedAIGlobalSettings = *localAIGlobalSettings
		mergedAIGlobalSettingsPtr = &mergedAIGlobalSettings
	}
	if remoteSnap.HasAIGlobalSettings && (localAIGlobalSettings != nil || remoteSnap.AIGlobalSettings != nil) {
		mergedAIGlobalSettings = mergeAIGlobalSettings(mergedAIGlobalSettings, remoteSnap.AIGlobalSettings)
		mergedAIGlobalSettingsPtr = &mergedAIGlobalSettings
	}
	localProxyNodes := c.GetAIProxyNodes()
	mergedProxyNodes := localProxyNodes
	if remoteSnap.HasProxyNodes {
		mergedProxyNodes = c.mergeAIProxyNodes(localProxyNodes, remoteSnap.ProxyNodes, lastSyncTime)
	}

	// 本地有变化 → 保存
	quickChanged := remoteSnap.HasQuickCommands && !quickCmdsEqual(mergedQuickCmds, localQuickCmds)
	credsChanged := remoteSnap.HasCredentials && !credsEqual(mergedCreds, localCreds)
	aiProvidersChanged := remoteSnap.HasAIProviders && !aiProvidersEqual(mergedAIProviders, localAIProviders)
	aiGlobalSettingsChanged := remoteSnap.HasAIGlobalSettings && !aiGlobalSettingsEqual(mergedAIGlobalSettingsPtr, localAIGlobalSettings)
	proxyNodesChanged := remoteSnap.HasProxyNodes && !aiProxyNodesEqual(mergedProxyNodes, localProxyNodes)
	localChanged := !connsEqual(merged, localConns) || quickChanged || credsChanged || aiProvidersChanged || aiGlobalSettingsChanged || proxyNodesChanged

	// 云端有变化 → 需要上传
	cloudQuickChanged := remoteSnap.HasQuickCommands && !quickCmdsEqual(mergedQuickCmds, remoteSnap.QuickCommands)
	cloudCredsChanged := remoteSnap.HasCredentials && !credsEqual(mergedCreds, remoteSnap.Credentials)
	cloudAIProvidersChanged := remoteSnap.HasAIProviders && !aiProvidersEqual(mergedAIProviders, remoteSnap.AIProviders)
	cloudAIGlobalSettingsChanged := remoteSnap.HasAIGlobalSettings && !aiGlobalSettingsEqual(mergedAIGlobalSettingsPtr, remoteSnap.AIGlobalSettings)
	if cloudAIGlobalSettingsChanged {
		log.Printf("[autoSyncProvider] aiGlobal diff %s", aiGlobalSettingsDiffSummary(mergedAIGlobalSettingsPtr, remoteSnap.AIGlobalSettings))
	}
	cloudProxyNodesChanged := remoteSnap.HasProxyNodes && !aiProxyNodesEqual(mergedProxyNodes, remoteSnap.ProxyNodes)
	cloudConnsChanged := !connsEqual(merged, remoteSnap.Connections)
	cloudChanged := cloudConnsChanged || cloudQuickChanged || cloudCredsChanged || cloudAIProvidersChanged || cloudAIGlobalSettingsChanged || cloudProxyNodesChanged

	// 无变化 → 静默跳过
	if !localChanged && !cloudChanged {
		c.saveLastSyncTime(time.Now().UnixMilli())
		return nil
	}

	// 确定同步方向（用于前端通知）
	var action string
	if cloudChanged && localChanged {
		action = "merge"
	} else if cloudChanged {
		action = "upload"
	} else {
		action = "download"
	}
	if localChanged {
		c.mu.Lock()
		if err := c.saveConnectionsFile(merged); err != nil {
			log.Printf("[autoSyncProvider] save: %v", err)
		}
		c.connCacheDirty = true
		if credsChanged {
			if err := c.saveCredentialsFile(mergedCreds); err != nil {
				log.Printf("[autoSyncProvider] save creds: %v", err)
			}
			c.credCacheDirty = true
		}
		if quickChanged {
			// staleness check: 重读文件确认没有被并发 SaveQuickCommands 覆盖
			// ponytail: 已持写锁，不能再调 loadRawFile（它会 RLock 自死锁），直接 os.ReadFile
			data, _ := os.ReadFile(c.quickCmdFile)
			if quickCmdsEqual(string(data), localQuickCmds) {
				atomicWriteFile(c.quickCmdFile, []byte(mergedQuickCmds), 0600)
			}
		}
		c.mu.Unlock()
		if aiProvidersChanged {
			if err := c.SaveAIProviderRegistry(ai.AIProviderRegistry{Providers: mergedAIProviders}); err != nil {
				log.Printf("[autoSyncProvider] save AI providers: %v", err)
			}
		}
		if aiGlobalSettingsChanged {
			if err := c.SaveAIGlobalSettings(mergedAIGlobalSettings); err != nil {
				log.Printf("[autoSyncProvider] save AI global settings: %v", err)
			}
		}
		if proxyNodesChanged {
			if err := c.SaveAIProxyNodes(mergedProxyNodes); err != nil {
				log.Printf("[autoSyncProvider] save AI proxy nodes: %v", err)
			}
		}
		c.CleanupOrphanedHistory()
	}

	// 云端有变化 → 上传
	syncTimeUpdated := false
	if cloudChanged {
		c.bumpSnapshotTime()
		syncTimeUpdated = true
		if _, berr := c.backupConnections(s, maxBackups); berr != nil {
			return fmt.Errorf("上传合并快照失败: %w", berr)
		}
	} else if localChanged {
		c.bumpSnapshotTime()
		syncTimeUpdated = true
	}

	// 仅在本轮没有生成新本地快照时，才用较新的远端时间校准本地时间戳。
	if !syncTimeUpdated && remoteSnapTime > localSnapTime {
		atomicWriteFile(c.syncTimeFile, []byte(fmt.Sprintf("%d", remoteSnapTime)), 0600)
	}
	c.saveLastSyncTime(time.Now().UnixMilli())

	if action == "upload" && !localChanged {
		return nil
	}

	c.emitSyncEvent("sync-status", map[string]interface{}{
		"action":       action,
		"localCount":   len(localConns),
		"remoteCount":  len(remoteSnap.Connections),
		"mergedCount":  len(merged),
		"localChanged": localChanged,
		"cloudChanged": cloudChanged,
	})

	return nil
}

// mergeWithDeletionPropagation 合并本地和云端连接：
// 1. 重叠连接（两边都有）→ 按 per-connection LastModified 取最新
// 2. 单侧独有 → LastModified > lastSyncTime 则保留（新增），否则删除
func (c *ConfigManager) mergeWithDeletionPropagation(localConns, remoteConns []Connection, lastSyncTime int64) []Connection {
	localMap := make(map[string]Connection, len(localConns))
	for _, lc := range localConns {
		localMap[lc.ID] = lc
	}
	remoteMap := make(map[string]Connection, len(remoteConns))
	for _, rc := range remoteConns {
		remoteMap[rc.ID] = rc
	}

	merged := make([]Connection, 0, len(localConns)+len(remoteConns))
	added := make(map[string]bool)

	// 按本地原始顺序遍历
	for _, lc := range localConns {
		if added[lc.ID] {
			continue
		}
		if rc, hasRemote := remoteMap[lc.ID]; hasRemote {
			if lc.LastModified >= rc.LastModified {
				merged = append(merged, lc)
			} else {
				merged = append(merged, rc)
			}
			added[lc.ID] = true
		} else {
			if lc.LastModified > lastSyncTime {
				merged = append(merged, lc)
			}
			added[lc.ID] = true
		}
	}
	// 远程独有（按远程原始顺序）
	for _, rc := range remoteConns {
		if !added[rc.ID] {
			if rc.LastModified > lastSyncTime {
				merged = append(merged, rc)
			}
			added[rc.ID] = true
		}
	}

	// host:port+username 去重（按 LastModified 保留最新的）。
	// 业务上同一账号同一入口视为同一节点，避免多端新增产生重复节点。
	type hpKey struct {
		host string
		port int
		user string
	}
	hostPortMap := make(map[hpKey]int)
	var deduped []Connection
	for _, v := range merged {
		key := hpKey{v.Host, v.Port, v.Username}
		if idx, ok := hostPortMap[key]; ok {
			if v.LastModified > deduped[idx].LastModified {
				deduped[idx] = v
			}
		} else {
			hostPortMap[key] = len(deduped)
			deduped = append(deduped, v)
		}
	}
	return deduped
}

// mergeCredentials 合并本地和云端凭据，逻辑与 mergeWithDeletionPropagation 一致
func (c *ConfigManager) mergeCredentials(localCreds, remoteCreds []Credential, lastSyncTime int64) []Credential {
	localMap := make(map[string]Credential, len(localCreds))
	for _, lc := range localCreds {
		localMap[lc.ID] = lc
	}
	remoteMap := make(map[string]Credential, len(remoteCreds))
	for _, rc := range remoteCreds {
		remoteMap[rc.ID] = rc
	}

	merged := make([]Credential, 0, len(localCreds)+len(remoteCreds))
	added := make(map[string]bool)

	for _, lc := range localCreds {
		if added[lc.ID] {
			continue
		}
		if rc, hasRemote := remoteMap[lc.ID]; hasRemote {
			if lc.LastModified >= rc.LastModified {
				merged = append(merged, lc)
			} else {
				merged = append(merged, rc)
			}
			added[lc.ID] = true
		} else {
			if lc.LastModified > lastSyncTime {
				merged = append(merged, lc)
			}
			added[lc.ID] = true
		}
	}
	for _, rc := range remoteCreds {
		if !added[rc.ID] {
			if rc.LastModified > lastSyncTime {
				merged = append(merged, rc)
			}
			added[rc.ID] = true
		}
	}
	return merged
}

func (c *ConfigManager) mergeAIProviders(localProviders, remoteProviders []ai.AIProviderProfile, lastSyncTime int64) []ai.AIProviderProfile {
	if remoteProviders == nil {
		return localProviders
	}
	remoteMap := make(map[string]ai.AIProviderProfile, len(remoteProviders))
	for _, p := range remoteProviders {
		remoteMap[p.ID] = p
	}
	merged := make([]ai.AIProviderProfile, 0, len(localProviders)+len(remoteProviders))
	added := make(map[string]bool)
	for _, lp := range localProviders {
		if added[lp.ID] {
			continue
		}
		if rp, hasRemote := remoteMap[lp.ID]; hasRemote {
			if lp.UpdatedAt >= rp.UpdatedAt {
				merged = append(merged, lp)
			} else {
				merged = append(merged, rp)
			}
		} else if lp.UpdatedAt > lastSyncTime {
			merged = append(merged, lp)
		}
		added[lp.ID] = true
	}
	for _, rp := range remoteProviders {
		if !added[rp.ID] {
			if rp.UpdatedAt > lastSyncTime {
				merged = append(merged, rp)
			}
			added[rp.ID] = true
		}
	}
	return merged
}

func (c *ConfigManager) mergeAIProxyNodes(localNodes, remoteNodes []ai.AIProxyNode, lastSyncTime int64) []ai.AIProxyNode {
	if remoteNodes == nil {
		return localNodes
	}
	remoteMap := make(map[string]ai.AIProxyNode, len(remoteNodes))
	for _, n := range remoteNodes {
		remoteMap[n.ID] = n
	}
	merged := make([]ai.AIProxyNode, 0, len(localNodes)+len(remoteNodes))
	added := make(map[string]bool)
	for _, ln := range localNodes {
		if added[ln.ID] {
			continue
		}
		if rn, hasRemote := remoteMap[ln.ID]; hasRemote {
			if ln.UpdatedAt >= rn.UpdatedAt {
				merged = append(merged, ln)
			} else {
				merged = append(merged, rn)
			}
		} else if ln.UpdatedAt > lastSyncTime {
			merged = append(merged, ln)
		}
		added[ln.ID] = true
	}
	for _, rn := range remoteNodes {
		if !added[rn.ID] {
			if rn.UpdatedAt > lastSyncTime {
				merged = append(merged, rn)
			}
			added[rn.ID] = true
		}
	}
	return merged
}

func mergeAIGlobalSettings(localSettings ai.AIGlobalSettings, remoteSettings *ai.AIGlobalSettings) ai.AIGlobalSettings {
	if remoteSettings == nil || remoteSettings.UpdatedAt <= 0 {
		return localSettings
	}
	if localSettings.UpdatedAt <= 0 || remoteSettings.UpdatedAt > localSettings.UpdatedAt {
		merged := *remoteSettings
		merged.ProxyNodes = nil
		return merged
	}
	localSettings.ProxyNodes = nil
	return localSettings
}

// ─── 同步模式分发 ─────────────────────────────────────────

// getSyncProviders 返回当前同步模式下所有已配置的提供商及初始化失败。
func (c *ConfigManager) getSyncProviders() ([]providerEntry, []providerFailure) {
	mode := c.GetSyncMode()
	var entries []providerEntry
	var failures []providerFailure

	add := func(id string, configured bool, storageFn func() (RemoteStorage, int, error)) {
		if mode != id && mode != "all" {
			return
		}
		if mode == "all" && !configured {
			return
		}
		s, max, err := storageFn()
		if err != nil {
			failures = append(failures, providerFailure{provider: id, err: err})
			return
		}
		entries = append(entries, providerEntry{provider: id, storage: s, maxBackups: max})
	}

	webdav := c.GetWebdavConfig()
	r2 := c.GetR2Config()
	ftpConfig := c.GetFTPConfig()
	sftpConfig := c.GetSFTPConfig()
	add("webdav", webdav != nil && webdav["url"] != "", c.newWebdavStorage)
	add("r2", r2 != nil && r2.Bucket != "" && r2.Endpoint != "", c.newR2Storage)
	add("ftp", ftpConfig != nil && ftpConfig.Host != "", c.newFTPStorage)
	add("sftp", sftpConfig != nil && sftpConfig.Host != "", c.newSFTPStorage)

	return entries, failures
}

type providerEntry struct {
	provider   string
	storage    RemoteStorage
	maxBackups int
}

type providerFailure struct {
	provider string
	err      error
}

func providerFailuresError(failures []providerFailure) error {
	if len(failures) == 0 {
		return nil
	}
	errs := make([]error, 0, len(failures))
	for _, failure := range failures {
		errs = append(errs, fmt.Errorf("%s: %w", failure.provider, failure.err))
	}
	return errors.Join(errs...)
}

func (c *ConfigManager) emitSyncFailure(provider string, err error) {
	if err == nil {
		return
	}
	payload := map[string]interface{}{"provider": provider, "error": err.Error(), "category": "sync"}
	if reason, ok := syncTrustFailureReason(err); ok {
		payload["category"] = "trust"
		payload["reason"] = reason
	}
	c.emitSyncEvent("sync-failed", payload)
}

func (c *ConfigManager) SyncAllProviders() (map[string]interface{}, error) {
	providers, failures := c.getSyncProviders()
	result, err := c.syncAllProviders(providers)
	return result, errors.Join(providerFailuresError(failures), err)
}

// AutoSync 自动同步：下载云端 → 双向合并(本地优先) → 上传到所有已配置的云端。
// 启动时也会调用，确保多设备间数据一致。
// 失败时最多重试 3 次（间隔 2s/4s/8s），仍失败则通过 Wails 事件通知前端。
func (c *ConfigManager) AutoSync() {
	if !c.GetAutoSyncEnabled() {
		return
	}
	// ponytail: 并发去重，避免多入口同时触发浪费网络资源
	if !c.syncRunning.CompareAndSwap(false, true) {
		return
	}
	defer c.syncRunning.Store(false)

	providers, failures := c.getSyncProviders()
	for _, failure := range failures {
		log.Printf("autoSync provider %s initialization failed: %v", failure.provider, failure.err)
		c.emitSyncFailure(failure.provider, failure.err)
	}
	if c.GetSyncMode() == "all" {
		if len(providers) == 0 && len(failures) > 0 {
			return
		}
		if _, err := c.syncAllProviders(providers); err != nil {
			log.Printf("autoSync all failed: %v", err)
			c.emitSyncFailure("all", err)
		}
		return
	}
	const maxRetries = 3

	var wg sync.WaitGroup
	for _, p := range providers {
		wg.Add(1)
		go func(p providerEntry) {
			defer wg.Done()
			if cl, ok := p.storage.(storageCloser); ok {
				defer cl.Close()
			}

			var lastErr error
			for attempt := 0; attempt < maxRetries; attempt++ {
				if attempt > 0 {
					time.Sleep(time.Duration(1<<uint(attempt)) * time.Second) // 2s, 4s, 8s
				}
				lastErr = c.autoSyncProvider(p.storage, p.maxBackups)
				if lastErr == nil {
					return
				}
				log.Printf("autoSync attempt %d/%d failed: %v", attempt+1, maxRetries, lastErr)
			}

			// 全部重试失败，通知前端
			if lastErr != nil {
				log.Printf("autoSync all %d attempts failed for %s: %v", maxRetries, p.provider, lastErr)
				c.emitSyncFailure(p.provider, lastErr)
			}
		}(p)
	}
	wg.Wait()
}

// RetrySync 前端手动重试同步，返回错误信息供前端展示
func (c *ConfigManager) RetrySync() string {
	providers, failures := c.getSyncProviders()
	if c.GetSyncMode() == "all" {
		var syncErr error
		if len(providers) > 0 {
			_, syncErr = c.syncAllProviders(providers)
		}
		if err := errors.Join(providerFailuresError(failures), syncErr); err != nil {
			return err.Error()
		}
		return ""
	}
	var errs []string
	for _, failure := range failures {
		errs = append(errs, fmt.Sprintf("%s: %v", failure.provider, failure.err))
	}
	for _, p := range providers {
		func() {
			if cl, ok := p.storage.(storageCloser); ok {
				defer cl.Close()
			}
			if err := c.autoSyncProvider(p.storage, p.maxBackups); err != nil {
				errs = append(errs, fmt.Sprintf("%T: %v", p.storage, err))
			}
		}()
	}
	if len(errs) > 0 {
		return strings.Join(errs, "; ")
	}
	return ""
}

// cmdKey 生成去重键：名称+命令（命令相同的项视为重复）
func cmdKey(m map[string]interface{}) string {
	name, _ := m["name"].(string)
	cmd, _ := m["command"].(string)
	return name + "|||" + cmd
}

// cmdLastModified 从 map 中读取 last_modified（JSON 数字是 float64）
func cmdLastModified(m map[string]interface{}) int64 {
	v, _ := m["last_modified"].(float64)
	return int64(v)
}

// quickCmdsEqual JSON 语义比较（忽略 key 顺序），避免前端 JSON.stringify 和 Go json.MarshalIndent 的 key 排序差异导致误判
func quickCmdsEqual(a, b string) bool {
	if a == b {
		return true
	}
	var va, vb interface{}
	if err := json.Unmarshal([]byte(a), &va); err != nil {
		return false
	}
	if err := json.Unmarshal([]byte(b), &vb); err != nil {
		return false
	}
	da, _ := json.Marshal(va)
	db, _ := json.Marshal(vb)
	return string(da) == string(db)
}

// mergeQuickCommands 合并本地和远端的快捷命令列表：
// - 顺序跟随 last_modified 较新的一边（移动后该边 max 更大）
// - 重叠项（同 name+command）：按 last_modified 取最新
// - 单侧独有：last_modified > lastSyncTime → 保留，否则视为已删除
// - 组内 children 同样逻辑
func (c *ConfigManager) mergeQuickCommands(localStr, remoteStr string, lastSyncTime int64) string {
	parseQuick := func(raw string) ([]interface{}, bool) {
		if strings.TrimSpace(raw) == "" {
			return []interface{}{}, true
		}
		var arr []interface{}
		if err := json.Unmarshal([]byte(raw), &arr); err != nil {
			return nil, false
		}
		return arr, true
	}

	local, ok := parseQuick(localStr)
	if !ok {
		return localStr
	}
	remote, ok := parseQuick(remoteStr)
	if !ok {
		return localStr
	}

	// build key-indexed maps
	type cmdEntry struct {
		item map[string]interface{}
		key  string
	}
	localMap := make(map[string]cmdEntry)
	for _, item := range local {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			localMap[key] = cmdEntry{m, key}
		}
	}
	remoteMap := make(map[string]cmdEntry)
	for _, item := range remote {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			remoteMap[key] = cmdEntry{m, key}
		}
	}

	// 顺序跟随 last_modified 较新的一边（移动后该边 max 更大）
	baseIsRemote := maxQuickLastModified(remote) > maxQuickLastModified(local)
	var base, other []interface{}
	var otherMap map[string]cmdEntry
	if baseIsRemote {
		base, other, otherMap = remote, local, localMap
	} else {
		base, other, otherMap = local, remote, remoteMap
	}

	result := make([]interface{}, 0)
	added := make(map[string]bool)

	for _, item := range base {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		key := cmdKey(m)
		if added[key] {
			continue
		}
		if re, inOther := otherMap[key]; inOther {
			// 重叠：按 last_modified 取最新
			if cmdLastModified(re.item) > cmdLastModified(m) {
				if lCh, ok := m["children"]; ok {
					if rCh, ok := re.item["children"]; ok {
						re.item["children"] = c.mergeCmdChildren(lCh, rCh, lastSyncTime)
					}
				}
				result = append(result, re.item)
			} else {
				if lCh, ok := m["children"]; ok {
					if rCh, ok := re.item["children"]; ok {
						m["children"] = c.mergeCmdChildren(lCh, rCh, lastSyncTime)
					}
				}
				result = append(result, m)
			}
			added[key] = true
		} else {
			// 独有：last_modified > lastSyncTime → 保留（新增），否则删除
			if cmdLastModified(m) > lastSyncTime {
				result = append(result, m)
			}
			added[key] = true
		}
	}

	// 另一边独有（按其原始顺序）：last_modified > lastSyncTime → 保留
	for _, item := range other {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			if !added[key] && cmdLastModified(m) > lastSyncTime {
				result = append(result, m)
			}
		}
	}

	data, _ := json.MarshalIndent(result, "", "  ")
	return string(data)
}

// mergeCmdChildren 合并两个 children 数组（同 mergeQuickCommands 逻辑）
func (c *ConfigManager) mergeCmdChildren(localCh, remoteCh interface{}, lastSyncTime int64) interface{} {
	lArr, lok := localCh.([]interface{})
	rArr, rok := remoteCh.([]interface{})
	if !lok || !rok {
		return remoteCh
	}

	lMap := make(map[string]map[string]interface{})
	for _, item := range lArr {
		if m, ok := item.(map[string]interface{}); ok {
			lMap[cmdKey(m)] = m
		}
	}
	rMap := make(map[string]map[string]interface{})
	for _, item := range rArr {
		if m, ok := item.(map[string]interface{}); ok {
			rMap[cmdKey(m)] = m
		}
	}

	// 顺序跟随 last_modified 较新的一边
	baseIsRemote := maxQuickLastModified(rArr) > maxQuickLastModified(lArr)
	var base, other []interface{}
	var otherMap map[string]map[string]interface{}
	if baseIsRemote {
		base, other, otherMap = rArr, lArr, lMap
	} else {
		base, other, otherMap = lArr, rArr, rMap
	}

	var result []interface{}
	added := make(map[string]bool)
	for _, item := range base {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		key := cmdKey(m)
		if added[key] {
			continue
		}
		if rm, inOther := otherMap[key]; inOther {
			if cmdLastModified(rm) > cmdLastModified(m) {
				result = append(result, rm)
			} else {
				result = append(result, m)
			}
			added[key] = true
		} else {
			if cmdLastModified(m) > lastSyncTime {
				result = append(result, m)
			}
			added[key] = true
		}
	}
	for _, item := range other {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			if !added[key] && cmdLastModified(m) > lastSyncTime {
				result = append(result, m)
			}
		}
	}
	return result
}

// maxQuickLastModified 递归计算数组中最大的 last_modified（含 children）
func maxQuickLastModified(arr []interface{}) int64 {
	var max int64
	for _, item := range arr {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if lm := cmdLastModified(m); lm > max {
			max = lm
		}
		if ch, ok := m["children"].([]interface{}); ok {
			if childMax := maxQuickLastModified(ch); childMax > max {
				max = childMax
			}
		}
	}
	return max
}

func markSnapshotRestored(snap *SyncSnapshot, t int64) {
	if snap == nil {
		return
	}
	for i := range snap.Connections {
		snap.Connections[i].LastModified = t
	}
	for i := range snap.Credentials {
		snap.Credentials[i].LastModified = t
	}
	if snap.QuickCommands != "" {
		snap.QuickCommands = touchQuickCommands(snap.QuickCommands, t)
	}
	for i := range snap.AIProviders {
		snap.AIProviders[i].UpdatedAt = t
	}
	if snap.AIGlobalSettings != nil {
		snap.AIGlobalSettings.UpdatedAt = t
		snap.AIGlobalSettings.ProxyNodes = nil
	}
	for i := range snap.ProxyNodes {
		snap.ProxyNodes[i].UpdatedAt = t
	}
	snap.SnapshotTime = t
}

func touchQuickCommands(raw string, t int64) string {
	var arr []interface{}
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return raw
	}
	touchQuickArray(arr, t)
	data, err := json.MarshalIndent(arr, "", "  ")
	if err != nil {
		return raw
	}
	return string(data)
}

func touchQuickArray(arr []interface{}, t int64) {
	for _, item := range arr {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		m["last_modified"] = t
		if children, ok := m["children"].([]interface{}); ok {
			touchQuickArray(children, t)
		}
	}
}

// restoreSnapshotToLocal 将快照中的所有数据恢复到本地文件
func (c *ConfigManager) restoreSnapshotToLocal(snap *SyncSnapshot) {
	if snap == nil {
		return
	}
	c.mu.Lock()
	if err := c.saveConnectionsFile(snap.Connections); err != nil {
		log.Printf("[restoreSnapshotToLocal] failed to save connections: %v", err)
	}
	c.connCacheDirty = true
	if snap.Credentials != nil {
		if err := c.saveCredentialsFile(snap.Credentials); err != nil {
			log.Printf("[restoreSnapshotToLocal] failed to save credentials: %v", err)
		}
		c.credCacheDirty = true
	}
	c.mu.Unlock()
	if snap.HasQuickCommands {
		if err := atomicWriteFile(c.quickCmdFile, []byte(snap.QuickCommands), 0600); err != nil {
			log.Printf("[restoreSnapshotToLocal] failed to write quick commands: %v", err)
		}
	}
	if snap.AIProviders != nil {
		if err := c.SaveAIProviderRegistry(ai.AIProviderRegistry{Providers: snap.AIProviders}); err != nil {
			log.Printf("[restoreSnapshotToLocal] failed to write AI providers: %v", err)
		}
	}
	if snap.AIGlobalSettings != nil {
		if err := c.SaveAIGlobalSettings(*snap.AIGlobalSettings); err != nil {
			log.Printf("[restoreSnapshotToLocal] failed to write AI global settings: %v", err)
		}
	}
	if snap.ProxyNodes != nil {
		if err := c.SaveAIProxyNodes(snap.ProxyNodes); err != nil {
			log.Printf("[restoreSnapshotToLocal] failed to write AI proxy nodes: %v", err)
		}
	}
}

// restoreFromProvider 是 RestoreFromXxxFile 的共享实现：
// 读取远端文件 → 解密解析快照 → 写回本地。
// 统一用 filepath.Base 防止路径穿越。
// extraKey 通常为恢复密码派生密钥，可为 nil。
func (c *ConfigManager) restoreFromProvider(s RemoteStorage, filename string, maxBackups int, password string) error {
	filename = filepath.Base(filename) // 防止路径穿越
	data, err := s.ReadFile(filename)
	if err != nil {
		return err
	}
	snap, err := c.decryptAndParseSnapshot(string(data), s.EncryptKey(), password) // s.EncryptKey() 仅为旧版 .enc 兼容
	if err != nil {
		return err
	}
	restoreTime := time.Now().UnixMilli()
	markSnapshotRestored(snap, restoreTime)
	c.restoreSnapshotToLocal(snap)
	atomicWriteFile(c.syncTimeFile, []byte(fmt.Sprintf("%d", restoreTime)), 0600)
	c.saveLastSyncTime(restoreTime - 1)
	if _, err := c.backupConnections(s, maxBackups); err != nil {
		return err
	}
	c.saveLastSyncTime(time.Now().UnixMilli())
	return nil
}

// restoreResult 将 restoreFromProvider 的 error 结果包装为各 Restore 方法统一的返回值
func restoreResult(err error) (map[string]interface{}, error) {
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"success": true}, nil
}

// ─── 备份提供者共享包装方法 ─────────────────────────────────
// 以下 backupTo/listBackupsFrom/syncFrom/restoreFrom 方法消除了 4 个提供者
// （webdav/r2/ftp/sftp）各自的 BackupToXxx/ListXxxBackups/SyncFromXxx/RestoreFromXxxFile
// 样板代码，统一处理 storageCloser 释放。

// backupTo 创建存储、备份、关闭连接
func (c *ConfigManager) backupTo(storageFn func() (RemoteStorage, int, error)) (map[string]interface{}, error) {
	s, max, err := storageFn()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return c.backupConnections(s, max)
}

// listBackupsFrom 创建存储、列出备份、关闭连接
func (c *ConfigManager) listBackupsFrom(storageFn func() (RemoteStorage, int, error)) ([]map[string]interface{}, error) {
	s, _, err := storageFn()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return c.listBackupFiles(s)
}

// syncFrom 创建存储、同步、关闭连接
func (c *ConfigManager) syncFrom(storageFn func() (RemoteStorage, int, error)) (map[string]interface{}, error) {
	s, max, err := storageFn()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return c.syncFromProvider(s, max)
}

// restoreFrom 创建存储、恢复、关闭连接。
// password 为空时仅尝试明文和旧版云端派生密钥；非空时用于 .lumin2 或旧 hex 解密。
func (c *ConfigManager) restoreFrom(storageFn func() (RemoteStorage, int, error), filename string, password string) (map[string]interface{}, error) {
	s, max, err := storageFn()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return restoreResult(c.restoreFromProvider(s, filename, max, password))
}
