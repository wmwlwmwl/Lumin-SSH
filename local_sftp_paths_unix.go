//go:build !windows
// +build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// unixPathMapper returns a path mapper for local Unix shell sessions.
// On macOS and Linux SFTP paths are the same as OS paths, so this is an identity function.
func unixPathMapper(_ string) func(string) string {
	return func(sftpPath string) string {
		if sftpPath == "" {
			return "/"
		}
		return sftpPath
	}
}

// getLocalUnixCwd returns the current working directory of the shell process
// running in a local Unix terminal session.
func getLocalUnixCwd(pid int) (string, error) {
	if runtime.GOOS == "linux" {
		// Linux: /proc/<pid>/cwd is a symlink to the process CWD
		target, err := os.Readlink(fmt.Sprintf("/proc/%d/cwd", pid))
		if err != nil {
			return "", fmt.Errorf("readlink /proc/%d/cwd: %w", pid, err)
		}
		return target, nil
	}
	// macOS: use lsof to get the CWD of the process
	out, err := exec.Command("lsof", "-a", "-d", "cwd", "-p", fmt.Sprintf("%d", pid), "-Fn").Output()
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

// localGetCwd returns the current working directory for a Unix local session
// by reading the shell process CWD directly from the OS. cmd is a locked
// snapshot of s.Cmd taken by the caller (CloseLocal may nil it concurrently).
func localGetCwd(s *SessionData, cmd *exec.Cmd) (string, error) {
	_ = s
	if cmd == nil || cmd.Process == nil {
		home, _ := os.UserHomeDir()
		return home, nil
	}
	return getLocalUnixCwd(cmd.Process.Pid)
}
