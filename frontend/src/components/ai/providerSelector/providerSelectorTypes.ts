import { getLanguage, type I18nKey } from '../../../i18n.ts';
import { getAIProviderDefinition } from '../providers/index.ts';
import { isCallMyVipProviderHost } from '../providerSpecialHosts.ts';

export interface AIProviderLike {
  id?: string;
  name?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  pinned?: boolean;
  cacheStrategy?: string;
  openAiResponsesUsePromptCacheRetention?: boolean;
  modelTemperature?: number | null;
  modelTopP?: number | null;
  reasoningEffort?: string;
  enableReasoningEffort?: boolean;
  dedicatedProxyEnabled?: boolean;
  dedicatedProxyId?: string;
  webSearchEnabled?: boolean;
  dedicatedWebSearchEnabled?: boolean;
  dedicatedWebSearchProviderId?: string;
  modelMaxTokens?: number;
  modelMaxThinkingTokens?: number;
  updatedAt?: number;
  description?: string;
  [key: string]: unknown;
}

export interface RectLike {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface AppBridgeShape {
  RequestAIProviderModelsWithProfile?: (payload: string) => Promise<unknown>;
  RequestAIProviderModels?: (baseUrl: string, apiKey: string) => Promise<unknown>;
}

export const defaultProviders: AIProviderLike[] = [];
export const summaryTooltipDelay = 300;

export const cacheStrategyLabelKeys: Record<string, I18nKey> = {
  model: '基于模型能力',
  off: '强制关闭',
  '5m': '5分钟',
  '1h': '1小时',
  '30m': '30分钟',
  in_memory: '内存缓存',
  '24h': '24小时',
};

export const reasoningEffortLabelKeys: Record<string, I18nKey> = {
  none: '无',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
};

export const DEFAULT_EFFORT_REASONING_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const adaptiveLabelCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

export function getAppBridge(): AppBridgeShape | null {
  return (window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.AIProviderBindings || window?.go?.wailsapp?.App) as AppBridgeShape | null;
}

export function getCacheStrategyLabel(t: (key: I18nKey) => string, value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : '';
  return t(cacheStrategyLabelKeys[nextValue] || cacheStrategyLabelKeys.model);
}

export function getReasoningEffortLabel(t: (key: I18nKey) => string, value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!nextValue || nextValue === 'disable') {
    return '';
  }
  return t((reasoningEffortLabelKeys[nextValue] || nextValue) as I18nKey);
}

export function supportsUnifiedEffortReasoning(providerValue: string) {
  return providerValue === 'Compatible' || providerValue === 'Responses' || providerValue === 'Messages';
}

export function buildDisplayModelCapability(providerValue: string, capability: Record<string, unknown> | null | undefined) {
  if (!supportsUnifiedEffortReasoning(providerValue)) {
    return capability || {};
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
  };
}

export function buildReasoningOptions(capability: Record<string, unknown> | null | undefined) {
  if (capability?.reasoningMode !== 'effort') {
    return [];
  }
  const supportedValues = Array.isArray(capability?.supportsReasoningEffort)
    ? capability.supportsReasoningEffort
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim().toLowerCase())
    : [];
  const nextOptions = capability?.requiredReasoningEffort
    ? supportedValues
    : ['disable', ...supportedValues.filter((value) => value !== 'disable')];
  return [...new Set(nextOptions)];
}

export function getProviderModelSummary(t: (key: I18nKey) => string, provider: AIProviderLike | null | undefined) {
  const model = typeof provider?.model === 'string' ? provider.model.trim() : '';
  if (!model) {
    return t('未选择模型');
  }
  const reasoningEffortLabel = getReasoningEffortLabel(t, provider?.reasoningEffort);
  if (!reasoningEffortLabel || provider?.enableReasoningEffort !== true) {
    return model;
  }
  return `${model}(${reasoningEffortLabel})`;
}

