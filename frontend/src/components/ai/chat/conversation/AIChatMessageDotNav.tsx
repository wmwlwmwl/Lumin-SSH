import { useState } from 'react';
import { Z } from '../../../../constants/zIndex.ts';
import { useTranslation } from '../../../../i18n.ts';
import { cn } from '../../../../utils/cn.ts';
import type { GroupedConversationEntry } from './conversationTypes.ts';

export interface UserMessageNavEntry {
  entry: Extract<GroupedConversationEntry, { type: 'user' }>;
  index: number;
}

export interface AIChatMessageDotNavProps {
  userMessageEntries: UserMessageNavEntry[];
  messageNavEnabled: boolean;
  isLeftSide: boolean;
  onJumpToUserMessage: (targetIndex: number, entry: GroupedConversationEntry) => void;
}

export default function AIChatMessageDotNav({
  userMessageEntries,
  messageNavEnabled,
  isLeftSide,
  onJumpToUserMessage,
}: AIChatMessageDotNavProps) {
  const { t } = useTranslation();
  const [hoveredNavIndex, setHoveredNavIndex] = useState(-1);

  if (userMessageEntries.length < 1 || !messageNavEnabled) {
    return null;
  }

  return (
    <div
      style={{ zIndex: Z.PANEL_BUTTON }}
      className={cn(
        'absolute bottom-[44px] top-[14px] flex flex-col items-center justify-center gap-[5px]',
        isLeftSide ? 'right-[3px]' : 'left-[3px]',
      )}>
      {userMessageEntries.map(({ entry, index }, navIndex) => {
        const navText = typeof entry.message?.text === 'string' ? entry.message.text.trim() : '';
        const navTime = typeof entry.message?.time === 'string' ? entry.message.time : '';
        const navPreview = navText.length > 60 ? navText.slice(0, 60) + '…' : navText;
        const isNavHovered = hoveredNavIndex === navIndex;
        return (
          <div
            key={entry.message?.id || `nav-${navIndex}`}
            className="relative flex justify-center"
            onMouseEnter={() => setHoveredNavIndex(navIndex)}
            onMouseLeave={() => setHoveredNavIndex(-1)}
          >
            <button
              type="button"
              onClick={() => onJumpToUserMessage(index, entry)}
              aria-label={navPreview || t('图片消息')}
              style={{ transform: isNavHovered ? 'scale(1.4)' : 'scale(1)' }}
              className={cn(
                'h-[7px] w-[7px] cursor-pointer rounded-full border border-line p-0 [transition:transform_150ms_ease,background_150ms_ease,border-color_150ms_ease]',
                isNavHovered ? 'bg-accent' : 'bg-overlay',
              )}
            />
            {isNavHovered ? (
              <div
                style={{ zIndex: Z.POPUP }}
                className={cn(
                  'pointer-events-none absolute top-1/2 w-max max-w-[240px] -translate-y-1/2 rounded-lg bg-[rgba(30,35,42,0.96)] px-2.5 py-1.5 text-sm leading-[1.5] text-white shadow-lg [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap',
                  isLeftSide ? 'right-full mr-2.5' : 'left-full ml-2.5',
                )}>
                {navTime ? <div className="mb-[3px] text-[10px] opacity-[0.55]">{navTime}</div> : null}
                {navPreview || t('图片消息')}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
