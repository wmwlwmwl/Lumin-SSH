import type React from 'react';
import { useTranslation } from '../../../i18n.ts';
import { handleInputDragSelectAll } from '../inputDragSelect.ts';
import {
  buildDisplayModelCapability,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_THINKING_TOKENS,
  type ProviderDraft,
} from './quickEditTypes.ts';

export interface QuickEditModelSectionProps {
  draft: ProviderDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft>>;
  modelRefreshing: boolean;
  modelRefreshError: string;
  handleRefreshModels: () => void;
  modelQuery: string;
  setModelQuery: React.Dispatch<React.SetStateAction<string>>;
  filteredModels: string[];
  setModelOptions: React.Dispatch<React.SetStateAction<string[]>>;
  providerDefinition: { getModelCapability: (model: string) => Record<string, unknown> };
}

export default function QuickEditModelSection({
  draft,
  setDraft,
  modelRefreshing,
  modelRefreshError,
  handleRefreshModels,
  modelQuery,
  setModelQuery,
  filteredModels,
  setModelOptions,
  providerDefinition,
}: QuickEditModelSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2.5">
        <label htmlFor="ai-provider-model-query" className="text-sm font-semibold text-primary">{t('模型')}</label>
        <button
          type="button"
          onClick={handleRefreshModels}
          disabled={modelRefreshing}
          style={{ opacity: modelRefreshing ? 0.7 : 1 }}
          className={`border-none bg-transparent text-sm p-0 ${modelRefreshing ? 'text-muted' : 'text-tertiary'}`}>
          {modelRefreshing ? t('刷新中...') : t('刷新模型')}
        </button>
      </div>

      {modelRefreshError ? (
        <div
          role="alert"
          className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2 py-[7px] px-[9px] border border-[rgba(var(--danger-rgb),0.28)] rounded-lg bg-danger-dim text-danger">
          <span
            aria-hidden="true"
            className="w-[18px] h-[18px] inline-flex items-center justify-center rounded-full bg-[rgba(var(--danger-rgb),0.16)] text-sm font-extrabold leading-none">
            !
          </span>
          <div className="min-w-0 grid gap-0.5">
            <div className="text-xs font-bold leading-[1.3]">{t('刷新模型失败')}</div>
            <div className="text-secondary font-mono text-[10px] leading-[1.45] [overflow-wrap:anywhere] select-text">
              {modelRefreshError}
            </div>
          </div>
        </div>
      ) : null}

      <input
        id="ai-provider-model-query"
        name="ai-provider-model-query"
        autoComplete="off"
        value={modelQuery}
        onChange={(event) => setModelQuery(event.target.value)}
        onMouseLeave={handleInputDragSelectAll}
        placeholder={t('筛选模型或输入以指定模型')}
        className="h-[34px] w-full rounded-none border border-line bg-sunken text-primary px-2.5 box-border outline-none"
      />

      <div className="min-h-[200px] border border-line bg-canvas flex flex-col">
        {filteredModels.length > 0 || modelQuery.trim() ? (
          <>
            {filteredModels.map((item) => {
              const active = draft.model === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    const capability = buildDisplayModelCapability(draft.provider, providerDefinition.getModelCapability(item));
                    setDraft((prev) => ({
                      ...prev,
                      model: item,
                      reasoningEffort: prev.reasoningEffort || (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : '') || 'disable',
                      modelMaxTokens: prev.modelMaxTokens || capability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS,
                      modelMaxThinkingTokens: prev.modelMaxThinkingTokens || capability.maxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS,
                    }));
                    setModelQuery('');
                  }}
                  className={`min-h-8 flex items-center justify-between gap-3 px-2.5 border-solid border-x-0 border-t-0 border-b border-line-subtle text-left ${active ? 'bg-[rgba(var(--accent-rgb),0.10)] text-primary' : 'bg-transparent text-secondary'}`}>
                  <span className="whitespace-nowrap overflow-hidden text-ellipsis">{item}</span>
                  {active ? <span className="text-accent text-sm">✓</span> : null}
                </button>
              );
            })}
            {modelQuery.trim() ? (
              <button
                type="button"
                onClick={() => {
                  const customModel = modelQuery.trim();
                  const capability = buildDisplayModelCapability(draft.provider, providerDefinition.getModelCapability(customModel));
                  setDraft((prev) => ({
                    ...prev,
                    model: customModel,
                    reasoningEffort: prev.reasoningEffort || (typeof capability.reasoningEffort === 'string' ? capability.reasoningEffort : '') || 'disable',
                    modelMaxTokens: prev.modelMaxTokens || capability.maxTokens || DEFAULT_MAX_OUTPUT_TOKENS,
                    modelMaxThinkingTokens: prev.modelMaxThinkingTokens || capability.maxThinkingTokens || DEFAULT_MAX_THINKING_TOKENS,
                  }));
                  setModelOptions((prev) => (
                    prev.includes(customModel)
                      ? prev
                      : [customModel, ...prev]
                  ));
                  setModelQuery('');
                }}
                className="min-h-8 flex items-center justify-between gap-3 px-2.5 border-none bg-transparent text-primary text-left cursor-pointer">
                <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                  {t('使用自定义模型').replace('{value}', modelQuery.trim())}
                </span>
              </button>
            ) : null}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-tertiary text-md">
            {t('暂无可用模型')}
          </div>
        )}
      </div>
    </div>
  );
}
