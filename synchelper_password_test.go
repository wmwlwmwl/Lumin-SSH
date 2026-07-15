package main

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	"errors"
	ai "luminssh-go/internal/ai"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type memoryStorage struct {
	files    map[string][]byte
	readErr  map[string]error
	listErr  error
	writeErr error
	writes   []string
	deletes  []string
}

func (s *memoryStorage) ListFiles() ([]RemoteFile, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	files := make([]RemoteFile, 0, len(s.files))
	for name, data := range s.files {
		files = append(files, RemoteFile{Name: name, Size: int64(len(data)), ModTime: time.Now()})
	}
	return files, nil
}
func (s *memoryStorage) ReadFile(name string) ([]byte, error) {
	if err := s.readErr[name]; err != nil {
		return nil, err
	}
	return s.files[name], nil
}
func (s *memoryStorage) WriteFile(name string, data []byte) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	if s.files == nil {
		s.files = map[string][]byte{}
	}
	s.files[name] = append([]byte(nil), data...)
	s.writes = append(s.writes, name)
	return nil
}
func (s *memoryStorage) DeleteFile(name string) error {
	delete(s.files, name)
	s.deletes = append(s.deletes, name)
	return nil
}
func (s *memoryStorage) EncryptKey() []byte { return nil }

func testSyncManager(t *testing.T) *ConfigManager {
	t.Helper()
	dir := t.TempDir()
	key := make([]byte, 32)
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	return &ConfigManager{
		configDir:            dir,
		connFile:             filepath.Join(dir, "connections.json"),
		credFile:             filepath.Join(dir, "credentials.json"),
		quickCmdFile:         filepath.Join(dir, "quick_commands.json"),
		syncTimeFile:         filepath.Join(dir, "snapshot_time"),
		lastSyncFile:         filepath.Join(dir, "last_sync_time"),
		recoveryPasswordFile: filepath.Join(dir, "recovery_password"),
		syncModeFile:         filepath.Join(dir, "sync_mode.json"),
		historyDir:           dir,
		key:                  key,
		gcm:                  gcm,
	}
}

func encryptedSnapshot(t *testing.T, password, id string) []byte {
	t.Helper()
	return encryptedSyncSnapshot(t, password, &SyncSnapshot{Connections: []Connection{{ID: id, Host: id, LastModified: 1}}})
}

func encryptedSyncSnapshot(t *testing.T, password string, snap *SyncSnapshot) []byte {
	t.Helper()
	data, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := encryptLUMIN2(string(data), password)
	if err != nil {
		t.Fatal(err)
	}
	return []byte(encrypted)
}

func TestFetchLatestBackupStrictlyFailsOnNewest(t *testing.T) {
	cm := testSyncManager(t)
	s := &memoryStorage{files: map[string][]byte{
		"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "正确", "old"),
		"connections_backup_20260102_000000.000_+0000.lumin2": encryptedSnapshot(t, "其他", "new"),
	}}
	_, err := cm.fetchLatestBackup(s, "正确")
	if !errors.Is(err, errRecoveryPassword) {
		t.Fatalf("最新备份密码错误应严格失败且可分类，得到：%v", err)
	}
}

func TestChangeRecoveryPasswordWithoutProvidersOnlyPersistsLocally(t *testing.T) {
	cm := testSyncManager(t)
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) { return nil, nil }
	if err := cm.ChangeRecoveryPassword("仅本地密码"); err != nil {
		t.Fatal(err)
	}
	if got := cm.GetRecoveryPassword(); got != "仅本地密码" {
		t.Fatalf("无云端时应允许仅设置本地密码，得到：%q", got)
	}
	if err := cm.ChangeRecoveryPassword(""); err != nil {
		t.Fatal(err)
	}
	if got := cm.GetRecoveryPassword(); got != "" {
		t.Fatalf("无云端时应允许清除本地密码，得到：%q", got)
	}
}

