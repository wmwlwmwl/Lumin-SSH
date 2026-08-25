import type * as React from 'react';
import { Z } from '../../constants/zIndex';
import type { AutocompleteItem, CommandAutocompleteState } from '../../utils/terminalCommandAutocomplete.ts';
import type { I18nKey } from '../../i18n.ts';

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string;

// 命令自动补全弹层。从 Terminal.tsx 原样搬移，props 与闭包变量同名。
interface TerminalAutocompletePopupProps {
  commandAutocomplete: CommandAutocompleteState
  setCommandAutocomplete: React.Dispatch<React.SetStateAction<CommandAutocompleteState>>
  commandAutocompletePopupPos: { left: number; top: number; width: number; maxHeight: number }
  commandAutocompleteListRef: React.RefObject<HTMLDivElement | null>
  applyCommandAutocompleteItem: (item: AutocompleteItem) => void
  t: LooseT
}

export function TerminalAutocompletePopup({
  commandAutocomplete,
  setCommandAutocomplete,
  commandAutocompletePopupPos,
  commandAutocompleteListRef,
  applyCommandAutocompleteItem,
  t,
}: TerminalAutocompletePopupProps) {
  return (
    <div
      className="term-popup flex flex-col overflow-hidden"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: commandAutocompletePopupPos.left,
        top: commandAutocompletePopupPos.top,
        width: commandAutocompletePopupPos.width,
        maxHeight: commandAutocompletePopupPos.maxHeight ?? 260,
        zIndex: Z.POPUP,
      }}
    >
      <div className="flex items-center justify-between gap-2.5 px-2.5 py-[7px] border-b border-[var(--term-separator)] text-xs text-[var(--term-status-color)]">
        <span>{t('命令')}</span>
        <span className="text-[var(--term-muted)] font-mono">Tab</span>
      </div>
      <div ref={commandAutocompleteListRef} className="max-h-[220px] overflow-y-auto overflow-x-hidden">
        {commandAutocomplete.loading && commandAutocomplete.items.length === 0 ? (
          <div className="px-3 py-2.5 text-sm text-[var(--term-muted)]">
            {t('正在搜索...')}
          </div>
        ) : commandAutocomplete.items.map((item, index) => {
          const isSelected = index === commandAutocomplete.selectedIndex;
          return (
            <button
              key={`${item.source}-${item.value}-${index}`}
              data-command-autocomplete-selected={isSelected ? 'true' : 'false'}
              type="button"
              onMouseEnter={() => {
                setCommandAutocomplete((previous) => ({
                  ...previous,
                  selectedIndex: index,
                }));
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                applyCommandAutocompleteItem(item);
              }}
              className={`w-full min-w-0 grid gap-1 px-3 py-[9px] text-left cursor-pointer overflow-hidden border-x-0 border-t-0 ${
                index === commandAutocomplete.items.length - 1 && !commandAutocomplete.loading ? '' : 'border-b border-b-[var(--term-separator)]'
              } ${isSelected ? 'bg-[rgba(59,130,246,0.12)]' : 'bg-transparent'} text-[var(--term-input-color)]`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex-1 min-w-0 text-sm truncate"
                  style={{ fontFamily: 'var(--font-terminal)' }}
                >
                  {item.label}
                </span>
                <span className="shrink-0 px-1.5 py-0.5 rounded-full border border-[var(--term-btn-border)] text-[var(--term-status-color)] text-[10px] leading-[1.2]">
                  {item.badge}
                </span>
              </div>
              {item.description ? (
                <span className="text-xs text-[var(--term-muted)] truncate">
                  {item.description}
                </span>
              ) : null}
            </button>
          );
        })}
        {commandAutocomplete.loading && commandAutocomplete.items.length > 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--term-muted)] border-t border-[var(--term-separator)]">
            {t('正在刷新结果...')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
