package sshmanager

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// statLine 构造 /proc/[pid]/stat 行:pid 与 comm 之外共 23 个数字字段。
func statLine(pid int, comm string, utime, stime, starttime, rss uint64) string {
	return strings.Join([]string{
		strconv.Itoa(pid), "(" + comm + ")", "S", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
		strconv.FormatUint(utime, 10), strconv.FormatUint(stime, 10), "13", "14", "15", "16", "17", "18", strconv.FormatUint(starttime, 10), "20",
		strconv.FormatUint(rss, 10), "22", "23", "24",
	}, " ")
}

func TestParseProcStatLineBasic(t *testing.T) {
	// 123 (sshd) S 1 ... utime=100 stime=50 ... starttime=1800 ... rss=256 页
	line := statLine(123, "sshd", 100, 50, 1800, 256)
	s, ok := parseProcStatLine(line)
	if !ok {
		t.Fatal("应解析成功")
	}
	if s.Pid != "123" || s.Comm != "sshd" || s.State != "S" {
		t.Fatalf("pid/comm/state 错误: %+v", s)
	}
	if s.Utime != 100 || s.Stime != 50 || s.Start != 1800 || s.Rss != 256 {
		t.Fatalf("数值字段错误: %+v", s)
	}
}

func TestParseProcStatLineCommWithSpacesAndParens(t *testing.T) {
	// comm 含空格与括号时,以最后一个 ) 为锚点
	line := "456 (foo bar) (baz) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24"
	s, ok := parseProcStatLine(line)
	if !ok {
		t.Fatal("应解析成功")
	}
	if s.Pid != "456" || s.Comm != "foo bar) (baz" {
		t.Fatalf("锚点解析错误: %+v", s)
	}
	if s.Utime != 11 || s.Rss != 21 {
		t.Fatalf("锚点后字段偏移错误: %+v", s)
	}
}

func TestParseProcStatLineTooShort(t *testing.T) {
	if _, ok := parseProcStatLine("123 (sshd) S 1 2"); ok {
		t.Fatal("字段不足应解析失败")
	}
	if _, ok := parseProcStatLine("no parens at all"); ok {
		t.Fatal("无括号应解析失败")
	}
}

func TestParseProbeProcSectionsComputesCPUAndCapsTop6(t *testing.T) {
	// 采样间隔 1s:进程 A 消耗 80 tick(80%),B 消耗 5 tick(5%)。
	// C 只出现在第一次采样,D 只出现在第二次,均应收敛丢弃。
	proc1 := []string{
		"1000",
		statLine(1, "procA", 100, 50, 10, 256),
		statLine(2, "procB", 10, 0, 10, 128),
		statLine(3, "procC", 99, 0, 10, 64),
	}
	proc2 := []string{
		"1001",
		statLine(1, "procA", 160, 70, 10, 256),
		statLine(2, "procB", 15, 0, 10, 128),
		statLine(4, "procD", 5, 0, 10, 32),
	}
	procs, err := parseProbeProcSections(proc1, proc2)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(procs) != 2 {
		t.Fatalf("应只保留双侧采样进程, 得到 %d: %#v", len(procs), procs)
	}
	// 按 cpu 降序: A(80) > B(5)
	if procs[0]["pid"] != "1" || procs[0]["cpu"].(float64) != 80.0 {
		t.Fatalf("procA 应排首位且 cpu=80: %#v", procs[0])
	}
	if procs[1]["pid"] != "2" || procs[1]["cpu"].(float64) != 5.0 {
		t.Fatalf("procB 应排第二且 cpu=5: %#v", procs[1])
	}
	if mem := procs[0]["mem"].(float64); mem != 1.0 {
		t.Fatalf("256 页 ×4KiB = 1MB, 得到 %v", mem)
	}
	if procs[0]["cmd"] != "procA" {
		t.Fatalf("cmd 应为 comm: %v", procs[0]["cmd"])
	}
}

func TestParseProbeProcSectionsTop6CapAndZeroElapsed(t *testing.T) {
	// 时间戳相同(elapsed 回退 1s)+ 超过 6 个进程验证截断
	proc1 := []string{"1000"}
	proc2 := []string{"1000"}
	for i := 1; i <= 8; i++ {
		proc1 = append(proc1, statLine(i, "p"+strconv.Itoa(i), uint64(i), 0, 10, 64))
		proc2 = append(proc2, statLine(i, "p"+strconv.Itoa(i), uint64(i*10), 0, 10, 64))
	}
	procs, err := parseProbeProcSections(proc1, proc2)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(procs) != 6 {
		t.Fatalf("应截断为 6 条, 得到 %d", len(procs))
	}
	// cpu = Δticks/1s = i*9,进程 8 应排首位
	if procs[0]["pid"] != "8" {
		t.Fatalf("cpu 降序排列错误: %#v", procs[0])
	}
}

