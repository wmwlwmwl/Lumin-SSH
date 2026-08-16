import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation, getLanguage, type I18nKey } from '../../i18n.ts'
import AIProviderListRow from './AIProviderListRow.tsx'
import AIProviderQuickEditOverlay from './AIProviderQuickEditOverlay.tsx'
import Tiptop from '../Tiptop.tsx'
import { getAIProviderState, normalizeAIProviderState, saveAIProviderState } from './aiProviderBridge.ts'
import { getAIProviderDefinition } from './providers/index.ts'
import { isCallMyVipProviderHost } from './providerSpecialHosts.ts'

export interface AIProviderLike {
  id?: string
  name?: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  pinned?: boolean
  cacheStrategy?: string
  reasoningEffort?: string
  enableReasoningEffort?: boolean
  dedicatedProxyEnabled?: boolean
  dedicatedProxyId?: string
  webSearchEnabled?: boolean
  dedicatedWebSearchEnabled?: boolean
  dedicatedWebSearchProviderId?: string
  modelMaxTokens?: number
  modelMaxThinkingTokens?: number
  updatedAt?: number
  description?: string
  [key: string]: unknown
}

interface RectLike {
  top: number
  left: number
  right: number
  bottom: number
}

interface AppBridgeShape {
  RequestAIProviderModelsWithProfile?: (payload: string) => Promise<unknown>
  RequestAIProviderModels?: (baseUrl: string, apiKey: string) => Promise<unknown>
}

export interface AIProviderSelectorProps {
  providers?: AIProviderLike[]
  currentProviderId?: string
  onCurrentProviderChange?: (providerId: string) => Promise<void> | void
  balanceRefreshSignal?: number
  persistSelectedProviderId?: boolean
  dismissSignal?: number
}

const defaultProviders: AIProviderLike[] = []
const summaryTooltipDelay = 300
const cacheStrategyLabelKeys: Record<string, I18nKey> = {
  model: '基于模型能力',
  off: '强制关闭',
  '5m': '5分钟',
  '1h': '1小时',
}
const reasoningEffortLabelKeys: Record<string, I18nKey> = {
  none: '无',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
}
const DEFAULT_EFFORT_REASONING_OPTIONS = ['low', 'medium', 'high', 'xhigh']
const adaptiveLabelCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

function getAppBridge(): AppBridgeShape | null {
  return (window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.AIProviderBindings || window?.go?.wailsapp?.App) as AppBridgeShape | null
}

function getCacheStrategyLabel(t: (key: I18nKey) => string, value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return t(cacheStrategyLabelKeys[nextValue] || cacheStrategyLabelKeys.model)
}

function getReasoningEffortLabel(t: (key: I18nKey) => string, value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!nextValue || nextValue === 'disable') {
    return ''
  }
  return t((reasoningEffortLabelKeys[nextValue] || nextValue) as I18nKey)
}

function supportsUnifiedEffortReasoning(providerValue: string) {
  return providerValue === 'Compatible' || providerValue === 'Responses' || providerValue === 'Messages'
}

function buildDisplayModelCapability(providerValue: string, capability: Record<string, unknown> | null | undefined) {
  if (!supportsUnifiedEffortReasoning(providerValue)) {
    return capability || {}
  }
  return {
    ...(capability || {}),
    supportsReasoningBinary: false,
    supportsReasoningBudget: false,
    requiredReasoningBudget: false,
    supportsReasoningEffort: [...DEFAULT_EFFORT_REASONING_OPTIONS],
    requiredReasoningEffort: false,
    reasoningMode: 'effort',
    reasoningEffort: typeof capability?.reasoningEffort === 'string' && capability.reasoningEffort.trim()
      ? capability.reasoningEffort.trim().toLowerCase()
      : 'medium',
    maxTokens: 0,
    maxThinkingTokens: 0,
  }
}

function buildReasoningOptions(capability: Record<string, unknown> | null | undefined) {
  if (capability?.reasoningMode !== 'effort') {
    return []
  }
  const supportedValues = Array.isArray(capability?.supportsReasoningEffort)
    ? capability.supportsReasoningEffort
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim().toLowerCase())
    : []
  const nextOptions = capability?.requiredReasoningEffort
    ? supportedValues
    : ['disable', ...supportedValues.filter((value) => value !== 'disable')]
  return [...new Set(nextOptions)]
}

function getProviderModelSummary(t: (key: I18nKey) => string, provider: AIProviderLike | null | undefined) {
  const model = typeof provider?.model === 'string' ? provider.model.trim() : ''
  if (!model) {
    return t('未选择模型')
  }
  const reasoningEffortLabel = getReasoningEffortLabel(t, provider?.reasoningEffort)
  if (!reasoningEffortLabel || provider?.enableReasoningEffort !== true) {
    return model
  }
  return `${model}(${reasoningEffortLabel})`
}

function measureAdaptiveLabelWidth(text: string, fontSize: number, fontWeight = 500, fontFamily = 'sans-serif') {
  const content = typeof text === 'string' ? text.trim() : ''
  if (!content) {
    return 0
  }
  const context = adaptiveLabelCanvas?.getContext('2d')
  if (!context) {
    return content.length * fontSize
  }
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  return context.measureText(content).width
}

function measureAdaptiveLabelTriggerWidth(text: string, fontSize: number, {
  fontWeight = 500,
  fontFamily = 'sans-serif',
  horizontalPadding = 20,
  minWidth = 36,
}: {
  fontWeight?: number
  fontFamily?: string
  horizontalPadding?: number
  minWidth?: number
} = {}) {
  const contentWidth = measureAdaptiveLabelWidth(text, fontSize, fontWeight, fontFamily)
  if (contentWidth <= 0) {
    return minWidth
  }
  return Math.max(minWidth, Math.ceil(contentWidth + horizontalPadding))
}

function resolveAdaptiveLabelLayout({
  providerText,
  modelText,
  availableWidth,
  providerFontFamily = 'sans-serif',
  modelFontFamily = 'sans-serif',
  fixedWidth = 0,
  baseFontSize = 12,
  minFontSize = 9,
}: {
  providerText?: string
  modelText?: string
  availableWidth?: number
  providerFontFamily?: string
  modelFontFamily?: string
  fixedWidth?: number
  baseFontSize?: number
  minFontSize?: number
} = {}) {
  const normalizedProviderText = typeof providerText === 'string' ? providerText.trim() : ''
  const normalizedModelText = typeof modelText === 'string' ? modelText.trim() : ''
  const normalizedAvailableWidth = typeof availableWidth === 'number' && Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 0
  const sizeOptions: number[] = []
  for (let size = baseFontSize; size >= minFontSize; size -= 1) {
    sizeOptions.push(size)
  }
  const modelSizeOptions = normalizedModelText ? sizeOptions : [baseFontSize]
  let bestLayout: { providerFontSize: number; modelFontSize: number; providerWidth: number; modelWidth: number; totalWidth: number } | null = null
  for (const providerFontSize of sizeOptions) {
    for (const modelFontSize of modelSizeOptions) {
      const providerWidth = measureAdaptiveLabelTriggerWidth(normalizedProviderText, providerFontSize, {
        fontWeight: 500,
        fontFamily: providerFontFamily,
      })
      const modelWidth = normalizedModelText
        ? measureAdaptiveLabelTriggerWidth(normalizedModelText, modelFontSize, {
            fontWeight: 600,
            fontFamily: modelFontFamily,
            minWidth: 32,
          })
        : 0
      const totalWidth = providerWidth + modelWidth + fixedWidth
      if (normalizedAvailableWidth > 0 && totalWidth > normalizedAvailableWidth) {
        continue
      }
      if (
        !bestLayout
        || providerFontSize + modelFontSize > bestLayout.providerFontSize + bestLayout.modelFontSize
        || (
          providerFontSize + modelFontSize === bestLayout.providerFontSize + bestLayout.modelFontSize
          && totalWidth < bestLayout.totalWidth
        )
      ) {
        bestLayout = {
          providerFontSize,
          modelFontSize,
          providerWidth,
          modelWidth,
          totalWidth,
        }
      }
    }
  }
  if (bestLayout) {
    return bestLayout
  }
  return {
    providerFontSize: minFontSize,
    modelFontSize: normalizedModelText ? minFontSize : baseFontSize,
    providerWidth: measureAdaptiveLabelTriggerWidth(normalizedProviderText, minFontSize, {
      fontWeight: 500,
      fontFamily: providerFontFamily,
    }),
    modelWidth: normalizedModelText
      ? measureAdaptiveLabelTriggerWidth(normalizedModelText, minFontSize, {
          fontWeight: 600,
          fontFamily: modelFontFamily,
          minWidth: 32,
        })
      : 0,
    totalWidth: 0,
  }
}

