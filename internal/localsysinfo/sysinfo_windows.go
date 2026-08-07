//go:build windows
// +build windows

package localsysinfo

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func SystemInfo(session Session, includeNetwork bool, dependencies Dependencies) (map[string]interface{}, error) {
	if session.WSLDistro == "" {
		return nil, fmt.Errorf("system info not available for Windows-native local sessions")
	}
	windowsPath, cleanup, err := deployProbeScript(dependencies.ProbeScript)
	if err != nil {
		return nil, fmt.Errorf("deploy probe script: %w", err)
	}
	defer cleanup()
	args := []string{"-d", session.WSLDistro, "--", "sh", windowsPathToWSL(windowsPath)}
	if includeNetwork {
		args = append(args, "network")
	}
	command := exec.Command("wsl.exe", args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("probe exec in WSL %q: %w", session.WSLDistro, err)
	}
	return dependencies.ParseProbe(string(output), includeNetwork)
}

func windowsPathToWSL(path string) string {
	if len(path) >= 2 && path[1] == ':' {
		return "/mnt/" + strings.ToLower(string(path[0])) + filepath.ToSlash(path[2:])
	}
	return filepath.ToSlash(path)
}

func FullProcessList(session Session, dependencies Dependencies) ([]map[string]interface{}, error) {
	if session.WSLDistro == "" {
		return nil, fmt.Errorf("process list not supported for Windows native sessions")
	}
	command := exec.Command("wsl.exe", "-d", session.WSLDistro, "--", "sh", "-c", "ps -eo pid,pcpu,rss,user,comm,stat,nlwp,etime,args --sort=-pcpu 2>/dev/null")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("ps exec in WSL %q: %w", session.WSLDistro, err)
	}
	return dependencies.ParseProcessList(string(output))
}

func StaticInfo(session Session, dependencies Dependencies) (map[string]interface{}, error) {
	if session.WSLDistro == "" {
		return map[string]interface{}{
			"os": "Windows Host", "timezone": "Local Time", "ip": "127.0.0.1",
			"cpu": map[string]interface{}{"model": "Windows Host Processor"},
		}, nil
	}
	script := `echo ---OS---
grep PRETTY_NAME /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/issue 2>/dev/null | head -1 || uname -s -r
echo ---TZ---
timedatectl show -p Timezone --value 2>/dev/null || readlink -f /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || cat /etc/timezone 2>/dev/null || date +'%z'
echo ---CPUINFO---
grep 'model name' /proc/cpuinfo | head -1
echo ---IP---
ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' || hostname -I 2>/dev/null | awk '{print $1}'`
	command := exec.Command("wsl.exe", "-d", session.WSLDistro, "--", "sh", "-c", strings.ReplaceAll(script, "\r\n", "\n"))
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("WSL static info exec: %w", err)
	}
	return dependencies.ParseStaticInfo(string(output))
}

func KillProcess(session Session, pid string) error {
	if session.WSLDistro != "" {
		command := exec.Command("wsl.exe", "-d", session.WSLDistro, "--", "kill", "-9", pid)
		command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		return command.Run()
	}
	command := exec.Command("taskkill", "/F", "/PID", pid)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Run()
}

func ProcessEnvironment(session Session, pid string) ([]string, error) {
	if session.WSLDistro == "" {
		return nil, fmt.Errorf("process env not supported on Windows native sessions")
	}
	command := exec.Command("wsl.exe", "-d", session.WSLDistro, "--", "sh", "-c", "cat /proc/"+pid+"/environ 2>/dev/null | tr '\\0' '\\n'")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.Output()
	if err != nil {
		return nil, err
	}
	return nonEmptyLines(string(output)), nil
}

func nonEmptyLines(output string) []string {
	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}
