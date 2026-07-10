# 节点密文导入/导出功能设计（在明文功能基础上改造）

## 背景

第一阶段已实现明文 JSON 导入/导出（`importexport.go` + 工具栏两按钮）。本阶段在此基础上增加：
1. **密文导出**：导出时让用户选明文或密文；密文用用户密码或本机云端密钥加密。
2. **密文导入**：智能识别明文 JSON / 密码密文 / 云端 `.enc`，自动尝试解密。
3. **收拢 UI**：工具栏两个按钮合并为一个，点击弹出"数据管理"Dialog，含导入/导出/模板下载。
4. **模板下载**：提供带样例的 JSON 模板，方便用户批量录入。

## 云端加密事实（已通过代码确认）

- 加密算法：AES-256-GCM，密文 hex 编码（`config.go:224 encryptWithKey`）。
- 云端密钥派生（裸 SHA-256，无盐无迭代）：
  - WebDAV：`sha256(url + username + password)`（`config.go:877`）
  - R2：`sha256(AccessKeyID + SecretAccessKey + Bucket + Endpoint)`（`r2.go:40`）
  - FTP：`sha256(host + port + username + password)`（`ftp.go:38`）
  - SFTP：`sha256(host + port + username + password + privateKey)`（`sftp.go:45`）
- 同步模式：`GetSyncMode()` 返回 `"webdav"/"r2"/"ftp"/"sftp"/"all"`（`config.go:1009`）。
- 未配置的后端：`GetXxxConfig()` 返回 nil。
- `.enc` 文件内容 = 纯 hex 密文，无文件头/元数据，扩展名仅约定。

## 密钥策略（已确认）

- **导出密文**：密钥来源两选一——
  - "复用云端密钥"（默认）：取本机已配置的同步后端密钥（当前选定优先，其次尝试其他已配置后端），零交互。
  - "自定义密码"：用户输入密码 → `sha256(password)` 当密钥。
- **导入密文**：自动尝试顺序——
  1. 若前端传了 password → 用 `sha256(password)`。
  2. 否则尝试本机各已配置后端密钥（当前选定优先，再其他）。
  3. 都失败 → 返回需要密码标记，前端弹 `luminDialog.prompt` 密码框，用户输入后重试。

## 后端设计

### `importexport.go` 扩展

新增纯函数（便于测试）：
```go
// resolveEncryptKey 按"当前优先 + 其他已配后端"策略返回本机可用的云端密钥。
// 返回 key 和找到的后端名（用于 UI 提示）；都没有则返回 (nil, "")。
func (c *ConfigManager) getActiveSyncKey() ([]byte, string)

// encryptExportData 用指定密钥加密导出对象，返回 hex 密文字符串。
func encryptExportData(exp connectionsExport, key []byte) (string, error)

// parseImportData 智能解析导入文件原始字节：
// 先试明文 JSON；失败则用候选密钥列表逐个解密。
// 返回解析出的 (connections, credentials, error)。
// error 为 errNeedPassword 时表示所有密钥失败、需用户输入密码。
var errNeedPassword = errors.New("need password")
func parseImportData(data []byte, candidateKeys [][]byte, passwordKey []byte) (*connectionsExport, error)
```

`parseImportData` 内部逻辑：
- 明文 JSON：`json.Unmarshal` 成功且 `format=="lumin-ssh-connections"` → 明文，返回。
- 否则当 hex 密文：用 `decryptWithKey` 逐个尝试候选密钥 + passwordKey。
  - 解密成功后解析：优先 `connectionsExport`（认 `format` 字段），回退 `SyncSnapshot`（认 `connections` 字段，忽略 quick_commands 等无关字段）。
  - 全部失败 → `errNeedPassword`。

`getActiveSyncKey()` 实现：
```go
func (c *ConfigManager) getActiveSyncKey() ([]byte, string) {
    // 按优先级收集候选后端：当前 syncMode 第一，其余后端随后
    order := orderedProviders(c.GetSyncMode()) // ["webdav","r2","ftp","sftp"] 调整顺序
    for _, p := range order {
        if key, name := c.providerKeyIfConfigured(p); key != nil {
            return key, name
        }
    }
    return nil, ""
}
```
`providerKeyIfConfigured(p)`：对每个后端，若 `GetXxxConfig()` 非 nil 且关键字段非空，返回其 `getXxxKey()`，否则跳过。

### `config.go` 扩展

`ImportConnections` 签名不变（仍接收 `[]Connection, []Credential`），逻辑不变。密文解析在 `app.go` 层完成后传入明文数据。

