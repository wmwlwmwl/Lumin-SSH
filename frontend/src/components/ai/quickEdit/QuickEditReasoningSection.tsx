import type React from 'react';
import { useTranslation } from '../../../i18n.ts';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  getReasoningOptionLabel,
  type ModelCapabilityLike,
  type ProviderDraft,
} from './quickEditTypes.ts';

export interface QuickEditReasoningSectionProps {
  draft: ProviderDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft>>;
  modelCapability: ModelCapabilityLike;
  effortReasoningOptions: string[];
  currentEffortReasoningSelection: string;
  resolvedMaxTokens: number;
  resolvedThinkingTokens: number;
  maxThinkingTokenLimit: number;
}

export default function QuickEditReasoningSection({
  draft,
  setDraft,
  modelCapability,
  effortReasoningOptions,
  currentEffortReasoningSelection,
  resolvedMaxTokens,
  resolvedThinkingTokens,
  maxThinkingTokenLimit,
}: QuickEditReasoningSectionProps) {
  const { t } = useTranslation();

  const renderBudgetSection = () => {
    const budgetEnabled = modelCapability.requiredReasoningBudget || draft.enableReasoningEffort;
    return (
      <div className="grid gap-2">
        {!modelCapability.requiredReasoningBudget ? (
          <div className="flex items-center justify-between gap-2.5 py-2.5 px-3 border border-line rounded-xl bg-overlay">
            <span className="text-sm text-primary font-semibold">{t('启用推理')}</span>
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, enableReasoningEffort: !prev.enableReasoningEffort }))}
              className={`w-[34px] h-5 rounded-full border border-line p-0.5 relative transition-colors duration-[120ms] ${draft.enableReasoningEffort ? 'bg-[rgba(var(--accent-rgb),0.52)]' : 'bg-hover'}`}>
              <span
                className="block w-3.5 h-3.5 rounded-full bg-raised"
                style={{ transform: draft.enableReasoningEffort ? 'translateX(14px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        ) : null}

        {budgetEnabled ? (
          <div className="grid gap-2.5 px-3 pt-3 pb-3.5 border border-line rounded-xl bg-overlay">
            <div className="grid gap-1">
              <div className="text-sm font-semibold text-primary">{t('最大输出 Token')}</div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2.5">
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
                <div className="min-w-[56px] text-right text-sm text-secondary">
                  {resolvedMaxTokens}
                </div>
              </div>
            </div>

            <div className="grid gap-1">
              <div className="text-sm font-semibold text-primary">{t('思考 Token 预算')}</div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-2.5">
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
                <div className="min-w-[56px] text-right text-sm text-secondary">
                  {resolvedThinkingTokens}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  switch (modelCapability.reasoningMode) {
    case 'binary':
      return (
        <div className="flex items-center justify-between gap-2.5 py-2.5 px-3 border border-line rounded-xl bg-overlay">
          <span className="text-sm text-primary font-semibold">{t('启用推理')}</span>
          <button
            type="button"
            onClick={() => setDraft((prev) => ({ ...prev, enableReasoningEffort: !prev.enableReasoningEffort }))}
            className={`w-[34px] h-5 rounded-full border border-line p-0.5 relative transition-colors duration-[120ms] ${draft.enableReasoningEffort ? 'bg-[rgba(var(--accent-rgb),0.52)]' : 'bg-hover'}`}>
            <span
              className="block w-3.5 h-3.5 rounded-full bg-raised"
              style={{ transform: draft.enableReasoningEffort ? 'translateX(14px)' : 'translateX(0)' }}
            />
          </button>
        </div>
      );
    case 'budget':
      return renderBudgetSection();
    case 'effort':
      return (
        <div className="grid gap-2.5">
          <div className="grid gap-[3px]">
            <div className="text-sm font-semibold text-primary">{t('思考深度')}</div>
            <div className="flex items-center gap-[18px] flex-wrap">
              {effortReasoningOptions.map((option) => {
                const active = currentEffortReasoningSelection === option;
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
                        }));
                        return;
                      }
                      setDraft((prev) => ({
                        ...prev,
                        reasoningEffort: option,
                        enableReasoningEffort: true,
                      }));
                    }}
                    className={`inline-flex items-center gap-2 border-none bg-transparent p-0 text-sm ${active ? 'text-primary font-bold' : 'text-secondary font-medium'}`}>
                    <span
                      className={`inline-flex items-center justify-center w-4 h-4 rounded-full box-border border ${active ? 'border-[rgba(var(--accent-rgb),0.65)] bg-[rgba(var(--accent-rgb),0.18)]' : 'border-line bg-transparent'}`}>
                      {active ? <span className="block w-2 h-2 rounded-full bg-accent" /> : null}
                    </span>
                    <span>{getReasoningOptionLabel(option)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {draft.provider === 'Messages' ? (
            <div className="flex items-center justify-between gap-2.5 py-2.5 px-3 border border-line rounded-xl bg-overlay">
              <div className="min-w-0 grid gap-0.5">
                <div className="text-sm text-primary font-semibold">{t('旧推理格式')}</div>
                <div className="text-xs text-tertiary leading-[1.4]">{t('为 Messages 使用旧式 thinking budget 负载，而不是 adaptive effort。')}</div>
              </div>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, openAiLegacyReasoningFormatEnabled: !prev.openAiLegacyReasoningFormatEnabled }))}
                className={`w-[34px] h-5 shrink-0 rounded-full border border-line p-0.5 relative transition-colors duration-[120ms] ${draft.openAiLegacyReasoningFormatEnabled ? 'bg-[rgba(var(--accent-rgb),0.52)]' : 'bg-hover'}`}>
                <span
                  className="block w-3.5 h-3.5 rounded-full bg-raised"
                  style={{ transform: draft.openAiLegacyReasoningFormatEnabled ? 'translateX(14px)' : 'translateX(0)' }}
                />
              </button>
            </div>
          ) : null}
        </div>
      );
    default:
      return null;
  }
}
