package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
)

const DefaultTerminalOutputLineLimit = 500
const DefaultTerminalOutputCharacterLimit = 35000

type OutputCompressionSettings struct {
	TerminalOutputLineLimit      int `json:"terminalOutputLineLimit"`
	TerminalOutputCharacterLimit int `json:"terminalOutputCharacterLimit"`
}

var terminalOutputLineLimitSetting atomic.Int64
var terminalOutputCharacterLimitSetting atomic.Int64

func init() {
	terminalOutputLineLimitSetting.Store(DefaultTerminalOutputLineLimit)
	terminalOutputCharacterLimitSetting.Store(DefaultTerminalOutputCharacterLimit)
}

func NormalizeOutputCompressionSettings(settings OutputCompressionSettings) OutputCompressionSettings {
	if settings.TerminalOutputLineLimit < 10 {
		settings.TerminalOutputLineLimit = DefaultTerminalOutputLineLimit
	}
	if settings.TerminalOutputCharacterLimit < 1000 {
		settings.TerminalOutputCharacterLimit = DefaultTerminalOutputCharacterLimit
	}
	return settings
}

func ApplyOutputCompressionSettings(settings OutputCompressionSettings) {
	normalized := NormalizeOutputCompressionSettings(settings)
	terminalOutputLineLimitSetting.Store(int64(normalized.TerminalOutputLineLimit))
	terminalOutputCharacterLimitSetting.Store(int64(normalized.TerminalOutputCharacterLimit))
}

func CurrentTerminalOutputLineLimit() int {
	value := int(terminalOutputLineLimitSetting.Load())
	if value < 10 {
		return DefaultTerminalOutputLineLimit
	}
	return value
}

func CurrentTerminalOutputCharacterLimit() int {
	value := int(terminalOutputCharacterLimitSetting.Load())
	if value < 1000 {
		return DefaultTerminalOutputCharacterLimit
	}
	return value
}

func OutputCompressionSettingsPath(configDir string) string {
	return filepath.Join(configDir, "mcp_output_compression.json")
}

func LoadOutputCompressionSettings(configDir string) OutputCompressionSettings {
	settings := OutputCompressionSettings{
		TerminalOutputLineLimit:      DefaultTerminalOutputLineLimit,
		TerminalOutputCharacterLimit: DefaultTerminalOutputCharacterLimit,
	}
	if configDir == "" {
		return settings
	}
	data, err := os.ReadFile(OutputCompressionSettingsPath(configDir))
	if err != nil {
		return settings
	}
	_ = json.Unmarshal(data, &settings)
	return NormalizeOutputCompressionSettings(settings)
}

func SaveOutputCompressionSettings(configDir string, settings OutputCompressionSettings) error {
	if configDir == "" {
		return nil
	}
	normalized := NormalizeOutputCompressionSettings(settings)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(OutputCompressionSettingsPath(configDir), data, 0600)
}

func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	tmpFile := path + ".tmp"
	file, err := os.OpenFile(tmpFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmpFile, path)
}