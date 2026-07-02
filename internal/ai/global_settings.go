package ai

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type AISlashCommand struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

type AIGlobalSettings struct {
	CurrentProviderID                 string   `json:"currentProviderId"`
	AutoApprovalEnabled               bool     `json:"autoApprovalEnabled"`
	AlwaysAllowReadOnly               bool     `json:"alwaysAllowReadOnly"`
	AlwaysAllowReadOnlyOutsideWorkspace bool   `json:"alwaysAllowReadOnlyOutsideWorkspace"`
	AlwaysAllowWrite                  bool     `json:"alwaysAllowWrite"`
	AlwaysAllowWriteOutsideWorkspace  bool     `json:"alwaysAllowWriteOutsideWorkspace"`
	AlwaysAllowWriteProtected         bool     `json:"alwaysAllowWriteProtected"`
	AlwaysAllowExecute                bool     `json:"alwaysAllowExecute"`
	AlwaysAllowExecuteAllCommands     bool     `json:"alwaysAllowExecuteAllCommands"`
	AllowedCommands                   []string         `json:"allowedCommands,omitempty"`
	DeniedCommands                    []string         `json:"deniedCommands,omitempty"`
	SlashCommands                     []AISlashCommand `json:"slashCommands,omitempty"`
	AlwaysAllowMcp                    bool     `json:"alwaysAllowMcp"`
	AlwaysAllowModeSwitch             bool     `json:"alwaysAllowModeSwitch"`
	AlwaysAllowSubtasks               bool     `json:"alwaysAllowSubtasks"`
	AlwaysAllowFollowupQuestions      bool     `json:"alwaysAllowFollowupQuestions"`
	TerminalIsolation                 bool     `json:"terminalIsolation"`
	ApprovalButtonOrder               string   `json:"approvalButtonOrder"`
	CommandActionButtonOrder          string   `json:"commandActionButtonOrder"`
}

func defaultAIGlobalSettings() AIGlobalSettings {
	return AIGlobalSettings{
		TerminalIsolation:        true,
		ApprovalButtonOrder:      "reject-approve",
		CommandActionButtonOrder: "terminate-continue",
	}
}

func isValidAISlashCommandName(value string) bool {
	if value == "" {
		return false
	}
	for _, currentRune := range value {
		if currentRune >= 'a' && currentRune <= 'z' {
			continue
		}
		if currentRune >= 'A' && currentRune <= 'Z' {
			continue
		}
		if currentRune >= '0' && currentRune <= '9' {
			continue
		}
		if currentRune == '.' || currentRune == '_' || currentRune == '-' {
			continue
		}
		return false
	}
	return true
}

func normalizeAISlashCommands(commands []AISlashCommand) []AISlashCommand {
	if commands == nil {
		return []AISlashCommand{}
	}
	normalized := make([]AISlashCommand, 0, len(commands))
	seen := make(map[string]struct{}, len(commands))
	for _, command := range commands {
		name := strings.TrimSpace(strings.TrimPrefix(command.Name, "/"))
		prompt := strings.TrimSpace(strings.ReplaceAll(command.Prompt, "\r\n", "\n"))
		if !isValidAISlashCommandName(name) || prompt == "" {
			continue
		}
		dedupeKey := strings.ToLower(name)
		if _, exists := seen[dedupeKey]; exists {
			continue
		}
		seen[dedupeKey] = struct{}{}
		normalized = append(normalized, AISlashCommand{
			Name:   name,
			Prompt: prompt,
		})
	}
	return normalized
}

func normalizeAIStringList(values []string) []string {
	if values == nil {
		return []string{}
	}
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
}

func containsAICommandWildcard(values []string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "*" {
			return true
		}
	}
	return false
}

func normalizeAIApprovalButtonOrder(value string) string {
	switch strings.TrimSpace(value) {
	case "approve-reject":
		return "approve-reject"
	default:
		return "reject-approve"
	}
}

func normalizeAICommandActionButtonOrder(value string) string {
	switch strings.TrimSpace(value) {
	case "continue-terminate":
		return "continue-terminate"
	default:
		return "terminate-continue"
	}
}

func normalizeAIGlobalSettings(settings AIGlobalSettings) AIGlobalSettings {
	settings.CurrentProviderID = strings.TrimSpace(settings.CurrentProviderID)
	settings.SlashCommands = normalizeAISlashCommands(settings.SlashCommands)
	settings.AllowedCommands = normalizeAIStringList(settings.AllowedCommands)
	settings.DeniedCommands = normalizeAIStringList(settings.DeniedCommands)
	settings.AlwaysAllowExecuteAllCommands = containsAICommandWildcard(settings.AllowedCommands)
	settings.AutoApprovalEnabled = settings.AlwaysAllowReadOnly || settings.AlwaysAllowWrite || settings.AlwaysAllowExecute
	settings.ApprovalButtonOrder = normalizeAIApprovalButtonOrder(settings.ApprovalButtonOrder)
	settings.CommandActionButtonOrder = normalizeAICommandActionButtonOrder(settings.CommandActionButtonOrder)
	return settings
}

func (c *ConfigManager) aiGlobalSettingsPath() string {
	return filepath.Join(c.configDir, "ai_global_settings.json")
}

func (c *ConfigManager) GetAIGlobalSettings() AIGlobalSettings {
	settings := defaultAIGlobalSettings()
	if c == nil {
		return settings
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.aiGlobalSettingsPath())
	if err != nil {
		return settings
	}
	_ = json.Unmarshal(data, &settings)
	return normalizeAIGlobalSettings(settings)
}

func (c *ConfigManager) SaveAIGlobalSettings(settings AIGlobalSettings) error {
	if c == nil {
		return nil
	}
	normalized := normalizeAIGlobalSettings(settings)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.aiGlobalSettingsPath(), data, 0600)
}

func (a *App) GetAIGlobalSettings() AIGlobalSettings {
	if a == nil || a.configManager == nil {
		return defaultAIGlobalSettings()
	}
	return a.configManager.GetAIGlobalSettings()
}

func (a *App) SaveAIGlobalSettings(jsonStr string) error {
	settings := defaultAIGlobalSettings()
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &settings); err != nil {
			return err
		}
	}
	if a == nil || a.configManager == nil {
		return nil
	}
	return a.configManager.SaveAIGlobalSettings(settings)
}