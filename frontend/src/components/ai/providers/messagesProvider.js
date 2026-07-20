const CONSERVATIVE_CAPABILITY = {
  known: false,
  supportsPromptCache: false,
  promptCacheRetention: 'in_memory',
  supportsReasoningBinary: false,
  supportsReasoningBudget: false,
  requiredReasoningBudget: false,
  supportsReasoningEffort: [],
  requiredReasoningEffort: false,
  reasoningEffort: 'disable',
  reasoningMode: 'none',
  maxTokens: 0,
  maxThinkingTokens: 0,
  supportsTemperature: true,
}

const capabilityRules = [
  {
    matchExact: 'claude-opus-4-8',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: 'in_memory',
      supportsReasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      requiredReasoningEffort: false,
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      maxTokens: 16384,
      maxThinkingTokens: 8192,
      supportsTemperature: true,
    },
  },
  {
    matchContains: 'claude-opus-4',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: 'in_memory',
      supportsReasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      requiredReasoningEffort: false,
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      maxTokens: 16384,
      maxThinkingTokens: 8192,
      supportsTemperature: true,
    },
  },
  {
    matchContains: 'claude-sonnet-4',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: 'in_memory',
      supportsReasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      requiredReasoningEffort: false,
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      maxTokens: 16384,
      maxThinkingTokens: 8192,
      supportsTemperature: true,
    },
  },
  {
    matchContains: 'claude-3.7-sonnet',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: 'in_memory',
      supportsReasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      requiredReasoningEffort: false,
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      maxTokens: 16384,
      maxThinkingTokens: 8192,
      supportsTemperature: true,
    },
  },
  {
    matchContains: 'claude',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: 'in_memory',
      supportsReasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      requiredReasoningEffort: false,
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      maxTokens: 16384,
      maxThinkingTokens: 8192,
      supportsTemperature: true,
    },
  },
]

function buildCapability(modelId, patch = {}) {
  return {
    ...CONSERVATIVE_CAPABILITY,
    modelId: typeof modelId === 'string' ? modelId.trim() : '',
    ...patch,
  }
}

function matchesRule(rule, normalizedModelId) {
  if (rule.matchExact) {
    return normalizedModelId === rule.matchExact.toLowerCase()
  }
  if (rule.matchPrefix) {
    return normalizedModelId.startsWith(rule.matchPrefix.toLowerCase())
  }
  if (rule.matchContains) {
    return normalizedModelId.includes(rule.matchContains.toLowerCase())
  }
  return false
}

function getModelCapability(modelId) {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim().toLowerCase() : ''
  if (!normalizedModelId) {
    return buildCapability(modelId)
  }
  const matchedRule = capabilityRules.find((rule) => matchesRule(rule, normalizedModelId))
  return matchedRule ? buildCapability(modelId, matchedRule.capability) : buildCapability(modelId)
}

export const messagesProvider = {
  value: 'Messages',
  label: 'Messages',
  defaultModel: '',
  initialModels: [],
  supportsPromptCacheSettings: true,
  supportsWebSearch: true,
  supportsDedicatedWebSearchCandidate: false,
  getModelCapability,
}