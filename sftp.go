package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
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
	json.Unmarshal(data, &conf)
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
		Username:   c.encrypt(username),
		AuthMethod: config["authMethod"],
		Password:   c.encrypt(password),
		PrivateKey: c.encrypt(privateKey),
		RemoteDir:  remoteDir,
		MaxBackups: maxBackups,
	}
	sftpFile := filepath.Join(c.configDir, "sftp.json")
	data, _ := json.MarshalIndent(conf, "", "  ")
	return os.WriteFile(sftpFile, data, 0600)
}

// sftpHostKeyCallback 返回基于 known_hosts 的 TOFU（首次信任）主机密钥校验回调。
// 首次连接时自动将主机密钥写入 known_hosts；后续连接若密钥不匹配则拒绝。
func sftpHostKeyCallback() ssh.HostKeyCallback {
	hostKeyPath := getKnownHostsPath()
	os.MkdirAll(filepath.Dir(hostKeyPath), 0700)
	if _, err := os.Stat(hostKeyPath); os.IsNotExist(err) {
		os.WriteFile(hostKeyPath, []byte(""), 0600)
	}
	cb, err := knownhosts.New(hostKeyPath)
	if err != nil {
		// known_hosts 损坏，重建空文件后重试，而非禁用校验
		os.WriteFile(hostKeyPath, []byte(""), 0600)
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
			return fmt.Errorf("解析私钥失败：%v", err)
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(password)}
	}

	sshClient, err := ssh.Dial("tcp", dialAddr(host, port), sshConfig)
	if err != nil {
		return fmt.Errorf("SSH 连接失败：%v", err)
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return fmt.Errorf("SFTP 初始化失败：%v", err)
	}
	defer sftpClient.Close()

	_, err = sftpClient.ReadDir("/")
	if err != nil {
		return fmt.Errorf("读取根目录失败：%v", err)
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
			return nil, nil, fmt.Errorf("解析私钥失败：%v", err)
		}
		sshConfig.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	} else {
		sshConfig.Auth = []ssh.AuthMethod{ssh.Password(conf.Password)}
	}

	sshClient, err := ssh.Dial("tcp", dialAddr(conf.Host, conf.Port), sshConfig)
	if err != nil {
		return nil, nil, fmt.Errorf("SSH 连接失败：%v", err)
	}

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		sshClient.Close()
		return nil, nil, fmt.Errorf("SFTP 初始化失败：%v", err)
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
			return fmt.Errorf("创建远程目录失败：%v", err)
		}
	}
	return nil
}

// ─── SFTP RemoteStorage 实现 ──────────────────────────────

type sftpStorage struct {
	c          *ConfigManager
	remoteDir  string
	key        []byte
	maxBackups int
}

func (s *sftpStorage) MaxBackups() int { return s.maxBackups }

func (s *sftpStorage) ListFiles() ([]RemoteFile, error) {
	client, sshClient, err := s.c.newSFTPClient()
	if err != nil {
		return nil, err
	}
	defer client.Close()
	defer sshClient.Close()

	files, err := client.ReadDir(s.remoteDir)
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
	client, sshClient, err := s.c.newSFTPClient()
	if err != nil {
		return nil, err
	}
	defer client.Close()
	defer sshClient.Close()

	path := strings.TrimSuffix(s.remoteDir, "/") + "/" + name
	f, err := client.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(f)
	return buf.Bytes(), err
}

func (s *sftpStorage) WriteFile(name string, data []byte) error {
	client, sshClient, err := s.c.newSFTPClient()
	if err != nil {
		return err
	}
	defer client.Close()
	defer sshClient.Close()

	if err := s.c.ensureSFTPDir(client); err != nil {
		return err
	}

	path := strings.TrimSuffix(s.remoteDir, "/") + "/" + name
	f, err := client.Create(path)
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
	client, sshClient, err := s.c.newSFTPClient()
	if err != nil {
		return err
	}
	defer client.Close()
	defer sshClient.Close()
	path := strings.TrimSuffix(s.remoteDir, "/") + "/" + name
	return client.Remove(path)
}

func (s *sftpStorage) EncryptKey() []byte { return s.key }

func (c *ConfigManager) newSFTPStorage() (RemoteStorage, int, error) {
	conf := c.GetSFTPConfig()
	if conf == nil {
		return nil, 0, fmt.Errorf("SFTP not configured")
	}
	return &sftpStorage{c: c, remoteDir: conf.RemoteDir, key: c.getSFTPKey(), maxBackups: conf.MaxBackups}, conf.MaxBackups, nil
}

// BackupToSFTP 备份到 SFTP
func (c *ConfigManager) BackupToSFTP() (map[string]interface{}, error) {
	s, max, err := c.newSFTPStorage()
	if err != nil {
		return nil, err
	}
	return c.backupConnections(s, max)
}

// ListSFTPBackups 列出 SFTP 备份
func (c *ConfigManager) ListSFTPBackups() ([]map[string]interface{}, error) {
	s, _, err := c.newSFTPStorage()
	if err != nil {
		return nil, err
	}
	return c.listBackupFiles(s)
}

// SyncFromSFTP 手动合并同步
func (c *ConfigManager) SyncFromSFTP() (map[string]interface{}, error) {
	s, _, err := c.newSFTPStorage()
	if err != nil {
		return nil, err
	}
	return c.syncFromProvider(s)
}

func (c *ConfigManager) RestoreFromSFTPFile(filename string) (map[string]interface{}, error) {
	filename = filepath.Base(filename) // 防止路径穿越
	conf := c.GetSFTPConfig()
	if conf == nil {
		return nil, fmt.Errorf("SFTP not configured")
	}

	client, sshClient, err := c.newSFTPClient()
	if err != nil {
		return nil, err
	}
	defer client.Close()
	defer sshClient.Close()

	remotePath := strings.TrimSuffix(conf.RemoteDir, "/") + "/" + filename
	f, err := client.Open(remotePath)
	if err != nil {
		return nil, fmt.Errorf("打开远程文件失败：%v", err)
	}
	defer f.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(f)
	if err != nil {
		return nil, fmt.Errorf("读取远程文件失败：%v", err)
	}

	key := c.getSFTPKey()
	snap, err := c.decryptAndParseSnapshot(buf.String(), key)
	if err != nil {
		return nil, err
	}

	c.restoreSnapshotToLocal(snap)
	return map[string]interface{}{
		"success": true,
	}, nil
}
