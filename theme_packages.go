package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const themePackageSchemaVersion = 1
const defaultLightThemePackageID = "lumin-light"
const defaultDarkThemePackageID = "lumin-dark"

type ThemePackageSettings struct {
	ThemeMode          string `json:"themeMode,omitempty"`
	LightThemePackageID string `json:"lightThemePackageId,omitempty"`
	DarkThemePackageID  string `json:"darkThemePackageId,omitempty"`
	UpdatedAt           int64  `json:"updatedAt,omitempty"`
}

type ThemePackageFile struct {
	SchemaVersion int                    `json:"schemaVersion"`
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Description   string                 `json:"description,omitempty"`
	ModeHint      string                 `json:"modeHint,omitempty"`
	Tokens        map[string]string      `json:"tokens,omitempty"`
	Components    map[string]interface{} `json:"components,omitempty"`
	Resources     map[string]interface{} `json:"resources,omitempty"`
}

type ThemePackagePreview struct {
	SurfaceBase         string `json:"surfaceBase,omitempty"`
	SurfaceRaised       string `json:"surfaceRaised,omitempty"`
	Accent              string `json:"accent,omitempty"`
	TextPrimary         string `json:"textPrimary,omitempty"`
	TerminalBg          string `json:"terminalBg,omitempty"`
	TerminalFg          string `json:"terminalFg,omitempty"`
	TerminalStatusBg    string `json:"terminalStatusBg,omitempty"`
	TerminalStatusColor string `json:"terminalStatusColor,omitempty"`
}

type ThemePackageSummary struct {
	SchemaVersion int                    `json:"schemaVersion"`
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Description   string                 `json:"description,omitempty"`
	ModeHint      string                 `json:"modeHint,omitempty"`
	Source        string                 `json:"source"`
	Path          string                 `json:"path"`
	Preview       ThemePackagePreview    `json:"preview"`
	Tokens        map[string]string      `json:"tokens,omitempty"`
	Components    map[string]interface{} `json:"components,omitempty"`
	Resources     map[string]interface{} `json:"resources,omitempty"`
}

func normalizeThemeModeSetting(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "light":
		return "light"
	case "system":
		return "system"
	default:
		return "dark"
	}
}

func normalizeThemePackageModeHint(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "light":
		return "light"
	case "dark":
		return "dark"
	default:
		return ""
	}
}

func normalizeThemePackageID(value string) string {
	return strings.TrimSpace(value)
}

func cloneStringMap(source map[string]string) map[string]string {
	if len(source) == 0 {
		return map[string]string{}
	}
	cloned := make(map[string]string, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func cloneAnySlice(source []interface{}) []interface{} {
	if len(source) == 0 {
		return []interface{}{}
	}
	cloned := make([]interface{}, len(source))
	for index, value := range source {
		cloned[index] = cloneAnyValue(value)
	}
	return cloned
}

func cloneAnyMap(source map[string]interface{}) map[string]interface{} {
	if len(source) == 0 {
		return map[string]interface{}{}
	}
	cloned := make(map[string]interface{}, len(source))
	for key, value := range source {
		cloned[key] = cloneAnyValue(value)
	}
	return cloned
}

func cloneAnyValue(value interface{}) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		return cloneAnyMap(typed)
	case []interface{}:
		return cloneAnySlice(typed)
	default:
		return typed
	}
}

func mergeStringMaps(base map[string]string, override map[string]string) map[string]string {
	merged := cloneStringMap(base)
	for key, value := range override {
		if strings.TrimSpace(value) == "" {
			continue
		}
		merged[key] = value
	}
	return merged
}

func mergeAnyMaps(base map[string]interface{}, override map[string]interface{}) map[string]interface{} {
	merged := cloneAnyMap(base)
	for key, value := range override {
		if value == nil {
			continue
		}
		if currentMap, ok := merged[key].(map[string]interface{}); ok {
			if nextMap, ok := value.(map[string]interface{}); ok {
				merged[key] = mergeAnyMaps(currentMap, nextMap)
				continue
			}
		}
		merged[key] = cloneAnyValue(value)
	}
	return merged
}

func parseHexThemeColor(value string) (uint8, uint8, uint8, bool) {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) != 7 || !strings.HasPrefix(trimmed, "#") {
		return 0, 0, 0, false
	}
	hexValue := trimmed[1:]
	var rgb [3]uint8
	for index := 0; index < 3; index += 1 {
		part := hexValue[index*2 : index*2+2]
		var parsed uint8
		for _, char := range part {
			parsed <<= 4
			switch {
			case char >= '0' && char <= '9':
				parsed += uint8(char - '0')
			case char >= 'a' && char <= 'f':
				parsed += uint8(char-'a') + 10
			case char >= 'A' && char <= 'F':
				parsed += uint8(char-'A') + 10
			default:
				return 0, 0, 0, false
			}
		}
		rgb[index] = parsed
	}
	return rgb[0], rgb[1], rgb[2], true
}

func rgbaFromHexThemeColor(value string, alpha float64, fallback string) string {
	r, g, b, ok := parseHexThemeColor(value)
	if !ok {
		return fallback
	}
	return fmt.Sprintf("rgba(%d, %d, %d, %.2f)", r, g, b, alpha)
}

func rgbTripletFromHexThemeColor(value string, fallback string) string {
	r, g, b, ok := parseHexThemeColor(value)
	if !ok {
		return fallback
	}
	return fmt.Sprintf("%d, %d, %d", r, g, b)
}

