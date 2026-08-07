//go:build !windows
// +build !windows

package localsysinfo

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func SystemInfo(session Session, includeNetwork bool, dependencies Dependencies) (map[string]interface{}, error) {
	_ = session
	scriptPath, cleanup, err := deployProbeScript(dependencies.ProbeScript)
	if err != nil {
		return nil, fmt.Errorf("deploy probe script: %w", err)
	}
	defer cleanup()
	args := []string{scriptPath}
	if includeNetwork {
		args = append(args, "network")
	}
	output, err := exec.Command("sh", args...).Output()
	if err != nil {
		return nil, fmt.Errorf("local probe exec: %w", err)
	}
	return dependencies.ParseProbe(string(output), includeNetwork)
}

func FullProcessList(session Session, dependencies Dependencies) ([]map[string]interface{}, error) {
	_ = session
	var command *exec.Cmd
	if runtime.GOOS == "darwin" {
		command = exec.Command("ps", "-eo", "pid,pcpu,rss,user,comm,state,etime,command", "-r")
	} else {
		command = exec.Command("sh", "-c", "ps -eo pid,pcpu,rss,user,comm,stat,nlwp,etime,args --sort=-pcpu 2>/dev/null")
	}
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("ps exec: %w", err)
	}
	if runtime.GOOS == "darwin" {
		return parseMacProcessListOutput(string(output))
	}
	return dependencies.ParseProcessList(string(output))
}

func parseMacProcessListOutput(output string) ([]map[string]interface{}, error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	processes := make([]map[string]interface{}, 0, len(lines))
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 8 || fields[0] == "PID" {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[1], 64)
		rss, _ := strconv.ParseUint(fields[2], 10, 64)
		args := strings.Join(fields[7:], " ")
		location := args
		if index := strings.Index(args, " "); index > 0 {
			location = args[:index]
		}
		processes = append(processes, map[string]interface{}{
			"pid": fields[0], "cpu": cpu, "mem": float64(rss) / 1024.0,
			"user": fields[3], "name": fields[4], "cmd": args, "loc": location,
			"stat": fields[5], "nlwp": 1, "etime": fields[6],
		})
	}
	return processes, nil
}

func StaticInfo(session Session, dependencies Dependencies) (map[string]interface{}, error) {
	_ = session
	script := `echo ---OS---
grep PRETTY_NAME /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/issue 2>/dev/null | head -1 || uname -s -r
echo ---TZ---
timedatectl show -p Timezone --value 2>/dev/null || readlink -f /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || cat /etc/timezone 2>/dev/null || date +'%z'
echo ---CPUINFO---
sysctl -n machdep.cpu.brand_string 2>/dev/null || grep 'model name' /proc/cpuinfo | head -1
echo ---IP---
ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' || route -n get 1.1.1.1 2>/dev/null | grep interface | awk '{print $2}' | xargs ipconfig getifaddr 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'`
	output, err := exec.Command("sh", "-c", script).Output()
	if err != nil {
		return nil, fmt.Errorf("local static info exec: %w", err)
	}
	return dependencies.ParseStaticInfo(string(output))
}

func KillProcess(session Session, pid string) error {
	_ = session
	return exec.Command("kill", "-9", pid).Run()
}

func ProcessEnvironment(session Session, pid string) ([]string, error) {
	_ = session
	output, err := exec.Command("sh", "-c", "cat /proc/"+pid+"/environ 2>/dev/null | tr '\\0' '\\n'").Output()
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
