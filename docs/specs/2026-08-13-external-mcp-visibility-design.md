# 外部 MCP 操控可视化追踪 — 设计规格

日期: 2026-08-13
状态: 已批准（范围=全部；前端通道=独立 mcp-activity）

## 1. 背景与目标

Lumin 已内置 MCP HTTP 服务（`127.0.0.1:5779/mcp`，`internal/mcp/runtime.go:14`），且已允许非浏览器/CLI 客户端接入（空 `Origin` 放行，`internal/mcpserver/http_handler.go:93`）。Claude Code / Codex 现在即可连接并调用 `execute_command` / `list_files` / `write_to_file` 等工具。

**问题**：内置 AI 跑工具时，通过 `ExecuteCommandInTerminalControlled` 的回调（`onCommandQueued` / `onCommandStarted` / `onCommandOutput`）把"服务器 / 命令 / 状态"实时推送到 AI 面板（`ai-chat-stream` 事件）。但外部 MCP 路径把这 5 个回调与审批通道全部传 `nil`（`internal/mcpbridge/host.go:96`、`internal/ai/runtime_bridge.go:417`），导致外部操控在 app 内完全不可见——只有裸命令文本出现在终端，无归属、无审批、无状态追踪。

**目标**：让外部 CLI（Claude Code / Codex）通过 MCP 控制服务器时，操控痕迹像内置 AI 一样可见——AI 面板风格的追踪卡片（独立 `mcp-activity` 通道）+ 终端命令块高亮，并提供可选审批门（默认自动执行 + 可见）。

## 2. 非目标

- 不改变 MCP 协议层（仍是 Streamable HTTP JSON-RPC）。
- 不新增安全边界（loopback + Origin 仍是摩擦控制，非防同用户恶意进程）。
- 不做内置 AI 与外部 MCP 的会话合并/接管（collaboration 已有独立机制）。

## 3. 架构

```
Claude Code ──HTTP/MCP──▶ mcpserver (127.0.0.1:5779)
                              │ HTTPHandler 捕获 User-Agent → ClientName
                              │ Catalog.CallWithContext（工具调用，统一埋点）
                              ▼
                    mcp.ActivityReporter（新增，注入式）
                              │
              ┌───────────────┼────────────────────┐
              ▼                ▼                    ▼
      execute_command    list_files/read/...   write/edit/transfer
        (接通回调↓)        (started/done)        (started/done)
              │
              ▼  复用 sshMgr.ExecuteCommandInTerminalControlled
        onQueued/onStarted/onOutput  ← 之前全 nil，现接通
              │
              ▼  runtime.EventsEmit(ctx, "mcp-activity", event)
        ┌──────────────────────────────────────────┐
        │  前端                                     │
        │  ① MCP 活动面板: 独立卡片(客户端+服务器)    │
        │  ② 终端: 命令块高亮 + 徽标                 │
        │  ③ 审批卡(可选): 批准/拒绝 → ResolveMCP... │
        └──────────────────────────────────────────┘
```

### 3.1 设计原则
- **复用优先**：execute_command 的状态机、审批交互样式、终端命令块装饰均复用现有实现，只在外部路径接通。
- **注入式**：reporter 由 `wailsapp`（持有 Wails ctx）注入到 MCP 链路，Go 业务包不直接依赖 Wails。
- **nil 安全**：reporter 未注入时退化为当前行为，不破坏现有调用方。
- **best-effort 发射**：活动事件发送失败不得中断工具调用。

## 4. 组件设计

### 4.1 Go — ActivityReporter（新增 `internal/mcp/activity.go`）

