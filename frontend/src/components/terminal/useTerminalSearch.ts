import { useCallback, useEffect } from 'react';
import type * as React from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import { getModKey, buildCombo } from '../../utils/platform.ts';
import { getTermSearchDecorations } from '../../utils/terminalHelpers.ts';
import type { TerminalTheme } from '../../utils/theme.ts';

// 终端缓冲区查找：选项构造（主题化高亮装饰）、打开/关闭、
// 上/下一个匹配与增量重搜、Ctrl+F 全局唤起。从 Terminal.tsx 原样搬移。
export function useTerminalSearch(deps: {
  showTermSearch: boolean;
  termSearchQuery: string;
  termSearchCaseSensitive: boolean;
  setShowTermSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setTermSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setTermSearchResult: React.Dispatch<React.SetStateAction<{ resultIndex: number; resultCount: number }>>;
  termRef: React.RefObject<XTerm | null>;
  searchAddonRef: React.RefObject<SearchAddon | null>;
  termSearchInputRef: React.RefObject<HTMLInputElement | null>;
  T: TerminalTheme;
  themeToggle: number;
  isActive: boolean;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  shortcutsRef: React.RefObject<Record<string, string> | null>;
}) {
  const {
    showTermSearch, termSearchQuery, termSearchCaseSensitive,
    setShowTermSearch, setTermSearchQuery, setTermSearchResult,
    termRef, searchAddonRef, termSearchInputRef,
    T, themeToggle, isActive, wrapperRef, shortcutsRef,
  } = deps;

  const getTermSearchOptions = useCallback((incremental = false) => ({
    caseSensitive: termSearchCaseSensitive,
    incremental,
    // 高亮跟终端底色走，不跟界面 light/dark 走（浅色 UI + 深色终端时用深色方案）
    decorations: getTermSearchDecorations(T),
  }), [termSearchCaseSensitive, themeToggle, T]);

  const openTermSearch = useCallback((seedText?: string) => {
    setShowTermSearch(true);
    if (typeof seedText === 'string' && seedText && !seedText.includes('\n') && seedText.length <= 200) {
      setTermSearchQuery(seedText);
    } else {
      const selection = termRef.current?.getSelection?.();
      if (selection && !selection.includes('\n') && selection.length <= 200) {
        setTermSearchQuery(selection);
      }
    }
    requestAnimationFrame(() => {
      termSearchInputRef.current?.focus();
      termSearchInputRef.current?.select();
    });
  }, []);

  const closeTermSearch = useCallback(() => {
    setShowTermSearch(false);
    setTermSearchResult({ resultIndex: -1, resultCount: 0 });
    try { searchAddonRef.current?.clearDecorations(); } catch (_) {}
    termRef.current?.focus();
  }, []);

  const findTermNext = useCallback((incremental = false) => {
    const addon = searchAddonRef.current;
    const query = termSearchQuery;
    if (!addon || !query) {
      setTermSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    addon.findNext(query, getTermSearchOptions(incremental));
  }, [getTermSearchOptions, termSearchQuery]);

  const findTermPrevious = useCallback(() => {
    const addon = searchAddonRef.current;
    const query = termSearchQuery;
    if (!addon || !query) {
      setTermSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    addon.findPrevious(query, getTermSearchOptions(false));
  }, [getTermSearchOptions, termSearchQuery]);

  // 查找栏打开后：输入变化 / 大小写切换 / 主题切换 → 清旧装饰再搜（避免浅深色装饰残留）
  useEffect(() => {
    if (!showTermSearch) return;
    if (!termSearchQuery) {
      try { searchAddonRef.current?.clearDecorations(); } catch (_) {}
      setTermSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    try { searchAddonRef.current?.clearDecorations(); } catch (_) {}
    findTermNext(true);
  }, [showTermSearch, termSearchQuery, termSearchCaseSensitive, themeToggle, findTermNext]);

  // 终端聚焦时 Ctrl+F；输入栏等区域同样可用
  useEffect(() => {
    if (!isActive) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const pressedStr = buildCombo(e, getModKey(e));
      const findShortcut = shortcutsRef.current?.find || 'Ctrl+F';
      if (pressedStr !== findShortcut) return;
      const activeEl = document.activeElement;
      const inWrapper = !!(wrapperRef.current && (
        wrapperRef.current.contains(activeEl)
        || wrapperRef.current.contains(e.target as Node | null)
      ));
      // xterm 辅助 textarea 有时不在 wrapper 内层级判断里，再兜一层
      const inXterm = !!(activeEl?.classList?.contains('xterm-helper-textarea')
        || (e.target as Element | null)?.classList?.contains('xterm-helper-textarea'));
      if (!inWrapper && !inXterm) return;
      e.preventDefault();
      e.stopPropagation();
      openTermSearch();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isActive, openTermSearch]);

  return { openTermSearch, closeTermSearch, findTermNext, findTermPrevious };
}
