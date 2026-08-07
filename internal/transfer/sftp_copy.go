package transfer

import (
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/pkg/sftp"
)

// CopyViaSFTP recursively copies srcPath to dstPath over SFTP. It is used for
// local sessions whose embedded SFTP server has no shell channel to run cp -a.
func CopyViaSFTP(client *sftp.Client, srcPath, dstPath string) error {
	info, err := client.Lstat(srcPath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", srcPath, err)
	}
	return copySFTPEntry(client, srcPath, dstPath, info)
}

func copySFTPEntry(client *sftp.Client, srcPath, dstPath string, info os.FileInfo) error {
	mode := info.Mode()
	if mode&os.ModeSymlink != 0 {
		target, err := client.ReadLink(srcPath)
		if err != nil {
			return err
		}
		if err := client.Symlink(target, dstPath); err != nil {
			return fmt.Errorf("symlink %s -> %s: %w", dstPath, target, err)
		}
		return nil
	}
	if mode.IsDir() {
		return copySFTPDir(client, srcPath, dstPath, info)
	}

	srcFile, err := client.Open(srcPath)
	if err != nil {
		return fmt.Errorf("open %s: %w", srcPath, err)
	}
	defer srcFile.Close()

	dstFile, err := client.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("create %s: %w", dstPath, err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Errorf("copy %s -> %s: %w", srcPath, dstPath, err)
	}
	if mode.Perm() != 0 {
		_ = client.Chmod(dstPath, mode.Perm())
	}
	return nil
}

func copySFTPDir(client *sftp.Client, srcPath, dstPath string, info os.FileInfo) error {
	if err := client.MkdirAll(dstPath); err != nil {
		return fmt.Errorf("mkdir %s: %w", dstPath, err)
	}

	walker := client.Walk(srcPath)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			return err
		}
		if walker.Path() == srcPath {
			continue
		}
		entryInfo := walker.Stat()
		if entryInfo == nil {
			continue
		}
		relativePath, err := sftpRelPath(srcPath, walker.Path())
		if err != nil {
			return err
		}
		target := path.Join(dstPath, relativePath)
		if entryInfo.IsDir() {
			if err := client.MkdirAll(target); err != nil {
				return fmt.Errorf("mkdir %s: %w", target, err)
			}
			if entryInfo.Mode().Perm() != 0 {
				_ = client.Chmod(target, entryInfo.Mode().Perm())
			}
			continue
		}
		if err := copySFTPEntry(client, walker.Path(), target, entryInfo); err != nil {
			return err
		}
	}
	if info.Mode().Perm() != 0 {
		_ = client.Chmod(dstPath, info.Mode().Perm())
	}
	return nil
}

func sftpRelPath(root, full string) (string, error) {
	root = strings.TrimSuffix(root, "/")
	if full == root {
		return "", nil
	}
	if !strings.HasPrefix(full, root+"/") {
		return "", fmt.Errorf("path %q not under %q", full, root)
	}
	return strings.TrimPrefix(full, root+"/"), nil
}