func TestParseProcSectionInvalid(t *testing.T) {
	if _, ok := parseProcSection([]string{"not-a-number"}); ok {
		t.Fatal("时间戳非法应失败")
	}
	if _, ok := parseProcSection(nil); ok {
		t.Fatal("空 section 应失败")
	}
}

func TestFormatProcEtime(t *testing.T) {
	cases := []struct {
		sec  float64
		want string
	}{
		{0, "00:00"},
		{59, "00:59"},
		{60, "01:00"},
		{3661, "1:01:01"},
		{90061, "1-01:01:01"},
		{-5, "00:00"}, // 负数(时钟回拨)钳制为 0
	}
	for _, c := range cases {
		if got := formatProcEtime(c.sec); got != c.want {
			t.Fatalf("formatProcEtime(%v) = %q, want %q", c.sec, got, c.want)
		}
	}
}

func TestParseFullProcListOutput(t *testing.T) {
	// uptime=10000s;进程 1(sshd, uid 0→root)与 2(内核线程 kworker,无 cmdline)
	out := strings.Join([]string{
		"10000.5 20000",
		"---PASSWD---",
		"root:0",
		"daemon:1",
		"---PROCS1---",
		"1000",
		procFullLine(1, "sshd", 100, 50, 9000, 256, 2, "0", "/usr/sbin/sshd -D"),
		procFullLine(2, "kworker/0:0", 50, 0, 100, 64, 1, "0", ""),
		"---PROCS2---",
		"1001",
		procFullLine(1, "sshd", 160, 70, 9000, 256, 2, "0", "/usr/sbin/sshd -D"),
		procFullLine(2, "kworker/0:0", 55, 0, 100, 64, 1, "0", ""),
		"---DONE---",
	}, "\n")

	procs, err := parseFullProcListOutput(out)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(procs) != 2 {
		t.Fatalf("应有 2 个进程, 得到 %d", len(procs))
	}
	p1 := procs[0]
	if p1["pid"] != "1" || p1["cpu"].(float64) != 80.0 {
		t.Fatalf("sshd cpu=80 且排首位: %#v", p1)
	}
	if p1["user"] != "root" || p1["name"] != "sshd" || p1["stat"] != "S" {
		t.Fatalf("user/name/stat 错误: %#v", p1)
	}
	if p1["nlwp"].(uint64) != 2 || p1["mem"].(float64) != 1.0 {
		t.Fatalf("nlwp/mem 错误: %#v", p1)
	}
	if p1["cmd"] != "/usr/sbin/sshd -D" || p1["loc"] != "/usr/sbin/sshd" {
		t.Fatalf("cmd/loc 错误: %#v", p1)
	}
	// etime = 10000 - 9000/100 = 9910s = 2:45:10
	if p1["etime"] != "2:45:10" {
		t.Fatalf("etime 换算错误: %v", p1["etime"])
	}
	// 内核线程:cmd 回退 comm
	p2 := procs[1]
	if p2["cmd"] != "kworker/0:0" || p2["loc"] != "kworker/0:0" {
		t.Fatalf("内核线程 cmd 应回退 comm: %#v", p2)
	}
	if p2["user"] != "root" {
		t.Fatalf("kworker 用户应为 root: %#v", p2)
	}
	// cpu = (55-50)/1 = 5,排在 sshd 之后
	if procs[1]["pid"] != "2" || procs[1]["cpu"].(float64) != 5.0 {
		t.Fatalf("排序错误: %#v", procs)
	}
}

func TestParseFullProcListOutputMalformedLines(t *testing.T) {
	out := strings.Join([]string{
		"10000",
		"---PASSWD---",
		"bad-line-without-colon",
		"root:0",
		"---PROCS1---",
		"1000",
		"1\x1fnot-a-stat-line\x1f1\x1f0\x1f/cmd",   // stat 行非法 → 跳过
		"2\x1fwrong-field-count",                    // 字段数不足 → 跳过
		"---PROCS2---",
		"1001",
		"1\x1fnot-a-stat-line\x1f1\x1f0\x1f/cmd",
		"---DONE---",
	}, "\n")
	procs, err := parseFullProcListOutput(out)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(procs) != 0 {
		t.Fatalf("非法行应全部跳过: %#v", procs)
	}
}

