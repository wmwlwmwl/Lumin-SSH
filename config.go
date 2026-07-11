package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/studio-b12/gowebdav"

	ai "luminssh-go/internal/ai"
)

// parseIntOrDefault 解析字符串为整数，失败时返回默认值
func parseIntOrDefault(s string, def int) int {
	if s == "" {
		return def
	}
	v, _ := strconv.Atoi(s)
	return v
}

// Connection struct
type Connection struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Host                string `json:"host"`
	Port                int    `json:"port"`
	Username            string `json:"username"`
	Password            string `json:"password,omitempty"`
	AuthMethod          string `json:"authMethod"`
	PrivateKey          string `json:"privateKey,omitempty"`
	Passphrase          string `json:"passphrase,omitempty"`
	Group               string `json:"group,omitempty"` // 服务器分组，空=未分组
	Os                  string `json:"os,omitempty"`
	CredentialID        string `json:"credentialId,omitempty"` // ponytail: 非空时用 Credential 认证，忽略内联字段
	TerminalInitPath    string `json:"terminalInitPath,omitempty"`
	FileManagerInitPath string `json:"fileManagerInitPath,omitempty"`
	ProxyMode           string `json:"proxyMode,omitempty"`
	ProxyNodeID         string `json:"proxyNodeId,omitempty"`
	ProxyType           string `json:"proxyType,omitempty"`
	ProxyHost           string `json:"proxyHost,omitempty"`
	ProxyPort           int    `json:"proxyPort,omitempty"`
	ProxyUsername       string `json:"proxyUsername,omitempty"`
	ProxyPassword       string `json:"proxyPassword,omitempty"`
	LastModified        int64  `json:"last_modified,omitempty"` // Unix 毫秒时间戳，合并时判断新旧
}

// Credential 可复用的认证凭据，多个 Connection 可引用同一 Credential
type Credential struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	AuthMethod   string `json:"authMethod"` // "password" | "privateKey"
	Username     string `json:"username"`
	Password     string `json:"password,omitempty"`      // 加密存储
	PrivateKey   string `json:"privateKey,omitempty"`    // 加密存储
	Passphrase   string `json:"passphrase,omitempty"`    // 加密存储
	LastModified int64  `json:"last_modified,omitempty"` // Unix 毫秒时间戳
}

type ChmodDialogSettings struct {
	Mode                  string `json:"mode,omitempty"`
	IncludeSubdirectories bool   `json:"includeSubdirectories,omitempty"`
	LastModified          int64  `json:"last_modified,omitempty"`
}

type FileManagerSettings struct {
	ChmodDialog ChmodDialogSettings `json:"chmodDialog,omitempty"`
}

type AppSettings struct {
	WebviewGpuDisabled bool `json:"webviewGpuDisabled,omitempty"`
}

type ConfigManager struct {
	configDir               string
	connFile                string
	credFile                string
	davFile                 string
	key                     []byte
	gcm                     cipher.AEAD // ponytail: 缓存 GCM cipher，避免每次 encrypt/decrypt 重建
	syncModeFile            string
	autoSyncEnabledFile     string
	syncTimeFile            string // 本地快照时间戳文件
	lastSyncFile            string // 上次同步时间戳文件（仅在同步完成时更新）
	recoveryPasswordFile    string // 恢复密码（加密存储）
	quickCmdFile            string
	paramHistFile           string
	fileManagerSettingsFile string
	workspaceStateFile      string
	workspacePrefsFile      string
	appSettingsFile         string
	historyDir              string
	globalHistFile          string
	mu                      sync.RWMutex
	connCache               []Connection // 缓存连接列表
	connCacheDirty          bool         // 缓存是否需要刷新
	credCache               []Credential // 缓存凭据列表
	credCacheDirty          bool         // 凭据缓存是否需要刷新
	syncRunning             atomic.Bool  // AutoSync 并发去重
	wailsCtx                context.Context
}

func NewConfigManager() *ConfigManager {
	appData, err := os.UserConfigDir()
	if err != nil {
		home, herr := os.UserHomeDir()
		if herr != nil {
			log.Fatalf("无法确定配置目录: %v / %v", err, herr)
		}
		appData = home
	}
	dir := filepath.Join(appData, "Lumin", "config")

	if err := os.MkdirAll(dir, 0700); err != nil {
		log.Fatalf("无法创建配置目录 %s: %v", dir, err)
	}

	keyFile := filepath.Join(dir, "lumin.key")
	var key []byte

	connFile := filepath.Join(dir, "connections.json")
	credFile := filepath.Join(dir, "credentials.json")
	davFile := filepath.Join(dir, "webdav.json")
	quickCmdFile := filepath.Join(dir, "quick_commands.json")
	paramHistFile := filepath.Join(dir, "param_history.json")
	fileManagerSettingsFile := filepath.Join(dir, "file_manager_settings.json")
	workspaceStateFile := filepath.Join(dir, "workspace_state.json")
	workspacePrefsFile := filepath.Join(dir, "workspace_prefs.json")
	appSettingsFile := filepath.Join(dir, "app_settings.json")
	historyDir := filepath.Join(dir, "history")
	if err := os.MkdirAll(historyDir, 0755); err != nil {
		log.Printf("[NewConfigManager] 无法创建历史目录 %s: %v", historyDir, err)
	}

	// ponytail: os.ReadFile 不存在时自动返回 err，无需 os.Stat 前置检查
	data, err := os.ReadFile(keyFile)
	if err == nil && len(data) == 32 {
		key = data
	} else {
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			log.Fatalf("无法生成加密密钥: %v", err)
		}
		if err := os.WriteFile(keyFile, key, 0600); err != nil {
			log.Fatalf("无法写入密钥文件: %v", err)
		}
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		log.Fatalf("无法创建 AES cipher: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		log.Fatalf("无法创建 GCM: %v", err)
	}

	return &ConfigManager{
		configDir:               dir,
		connFile:                connFile,
		credFile:                credFile,
		davFile:                 davFile,
		key:                     key,
		gcm:                     gcm,
		syncModeFile:            filepath.Join(dir, "sync_mode.json"),
		autoSyncEnabledFile:     filepath.Join(dir, "auto_sync_enabled.json"),
		syncTimeFile:            filepath.Join(dir, "snapshot_time"),
		lastSyncFile:            filepath.Join(dir, "last_sync_time"),
		recoveryPasswordFile:    filepath.Join(dir, "recovery_password"),
		quickCmdFile:            quickCmdFile,
		paramHistFile:           paramHistFile,
		fileManagerSettingsFile: fileManagerSettingsFile,
		workspaceStateFile:      workspaceStateFile,
		workspacePrefsFile:      workspacePrefsFile,
		appSettingsFile:         appSettingsFile,
		historyDir:              historyDir,
		globalHistFile:          filepath.Join(historyDir, "global.json"),
	}
}

