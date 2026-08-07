//go:build windows
// +build windows

package localsftp

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func WSLPathMapper(distro string) func(string) string {
	uncBase := `\\wsl.localhost\` + distro
	return func(sftpPath string) string {
		relative := strings.TrimPrefix(sftpPath, "/")
		if relative == "" {
			return uncBase + `\`
		}
		if strings.HasPrefix(relative, "mnt/") {
			parts := strings.SplitN(relative[len("mnt/"):], "/", 2)
			if len(parts[0]) == 1 {
				drive := strings.ToUpper(parts[0]) + ":"
				if len(parts) == 1 || parts[1] == "" {
					return drive + `\`
				}
				return drive + `\` + filepath.FromSlash(parts[1])
			}
		}
		return uncBase + `\` + filepath.FromSlash(relative)
	}
}

func WindowsPathMapper() func(string) string {
	return func(sftpPath string) string {
		path := strings.TrimPrefix(sftpPath, "/")
		if path == "" {
			home, _ := os.UserHomeDir()
			return home
		}
		parts := strings.SplitN(path, "/", 2)
		drive := strings.ToUpper(parts[0]) + ":"
		if len(parts) == 1 || parts[1] == "" {
			return drive + `\`
		}
		return drive + `\` + filepath.FromSlash(parts[1])
	}
}

func UnixPathMapper(root string) func(string) string { return WSLPathMapper(root) }

func ListRoot() ([]os.FileInfo, error) {
	infos := make([]os.FileInfo, 0)
	for _, letter := range "abcdefghijklmnopqrstuvwxyz" {
		drive := string(letter) + `:\`
		if _, err := os.Stat(drive); err == nil {
			infos = append(infos, &fakeDirInfo{name: string(letter)})
		}
	}
	if len(infos) == 0 {
		infos = []os.FileInfo{&fakeDirInfo{name: "c"}}
	}
	return infos, nil
}

type fakeDirInfo struct{ name string }

func (f *fakeDirInfo) Name() string       { return f.name }
func (f *fakeDirInfo) Size() int64        { return 0 }
func (f *fakeDirInfo) Mode() os.FileMode  { return os.ModeDir | 0o755 }
func (f *fakeDirInfo) ModTime() time.Time { return time.Time{} }
func (f *fakeDirInfo) IsDir() bool        { return true }
func (f *fakeDirInfo) Sys() any           { return nil }

func windowsPathToSFTP(windowsPath string) string {
	cleaned := filepath.ToSlash(windowsPath)
	if len(cleaned) >= 2 && cleaned[1] == ':' {
		return "/" + strings.ToLower(string(cleaned[0])) + cleaned[2:]
	}
	return "/" + strings.TrimPrefix(cleaned, "/")
}

func CurrentWorkingDirectory(wslDistro string, pid int) (string, error) {
	_ = pid
	if wslDistro != "" {
		script := `pgrep -u $(id -u) -x bash 2>/dev/null | xargs -I{} readlink /proc/{}/cwd 2>/dev/null | tail -n1`
		command := exec.Command("wsl.exe", "-d", wslDistro, "--", "sh", "-c", script)
		command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		output, err := command.Output()
		if err != nil || strings.TrimSpace(string(output)) == "" {
			return "", fmt.Errorf("wsl cwd query failed: %w", err)
		}
		return strings.TrimSpace(string(output)), nil
	}
	home, _ := os.UserHomeDir()
	return windowsPathToSFTP(home), nil
}