func TestChangeRecoveryPasswordWrongPasswordWritesNothing(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.SetRecoveryPassword("旧密码"); err != nil {
		t.Fatal(err)
	}
	s := &memoryStorage{files: map[string][]byte{
		"connections_backup_20260102_000000.000_+0000.lumin2": encryptedSnapshot(t, "第三个密码", "remote"),
	}}
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	err := cm.ChangeRecoveryPassword("新密码")
	if !errors.Is(err, errRecoveryPasswordResetRequired) {
		t.Fatalf("旧、新密码都错误时应返回稳定重置分类，得到：%v", err)
	}
	if errors.Is(err, errRecoveryPassword) {
		t.Fatalf("稳定重置分类不应伪装成普通密码错误：%v", err)
	}
	if len(s.writes) != 0 || len(s.deletes) != 0 {
		t.Fatalf("密码预检失败不得写远端：writes=%v deletes=%v", s.writes, s.deletes)
	}
	if got := cm.GetRecoveryPassword(); got != "旧密码" {
		t.Fatalf("密码预检失败不得改本地密码，得到：%q", got)
	}
	if _, err := os.Stat(cm.connFile); !os.IsNotExist(err) {
		t.Fatalf("密码预检失败不得写本地同步数据：%v", err)
	}
}

func TestChangeRecoveryPasswordDoesNotClassifyNonPasswordError(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.SetRecoveryPassword("旧密码"); err != nil {
		t.Fatal(err)
	}
	networkErr := errors.New("网络中断")
	s := &memoryStorage{files: map[string][]byte{}, readErr: map[string]error{}, writeErr: nil}
	s.readErr["connections_backup_20260101_000000.000_+0000.lumin2"] = networkErr
	s.files["connections_backup_20260101_000000.000_+0000.lumin2"] = encryptedSnapshot(t, "旧密码", "remote")
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	err := cm.ChangeRecoveryPassword("新密码")
	if !errors.Is(err, networkErr) {
		t.Fatalf("网络错误应保持错误链，得到：%v", err)
	}
	if errors.Is(err, errRecoveryPasswordResetRequired) {
		t.Fatalf("网络错误不得分类为强制重置：%v", err)
	}
}

func TestChangeRecoveryPasswordAllFailsClosed(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.SetRecoveryPassword("旧密码"); err != nil {
		t.Fatal(err)
	}
	first := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "旧密码", "one")}}
	second := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "错误", "two")}}
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: first}, {provider: "r2", storage: second}}, nil
	}
	if err := cm.ChangeRecoveryPassword("新密码"); err == nil {
		t.Fatal("all 模式任一预检失败应整体失败")
	}
	if len(first.writes)+len(second.writes) != 0 {
		t.Fatalf("all 预检失败应零远端写入：%v %v", first.writes, second.writes)
	}
	if _, err := os.Stat(cm.connFile); !os.IsNotExist(err) {
		t.Fatalf("all 预检失败应零本地写入：%v", err)
	}
}

func TestChangeRecoveryPasswordRollsBackUploadsWhenLocalPersistFails(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.SetRecoveryPassword("旧密码"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(cm.quickCmdFile, 0700); err != nil {
		t.Fatal(err)
	}
	s := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "旧密码", "one")}}
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	if err := cm.ChangeRecoveryPassword("新密码"); err == nil {
		t.Fatal("本地持久化失败应返回错误")
	}
	if len(s.writes) != 1 || len(s.deletes) != 1 || s.writes[0] != s.deletes[0] {
		t.Fatalf("本地持久化失败应回滚本轮上传：writes=%v deletes=%v", s.writes, s.deletes)
	}
	if got := cm.GetRecoveryPassword(); got != "旧密码" {
		t.Fatalf("本地持久化失败不得保存新密码，得到：%q", got)
	}
}

func TestChangeRecoveryPasswordRollsBackUploadsWhenPasswordPersistFails(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.SetRecoveryPassword("旧密码"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(cm.recoveryPasswordFile); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(cm.recoveryPasswordFile, 0700); err != nil {
		t.Fatal(err)
	}
	s := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "旧密码", "one")}}
	// 本地密码文件被故意破坏后无法读取旧密码，因此让远端同时接受候选新密码完成纯读取预检。
	s.files["connections_backup_20260101_000000.000_+0000.lumin2"] = encryptedSnapshot(t, "新密码", "one")
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	if err := cm.ChangeRecoveryPassword("新密码"); err == nil {
		t.Fatal("密码持久化失败应返回错误")
	}
	if len(s.writes) != 1 || len(s.deletes) != 1 || s.writes[0] != s.deletes[0] {
		t.Fatalf("密码持久化失败应回滚本轮上传：writes=%v deletes=%v", s.writes, s.deletes)
	}
}