export function measureAdaptiveLabelWidth(text: string, fontSize: number, fontWeight = 500, fontFamily = 'sans-serif') {
  const content = typeof text === 'string' ? text.trim() : '';
  if (!content) {
    return 0;
  }
  const context = adaptiveLabelCanvas?.getContext('2d');
  if (!context) {
    return content.length * fontSize;
  }
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return context.measureText(content).width;
}

export function measureAdaptiveLabelTriggerWidth(text: string, fontSize: number, {
  fontWeight = 500,
  fontFamily = 'sans-serif',
  horizontalPadding = 20,
  minWidth = 36,
}: {
  fontWeight?: number;
  fontFamily?: string;
  horizontalPadding?: number;
  minWidth?: number;
} = {}) {
  const contentWidth = measureAdaptiveLabelWidth(text, fontSize, fontWeight, fontFamily);
  if (contentWidth <= 0) {
    return minWidth;
  }
  return Math.max(minWidth, Math.ceil(contentWidth + horizontalPadding));
}

export function resolveAdaptiveLabelLayout({
  providerText,
  modelText,
  availableWidth,
  providerFontFamily = 'sans-serif',
  modelFontFamily = 'sans-serif',
  fixedWidth = 0,
  baseFontSize = 12,
  minFontSize = 9,
}: {
  providerText?: string;
  modelText?: string;
  availableWidth?: number;
  providerFontFamily?: string;
  modelFontFamily?: string;
  fixedWidth?: number;
  baseFontSize?: number;
  minFontSize?: number;
} = {}) {
  const normalizedProviderText = typeof providerText === 'string' ? providerText.trim() : '';
  const normalizedModelText = typeof modelText === 'string' ? modelText.trim() : '';
  const normalizedAvailableWidth = typeof availableWidth === 'number' && Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 0;
  const sizeOptions: number[] = [];
  for (let size = baseFontSize; size >= minFontSize; size -= 1) {
    sizeOptions.push(size);
  }
  const modelSizeOptions = normalizedModelText ? sizeOptions : [baseFontSize];
  let bestLayout: { providerFontSize: number; modelFontSize: number; providerWidth: number; modelWidth: number; totalWidth: number } | null = null;
  for (const providerFontSize of sizeOptions) {
    for (const modelFontSize of modelSizeOptions) {
      const providerWidth = measureAdaptiveLabelTriggerWidth(normalizedProviderText, providerFontSize, {
        fontWeight: 500,
        fontFamily: providerFontFamily,
      });
      const modelWidth = normalizedModelText
        ? measureAdaptiveLabelTriggerWidth(normalizedModelText, modelFontSize, {
            fontWeight: 600,
            fontFamily: modelFontFamily,
            minWidth: 32,
          })
        : 0;
      const totalWidth = providerWidth + modelWidth + fixedWidth;
      if (normalizedAvailableWidth > 0 && totalWidth > normalizedAvailableWidth) {
        continue;
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
        };
      }
    }
  }
  if (bestLayout) {
    return bestLayout;
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
  };
}

export function resolveAdaptiveSelectorAvailableWidth(container: HTMLElement | null) {
  const row = container?.parentElement;
  if (!container || !row) {
    return container?.clientWidth || 0;
  }
  const computedStyle = window.getComputedStyle(row);
  const gap = Number.parseFloat(computedStyle.columnGap || computedStyle.gap || '0') || 0;
  const children = Array.from(row.children);
  const siblingsWidth = children
    .filter((child) => child !== container)
    .reduce((total, child) => total + child.getBoundingClientRect().width, 0);
  const totalGap = gap * Math.max(0, children.length - 1);
  return Math.max(0, Math.max(container.clientWidth, row.clientWidth - siblingsWidth - totalGap));
}

