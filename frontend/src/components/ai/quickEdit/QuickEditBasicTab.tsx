import type React from 'react';
import { useTranslation, type I18nKey } from '../../../i18n.ts';
import { handleInputDragSelectAll } from '../inputDragSelect.ts';
import type { ModelCapabilityLike, ProviderDraft } from './quickEditTypes.ts';
import { SelectMenu, StyledCheckbox, type SelectMenuOption } from './QuickEditWidgets.tsx';
import QuickEditModelSection from './QuickEditModelSection.tsx';
import QuickEditReasoningSection from './QuickEditReasoningSection.tsx';
import QuickEditWebSearchSection, { type DedicatedProviderOption, type DedicatedProxyOption } from './QuickEditWebSearchSection.tsx';

export interface QuickEditBasicTabProps {
  active: boolean;
  draft: ProviderDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft>>;
  providerOptions: SelectMenuOption[];
  providerMenuOpen: boolean;
  setProviderMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleProviderSelect: (value: string) => void;
  providerFieldRef: React.RefObject<HTMLDivElement | null>;
  supportsPromptCacheSettings: boolean;
  providerDefinition: { value: string; getModelCapability: (model: string) => Record<string, unknown> };
  usePromptCacheRetention: boolean;
  activeModelPromptCachePolicy: { availableFormats?: Array<{ format: string; durations: string[] }> } | null;
  responsePromptCacheOptionsReady: boolean;
  promptCacheOptions: Array<{ value: string; labelKey: I18nKey }>;
  selectedPromptCacheStrategy: string;
  promptCacheOfficialSupport: string;
  supportsWebSearch: boolean;
  canValidateWebSearch: boolean;
  validatingWebSearch: boolean;
  webSearchValidationPassed: boolean;
  webSearchValidationMessage: string;
  handleWebSearchToggle: () => void;
  handleValidateWebSearch: () => void;
  dedicatedProviderFieldRef: React.RefObject<HTMLDivElement | null>;
  dedicatedProviderMenuOpen: boolean;
  setDedicatedProviderMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentDedicatedProviderOption: DedicatedProviderOption | null;
  dedicatedProviderSearch: string;
  setDedicatedProviderSearch: React.Dispatch<React.SetStateAction<string>>;
  filteredDedicatedProviderOptions: DedicatedProviderOption[];
  selectedWebSearchProviderValue: string;
  handleWebSearchProviderSelect: (value: string) => void;
  dedicatedProxyFieldRef: React.RefObject<HTMLDivElement | null>;
  proxyMenuOpen: boolean;
  setProxyMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentDedicatedProxyOption: DedicatedProxyOption | null;
  dedicatedProxyOptions: DedicatedProxyOption[];
  modelCapability: ModelCapabilityLike;
  effortReasoningOptions: string[];
  currentEffortReasoningSelection: string;
  resolvedMaxTokens: number;
  resolvedThinkingTokens: number;
  maxThinkingTokenLimit: number;
  modelRefreshing: boolean;
  modelRefreshError: string;
  handleRefreshModels: () => void;
  modelQuery: string;
  setModelQuery: React.Dispatch<React.SetStateAction<string>>;
  filteredModels: string[];
  setModelOptions: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function QuickEditBasicTab({
  active,
  draft,
  setDraft,
  providerOptions,
  providerMenuOpen,
  setProviderMenuOpen,
  handleProviderSelect,
  providerFieldRef,
  supportsPromptCacheSettings,
  providerDefinition,
  usePromptCacheRetention,
  activeModelPromptCachePolicy,
  responsePromptCacheOptionsReady,
  promptCacheOptions,
  selectedPromptCacheStrategy,
  promptCacheOfficialSupport,
  supportsWebSearch,
  canValidateWebSearch,
  validatingWebSearch,
  webSearchValidationPassed,
  webSearchValidationMessage,
  handleWebSearchToggle,
  handleValidateWebSearch,
  dedicatedProviderFieldRef,
  dedicatedProviderMenuOpen,
  setDedicatedProviderMenuOpen,
  currentDedicatedProviderOption,
  dedicatedProviderSearch,
  setDedicatedProviderSearch,
  filteredDedicatedProviderOptions,
  selectedWebSearchProviderValue,
  handleWebSearchProviderSelect,
  dedicatedProxyFieldRef,
  proxyMenuOpen,
  setProxyMenuOpen,
  currentDedicatedProxyOption,
  dedicatedProxyOptions,
  modelCapability,
  effortReasoningOptions,
  currentEffortReasoningSelection,
  resolvedMaxTokens,
  resolvedThinkingTokens,
  maxThinkingTokenLimit,
  modelRefreshing,
  modelRefreshError,
  handleRefreshModels,
  modelQuery,
  setModelQuery,
  filteredModels,
  setModelOptions,
}: QuickEditBasicTabProps) {
  const { t } = useTranslation();

  return (
    <div className={`${active ? 'grid' : 'hidden'} gap-1`}>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="grid gap-0.5">
          <label htmlFor="ai-provider-config-name" className="text-sm font-semibold text-primary">{t('配置文件')}</label>
          <input
            id="ai-provider-config-name"
            name="ai-provider-config-name"
            autoComplete="off"
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            onMouseLeave={handleInputDragSelectAll}
            placeholder={t('输入配置名')}
            className="h-[34px] w-full rounded-lg border border-line bg-sunken text-primary px-2.5 box-border outline-none"
          />
        </div>

        <div className="grid gap-0.5">
          <label id="ai-provider-select-label" htmlFor="ai-provider-select" className="text-sm font-semibold text-primary">{t('API提供商')}</label>
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
        <div className="grid gap-[3px]">
          <div className="flex items-center justify-between gap-2.5">
            <div className="text-sm font-semibold text-primary leading-[1.2]">{t('缓存策略')}</div>
            {providerDefinition.value === 'Responses' ? (
              <StyledCheckbox
                checked={usePromptCacheRetention}
                onChange={(nextUseRetention) => {
                  const nextFormat = nextUseRetention ? 'prompt_cache_retention' : 'prompt_cache_options';
                  const supportedDurations = activeModelPromptCachePolicy?.availableFormats
                    ?.find((option) => option.format === nextFormat)
                    ?.durations || [];
                  const supportedOptions = ['off', 'model', ...supportedDurations];
                  setDraft((prev) => ({
                    ...prev,
                    openAiResponsesUsePromptCacheRetention: nextUseRetention,
                    cacheStrategy: !responsePromptCacheOptionsReady || supportedOptions.includes(prev.cacheStrategy)
                      ? prev.cacheStrategy
                      : 'model',
                  }));
                }}>
                {usePromptCacheRetention ? `${t('当前格式')}:prompt_cache_retention` : `${t('当前格式')}:prompt_cache_options`}
              </StyledCheckbox>
            ) : null}
          </div>
          <div
            style={{ gridTemplateColumns: `repeat(${Math.max(promptCacheOptions.length, 1)}, minmax(0, 1fr))` }}
            className="grid border border-line rounded-lg overflow-hidden">
            {promptCacheOptions.map((option: { value: string; labelKey: I18nKey }, index: number) => {
              const selected = selectedPromptCacheStrategy === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, cacheStrategy: option.value }))}
                  className={`h-[34px] border-solid text-sm transition-colors duration-[120ms] ${index < promptCacheOptions.length - 1 ? 'border-y-0 border-l-0 border-r border-line-subtle' : 'border-0'} ${selected ? 'bg-[rgba(var(--accent-rgb),0.14)] text-primary font-bold' : 'bg-transparent text-secondary font-medium'}`}>
                  {t(option.labelKey as I18nKey)}
                </button>
              );
            })}
          </div>
          {promptCacheOfficialSupport ? (
            <div className="text-tertiary text-xs leading-[1.4] [overflow-wrap:anywhere]">
              {promptCacheOfficialSupport}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-0.5">
        <label htmlFor="ai-provider-base-url" className="text-sm font-semibold text-primary leading-[1.2]">{t('基础 URL')}</label>
        <input
          id="ai-provider-base-url"
          name="ai-provider-base-url"
          autoComplete="off"
          value={draft.baseUrl}
          onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
          onMouseLeave={handleInputDragSelectAll}
          placeholder="https://api.example.com/v1"
          className="h-[34px] w-full rounded-none border border-line bg-sunken text-primary px-2.5 box-border outline-none"
        />
      </div>

      <div className="grid gap-0.5">
        <div className="flex items-center gap-1.5">
          <label htmlFor="ai-provider-api-key" className="text-sm font-semibold text-primary leading-[1.2]">{t('API 密钥')}</label>
        </div>
        <input
          id="ai-provider-api-key"
          name="ai-provider-api-key"
          autoComplete="off"
          value={draft.apiKey}
          onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
          onMouseLeave={handleInputDragSelectAll}
          placeholder={t('输入 API Key')}
          className="h-[34px] w-full rounded-none border border-line bg-sunken text-primary px-2.5 box-border outline-none"
        />
      </div>

      <QuickEditWebSearchSection
        draft={draft}
        setDraft={setDraft}
        supportsWebSearch={supportsWebSearch}
        canValidateWebSearch={canValidateWebSearch}
        validatingWebSearch={validatingWebSearch}
        webSearchValidationPassed={webSearchValidationPassed}
        webSearchValidationMessage={webSearchValidationMessage}
        handleWebSearchToggle={handleWebSearchToggle}
        handleValidateWebSearch={handleValidateWebSearch}
        dedicatedProviderFieldRef={dedicatedProviderFieldRef}
        dedicatedProviderMenuOpen={dedicatedProviderMenuOpen}
        setDedicatedProviderMenuOpen={setDedicatedProviderMenuOpen}
        currentDedicatedProviderOption={currentDedicatedProviderOption}
        dedicatedProviderSearch={dedicatedProviderSearch}
        setDedicatedProviderSearch={setDedicatedProviderSearch}
        filteredDedicatedProviderOptions={filteredDedicatedProviderOptions}
        selectedWebSearchProviderValue={selectedWebSearchProviderValue}
        handleWebSearchProviderSelect={handleWebSearchProviderSelect}
        dedicatedProxyFieldRef={dedicatedProxyFieldRef}
        proxyMenuOpen={proxyMenuOpen}
        setProxyMenuOpen={setProxyMenuOpen}
        currentDedicatedProxyOption={currentDedicatedProxyOption}
        dedicatedProxyOptions={dedicatedProxyOptions}
      />

      <QuickEditReasoningSection
        draft={draft}
        setDraft={setDraft}
        modelCapability={modelCapability}
        effortReasoningOptions={effortReasoningOptions}
        currentEffortReasoningSelection={currentEffortReasoningSelection}
        resolvedMaxTokens={resolvedMaxTokens}
        resolvedThinkingTokens={resolvedThinkingTokens}
        maxThinkingTokenLimit={maxThinkingTokenLimit}
      />

      <QuickEditModelSection
        draft={draft}
        setDraft={setDraft}
        modelRefreshing={modelRefreshing}
        modelRefreshError={modelRefreshError}
        handleRefreshModels={handleRefreshModels}
        modelQuery={modelQuery}
        setModelQuery={setModelQuery}
        filteredModels={filteredModels}
        setModelOptions={setModelOptions}
        providerDefinition={providerDefinition}
      />
    </div>
  );
}
