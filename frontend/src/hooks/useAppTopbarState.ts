import { useCallback, useEffect, useRef, useState } from 'react';
import useWindowState from './useWindowState.ts';
import type { SessionLike } from '../utils/sessionWorkspace.ts';

export interface UseAppTopbarStateOptions {
  sessions: SessionLike[];
}

export default function useAppTopbarState({ sessions }: UseAppTopbarStateOptions) {
  const [showSessionList, setShowSessionList] = useState(false);
  const [sessionListPos, setSessionListPos] = useState({ x: 0, y: 0 });
  const [sessionListQuery, setSessionListQuery] = useState('');
  const sessionListBtnRef = useRef<HTMLButtonElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabActionsRef = useRef<HTMLDivElement>(null);

  const handleToggleMaximise = useWindowState();
  const handleTopbarDoubleClick = useCallback((event?: React.MouseEvent<HTMLDivElement>) => {
    if (!event) return;
    try { window.getSelection?.()?.removeAllRanges?.(); } catch { }
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('.no-drag') || target.closest('.topbar-logo') || target.closest('.tab-item')) return;
    event.preventDefault();
    handleToggleMaximise();
  }, [handleToggleMaximise]);

  useEffect(() => {
    if (!showSessionList) return;
    const handler = (e: MouseEvent) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node) && sessionListBtnRef.current && !sessionListBtnRef.current.contains(e.target as Node)) {
        setShowSessionList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSessionList]);

  const toggleSessionList = useCallback(() => {
    if (showSessionList) { setShowSessionList(false); return; }
    const rect = sessionListBtnRef.current?.getBoundingClientRect();
    if (!rect) { setShowSessionList(false); return; }
    setSessionListPos({ x: rect.right, y: rect.bottom + 4 });
    setSessionListQuery('');
    setShowSessionList(true);
  }, [showSessionList]);

  useEffect(() => {
    const scroll = tabScrollRef.current;
    const list = tabListRef.current;
    if (!scroll || !list) return;
    const check = () => setTabsOverflow(list.scrollWidth > scroll.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(scroll);
    ro.observe(list);
    return () => ro.disconnect();
  }, [sessions]);

  return {
    handleToggleMaximise,
    handleTopbarDoubleClick,
    showSessionList,
    setShowSessionList,
    sessionListPos,
    sessionListQuery,
    setSessionListQuery,
    sessionListBtnRef,
    sessionListRef,
    toggleSessionList,
    tabsOverflow,
    tabScrollRef,
    tabListRef,
    tabActionsRef,
  };
}
