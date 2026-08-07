package platformupdate

import "strings"

// IsAllowedDownloadURL 仅允许 GitHub Release 资产下载地址（含常见 ghproxy 前缀）。
// 拒绝 html_url / 网页 / 非 download 路径，避免把 Release 页面当安装包热替换。
func IsAllowedDownloadURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "https://") {
		return false
	}
	// 允许直连与常见镜像前缀：镜像通常是 https://proxy/https://github.com/...
	// 统一在完整字符串里找 github.com/.../releases/download/
	lower := strings.ToLower(raw)
	idx := strings.Index(lower, "github.com/")
	if idx < 0 {
		return false
	}
	rest := lower[idx+len("github.com/"):]
	// 期望: owner/repo/releases/download/...
	if !strings.Contains(rest, "/releases/download/") {
		return false
	}
	// 拒绝 .sha256 自身
	if strings.HasSuffix(lower, ".sha256") {
		return false
	}
	return true
}

// IsAllowedFilename 校验更新文件名是否为受支持的安装包格式。
func IsAllowedFilename(filename string) bool {
	name := strings.ToLower(strings.TrimSpace(filename))
	if name == "" || name == "." || name == ".." {
		return false
	}
	if strings.HasSuffix(name, ".sha256") {
		return false
	}
	return strings.HasSuffix(name, ".exe") ||
		strings.HasSuffix(name, ".deb") ||
		strings.HasSuffix(name, ".rpm") ||
		strings.HasSuffix(name, ".dmg")
}
