package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
)

type FTPConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	RemoteDir  string `json:"remoteDir"`
	MaxBackups int    `json:"maxBackups"`
}

// getFTPKey 基于连接配置派生加密密钥。
// 注意：此处使用裸 SHA-256 而未加盐与迭代（无 KDF），该简化处理是可接受的，因为：
//  1. 输入包含用户密码等高熵字段；
//  2. 该密钥仅用于已加密配置数据的传输/静态保护；
//  3. 主保护由 ConfigManager 的主密钥提供。
//
// 修改 KDF 会破坏与既有备份的向后兼容，故保持现状。
func (c *ConfigManager) getFTPKey() []byte {
	conf := c.GetFTPConfig()
	if conf == nil {
		return c.key
	}
	hash := sha256.Sum256([]byte(conf.Host + fmt.Sprintf("%d", conf.Port) + conf.Username + conf.Password))
	return hash[:]
}

func (c *ConfigManager) GetFTPConfig() *FTPConfig {
	ftpFile := filepath.Join(c.configDir, "ftp.json")
	data, err := os.ReadFile(ftpFile)
	if err != nil {
		return nil
	}
	var conf FTPConfig
	json.Unmarshal(data, &conf)
	conf.Username = c.decrypt(conf.Username)
	conf.Password = c.decrypt(conf.Password)
	if conf.RemoteDir == "" {
		conf.RemoteDir = "/Lumin/"
	}
	if conf.Port == 0 {
		conf.Port = 21
	}
	return &conf
}

func (c *ConfigManager) SaveFTPConfig(config map[string]string) error {
	existing := c.GetFTPConfig()

	username := config["username"]
	password := config["password"]
	if username == "" && existing != nil {
		username = existing.Username
	}
	if password == "" && existing != nil {
		password = existing.Password
	}

	port := 21
	if config["port"] != "" {
		fmt.Sscanf(config["port"], "%d", &port)
	}

	remoteDir := config["remoteDir"]
	if remoteDir == "" {
		remoteDir = "/Lumin/"
	}
	if !strings.HasPrefix(remoteDir, "/") {
		remoteDir = "/" + remoteDir
	}
	if !strings.HasSuffix(remoteDir, "/") {
		remoteDir += "/"
	}

	maxBackups := 0
	if config["maxBackups"] != "" {
		fmt.Sscanf(config["maxBackups"], "%d", &maxBackups)
	}

	conf := FTPConfig{
		Host:       config["host"],
		Port:       port,
		Username:   c.encrypt(username),
		Password:   c.encrypt(password),
		RemoteDir:  remoteDir,
		MaxBackups: maxBackups,
	}
	ftpFile := filepath.Join(c.configDir, "ftp.json")
	data, _ := json.MarshalIndent(conf, "", "  ")
	return os.WriteFile(ftpFile, data, 0600)
}

func (c *ConfigManager) TestFTPConnection(host string, port int, username, password string) error {
	addr := dialAddr(host, port)
	// 优先尝试显式 TLS，失败则回退到明文
	client, err := ftp.Dial(addr, ftp.DialWithTimeout(10*time.Second), ftp.DialWithExplicitTLS(&tls.Config{ServerName: host}))
	if err != nil {
		log.Printf("FTP TLS 拨号失败 %s，回退到明文连接: %v", addr, err)
		client, err = ftp.Dial(addr, ftp.DialWithTimeout(10*time.Second))
		if err != nil {
			return err
		}
	}
	defer client.Quit()

	err = client.Login(username, password)
	if err != nil {
		return err
	}
	return nil
}

func (c *ConfigManager) newFTPClient() (*ftp.ServerConn, error) {
	conf := c.GetFTPConfig()
	if conf == nil {
		return nil, fmt.Errorf("FTP not configured")
	}
	addr := dialAddr(conf.Host, conf.Port)
	// 优先尝试显式 TLS，失败则回退到明文
	client, err := ftp.Dial(addr, ftp.DialWithTimeout(10*time.Second), ftp.DialWithExplicitTLS(&tls.Config{ServerName: conf.Host}))
	if err != nil {
		log.Printf("FTP TLS 拨号失败 %s，回退到明文连接: %v", addr, err)
		client, err = ftp.Dial(addr, ftp.DialWithTimeout(10*time.Second))
		if err != nil {
			return nil, err
		}
	}
	err = client.Login(conf.Username, conf.Password)
	if err != nil {
		client.Quit()
		return nil, err
	}
	return client, nil
}

