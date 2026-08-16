# OpenWrt 支持设计文档

日期：2026-08-14
关联 issue：[wmwlwmwl/Lumin-SSH#204「openwrt 支持」](https://github.com/wmwlwmwl/Lumin-SSH/issues/204)（assignee: bamboostrip）

## 1. 背景与目标

用户 jayck88 在 GL.iNet GL-E5800（OpenWrt + Dropbear）上实测，希望 Lumin 把 OpenWrt 作为正式支持平台。主要诉求：

1. OpenWrt / BusyBox 自动识别
2. 系统监控不依赖 procps-ng-ps（OpenWrt 开箱即用）
3. 进程管理兼容 BusyBox 或直接读 /proc
4. SFTP 缺失时针对 OpenWrt 给出明确、可复制的安装提示（`opkg update && opkg install openssh-sftp-server`），而不是现在只显示 `unexpected EOF`
5. 安装 openssh-sftp-server 后文件管理器正常工作（不重写非 SFTP 文件传输）

## 2. 现状分析（代码勘察结论）

`internal/sshmanager/ssh.go`、`internal/transfer/`、`frontend/src/components/`：

| 功能 | 现状 | OpenWrt 兼容性 |
|---|---|---|
| 系统监控数据源 | 探针脚本 `dynamicProbeScript` 已基本全 /proc 化（uptime/loadavg/meminfo/stat/net/dev/diskstats/df -k），含 `ss`→`netstat` 回退 | ✅ 数据源兼容 |
| 探针脚本部署 | `deployProbeScriptIO` 用 **SFTP** 写 `~/.lumin/probe.sh`（ssh.go:2179-2288） | ❌ **无 sftp-server 时 GetSystemInfo 整体不可用**（先 `GetSFTPClient` 再部署，直接报 "SFTP not available"） |
| 探针进程段 | `ps -eo pid,pcpu,rss,comm --sort=-pcpu \| head -6`（ssh.go:2170） | ❌ procps 专属语法（`-e`/`--sort`），BusyBox ps 不支持 → 进程段为空 |
| 完整进程列表 | `GetFullProcessList`：`ps -eo pid,pcpu,rss,user,comm,stat,nlwp,etime,args --sort=-pcpu`（ssh.go:3067），前端 ProcessPage 每 1-3s 轮询 | ❌ 同上，`nlwp` 字段 BusyBox 也不支持 |
| 杀进程 | `kill -9 <pid>`（ssh.go:3139） | ✅ BusyBox 支持 |
| 进程环境变量 | `cat /proc/<pid>/environ`（ssh.go:3162） | ✅ 已 /proc 化 |
| OS 识别 | `GetServerStaticInfo` 解析 `/etc/os-release` 的 PRETTY_NAME（ssh.go:3201），未缓存、无 OpenWrt 判断 | ⚠️ 有基础但不可复用 |
| SFTP 失败提示 | `initSFTPClient` 失败时 emit `ssh-status {status:"sftp-unavailable"}`，**前端没有任何分支处理**（useSessionConnections.ts:1103 只处理 `post-auth-slow`）；文件管理器 toast 显示 `读取目录失败: SFTP not available: unexpected EOF` | ❌ 无明确提示 |
| 前端提示能力 | `addToast` 已支持 `actions?: ToastAction[]`（{label, onClick}），ProbePanel/App.tsx 已用 | ✅ 可做「复制命令」按钮 |

**关键结论**：
- 系统监控的**数据采集本身**已兼容 BusyBox，真正挡路的是「探针脚本通过 SFTP 部署」和「进程段/进程列表的 ps 语法」。
- 「监控开箱即用」要求探针部署脱离 SFTP（否则没装 sftp-server 时监控整块不可用，与 issue 诉求矛盾）。
- Dropbear 缺省没有 sftp subsystem，`pkg/sftp` 握手时读到通道 EOF，错误串即用户看到的 `unexpected EOF`。

## 3. 方案对比

### Part A：进程列表去 procps 化

- **A1 BusyBox ps 双轨（最小改动）**：检测到 BusyBox 后改用 `ps -o pid,pcpu,rss,user,stat,etime,args`（去掉 `-e`/`--sort`/`nlwp`），排序放 Go 端。
  - 优点：改动最小。
  - 缺点：仍依赖 BusyBox `ps -o` 的字段支持（各版本不一致，`pcpu`/`etime` 在精简版可能缺失）；`pcpu` 是瞬时快照值而非 delta，数值口径与 procps 不同。
- **A2 /proc 直读脚本（推荐）**：进程数据全部从 `/proc/[0-9]*/stat`、`/proc/[0-9]*/status`、`/proc/[0-9]*/cmdline` 读取；CPU% 用两次采样（utime+stime delta）计算。
  - 优点：零外部依赖，任何 Linux 可用（顺带覆盖 Alpine、极简容器）；与探针既有的 /proc 风格一致；字段齐全（nlwp 来自 status 的 `Threads:`，etime 由 stat 的 starttime 与 /proc/uptime 差值换算）。
  - 缺点：CPU% 需要 ~1s 采样窗口；代码量中等。
- **A3 运行时回退链（ps → BusyBox ps → /proc）**：最稳但最重，测试面大，现代发行版都带 procps，回退链的中间层收益低。YAGNI，不采用。

**选择：A2，但分轨**——探针进程段（top 6）统一改为 /proc 双采样（复用探针已有 1s 采样窗口，零额外延迟，所有平台行为统一）；`GetFullProcessList` 仅在检测到 BusyBox 时走 /proc 脚本，常规 Linux 保持现有 ps 路径不变（回归风险最小）。

### Part B：探针部署脱离 SFTP

- **B1 heredoc 经 exec 通道写入（推荐）**：`mkdir -p ~/.lumin /tmp/.lumin; cat > ~/.lumin/probe.sh <<'LUMIN_EOF' ... LUMIN_EOF; chmod 755 ...`，单条 exec 命令完成，替换 `deployProbeScriptIO` 的 SFTP 写入。带引号的 heredoc 防变量展开；现有 `probeDeployed`/`probeFailed` 状态机与 `buildProbeScriptRunCommand` 完全保留。
- **B2 每轮内联执行**：不落盘，每轮把 2-3KB 脚本拼进命令。每 3s 轮询多传几 KB，浪费带宽，且无探针脚本可被 `diagnoseProbeScriptFailure` 诊断。不采用。

**选择：B1。** 这使 `getSystemInfo` 不再依赖 SFTP，OpenWrt 无 sftp-server 时系统监控照常工作（满足「开箱即用」）。

### Part C：OpenWrt 识别与 SFTP 缺失提示

- **检测**：SFTP 初始化失败时探测一次并缓存到连接条目（三态：未知/是/否），命令 `[ -f /etc/openwrt_release ] && echo openwrt`（OpenWrt 专属文件，比解析 PRETTY_NAME 更可靠）。检测到 BusyBox 的复用同一探测。
- **提示**：
  - 后端 `GetSFTPClient` 错误包装：OpenWrt 时返回「检测到 OpenWrt 设备，文件管理器需要 SFTP。请安装：`opkg update && opkg install openssh-sftp-server`（原错误：unexpected EOF）」。
  - 前端 `useSessionConnections` 增加 `sftp-unavailable` 分支；FileManager/连接场景 toast 带「复制命令」action（ToastAction），一键复制安装命令；同时显示在文件管理器顶部提示条。
- 新文案进全部 27 个 locale（`frontend/scripts/check-i18n.mjs` 校验 key 一致性）。

## 4. 设计细节

### 4.1 连接条目新增能力检测

`sshClientEntry`（ssh.go）新增：
```go
// 三态：0 未知 / 1 是 / -1 否；探测一次后缓存，避免每轮重复探测
probeFlags      map[string]int // 如 "busybox"、"openwrt"
probeFlagsMu    sync.Mutex
```
探测命令（幂等、无副作用；末尾 `true` 保证 exit 0——「未匹配」是合法的探测结果，必须能缓存为「否」，否则非 OpenWrt 机器上每次轮询都会重跑探测，且 BUSYBOX=1 的输出会随最后一个测试的非零退出码被当作失败丢弃）：
```sh
ps --help 2>&1 | grep -qi busybox && echo BUSYBOX=1
command -v busybox >/dev/null 2>&1 && busybox 2>&1 | grep -qi busybox && echo BUSYBOX=1
[ -f /etc/openwrt_release ] && echo OPENWRT=1
true
```
触发点：`initSFTPClient` 失败分支（此时只跑一次，缓存结果）；`GetFullProcessList` 首次调用时若 flags 未知也探测。

### 4.2 探针脚本进程段（dynamicProbeScript，ssh.go:2140）

在现有 `---CPU1---` 前插入 `---PROC1---` 采样，`---CPU2---` 后插入 `---PROC2---` 采样（复用既有 sleep 1 窗口），替换 `---PROC---` 的 ps 行。**脚本只做采集，不做 stat 字段解析**——`/proc/[pid]/stat` 的 comm 可能含空格/括号，shell 里解析容易出错，原始行直接透传给 Go，Go 端按「最后一个 `)` 之后是其余字段」的锚点规则解析（可单测）：

```sh
echo ---PROC1---
for f in /proc/[0-9]*/stat; do
  [ -r "$f" ] || continue
  pid=${f#/proc/}; pid=${pid%/stat}
  s=$(cat "$f") || continue
  threads=$(awk '/^Threads:/{print $2}' /proc/$pid/status 2>/dev/null)
  uid=$(awk '/^Uid:/{print $2}' /proc/$pid/status 2>/dev/null)
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null)
  echo "$pid|$s|$threads|$uid|$cmd"
done
```

Go 端解析 `---PROC1---`/`---PROC2---` 两个 section，按 pid 配对：`cpu% = (Δutime+Δstime) / CLK_TCK / elapsed`（elapsed 取 Go 端两次命令执行的时间戳差，CLK_TCK 固定 100），`mem = rss(页数) × 页大小(4KiB) / 1024`，`cmd` 为空时回退 comm。输出结构保持 `{pid, cpu, mem, cmd}` 不变，top6 按 cpu 降序在 Go 端取。

### 4.3 GetFullProcessList 的 /proc 路径（BusyBox 时）

新增内联脚本（与 4.2 同构，双采样中间 `sleep 1`，补充 user 映射）：
- 每进程：`pid|stat原始行|threads|uid|cmdline`；etime 由 Go 端用 stat 的 starttime（tick）与探针已有的 uptime 秒数换算。
- user 显示名：脚本内 `awk -F: -v u="$uid" '$3==u{print $1; exit}' /etc/passwd`（OpenWrt 可能无 getent，直接读 passwd 最稳），查不到回退显示 uid 数字。
- Go 端新增 `parseProcProcessList`（与 `parseFullProcessListOutput` 同构输出）：`{pid, cpu, mem, user, name, cmd, loc, stat, nlwp, etime}`，cpu 降序排序；nlwp=threads，stat 取 stat 行 state 字段。

### 4.4 探针部署改 heredoc（deployProbeScriptIO，ssh.go:2221）

```go
cmd := "mkdir -p ~/.lumin /tmp/.lumin && cat > ~/.lumin/probe.sh <<'LUMIN_EOF'\n" +
    dynamicProbeScript + "\nLUMIN_EOF\nchmod 755 ~/.lumin/probe.sh"
```
经 `executeCmdWithClient` 执行（exec 通道，无 SFTP 依赖）。`deployProbeScript` 签名去掉 `sftpClient` 参数；`getSystemInfo` 不再调用 `GetSFTPClient`。`deployProbeScript` 的超时保护（probeDeployTimeout select）保留，改为对 exec 命令同样兜底。实现补充：部署命令经 `wrapShCmd` 包在 `sh -c` 中执行（单引号按 `'\''` 转义），远端登录 shell 为 fish/csh 等不支持 heredoc 的 shell 时语义仍一致。

### 4.5 OpenWrt SFTP 提示

- `initSFTPClient` 失败分支：探测 OpenWrt → 若命中，emit 的 `ssh-status` 事件追加字段 `openwrt: true`、`installCmd: "opkg update && opkg install openssh-sftp-server"`。
- `GetSFTPClient` 的 `SFTP not available: %w` 包装处：OpenWrt 命中时返回友好消息（含原错误、安装命令）。
- 前端 `useSessionConnections.ts` `ssh-status` 监听新增 `sftp-unavailable` 分支：`addToast(..., 'warning', 15000, [{label: t('复制安装命令'), onClick: () => navigator.clipboard.writeText(installCmd)}])`；toast 文案同时提示「安装完成后请重新连接会话」（SFTP client 仅在连接时初始化，装包后需重连才会重试）。
- FileManager 错误分支（FileManager.tsx:3274）：错误串含「OpenWrt」时同样显示带复制 action 的 toast（或顶部提示条）。
- 非 OpenWrt 的 SFTP 失败保持原错误透传（不误伤其他平台）。

### 4.6 错误处理

- 探针部署失败：沿用现有 `probeFailed` ≥3 放弃机制；heredoc 写失败（如家目录只读）回退 `/tmp/.lumin/probe.sh` 的路径逻辑保留。
- /proc 采样部分失败：单进程行解析失败跳过该行（与现有 `parseFullProcessListOutput` 的 len<9 continue 一致），不整体报错。
- 探测命令本身失败：flags 保持「未知」，下次再试，不阻塞主流程。

### 4.7 测试计划

- Go 单元测试（internal/sshmanager）：
  - `parseProcProcessList`：用构造的 /proc 样例输出（含 comm 含空格/括号、rss 单位换算、uid→user 映射、etime 换算）断言各字段。
  - 探针 PROC1/PROC2 解析：CPU% delta 计算（含跨秒边界、无配对 PID 丢弃）。
  - `GetFullProcessList` 分轨逻辑：BusyBox flags=1 走 /proc 路径（mock executeCmd 返回值）。
  - heredoc 命令构造：断言 `<<'LUMIN_EOF'` 与 chmod 存在、无未转义注入。
- 前端：check-i18n.mjs 通过；`tsc`/lint 通过。
- 实机验证（需 OpenWrt 设备，可协调 issue 用户 jayck88 用 GL-E5800 测试）：
  1. 无 sftp-server：监控/进程列表正常；文件管理器给出可复制安装提示。
  2. `opkg update && opkg install openssh-sftp-server` 后：文件管理器正常，无需重连（SFTP client 初始化失败后需重连会话验证）。
  3. 常规 Linux（Ubuntu/Debian）回归：进程列表与 top6 行为不变。

## 5. 实现步骤（提交划分）

1. `fix/openwrt-support` 分支（已建）。
2. Commit 1：探针部署 heredoc 化（4.4）+ `getSystemInfo` 去 SFTP 依赖。
3. Commit 2：探针进程段 /proc 双采样（4.2）+ Go 端解析（复用/新增解析函数 + 单测）。
4. Commit 3：BusyBox 检测（4.1）+ `GetFullProcessList` /proc 路径（4.3）+ 单测。
5. Commit 4：OpenWrt SFTP 提示（4.5）+ 前端事件处理 + 27 locale 文案 + check-i18n。
6. 全量构建（`go build ./...`、前端 `npm run build`）、单测、手动冒烟。
7. 视验证情况回复 issue #204 并与 jayck88 协调实机测试。

## 6. 范围外（明确不做）

- 非 SFTP 的文件传输实现（issue 已认可继续依赖 openssh-sftp-server）。
- 非 Linux 平台（FreeBSD 等）的 ps 兼容；本地连接（localsysinfo）不动。
- 进程树/父子关系展示（现有 UI 无此需求）。

## 7. 审查修订（2026-08-14，第二轮 code review 后）

第二轮 review 发现并修正以下问题（除注明外均附单测，见 procstat_test.go）：

1. **[Critical] cmdline 内嵌 marker 破坏 section 提取**：运行脚本的 sh 自身会被采样，其 argv 含整段脚本（多行 + `---PROCS2---` 等 marker 子串），`extractSection` 的子串匹配被 cmdline 内的 marker 提前截断——真实设备上 `GetFullProcessList` 每次都会报 `invalid PROC sections`（本机真实 sh 冒烟测试即复现）。修复：`sample()` 把 cmdline 的换行随 NUL 一并转空格（保证记录单行），完整列表解析改用整行精确匹配的 `extractSectionExact`。
2. **BusyBox 误判**：裸 busybox 自述头回退检测改为仅在 `ps` 缺失时启用；装了 busybox-static 的常规 Linux（procps ps）不再被永久切到 /proc 慢路径（对应 §3 Part A「常规 Linux 不变」约束）。
3. **fish/csh 兼容**：`GetFullProcessList` 的 BusyBox 路径经 `wrapShCmd` 包 POSIX sh（与部署/运行命令一致）；路由决策提取为纯函数 `fullProcListCmdFor` 并补分支单测——即 §4.7 的分轨测试，以纯函数 seam 替代 mock executeCmd。
4. **数据竞态**：`GetSFTPClient` 等待初始化后的二次读取（`entry.SFTP`/`entry.Client`）挪回 RLock 内（原锁外读与 `initSFTPClient` 写入并发，`-race` 可检出）。
5. **fork 风暴**：探针 PROC 段改单条 `cat /proc/[0-9]*/stat`（整段一次 fork）；`sample()` 的 stat/status 读取改纯 shell `read` 内建（不 fork awk/cat），每 PID 仅剩 cmdline 的一次 `tr`。
6. **时间戳精度**：采样时间戳改 `cut -d' ' -f1 /proc/uptime`（浮点秒）；探针段在非 Linux（无 /proc/uptime）回退 `date +%s` 保持旧行为。
7. **PID 复用防护**：两次采样 `starttime` 不一致的 PID 视为复用，剔除（tick delta 无意义）。
8. **探针双跑**：`buildProbeScriptRunCommand` 的 `&&/||` 双路径串联改 if/else——tee 双写后两份脚本常在，`&&/||` 会在 home 份非零退出时重跑 /tmp 份。
9. **杂项**：修正过期注释（探针部署已非 SFTP）；标注 CLK_TCK=100 与 4KiB 页为 OpenWrt 目标平台假设（16KiB 页 ARM64 内核需另行适配）；`.gitignore` 增加 `*.tmp`（`internal/config` 原子写测试残留）。

§4.5 的「或顶部提示条」按文档允许的 toast 方案实现，不再另做横幅。
