package ai

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type AIConversationTaskSettings struct {
	CurrentProviderID                string   `json:"currentProviderId"`
	AutoApprovalEnabled              bool     `json:"autoApprovalEnabled"`
	AlwaysAllowReadOnly              bool     `json:"alwaysAllowReadOnly"`
	AlwaysAllowReadOnlyOutsideWorkspace bool  `json:"alwaysAllowReadOnlyOutsideWorkspace"`
	AlwaysAllowWrite                 bool     `json:"alwaysAllowWrite"`
	AlwaysAllowWriteOutsideWorkspace bool     `json:"alwaysAllowWriteOutsideWorkspace"`
	AlwaysAllowWriteProtected        bool     `json:"alwaysAllowWriteProtected"`
	AlwaysAllowExecute               bool     `json:"alwaysAllowExecute"`
	AlwaysAllowExecuteAllCommands    bool     `json:"alwaysAllowExecuteAllCommands"`
	AllowedCommands                  []string `json:"allowedCommands,omitempty"`
	DeniedCommands                   []string `json:"deniedCommands,omitempty"`
	AlwaysAllowMcp                   bool     `json:"alwaysAllowMcp"`
	AlwaysAllowModeSwitch            bool     `json:"alwaysAllowModeSwitch"`
	AlwaysAllowSubtasks              bool     `json:"alwaysAllowSubtasks"`
	AlwaysAllowFollowupQuestions     bool     `json:"alwaysAllowFollowupQuestions"`
}

type AIConversationMessage struct {
	ID          string                 `json:"id,omitempty"`
	TurnID      string                 `json:"turnId,omitempty"`
	Kind        string                 `json:"kind"`
	Text        string                 `json:"text,omitempty"`
	Time        string                 `json:"time,omitempty"`
	Metrics     []string               `json:"metrics,omitempty"`
	Streaming   bool                   `json:"streaming,omitempty"`
	Duration    string                 `json:"duration,omitempty"`
	ActionLabel string                 `json:"actionLabel,omitempty"`
	Title       string                 `json:"title,omitempty"`
	Summary     string                 `json:"summary,omitempty"`
	Code        string                 `json:"code,omitempty"`
	Status      string                 `json:"status,omitempty"`
	Result             string                 `json:"result,omitempty"`
	RemainingFileEdits int                    `json:"remainingFileEdits,omitempty"`
	Purpose            string                 `json:"purpose,omitempty"`
	Command            string                 `json:"command,omitempty"`
	Output      string                 `json:"output,omitempty"`
	Images      []string               `json:"images,omitempty"`
	ServerName  string                 `json:"serverName,omitempty"`
	ToolName    string                 `json:"toolName,omitempty"`
	Args        string                 `json:"args,omitempty"`
	Response    string                 `json:"response,omitempty"`
	Question    string                 `json:"question,omitempty"`
	Suggestions []string               `json:"suggestions,omitempty"`
	Extra       map[string]interface{} `json:"extra,omitempty"`
}

type AIConversationAPIMessage struct {
	Role         string   `json:"role"`
	Content      string   `json:"content"`
	MessageID    string   `json:"messageId,omitempty"`
	UIMessageIDs []string `json:"uiMessageIds,omitempty"`
	Images       []string `json:"images,omitempty"`
	Ts           int64    `json:"ts,omitempty"`
}

type AIConversationSummary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	Status      string `json:"status"`
	ToolProtocol string `json:"toolProtocol"`
	MessageCount int   `json:"messageCount"`
}

type AIConversationSnapshot struct {
	ID           string                     `json:"id"`
	Title        string                     `json:"title"`
	CreatedAt    int64                      `json:"createdAt"`
	UpdatedAt    int64                      `json:"updatedAt"`
	Status       string                     `json:"status"`
	ToolProtocol string                     `json:"toolProtocol"`
	Messages     []AIConversationMessage    `json:"messages"`
	APIMessages  []AIConversationAPIMessage `json:"apiMessages"`
	Settings     AIConversationTaskSettings `json:"settings"`
}

