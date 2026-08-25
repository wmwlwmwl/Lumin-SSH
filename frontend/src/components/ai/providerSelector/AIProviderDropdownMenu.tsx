import { Plus, Search } from 'lucide-react';
import type React from 'react';
import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import Tiptop from '../../Tiptop.tsx';
import AIProviderListRow from '../AIProviderListRow.tsx';
import type { AIProviderLike, RectLike } from './providerSelectorTypes.ts';

export interface AIProviderDropdownMenuProps {
  open: boolean;
  triggerRect: RectLike | null;
  panelBounds: { top: number; left: number; width: number; height: number } | null;
  dropdownMetrics: { width: number; maxHeight: number } | null;
  searchValue: string;
  setSearchValue: React.Dispatch<React.SetStateAction<string>>;
  handleOpenEditor: (mode: 'create' | 'edit', provider: AIProviderLike | null) => void;
  filteredProviders: AIProviderLike[];
  pinnedProviders: AIProviderLike[];
  normalProviders: AIProviderLike[];
  effectiveSelectedId: string;
  handleSelectProvider: (id: string) => Promise<void>;
  handleCopyProvider: (provider: AIProviderLike) => void;
  handleTogglePin: (provider: AIProviderLike) => Promise<void>;
}

export default function AIProviderDropdownMenu({
  open,
  triggerRect,
  panelBounds,
  dropdownMetrics,
  searchValue,
  setSearchValue,
  handleOpenEditor,
  filteredProviders,
  pinnedProviders,
  normalProviders,
  effectiveSelectedId,
  handleSelectProvider,
  handleCopyProvider,
  handleTogglePin,
}: AIProviderDropdownMenuProps) {
  const { t } = useTranslation();

  if (!open || !triggerRect) {
    return null;
  }

  const expandLeft = triggerRect.left + 400 > window.innerWidth - 16;

  const renderRows = (items: AIProviderLike[]) => (
    <div>
      {items.map((item) => (
        <AIProviderListRow
          key={item.id}
          item={{
            name: item.name || '',
            model: item.model,
            description: typeof item.description === 'string' ? item.description : undefined,
            pinned: item.pinned,
          }}
          active={item.id === effectiveSelectedId}
          onSelect={() => void handleSelectProvider(item.id || '')}
          onCopy={() => handleCopyProvider(item)}
          onEdit={() => handleOpenEditor('edit', item)}
          onTogglePin={() => void handleTogglePin(item)}
        />
      ))}
    </div>
  );

  return (
    <div
      className="fixed rounded-lg border border-line bg-overlay shadow-xl flex flex-col overflow-hidden box-border"
      style={{
        ...(panelBounds ? { left: panelBounds.left } : (expandLeft ? { right: window.innerWidth - triggerRect.right } : { left: triggerRect.left })),
        bottom: window.innerHeight - triggerRect.top + 8,
        width: dropdownMetrics?.width ?? 400,
        maxWidth: dropdownMetrics?.width ? `${dropdownMetrics.width}px` : 'min(400px, calc(100vw - 32px))',
        maxHeight: dropdownMetrics?.maxHeight ?? 320,
        zIndex: Z.SEARCH_PANEL,
      }}
    >
      <div className="p-2.5 grid gap-2 border-b border-line-subtle">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold text-primary">{t('供应商列表')}</div>
          <div className="flex items-center gap-2">
            <Tiptop text={t('添加供应商')}>
              <button
                type="button"
                aria-label={t('添加供应商')}
                onClick={() => handleOpenEditor('create', null)}
                className="w-7 h-7 inline-flex items-center justify-center rounded-none border border-line bg-transparent text-secondary transition-colors duration-100"
              >
                <Plus size={14} />
              </button>
            </Tiptop>
          </div>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-tertiary" />
          <input
            name="ai-provider-search"
            autoComplete="off"
            aria-label={t('搜索...')}
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={t('搜索...')}
            className="w-full h-9 rounded-none border border-line bg-canvas text-primary pt-0 pb-0 pr-2.5 pl-8 box-border outline-none"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {filteredProviders.length === 0 ? (
          <div className="flex-1 min-h-0 flex items-center justify-center p-6 text-center text-sm text-tertiary">
            {t('没有匹配的供应商')}
          </div>
        ) : (
          <>
            {pinnedProviders.length > 0 ? (
              <div className={`shrink-0 bg-overlay overflow-x-hidden ${normalProviders.length > 0 ? 'border-b border-line-subtle' : ''}`}>
                {renderRows(pinnedProviders)}
              </div>
            ) : null}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {normalProviders.length > 0 ? renderRows(normalProviders) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
