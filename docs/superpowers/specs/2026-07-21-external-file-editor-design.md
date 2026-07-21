# 外置文件编辑器（A+ 会话式）设计

## 目标
在文件编辑窗口提供「使用系统编辑器」「用…编辑」「自动打开（默认 off）」，编辑远程文件时走本地编辑器，变更自动回传远程。三端（Windows / macOS / Linux）统一可用。

## 架构
Go 侧 `ExternalEditManager` 管理会话：
1. `ReadFile` / 使用前端当前内容写入本地 temp
2. 系统默认或指定应用打开
3. `fsnotify` 监听目录（兼容原子保存 rename）
4. 防抖 800ms + 两次稳定读 + SHA256 去重后 `WriteFile`
5. 断线 / 退出 / 主动停止时清理

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
- `fileEditorAutoOpenExternal` 默认 `false`
- `fileEditorPreferredApp`
- `fileEditorRecentApps`（最多 5）

## 边界
- 最大 5MB
- 不做 SSHFS
- 不依赖编辑器进程 PID 结束（系统默认打开常无 PID）
