import { t as translate, type I18nKey } from '../../../i18n.ts';
import { getAIProviderDefinition } from '../providers/index.ts';
import type { AIProviderLike } from '../AIProviderSelector.tsx';

export const defaultCacheOptions: Array<{ value: string; labelKey: I18nKey }> = [
  { value: 'model', labelKey: '基于模型能力' },
  { value: 'off', labelKey: '强制关闭' },
  { value: '5m', labelKey: '5分钟' },
  { value: '1h', labelKey: '1小时' },
];

export const reasoningEffortLabels: Record<string, I18nKey> = {
  disable: '无',
  none: '无',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
};

export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
export const DEFAULT_MAX_THINKING_TOKENS = 8192;
export const DEFAULT_EFFORT_REASONING_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const providerHighlightLabelKeys: Record<string, I18nKey> = {
  Compatible: '高兼容',
  Responses: '高缓存',
};

export const selfWebSearchProviderValue = '__self__';

export const responsePromptCacheStrategyLabelKeys: Record<string, I18nKey> = {
  off: '强制关闭',
  model: '基于模型能力',
  '30m': '30分钟',
  in_memory: '内存缓存',
  '24h': '24小时',
};

export function getProviderDisplayLabel(provider: { value?: string; label?: string } | null | undefined, t: (key: I18nKey) => string) {
  if (!provider || typeof provider !== 'object') {
    return '';
  }
  const providerValue = typeof provider.value === 'string' ? provider.value : '';
  const highlightLabelKey = providerValue ? providerHighlightLabelKeys[providerValue] : undefined;
  if (!highlightLabelKey) {
    return provider.label || '';
  }
  return `(${t(highlightLabelKey as I18nKey)})${provider.label || ''}`;
}

export function getAppBridge() {
  return window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.AIProviderBindings || window?.go?.wailsapp?.App;
}

export function normalizePositiveInteger(value: unknown, fallback = 0) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    return fallback;
  }
  return Math.floor(nextValue);
}

export function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
}

export function buildInitialModelOptions(providerDefinition: unknown, model: string) {
  const trimmedModel = typeof model === 'string' ? model.trim() : '';
  const initialModels = Array.isArray((providerDefinition as Record<string, unknown> | null)?.initialModels)
    ? (providerDefinition as Record<string, unknown>).initialModels
    : [];
  const options: string[] = [...(initialModels as string[])];
  if (trimmedModel && !options.includes(trimmedModel)) {
    options.unshift(trimmedModel);
  }
  return options;
}

export function buildReasoningOptionsForCapability(capability: Record<string, unknown> | null | undefined) {
  if (capability?.reasoningMode !== 'effort') {
    return [];
  }
  const supportedValues = Array.isArray(capability?.supportsReasoningEffort)
    ? capability.supportsReasoningEffort.filter((value) => typeof value === 'string' && value.trim())
    : [];
  const nextOptions = capability?.requiredReasoningEffort
    ? supportedValues
    : ['disable', ...supportedValues.filter((value) => value !== 'disable')];
  return [...new Set(nextOptions)];
}

export function getReasoningOptionLabel(value: string) {
  const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return translate((reasoningEffortLabels[nextValue] || nextValue || '无') as I18nKey);
}

export function supportsUnifiedEffortReasoning(providerValue: string) {
  return providerValue === 'Compatible' || providerValue === 'Responses' || providerValue === 'Messages';
}

export interface ModelCapabilityLike {
  modelId?: string;
  reasoningMode?: string;
  reasoningEffort?: string;
  supportsReasoningEffort?: string[];
  maxTokens?: number;
  maxThinkingTokens?: number;
  requiredReasoningBudget?: boolean;
  requiredReasoningEffort?: boolean;
  [key: string]: unknown;
}

export function buildDisplayModelCapability(providerValue: string, capability: ModelCapabilityLike): ModelCapabilityLike {
  if (!supportsUnifiedEffortReasoning(providerValue)) {
    return capability;
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
  };
}

export interface ProviderDraft {
  id: string;
  name: string;
  provider: string;
  cacheStrategy: string;
  openAiResponsesUsePromptCacheRetention: boolean;
  modelTemperature: number | null;
  modelTopP: number | null;
  baseUrl: string;
  apiKey: string;
  model: string;
  webSearchEnabled: boolean;
  dedicatedWebSearchEnabled: boolean;
  dedicatedWebSearchProviderId: string;
  dedicatedProxyEnabled: boolean;
  dedicatedProxyId: string;
  reasoningEffort: string;
  enableReasoningEffort: boolean;
  openAiLegacyReasoningFormatEnabled: boolean;
  modelMaxTokens: number;
  modelMaxThinkingTokens: number;
  pinned: boolean;
}

export function resolveEffortReasoningSelection(draft: ProviderDraft | Record<string, unknown>, capability: Record<string, unknown> | null | undefined) {
  if (capability?.reasoningMode !== 'effort') {
    return 'disable';
  }
  const availableOptions = buildReasoningOptionsForCapability(capability);
  const storedValue = typeof (draft as Record<string, unknown>).reasoningEffort === 'string' ? String((draft as Record<string, unknown>).reasoningEffort).trim().toLowerCase() : '';

  if (capability?.requiredReasoningEffort) {
    if (storedValue && availableOptions.includes(storedValue)) {
      return storedValue;
    }
    return typeof capability?.reasoningEffort === 'string' ? capability.reasoningEffort : (availableOptions[0] || 'high');
  }

  if ((draft as Record<string, unknown>).enableReasoningEffort === false) {
    return 'disable';
  }

  if (storedValue && availableOptions.includes(storedValue)) {
    return storedValue;
  }

  return storedValue || 'disable';
}

export function buildDraft(provider?: AIProviderLike | null): ProviderDraft {
  const providerDefinition = getAIProviderDefinition(provider?.provider || 'Compatible');
  const resolvedModel = typeof provider?.model === 'string' && provider.model.trim()
    ? provider.model.trim()
    : '';
  const capability = providerDefinition.getModelCapability(resolvedModel);

  return {
    id: typeof provider?.id === 'string' && provider.id.trim() ? provider.id.trim() : '',
    name: typeof provider?.name === 'string' ? provider.name : '',
    provider: providerDefinition.value,
    cacheStrategy: typeof provider?.cacheStrategy === 'string' && provider.cacheStrategy.trim()
      ? provider.cacheStrategy.trim()
      : (providerDefinition.value === 'Responses' ? 'model' : '5m'),
    openAiResponsesUsePromptCacheRetention: provider?.openAiResponsesUsePromptCacheRetention === true,
    modelTemperature: normalizeOptionalNumber(provider?.modelTemperature),
    modelTopP: normalizeOptionalNumber(provider?.modelTopP),
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
  };
}
