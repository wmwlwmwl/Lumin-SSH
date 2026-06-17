package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/studio-b12/gowebdav"
)

// Connection struct
type Connection struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password,omitempty"`
	AuthMethod string `json:"authMethod"`
	PrivateKey string `json:"privateKey,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
	Os         string `json:"os,omitempty"`
}

type ConfigManager struct {
	configDir      string
	connFile       string
	davFile        string
	key            []byte
	syncModeFile   string
	quickCmdFile   string
	paramHistFile  string
	historyDir     string
	globalHistFile string
	mu             sync.Mutex
}

func NewConfigManager() *ConfigManager {
	appData, _ := os.UserConfigDir()
	dir := filepath.Join(appData, "Lumin", "config")

	os.MkdirAll(dir, 0755)

	keyFile := filepath.Join(dir, "lumin.key")
	var key []byte
	var keyErr error

	connFile := filepath.Join(dir, "connections.json")
	davFile := filepath.Join(dir, "webdav.json")
	quickCmdFile := filepath.Join(dir, "quick_commands.json")
	paramHistFile := filepath.Join(dir, "param_history.json")
	historyDir := filepath.Join(dir, "history")
	os.MkdirAll(historyDir, 0755)

	// 检查是否存在本地独立密钥文件
	if _, err := os.Stat(keyFile); err == nil {
		// 密钥已存在，直接读取
		key, keyErr = os.ReadFile(keyFile)
		if keyErr != nil || len(key) != 32 {
			// 如果读取损坏或长度不符，重新生成
			key = make([]byte, 32)
			if _, err := rand.Read(key); err != nil {
				log.Fatalf("无法生成加密密钥: %v", err)
			}
			if err := os.WriteFile(keyFile, key, 0600); err != nil {
				log.Fatalf("无法写入密钥文件: %v", err)
			}
		}
	} else {
		// 密钥文件不存在，生成全新密钥
		newKey := make([]byte, 32)
		if _, err := rand.Read(newKey); err != nil {
			log.Fatalf("无法生成加密密钥: %v", err)
		}
		if err := os.WriteFile(keyFile, newKey, 0600); err != nil {
			log.Fatalf("无法写入密钥文件: %v", err)
		}
		key = newKey
	}

	return &ConfigManager{
		configDir:      dir,
		connFile:       connFile,
		davFile:        davFile,
		key:            key,
		syncModeFile:   filepath.Join(dir, "sync_mode.json"),
		quickCmdFile:   quickCmdFile,
		paramHistFile:  paramHistFile,
		historyDir:     historyDir,
		globalHistFile: filepath.Join(historyDir, "global.json"),
	}
}

func (c *ConfigManager) encrypt(text string) string {
	if text == "" {
		return ""
	}
	block, _ := aes.NewCipher(c.key)
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, gcm.NonceSize())
	io.ReadFull(rand.Reader, nonce)
	ciphertext := gcm.Seal(nonce, nonce, []byte(text), nil)
	return fmt.Sprintf("%x", ciphertext)
}

func (c *ConfigManager) encryptWithKey(text string, key []byte) string {
	if text == "" {
		return ""
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, gcm.NonceSize())
	io.ReadFull(rand.Reader, nonce)
	ciphertext := gcm.Seal(nonce, nonce, []byte(text), nil)
	return fmt.Sprintf("%x", ciphertext)
}

func (c *ConfigManager) decrypt(hexText string) string {
	return c.decryptWithKey(hexText, c.key)
}

func (c *ConfigManager) decryptWithKey(hexText string, key []byte) string {
	if hexText == "" {
		return ""
	}
	var ciphertext []byte
	fmt.Sscanf(hexText, "%x", &ciphertext)

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
	nonce, ciphertext := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return ""
	}
	return string(plaintext)
}

func (c *ConfigManager) GetConnections() []Connection {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.getConnectionsLocked()
}

// getConnectionsLocked 读取连接列表，调用方需持有 c.mu
func (c *ConfigManager) getConnectionsLocked() []Connection {
	data, err := os.ReadFile(c.connFile)
	if err != nil {
		return []Connection{}
	}
	var conns []Connection
	json.Unmarshal(data, &conns)
	for i := range conns {
		conns[i].Password = c.decrypt(conns[i].Password)
		conns[i].Passphrase = c.decrypt(conns[i].Passphrase)
	}
	return conns
}

func (c *ConfigManager) GetConnectionByID(id string) *Connection {
	conns := c.GetConnections()
	for _, conn := range conns {
		if conn.ID == id {
			return &conn
		}
	}
	return nil
}

func (c *ConfigManager) SaveConnection(conn Connection) Connection {
	c.mu.Lock()
	defer c.mu.Unlock()
	conns := c.getConnectionsLocked()
	if conn.ID == "" {
		conn.ID = fmt.Sprintf("%d", time.Now().UnixNano())
		conns = append(conns, conn)
	} else {
		found := false
		for i, existing := range conns {
			if existing.ID == conn.ID {
				// If no new password provided, keep old
				if conn.Password == "" && existing.Password != "" {
					conn.Password = existing.Password
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

	if err := c.saveConnectionsFile(conns); err != nil {
		log.Printf("[SaveConnection] failed to save connections: %v", err)
	}
	go c.AutoSyncToWebdav()
	return conn
}

// saveConnectionsFile 加密并原子写入连接列表，调用方需持有 c.mu
func (c *ConfigManager) saveConnectionsFile(conns []Connection) error {
	toSave := make([]Connection, len(conns))
	copy(toSave, conns)
	for i := range toSave {
		toSave[i].Password = c.encrypt(toSave[i].Password)
		toSave[i].Passphrase = c.encrypt(toSave[i].Passphrase)
	}
	data, err := json.MarshalIndent(toSave, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal connections: %w", err)
	}
	// 原子写入：先写临时文件，再 rename 覆盖，避免中断损坏原文件
	tmpFile := c.connFile + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0600); err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := os.Rename(tmpFile, c.connFile); err != nil {
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
}

// loadRawFile 读取配置文件的原始 JSON 字符串（用于同步快照）
func (c *ConfigManager) loadRawFile(path string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
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

	// 清理该服务器的历史文件
	histPath := filepath.Join(c.historyDir, id+".json")
	os.Remove(histPath)

	go c.AutoSyncToWebdav()
	return true
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
	data, err := os.ReadFile(c.davFile)
	if err != nil {
		return nil
	}
	var conf WebdavConfig
	json.Unmarshal(data, &conf)
	return map[string]string{
		"url":        conf.Url,
		"username":   c.decrypt(conf.Username),
		"password":   c.decrypt(conf.Password),
		"remotePath": conf.RemotePath,
		"maxBackups": fmt.Sprintf("%d", conf.MaxBackups),
	}
}

func (c *ConfigManager) getWebdavKey() []byte {
	confMap := c.GetWebdavConfig()
	if confMap == nil || confMap["url"] == "" {
		return c.key
	}
	hash := sha256.Sum256([]byte(confMap["url"] + confMap["username"] + confMap["password"]))
	return hash[:]
}

func (c *ConfigManager) SaveWebdavConfig(config map[string]string) error {
	pass := config["password"]
	if pass == "" {
		existing := c.GetWebdavConfig()
		if existing != nil && existing["password"] != "" {
			pass = existing["password"]
		}
	}

	maxBackups := 0
	if config["maxBackups"] != "" {
		fmt.Sscanf(config["maxBackups"], "%d", &maxBackups)
	}

	conf := WebdavConfig{
		Url:        config["url"],
		Username:   c.encrypt(config["username"]),
		Password:   c.encrypt(pass),
		RemotePath: config["remotePath"],
		MaxBackups: maxBackups,
	}
	if conf.RemotePath == "" {
		conf.RemotePath = "/Lumin/"
	}
	data, _ := json.MarshalIndent(conf, "", "  ")
	return os.WriteFile(c.davFile, data, 0600)
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
	conf := c.GetWebdavConfig()
	if conf == nil {
		return nil, 0, fmt.Errorf("WebDAV not configured")
	}
	client := gowebdav.NewClient(conf["url"], conf["username"], conf["password"])
	var maxBackups int
	fmt.Sscanf(conf["maxBackups"], "%d", &maxBackups)
	return &webdavStorage{
		client:     client,
		remotePath: conf["remotePath"],
		key:        c.getWebdavKey(),
	}, maxBackups, nil
}

// BackupToWebdav 备份到 WebDAV
func (c *ConfigManager) BackupToWebdav() (map[string]interface{}, error) {
	s, max, err := c.newWebdavStorage()
	if err != nil {
		return nil, err
	}
	return c.backupConnections(s, max)
}

// ListWebdavBackups 列出 WebDAV 备份
func (c *ConfigManager) ListWebdavBackups() ([]map[string]interface{}, error) {
	s, _, err := c.newWebdavStorage()
	if err != nil {
		return nil, err
	}
	return c.listBackupFiles(s)
}

// SyncFromWebdav 手动合并同步
func (c *ConfigManager) SyncFromWebdav() (map[string]interface{}, error) {
	s, _, err := c.newWebdavStorage()
	if err != nil {
		return nil, err
	}
	return c.syncFromProvider(s)
}

func (c *ConfigManager) RestoreFromWebdavFile(filename string) (map[string]interface{}, error) {
	confMap := c.GetWebdavConfig()
	if confMap == nil {
		return nil, fmt.Errorf("WebDAV not configured")
	}
	client := gowebdav.NewClient(confMap["url"], confMap["username"], confMap["password"])
	remoteFile := filepath.ToSlash(filepath.Join(confMap["remotePath"], filename))

	data, err := client.Read(remoteFile)
	if err != nil {
		return nil, err
	}

	key := c.getWebdavKey()
	snap, err := c.decryptAndParseSnapshot(string(data), key)
	if err != nil {
		return nil, err
	}

	c.restoreSnapshotToLocal(snap)
	return map[string]interface{}{
		"success": true,
	}, nil
}

// ─── 同步模式配置 ─────────────────────────────────────────

// GetSyncMode 获取自动同步模式：webdav / r2 / ftp / sftp / all
func (c *ConfigManager) GetSyncMode() string {
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
	data, _ := json.Marshal(mode)
	return os.WriteFile(c.syncModeFile, data, 0600)
}

func (c *ConfigManager) isWebdavConfigured() bool {
	conf := c.GetWebdavConfig()
	return conf != nil && conf["url"] != ""
}

func (c *ConfigManager) isR2Configured() bool {
	conf := c.GetR2Config()
	return conf != nil && conf.Bucket != "" && conf.Endpoint != ""
}

func (c *ConfigManager) isFTPConfigured() bool {
	conf := c.GetFTPConfig()
	return conf != nil && conf.Host != "" && conf.Username != ""
}

func (c *ConfigManager) isSFTPConfigured() bool {
	conf := c.GetSFTPConfig()
	return conf != nil && conf.Host != "" && conf.Username != ""
}

// ─── 快捷命令 ──────────────────────────────────────

// GetQuickCommands 读取快捷命令列表
func (c *ConfigManager) GetQuickCommands() string {
	c.mu.Lock()
	defer c.mu.Unlock()
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
	err := os.WriteFile(c.quickCmdFile, []byte(jsonStr), 0600)
	if err == nil {
		go c.AutoSyncToWebdav()
	}
	return err
}

// SaveQuickCommandsLocal 保存快捷命令列表到本地，不触发云端同步
func (c *ConfigManager) SaveQuickCommandsLocal(jsonStr string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return os.WriteFile(c.quickCmdFile, []byte(jsonStr), 0600)
}

// GetParamHistory 读取参数历史
func (c *ConfigManager) GetParamHistory() string {
	data, err := os.ReadFile(c.paramHistFile)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// SaveParamHistory 保存参数历史
func (c *ConfigManager) SaveParamHistory(jsonStr string) error {
	return os.WriteFile(c.paramHistFile, []byte(jsonStr), 0600)
}

// ─── 命令历史 ──────────────────────────────────────

// GetCommandHistory 读取指定会话的命令历史
func (c *ConfigManager) GetCommandHistory(sessionId string) string {
	path := filepath.Join(c.historyDir, sessionId+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// SaveCommandHistory 保存指定会话的命令历史
func (c *ConfigManager) SaveCommandHistory(sessionId, jsonStr string) error {
	path := filepath.Join(c.historyDir, sessionId+".json")
	return os.WriteFile(path, []byte(jsonStr), 0600)
}

// GetGlobalCommandHistory 读取全局命令历史
func (c *ConfigManager) GetGlobalCommandHistory() string {
	data, err := os.ReadFile(c.globalHistFile)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// SaveGlobalCommandHistory 保存全局命令历史
func (c *ConfigManager) SaveGlobalCommandHistory(jsonStr string) error {
	return os.WriteFile(c.globalHistFile, []byte(jsonStr), 0600)
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