func buildBaseThemeTokens(modeHint string, accent string) map[string]string {
	if normalizeThemePackageModeHint(modeHint) == "light" {
		return map[string]string{
			"surfaceBase":    "#f3f4f6",
			"surfaceRaised":  "#ffffff",
			"surfaceOverlay": "#ffffff",
			"surfaceSunken":  "#e9ecef",
			"surfaceHover":   "#e2e6eb",
			"surfaceActive":  "#d6dbe2",
			"border":         "rgba(28, 35, 45, 0.14)",
			"borderLight":    "rgba(28, 35, 45, 0.08)",
			"borderSubtle":   "rgba(28, 35, 45, 0.10)",
			"borderFocus":    accent,
			"textPrimary":    "#111827",
			"textSecondary":  "#334155",
			"textTertiary":   "#526176",
			"textMuted":      "#6b7a8f",
			"probeLabel":     "#1f2937",
			"probeDetail":    "#334155",
			"probeFaint":     "#526176",
			"accent":         accent,
			"accentRgb":      rgbTripletFromHexThemeColor(accent, "37, 99, 235"),
			"accentHover":    accent,
			"accentDim":      rgbaFromHexThemeColor(accent, 0.08, "rgba(37, 99, 235, 0.08)"),
			"accentBorder":   rgbaFromHexThemeColor(accent, 0.22, "rgba(37, 99, 235, 0.22)"),
			"success":        "#16a34a",
			"successRgb":     "22, 163, 74",
			"successDim":     "rgba(22, 163, 74, 0.08)",
			"danger":         "#dc2626",
			"dangerRgb":      "220, 38, 38",
			"dangerDim":      "rgba(220, 38, 38, 0.08)",
			"warning":        "#ca8a04",
			"warningRgb":     "202, 138, 4",
			"warningDim":     "rgba(202, 138, 4, 0.08)",
			"info":           "#7c3aed",
			"infoRgb":        "124, 58, 237",
			"infoDim":        "rgba(124, 58, 237, 0.08)",
			"fileIconShell":  "#15803d",
		}
	}
	return map[string]string{
		"surfaceBase":    "#0f1319",
		"surfaceRaised":  "#141a23",
		"surfaceOverlay": "#1a2130",
		"surfaceSunken":  "#1b2230",
		"surfaceHover":   "#243042",
		"surfaceActive":  "#2c384c",
		"border":         "rgba(72, 86, 110, 0.55)",
		"borderLight":    "rgba(72, 86, 110, 0.28)",
		"borderSubtle":   "rgba(72, 86, 110, 0.32)",
		"borderFocus":    accent,
		"textPrimary":    "#eef3f9",
		"textSecondary":  "#c8d1dd",
		"textTertiary":   "#a0aabc",
		"textMuted":      "#7a8698",
		"probeLabel":     "#d8e0ea",
		"probeDetail":    "#b9c4d2",
		"probeFaint":     "#93a0b2",
		"accent":         accent,
		"accentRgb":      rgbTripletFromHexThemeColor(accent, "77, 158, 255"),
		"accentHover":    accent,
		"accentDim":      rgbaFromHexThemeColor(accent, 0.12, "rgba(77, 158, 255, 0.12)"),
		"accentBorder":   rgbaFromHexThemeColor(accent, 0.28, "rgba(77, 158, 255, 0.28)"),
		"success":        "#3fb950",
		"successRgb":     "63, 185, 80",
		"successDim":     "rgba(63, 185, 80, 0.12)",
		"danger":         "#f87171",
		"dangerRgb":      "248, 113, 113",
		"dangerDim":      "rgba(248, 113, 113, 0.12)",
		"warning":        "#d9a434",
		"warningRgb":     "217, 164, 52",
		"warningDim":     "rgba(217, 164, 52, 0.12)",
		"info":           "#a78bfa",
		"infoRgb":        "167, 139, 250",
		"infoDim":        "rgba(167, 139, 250, 0.12)",
		"fileIconShell":  "#89e051",
	}
}

func buildTabsComponent(modeHint string) map[string]interface{} {
	if normalizeThemePackageModeHint(modeHint) == "light" {
		return map[string]interface{}{
			"inactiveBg":      "#e4e8ee",
			"inactiveBgHover": "#d8dee6",
			"inactiveBorder":  "rgba(28, 35, 45, 0.16)",
			"inactiveText":    "#1f2937",
			"activeBg":        "color-mix(in srgb, var(--accent) 14%, #ffffff)",
			"activeBorder":    "color-mix(in srgb, var(--accent) 42%, var(--border))",
			"activeText":      "#0f172a",
			"radius":          "0",
		}
	}
	return map[string]interface{}{
		"inactiveBg":      "var(--surface-active)",
		"inactiveBgHover": "color-mix(in srgb, var(--surface-active) 82%, var(--accent) 8%)",
		"inactiveBorder":  "color-mix(in srgb, var(--border) 88%, #6b7a90)",
		"inactiveText":    "var(--text-primary)",
		"activeBg":        "color-mix(in srgb, var(--accent) 18%, var(--surface-raised))",
		"activeBorder":    "color-mix(in srgb, var(--accent) 48%, var(--border))",
		"activeText":      "var(--text-primary)",
		"radius":          "0",
	}
}

func buildTerminalComponent(xterm map[string]string, container map[string]string) map[string]interface{} {
	return map[string]interface{}{
		"xterm": func() map[string]interface{} {
			next := make(map[string]interface{}, len(xterm))
			for key, value := range xterm {
				next[key] = value
			}
			return next
		}(),
		"container": func() map[string]interface{} {
			next := make(map[string]interface{}, len(container))
			for key, value := range container {
				next[key] = value
			}
			return next
		}(),
	}
}

