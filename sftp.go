package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type SFTPConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	AuthMethod string `json:"authMethod"` // "password" 或 "key"
	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase,omitempty"`
	RemoteDir  string `json:"remoteDir"`
	MaxBackups int    `json:"maxBackups"`
}

// getSFTPKey 基于连接配置派生加密密钥。
// 注意：此处使用裸 SHA-256 而未加盐与迭代（无 KDF），该简化处理是可接受的，因为：
//  1. 输入包含用户密码等高熵字段；
//  2. 该密钥仅用于已加密配置数据的传输/静态保护；
//  3. 主保护由 ConfigManager 的主密钥提供。
//
// 修改 KDF 会破坏与既有备份的向后兼容，故保持现状。
func (c *ConfigManager) getSFTPKey() []byte {
	conf := c.GetSFTPConfig()
	if conf == nil {
		return c.key
	}
	hash := sha256.Sum256([]byte(conf.Host + fmt.Sprintf("%d", conf.Port) + conf.Username + conf.Password + conf.PrivateKey))
	return hash[:]
}

func (c *ConfigManager) GetSFTPConfig() *SFTPConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.getSFTPConfigLocked()
}

// getSFTPConfigLocked 读取 SFTP 配置，调用方需持有 c.mu
func (c *ConfigManager) getSFTPConfigLocked() *SFTPConfig {
	sftpFile := filepath.Join(c.configDir, "sftp.json")
	data, err := os.ReadFile(sftpFile)
	if err != nil {
		return nil
	}
	var conf SFTPConfig
	if err := json.Unmarshal(data, &conf); err != nil {
		return nil
	}
	conf.Username = c.decrypt(conf.Username)
	conf.Password = c.decrypt(conf.Password)
	conf.PrivateKey = c.decrypt(conf.PrivateKey)
	if conf.Port == 0 {
		conf.Port = 22
	}
	if conf.RemoteDir == "" {
		conf.RemoteDir = "/Lumin/"
	}
	if conf.RemoteDir[len(conf.RemoteDir)-1] != '/' {
		conf.RemoteDir += "/"
	}
	return &conf
}

func (c *ConfigManager) SaveSFTPConfig(config map[string]string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	existing := c.getSFTPConfigLocked()

	username := config["username"]
	password := config["password"]
	privateKey := config["privateKey"]
	if username == "" && existing != nil {
		username = existing.Username
	}
	if password == "" && existing != nil {
		password = existing.Password
	}
	if privateKey == "" && existing != nil {
		privateKey = existing.PrivateKey
	}

	port := 22
	if p, ok := config["port"]; ok && p != "" {
		fmt.Sscanf(p, "%d", &port)
	}

	remoteDir := config["remoteDir"]
	if remoteDir == "" {
		remoteDir = "/Lumin/"
	}
	if remoteDir[len(remoteDir)-1] != '/' {
		remoteDir += "/"
	}

	maxBackups := parseIntOrDefault(config["maxBackups"], 0)

	conf := SFTPConfig{
		Host:       config["host"],
		Port:       port,
		AuthMethod: config["authMethod"],
		RemoteDir:  remoteDir,
		MaxBackups: maxBackups,
	}

	encUser, err := c.encrypt(username)
	if err != nil {
		return fmt.Errorf("encrypt username: %w", err)
	}
	encPass, err := c.encrypt(password)
	if err != nil {
		return fmt.Errorf("encrypt password: %w", err)
	}
	encKey, err := c.encrypt(privateKey)
	if err != nil {
		return fmt.Errorf("encrypt private key: %w", err)
	}
	conf.Username = encUser
	conf.Password = encPass
	conf.PrivateKey = encKey
	sftpFile := filepath.Join(c.configDir, "sftp.json")
	data, err := json.MarshalIndent(conf, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal sftp config: %w", err)
	}
	return atomicWriteFile(sftpFile, data, 0600)
}

// sftpHostKeyCallback 返回基于 known_hosts 的 TOFU（首次信任）主机密钥校验回调。
// 首次连接时自动将主机密钥写入 known_hosts；后续连接若密钥不匹配则拒绝。
// 注意：TOFU 模式在首次连接时存在中间人攻击风险，此处通过日志记录以便审计。
func sftpHostKeyCallback() ssh.HostKeyCallback {
	cb, err := initKnownHostsCallback()
	if err != nil {
		return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			return err
		}
	}
	knownHostsPath := getKnownHostsPath()
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := cb(hostname, remote, key)
		if err == nil {
			return nil
		}
		// TOFU：密钥不在 known_hosts 中（首次连接），追加写入
		var keyErr *knownhosts.KeyError
		if errors.As(err, &keyErr) && len(keyErr.Want) == 0 {
			log.Printf("[sftpHostKeyCallback] TOFU: 自动接受 %s 的新主机密钥 (fingerprint: %s)", hostname, ssh.FingerprintSHA256(key))
			line := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
			if f, ferr := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_WRONLY, 0600); ferr == nil {
				if _, werr := f.WriteString(line + "\n"); werr == nil {
					f.Close()
					return nil
				}
				f.Close()
			}
		}
		return err
	}
}

