import { t } from '../../i18n.js'
import { runAIProviderPasteHandlerById } from './aiProviderPasteHandlers.js'

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

export function isBuiltinAIProvider(provider) {
  return provider?.builtin === true
}

function cloneApiKeyField(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function readEmbeddedBrowserPathValue(source, path) {
  if (!source || typeof source !== 'object' || typeof path !== 'string' || !path.trim()) {
    return undefined
  }
  return path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current === undefined || current === null) {
        return undefined
      }
      if (typeof current === 'string') {
        try {
          current = JSON.parse(current)
        } catch {
          return undefined
        }
      }
      if (typeof current !== 'object') {
        return undefined
      }
      return current[segment]
    }, source)
}

function resolveEmbeddedBrowserStorageValue(bucket, pathConfig, sourceType) {
  if (!bucket || !pathConfig || typeof pathConfig !== 'object') {
    return undefined
  }
  if (sourceType === 'cookie' && Array.isArray(bucket)) {
    const expectedDomain = typeof pathConfig.domain === 'string' ? pathConfig.domain.trim() : ''
    const expectedName = typeof pathConfig.name === 'string' ? pathConfig.name.trim() : ''
    const matchedItem = bucket.find((item) => {
      const itemDomain = typeof item?.domain === 'string' ? item.domain.trim() : ''
      const itemName = typeof item?.name === 'string' ? item.name.trim() : (typeof item?.key === 'string' ? item.key.trim() : '')
      return (!expectedDomain || itemDomain === expectedDomain) && expectedName && itemName === expectedName
    })
    return matchedItem?.value
  }
  const expectedKey = typeof pathConfig.key === 'string' ? pathConfig.key.trim() : ''
  if (Array.isArray(bucket)) {
    const exactItem = bucket.find((item) => {
      const itemKey = typeof item?.key === 'string' ? item.key.trim() : (typeof item?.name === 'string' ? item.name.trim() : '')
      const itemOrigin = typeof item?.origin === 'string' ? item.origin.trim() : ''
      const expectedOrigin = typeof pathConfig.origin === 'string' ? pathConfig.origin.trim() : ''
      return itemKey === expectedKey && (!expectedOrigin || !itemOrigin || itemOrigin === expectedOrigin)
    })
    if (exactItem?.value !== undefined) {
      return exactItem.value
    }
    if (expectedKey.includes('.')) {
      const [rootKey, ...restPath] = expectedKey.split('.')
      const nestedItem = bucket.find((item) => {
        const itemKey = typeof item?.key === 'string' ? item.key.trim() : (typeof item?.name === 'string' ? item.name.trim() : '')
        return itemKey === rootKey
      })
      if (nestedItem?.value !== undefined) {
        return readEmbeddedBrowserPathValue(nestedItem.value, restPath.join('.'))
      }
    }
    return undefined
  }
  if (expectedKey && Object.prototype.hasOwnProperty.call(bucket, expectedKey)) {
    return bucket[expectedKey]
  }
  return readEmbeddedBrowserPathValue(bucket, expectedKey)
}

export function resolveEmbeddedBrowserAPIKey(payload, apiKeyField) {
  const directCandidates = [
    payload?.apiKey,
    payload?.token,
    payload?.value,
    payload?.accessToken,
  ]
  const directApiKey = directCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim())
  if (directApiKey) {
    return directApiKey.trim()
  }
  if (!apiKeyField || typeof apiKeyField !== 'object') {
    return ''
  }
  const sourceType = typeof apiKeyField?.source === 'string' ? apiKeyField.source.trim().toLowerCase() : ''
  const pathConfig = apiKeyField?.path && typeof apiKeyField.path === 'object' ? apiKeyField.path : null
  let bucket = null
  if (sourceType === 'cookie') {
    bucket = payload?.cookies ?? payload?.cookie ?? payload?.cookieJar ?? null
  } else if (sourceType === 'local_storage') {
    bucket = payload?.localStorage ?? payload?.local_storage ?? payload?.storage?.localStorage ?? payload?.storage?.local_storage ?? null
  } else if (sourceType === 'session_storage') {
    bucket = payload?.sessionStorage ?? payload?.session_storage ?? payload?.storage?.sessionStorage ?? payload?.storage?.session_storage ?? null
  }
  const resolvedValue = resolveEmbeddedBrowserStorageValue(bucket, pathConfig, sourceType)
  return typeof resolvedValue === 'string' ? resolvedValue.trim() : ''
}

export function runAIProviderAPIKeyPasteHandler(rawText, apiKeyField) {
  const normalizedText = typeof rawText === 'string' ? rawText : ''
  const handlerId = typeof apiKeyField?.paste?.handlerId === 'string' ? apiKeyField.paste.handlerId.trim() : ''
  return runAIProviderPasteHandlerById(
    handlerId,
    normalizedText,
    cloneApiKeyField(apiKeyField),
    { resolveEmbeddedBrowserAPIKey },
  )
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
    dedicatedProxyEnabled: Boolean(provider?.dedicatedProxyEnabled),
    dedicatedProxyId: typeof provider?.dedicatedProxyId === 'string' ? provider.dedicatedProxyId.trim() : '',
    reasoningEffort: normalizeReasoningEffort(provider?.reasoningEffort),
    enableReasoningEffort: Boolean(provider?.enableReasoningEffort)
      || normalizeReasoningEffort(provider?.reasoningEffort) !== 'disable'
      || normalizePositiveInteger(provider?.modelMaxTokens) > 0
      || normalizePositiveInteger(provider?.modelMaxThinkingTokens) > 0,
    openAiLegacyReasoningFormatEnabled: provider?.openAiLegacyReasoningFormatEnabled === true,
    modelMaxTokens: normalizePositiveInteger(provider?.modelMaxTokens),
    modelMaxThinkingTokens: normalizePositiveInteger(provider?.modelMaxThinkingTokens),
    pinned: Boolean(provider?.pinned),
    builtin: provider?.builtin === true,
    builtinLoginURL: typeof provider?.builtinLoginUrl === 'string'
      ? provider.builtinLoginUrl.trim()
      : (typeof provider?.builtinLoginURL === 'string' ? provider.builtinLoginURL.trim() : ''),
    apiKeyField: cloneApiKeyField(provider?.apiKeyField),
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