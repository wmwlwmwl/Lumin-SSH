package sshmanager

// /proc 直读的进程采样解析。探针脚本与 GetFullProcessList 的 BusyBox 路径
// 都输出原始 /proc/[pid]/stat 行,由本文件负责字段提取与 CPU% 计算,
// 不依赖 procps-ng 的 ps(OpenWrt/BusyBox 开箱即用)。

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

// procStatSample 单个进程一次采样的解析结果。
type procStatSample struct {
	Pid     string
	Comm    string
	State   string
	Utime   uint64
	Stime   uint64
	Start   uint64 // starttime(ticks since boot),完整进程列表的 etime 换算用;两次采样比对可识别 PID 复用
	Rss     uint64 // 内存页数(×4KiB 得 KB;按 OpenWrt 目标平台 4KiB 页内核计,16KiB 页内核需另行适配)
	Threads uint64
	Uid     string
	Cmd     string
}

// parseProcStatLine 解析 /proc/[pid]/stat 原始行:
//
//	pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt
//	utime stime cutime cstime priority nice num_threads itrealvalue starttime vsize rss ...
//
// comm 可能含空格与括号,不能按空白切分;以「最后一个 ) 之后」为其余字段的锚点,
// 括号内为 comm,括号前为 pid。
func parseProcStatLine(line string) (procStatSample, bool) {
	closeIdx := strings.LastIndex(line, ")")
	if closeIdx < 0 {
		return procStatSample{}, false
	}
	head := strings.TrimSpace(line[:closeIdx])
	openIdx := strings.Index(head, "(")
	if openIdx < 0 {
		return procStatSample{}, false
	}
	s := procStatSample{
		Pid:  strings.TrimSpace(head[:openIdx]),
		Comm: strings.TrimSpace(head[openIdx+1:]),
	}
	if s.Pid == "" || s.Comm == "" {
		return procStatSample{}, false
	}
	// 锚点后的字段(1-based 对应 /proc/pid/stat): 1 state, 12 utime, 13 stime, 20 starttime, 22 rss
	tail := strings.Fields(line[closeIdx+2:])
	if len(tail) < 22 {
		return procStatSample{}, false
	}
	s.State = tail[0]
	s.Utime, _ = strconv.ParseUint(tail[11], 10, 64)
	s.Stime, _ = strconv.ParseUint(tail[12], 10, 64)
	s.Start, _ = strconv.ParseUint(tail[19], 10, 64)
	s.Rss, _ = strconv.ParseUint(tail[21], 10, 64)
	return s, true
}

// procSection 一次采集:首行为 date +%s 时间戳,其余行为 stat 原始行。
type procSection struct {
	ts      float64
	samples []procStatSample
}

// parseProcSection 解析一个 PROC section(lines 首行为时间戳)。
func parseProcSection(lines []string) (procSection, bool) {
	if len(lines) < 1 {
		return procSection{}, false
	}
	ts, err := strconv.ParseFloat(strings.TrimSpace(lines[0]), 64)
	if err != nil {
		return procSection{}, false
	}
	sec := procSection{ts: ts}
	for _, l := range lines[1:] {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if sample, ok := parseProcStatLine(l); ok {
			sec.samples = append(sec.samples, sample)
		}
	}
	return sec, true
}