// buildSSHConfig 构建 SFTP 用的 SSH 配置，复用于 TestSFTPConnection 和 newSFTPClient
func buildSSHConfig(username, password, authMethod, privateKey, passphrase string) (*ssh.ClientConfig, error) {
	sshConfig := &ssh.ClientConfig{
		User:            username,
		HostKeyCallback: sftpHostKeyCallback(),
		Timeout:         10 * time.Second,
	}
	if authMethod == "key" {
		var signer ssh.Signer
		var err error
		if passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(privateKey), []byte(passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(privateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("解析私钥失败：%w", err)
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(password)}
	}
	return sshConfig, nil
}

func (c *ConfigManager) TestSFTPConnection(host string, port int, username, password, authMethod, privateKey, passphrase string) error {
	sshConfig, err := buildSSHConfig(username, password, authMethod, privateKey, passphrase)
	if err != nil {
		return err
	}

	sshClient, err := ssh.Dial("tcp", dialAddr(host, port), sshConfig)
	if err != nil {
		return fmt.Errorf("SSH 连接失败：%w", err)
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return fmt.Errorf("SFTP 初始化失败：%w", err)
	}
	defer sftpClient.Close()

	_, err = sftpClient.ReadDir("/")
	if err != nil {
		return fmt.Errorf("读取根目录失败：%w", err)
	}

	return nil
}

func (c *ConfigManager) newSFTPClient() (*sftp.Client, *ssh.Client, error) {
	conf := c.GetSFTPConfig()
	if conf == nil {
		return nil, nil, fmt.Errorf("SFTP not configured")
	}

	sshConfig, err := buildSSHConfig(conf.Username, conf.Password, conf.AuthMethod, conf.PrivateKey, conf.Passphrase)
	if err != nil {
		return nil, nil, err
	}

	sshClient, err := ssh.Dial("tcp", dialAddr(conf.Host, conf.Port), sshConfig)
	if err != nil {
		return nil, nil, fmt.Errorf("SSH 连接失败：%w", err)
	}

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		sshClient.Close()
		return nil, nil, fmt.Errorf("SFTP 初始化失败：%w", err)
	}

	return sftpClient, sshClient, nil
}

func ensureSFTPDir(client *sftp.Client, remoteDir string) error {
	_, err := client.Stat(remoteDir)
	if err != nil {
		err = client.MkdirAll(remoteDir)
		if err != nil {
			return fmt.Errorf("创建远程目录失败：%w", err)
		}
	}
	return nil
}

// ─── SFTP RemoteStorage 实现 ──────────────────────────────

type sftpStorage struct {
	c          *ConfigManager
	client     *sftp.Client
	sshClient  *ssh.Client
	remoteDir  string
	key        []byte
	maxBackups int
}

// Close 关闭底层 SFTP 与 SSH 连接
func (s *sftpStorage) Close() error {
	var err1, err2 error
	if s.client != nil {
		err1 = s.client.Close()
	}
	if s.sshClient != nil {
		err2 = s.sshClient.Close()
	}
	if err1 != nil {
		return err1
	}
	return err2
}

func (s *sftpStorage) MaxBackups() int { return s.maxBackups }

func (s *sftpStorage) ListFiles() ([]RemoteFile, error) {
	files, err := s.client.ReadDir(s.remoteDir)
	if err != nil {
		return nil, err
	}
	var result []RemoteFile
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

func (s *sftpStorage) ReadFile(name string) ([]byte, error) {
	path := strings.TrimSuffix(s.remoteDir, "/") + "/" + name
	f, err := s.client.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(f)
	return buf.Bytes(), err
}

func (s *sftpStorage) WriteFile(name string, data []byte) error {
	if err := ensureSFTPDir(s.client, s.remoteDir); err != nil {
		return err
	}

	path := strings.TrimSuffix(s.remoteDir, "/") + "/" + name
	f, err := s.client.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.Write(data)
	if err != nil {
		return err
	}
	return f.Close()
}

func (s *sftpStorage) DeleteFile(name string) error {
	path := strings.TrimSuffix(s.remoteDir, "/") + "/" + name
	return s.client.Remove(path)
}

func (s *sftpStorage) EncryptKey() []byte { return s.key }

func (c *ConfigManager) newSFTPStorage() (RemoteStorage, int, error) {
	conf := c.GetSFTPConfig()
	if conf == nil {
		return nil, 0, fmt.Errorf("SFTP not configured")
	}
	client, sshClient, err := c.newSFTPClient()
	if err != nil {
		return nil, 0, err
	}
	return &sftpStorage{
		c:          c,
		client:     client,
		sshClient:  sshClient,
		remoteDir:  conf.RemoteDir,
		key:        c.getSFTPKey(),
		maxBackups: conf.MaxBackups,
	}, conf.MaxBackups, nil
}

// BackupToSFTP 备份到 SFTP
func (c *ConfigManager) BackupToSFTP() (map[string]interface{}, error) {
	return c.backupTo(c.newSFTPStorage)
}

// ListSFTPBackups 列出 SFTP 备份
func (c *ConfigManager) ListSFTPBackups() ([]map[string]interface{}, error) {
	return c.listBackupsFrom(c.newSFTPStorage)
}

// SyncFromSFTP 手动合并同步
func (c *ConfigManager) SyncFromSFTP() (map[string]interface{}, error) {
	return c.syncFrom(c.newSFTPStorage)
}

func (c *ConfigManager) RestoreFromSFTPFile(filename string) (map[string]interface{}, error) {
	return c.restoreFrom(c.newSFTPStorage, filename, c.getRecoveryPasswordKey())
}

// RestoreFromSFTPFileWithPassword 用用户输入的密码恢复（恢复失败时的兜底入口）。
func (c *ConfigManager) RestoreFromSFTPFileWithPassword(filename string, password string) (map[string]interface{}, error) {
	key := sha256Key(password)
	return c.restoreFrom(c.newSFTPStorage, filename, key)
}
