package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

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
	Connections   []Connection `json:"connections"`
	Credentials   []Credential `json:"credentials,omitempty"`
	QuickCommands string       `json:"quick_commands,omitempty"`
	SnapshotTime  int64        `json:"snapshot_time,omitempty"` // 快照总时间戳（Unix 毫秒），用于判断同步方向
}

// ─── 共享解密/解析 ─────────────────────────────────────────

// decryptAndParseSnapshot 解密并解析为完整快照（优先新格式，回退旧格式）
func (c *ConfigManager) decryptAndParseSnapshot(data string, key []byte) (*SyncSnapshot, error) {
	decrypted := c.decryptWithKey(data, key)
	if decrypted == "" {
		decrypted = c.decryptWithKey(data, c.key)
		if decrypted == "" {
			return nil, fmt.Errorf("解密失败：如果这是旧版本产生的备份，且您之前卸载清理了本地缓存(lumin.key)，则受 AES-256 高强加密保护，资料已永久无法恢复。")
		}
	}
	// 尝试新格式（快照）
	var snap SyncSnapshot
	if err := json.Unmarshal([]byte(decrypted), &snap); err == nil && snap.Connections != nil {
		return &snap, nil
	}
	// 回退旧格式（纯连接列表）
	var conns []Connection
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
		if e.Name != c.Name || e.Host != c.Host || e.Port != c.Port ||
			e.Username != c.Username || e.Password != c.Password ||
			e.AuthMethod != c.AuthMethod || e.PrivateKey != c.PrivateKey ||
			e.Passphrase != c.Passphrase || e.Os != c.Os || e.Group != c.Group {
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
		if e.Name != c.Name || e.AuthMethod != c.AuthMethod ||
			e.Username != c.Username || e.Password != c.Password ||
			e.PrivateKey != c.PrivateKey || e.Passphrase != c.Passphrase {
			return false
		}
	}
	return true
}

// ─── 共享远端操作 ─────────────────────────────────────────

