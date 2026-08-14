# 外部 CLI 通过 MCP 控制 Lumin SSH 服务器 — 接入指南

Lumin 内置 MCP 服务（Streamable HTTP），监听 `127.0.0.1:5779/mcp`。Claude Code、Codex 等 CLI 工具可通过 MCP 连接，像真人一样操控你已连接的 SSH 服务器——命令在终端里实时可见，操作痕迹显示在 MCP 活动面板中。

## 快速接入

### Claude Code

在 Claude Code 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "lumin": {
      "url": "http://127.0.0.1:5779/mcp"
    }
  }
}
```

或通过命令行：

```bash
claude mcp add lumin --transport http http://127.0.0.1:5779/mcp
```

### Codex / 其他 MCP 客户端

在客户端的 MCP 配置（通常是 `mcp.json` 或类似）中加入：

```json
{
  "mcpServers": {
    "lumin": {
      "url": "http://127.0.0.1:5779/mcp"
    }
  }
}
```

## 使用流程

1. 在 Lumin 中**连接你的 SSH 服务器**（MCP 只能操控已连接的会话）
2. CLI 连接 MCP 后，先调用 `list_connected_sessions` 获取 `session_id`
3. 使用 `session_id` 调用其他工具：`execute_command`、`list_files`、`read_file`、`write_to_file` 等

## 可用工具

| 工具 | 说明 |
|------|------|
| `list_connected_sessions` | 列出所有已连接的 SSH 会话 |
| `get_work_path` | 获取会话当前工作目录 |
| `list_files` | 列出远程目录 |
| `read_file` | 读取远程文件 |
| `write_to_file` | 写入远程文件 |
| `execute_command` | 在真实终端中执行命令（可见、交互式） |
| `transfer_batch` | 批量传输文件 |
| `transfer_list` | 查看传输队列 |
| `search_replace` / `apply_diff` / `apply_patch` / `edit_file` | 远程文件编辑 |

## 可见性

外部 MCP 的操作会在以下位置留下痕迹：

- **终端**：命令直接在 SSH 终端中执行（与手动输入无异）
- **MCP 活动面板**：右下角 🤖 按钮打开，显示客户端名称、服务器、命令、状态、输出
- **审批**（可选）：在 AI 设置 → MCP 中开启「外部 MCP 写操作需审批」后，写操作需手动批准

## 安全说明

- MCP 服务仅绑定 `127.0.0.1`，不对公网暴露
- 默认拒绝浏览器调用（仅允许无 Origin 的本机 CLI）
- 审批门是可选的摩擦层，**不是**防同用户恶意进程的安全边界
- 外部 CLI 能操控的范围 = 你在 Lumin 中已连接的 SSH 会话
