package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type R2Config struct {
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	Bucket          string `json:"bucket"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	Prefix          string `json:"prefix"`
	MaxBackups      int    `json:"maxBackups"`
}

// getR2Key 基于连接配置派生加密密钥。
// 注意：此处使用裸 SHA-256 而未加盐与迭代（无 KDF），该简化处理是可接受的，因为：
//  1. 输入包含访问密钥等高熵字段；
//  2. 该密钥仅用于已加密配置数据的传输/静态保护；
//  3. 主保护由 ConfigManager 的主密钥提供。
// 修改 KDF 会破坏与既有备份的向后兼容，故保持现状。
func (c *ConfigManager) getR2Key() []byte {
	conf := c.GetR2Config()
	if conf == nil {
		return c.key
	}
	hash := sha256.Sum256([]byte(conf.AccessKeyID + conf.SecretAccessKey + conf.Bucket + conf.Endpoint))
	return hash[:]
}

func (c *ConfigManager) GetR2Config() *R2Config {
	r2File := filepath.Join(c.configDir, "r2.json")
	data, err := os.ReadFile(r2File)
	if err != nil {
		return nil
	}
	var conf R2Config
	json.Unmarshal(data, &conf)
	conf.AccessKeyID = c.decrypt(conf.AccessKeyID)
	conf.SecretAccessKey = c.decrypt(conf.SecretAccessKey)
	if conf.Region == "" {
		conf.Region = "auto"
	}
	if conf.Prefix == "" {
		conf.Prefix = "Lumin/"
	}
	return &conf
}

func (c *ConfigManager) SaveR2Config(config map[string]string) error {
	existing := c.GetR2Config()

	accessKey := config["accessKeyId"]
	secretKey := config["secretAccessKey"]
	if accessKey == "" && existing != nil {
		accessKey = existing.AccessKeyID
	}
	if secretKey == "" && existing != nil {
		secretKey = existing.SecretAccessKey
	}

	prefix := config["prefix"]
	if prefix == "" {
		prefix = "Lumin/"
	}
	if prefix[len(prefix)-1] != '/' {
		prefix += "/"
	}

	region := config["region"]
	if region == "" {
		region = "auto"
	}

	maxBackups := 0
	if config["maxBackups"] != "" {
		fmt.Sscanf(config["maxBackups"], "%d", &maxBackups)
	}

	conf := R2Config{
		AccessKeyID:     c.encrypt(accessKey),
		SecretAccessKey: c.encrypt(secretKey),
		Bucket:          config["bucket"],
		Endpoint:        sanitizeEndpoint(config["endpoint"]),
		Region:          region,
		Prefix:          prefix,
		MaxBackups:      maxBackups,
	}
	r2File := filepath.Join(c.configDir, "r2.json")
	data, _ := json.MarshalIndent(conf, "", "  ")
	return os.WriteFile(r2File, data, 0600)
}

// sanitizeEndpoint 去除 URL 中的协议前缀和尾部斜杠，minio.New 会自动拼接 https://
func sanitizeEndpoint(endpoint string) string {
	e := strings.TrimSpace(endpoint)
	e = strings.TrimSuffix(e, "/")
	e = strings.TrimPrefix(e, "https://")
	e = strings.TrimPrefix(e, "http://")
	return e
}

func (c *ConfigManager) TestR2Connection(accessKeyId, secretAccessKey, bucket, endpoint string) error {
	cli, err := minio.New(sanitizeEndpoint(endpoint), &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyId, secretAccessKey, ""),
		Secure: true,
		Region: "auto",
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for obj := range cli.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:  "",
		MaxKeys: 1,
	}) {
		if obj.Err != nil {
			return obj.Err
		}
		break
	}
	return nil
}

func (c *ConfigManager) newR2Client() (*minio.Client, error) {
	conf := c.GetR2Config()
	if conf == nil {
		return nil, fmt.Errorf("R2 not configured")
	}
	return minio.New(sanitizeEndpoint(conf.Endpoint), &minio.Options{
		Creds:  credentials.NewStaticV4(conf.AccessKeyID, conf.SecretAccessKey, ""),
		Secure: true,
		Region: conf.Region,
	})
}

// ─── R2 RemoteStorage 实现 ─────────────────────────────────

type r2Storage struct {
	cli        *minio.Client
	bucket     string
	prefix     string
	key        []byte
	maxBackups int
}

func (s *r2Storage) MaxBackups() int { return s.maxBackups }

func (s *r2Storage) ListFiles() ([]RemoteFile, error) {
	ctx := context.Background()
	objects := s.cli.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{Prefix: s.prefix})
	var result []RemoteFile
	var firstErr error
	for obj := range objects {
		if obj.Err != nil {
			if firstErr == nil {
				firstErr = obj.Err
			}
			continue
		}
		name := strings.TrimPrefix(obj.Key, s.prefix)
		if name == "" {
			continue
		}
		result = append(result, RemoteFile{
			Name:    name,
			ModTime: obj.LastModified,
			Size:    obj.Size,
		})
	}
	if firstErr != nil {
		return nil, fmt.Errorf("list objects error: %w", firstErr)
	}
	return result, nil
}

func (s *r2Storage) ReadFile(name string) ([]byte, error) {
	ctx := context.Background()
	obj, err := s.cli.GetObject(ctx, s.bucket, s.prefix+name, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(obj)
	return buf.Bytes(), err
}

func (s *r2Storage) WriteFile(name string, data []byte) error {
	ctx := context.Background()
	objectKey := s.prefix + name
	_, err := s.cli.PutObject(ctx, s.bucket, objectKey, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: "application/octet-stream",
	})
	return err
}

func (s *r2Storage) DeleteFile(name string) error {
	ctx := context.Background()
	return s.cli.RemoveObject(ctx, s.bucket, s.prefix+name, minio.RemoveObjectOptions{})
}

func (s *r2Storage) EncryptKey() []byte { return s.key }

func (c *ConfigManager) newR2Storage() (RemoteStorage, int, error) {
	conf := c.GetR2Config()
	if conf == nil {
		return nil, 0, fmt.Errorf("R2 not configured")
	}
	cli, err := c.newR2Client()
	if err != nil {
		return nil, 0, err
	}
	return &r2Storage{cli: cli, bucket: conf.Bucket, prefix: conf.Prefix, key: c.getR2Key(), maxBackups: conf.MaxBackups}, conf.MaxBackups, nil
}

// BackupToR2 备份到 R2
func (c *ConfigManager) BackupToR2() (map[string]interface{}, error) {
	s, max, err := c.newR2Storage()
	if err != nil {
		return nil, err
	}
	return c.backupConnections(s, max)
}

// ListR2Backups 列出 R2 备份
func (c *ConfigManager) ListR2Backups() ([]map[string]interface{}, error) {
	s, _, err := c.newR2Storage()
	if err != nil {
		return nil, err
	}
	return c.listBackupFiles(s)
}

// SyncFromR2 手动合并同步
func (c *ConfigManager) SyncFromR2() (map[string]interface{}, error) {
	s, _, err := c.newR2Storage()
	if err != nil {
		return nil, err
	}
	return c.syncFromProvider(s)
}

func (c *ConfigManager) RestoreFromR2File(objectKey string) (map[string]interface{}, error) {
	conf := c.GetR2Config()
	if conf == nil {
		return nil, fmt.Errorf("R2 not configured")
	}
	cli, err := c.newR2Client()
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	fullKey := conf.Prefix + objectKey
	obj, err := cli.GetObject(ctx, conf.Bucket, fullKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()

	buf := new(bytes.Buffer)
	_, err = buf.ReadFrom(obj)
	if err != nil {
		return nil, err
	}

	key := c.getR2Key()
	snap, err := c.decryptAndParseSnapshot(buf.String(), key)
	if err != nil {
		return nil, err
	}

	c.restoreSnapshotToLocal(snap)
	return map[string]interface{}{
		"success": true,
	}, nil
}
