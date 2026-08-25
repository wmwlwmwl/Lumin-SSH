import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useTranslation } from '../../../i18n.ts';
import { Z } from '../../../constants/zIndex.ts';
import { cn } from '../../../utils/cn.ts';
import { groupConversationMessages } from './aiChatMessageTopology.ts';
import {
  getAIChatMessageEntryAnimationClass,
  getEntryKey,
  getLastAssistantTurnIndex,
  hasSubsequentAssistantTurn,
  type GroupedConversationEntry,
} from './conversation/conversationTypes.ts';
import { renderGroupedEntry } from './conversation/AIChatGroupedEntryRenderer.tsx';
import AIChatMessageDotNav, { type UserMessageNavEntry } from './conversation/AIChatMessageDotNav.tsx';
import { useConversationScroll } from './conversation/useConversationScroll.ts';

export type { GroupedConversationEntry } from './conversation/conversationTypes.ts';

export interface AIChatConversationProps {
  messages?: unknown[];
  sessionId?: string;
  terminalId?: string;
  conversationId?: string;
  tabId?: string;
  onSendUserMessage?: (text: string) => void;
  onRetryUserMessage?: (id: string, text: string, images: string[]) => void;
  onRetryAssistantMessage?: (id: string) => void;
  onEditUserMessage?: (id: string, text: string, images: string[]) => void;
  onDeleteMessage?: (id: string) => void;
  onPreviewRestore?: (artifactPath: string, targetTerminalId: string) => void;
  onPreviewDiffFetch?: (artifactPath: string, targetTerminalId: string) => void;
  onApplyRestore?: (artifactPath: string, targetTerminalId: string) => void;
  followupInteractionLocked?: boolean;
  messageActionBarAtBottom?: boolean;
  messageNavEnabled?: boolean;
  side?: string;
  scrollToBottomSignal?: number;
  sendPerfMetricsRef?: { current: Map<string, unknown> | null } | null;
  editingTargetMessageId?: string;
}

