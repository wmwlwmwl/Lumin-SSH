import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation, getLanguage } from '../../i18n.js'
import AIProviderListRow from './AIProviderListRow.jsx'
import AIProviderQuickEditOverlay from './AIProviderQuickEditOverlay.jsx'
import Tiptop from '../Tiptop.jsx'
import { getAIProviderState, isBuiltinAIProvider, normalizeAIProviderState, saveAIProviderState } from './aiProviderBridge.js'

const defaultProviders = []
const summaryTooltipDelay = 300
const embeddedBrowserAuthMessageTypes = new Set([
  'lumin-builtin-provider-auth',
  'builtin-provider-auth',
  'builtin-ai-provider-auth',
])
const embeddedBrowserAuthRequestType = 'lumin-builtin-provider-auth-request'

const cacheStrategyLabelKeys = {
  model: '基于模型能力',
  off: '强制关闭',
  '5m': '5分钟',
  '1h': '1小时',
}

function getCacheStrategyLabel(t, value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return t(cacheStrategyLabelKeys[nextValue] || cacheStrategyLabelKeys.model)
}

const reasoningEffortLabelKeys = {
  none: '无',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
}

function getReasoningEffortLabel(t, value) {
  const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!nextValue || nextValue === 'disable') {
    return ''
  }
  return t(reasoningEffortLabelKeys[nextValue] || nextValue)
}