func defaultAIConversationTaskSettings(globalSettings AIGlobalSettings) AIConversationTaskSettings {
	return AIConversationTaskSettings{
		CurrentProviderID:                strings.TrimSpace(globalSettings.CurrentProviderID),
		AutoApprovalEnabled:              globalSettings.AutoApprovalEnabled,
		AlwaysAllowReadOnly:              globalSettings.AlwaysAllowReadOnly,
		AlwaysAllowReadOnlyOutsideWorkspace: globalSettings.AlwaysAllowReadOnlyOutsideWorkspace,
		AlwaysAllowWrite:                 globalSettings.AlwaysAllowWrite,
		AlwaysAllowWriteOutsideWorkspace: globalSettings.AlwaysAllowWriteOutsideWorkspace,
		AlwaysAllowWriteProtected:        globalSettings.AlwaysAllowWriteProtected,
		AlwaysAllowExecute:               globalSettings.AlwaysAllowExecute,
		AlwaysAllowExecuteAllCommands:    globalSettings.AlwaysAllowExecuteAllCommands,
		AlwaysAllowMcp:                   globalSettings.AlwaysAllowMcp,
		AlwaysAllowModeSwitch:            globalSettings.AlwaysAllowModeSwitch,
		AlwaysAllowSubtasks:              globalSettings.AlwaysAllowSubtasks,
		AlwaysAllowFollowupQuestions:     globalSettings.AlwaysAllowFollowupQuestions,
	}
}

func normalizeAIConversationTaskSettings(settings AIConversationTaskSettings) AIConversationTaskSettings {
	settings.CurrentProviderID = strings.TrimSpace(settings.CurrentProviderID)
	settings.AllowedCommands = normalizeAIStringList(settings.AllowedCommands)
	settings.DeniedCommands = normalizeAIStringList(settings.DeniedCommands)
	settings.AlwaysAllowExecuteAllCommands = containsAICommandWildcard(settings.AllowedCommands)
	settings.AutoApprovalEnabled = settings.AlwaysAllowReadOnly || settings.AlwaysAllowWrite || settings.AlwaysAllowExecute
	return settings
}

func normalizeAIConversationMessages(messages []AIConversationMessage) []AIConversationMessage {
	if messages == nil {
		return []AIConversationMessage{}
	}
	normalized := make([]AIConversationMessage, 0, len(messages))
	for _, message := range messages {
		if strings.TrimSpace(message.Kind) == "" {
			continue
		}
		message.ID = strings.TrimSpace(message.ID)
		message.TurnID = strings.TrimSpace(message.TurnID)
		message.Kind = strings.TrimSpace(message.Kind)
		message.Text = strings.TrimSpace(message.Text)
		message.Time = strings.TrimSpace(message.Time)
		message.Duration = strings.TrimSpace(message.Duration)
		message.ActionLabel = strings.TrimSpace(message.ActionLabel)
		message.Title = strings.TrimSpace(message.Title)
		message.Summary = strings.TrimSpace(message.Summary)
		message.Code = strings.TrimSpace(message.Code)
		message.Status = strings.TrimSpace(message.Status)
		message.Result = strings.TrimSpace(message.Result)
		if message.RemainingFileEdits < 0 {
			message.RemainingFileEdits = 0
		}
		message.Purpose = strings.TrimSpace(message.Purpose)
		message.Command = strings.TrimSpace(message.Command)
		message.Output = strings.TrimSpace(message.Output)
		message.Images = normalizeAIStringList(message.Images)
		message.ServerName = strings.TrimSpace(message.ServerName)
		message.ToolName = strings.TrimSpace(message.ToolName)
		message.Args = strings.TrimSpace(message.Args)
		message.Response = strings.TrimSpace(message.Response)
		message.Question = strings.TrimSpace(message.Question)
		normalized = append(normalized, message)
	}
	return normalized
}

