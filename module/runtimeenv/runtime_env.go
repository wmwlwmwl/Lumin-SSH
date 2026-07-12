package runtimeenv

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const DefaultEnvironmentType = "uv"
const DefaultTargetPathTemplate = "${APP_DIR}\\envs\\uv"
const ModulePath = "module/runtimeenv/runtime_env.go"

type Settings struct {
	EnvironmentType    string `json:"environmentType,omitempty"`
	TargetPathTemplate string `json:"targetPathTemplate,omitempty"`
}

type Plan struct {
	EnvironmentType    string `json:"environmentType"`
	TargetPathTemplate string `json:"targetPathTemplate"`
	ProgramDirectory   string `json:"programDirectory,omitempty"`
	TargetPath         string `json:"targetPath,omitempty"`
	ModulePath         string `json:"modulePath"`
}

type Status struct {
	EnvironmentType string `json:"environmentType"`
	Ready           bool   `json:"ready"`
	BinaryPath      string `json:"binaryPath,omitempty"`
}

type ManagedState struct {
	EnvironmentType string `json:"environmentType"`
	Version         string `json:"version,omitempty"`
	BinaryPath      string `json:"binaryPath,omitempty"`
}

func DefaultSettings() Settings {
	return Settings{
		EnvironmentType:    DefaultEnvironmentType,
		TargetPathTemplate: DefaultTargetPathTemplate,
	}
}

func NormalizeEnvironmentType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case DefaultEnvironmentType:
		return DefaultEnvironmentType
	default:
		return DefaultEnvironmentType
	}
}

func NormalizeSettings(settings Settings) Settings {
	normalized := settings
	normalized.EnvironmentType = NormalizeEnvironmentType(settings.EnvironmentType)
	normalized.TargetPathTemplate = strings.TrimSpace(strings.ReplaceAll(settings.TargetPathTemplate, "\r\n", "\n"))
	if normalized.TargetPathTemplate == "" {
		normalized.TargetPathTemplate = DefaultTargetPathTemplate
	}
	return normalized
}

func ResolveTargetPath(programDirectory string, settings Settings) string {
	normalized := NormalizeSettings(settings)
	trimmedProgramDirectory := strings.TrimSpace(programDirectory)
	template := strings.TrimSpace(normalized.TargetPathTemplate)
	if template == "" {
		return ""
	}
	resolved := strings.ReplaceAll(template, "${APP_DIR}", trimmedProgramDirectory)
	resolved = strings.ReplaceAll(resolved, "%APP_DIR%", trimmedProgramDirectory)
	resolved = strings.ReplaceAll(resolved, "\\", string(filepath.Separator))
	resolved = strings.ReplaceAll(resolved, "/", string(filepath.Separator))
	if trimmedProgramDirectory != "" && !filepath.IsAbs(resolved) {
		resolved = filepath.Join(trimmedProgramDirectory, resolved)
	}
	if absolutePath, err := filepath.Abs(resolved); err == nil {
		resolved = absolutePath
	}
	return filepath.Clean(resolved)
}

func BuildPlan(programDirectory string, settings Settings) Plan {
	normalized := NormalizeSettings(settings)
	return Plan{
		EnvironmentType:    normalized.EnvironmentType,
		TargetPathTemplate: normalized.TargetPathTemplate,
		ProgramDirectory:   strings.TrimSpace(programDirectory),
		TargetPath:         ResolveTargetPath(programDirectory, normalized),
		ModulePath:         ModulePath,
	}
}

func ManagedStatePath(programDirectory string, settings Settings) string {
	installRoot := ResolveTargetPath(programDirectory, settings)
	if strings.TrimSpace(installRoot) == "" {
		return ""
	}
	return filepath.Join(installRoot, "current.json")
}

func SaveManagedState(programDirectory string, settings Settings, version string, binaryPath string) error {
	statePath := ManagedStatePath(programDirectory, settings)
	if strings.TrimSpace(statePath) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		return err
	}
	cleanBinaryPath := filepath.Clean(strings.TrimSpace(binaryPath))
	if absolutePath, err := filepath.Abs(cleanBinaryPath); err == nil {
		cleanBinaryPath = absolutePath
	}
	state := ManagedState{
		EnvironmentType: NormalizeEnvironmentType(settings.EnvironmentType),
		Version:         strings.TrimSpace(version),
		BinaryPath:      cleanBinaryPath,
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tempPath := statePath + ".tmp"
	if err := os.WriteFile(tempPath, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tempPath, statePath)
}

func loadManagedState(programDirectory string, settings Settings) (ManagedState, bool) {
	statePath := ManagedStatePath(programDirectory, settings)
	if strings.TrimSpace(statePath) == "" {
		return ManagedState{}, false
	}
	data, err := os.ReadFile(statePath)
	if err != nil {
		return ManagedState{}, false
	}
	var state ManagedState
	if err := json.Unmarshal(data, &state); err != nil {
		return ManagedState{}, false
	}
	state.EnvironmentType = NormalizeEnvironmentType(state.EnvironmentType)
	state.BinaryPath = filepath.Clean(strings.TrimSpace(state.BinaryPath))
	if state.EnvironmentType == "" || state.BinaryPath == "" {
		return ManagedState{}, false
	}
	return state, true
}

func DetectStatus(programDirectory string, settings Settings) Status {
	normalized := NormalizeSettings(settings)
	status := Status{
		EnvironmentType: normalized.EnvironmentType,
	}
	if state, ok := loadManagedState(programDirectory, normalized); ok {
		if _, err := os.Stat(state.BinaryPath); err == nil {
			status.Ready = true
			status.BinaryPath = state.BinaryPath
			return status
		}
	}
	binaryPath, err := exec.LookPath(normalized.EnvironmentType)
	if err != nil {
		return status
	}
	if absolutePath, absErr := filepath.Abs(binaryPath); absErr == nil {
		binaryPath = absolutePath
	}
	status.Ready = true
	status.BinaryPath = filepath.Clean(binaryPath)
	return status
}