function getProviderModelSummary(t, provider) {
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

function getApiKeyPreview(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (!nextValue) {
    return ''
  }
  return nextValue.length <= 12 ? nextValue : nextValue.slice(-12)
}

function sortProviders(items) {
  const locale = getLanguage() || 'zh-CN'
  return [...items].sort((left, right) => {
    const leftBuiltin = isBuiltinAIProvider(left)
    const rightBuiltin = isBuiltinAIProvider(right)
    if (leftBuiltin !== rightBuiltin) {
      return leftBuiltin ? 1 : -1
    }
    if (!leftBuiltin && Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1
    }
    return left.name.localeCompare(right.name, locale)
  })
}

function parseEmbeddedBrowserMessage(data) {
  if (data && typeof data === 'object') {
    return data
  }
  if (typeof data !== 'string' || !data.trim()) {
    return null
  }
  try {
    const parsed = JSON.parse(data)
    return parsed && typeof parsed === 'object' ? parsed : null
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

function resolveEmbeddedBrowserAPIKey(payload, apiKeyField) {
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

function matchesEmbeddedBrowserAPIKeyExpression(value, expression) {
  const trimmedValue = typeof value === 'string' ? value.trim() : ''
  if (!trimmedValue) {
    return false
  }
  const trimmedExpression = typeof expression === 'string' ? expression.trim() : ''
  if (!trimmedExpression) {
    return true
  }
  try {
    return new RegExp(trimmedExpression).test(trimmedValue)
  } catch {
    return true
  }
}

function resolveURLOrigin(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (!nextValue) {
    return ''
  }
  try {
    return new URL(nextValue).origin
  } catch {
    return ''
  }
}

function buildEmbeddedBrowserAuthRequest(context) {
  if (!context || typeof context !== 'object') {
    return null
  }
  return {
    type: embeddedBrowserAuthRequestType,
    providerId: typeof context.providerId === 'string' ? context.providerId.trim() : '',
    providerName: typeof context.providerName === 'string' ? context.providerName.trim() : '',
    apiKeyField: context.apiKeyField && typeof context.apiKeyField === 'object' ? context.apiKeyField : null,
    timestamp: Date.now(),
  }
}

export default function AIProviderSelector({
  providers = defaultProviders,
  currentProviderId,
  onCurrentProviderChange,
  persistSelectedProviderId = true,
  dismissSignal = 0,
}) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const iframeRef = useRef(null)
  const tooltipTimerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [providerList, setProviderList] = useState(sortProviders(providers))
  const [persistedCurrentProviderId, setPersistedCurrentProviderId] = useState(providers[0]?.id || '')
  const [panelBounds, setPanelBounds] = useState(null)
  const [workspaceBounds, setWorkspaceBounds] = useState(null)
  const [dropdownMetrics, setDropdownMetrics] = useState(null)
  const [triggerRect, setTriggerRect] = useState(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipTriggerRect, setTooltipTriggerRect] = useState(null)
  const [tokenStoreOpen, setTokenStoreOpen] = useState(false)
  const [tokenStoreLoading, setTokenStoreLoading] = useState(false)
  const [tokenStoreFrameURL, setTokenStoreFrameURL] = useState('')
  const [tokenStoreViewTitle, setTokenStoreViewTitle] = useState('')
  const [embeddedBrowserContext, setEmbeddedBrowserContext] = useState(null)
  const expandLeft = triggerRect ? triggerRect.left + 400 > window.innerWidth - 16 : false
  const tooltipExpandLeft = tooltipTriggerRect ? tooltipTriggerRect.left + 280 > window.innerWidth - 16 : false
  const [editingState, setEditingState] = useState({ open: false, mode: 'edit', provider: null })
  const isControlled = typeof currentProviderId === 'string'
  const effectiveSelectedId = isControlled ? currentProviderId : persistedCurrentProviderId

  const selectedProvider = useMemo(
    () => providerList.find((item) => item.id === effectiveSelectedId) || null,
    [providerList, effectiveSelectedId],
  )
  const providerSummaryRows = [
    { label: t('供应商'), value: selectedProvider?.name || t('选择供应商') },
    { label: t('模型'), value: getProviderModelSummary(t, selectedProvider) },
    { label: t('API兼容方式'), value: selectedProvider?.provider || 'Compatible' },
    { label: t('缓存策略'), value: getCacheStrategyLabel(t, selectedProvider?.cacheStrategy) },
    { label: 'Key', value: getApiKeyPreview(selectedProvider?.apiKey) || '-' },
  ]

  const closeTooltip = useCallback(() => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    setTooltipVisible(false)
  }, [])

  const handleTriggerMouseEnter = useCallback(() => {
    if (open || editingState.open) {
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
  }, [editingState.open, open])

  const filteredProviders = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase()
    const sortedProviders = sortProviders(providerList)
    if (!keyword) {
      return sortedProviders
    }
    return sortedProviders.filter((item) => {
      const haystack = `${item.name} ${item.model || ''} ${item.provider || ''}`.toLowerCase()
      return haystack.includes(keyword)
    })
  }, [providerList, searchValue])

  const pinnedProviders = useMemo(
    () => filteredProviders.filter((item) => item.pinned),
    [filteredProviders],
  )

  const normalProviders = useMemo(
    () => filteredProviders.filter((item) => !item.pinned),
    [filteredProviders],
  )

  const persistRegistryState = useCallback(async (nextProviders, nextPersistedId) => {
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

  const getPersistedSelectionId = useCallback((nextProviders, preferredId) => {
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
    if (open || editingState.open) {
      closeTooltip()
    }
  }, [closeTooltip, editingState.open, open])

  useEffect(() => {
    if (!open || editingState.open) {
      return undefined
    }

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open, editingState.open])

  useEffect(() => {
    if (!editingState.open && !open && !tokenStoreOpen) {
      setTriggerRect(null)
      setWorkspaceBounds(null)
      return undefined
    }

    const updatePanelBounds = () => {
      const root = containerRef.current?.closest('[data-ai-panel-root="true"]')
      const workspaceRoot = containerRef.current?.closest('[data-ai-workspace-root="true"]')
      const chatStage = root?.querySelector('[data-ai-chat-stage="true"]')
      const composerInputZone = root?.querySelector('[data-ai-composer-input-zone="true"]')
      const fallbackPanel = root || chatStage || composerInputZone

      if (!fallbackPanel) {
        setPanelBounds(null)
        setWorkspaceBounds(null)
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

      const aiPanelRect = root?.getBoundingClientRect()
      const workspaceRect = workspaceRoot?.getBoundingClientRect()
      if (aiPanelRect && workspaceRect) {
        const aiPanelOnRight = aiPanelRect.left >= workspaceRect.left + workspaceRect.width / 2
        const nextLeft = aiPanelOnRight ? workspaceRect.left : aiPanelRect.right
        const nextRight = aiPanelOnRight ? aiPanelRect.left : workspaceRect.right
        const nextWidth = Math.max(0, nextRight - nextLeft)
        if (nextWidth > 0 && workspaceRect.height > 0) {
          setWorkspaceBounds({
            top: workspaceRect.top,
            left: nextLeft,
            width: nextWidth,
            height: workspaceRect.height,
          })
        } else {
          setWorkspaceBounds(null)
        }
      } else {
        setWorkspaceBounds(null)
      }

      const triggerRectData = containerRef.current?.getBoundingClientRect()
      if (triggerRectData) {
        const panelWidth = Math.max(triggerRectData.width, Math.min(right - left, window.innerWidth - 32))
        setDropdownMetrics({
          width: panelWidth,
          maxHeight: Math.max(120, triggerRectData.top - top - 8),
        })
        setTriggerRect({ top: triggerRectData.top, left: triggerRectData.left, right: triggerRectData.right, bottom: triggerRectData.bottom })
      }
    }

    updatePanelBounds()
    window.addEventListener('resize', updatePanelBounds)
    window.addEventListener('scroll', updatePanelBounds, true)

    return () => {
      window.removeEventListener('resize', updatePanelBounds)
      window.removeEventListener('scroll', updatePanelBounds, true)
    }
  }, [editingState.open, open, tokenStoreOpen])

  useEffect(() => {
    let cancelled = false
    closeTooltip()
    setOpen(false)
    setSearchValue('')
    setTokenStoreOpen(false)
    setTokenStoreLoading(false)
    setTokenStoreFrameURL('')
    setTokenStoreViewTitle('')
    setEmbeddedBrowserContext(null)
    setTriggerRect(null)
    setTooltipTriggerRect(null)
    setDropdownMetrics(null)
    setPanelBounds(null)
    setWorkspaceBounds(null)
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

  useEffect(() => {
    if (!tokenStoreOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTokenStoreOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tokenStoreOpen])

  const notifySelectionChange = useCallback(async (providerId) => {
    if (typeof onCurrentProviderChange === 'function') {
      await onCurrentProviderChange(providerId)
    }
  }, [onCurrentProviderChange])

  const openEmbeddedBrowser = useCallback((url, title = '', context = null) => {
    const nextURL = typeof url === 'string' ? url.trim() : ''
    if (!nextURL) {
      return
    }
    const nextContext = context && typeof context === 'object' ? { ...context } : null
    closeTooltip()
    setOpen(false)
    if (nextContext?.kind !== 'builtin_login' && nextContext?.kind !== 'builtin_doc') {
      setEditingState({ open: false, mode: 'edit', provider: null })
    }
    setTokenStoreFrameURL(nextURL)
    setTokenStoreViewTitle(typeof title === 'string' && title.trim() ? title.trim() : '')
    setEmbeddedBrowserContext(nextContext)
    setTokenStoreLoading(true)
    setTokenStoreOpen(true)
  }, [closeTooltip])

  const handleOpenEditor = (mode, provider = null) => {
    setOpen(false)
    setTokenStoreOpen(false)
    setTokenStoreLoading(false)
    setEmbeddedBrowserContext(null)
    setEditingState({ open: true, mode, provider })
  }

  const handleSelectProvider = async (providerId) => {
    setOpen(false)
    if (!isControlled || persistSelectedProviderId) {
      await persistRegistryState(providerList, providerId)
    } else if (!isControlled) {
      setPersistedCurrentProviderId(providerId)
    }
    await notifySelectionChange(providerId)
  }

  const handleSaveProvider = async (draft) => {
    const savedProvider = {
      id: draft.id || `ai-provider-${Date.now()}`,
      name: draft.name?.trim() || t('未命名供应商'),
      provider: draft.provider?.trim() || 'Compatible',
      model: draft.model?.trim() || t('未选择模型'),
      baseUrl: draft.baseUrl?.trim() || '',
      apiKey: draft.apiKey?.trim() || '',
      cacheStrategy: draft.cacheStrategy || 'model',
      webSearchEnabled: Boolean(draft.webSearchEnabled),
      dedicatedWebSearchEnabled: Boolean(draft.dedicatedWebSearchEnabled),
      dedicatedWebSearchProviderId: draft.dedicatedWebSearchProviderId || '',
      dedicatedProxyEnabled: Boolean(draft.dedicatedProxyEnabled),
      dedicatedProxyId: draft.dedicatedProxyId || '',
      reasoningEffort: draft.reasoningEffort || 'disable',
      enableReasoningEffort: Boolean(draft.enableReasoningEffort),
      modelMaxTokens: Number.isFinite(Number(draft.modelMaxTokens)) && Number(draft.modelMaxTokens) > 0
        ? Math.floor(Number(draft.modelMaxTokens))
        : 0,
      modelMaxThinkingTokens: Number.isFinite(Number(draft.modelMaxThinkingTokens)) && Number(draft.modelMaxThinkingTokens) > 0
        ? Math.floor(Number(draft.modelMaxThinkingTokens))
        : 0,
      pinned: Boolean(draft.pinned),
      apiKeyField: draft?.apiKeyField && typeof draft.apiKeyField === 'object' ? draft.apiKeyField : null,
      updatedAt: Date.now(),
    }

    const nextBaseProviders = providerList.some((item) => item.id === savedProvider.id)
      ? providerList.map((item) => (item.id === savedProvider.id ? { ...item, ...savedProvider } : item))
      : [savedProvider, ...providerList]

    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(nextBaseProviders, savedProvider.id),
      providers: nextBaseProviders,
    })
    const nextProviders = sortProviders(normalizedState.providers)

    await persistRegistryState(nextProviders, normalizedState.currentProviderId)
    setOpen(false)
    setEditingState({ open: false, mode: 'edit', provider: null })
    await notifySelectionChange(savedProvider.id)
  }

  const handleDeleteProvider = async (provider) => {
    if (!provider || isBuiltinAIProvider(provider)) {
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

  const handleTogglePin = async (item) => {
    if (isBuiltinAIProvider(item)) {
      return
    }
    const nextBaseProviders = providerList.map((entry) => (
      entry.id === item.id ? { ...entry, pinned: !entry.pinned, updatedAt: Date.now() } : entry
    ))
    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(nextBaseProviders, persistedCurrentProviderId || nextBaseProviders[0]?.id || ''),
      providers: nextBaseProviders,
    })
    await persistRegistryState(sortProviders(normalizedState.providers), normalizedState.currentProviderId)
  }

  const completeEmbeddedBrowserBuiltinLogin = useCallback(async (providerId, apiKey) => {
    const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
    const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (!trimmedProviderId || !trimmedApiKey) {
      return
    }
    const nextBaseProviders = providerList.map((item) => (
      item.id === trimmedProviderId
        ? { ...item, apiKey: trimmedApiKey, updatedAt: Date.now() }
        : item
    ))
    const normalizedState = normalizeAIProviderState({
      currentProviderId: getPersistedSelectionId(nextBaseProviders, persistedCurrentProviderId || nextBaseProviders[0]?.id || ''),
      providers: nextBaseProviders,
    })
    await persistRegistryState(sortProviders(normalizedState.providers), normalizedState.currentProviderId)
    setTokenStoreOpen(false)
    setTokenStoreLoading(false)
    setEmbeddedBrowserContext(null)
  }, [getPersistedSelectionId, persistRegistryState, persistedCurrentProviderId, providerList])

  useEffect(() => {
    if (!tokenStoreOpen || embeddedBrowserContext?.kind !== 'builtin_login') {
      return undefined
    }

    const targetOrigin = resolveURLOrigin(tokenStoreFrameURL)

    const handleMessage = (event) => {
      const sourceWindow = iframeRef.current?.contentWindow
      if (!sourceWindow || event.source !== sourceWindow) {
        return
      }
      if (targetOrigin && event.origin && event.origin !== targetOrigin) {
        return
      }
      const payload = parseEmbeddedBrowserMessage(event.data)
      if (!payload) {
        return
      }
      const messageType = [
        payload?.type,
        payload?.kind,
        payload?.channel,
        payload?.event,
      ].find((value) => typeof value === 'string' && value.trim())
      if (!messageType || !embeddedBrowserAuthMessageTypes.has(messageType.trim())) {
        return
      }
      const expectedProviderId = typeof embeddedBrowserContext?.providerId === 'string' ? embeddedBrowserContext.providerId.trim() : ''
      const messageProviderId = typeof payload?.providerId === 'string' && payload.providerId.trim()
        ? payload.providerId.trim()
        : expectedProviderId
      if (!expectedProviderId || messageProviderId !== expectedProviderId) {
        return
      }
      const resolvedApiKey = resolveEmbeddedBrowserAPIKey(payload, embeddedBrowserContext?.apiKeyField)
      const expression = embeddedBrowserContext?.apiKeyField?.expression
      if (!matchesEmbeddedBrowserAPIKeyExpression(resolvedApiKey, expression)) {
        return
      }
      void completeEmbeddedBrowserBuiltinLogin(messageProviderId, resolvedApiKey)
    }

    const requestPayload = buildEmbeddedBrowserAuthRequest(embeddedBrowserContext)
    const requestAuthSnapshot = () => {
      if (!requestPayload) {
        return
      }
      const targetWindow = iframeRef.current?.contentWindow
      if (targetWindow) {
        targetWindow.postMessage(requestPayload, targetOrigin || '*')
      }
      const injectBridge = window?.go?.main?.App?.InjectAIBuiltinLoginBridge
      if (typeof injectBridge === 'function') {
        Promise.resolve(injectBridge(JSON.stringify({
          frameSrc: tokenStoreFrameURL,
          frameTitle: tokenStoreViewTitle || defaultTokenStoreTitle,
          targetOrigin: targetOrigin || '*',
          message: requestPayload,
        }))).catch(() => {})
      }
    }

    window.addEventListener('message', handleMessage)
    requestAuthSnapshot()
    const timer = window.setInterval(requestAuthSnapshot, 1000)

    return () => {
      window.removeEventListener('message', handleMessage)
      window.clearInterval(timer)
    }
  }, [completeEmbeddedBrowserBuiltinLogin, embeddedBrowserContext, tokenStoreFrameURL, tokenStoreOpen])

  const renderRows = (items) => (
    <div>
      {items.map((item) => (
        <AIProviderListRow
          key={item.id}
          item={item}
          builtin={isBuiltinAIProvider(item)}
          active={item.id === effectiveSelectedId}
          onSelect={() => handleSelectProvider(item.id)}
          onEdit={() => handleOpenEditor('edit', item)}
          onTogglePin={() => handleTogglePin(item)}
        />
      ))}
    </div>
  )

  const tokenStoreViewportBounds = workspaceBounds || panelBounds || {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }

  return (
    <>
      <div ref={containerRef} style={{ position: 'relative', flexShrink: 0, overflow: 'visible', zIndex: open ? 40 : 'auto' }}>
        <button
          type="button"
          onClick={() => {
            closeTooltip()
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
            borderRadius: 8,
            border: `1px solid ${open ? 'var(--accent-border)' : 'var(--border)'}`,
            background: open ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
            color: 'var(--text-primary)',
            fontSize: 12,
            fontWeight: 500,
            transition: 'var(--transition)',
            whiteSpace: 'nowrap',
          }}
        >
          <span>{selectedProvider?.name || t('选择供应商')}</span>
        </button>

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

        {open && triggerRect && (
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
        )}
      </div>

      {tokenStoreOpen && tokenStoreViewportBounds ? (
        <div
          onClick={() => {
            setTokenStoreOpen(false)
            setTokenStoreLoading(false)
            setEmbeddedBrowserContext(null)
          }}
          style={{
            position: 'fixed',
            top: tokenStoreViewportBounds.top,
            left: tokenStoreViewportBounds.left,
            width: tokenStoreViewportBounds.width,
            height: tokenStoreViewportBounds.height,
            maxWidth: '100vw',
            maxHeight: '100vh',
            background: 'rgba(5, 10, 18, 0.62)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            zIndex: 10020,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--surface-base)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ height: 46, padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{tokenStoreViewTitle || t('文档')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setTokenStoreOpen(false)
                    setTokenStoreLoading(false)
                    setEmbeddedBrowserContext(null)
                  }}
                  aria-label={t('关闭')}
                  style={{
                    width: 30,
                    height: 30,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: 18,
                    lineHeight: 1,
                    transition: 'var(--transition)',
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--surface-base)', overflow: 'hidden' }}>
              {tokenStoreLoading ? (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                    background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 15, 26, 0.98))',
                    zIndex: 1,
                  }}
                >
                  <div
                    style={{
                      width: 'min(560px, 100%)',
                      padding: '28px 30px',
                      borderRadius: 18,
                      border: '1px solid var(--border)',
                      background: 'rgba(17, 24, 39, 0.92)',
                      boxShadow: 'var(--shadow-xl)',
                      display: 'grid',
                      gap: 14,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 24, lineHeight: 1 }}>🌐</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{t('加载中...')}</div>
                  </div>
                </div>
              ) : null}
              <iframe
                ref={iframeRef}
                src={tokenStoreFrameURL}
                title={tokenStoreViewTitle || t('文档')}
                referrerPolicy="no-referrer"
                onLoad={() => setTokenStoreLoading(false)}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#ffffff',
                  display: 'block',
                  opacity: tokenStoreLoading ? 0 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <AIProviderQuickEditOverlay
        open={editingState.open}
        mode={editingState.mode}
        provider={editingState.provider}
        providers={providerList}
        panelBounds={panelBounds}
        onClose={() => setEditingState({ open: false, mode: 'edit', provider: null })}
        onSave={handleSaveProvider}
        onDelete={handleDeleteProvider}
        onOpenBuiltinLogin={openEmbeddedBrowser}
      />
    </>
  )
}