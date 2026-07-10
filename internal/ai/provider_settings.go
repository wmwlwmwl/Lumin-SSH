package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	aiprovider "luminssh-go/internal/ai/provider"
)

type AIProviderProfile struct {
	ID                           string `json:"id"`
	Name                         string `json:"name"`
	Provider                     string `json:"provider"`
	Model                        string `json:"model"`
	BaseURL                      string `json:"baseUrl"`
	APIKey                       string `json:"apiKey"`
	CacheStrategy                string `json:"cacheStrategy"`
	WebSearchEnabled             bool   `json:"webSearchEnabled"`
	DedicatedWebSearchEnabled    bool   `json:"dedicatedWebSearchEnabled"`
	DedicatedWebSearchProviderID string `json:"dedicatedWebSearchProviderId,omitempty"`
	DedicatedProxyEnabled        bool   `json:"dedicatedProxyEnabled"`
	DedicatedProxyID             string `json:"dedicatedProxyId,omitempty"`
	ReasoningEffort              string `json:"reasoningEffort"`
	EnableReasoningEffort        bool   `json:"enableReasoningEffort"`
	ModelMaxTokens               int    `json:"modelMaxTokens,omitempty"`
	ModelMaxThinkingTokens       int    `json:"modelMaxThinkingTokens,omitempty"`
	Pinned                       bool   `json:"pinned"`
	UpdatedAt                    int64  `json:"updatedAt,omitempty"`
}

type AIProviderRegistry struct {
	Providers []AIProviderProfile `json:"providers"`
}

type AIProviderState struct {
	CurrentProviderID string              `json:"currentProviderId"`
	Providers         []AIProviderProfile `json:"providers"`
}

func normalizeAIProviderProtocol(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "compatible":
		return "Compatible"
	case "responses":
		return "Responses"
	case "messages":
		return "Messages"
	default:
		return "Compatible"
	}
}

func normalizeAIProviderCacheStrategy(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "off":
		return "off"
	case "model":
		return "model"
	case "5m":
		return "5m"
	case "1h":
		return "1h"
	default:
		return "model"
	}
}

func normalizeAIProviderReasoningEffort(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "disable":
		return "disable"
	case "none":
		return "none"
	case "minimal":
		return "minimal"
	case "low":
		return "low"
	case "medium":
		return "medium"
	case "high":
		return "high"
	case "xhigh", "max":
		return "xhigh"
	default:
		return "disable"
	}
}

func normalizeAIProviderProfiles(profiles []AIProviderProfile) []AIProviderProfile {
	if profiles == nil {
		return []AIProviderProfile{}
	}

	now := time.Now().UnixMilli()
	ids := make(map[string]struct{}, len(profiles))
	normalized := make([]AIProviderProfile, len(profiles))
	copy(normalized, profiles)

	for index := range normalized {
		profile := &normalized[index]
		if strings.TrimSpace(profile.ID) == "" {
			profile.ID = fmt.Sprintf("ai-provider-%d-%d", now, index)
		}
		if strings.TrimSpace(profile.Name) == "" {
			profile.Name = "未命名供应商"
		}
		profile.Provider = normalizeAIProviderProtocol(profile.Provider)
		profile.Model = strings.TrimSpace(profile.Model)
		if profile.Model == "" {
			profile.Model = "未选择模型"
		}
		profile.BaseURL = strings.TrimSpace(profile.BaseURL)
		profile.APIKey = strings.TrimSpace(profile.APIKey)
		profile.DedicatedProxyID = strings.TrimSpace(profile.DedicatedProxyID)
		profile.CacheStrategy = normalizeAIProviderCacheStrategy(profile.CacheStrategy)
		profile.ReasoningEffort = normalizeAIProviderReasoningEffort(profile.ReasoningEffort)
		profile.EnableReasoningEffort = profile.EnableReasoningEffort || (profile.ReasoningEffort != "" && profile.ReasoningEffort != "disable") || profile.ModelMaxTokens > 0 || profile.ModelMaxThinkingTokens > 0
		if profile.ModelMaxTokens < 0 {
			profile.ModelMaxTokens = 0
		}
		if profile.ModelMaxThinkingTokens < 0 {
			profile.ModelMaxThinkingTokens = 0
		}
		if profile.ModelMaxTokens > 0 && profile.ModelMaxThinkingTokens > 0 {
			maxThinkingTokens := int(float64(profile.ModelMaxTokens) * 0.8)
			if maxThinkingTokens > 0 && profile.ModelMaxThinkingTokens > maxThinkingTokens {
				profile.ModelMaxThinkingTokens = maxThinkingTokens
			}
		}
		if profile.UpdatedAt == 0 {
			profile.UpdatedAt = now
		}
		ids[profile.ID] = struct{}{}
	}

	dedicatedCandidateIDs := make(map[string]struct{}, len(normalized))
	for _, profile := range normalized {
		if aiprovider.CanBeDedicatedWebSearchCandidate(profile.Provider) {
			dedicatedCandidateIDs[profile.ID] = struct{}{}
		}
	}

	for index := range normalized {
		profile := &normalized[index]

		if profile.WebSearchEnabled {
			profile.DedicatedWebSearchEnabled = false
		}

		if profile.DedicatedWebSearchProviderID == profile.ID {
			profile.DedicatedWebSearchProviderID = ""
		}

		if profile.DedicatedWebSearchEnabled {
			if _, ok := dedicatedCandidateIDs[profile.DedicatedWebSearchProviderID]; !ok || profile.DedicatedWebSearchProviderID == "" {
				replacement := ""
				for otherIndex := range normalized {
					if normalized[otherIndex].ID != profile.ID && aiprovider.CanBeDedicatedWebSearchCandidate(normalized[otherIndex].Provider) {
						replacement = normalized[otherIndex].ID
						break
					}
				}
				profile.DedicatedWebSearchProviderID = replacement
				profile.DedicatedWebSearchEnabled = replacement != ""
			}
		} else if profile.DedicatedWebSearchProviderID != "" {
			if _, ok := dedicatedCandidateIDs[profile.DedicatedWebSearchProviderID]; !ok {
				profile.DedicatedWebSearchProviderID = ""
			}
		}
	}

	return normalized
}