func normalizeAIConversationAPIMessages(messages []AIConversationAPIMessage) []AIConversationAPIMessage {
	if messages == nil {
		return []AIConversationAPIMessage{}
	}
	normalized := make([]AIConversationAPIMessage, 0, len(messages))
	for _, message := range messages {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		if role != "system" && role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(message.Content)
		images := normalizeAIStringList(message.Images)
		if content == "" && len(images) == 0 {
			continue
		}
		uiMessageIDs := make([]string, 0, len(message.UIMessageIDs))
		seen := make(map[string]struct{}, len(message.UIMessageIDs))
		for _, uiMessageID := range message.UIMessageIDs {
			trimmedUIMessageID := strings.TrimSpace(uiMessageID)
			if trimmedUIMessageID == "" {
				continue
			}
			if _, exists := seen[trimmedUIMessageID]; exists {
				continue
			}
			seen[trimmedUIMessageID] = struct{}{}
			uiMessageIDs = append(uiMessageIDs, trimmedUIMessageID)
		}
		normalized = append(normalized, AIConversationAPIMessage{
			Role:         role,
			Content:      content,
			MessageID:    strings.TrimSpace(message.MessageID),
			UIMessageIDs: uiMessageIDs,
			Images:       images,
			Ts:           message.Ts,
		})
	}
	return normalized
}

func normalizeAIConversationSummary(summary AIConversationSummary) AIConversationSummary {
	summary.ID = strings.TrimSpace(summary.ID)
	summary.Title = strings.TrimSpace(summary.Title)
	if summary.Title == "" {
		summary.Title = "新对话"
	}
	if summary.Status == "" {
		summary.Status = "idle"
	}
	if summary.ToolProtocol == "" {
		summary.ToolProtocol = "xml"
	}
	return summary
}

func normalizeAIConversationSnapshot(snapshot AIConversationSnapshot, fallbackSettings AIConversationTaskSettings) AIConversationSnapshot {
	snapshot.ID = strings.TrimSpace(snapshot.ID)
	if snapshot.ID == "" {
		snapshot.ID = aiConversationID()
	}
	snapshot.Title = strings.TrimSpace(snapshot.Title)
	if snapshot.Title == "" {
		snapshot.Title = "新对话"
	}
	if snapshot.Status == "" {
		snapshot.Status = "idle"
	}
	if snapshot.ToolProtocol == "" {
		snapshot.ToolProtocol = "xml"
	}
	if snapshot.Messages == nil {
		snapshot.Messages = []AIConversationMessage{}
	}
	snapshot.Messages = normalizeAIConversationMessages(snapshot.Messages)
	if snapshot.APIMessages == nil {
		snapshot.APIMessages = []AIConversationAPIMessage{}
	}
	snapshot.APIMessages = normalizeAIConversationAPIMessages(snapshot.APIMessages)
	if snapshot.CreatedAt == 0 {
		snapshot.CreatedAt = time.Now().UnixMilli()
	}
	if snapshot.UpdatedAt == 0 {
		snapshot.UpdatedAt = snapshot.CreatedAt
	}
	snapshot.Settings = normalizeAIConversationTaskSettings(snapshot.Settings)
	return snapshot
}

func aiConversationID() string {
	randomBytes := make([]byte, 8)
	if _, err := rand.Read(randomBytes); err != nil {
		return fmt.Sprintf("conv-%d", time.Now().UnixMilli())
	}
	return "conv-" + hex.EncodeToString(randomBytes)
}

func (c *ConfigManager) aiConversationsRootDir() string {
	return filepath.Join(c.configDir, "tasks")
}

func (c *ConfigManager) aiConversationDir(conversationID string) string {
	return filepath.Join(c.aiConversationsRootDir(), conversationID)
}

func (c *ConfigManager) aiConversationMetadataPath(conversationID string) string {
	return filepath.Join(c.aiConversationDir(conversationID), "task_metadata.json")
}

func (c *ConfigManager) aiConversationMessagesPath(conversationID string) string {
	return filepath.Join(c.aiConversationDir(conversationID), "ui_messages.json")
}

func (c *ConfigManager) aiConversationAPIMessagesPath(conversationID string) string {
	return filepath.Join(c.aiConversationDir(conversationID), "api_conversation_history.json")
}

func (c *ConfigManager) aiConversationSettingsPath(conversationID string) string {
	return filepath.Join(c.aiConversationDir(conversationID), "setting.json")
}

func (c *ConfigManager) readAIConversationSummary(conversationID string) (AIConversationSummary, error) {
	data, err := os.ReadFile(c.aiConversationMetadataPath(conversationID))
	if err != nil {
		return AIConversationSummary{}, err
	}
	var summary AIConversationSummary
	if err := json.Unmarshal(data, &summary); err != nil {
		return AIConversationSummary{}, err
	}
	return normalizeAIConversationSummary(summary), nil
}

