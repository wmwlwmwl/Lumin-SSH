package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

type AISlashCommand struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

type AIProxyNode struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"`
	UpdatedAt int64  `json:"updatedAt,omitempty"`
}

type AIGlobalSettings struct {
	CurrentProviderID                   string           `json:"currentProviderId"`
	AutoApprovalEnabled                 bool             `json:"autoApprovalEnabled"`
	AlwaysAllowReadOnly                 bool             `json:"alwaysAllowReadOnly"`
	AlwaysAllowReadOnlyOutsideWorkspace bool             `json:"alwaysAllowReadOnlyOutsideWorkspace"`
	AlwaysAllowWrite                    bool             `json:"alwaysAllowWrite"`
	AlwaysAllowWriteOutsideWorkspace    bool             `json:"alwaysAllowWriteOutsideWorkspace"`
	AlwaysAllowWriteProtected           bool             `json:"alwaysAllowWriteProtected"`
	AlwaysAllowExecute                  bool             `json:"alwaysAllowExecute"`
	AlwaysAllowExecuteReadOnly          bool             `json:"alwaysAllowExecuteReadOnly"`
	AlwaysAllowExecuteAllCommands       bool             `json:"alwaysAllowExecuteAllCommands"`
	AllowedCommands                     []string         `json:"allowedCommands,omitempty"`
	DeniedCommands                      []string         `json:"deniedCommands,omitempty"`
	SlashCommands                       []AISlashCommand `json:"slashCommands,omitempty"`
	AlwaysAllowMcp                      bool             `json:"alwaysAllowMcp"`
	AlwaysAllowModeSwitch               bool             `json:"alwaysAllowModeSwitch"`
	AlwaysAllowSubtasks                 bool             `json:"alwaysAllowSubtasks"`
	SoundEnabled                        bool             `json:"soundEnabled"`
	SoundVolume                         float64          `json:"soundVolume,omitempty"`
	MCPEnabled                          bool             `json:"mcpEnabled"`
	MCPAllowBrowserCalls                bool             `json:"mcpAllowBrowserCalls"`
	TerminalIsolation                   bool             `json:"terminalIsolation"`
	ConfirmDelete                       bool             `json:"confirmDelete"`
	ContinueAfterToolRejection          bool             `json:"continueAfterToolRejection"`
	ConversationAutoBackupEnabled       bool             `json:"conversationAutoBackupEnabled"`
	MessageActionBarAtBottom            bool             `json:"messageActionBarAtBottom"`
	ApprovalButtonOrder                 string           `json:"approvalButtonOrder"`
	CommandActionButtonOrder            string           `json:"commandActionButtonOrder"`
	ToolResultTokenThreshold            int              `json:"toolResultTokenThreshold,omitempty"`
	AIRequestProxyID                    string           `json:"aiRequestProxyId,omitempty"`
	UpdatedAt                           int64            `json:"updatedAt,omitempty"`
	ProxyNodes                          []AIProxyNode    `json:"proxyNodes,omitempty"`
}

func defaultAIGlobalSettings() AIGlobalSettings {
	return AIGlobalSettings{
		SoundEnabled:                  true,
		SoundVolume:                   0.06,
		MCPEnabled:                    true,
		MCPAllowBrowserCalls:          false,
		TerminalIsolation:             true,
		ConfirmDelete:                 true,
		ContinueAfterToolRejection:    true,
		ConversationAutoBackupEnabled: true,
		MessageActionBarAtBottom:      true,
		ApprovalButtonOrder:           "reject-approve",
		CommandActionButtonOrder:      "terminate-continue",
		ToolResultTokenThreshold:      350000,
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

func normalizeAIProxyType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "http":
		return "http"
	default:
		return "socks5"
	}
}

