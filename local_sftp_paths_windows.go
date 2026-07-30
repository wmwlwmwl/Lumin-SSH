//go:build windows
// +build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// wslPathMapper returns a path mapper that translates SFTP Unix-style paths to
// Windows UNC paths for a WSL distro: /home/user -> \\wsl.localhost\Ubuntu\home\user
func wslPathMapper(distro string) func(string) string {
	uncBase := `\\wsl.localhost\` + distro
	return func(sftpPath string) string {
		rel := strings.TrimPrefix(sftpPath, "/")
		if rel == "" {
			return uncBase + `\`
		}
		return uncBase + `\` + filepath.FromSlash(rel)
	}
}

// winPathMapper returns a path mapper for Windows-native shells (PowerShell/CMD).
// SFTP paths use the form /c/Users/... which map to C:\Users\...
func winPathMapper() func(string) string {
	return func(sftpPath string) string {
		p := strings.TrimPrefix(sftpPath, "/")
		if p == "" {
			// Root "/" is handled by winListRoot; return C:\ as fallback for file ops
			home, _ := os.UserHomeDir()
			return home
		}
		parts := strings.SplitN(p, "/", 2)
		drive := strings.ToUpper(parts[0]) + ":"
		if len(parts) == 1 || parts[1] == "" {
			return drive + `\`
		}
		return drive + `\` + filepath.FromSlash(parts[1])
	}
}

// winListRoot lists available Windows drive letters as synthetic directory entries.
func winListRoot() ([]os.FileInfo, error) {
	var infos []os.FileInfo
	for _, letter := range "abcdefghijklmnopqrstuvwxyz" {
		drive := string(letter) + `:\`
		if _, err := os.Stat(drive); err == nil {
			infos = append(infos, &fakeDirInfo{name: string(letter)})
		}
	}
	if len(infos) == 0 {
		// Fallback: always expose C drive
		infos = []os.FileInfo{&fakeDirInfo{name: "c"}}
	}
	return infos, nil
}

// fakeDirInfo is a synthetic os.FileInfo representing a virtual directory entry
// (used for drive letters at the Windows SFTP root).
type fakeDirInfo struct {
	name string
}

func (f *fakeDirInfo) Name() string       { return f.name }
func (f *fakeDirInfo) Size() int64        { return 0 }
func (f *fakeDirInfo) Mode() os.FileMode  { return os.ModeDir | 0755 }
func (f *fakeDirInfo) ModTime() time.Time { return time.Time{} }
func (f *fakeDirInfo) IsDir() bool        { return true }
func (f *fakeDirInfo) Sys() interface{}   { return nil }

// windowsPathToSFTP converts a Windows path (C:\Users\foo) to an SFTP-style
// path (/c/Users/foo). Used by getLocalCwd for PowerShell sessions.
func windowsPathToSFTP(winPath string) string {
	clean := filepath.ToSlash(winPath)
	if len(clean) >= 2 && clean[1] == ':' {
		drive := strings.ToLower(string(clean[0]))
		rest := clean[2:] // includes leading slash, e.g. "/Users/foo"
		return "/" + drive + rest
	}
	return "/" + strings.TrimPrefix(clean, "/")
}

// wslGetCwd queries the current working directory of the active shell
// inside a WSL distro by reading /proc/<pid>/cwd via wsl.exe.
//
// NOTE: external CWD polling is inherently fragile under WSL interop —
// ptrace_scope and multi-bash PID ambiguity make it unreliable — so the
// primary CWD source for WSL sessions is now the PROMPT_COMMAND marker stream
// parsed by commandHistoryStream (see connectLocal). This function is kept
// only as a best-effort fallback for GetTerminalCwd seeding.
func wslGetCwd(distro string) (string, error) {
	script := `pgrep -u $(id -u) -x bash 2>/dev/null | xargs -I{} readlink /proc/{}/cwd 2>/dev/null | tail -n1`
	cmd := exec.Command("wsl.exe", "-d", distro, "--", "sh", "-c", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil || len(strings.TrimSpace(string(out))) == 0 {
		return "", fmt.Errorf("wsl cwd query failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// localGetCwd returns the current working directory for a Windows local session.
// For WSL sessions it queries the shell CWD inside WSL; for native Windows
// shells it returns the user home directory converted to SFTP path format.
func localGetCwd(s *SessionData) (string, error) {
	if s.WSLDistro != "" {
		return wslGetCwd(s.WSLDistro)
	}
	// PowerShell / CMD: return home dir as a best-effort fallback.
	// Getting the precise CWD of a Windows process requires NtQueryInformationProcess
	// which is complex; the terminal tracks CWD via CurrentCwd when PS1 is configured.
	home, _ := os.UserHomeDir()
	return windowsPathToSFTP(home), nil
}