func TestPersistSyncSnapshotSavesAllMergedFields(t *testing.T) {
	cm := testSyncManager(t)
	settings := &ai.AIGlobalSettings{CurrentProviderID: "provider", UpdatedAt: 1}
	snap := &SyncSnapshot{
		Connections:      []Connection{{ID: "connection", Host: "host"}},
		Credentials:      []Credential{{ID: "credential", Name: "凭据"}},
		QuickCommands:    "[]",
		AIProviders:      []ai.AIProviderProfile{{ID: "provider", Name: "供应商", UpdatedAt: 1}},
		AIGlobalSettings: settings,
		ProxyNodes:       []ai.AIProxyNode{{ID: "proxy", Name: "代理", Host: "127.0.0.1", Port: 1080, UpdatedAt: 1}},
		SnapshotTime:     123,
	}
	if err := cm.persistSyncSnapshot(snap); err != nil {
		t.Fatal(err)
	}
	if got := cm.GetAIProviderRegistry().Providers; len(got) != 1 || got[0].ID != "provider" {
		t.Fatalf("AI 供应商未完整持久化：%+v", got)
	}
	if got := cm.GetAIGlobalSettings(); got.CurrentProviderID != "provider" {
		t.Fatalf("AI 全局设置未完整持久化：%+v", got)
	}
	if got := cm.GetAIProxyNodes(); len(got) != 1 || got[0].ID != "proxy" {
		t.Fatalf("AI 代理节点未完整持久化：%+v", got)
	}
}

func TestSnapshotUploadPathHandlesNilResult(t *testing.T) {
	if got := snapshotUploadPath(nil); got != "" {
		t.Fatalf("nil 上传结果应安全返回空路径，得到：%q", got)
	}
}

func TestSyncWithRecoveryPasswordWrongCandidateIsNotSaved(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.SetRecoveryPassword("旧密码"); err != nil {
		t.Fatal(err)
	}
	s := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "正确候选", "one")}}
	cm.syncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	if _, err := cm.SyncWithRecoveryPassword("错误候选"); !errors.Is(err, errRecoveryPassword) {
		t.Fatalf("错误候选应返回密码错误，得到：%v", err)
	}
	if got := cm.GetRecoveryPassword(); got != "旧密码" {
		t.Fatalf("错误候选不得持久化，得到：%q", got)
	}
	if len(s.writes) != 0 {
		t.Fatalf("错误候选纯读取预检不得写远端：%v", s.writes)
	}
}

func TestSyncWithRecoveryPasswordSavesConfirmedCandidate(t *testing.T) {
	cm := testSyncManager(t)
	s := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "正确候选", "one")}}
	cm.syncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	if _, err := cm.SyncWithRecoveryPassword("正确候选"); err != nil {
		t.Fatal(err)
	}
	if got := cm.GetRecoveryPassword(); got != "正确候选" {
		t.Fatalf("预检成功后应持久化候选密码，得到：%q", got)
	}
}

func TestSyncAllProvidersStrictPreservesPasswordError(t *testing.T) {
	cm := testSyncManager(t)
	s := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "正确", "one")}}
	_, err := cm.syncAllProviders([]providerEntry{{provider: "webdav", storage: s}}, "错误", true)
	if !errors.Is(err, errRecoveryPassword) {
		t.Fatalf("all 严格同步应保留密码错误链，得到：%v", err)
	}
}