// parseProbeProcSections 将探针 PROC1/PROC2 两个采样配成进程列表:
// cpu% = (Δutime+Δstime) / Δ秒(CLK_TCK=100,即每秒 100 tick,满核=100%)。
// 只出现在单侧采样的进程(采样窗口内创建/退出)直接丢弃;按 CPU 降序取前 6,
// 与旧版 `ps ... | head -6` 行为一致。
func parseProbeProcSections(proc1Lines, proc2Lines []string) ([]map[string]interface{}, error) {
	sec1, ok1 := parseProcSection(proc1Lines)
	sec2, ok2 := parseProcSection(proc2Lines)
	if !ok1 || !ok2 {
		return nil, fmt.Errorf("invalid PROC sections")
	}
	elapsed := sec2.ts - sec1.ts
	if elapsed <= 0 {
		elapsed = 1
	}
	first := make(map[string]procStatSample, len(sec1.samples))
	for _, p := range sec1.samples {
		first[p.Pid] = p
	}
	procs := make([]map[string]interface{}, 0, len(sec2.samples))
	for _, p2 := range sec2.samples {
		p1, ok := first[p2.Pid]
		if !ok || p1.Start != p2.Start {
			continue // 单侧缺失(窗口内创建/退出)或 PID 复用(starttime 变化),delta 无意义
		}
		ticks := int64(p2.Utime+p2.Stime) - int64(p1.Utime+p1.Stime)
		cpu := float64(ticks) / elapsed
		if cpu < 0 {
			cpu = 0
		}
		procs = append(procs, map[string]interface{}{
			"pid": p2.Pid,
			"cpu": cpu,
			"mem": float64(p2.Rss) * 4.0 / 1024.0, // 页→MB
			"cmd": p2.Comm,
		})
	}
	sort.Slice(procs, func(i, j int) bool {
		return procs[i]["cpu"].(float64) > procs[j]["cpu"].(float64)
	})
	if len(procs) > 6 {
		procs = procs[:6]
	}
	return procs, nil
}

// ─── 远端能力探测(BusyBox / OpenWrt) ─────────────────────────────

const (
	featureBusybox = "busybox"
	featureOpenWrt = "openwrt"
)

// remoteFeatureProbeCmd 探测远端是否为 BusyBox / OpenWrt。
// busybox 的 `ps --help` 输出含 "BusyBox v..." 字样,与 procps 区分;
// 裸 busybox 自述头回退仅在 ps 缺失时启用(个别精简固件没编入 ps applet)——
// 常规 Linux 常见 busybox-static 救援安装,若 ps 是 procps 却因存在 busybox
// 二进制误判,会把进程列表永久切到 /proc 慢路径,违反「常规 Linux 不变」;
// /etc/openwrt_release 是 OpenWrt 专属文件,比解析 os-release 更可靠。
// 末尾 true 保证命令总以 0 退出:「未匹配」是合法的探测结果(记为否),
// 必须缓存——否则常规 Linux 上每次轮询都会重跑探测,而且 BUSYBOX=1 的
// 输出会随最后一个测试的非零退出码被当作失败丢弃。
const remoteFeatureProbeCmd = `ps --help 2>&1 | grep -qi busybox && echo BUSYBOX=1
command -v ps >/dev/null 2>&1 || { command -v busybox >/dev/null 2>&1 && busybox 2>&1 | grep -qi busybox && echo BUSYBOX=1; }
[ -f /etc/openwrt_release ] && echo OPENWRT=1
true`

// parseRemoteFeatureProbeOutput 解析探测输出,出现的特性记 1,未出现的不记
// (由 ensureRemoteFeatures 对未出现项补记为「否」)。独立成函数便于单测。
func parseRemoteFeatureProbeOutput(out string) map[string]int {
	parsed := map[string]int{}
	for _, l := range strings.Split(out, "\n") {
		switch strings.TrimSpace(l) {
		case "BUSYBOX=1":
			parsed[featureBusybox] = 1
		case "OPENWRT=1":
			parsed[featureOpenWrt] = 1
		}
	}
	return parsed
}

