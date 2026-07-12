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
	ID                                 string         `json:"id"`
	Name                               string         `json:"name"`
	Provider                           string         `json:"provider"`
	Model                              string         `json:"model"`
	BaseURL                            string         `json:"baseUrl"`
	APIKey                             string         `json:"apiKey"`
	CacheStrategy                      string         `json:"cacheStrategy"`
	WebSearchEnabled                   bool           `json:"webSearchEnabled"`
	DedicatedWebSearchEnabled          bool           `json:"dedicatedWebSearchEnabled"`
	DedicatedWebSearchProviderID       string         `json:"dedicatedWebSearchProviderId,omitempty"`
	DedicatedProxyEnabled              bool           `json:"dedicatedProxyEnabled"`
	DedicatedProxyID                   string         `json:"dedicatedProxyId,omitempty"`
	ReasoningEffort                    string         `json:"reasoningEffort"`
	EnableReasoningEffort              bool           `json:"enableReasoningEffort"`
	OpenAILegacyReasoningFormatEnabled bool           `json:"openAiLegacyReasoningFormatEnabled"`
	ModelMaxTokens                     int            `json:"modelMaxTokens,omitempty"`
	ModelMaxThinkingTokens             int            `json:"modelMaxThinkingTokens,omitempty"`
	Pinned                             bool           `json:"pinned"`
	Builtin                            bool           `json:"builtin,omitempty"`
	BuiltinLoginURL                    string         `json:"builtinLoginUrl,omitempty"`
	APIKeyField                        map[string]any `json:"apiKeyField,omitempty"`
	UpdatedAt                          int64          `json:"updatedAt,omitempty"`
}

type AIProviderRegistry struct {
	Providers []AIProviderProfile `json:"providers"`
}

type AIProviderState struct {
	CurrentProviderID string              `json:"currentProviderId"`
	Providers         []AIProviderProfile `json:"providers"`
}

const (
	aiBuiltinProviderNamePrefix = "[内置]-"
)

func cloneAIProviderAnyMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var cloned map[string]any
	if err := json.Unmarshal(data, &cloned); err != nil {
		return nil
	}
	return cloned
}

var aiBuiltinProviderPresetMap = map[string]AIProviderProfile{
	"builtin-kimi": {
		ID:              "builtin-kimi",
		Name:            aiBuiltinProviderNamePrefix + "Kimi",
		Provider:        "Compatible",
		BaseURL:         "http://127.0.0.1:9543/v1",
		BuiltinLoginURL: "https://www.kimi.com/",
		APIKeyField: map[string]any{
			"expression": "^.+$",
			"paste": map[string]any{
				"handlerId": "builtin-kimi-local-storage-json-v1",
			},
		},
		Model:   "",
		Pinned:  false,
		Builtin: true,
	},
}

func GetAIBuiltinProviderPreset(providerID string) (AIProviderProfile, bool) {
	preset, ok := aiBuiltinProviderPresetMap[strings.TrimSpace(providerID)]
	return preset, ok
}

func isAIBuiltinProviderName(name string) bool {
	return strings.HasPrefix(strings.TrimSpace(name), aiBuiltinProviderNamePrefix)
}

func IsAIBuiltinProviderProfile(profile AIProviderProfile) bool {
	if _, ok := GetAIBuiltinProviderPreset(profile.ID); ok {
		return true
	}
	return isAIBuiltinProviderName(profile.Name)
}

func FindAIBuiltinProvider(profiles []AIProviderProfile) *AIProviderProfile {
	for index := range profiles {
		if IsAIBuiltinProviderProfile(profiles[index]) {
			profile := profiles[index]
			return &profile
		}
	}
	return nil
}

func BuildAIBuiltinProviderProfile(profile AIProviderProfile, preservedAPIKey string) AIProviderProfile {
	preset, ok := GetAIBuiltinProviderPreset(profile.ID)
	if !ok {
		preset = aiBuiltinProviderPresetMap["builtin-kimi"]
	}
	nextProfile := profile
	nextProfile.ID = preset.ID
	nextProfile.Name = preset.Name
	nextProfile.Provider = preset.Provider
	nextProfile.BaseURL = preset.BaseURL
	nextProfile.Pinned = preset.Pinned
	nextProfile.Builtin = true
	nextProfile.BuiltinLoginURL = strings.TrimSpace(preset.BuiltinLoginURL)
	nextProfile.APIKeyField = cloneAIProviderAnyMap(preset.APIKeyField)
	nextProfile.Model = strings.TrimSpace(nextProfile.Model)
	if nextProfile.Model == "" {
		nextProfile.Model = strings.TrimSpace(preset.Model)
	}
	if trimmedAPIKey := strings.TrimSpace(preservedAPIKey); trimmedAPIKey != "" {
		nextProfile.APIKey = trimmedAPIKey
	} else {
		nextProfile.APIKey = strings.TrimSpace(nextProfile.APIKey)
	}
	return nextProfile
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

func normalizeAIProviderProfilesWithBuiltin(profiles []AIProviderProfile, existingBuiltin *AIProviderProfile) []AIProviderProfile {
	if profiles == nil {
		profiles = []AIProviderProfile{}
	}

	now := time.Now().UnixMilli()
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
		profile.Builtin = false
		profile.BuiltinLoginURL = ""
		profile.APIKeyField = nil
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
	}

	builtinCandidate := AIProviderProfile{}
	if existingBuiltin != nil {
		builtinCandidate = *existingBuiltin
	}
	for _, profile := range normalized {
		if IsAIBuiltinProviderProfile(profile) {
			builtinCandidate = profile
			break
		}
	}

	filtered := make([]AIProviderProfile, 0, len(normalized)+1)
	for _, profile := range normalized {
		if IsAIBuiltinProviderProfile(profile) {
			continue
		}
		filtered = append(filtered, profile)
	}
	normalized = append(filtered, BuildAIBuiltinProviderProfile(builtinCandidate, builtinCandidate.APIKey))

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

func normalizeAIProviderProfiles(profiles []AIProviderProfile) []AIProviderProfile {
	return normalizeAIProviderProfilesWithBuiltin(profiles, nil)
}

func normalizeAIProviderRegistryWithBuiltin(registry AIProviderRegistry, existingBuiltin *AIProviderProfile) AIProviderRegistry {
	registry.Providers = normalizeAIProviderProfilesWithBuiltin(registry.Providers, existingBuiltin)
	return registry
}

func normalizeAIProviderRegistry(registry AIProviderRegistry) AIProviderRegistry {
	return normalizeAIProviderRegistryWithBuiltin(registry, nil)
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
	existingBuiltin := FindAIBuiltinProvider(c.GetAIProviderRegistry().Providers)
	normalized := normalizeAIProviderRegistryWithBuiltin(registry, existingBuiltin)
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
		Provider:                           profile.Provider,
		Model:                              profile.Model,
		BaseURL:                            profile.BaseURL,
		APIKey:                             profile.APIKey,
		CacheStrategy:                      profile.CacheStrategy,
		ReasoningEffort:                    profile.ReasoningEffort,
		EnableReasoningEffort:              profile.EnableReasoningEffort,
		OpenAILegacyReasoningFormatEnabled: profile.OpenAILegacyReasoningFormatEnabled,
		ModelMaxTokens:                     profile.ModelMaxTokens,
		ModelMaxThinkingTokens:             profile.ModelMaxThinkingTokens,
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