// procFullLine 构造完整进程列表的一行记录(pid|stat|threads|uid|cmd)。
func procFullLine(pid int, comm string, utime, stime, starttime, rss, threads uint64, uid, cmd string) string {
	return strings.Join([]string{
		strconv.Itoa(pid),
		statLine(pid, comm, utime, stime, starttime, rss),
		strconv.FormatUint(threads, 10),
		uid,
		cmd,
	}, "\x1f")
}

func TestProbeDeployCmdHeredocStructure(t *testing.T) {
	cmd := probeDeployCmd()
	for _, want := range []string{
		"tee ~/.lumin/probe.sh /tmp/.lumin/probe.sh >/dev/null <<'LUMIN_EOF'",
		"---PROC1---",
		"---PROC2---",
		"[ -f ~/.lumin/probe.sh ] || [ -f /tmp/.lumin/probe.sh ]",
	} {
		if !strings.Contains(cmd, want) {
			t.Fatalf("部署命令缺少 %q", want)
		}
	}
	if strings.Contains(cmd, "---PROC---\n") {
		t.Fatal("部署命令不应再包含旧 ps 进程段")
	}
	if strings.Contains(dynamicProbeScript, "LUMIN_EOF") {
		t.Fatal("探针脚本内容不能包含 heredoc 定界符 LUMIN_EOF,否则部署截断")
	}
}

func TestParseRemoteFeatureProbeOutput(t *testing.T) {
	got := parseRemoteFeatureProbeOutput("BUSYBOX=1\nOPENWRT=1\n")
	if got[featureBusybox] != 1 || got[featureOpenWrt] != 1 {
		t.Fatalf("双命中解析错误: %#v", got)
	}
	if len(got) != 2 {
		t.Fatalf("不应有额外字段: %#v", got)
	}

	got = parseRemoteFeatureProbeOutput("  BUSYBOX=1  \ngarbage line\nBUSYBOX=1\n")
	if got[featureBusybox] != 1 {
		t.Fatalf("BUSYBOX 命中解析错误: %#v", got)
	}
	if _, has := got[featureOpenWrt]; has {
		t.Fatalf("未命中特性不应出现: %#v", got)
	}

	if got := parseRemoteFeatureProbeOutput(""); len(got) != 0 {
		t.Fatalf("空输出应为空 map: %#v", got)
	}
}

// 探测命令必须以 0 退出:常规 Linux 上「未匹配」是合法结果,必须能被
// ensureRemoteFeatures 缓存为「否」——历史上探测命令最后一行测试失败会
// 以非零退出,导致每次轮询都重跑探测,且 BUSYBOX=1 输出被当作失败丢弃。
func TestRemoteFeatureProbeCmdExitsZeroUnderPOSIXShell(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no POSIX sh available")
	}
	out, err := exec.Command(sh, "-c", remoteFeatureProbeCmd).CombinedOutput()
	if err != nil {
		t.Fatalf("探测命令应以 0 退出, 得到 %v, 输出: %s", err, out)
	}
	parsed := parseRemoteFeatureProbeOutput(string(out))
	for k := range parsed {
		if k != featureBusybox && k != featureOpenWrt {
			t.Fatalf("探测输出含意外标记 %q: %s", k, out)
		}
	}
}

// runFeatureProbeWithStubs 在受限 PATH(仅含给定 stub)下经真实 sh 执行探测命令,
// 用于验证探测命令对 ps/busybox 存在性组合的判定。stub 为文件名→脚本内容。
func runFeatureProbeWithStubs(t *testing.T, stubs map[string]string) string {
	t.Helper()
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no POSIX sh available")
	}
	dir := "/tmp/lumin-probe-stub-" + strings.ReplaceAll(t.Name(), "/", "_")
	parts := []string{"mkdir -p " + dir}
	for name, body := range stubs {
		parts = append(parts, fmt.Sprintf("printf '%s' > %s/%s && chmod 755 %s/%s", body, dir, name, dir, name))
	}
	if out, err := exec.Command(sh, "-c", strings.Join(parts, " && ")).CombinedOutput(); err != nil {
		t.Fatalf("stub 创建失败: %v, 输出: %s", err, out)
	}
	t.Cleanup(func() { exec.Command(sh, "-c", "rm -rf "+dir).Run() })
	out, err := exec.Command(sh, "-c", "PATH="+dir+"; export PATH; "+remoteFeatureProbeCmd).CombinedOutput()
	if err != nil {
		t.Fatalf("探测命令应以 0 退出, 得到 %v, 输出: %s", err, out)
	}
	return string(out)
}

