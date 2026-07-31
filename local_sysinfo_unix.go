//go:build !windows
// +build !windows

package main

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// getLocalSystemInfoImpl runs the dynamic probe script locally on macOS or Linux.
// The script is written to a temp file and run via `sh <file> network` (not
// `sh -c "<script> network"`), so the "network" flag reaches the script as $1 —
// argv after a script file is positional, whereas `$1` is always empty under
// `sh -c` with no trailing argv.
func getLocalSystemInfoImpl(s *SessionData, includeNetwork bool) (map[string]interface{}, error) {
	scriptPath, cleanup, err := deployLocalProbeScript()
	if err != nil {
		return nil, fmt.Errorf("deploy probe script: %w", err)
	}
	defer cleanup()

	args := []string{scriptPath}
	if includeNetwork {
		args = append(args, "network")
	}
	out, err := exec.Command("sh", args...).Output()
	if err != nil {
		return nil, fmt.Errorf("local probe exec: %w", err)
	}
	return parseProbeOutput(string(out), includeNetwork)
}

// getLocalFullProcessListImpl queries the full process list for local Unix sessions.
func getLocalFullProcessListImpl(s *SessionData) ([]map[string]interface{}, error) {
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.Command("ps", "-eo", "pid,pcpu,rss,user,comm,state,etime,command", "-r")
	} else {
		cmd = exec.Command("sh", "-c", "ps -eo pid,pcpu,rss,user,comm,stat,nlwp,etime,args --sort=-pcpu 2>/dev/null")
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ps exec: %w", err)
	}
	if runtime.GOOS == "darwin" {
		return parseMacProcessListOutput(string(out))
	}
	return parseFullProcessListOutput(string(out))
}

// parseMacProcessListOutput parses macOS ps output format into structured maps.
func parseMacProcessListOutput(out string) ([]map[string]interface{}, error) {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	var processes []map[string]interface{}
	for _, l := range lines {
		fields := strings.Fields(l)
		if len(fields) < 8 {
			continue
		}
		if fields[0] == "PID" {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[1], 64)
		rss, _ := strconv.ParseUint(fields[2], 10, 64)
		
		name := fields[4]
		stat := fields[5]
		etime := fields[6]
		args := strings.Join(fields[7:], " ")
		
		var loc string
		if idx := strings.Index(args, " "); idx > 0 {
			loc = args[:idx]
		} else {
			loc = args
		}
		
		processes = append(processes, map[string]interface{}{
			"pid":   fields[0],
			"cpu":   cpu,
			"mem":   float64(rss) / 1024.0,
			"user":  fields[3],
			"name":  name,
			"cmd":   args,
			"loc":   loc,
			"stat":  stat,
			"nlwp":  1, // default fallback
			"etime": etime,
		})
	}
	return processes, nil
}

// getLocalServerStaticInfoImpl retrieves static host info for local Unix sessions.
func getLocalServerStaticInfoImpl(s *SessionData) (map[string]interface{}, error) {
	script := `echo ---OS---
grep PRETTY_NAME /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/issue 2>/dev/null | head -1 || uname -s -r
echo ---TZ---
timedatectl show -p Timezone --value 2>/dev/null || readlink -f /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || cat /etc/timezone 2>/dev/null || date +'%z'
echo ---CPUINFO---
sysctl -n machdep.cpu.brand_string 2>/dev/null || grep 'model name' /proc/cpuinfo | head -1
echo ---IP---
ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' || route -n get 1.1.1.1 2>/dev/null | grep interface | awk '{print $2}' | xargs ipconfig getifaddr 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'`

	out, err := exec.Command("sh", "-c", script).Output()
	if err != nil {
		return nil, fmt.Errorf("local static info exec: %w", err)
	}
	return parseServerStaticInfoOutput(string(out))
}

// localKillProcess kills a local process.
func localKillProcess(s *SessionData, pid string) error {
	return exec.Command("kill", "-9", pid).Run()
}

// localGetProcessEnv retrieves env vars for a local Unix process.
func localGetProcessEnv(s *SessionData, pid string) ([]string, error) {
	out, err := exec.Command("sh", "-c", "cat /proc/"+pid+"/environ 2>/dev/null | tr '\\0' '\\n'").Output()
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