export default function AIChatConversation({
  messages = [],
  sessionId = '',
  terminalId = '',
  conversationId = '',
  tabId = '',
  onSendUserMessage,
  onRetryUserMessage,
  onRetryAssistantMessage,
  onEditUserMessage,
  onDeleteMessage,
  onPreviewRestore,
  onPreviewDiffFetch,
  onApplyRestore,
  followupInteractionLocked = false,
  messageActionBarAtBottom = false,
  messageNavEnabled = true,
  side = 'right',
  scrollToBottomSignal = 0,
  sendPerfMetricsRef = null,
  editingTargetMessageId = '',
}: AIChatConversationProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollerElementRef = useRef<HTMLElement | null>(null);
  const isLeftSide = side !== 'left';

  const groupedMessages = useMemo(() => groupConversationMessages(messages) as GroupedConversationEntry[], [messages]);
  const lastAssistantTurnIndex = useMemo(() => getLastAssistantTurnIndex(groupedMessages), [groupedMessages]);
  const firstUserMessageIndex = useMemo(() => groupedMessages.findIndex((entry) => entry?.type === 'user'), [groupedMessages]);

  const userMessageEntries = useMemo(() => {
    const result: UserMessageNavEntry[] = [];
    groupedMessages.forEach((entry, idx) => {
      if (entry?.type === 'user' && entry.message) {
        result.push({ entry, index: idx });
      }
    });
    return result;
  }, [groupedMessages]);

  const {
    followIntentRef,
    isScrollbarDraggingRef,
    showScrollToBottom,
    setShowScrollToBottom,
    highlightedEntryKey,
    setHighlightedEntryKey,
    suspendFollow,
    handleJumpToUserMessage,
    handleScrollToBottom,
    handleUserWheelCapture,
    handleUserTouchStartCapture,
    handleUserTouchMoveCapture,
    handleUserTouchEndCapture,
    handlePointerDownCapture,
    handleKeyDownCapture,
  } = useConversationScroll({
    groupedMessages,
    conversationId,
    scrollToBottomSignal,
    containerRef,
    virtuosoRef,
    scrollerElementRef,
  });

  useEffect(() => {
    const handleLocateConversationDiffItem = (event: Event) => {
      const detail = (event as CustomEvent).detail as Record<string, unknown> | undefined;
      const targetSessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : '';
      const targetTerminalId = typeof detail?.terminalId === 'string' ? detail.terminalId.trim() : '';
      const targetTabId = typeof detail?.tabId === 'string' ? detail.tabId.trim() : '';
      const targetMessageId = typeof detail?.messageId === 'string' ? detail.messageId.trim() : '';
      if (!targetMessageId) {
        return;
      }
      if (targetSessionId && targetSessionId !== sessionId) {
        return;
      }
      if (targetTerminalId && targetTerminalId !== terminalId) {
        return;
      }
      if (targetTabId && targetTabId !== tabId) {
        return;
      }

      const targetIndex = groupedMessages.findIndex((entry) => {
        if (!entry || typeof entry !== 'object') {
          return false;
        }
        if (entry.type === 'assistant-turn') {
          if (entry.assistant?.id === targetMessageId || entry.turnId === targetMessageId) {
            return true;
          }
          return Array.isArray(entry.tools) && entry.tools.some((tool) => tool?.id === targetMessageId);
        }
        if (entry.type === 'user' || entry.type === 'reasoning' || entry.type === 'context-condense') {
          return entry.message?.id === targetMessageId;
        }
        if (entry.type === 'tool-session') {
          return Array.isArray(entry.tools) && entry.tools.some((tool) => tool?.id === targetMessageId);
        }
        return false;
      });

      if (targetIndex < 0) {
        return;
      }

      const targetEntry = groupedMessages[targetIndex];
      const targetEntryKey = getEntryKey(targetEntry, targetIndex);
      suspendFollow();
      if (typeof virtuosoRef.current?.scrollToIndex === 'function') {
        virtuosoRef.current.scrollToIndex({
          index: targetIndex,
          align: 'center',
          behavior: 'smooth',
        });
      } else {
        virtuosoRef.current?.scrollTo?.({
          top: Number.MAX_SAFE_INTEGER,
          behavior: 'smooth',
        });
      }
      setHighlightedEntryKey(targetEntryKey);
    };

    window.addEventListener('ai-conversation-diff-locate', handleLocateConversationDiffItem);
    return () => {
      window.removeEventListener('ai-conversation-diff-locate', handleLocateConversationDiffItem);
    };
  }, [groupedMessages, sessionId, suspendFollow, tabId, terminalId, setHighlightedEntryKey]);

  if (groupedMessages.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-transparent p-5">
        <div className="max-w-[260px] text-center text-sm leading-[1.8] text-tertiary">
          {t('选择供应商并发送消息后，AI会在这里按真实流式顺序输出内容。')}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onWheelCapture={handleUserWheelCapture}
      onTouchStartCapture={handleUserTouchStartCapture}
      onTouchMoveCapture={handleUserTouchMoveCapture}
      onTouchEndCapture={handleUserTouchEndCapture}
      onTouchCancelCapture={handleUserTouchEndCapture}
      onPointerDownCapture={handlePointerDownCapture}
      onKeyDownCapture={handleKeyDownCapture}
      className="relative min-h-0 h-full flex-1 overflow-x-hidden bg-transparent">
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={(element) => {
          scrollerElementRef.current = element instanceof HTMLElement ? element : null;
          if (element instanceof HTMLElement) {
            element.style.overflowX = 'hidden';
            element.style.direction = isLeftSide ? 'rtl' : 'ltr';
          }
        }}
        style={{ height: '100%', overflowX: 'hidden' }}
        data={groupedMessages}
        alignToBottom={false}
        increaseViewportBy={{ top: 1200, bottom: 800 }}
        initialTopMostItemIndex={{ index: Math.max(groupedMessages.length - 1, 0), align: 'end' }}
        atBottomThreshold={2}
        followOutput={() => (followIntentRef.current ? 'auto' : false)}
        atBottomStateChange={(isAtBottom) => {
          if (isAtBottom && !isScrollbarDraggingRef.current) {
            followIntentRef.current = true;
            setShowScrollToBottom(false);
            return;
          }
          setShowScrollToBottom(!followIntentRef.current);
        }}
        computeItemKey={(index, entry) => getEntryKey(entry, index)}
        itemContent={(index, entry) => {
          const entryKey = getEntryKey(entry, index);
          const isHighlighted = highlightedEntryKey === entryKey;
          const entryAnimClass = getAIChatMessageEntryAnimationClass(entry);
          const isEditingTargetEntry = entry?.type === 'user' && typeof entry?.message?.id === 'string' && entry.message.id.trim() && entry.message.id.trim() === editingTargetMessageId;
          return (
            <div
              className={cn(
                '[direction:ltr] rounded-[14px] px-3.5',
                index === groupedMessages.length - 1 ? 'pb-[18px]' : 'pb-3.5',
                isHighlighted
                  ? 'animate-[ai-chat-message-flash_0.72s_ease-in-out_4] bg-[rgba(var(--accent-rgb),0.08)]'
                  : cn(entryAnimClass, 'bg-transparent'),
                '[transition:background_180ms_ease,box-shadow_180ms_ease]',
              )}>
              {renderGroupedEntry(entry, {
                onSendUserMessage,
                onRetryUserMessage,
                onRetryAssistantMessage,
                onEditUserMessage,
                onDeleteMessage,
                onPreviewRestore,
                onPreviewDiffFetch,
                onApplyRestore,
                followupInteractionLocked,
                messageActionBarAtBottom,
                sendPerfMetricsRef,
                isEditingTarget: Boolean(isEditingTargetEntry),
              }, {
                isLastAssistantTurn: index === lastAssistantTurnIndex,
                hasSubsequentAssistantMessage: hasSubsequentAssistantTurn(groupedMessages, index),
                isFirstUserMessage: index === firstUserMessageIndex,
              })}
            </div>
          );
        }}
      />
      <AIChatMessageDotNav
        userMessageEntries={userMessageEntries}
        messageNavEnabled={messageNavEnabled}
        isLeftSide={isLeftSide}
        onJumpToUserMessage={handleJumpToUserMessage}
      />
      {showScrollToBottom ? (
        <div
          style={{ zIndex: Z.PANEL_BUTTON }}
          className="pointer-events-none absolute bottom-2.5 right-3.5">
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="pointer-events-auto inline-flex h-8 min-w-[40px] cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-overlay px-2.5 text-primary shadow-lg [transition:var(--transition)]">
            <ChevronDown size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