// 常规 Linux 装了 busybox-static(rescue shell 常见)时,ps 仍是 procps,
// 不得因存在 busybox 二进制就误判为 BusyBox——否则永久走 /proc 慢路径,
// 违反「常规 Linux 保持 ps 路径不变」的设计约束。
func TestRemoteFeatureProbeCmdNoBusyboxFalsePositiveWhenProcpsPresent(t *testing.T) {
	out := runFeatureProbeWithStubs(t, map[string]string{
		"ps":      "#!/bin/sh\necho \"Usage: ps [options]\"\n",
		"busybox": "#!/bin/sh\necho \"BusyBox v1.36.0 multi-call binary\"\n",
		"grep":    "#!/bin/sh\nexec /bin/grep \"$@\"\n",
	})
	if parseRemoteFeatureProbeOutput(out)[featureBusybox] == 1 {
		t.Fatalf("procps ps + busybox 共存时不得判为 BusyBox, 输出: %s", out)
	}
}

// 个别精简固件没编入 ps applet:此时才允许用裸 busybox 自述头回退检测。
func TestRemoteFeatureProbeCmdFallsBackToBareBusyboxWhenPsAbsent(t *testing.T) {
	out := runFeatureProbeWithStubs(t, map[string]string{
		"busybox": "#!/bin/sh\necho \"BusyBox v1.36.0 multi-call binary\"\n",
		"grep":    "#!/bin/sh\nexec /bin/grep \"$@\"\n",
	})
	if parseRemoteFeatureProbeOutput(out)[featureBusybox] != 1 {
		t.Fatalf("ps 缺失时应回退 busybox 自述头检测, 输出: %s", out)
	}
}

// BusyBox 自带的 ps --help 含 "BusyBox v" 字样,仍必须走首行命中。
func TestRemoteFeatureProbeCmdDetectsBusyboxPs(t *testing.T) {
	out := runFeatureProbeWithStubs(t, map[string]string{
		"ps":   "#!/bin/sh\necho \"BusyBox v1.36.0 ps usage\"\n",
		"grep": "#!/bin/sh\nexec /bin/grep \"$@\"\n",
	})
	if parseRemoteFeatureProbeOutput(out)[featureBusybox] != 1 {
		t.Fatalf("BusyBox ps 应命中, 输出: %s", out)
	}
}

// 探针 PROC 段必须「单条批量 cat + /proc/uptime 浮点时间戳」:
// 逐 PID fork cat 在低配路由器上一次采样要 fork 数百次;date +%s 整秒截断
// 会让被 fork 拖长的采样窗口把 CPU% 放大近一倍。非 Linux(无 /proc/uptime)
// 回退 date +%s 保持旧行为。
func TestDynamicProbeScriptProcSamplingForkLean(t *testing.T) {
	for _, marker := range []string{"---PROC1---", "---PROC2---"} {
		want := marker + "\ncut -d' ' -f1 /proc/uptime 2>/dev/null || date +%s\ncat /proc/[0-9]*/stat 2>/dev/null\n"
		if !strings.Contains(dynamicProbeScript, want) {
			t.Fatalf("%s 段应为 uptime 时间戳 + 单条批量 cat, 实际:\n%s", marker, dynamicProbeScript)
		}
	}
	if strings.Contains(dynamicProbeScript, "for f in /proc/[0-9]*/stat") {
		t.Fatal("PROC 段不得逐 PID fork cat")
	}
}

// sample() 的 stat/status 读取必须是纯 shell 内建(read),不得逐 PID fork
// awk/cat——低配路由器上 150 进程 × 2 采样 ≈ 1200 次 fork/exec,逼近超时。
// cmdline 的 NUL→空格转换保留一次 tr(read 无法处理 NUL)。
func TestFullProcListScriptForkLean(t *testing.T) {
	if strings.Contains(fullProcListScript, "awk") {
		t.Fatal("sample() 不得调用 awk:每 PID 2 次 fork 在低配路由器上不可接受")
	}
	if strings.Contains(fullProcListScript, "$(cat ") {
		t.Fatal("stat 读取应用 read 内建, 不得用 $(cat)")
	}
	for _, want := range []string{
		"IFS= read -r s",
		"while read -r k v rest",
		"tr '\\0\\n' '  '",
		"cut -d' ' -f1 /proc/uptime",
	} {
		if !strings.Contains(fullProcListScript, want) {
			t.Fatalf("sample() 缺少 %q, 实际:\n%s", want, fullProcListScript)
		}
	}
	if strings.Contains(fullProcListScript, "date +%s") {
		t.Fatal("时间戳应用 /proc/uptime 浮点, 避免整秒截断放大 CPU%")
	}
}

