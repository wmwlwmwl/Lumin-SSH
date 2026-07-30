# WSL 本地终端 → 文件管理器 CWD 跟随 修复设计

## 问题
WSL 本地终端里 `cd` 切换目录后，文件管理器不跟随（路径/文件列表不变），终端自己显示的 CWD 也不变。远程 SSH 正常。

## 根因（实测确认，分两层）

### 1. 外部轮询 `wslGetCwd` 根本不可靠
原实现每 1.2s 起一个独立 `wsl.exe -d <distro> -- sh -c <script>` 去读交互 shell 的 `/proc/<pid>/cwd`，三个问题叠加：
- **ptrace_scope=1**：monitor 进程与 ConPTY 的 bash 无父子关系，`readlink /proc/<pid>/cwd` 直接 `Permission denied`。
- **PID 歧义**：系统常有多个 bash，`pgrep ... | tail -n1` 经常选错。
- **interop 引号/命令替换**：`$(pgrep)`、双引号、`for` 循环经 `wsl.exe -- sh -c` 传递时被破坏。
结果：脚本走 fallback `echo "$HOME"`，恒返回主目录 → `StartLocalCwdMonitor` 的 `changed` 第一次后恒为 false → `ssh-terminal-cwd` 事件不再发出。

### 2. 远程 SSH 的 marker 方案不能直接复用
远程 SSH 在 `buildShellLaunchCommand` 注入 `PROMPT_COMMAND` 钩子，每次提示符输出 `\x1fLUMIN_CWD\x1f<base64>\x1e`，由 `commandHistoryStream` 解析。
**但 Windows ConPTY 会剥离 `\x1f`(US)/`\x1e`(RS) 等控制字节**（实测确认：`printf '\037X\037Y\036Z'` 经 ConPTY 后变成 `XYZ`，0x1f/0x1e 全部消失）。SSH 的 PTY 原始通道不剥，所以远程能用、WSL 不能用。

## 方案：OSC 733 marker（已端到端验证）

OSC 序列（如终端标题 `\x1b]0;...\x07`）能完整穿透 ConPTY。改用自定义 OSC 733 携带 CWD：

```
ESC ] 733 ; <base64 of pwd> BEL
```

### 数据流
1. **注入钩子**（`local_conn_windows.go`）：通过 WSLENV 把 `PROMPT_COMMAND` 传进 WSL（避开命令行引号地狱），钩子每次提示符输出 OSC 733 + base64(pwd)。用户的 `.bashrc` 默认不覆盖 `PROMPT_COMMAND`（实测 Ubuntu 为空），钩子能存活；若被覆盖则优雅降级（不报错，只是不跟随）。
2. **解析**（新增 `osc_cwd_parser.go`）：有状态解析器，跨 read 边界处理 marker，剥掉 marker 后返回可见输出 + 解码出的 CWD。
3. **发事件**（`pipeLocalOutput`，ssh.go）：CWD 变化时 emit `ssh-terminal-cwd-<sessionId>`，复用前端已验证的「跟随 + 必要时开新标签」逻辑。

### 为什么不复用 commandHistoryStream
- marker 格式不同（OSC vs `\x1f`），且 WSL 不需要命令历史那条逻辑。
- 独立的 `oscCwdParser` 关注点单一、易测，不污染远程 SSH 的解析器。

## 改动范围
| 文件 | 改动 | 影响面 |
|---|---|---|
| `osc_cwd_parser.go` | **新增** OSC 解析器 | 仅 WSL |
| `local_conn_windows.go` | WSL 启动改用 WSLENV 注入钩子；SessionData 设 `OSCCwdParser`/`RemoteHistoryActive`；输出走 `pipeLocalOutput` | 仅 WSL |
| `ssh.go` | `SessionData` 加 `OSCCwdParser` 字段；新增 `pipeLocalOutput`；`StartLocalCwdMonitor` 对 WSL 提前返回 | WSL；`pipeLocalOutput` 是新方法 |
| `local_sftp_paths_windows.go` | `wslGetCwd` 保留为 `GetTerminalCwd` 初始 fallback（不再上热路径） | 仅 fallback |

## 不受影响
- **远程 SSH**：完全独立路径（`setupSession` + `commandHistoryStream`），零改动。
- **PowerShell/CMD**：无 bash 钩子，维持原 home 兜底（已知限制，不在本次范围）。
- **串口**：无 CWD，维持现状。
- **Unix 本地（macOS/Linux）**：`local_conn_unix.go` 未改，仍用 `/proc`/`lsof` 轮询（在那些平台可靠）。

## 验证
- `go build ./...` / `go vet ./...` 通过。
- 独立 ConPTY 复现：注入钩子 + `oscCwdParser` 解析真实 WSL 流，`cd /tmp /usr /etc` 全部正确返回真实路径。
- 待真机确认：`wails dev` 打开 WSL 终端，cd 切目录，看文件管理器是否跟随、终端 CWD 是否更新。

## 已知限制 / 后续
- 若某 WSL 发行版的 `.bashrc` 覆盖 `PROMPT_COMMAND`，钩子失效（降级为不跟随，不报错）。如需更稳，可改用 `bash --init-file` 包装链式加载，但需写临时文件，复杂度更高，暂不做。
- PowerShell/CMD 的真实 CWD 跟随需 NtQueryInformationProcess，是独立任务。