func TestSnapshotEqualIgnoresTimeListOrderAndQuickJSONFormatting(t *testing.T) {
	first := &SyncSnapshot{
		Connections:   []Connection{{ID: "a", Host: "一"}, {ID: "b", Host: "二"}},
		Credentials:   []Credential{{ID: "x", Name: "甲"}, {ID: "y", Name: "乙"}},
		QuickCommands: `[{"name":"先","command":"one"},{"name":"后","command":"two"}]`,
		SnapshotTime:  1,
	}
	second := &SyncSnapshot{
		Connections:   []Connection{{ID: "b", Host: "二"}, {ID: "a", Host: "一"}},
		Credentials:   []Credential{{ID: "y", Name: "乙"}, {ID: "x", Name: "甲"}},
		QuickCommands: "[ { \"command\": \"one\", \"name\": \"先\" }, { \"command\": \"two\", \"name\": \"后\" } ]",
		SnapshotTime:  999,
	}
	if !snapshotEqual(first, second) {
		t.Fatal("业务比较应忽略快照时间、按 ID 比较列表，并按 JSON 语义比较快捷命令")
	}
	second.QuickCommands = `[{"name":"后","command":"two"},{"name":"先","command":"one"}]`
	if snapshotEqual(first, second) {
		t.Fatal("快捷命令业务顺序变化必须视为不同")
	}
}

func TestSyncAllProvidersUploadsOnlyDifferentAndNoBackup(t *testing.T) {
	cm := testSyncManager(t)
	local := &SyncSnapshot{
		Connections:         []Connection{{ID: "same", Host: "same", LastModified: 10}},
		Credentials:         []Credential{},
		QuickCommands:       "[]",
		AIProviders:         []ai.AIProviderProfile{},
		ProxyNodes:          []ai.AIProxyNode{},
		SnapshotTime:        10,
		HasCredentials:      true,
		HasQuickCommands:    true,
		HasAIProviders:      true,
		HasAIGlobalSettings: true,
		HasProxyNodes:       true,
	}
	if err := cm.persistSyncSnapshot(local); err != nil {
		t.Fatal(err)
	}
	same := *cm.localSyncSnapshot()
	same.SnapshotTime = 999
	different := same
	different.Connections = []Connection{{ID: "same", Host: "old", ProxyMode: "direct", LastModified: 1}}
	matching := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSyncSnapshot(t, "密码", &same)}}
	stale := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSyncSnapshot(t, "密码", &different)}}
	empty := &memoryStorage{files: map[string][]byte{}}
	result, err := cm.syncAllProviders([]providerEntry{{provider: "webdav", storage: matching}, {provider: "r2", storage: stale}, {provider: "ftp", storage: empty}}, "密码")
	if err != nil {
		t.Fatal(err)
	}
	if len(matching.writes) != 0 || len(stale.writes) != 1 || len(empty.writes) != 1 {
		t.Fatalf("应仅上传不同或无备份目标：matching=%v stale=%v empty=%v", matching.writes, stale.writes, empty.writes)
	}
	if result["action"] != "upload" || result["uploaded"] != 2 {
		t.Fatalf("动作和上传数错误：%v", result)
	}
}

func TestSyncAllProvidersRealDownloadFailureFailsClosed(t *testing.T) {
	cm := testSyncManager(t)
	good := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "密码", "remote")}}
	bad := &memoryStorage{listErr: errors.New("网络中断")}
	if _, err := cm.syncAllProviders([]providerEntry{{provider: "webdav", storage: good}, {provider: "r2", storage: bad}}, "密码"); err == nil {
		t.Fatal("任一真实下载失败应 fail closed")
	}
	if len(good.writes) != 0 || len(bad.writes) != 0 {
		t.Fatalf("下载失败不得上传：good=%v bad=%v", good.writes, bad.writes)
	}
	if _, err := os.Stat(cm.connFile); !os.IsNotExist(err) {
		t.Fatalf("下载失败不得持久化本地：%v", err)
	}
}

func TestSyncAllProvidersRollsBackUploadsOnFailure(t *testing.T) {
	cm := testSyncManager(t)
	first := &memoryStorage{files: map[string][]byte{}}
	second := &memoryStorage{files: map[string][]byte{}, writeErr: errors.New("上传失败")}
	if _, err := cm.syncAllProviders([]providerEntry{{provider: "webdav", storage: first}, {provider: "r2", storage: second}}, "密码"); err == nil {
		t.Fatal("后续上传失败应整体失败")
	}
	if len(first.writes) != 1 || len(first.deletes) != 1 || first.writes[0] != first.deletes[0] {
		t.Fatalf("后续上传失败应回滚本轮文件：writes=%v deletes=%v", first.writes, first.deletes)
	}
	if _, err := os.Stat(cm.connFile); !os.IsNotExist(err) {
		t.Fatalf("上传失败不得持久化本地：%v", err)
	}
}