```go
type ActivityStatus string // "started"|"queued"|"running"|"output"|"done"|"error"|"approval_required"|"approved"|"rejected"|"timed_out"

type ActivityEvent struct {
    RequestID  string         // 关联一次工具调用的 start/done
    Source     string         // 固定 "external-mcp"
    ClientName string         // 取自 HTTP User-Agent（如 "claude-cli/0.x"）
    Tool       string         // "execute_command" 等
    SessionID  string
    ServerName string         // 解析自 connection.Name
    Command    string         // execute_command 专用
    Purpose    string
    IsMutating bool
    CWD        string
    Status     ActivityStatus
    Output     string
    ExitCode   *int
    Timestamp  int64          // unix milli
}

type ActivityReporter interface {
    ReportActivity(event ActivityEvent)                 // fire-and-forget
    RequestApproval(event ActivityEvent) (approved bool, err error) // 阻塞，写操作审批
}
```

### 4.2 Go — Host 接口与 mcpbridge 注入

- `mcp.Host` 增加方法 `ActivityReporter() mcp.ActivityReporter`（可空）。
- `mcpbridge.Host` 增加 `reporter` 字段，由 `wailsapp.newMCPHost` 注入；`NewHost` 签名扩展或新增 `Host.WithReporter(...)`。
- `mcp.StartServer(host, settings)` 内部从 `host.ActivityReporter()` 取 reporter，传给 catalog。

### 4.3 Go — Catalog 统一埋点（`internal/mcpserver/catalog.go`）

- `Catalog` 增加 `reporter ActivityReporter` 与 `clientName string`（由 HTTPHandler 按请求注入）。
- `CallWithContext` 包装：调用前发 `started`，调用后按结果发 `done`/`error`（覆盖所有工具）。
- `execute_command` 额外接通三个回调（见 4.4）。
- reporter/clientName 为空时退化为现状。

### 4.4 Go — execute_command 接通回调（`internal/mcpbridge/host.go`）

`Host.ExecuteCommandInTerminalControlled` 内部用 reporter 构造回调并传入 `sshMgr.ExecuteCommandInTerminalControlled`：
- `onCommandQueued` → `ReportActivity{Status:"queued"}`
- `onCommandStarted` → `ReportActivity{Status:"running"}` + 终端高亮标记事件
- `onCommandOutput` → `ReportActivity{Status:"output", Output:snapshot}`

审批门（当 `MCPRequireApproval && isMutating`）：
- 执行前调 `reporter.RequestApproval(event{Status:"approval_required"})`，阻塞等待。
- 超时（默认 5 分钟）→ 自动拒绝，工具返回 `"approval timed out"`。
- 拒绝 → 工具返回 `"rejected by user"`。
- 批准 → 继续。

### 4.5 Go — HTTPHandler 传递 ClientName（`internal/mcpserver/http_handler.go`）

- `handleToolsCall` 读取 `r.Header.Get("User-Agent")`，规范化为 ClientName（如 `claude-cli` / `codex` / `unknown`），写入 catalog 调用上下文。

### 4.6 Go — 审批 resolver（`internal/wailsapp/`）

- `wailsapp` 实现 `ActivityReporter`：
  - `ReportActivity` → `runtime.EventsEmit(ctx, "mcp-activity", event)`
  - `RequestApproval` → 登记 pending（map[requestID]chan bool），发 `approval_required` 事件，`<-chan` 阻塞；启动超时定时器。
- 新增 Wails 绑定方法 `ResolveMCPApproval(requestID string, approved bool) error`：找到 pending chan 并发送结果。

### 4.7 Go — 设置（`internal/ai/global_settings.go`）

`AIGlobalSettings` 增加：
- `MCPRequireApproval bool`（json `mcpRequireApproval`，默认 false）
- `MCPActivityVisible bool`（json `mcpActivityVisible`，默认 false；设置 UI 手动开启后弹出活动弹窗）
- `defaultAIGlobalSettings()` 设默认值；`LoadServiceSettings` 透传。

### 4.8 前端 — MCP 活动面板（新组件）

- 新文件 `frontend/src/components/MCPActivityPanel.tsx`（或纳入现有面板区）。
- 监听 `EventsOn('mcp-activity', ...)`，渲染卡片流：客户端徽标、服务器名、工具、命令/路径、状态、输出折叠、退出码。
- 审批卡：批准/拒绝按钮 → 调 `ResolveMCPApproval(requestID, approved)`。
- 挂载位置：工作区侧栏/底部（与 AI 面板并列的一个区或标签）。