func (c *ConfigManager) readAIConversationMessages(conversationID string) []AIConversationMessage {
	data, err := os.ReadFile(c.aiConversationMessagesPath(conversationID))
	if err != nil {
		return []AIConversationMessage{}
	}
	var messages []AIConversationMessage
	if err := json.Unmarshal(data, &messages); err != nil {
		return []AIConversationMessage{}
	}
	if messages == nil {
		return []AIConversationMessage{}
	}
	return messages
}

func (c *ConfigManager) readAIConversationAPIMessages(conversationID string) []AIConversationAPIMessage {
	data, err := os.ReadFile(c.aiConversationAPIMessagesPath(conversationID))
	if err != nil {
		return []AIConversationAPIMessage{}
	}
	var messages []AIConversationAPIMessage
	if err := json.Unmarshal(data, &messages); err != nil {
		return []AIConversationAPIMessage{}
	}
	if messages == nil {
		return []AIConversationAPIMessage{}
	}
	return normalizeAIConversationAPIMessages(messages)
}

func (c *ConfigManager) readAIConversationSettings(conversationID string, fallback AIConversationTaskSettings) AIConversationTaskSettings {
	data, err := os.ReadFile(c.aiConversationSettingsPath(conversationID))
	if err != nil {
		return fallback
	}
	var settings AIConversationTaskSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return fallback
	}
	return normalizeAIConversationTaskSettings(settings)
}

func marshalAIConversationJSON(value interface{}) ([]byte, error) {
	var builder strings.Builder
	encoder := json.NewEncoder(&builder)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return []byte(strings.TrimSuffix(builder.String(), "\n")), nil
}

func (c *ConfigManager) writeAIConversationSnapshot(snapshot AIConversationSnapshot) error {
	if err := os.MkdirAll(c.aiConversationDir(snapshot.ID), 0700); err != nil {
		return err
	}

	summary := normalizeAIConversationSummary(AIConversationSummary{
		ID:           snapshot.ID,
		Title:        snapshot.Title,
		CreatedAt:    snapshot.CreatedAt,
		UpdatedAt:    snapshot.UpdatedAt,
		Status:       snapshot.Status,
		ToolProtocol: snapshot.ToolProtocol,
		MessageCount: len(snapshot.Messages),
	})

	metadataBytes, err := marshalAIConversationJSON(summary)
	if err != nil {
		return err
	}
	if err := atomicWriteFile(c.aiConversationMetadataPath(snapshot.ID), metadataBytes, 0600); err != nil {
		return err
	}

	messageBytes, err := marshalAIConversationJSON(snapshot.Messages)
	if err != nil {
		return err
	}
	if err := atomicWriteFile(c.aiConversationMessagesPath(snapshot.ID), messageBytes, 0600); err != nil {
		return err
	}

	apiMessageBytes, err := marshalAIConversationJSON(normalizeAIConversationAPIMessages(snapshot.APIMessages))
	if err != nil {
		return err
	}
	if err := atomicWriteFile(c.aiConversationAPIMessagesPath(snapshot.ID), apiMessageBytes, 0600); err != nil {
		return err
	}

	settingsBytes, err := marshalAIConversationJSON(normalizeAIConversationTaskSettings(snapshot.Settings))
	if err != nil {
		return err
	}
	return atomicWriteFile(c.aiConversationSettingsPath(snapshot.ID), settingsBytes, 0600)
}

func (c *ConfigManager) ListAIConversations() []AIConversationSummary {
	if c == nil {
		return []AIConversationSummary{}
	}
	c.mu.RLock()
	defer c.mu.RUnlock()

	entries, err := os.ReadDir(c.aiConversationsRootDir())
	if err != nil {
		return []AIConversationSummary{}
	}

	summaries := make([]AIConversationSummary, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		summary, err := c.readAIConversationSummary(entry.Name())
		if err != nil {
			continue
		}
		summaries = append(summaries, summary)
	}

	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].UpdatedAt != summaries[j].UpdatedAt {
			return summaries[i].UpdatedAt > summaries[j].UpdatedAt
		}
		return summaries[i].ID > summaries[j].ID
	})

	return summaries
}