func (c *ConfigManager) ensureFTPDir(client *ftp.ServerConn) error {
	conf := c.GetFTPConfig()
	if conf == nil {
		return fmt.Errorf("FTP not configured")
	}

	// Try to change to the remote directory first
	err := client.ChangeDir(conf.RemoteDir)
	if err == nil {
		return nil
	}

	// Directory doesn't exist, create it level by level
	parts := strings.Split(strings.Trim(conf.RemoteDir, "/"), "/")
	current := ""
	for _, part := range parts {
		if part == "" {
			continue
		}
		current += "/" + part
		err := client.ChangeDir(current)
		if err != nil {
			err = client.MakeDir(current)
			if err != nil {
				return fmt.Errorf("failed to create directory %s: %v", current, err)
			}
		}
	}
	// Final change to the target dir
	return client.ChangeDir(conf.RemoteDir)
}

// ─── FTP RemoteStorage 实现 ───────────────────────────────

type ftpStorage struct {
	c          *ConfigManager
	remoteDir  string
	key        []byte
	maxBackups int
}

func (s *ftpStorage) MaxBackups() int { return s.maxBackups }

func (s *ftpStorage) ListFiles() ([]RemoteFile, error) {
	client, err := s.c.newFTPClient()
	if err != nil {
		return nil, err
	}
	defer client.Quit()

	entries, err := client.List(s.remoteDir)
	if err != nil {
		return nil, err
	}
	var result []RemoteFile
	for _, e := range entries {
		result = append(result, RemoteFile{
			Name:    e.Name,
			ModTime: e.Time,
			IsDir:   e.Type == ftp.EntryTypeFolder,
			Size:    int64(e.Size),
		})
	}
	return result, nil
}

func (s *ftpStorage) ReadFile(name string) ([]byte, error) {
	client, err := s.c.newFTPClient()
	if err != nil {
		return nil, err
	}
	defer client.Quit()

	path := strings.TrimRight(s.remoteDir, "/") + "/" + name
	resp, err := client.Retr(path)
	if err != nil {
		return nil, err
	}
	defer resp.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(resp)
	return buf.Bytes(), err
}

func (s *ftpStorage) WriteFile(name string, data []byte) error {
	client, err := s.c.newFTPClient()
	if err != nil {
		return err
	}
	defer client.Quit()

	if err := s.c.ensureFTPDir(client); err != nil {
		return err
	}

	return client.Stor(name, bytes.NewReader(data))
}

func (s *ftpStorage) DeleteFile(name string) error {
	client, err := s.c.newFTPClient()
	if err != nil {
		return err
	}
	defer client.Quit()
	path := strings.TrimRight(s.remoteDir, "/") + "/" + name
	return client.Delete(path)
}

func (s *ftpStorage) EncryptKey() []byte { return s.key }

func (c *ConfigManager) newFTPStorage() (RemoteStorage, int, error) {
	conf := c.GetFTPConfig()
	if conf == nil {
		return nil, 0, fmt.Errorf("FTP not configured")
	}
	return &ftpStorage{c: c, remoteDir: conf.RemoteDir, key: c.getFTPKey(), maxBackups: conf.MaxBackups}, conf.MaxBackups, nil
}

// BackupToFTP 备份到 FTP
func (c *ConfigManager) BackupToFTP() (map[string]interface{}, error) {
	s, max, err := c.newFTPStorage()
	if err != nil {
		return nil, err
	}
	return c.backupConnections(s, max)
}

// ListFTPBackups 列出 FTP 备份
func (c *ConfigManager) ListFTPBackups() ([]map[string]interface{}, error) {
	s, _, err := c.newFTPStorage()
	if err != nil {
		return nil, err
	}
	return c.listBackupFiles(s)
}

// SyncFromFTP 手动合并同步
func (c *ConfigManager) SyncFromFTP() (map[string]interface{}, error) {
	s, _, err := c.newFTPStorage()
	if err != nil {
		return nil, err
	}
	return c.syncFromProvider(s)
}

func (c *ConfigManager) RestoreFromFTPFile(filename string) (map[string]interface{}, error) {
	filename = filepath.Base(filename) // 防止路径穿越
	conf := c.GetFTPConfig()
	if conf == nil {
		return nil, fmt.Errorf("FTP not configured")
	}
	client, err := c.newFTPClient()
	if err != nil {
		return nil, err
	}
	defer client.Quit()

	remotePath := strings.TrimRight(conf.RemoteDir, "/") + "/" + filename
	resp, err := client.Retr(remotePath)
	if err != nil {
		return nil, err
	}
	defer resp.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(resp)
	if err != nil {
		return nil, err
	}

	key := c.getFTPKey()
	snap, err := c.decryptAndParseSnapshot(buf.String(), key)
	if err != nil {
		return nil, err
	}

	c.restoreSnapshotToLocal(snap)
	return map[string]interface{}{
		"success": true,
	}, nil
}