func (c *ConfigManager) encrypt(text string) (string, error) {
	if text == "" {
		return "", nil
	}
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	ciphertext := c.gcm.Seal(nonce, nonce, []byte(text), nil)
	return hex.EncodeToString(ciphertext), nil
}

func (c *ConfigManager) decrypt(hexText string) string {
	if hexText == "" {
		return ""
	}
	ciphertext, err := hex.DecodeString(hexText)
	if err != nil {
		log.Printf("[decrypt] hex decode failed: %v", err)
		return ""
	}
	if len(ciphertext) < c.gcm.NonceSize() {
		return ""
	}
	nonce, ct := ciphertext[:c.gcm.NonceSize()], ciphertext[c.gcm.NonceSize():]
	plaintext, err := c.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return ""
	}
	return string(plaintext)
}

// encryptWithKey 使用指定密钥加密（用于云端备份等场景）
func (c *ConfigManager) encryptWithKey(text string, key []byte) (string, error) {
	if text == "" {
		return "", nil
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes.NewCipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("cipher.NewGCM: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(text), nil)
	return hex.EncodeToString(ciphertext), nil
}

// decryptWithKey 使用指定密钥解密
func (c *ConfigManager) decryptWithKey(hexText string, key []byte) string {
	if hexText == "" {
		return ""
	}
	ciphertext, err := hex.DecodeString(hexText)
	if err != nil {
		log.Printf("[decryptWithKey] hex decode failed: %v", err)
		return ""
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	if len(ciphertext) < gcm.NonceSize() {
		return ""
	}
	nonce, ct := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return ""
	}
	return string(plaintext)
}

func (c *ConfigManager) GetConnections() []Connection {
	c.mu.RLock()
	if !c.connCacheDirty && c.connCache != nil {
		result := make([]Connection, len(c.connCache))
		copy(result, c.connCache)
		c.mu.RUnlock()
		return result
	}
	c.mu.RUnlock()

	// 缓存未命中，升级为写锁刷新缓存
	c.mu.Lock()
	// double-check：另一个 goroutine 可能已经刷新了
	if !c.connCacheDirty && c.connCache != nil {
		result := make([]Connection, len(c.connCache))
		copy(result, c.connCache)
		c.mu.Unlock()
		return result
	}
	conns := c.getConnectionsLocked()
	c.connCache = conns
	c.connCacheDirty = false
	result := make([]Connection, len(conns))
	copy(result, conns)
	c.mu.Unlock()
	return result
}

// getConnectionsLocked 读取连接列表，调用方需持有 c.mu
func (c *ConfigManager) getConnectionsLocked() []Connection {
	data, err := os.ReadFile(c.connFile)
	if err != nil {
		return []Connection{}
	}
	var conns []Connection
	if err := json.Unmarshal(data, &conns); err != nil {
		log.Printf("[getConnectionsLocked] json.Unmarshal failed: %v", err)
		return []Connection{}
	}
	for i := range conns {
		conns[i].Password = c.decrypt(conns[i].Password)
		conns[i].Passphrase = c.decrypt(conns[i].Passphrase)
		conns[i].PrivateKey = c.decryptOrPassthrough(conns[i].PrivateKey)
		conns[i].ProxyPassword = c.decrypt(conns[i].ProxyPassword)
		sanitizeConnectionProxyConfig(&conns[i])
	}
	return conns
}

// decryptOrPassthrough 尝试解密 PrivateKey，失败则原样返回
// 用于明文私钥到加密私钥的平滑迁移：旧配置里 PrivateKey 是明文 PEM，加密后是 hex
// ponytail: 用 "-----BEGIN" 前缀区分明文与密文，PEM 头固定以此开头，hex 不含
func (c *ConfigManager) decryptOrPassthrough(text string) string {
	if text == "" {
		return ""
	}
	if strings.HasPrefix(text, "-----BEGIN") {
		return text
	}
	return c.decrypt(text)
}

// GetConnectionByID 按 ID 返回连接的深拷贝。
// 返回值语义避免返回指向内部临时切片的指针，防止调用方修改的是副本而非真实配置。
func (c *ConfigManager) GetConnectionByID(id string) (Connection, bool) {
	conns := c.GetConnections()
	for _, conn := range conns {
		if conn.ID == id {
			return conn, true
		}
	}
	return Connection{}, false
}

// GetConnectionsMasked 返回掩码后的连接列表，用于前端显示
func (c *ConfigManager) GetConnectionsMasked() []Connection {
	conns := c.GetConnections()
	for i := range conns {
		if conns[i].Password != "" {
			conns[i].Password = "****"
		}
		if conns[i].PrivateKey != "" {
			conns[i].PrivateKey = "[key configured]"
		}
		if conns[i].Passphrase != "" {
			conns[i].Passphrase = "****"
		}
		if conns[i].ProxyPassword != "" {
			conns[i].ProxyPassword = "****"
		}
	}
	return conns
}

func (c *ConfigManager) SaveConnection(conn Connection, noSync bool) Connection {
	sanitizeConnectionProxyConfig(&conn)
	c.mu.Lock()
	defer c.mu.Unlock()
	conns := c.getConnectionsLocked()
	if conn.ID == "" {
		// ponytail: 用 crypto/rand 替代 UnixNano，避免 Windows 精度不足导致 ID 冲突
		b := make([]byte, 8)
		if _, err := rand.Read(b); err != nil {
			conn.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
		} else {
			conn.ID = fmt.Sprintf("%x", b)
		}
		conns = append(conns, conn)
	} else {
		found := false
		for i, existing := range conns {
			if existing.ID == conn.ID {
				// If no new password provided, keep old
				if conn.Password == "" && existing.Password != "" {
					conn.Password = existing.Password
				}
				// If no new private key provided, keep old
				if conn.PrivateKey == "" && existing.PrivateKey != "" {
					conn.PrivateKey = existing.PrivateKey
				}
				// If no new passphrase provided, keep old
				if conn.Passphrase == "" && existing.Passphrase != "" {
					conn.Passphrase = existing.Passphrase
				}
				if conn.ProxyMode == "custom" && conn.ProxyPassword == "" && existing.ProxyPassword != "" {
					conn.ProxyPassword = existing.ProxyPassword
				}
				conns[i] = conn
				found = true
				break
			}
		}
		if !found {
			conns = append(conns, conn)
		}
	}

	conn.LastModified = time.Now().UnixMilli()
	// 更新 conns 中对应条目的时间戳
	for i, s := range conns {
		if s.ID == conn.ID {
			conns[i].LastModified = conn.LastModified
			break
		}
	}

	if err := c.saveConnectionsFile(conns); err != nil {
		log.Printf("[SaveConnection] failed to save connections: %v", err)
	}
	c.connCacheDirty = true // 标记缓存需要刷新
	if noSync {
		// ponytail: 连接前仅写盘不触发同步，等 OS 更新后一起同步，避免两次上传
	} else {
		c.bumpSnapshotTime()
		go c.AutoSync()
	}
	return conn
}

// saveConnectionsFile 加密并原子写入连接列表，调用方需持有 c.mu
func (c *ConfigManager) saveConnectionsFile(conns []Connection) error {
	toSave := make([]Connection, len(conns))
	copy(toSave, conns)
	for i := range toSave {
		encPass, err := c.encrypt(toSave[i].Password)
		if err != nil {
			return fmt.Errorf("encrypt password: %w", err)
		}
		encPhrase, err := c.encrypt(toSave[i].Passphrase)
		if err != nil {
			return fmt.Errorf("encrypt passphrase: %w", err)
		}
		encKey, err := c.encrypt(toSave[i].PrivateKey)
		if err != nil {
			return fmt.Errorf("encrypt privateKey: %w", err)
		}
		encProxyPass, err := c.encrypt(toSave[i].ProxyPassword)
		if err != nil {
			return fmt.Errorf("encrypt proxyPassword: %w", err)
		}
		toSave[i].Password = encPass
		toSave[i].Passphrase = encPhrase
		toSave[i].PrivateKey = encKey
		toSave[i].ProxyPassword = encProxyPass
	}
	data, err := json.MarshalIndent(toSave, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal connections: %w", err)
	}
	// 原子写入：先写临时文件，再 rename 覆盖，避免中断损坏原文件
	return atomicWriteFile(c.connFile, data, 0600)
}

// loadRawFile 读取配置文件的原始 JSON 字符串（用于同步快照）
func (c *ConfigManager) loadRawFile(path string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

// atomicWriteFile 原子写入文件：先写临时文件 + fsync，再 rename 覆盖。
// fsync 防止进程快速退出时 OS 缓存未刷盘导致数据丢失。
func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	tmpFile := path + ".tmp"
	f, err := os.OpenFile(tmpFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return fmt.Errorf("open temp file: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return fmt.Errorf("sync temp file: %w", err)
	}
	f.Close()
	if err := os.Rename(tmpFile, path); err != nil {
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
}

// loadSnapshotTime 读取本地快照时间戳
func (c *ConfigManager) loadSnapshotTime() int64 {
	data, err := os.ReadFile(c.syncTimeFile)
	if err != nil {
		return 0
	}
	var t int64
	fmt.Sscanf(string(data), "%d", &t)
	return t
}

// bumpSnapshotTime 更新本地快照时间戳为当前时间
func (c *ConfigManager) bumpSnapshotTime() int64 {
	now := time.Now().UnixMilli()
	atomicWriteFile(c.syncTimeFile, []byte(fmt.Sprintf("%d", now)), 0600)
	return now
}

// loadLastSyncTime 读取上次同步时间戳（仅在同步完成时更新，不受本地改动影响）
func (c *ConfigManager) loadLastSyncTime() int64 {
	data, err := os.ReadFile(c.lastSyncFile)
	if err != nil {
		return 0
	}
	var t int64
	fmt.Sscanf(string(data), "%d", &t)
	return t
}

// saveLastSyncTime 保存上次同步时间戳
func (c *ConfigManager) saveLastSyncTime(t int64) {
	atomicWriteFile(c.lastSyncFile, []byte(fmt.Sprintf("%d", t)), 0600)
}

// SetConnectionGroup 仅更新服务器的分组字段，不影响密码等敏感数据
func (c *ConfigManager) SetConnectionGroup(id string, group string) error {
	return c.updateConnectionField(id, func(conn *Connection) { conn.Group = group })
}

// SetConnectionOS 仅更新服务器的操作系统字段
func (c *ConfigManager) SetConnectionOS(id string, os string) error {
	return c.updateConnectionField(id, func(conn *Connection) { conn.Os = os })
}

// updateConnectionField 通用：按 ID 查找并更新单个字段
func (c *ConfigManager) updateConnectionField(id string, apply func(*Connection)) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	conns := c.getConnectionsLocked()
	for i, conn := range conns {
		if conn.ID == id {
			apply(&conns[i])
			conns[i].LastModified = time.Now().UnixMilli()
			if err := c.saveConnectionsFile(conns); err != nil {
				return err
			}
			c.bumpSnapshotTime()
			c.connCacheDirty = true
			go c.AutoSync()
			return nil
		}
	}
	return fmt.Errorf("connection not found: %s", id)
}

func (c *ConfigManager) DeleteConnection(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	conns := c.getConnectionsLocked()
	filtered := []Connection{}
	for _, conn := range conns {
		if conn.ID != id {
			filtered = append(filtered, conn)
		}
	}
	if err := c.saveConnectionsFile(filtered); err != nil {
		log.Printf("[DeleteConnection] failed to save connections: %v", err)
	}
	c.bumpSnapshotTime()
	c.connCacheDirty = true // 标记缓存需要刷新

	// 清理该服务器的历史文件
	histPath := filepath.Join(c.historyDir, id+".json")
	os.Remove(histPath)

	go c.AutoSync()
	return true
}

// ── Credential 凭据管理 ──────────────────────────────────────────

func (c *ConfigManager) GetCredentials() []Credential {
	c.mu.RLock()
	if !c.credCacheDirty && c.credCache != nil {
		result := make([]Credential, len(c.credCache))
		copy(result, c.credCache)
		c.mu.RUnlock()
		return result
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.credCacheDirty && c.credCache != nil {
		result := make([]Credential, len(c.credCache))
		copy(result, c.credCache)
		return result
	}
	creds := c.getCredentialsLocked()
	c.credCache = creds
	c.credCacheDirty = false
	result := make([]Credential, len(creds))
	copy(result, creds)
	return result
}

// getCredentialsLocked 读取凭据列表，调用方需持有 c.mu
func (c *ConfigManager) getCredentialsLocked() []Credential {
	data, err := os.ReadFile(c.credFile)
	if err != nil {
		return []Credential{}
	}
	var creds []Credential
	if err := json.Unmarshal(data, &creds); err != nil {
		log.Printf("[getCredentialsLocked] json.Unmarshal failed: %v", err)
		return []Credential{}
	}
	for i := range creds {
		creds[i].Password = c.decrypt(creds[i].Password)
		creds[i].Passphrase = c.decrypt(creds[i].Passphrase)
		creds[i].PrivateKey = c.decryptOrPassthrough(creds[i].PrivateKey)
	}
	return creds
}

func (c *ConfigManager) GetCredentialByID(id string) (Credential, bool) {
	creds := c.GetCredentials()
	for _, cr := range creds {
		if cr.ID == id {
			return cr, true
		}
	}
	return Credential{}, false
}

func (c *ConfigManager) GetCredentialsMasked() []Credential {
	creds := c.GetCredentials()
	for i := range creds {
		if creds[i].Password != "" {
			creds[i].Password = "****"
		}
		if creds[i].PrivateKey != "" {
			creds[i].PrivateKey = "[key configured]"
		}
		if creds[i].Passphrase != "" {
			creds[i].Passphrase = "****"
		}
	}
	return creds
}

func (c *ConfigManager) SaveCredential(cred Credential) Credential {
	c.mu.Lock()
	defer c.mu.Unlock()
	creds := c.getCredentialsLocked()

	if cred.ID == "" {
		b := make([]byte, 8)
		if _, err := rand.Read(b); err != nil {
			cred.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
		} else {
			cred.ID = fmt.Sprintf("%x", b)
		}
		creds = append(creds, cred)
	} else {
		found := false
		for i, existing := range creds {
			if existing.ID == cred.ID {
				if cred.Password == "" && existing.Password != "" {
					cred.Password = existing.Password
				}
				if cred.PrivateKey == "" && existing.PrivateKey != "" {
					cred.PrivateKey = existing.PrivateKey
				}
				if cred.Passphrase == "" && existing.Passphrase != "" {
					cred.Passphrase = existing.Passphrase
				}
				creds[i] = cred
				found = true
				break
			}
		}
		if !found {
			creds = append(creds, cred)
		}
	}

	cred.LastModified = time.Now().UnixMilli()
	for i, s := range creds {
		if s.ID == cred.ID {
			creds[i].LastModified = cred.LastModified
			break
		}
	}

	if err := c.saveCredentialsFile(creds); err != nil {
		log.Printf("[SaveCredential] failed to save credentials: %v", err)
	}
	c.credCacheDirty = true
	c.bumpSnapshotTime()
	go c.AutoSync()
	return cred
}

func (c *ConfigManager) DeleteCredential(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	conns := c.getConnectionsLocked()
	// 检查是否有连接引用此凭据
	for _, conn := range conns {
		if conn.CredentialID == id {
			refName := conn.Name
			if refName == "" {
				refName = conn.Host
			}
			return fmt.Errorf("该凭据仍被服务器「%s」引用，无法删除", refName)
		}
	}

	creds := c.getCredentialsLocked()
	filtered := make([]Credential, 0, len(creds))
	for _, cr := range creds {
		if cr.ID != id {
			filtered = append(filtered, cr)
		}
	}
	if err := c.saveCredentialsFile(filtered); err != nil {
		log.Printf("[DeleteCredential] failed to save credentials: %v", err)
	}
	c.credCacheDirty = true
	c.bumpSnapshotTime()
	go c.AutoSync()
	return nil
}

// saveCredentialsFile 加密并原子写入凭据列表，调用方需持有 c.mu
func (c *ConfigManager) saveCredentialsFile(creds []Credential) error {
	toSave := make([]Credential, len(creds))
	copy(toSave, creds)
	for i := range toSave {
		encPass, err := c.encrypt(toSave[i].Password)
		if err != nil {
			return fmt.Errorf("encrypt password: %w", err)
		}
		encPhrase, err := c.encrypt(toSave[i].Passphrase)
		if err != nil {
			return fmt.Errorf("encrypt passphrase: %w", err)
		}
		encKey, err := c.encrypt(toSave[i].PrivateKey)
		if err != nil {
			return fmt.Errorf("encrypt privateKey: %w", err)
		}
		toSave[i].Password = encPass
		toSave[i].Passphrase = encPhrase
		toSave[i].PrivateKey = encKey
	}
	data, err := json.MarshalIndent(toSave, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal credentials: %w", err)
	}
	return atomicWriteFile(c.credFile, data, 0600)
}

// ImportConnections 合并导入节点：按 host+port+username 判重，本地已存在则跳过，仅新增。
// incoming 为待导入的明文节点列表，incomingCreds 为待导入的明文凭据列表。
// 走 saveConnectionsFile/saveCredentialsFile 自动加密 + 原子写，并触发云同步。
func (c *ConfigManager) ImportConnections(incoming []Connection, incomingCreds []Credential, incomingProxyNodes ...[]ai.AIProxyNode) (ImportResult, error) {
	c.mu.Lock()
	localConns := c.getConnectionsLocked()
	localCreds := c.getCredentialsLocked()
	localProxyNodes := c.GetAIProxyNodes()

	toAdd, result := mergeImport(localConns, incoming)
	incomingCreds = filterImportCredentialsForConnections(incomingCreds, toAdd)
	var importProxyNodes []ai.AIProxyNode
	if len(incomingProxyNodes) > 0 {
		importProxyNodes = filterImportProxyNodesForConnections(incomingProxyNodes[0], toAdd)
	}
	if len(toAdd) == 0 && len(incomingCreds) == 0 && len(importProxyNodes) == 0 {
		c.mu.Unlock()
		// 无需新增任何数据，直接返回统计（仍可能全是重复）
		return result, nil
	}

	toAddCreds, credIDMap := mergeImportCredentials(localCreds, incomingCreds)
	var proxyIDMap map[string]string
	var toAddProxyNodes []ai.AIProxyNode
	if len(importProxyNodes) > 0 {
		toAddProxyNodes, proxyIDMap = mergeImportProxyNodes(localProxyNodes, importProxyNodes)
	}
	applyImportReferenceMappings(toAdd, credIDMap, proxyIDMap)

	// 合并节点
	if len(toAdd) > 0 {
		mergedConns := make([]Connection, 0, len(localConns)+len(toAdd))
		mergedConns = append(mergedConns, localConns...)
		mergedConns = append(mergedConns, toAdd...)
		if err := c.saveConnectionsFile(mergedConns); err != nil {
			c.mu.Unlock()
			return result, fmt.Errorf("保存导入的节点失败: %w", err)
		}
		c.connCacheDirty = true
	}

	// 合并凭据（按 ID 去重）
	if len(toAddCreds) > 0 {
		mergedCreds := make([]Credential, 0, len(localCreds)+len(toAddCreds))
		mergedCreds = append(mergedCreds, localCreds...)
		mergedCreds = append(mergedCreds, toAddCreds...)
		if err := c.saveCredentialsFile(mergedCreds); err != nil {
			c.mu.Unlock()
			return result, fmt.Errorf("保存导入的凭据失败: %w", err)
		}
		c.credCacheDirty = true
	}
	c.mu.Unlock()

	if len(toAddProxyNodes) > 0 {
		mergedProxyNodes := make([]ai.AIProxyNode, 0, len(localProxyNodes)+len(toAddProxyNodes))
		mergedProxyNodes = append(mergedProxyNodes, localProxyNodes...)
		mergedProxyNodes = append(mergedProxyNodes, toAddProxyNodes...)
		if err := c.SaveAIProxyNodes(mergedProxyNodes); err != nil {
			return result, fmt.Errorf("保存导入的代理节点失败: %w", err)
		}
	}

	c.bumpSnapshotTime()
	go c.AutoSync()
	return result, nil
}

// ResolveConnectionAuth 如果 Connection 引用了 Credential，返回用凭据填充认证字段的副本
func (c *ConfigManager) ResolveConnectionAuth(conn Connection) Connection {
	if conn.CredentialID == "" {
		return conn
	}
	cred, ok := c.GetCredentialByID(conn.CredentialID)
	if !ok {
		log.Printf("[ResolveConnectionAuth] credential %s not found for connection %s, using inline fields", conn.CredentialID, conn.ID)
		return conn
	}
	conn.AuthMethod = cred.AuthMethod
	conn.Username = cred.Username
	conn.Password = cred.Password
	conn.PrivateKey = cred.PrivateKey
	conn.Passphrase = cred.Passphrase
	return conn
}

// WEBDAV
type WebdavConfig struct {
	Url        string `json:"url"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	RemotePath string `json:"remotePath"`
	MaxBackups int    `json:"maxBackups"`
}

func (c *ConfigManager) GetWebdavConfig() map[string]string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.getWebdavConfigLocked()
}

// getWebdavConfigLocked 读取 WebDAV 配置，调用方需持有 c.mu
func (c *ConfigManager) getWebdavConfigLocked() map[string]string {
	data, err := os.ReadFile(c.davFile)
	if err != nil {
		return nil
	}
	var conf WebdavConfig
	if err := json.Unmarshal(data, &conf); err != nil {
		log.Printf("[getWebdavConfigLocked] json.Unmarshal failed: %v", err)
		return nil
	}
	return map[string]string{
		"url":        conf.Url,
		"username":   c.decrypt(conf.Username),
		"password":   c.decrypt(conf.Password),
		"remotePath": conf.RemotePath,
		"maxBackups": fmt.Sprintf("%d", conf.MaxBackups),
	}
}

func (c *ConfigManager) getWebdavKey() []byte {
	confMap := c.getWebdavConfigLocked()
	if confMap == nil || confMap["url"] == "" {
		return c.key
	}
	hash := sha256.Sum256([]byte(confMap["url"] + confMap["username"] + confMap["password"]))
	return hash[:]
}

func (c *ConfigManager) SaveWebdavConfig(config map[string]string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	pass := config["password"]
	if pass == "" {
		existing := c.getWebdavConfigLocked()
		if existing != nil && existing["password"] != "" {
			pass = existing["password"]
		}
	}

	maxBackups := parseIntOrDefault(config["maxBackups"], 0)

	encUser, err := c.encrypt(config["username"])
	if err != nil {
		return fmt.Errorf("encrypt username: %w", err)
	}
	encPass, err := c.encrypt(pass)
	if err != nil {
		return fmt.Errorf("encrypt password: %w", err)
	}

	conf := WebdavConfig{
		Url:        config["url"],
		Username:   encUser,
		Password:   encPass,
		RemotePath: config["remotePath"],
		MaxBackups: maxBackups,
	}
	if conf.RemotePath == "" {
		conf.RemotePath = "/Lumin/"
	}
	data, err := json.MarshalIndent(conf, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal webdav config: %w", err)
	}
	return atomicWriteFile(c.davFile, data, 0600)
}

func (c *ConfigManager) TestWebdavConnection(url, username, password string) error {
	client := gowebdav.NewClient(url, username, password)
	_, err := client.ReadDir("/")
	return err
}

// ─── WebDAV RemoteStorage 实现 ─────────────────────────────

type webdavStorage struct {
	client     *gowebdav.Client
	remotePath string
	key        []byte
}

func (s *webdavStorage) ListFiles() ([]RemoteFile, error) {
	files, err := s.client.ReadDir(s.remotePath)
	if err != nil {
		return nil, err
	}
	result := make([]RemoteFile, 0, len(files))
	for _, f := range files {
		result = append(result, RemoteFile{
			Name:    f.Name(),
			ModTime: f.ModTime(),
			IsDir:   f.IsDir(),
			Size:    f.Size(),
		})
	}
	return result, nil
}

func (s *webdavStorage) ReadFile(name string) ([]byte, error) {
	path := filepath.ToSlash(filepath.Join(s.remotePath, name))
	return s.client.Read(path)
}

func (s *webdavStorage) WriteFile(name string, data []byte) error {
	path := filepath.ToSlash(filepath.Join(s.remotePath, name))
	// ensure dir exists
	if _, err := s.client.ReadDir(s.remotePath); err != nil {
		s.client.MkdirAll(s.remotePath, 0755)
	}
	return s.client.Write(path, data, 0644)
}

func (s *webdavStorage) DeleteFile(name string) error {
	path := filepath.ToSlash(filepath.Join(s.remotePath, name))
	return s.client.Remove(path)
}

func (s *webdavStorage) EncryptKey() []byte { return s.key }

func (c *ConfigManager) newWebdavStorage() (RemoteStorage, int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	conf := c.getWebdavConfigLocked()
	if conf == nil {
		return nil, 0, fmt.Errorf("WebDAV not configured")
	}
	client := gowebdav.NewClient(conf["url"], conf["username"], conf["password"])
	maxBackups := parseIntOrDefault(conf["maxBackups"], 0)
	return &webdavStorage{
		client:     client,
		remotePath: conf["remotePath"],
		key:        c.getWebdavKey(),
	}, maxBackups, nil
}

// BackupToWebdav 备份到 WebDAV
func (c *ConfigManager) BackupToWebdav() (map[string]interface{}, error) {
	return c.backupTo(c.newWebdavStorage)
}

// ListWebdavBackups 列出 WebDAV 备份
func (c *ConfigManager) ListWebdavBackups() ([]map[string]interface{}, error) {
	return c.listBackupsFrom(c.newWebdavStorage)
}

// SyncFromWebdav 手动合并同步
func (c *ConfigManager) SyncFromWebdav() (map[string]interface{}, error) {
	return c.syncFrom(c.newWebdavStorage)
}

func (c *ConfigManager) RestoreFromWebdavFile(filename string) (map[string]interface{}, error) {
	return c.restoreFrom(c.newWebdavStorage, filename, c.getRecoveryPasswordKey())
}

// RestoreFromWebdavFileWithPassword 用用户输入的密码恢复（恢复失败时的兜底入口）。
func (c *ConfigManager) RestoreFromWebdavFileWithPassword(filename string, password string) (map[string]interface{}, error) {
	key := sha256Key(password)
	return c.restoreFrom(c.newWebdavStorage, filename, key)
}

// ─── 同步模式配置 ─────────────────────────────────────────

// GetSyncMode 获取自动同步模式：webdav / r2 / ftp / sftp / all
func (c *ConfigManager) GetSyncMode() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.syncModeFile)
	if err != nil {
		return "webdav"
	}
	var mode string
	if json.Unmarshal(data, &mode) != nil || mode == "" {
		return "webdav"
	}
	return mode
}

// SetSyncMode 设置自动同步模式
func (c *ConfigManager) SetSyncMode(mode string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, _ := json.Marshal(mode)
	return atomicWriteFile(c.syncModeFile, data, 0600)
}

func (c *ConfigManager) GetAutoSyncEnabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.autoSyncEnabledFile)
	if err != nil {
		return false
	}
	var enabled bool
	if json.Unmarshal(data, &enabled) != nil {
		return false
	}
	return enabled
}

func (c *ConfigManager) SetAutoSyncEnabled(enabled bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, _ := json.Marshal(enabled)
	return atomicWriteFile(c.autoSyncEnabledFile, data, 0600)
}

// ─── 恢复密码 ─────────────────────────────────────────────

// GetRecoveryPassword 获取恢复密码（明文，供前端回显"已设置"状态）；未设置返回空串。
func (c *ConfigManager) GetRecoveryPassword() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.recoveryPasswordFile)
	if err != nil {
		return ""
	}
	return c.decrypt(string(data))
}

// SetRecoveryPassword 设置恢复密码；空串则清除。
// 密码用主密钥加密后原子写入。
func (c *ConfigManager) SetRecoveryPassword(password string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.TrimSpace(password) == "" {
		_ = os.Remove(c.recoveryPasswordFile)
		return nil
	}
	enc, err := c.encrypt(password)
	if err != nil {
		return fmt.Errorf("加密恢复密码失败: %w", err)
	}
	return atomicWriteFile(c.recoveryPasswordFile, []byte(enc), 0600)
}

// getRecoveryPasswordKey 返回恢复密码的 SHA-256 派生密钥；未设置返回 nil。
func (c *ConfigManager) getRecoveryPasswordKey() []byte {
	pw := c.GetRecoveryPassword()
	if pw == "" {
		return nil
	}
	h := sha256.Sum256([]byte(pw))
	return h[:]
}

func sanitizeChmodDialogMode(mode string) string {
	filtered := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '7' {
			return r
		}
		return -1
	}, strings.TrimSpace(mode))
	if len(filtered) == 4 && filtered[0] == '0' {
		filtered = filtered[1:]
	}
	if len(filtered) != 3 {
		return ""
	}
	return filtered
}

func (c *ConfigManager) getFileManagerSettingsLocked() FileManagerSettings {
	data, err := os.ReadFile(c.fileManagerSettingsFile)
	if err != nil {
		return FileManagerSettings{}
	}
	var settings FileManagerSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		log.Printf("[getFileManagerSettingsLocked] json.Unmarshal failed: %v", err)
		return FileManagerSettings{}
	}
	settings.ChmodDialog.Mode = sanitizeChmodDialogMode(settings.ChmodDialog.Mode)
	return settings
}

func (c *ConfigManager) saveFileManagerSettingsLocked(settings FileManagerSettings) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal file manager settings: %w", err)
	}
	return atomicWriteFile(c.fileManagerSettingsFile, data, 0600)
}

func (c *ConfigManager) getAppSettingsLocked() AppSettings {
	data, err := os.ReadFile(c.appSettingsFile)
	if err != nil {
		return AppSettings{}
	}
	var settings AppSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		log.Printf("[getAppSettingsLocked] json.Unmarshal failed: %v", err)
		return AppSettings{}
	}
	return settings
}

func (c *ConfigManager) saveAppSettingsLocked(settings AppSettings) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal app settings: %w", err)
	}
	return atomicWriteFile(c.appSettingsFile, data, 0600)
}

func (c *ConfigManager) GetWebviewGpuDisabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.getAppSettingsLocked().WebviewGpuDisabled
}

func (c *ConfigManager) SetWebviewGpuDisabled(enabled bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	settings := c.getAppSettingsLocked()
	settings.WebviewGpuDisabled = enabled
	return c.saveAppSettingsLocked(settings)
}

func (c *ConfigManager) GetChmodDialogSettings() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()
	settings := c.getFileManagerSettingsLocked()
	return map[string]interface{}{
		"mode":                  settings.ChmodDialog.Mode,
		"includeSubdirectories": settings.ChmodDialog.IncludeSubdirectories,
	}
}

func (c *ConfigManager) SaveChmodDialogSettings(mode string, includeSubdirectories bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	sanitizedMode := sanitizeChmodDialogMode(mode)
	if sanitizedMode == "" {
		sanitizedMode = "644"
	}
	settings := c.getFileManagerSettingsLocked()
	settings.ChmodDialog.Mode = sanitizedMode
	settings.ChmodDialog.IncludeSubdirectories = includeSubdirectories
	settings.ChmodDialog.LastModified = time.Now().UnixMilli()
	err := c.saveFileManagerSettingsLocked(settings)
	if err == nil {
		c.bumpSnapshotTime()
		go c.AutoSync()
	}
	return err
}

// ─── 快捷命令 ──────────────────────────────────────

// GetQuickCommands 读取快捷命令列表
func (c *ConfigManager) GetQuickCommands() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.quickCmdFile)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// SaveQuickCommands 保存快捷命令列表（JSON 字符串），触发云端同步
func (c *ConfigManager) SaveQuickCommands(jsonStr string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	err := atomicWriteFile(c.quickCmdFile, []byte(jsonStr), 0600)
	if err == nil {
		c.bumpSnapshotTime()
		go c.AutoSync()
	}
	return err
}

// SaveQuickCommandsLocal 保存快捷命令列表到本地，不触发云端同步
func (c *ConfigManager) SaveQuickCommandsLocal(jsonStr string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.quickCmdFile, []byte(jsonStr), 0600)
}

// GetParamHistory 读取参数历史
func (c *ConfigManager) GetParamHistory() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.paramHistFile)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// SaveParamHistory 保存参数历史
func (c *ConfigManager) SaveParamHistory(jsonStr string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.paramHistFile, []byte(jsonStr), 0600)
}

func (c *ConfigManager) GetRememberWorkspace() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.workspacePrefsFile)
	if err != nil {
		return false
	}
	var enabled bool
	if err := json.Unmarshal(data, &enabled); err == nil {
		return enabled
	}
	var payload map[string]bool
	if err := json.Unmarshal(data, &payload); err == nil {
		return payload["rememberWorkspace"]
	}
	return false
}

func (c *ConfigManager) SetRememberWorkspace(enabled bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := json.Marshal(enabled)
	if err != nil {
		return err
	}
	if err := atomicWriteFile(c.workspacePrefsFile, data, 0600); err != nil {
		return err
	}
	if !enabled {
		if err := os.Remove(c.workspaceStateFile); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (c *ConfigManager) GetWorkspaceState() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.workspaceStateFile)
	if err != nil {
		return ""
	}
	return string(data)
}

func (c *ConfigManager) SaveWorkspaceState(jsonStr string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	trimmed := strings.TrimSpace(jsonStr)
	if trimmed == "" {
		if err := os.Remove(c.workspaceStateFile); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if !json.Valid([]byte(trimmed)) {
		return fmt.Errorf("invalid workspace state")
	}
	return atomicWriteFile(c.workspaceStateFile, []byte(trimmed), 0600)
}

func (c *ConfigManager) ClearWorkspaceState() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := os.Remove(c.workspaceStateFile); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ─── 命令历史 ──────────────────────────────────────

// GetCommandHistory 读取指定会话的命令历史
func (c *ConfigManager) GetCommandHistory(sessionId string) string {
	// 防止路径穿越
	sessionId = filepath.Base(sessionId)
	path := filepath.Join(c.historyDir, sessionId+".json")
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(path)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// SaveCommandHistory 保存指定会话的命令历史
func (c *ConfigManager) SaveCommandHistory(sessionId, jsonStr string) error {
	// 防止路径穿越
	sessionId = filepath.Base(sessionId)
	path := filepath.Join(c.historyDir, sessionId+".json")
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(path, []byte(jsonStr), 0600)
}

// GetGlobalCommandHistory 读取全局命令历史
func (c *ConfigManager) GetGlobalCommandHistory() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.globalHistFile)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// SaveGlobalCommandHistory 保存全局命令历史
func (c *ConfigManager) SaveGlobalCommandHistory(jsonStr string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.globalHistFile, []byte(jsonStr), 0600)
}

// CleanupOrphanedHistory 清理已不存在的连接的历史文件
func (c *ConfigManager) CleanupOrphanedHistory() {
	conns := c.GetConnections()
	active := make(map[string]bool)
	for _, conn := range conns {
		active[conn.ID] = true
	}

	entries, err := os.ReadDir(c.historyDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		// 跳过 global.json
		if e.Name() == "global.json" {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".json")
		if !active[id] {
			path := filepath.Join(c.historyDir, e.Name())
			os.Remove(path)
		}
	}
}
