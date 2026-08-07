package ai

// ponytail: 从 package main (ai_theme_tuning.go) 提取的纯逻辑函数。
// 不依赖 internal/config 类型，仅依赖标准库。
// config 依赖的函数（draft 状态管理、HandleThemeToolRequest 等）仍留在 package main。
// 升级路径：若 internal/config 不再 import internal/ai，可将 config 依赖部分也迁入。

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ─── 预览字段分组 ──────────────────────────────────────────

type themeToolPreviewFieldGroup struct {
	Name    string
	Summary string
	Paths   []string
}

var themeToolPreviewFieldGroups = []themeToolPreviewFieldGroup{
	{
		Name:    "terminal.xterm",
		Summary: "Affects terminal text area colors, ANSI palette, cursor, selection and terminal glyph contrast only.",
		Paths: []string{
			"components.terminal.xterm.background",
			"components.terminal.xterm.foreground",
			"components.terminal.xterm.cursor",
			"components.terminal.xterm.cursorAccent",
			"components.terminal.xterm.selectionBackground",
			"components.terminal.xterm.selectionForeground",
			"components.terminal.xterm.selectionInactiveBackground",
			"components.terminal.xterm.black",
			"components.terminal.xterm.red",
			"components.terminal.xterm.green",
			"components.terminal.xterm.yellow",
			"components.terminal.xterm.blue",
			"components.terminal.xterm.magenta",
			"components.terminal.xterm.cyan",
			"components.terminal.xterm.white",
			"components.terminal.xterm.brightBlack",
			"components.terminal.xterm.brightRed",
			"components.terminal.xterm.brightGreen",
			"components.terminal.xterm.brightYellow",
			"components.terminal.xterm.brightBlue",
			"components.terminal.xterm.brightMagenta",
			"components.terminal.xterm.brightCyan",
			"components.terminal.xterm.brightWhite",
		},
	},
	{
		Name:    "terminal.container",
		Summary: "Affects terminal chrome around xterm, including status bar, command input bar, popups and context menus.",
		Paths: []string{
			"components.terminal.container.containerBg",
			"components.terminal.container.tint",
			"components.terminal.container.statusBarBg",
			"components.terminal.container.statusBarBorder",
			"components.terminal.container.statusBarColor",
			"components.terminal.container.serverNameColor",
			"components.terminal.container.inputBarBg",
			"components.terminal.container.inputBarBorder",
			"components.terminal.container.inputBg",
			"components.terminal.container.inputColor",
			"components.terminal.container.inputPlaceholder",
			"components.terminal.container.popupBg",
			"components.terminal.container.popupBorder",
			"components.terminal.container.popupShadow",
			"components.terminal.container.contextBg",
			"components.terminal.container.contextBorder",
			"components.terminal.container.contextShadow",
			"components.terminal.container.separator",
			"components.terminal.container.mutedColor",
			"components.terminal.container.btnBorder",
			"components.terminal.container.btnMuted",
		},
	},
	{
		Name:    "tabs",
		Summary: "Affects workspace tab strip colors only.",
		Paths: []string{
			"components.tabs.inactiveBg",
			"components.tabs.inactiveBgHover",
			"components.tabs.inactiveBorder",
			"components.tabs.inactiveText",
			"components.tabs.activeBg",
			"components.tabs.activeBorder",
			"components.tabs.activeText",
			"components.tabs.radius",
		},
	},
	{
		Name:    "fileManager",
		Summary: "Affects only the file manager main panel, toolbar, path input, list header, list rows and file name text colors.",
		Paths: []string{
			"components.fileManager.panelBg",
			"components.fileManager.toolbarBg",
			"components.fileManager.borderColor",
			"components.fileManager.rowHoverBg",
			"components.fileManager.selectedRowBg",
			"components.fileManager.textColor",
			"components.fileManager.secondaryTextColor",
			"components.fileManager.mutedTextColor",
			"components.fileManager.headerTextColor",
			"components.fileManager.pathBg",
			"components.fileManager.pathTextColor",
			"components.fileManager.folderTextColor",
		},
	},
	{
		Name:    "topbar",
		Summary: "Affects only the top application bar background, border and title text.",
		Paths: []string{
			"components.topbar.background",
			"components.topbar.borderBottomColor",
			"components.topbar.titleColor",
		},
	},
	{
		Name:    "quickCommands",
		Summary: "Affects only the quick commands panel, its inputs, menus and command list text colors.",
		Paths: []string{
			"components.quickCommands.panelBg",
			"components.quickCommands.borderColor",
			"components.quickCommands.textColor",
			"components.quickCommands.secondaryTextColor",
			"components.quickCommands.mutedTextColor",
			"components.quickCommands.inputBg",
			"components.quickCommands.inputBorderColor",
			"components.quickCommands.menuBg",
			"components.quickCommands.menuBorderColor",
			"components.quickCommands.separatorColor",
		},
	},
	{
		Name:    "connectingCard",
		Summary: "Affects only the SSH connecting overlay card, overlay backdrop and its progress/button colors.",
		Paths: []string{
			"components.connectingCard.overlayBg",
			"components.connectingCard.cardBg",
			"components.connectingCard.borderColor",
			"components.connectingCard.titleColor",
			"components.connectingCard.secondaryTextColor",
			"components.connectingCard.mutedTextColor",
			"components.connectingCard.buttonBg",
			"components.connectingCard.buttonTextColor",
			"components.connectingCard.progressTrackColor",
		},
	},
}

