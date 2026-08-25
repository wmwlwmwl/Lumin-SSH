import type React from 'react';
import { useTranslation } from '../../../i18n.ts';
import { normalizeOptionalNumber, type ProviderDraft } from './quickEditTypes.ts';
import { StyledCheckbox } from './QuickEditWidgets.tsx';

export interface QuickEditAdvancedTabProps {
  active: boolean;
  draft: ProviderDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft>>;
}

export default function QuickEditAdvancedTab({
  active,
  draft,
  setDraft,
}: QuickEditAdvancedTabProps) {
  const { t } = useTranslation();

  return (
    <div className={`${active ? 'grid' : 'hidden'} gap-1.5 py-0.5`}>
      <div className="grid gap-1 py-2 px-2.5 border border-line rounded-lg bg-overlay">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="ai-provider-temperature" className="text-sm font-semibold text-primary">Temperature</label>
          <StyledCheckbox
            checked={draft.modelTemperature !== null}
            onChange={(checked) => setDraft((prev) => ({
              ...prev,
              modelTemperature: checked ? (prev.modelTemperature ?? 0) : null,
            }))}>
            {t('启用自定义温度')}
          </StyledCheckbox>
        </div>
        {draft.modelTemperature !== null ? (
          <input
            id="ai-provider-temperature"
            name="ai-provider-temperature"
            autoComplete="off"
            type="number"
            inputMode="decimal"
            step="any"
            value={draft.modelTemperature}
            onChange={(event) => setDraft((prev) => ({
              ...prev,
              modelTemperature: normalizeOptionalNumber(event.target.value),
            }))}
            className="h-[34px] w-full rounded-lg border border-line bg-sunken text-primary px-2.5 box-border outline-none"
          />
        ) : (
          <div className="text-xs leading-[1.25] text-tertiary">{t('关闭后不发送该参数')}</div>
        )}
      </div>
      <div className="grid gap-1 py-2 px-2.5 border border-line rounded-lg bg-overlay">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="ai-provider-top-p" className="text-sm font-semibold text-primary">{t('Top P')}</label>
          <StyledCheckbox
            checked={draft.modelTopP !== null}
            onChange={(checked) => setDraft((prev) => ({
              ...prev,
              modelTopP: checked ? (prev.modelTopP ?? 1) : null,
            }))}>
            {t('启用自定义 Top P')}
          </StyledCheckbox>
        </div>
        {draft.modelTopP !== null ? (
          <input
            id="ai-provider-top-p"
            name="ai-provider-top-p"
            autoComplete="off"
            type="number"
            inputMode="decimal"
            step="any"
            value={draft.modelTopP}
            onChange={(event) => setDraft((prev) => ({
              ...prev,
              modelTopP: normalizeOptionalNumber(event.target.value),
            }))}
            className="h-[34px] w-full rounded-lg border border-line bg-sunken text-primary px-2.5 box-border outline-none"
          />
        ) : (
          <div className="text-xs leading-[1.25] text-tertiary">{t('关闭后不发送该参数')}</div>
        )}
      </div>
    </div>
  );
}