// fetchLatestBackup 从远端下载最新备份并解密为快照
func (c *ConfigManager) fetchLatestBackup(s RemoteStorage) (*SyncSnapshot, error) {
	files, err := s.ListFiles()
	if err != nil {
		return nil, fmt.Errorf("读取远程目录失败：%w", err)
	}

	// 按文件名（含毫秒精度时间戳）降序排列，跨平台一致性优于 ModTime
	var backups []string
	for _, f := range files {
		if !f.IsDir && strings.HasPrefix(f.Name, "connections_backup_") {
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
		parsed, err := c.decryptAndParseSnapshot(string(data), s.EncryptKey())
		if err != nil {
			log.Printf("fetchLatestBackup: decrypt %s: %v (skipping)", name, err)
			continue
		}
		if parsed.Connections == nil {
			continue
		}
		if snap == nil {
			snap = parsed
			log.Printf("fetchLatestBackup: selected %s (snapTime=%d creds=%d)", name, snap.SnapshotTime, len(snap.Credentials))
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

// backupConnections 加密本地所有可同步数据并上传到远端，同时清理超出 maxBackups 的旧备份
func (c *ConfigManager) backupConnections(s RemoteStorage, maxBackups int) (map[string]interface{}, error) {
	snap := SyncSnapshot{
		Connections:   c.GetConnections(),
		Credentials:   c.GetCredentials(),
		QuickCommands: c.loadRawFile(c.quickCmdFile),
		SnapshotTime:  c.loadSnapshotTime(),
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal snapshot: %w", err)
	}
	encrypted, err := c.encryptWithKey(string(data), s.EncryptKey())
	if err != nil {
		return nil, fmt.Errorf("encrypt snapshot: %w", err)
	}

	// 文件名精度到毫秒 + 时区，避免服务器 ModTime 时区不同导致显示错误
	timestamp := time.Now().Format("20060102_150405.000_-0700")
	fileName := fmt.Sprintf("connections_backup_%s.enc", timestamp)
	if err := s.WriteFile(fileName, []byte(encrypted)); err != nil {
		return nil, err
	}

	if maxBackups > 0 {
		c.pruneOldBackups(s, maxBackups)
	}

	return map[string]interface{}{
		"path":  fileName,
		"time":  time.Now().Format("2006-01-02 15:04:05 -0700"),
		"count": len(snap.Connections),
	}, nil
}

// pruneOldBackups 删除超出数量的最旧备份文件
func (c *ConfigManager) pruneOldBackups(s RemoteStorage, maxBackups int) {
	files, err := s.ListFiles()
	if err != nil {
		return
	}

	type backupEntry struct {
		name string
		time time.Time
	}
	var backups []backupEntry
	for _, f := range files {
		if !f.IsDir && strings.HasPrefix(f.Name, "connections_backup_") {
			backups = append(backups, backupEntry{f.Name, f.ModTime})
		}
	}
	if len(backups) > maxBackups {
		sort.Slice(backups, func(i, j int) bool {
			return backups[i].time.Before(backups[j].time)
		})
		for i := 0; i < len(backups)-maxBackups; i++ {
			if err := s.DeleteFile(backups[i].name); err != nil {
				log.Printf("pruneOldBackups: failed to delete %s: %v", backups[i].name, err)
			}
		}
	}
}

// listBackupFiles 列出远端备份文件及其元信息
func (c *ConfigManager) listBackupFiles(s RemoteStorage) ([]map[string]interface{}, error) {
	files, err := s.ListFiles()
	if err != nil {
		return nil, err
	}

	var backups []map[string]interface{}
	for _, f := range files {
		if !f.IsDir && strings.HasPrefix(f.Name, "connections_backup_") {
			// 从文件名解析时间：优先新格式（带时区），fallback 旧格式（无时区用本地时间）
			timeStr := ""
			if t, err := time.Parse("connections_backup_20060102_150405.000_-0700.enc", f.Name); err == nil {
				timeStr = t.Local().Format("2006-01-02 15:04:05 -0700")
			} else if t, err := time.ParseInLocation("connections_backup_20060102_150405.000.enc", f.Name, time.Local); err == nil {
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
func (c *ConfigManager) syncFromProvider(s RemoteStorage) (map[string]interface{}, error) {
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
		log.Printf("[syncFromProvider] failed to save connections: %v", err)
	}
	c.connCacheDirty = true

	// 合并凭据
	var mergedCreds []Credential
	if remoteSnap.Credentials != nil {
		localCreds := c.getCredentialsLocked()
		mergedCreds = c.mergeCredentials(localCreds, remoteSnap.Credentials, lastSyncTime)
		if err := c.saveCredentialsFile(mergedCreds); err != nil {
			log.Printf("[syncFromProvider] failed to save credentials: %v", err)
		}
		c.credCacheDirty = true
	}
	c.mu.Unlock()
	c.CleanupOrphanedHistory() // 清理已不存在的连接的历史文件

	// 合并快捷命令（按 last_modified 取最新，单侧独有按 lastSyncTime 判断删除）
	localQuickCmds := c.loadRawFile(c.quickCmdFile)
	mergedQuickCmds := c.mergeQuickCommands(localQuickCmds, remoteSnap.QuickCommands, lastSyncTime)
	if err := atomicWriteFile(c.quickCmdFile, []byte(mergedQuickCmds), 0600); err != nil {
		log.Printf("[syncFromProvider] failed to write quick commands: %v", err)
	}

	var backupResult interface{}
	changed := !connsEqual(deduped, remoteSnap.Connections) ||
		!quickCmdsEqual(mergedQuickCmds, remoteSnap.QuickCommands) ||
		(mergedCreds != nil && !credsEqual(mergedCreds, remoteSnap.Credentials))
	if changed {
		c.bumpSnapshotTime() // 手动同步后更新总时间戳，确保下次自动同步方向正确
		// 通过可选接口获取后端配置的 maxBackups，未实现者默认 0（不清理）
		maxBackups := 0
		if mb, ok := s.(maxBackupsProvider); ok {
			maxBackups = mb.MaxBackups()
		}
		br, berr := c.backupConnections(s, maxBackups)
		if berr != nil {
			log.Printf("syncFromProvider: backup failed: %v", berr)
		}
		backupResult = br
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
		// 云端无备份或网络不可达，尝试首次上传
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
	if remoteSnap.Credentials != nil {
		mergedCreds = c.mergeCredentials(localCreds, remoteSnap.Credentials, lastSyncTime)
	} else {
		mergedCreds = localCreds
	}

	// 快捷命令合并：重叠按 last_modified 取最新，单侧独有按 lastSyncTime 判断删除
	localQuickCmds := c.loadRawFile(c.quickCmdFile)
	mergedQuickCmds := c.mergeQuickCommands(localQuickCmds, remoteSnap.QuickCommands, lastSyncTime)

	// 本地有变化 → 保存
	credsChanged := remoteSnap.Credentials != nil && !credsEqual(mergedCreds, localCreds)
	localChanged := !connsEqual(merged, localConns) || !quickCmdsEqual(mergedQuickCmds, localQuickCmds) || credsChanged

	// 云端有变化 → 需要上传
	cloudCredsChanged := !credsEqual(mergedCreds, remoteSnap.Credentials)
	cloudChanged := !connsEqual(merged, remoteSnap.Connections) || !quickCmdsEqual(mergedQuickCmds, remoteSnap.QuickCommands) || cloudCredsChanged

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
		if !quickCmdsEqual(mergedQuickCmds, localQuickCmds) {
			// staleness check: 重读文件确认没有被并发 SaveQuickCommands 覆盖
			// ponytail: 已持写锁，不能再调 loadRawFile（它会 RLock 自死锁），直接 os.ReadFile
			data, _ := os.ReadFile(c.quickCmdFile)
			if quickCmdsEqual(string(data), localQuickCmds) {
				atomicWriteFile(c.quickCmdFile, []byte(mergedQuickCmds), 0600)
			}
		}
		c.mu.Unlock()
		c.CleanupOrphanedHistory()
	}

	// 云端有变化 → 上传
	if cloudChanged {
		c.bumpSnapshotTime()
		if _, berr := c.backupConnections(s, maxBackups); berr != nil {
			log.Printf("[autoSyncProvider] backup failed: %v", berr)
		}
	} else if localChanged {
		c.bumpSnapshotTime()
	}

	// 更新本地时间戳为双方最大值，保持同步
	if remoteSnapTime > localSnapTime {
		atomicWriteFile(c.syncTimeFile, []byte(fmt.Sprintf("%d", remoteSnapTime)), 0600)
	}
	c.saveLastSyncTime(time.Now().UnixMilli())

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

	// host:port+username 去重（按 LastModified 保留最新的）
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
	// ponytail: 本地无凭据说明是首次同步凭据的新设备，
	// lastSyncTime 可能已被其他数据类型（连接）的同步设置，不应因此丢弃远程凭据
	if len(localCreds) == 0 {
		lastSyncTime = 0
	}

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

// ─── 同步模式分发 ─────────────────────────────────────────

// getSyncProviders 返回当前同步模式下所有已配置的提供商
func (c *ConfigManager) getSyncProviders() []providerEntry {
	mode := c.GetSyncMode()
	var entries []providerEntry

	add := func(match string, storageFn func() (RemoteStorage, int, error)) {
		if mode == match || mode == "all" {
			s, max, err := storageFn()
			if err == nil {
				entries = append(entries, providerEntry{storage: s, maxBackups: max})
			}
		}
	}

	add("webdav", c.newWebdavStorage)
	add("r2", c.newR2Storage)
	add("ftp", c.newFTPStorage)
	add("sftp", c.newSFTPStorage)

	if mode != "all" && mode != "webdav" {
		// 选中的方式不可用则回退到 webdav
		if len(entries) == 0 {
			log.Printf("getSyncProviders: selected provider %s not available, falling back", mode)
			s, max, err := c.newWebdavStorage()
			if err == nil {
				entries = append(entries, providerEntry{storage: s, maxBackups: max})
			}
		}
	}

	return entries
}

type providerEntry struct {
	storage    RemoteStorage
	maxBackups int
}

// AutoSync 自动同步：下载云端 → 双向合并(本地优先) → 上传到所有已配置的云端。
// 启动时也会调用，确保多设备间数据一致。
// 失败时最多重试 3 次（间隔 2s/4s/8s），仍失败则通过 Wails 事件通知前端。
func (c *ConfigManager) AutoSync() {
	// ponytail: 并发去重，避免多入口同时触发浪费网络资源
	if !c.syncRunning.CompareAndSwap(false, true) {
		return
	}
	defer c.syncRunning.Store(false)

	providers := c.getSyncProviders()
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
				providerName := fmt.Sprintf("%T", p.storage)
				log.Printf("autoSync all %d attempts failed for %s: %v", maxRetries, providerName, lastErr)
				if c.wailsCtx != nil {
					runtime.EventsEmit(c.wailsCtx, "sync-failed", map[string]interface{}{
						"provider": providerName,
						"error":    lastErr.Error(),
					})
				}
			}
		}(p)
	}
	wg.Wait()
}

// RetrySync 前端手动重试同步，返回错误信息供前端展示
func (c *ConfigManager) RetrySync() string {
	providers := c.getSyncProviders()
	var errs []string
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
	// 重新 marshal 为规范形式比较
	da, _ := json.Marshal(va)
	db, _ := json.Marshal(vb)
	return string(da) == string(db)
}

// mergeQuickCommands 合并本地和远端的快捷命令列表：
// - 重叠项（同 name+command）：按 last_modified 取最新
// - 单侧独有：last_modified > lastSyncTime → 保留，否则视为已删除
// - 组内 children 同样逻辑
func (c *ConfigManager) mergeQuickCommands(localStr, remoteStr string, lastSyncTime int64) string {
	if remoteStr == "" || remoteStr == "[]" {
		return localStr
	}
	if localStr == "" || localStr == "[]" {
		return remoteStr
	}

	var local, remote []interface{}
	if err := json.Unmarshal([]byte(localStr), &local); err != nil {
		return localStr
	}
	if err := json.Unmarshal([]byte(remoteStr), &remote); err != nil {
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

	result := make([]interface{}, 0)
	added := make(map[string]bool)

	// 本地的每项（按原始顺序）：重叠按 last_modified 取最新，本地独有按 lastSyncTime 判断删除
	for _, item := range local {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		key := cmdKey(m)
		if added[key] {
			continue
		}
		if re, inRemote := remoteMap[key]; inRemote {
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
			// 本地独有：last_modified > lastSyncTime → 保留（新增），否则删除
			if cmdLastModified(m) > lastSyncTime {
				result = append(result, m)
			}
			added[key] = true
		}
	}

	// 远程独有（按远程原始顺序）：last_modified > lastSyncTime → 保留
	for _, item := range remote {
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

	var result []interface{}
	added := make(map[string]bool)
	for _, item := range lArr {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		key := cmdKey(m)
		if added[key] {
			continue
		}
		if rm, inRemote := rMap[key]; inRemote {
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
	for _, item := range rArr {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			if !added[key] && cmdLastModified(m) > lastSyncTime {
				result = append(result, m)
			}
		}
	}
	return result
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
	if snap.QuickCommands != "" {
		if err := atomicWriteFile(c.quickCmdFile, []byte(snap.QuickCommands), 0600); err != nil {
			log.Printf("[restoreSnapshotToLocal] failed to write quick commands: %v", err)
		}
	}
}

// restoreFromProvider 是 RestoreFromXxxFile 的共享实现：
// 读取远端文件 → 解密解析快照 → 写回本地。
// 统一用 filepath.Base 防止路径穿越。
func (c *ConfigManager) restoreFromProvider(s RemoteStorage, filename string) error {
	filename = filepath.Base(filename) // 防止路径穿越
	data, err := s.ReadFile(filename)
	if err != nil {
		return err
	}
	snap, err := c.decryptAndParseSnapshot(string(data), s.EncryptKey())
	if err != nil {
		return err
	}
	c.restoreSnapshotToLocal(snap)
	c.bumpSnapshotTime() // 恢复后更新总时间戳，确保下次自动同步方向正确
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
	s, _, err := storageFn()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return c.syncFromProvider(s)
}

// restoreFrom 创建存储、恢复、关闭连接
func (c *ConfigManager) restoreFrom(storageFn func() (RemoteStorage, int, error), filename string) (map[string]interface{}, error) {
	s, _, err := storageFn()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return restoreResult(c.restoreFromProvider(s, filename))
}
