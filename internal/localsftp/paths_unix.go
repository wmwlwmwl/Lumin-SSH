//go:build !windows
// +build !windows

package localsftp

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func UnixPathMapper(_ string) func(string) string {
	return func(sftpPath string) string {
		if sftpPath == "" {
			return "/"
		}
		return sftpPath
	}
}

func WindowsPathMapper() func(string) string { return UnixPathMapper("") }

func ListRoot() ([]os.FileInfo, error) { return nil, nil }

func CurrentWorkingDirectory(wslDistro string, pid int) (string, error) {
	_ = wslDistro
	if pid <= 0 {
		home, _ := os.UserHomeDir()
		return home, nil
	}
	if runtime.GOOS == "linux" {
		target, err := os.Readlink(fmt.Sprintf("/proc/%d/cwd", pid))
		if err != nil {
			return "", fmt.Errorf("readlink /proc/%d/cwd: %w", pid, err)
		}
		return target, nil
	}
	out, err := exec.Command("lsof", "-a", "-d", "cwd", "-p", strconv.Itoa(pid), "-Fn").Output()
	if err != nil {
		return "", fmt.Errorf("lsof cwd for pid %d: %w", pid, err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "n") {
			return strings.TrimPrefix(strings.TrimSpace(line), "n"), nil
		}
	}
	return "", fmt.Errorf("cwd not found in lsof output for pid %d", pid)
}
