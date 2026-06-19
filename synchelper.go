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
	QuickCommands string       `json:"quick_commands,omitempty"`
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

// mergeAndDedupe 合并本地和远程连接列表：
// 1. 按 ID 合并（远端覆盖同名）
// 2. 按 host:port+username 去重，保留信息更完整的记录
func (c *ConfigManager) mergeAndDedupe(localConns, remoteConns []Connection) []Connection {
	mergedMap := make(map[string]Connection)
	for _, lc := range localConns {
		mergedMap[lc.ID] = lc
	}
	for _, rc := range remoteConns {
		mergedMap[rc.ID] = rc
	}

	merged := make([]Connection, 0, len(mergedMap))
	for _, v := range mergedMap {
		merged = append(merged, v)
	}
	// 按 ID 排序，保证去重结果稳定可重现（避免 map 迭代顺序随机）
	sort.Slice(merged, func(i, j int) bool {
		return merged[i].ID < merged[j].ID
	})

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
			// 字段级合并：仅用 v 填补 existing 中缺失的字段，避免整条覆盖丢失数据
			existing := deduped[idx]
			if existing.Password == "" && v.Password != "" {
				existing.Password = v.Password
			}
			if existing.PrivateKey == "" && v.PrivateKey != "" {
				existing.PrivateKey = v.PrivateKey
			}
			if existing.Passphrase == "" && v.Passphrase != "" {
				existing.Passphrase = v.Passphrase
			}
			if v.Name != "" && existing.Name == "" {
				existing.Name = v.Name
			}
			deduped[idx] = existing
		} else {
			hostPortMap[key] = len(deduped)
			deduped = append(deduped, v)
		}
	}
	return deduped
}

// connsEqual 比较两个连接列表是否内容一致（按 ID 排序后比 JSON）
func connsEqual(a, b []Connection) bool {
	if len(a) != len(b) {
		return false
	}
	sa := sortedConnsJSON(a)
	sb := sortedConnsJSON(b)
	return sa == sb
}

func sortedConnsJSON(conns []Connection) string {
	sorted := make([]Connection, len(conns))
	copy(sorted, conns)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].ID < sorted[j].ID
	})
	data, _ := json.Marshal(sorted)
	return string(data)
}