func buildBuiltinThemePackage(id string, name string, description string, modeHint string, accent string, terminalComponent map[string]interface{}) ThemePackageFile {
	return ThemePackageFile{
		SchemaVersion: themePackageSchemaVersion,
		ID:            id,
		Name:          name,
		Description:   description,
		ModeHint:      modeHint,
		Tokens:        buildBaseThemeTokens(modeHint, accent),
		Components: map[string]interface{}{
			"tabs":     buildTabsComponent(modeHint),
			"terminal": cloneAnyMap(terminalComponent),
		},
		Resources: map[string]interface{}{},
	}
}

func buildBuiltinThemePackages() []ThemePackageFile {
	return []ThemePackageFile{
		buildBuiltinThemePackage(
			"lumin-dark",
			"天青",
			"默认蓝调深色",
			"dark",
			"#4d9eff",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#e6edf3",
					"cursor":                      "#4d9eff",
					"cursorAccent":                "#0e1218",
					"selectionBackground":         "#2563eb",
					"selectionForeground":         "#ffffff",
					"selectionInactiveBackground": "#2563eb",
					"black":                       "#484f58",
					"red":                         "#ff6b6b",
					"green":                       "#3dd68c",
					"yellow":                      "#ffcc33",
					"blue":                        "#6cb6ff",
					"magenta":                     "#d2a8ff",
					"cyan":                        "#39d0d6",
					"white":                       "#d0d7de",
					"brightBlack":                 "#8b949e",
					"brightRed":                   "#ff8a80",
					"brightGreen":                 "#56f09c",
					"brightYellow":                "#ffe066",
					"brightBlue":                  "#91cbff",
					"brightMagenta":               "#e2b6ff",
					"brightCyan":                  "#5ce1e6",
					"brightWhite":                 "#ffffff",
				},
				map[string]string{
					"containerBg":     "#0b111a",
					"tint":            "rgba(77, 158, 255, 0.10)",
					"statusBarBg":     "rgba(12, 28, 48, 0.96)",
					"statusBarBorder": "1px solid rgba(77,158,255,0.42)",
					"statusBarColor":  "#4d9eff",
					"serverNameColor": "#eaf0f7",
					"inputBarBg":      "rgba(12, 28, 48, 0.98)",
					"inputBarBorder":  "1px solid rgba(77,158,255,0.36)",
					"inputBg":         "rgba(8, 18, 32, 0.94)",
					"inputColor":      "#eaf0f7",
					"inputPlaceholder": "#5a6578",
					"popupBg":         "#121a26",
					"popupBorder":     "1px solid rgba(77,158,255,0.28)",
					"popupShadow":     "0 -8px 32px rgba(0,5,20,0.5), 0 2px 8px rgba(0,5,20,0.3)",
					"contextBg":       "#121a26",
					"contextBorder":   "1px solid rgba(77,158,255,0.28)",
					"contextShadow":   "0 8px 32px rgba(0,5,20,0.6), 0 2px 8px rgba(0,5,20,0.4)",
					"separator":       "rgba(77,158,255,0.22)",
					"mutedColor":      "#5a6578",
					"btnBorder":       "rgba(77,158,255,0.28)",
					"btnMuted":        "#5a6578",
				},
			),
		),
		buildBuiltinThemePackage(
			"lumin-light",
			"天青",
			"默认蓝调浅色",
			"light",
			"#2563eb",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#0f172a",
					"cursor":                      "#2563eb",
					"cursorAccent":                "#ffffff",
					"selectionBackground":         "#2563eb",
					"selectionForeground":         "#ffffff",
					"selectionInactiveBackground": "#2563eb",
					"black":                       "#0a0f1a",
					"red":                         "#b91c1c",
					"green":                       "#15803d",
					"yellow":                      "#854d0e",
					"blue":                        "#1d4ed8",
					"magenta":                     "#7e22ce",
					"cyan":                        "#0f766e",
					"white":                       "#e2e8f0",
					"brightBlack":                 "#475569",
					"brightRed":                   "#dc2626",
					"brightGreen":                 "#16a34a",
					"brightYellow":                "#a16207",
					"brightBlue":                  "#2563eb",
					"brightMagenta":               "#9333ea",
					"brightCyan":                  "#0891b2",
					"brightWhite":                 "#f8fafc",
				},
				map[string]string{
					"containerBg":     "#f7f9fc",
					"tint":            "rgba(37, 99, 235, 0.10)",
					"statusBarBg":     "rgba(232, 240, 254, 0.98)",
					"statusBarBorder": "1px solid rgba(37,99,235,0.38)",
					"statusBarColor":  "#1d4ed8",
					"serverNameColor": "#0f172a",
					"inputBarBg":      "rgba(232, 240, 254, 0.98)",
					"inputBarBorder":  "1px solid rgba(37,99,235,0.30)",
					"inputBg":         "rgba(255,255,255,0.95)",
					"inputColor":      "#0f172a",
					"inputPlaceholder": "#64748b",
					"popupBg":         "#ffffff",
					"popupBorder":     "1px solid rgba(37,99,235,0.22)",
					"popupShadow":     "0 -8px 32px rgba(28,25,23,0.1), 0 2px 8px rgba(28,25,23,0.06)",
					"contextBg":       "#ffffff",
					"contextBorder":   "1px solid rgba(37,99,235,0.22)",
					"contextShadow":   "0 8px 32px rgba(28,25,23,0.12), 0 2px 8px rgba(28,25,23,0.06)",
					"separator":       "rgba(37,99,235,0.16)",
					"mutedColor":      "#64748b",
					"btnBorder":       "rgba(37,99,235,0.24)",
					"btnMuted":        "#64748b",
				},
			),
		),
		buildBuiltinThemePackage(
			"tokyo-night-dark",
			"夜空",
			"靛蓝夜色",
			"dark",
			"#7aa2f7",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#c0caf5",
					"cursor":                      "#7aa2f7",
					"cursorAccent":                "#1a1b26",
					"selectionBackground":         "#3d59a1",
					"selectionForeground":         "#ffffff",
					"selectionInactiveBackground": "#3d59a1",
					"black":                       "#32344a",
					"red":                         "#ff7a93",
					"green":                       "#9ece6a",
					"yellow":                      "#e0af68",
					"blue":                        "#7aa2f7",
					"magenta":                     "#bb9af7",
					"cyan":                        "#7dcfff",
					"white":                       "#a9b1d6",
					"brightBlack":                 "#565f89",
					"brightRed":                   "#ff9db0",
					"brightGreen":                 "#b9f27c",
					"brightYellow":                "#ffc777",
					"brightBlue":                  "#89b4fa",
					"brightMagenta":               "#cbb2ff",
					"brightCyan":                  "#89ddff",
					"brightWhite":                 "#ffffff",
				},
				map[string]string{
					"containerBg":     "#161821",
					"tint":            "rgba(122, 162, 247, 0.12)",
					"statusBarBg":     "rgba(28, 32, 58, 0.97)",
					"statusBarBorder": "1px solid rgba(122,162,247,0.48)",
					"statusBarColor":  "#7aa2f7",
					"serverNameColor": "#c0caf5",
					"inputBarBg":      "rgba(28, 32, 58, 0.98)",
					"inputBarBorder":  "1px solid rgba(122,162,247,0.40)",
					"inputBg":         "rgba(18, 22, 40, 0.94)",
					"inputColor":      "#c0caf5",
					"inputPlaceholder": "#565f89",
					"popupBg":         "#1a1b2e",
					"popupBorder":     "1px solid rgba(122,162,247,0.32)",
					"popupShadow":     "0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
					"contextBg":       "#1a1b2e",
					"contextBorder":   "1px solid rgba(122,162,247,0.32)",
					"contextShadow":   "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
					"separator":       "rgba(122,162,247,0.24)",
					"mutedColor":      "#565f89",
					"btnBorder":       "rgba(122,162,247,0.30)",
					"btnMuted":        "#565f89",
				},
			),
		),
		buildBuiltinThemePackage(
			"tokyo-night-light",
			"晨雾",
			"蓝灰浅色",
			"light",
			"#1d4ed8",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#1f2335",
					"cursor":                      "#1d4ed8",
					"cursorAccent":                "#ffffff",
					"selectionBackground":         "#1d4ed8",
					"selectionForeground":         "#ffffff",
					"selectionInactiveBackground": "#1d4ed8",
					"black":                       "#0c0e18",
					"red":                         "#b8344e",
					"green":                       "#286214",
					"yellow":                      "#724905",
					"blue":                        "#1d57c4",
					"magenta":                     "#7a30cb",
					"cyan":                        "#005b76",
					"white":                       "#d5d9e8",
					"brightBlack":                 "#444b6a",
					"brightRed":                   "#cf2d4c",
					"brightGreen":                 "#387a21",
					"brightYellow":                "#8f5e15",
					"brightBlue":                  "#245fcb",
					"brightMagenta":               "#8536f5",
					"brightCyan":                  "#007197",
					"brightWhite":                 "#f4f5f9",
				},
				map[string]string{
					"containerBg":     "#e8ecf7",
					"tint":            "rgba(61, 89, 161, 0.14)",
					"statusBarBg":     "rgba(214, 222, 245, 0.98)",
					"statusBarBorder": "1px solid rgba(61,89,161,0.42)",
					"statusBarColor":  "#1d4ed8",
					"serverNameColor": "#1f2335",
					"inputBarBg":      "rgba(214, 222, 245, 0.98)",
					"inputBarBorder":  "1px solid rgba(61,89,161,0.34)",
					"inputBg":         "rgba(255,255,255,0.94)",
					"inputColor":      "#1f2335",
					"inputPlaceholder": "#5b6388",
					"popupBg":         "#eef1f8",
					"popupBorder":     "1px solid rgba(61,89,161,0.28)",
					"popupShadow":     "0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)",
					"contextBg":       "#eef1f8",
					"contextBorder":   "1px solid rgba(61,89,161,0.28)",
					"contextShadow":   "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
					"separator":       "rgba(61,89,161,0.18)",
					"mutedColor":      "#5b6388",
					"btnBorder":       "rgba(61,89,161,0.28)",
					"btnMuted":        "#5b6388",
				},
			),
		),
		buildBuiltinThemePackage(
			"catppuccin-dark",
			"紫雾",
			"淡紫深色",
			"dark",
			"#cba6f7",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#cdd6f4",
					"cursor":                      "#f5c2e7",
					"cursorAccent":                "#1e1e2e",
					"selectionBackground":         "#7c3aed",
					"selectionForeground":         "#ffffff",
					"selectionInactiveBackground": "#7c3aed",
					"black":                       "#45475a",
					"red":                         "#f38ba8",
					"green":                       "#a6e3a1",
					"yellow":                      "#f9e2af",
					"blue":                        "#89b4fa",
					"magenta":                     "#f5c2e7",
					"cyan":                        "#94e2d5",
					"white":                       "#cdd6f4",
					"brightBlack":                 "#6c7086",
					"brightRed":                   "#f38ba8",
					"brightGreen":                 "#b4f0a7",
					"brightYellow":                "#ffe6a8",
					"brightBlue":                  "#a6c8ff",
					"brightMagenta":               "#f5c2e7",
					"brightCyan":                  "#a6f0e2",
					"brightWhite":                 "#ffffff",
				},
				map[string]string{
					"containerBg":     "#181825",
					"tint":            "rgba(203, 166, 247, 0.12)",
					"statusBarBg":     "rgba(36, 28, 52, 0.97)",
					"statusBarBorder": "1px solid rgba(203,166,247,0.50)",
					"statusBarColor":  "#cba6f7",
					"serverNameColor": "#cdd6f4",
					"inputBarBg":      "rgba(36, 28, 52, 0.98)",
					"inputBarBorder":  "1px solid rgba(203,166,247,0.42)",
					"inputBg":         "rgba(26, 22, 40, 0.94)",
					"inputColor":      "#cdd6f4",
					"inputPlaceholder": "#6c7086",
					"popupBg":         "#1e1e2e",
					"popupBorder":     "1px solid rgba(203,166,247,0.34)",
					"popupShadow":     "0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
					"contextBg":       "#1e1e2e",
					"contextBorder":   "1px solid rgba(203,166,247,0.34)",
					"contextShadow":   "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
					"separator":       "rgba(203,166,247,0.24)",
					"mutedColor":      "#6c7086",
					"btnBorder":       "rgba(203,166,247,0.30)",
					"btnMuted":        "#6c7086",
				},
			),
		),
		buildBuiltinThemePackage(
			"catppuccin-light",
			"丁香",
			"淡紫浅色",
			"light",
			"#8839ef",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#2c2f3a",
					"cursor":                      "#d20f39",
					"cursorAccent":                "#ffffff",
					"selectionBackground":         "#1e66f5",
					"selectionForeground":         "#ffffff",
					"selectionInactiveBackground": "#1e66f5",
					"black":                       "#11111b",
					"red":                         "#d20f39",
					"green":                       "#40a02b",
					"yellow":                      "#df8e1d",
					"blue":                        "#1e66f5",
					"magenta":                     "#8839ef",
					"cyan":                        "#179299",
					"white":                       "#dce0e8",
					"brightBlack":                 "#6c6f85",
					"brightRed":                   "#e64553",
					"brightGreen":                 "#40a02b",
					"brightYellow":                "#df8e1d",
					"brightBlue":                  "#04a5e5",
					"brightMagenta":               "#ea76cb",
					"brightCyan":                  "#209fb5",
					"brightWhite":                 "#eff1f5",
				},
				map[string]string{
					"containerBg":     "#eff1f5",
					"tint":            "rgba(136, 57, 239, 0.06)",
					"statusBarBg":     "rgba(220, 214, 240, 0.98)",
					"statusBarBorder": "1px solid rgba(136,57,239,0.45)",
					"statusBarColor":  "#8839ef",
					"serverNameColor": "#2c2f3a",
					"inputBarBg":      "rgba(220, 214, 240, 0.98)",
					"inputBarBorder":  "1px solid rgba(136,57,239,0.36)",
					"inputBg":         "rgba(255,255,255,0.96)",
					"inputColor":      "#2c2f3a",
					"inputPlaceholder": "#6c6f85",
					"popupBg":         "#eff1f5",
					"popupBorder":     "1px solid rgba(136,57,239,0.30)",
					"popupShadow":     "0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)",
					"contextBg":       "#eff1f5",
					"contextBorder":   "1px solid rgba(136,57,239,0.30)",
					"contextShadow":   "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
					"separator":       "rgba(136,57,239,0.20)",
					"mutedColor":      "#6c6f85",
					"btnBorder":       "rgba(136,57,239,0.30)",
					"btnMuted":        "#6c6f85",
				},
			),
		),
		buildBuiltinThemePackage(
			"dracula-dark",
			"粉紫",
			"粉紫深色",
			"dark",
			"#ff79c6",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#f8f8f2",
					"cursor":                      "#f8f8f2",
					"cursorAccent":                "#282a36",
					"selectionBackground":         "#bd93f9",
					"selectionForeground":         "#1e1f29",
					"selectionInactiveBackground": "#bd93f9",
					"black":                       "#21222c",
					"red":                         "#ff5555",
					"green":                       "#50fa7b",
					"yellow":                      "#f1fa8c",
					"blue":                        "#bd93f9",
					"magenta":                     "#ff79c6",
					"cyan":                        "#8be9fd",
					"white":                       "#f8f8f2",
					"brightBlack":                 "#6272a4",
					"brightRed":                   "#ff6e6e",
					"brightGreen":                 "#69ff94",
					"brightYellow":                "#ffffa5",
					"brightBlue":                  "#d6acff",
					"brightMagenta":               "#ff92df",
					"brightCyan":                  "#a4ffff",
					"brightWhite":                 "#ffffff",
				},
				map[string]string{
					"containerBg":     "#2b2d3a",
					"tint":            "rgba(255, 121, 198, 0.10)",
					"statusBarBg":     "rgba(52, 42, 66, 0.97)",
					"statusBarBorder": "1px solid rgba(255,121,198,0.48)",
					"statusBarColor":  "#ff79c6",
					"serverNameColor": "#f8f8f2",
					"inputBarBg":      "rgba(52, 42, 66, 0.98)",
					"inputBarBorder":  "1px solid rgba(189,147,249,0.40)",
					"inputBg":         "rgba(40, 34, 54, 0.94)",
					"inputColor":      "#f8f8f2",
					"inputPlaceholder": "#6272a4",
					"popupBg":         "#2b2d3a",
					"popupBorder":     "1px solid rgba(189,147,249,0.34)",
					"popupShadow":     "0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
					"contextBg":       "#2b2d3a",
					"contextBorder":   "1px solid rgba(189,147,249,0.34)",
					"contextShadow":   "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
					"separator":       "rgba(255,121,198,0.22)",
					"mutedColor":      "#6272a4",
					"btnBorder":       "rgba(255,121,198,0.30)",
					"btnMuted":        "#6272a4",
				},
			),
		),
		buildBuiltinThemePackage(
			"dracula-light",
			"玫粉",
			"粉紫浅色",
			"light",
			"#be185d",
			buildTerminalComponent(
				map[string]string{
					"background":                  "#00000000",
					"foreground":                  "#1f1f2e",
					"cursor":                      "#be185d",
					"cursorAccent":                "#ffffff",
					"selectionBackground":         "#7c3aed",
					"selectionForeground":         "#ffffff",
					"selectionInactiveBackground": "#7c3aed",
					"black":                       "#0a0a0f",
					"red":                         "#b91c1c",
					"green":                       "#15803d",
					"yellow":                      "#854d0e",
					"blue":                        "#6d28d9",
					"magenta":                     "#be185d",
					"cyan":                        "#0e7490",
					"white":                       "#9ca3af",
					"brightBlack":                 "#4b5563",
					"brightRed":                   "#dc2626",
					"brightGreen":                 "#16a34a",
					"brightYellow":                "#a16207",
					"brightBlue":                  "#5b21b6",
					"brightMagenta":               "#9d174d",
					"brightCyan":                  "#007788",
					"brightWhite":                 "#f3f4f6",
				},
				map[string]string{
					"containerBg":     "#f4f4f5",
					"tint":            "rgba(219, 39, 119, 0.03)",
					"statusBarBg":     "rgba(253, 242, 248, 0.98)",
					"statusBarBorder": "1px solid rgba(190,24,93,0.40)",
					"statusBarColor":  "#be185d",
					"serverNameColor": "#1f1f2e",
					"inputBarBg":      "rgba(253, 242, 248, 0.98)",
					"inputBarBorder":  "1px solid rgba(124,58,237,0.32)",
					"inputBg":         "rgba(255,255,255,0.97)",
					"inputColor":      "#1f1f2e",
					"inputPlaceholder": "#6b7280",
					"popupBg":         "#fafafa",
					"popupBorder":     "1px solid rgba(124,58,237,0.26)",
					"popupShadow":     "0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)",
					"contextBg":       "#fafafa",
					"contextBorder":   "1px solid rgba(124,58,237,0.26)",
					"contextShadow":   "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
					"separator":       "rgba(190,24,93,0.16)",
					"mutedColor":      "#6b7280",
					"btnBorder":       "rgba(190,24,93,0.26)",
					"btnMuted":        "#6b7280",
				},
			),
		),
	}
}