func normalizeAIProviderRegistry(registry AIProviderRegistry) AIProviderRegistry {
	registry.Providers = normalizeAIProviderProfiles(registry.Providers)
	return registry
}

func normalizeAIProviderState(state AIProviderState) AIProviderState {
	state.CurrentProviderID = strings.TrimSpace(state.CurrentProviderID)
	state.Providers = normalizeAIProviderProfiles(state.Providers)

	validIDs := make(map[string]struct{}, len(state.Providers))
	for _, profile := range state.Providers {
		validIDs[profile.ID] = struct{}{}
	}

	if _, ok := validIDs[state.CurrentProviderID]; !ok {
		state.CurrentProviderID = ""
	}

	return state
}

func (c *ConfigManager) aiProviderRegistryPath() string {
	return filepath.Join(c.configDir, "ai_providers.json")
}

func (c *ConfigManager) GetAIProviderRegistry() AIProviderRegistry {
	registry := AIProviderRegistry{
		Providers: []AIProviderProfile{},
	}
	if c == nil {
		return normalizeAIProviderRegistry(registry)
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(c.aiProviderRegistryPath())
	if err != nil {
		return normalizeAIProviderRegistry(registry)
	}
	_ = json.Unmarshal(data, &registry)
	return normalizeAIProviderRegistry(registry)
}

func (c *ConfigManager) SaveAIProviderRegistry(registry AIProviderRegistry) error {
	if c == nil {
		return nil
	}
	normalized := normalizeAIProviderRegistry(registry)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return atomicWriteFile(c.aiProviderRegistryPath(), data, 0600)
}

func (c *ConfigManager) GetAIProviderState() AIProviderState {
	if c == nil {
		return normalizeAIProviderState(AIProviderState{Providers: []AIProviderProfile{}})
	}
	registry := c.GetAIProviderRegistry()
	globalSettings := c.GetAIGlobalSettings()
	return normalizeAIProviderState(AIProviderState{
		CurrentProviderID: globalSettings.CurrentProviderID,
		Providers:         registry.Providers,
	})
}

func (c *ConfigManager) SaveAIProviderState(state AIProviderState) error {
	if c == nil {
		return nil
	}
	normalized := normalizeAIProviderState(state)
	if err := c.SaveAIProviderRegistry(AIProviderRegistry{Providers: normalized.Providers}); err != nil {
		return err
	}
	globalSettings := c.GetAIGlobalSettings()
	globalSettings.CurrentProviderID = normalized.CurrentProviderID
	return c.SaveAIGlobalSettings(globalSettings)
}

func (a *App) GetAIProviderState() AIProviderState {
	if a == nil || a.configManager == nil {
		return normalizeAIProviderState(AIProviderState{Providers: []AIProviderProfile{}})
	}
	return a.configManager.GetAIProviderState()
}

func (a *App) SaveAIProviderState(jsonStr string) error {
	state := AIProviderState{
		Providers: []AIProviderProfile{},
	}
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &state); err != nil {
			return err
		}
	}
	if a == nil || a.configManager == nil {
		return nil
	}
	return a.configManager.SaveAIProviderState(state)
}

func toAIProviderRuntimeProfile(profile AIProviderProfile) aiprovider.Profile {
	return aiprovider.Profile{
		Provider:               profile.Provider,
		Model:                  profile.Model,
		BaseURL:                profile.BaseURL,
		APIKey:                 profile.APIKey,
		CacheStrategy:          profile.CacheStrategy,
		ReasoningEffort:        profile.ReasoningEffort,
		EnableReasoningEffort:  profile.EnableReasoningEffort,
		ModelMaxTokens:         profile.ModelMaxTokens,
		ModelMaxThinkingTokens: profile.ModelMaxThinkingTokens,
	}
}

func toAIProviderRuntimeCacheObjects(cacheObjects *AIConversationProviderCacheObjects) *aiprovider.ProviderCacheObjects {
	if cacheObjects == nil || cacheObjects.OpenAIResponses == nil {
		return nil
	}
	return &aiprovider.ProviderCacheObjects{
		OpenAIResponses: &aiprovider.OpenAIResponsesCacheObject{
			ResponseID: strings.TrimSpace(cacheObjects.OpenAIResponses.ResponseID),
			Output:     aiprovider.CloneOpenAIResponsesOutputItems(cacheObjects.OpenAIResponses.Output),
			Include:    normalizeAIStringList(cacheObjects.OpenAIResponses.Include),
			Store:      cacheObjects.OpenAIResponses.Store,
			CapturedAt: cacheObjects.OpenAIResponses.CapturedAt,
		},
	}
}

func toAIProviderRuntimeMessages(messages []AIChatRequestMessage) []aiprovider.ChatMessage {
	converted := make([]aiprovider.ChatMessage, 0, len(messages))
	for _, message := range messages {
		converted = append(converted, aiprovider.ChatMessage{
			Role:         message.Role,
			Content:      message.Content,
			Images:       normalizeAIStringList(message.Images),
			CacheObjects: toAIProviderRuntimeCacheObjects(message.CacheObjects),
		})
	}
	return converted
}