// snapshotEqual 比较本地快照和远端快照是否一致
func snapshotEqual(s1, s2 *SyncSnapshot) bool {
	if !connsEqual(s1.Connections, s2.Connections) {
		return false
	}
	if s1.QuickCommands != s2.QuickCommands {
		return false
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

	var latest string
	var latestTime time.Time
	for _, f := range files {
		if !f.IsDir && strings.HasPrefix(f.Name, "connections_backup_") && f.ModTime.After(latestTime) {
			latestTime = f.ModTime
			latest = f.Name
		}
	}
	if latest == "" {
		return nil, fmt.Errorf("云端没有备份文件")
	}

	data, err := s.ReadFile(latest)
	if err != nil {
		return nil, err
	}
	return c.decryptAndParseSnapshot(string(data), s.EncryptKey())
}

// backupConnections 加密本地所有可同步数据并上传到远端，同时清理超出 maxBackups 的旧备份
func (c *ConfigManager) backupConnections(s RemoteStorage, maxBackups int) (map[string]interface{}, error) {
	snap := SyncSnapshot{
		Connections:   c.GetConnections(),
		QuickCommands: c.loadRawFile(c.quickCmdFile),
	}
	data, _ := json.MarshalIndent(snap, "", "  ")
	encrypted, err := c.encryptWithKey(string(data), s.EncryptKey())
	if err != nil {
		return nil, fmt.Errorf("encrypt snapshot: %w", err)
	}

	// 文件名精度到毫秒，避免自动同步与手动同步在同一秒触发时写入同一文件名导致覆盖
	timestamp := time.Now().Format("20060102_150405.000")
	fileName := fmt.Sprintf("connections_backup_%s.enc", timestamp)
	if err := s.WriteFile(fileName, []byte(encrypted)); err != nil {
		return nil, err
	}

	if maxBackups > 0 {
		c.pruneOldBackups(s, maxBackups)
	}

	return map[string]interface{}{
		"path":  fileName,
		"time":  time.Now().Format("2006-01-02 15:04:05"),
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
			backups = append(backups, map[string]interface{}{
				"name": f.Name,
				"size": f.Size,
				"time": f.ModTime.Format("2006-01-02 15:04:05"),
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

	// 合并连接（双向：按 ID 去重合并）
	localConns := c.GetConnections()
	deduped := c.mergeAndDedupe(localConns, remoteSnap.Connections)
	c.saveConnectionsFile(deduped)
	c.CleanupOrphanedHistory() // 清理已不存在的连接的历史文件

	// 合并快捷命令（双向：按 name 去重合并）
	localQuickCmds := c.loadRawFile(c.quickCmdFile)
	mergedQuickCmds := c.mergeQuickCommands(localQuickCmds, remoteSnap.QuickCommands)
	if err := os.WriteFile(c.quickCmdFile, []byte(mergedQuickCmds), 0600); err != nil {
		log.Printf("[syncFromProvider] failed to write quick commands: %v", err)
	}

	var backupResult interface{}
	changed := !connsEqual(deduped, remoteSnap.Connections) ||
		mergedQuickCmds != remoteSnap.QuickCommands
	if changed {
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

	return map[string]interface{}{
		"success":     true,
		"localCount":  len(localConns),
		"remoteCount": len(remoteSnap.Connections),
		"mergedCount": len(deduped),
		"backup":      backupResult,
	}, nil
}

// autoSyncProvider 自动同步：以本地为准推送变更到云端，无变化则跳过
func (c *ConfigManager) autoSyncProvider(s RemoteStorage, maxBackups int) {
	localSnap := &SyncSnapshot{
		Connections:   c.GetConnections(),
		QuickCommands: c.loadRawFile(c.quickCmdFile),
	}

	remoteSnap, err := c.fetchLatestBackup(s)
	if err != nil {
		if _, berr := c.backupConnections(s, maxBackups); berr != nil { // 云端无备份，直接上传
			log.Printf("autoSync backup failed: %v", berr)
		}
		return
	}

	if !snapshotEqual(localSnap, remoteSnap) {
		if _, berr := c.backupConnections(s, maxBackups); berr != nil {
			log.Printf("autoSync backup failed: %v", berr)
		}
	}
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

// AutoSync 自动同步：以本地为准推送变更到所有已配置的云端。
// 各 provider 只读本地文件（GetConnections/loadRawFile 有 c.mu 保护）、写各自远端，无冲突，
// 因此并行调度以降低总耗时。任一 provider 失败仅记录日志（autoSyncProvider 内部已记录），不影响其他。
func (c *ConfigManager) AutoSync() {
	providers := c.getSyncProviders()
	var wg sync.WaitGroup
	for _, p := range providers {
		wg.Add(1)
		go func(p providerEntry) {
			defer wg.Done()
			// 释放该 provider 持有的底层连接（如 SFTP/FTP），webdav/r2 无需关闭
			if cl, ok := p.storage.(storageCloser); ok {
				defer cl.Close()
			}
			c.autoSyncProvider(p.storage, p.maxBackups)
		}(p)
	}
	wg.Wait()
}

// cmdKey 生成去重键：名称+命令（命令相同的项视为重复）
func cmdKey(m map[string]interface{}) string {
	name, _ := m["name"].(string)
	cmd, _ := m["command"].(string)
	return name + "|||" + cmd
}

// mergeQuickCommands 合并本地和远端的快捷命令列表（按 名称+命令 去重合并，组内 children 同样）
func (c *ConfigManager) mergeQuickCommands(localStr, remoteStr string) string {
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

	// build key-indexed map from local
	localMap := make(map[string]interface{})
	var localOrder []string
	for _, item := range local {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			localMap[key] = m
			localOrder = append(localOrder, key)
		}
	}

	// merge remote into local
	for _, item := range remote {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			if existing, ok := localMap[key]; ok {
				// group with children on both sides → merge children
				if ex, eok := existing.(map[string]interface{}); eok {
					if exCh, exOk := ex["children"]; exOk {
						if rmCh, rmOk := m["children"]; rmOk {
							mergedCh := c.mergeCmdChildren(exCh, rmCh)
							m["children"] = mergedCh
						}
					}
				}
			}
			localMap[key] = m
		}
	}

	// build result preserving local order, then append new remote items
	result := make([]interface{}, 0)
	added := make(map[string]bool)
	for _, key := range localOrder {
		if _, ok := localMap[key]; ok {
			result = append(result, localMap[key])
			added[key] = true
		}
	}
	for _, item := range remote {
		if m, ok := item.(map[string]interface{}); ok {
			key := cmdKey(m)
			if !added[key] {
				result = append(result, m)
			}
		}
	}

	data, _ := json.MarshalIndent(result, "", "  ")
	return string(data)
}

// mergeCmdChildren 合并两个 children 数组（按 名称+命令 去重，remote 覆盖同名的 local）
func (c *ConfigManager) mergeCmdChildren(localCh, remoteCh interface{}) interface{} {
	lArr, lok := localCh.([]interface{})
	rArr, rok := remoteCh.([]interface{})
	if !lok || !rok {
		return remoteCh
	}

	childMap := make(map[string]interface{})
	var order []string
	for _, c := range lArr {
		if m, ok := c.(map[string]interface{}); ok {
			key := cmdKey(m)
			childMap[key] = m
			order = append(order, key)
		}
	}
	for _, c := range rArr {
		if m, ok := c.(map[string]interface{}); ok {
			key := cmdKey(m)
			if _, exists := childMap[key]; !exists {
				order = append(order, key)
			}
			childMap[key] = m
		}
	}

	result := make([]interface{}, 0, len(childMap))
	for _, n := range order {
		if v, ok := childMap[n]; ok {
			result = append(result, v)
		}
	}
	return result
}

// restoreSnapshotToLocal 将快照中的所有数据恢复到本地文件
func (c *ConfigManager) restoreSnapshotToLocal(snap *SyncSnapshot) {
	if snap == nil {
		return
	}
	c.saveConnectionsFile(snap.Connections)
	if snap.QuickCommands != "" {
		if err := os.WriteFile(c.quickCmdFile, []byte(snap.QuickCommands), 0600); err != nil {
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
	return nil
}

// restoreResult 将 restoreFromProvider 的 error 结果包装为各 Restore 方法统一的返回值
func restoreResult(err error) (map[string]interface{}, error) {
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"success": true}, nil
}