func getBuiltinThemePackageByID(id string) (ThemePackageFile, bool) {
	for _, item := range buildBuiltinThemePackages() {
		if item.ID == id {
			return item, true
		}
	}
	return ThemePackageFile{}, false
}

func inferThemePackageModeHint(item ThemePackageFile) string {
	if modeHint := normalizeThemePackageModeHint(item.ModeHint); modeHint != "" {
		return modeHint
	}
	switch {
	case strings.HasSuffix(item.ID, "-light"):
		return "light"
	case strings.HasSuffix(item.ID, "-dark"):
		return "dark"
	default:
		return "dark"
	}
}

func defaultThemePackageForMode(modeHint string) ThemePackageFile {
	if normalizeThemePackageModeHint(modeHint) == "light" {
		if item, ok := getBuiltinThemePackageByID(defaultLightThemePackageID); ok {
			return item
		}
	}
	if item, ok := getBuiltinThemePackageByID(defaultDarkThemePackageID); ok {
		return item
	}
	return ThemePackageFile{
		SchemaVersion: themePackageSchemaVersion,
		ID:            defaultDarkThemePackageID,
		Name:          "天青",
		ModeHint:      "dark",
		Tokens:        buildBaseThemeTokens("dark", "#4d9eff"),
		Components: map[string]interface{}{
			"tabs": buildTabsComponent("dark"),
		},
		Resources: map[string]interface{}{},
	}
}