// 在真实 POSIX sh 下端到端执行 sample() 脚本并解析输出,验证语法与管线
// (本机为 MSYS/Cygwin 布局的 /proc,stat 行可解析;status 缺失时 threads/uid
// 为空是预期降级)。生产环境的 BusyBox ash 同为 POSIX 子集。
func TestFullProcListScriptRunsUnderPOSIXSh(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no POSIX sh available")
	}
	out, err := exec.Command(sh, "-c", wrapShCmd(fullProcListScript)).CombinedOutput()
	if err != nil {
		t.Fatalf("脚本执行失败: %v, 输出: %s", err, out)
	}
	procs, err := parseFullProcListOutput(string(out))
	if err != nil {
		t.Fatalf("输出解析失败: %v, 输出: %s", err, out)
	}
	if len(procs) < 1 {
		t.Skipf("本机 /proc 无可解析进程: %s", out)
	}
	for _, k := range []string{"pid", "cpu", "mem", "user", "name", "cmd", "loc", "stat", "nlwp", "etime"} {
		if _, ok := procs[0][k]; !ok {
			t.Fatalf("进程缺字段 %q: %#v", k, procs[0])
		}
	}
}

// PID 复用:采样窗口内旧进程退出、号码被新进程复用(starttime 不同),
// tick delta 无意义,必须丢弃;starttime 一致的正常进程保留。
func TestParseProbeProcSectionsDropsRecycledPids(t *testing.T) {
	proc1 := []string{
		"1000",
		statLine(7, "keep", 10, 0, 100, 64),
		statLine(8, "old", 90, 0, 100, 64),
	}
	proc2 := []string{
		"1001",
		statLine(7, "keep", 20, 0, 100, 64),
		statLine(8, "new", 5, 0, 9900, 64),
	}
	procs, err := parseProbeProcSections(proc1, proc2)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(procs) != 1 || procs[0]["pid"] != "7" {
		t.Fatalf("复用 PID 应丢弃, 只留 pid 7: %#v", procs)
	}
}

func TestParseFullProcListOutputDropsRecycledPids(t *testing.T) {
	out := strings.Join([]string{
		"10000",
		"---PASSWD---",
		"root:0",
		"---PROCS1---",
		"1000",
		procFullLine(7, "keep", 10, 0, 100, 64, 1, "0", "/keep"),
		procFullLine(8, "old", 90, 0, 100, 64, 1, "0", "/old"),
		"---PROCS2---",
		"1001",
		procFullLine(7, "keep", 20, 0, 100, 64, 1, "0", "/keep"),
		procFullLine(8, "new", 5, 0, 9900, 64, 1, "0", "/new"),
		"---DONE---",
	}, "\n")
	procs, err := parseFullProcListOutput(out)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if len(procs) != 1 || procs[0]["pid"] != "7" {
		t.Fatalf("复用 PID 应丢弃, 只留 pid 7: %#v", procs)
	}
}

// 运行命令不得用 &&/|| 串联双路径:tee 双写后 home 与 /tmp 两份都常在,
// home 份非零退出会再跑一遍 /tmp 份——探针双跑、输出拼接、延迟翻倍。
func TestBuildProbeScriptRunCommandNoDoubleRun(t *testing.T) {
	cmd := buildProbeScriptRunCommand(" network")
	if strings.Contains(cmd, "&&") || strings.Contains(cmd, "||") {
		t.Fatalf("不得用 &&/|| 串联双路径: %s", cmd)
	}
	for _, want := range []string{`if [ -f "$f" ]; then`, `sh "$f" network`, `sh /tmp/.lumin/probe.sh network`, "fi"} {
		if !strings.Contains(cmd, want) {
			t.Fatalf("缺少 %q: %s", want, cmd)
		}
	}
}

