import type React from 'react';
import { Z } from '../../../constants/zIndex.ts';
import { useTranslation } from '../../../i18n.ts';
import { cn } from '../../../utils/cn.ts';
import type { MentionMenuItem, MentionMenuState, SlashCommandMenuState } from './composerTypes.ts';

export interface AIComposerMentionMenuProps {
  mentionMenu: MentionMenuState;
  slashCommandMenu: SlashCommandMenuState;
  mentionMenuListRef: React.RefObject<HTMLDivElement | null>;
  onSelectMentionItem: (item: MentionMenuItem) => void;
  onSelectSlashCommandItem: (item: MentionMenuItem) => void;
}

export function AIComposerMentionMenu({
  mentionMenu,
  slashCommandMenu,
  mentionMenuListRef,
  onSelectMentionItem,
  onSelectSlashCommandItem,
}: AIComposerMentionMenuProps) {
  const { t } = useTranslation();

  if (slashCommandMenu.open && slashCommandMenu.items.length > 0) {
    return (
      <div
        ref={mentionMenuListRef}
        style={{ zIndex: Z.POPUP }}
        className="absolute bottom-[calc(100%+8px)] left-0 min-w-[240px] max-w-[360px] max-h-[260px] p-1 rounded-xl border border-line bg-overlay shadow-xl overflow-y-auto grid gap-0.5"
      >
        <div className="px-2.5 py-1 text-[10px] font-bold text-tertiary uppercase tracking-wider border-b border-line-subtle mb-0.5">
          {t('斜杠命令')}
        </div>
        {slashCommandMenu.items.map((item, index) => {
          const active = slashCommandMenu.selectedIndex === index;
          return (
            <button
              key={`${item.name || item.title}-${index}`}
              type="button"
              onClick={() => onSelectSlashCommandItem(item)}
              className={cn(
                'min-h-[32px] flex items-center justify-between gap-2 px-2.5 rounded-lg border-none text-left cursor-pointer transition-colors',
                active ? 'bg-[rgba(var(--accent-rgb),0.14)] text-primary font-bold' : 'bg-transparent text-secondary hover:bg-hover',
              )}
            >
              <div className="min-w-0 grid gap-0.5">
                <span className="text-sm font-semibold text-primary truncate">{item.title}</span>
                {item.description ? (
                  <span className="text-xs text-tertiary truncate">{item.description}</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  if (mentionMenu.open) {
    return (
      <div
        ref={mentionMenuListRef}
        style={{ zIndex: Z.POPUP }}
        className="absolute bottom-[calc(100%+8px)] left-0 min-w-[260px] max-w-[380px] max-h-[280px] p-1 rounded-xl border border-line bg-overlay shadow-xl overflow-y-auto grid gap-0.5"
      >
        {mentionMenu.loading ? (
          <div className="p-3 text-center text-xs text-tertiary">
            {t('加载中...')}
          </div>
        ) : (mentionMenu.items.length === 0 ? (
          <div className="p-3 text-center text-xs text-tertiary">
            {t('未找到结果')}
          </div>
        ) : (
          mentionMenu.items.map((item, index) => {
            const active = mentionMenu.selectedIndex === index;
            if (item.kind === 'empty') {
              return (
                <div key={`empty-${index}`} className="p-2.5 text-center text-xs text-tertiary">
                  <div className="font-semibold text-secondary">{item.title}</div>
                  {item.description ? <div>{item.description}</div> : null}
                </div>
              );
            }
            return (
              <button
                key={`${item.kind}-${item.title}-${index}`}
                type="button"
                onClick={() => onSelectMentionItem(item)}
                className={cn(
                  'min-h-[36px] flex items-center justify-between gap-2.5 px-2.5 py-1 rounded-lg border-none text-left cursor-pointer transition-colors',
                  active ? 'bg-[rgba(var(--accent-rgb),0.14)] text-primary font-bold' : 'bg-transparent text-secondary hover:bg-hover',
                )}
              >
                <div className="min-w-0 grid gap-0.5">
                  <span className="text-sm font-semibold text-primary truncate">{item.title}</span>
                  {item.description ? (
                    <span className="text-xs text-tertiary truncate">{item.description}</span>
                  ) : null}
                </div>
              </button>
            );
          })
        ))}
      </div>
    );
  }

  return null;
}
