import { t } from '../../i18n.js'

const EMPTY_STATE = { currentProviderId: '', providers: [] }
const VALID_PROTOCOLS = new Set(['Compatible', 'Responses', 'Messages'])
const VALID_CACHE_STRATEGIES = new Set(['off', 'model', '5m', '1h'])
const VALID_REASONING_EFFORTS = new Set(['disable', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

function getAppBridge() {
  return window?.go?.main?.AIBindings || window?.go?.main?.AIProviderBindings || window?.go?.main?.App
}

function normalizeProtocol(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return VALID_PROTOCOLS.has(nextValue) ? nextValue : 'Compatible'
}

function normalizeCacheStrategy(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return VALID_CACHE_STRATEGIES.has(nextValue) ? nextValue : 'model'
}

function normalizeReasoningEffort(value) {
  const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return VALID_REASONING_EFFORTS.has(nextValue) ? nextValue : 'disable'
}

function normalizePositiveInteger(value) {
  const nextValue = Number(value)
  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    return 0
  }
  return Math.floor(nextValue)
}

function normalizeProvider(provider, index) {
  const now = Date.now()
  return {
    id: typeof provider?.id === 'string' && provider.id.trim() ? provider.id.trim() : `ai-provider-${index}-${now}`,
    name: typeof provider?.name === 'string' && provider.name.trim() ? provider.name.trim() : t('未命名供应商'),
    provider: normalizeProtocol(provider?.provider),
    model: typeof provider?.model === 'string' && provider.model.trim() ? provider.model.trim() : t('未选择模型'),
    baseUrl: typeof provider?.baseUrl === 'string' ? provider.baseUrl.trim() : '',
    apiKey: typeof provider?.apiKey === 'string' ? provider.apiKey.trim() : '',
    cacheStrategy: normalizeCacheStrategy(provider?.cacheStrategy),
    webSearchEnabled: provider?.webSearchEnabled !== false,
    dedicatedWebSearchEnabled: Boolean(provider?.dedicatedWebSearchEnabled),
    dedicatedWebSearchProviderId: typeof provider?.dedicatedWebSearchProviderId === 'string' ? provider.dedicatedWebSearchProviderId.trim() : '',
    reasoningEffort: normalizeReasoningEffort(provider?.reasoningEffort),
    enableReasoningEffort: Boolean(provider?.enableReasoningEffort)
      || normalizeReasoningEffort(provider?.reasoningEffort) !== 'disable'
      || normalizePositiveInteger(provider?.modelMaxTokens) > 0
      || normalizePositiveInteger(provider?.modelMaxThinkingTokens) > 0,
    modelMaxTokens: normalizePositiveInteger(provider?.modelMaxTokens),
    modelMaxThinkingTokens: normalizePositiveInteger(provider?.modelMaxThinkingTokens),
    pinned: Boolean(provider?.pinned),
    updatedAt: typeof provider?.updatedAt === 'number' ? provider.updatedAt : now,
  }
}

export function normalizeAIProviderState(state) {
  const providers = Array.isArray(state?.providers) ? state.providers.map((provider, index) => normalizeProvider(provider, index)) : []
  const idSet = new Set(providers.map((provider) => provider.id))

  const normalizedProviders = providers.map((provider) => {
    let webSearchEnabled = provider.webSearchEnabled
    let dedicatedWebSearchEnabled = provider.dedicatedWebSearchEnabled
    let dedicatedWebSearchProviderId = provider.dedicatedWebSearchProviderId

    if (webSearchEnabled) {
      dedicatedWebSearchEnabled = false
    }

    if (dedicatedWebSearchProviderId === provider.id) {
      dedicatedWebSearchProviderId = ''
    }

    if (dedicatedWebSearchEnabled) {
      if (!dedicatedWebSearchProviderId || !idSet.has(dedicatedWebSearchProviderId)) {
        const fallbackProvider = providers.find((item) => item.id !== provider.id)
        dedicatedWebSearchProviderId = fallbackProvider?.id || ''
        dedicatedWebSearchEnabled = Boolean(dedicatedWebSearchProviderId)
      }
    } else if (dedicatedWebSearchProviderId && !idSet.has(dedicatedWebSearchProviderId)) {
      dedicatedWebSearchProviderId = ''
    }

    return {
      ...provider,
      webSearchEnabled,
      dedicatedWebSearchEnabled,
      dedicatedWebSearchProviderId,
    }
  })

  const currentProviderId = typeof state?.currentProviderId === 'string' && idSet.has(state.currentProviderId)
    ? state.currentProviderId
    : ''

  return {
    currentProviderId,
    providers: normalizedProviders,
  }
}

export async function getAIProviderState() {
  const bridge = getAppBridge()
  if (!bridge?.GetAIProviderState) {
    return EMPTY_STATE
  }
  try {
    const state = await bridge.GetAIProviderState()
    return normalizeAIProviderState(state)
  } catch {
    return EMPTY_STATE
  }
}

export async function saveAIProviderState(state) {
  const normalizedState = normalizeAIProviderState(state)
  const bridge = getAppBridge()
  if (!bridge?.SaveAIProviderState) {
    return normalizedState
  }
  await bridge.SaveAIProviderState(JSON.stringify(normalizedState))
  return normalizedState
}