function resolveAdaptiveSelectorAvailableWidth(container: HTMLElement | null) {
  const row = container?.parentElement
  if (!container || !row) {
    return container?.clientWidth || 0
  }
  const computedStyle = window.getComputedStyle(row)
  const gap = Number.parseFloat(computedStyle.columnGap || computedStyle.gap || '0') || 0
  const children = Array.from(row.children)
  const siblingsWidth = children
    .filter((child) => child !== container)
    .reduce((total, child) => total + child.getBoundingClientRect().width, 0)
  const totalGap = gap * Math.max(0, children.length - 1)
  return Math.max(0, Math.max(container.clientWidth, row.clientWidth - siblingsWidth - totalGap))
}

function buildProviderModelOptions(provider: AIProviderLike | null | undefined) {
  const providerValue = typeof provider?.provider === 'string' && provider.provider.trim() ? provider.provider.trim() : 'Compatible'
  const providerDefinition = getAIProviderDefinition(providerValue)
  const seen = new Set<string>()
  const options: string[] = []
  const appendOption = (value: unknown) => {
    const nextValue = typeof value === 'string' ? value.trim() : ''
    if (!nextValue || seen.has(nextValue)) {
      return
    }
    seen.add(nextValue)
    options.push(nextValue)
  }
  appendOption(provider?.model)
  ;(Array.isArray(providerDefinition?.initialModels) ? providerDefinition.initialModels : []).forEach(appendOption)
  appendOption(providerDefinition?.defaultModel)
  return options
}

function getApiKeyPreview(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (!nextValue) {
    return ''
  }
  return nextValue.length <= 12 ? nextValue : nextValue.slice(-12)
}

function buildProviderCopyName(t: (key: I18nKey) => string, provider: AIProviderLike | null | undefined) {
  const baseName = typeof provider?.name === 'string' && provider.name.trim() ? provider.name.trim() : t('未命名供应商')
  return `${baseName}${t('副本')}`
}

function sortProviders(items: AIProviderLike[]) {
  const locale = getLanguage() || 'zh-CN'
  return [...items].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1
    }
    return String(left.name || '').localeCompare(String(right.name || ''), locale)
  })
}

function resolveAIProviderBaseOrigin(value: unknown) {
  const rawBaseURL = typeof value === 'string' ? value.trim() : ''
  if (!rawBaseURL) {
    return ''
  }
  const candidates = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawBaseURL) ? [rawBaseURL] : [rawBaseURL, `https://${rawBaseURL}`]
  for (const candidate of candidates) {
    try {
      return new URL(candidate).origin
    } catch {}
  }
  return ''
}

function isAIProviderBalanceLabelEnabled(provider: AIProviderLike | null | undefined) {
  return isCallMyVipProviderHost(provider?.baseUrl)
}

function normalizeAIProviderBalanceValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  return ''
}

function stripAIProviderBalanceCurrencyPrefix(value: unknown) {
  const normalizedValue = normalizeAIProviderBalanceValue(value)
  if (!normalizedValue) {
    return ''
  }
  return normalizedValue.replace(/^[\s$¥￥]+/, '').trim()
}

function formatAIProviderBalanceLabel(value: unknown) {
  const normalizedValue = stripAIProviderBalanceCurrencyPrefix(value)
  if (!normalizedValue) {
    return '¥--'
  }
  return `¥${normalizedValue}`
}

function parseAIProviderBalanceNumber(value: unknown) {
  const normalizedValue = stripAIProviderBalanceCurrencyPrefix(value).replace(/,/g, '')
  if (!normalizedValue) {
    return null
  }
  const parsedValue = Number.parseFloat(normalizedValue)
  return Number.isFinite(parsedValue) ? parsedValue : null
}

function formatAIProviderBalanceDeltaLabel(value: number) {
  if (!Number.isFinite(value) || value === 0) {
    return ''
  }
  const sign = value > 0 ? '+' : '-'
  const absValue = Math.abs(value)
  const formattedValue = absValue >= 1000
    ? absValue.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : absValue.toFixed(absValue >= 100 ? 0 : absValue >= 1 ? 2 : 4).replace(/\.?0+$/u, '')
  return `${sign}${formattedValue}`
}

