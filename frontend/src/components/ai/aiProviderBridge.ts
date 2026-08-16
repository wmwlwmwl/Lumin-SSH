import { t } from '../../i18n.ts'
import { canUseDedicatedWebSearchCandidate } from './providers/index.ts'

export type AIProvider = {
  id: string
  name: string
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  cacheStrategy: string
  webSearchEnabled: boolean
  dedicatedWebSearchEnabled: boolean
  dedicatedWebSearchProviderId: string
  dedicatedProxyEnabled: boolean
  dedicatedProxyId: string
  reasoningEffort: string
  enableReasoningEffort: boolean
  openAiLegacyReasoningFormatEnabled: boolean
  modelMaxTokens: number
  modelMaxThinkingTokens: number
  pinned: boolean
  updatedAt: number
}

export interface AIProviderState {
  currentProviderId: string
  providers: AIProvider[]
}

const EMPTY_STATE: AIProviderState = { currentProviderId: '', providers: [] }
const VALID_PROTOCOLS = new Set<string>(['Compatible', 'Responses', 'Messages'])
const VALID_CACHE_STRATEGIES = new Set<string>(['off', 'model', '5m', '1h', '30m', 'in_memory', '24h'])
const VALID_REASONING_EFFORTS = new Set<string>(['disable', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

interface AIProviderBridgeShape {
  GetAIProviderState?: () => Promise<unknown>
  SaveAIProviderState?: (payload: string) => Promise<unknown>
  GetAIProviderTokenGroup?: (payload: string) => Promise<unknown>
}

function getAppBridge(): AIProviderBridgeShape | null {
  return (window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.AIProviderBindings || window?.go?.wailsapp?.App) as AIProviderBridgeShape | null
}

function normalizeProtocol(value: unknown): string {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return VALID_PROTOCOLS.has(nextValue) ? nextValue : 'Compatible'
}

function normalizeCacheStrategy(value: unknown): string {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return VALID_CACHE_STRATEGIES.has(nextValue) ? nextValue : 'model'
}

function normalizeReasoningEffort(value: unknown): string {
  const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return VALID_REASONING_EFFORTS.has(nextValue) ? nextValue : 'disable'
}

function normalizePositiveInteger(value: unknown): number {
  const nextValue = Number(value)
  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    return 0
  }
  return Math.floor(nextValue)
}

function normalizeModel(value: unknown): string {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return nextValue === t('未选择模型') ? '' : nextValue
}

function normalizeProvider(provider: unknown, index: number): AIProvider {
  const p = (provider ?? {}) as Record<string, unknown>
  const now = Date.now()
  return {
    id: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `ai-provider-${index}-${now}`,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('未命名供应商'),
    provider: normalizeProtocol(p.provider),
    model: normalizeModel(p.model),
    baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl.trim() : '',
    apiKey: typeof p.apiKey === 'string' ? p.apiKey.trim() : '',
    cacheStrategy: normalizeCacheStrategy(p.cacheStrategy),
    webSearchEnabled: p.webSearchEnabled !== false,
    dedicatedWebSearchEnabled: Boolean(p.dedicatedWebSearchEnabled),
    dedicatedWebSearchProviderId: typeof p.dedicatedWebSearchProviderId === 'string' ? p.dedicatedWebSearchProviderId.trim() : '',
    dedicatedProxyEnabled: Boolean(p.dedicatedProxyEnabled),
    dedicatedProxyId: typeof p.dedicatedProxyId === 'string' ? p.dedicatedProxyId.trim() : '',
    reasoningEffort: normalizeReasoningEffort(p.reasoningEffort),
    enableReasoningEffort: Boolean(p.enableReasoningEffort)
      || normalizeReasoningEffort(p.reasoningEffort) !== 'disable'
      || normalizePositiveInteger(p.modelMaxTokens) > 0
      || normalizePositiveInteger(p.modelMaxThinkingTokens) > 0,
    openAiLegacyReasoningFormatEnabled: p.openAiLegacyReasoningFormatEnabled === true,
    modelMaxTokens: normalizePositiveInteger(p.modelMaxTokens),
    modelMaxThinkingTokens: normalizePositiveInteger(p.modelMaxThinkingTokens),
    pinned: Boolean(p.pinned),
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
  }
}

export function normalizeAIProviderState(state: unknown): AIProviderState {
  const stateRecord = (state ?? {}) as { providers?: unknown; currentProviderId?: unknown }
  const providers = Array.isArray(stateRecord.providers) ? stateRecord.providers.map((provider, index) => normalizeProvider(provider, index)) : []
  const idSet = new Set(providers.map((provider) => provider.id))

  const normalizedProviders = providers.map((provider) => {
    const webSearchEnabled = provider.webSearchEnabled
    let dedicatedWebSearchEnabled = provider.dedicatedWebSearchEnabled
    let dedicatedWebSearchProviderId = provider.dedicatedWebSearchProviderId
    const dedicatedCandidateIds = new Set(
      providers
        .filter((item) => item.id !== provider.id)
        .filter((item) => canUseDedicatedWebSearchCandidate(item.provider))
        .map((item) => item.id),
    )

    if (dedicatedWebSearchProviderId === provider.id) {
      dedicatedWebSearchProviderId = ''
    }

    if (dedicatedWebSearchEnabled) {
      if (!dedicatedWebSearchProviderId || !dedicatedCandidateIds.has(dedicatedWebSearchProviderId)) {
        const fallbackProvider = providers.find((item) => item.id !== provider.id && canUseDedicatedWebSearchCandidate(item.provider))
        dedicatedWebSearchProviderId = fallbackProvider?.id || ''
        dedicatedWebSearchEnabled = Boolean(dedicatedWebSearchProviderId)
      }
    } else if (dedicatedWebSearchProviderId && !dedicatedCandidateIds.has(dedicatedWebSearchProviderId)) {
      dedicatedWebSearchProviderId = ''
    }

    return {
      ...provider,
      webSearchEnabled,
      dedicatedWebSearchEnabled,
      dedicatedWebSearchProviderId,
    }
  })

  const currentProviderId = typeof stateRecord.currentProviderId === 'string' && idSet.has(stateRecord.currentProviderId)
    ? stateRecord.currentProviderId
    : ''

  return {
    currentProviderId,
    providers: normalizedProviders,
  }
}

export async function getAIProviderState(): Promise<AIProviderState> {
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

export async function getAIProviderTokenGroup(provider: unknown): Promise<unknown> {
  const bridge = getAppBridge()
  if (!bridge?.GetAIProviderTokenGroup) {
    throw new Error(t('Token 分组查询能力未就绪'))
  }
  const normalizedProvider = normalizeProvider(provider || {}, 0)
  return bridge.GetAIProviderTokenGroup(JSON.stringify(normalizedProvider))
}

export async function saveAIProviderState(state: unknown): Promise<AIProviderState> {
  const normalizedState = normalizeAIProviderState(state)
  const bridge = getAppBridge()
  if (!bridge?.SaveAIProviderState) {
    return normalizedState
  }
  await bridge.SaveAIProviderState(JSON.stringify(normalizedState))
  return normalizedState
}