func normalizeAISoundVolume(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func buildDefaultAIProxyNodeID(proxyType string, host string, port int, index int) string {
	sanitizedHost := strings.ToLower(strings.TrimSpace(host))
	sanitizedHost = strings.NewReplacer(":", "-", ".", "-", "[", "", "]", "", "/", "-", "\\", "-").Replace(sanitizedHost)
	if sanitizedHost == "" {
		sanitizedHost = fmt.Sprintf("node-%d", index+1)
	}
	return fmt.Sprintf("proxy-%s-%s-%d-%d", proxyType, sanitizedHost, port, index+1)
}

func normalizeAIProxyNodes(nodes []AIProxyNode) []AIProxyNode {
	if nodes == nil {
		return []AIProxyNode{}
	}
	normalized := make([]AIProxyNode, 0, len(nodes))
	seen := make(map[string]struct{}, len(nodes))
	for index, node := range nodes {
		host := strings.TrimSpace(node.Host)
		if host == "" {
			continue
		}
		proxyType := normalizeAIProxyType(node.Type)
		port := node.Port
		if port <= 0 || port > 65535 {
			port = 1080
		}
		id := strings.TrimSpace(node.ID)
		if id == "" {
			id = buildDefaultAIProxyNodeID(proxyType, host, port, index)
		}
		if _, exists := seen[id]; exists {
			continue
		}
		updatedAt := node.UpdatedAt
		if updatedAt <= 0 {
			updatedAt = time.Now().UnixMilli()
		}
		seen[id] = struct{}{}
		normalized = append(normalized, AIProxyNode{
			ID:        id,
			Name:      strings.TrimSpace(node.Name),
			Type:      proxyType,
			Host:      host,
			Port:      port,
			Username:  strings.TrimSpace(node.Username),
			Password:  node.Password,
			UpdatedAt: updatedAt,
		})
	}
	return normalized
}

func normalizeAIRequestProxyID(selectedID string, nodes []AIProxyNode) string {
	trimmedID := strings.TrimSpace(selectedID)
	if trimmedID == "" {
		return ""
	}
	for _, node := range nodes {
		if node.ID == trimmedID {
			return trimmedID
		}
	}
	return ""
}

func aiProxyNodesPathForConfigDir(configDir string) string {
	return filepath.Join(configDir, "proxy_nodes.json")
}

func loadAIProxyNodesFromPath(path string) ([]AIProxyNode, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	var nodes []AIProxyNode
	if err := json.Unmarshal(data, &nodes); err != nil {
		return []AIProxyNode{}, true
	}
	return normalizeAIProxyNodes(nodes), true
}

func LoadAIProxyNodes(configDir string) []AIProxyNode {
	if strings.TrimSpace(configDir) == "" {
		return []AIProxyNode{}
	}
	if nodes, ok := loadAIProxyNodesFromPath(aiProxyNodesPathForConfigDir(configDir)); ok {
		return nodes
	}
	return []AIProxyNode{}
}

func normalizeAIGlobalSettings(settings AIGlobalSettings) AIGlobalSettings {
	settings.CurrentProviderID = strings.TrimSpace(settings.CurrentProviderID)
	settings.SlashCommands = normalizeAISlashCommands(settings.SlashCommands)
	settings.AllowedCommands = normalizeAIStringList(settings.AllowedCommands)
	settings.DeniedCommands = normalizeAIStringList(settings.DeniedCommands)
	settings.AlwaysAllowExecuteAllCommands = containsAICommandWildcard(settings.AllowedCommands)
	settings.AutoApprovalEnabled = settings.AlwaysAllowReadOnly || settings.AlwaysAllowWrite || settings.AlwaysAllowExecute || settings.AlwaysAllowExecuteReadOnly
	settings.ApprovalButtonOrder = normalizeAIApprovalButtonOrder(settings.ApprovalButtonOrder)
	settings.CommandActionButtonOrder = normalizeAICommandActionButtonOrder(settings.CommandActionButtonOrder)
	settings.SoundVolume = normalizeAISoundVolume(settings.SoundVolume)
	if settings.UpdatedAt <= 0 {
		settings.UpdatedAt = time.Now().UnixMilli()
	}
	settings.ProxyNodes = normalizeAIProxyNodes(settings.ProxyNodes)
	settings.AIRequestProxyID = normalizeAIRequestProxyID(settings.AIRequestProxyID, settings.ProxyNodes)
	if settings.ToolResultTokenThreshold <= 0 {
		settings.ToolResultTokenThreshold = defaultAIGlobalSettings().ToolResultTokenThreshold
	}
	return settings
}

func aiGlobalSettingsContentEqual(a, b AIGlobalSettings) bool {
	a.ProxyNodes = nil
	b.ProxyNodes = nil
	a.UpdatedAt = 0
	b.UpdatedAt = 0
	return reflect.DeepEqual(a, b)
}

func LoadAIGlobalSettings(configDir string) AIGlobalSettings {
	settings := defaultAIGlobalSettings()
	if strings.TrimSpace(configDir) == "" {
		return settings
	}
	data, err := os.ReadFile(filepath.Join(configDir, "ai_global_settings.json"))
	if err == nil {
		_ = json.Unmarshal(data, &settings)
	}
	settings.ProxyNodes = LoadAIProxyNodes(configDir)
	return normalizeAIGlobalSettings(settings)
}

func (c *ConfigManager) aiGlobalSettingsPath() string {
	return filepath.Join(c.configDir, "ai_global_settings.json")
}

func (c *ConfigManager) aiProxyNodesPath() string {
	return aiProxyNodesPathForConfigDir(c.configDir)
}

func (c *ConfigManager) GetAIProxyNodes() []AIProxyNode {
	if c == nil {
		return []AIProxyNode{}
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if nodes, ok := loadAIProxyNodesFromPath(c.aiProxyNodesPath()); ok {
		return nodes
	}
	return []AIProxyNode{}
}

func (c *ConfigManager) SaveAIProxyNodes(nodes []AIProxyNode) error {
	if c == nil {
		return nil
	}
	normalized := normalizeAIProxyNodes(nodes)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.aiProxyNodesPath(), data, 0600)
}

func (c *ConfigManager) GetAIGlobalSettings() AIGlobalSettings {
	settings := defaultAIGlobalSettings()
	if c == nil {
		return settings
	}
	c.mu.RLock()
	data, err := os.ReadFile(c.aiGlobalSettingsPath())
	proxyNodes, ok := loadAIProxyNodesFromPath(c.aiProxyNodesPath())
	c.mu.RUnlock()
	if err == nil {
		_ = json.Unmarshal(data, &settings)
	}
	if ok {
		settings.ProxyNodes = proxyNodes
	} else {
		settings.ProxyNodes = []AIProxyNode{}
	}
	return normalizeAIGlobalSettings(settings)
}

func (c *ConfigManager) SaveAIGlobalSettings(settings AIGlobalSettings) error {
	if c == nil {
		return nil
	}
	settings.ProxyNodes = LoadAIProxyNodes(c.configDir)
	normalized := normalizeAIGlobalSettings(settings)
	normalized.ProxyNodes = nil

	c.mu.Lock()
	defer c.mu.Unlock()
	existing := defaultAIGlobalSettings()
	if data, err := os.ReadFile(c.aiGlobalSettingsPath()); err == nil {
		_ = json.Unmarshal(data, &existing)
	}
	existing = normalizeAIGlobalSettings(existing)
	existing.ProxyNodes = nil
	if aiGlobalSettingsContentEqual(existing, normalized) {
		return nil
	}

	normalized.UpdatedAt = time.Now().UnixMilli()
	settingsData, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(c.aiGlobalSettingsPath(), settingsData, 0600)
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
