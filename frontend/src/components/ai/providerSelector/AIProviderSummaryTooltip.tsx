import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import { getReasoningEffortLabel, type RectLike } from './providerSelectorTypes.ts';

export interface AIProviderSummaryTooltipProps {
  tooltipVisible: boolean;
  tooltipTriggerRect: RectLike | null;
  open: boolean;
  editingOpen: boolean;
  providerSummaryRows: Array<{ label: string; value: string }>;
}

export function AIProviderSummaryTooltip({
  tooltipVisible,
  tooltipTriggerRect,
  open,
  editingOpen,
  providerSummaryRows,
}: AIProviderSummaryTooltipProps) {
  if (!tooltipVisible || !tooltipTriggerRect || open || editingOpen) {
    return null;
  }

  const tooltipExpandLeft = tooltipTriggerRect.left + 280 > window.innerWidth - 16;

  return (
    <div
      className="fixed w-max py-2.5 px-3 rounded-lg border border-line bg-overlay shadow-xl grid gap-1.5 pointer-events-none"
      style={{
        ...(tooltipExpandLeft
          ? { right: Math.max(16, window.innerWidth - tooltipTriggerRect.right) }
          : { left: Math.max(16, tooltipTriggerRect.left) }),
        bottom: window.innerHeight - tooltipTriggerRect.top + 8,
        maxWidth: Math.max(180, (tooltipExpandLeft ? tooltipTriggerRect.right : window.innerWidth - tooltipTriggerRect.left) - 16),
        zIndex: Z.SEARCH_PANEL,
      }}
    >
      {providerSummaryRows.map((row) => (
        <div key={row.label} className="flex items-start gap-2 min-w-0">
          <span className="shrink-0 text-xs text-tertiary whitespace-nowrap">
            {row.label}
          </span>
          <span className="min-w-0 max-w-full text-[11.5px] text-primary leading-[1.45] [overflow-wrap:anywhere]">
            {row.value}
          </span>
        </div>
      ))}
      <div
        className={`absolute -bottom-1.5 w-2.5 h-2.5 border-r border-b border-line bg-overlay rotate-45 ${
          tooltipExpandLeft ? 'right-5' : 'left-5'
        }`}
      />
    </div>
  );
}

export interface AIProviderQuickModelMenuProps {
  modelMenuOpen: boolean;
  modelTriggerRect: RectLike | null;
  quickModelLoading: boolean;
  quickModelError: string;
  quickModelConfig: { options: string[]; currentValue: string };
  handleQuickModelSelect: (value: string) => Promise<void>;
}

export function AIProviderQuickModelMenu({
  modelMenuOpen,
  modelTriggerRect,
  quickModelLoading,
  quickModelError,
  quickModelConfig,
  handleQuickModelSelect,
}: AIProviderQuickModelMenuProps) {
  const { t } = useTranslation();

  if (!modelMenuOpen || !modelTriggerRect) {
    return null;
  }

  return (
    <div
      className="fixed min-w-[180px] max-w-[320px] max-h-[320px] p-1 rounded-lg border border-line bg-overlay shadow-xl grid gap-0.5 overflow-y-auto"
      style={{
        right: Math.max(16, window.innerWidth - modelTriggerRect.right),
        bottom: window.innerHeight - modelTriggerRect.top + 8,
        zIndex: Z.MENU,
      }}
    >
      {quickModelLoading ? (
        <div className="px-2.5 py-1.5 text-xs text-tertiary">
          {t('刷新中...')}
        </div>
      ) : null}
      {!quickModelLoading && quickModelError ? (
        <div className="px-2.5 py-1.5 text-xs text-danger leading-[1.4]">
          {quickModelError}
        </div>
      ) : null}
      {quickModelConfig.options.map((option) => {
        const active = option === quickModelConfig.currentValue;
        return (
          <button
            key={option}
            type="button"
            onClick={() => void handleQuickModelSelect(option)}
            className={`min-h-[30px] flex items-center justify-between gap-3 px-2.5 rounded-lg border-none text-left text-sm transition-colors duration-100 ${
              active ? 'bg-accent-dim text-primary font-bold' : 'bg-transparent text-secondary font-medium'
            }`}
          >
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{option}</span>
            {active ? <span className="text-accent text-sm">✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface AIProviderQuickReasoningMenuProps {
  reasoningMenuOpen: boolean;
  triggerRect: RectLike | null;
  quickReasoningConfig: { options: string[]; currentValue: string };
  handleQuickReasoningSelect: (value: string) => Promise<void>;
}

export function AIProviderQuickReasoningMenu({
  reasoningMenuOpen,
  triggerRect,
  quickReasoningConfig,
  handleQuickReasoningSelect,
}: AIProviderQuickReasoningMenuProps) {
  const { t } = useTranslation();

  if (!reasoningMenuOpen || !triggerRect) {
    return null;
  }

  return (
    <div
      className="fixed min-w-[92px] p-1 rounded-lg border border-line bg-overlay shadow-xl grid gap-0.5"
      style={{
        right: Math.max(16, window.innerWidth - triggerRect.right),
        bottom: window.innerHeight - triggerRect.top + 8,
        zIndex: Z.MENU,
      }}
    >
      {quickReasoningConfig.options.map((option) => {
        const active = option === quickReasoningConfig.currentValue;
        return (
          <button
            key={option}
            type="button"
            onClick={() => void handleQuickReasoningSelect(option)}
            className={`min-h-[30px] flex items-center justify-between gap-3 px-2.5 rounded-lg border-none text-left text-sm transition-colors duration-100 ${
              active ? 'bg-accent-dim text-primary font-bold' : 'bg-transparent text-secondary font-medium'
            }`}
          >
            <span>{getReasoningEffortLabel(t, option) || t('无')}</span>
            {active ? <span className="text-accent text-sm">✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}