func validateThemePackageFile(item *ThemePackageFile) error {
	if item == nil {
		return fmt.Errorf("theme package is nil")
	}
	if item.SchemaVersion != themePackageSchemaVersion {
		return fmt.Errorf("unsupported schemaVersion: %d", item.SchemaVersion)
	}
	item.ID = normalizeThemePackageID(item.ID)
	item.Name = strings.TrimSpace(item.Name)
	item.Description = strings.TrimSpace(item.Description)
	item.ModeHint = inferThemePackageModeHint(*item)
	if item.ID == "" {
		return fmt.Errorf("missing theme package id")
	}
	if item.Name == "" {
		return fmt.Errorf("missing theme package name")
	}
	if item.Tokens == nil {
		item.Tokens = map[string]string{}
	}
	if item.Components == nil {
		item.Components = map[string]interface{}{}
	}
	if item.Resources == nil {
		item.Resources = map[string]interface{}{}
	}
	return nil
}

func mergeThemePackageWithDefaults(item ThemePackageFile) ThemePackageFile {
	modeHint := inferThemePackageModeHint(item)
	defaultItem := defaultThemePackageForMode(modeHint)
	item.SchemaVersion = themePackageSchemaVersion
	item.ModeHint = modeHint
	item.Tokens = mergeStringMaps(defaultItem.Tokens, item.Tokens)
	item.Components = mergeAnyMaps(defaultItem.Components, item.Components)
	item.Resources = mergeAnyMaps(defaultItem.Resources, item.Resources)
	return item
}

