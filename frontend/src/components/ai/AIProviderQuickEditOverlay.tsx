import { ArrowLeft, Check, CircleHelp, Globe, Save, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation, t as translate, type I18nKey } from '../../i18n.ts'
import { getAIGlobalSettings } from './aiGlobalSettingsBridge.ts'
import {
  availableAIProviders,
  canUseDedicatedWebSearchCandidate,
  getAIProviderDefinition,
} from './providers/index.ts'
import { handleInputDragSelectAll } from './inputDragSelect.ts'
import type { AIProviderLike } from './AIProviderSelector.tsx'

const defaultCacheOptions: Array<{ value: string; labelKey: I18nKey }> = [
  { value: 'model', labelKey: '基于模型能力' },
  { value: 'off', labelKey: '强制关闭' },
  { value: '5m', labelKey: '5分钟' },
  { value: '1h', labelKey: '1小时' },
]

const reasoningEffortLabels: Record<string, I18nKey> = {
  disable: '无',
  none: '无',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
}

const DEFAULT_MAX_OUTPUT_TOKENS = 16384
const DEFAULT_MAX_THINKING_TOKENS = 8192
const DEFAULT_EFFORT_REASONING_OPTIONS = ['low', 'medium', 'high', 'xhigh']
const providerHighlightLabelKeys: Record<string, I18nKey> = {
  Compatible: '高兼容',
  Responses: '高缓存',
}
const selfWebSearchProviderValue = '__self__'

function getProviderDisplayLabel(provider: { value?: string; label?: string } | null | undefined, t: (key: I18nKey) => string) {
  if (!provider || typeof provider !== 'object') {
    return ''
  }
  const providerValue = typeof provider.value === 'string' ? provider.value : ''
  const highlightLabelKey = providerValue ? providerHighlightLabelKeys[providerValue] : undefined
  if (!highlightLabelKey) {
    return provider.label || ''
  }
  return `(${t(highlightLabelKey as I18nKey)})${provider.label || ''}`
}

function getAppBridge() {
  return window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.AIProviderBindings || window?.go?.wailsapp?.App
}

function normalizePositiveInteger(value: unknown, fallback = 0) {
  const nextValue = Number(value)
  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    return fallback
  }
  return Math.floor(nextValue)
}

function buildInitialModelOptions(providerDefinition: unknown, model: string) {
  const trimmedModel = typeof model === 'string' ? model.trim() : ''
  const initialModels = Array.isArray((providerDefinition as Record<string, unknown> | null)?.initialModels)
    ? (providerDefinition as Record<string, unknown>).initialModels
    : []
  const options: string[] = [...initialModels as string[]]
  if (trimmedModel && !options.includes(trimmedModel)) {
    options.unshift(trimmedModel)
  }
  return options
}

function buildReasoningOptionsForCapability(capability: Record<string, unknown> | null | undefined) {
  if (capability?.reasoningMode !== 'effort') {
    return []
  }
  const supportedValues = Array.isArray(capability?.supportsReasoningEffort)
    ? capability.supportsReasoningEffort.filter((value) => typeof value === 'string' && value.trim())
    : []
  const nextOptions = capability?.requiredReasoningEffort
    ? supportedValues
    : ['disable', ...supportedValues.filter((value) => value !== 'disable')]
  return [...new Set(nextOptions)]
}

function getReasoningOptionLabel(value: string) {
  const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : ''
  // 动态 key：reasoningEffortLabels 的值均为合法 i18n 键，未知值原样兜底
  return translate((reasoningEffortLabels[nextValue] || nextValue || '无') as I18nKey)
}

function supportsUnifiedEffortReasoning(providerValue: string) {
  return providerValue === 'Compatible' || providerValue === 'Responses' || providerValue === 'Messages'
}

interface ModelCapabilityLike {
  modelId?: string
  reasoningMode?: string
  reasoningEffort?: string
  supportsReasoningEffort?: string[]
  maxTokens?: number
  maxThinkingTokens?: number
  requiredReasoningBudget?: boolean
  requiredReasoningEffort?: boolean
  [key: string]: unknown
}

