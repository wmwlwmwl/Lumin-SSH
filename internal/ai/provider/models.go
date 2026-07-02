package provider

import "strings"

func normalizeProviderProtocol(value string) string {
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

func normalizeReasoningEffort(value string) string {
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

const (
	AIProviderReasoningModeNone   = "none"
	AIProviderReasoningModeBinary = "binary"
	AIProviderReasoningModeEffort = "effort"
	AIProviderReasoningModeBudget = "budget"
)

type AIProviderModelCapability struct {
	Provider                 string   `json:"provider,omitempty"`
	ModelID                  string   `json:"modelId,omitempty"`
	Known                    bool     `json:"known"`
	SupportsPromptCache      bool     `json:"supportsPromptCache"`
	PromptCacheRetention     string   `json:"promptCacheRetention,omitempty"`
	SupportsReasoningBinary  bool     `json:"supportsReasoningBinary"`
	SupportsReasoningBudget  bool     `json:"supportsReasoningBudget"`
	RequiredReasoningBudget  bool     `json:"requiredReasoningBudget"`
	SupportsReasoningEffort  []string `json:"supportsReasoningEffort,omitempty"`
	RequiredReasoningEffort  bool     `json:"requiredReasoningEffort"`
	ReasoningEffort          string   `json:"reasoningEffort,omitempty"`
	ReasoningMode            string   `json:"reasoningMode,omitempty"`
	MaxTokens                int      `json:"maxTokens,omitempty"`
	MaxThinkingTokens        int      `json:"maxThinkingTokens,omitempty"`
	SupportsTemperature      bool     `json:"supportsTemperature"`
}

type aiProviderModelCapabilityRule struct {
	MatchExact    string
	MatchPrefix   string
	MatchContains string
	Capability    AIProviderModelCapability
}

var compatibleProviderModelCapabilityRules = []aiProviderModelCapabilityRule{
	{
		MatchPrefix: "gpt-5.4",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "24h",
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
				"xhigh",
			},
			ReasoningEffort:     "xhigh",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchPrefix: "gpt-5.2",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "24h",
			SupportsReasoningEffort: []string{
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
			},
			ReasoningEffort:     "medium",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchPrefix: "gpt-5.1",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "24h",
			SupportsReasoningEffort: []string{
				"none",
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "medium",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchPrefix: "gpt-5-chat",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "24h",
			ReasoningMode:        AIProviderReasoningModeNone,
			SupportsTemperature:  false,
		},
	},
	{
		MatchExact: "gpt-5",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "24h",
			ReasoningMode:        AIProviderReasoningModeNone,
			SupportsTemperature:  false,
		},
	},
	{
		MatchContains: "codex",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "24h",
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "medium",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchExact: "o4-mini-high",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "high",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchExact: "o4-mini-low",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "low",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchPrefix: "o4-mini",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "medium",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchExact: "o3-mini-high",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "high",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchExact: "o3-mini-low",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "low",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchPrefix: "o3-mini",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "medium",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchExact: "o3-low",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "low",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchPrefix: "o3",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "medium",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
	{
		MatchPrefix: "o1",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			SupportsReasoningEffort: []string{
				"low",
				"medium",
				"high",
			},
			ReasoningEffort:     "high",
			ReasoningMode:       AIProviderReasoningModeEffort,
			SupportsTemperature: false,
		},
	},
}

var responsesProviderModelCapabilityRules = compatibleProviderModelCapabilityRules

var messagesProviderModelCapabilityRules = []aiProviderModelCapabilityRule{
	{
		MatchExact: "claude-opus-4-8",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "in_memory",
			SupportsReasoningBudget: true,
			RequiredReasoningBudget: false,
			ReasoningMode:       AIProviderReasoningModeBudget,
			MaxTokens:           16384,
			MaxThinkingTokens:   8192,
			SupportsTemperature: true,
		},
	},
	{
		MatchContains: "claude-opus-4",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "in_memory",
			SupportsReasoningBudget: true,
			RequiredReasoningBudget: false,
			ReasoningMode:       AIProviderReasoningModeBudget,
			MaxTokens:           16384,
			MaxThinkingTokens:   8192,
			SupportsTemperature: true,
		},
	},
	{
		MatchContains: "claude-sonnet-4",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "in_memory",
			SupportsReasoningBudget: true,
			RequiredReasoningBudget: false,
			ReasoningMode:       AIProviderReasoningModeBudget,
			MaxTokens:           16384,
			MaxThinkingTokens:   8192,
			SupportsTemperature: true,
		},
	},
	{
		MatchContains: "claude-3.7-sonnet",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "in_memory",
			SupportsReasoningBudget: true,
			RequiredReasoningBudget: false,
			ReasoningMode:       AIProviderReasoningModeBudget,
			MaxTokens:           16384,
			MaxThinkingTokens:   8192,
			SupportsTemperature: true,
		},
	},
	{
		MatchContains: "claude",
		Capability: AIProviderModelCapability{
			Known:                true,
			SupportsPromptCache:  true,
			PromptCacheRetention: "in_memory",
			SupportsReasoningBudget: true,
			RequiredReasoningBudget: false,
			ReasoningMode:       AIProviderReasoningModeBudget,
			MaxTokens:           16384,
			MaxThinkingTokens:   8192,
			SupportsTemperature: true,
		},
	},
}