func TestSyncAllProvidersRollsBackWhenLocalPersistFails(t *testing.T) {
	cm := testSyncManager(t)
	if err := os.Mkdir(cm.quickCmdFile, 0700); err != nil {
		t.Fatal(err)
	}
	storage := &memoryStorage{files: map[string][]byte{}}
	if _, err := cm.syncAllProviders([]providerEntry{{provider: "webdav", storage: storage}}, "密码"); err == nil {
		t.Fatal("本地持久化失败应整体失败")
	}
	if len(storage.writes) != 1 || len(storage.deletes) != 1 || storage.writes[0] != storage.deletes[0] {
		t.Fatalf("本地持久化失败应回滚本轮文件：writes=%v deletes=%v", storage.writes, storage.deletes)
	}
}

func TestSyncAllProvidersPropagatesDeletionIntoFinal(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.persistSyncSnapshot(&SyncSnapshot{
		Connections:   []Connection{{ID: "deleted", Host: "deleted", LastModified: 100}},
		QuickCommands: "[]",
		SnapshotTime:  100,
	}); err != nil {
		t.Fatal(err)
	}
	cm.saveLastSyncTime(200)
	remote := &SyncSnapshot{Connections: []Connection{}, SnapshotTime: 300}
	storage := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSyncSnapshot(t, "密码", remote)}}
	result, err := cm.syncAllProviders([]providerEntry{{provider: "webdav", storage: storage}}, "密码")
	if err != nil {
		t.Fatal(err)
	}
	if got := cm.GetConnections(); len(got) != 0 {
		t.Fatalf("远端删除应传播到 FINAL 和本地：%+v", got)
	}
	if len(storage.writes) != 1 || result["action"] != "merge" {
		t.Fatalf("删除传播后的完整 FINAL 应回写旧格式远端：writes=%v result=%v", storage.writes, result)
	}
	decrypted, err := decryptLUMIN2(string(storage.files[storage.writes[0]]), "密码")
	if err != nil {
		t.Fatal(err)
	}
	var uploaded SyncSnapshot
	if err := json.Unmarshal([]byte(decrypted), &uploaded); err != nil {
		t.Fatal(err)
	}
	if len(uploaded.Connections) != 0 {
		t.Fatalf("上传 FINAL 不得复活已删除连接：%+v", uploaded.Connections)
	}
}

func TestSyncAllProvidersInitializationFailureStopsBeforeSync(t *testing.T) {
	cm := testSyncManager(t)
	storage := &memoryStorage{files: map[string][]byte{}}
	cm.syncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: storage}}, []providerFailure{{provider: "r2", err: errors.New("初始化失败")}}
	}
	if _, err := cm.SyncAllProviders(); err == nil {
		t.Fatal("all 入口初始化失败应立即停止")
	}
	if len(storage.writes) != 0 {
		t.Fatalf("初始化失败不得继续同步：%v", storage.writes)
	}
}

func TestResetRecoveryPasswordUsesLocalSnapshotAndPreservesOldBackups(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.persistSyncSnapshot(&SyncSnapshot{
		Connections:   []Connection{{ID: "local", Host: "local", LastModified: 2}},
		QuickCommands: "[]",
		SnapshotTime:  2,
	}); err != nil {
		t.Fatal(err)
	}
	oldName := "connections_backup_20260101_000000.000_+0000.lumin2"
	s := &memoryStorage{files: map[string][]byte{oldName: encryptedSnapshot(t, "未知密码", "remote")}}
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	if err := cm.ResetRecoveryPassword("新密码"); err != nil {
		t.Fatal(err)
	}
	if len(s.writes) != 1 {
		t.Fatalf("每个后端应只上传一次：%v", s.writes)
	}
	if _, ok := s.files[oldName]; !ok {
		t.Fatal("强制重置必须保留旧备份")
	}
	snap, err := cm.decryptAndParseSnapshot(string(s.files[s.writes[0]]), nil, "新密码")
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Connections) != 1 || snap.Connections[0].ID != "local" {
		t.Fatalf("强制重置必须以本机快照为准，得到：%+v", snap.Connections)
	}
}

