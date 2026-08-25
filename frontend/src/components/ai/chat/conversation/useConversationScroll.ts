import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import {
  getEntryKey,
  getTouchClientY,
  shouldIgnoreConversationScrollIntentFromNestedScroller,
  type GroupedConversationEntry,
} from './conversationTypes.ts';

export interface UseConversationScrollOptions {
  groupedMessages: GroupedConversationEntry[];
  conversationId: string;
  scrollToBottomSignal: number;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  virtuosoRef: MutableRefObject<VirtuosoHandle | null>;
  scrollerElementRef: MutableRefObject<HTMLElement | null>;
}

export function useConversationScroll({
  groupedMessages,
  conversationId,
  scrollToBottomSignal,
  containerRef,
  virtuosoRef,
  scrollerElementRef,
}: UseConversationScrollOptions) {
  const followIntentRef = useRef(true);
  const scrollAnimationFrameRef = useRef(0);
  const lastContainerHeightRef = useRef(0);
  const lastTouchClientYRef = useRef<number | null>(null);
  const isScrollbarDraggingRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [highlightedEntryKey, setHighlightedEntryKey] = useState('');

  const suspendFollow = useCallback(() => {
    const scroller = scrollerElementRef.current;
    if (!(scroller instanceof HTMLElement) || scroller.scrollHeight <= scroller.clientHeight + 1) {
      return;
    }
    followIntentRef.current = false;
    setShowScrollToBottom(true);
  }, [scrollerElementRef]);

  const handleJumpToUserMessage = useCallback((targetIndex: number, entry: GroupedConversationEntry) => {
    followIntentRef.current = false;
    setShowScrollToBottom(true);
    if (typeof virtuosoRef.current?.scrollToIndex === 'function') {
      virtuosoRef.current.scrollToIndex({
        index: targetIndex,
        align: 'center',
        behavior: 'auto',
      });
    }
    setHighlightedEntryKey(getEntryKey(entry, targetIndex));
  }, [virtuosoRef]);

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'auto') => {
    if (groupedMessages.length === 0) {
      return;
    }
    if (typeof virtuosoRef.current?.scrollToIndex === 'function') {
      virtuosoRef.current.scrollToIndex({
        index: groupedMessages.length - 1,
        align: 'end',
        behavior,
      });
      return;
    }
    const scroller = scrollerElementRef.current;
    if (scroller instanceof HTMLElement) {
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior });
      } else {
        scroller.scrollTop = scroller.scrollHeight;
      }
      return;
    }
    virtuosoRef.current?.scrollTo?.({
      top: Number.MAX_SAFE_INTEGER,
      behavior,
    });
  }, [groupedMessages.length, scrollerElementRef, virtuosoRef]);

  const scheduleScrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'auto', force = false) => {
    if (groupedMessages.length === 0) {
      return;
    }
    if (!force && !followIntentRef.current) {
      return;
    }
    if (scrollAnimationFrameRef.current) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
    scrollAnimationFrameRef.current = requestAnimationFrame(() => {
      scrollAnimationFrameRef.current = 0;
      scrollToBottom(behavior);
    });
  }, [groupedMessages.length, scrollToBottom]);

  useEffect(() => {
    if (groupedMessages.length === 0) {
      followIntentRef.current = true;
      lastContainerHeightRef.current = 0;
      setShowScrollToBottom(false);
    }
  }, [groupedMessages.length]);

  useEffect(() => {
    if (groupedMessages.length === 0) {
      return;
    }
    followIntentRef.current = true;
    setShowScrollToBottom(false);
    scheduleScrollToBottom('auto', true);
  }, [conversationId, groupedMessages.length, scheduleScrollToBottom]);

  useEffect(() => {
    if (!scrollToBottomSignal || groupedMessages.length === 0) {
      return;
    }
    followIntentRef.current = true;
    setShowScrollToBottom(false);
    scheduleScrollToBottom('smooth', true);
  }, [groupedMessages.length, scheduleScrollToBottom, scrollToBottomSignal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver !== 'function') {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect?.height || 0;
      if (!nextHeight) {
        return;
      }
      if (!lastContainerHeightRef.current) {
        lastContainerHeightRef.current = nextHeight;
        return;
      }
      if (Math.abs(nextHeight - lastContainerHeightRef.current) < 1) {
        return;
      }
      lastContainerHeightRef.current = nextHeight;
      scheduleScrollToBottom('auto');
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [containerRef, scheduleScrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollAnimationFrameRef.current) {
        cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!highlightedEntryKey) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setHighlightedEntryKey('');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [highlightedEntryKey]);

  const handleScrollToBottom = useCallback(() => {
    followIntentRef.current = true;
    setShowScrollToBottom(false);
    scrollToBottom('auto');
  }, [scrollToBottom]);

  const handleUserWheelCapture = useCallback((event: React.WheelEvent) => {
    const deltaY = Number(event?.deltaY) || 0;
    if (deltaY >= -1) {
      return;
    }
    if (shouldIgnoreConversationScrollIntentFromNestedScroller(event?.target, containerRef.current, deltaY)) {
      return;
    }
    suspendFollow();
  }, [containerRef, suspendFollow]);

  const handleUserTouchStartCapture = useCallback((event: React.TouchEvent) => {
    lastTouchClientYRef.current = getTouchClientY(event);
  }, []);

  const handleUserTouchMoveCapture = useCallback((event: React.TouchEvent) => {
    const nextTouchClientY = getTouchClientY(event);
    const previousTouchClientY = lastTouchClientYRef.current;
    lastTouchClientYRef.current = nextTouchClientY;
    if (nextTouchClientY === null || previousTouchClientY === null) {
      return;
    }
    const deltaY = previousTouchClientY - nextTouchClientY;
    if (deltaY >= -1) {
      return;
    }
    if (shouldIgnoreConversationScrollIntentFromNestedScroller(event?.target, containerRef.current, deltaY)) {
      return;
    }
    suspendFollow();
  }, [containerRef, suspendFollow]);

  const handleUserTouchEndCapture = useCallback(() => {
    lastTouchClientYRef.current = null;
  }, []);

  const handlePointerDownCapture = useCallback((event: React.PointerEvent) => {
    const scroller = scrollerElementRef.current;
    if (!(scroller instanceof HTMLElement) || event?.target !== scroller) {
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const scrollbarWidth = Math.max(scroller.offsetWidth - scroller.clientWidth, 12);
    const isLeftScrollbar = getComputedStyle(scroller).direction === 'rtl';
    const clientX = Number(event?.clientX);
    const isScrollbar = isLeftScrollbar
      ? clientX <= rect.left + scrollbarWidth
      : clientX >= rect.right - scrollbarWidth;
    if (isScrollbar) {
      isScrollbarDraggingRef.current = true;
      suspendFollow();
    }
  }, [scrollerElementRef, suspendFollow]);

  const handlePointerEndCapture = useCallback(() => {
    if (!isScrollbarDraggingRef.current) {
      return;
    }
    isScrollbarDraggingRef.current = false;
    const scroller = scrollerElementRef.current;
    if (!(scroller instanceof HTMLElement)) {
      return;
    }
    const isAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
    followIntentRef.current = isAtBottom;
    setShowScrollToBottom(!isAtBottom);
  }, [scrollerElementRef]);

  useEffect(() => {
    window.addEventListener('pointerup', handlePointerEndCapture);
    window.addEventListener('pointercancel', handlePointerEndCapture);
    window.addEventListener('blur', handlePointerEndCapture);
    return () => {
      window.removeEventListener('pointerup', handlePointerEndCapture);
      window.removeEventListener('pointercancel', handlePointerEndCapture);
      window.removeEventListener('blur', handlePointerEndCapture);
    };
  }, [handlePointerEndCapture]);

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent) => {
    if (!['ArrowUp', 'PageUp', 'Home'].includes(event?.key)) {
      return;
    }
    if (shouldIgnoreConversationScrollIntentFromNestedScroller(event?.target, containerRef.current, -1)) {
      return;
    }
    suspendFollow();
  }, [containerRef, suspendFollow]);

  return {
    followIntentRef,
    isScrollbarDraggingRef,
    showScrollToBottom,
    setShowScrollToBottom,
    highlightedEntryKey,
    setHighlightedEntryKey,
    suspendFollow,
    handleJumpToUserMessage,
    scrollToBottom,
    scheduleScrollToBottom,
    handleScrollToBottom,
    handleUserWheelCapture,
    handleUserTouchStartCapture,
    handleUserTouchMoveCapture,
    handleUserTouchEndCapture,
    handlePointerDownCapture,
    handleKeyDownCapture,
  };
}
