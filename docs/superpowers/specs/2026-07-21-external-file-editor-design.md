# 外置文件编辑器（A+ 会话式）设计

## 目标
在文件编辑窗口提供「使用系统编辑器」「用…编辑（记忆路径）」，编辑远程文件时走本地编辑器，变更自动回传远程。三端（Windows / macOS / Linux）统一可用。

**不做「自动打开」**：勾选后会跳过内置窗口，用户无法再关掉该偏好。始终先打开内置编辑器，外置由用户点击触发。

## 架构
Go 侧 `ExternalEditManager` 管理会话：
1. `ReadFile` / 使用前端当前内容写入本地 temp
2. 系统默认或指定应用打开
3. `fsnotify` 监听目录（兼容原子保存 rename）
4. 防抖 800ms + 两次稳定读 + SHA256 去重后 `WriteFile`
5. 关闭标签 / 断线 / 退出时 `Stop` 清理 temp；启动与退出时 prune 孤儿目录

## 「用…编辑」行为（对齐 electerm 记忆）
- 首次：选可执行文件并写入 `fileEditorPreferredApp`
- 再次点击主按钮：直接用记忆路径打开
- 「更换…」：强制重新选择并覆盖记忆
- 记忆路径失效：自动弹出重选

## API
- `OpenRemoteFileInSystemEditor(sessionId, remotePath, content)`
- `OpenRemoteFileWithEditor(sessionId, remotePath, content, editorPath)`
- `SelectExternalEditor()`
- `StopExternalEdit(sessionId, remotePath)`
- `ListExternalEditSessions()`

## 事件
- `external-edit-started`
- `external-edit-synced`
- `external-edit-error`
- `external-edit-stopped`

## 偏好（localStorage）
- `fileEditorPreferredApp`：上次指定编辑器绝对路径
- `fileEditorRecentApps`：最近 5 个（预留）

## 临时文件生命周期
| 时机 | 行为 |
|------|------|
| 打开外置 | 写入 `%TEMP%/lumin-ssh-external-edit/<hash>/filename` |
| 关闭编辑标签 / 全部关闭 | `StopExternalEdit` 删文件与目录 |
| SSH 断线 / 应用退出 | 停会话并清理 |
| 启动 / 退出 | prune 无主孤儿目录 |

## 边界
- 最大 5MB
- 不做 SSHFS
- 不依赖编辑器进程 PID 结束（系统默认打开常无 PID）