func TestResetRecoveryPasswordRollsBackAllUploadsOnLaterFailure(t *testing.T) {
	cm := testSyncManager(t)
	first := &memoryStorage{files: map[string][]byte{}}
	second := &memoryStorage{files: map[string][]byte{}, writeErr: errors.New("上传失败")}
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: first}, {provider: "r2", storage: second}}, nil
	}
	if err := cm.ResetRecoveryPassword("新密码"); err == nil {
		t.Fatal("后端上传失败应返回错误")
	}
	if len(first.writes) != 1 || len(first.deletes) != 1 || first.writes[0] != first.deletes[0] {
		t.Fatalf("后续上传失败应回滚已上传文件：writes=%v deletes=%v", first.writes, first.deletes)
	}
	if got := cm.GetRecoveryPassword(); got != "" {
		t.Fatalf("上传失败不得保存本地密码，得到：%q", got)
	}
}

func TestResetRecoveryPasswordRollsBackWhenPasswordPersistFails(t *testing.T) {
	cm := testSyncManager(t)
	if err := os.Mkdir(cm.recoveryPasswordFile, 0700); err != nil {
		t.Fatal(err)
	}
	s := &memoryStorage{files: map[string][]byte{}}
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: s}}, nil
	}
	if err := cm.ResetRecoveryPassword("新密码"); err == nil {
		t.Fatal("本地密码保存失败应返回错误")
	}
	if len(s.writes) != 1 || len(s.deletes) != 1 || s.writes[0] != s.deletes[0] {
		t.Fatalf("密码保存失败应回滚上传：writes=%v deletes=%v", s.writes, s.deletes)
	}
}

func TestResetRecoveryPasswordWithoutProvidersAndWhitespace(t *testing.T) {
	cm := testSyncManager(t)
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) { return nil, nil }
	if err := cm.ResetRecoveryPassword("仅本地密码"); err != nil {
		t.Fatal(err)
	}
	if got := cm.GetRecoveryPassword(); got != "仅本地密码" {
		t.Fatalf("无后端时应仅保存本地密码，得到：%q", got)
	}
	if err := cm.ResetRecoveryPassword(" \t\r\n "); err != nil {
		t.Fatal(err)
	}
	if got := cm.GetRecoveryPassword(); got != "" {
		t.Fatalf("纯空白应规范为空密码，得到：%q", got)
	}
}

func TestSetRecoveryPasswordReturnsRemoveError(t *testing.T) {
	cm := testSyncManager(t)
	if err := os.Mkdir(cm.recoveryPasswordFile, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cm.recoveryPasswordFile, "占位"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := cm.SetRecoveryPassword(""); err == nil {
		t.Fatal("清除不可删除的密码路径必须返回删除错误")
	}
}

func TestChangeRecoveryPasswordPersistsAfterSuccessfulUploads(t *testing.T) {
	cm := testSyncManager(t)
	if err := cm.SetRecoveryPassword("旧密码"); err != nil {
		t.Fatal(err)
	}
	first := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "旧密码", "one")}}
	second := &memoryStorage{files: map[string][]byte{"connections_backup_20260101_000000.000_+0000.lumin2": encryptedSnapshot(t, "旧密码", "two")}}
	cm.allSyncProvidersForTest = func() ([]providerEntry, []providerFailure) {
		return []providerEntry{{provider: "webdav", storage: first}, {provider: "r2", storage: second}}, nil
	}
	if err := cm.ChangeRecoveryPassword("新密码"); err != nil {
		t.Fatal(err)
	}
	if len(first.writes) != 1 || len(second.writes) != 1 {
		t.Fatalf("每个目标应只上传一次：%v %v", first.writes, second.writes)
	}
	if got := cm.GetRecoveryPassword(); got != "新密码" {
		t.Fatalf("全部成功后应持久化新密码，得到：%q", got)
	}
	for _, s := range []*memoryStorage{first, second} {
		if _, err := cm.decryptAndParseSnapshot(string(s.files[s.writes[0]]), nil, "新密码"); err != nil {
			t.Fatalf("新快照应使用新密码：%v", err)
		}
	}
}
