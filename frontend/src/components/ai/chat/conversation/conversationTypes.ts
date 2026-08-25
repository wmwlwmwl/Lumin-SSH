import { t } from '../../../../i18n.ts';
import type { AIChatToolSessionItem } from '../AIChatToolSessionPane.tsx';

/** 发送性能指标记录（宽松形状，来自 AIPanel） */
export interface SendPerfRecord {
  stages?: Array<{ ms?: unknown; label?: unknown }>;
  total?: unknown;
}

export function formatSendPerfMetrics(record: unknown) {
  const r = record as SendPerfRecord | null | undefined;
  if (!r || !Array.isArray(r.stages) || r.stages.length === 0) {
    return '';
  }
  const total = Number(r.total) || 0;
  const lines = r.stages.map((stage, index) => {
    const ms = Number(stage.ms) || 0;
    const percent = total > 0 ? ((ms / total) * 100).toFixed(1) : '0.0';
    return `${index + 1}.${stage.label} -> ${ms.toFixed(1)}ms (${percent}%)`;
  });
  lines.push(`${t('总计')} -> ${total.toFixed(1)}ms`);
  return lines.join('\n');
}

export function resolveSendPerfMetrics(sendPerfMetricsRef: { current: Map<string, unknown> | null } | null | undefined, messageId: unknown) {
  const normalizedId = typeof messageId === 'string' ? messageId.trim() : '';
  if (!normalizedId || !sendPerfMetricsRef?.current) {
    return '';
  }
  return formatSendPerfMetrics(sendPerfMetricsRef.current.get(normalizedId));
}

/** 会话消息条目（aiChatMessageTopology.js 分组后的宽松形状） */
export type GroupedConversationEntry =
  | { id?: string; type: 'user'; message?: { id?: string; text?: string; time?: string; images?: unknown[]; extra?: Record<string, unknown> } }
  | { id?: string; type: 'assistant-turn'; turnId?: string; assistant?: { id?: string; title?: string; time?: string; text?: string; streaming?: boolean; extra?: Record<string, unknown> }; reasoning?: Array<{ id: string; text?: string; duration?: string }>; tools?: AIChatToolSessionItem[] }
  | { id?: string; type: 'reasoning'; message?: { id?: string; text?: string; duration?: string } }
  | { id?: string; type: 'context-condense'; message?: Record<string, unknown> }
  | { id?: string; type: 'tool-session'; tools?: AIChatToolSessionItem[] };

export interface ConversationHandlers {
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
  sendPerfMetricsRef?: { current: Map<string, unknown> | null } | null;
  isEditingTarget?: boolean;
}

export interface ConversationEntryMeta {
  isLastAssistantTurn?: boolean;
  hasSubsequentAssistantMessage?: boolean;
  isFirstUserMessage?: boolean;
}

export function getEntryKey(entry: GroupedConversationEntry, index: number) {
  if (entry?.id) {
    return entry.id;
  }
  if (entry?.type === 'assistant-turn') {
    return entry.turnId || entry.assistant?.id || `assistant-${index}`;
  }
  if (entry?.type === 'user') {
    return entry.message?.id || `user-${index}`;
  }
  if (entry?.type === 'reasoning') {
    return entry.message?.id || `reasoning-${index}`;
  }
  return `entry-${index}`;
}

export function getLastAssistantTurnIndex(entries: GroupedConversationEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === 'assistant-turn') {
      return index;
    }
  }
  return -1;
}

export function hasSubsequentAssistantTurn(entries: GroupedConversationEntry[], currentIndex: number) {
  for (let index = currentIndex + 1; index < entries.length; index += 1) {
    if (entries[index]?.type === 'assistant-turn') {
      return true;
    }
  }
  return false;
}

export function getAIChatMessageEntryAnimationClass(entry: GroupedConversationEntry) {
  if (entry?.type === 'user') {
    return 'animate-[ai-chat-msg-enter-right_1500ms_cubic-bezier(0.16,1,0.3,1)_both]';
  }
  return 'animate-[ai-chat-msg-enter-left_1500ms_cubic-bezier(0.16,1,0.3,1)_both]';
}

export function isVerticallyScrollableElement(element: Element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.scrollHeight <= element.clientHeight + 1) {
    return false;
  }
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

export function collectScrollableAncestorsWithinContainer(target: EventTarget | null, container: HTMLElement | null) {
  const ancestors: HTMLElement[] = [];
  let current = target instanceof HTMLElement ? target : null;
  while (current && current !== container) {
    if (isVerticallyScrollableElement(current)) {
      ancestors.push(current);
    }
    current = current.parentElement;
  }
  return ancestors;
}

export function canScrollableElementConsumeDelta(element: Element, deltaY: number) {
  if (!(element instanceof HTMLElement) || Math.abs(Number(deltaY) || 0) < 1) {
    return false;
  }
  const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
  if (deltaY < 0) {
    return element.scrollTop > 0;
  }
  return element.scrollTop < maxScrollTop - 1;
}

export function shouldIgnoreConversationScrollIntentFromNestedScroller(target: EventTarget | null, container: HTMLElement | null, deltaY: number | null = null) {
  if (!(container instanceof HTMLElement)) {
    return false;
  }
  const scrollableAncestors = collectScrollableAncestorsWithinContainer(target, container);
  if (scrollableAncestors.length <= 1) {
    return false;
  }
  const nearestScrollable = scrollableAncestors[0];
  const outermostScrollable = scrollableAncestors[scrollableAncestors.length - 1];
  if (nearestScrollable === outermostScrollable) {
    return false;
  }
  if (typeof deltaY === 'number') {
    return canScrollableElementConsumeDelta(nearestScrollable, deltaY);
  }
  return true;
}

export function getTouchClientY(event: React.TouchEvent | React.TouchEvent<HTMLElement>) {
  const touch = event?.touches?.[0] || event?.changedTouches?.[0];
  const value = Number(touch?.clientY);
  return Number.isFinite(value) ? value : null;
}
