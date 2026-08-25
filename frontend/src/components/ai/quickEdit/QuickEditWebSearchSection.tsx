import { Check, CircleHelp, Globe, Search } from 'lucide-react';
import type React from 'react';
import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import { handleInputDragSelectAll } from '../inputDragSelect.ts';
import type { ProviderDraft } from './quickEditTypes.ts';

export interface DedicatedProviderOption {
  value: string;
  label: string;
}

export interface DedicatedProxyOption {
  value: string;
  label: string;
}

export interface QuickEditWebSearchSectionProps {
  draft: ProviderDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft>>;
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
}

export default function QuickEditWebSearchSection({
  draft,
  setDraft,
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
}: QuickEditWebSearchSectionProps) {
  const { t } = useTranslation();

  const validationButtonVariant = webSearchValidationMessage
    ? (webSearchValidationPassed ? 'success' : 'error')
    : 'default';

  return (
    <>
      {supportsWebSearch ? (
        <div className="grid py-2.5 px-3 border border-line rounded-xl bg-overlay">
          <div className="grid grid-cols-[1fr_auto] items-start gap-2">
            <div className="flex items-center justify-between gap-2.5 min-h-8">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-[rgba(var(--accent-rgb),0.12)] text-accent shrink-0">
                  <Globe size={14} />
                </div>
                <div className="min-w-0 grid gap-px">
                  <div className="text-base font-semibold text-primary">{t('联网搜索')}</div>
                  <div className="text-xs text-tertiary leading-[1.2]">{t('启用后通过所选供应商执行联网搜索')}</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <CircleHelp size={14} color="var(--text-tertiary)" />
                <button
                  type="button"
                  onClick={handleWebSearchToggle}
                  className={`w-[34px] h-5 rounded-full border border-line p-0.5 relative transition-colors duration-[120ms] ${draft.webSearchEnabled ? 'bg-[rgba(var(--accent-rgb),0.52)]' : 'bg-hover'}`}>
                  <span
                    className="block w-3.5 h-3.5 rounded-full bg-raised"
                    style={{ transform: draft.webSearchEnabled ? 'translateX(14px)' : 'translateX(0)' }}
                  />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleValidateWebSearch}
              disabled={!canValidateWebSearch || validatingWebSearch}
              style={{ opacity: canValidateWebSearch ? 1 : 0.6 }}
              className={`min-w-[74px] min-h-10 px-2.5 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-1.5 ${validationButtonVariant === 'success'
                ? 'border-[rgba(var(--success-rgb),0.35)] bg-[rgba(var(--success-rgb),0.10)] text-success'
                : validationButtonVariant === 'error'
                  ? 'border-[rgba(var(--danger-rgb),0.30)] bg-[rgba(var(--danger-rgb),0.08)] text-danger'
                  : !canValidateWebSearch
                    ? 'border-line bg-canvas text-tertiary'
                    : 'border-line bg-canvas text-primary'}`}>
              {validatingWebSearch ? t('验证中...') : (
                <>
                  {webSearchValidationPassed ? <Check size={13} /> : null}
                  <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {webSearchValidationMessage || t('验证')}
                  </span>
                </>
              )}
            </button>
          </div>

          <div className="grid gap-1.5 pt-2 border-t border-line-subtle">
            <div ref={dedicatedProviderFieldRef} className="relative min-w-0">
              <button
                type="button"
                disabled={!draft.webSearchEnabled}
                onClick={() => {
                  if (!draft.webSearchEnabled) {
                    return;
                  }
                  setDedicatedProviderMenuOpen((prev) => !prev);
                }}
                style={{ opacity: draft.webSearchEnabled ? 1 : 0.6 }}
                className={`h-[30px] w-full flex items-center justify-between gap-2 px-2.5 rounded-full box-border border text-sm text-secondary transition-[color,background-color,border-color] duration-[120ms] ${dedicatedProviderMenuOpen ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)]' : 'border-line bg-canvas'} ${draft.webSearchEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                <span className="min-w-0 truncate">
                  {currentDedicatedProviderOption?.label || t('自身')}
                </span>
                <span className={`text-tertiary text-[10px] ${dedicatedProviderMenuOpen ? 'rotate-180' : 'rotate-0'}`}>▾</span>
              </button>
              {dedicatedProviderMenuOpen && draft.webSearchEnabled ? (
                <div
                  style={{ zIndex: Z.POPUP }}
                  className="absolute right-0 top-[calc(100%_+_8px)] w-[320px] max-w-[min(100%,320px)] max-h-[320px] rounded-none border border-accent-border bg-overlay shadow-xl overflow-hidden">
                  <div className="relative border-b border-line-subtle">
                    <Search size={14} className="absolute left-2.5 top-[9px] text-tertiary" />
                    <input
                      name="ai-provider-global-search"
                      autoComplete="off"
                      aria-label={t('搜索全局配置')}
                      value={dedicatedProviderSearch}
                      onChange={(event) => setDedicatedProviderSearch(event.target.value)}
                      onMouseLeave={handleInputDragSelectAll}
                      placeholder={t('搜索全局配置')}
                      className="w-full h-[34px] border-none outline-none bg-canvas text-primary pt-0 pb-0 pl-8 pr-2.5 box-border text-base"
                    />
                  </div>
                  <div className="max-h-[285px] overflow-y-auto">
                    {filteredDedicatedProviderOptions.length > 0 ? (
                      filteredDedicatedProviderOptions.map((option) => {
                        const active = option.value === selectedWebSearchProviderValue;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => handleWebSearchProviderSelect(option.value)}
                            className={`w-full min-h-[34px] flex items-center justify-between gap-3 px-2.5 border-solid border-x-0 border-t-0 border-b border-line-subtle text-sm text-left cursor-pointer ${active ? 'bg-[rgba(var(--accent-rgb),0.16)] text-primary' : 'bg-transparent text-secondary'}`}>
                            <span className="min-w-0 truncate">{option.label}</span>
                            {active ? <Check size={12} color="var(--text-primary)" /> : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="py-3.5 px-2.5 text-center text-sm text-tertiary">
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

      <div className="grid gap-1.5">
        <div
          style={{ gridTemplateColumns: draft.dedicatedProxyEnabled ? '1fr auto auto' : '1fr auto' }}
          className="grid items-center gap-2.5 py-2.5 px-3 border border-line rounded-xl bg-overlay">
          <span className="text-sm text-primary">{t('专属代理服务器')}</span>

          {draft.dedicatedProxyEnabled ? (
            <div ref={dedicatedProxyFieldRef} className="relative min-w-0 max-w-[320px]">
              <button
                type="button"
                onClick={() => setProxyMenuOpen((prev) => !prev)}
                className={`h-[30px] min-w-[220px] max-w-[320px] flex items-center justify-between gap-2 px-2.5 rounded-full box-border border text-sm text-secondary cursor-pointer transition-colors duration-[120ms] ${proxyMenuOpen ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)]' : 'border-line bg-canvas'}`}>
                <span className="min-w-0 truncate">
                  {currentDedicatedProxyOption?.label || t('不使用')}
                </span>
                <span className={`text-tertiary text-[10px] ${proxyMenuOpen ? 'rotate-180' : 'rotate-0'}`}>▾</span>
              </button>
              {proxyMenuOpen ? (
                <div
                  style={{ zIndex: Z.POPUP }}
                  className="absolute right-0 top-[calc(100%_+_8px)] w-[320px] max-w-[320px] max-h-[320px] rounded-none border border-accent-border bg-overlay shadow-xl overflow-hidden">
                  <div className="max-h-[285px] overflow-y-auto">
                    {dedicatedProxyOptions.map((option) => {
                      const active = option.value === draft.dedicatedProxyId;
                      return (
                        <button
                          key={option.value || '__none__'}
                          type="button"
                          onClick={() => {
                            setDraft((prev) => ({
                              ...prev,
                              dedicatedProxyId: option.value,
                              dedicatedProxyEnabled: true,
                            }));
                            setProxyMenuOpen(false);
                          }}
                          className={`w-full min-h-[34px] flex items-center justify-between gap-3 px-2.5 border-solid border-x-0 border-t-0 border-b border-line-subtle text-sm text-left cursor-pointer ${active ? 'bg-[rgba(var(--accent-rgb),0.16)] text-primary' : 'bg-transparent text-secondary'}`}>
                          <span className="min-w-0 truncate">{option.label}</span>
                          {active ? <Check size={12} color="var(--text-primary)" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setDraft((prev) => ({ ...prev, dedicatedProxyEnabled: !prev.dedicatedProxyEnabled }))}
            className={`w-[34px] h-5 rounded-full border border-line p-0.5 relative transition-colors duration-[120ms] ${draft.dedicatedProxyEnabled ? 'bg-[rgba(var(--accent-rgb),0.52)]' : 'bg-hover'}`}>
            <span
              className="block w-3.5 h-3.5 rounded-full bg-raised"
              style={{ transform: draft.dedicatedProxyEnabled ? 'translateX(14px)' : 'translateX(0)' }}
            />
          </button>
        </div>
        <div className="text-xs text-tertiary leading-normal">
          {t('开启后为当前供应商单独指定代理；关闭后跟随全局 AI 请求代理。')}
        </div>
      </div>
    </>
  );
}