func normalizeAIProviderModelReasoningEffortOptions(values []string) []string {
	if values == nil {
		return []string{}
	}
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		nextValue := strings.ToLower(strings.TrimSpace(value))
		switch nextValue {
		case "disable", "none", "minimal", "low", "medium", "high", "xhigh":
		default:
			continue
		}
		if _, exists := seen[nextValue]; exists {
			continue
		}
		seen[nextValue] = struct{}{}
		normalized = append(normalized, nextValue)
	}
	return normalized
}

func buildConservativeAIProviderModelCapability(provider string, modelID string) AIProviderModelCapability {
	return AIProviderModelCapability{
		Provider:            normalizeProviderProtocol(provider),
		ModelID:             strings.TrimSpace(modelID),
		Known:               false,
		ReasoningMode:       AIProviderReasoningModeNone,
		SupportsTemperature: true,
	}
}

func finalizeAIProviderModelCapability(provider string, modelID string, capability AIProviderModelCapability) AIProviderModelCapability {
	capability.Provider = normalizeProviderProtocol(provider)
	capability.ModelID = strings.TrimSpace(modelID)
	capability.ReasoningMode = strings.TrimSpace(capability.ReasoningMode)
	if capability.ReasoningMode == "" {
		switch {
		case capability.SupportsReasoningBudget || capability.RequiredReasoningBudget:
			capability.ReasoningMode = AIProviderReasoningModeBudget
		case capability.SupportsReasoningBinary:
			capability.ReasoningMode = AIProviderReasoningModeBinary
		case len(capability.SupportsReasoningEffort) > 0:
			capability.ReasoningMode = AIProviderReasoningModeEffort
		default:
			capability.ReasoningMode = AIProviderReasoningModeNone
		}
	}
	capability.SupportsReasoningEffort = normalizeAIProviderModelReasoningEffortOptions(capability.SupportsReasoningEffort)
	capability.ReasoningEffort = strings.ToLower(strings.TrimSpace(capability.ReasoningEffort))
	return capability
}

func matchesAIProviderModelCapabilityRule(rule aiProviderModelCapabilityRule, normalizedModelID string) bool {
	switch {
	case rule.MatchExact != "":
		return normalizedModelID == strings.ToLower(strings.TrimSpace(rule.MatchExact))
	case rule.MatchPrefix != "":
		return strings.HasPrefix(normalizedModelID, strings.ToLower(strings.TrimSpace(rule.MatchPrefix)))
	case rule.MatchContains != "":
		return strings.Contains(normalizedModelID, strings.ToLower(strings.TrimSpace(rule.MatchContains)))
	default:
		return false
	}
}

func getAIProviderModelCapabilityRules(provider string) []aiProviderModelCapabilityRule {
	switch normalizeProviderProtocol(provider) {
	case "Responses":
		return responsesProviderModelCapabilityRules
	case "Messages":
		return messagesProviderModelCapabilityRules
	default:
		return compatibleProviderModelCapabilityRules
	}
}

func ResolveModelCapability(provider string, modelID string) AIProviderModelCapability {
	normalizedModelID := strings.ToLower(strings.TrimSpace(modelID))
	if normalizedModelID == "" {
		return buildConservativeAIProviderModelCapability(provider, modelID)
	}
	for _, rule := range getAIProviderModelCapabilityRules(provider) {
		if matchesAIProviderModelCapabilityRule(rule, normalizedModelID) {
			return finalizeAIProviderModelCapability(provider, modelID, rule.Capability)
		}
	}
	return buildConservativeAIProviderModelCapability(provider, modelID)
}

func providerSupportsAIQuickEditPromptCache(provider string) bool {
	switch normalizeProviderProtocol(provider) {
	case "Compatible", "Messages":
		return true
	default:
		return false
	}
}

func providerSupportsAIQuickEditWebSearch(provider string) bool {
	switch normalizeProviderProtocol(provider) {
	case "Compatible", "Responses", "Messages":
		return true
	default:
		return false
	}
}

func CanBeDedicatedWebSearchCandidate(provider string) bool {
	switch normalizeProviderProtocol(provider) {
	case "Compatible", "Responses":
		return true
	default:
		return false
	}
}