### 4.9 前端 — 终端命令块高亮（`frontend/src/components/Terminal.tsx`）

- 外部 AI 触发的 execute_command，通过 `mcp-activity`（status=running，含 sessionID）在该 session 的终端命令块打"外部"变体：不同边框色 + 徽标（如 `Claude Code`）。
- 复用现有命令块 marker/decoration 体系，新增 external 标记分支。

### 4.10 前端 — 设置 UI

- AI 设置面板加两个开关：「外部 MCP 操作可见」「外部 MCP 写操作需审批」。

### 4.11 文档

- `README.md` / 新增 `docs/MCP-CLI-GUIDE.md`：Claude Code / Codex 接入配置示例。

## 5. 数据流（execute_command 示例）

```
Claude Code POST /mcp  tools/call{execute_command, session_id, command, is_mutating=1}
  → HTTPHandler: ClientName = parse(User-Agent)
  → Catalog.CallWithContext:
      emit started{client, server, command, isMutating}
      if MCPRequireApproval && isMutating:
          reporter.RequestApproval → emit approval_required → 阻塞
          ← 前端 ResolveMCPApproval(id, true)  (或超时→拒绝)
      Host.ExecuteCommandInTerminalControlled(..., onQueued, onStarted, onOutput)
          onQueued → emit queued
          onStarted → emit running (+ 终端高亮)
          onOutput → emit output
      emit done{exitCode, output}
  → HTTP 响应结果回 Claude Code
```

## 6. 错误处理

- 审批超时（5 min）→ 自动拒绝，工具返回 `"approval timed out"`。
- reporter 为 nil → 退化为现状（无事件、无审批、立即执行）。
- 事件发射 panic/错误 → 捕获记录到 MCP 日志（`appendMCPLog`），不影响工具结果。
- 会话不存在 / SFTP 不可用 → 沿用现有错误返回，并补发 `error` 活动事件。

## 7. 测试

**Go 单测**：
- `Catalog.CallWithContext` 在 start/done 各发一次事件（mock reporter）。
- reporter 为 nil 时不 panic、不阻塞。
- 审批：批准→继续、拒绝→错误、超时→错误。
- `mcpbridge.Host` 回调正确转发为活动事件。
- ClientName 从 User-Agent 解析。

**手动验证**：
- Claude Code 连 `http://127.0.0.1:5779/mcp`，跑 `list_connected_sessions` → `execute_command`，确认面板出卡片、终端高亮。
- 开启审批后，写操作弹出审批卡，批准/拒绝/超时三条路径正确。

## 8. 实施顺序

1. Go: `ActivityReporter` 接口 + 事件类型（`internal/mcp/activity.go`）。
2. Go: Host 接口扩展 + `mcpbridge.Host` 注入 reporter + 接通 execute_command 回调与审批。
3. Go: Catalog 统一埋点 + HTTPHandler 传 ClientName。
4. Go: `wailsapp` reporter 实现 + `ResolveMCPApproval` 绑定 + 设置字段。
5. 前端: `mcp-activity` 监听 + 活动面板卡片 + 审批交互。
6. 前端: 终端命令块高亮。
7. 前端: 设置开关 UI。
8. 文档 + 手动验证。

## 9. 影响面

- 新增文件：`internal/mcp/activity.go`、`frontend/src/components/MCPActivityPanel.tsx`、`docs/MCP-CLI-GUIDE.md`。
- 修改：`internal/mcp/{host,runtime,command_provider}.go`、`internal/mcpserver/{catalog,http_handler,server}.go`、`internal/mcpbridge/{host,service}.go`、`internal/ai/global_settings.go`、`internal/wailsapp/{app,mcp_bridge,ai_wails_bindings}.go`、`frontend/src/components/Terminal.tsx`、AI 设置组件。
- 风险：reporter 注入链路较长，需保证 nil 安全与不阻塞工具调用。