### `app.go` 绑定改造

```go
// 导出：useEncryption=false 明文 .json；true 密文 .enc。
// password 非空时用 sha256(password)；空则用本机云端密钥。
func (a *App) ExportConnections(useEncryption bool, password string) (string, error)

// 导入：password 可空。返回 ImportResult。
// 当需要密码时返回的 error 含可识别标记（用 errors.Is(err, errNeedPassword)），
// 前端据此弹密码框重试。
func (a *App) ImportConnections(password string) (ImportResult, error)

// 下载导入模板：弹保存对话框，写带样例的明文 JSON，返回路径。
func (a *App) DownloadImportTemplate() (string, error)
```

`ImportConnections(password)` 流程：
1. 弹打开对话框选文件 → 取消返回空结果。
2. 读文件字节。
3. 构造候选密钥列表：若 password 非空加 `sha256(password)`；加本机各已配置后端密钥。
4. `parseImportData` → 明文/密文统一解析。
5. `errNeedPassword` → 原样返回该 error（前端识别）。
6. 成功 → `configManager.ImportConnections(conns, creds)`。

模板内容：含 2 条样例（密码认证 + 私钥认证）的合法 `connectionsExport` JSON，host/密码用占位符。

## 前端设计

### 新建 `ImportExportDialog.jsx`（受控组件，参考 CredentialsModal 范式）

props: `{ onClose, onExport, onImport, onDownloadTemplate, hasCloudProvider }`

结构（`modal-overlay` + `modal-md`）：
- **导出区**：格式单选（明文/密文）；密文时显示密钥来源单选（复用云端/自定义密码 + 输入框）；[导出] 按钮。
- **导入区**：[选择文件并导入] 按钮；密码框在导入返回 needPassword 时由 `luminDialog.prompt` 弹出（不放在 Dialog 内，复用全局弹窗）。
- **底部**：[下载导入模板] 链接/按钮。

导出回调：`onExport({ useEncryption, password })` → App.jsx 调 `AppGo.ExportConnections(...)`。
导入回调：`onImport()` → App.jsx 调 `AppGo.ImportConnections('')` → 若 error 是 needPassword → `luminDialog.prompt` 取密码 → 调 `AppGo.ImportConnections(password)`。

### `App.jsx` 改造

- 删除 `handleExportServers`/`handleImportServers`，新增：
  - `handleOpenImportExport()`：`setShowImportExportDialog(true)`。
  - `handleExport(opts)`：调 `ExportConnections(opts.useEncryption, opts.password)`，toast 结果。
  - `handleImport(password)`：调 `ImportConnections(password)`，处理 needPassword → 弹密码框重试，成功后 `loadServers()`。
  - `handleDownloadTemplate()`：调 `DownloadImportTemplate()`，toast 路径。
- 新增状态 `showImportExportDialog`，条件渲染 `<ImportExportDialog>`。

### `Dashboard.jsx` 改造

- 工具栏的两个按钮（Upload/Download）合并为一个（`Database` 或 `ArrowUpDown` 图标），`onClick={onOpenImportExport}`。
- props 改为 `onOpenImportExport`（替代 `onExportServers`/`onImportServers`）。

### `i18n`

新增中英文：数据管理、导出格式、明文、密文、加密方式、复用云端密钥、自定义密码、导出、导入、下载导入模板、请输入导出密码、密文需要密码请输入、密码错误或文件不兼容、未配置任何云同步后端请输入密码、已下载模板到 {path} 等。

## 错误处理与边界

- 导出密文 + 选"复用云端"但本机无任何已配后端 → 报错提示"请配置云同步或改用密码"。
- 导出密文 + 自定义密码为空 → 前端校验阻止，提示输入。
- 导入密码错误 → 提示重试。
- 云端 `.enc` 含 quick_commands/file_manager_settings → 导入只取 connections+credentials。
- 明文/密文混选 → parseImportData 自动识别，无需用户指定。
- 密钥尝试顺序：password 优先于本机云凭据（若用户输了密码就用密码）。

## 测试

扩展 `importexport_test.go`：
- 密文往返：用密码 key 加密 → parseImportData 解密 → 数据一致。
- 密文往返：用模拟云端 key 加密 → 解密成功。
- 明文 JSON 直接解析。
- SyncSnapshot 格式兼容解析。
- errNeedPassword：无任何正确密钥时返回该错误。
- candidateKeys 顺序：password key 优先。

## 不在范围

- 部分导出（勾选节点/按分组）。
- 改动云端备份的加密机制（保持向后兼容）。
