package main

import (
	"context"
	"net"
	"os"
	"time"

	ai "luminssh-go/internal/ai"
	"luminssh-go/internal/config"
)

// ─── type alias：config 簇导出类型 ───────────────────────────
// ponytail: config 簇迁移到 internal/config 后，用 type alias 让 package main
// 零修改引用所有类型。alias 是同一类型，方法 receiver 自动穿透。
// 升级路径：逐步将各文件改为直接引用 config.XxxType，最终删除本文件。

type (
	Connection              = config.Connection
	Credential              = config.Credential
	ChmodDialogSettings     = config.ChmodDialogSettings
	TransferTuningSettings  = config.TransferTuningSettings
	FileManagerSettings     = config.FileManagerSettings
	AppSettings             = config.AppSettings
	WorkspacePrefs          = config.WorkspacePrefs
	PersistedPortForward    = config.PersistedPortForward
	ConfigManager           = config.ConfigManager
	SyncTombstone           = config.SyncTombstone
	SyncTombstoneStats      = config.SyncTombstoneStats
	SyncTombstonePruneResult = config.SyncTombstonePruneResult
	WebdavConfig            = config.WebdavConfig
	R2Config                = config.R2Config
	FTPConfig               = config.FTPConfig
	FTPCertificateInfo      = config.FTPCertificateInfo
	FTPConnectionTestResult = config.FTPConnectionTestResult
	SFTPConfig              = config.SFTPConfig
	SFTPHostKeyMismatch     = config.SFTPHostKeyMismatch
	SFTPConnectionTestResult = config.SFTPConnectionTestResult
	RemoteFile              = config.RemoteFile
	RemoteStorage           = config.RemoteStorage
	SyncSnapshot            = config.SyncSnapshot
	TombstoneConflictItem   = config.TombstoneConflictItem
	TombstoneConflictPreview = config.TombstoneConflictPreview
	ThemePackageSettings    = config.ThemePackageSettings
	ThemePackageFile        = config.ThemePackageFile
	ThemePackagePreview     = config.ThemePackagePreview
	ThemePackageSummary     = config.ThemePackageSummary
	ImportResult            = config.ImportResult
)

// ─── 构造函数 ────────────────────────────────────────────────

func NewConfigManager() *ConfigManager {
	return config.NewConfigManager()
}

// ─── 自由函数 wrapper ─────────────────────────────────────────

func normalizeTerminalEncoding(value string) string {
	return config.NormalizeTerminalEncoding(value)
}

func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	return config.AtomicWriteFile(path, data, perm)
}

func parseIntOrDefault(s string, def int) int {
	return config.ParseIntOrDefault(s, def)
}

func dialConnectionTargetContext(ctx context.Context, conn Connection, target string, timeout time.Duration) (net.Conn, error) {
	return config.DialConnectionTargetContext(ctx, conn, target, timeout)
}

func connectionUsesProxy(conn Connection) bool {
	return config.ConnectionUsesProxy(conn)
}

func cloneStringMap(source map[string]string) map[string]string {
	return config.CloneStringMap(source)
}

func cloneAnyMap(source map[string]interface{}) map[string]interface{} {
	return config.CloneAnyMap(source)
}

func mergeAnyMaps(base map[string]interface{}, override map[string]interface{}) map[string]interface{} {
	return config.MergeAnyMaps(base, override)
}

func validateThemePackageFile(item *ThemePackageFile) error {
	return config.ValidateThemePackageFile(item)
}

func readThemePackageSummaryFromFile(path string, source string) (ThemePackageSummary, error) {
	return config.ReadThemePackageSummaryFromFile(path, source)
}

func themePackageSummaryToMap(item ThemePackageSummary) map[string]interface{} {
	return config.ThemePackageSummaryToMap(item)
}

func themePackageSettingsToMap(item ThemePackageSettings) map[string]interface{} {
	return config.ThemePackageSettingsToMap(item)
}

// ─── 常量 / 变量别名 ──────────────────────────────────────────

const themePackageSchemaVersion = config.ThemePackageSchemaVersion

var errNeedPassword = config.ErrNeedPassword

// ─── 自由函数 wrapper（依赖 ai 包） ─────────────────────────────

func buildConnectionsExportWithProxyNodes(conns []Connection, creds []Credential, proxyNodes []ai.AIProxyNode) SyncSnapshot {
	return config.BuildConnectionsExportWithProxyNodes(conns, creds, proxyNodes)
}

func aiProvidersEqual(a, b []ai.AIProviderProfile) bool {
	return config.AIProvidersEqual(a, b)
}

func buildImportTemplate(lang string) SyncSnapshot {
	return config.BuildImportTemplate(lang)
}

func normalizeFileManagerSmartUncompressConflictStrategy(value string) string {
	return config.NormalizeFileManagerSmartUncompressConflictStrategy(value)
}