function buildDisplayModelCapability(providerValue: string, capability: ModelCapabilityLike): ModelCapabilityLike {
  if (!supportsUnifiedEffortReasoning(providerValue)) {
    return capability
  }
  return {
    ...capability,
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

function resolveEffortReasoningSelection(draft: ProviderDraft | Record<string, unknown>, capability: Record<string, unknown> | null | undefined) {
  if (capability?.reasoningMode !== 'effort') {
    return 'disable'
  }
  const availableOptions = buildReasoningOptionsForCapability(capability)
  const storedValue = typeof (draft as Record<string, unknown>).reasoningEffort === 'string' ? String((draft as Record<string, unknown>).reasoningEffort).trim().toLowerCase() : ''

  if (capability?.requiredReasoningEffort) {
    if (storedValue && availableOptions.includes(storedValue)) {
      return storedValue
    }
    return typeof capability?.reasoningEffort === 'string' ? capability.reasoningEffort : (availableOptions[0] || 'high')
  }

  if ((draft as Record<string, unknown>).enableReasoningEffort === false) {
    return 'disable'
  }

  if (storedValue && availableOptions.includes(storedValue)) {
    return storedValue
  }

  return storedValue || 'disable'
}

interface ProviderDraft {
  id: string
  name: string
  provider: string
  cacheStrategy: string
  baseUrl: string
  apiKey: string
  model: string
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
}

function buildDraft(provider?: AIProviderLike | null): ProviderDraft {
  const providerDefinition = getAIProviderDefinition(provider?.provider || 'Compatible')
  const resolvedModel = typeof provider?.model === 'string' && provider.model.trim()
    ? provider.model.trim()
    : ''
  const capability = providerDefinition.getModelCapability(resolvedModel)

  return {
    id: typeof provider?.id === 'string' && provider.id.trim() ? provider.id.trim() : '',
    name: typeof provider?.name === 'string' ? provider.name : '',
    provider: providerDefinition.value,
    cacheStrategy: typeof provider?.cacheStrategy === 'string' && provider.cacheStrategy.trim()
      ? provider.cacheStrategy.trim()
      : '5m',
    baseUrl: typeof provider?.baseUrl === 'string' ? provider.baseUrl : '',
    apiKey: typeof provider?.apiKey === 'string' ? provider.apiKey : '',
    model: resolvedModel,
    webSearchEnabled: provider?.webSearchEnabled !== false,
    dedicatedWebSearchEnabled: Boolean(provider?.dedicatedWebSearchEnabled),
    dedicatedWebSearchProviderId: provider?.dedicatedWebSearchEnabled === true && typeof provider?.dedicatedWebSearchProviderId === 'string' && provider.dedicatedWebSearchProviderId.trim()
      ? provider.dedicatedWebSearchProviderId.trim()
      : selfWebSearchProviderValue,
    dedicatedProxyEnabled: Boolean(provider?.dedicatedProxyEnabled),
    dedicatedProxyId: typeof provider?.dedicatedProxyId === 'string' ? provider.dedicatedProxyId.trim() : '',
    reasoningEffort: typeof provider?.reasoningEffort === 'string' && provider.reasoningEffort.trim()
      ? provider.reasoningEffort.trim().toLowerCase()
      : (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : 'disable'),
    enableReasoningEffort: provider?.enableReasoningEffort === true
      || (typeof provider?.reasoningEffort === 'string' && provider.reasoningEffort.trim().toLowerCase() !== 'disable')
      || normalizePositiveInteger(provider?.modelMaxTokens) > 0
      || normalizePositiveInteger(provider?.modelMaxThinkingTokens) > 0
      || capability.requiredReasoningBudget === true
      || capability.requiredReasoningEffort === true,
    openAiLegacyReasoningFormatEnabled: provider?.openAiLegacyReasoningFormatEnabled === true,
    modelMaxTokens: normalizePositiveInteger(provider?.modelMaxTokens, capability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS),
    modelMaxThinkingTokens: normalizePositiveInteger(provider?.modelMaxThinkingTokens, capability.maxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS),
    pinned: Boolean(provider?.pinned),
  }
}

interface SelectMenuOption {
  value: string
  label: string
}

function SelectMenu({ value, options, open, onToggle, onSelect, menuRef, menuWidth = '100%', showSelectedIcon = true, disabled = false, id, 'aria-labelledby': ariaLabelledBy, 'aria-label': ariaLabel }: {
  value: string
  options: SelectMenuOption[]
  open: boolean
  onToggle?: () => void
  onSelect: (value: string) => void
  menuRef?: React.Ref<HTMLDivElement>
  menuWidth?: string
  showSelectedIcon?: boolean
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
  'aria-label'?: string
}) {
  const currentOption = options.find((option) => option.value === value) || options[0]

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        type="button"
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return
          }
          onToggle?.()
        }}
        style={{
          height: 34,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderRadius: 18,
          border: `1px solid ${open ? 'var(--accent-border)' : 'var(--border)'}`,
          background: open ? 'rgba(var(--accent-rgb), 0.10)' : 'var(--surface-base)',
          color: 'var(--text-primary)',
          boxSizing: 'border-box',
          opacity: disabled ? 0.7 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'var(--transition)',
        }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 }}>
          {currentOption?.label || value}
        </span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 11, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'var(--transition)' }}>▾</span>
      </button>

      {open && !disabled ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: menuWidth,
            padding: 4,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface-overlay)',
            boxShadow: 'var(--shadow-lg)',
            display: 'grid',
            gap: 2,
            zIndex: 30,
          }}>
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                style={{
                  minHeight: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '0 10px',
                  border: 'none',
                  borderRadius: 8,
                  background: active ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 13,
                  textAlign: 'left',
                  transition: 'var(--transition)',
                }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
                {active && showSelectedIcon ? <Check size={13} color="var(--accent)" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export interface AIProviderQuickEditOverlayProps {
  open: boolean
  mode?: 'create' | 'edit'
  provider?: AIProviderLike | null
  providers?: AIProviderLike[]
  panelBounds?: { top: number; left: number; width: number; height: number } | null
  onClose: () => void
  onSave?: (draft: Record<string, unknown>) => void | Promise<void>
  onDelete?: (provider: AIProviderLike) => void | Promise<void>
}

export default function AIProviderQuickEditOverlay({ open, mode = 'edit', provider, providers = [], panelBounds, onClose, onSave, onDelete }: AIProviderQuickEditOverlayProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ProviderDraft>(buildDraft())
  const [modelQuery, setModelQuery] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>(buildInitialModelOptions(getAIProviderDefinition('Compatible'), ''))
  const [modelRefreshError, setModelRefreshError] = useState('')
  const [modelRefreshing, setModelRefreshing] = useState(false)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [dedicatedProviderMenuOpen, setDedicatedProviderMenuOpen] = useState(false)
  const [dedicatedProviderSearch, setDedicatedProviderSearch] = useState('')
  const [validatingWebSearch, setValidatingWebSearch] = useState(false)
  const [webSearchValidationMessage, setWebSearchValidationMessage] = useState('')
  const [webSearchValidationPassed, setWebSearchValidationPassed] = useState(false)
  const [proxyNodes, setProxyNodes] = useState<Array<{ id?: string; name?: string; type?: string; host?: string; port?: number }>>([])
  const [proxyMenuOpen, setProxyMenuOpen] = useState(false)
  const providerFieldRef = useRef<HTMLDivElement | null>(null)
  const dedicatedProviderFieldRef = useRef<HTMLDivElement | null>(null)
  const dedicatedProxyFieldRef = useRef<HTMLDivElement | null>(null)
  const autoRefreshTimerRef = useRef<number | null>(null)
  const lastAutoRefreshKeyRef = useRef('')
  const providerDefinition = useMemo(
    () => getAIProviderDefinition(draft.provider),
    [draft.provider],
  )

  const providerOptions = useMemo(
    () => availableAIProviders.map((provider: { value: string; label?: string }) => ({
      value: provider.value,
      label: getProviderDisplayLabel(provider, t),
    })),
    [t],
  )

  const modelCapability = useMemo(() => {
    const baseCapability = providerDefinition.getModelCapability(draft.model || '')
    return buildDisplayModelCapability(draft.provider, baseCapability)
  }, [draft.provider, providerDefinition, draft.model])

  const effortReasoningOptions = useMemo(
    () => buildReasoningOptionsForCapability(modelCapability),
    [modelCapability],
  )

  const currentEffortReasoningSelection = useMemo(
    () => resolveEffortReasoningSelection(draft, modelCapability),
    [draft, modelCapability],
  )

  const resolvedMaxTokens = useMemo(
    () => normalizePositiveInteger(draft.modelMaxTokens, modelCapability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS),
    [draft.modelMaxTokens, modelCapability.maxTokens],
  )

  const maxThinkingTokenLimit = useMemo(
    () => Math.max(1024, Math.floor(resolvedMaxTokens * 0.8)),
    [resolvedMaxTokens],
  )

  const resolvedThinkingTokens = useMemo(() => {
    const fallbackValue = modelCapability.maxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS
    return Math.min(
      normalizePositiveInteger(draft.modelMaxThinkingTokens, fallbackValue),
      maxThinkingTokenLimit,
    )
  }, [draft.modelMaxThinkingTokens, maxThinkingTokenLimit, modelCapability.maxThinkingTokens])

  const supportsPromptCacheSettings = providerDefinition.supportsPromptCacheSettings === true
  const promptCacheOptions = useMemo(() => {
    if (!supportsPromptCacheSettings) {
      return [] as Array<{ value: string; labelKey: string }>
    }
    if (providerDefinition.value === 'Responses') {
      // providers JSDoc 未声明该函数，按结构断言
      const getPromptCacheStrategyOptions = (providerDefinition as unknown as { getPromptCacheStrategyOptions?: (model: string) => Array<{ value: string; labelKey: string }> }).getPromptCacheStrategyOptions
      if (typeof getPromptCacheStrategyOptions === 'function') {
        return getPromptCacheStrategyOptions(draft.model || '')
      }
    }
    return defaultCacheOptions
  }, [draft.model, providerDefinition, supportsPromptCacheSettings])
  const selectedPromptCacheStrategy = useMemo(() => {
    const values = promptCacheOptions.map((option) => option.value)
    if (values.includes(draft.cacheStrategy)) {
      return draft.cacheStrategy
    }
    if (values.includes('model')) {
      return 'model'
    }
    return values[0] || 'model'
  }, [draft.cacheStrategy, promptCacheOptions])
  const supportsWebSearch = providerDefinition.supportsWebSearch === true
  const dedicatedProviderOptions = useMemo(
    () => ([
      { value: selfWebSearchProviderValue, label: t('自身') },
      ...providers
        .filter((item) => item.id !== draft.id)
        .filter((item) => canUseDedicatedWebSearchCandidate(item.provider))
        .map((item) => ({
          value: item.id || '',
          label: item.model ? `${item.name || ''} · ${item.model}` : (item.name || ''),
        })),
    ]),
    [providers, draft.id, t],
  )

  const filteredDedicatedProviderOptions = useMemo(() => {
    const keyword = dedicatedProviderSearch.trim().toLowerCase()
    if (!keyword) {
      return dedicatedProviderOptions
    }
    return dedicatedProviderOptions.filter((item) => item.label.toLowerCase().includes(keyword))
  }, [dedicatedProviderOptions, dedicatedProviderSearch])

  const currentDedicatedProviderOption = useMemo(
    () => dedicatedProviderOptions.find((item) => item.value === draft.dedicatedWebSearchProviderId) || dedicatedProviderOptions[0] || null,
    [dedicatedProviderOptions, draft.dedicatedWebSearchProviderId],
  )

  const dedicatedProxyOptions = useMemo(() => ([
    { value: '', label: t('不使用') },
    ...proxyNodes.map((node) => ({
      value: node.id || '',
      label: [
        node.name || t('未命名节点'),
        `${node.type === 'http' ? 'http' : 'socks5'}://${node.host}:${node.port}`,
      ].join(' · '),
    })),
  ]), [proxyNodes, t])

  const currentDedicatedProxyOption = useMemo(
    () => dedicatedProxyOptions.find((item) => item.value === draft.dedicatedProxyId) || dedicatedProxyOptions[0] || null,
    [dedicatedProxyOptions, draft.dedicatedProxyId],
  )

  const selectedWebSearchProviderValue = currentDedicatedProviderOption?.value || selfWebSearchProviderValue
  const usingDedicatedWebSearchProvider = selectedWebSearchProviderValue !== selfWebSearchProviderValue
  const canValidateWebSearch = draft.webSearchEnabled && (
    usingDedicatedWebSearchProvider
      ? Boolean(selectedWebSearchProviderValue)
      : Boolean(draft.baseUrl && draft.apiKey && draft.model)
  )

  const title = draft.name || (mode === 'create' ? t('新增供应商') : t('编辑供应商'))
  const subtitle = mode === 'create' ? t('创建供应商配置...') : t('编辑...')


  const refreshModelsWithCredentials = async (providerValue: string, baseUrlValue: string, apiKeyValue: string, selectedModel = '') => {
    const trimmedProvider = typeof providerValue === 'string' ? providerValue.trim() : ''
    const trimmedBaseUrl = typeof baseUrlValue === 'string' ? baseUrlValue.trim() : ''
    const trimmedApiKey = typeof apiKeyValue === 'string' ? apiKeyValue.trim() : ''

    if (!trimmedBaseUrl || !trimmedApiKey) {
      setModelRefreshError('')
      return false
    }

    const refreshKey = `${trimmedProvider}::${trimmedBaseUrl}::${trimmedApiKey}`
    lastAutoRefreshKeyRef.current = refreshKey
    setModelRefreshing(true)
    setModelRefreshError('')

    const bridge = getAppBridge()
    if (!bridge?.RequestAIProviderModels) {
      setModelRefreshing(false)
      setModelRefreshError(t('当前环境不支持刷新模型'))
      return false
    }

    try {
      const requestProfile = {
        ...draft,
        provider: trimmedProvider || draft.provider,
        baseUrl: trimmedBaseUrl,
        apiKey: trimmedApiKey,
        model: selectedModel || draft.model,
        dedicatedProxyEnabled: Boolean(draft.dedicatedProxyEnabled),
        dedicatedProxyId: draft.dedicatedProxyId || '',
      }
      const models = bridge?.RequestAIProviderModelsWithProfile
        ? await bridge.RequestAIProviderModelsWithProfile(JSON.stringify(requestProfile))
        : await bridge.RequestAIProviderModels(trimmedBaseUrl, trimmedApiKey)
      const normalizedModels = Array.isArray(models)
        ? models.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : []

      if (normalizedModels.length === 0) {
        throw new Error(t('未获取到任何模型'))
      }

      const nextModels = selectedModel && !normalizedModels.includes(selectedModel)
        ? [selectedModel, ...normalizedModels]
        : normalizedModels

      setModelOptions(nextModels)

      return true
    } catch (error) {
      setModelOptions(buildInitialModelOptions(getAIProviderDefinition(trimmedProvider || draft.provider), selectedModel || draft.model))
      setModelRefreshError(error instanceof Error ? error.message : t('刷新模型失败'))
      return false
    } finally {
      setModelRefreshing(false)
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }
    const initialDraft = buildDraft(provider)
    const initialProviderDefinition = getAIProviderDefinition(initialDraft.provider)
    setDraft(initialDraft)
    setModelOptions(buildInitialModelOptions(initialProviderDefinition, initialDraft.model))
    setModelRefreshError('')
    setModelRefreshing(false)
    setModelQuery('')
    setProviderMenuOpen(false)
    setDedicatedProviderMenuOpen(false)
    setDedicatedProviderSearch('')
    setProxyMenuOpen(false)
    setValidatingWebSearch(false)
    setWebSearchValidationMessage('')
    setWebSearchValidationPassed(false)
    getAIGlobalSettings()
      .then((settings) => {
        const nextProxyNodes = Array.isArray(settings?.proxyNodes) ? settings.proxyNodes : []
        setProxyNodes(nextProxyNodes)
      })
      .catch(() => {
        setProxyNodes([])
      })
    if (initialDraft.baseUrl.trim() && initialDraft.apiKey.trim()) {
      void refreshModelsWithCredentials(initialDraft.provider, initialDraft.baseUrl, initialDraft.apiKey, initialDraft.model)
    } else {
      lastAutoRefreshKeyRef.current = ''
    }
  }, [open, provider])

  // 代理节点变更时实时刷新下拉列表
  useEffect(() => {
    if (!open) return undefined
    const handler = (event: Event) => {
      const newProxyNodes = (event as CustomEvent<unknown>).detail
      if (Array.isArray(newProxyNodes)) setProxyNodes(newProxyNodes as Array<{ id?: string; name?: string; type?: string; host?: string; port?: number }>)
    }
    window.addEventListener('lumin:proxy-nodes-changed', handler)
    return () => window.removeEventListener('lumin:proxy-nodes-changed', handler)
  }, [open])


  useEffect(() => {
    if (!providerMenuOpen && !dedicatedProviderMenuOpen && !proxyMenuOpen) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (providerFieldRef.current && !providerFieldRef.current.contains(event.target as Node)) {
        setProviderMenuOpen(false)
      }
      if (dedicatedProviderFieldRef.current && !dedicatedProviderFieldRef.current.contains(event.target as Node)) {
        setDedicatedProviderMenuOpen(false)
      }
      if (dedicatedProxyFieldRef.current && !dedicatedProxyFieldRef.current.contains(event.target as Node)) {
        setProxyMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [providerMenuOpen, dedicatedProviderMenuOpen, proxyMenuOpen])

  useEffect(() => {
    setWebSearchValidationMessage('')
    setWebSearchValidationPassed(false)
  }, [
    draft.provider,
    draft.baseUrl,
    draft.apiKey,
    draft.model,
    draft.webSearchEnabled,
    draft.dedicatedWebSearchEnabled,
    draft.dedicatedWebSearchProviderId,
  ])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const trimmedBaseUrl = draft.baseUrl.trim()
    const trimmedApiKey = draft.apiKey.trim()

    if (!trimmedBaseUrl || !trimmedApiKey) {
      lastAutoRefreshKeyRef.current = ''
      if (autoRefreshTimerRef.current) {
        window.clearTimeout(autoRefreshTimerRef.current)
      }
      return undefined
    }

    const refreshKey = `${draft.provider.trim()}::${trimmedBaseUrl}::${trimmedApiKey}`
    if (refreshKey === lastAutoRefreshKeyRef.current) {
      return undefined
    }

    if (autoRefreshTimerRef.current) {
      window.clearTimeout(autoRefreshTimerRef.current)
    }

    autoRefreshTimerRef.current = window.setTimeout(() => {
      void refreshModelsWithCredentials(draft.provider, trimmedBaseUrl, trimmedApiKey, draft.model)
    }, 1000)

    return () => {
      if (autoRefreshTimerRef.current) {
        window.clearTimeout(autoRefreshTimerRef.current)
      }
    }
  }, [open, draft.provider, draft.baseUrl, draft.apiKey, draft.model])

  const filteredModels = useMemo(() => {
    const keyword = modelQuery.trim().toLowerCase()
    if (!keyword) {
      return modelOptions
    }
    return modelOptions.filter((item) => item.toLowerCase().includes(keyword))
  }, [modelOptions, modelQuery])

  if (!open) {
    return null
  }

  const handleProviderSelect = (nextProvider: string) => {
    const nextProviderDefinition = getAIProviderDefinition(nextProvider)
    setDraft((prev) => {
      const nextModel = typeof prev.model === 'string' ? prev.model.trim() : ''
      const nextCapability = nextProviderDefinition.getModelCapability(nextModel)
      return {
        ...prev,
        provider: nextProviderDefinition.value,
        model: nextModel,
        cacheStrategy: prev.cacheStrategy || '5m',
        reasoningEffort: prev.reasoningEffort || (typeof nextCapability.reasoningEffort === 'string' ? nextCapability.reasoningEffort : '') || 'disable',
        enableReasoningEffort: nextCapability.requiredReasoningBudget || nextCapability.requiredReasoningEffort
          ? true
          : prev.enableReasoningEffort,
        modelMaxTokens: prev.modelMaxTokens || nextCapability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS,
        modelMaxThinkingTokens: prev.modelMaxThinkingTokens || nextCapability.maxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS,
      }
    })
    setModelOptions(buildInitialModelOptions(nextProviderDefinition, typeof draft.model === 'string' ? draft.model.trim() : ''))
    setModelQuery('')
    setProviderMenuOpen(false)
  }

  const handleWebSearchProviderSelect = (nextProviderId: string) => {
    const normalizedProviderId = dedicatedProviderOptions.some((item) => item.value === nextProviderId)
      ? nextProviderId
      : selfWebSearchProviderValue
    setDraft((prev) => ({
      ...prev,
      dedicatedWebSearchEnabled: normalizedProviderId !== selfWebSearchProviderValue,
      dedicatedWebSearchProviderId: normalizedProviderId,
    }))
    setDedicatedProviderMenuOpen(false)
    setDedicatedProviderSearch('')
  }

  const handleWebSearchToggle = () => {
    setDraft((prev) => ({
      ...prev,
      webSearchEnabled: !prev.webSearchEnabled,
    }))
  }

  const handleRefreshModels = async () => {
    const trimmedBaseUrl = draft.baseUrl.trim()
    const trimmedApiKey = draft.apiKey.trim()

    if (!trimmedBaseUrl) {
      setModelRefreshError(t('请先填写基础 URL'))
      return
    }

    if (!trimmedApiKey) {
      setModelRefreshError(t('请先填写 API 密钥'))
      return
    }

    await refreshModelsWithCredentials(draft.provider, trimmedBaseUrl, trimmedApiKey, draft.model)
  }

  const handleValidateWebSearch = async () => {
    if (!canValidateWebSearch || validatingWebSearch) {
      return
    }
    const bridge = getAppBridge()
    if (!bridge?.ValidateAIProviderWebSearch) {
      setWebSearchValidationPassed(false)
      setWebSearchValidationMessage(t('不支持'))
      return
    }

    setValidatingWebSearch(true)
    setWebSearchValidationPassed(false)
    setWebSearchValidationMessage('')

    try {
      const resolvedWebSearchProviderValue = dedicatedProviderOptions.some((item) => item.value === draft.dedicatedWebSearchProviderId)
        ? draft.dedicatedWebSearchProviderId
        : selfWebSearchProviderValue
      const useDedicatedWebSearchProvider = resolvedWebSearchProviderValue !== selfWebSearchProviderValue
      const result = await bridge.ValidateAIProviderWebSearch(JSON.stringify({
        ...draft,
        provider: providerDefinition.value,
        model: draft.model?.trim() || '',
        webSearchEnabled: draft.webSearchEnabled,
        dedicatedWebSearchEnabled: useDedicatedWebSearchProvider,
        dedicatedWebSearchProviderId: useDedicatedWebSearchProvider ? resolvedWebSearchProviderValue : '',
        reasoningEffort: draft.reasoningEffort || 'disable',
        enableReasoningEffort: Boolean(draft.enableReasoningEffort),
        modelMaxTokens: normalizePositiveInteger(draft.modelMaxTokens),
        modelMaxThinkingTokens: normalizePositiveInteger(draft.modelMaxThinkingTokens),
        openAiLegacyReasoningFormatEnabled: draft.openAiLegacyReasoningFormatEnabled === true,
      }))
      const passed = result?.success === true
      setWebSearchValidationPassed(passed)
      setWebSearchValidationMessage(passed ? t('支持') : t('不支持'))
    } catch {
      setWebSearchValidationPassed(false)
      setWebSearchValidationMessage(t('不支持'))
    } finally {
      setValidatingWebSearch(false)
    }
  }

  const handleSave = () => {
    let reasoningEffort = draft.reasoningEffort || 'disable'
    let enableReasoningEffort = Boolean(draft.enableReasoningEffort)
    let modelMaxTokens = normalizePositiveInteger(draft.modelMaxTokens)
    let modelMaxThinkingTokens = normalizePositiveInteger(draft.modelMaxThinkingTokens)

    switch (modelCapability.reasoningMode) {
      case 'binary':
        reasoningEffort = 'disable'
        modelMaxTokens = 0
        modelMaxThinkingTokens = 0
        break
      case 'effort': {
        const nextSelection = currentEffortReasoningSelection
        reasoningEffort = nextSelection
        enableReasoningEffort = nextSelection !== 'disable'
        modelMaxTokens = 0
        modelMaxThinkingTokens = 0
        break
      }
      case 'budget':
        reasoningEffort = 'disable'
        enableReasoningEffort = modelCapability.requiredReasoningBudget ? true : Boolean(draft.enableReasoningEffort)
        if (!enableReasoningEffort && !modelCapability.requiredReasoningBudget) {
          modelMaxTokens = 0
          modelMaxThinkingTokens = 0
        } else {
          modelMaxTokens = resolvedMaxTokens
          modelMaxThinkingTokens = resolvedThinkingTokens
        }
        break
      default:
        reasoningEffort = 'disable'
        enableReasoningEffort = false
        modelMaxTokens = 0
        modelMaxThinkingTokens = 0
        break
    }

    const resolvedWebSearchProviderValue = dedicatedProviderOptions.some((item) => item.value === draft.dedicatedWebSearchProviderId)
      ? draft.dedicatedWebSearchProviderId
      : selfWebSearchProviderValue
    const useDedicatedWebSearchProvider = resolvedWebSearchProviderValue !== selfWebSearchProviderValue

    onSave?.({
      ...draft,
      provider: providerDefinition.value,
      cacheStrategy: selectedPromptCacheStrategy,
      webSearchEnabled: draft.webSearchEnabled,
      dedicatedWebSearchEnabled: useDedicatedWebSearchProvider,
      dedicatedWebSearchProviderId: useDedicatedWebSearchProvider ? resolvedWebSearchProviderValue : '',
      dedicatedProxyEnabled: draft.dedicatedProxyEnabled,
      dedicatedProxyId: draft.dedicatedProxyEnabled ? draft.dedicatedProxyId : '',
      reasoningEffort,
      enableReasoningEffort,
      openAiLegacyReasoningFormatEnabled: draft.openAiLegacyReasoningFormatEnabled === true,
      modelMaxTokens,
      modelMaxThinkingTokens,
    })
  }

  const renderBudgetSection = () => {
    const budgetEnabled = modelCapability.requiredReasoningBudget || draft.enableReasoningEffort
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {!modelCapability.requiredReasoningBudget ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--surface-overlay)',
            }}>
            <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{t('启用推理')}</span>
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, enableReasoningEffort: !prev.enableReasoningEffort }))}
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: draft.enableReasoningEffort ? 'rgba(var(--accent-rgb), 0.52)' : 'var(--surface-hover)',
                padding: 2,
                position: 'relative',
                transition: 'var(--transition)',
              }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: 'var(--surface-raised)',
                  display: 'block',
                  transform: draft.enableReasoningEffort ? 'translateX(14px)' : 'translateX(0)',
                  transition: 'var(--transition)',
                }}
              />
            </button>
          </div>
        ) : null}

        {budgetEnabled ? (
          <div
            style={{
              display: 'grid',
              gap: 10,
              padding: '12px 12px 14px',
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--surface-overlay)',
            }}>
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('最大输出 Token')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10 }}>
                <input
                  id="ai-qedit-max-tokens"
                  name="ai-qedit-max-tokens"
                  autoComplete="off"
                  type="range"
                  min={8192}
                  max={Math.max(resolvedMaxTokens, modelCapability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS)}
                  step={1024}
                  value={resolvedMaxTokens}
                  onChange={(event) => setDraft((prev) => ({ ...prev, modelMaxTokens: Number(event.target.value) }))}
                />
                <div style={{ minWidth: 56, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {resolvedMaxTokens}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('思考 Token 预算')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10 }}>
                <input
                  id="ai-qedit-thinking-tokens"
                  name="ai-qedit-thinking-tokens"
                  autoComplete="off"
                  type="range"
                  min={1024}
                  max={maxThinkingTokenLimit}
                  step={1024}
                  value={resolvedThinkingTokens}
                  onChange={(event) => setDraft((prev) => ({ ...prev, modelMaxThinkingTokens: Number(event.target.value) }))}
                />
                <div style={{ minWidth: 56, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {resolvedThinkingTokens}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const renderReasoningSection = () => {
    switch (modelCapability.reasoningMode) {
      case 'binary':
        return (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--surface-overlay)',
            }}>
            <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{t('启用推理')}</span>
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, enableReasoningEffort: !prev.enableReasoningEffort }))}
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: draft.enableReasoningEffort ? 'rgba(var(--accent-rgb), 0.52)' : 'var(--surface-hover)',
                padding: 2,
                position: 'relative',
                transition: 'var(--transition)',
              }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: 'var(--surface-raised)',
                  display: 'block',
                  transform: draft.enableReasoningEffort ? 'translateX(14px)' : 'translateX(0)',
                  transition: 'var(--transition)',
                }}
              />
            </button>
          </div>
        )
      case 'budget':
        return renderBudgetSection()
      case 'effort':
        return (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 3 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('思考深度')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                {effortReasoningOptions.map((option) => {
                  const active = currentEffortReasoningSelection === option
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        if (option === 'disable') {
                          setDraft((prev) => ({
                            ...prev,
                            reasoningEffort: 'disable',
                            enableReasoningEffort: false,
                          }))
                          return
                        }
                        setDraft((prev) => ({
                          ...prev,
                          reasoningEffort: option,
                          enableReasoningEffort: true,
                        }))
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        border: 'none',
                        background: 'transparent',
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        padding: 0,
                        fontSize: 12,
                        fontWeight: active ? 700 : 500,
                      }}>
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 999,
                          boxSizing: 'border-box',
                          border: `1px solid ${active ? 'rgba(var(--accent-rgb), 0.65)' : 'var(--border)'}`,
                          background: active ? 'rgba(var(--accent-rgb), 0.18)' : 'transparent',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        {active ? <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent)', display: 'block' }} /> : null}
                      </span>
                      <span>{getReasoningOptionLabel(option)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            {draft.provider === 'Messages' ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  background: 'var(--surface-overlay)',
                }}>
                <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{t('旧推理格式')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{t('为 Messages 使用旧式 thinking budget 负载，而不是 adaptive effort。')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, openAiLegacyReasoningFormatEnabled: !prev.openAiLegacyReasoningFormatEnabled }))}
                  style={{
                    width: 34,
                    height: 20,
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: draft.openAiLegacyReasoningFormatEnabled ? 'rgba(var(--accent-rgb), 0.52)' : 'var(--surface-hover)',
                    padding: 2,
                    position: 'relative',
                    transition: 'var(--transition)',
                    flexShrink: 0,
                  }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: 'var(--surface-raised)',
                      display: 'block',
                      transform: draft.openAiLegacyReasoningFormatEnabled ? 'translateX(14px)' : 'translateX(0)',
                      transition: 'var(--transition)',
                    }}
                  />
                </button>
              </div>
            ) : null}
          </div>
        )
      default:
        return null
    }
  }

  const validationButtonVariant = webSearchValidationMessage
    ? (webSearchValidationPassed ? 'success' : 'error')
    : 'default'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: panelBounds?.top ?? 0,
        left: panelBounds?.left ?? 0,
        width: panelBounds?.width ?? '100vw',
        height: panelBounds?.height ?? '100vh',
        maxWidth: '100vw',
        maxHeight: '100vh',
        overflow: 'hidden',
        background: 'rgba(5, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'stretch',
        zIndex: 120,
      }}>
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--surface-base)',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--text-primary)',
          overflow: 'hidden',
        }}>
        <div style={{ height: 46, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 30,
                height: 30,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-secondary)',
                transition: 'var(--transition)',
              }}>
              <ArrowLeft size={16} />
            </button>
            <div style={{ minWidth: 0, display: 'grid', gap: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.2 }}>{subtitle}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode === 'edit' ? (
              <button
                type="button"
                onClick={() => { if (provider) onDelete?.(provider) }}
                style={{
                  width: 32,
                  height: 32,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: 'var(--danger)',
                  transition: 'var(--transition)',
                }}>
                <Trash2 size={15} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSave}
              style={{
                height: 34,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '0 12px',
                borderRadius: 8,
                border: '1px solid var(--accent-border)',
                background: 'rgba(var(--accent-rgb), 0.14)',
                color: 'var(--accent)',
                fontSize: 12,
                fontWeight: 700,
                transition: 'var(--transition)',
              }}>
              <Save size={14} />
              {t('保存')}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <label htmlFor="ai-provider-config-name" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('配置文件')}</label>
              <input
                id="ai-provider-config-name"
                name="ai-provider-config-name"
                autoComplete="off"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                onMouseLeave={handleInputDragSelectAll}
                placeholder={t('输入配置名')}
                style={{
                  height: 34,
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-sunken)',
                  color: 'var(--text-primary)',
                  padding: '0 10px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'grid', gap: 2 }}>
              <label id="ai-provider-select-label" htmlFor="ai-provider-select" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('API提供商')}</label>
              <SelectMenu
                id="ai-provider-select"
                aria-labelledby="ai-provider-select-label"
                value={draft.provider}
                options={providerOptions}
                open={providerMenuOpen}
                onToggle={() => setProviderMenuOpen((prev) => !prev)}
                onSelect={handleProviderSelect}
                menuRef={providerFieldRef}
                showSelectedIcon={false}
              />
            </div>
          </div>

          {supportsPromptCacheSettings ? (
            <div style={{ display: 'grid', gap: 3 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>{t('缓存策略')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(promptCacheOptions.length, 1)}, minmax(0, 1fr))`, gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {promptCacheOptions.map((option: { value: string; labelKey: string }, index: number) => {
                  const active = selectedPromptCacheStrategy === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, cacheStrategy: option.value }))}
                      style={{
                        height: 34,
                        border: 'none',
                        borderRight: index < promptCacheOptions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        background: active ? 'rgba(var(--accent-rgb), 0.14)' : 'transparent',
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontSize: 12,
                        fontWeight: active ? 700 : 500,
                        transition: 'var(--transition)',
                      }}>
                      {t(option.labelKey as I18nKey)}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 2 }}>
            <label htmlFor="ai-provider-base-url" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>{t('基础 URL')}</label>
            <input
              id="ai-provider-base-url"
              name="ai-provider-base-url"
              autoComplete="off"
              value={draft.baseUrl}
              onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
              onMouseLeave={handleInputDragSelectAll}
              placeholder="https://api.example.com/v1"
              style={{
                height: 34,
                width: '100%',
                borderRadius: 0,
                border: '1px solid var(--border)',
                background: 'var(--surface-sunken)',
                color: 'var(--text-primary)',
                padding: '0 10px',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label htmlFor="ai-provider-api-key" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>{t('API 密钥')}</label>
            </div>
            <input
              id="ai-provider-api-key"
              name="ai-provider-api-key"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
              onMouseLeave={handleInputDragSelectAll}
              placeholder={t('输入 API Key')}
              style={{
                height: 34,
                width: '100%',
                borderRadius: 0,
                border: '1px solid var(--border)',
                background: 'var(--surface-sunken)',
                color: 'var(--text-primary)',
                padding: '0 10px',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          {supportsWebSearch ? (
            <div
              style={{
                display: 'grid',
                gap: 0,
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 12,
                background: 'var(--surface-overlay)',
              }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    minHeight: 32,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 999,
                        background: 'rgba(var(--accent-rgb), 0.12)',
                        color: 'var(--accent)',
                        flexShrink: 0,
                      }}>
                      <Globe size={14} />
                    </div>
                    <div style={{ minWidth: 0, display: 'grid', gap: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('联网搜索')}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.2 }}>{t('启用后通过所选供应商执行联网搜索')}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <CircleHelp size={14} color="var(--text-tertiary)" />
                    <button
                      type="button"
                      onClick={handleWebSearchToggle}
                      style={{
                        width: 34,
                        height: 20,
                        borderRadius: 999,
                        border: '1px solid var(--border)',
                        background: draft.webSearchEnabled ? 'rgba(var(--accent-rgb), 0.52)' : 'var(--surface-hover)',
                        padding: 2,
                        position: 'relative',
                        transition: 'var(--transition)',
                      }}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 999,
                          background: 'var(--surface-raised)',
                          display: 'block',
                          transform: draft.webSearchEnabled ? 'translateX(14px)' : 'translateX(0)',
                          transition: 'var(--transition)',
                        }}
                      />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleValidateWebSearch}
                  disabled={!canValidateWebSearch || validatingWebSearch}
                  style={{
                    minWidth: 74,
                    minHeight: 40,
                    padding: '0 10px',
                    borderRadius: 12,
                    border: validationButtonVariant === 'success'
                      ? '1px solid rgba(var(--success-rgb), 0.35)'
                      : validationButtonVariant === 'error'
                        ? '1px solid rgba(var(--danger-rgb), 0.30)'
                        : '1px solid var(--border)',
                    background: validationButtonVariant === 'success'
                      ? 'rgba(var(--success-rgb), 0.10)'
                      : validationButtonVariant === 'error'
                        ? 'rgba(var(--danger-rgb), 0.08)'
                        : 'var(--surface-base)',
                    color: !canValidateWebSearch
                      ? 'var(--text-tertiary)'
                      : validationButtonVariant === 'success'
                        ? 'var(--success)'
                        : validationButtonVariant === 'error'
                          ? 'var(--danger)'
                          : 'var(--text-primary)',
                    fontSize: 12,
                    fontWeight: 600,
                    opacity: canValidateWebSearch ? 1 : 0.6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}>
                  {validatingWebSearch ? t('验证中...') : (
                    <>
                      {webSearchValidationPassed ? <Check size={13} /> : null}
                      <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {webSearchValidationMessage || t('验证')}
                      </span>
                    </>
                  )}
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border-subtle)',
                }}>
                <div ref={dedicatedProviderFieldRef} style={{ position: 'relative', minWidth: 0 }}>
                  <button
                    type="button"
                    disabled={!draft.webSearchEnabled}
                    onClick={() => {
                      if (!draft.webSearchEnabled) {
                        return
                      }
                      setDedicatedProviderMenuOpen((prev) => !prev)
                    }}
                    style={{
                      height: 30,
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '0 10px',
                      borderRadius: 999,
                      border: `1px solid ${dedicatedProviderMenuOpen ? 'var(--accent-border)' : 'var(--border)'}`,
                      background: dedicatedProviderMenuOpen ? 'rgba(var(--accent-rgb), 0.10)' : 'var(--surface-base)',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      boxSizing: 'border-box',
                      transition: 'var(--transition)',
                      opacity: draft.webSearchEnabled ? 1 : 0.6,
                      cursor: draft.webSearchEnabled ? 'pointer' : 'not-allowed',
                    }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentDedicatedProviderOption?.label || t('自身')}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 10, transform: dedicatedProviderMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'var(--transition)' }}>▾</span>
                  </button>
                  {dedicatedProviderMenuOpen && draft.webSearchEnabled ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 'calc(100% + 8px)',
                        width: 320,
                        maxWidth: 'min(100%, 320px)',
                        maxHeight: 320,
                        borderRadius: 0,
                        border: '1px solid var(--accent-border)',
                        background: 'var(--surface-overlay)',
                        boxShadow: 'var(--shadow-xl)',
                        overflow: 'hidden',
                        zIndex: 40,
                      }}>
                      <div style={{ position: 'relative', borderBottom: '1px solid var(--border-subtle)' }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
                        <input
                          name="ai-provider-global-search"
                          autoComplete="off"
                          aria-label={t('搜索全局配置')}
                          value={dedicatedProviderSearch}
                          onChange={(event) => setDedicatedProviderSearch(event.target.value)}
                          onMouseLeave={handleInputDragSelectAll}
                          placeholder={t('搜索全局配置')}
                          style={{
                            width: '100%',
                            height: 34,
                            border: 'none',
                            outline: 'none',
                            background: 'var(--surface-base)',
                            color: 'var(--text-primary)',
                            padding: '0 10px 0 32px',
                            boxSizing: 'border-box',
                            fontSize: 13,
                          }}
                        />
                      </div>
                      <div style={{ maxHeight: 285, overflowY: 'auto' }}>
                        {filteredDedicatedProviderOptions.length > 0 ? (
                          filteredDedicatedProviderOptions.map((option) => {
                            const active = option.value === selectedWebSearchProviderValue
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => handleWebSearchProviderSelect(option.value)}
                                style={{
                                  width: '100%',
                                  minHeight: 34,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  padding: '0 10px',
                                  border: 'none',
                                  borderBottom: '1px solid var(--border-subtle)',
                                  background: active ? 'rgba(var(--accent-rgb), 0.16)' : 'transparent',
                                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                                  fontSize: 12,
                                  textAlign: 'left',
                                }}>
                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
                                {active ? <Check size={12} color="var(--text-primary)" /> : null}
                              </button>
                            )
                          })
                        ) : (
                          <div style={{ padding: '14px 10px', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>
                            {t('没有匹配的供应商')}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 6 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: draft.dedicatedProxyEnabled ? '1fr auto auto' : '1fr auto',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 12,
                background: 'var(--surface-overlay)',
              }}>
              <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('专属代理服务器')}</span>

              {draft.dedicatedProxyEnabled ? (
                <div ref={dedicatedProxyFieldRef} style={{ position: 'relative', minWidth: 0, maxWidth: 320 }}>
                  <button
                    type="button"
                    onClick={() => setProxyMenuOpen((prev) => !prev)}
                    style={{
                      height: 30,
                      minWidth: 220,
                      maxWidth: 320,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '0 10px',
                      borderRadius: 999,
                      border: `1px solid ${proxyMenuOpen ? 'var(--accent-border)' : 'var(--border)'}`,
                      background: proxyMenuOpen ? 'rgba(var(--accent-rgb), 0.10)' : 'var(--surface-base)',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      boxSizing: 'border-box',
                      transition: 'var(--transition)',
                    }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentDedicatedProxyOption?.label || t('不使用')}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 10, transform: proxyMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'var(--transition)' }}>▾</span>
                  </button>
                  {proxyMenuOpen ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 'calc(100% + 8px)',
                        width: 320,
                        maxWidth: 320,
                        maxHeight: 320,
                        borderRadius: 0,
                        border: '1px solid var(--accent-border)',
                        background: 'var(--surface-overlay)',
                        boxShadow: 'var(--shadow-xl)',
                        overflow: 'hidden',
                        zIndex: 40,
                      }}>
                      <div style={{ maxHeight: 285, overflowY: 'auto' }}>
                        {dedicatedProxyOptions.map((option) => {
                          const active = option.value === draft.dedicatedProxyId
                          return (
                            <button
                              key={option.value || '__none__'}
                              type="button"
                              onClick={() => {
                                setDraft((prev) => ({
                                  ...prev,
                                  dedicatedProxyId: option.value,
                                  dedicatedProxyEnabled: true,
                                }))
                                setProxyMenuOpen(false)
                              }}
                              style={{
                                width: '100%',
                                minHeight: 34,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                padding: '0 10px',
                                border: 'none',
                                borderBottom: '1px solid var(--border-subtle)',
                                background: active ? 'rgba(var(--accent-rgb), 0.16)' : 'transparent',
                                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontSize: 12,
                                textAlign: 'left',
                              }}>
                              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
                              {active ? <Check size={12} color="var(--text-primary)" /> : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, dedicatedProxyEnabled: !prev.dedicatedProxyEnabled }))}
                style={{
                  width: 34,
                  height: 20,
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: draft.dedicatedProxyEnabled ? 'rgba(var(--accent-rgb), 0.52)' : 'var(--surface-hover)',
                  padding: 2,
                  position: 'relative',
                  transition: 'var(--transition)',
                }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: 'var(--surface-raised)',
                    display: 'block',
                    transform: draft.dedicatedProxyEnabled ? 'translateX(14px)' : 'translateX(0)',
                    transition: 'var(--transition)',
                  }}
                />
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {t('开启后为当前供应商单独指定代理；关闭后跟随全局 AI 请求代理。')}
            </div>
          </div>

          {renderReasoningSection()}

          <div style={{ display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <label htmlFor="ai-provider-model-query" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{t('模型')}</label>
                {modelRefreshError ? (
                  <div style={{ color: 'var(--danger)', fontSize: 11, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                    {modelRefreshError}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleRefreshModels}
                disabled={modelRefreshing}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: modelRefreshing ? 'var(--text-muted)' : 'var(--text-tertiary)',
                  fontSize: 12,
                  padding: 0,
                  opacity: modelRefreshing ? 0.7 : 1,
                }}>
                {modelRefreshing ? t('刷新中...') : t('刷新模型')}
              </button>
            </div>

            <input
              id="ai-provider-model-query"
              name="ai-provider-model-query"
              autoComplete="off"
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
              onMouseLeave={handleInputDragSelectAll}
              placeholder={t('筛选模型或输入以指定模型')}
              style={{
                height: 34,
                width: '100%',
                borderRadius: 0,
                border: '1px solid var(--border)',
                background: 'var(--surface-sunken)',
                color: 'var(--text-primary)',
                padding: '0 10px',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />

            <div style={{ minHeight: 200, border: '1px solid var(--border)', background: 'var(--surface-base)', display: 'flex', flexDirection: 'column' }}>
              {filteredModels.length > 0 || modelQuery.trim() ? (
                <>
                  {filteredModels.map((item) => {
                    const active = draft.model === item
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          const capability = buildDisplayModelCapability(draft.provider, providerDefinition.getModelCapability(item))
                          setDraft((prev) => ({
                            ...prev,
                            model: item,
                            reasoningEffort: prev.reasoningEffort || (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : '') || 'disable',
                            modelMaxTokens: prev.modelMaxTokens || capability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS,
                            modelMaxThinkingTokens: prev.modelMaxThinkingTokens || capability.maxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS,
                          }))
                          setModelQuery('')
                        }}
                        style={{
                          minHeight: 32,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '0 10px',
                          border: 'none',
                          borderBottom: '1px solid var(--border-subtle)',
                          background: active ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          textAlign: 'left',
                        }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item}</span>
                        {active ? <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓</span> : null}
                      </button>
                    )
                  })}
                  {modelQuery.trim() ? (
                    <button
                      type="button"
                      onClick={() => {
                        const customModel = modelQuery.trim()
                        const capability = buildDisplayModelCapability(draft.provider, providerDefinition.getModelCapability(customModel))
                        setDraft((prev) => ({
                          ...prev,
                          model: customModel,
                          reasoningEffort: prev.reasoningEffort || (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : '') || 'disable',
                          modelMaxTokens: prev.modelMaxTokens || capability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS,
                          modelMaxThinkingTokens: prev.modelMaxThinkingTokens || capability.maxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS,
                        }))
                        setModelOptions((prev) => (
                          prev.includes(customModel)
                            ? prev
                            : [customModel, ...prev]
                        ))
                        setModelQuery('')
                      }}
                      style={{
                        minHeight: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '0 10px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        textAlign: 'left',
                      }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t('使用自定义模型').replace('{value}', modelQuery.trim())}
                      </span>
                    </button>
                  ) : null}
                </>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
                  {t('暂无可用模型')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
