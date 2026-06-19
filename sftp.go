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
	existing := c.GetSFTPConfig()

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

	maxBackups := 0
	if config["maxBackups"] != "" {
		fmt.Sscanf(config["maxBackups"], "%d", &maxBackups)
	}

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
	data, _ := json.MarshalIndent(conf, "", "  ")
	return os.WriteFile(sftpFile, data, 0600)
}

// sftpHostKeyCallback 返回基于 known_hosts 的 TOFU（首次信任）主机密钥校验回调。
// 首次连接时自动将主机密钥写入 known_hosts；后续连接若密钥不匹配则拒绝。
func sftpHostKeyCallback() ssh.HostKeyCallback {
	hostKeyPath := getKnownHostsPath()
	if err := os.MkdirAll(filepath.Dir(hostKeyPath), 0700); err != nil {
		log.Printf("[sftpHostKeyCallback] MkdirAll for known_hosts dir failed: %v", err)
	}
	if _, err := os.Stat(hostKeyPath); os.IsNotExist(err) {
		if err := os.WriteFile(hostKeyPath, []byte(""), 0600); err != nil {
			log.Printf("[sftpHostKeyCallback] failed to create known_hosts file: %v", err)
		}
	}
	cb, err := knownhosts.New(hostKeyPath)
	if err != nil {
		// known_hosts 损坏，重建空文件后重试，而非禁用校验
		if err := os.WriteFile(hostKeyPath, []byte(""), 0600); err != nil {
			log.Printf("[sftpHostKeyCallback] failed to recreate known_hosts file: %v", err)
		}
		cb, err = knownhosts.New(hostKeyPath)
		if err != nil {
			return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
				return fmt.Errorf("无法初始化主机密钥校验: %w", err)
			}
		}
	}
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := cb(hostname, remote, key)
		if err == nil {
			return nil
		}
		// TOFU：密钥不在 known_hosts 中（首次连接），追加写入
		var keyErr *knownhosts.KeyError
		if errors.As(err, &keyErr) && len(keyErr.Want) == 0 {
			line := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
			if f, ferr := os.OpenFile(hostKeyPath, os.O_APPEND|os.O_WRONLY, 0600); ferr == nil {
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

func (c *ConfigManager) TestSFTPConnection(host string, port int, username, password, authMethod, privateKey string) error {
	sshConfig := &ssh.ClientConfig{
		User:            username,
		HostKeyCallback: sftpHostKeyCallback(),
		Timeout:         10 * time.Second,
	}

	if authMethod == "key" {
		signer, err := ssh.ParsePrivateKey([]byte(privateKey))
		if err != nil {
			return fmt.Errorf("解析私钥失败：%w", err)
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(password)}
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

	sshConfig := &ssh.ClientConfig{
		User:            conf.Username,
		HostKeyCallback: sftpHostKeyCallback(),
		Timeout:         10 * time.Second,
	}

	if conf.AuthMethod == "key" {
		signer, err := ssh.ParsePrivateKey([]byte(conf.PrivateKey))
		if err != nil {
			return nil, nil, fmt.Errorf("解析私钥失败：%w", err)
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(conf.Password)}
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

func (c *ConfigManager) ensureSFTPDir(client *sftp.Client) error {
	conf := c.GetSFTPConfig()
	if conf == nil {
		return fmt.Errorf("SFTP not configured")
	}
	_, err := client.Stat(conf.RemoteDir)
	if err != nil {
		err = client.MkdirAll(conf.RemoteDir)
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
	if err := s.c.ensureSFTPDir(s.client); err != nil {
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
	s, max, err := c.newSFTPStorage()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return c.backupConnections(s, max)
}

// ListSFTPBackups 列出 SFTP 备份
func (c *ConfigManager) ListSFTPBackups() ([]map[string]interface{}, error) {
	s, _, err := c.newSFTPStorage()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return c.listBackupFiles(s)
}

// SyncFromSFTP 手动合并同步
func (c *ConfigManager) SyncFromSFTP() (map[string]interface{}, error) {
	s, _, err := c.newSFTPStorage()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return c.syncFromProvider(s)
}

func (c *ConfigManager) RestoreFromSFTPFile(filename string) (map[string]interface{}, error) {
	s, _, err := c.newSFTPStorage()
	if err != nil {
		return nil, err
	}
	if cl, ok := s.(storageCloser); ok {
		defer cl.Close()
	}
	return restoreResult(c.restoreFromProvider(s, filename))
}