function extractAIProviderBalanceValue(payload: unknown) {
  if (typeof payload === 'string' && payload.trim()) {
    try {
      return extractAIProviderBalanceValue(JSON.parse(payload))
    } catch {
      return normalizeAIProviderBalanceValue(payload)
    }
  }
  if (!payload || typeof payload !== 'object') {
    return ''
  }
  const payloadRecord = payload as Record<string, unknown>
  const candidates = [
    payloadRecord.display_balance,
    (payloadRecord.data as Record<string, unknown> | undefined)?.display_balance,
    (payloadRecord.user as Record<string, unknown> | undefined)?.display_balance,
    ((payloadRecord.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined)?.display_balance,
    payloadRecord.quota,
    (payloadRecord.data as Record<string, unknown> | undefined)?.quota,
    (payloadRecord.user as Record<string, unknown> | undefined)?.quota,
    ((payloadRecord.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined)?.quota,
  ]
  for (const candidate of candidates) {
    const normalizedValue = normalizeAIProviderBalanceValue(candidate)
    if (normalizedValue) {
      return normalizedValue
    }
  }
  return ''
}

export default function AIProviderSelector({
  providers = defaultProviders,
  currentProviderId,
  onCurrentProviderChange,
  balanceRefreshSignal = 0,
  persistSelectedProviderId = true,
  dismissSignal = 0,
}: AIProviderSelectorProps) {
  const { t, lang } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tooltipTimerRef = useRef<number | null>(null)
  const providerLabelRef = useRef<HTMLSpanElement | null>(null)
  const modelLabelRef = useRef<HTMLSpanElement | null>(null)
  const modelButtonRef = useRef<HTMLDivElement | null>(null)
  const reasoningButtonRef = useRef<HTMLDivElement | null>(null)
  const balanceRequestRef = useRef(0)
  const balanceDeltaTimeoutRef = useRef<number | null>(null)
  const providerBalanceCacheRef = useRef<Record<string, { label: string; numericValue: number | null }>>({})
  const [open, setOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [providerList, setProviderList] = useState<AIProviderLike[]>(sortProviders(providers))
  const [persistedCurrentProviderId, setPersistedCurrentProviderId] = useState(providers[0]?.id || '')
  const [panelBounds, setPanelBounds] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [dropdownMetrics, setDropdownMetrics] = useState<{ width: number; maxHeight: number } | null>(null)
  const [triggerRect, setTriggerRect] = useState<RectLike | null>(null)
  const [modelTriggerRect, setModelTriggerRect] = useState<RectLike | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipTriggerRect, setTooltipTriggerRect] = useState<RectLike | null>(null)
  const [providerBalanceLabel, setProviderBalanceLabel] = useState('')
  const [providerBalanceDelta, setProviderBalanceDelta] = useState<number | null>(null)
  const [providerBalanceDeltaTick, setProviderBalanceDeltaTick] = useState(0)
  const [quickModelOptions, setQuickModelOptions] = useState<string[]>([])
  const [quickModelLoading, setQuickModelLoading] = useState(false)
  const [quickModelError, setQuickModelError] = useState('')
  const [quickModelResolved, setQuickModelResolved] = useState(false)
  const [editingState, setEditingState] = useState<{ open: boolean; mode: 'create' | 'edit'; provider: AIProviderLike | null }>({ open: false, mode: 'edit', provider: null })
  const [providerLabelFontSize, setProviderLabelFontSize] = useState(12)
  const [modelLabelFontSize, setModelLabelFontSize] = useState(12)
  const [providerTriggerWidth, setProviderTriggerWidth] = useState(0)
  const [modelTriggerWidth, setModelTriggerWidth] = useState(0)
  const isControlled = typeof currentProviderId === 'string'
  const effectiveSelectedId = isControlled ? currentProviderId : persistedCurrentProviderId

  const closeTooltip = useCallback(() => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    setTooltipVisible(false)
  }, [])

  const selectedProvider = useMemo(
    () => providerList.find((item) => item.id === effectiveSelectedId) || null,
    [providerList, effectiveSelectedId],
  )

  const quickModelConfig = useMemo(() => {
    if (!selectedProvider) {
      return { visible: false, options: [] as string[], currentValue: '', currentLabel: '' }
    }
    const fallbackOptions = buildProviderModelOptions(selectedProvider)
    const options = quickModelResolved
      ? (quickModelOptions.length > 0 ? quickModelOptions : fallbackOptions)
      : fallbackOptions
    const selectedModel = typeof selectedProvider.model === 'string' ? selectedProvider.model.trim() : ''
    const currentValue = selectedModel || (options[0] || '')
    return {
      visible: Boolean(currentValue || options.length > 0),
      options,
      currentValue,
      currentLabel: currentValue || t('模型'),
    }
  }, [quickModelOptions, quickModelResolved, selectedProvider, t, lang])

  const quickReasoningConfig = useMemo(() => {
    if (!selectedProvider) {
      return { visible: false, options: [] as string[], currentValue: 'disable', currentLabel: '' }
    }
    const selectedModel = typeof selectedProvider.model === 'string' ? selectedProvider.model.trim() : ''
    if (!selectedModel) {
      return { visible: false, options: [] as string[], currentValue: 'disable', currentLabel: '' }
    }
    const providerValue = typeof selectedProvider.provider === 'string' && selectedProvider.provider.trim() ? selectedProvider.provider.trim() : 'Compatible'
    const providerDefinition = getAIProviderDefinition(providerValue)
    const capability = buildDisplayModelCapability(providerDefinition.value, providerDefinition.getModelCapability(selectedModel))
    let options = buildReasoningOptions(capability)
    const storedValue = typeof selectedProvider.reasoningEffort === 'string' ? selectedProvider.reasoningEffort.trim().toLowerCase() : ''
    const defaultValue = typeof capability?.reasoningEffort === 'string' ? capability.reasoningEffort.trim().toLowerCase() : ''
    if (storedValue && storedValue !== 'disable' && !options.includes(storedValue)) {
      options = [...options, storedValue]
    }
    if (defaultValue && defaultValue !== 'disable' && !options.includes(defaultValue)) {
      options = [...options, defaultValue]
    }
    if (capability?.reasoningMode !== 'effort' || options.length <= 1) {
      return { visible: false, options: [] as string[], currentValue: 'disable', currentLabel: '' }
    }
    let currentValue = storedValue && options.includes(storedValue) ? storedValue : ''
    if (!currentValue) {
      currentValue = capability?.requiredReasoningEffort
        ? (defaultValue || options[0] || 'disable')
        : (selectedProvider.enableReasoningEffort === true
          ? (defaultValue || options.find((value) => value !== 'disable') || options[0] || 'disable')
          : (options.includes('disable') ? 'disable' : (defaultValue || options[0] || 'disable')))
    }
    if (selectedProvider.enableReasoningEffort !== true && options.includes('disable') && !capability?.requiredReasoningEffort) {
      currentValue = 'disable'
    }
    return {
      visible: true,
      options,
      currentValue,
      currentLabel: getReasoningEffortLabel(t, currentValue) || t('无'),
    }
  }, [selectedProvider, t, lang])

  const providerBalanceLabelEnabled = isAIProviderBalanceLabelEnabled(selectedProvider)
  const providerTriggerText = providerBalanceLabelEnabled ? (providerBalanceLabel || '¥ --') : (selectedProvider?.name || t('选择供应商'))
  const providerBalanceDeltaLabel = providerBalanceDelta === null ? '' : formatAIProviderBalanceDeltaLabel(providerBalanceDelta)
  const providerBalanceDeltaPositive = Number(providerBalanceDelta) > 0

  const providerSummaryRows = [
    { label: t('供应商'), value: selectedProvider?.name || t('选择供应商') },
    { label: t('模型'), value: getProviderModelSummary(t, selectedProvider) },
    { label: t('API兼容方式'), value: selectedProvider?.provider || 'Compatible' },
    { label: t('缓存策略'), value: getCacheStrategyLabel(t, selectedProvider?.cacheStrategy) },
    { label: 'Key', value: getApiKeyPreview(selectedProvider?.apiKey) || '-' },
  ]

  const updateAdaptiveLabelFontSizes = useCallback(() => {
    const providerText = providerTriggerText
    const modelText = quickModelConfig.visible ? quickModelConfig.currentLabel : ''
    const providerFontFamily = providerLabelRef.current
      ? (window.getComputedStyle(providerLabelRef.current).fontFamily || 'sans-serif')
      : 'sans-serif'
    const modelFontFamily = modelLabelRef.current
      ? (window.getComputedStyle(modelLabelRef.current).fontFamily || 'sans-serif')
      : providerFontFamily
    const reasoningWidth = quickReasoningConfig.visible && reasoningButtonRef.current
      ? Math.ceil(reasoningButtonRef.current.getBoundingClientRect().width)
      : 0
    const overlapWidth = (quickModelConfig.visible ? 1 : 0) + (quickReasoningConfig.visible ? 1 : 0)
    const layout = resolveAdaptiveLabelLayout({
      providerText,
      modelText,
      availableWidth: resolveAdaptiveSelectorAvailableWidth(containerRef.current),
      providerFontFamily,
      modelFontFamily,
      fixedWidth: reasoningWidth - overlapWidth,
      minFontSize: 6,
    })
    setProviderLabelFontSize(layout.providerFontSize)
    setModelLabelFontSize(layout.modelFontSize)
    setProviderTriggerWidth(layout.providerWidth)
    setModelTriggerWidth(layout.modelWidth)
  }, [providerTriggerText, quickModelConfig.currentLabel, quickModelConfig.visible, quickReasoningConfig.currentLabel, quickReasoningConfig.visible])

  const filteredProviders = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase()
    const sortedProviders = sortProviders(providerList)
    if (!keyword) {
      return sortedProviders
    }
    return sortedProviders.filter((item) => {
      const haystack = `${item.name || ''} ${item.model || ''} ${item.provider || ''}`.toLowerCase()
      return haystack.includes(keyword)
    })
  }, [providerList, searchValue])

  const pinnedProviders = useMemo(() => filteredProviders.filter((item) => item.pinned), [filteredProviders])
  const normalProviders = useMemo(() => filteredProviders.filter((item) => !item.pinned), [filteredProviders])

  const persistRegistryState = useCallback(async (nextProviders: AIProviderLike[], nextPersistedId: string) => {
    const savedState = await saveAIProviderState({
      currentProviderId: nextPersistedId,
      providers: nextProviders,
    })
    const sortedProviders = sortProviders(savedState.providers)
    const sortedCurrentProviderId = savedState.currentProviderId || nextPersistedId || sortedProviders[0]?.id || ''
    setProviderList(sortedProviders)
    setPersistedCurrentProviderId(sortedCurrentProviderId)
    return {
      providers: sortedProviders,
      currentProviderId: sortedCurrentProviderId,
    }
  }, [])

  const getPersistedSelectionId = useCallback((nextProviders: AIProviderLike[], preferredId: string) => {
    if (persistSelectedProviderId || !isControlled) {
      return preferredId
    }
    if (persistedCurrentProviderId && nextProviders.some((item) => item.id === persistedCurrentProviderId)) {
      return persistedCurrentProviderId
    }
    return nextProviders[0]?.id || ''
  }, [isControlled, persistSelectedProviderId, persistedCurrentProviderId])

  const resolveProviderRegistryState = useCallback(async () => {
    const state = await getAIProviderState()
    const hasPersistedProviders = Array.isArray(state.providers) && state.providers.length > 0
    const nextState = hasPersistedProviders
      ? state
      : normalizeAIProviderState({ currentProviderId: providers[0]?.id || '', providers })
    const nextProviders = sortProviders(nextState.providers)
    const nextSelectedId = nextState.currentProviderId || nextProviders[0]?.id || ''
    return {
      hasPersistedProviders,
      nextProviders,
      nextSelectedId,
    }
  }, [providers])

  const notifySelectionChange = useCallback(async (providerId: string) => {
    if (typeof onCurrentProviderChange === 'function') {
      await onCurrentProviderChange(providerId)
    }
  }, [onCurrentProviderChange])

  const handleOpenEditor = (mode: 'create' | 'edit', provider: AIProviderLike | null) => {
    setOpen(false)
    setModelMenuOpen(false)
    setReasoningMenuOpen(false)
    setEditingState({ open: true, mode, provider })
  }

  const handleCopyProvider = (provider: AIProviderLike) => {
    if (!provider) {
      return
    }
    handleOpenEditor('create', {
      ...provider,
      id: '',
      name: buildProviderCopyName(t, provider),
    })
  }

  const handleSelectProvider = async (providerId: string) => {
    setOpen(false)
    setModelMenuOpen(false)
    setReasoningMenuOpen(false)
    if (!isControlled || persistSelectedProviderId) {
      await persistRegistryState(providerList, providerId)
    } else {
      setPersistedCurrentProviderId(providerId)
    }
    await notifySelectionChange(providerId)
  }

  const handleQuickModelSelect = useCallback(async (nextValue: string) => {
    if (!selectedProvider) {
      return
    }
    const normalizedValue = typeof nextValue === 'string' ? nextValue.trim() : ''
    if (!normalizedValue) {
      return
    }
    const providerValue = typeof selectedProvider.provider === 'string' && selectedProvider.provider.trim() ? selectedProvider.provider.trim() : 'Compatible'
    const providerDefinition = getAIProviderDefinition(providerValue)
    const capability = buildDisplayModelCapability(providerDefinition.value, providerDefinition.getModelCapability(normalizedValue))
    const nextProviders = providerList.map((item) => {
      if (item.id !== selectedProvider.id) {
        return item
      }
      const nextReasoningOptions = buildReasoningOptions(capability)
      let reasoningEffort = typeof item.reasoningEffort === 'string' ? item.reasoningEffort.trim().toLowerCase() : 'disable'
      let enableReasoningEffort = item.enableReasoningEffort === true
      if (capability?.reasoningMode === 'effort') {
        if (!nextReasoningOptions.includes(reasoningEffort)) {
          reasoningEffort = capability.requiredReasoningEffort
            ? (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : nextReasoningOptions[0] || 'disable')
            : (enableReasoningEffort
              ? (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : nextReasoningOptions.find((value) => value !== 'disable') || 'disable')
              : (nextReasoningOptions.includes('disable') ? 'disable' : (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : nextReasoningOptions[0] || 'disable')))
        }
        enableReasoningEffort = capability.requiredReasoningEffort ? true : reasoningEffort !== 'disable'
      } else {
        reasoningEffort = 'disable'
        enableReasoningEffort = false
      }
      return {
        ...item,
        model: normalizedValue,
        reasoningEffort,
        enableReasoningEffort,
        modelMaxTokens: 0,
        modelMaxThinkingTokens: 0,
        updatedAt: Date.now(),
      }
    })
    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(nextProviders, persistedCurrentProviderId || effectiveSelectedId || selectedProvider.id || ''),
      providers: nextProviders,
    })
    await persistRegistryState(normalizedState.providers, normalizedState.currentProviderId)
    setModelMenuOpen(false)
  }, [effectiveSelectedId, getPersistedSelectionId, persistRegistryState, persistedCurrentProviderId, providerList, selectedProvider])

  const handleQuickReasoningSelect = useCallback(async (nextValue: string) => {
    if (!selectedProvider) {
      return
    }
    const normalizedValue = typeof nextValue === 'string' ? nextValue.trim().toLowerCase() : 'disable'
    const nextProviders = providerList.map((item) => (
      item.id === selectedProvider.id
        ? {
            ...item,
            reasoningEffort: normalizedValue || 'disable',
            enableReasoningEffort: normalizedValue !== 'disable',
            modelMaxTokens: 0,
            modelMaxThinkingTokens: 0,
            updatedAt: Date.now(),
          }
        : item
    ))
    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(nextProviders, persistedCurrentProviderId || effectiveSelectedId || selectedProvider.id || ''),
      providers: nextProviders,
    })
    await persistRegistryState(normalizedState.providers, normalizedState.currentProviderId)
    setReasoningMenuOpen(false)
  }, [effectiveSelectedId, getPersistedSelectionId, persistRegistryState, persistedCurrentProviderId, providerList, selectedProvider])

  const handleSaveProvider = async (draft: Record<string, unknown>) => {
    const savedProvider: AIProviderLike = {
      id: draft.id ? String(draft.id) : `ai-provider-${Date.now()}`,
      name: (typeof draft.name === 'string' ? draft.name.trim() : '') || t('未命名供应商'),
      provider: (typeof draft.provider === 'string' ? draft.provider.trim() : '') || 'Compatible',
      model: typeof draft.model === 'string' ? draft.model.trim() : '',
      baseUrl: typeof draft.baseUrl === 'string' ? draft.baseUrl.trim() : '',
      apiKey: typeof draft.apiKey === 'string' ? draft.apiKey.trim() : '',
      cacheStrategy: typeof draft.cacheStrategy === 'string' ? draft.cacheStrategy : 'model',
      webSearchEnabled: Boolean(draft.webSearchEnabled),
      dedicatedWebSearchEnabled: Boolean(draft.dedicatedWebSearchEnabled),
      dedicatedWebSearchProviderId: typeof draft.dedicatedWebSearchProviderId === 'string' ? draft.dedicatedWebSearchProviderId : '',
      dedicatedProxyEnabled: Boolean(draft.dedicatedProxyEnabled),
      dedicatedProxyId: typeof draft.dedicatedProxyId === 'string' ? draft.dedicatedProxyId : '',
      reasoningEffort: typeof draft.reasoningEffort === 'string' ? draft.reasoningEffort : 'disable',
      enableReasoningEffort: Boolean(draft.enableReasoningEffort),
      modelMaxTokens: Number.isFinite(Number(draft.modelMaxTokens)) && Number(draft.modelMaxTokens) > 0
        ? Math.floor(Number(draft.modelMaxTokens))
        : 0,
      modelMaxThinkingTokens: Number.isFinite(Number(draft.modelMaxThinkingTokens)) && Number(draft.modelMaxThinkingTokens) > 0
        ? Math.floor(Number(draft.modelMaxThinkingTokens))
        : 0,
      pinned: Boolean(draft.pinned),
      updatedAt: Date.now(),
    }

    const nextBaseProviders = providerList.some((item) => item.id === savedProvider.id)
      ? providerList.map((item) => (item.id === savedProvider.id ? { ...item, ...savedProvider } : item))
      : [savedProvider, ...providerList]

    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(nextBaseProviders, savedProvider.id || ''),
      providers: nextBaseProviders,
    })
    const nextProviders = sortProviders(normalizedState.providers)

    await persistRegistryState(nextProviders, normalizedState.currentProviderId)
    setOpen(false)
    setEditingState({ open: false, mode: 'edit', provider: null })
    await notifySelectionChange(savedProvider.id || '')
  }

  const handleDeleteProvider = async (provider: AIProviderLike) => {
    if (!provider) {
      return
    }
    const confirmed = await window.luminDialog?.confirm(`${t('确定删除供应商')}「${provider.name || provider.provider || provider.id}」？${t('此操作不可撤销')}`)
    if (!confirmed) {
      return
    }

    const nextBaseProviders = providerList.filter((item) => item.id !== provider.id)
    const fallbackSelectedId = nextBaseProviders[0]?.id || ''
    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(
        nextBaseProviders,
        persistedCurrentProviderId === provider.id ? fallbackSelectedId : persistedCurrentProviderId,
      ),
      providers: nextBaseProviders,
    })
    const nextProviders = sortProviders(normalizedState.providers)

    await persistRegistryState(nextProviders, normalizedState.currentProviderId)
    setOpen(false)
    setEditingState({ open: false, mode: 'edit', provider: null })

    if (effectiveSelectedId === provider.id) {
      await notifySelectionChange(fallbackSelectedId)
    }
  }

  const handleTogglePin = async (item: AIProviderLike) => {
    const nextBaseProviders = providerList.map((entry) => (
      entry.id === item.id ? { ...entry, pinned: !entry.pinned, updatedAt: Date.now() } : entry
    ))
    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(nextBaseProviders, persistedCurrentProviderId || nextBaseProviders[0]?.id || ''),
      providers: nextBaseProviders,
    })
    await persistRegistryState(sortProviders(normalizedState.providers), normalizedState.currentProviderId)
  }

  const renderRows = (items: AIProviderLike[]) => (
    <div>
      {items.map((item) => (
        <AIProviderListRow
          key={item.id}
          item={{
            name: item.name || '',
            model: item.model,
            description: typeof item.description === 'string' ? item.description : undefined,
            pinned: item.pinned,
          }}
          active={item.id === effectiveSelectedId}
          onSelect={() => handleSelectProvider(item.id || '')}
          onCopy={() => handleCopyProvider(item)}
          onEdit={() => handleOpenEditor('edit', item)}
          onTogglePin={() => handleTogglePin(item)}
        />
      ))}
    </div>
  )

  useEffect(() => {
    let cancelled = false

    resolveProviderRegistryState()
      .then(async ({ hasPersistedProviders, nextProviders, nextSelectedId }) => {
        if (cancelled) {
          return
        }
        setProviderList(nextProviders)
        setPersistedCurrentProviderId(nextSelectedId)
        if (!hasPersistedProviders) {
          await persistRegistryState(nextProviders, nextSelectedId)
        }
      })
      .catch(async () => {
        if (cancelled) {
          return
        }
        const nextState = normalizeAIProviderState({ currentProviderId: providers[0]?.id || '', providers })
        const nextProviders = sortProviders(nextState.providers)
        const nextSelectedId = nextState.currentProviderId || nextProviders[0]?.id || ''
        setProviderList(nextProviders)
        setPersistedCurrentProviderId(nextSelectedId)
        await persistRegistryState(nextProviders, nextSelectedId)
      })

    return () => {
      cancelled = true
    }
  }, [persistRegistryState, providers, resolveProviderRegistryState])

  useLayoutEffect(() => {
    updateAdaptiveLabelFontSizes()
    const observedElements = [containerRef.current, containerRef.current?.parentElement, reasoningButtonRef.current].filter(Boolean) as HTMLElement[]
    if (observedElements.length === 0) {
      return undefined
    }
    if (typeof window.ResizeObserver === 'function') {
      const observer = new window.ResizeObserver(() => {
        updateAdaptiveLabelFontSizes()
      })
      observedElements.forEach((element) => observer.observe(element))
      window.addEventListener('resize', updateAdaptiveLabelFontSizes)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', updateAdaptiveLabelFontSizes)
      }
    }
    window.addEventListener('resize', updateAdaptiveLabelFontSizes)
    return () => window.removeEventListener('resize', updateAdaptiveLabelFontSizes)
  }, [quickModelConfig.visible, quickReasoningConfig.visible, updateAdaptiveLabelFontSizes])

  useLayoutEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateAdaptiveLabelFontSizes()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [providerTriggerText, quickModelConfig.currentLabel, quickReasoningConfig.currentLabel, updateAdaptiveLabelFontSizes])

  useLayoutEffect(() => {
    const availableWidth = resolveAdaptiveSelectorAvailableWidth(containerRef.current)
    if (availableWidth <= 0) {
      return
    }
    const providerLabelElement = providerLabelRef.current
    const modelLabelElement = modelLabelRef.current
    const reasoningWidth = quickReasoningConfig.visible && reasoningButtonRef.current
      ? Math.ceil(reasoningButtonRef.current.getBoundingClientRect().width)
      : 0
    const overlapWidth = (quickModelConfig.visible ? 1 : 0) + (quickReasoningConfig.visible ? 1 : 0)
    const currentProviderWidth = providerTriggerWidth > 0 ? providerTriggerWidth : 0
    const currentModelWidth = quickModelConfig.visible && modelTriggerWidth > 0 ? modelTriggerWidth : 0
    const currentTotalWidth = currentProviderWidth + currentModelWidth + reasoningWidth - overlapWidth
    const spareWidth = Math.max(0, availableWidth - currentTotalWidth)
    const providerOverflow = providerLabelElement
      ? Math.max(0, Math.ceil(providerLabelElement.scrollWidth - providerLabelElement.clientWidth))
      : 0
    const modelOverflow = quickModelConfig.visible && modelLabelElement
      ? Math.max(0, Math.ceil(modelLabelElement.scrollWidth - modelLabelElement.clientWidth))
      : 0
    if (spareWidth <= 0 || (providerOverflow <= 0 && modelOverflow <= 0)) {
      return
    }
    let remainingWidth = spareWidth
    let nextModelWidth = currentModelWidth
    let nextProviderWidth = currentProviderWidth
    if (modelOverflow > 0 && remainingWidth > 0) {
      const extraWidth = Math.min(modelOverflow + 2, remainingWidth)
      nextModelWidth += extraWidth
      remainingWidth -= extraWidth
    }
    if (providerOverflow > 0 && remainingWidth > 0) {
      const extraWidth = Math.min(providerOverflow + 2, remainingWidth)
      nextProviderWidth += extraWidth
    }
    if (nextProviderWidth !== currentProviderWidth) {
      setProviderTriggerWidth(nextProviderWidth)
    }
    if (nextModelWidth !== currentModelWidth) {
      setModelTriggerWidth(nextModelWidth)
    }
  }, [
    modelTriggerWidth,
    providerTriggerWidth,
    quickModelConfig.currentLabel,
    quickModelConfig.visible,
    quickReasoningConfig.visible,
    providerTriggerText,
  ])

  useEffect(() => {
    if (!selectedProvider) {
      setQuickModelOptions([])
      setQuickModelLoading(false)
      setQuickModelError('')
      setQuickModelResolved(false)
      return undefined
    }

    const providerValue = typeof selectedProvider.provider === 'string' ? selectedProvider.provider.trim() : ''
    const baseUrl = typeof selectedProvider.baseUrl === 'string' ? selectedProvider.baseUrl.trim() : ''
    const apiKey = typeof selectedProvider.apiKey === 'string' ? selectedProvider.apiKey.trim() : ''

    if (!baseUrl || !apiKey) {
      setQuickModelOptions(buildProviderModelOptions(selectedProvider))
      setQuickModelLoading(false)
      setQuickModelError('')
      setQuickModelResolved(false)
      return undefined
    }

    let cancelled = false
    setQuickModelLoading(true)
    setQuickModelError('')
    setQuickModelResolved(false)

    const bridge = getAppBridge()
    const requestProfile = {
      ...selectedProvider,
      provider: providerValue || 'Compatible',
      baseUrl,
      apiKey,
      model: typeof selectedProvider.model === 'string' ? selectedProvider.model.trim() : '',
      dedicatedProxyEnabled: Boolean(selectedProvider.dedicatedProxyEnabled),
      dedicatedProxyId: typeof selectedProvider.dedicatedProxyId === 'string' ? selectedProvider.dedicatedProxyId.trim() : '',
    }

    const requestModels = async () => {
      try {
        const models = bridge?.RequestAIProviderModelsWithProfile
          ? await bridge.RequestAIProviderModelsWithProfile(JSON.stringify(requestProfile))
          : bridge?.RequestAIProviderModels
            ? await bridge.RequestAIProviderModels(baseUrl, apiKey)
            : []
        if (cancelled) {
          return
        }
        const normalizedModels = Array.isArray(models)
          ? models.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
          : []
        setQuickModelOptions(normalizedModels)
        setQuickModelError('')
        setQuickModelResolved(true)
      } catch (error) {
        if (cancelled) {
          return
        }
        setQuickModelOptions([])
        setQuickModelError(error instanceof Error ? error.message : '')
        setQuickModelResolved(true)
      } finally {
        if (!cancelled) {
          setQuickModelLoading(false)
        }
      }
    }

    void requestModels()

    return () => {
      cancelled = true
    }
  }, [
    selectedProvider?.id,
    selectedProvider?.provider,
    selectedProvider?.baseUrl,
    selectedProvider?.apiKey,
    selectedProvider?.dedicatedProxyEnabled,
    selectedProvider?.dedicatedProxyId,
  ])

  useEffect(() => {
    if (!selectedProvider || !providerBalanceLabelEnabled) {
      setProviderBalanceLabel('')
      setProviderBalanceDelta(null)
      return undefined
    }
    const origin = resolveAIProviderBaseOrigin(selectedProvider.baseUrl)
    const apiKey = typeof selectedProvider.apiKey === 'string' ? selectedProvider.apiKey.trim() : ''
    const providerId = typeof selectedProvider.id === 'string' ? selectedProvider.id.trim() : ''
    const cachedBalanceEntry = providerId ? providerBalanceCacheRef.current[providerId] || null : null
    if (!origin || !apiKey) {
      setProviderBalanceLabel('¥ --')
      setProviderBalanceDelta(null)
      return undefined
    }
    const requestId = balanceRequestRef.current + 1
    balanceRequestRef.current = requestId
    const controller = new AbortController()
    setProviderBalanceLabel(cachedBalanceEntry?.label || '¥ --')
    void fetch(`${origin}/api/usage/token/user-balance?apikey=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const contentType = typeof response.headers?.get === 'function' ? response.headers.get('content-type') || '' : ''
        if (contentType.toLowerCase().includes('application/json')) {
          return response.json()
        }
        return response.text()
      })
      .then((payload) => {
        if (balanceRequestRef.current !== requestId) {
          return
        }
        const balanceValue = extractAIProviderBalanceValue(payload)
        const nextNumericValue = parseAIProviderBalanceNumber(balanceValue)
        const previousNumericValue = cachedBalanceEntry?.numericValue
        const nextBalanceLabel = formatAIProviderBalanceLabel(balanceValue)
        setProviderBalanceLabel(nextBalanceLabel)
        if (providerId && Number.isFinite(previousNumericValue) && Number.isFinite(nextNumericValue)) {
          const deltaValue = (nextNumericValue as number) - (previousNumericValue as number)
          if (deltaValue !== 0) {
            setProviderBalanceDelta(deltaValue)
            setProviderBalanceDeltaTick((current) => current + 1)
          }
        }
        if (providerId) {
          providerBalanceCacheRef.current[providerId] = {
            label: nextBalanceLabel,
            numericValue: nextNumericValue,
          }
        }
      })
      .catch(() => {
        if (balanceRequestRef.current !== requestId) {
          return
        }
        setProviderBalanceLabel(cachedBalanceEntry?.label || '¥ --')
        setProviderBalanceDelta(null)
      })
    return () => {
      controller.abort()
    }
  }, [balanceRefreshSignal, providerBalanceLabelEnabled, selectedProvider?.apiKey, selectedProvider?.baseUrl, selectedProvider?.id])

  useEffect(() => {
    if (balanceDeltaTimeoutRef.current) {
      window.clearTimeout(balanceDeltaTimeoutRef.current)
      balanceDeltaTimeoutRef.current = null
    }
    if (!providerBalanceDeltaLabel) {
      return undefined
    }
    balanceDeltaTimeoutRef.current = window.setTimeout(() => {
      setProviderBalanceDelta(null)
      balanceDeltaTimeoutRef.current = null
    }, 2400)
    return () => {
      if (balanceDeltaTimeoutRef.current) {
        window.clearTimeout(balanceDeltaTimeoutRef.current)
        balanceDeltaTimeoutRef.current = null
      }
    }
  }, [providerBalanceDeltaLabel, providerBalanceDeltaTick])

  useEffect(() => () => closeTooltip(), [closeTooltip])

  useEffect(() => {
    if (!tooltipVisible) {
      return undefined
    }

    const updateTooltipRect = () => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        setTooltipVisible(false)
        return
      }
      setTooltipTriggerRect({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom })
    }

    updateTooltipRect()
    window.addEventListener('resize', updateTooltipRect)
    window.addEventListener('scroll', updateTooltipRect, true)

    return () => {
      window.removeEventListener('resize', updateTooltipRect)
      window.removeEventListener('scroll', updateTooltipRect, true)
    }
  }, [tooltipVisible])

  useEffect(() => {
    if (open || editingState.open || modelMenuOpen || reasoningMenuOpen) {
      closeTooltip()
    }
  }, [closeTooltip, editingState.open, modelMenuOpen, open, reasoningMenuOpen])

  useEffect(() => {
    if ((!open && !modelMenuOpen && !reasoningMenuOpen) || editingState.open) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setModelMenuOpen(false)
        setReasoningMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [editingState.open, modelMenuOpen, open, reasoningMenuOpen])

  useEffect(() => {
    if (!editingState.open && !open && !modelMenuOpen && !reasoningMenuOpen) {
      setTriggerRect(null)
      setModelTriggerRect(null)
      setPanelBounds(null)
      setDropdownMetrics(null)
      return undefined
    }

    const updatePanelBounds = () => {
      const root = containerRef.current?.closest('[data-ai-panel-root="true"]')
      const chatStage = root?.querySelector('[data-ai-chat-stage="true"]')
      const composerInputZone = root?.querySelector('[data-ai-composer-input-zone="true"]')
      const fallbackPanel = root || chatStage || composerInputZone

      if (!fallbackPanel) {
        setPanelBounds(null)
        setDropdownMetrics(null)
        return
      }

      const fallbackRect = fallbackPanel.getBoundingClientRect()
      const chatRect = chatStage?.getBoundingClientRect()
      const composerRect = composerInputZone?.getBoundingClientRect()

      const top = Math.min(chatRect?.top ?? fallbackRect.top, composerRect?.top ?? fallbackRect.top)
      const left = Math.min(chatRect?.left ?? fallbackRect.left, composerRect?.left ?? fallbackRect.left)
      const right = Math.max(chatRect?.right ?? fallbackRect.right, composerRect?.right ?? fallbackRect.right)
      const bottom = Math.max(chatRect?.bottom ?? fallbackRect.bottom, composerRect?.bottom ?? fallbackRect.bottom)

      setPanelBounds({
        top,
        left,
        width: right - left,
        height: bottom - top,
      })

      const triggerRectData = containerRef.current?.getBoundingClientRect()
      if (triggerRectData) {
        const panelWidth = Math.max(triggerRectData.width, Math.min(right - left, window.innerWidth - 32))
        setDropdownMetrics({
          width: panelWidth,
          maxHeight: Math.max(120, triggerRectData.top - top - 8),
        })
        setTriggerRect({ top: triggerRectData.top, left: triggerRectData.left, right: triggerRectData.right, bottom: triggerRectData.bottom })
      }

      const modelRectData = modelButtonRef.current?.getBoundingClientRect()
      if (modelRectData) {
        setModelTriggerRect({ top: modelRectData.top, left: modelRectData.left, right: modelRectData.right, bottom: modelRectData.bottom })
      } else {
        setModelTriggerRect(null)
      }
    }

    updatePanelBounds()
    window.addEventListener('resize', updatePanelBounds)
    window.addEventListener('scroll', updatePanelBounds, true)

    return () => {
      window.removeEventListener('resize', updatePanelBounds)
      window.removeEventListener('scroll', updatePanelBounds, true)
    }
  }, [editingState.open, modelMenuOpen, open, reasoningMenuOpen])

  useEffect(() => {
    let cancelled = false
    closeTooltip()
    setOpen(false)
    setModelMenuOpen(false)
    setReasoningMenuOpen(false)
    setSearchValue('')
    setQuickModelOptions([])
    setQuickModelLoading(false)
    setQuickModelError('')
    setQuickModelResolved(false)
    setTriggerRect(null)
    setModelTriggerRect(null)
    setTooltipTriggerRect(null)
    setDropdownMetrics(null)
    setPanelBounds(null)
    setEditingState({ open: false, mode: 'edit', provider: null })

    if (dismissSignal <= 0) {
      return () => {
        cancelled = true
      }
    }

    resolveProviderRegistryState()
      .then(({ nextProviders, nextSelectedId }) => {
        if (cancelled) {
          return
        }
        setProviderList(nextProviders)
        setPersistedCurrentProviderId(nextSelectedId)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        const nextState = normalizeAIProviderState({ currentProviderId: providers[0]?.id || '', providers })
        const nextProviders = sortProviders(nextState.providers)
        const nextSelectedId = nextState.currentProviderId || nextProviders[0]?.id || ''
        setProviderList(nextProviders)
        setPersistedCurrentProviderId(nextSelectedId)
      })

    return () => {
      cancelled = true
    }
  }, [closeTooltip, dismissSignal, providers, resolveProviderRegistryState])

  const handleTriggerMouseEnter = useCallback(() => {
    if (open || editingState.open || modelMenuOpen || reasoningMenuOpen) {
      return
    }
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      setTooltipTriggerRect({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom })
    }
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current)
    }
    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltipVisible(true)
      tooltipTimerRef.current = null
    }, summaryTooltipDelay)
  }, [editingState.open, modelMenuOpen, open, reasoningMenuOpen])

  const expandLeft = triggerRect ? triggerRect.left + 400 > window.innerWidth - 16 : false
  const tooltipExpandLeft = tooltipTriggerRect ? tooltipTriggerRect.left + 280 > window.innerWidth - 16 : false

  return (
    <>
      <div ref={containerRef} style={{ position: 'relative', flex: '1 1 0', width: 0, minWidth: 0, maxWidth: '100%', overflow: 'visible', zIndex: open || modelMenuOpen || reasoningMenuOpen ? 40 : 'auto' }}>
        {providerBalanceLabelEnabled && providerBalanceDeltaLabel ? (
          <span
            key={`${providerBalanceDeltaTick}:${providerBalanceDeltaLabel}`}
            style={{
              position: 'absolute',
              left: 10,
              bottom: 'calc(100% + 2px)',
              pointerEvents: 'none',
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: providerBalanceDeltaPositive ? 'var(--success)' : 'var(--danger)',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.22)',
              animation: 'ai-provider-balance-delta-float 2.2s ease-out forwards',
              zIndex: 10003,
            }}
          >
            {providerBalanceDeltaLabel}
          </span>
        ) : null}
        <style>{`
          @keyframes ai-provider-balance-delta-float {
            0% { opacity: 0; transform: translateY(8px) scale(0.92); }
            18% { opacity: 1; transform: translateY(0) scale(1); }
            72% { opacity: 1; transform: translateY(-10px) scale(1); }
            100% { opacity: 0; transform: translateY(-18px) scale(0.98); }
          }
        `}</style>
        <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', minWidth: 0, maxWidth: '100%' }}>
          <button
            type="button"
            onClick={() => {
              closeTooltip()
              setModelMenuOpen(false)
              setReasoningMenuOpen(false)
              setOpen((prev) => !prev)
            }}
            onMouseEnter={handleTriggerMouseEnter}
            onMouseLeave={closeTooltip}
            onFocus={handleTriggerMouseEnter}
            onBlur={closeTooltip}
            style={{
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              borderRadius: quickModelConfig.visible || quickReasoningConfig.visible ? '8px 0 0 8px' : 8,
              border: `1px solid ${open ? 'var(--accent-border)' : 'var(--border)'}`,
              background: open ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontWeight: 500,
              transition: 'var(--transition)',
              whiteSpace: 'nowrap',
              minWidth: 0,
              maxWidth: '100%',
              flex: '0 0 auto',
              ...(providerTriggerWidth > 0 ? { width: providerTriggerWidth } : {}),
            }}
          >
            <span
              ref={providerLabelRef}
              style={{
                display: 'block',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: providerLabelFontSize,
                lineHeight: 1.2,
              }}
            >
              {providerTriggerText}
            </span>
          </button>

          {quickModelConfig.visible ? (
            <div
              ref={modelButtonRef}
              style={{
                position: 'relative',
                marginLeft: -1,
                minWidth: 0,
                maxWidth: '100%',
                flex: '0 0 auto',
                ...(modelTriggerWidth > 0 ? { width: modelTriggerWidth } : {}),
              }}>
              <button
                type="button"
                onClick={() => {
                  closeTooltip()
                  setOpen(false)
                  setReasoningMenuOpen(false)
                  setModelMenuOpen((prev) => !prev)
                }}
                onMouseEnter={handleTriggerMouseEnter}
                onMouseLeave={closeTooltip}
                onFocus={handleTriggerMouseEnter}
                onBlur={closeTooltip}
                style={{
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0 10px',
                  borderRadius: quickReasoningConfig.visible ? 0 : '0 8px 8px 0',
                  border: `1px solid ${modelMenuOpen ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: modelMenuOpen ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                  color: modelMenuOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'var(--transition)',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  maxWidth: '100%',
                  width: '100%',
                }}
              >
                <span
                  ref={modelLabelRef}
                  style={{
                    display: 'block',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: modelLabelFontSize,
                    lineHeight: 1.2,
                  }}
                >
                  {quickModelConfig.currentLabel}
                </span>
              </button>
              {modelMenuOpen && modelTriggerRect ? (
                <div
                  style={{
                    position: 'fixed',
                    right: Math.max(16, window.innerWidth - modelTriggerRect.right),
                    bottom: window.innerHeight - modelTriggerRect.top + 8,
                    minWidth: 180,
                    maxWidth: 320,
                    maxHeight: 320,
                    padding: 4,
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-overlay)',
                    boxShadow: 'var(--shadow-xl)',
                    display: 'grid',
                    gap: 2,
                    overflowY: 'auto',
                    zIndex: 10002,
                  }}
                >
                  {quickModelLoading ? (
                    <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {t('刷新中...')}
                    </div>
                  ) : null}
                  {!quickModelLoading && quickModelError ? (
                    <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--danger)', lineHeight: 1.4 }}>
                      {quickModelError}
                    </div>
                  ) : null}
                  {quickModelConfig.options.map((option) => {
                    const active = option === quickModelConfig.currentValue
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => void handleQuickModelSelect(option)}
                        style={{
                          minHeight: 30,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '0 10px',
                          border: 'none',
                          borderRadius: 8,
                          background: active ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontSize: 12,
                          fontWeight: active ? 700 : 500,
                          textAlign: 'left',
                          transition: 'var(--transition)',
                        }}
                      >
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option}</span>
                        {active ? <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓</span> : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {quickReasoningConfig.visible ? (
            <div ref={reasoningButtonRef} style={{ position: 'relative', marginLeft: -1, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => {
                  closeTooltip()
                  setOpen(false)
                  setModelMenuOpen(false)
                  setReasoningMenuOpen((prev) => !prev)
                }}
                onMouseEnter={handleTriggerMouseEnter}
                onMouseLeave={closeTooltip}
                onFocus={handleTriggerMouseEnter}
                onBlur={closeTooltip}
                style={{
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0 10px',
                  borderRadius: '0 8px 8px 0',
                  border: `1px solid ${reasoningMenuOpen ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: reasoningMenuOpen ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                  color: reasoningMenuOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'var(--transition)',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{quickReasoningConfig.currentLabel}</span>
              </button>
              {reasoningMenuOpen && triggerRect ? (
                <div
                  style={{
                    position: 'fixed',
                    right: Math.max(16, window.innerWidth - triggerRect.right),
                    bottom: window.innerHeight - triggerRect.top + 8,
                    minWidth: 92,
                    padding: 4,
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-overlay)',
                    boxShadow: 'var(--shadow-xl)',
                    display: 'grid',
                    gap: 2,
                    zIndex: 10002,
                  }}
                >
                  {quickReasoningConfig.options.map((option) => {
                    const active = option === quickReasoningConfig.currentValue
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => void handleQuickReasoningSelect(option)}
                        style={{
                          minHeight: 30,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '0 10px',
                          border: 'none',
                          borderRadius: 8,
                          background: active ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontSize: 12,
                          fontWeight: active ? 700 : 500,
                          textAlign: 'left',
                          transition: 'var(--transition)',
                        }}
                      >
                        <span>{getReasoningEffortLabel(t, option) || t('无')}</span>
                        {active ? <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓</span> : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {tooltipVisible && tooltipTriggerRect && !open && !editingState.open ? (
          <div
            style={{
              position: 'fixed',
              ...(tooltipExpandLeft
                ? { right: Math.max(16, window.innerWidth - tooltipTriggerRect.right) }
                : { left: Math.max(16, tooltipTriggerRect.left) }),
              bottom: window.innerHeight - tooltipTriggerRect.top + 8,
              width: 'max-content',
              maxWidth: Math.max(180, (tooltipExpandLeft ? tooltipTriggerRect.right : window.innerWidth - tooltipTriggerRect.left) - 16),
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-overlay)',
              boxShadow: 'var(--shadow-xl)',
              display: 'grid',
              gap: 6,
              zIndex: 10001,
              pointerEvents: 'none',
            }}
          >
            {providerSummaryRows.map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    minWidth: 0,
                    maxWidth: '100%',
                    fontSize: 11.5,
                    color: 'var(--text-primary)',
                    lineHeight: 1.45,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
            <div
              style={{
                position: 'absolute',
                bottom: -6,
                ...(tooltipExpandLeft ? { right: 20 } : { left: 20 }),
                width: 10,
                height: 10,
                borderRight: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface-overlay)',
                transform: 'rotate(45deg)',
              }}
            />
          </div>
        ) : null}

        {open && triggerRect ? (
          <div
            style={{
              position: 'fixed',
              ...(panelBounds ? { left: panelBounds.left } : (expandLeft ? { right: window.innerWidth - triggerRect.right } : { left: triggerRect.left })),
              bottom: window.innerHeight - triggerRect.top + 8,
              width: dropdownMetrics?.width ?? 400,
              maxWidth: dropdownMetrics?.width ? `${dropdownMetrics.width}px` : 'min(400px, calc(100vw - 32px))',
              maxHeight: dropdownMetrics?.maxHeight ?? 320,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-overlay)',
              boxShadow: 'var(--shadow-xl)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              overflowX: 'hidden',
              boxSizing: 'border-box',
              zIndex: 10000,
            }}
          >
            <div style={{ padding: 10, display: 'grid', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('供应商列表')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tiptop text={t('添加供应商')}>
                    <button
                      type="button"
                      aria-label={t('添加供应商')}
                      onClick={() => handleOpenEditor('create', null)}
                      style={{
                        width: 28,
                        height: 28,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 0,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        transition: 'var(--transition)',
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  </Tiptop>
                </div>
              </div>

              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-tertiary)' }} />
                <input
                  name="ai-provider-search"
                  autoComplete="off"
                  aria-label={t('搜索...')}
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder={t('搜索...')}
                  style={{
                    width: '100%',
                    height: 36,
                    borderRadius: 0,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-base)',
                    color: 'var(--text-primary)',
                    padding: '0 10px 0 32px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', overflowX: 'hidden' }}>
              {filteredProviders.length === 0 ? (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {t('没有匹配的供应商')}
                </div>
              ) : (
                <>
                  {pinnedProviders.length > 0 ? (
                    <div style={{ flexShrink: 0, borderBottom: normalProviders.length > 0 ? '1px solid var(--border-subtle)' : 'none', background: 'var(--surface-overlay)', overflowX: 'hidden' }}>
                      {renderRows(pinnedProviders)}
                    </div>
                  ) : null}
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                    {normalProviders.length > 0 ? renderRows(normalProviders) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <AIProviderQuickEditOverlay
        open={editingState.open}
        mode={editingState.mode}
        provider={editingState.provider}
        providers={providerList}
        panelBounds={panelBounds}
        onClose={() => setEditingState({ open: false, mode: 'edit', provider: null })}
        onSave={handleSaveProvider}
        onDelete={handleDeleteProvider}
      />
    </>
  )
}