func (c *ConfigManager) CreateAIConversation(title string) (AIConversationSnapshot, error) {
	if c == nil {
		return AIConversationSnapshot{}, fmt.Errorf("config manager unavailable")
	}

	globalSettings := c.GetAIGlobalSettings()
	snapshot := normalizeAIConversationSnapshot(AIConversationSnapshot{
		ID:           aiConversationID(),
		Title:        strings.TrimSpace(title),
		CreatedAt:    time.Now().UnixMilli(),
		UpdatedAt:    time.Now().UnixMilli(),
		Status:       "idle",
		ToolProtocol: "xml",
		Messages:     []AIConversationMessage{},
		APIMessages:  []AIConversationAPIMessage{},
		Settings:     defaultAIConversationTaskSettings(globalSettings),
	}, defaultAIConversationTaskSettings(globalSettings))

	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.writeAIConversationSnapshot(snapshot); err != nil {
		return AIConversationSnapshot{}, err
	}
	return snapshot, nil
}

func (c *ConfigManager) GetAIConversation(conversationID string) (AIConversationSnapshot, error) {
	if c == nil {
		return AIConversationSnapshot{}, fmt.Errorf("config manager unavailable")
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return AIConversationSnapshot{}, fmt.Errorf("conversation id is required")
	}

	fallbackSettings := defaultAIConversationTaskSettings(c.GetAIGlobalSettings())

	c.mu.RLock()
	defer c.mu.RUnlock()

	summary, err := c.readAIConversationSummary(conversationID)
	if err != nil {
		return AIConversationSnapshot{}, err
	}

	snapshot := AIConversationSnapshot{
		ID:           summary.ID,
		Title:        summary.Title,
		CreatedAt:    summary.CreatedAt,
		UpdatedAt:    summary.UpdatedAt,
		Status:       summary.Status,
		ToolProtocol: summary.ToolProtocol,
		Messages:     c.readAIConversationMessages(conversationID),
		APIMessages:  c.readAIConversationAPIMessages(conversationID),
		Settings:     c.readAIConversationSettings(conversationID, fallbackSettings),
	}

	return normalizeAIConversationSnapshot(snapshot, fallbackSettings), nil
}

func (c *ConfigManager) SaveAIConversation(snapshot AIConversationSnapshot) (AIConversationSnapshot, error) {
	if c == nil {
		return AIConversationSnapshot{}, fmt.Errorf("config manager unavailable")
	}
	fallbackSettings := defaultAIConversationTaskSettings(c.GetAIGlobalSettings())
	normalized := normalizeAIConversationSnapshot(snapshot, fallbackSettings)

	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.writeAIConversationSnapshot(normalized); err != nil {
		return AIConversationSnapshot{}, err
	}
	return normalized, nil
}

func (c *ConfigManager) DeleteAIConversation(conversationID string) error {
	if c == nil {
		return fmt.Errorf("config manager unavailable")
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return fmt.Errorf("conversation id is required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return os.RemoveAll(c.aiConversationDir(conversationID))
}

func (a *App) ListAIConversations() []AIConversationSummary {
	if a == nil || a.configManager == nil {
		return []AIConversationSummary{}
	}
	return a.configManager.ListAIConversations()
}

func (a *App) CreateAIConversation(title string) (AIConversationSnapshot, error) {
	if a == nil || a.configManager == nil {
		return AIConversationSnapshot{}, fmt.Errorf("config manager unavailable")
	}
	return a.configManager.CreateAIConversation(title)
}

func (a *App) GetAIConversation(conversationID string) (AIConversationSnapshot, error) {
	if a == nil || a.configManager == nil {
		return AIConversationSnapshot{}, fmt.Errorf("config manager unavailable")
	}
	return a.configManager.GetAIConversation(conversationID)
}

func (a *App) SaveAIConversation(jsonStr string) (AIConversationSnapshot, error) {
	if a == nil || a.configManager == nil {
		return AIConversationSnapshot{}, fmt.Errorf("config manager unavailable")
	}
	var snapshot AIConversationSnapshot
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &snapshot); err != nil {
			return AIConversationSnapshot{}, err
		}
	}
	return a.configManager.SaveAIConversation(snapshot)
}

func (a *App) DeleteAIConversation(conversationID string) error {
	if a == nil || a.configManager == nil {
		return fmt.Errorf("config manager unavailable")
	}
	return a.configManager.DeleteAIConversation(conversationID)
}