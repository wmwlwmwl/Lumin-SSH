package main

import (
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/pkg/sftp"
)

// copyViaSFTP recursively copies srcPath to dstPath over SFTP. Used for local
// sessions (WSL/PowerShell) whose embedded SFTP server has no shell channel to
// run `cp -a`. The SFTP server's path mapper already translates Unix-style paths
// to native OS paths, so this operates on the same paths the file manager uses.
//
// It preserves file modes and recreates directory structure. Symlinks are
// copied by re-creating them at the destination (link target preserved).
func copyViaSFTP(c *sftp.Client, srcPath, dstPath string) error {
	info, err := c.Lstat(srcPath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", srcPath, err)
	}
	return copySFTPEntry(c, srcPath, dstPath, info)
}

func copySFTPEntry(c *sftp.Client, srcPath, dstPath string, info os.FileInfo) error {
	mode := info.Mode()

	// Symlink: replicate the link rather than following it.
	if mode&os.ModeSymlink != 0 {
		target, err := c.ReadLink(srcPath)
		if err != nil {
			return err
		}
		if err := c.Symlink(target, dstPath); err != nil {
			return fmt.Errorf("symlink %s -> %s: %w", dstPath, target, err)
		}
		return nil
	}

	if mode.IsDir() {
		return copySFTPDir(c, srcPath, dstPath, info)
	}

	// Regular file (or other): stream contents.
	srcFile, err := c.Open(srcPath)
	if err != nil {
		return fmt.Errorf("open %s: %w", srcPath, err)
	}
	defer srcFile.Close()

	dstFile, err := c.OpenFile(dstPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("create %s: %w", dstPath, err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Errorf("copy %s -> %s: %w", srcPath, dstPath, err)
	}
	// Best-effort mode preservation.
	if mode.Perm() != 0 {
		_ = c.Chmod(dstPath, mode.Perm())
	}
	return nil
}

func copySFTPDir(c *sftp.Client, srcPath, dstPath string, info os.FileInfo) error {
	if err := c.MkdirAll(dstPath); err != nil {
		return fmt.Errorf("mkdir %s: %w", dstPath, err)
	}

	walker := c.Walk(srcPath)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			return err
		}
		// Skip the root itself (already created above); only copy children.
		if walker.Path() == srcPath {
			continue
		}
		st := walker.Stat()
		if st == nil {
			continue
		}
		rel, err := sftpRelPath(srcPath, walker.Path())
		if err != nil {
			return err
		}
		target := path.Join(dstPath, rel)

		if st.IsDir() {
			if err := c.MkdirAll(target); err != nil {
				return fmt.Errorf("mkdir %s: %w", target, err)
			}
			if st.Mode().Perm() != 0 {
				_ = c.Chmod(target, st.Mode().Perm())
			}
			continue
		}
		if err := copySFTPEntry(c, walker.Path(), target, st); err != nil {
			return err
		}
	}
	if info.Mode().Perm() != 0 {
		_ = c.Chmod(dstPath, info.Mode().Perm())
	}
	return nil
}

// sftpRelPath returns walker.Path() relative to root, using forward slashes.
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