// ─── 导出函数（package main 调用） ────────────────────────────

func ThemeToolFieldMap() map[string]interface{} {
	components := map[string]interface{}{}
	for _, group := range themeToolPreviewFieldGroups {
		components[group.Name] = map[string]interface{}{
			"summary":       group.Summary,
			"editablePaths": append([]string{}, group.Paths...),
		}
	}
	return map[string]interface{}{
		"rules": map[string]interface{}{
			"globalTokensAllowed":       false,
			"previewScope":              "private_component_fields_only",
			"unsupportedFieldBehavior":  "block_preview",
			"inspectReturnsFullDraft":   true,
			"helpIncludesFieldMap":      true,
			"commitWritesUserThemeFile": true,
		},
		"components": components,
	}
}

func themeToolAllowedPreviewPaths() map[string]struct{} {
	result := map[string]struct{}{}
	for _, group := range themeToolPreviewFieldGroups {
		for _, path := range group.Paths {
			result[path] = struct{}{}
		}
	}
	return result
}

func themeToolHasAllowedPreviewPath(path string) bool {
	_, ok := themeToolAllowedPreviewPaths()[path]
	return ok
}

func themeToolSuggestedPathsFromPatch(patch map[string]interface{}) []string {
	suggestions := make([]string, 0)
	components, _ := patch["components"].(map[string]interface{})
	if len(components) == 0 {
		return suggestions
	}
	for _, group := range themeToolPreviewFieldGroups {
		switch group.Name {
		case "terminal.xterm":
			terminal, _ := components["terminal"].(map[string]interface{})
			if _, ok := terminal["xterm"]; ok {
				suggestions = append(suggestions, group.Paths...)
			}
		case "terminal.container":
			terminal, _ := components["terminal"].(map[string]interface{})
			if _, ok := terminal["container"]; ok {
				suggestions = append(suggestions, group.Paths...)
			}
		default:
			if _, ok := components[group.Name]; ok {
				suggestions = append(suggestions, group.Paths...)
			}
		}
	}
	return ThemeToolUniqueStrings(suggestions)
}

func ThemeToolValidatePreviewPatch(patch map[string]interface{}) ([]string, []string) {
	leafPaths := make([]string, 0)
	ThemeToolCollectPatchPaths("", patch, &leafPaths)
	leafPaths = ThemeToolUniqueStrings(leafPaths)
	if len(leafPaths) == 0 {
		return []string{"patch"}, []string{}
	}
	invalidPaths := make([]string, 0)
	for _, path := range leafPaths {
		if !strings.HasPrefix(path, "components.") {
			invalidPaths = append(invalidPaths, path)
			continue
		}
		if !themeToolHasAllowedPreviewPath(path) {
			invalidPaths = append(invalidPaths, path)
		}
	}
	return ThemeToolUniqueStrings(invalidPaths), themeToolSuggestedPathsFromPatch(patch)
}

func ThemeToolBuildPreviewBlockedWarnings(invalidPaths []string) []string {
	warnings := make([]string, 0, len(invalidPaths))
	for _, path := range invalidPaths {
		if strings.HasPrefix(path, "tokens.") {
			warnings = append(warnings, "global tokens are forbidden in AI theme tuning: "+path)
			continue
		}
		warnings = append(warnings, "unsupported or unconnected private field: "+path)
	}
	return ThemeToolUniqueStrings(warnings)
}

func ThemeToolUniqueStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func ThemeToolParseRequestObject(raw string) (map[string]interface{}, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return map[string]interface{}{}, nil
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return nil, fmt.Errorf("theme tool request must be valid JSON")
	}
	if parsed == nil {
		return map[string]interface{}{}, nil
	}
	return parsed, nil
}

func ThemeToolParsePatchObject(raw string) (map[string]interface{}, error) {
	parsed, err := ThemeToolParseRequestObject(raw)
	if err != nil {
		return nil, err
	}
	if patch, ok := parsed["patch"].(map[string]interface{}); ok {
		return patch, nil
	}
	return parsed, nil
}

func ThemeToolCollectPatchPaths(prefix string, value interface{}, paths *[]string) {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, nestedValue := range typed {
			nextPrefix := key
			if prefix != "" {
				nextPrefix = prefix + "." + key
			}
			ThemeToolCollectPatchPaths(nextPrefix, nestedValue, paths)
		}
	default:
		if strings.TrimSpace(prefix) != "" {
			*paths = append(*paths, prefix)
		}
	}
}

func ThemeToolBuildDraftID(slot string) string {
	return fmt.Sprintf("theme-draft-%s-%d", slot, time.Now().UnixMilli())
}

func ThemeToolBuildCommittedID(slot string) string {
	return fmt.Sprintf("ai-theme-%s-%d", slot, time.Now().UnixMilli())
}

func ThemeToolDefaultDraftName(name string) string {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return "Theme Draft"
	}
	if strings.HasSuffix(trimmedName, " Draft") {
		return trimmedName
	}
	return trimmedName + " Draft"
}

func ThemeToolDefaultCommitName(stateSlot string, draftName string) string {
	trimmedName := strings.TrimSpace(strings.TrimSuffix(draftName, " Draft"))
	if trimmedName != "" {
		return trimmedName
	}
	if stateSlot == "light" {
		return "AI Light Theme"
	}
	return "AI Dark Theme"
}