export function buildProviderModelOptions(provider: AIProviderLike | null | undefined) {
  const providerValue = typeof provider?.provider === 'string' && provider.provider.trim() ? provider.provider.trim() : 'Compatible';
  const providerDefinition = getAIProviderDefinition(providerValue);
  const seen = new Set<string>();
  const options: string[] = [];
  const appendOption = (value: unknown) => {
    const nextValue = typeof value === 'string' ? value.trim() : '';
    if (!nextValue || seen.has(nextValue)) {
      return;
    }
    seen.add(nextValue);
    options.push(nextValue);
  };
  appendOption(provider?.model);
  (Array.isArray(providerDefinition?.initialModels) ? providerDefinition.initialModels : []).forEach(appendOption);
  appendOption(providerDefinition?.defaultModel);
  return options;
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

export function getApiKeyPreview(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : '';
  if (!nextValue) {
    return '';
  }
  return nextValue.length <= 12 ? nextValue : nextValue.slice(-12);
}

export function buildProviderCopyName(t: (key: I18nKey) => string, provider: AIProviderLike | null | undefined) {
  const baseName = typeof provider?.name === 'string' && provider.name.trim() ? provider.name.trim() : t('未命名供应商');
  return `${baseName}${t('副本')}`;
}

export function sortProviders(items: AIProviderLike[]) {
  const locale = getLanguage() || 'zh-CN';
  return [...items].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), locale);
  });
}

export function resolveAIProviderBaseOrigin(value: unknown) {
  const rawBaseURL = typeof value === 'string' ? value.trim() : '';
  if (!rawBaseURL) {
    return '';
  }
  const candidates = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawBaseURL) ? [rawBaseURL] : [rawBaseURL, `https://${rawBaseURL}`];
  for (const candidate of candidates) {
    try {
      return new URL(candidate).origin;
    } catch {}
  }
  return '';
}

export function isAIProviderBalanceLabelEnabled(provider: AIProviderLike | null | undefined) {
  return isCallMyVipProviderHost(provider?.baseUrl);
}

export function normalizeAIProviderBalanceValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return '';
}

export function stripAIProviderBalanceCurrencyPrefix(value: unknown) {
  const normalizedValue = normalizeAIProviderBalanceValue(value);
  if (!normalizedValue) {
    return '';
  }
  return normalizedValue.replace(/^[\s$¥￥]+/, '').trim();
}

export function formatAIProviderBalanceLabel(value: unknown) {
  const normalizedValue = stripAIProviderBalanceCurrencyPrefix(value);
  if (!normalizedValue) {
    return '¥--';
  }
  return `¥${normalizedValue}`;
}

export function parseAIProviderBalanceNumber(value: unknown) {
  const normalizedValue = stripAIProviderBalanceCurrencyPrefix(value).replace(/,/g, '');
  if (!normalizedValue) {
    return null;
  }
  const parsedValue = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function formatAIProviderBalanceDeltaLabel(value: number) {
  if (!Number.isFinite(value) || value === 0) {
    return '';
  }
  const sign = value > 0 ? '+' : '-';
  const absValue = Math.abs(value);
  const formattedValue = absValue >= 1000
    ? absValue.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : absValue.toFixed(absValue >= 100 ? 0 : (absValue >= 1 ? 2 : 4)).replace(/\.?0+$/u, '');
  return `${sign}${formattedValue}`;
}

export function extractAIProviderBalanceValue(payload: unknown) {
  if (typeof payload === 'string' && payload.trim()) {
    try {
      return extractAIProviderBalanceValue(JSON.parse(payload));
    } catch {
      return normalizeAIProviderBalanceValue(payload);
    }
  }
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const payloadRecord = payload as Record<string, unknown>;
  const candidates = [
    payloadRecord.display_balance,
    (payloadRecord.data as Record<string, unknown> | undefined)?.display_balance,
    (payloadRecord.user as Record<string, unknown> | undefined)?.display_balance,
    ((payloadRecord.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined)?.display_balance,
    payloadRecord.quota,
    (payloadRecord.data as Record<string, unknown> | undefined)?.quota,
    (payloadRecord.user as Record<string, unknown> | undefined)?.quota,
    ((payloadRecord.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined)?.quota,
  ];
  for (const candidate of candidates) {
    const normalizedValue = normalizeAIProviderBalanceValue(candidate);
    if (normalizedValue) {
      return normalizedValue;
    }
  }
  return '';
}
