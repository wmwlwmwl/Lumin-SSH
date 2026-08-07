package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestUniqueUserThemePackageID(t *testing.T) {
	used := map[string]bool{
		"lumin-light": true,
		"lumin-dark":  true,
	}
	got := uniqueUserThemePackageID("lumin-dark", "light", used)
	if got != "lumin-copy-light" {
		t.Fatalf("want lumin-copy-light, got %s", got)
	}
	used[got] = true
	got2 := uniqueUserThemePackageID("lumin-dark", "light", used)
	if got2 != "lumin-copy-light-2" {
		t.Fatalf("want lumin-copy-light-2, got %s", got2)
	}
}

func TestCopyThemePackageToModeStaysLightUIKeepsSourceAccent(t *testing.T) {
	tmp := t.TempDir()
	cm := &ConfigManager{configDir: tmp}
	// 夜空深色 accent=#7aa2f7
	summary, err := cm.CopyThemePackageToMode("tokyo-night-dark", "light")
	if err != nil {
		t.Fatalf("copy: %v", err)
	}
	if summary.ModeHint != "light" {
		t.Fatalf("modeHint=%s", summary.ModeHint)
	}

	path := filepath.Join(tmp, "themes", summary.ID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var item ThemePackageFile
	if err := json.Unmarshal(data, &item); err != nil {
		t.Fatalf("json: %v", err)
	}

	// 浅色槽：界面骨架仍是浅色
	if item.Tokens["surfaceBase"] != "#f3f4f6" {
		t.Fatalf("surfaceBase want light #f3f4f6, got %q", item.Tokens["surfaceBase"])
	}
	if item.Tokens["textPrimary"] != "#111827" {
		t.Fatalf("textPrimary want light #111827, got %q", item.Tokens["textPrimary"])
	}

	// 主色从源包带走（会话标签 / 网络速率用 --accent）
	if item.Tokens["accent"] != "#7aa2f7" {
		t.Fatalf("accent want source #7aa2f7, got %q", item.Tokens["accent"])
	}
	if item.Tokens["accentRgb"] != "122, 162, 247" {
		t.Fatalf("accentRgb want source, got %q", item.Tokens["accentRgb"])
	}

	// 终端从源包
	term, _ := item.Components["terminal"].(map[string]interface{})
	xterm, _ := term["xterm"].(map[string]interface{})
	container, _ := term["container"].(map[string]interface{})
	if fg, _ := xterm["foreground"].(string); fg != "#c0caf5" {
		t.Fatalf("terminal fg want #c0caf5, got %q", fg)
	}
	if bg, _ := container["containerBg"].(string); bg != "#161821" {
		t.Fatalf("terminal containerBg want #161821, got %q", bg)
	}

	tabs, _ := item.Components["tabs"].(map[string]interface{})
	if inactiveText, _ := tabs["inactiveText"].(string); inactiveText != "#1f2937" {
		t.Fatalf("tabs should be light structure, inactiveText=%q", inactiveText)
	}

	// 文件图标色按目标浅侧重写，不能继续带着深色 #89e051
	if item.Tokens["fileIconShell"] != "#15803d" {
		t.Fatalf("fileIconShell want light #15803d, got %q", item.Tokens["fileIconShell"])
	}
	// 深浅绑定的 UI 组件应被剥掉，交给前端按浅色 modeHint 重算
	for _, key := range []string{"fileManager", "topbar", "quickCommands", "connectingCard"} {
		if _, ok := item.Components[key]; ok {
			t.Fatalf("component %s should be stripped on copy-to-mode", key)
		}
	}
}

func TestCopyThemePackageToModeStripsModeBoundUIAndRewritesFileIcon(t *testing.T) {
	tmp := t.TempDir()
	cm := &ConfigManager{configDir: tmp}
	userDir := filepath.Join(tmp, "themes")
	if err := os.MkdirAll(userDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// 人造深色用户包：故意塞上深色 fileManager + 亮绿 shell 图标
	source := ThemePackageFile{
		SchemaVersion: themePackageSchemaVersion,
		ID:            "user-dark-polluted",
		Name:          "污染深色",
		ModeHint:      "dark",
		Tokens: map[string]string{
			"surfaceBase":   "#0f1319",
			"textPrimary":   "#eef3f9",
			"accent":        "#ff00aa",
			"fileIconShell": "#89e051",
		},
		Components: map[string]interface{}{
			"fileManager": map[string]interface{}{
				"panelBg":         "#0f1319",
				"folderTextColor": "#4d9eff",
			},
			"topbar": map[string]interface{}{
				"background": "#141a23",
			},
			"quickCommands": map[string]interface{}{
				"panelBg": "#1a2130",
			},
			"connectingCard": map[string]interface{}{
				"cardBg": "#1a2130",
			},
			"tabs": buildTabsComponent("dark"),
			"terminal": map[string]interface{}{
				"xterm": map[string]interface{}{
					"foreground": "#c0caf5",
				},
				"container": map[string]interface{}{
					"containerBg": "#161821",
				},
			},
		},
	}
	data, err := json.MarshalIndent(source, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(userDir, source.ID+".json"), data, 0o644); err != nil {
		t.Fatal(err)
	}

	summary, err := cm.CopyThemePackageToMode(source.ID, "light")
	if err != nil {
		t.Fatalf("copy: %v", err)
	}
	path := filepath.Join(userDir, summary.ID+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var item ThemePackageFile
	if err := json.Unmarshal(raw, &item); err != nil {
		t.Fatal(err)
	}
	if item.ModeHint != "light" {
		t.Fatalf("modeHint=%s", item.ModeHint)
	}
	if item.Tokens["surfaceBase"] != "#f3f4f6" {
		t.Fatalf("surfaceBase=%q", item.Tokens["surfaceBase"])
	}
	if item.Tokens["fileIconShell"] != "#15803d" {
		t.Fatalf("fileIconShell=%q want #15803d", item.Tokens["fileIconShell"])
	}
	// accent 仍从源包
	if item.Tokens["accent"] != "#ff00aa" {
		t.Fatalf("accent=%q want source #ff00aa", item.Tokens["accent"])
	}
	for _, key := range themePackageModeBoundUIComponents {
		if _, ok := item.Components[key]; ok {
			t.Fatalf("%s should be stripped", key)
		}
	}
	// terminal 保留
	term, _ := item.Components["terminal"].(map[string]interface{})
	xterm, _ := term["xterm"].(map[string]interface{})
	if fg, _ := xterm["foreground"].(string); fg != "#c0caf5" {
		t.Fatalf("terminal should keep source, fg=%q", fg)
	}
}