func themePackageNestedString(source map[string]interface{}, keys ...string) string {
	current := interface{}(source)
	for _, key := range keys {
		currentMap, ok := current.(map[string]interface{})
		if !ok {
			return ""
		}
		current, ok = currentMap[key]
		if !ok {
			return ""
		}
	}
	switch typed := current.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func buildThemePackagePreview(item ThemePackageFile) ThemePackagePreview {
	return ThemePackagePreview{
		SurfaceBase:         strings.TrimSpace(item.Tokens["surfaceBase"]),
		SurfaceRaised:       strings.TrimSpace(item.Tokens["surfaceRaised"]),
		Accent:              strings.TrimSpace(item.Tokens["accent"]),
		TextPrimary:         strings.TrimSpace(item.Tokens["textPrimary"]),
		TerminalBg:          themePackageNestedString(item.Components, "terminal", "container", "containerBg"),
		TerminalFg:          themePackageNestedString(item.Components, "terminal", "xterm", "foreground"),
		TerminalStatusBg:    themePackageNestedString(item.Components, "terminal", "container", "statusBarBg"),
		TerminalStatusColor: themePackageNestedString(item.Components, "terminal", "container", "statusBarColor"),
	}
}

func themePackageSummaryToMap(item ThemePackageSummary) map[string]interface{} {
	return map[string]interface{}{
		"schemaVersion": item.SchemaVersion,
		"id":            item.ID,
		"name":          item.Name,
		"description":   item.Description,
		"modeHint":      item.ModeHint,
		"source":        item.Source,
		"path":          item.Path,
		"preview": map[string]interface{}{
			"surfaceBase":         item.Preview.SurfaceBase,
			"surfaceRaised":       item.Preview.SurfaceRaised,
			"accent":              item.Preview.Accent,
			"textPrimary":         item.Preview.TextPrimary,
			"terminalBg":          item.Preview.TerminalBg,
			"terminalFg":          item.Preview.TerminalFg,
			"terminalStatusBg":    item.Preview.TerminalStatusBg,
			"terminalStatusColor": item.Preview.TerminalStatusColor,
		},
		"tokens":     cloneStringMap(item.Tokens),
		"components": cloneAnyMap(item.Components),
		"resources":  cloneAnyMap(item.Resources),
	}
}

func themePackageSettingsToMap(item ThemePackageSettings) map[string]interface{} {
	return map[string]interface{}{
		"themeMode":          item.ThemeMode,
		"lightThemePackageId": item.LightThemePackageID,
		"darkThemePackageId":  item.DarkThemePackageID,
		"updatedAt":           item.UpdatedAt,
	}
}

func ensureBuiltinThemePackagesDirectory() (string, error) {
	programDirectory := strings.TrimSpace(getProgramDirectory())
	if programDirectory == "" {
		return "", fmt.Errorf("program directory unavailable")
	}
	targetDirectory := filepath.Join(programDirectory, "themes")
	if err := os.MkdirAll(targetDirectory, 0o755); err != nil {
		return "", err
	}
	for _, item := range buildBuiltinThemePackages() {
		data, err := json.MarshalIndent(item, "", "  ")
		if err != nil {
			return "", err
		}
		targetPath := filepath.Join(targetDirectory, item.ID+".json")
		if err := atomicWriteFile(targetPath, data, 0o644); err != nil {
			return "", err
		}
	}
	return targetDirectory, nil
}

func (c *ConfigManager) ensureUserThemePackagesDirectory() (string, error) {
	if c == nil || strings.TrimSpace(c.configDir) == "" {
		return "", fmt.Errorf("config directory unavailable")
	}
	targetDirectory := filepath.Join(c.configDir, "themes")
	if err := os.MkdirAll(targetDirectory, 0o755); err != nil {
		return "", err
	}
	return targetDirectory, nil
}

func readThemePackageSummaryFromFile(path string, source string) (ThemePackageSummary, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ThemePackageSummary{}, err
	}
	var item ThemePackageFile
	if err := json.Unmarshal(data, &item); err != nil {
		return ThemePackageSummary{}, err
	}
	if err := validateThemePackageFile(&item); err != nil {
		return ThemePackageSummary{}, err
	}
	merged := mergeThemePackageWithDefaults(item)
	return ThemePackageSummary{
		SchemaVersion: merged.SchemaVersion,
		ID:            merged.ID,
		Name:          merged.Name,
		Description:   merged.Description,
		ModeHint:      merged.ModeHint,
		Source:        source,
		Path:          path,
		Preview:       buildThemePackagePreview(merged),
		Tokens:        cloneStringMap(merged.Tokens),
		Components:    cloneAnyMap(merged.Components),
		Resources:     cloneAnyMap(merged.Resources),
	}, nil
}

