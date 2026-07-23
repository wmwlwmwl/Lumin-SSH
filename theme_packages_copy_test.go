package main

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
}