// GetSFTPClient 等待初始化后对 entry 字段的读取必须发生在 RLock 内:
// 等待超时路径与 initSFTPClient 的写入并发时,锁外读 entry.SFTP 是数据
// 竞态(go test -race 检出)。
func TestGetSFTPClientEntryFieldsReadUnderLock(t *testing.T) {
	m := NewSSHManager()
	entry := &sshClientEntry{SFTPReady: make(chan struct{})}
	close(entry.SFTPReady)
	m.sessions["race-sess"] = &SessionData{ConnKey: "race-key"}
	m.clients["race-key"] = entry

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 500; i++ {
			m.mu.Lock()
			entry.SFTP = nil
			m.mu.Unlock()
		}
	}()
	for i := 0; i < 500; i++ {
		if _, err := m.GetSFTPClient("race-sess"); err == nil {
			t.Fatal("SFTP 为 nil 时应返回错误")
		}
	}
	<-done
}

// cmdline 可能包含换行与 marker 子串(最典型:运行本脚本的 sh,其 argv 就是
// 整段脚本)。脚本端须把换行一并转空格保证记录单行;解析端 marker 必须整行
// 精确匹配,否则 section 被 cmdline 内嵌的 "---PROCS2---" 等子串提前截断。
func TestParseFullProcListOutputToleratesMarkersInCmdline(t *testing.T) {
	// cmd 含 marker 子串但为单行(与修复后的脚本行为一致)
	cmdWithMarker := `sh -c echo ---PROCS2---; echo ---DONE---`
	out := strings.Join([]string{
		"10000",
		"---PASSWD---",
		"root:0",
		"---PROCS1---",
		"1000",
		procFullLine(1, "sh", 10, 0, 100, 64, 1, "0", cmdWithMarker),
		"---PROCS2---",
		"1001",
		procFullLine(1, "sh", 20, 0, 100, 64, 1, "0", cmdWithMarker),
		"---DONE---",
	}, "\n")
	procs, err := parseFullProcListOutput(out)
	if err != nil {
		t.Fatalf("cmdline 含 marker 子串时不应解析失败: %v", err)
	}
	if len(procs) != 1 || procs[0]["pid"] != "1" {
		t.Fatalf("应保留 pid 1, 得到: %#v", procs)
	}
	if procs[0]["cmd"] != cmdWithMarker {
		t.Fatalf("cmd 应原样保留: %#v", procs[0])
	}
}

// BusyBox 路径必须经 wrapShCmd 包 POSIX sh(脚本含函数/参数展开语法,
// fish/csh 登录 shell 下裸发会语法报错);常规 Linux 路径保持原 ps 命令
// 不变(设计 §4.7 的分支路由测试)。
func TestFullProcListCmdRouting(t *testing.T) {
	busy := fullProcListCmdFor(true)
	if !strings.HasPrefix(busy, "sh -c '") || !strings.HasSuffix(busy, "'") {
		t.Fatalf("BusyBox 路径必须包 POSIX sh: %s", busy)
	}
	inner := strings.TrimSuffix(strings.TrimPrefix(busy, "sh -c '"), "'")
	if got := strings.ReplaceAll(inner, `'\''`, "'"); got != fullProcListScript {
		t.Fatal("包裹内容应可完整还原为 fullProcListScript")
	}

	regular := fullProcListCmdFor(false)
	if !strings.Contains(regular, "ps -eo") || strings.Contains(regular, "sh -c") {
		t.Fatalf("常规 Linux 路径应保持原 ps 命令: %s", regular)
	}
}

func TestWrapShCmd(t *testing.T) {
	wrapped := wrapShCmd("echo 'a b'")
	want := `sh -c 'echo '\''a b'\'''`
	if wrapped != want {
		t.Fatalf("转义结果: %q, want %q", wrapped, want)
	}

	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no POSIX sh available")
	}
	// 回环验证:内容含单引号/双引号/多行,经 sh 执行后行为与原命令一致。
	// 这保证 wrapShCmd 的 '\'' 转义不会被外层登录 shell(即使非 bash)误解。
	script := "echo 'quoted' \"double\"\nprintf '%s\\n' 'line2'"
	out, err := exec.Command(sh, "-c", wrapShCmd(script)).CombinedOutput()
	if err != nil {
		t.Fatalf("wrapShCmd 命令执行失败: %v, 输出: %s", err, out)
	}
	if got := string(out); got != "quoted double\nline2\n" {
		t.Fatalf("回环输出不符: %q", got)
	}
}
