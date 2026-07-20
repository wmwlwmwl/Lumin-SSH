const VALID_REASONING_EFFORTS = new Set(['disable', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

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
    matchPrefix: 'gpt-5.4',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: '24h',
      supportsReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
      reasoningEffort: 'xhigh',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchPrefix: 'gpt-5.2',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: '24h',
      supportsReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'],
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchPrefix: 'gpt-5.1',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: '24h',
      supportsReasoningEffort: ['none', 'low', 'medium', 'high'],
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchPrefix: 'gpt-5-chat',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: '24h',
      reasoningMode: 'none',
      supportsTemperature: false,
    },
  },
  {
    matchExact: 'gpt-5',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: '24h',
      reasoningMode: 'none',
      supportsTemperature: false,
    },
  },
  {
    matchContains: 'codex',
    capability: {
      known: true,
      supportsPromptCache: true,
      promptCacheRetention: '24h',
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchExact: 'o4-mini-high',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'high',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchExact: 'o4-mini-low',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'low',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchPrefix: 'o4-mini',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchExact: 'o3-mini-high',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'high',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchExact: 'o3-mini-low',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'low',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchPrefix: 'o3-mini',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchExact: 'o3-low',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'low',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchPrefix: 'o3',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'medium',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
  {
    matchPrefix: 'o1',
    capability: {
      known: true,
      supportsPromptCache: true,
      supportsReasoningEffort: ['low', 'medium', 'high'],
      reasoningEffort: 'high',
      reasoningMode: 'effort',
      supportsTemperature: false,
    },
  },
]

function normalizeReasoningEffortOptions(values) {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set()
  const normalized = []
  values.forEach((value) => {
    const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (!VALID_REASONING_EFFORTS.has(nextValue) || seen.has(nextValue)) {
      return
    }
    seen.add(nextValue)
    normalized.push(nextValue)
  })
  return normalized
}

function buildCapability(modelId, patch = {}) {
  return {
    ...CONSERVATIVE_CAPABILITY,
    modelId: typeof modelId === 'string' ? modelId.trim() : '',
    ...patch,
    supportsReasoningEffort: normalizeReasoningEffortOptions(patch.supportsReasoningEffort),
    reasoningEffort: typeof patch.reasoningEffort === 'string' ? patch.reasoningEffort.trim().toLowerCase() : CONSERVATIVE_CAPABILITY.reasoningEffort,
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

export const responsesProvider = {
  value: 'Responses',
  label: 'Responses',
  defaultModel: '',
  initialModels: [],
  supportsPromptCacheSettings: false,
  supportsWebSearch: true,
  supportsDedicatedWebSearchCandidate: true,
  getModelCapability,
}