func listThemePackagesFromDirectory(directory string, source string) ([]ThemePackageSummary, error) {
	if strings.TrimSpace(directory) == "" {
		return []ThemePackageSummary{}, nil
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		if os.IsNotExist(err) {
			return []ThemePackageSummary{}, nil
		}
		return nil, err
	}
	result := make([]ThemePackageSummary, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".json" {
			continue
		}
		summary, err := readThemePackageSummaryFromFile(filepath.Join(directory, entry.Name()), source)
		if err != nil {
			continue
		}
		result = append(result, summary)
	}
	return result, nil
}

func (c *ConfigManager) ListThemePackages() ([]ThemePackageSummary, error) {
	builtinDirectory, err := ensureBuiltinThemePackagesDirectory()
	if err != nil {
		return nil, err
	}
	userDirectory, err := c.ensureUserThemePackagesDirectory()
	if err != nil {
		return nil, err
	}
	builtinPackages, err := listThemePackagesFromDirectory(builtinDirectory, "builtin")
	if err != nil {
		return nil, err
	}
	userPackages, err := listThemePackagesFromDirectory(userDirectory, "user")
	if err != nil {
		return nil, err
	}
	ordered := make([]ThemePackageSummary, 0, len(builtinPackages)+len(userPackages))
	seen := map[string]int{}
	for _, item := range builtinPackages {
		if item.ID == "" {
			continue
		}
		seen[item.ID] = len(ordered)
		ordered = append(ordered, item)
	}
	for _, item := range userPackages {
		if item.ID == "" {
			continue
		}
		if index, ok := seen[item.ID]; ok {
			ordered[index] = item
			continue
		}
		seen[item.ID] = len(ordered)
		ordered = append(ordered, item)
	}
	sort.SliceStable(ordered, func(left, right int) bool {
		if ordered[left].Source != ordered[right].Source {
			return ordered[left].Source < ordered[right].Source
		}
		if ordered[left].ModeHint != ordered[right].ModeHint {
			return ordered[left].ModeHint < ordered[right].ModeHint
		}
		return strings.ToLower(ordered[left].Name) < strings.ToLower(ordered[right].Name)
	})
	return ordered, nil
}