// ensureRemoteFeatures 探测并缓存远端能力(connKey -> feature -> 1 是 / -1 否)。
// 探测命令成功执行(exit 0)后未输出的特性记为「否」并缓存;传输层失败才不
// 缓存、下次调用重试,且不阻塞主流程(调用方拿到「否」也只影响是否走兼容路径)。
func (m *SSHManager) ensureRemoteFeatures(client *ssh.Client, connKey string) {
	m.mu.RLock()
	flags, ok := m.remoteFeatures[connKey]
	needProbe := !ok || flags[featureBusybox] == 0 || flags[featureOpenWrt] == 0
	m.mu.RUnlock()
	if !needProbe {
		return
	}

	out, err := m.executeCmdWithClient(client, remoteFeatureProbeCmd)
	parsed := map[string]int{}
	if err == nil {
		parsed = parseRemoteFeatureProbeOutput(out)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	flags = m.remoteFeatures[connKey]
	if flags == nil {
		flags = map[string]int{}
		m.remoteFeatures[connKey] = flags
	}
	if err != nil {
		return // 探测失败:保持未知,下次重试
	}
	for _, f := range []string{featureBusybox, featureOpenWrt} {
		if _, has := parsed[f]; !has {
			parsed[f] = -1
		}
	}
	for k, v := range parsed {
		flags[k] = v
	}
}

// remoteFeatureIs 返回 connKey 连接的某能力是否为真;未探测时先探测。
func (m *SSHManager) remoteFeatureIs(client *ssh.Client, connKey, feature string) bool {
	m.ensureRemoteFeatures(client, connKey)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.remoteFeatures[connKey][feature] == 1
}

// ─── 完整进程列表的 /proc 路径(BusyBox 无 procps ps 时使用) ────────

// fullProcListScript 双采样 /proc 生成完整进程列表。
// 每个进程一行,以 \x1f 分隔:pid|stat原始行|线程数|uid|cmdline。
// stat 原始行透传给 Go 解析(comm 可能含空格/括号,shell 解析不可靠);
// uid→用户名映射由 Go 端用 ---PASSWD--- 段完成。
// 性能:stat/status 用 read 内建读取,不逐 PID fork awk/cat(低配路由器上
// 1200 次 fork/exec 会把一次刷新拖到数秒);cmdline 保留一次 tr(read 处理
// 不了 NUL),且把换行一并转空格——运行本脚本的 sh 自身会被采样,其 argv
// 含整段脚本(多行+内嵌 marker),多行记录会破坏「一行一进程」的解析契约。
// 时间戳用 /proc/uptime 浮点值:date +%s 整秒截断会让被拖长的采样窗口
// 把 CPU% 放大近一倍。
const fullProcListScript = `cat /proc/uptime
echo ---PASSWD---
cut -d: -f1,3 /etc/passwd 2>/dev/null
echo ---PROCS1---
cut -d' ' -f1 /proc/uptime
sample() {
  for f in /proc/[0-9]*/stat; do
    [ -r "$f" ] || continue
    pid=${f#/proc/}; pid=${pid%/stat}
    IFS= read -r s < "$f" || continue
    threads=; uid=
    while read -r k v rest; do
      [ "$k" = "Threads:" ] && threads=$v
      [ "$k" = "Uid:" ] && uid=$v
    done < /proc/$pid/status
    cmd=$(tr '\0\n' '  ' < /proc/$pid/cmdline 2>/dev/null)
    printf '%s\037%s\037%s\037%s\037%s\n' "$pid" "$s" "$threads" "$uid" "$cmd"
  done
}
sample
sleep 1
echo ---PROCS2---
cut -d' ' -f1 /proc/uptime
sample
echo ---DONE---
`

// parseFullProcSection 解析完整进程列表的一个采样 section(首行为时间戳)。
func parseFullProcSection(lines []string) (procSection, bool) {
	if len(lines) < 1 {
		return procSection{}, false
	}
	ts, err := strconv.ParseFloat(strings.TrimSpace(lines[0]), 64)
	if err != nil {
		return procSection{}, false
	}
	sec := procSection{ts: ts}
	for _, l := range lines[1:] {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		parts := strings.Split(l, "\x1f")
		if len(parts) != 5 {
			continue
		}
		stat, ok := parseProcStatLine(parts[1])
		if !ok {
			continue
		}
		stat.Pid = parts[0]
		stat.Threads, _ = strconv.ParseUint(parts[2], 10, 64)
		stat.Uid = parts[3]
		stat.Cmd = strings.TrimSpace(parts[4])
		sec.samples = append(sec.samples, stat)
	}
	return sec, true
}

// parseFullProcListOutput 解析 fullProcListScript 输出,字段结构与
// parseFullProcessListOutput(procps ps 路径)保持一致,前端无需区分来源。
func parseFullProcListOutput(out string) ([]map[string]interface{}, error) {
	lines := strings.Split(strings.TrimSpace(out), "\n")

	uptime := 0.0
	if len(lines) > 0 {
		fmt.Sscanf(strings.TrimSpace(lines[0]), "%f", &uptime)
	}

	passwd := map[string]string{}
	for _, l := range extractSectionExact(lines, "---PASSWD---", "---PROCS1---") {
		parts := strings.SplitN(l, ":", 2)
		if len(parts) == 2 {
			passwd[parts[1]] = parts[0]
		}
	}

	// 记录行携带任意 cmdline,可能内嵌 marker 子串,必须整行精确匹配提取
	sec1, ok1 := parseFullProcSection(extractSectionExact(lines, "---PROCS1---", "---PROCS2---"))
	sec2, ok2 := parseFullProcSection(extractSectionExact(lines, "---PROCS2---", "---DONE---"))
	if !ok1 || !ok2 {
		return nil, fmt.Errorf("invalid PROC sections")
	}
	elapsed := sec2.ts - sec1.ts
	if elapsed <= 0 {
		elapsed = 1
	}

	first := make(map[string]procStatSample, len(sec1.samples))
	for _, p := range sec1.samples {
		first[p.Pid] = p
	}
	procs := make([]map[string]interface{}, 0, len(sec2.samples))
	for _, p2 := range sec2.samples {
		p1, ok := first[p2.Pid]
		if !ok || p1.Start != p2.Start {
			continue // 采样窗口内创建/退出,或 PID 已被复用(starttime 变化),无 CPU delta,丢弃
		}
		ticks := int64(p2.Utime+p2.Stime) - int64(p1.Utime+p1.Stime)
		cpu := float64(ticks) / elapsed
		if cpu < 0 {
			cpu = 0
		}
		cmd := p2.Cmd
		if cmd == "" {
			cmd = p2.Comm // 内核线程无 cmdline,回退 comm
		}
		user := p2.Uid
		if name, ok := passwd[p2.Uid]; ok && name != "" {
			user = name
		}
		loc := cmd
		if idx := strings.Index(cmd, " "); idx > 0 {
			loc = cmd[:idx]
		}
		procs = append(procs, map[string]interface{}{
			"pid":   p2.Pid,
			"cpu":   cpu,
			"mem":   float64(p2.Rss) * 4.0 / 1024.0, // 页→MB
			"user":  user,
			"name":  p2.Comm,
			"cmd":   cmd,
			"loc":   loc,
			"stat":  p2.State,
			"nlwp":  p2.Threads,
			"etime": formatProcEtime(uptime - float64(p2.Start)/100.0),
		})
	}
	sort.Slice(procs, func(i, j int) bool {
		return procs[i]["cpu"].(float64) > procs[j]["cpu"].(float64)
	})
	return procs, nil
}

// formatProcEtime 把秒数格式化为 procps 风格的 etime("MM:SS"/"H:MM:SS"/"D-HH:MM:SS")。
func formatProcEtime(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	s := int(seconds)
	days := s / 86400
	hours := (s % 86400) / 3600
	mins := (s % 3600) / 60
	secs := s % 60
	if days > 0 {
		return fmt.Sprintf("%d-%02d:%02d:%02d", days, hours, mins, secs)
	}
	if hours > 0 {
		return fmt.Sprintf("%d:%02d:%02d", hours, mins, secs)
	}
	return fmt.Sprintf("%02d:%02d", mins, secs)
}
