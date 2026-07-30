//go:build windows
// +build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

// getLocalSystemInfoImpl runs the dynamic probe script for a local Windows session.
// For WSL sessions it executes the script inside the WSL distro via wsl.exe.
// For Windows-native shells (PowerShell/CMD) system info is not yet supported.
func getLocalSystemInfoImpl(s *SessionData, includeNetwork bool) (map[string]interface{}, error) {
	if s.WSLDistro == "" {
		return nil, fmt.Errorf("system info not available for Windows-native local sessions")
	}

	// Run the probe script inline inside WSL — no file deployment needed.
	// Ensure LF line endings to avoid CRLF issues when passing to sh.
	script := strings.ReplaceAll(dynamicProbeScript, "\r\n", "\n")
	probeArg := ""
	if includeNetwork {
		probeArg = " network"
	}
	// Pass script as a single sh -c argument; append the optional probe argument.
	fullScript := script + probeArg
	cmd := exec.Command("wsl.exe", "-d", s.WSLDistro, "--", "sh", "-c", fullScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("probe exec in WSL %q: %w", s.WSLDistro, err)
	}
	return parseProbeOutput(string(out), includeNetwork)
}

// getLocalFullProcessListImpl queries the full process list for local Windows sessions.
// For WSL distros it runs ps; Windows-native is currently not supported.
func getLocalFullProcessListImpl(s *SessionData) ([]map[string]interface{}, error) {
	if s.WSLDistro == "" {
		return nil, fmt.Errorf("process list not supported for Windows native sessions")
	}
	cmd := exec.Command("wsl.exe", "-d", s.WSLDistro, "--", "sh", "-c", "ps -eo pid,pcpu,rss,user,comm,stat,nlwp,etime,args --sort=-pcpu 2>/dev/null")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ps exec in WSL %q: %w", s.WSLDistro, err)
	}
	return parseFullProcessListOutput(string(out))
}

// getLocalServerStaticInfoImpl retrieves static host info for Windows/WSL sessions.
func getLocalServerStaticInfoImpl(s *SessionData) (map[string]interface{}, error) {
	if s.WSLDistro == "" {
		// Native Windows fallback
		return map[string]interface{}{
			"os":       "Windows Host",
			"timezone": "Local Time",
			"ip":       "127.0.0.1",
			"cpu": map[string]interface{}{
				"model": "Windows Host Processor",
			},
		}, nil
	}

	// WSL: query details via wsl.exe
	script := `echo ---OS---
grep PRETTY_NAME /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/issue 2>/dev/null | head -1 || uname -s -r
echo ---TZ---
timedatectl show -p Timezone --value 2>/dev/null || readlink -f /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || cat /etc/timezone 2>/dev/null || date +'%z'
echo ---CPUINFO---
grep 'model name' /proc/cpuinfo | head -1
echo ---IP---
ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' || hostname -I 2>/dev/null | awk '{print $1}'`

	script = strings.ReplaceAll(script, "\r\n", "\n")
	cmd := exec.Command("wsl.exe", "-d", s.WSLDistro, "--", "sh", "-c", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("WSL static info exec: %w", err)
	}
	return parseServerStaticInfoOutput(string(out))
}

// localKillProcess kills a process in WSL or Windows native.
func localKillProcess(s *SessionData, pid string) error {
	if s.WSLDistro != "" {
		cmd := exec.Command("wsl.exe", "-d", s.WSLDistro, "--", "kill", "-9", pid)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		return cmd.Run()
	}
	cmd := exec.Command("taskkill", "/F", "/PID", pid)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

// localGetProcessEnv retrieves env vars for a process in WSL or Windows native.
func localGetProcessEnv(s *SessionData, pid string) ([]string, error) {
	if s.WSLDistro == "" {
		return nil, fmt.Errorf("process env not supported on Windows native sessions")
	}
	cmd := exec.Command("wsl.exe", "-d", s.WSLDistro, "--", "sh", "-c", "cat /proc/"+pid+"/environ 2>/dev/null | tr '\\0' '\\n'")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	var result []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			result = append(result, l)
		}
	}
	return result, nil
}