func (c *ConfigManager) GetThemePackagesDirectory() (string, error) {
	return c.ensureUserThemePackagesDirectory()
}

func (c *ConfigManager) GetThemePackageSettings() ThemePackageSettings {
	c.mu.RLock()
	defer c.mu.RUnlock()
	settings := c.getAppSettingsLocked()
	current := settings.ThemePackages
	current.ThemeMode = normalizeThemeModeSetting(current.ThemeMode)
	current.LightThemePackageID = normalizeThemePackageID(current.LightThemePackageID)
	current.DarkThemePackageID = normalizeThemePackageID(current.DarkThemePackageID)
	if current.LightThemePackageID == "" {
		current.LightThemePackageID = defaultLightThemePackageID
	}
	if current.DarkThemePackageID == "" {
		current.DarkThemePackageID = defaultDarkThemePackageID
	}
	return current
}

func (c *ConfigManager) SaveThemePackageSettings(nextSettings ThemePackageSettings) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	appSettings := c.getAppSettingsLocked()
	nextSettings.ThemeMode = normalizeThemeModeSetting(nextSettings.ThemeMode)
	nextSettings.LightThemePackageID = normalizeThemePackageID(nextSettings.LightThemePackageID)
	nextSettings.DarkThemePackageID = normalizeThemePackageID(nextSettings.DarkThemePackageID)
	if nextSettings.LightThemePackageID == "" {
		nextSettings.LightThemePackageID = defaultLightThemePackageID
	}
	if nextSettings.DarkThemePackageID == "" {
		nextSettings.DarkThemePackageID = defaultDarkThemePackageID
	}
	nextSettings.UpdatedAt = time.Now().UnixMilli()
	appSettings.ThemePackages = nextSettings
	return c.saveAppSettingsLocked(appSettings)
}

func (c *ConfigManager) ImportThemePackageFiles(paths []string) ([]ThemePackageSummary, error) {
	userDirectory, err := c.ensureUserThemePackagesDirectory()
	if err != nil {
		return nil, err
	}
	imported := make([]ThemePackageSummary, 0, len(paths))
	seenFileNames := map[string]bool{}
	for _, rawPath := range paths {
		cleanedPath := filepath.Clean(strings.TrimSpace(rawPath))
		if cleanedPath == "" {
			continue
		}
		fileName := filepath.Base(cleanedPath)
		if strings.ToLower(filepath.Ext(fileName)) != ".json" {
			return nil, fmt.Errorf("unsupported theme package file: %s", fileName)
		}
		if seenFileNames[fileName] {
			continue
		}
		seenFileNames[fileName] = true
		data, err := os.ReadFile(cleanedPath)
		if err != nil {
			return nil, err
		}
		var item ThemePackageFile
		if err := json.Unmarshal(data, &item); err != nil {
			return nil, err
		}
		if err := validateThemePackageFile(&item); err != nil {
			return nil, err
		}
		targetPath := filepath.Join(userDirectory, fileName)
		if err := atomicWriteFile(targetPath, data, 0o644); err != nil {
			return nil, err
		}
		summary, err := readThemePackageSummaryFromFile(targetPath, "user")
		if err != nil {
			return nil, err
		}
		imported = append(imported, summary)
	}
	return imported, nil
}

func (c *ConfigManager) DeleteThemePackage(themeID string) error {
	userDirectory, err := c.ensureUserThemePackagesDirectory()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(userDirectory)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	normalizedThemeID := normalizeThemePackageID(themeID)
	for _, entry := range entries {
		if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".json" {
			continue
		}
		targetPath := filepath.Join(userDirectory, entry.Name())
		summary, err := readThemePackageSummaryFromFile(targetPath, "user")
		if err != nil {
			continue
		}
		if summary.ID != normalizedThemeID {
			continue
		}
		return os.Remove(targetPath)
	}
	return fmt.Errorf("theme package not found: %s", normalizedThemeID)
}