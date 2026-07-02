package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
)

type mcpOutputCompressionSettings struct {
	TerminalOutputLineLimit      int `json:"terminalOutputLineLimit"`
	TerminalOutputCharacterLimit int `json:"terminalOutputCharacterLimit"`
}

var terminalOutputLineLimitSetting atomic.Int64
var terminalOutputCharacterLimitSetting atomic.Int64

func init() {
	terminalOutputLineLimitSetting.Store(defaultTerminalOutputLineLimit)
	terminalOutputCharacterLimitSetting.Store(defaultTerminalOutputCharacterLimit)
}

func normalizeMCPOutputCompressionSettings(settings mcpOutputCompressionSettings) mcpOutputCompressionSettings {
	if settings.TerminalOutputLineLimit < 10 {
		settings.TerminalOutputLineLimit = defaultTerminalOutputLineLimit
	}
	if settings.TerminalOutputCharacterLimit < 1000 {
		settings.TerminalOutputCharacterLimit = defaultTerminalOutputCharacterLimit
	}
	return settings
}

func applyMCPOutputCompressionSettings(settings mcpOutputCompressionSettings) {
	normalized := normalizeMCPOutputCompressionSettings(settings)
	terminalOutputLineLimitSetting.Store(int64(normalized.TerminalOutputLineLimit))
	terminalOutputCharacterLimitSetting.Store(int64(normalized.TerminalOutputCharacterLimit))
}

func currentTerminalOutputLineLimit() int {
	value := int(terminalOutputLineLimitSetting.Load())
	if value < 10 {
		return defaultTerminalOutputLineLimit
	}
	return value
}

func currentTerminalOutputCharacterLimit() int {
	value := int(terminalOutputCharacterLimitSetting.Load())
	if value < 1000 {
		return defaultTerminalOutputCharacterLimit
	}
	return value
}

func (c *ConfigManager) mcpOutputCompressionSettingsPath() string {
	return filepath.Join(c.configDir, "mcp_output_compression.json")
}

func (c *ConfigManager) GetMCPOutputCompressionSettings() mcpOutputCompressionSettings {
	settings := mcpOutputCompressionSettings{
		TerminalOutputLineLimit:      defaultTerminalOutputLineLimit,
		TerminalOutputCharacterLimit: defaultTerminalOutputCharacterLimit,
	}
	if c == nil {
		return settings
	}
	data, err := os.ReadFile(c.mcpOutputCompressionSettingsPath())
	if err != nil {
		return settings
	}
	_ = json.Unmarshal(data, &settings)
	return normalizeMCPOutputCompressionSettings(settings)
}

func (c *ConfigManager) SaveMCPOutputCompressionSettings(settings mcpOutputCompressionSettings) error {
	if c == nil {
		return nil
	}
	normalized := normalizeMCPOutputCompressionSettings(settings)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(c.mcpOutputCompressionSettingsPath(), data, 0600)
}

func (a *App) GetMCPOutputCompressionSettings() map[string]int {
	settings := mcpOutputCompressionSettings{
		TerminalOutputLineLimit:      defaultTerminalOutputLineLimit,
		TerminalOutputCharacterLimit: defaultTerminalOutputCharacterLimit,
	}
	if a != nil && a.configManager != nil {
		settings = a.configManager.GetMCPOutputCompressionSettings()
	}
	return map[string]int{
		"terminalOutputLineLimit":      settings.TerminalOutputLineLimit,
		"terminalOutputCharacterLimit": settings.TerminalOutputCharacterLimit,
	}
}

func (a *App) SaveMCPOutputCompressionSettings(lineLimit int, characterLimit int) error {
	settings := normalizeMCPOutputCompressionSettings(mcpOutputCompressionSettings{
		TerminalOutputLineLimit:      lineLimit,
		TerminalOutputCharacterLimit: characterLimit,
	})
	if a != nil && a.configManager != nil {
		if err := a.configManager.SaveMCPOutputCompressionSettings(settings); err != nil {
			return err
		}
	}
	applyMCPOutputCompressionSettings(settings)
	return nil
}