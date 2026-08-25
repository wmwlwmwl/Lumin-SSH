import type React from 'react';
import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import { cn } from '../../../utils/cn.ts';
import type { MentionMenuItem, MentionMenuState, SlashCommandMenuState } from './composerTypes.ts';

export interface AIComposerInlineMenuProps {
  activeInlineMenu: ({ mode: 'slash' } & SlashCommandMenuState) | ({ mode: 'mention' } & MentionMenuState) | null;
  mentionMenu: MentionMenuState;
  currentCwd: string;
  mentionMenuListRef: React.RefObject<HTMLDivElement | null>;
  setSlashCommandMenu: React.Dispatch<React.SetStateAction<SlashCommandMenuState>>;
  setMentionMenu: React.Dispatch<React.SetStateAction<MentionMenuState>>;
  loadMentionSuggestions: (nextText: string, nextCursorPosition: number, forcedType?: 'file' | 'folder' | null) => Promise<void>;
  handleMentionItemSelect: (item: MentionMenuItem) => void;
  value: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function AIComposerInlineMenu({
  activeInlineMenu,
  mentionMenu,
  currentCwd,
  mentionMenuListRef,
  setSlashCommandMenu,
  setMentionMenu,
  loadMentionSuggestions,
  handleMentionItemSelect,
  value,
  textareaRef,
}: AIComposerInlineMenuProps) {
  const { t } = useTranslation();

  if (!activeInlineMenu?.open) {
    return null;
  }

  return (
    <div
      onMouseDown={(event) => event.preventDefault()}
      className="absolute left-3 right-[58px] bottom-[calc(100%-12px)] rounded-xl border border-line bg-overlay shadow-lg overflow-hidden"
      style={{ zIndex: Z.POPUP }}>
      <div className="flex items-center justify-between gap-2.5 px-2.5 py-2 border-b border-line text-xs text-tertiary">
        <div className="flex items-center gap-2 min-w-0">
          <span>
            {activeInlineMenu.mode === 'slash'
              ? `/ ${t('斜杠命令')}`
              : mentionMenu.selectedType === 'file'
                ? `${t('文件')} · ${currentCwd}`
                : mentionMenu.selectedType === 'folder'
                  ? `${t('文件夹')} · ${currentCwd}`
                  : `@ ${t('上下文')}`}
          </span>
          {activeInlineMenu.mode === 'mention' && mentionMenu.loading ? (
            <span className="text-accent whitespace-nowrap">
              {t('正在搜索...')}
            </span>
          ) : null}
        </div>
        {activeInlineMenu.mode === 'mention' && mentionMenu.selectedType ? (
          <button
            type="button"
            onClick={() => {
              const textarea = textareaRef.current;
              const nextCursorPosition = textarea ? (textarea.selectionStart ?? value.length) : value.length;
              void loadMentionSuggestions(value, nextCursorPosition, null);
            }}
            className="border-none bg-transparent text-secondary cursor-pointer p-0 text-xs">
            {t('返回')}
          </button>
        ) : null}
      </div>
      <div ref={mentionMenuListRef} className="max-h-[240px] overflow-y-auto grid">
        {activeInlineMenu.mode === 'mention' && activeInlineMenu.items.length === 0 && mentionMenu.loading ? (
          <div className="px-3.5 py-3 text-sm text-tertiary">
            {t('正在搜索远端路径...')}
          </div>
        ) : null}
        {activeInlineMenu.items.map((item, index) => {
          const isSelected = index === activeInlineMenu.selectedIndex && item.kind !== 'empty';
          return (
            <button
              key={`${activeInlineMenu.mode}-${item.kind}-${item.kind === 'result' ? item.path : item.title}-${index}`}
              data-mention-selected={isSelected ? 'true' : 'false'}
              type="button"
              onMouseEnter={() => {
                if (item.kind === 'empty') {
                  return;
                }
                if (activeInlineMenu.mode === 'slash') {
                  setSlashCommandMenu((previous) => ({
                    ...previous,
                    selectedIndex: index,
                  }));
                  return;
                }
                setMentionMenu((previous) => ({
                  ...previous,
                  selectedIndex: index,
                }));
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                handleMentionItemSelect(item);
              }}
              className={cn(
                'grid gap-0.5 w-full px-3 py-[9px] text-left border-x-0 border-t-0',
                index === activeInlineMenu.items.length - 1 && !(activeInlineMenu.mode === 'mention' && mentionMenu.loading)
                  ? ''
                  : 'border-b border-b-line-subtle',
                isSelected ? 'bg-[rgba(var(--accent-rgb),0.12)]' : 'bg-transparent',
                item.kind === 'empty' ? 'text-tertiary cursor-default' : 'text-primary cursor-pointer',
              )}>
              <span className={cn('text-base', isSelected ? 'font-bold' : 'font-semibold')}>
                {item.title}
              </span>
              {item.description ? (
                <span className="text-xs text-tertiary leading-normal">
                  {item.description}
                </span>
              ) : null}
            </button>
          );
        })}
        {activeInlineMenu.mode === 'mention' && mentionMenu.loading && activeInlineMenu.items.length > 0 ? (
          <div className="px-3 py-2 text-xs text-tertiary border-t border-t-line-subtle">
            {t('正在刷新结果...')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
