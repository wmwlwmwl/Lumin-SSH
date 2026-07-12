package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	ai "luminssh-go/internal/ai"
	aiprovider "luminssh-go/internal/ai/provider"
)

type AIProviderBindings struct {
	configManager *ConfigManager
}

func NewAIProviderBindings(configManager *ConfigManager) *AIProviderBindings {
	return &AIProviderBindings{configManager: configManager}
}

func (b *AIProviderBindings) GetAIProviderState() ai.AIProviderState {
	if b == nil || b.configManager == nil {
		return normalizeAIProviderStateForBinding(ai.AIProviderState{Providers: []ai.AIProviderProfile{}})
	}
	registry := b.getAIProviderRegistry()
	return normalizeAIProviderStateForBinding(ai.AIProviderState{
		CurrentProviderID: b.readAICurrentProviderID(),
		Providers:         registry.Providers,
	})
}

func (b *AIProviderBindings) SaveAIProviderState(jsonStr string) error {
	state := ai.AIProviderState{
		Providers: []ai.AIProviderProfile{},
	}
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &state); err != nil {
			return err
		}
	}
	normalized := normalizeAIProviderStateForBinding(state)
	if err := b.saveAIProviderRegistry(ai.AIProviderRegistry{Providers: normalized.Providers}); err != nil {
		return err
	}
	return b.saveAICurrentProviderID(normalized.CurrentProviderID)
}

func (b *AIProviderBindings) aiProviderRegistryPath() string {
	return filepath.Join(b.configManager.configDir, "ai_providers.json")
}

func (b *AIProviderBindings) aiGlobalSettingsPath() string {
	return filepath.Join(b.configManager.configDir, "ai_global_settings.json")
}

func (b *AIProviderBindings) getAIProviderRegistry() ai.AIProviderRegistry {
	registry := ai.AIProviderRegistry{
		Providers: []ai.AIProviderProfile{},
	}
	if b == nil || b.configManager == nil {
		registry.Providers = normalizeAIProviderProfilesForBinding(registry.Providers)
		return registry
	}
	data, err := os.ReadFile(b.aiProviderRegistryPath())
	if err == nil {
		_ = json.Unmarshal(data, &registry)
	}
	registry.Providers = normalizeAIProviderProfilesForBinding(registry.Providers)
	return registry
}

func (b *AIProviderBindings) saveAIProviderRegistry(registry ai.AIProviderRegistry) error {
	if b == nil || b.configManager == nil {
		return nil
	}
	existingBuiltin := ai.FindAIBuiltinProvider(b.getAIProviderRegistry().Providers)
	normalizedProviders := normalizeAIProviderProfilesForBinding(registry.Providers)
	if existingBuiltin != nil {
		for index := range normalizedProviders {
			if ai.IsAIBuiltinProviderProfile(normalizedProviders[index]) {
				normalizedProviders[index] = ai.BuildAIBuiltinProviderProfile(normalizedProviders[index], existingBuiltin.APIKey)
			}
		}
	}
	normalized := ai.AIProviderRegistry{
		Providers: normalizedProviders,
	}
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(b.aiProviderRegistryPath(), data, 0600)
}

func (b *AIProviderBindings) readAICurrentProviderID() string {
	if b == nil || b.configManager == nil {
		return ""
	}
	payload := map[string]interface{}{}
	data, err := os.ReadFile(b.aiGlobalSettingsPath())
	if err != nil {
		return ""
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}
	value, _ := payload["currentProviderId"].(string)
	return strings.TrimSpace(value)
}

func (b *AIProviderBindings) saveAICurrentProviderID(currentProviderID string) error {
	if b == nil || b.configManager == nil {
		return nil
	}
	payload := map[string]interface{}{}
	data, err := os.ReadFile(b.aiGlobalSettingsPath())
	if err == nil {
		_ = json.Unmarshal(data, &payload)
	}
	payload["currentProviderId"] = strings.TrimSpace(currentProviderID)
	nextData, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(b.aiGlobalSettingsPath(), nextData, 0600)
}

func normalizeAIProviderProtocolForBinding(value string) string {
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

func normalizeAIProviderCacheStrategyForBinding(value string) string {
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

func normalizeAIProviderReasoningEffortForBinding(value string) string {
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

func normalizeAIProviderProfilesForBinding(profiles []ai.AIProviderProfile) []ai.AIProviderProfile {
	if profiles == nil {
		profiles = []ai.AIProviderProfile{}
	}
	now := time.Now().UnixMilli()
	normalized := make([]ai.AIProviderProfile, len(profiles))
	copy(normalized, profiles)
	for index := range normalized {
		profile := &normalized[index]
		if strings.TrimSpace(profile.ID) == "" {
			profile.ID = "ai-provider-" + strings.TrimSpace(time.UnixMilli(now).Format("20060102150405")) + "-" + strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(time.UnixMilli(now+int64(index)).Format("15:04:05.000"), ":", ""), ".", ""), " ", ""))
		}
		if strings.TrimSpace(profile.Name) == "" {
			profile.Name = "未命名供应商"
		}
		profile.Builtin = false
		profile.BuiltinLoginURL = ""
		profile.Provider = normalizeAIProviderProtocolForBinding(profile.Provider)
		profile.Model = strings.TrimSpace(profile.Model)
		if profile.Model == "" {
			profile.Model = "未选择模型"
		}
		profile.BaseURL = strings.TrimSpace(profile.BaseURL)
		profile.APIKey = strings.TrimSpace(profile.APIKey)
		profile.CacheStrategy = normalizeAIProviderCacheStrategyForBinding(profile.CacheStrategy)
		profile.ReasoningEffort = normalizeAIProviderReasoningEffortForBinding(profile.ReasoningEffort)
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
	builtinCandidate := ai.AIProviderProfile{}
	for _, profile := range normalized {
		if ai.IsAIBuiltinProviderProfile(profile) {
			builtinCandidate = profile
			break
		}
	}
	filtered := make([]ai.AIProviderProfile, 0, len(normalized)+1)
	for _, profile := range normalized {
		if ai.IsAIBuiltinProviderProfile(profile) {
			continue
		}
		filtered = append(filtered, profile)
	}
	normalized = append(filtered, ai.BuildAIBuiltinProviderProfile(builtinCandidate, builtinCandidate.APIKey))
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

func normalizeAIProviderStateForBinding(state ai.AIProviderState) ai.AIProviderState {
	state.CurrentProviderID = strings.TrimSpace(state.CurrentProviderID)
	state.Providers = normalizeAIProviderProfilesForBinding(state.Providers)
	validIDs := make(map[string]struct{}, len(state.Providers))
	for _, profile := range state.Providers {
		validIDs[profile.ID] = struct{}{}
	}
	if _, ok := validIDs[state.CurrentProviderID]; !ok {
		state.CurrentProviderID = ""
	}
	return state
}