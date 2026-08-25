import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js';
import {
  createFileManagerPaneEffectState,
  createFileManagerPaneViewState,
  findFileManagerVirtualRowIndex,
  isFileManagerVirtualRangeVisible,
  normalizeFileManagerPaneKey,
} from '../../utils/fileManagerHelpers.tsx';
import type { FileListViewAnchor, FileManagerVirtualRow, RowEffectState } from '../../utils/fileManagerItems.ts';
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { FileManagerFileItem } from './fileManagerTypes.ts';
import type { useFileManagerWorkspaceSync } from './useFileManagerWorkspaceSync.ts';

// 面板视图状态：可视锚点捕获/恢复（防跳动）、行动画效果队列、
// 行可见性与滚动定位，以及目录 diff 追踪与新目录条目的面板定位辅助
export function useFileManagerPaneView(deps: ReturnType<typeof useFileManagerCore> & ReturnType<typeof useFileManagerWorkspaceSync>) {
  const {
    sessionId, isActive, loading, t,
    activePaneKey, fileListRef, fileManagerRootRef,
    inactivePaneListRefs, paneScrollerElementsRef, paneVisibleRangesRef, paneVirtuosoRefs,
    setItems, items, currentPath, currentPathRef, activeVirtualRows, activeFileManagerTab,
    normalizePath,
    fileManagerWorkspaceRef,
  } = deps;
  const paneViewStateRef = useRef({
    left: createFileManagerPaneViewState(),
    right: createFileManagerPaneViewState(),
  });
  const getPaneViewState = useCallback((paneKey: string) => (
    paneViewStateRef.current[normalizeFileManagerPaneKey(paneKey)]
  ), []);
  const pendingViewRestoreRef = useMemo(() => ({
    get current() {
      return getPaneViewState(activePaneKey).pendingRestore;
    },
    set current(value) {
      getPaneViewState(activePaneKey).pendingRestore = value;
    },
  }), [activePaneKey, getPaneViewState]);
  const paneEffectStateRef = useRef({
    left: createFileManagerPaneEffectState(),
    right: createFileManagerPaneEffectState(),
  });
  const getPaneEffectState = useCallback((paneKey: string) => (
    paneEffectStateRef.current[normalizeFileManagerPaneKey(paneKey)]
  ), []);
  const rowEffectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [activeRowEffects, setActiveRowEffects] = useState<Record<string, RowEffectState>>({});
  const activeRowEffectsRef = useRef<Record<string, RowEffectState>>({});

  const captureFileListViewAnchor = useCallback((paneKey = activePaneKey, listElement: HTMLElement | null = null) => {
    const normalizedPaneKey = normalizeFileManagerPaneKey(paneKey);
    const paneViewState = getPaneViewState(normalizedPaneKey);
    const list = listElement
      || (normalizedPaneKey === activePaneKey
        ? fileListRef.current
        : (inactivePaneListRefs.current[normalizedPaneKey] || paneScrollerElementsRef.current[normalizedPaneKey]));
    if (!list) return paneViewState.lastVisibleAnchor || null;
    const rootRect = fileManagerRootRef.current?.getBoundingClientRect?.();
    const canMeasure = !document.hidden && !!rootRect && rootRect.width > 1 && rootRect.height > 1;
    if (!canMeasure) {
      return paneViewState.lastVisibleAnchor || {
        key: '',
        offset: 0,
        scrollTop: list.scrollTop,
      };
    }
    const header = list.querySelector('.file-list-header');
    const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
    const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
    const anchorRow = rows.find((row) => row.getBoundingClientRect().bottom > viewportTop + 1);
    const anchorRect = anchorRow?.getBoundingClientRect?.();
    const nextAnchor = {
      key: (anchorRow as HTMLElement | undefined)?.dataset?.fileRowKey || '',
      offset: anchorRect ? anchorRect.top - viewportTop : 0,
      scrollTop: list.scrollTop,
    };
    paneViewState.lastVisibleAnchor = nextAnchor;
    return nextAnchor;
  }, [activePaneKey, getPaneViewState]);

  const queueFileListViewRestore = useCallback((anchor: FileListViewAnchor | null = captureFileListViewAnchor(), paneKey = activePaneKey) => {
    const paneViewState = getPaneViewState(paneKey);
    paneViewState.pendingRestore = anchor;
  }, [activePaneKey, captureFileListViewAnchor, getPaneViewState]);

  const updateItemsPreservingView = useCallback((updater: FileManagerFileItem[] | ((current: FileManagerFileItem[]) => FileManagerFileItem[]), anchor: FileListViewAnchor | null = captureFileListViewAnchor(), paneKey = activePaneKey) => {
    const paneViewState = getPaneViewState(paneKey);
    paneViewState.pendingRestore = anchor;
    setItems((current) => (typeof updater === 'function' ? updater(current) : updater));
  }, [activePaneKey, captureFileListViewAnchor, getPaneViewState]);

  const applyPanePendingRestoreIfReady = useCallback((paneKey = activePaneKey, listElement: HTMLElement | null = null) => {
    const normalizedPaneKey = normalizeFileManagerPaneKey(paneKey);
    const paneViewState = getPaneViewState(normalizedPaneKey);
    const pendingRestore = paneViewState.pendingRestore;
    if (!pendingRestore) return false;
    const list = listElement
      || (normalizedPaneKey === activePaneKey
        ? fileListRef.current
        : (inactivePaneListRefs.current[normalizedPaneKey] || paneScrollerElementsRef.current[normalizedPaneKey]));
    if (!list) return false;
    const header = list.querySelector('.file-list-header');
    const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
    const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
    if (pendingRestore.key) {
      const anchorRow = rows.find((row) => (row as HTMLElement).dataset?.fileRowKey === pendingRestore.key);
      if (anchorRow) {
        const delta = anchorRow.getBoundingClientRect().top - viewportTop - pendingRestore.offset;
        if (delta !== 0) {
          list.scrollTop += delta;
        }
        paneViewState.pendingRestore = null;
        captureFileListViewAnchor(normalizedPaneKey, list);
        return true;
      }
    }
    if (typeof pendingRestore.scrollTop === 'number') {
      list.scrollTop = pendingRestore.scrollTop;
      paneViewState.pendingRestore = null;
      captureFileListViewAnchor(normalizedPaneKey, list);
      return true;
    }
    return false;
  }, [activePaneKey, captureFileListViewAnchor, getPaneViewState]);

  const confirmCreatedItem = useCallback(async (targetDirPath: unknown, name: unknown, isDirectory: boolean) => {
    const normalizedTargetDirPath = normalizePath(targetDirPath) || '/';
    const trimmedName = String(name || '').trim();
    let listedItems = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const nextItems = await AppGo.ListDir(sessionId, normalizedTargetDirPath);
      listedItems = Array.isArray(nextItems) ? nextItems : [];
      const matchedItem = listedItems.find((item) => (
        String(item?.name || '').trim() === trimmedName
        && Boolean(item?.isDirectory) === Boolean(isDirectory)
      ));
      if (matchedItem) {
        return { matchedItem, listedItems, normalizedTargetDirPath };
      }
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
    throw new Error(`${isDirectory ? t('未找到文件夹') : t('未找到文件')}: ${trimmedName}`);
  }, [normalizePath, sessionId, t]);

  useLayoutEffect(() => {
    applyPanePendingRestoreIfReady(activePaneKey, fileListRef.current);
  }, [activePaneKey, applyPanePendingRestoreIfReady, items]);

  const isDeletedPlaceholderItem = useCallback((item: FileManagerFileItem | null) => Boolean(item?.__luminDeletedPlaceholder), []);

  const queueRowEffect = useCallback((logicalKey: string, rowKey: string, effect: string, paneKey = activePaneKey) => {
    if (!logicalKey || !rowKey || !effect) return;
    const paneEffectState = getPaneEffectState(paneKey);
    paneEffectState.pendingVisualEffects.set(logicalKey, { logicalKey, rowKey, effect, paneKey: normalizeFileManagerPaneKey(paneKey) });
  }, [activePaneKey, getPaneEffectState]);

  const clearRowEffectTimer = useCallback((rowKey: string) => {
    const timer = rowEffectTimersRef.current.get(rowKey);
    if (timer) {
      window.clearTimeout(timer);
      rowEffectTimersRef.current.delete(rowKey);
    }
  }, []);

  const clearActiveRowEffect = useCallback((rowKey: string) => {
    clearRowEffectTimer(rowKey);
    setActiveRowEffects((current) => {
      if (!current[rowKey]) return current;
      const next = { ...current };
      delete next[rowKey];
      activeRowEffectsRef.current = next;
      return next;
    });
  }, [clearRowEffectTimer]);

  const startRowEffect = useCallback((entry: RowEffectState) => {
    if (!entry?.rowKey || !entry?.effect) return;
    const durationMs = 1200;
    const now = Date.now();
    clearRowEffectTimer(entry.rowKey);
    const nextEffectState: RowEffectState = {
      logicalKey: entry.logicalKey,
      rowKey: entry.rowKey,
      effect: entry.effect,
      paneKey: entry.paneKey,
      startedAt: now,
      durationMs,
    };
    setActiveRowEffects((current) => {
      const next = { ...current, [entry.rowKey]: nextEffectState };
      activeRowEffectsRef.current = next;
      return next;
    });
    const timer = window.setTimeout(() => {
      clearActiveRowEffect(entry.rowKey);
    }, durationMs);
    rowEffectTimersRef.current.set(entry.rowKey, timer);
  }, [clearActiveRowEffect, clearRowEffectTimer]);

  const isFileManagerActuallyVisible = useCallback(() => {
    if (!isActive || document.hidden) return false;
    const root = fileManagerRootRef.current;
    if (!root) return false;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const style = window.getComputedStyle(root);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }, [isActive]);

  const isRowVisibleInViewport = useCallback((rowKey: string, options: { paneKey?: string; paneRows?: FileManagerVirtualRow[]; listElement?: HTMLElement | null } = {}) => {
    if (!rowKey) return false;
    const paneKey = normalizeFileManagerPaneKey(options.paneKey || activePaneKey);
    const paneRows = Array.isArray(options.paneRows)
      ? options.paneRows
      : (paneKey === activePaneKey ? activeVirtualRows : []);
    const list = options.listElement
      || (paneKey === activePaneKey
        ? fileListRef.current
        : (inactivePaneListRefs.current[paneKey] || paneScrollerElementsRef.current[paneKey]));
    if (list) {
      const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
      const row = rows.find((entry) => (entry as HTMLElement).dataset?.fileRowKey === rowKey);
      if (row) {
        const header = list.querySelector('.file-list-header');
        const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
        const viewportBottom = list.getBoundingClientRect().bottom;
        const rowRect = row.getBoundingClientRect();
        return rowRect.bottom > viewportTop + 1 && rowRect.top < viewportBottom - 1;
      }
    }
    const visibleRange = paneVisibleRangesRef.current[paneKey] || { startIndex: 0, endIndex: -1 };
    const rowIndex = findFileManagerVirtualRowIndex(paneRows, rowKey);
    if (rowIndex < 0) return false;
    return isFileManagerVirtualRangeVisible(visibleRange, rowIndex);
  }, [activePaneKey, activeVirtualRows]);

  const revealRowInViewport = useCallback((rowKey: string, options: { paneKey?: string; paneRows?: FileManagerVirtualRow[]; listElement?: HTMLElement | null } = {}) => {
    if (!rowKey) return false;
    const paneKey = normalizeFileManagerPaneKey(options.paneKey || activePaneKey);
    const paneRows = Array.isArray(options.paneRows)
      ? options.paneRows
      : (paneKey === activePaneKey ? activeVirtualRows : []);
    const rowIndex = findFileManagerVirtualRowIndex(paneRows, rowKey);
    const virtuosoHandle = paneVirtuosoRefs.current[paneKey] as { scrollToIndex?: (opts: { index: number; align?: string; behavior?: string }) => void } | null | undefined;
    if (rowIndex >= 0 && virtuosoHandle) {
      const paneViewState = getPaneViewState(paneKey);
      paneViewState.pendingRestore = null;
      if (virtuosoHandle.scrollToIndex) {
        virtuosoHandle.scrollToIndex({
          index: rowIndex,
          align: 'center',
          behavior: 'auto',
        });
        return true;
      }
    }
    const list = options.listElement
      || (paneKey === activePaneKey
        ? fileListRef.current
        : (inactivePaneListRefs.current[paneKey] || paneScrollerElementsRef.current[paneKey]));
    if (list) {
      const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
      const row = rows.find((entry) => (entry as HTMLElement).dataset?.fileRowKey === rowKey);
      if (row) {
        const header = list.querySelector('.file-list-header');
        const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
        const viewportBottom = list.getBoundingClientRect().bottom;
        const rowRect = row.getBoundingClientRect();
        if (rowRect.bottom > viewportTop + 1 && rowRect.top < viewportBottom - 1) {
          return true;
        }
        const viewportHeight = Math.max(1, viewportBottom - viewportTop);
        const targetScrollTop = Math.max(
          0,
          list.scrollTop + (rowRect.top - viewportTop) - Math.max(12, (viewportHeight - rowRect.height) / 2),
        );
        list.scrollTop = targetScrollTop;
        if (paneKey === activePaneKey) {
          captureFileListViewAnchor();
        }
        return true;
      }
    }
    return false;
  }, [activePaneKey, activeVirtualRows, captureFileListViewAnchor, getPaneViewState]);

  const flushPendingRowEffects = useCallback((paneKey = activePaneKey, paneRows: FileManagerVirtualRow[] = activeVirtualRows, listElement: HTMLElement | null = null) => {
    if (!isFileManagerActuallyVisible()) return;
    const normalizedPaneKey = normalizeFileManagerPaneKey(paneKey);
    const paneEffectState = getPaneEffectState(normalizedPaneKey);
    paneEffectState.pendingVisualEffects.forEach((entry, logicalKey) => {
      if (!isRowVisibleInViewport(entry.rowKey, { paneKey: normalizedPaneKey, paneRows, listElement })) return;
      paneEffectState.pendingVisualEffects.delete(logicalKey);
      startRowEffect(entry);
    });
  }, [activePaneKey, activeVirtualRows, getPaneEffectState, isFileManagerActuallyVisible, isRowVisibleInViewport, startRowEffect]);

  const didItemMetadataChange = useCallback((prevItem: FileManagerFileItem, nextItem: FileManagerFileItem) => (
    prevItem?.isDirectory !== nextItem?.isDirectory
    || Number(prevItem?.size || 0) !== Number(nextItem?.size || 0)
    || String(prevItem?.permission || '') !== String(nextItem?.permission || '')
    || String(prevItem?.mode || '') !== String(nextItem?.mode || '')
    || String(prevItem?.modifyTime || '') !== String(nextItem?.modifyTime || '')
  ), []);

  const buildItemsWithTrackedDiff = useCallback((currentItems: FileManagerFileItem[], nextItems: FileManagerFileItem[], directoryPath: unknown, paneKey = activePaneKey) => {
    const normalizedNextItems = Array.isArray(nextItems) ? nextItems : [];
    const currentByName = new Map(currentItems.map((entry) => [entry.name, entry]));

    normalizedNextItems.forEach((entry) => {
      const logicalPath = directoryPath === '/' ? `/${entry.name}` : `${directoryPath}/${entry.name}`;
      const previousEntry = currentByName.get(entry.name);
      if (!previousEntry) {
        queueRowEffect(logicalPath, logicalPath, 'added', paneKey);
        return;
      }
      if (didItemMetadataChange(previousEntry, entry)) {
        queueRowEffect(logicalPath, logicalPath, 'changed', paneKey);
      }
    });

    return normalizedNextItems;
  }, [activePaneKey, didItemMetadataChange, queueRowEffect]);

  useEffect(() => {
    captureFileListViewAnchor();
    flushPendingRowEffects(activePaneKey, activeVirtualRows, fileListRef.current);
  }, [activePaneKey, activeVirtualRows, captureFileListViewAnchor, flushPendingRowEffects, items, loading, isActive]);

  useEffect(() => {
    return () => {
      rowEffectTimersRef.current.forEach((currentTimer) => window.clearTimeout(currentTimer));
      rowEffectTimersRef.current.clear();
      Object.values(paneEffectStateRef.current).forEach((paneEffectState) => {
        paneEffectState.pendingVisualEffects.clear();
      });
    };
  }, []);

  useEffect(() => {
    const paneViewState = getPaneViewState(activePaneKey);
    const paneEffectState = getPaneEffectState(activePaneKey);
    paneViewState.lastVisibleAnchor = null;
    paneViewState.pendingRestore = null;
    paneEffectState.pendingVisualEffects.clear();
    rowEffectTimersRef.current.forEach((currentTimer) => window.clearTimeout(currentTimer));
    rowEffectTimersRef.current.clear();
    setActiveRowEffects({});
  }, [activeFileManagerTab?.id, activePaneKey, currentPath, getPaneEffectState, getPaneViewState]);

  useEffect(() => {
    activeRowEffectsRef.current = activeRowEffects;
  }, [activeRowEffects]);

  const getInactiveFileManagerPaneState = useCallback(() => {
    const inactivePaneKey = activePaneKey === 'right' ? 'left' : 'right';
    const inactivePaneSnapshot = fileManagerWorkspaceRef.current?.panes?.[inactivePaneKey] || {};
    return {
      key: inactivePaneKey,
      path: normalizePath(inactivePaneSnapshot.path) || '/',
      tabId: String(inactivePaneSnapshot.tabId || '').trim(),
    };
  }, [activePaneKey, normalizePath]);

  const resolveFileManagerPaneKeysForPath = useCallback((targetPath: unknown) => {
    const normalizedTargetPath = normalizePath(targetPath) || '/';
    const currentWorkspace = fileManagerWorkspaceRef.current;
    const keys: string[] = [];
    const leftPanePath = normalizePath(currentWorkspace?.panes?.left?.path) || '';
    const rightPanePath = normalizePath(currentWorkspace?.panes?.right?.path) || '';
    if (leftPanePath === normalizedTargetPath) {
      keys.push('left');
    }
    if (rightPanePath === normalizedTargetPath) {
      keys.push('right');
    }
    if (keys.length === 0 && normalizedTargetPath === (normalizePath(currentPathRef.current) || '/')) {
      keys.push(activePaneKey);
    }
    return Array.from(new Set(keys.map((paneKey) => normalizeFileManagerPaneKey(paneKey))));
  }, [activePaneKey, normalizePath]);

  const queueRowEffectForMatchingPanes = useCallback((directoryPath: unknown, logicalKey: string, rowKey: string, effect: string) => {
    const matchingPaneKeys = resolveFileManagerPaneKeysForPath(directoryPath);
    const targetPaneKeys = matchingPaneKeys.length > 0 ? matchingPaneKeys : [activePaneKey];
    targetPaneKeys.forEach((paneKey) => {
      queueRowEffect(logicalKey, rowKey, effect, paneKey);
    });
  }, [activePaneKey, queueRowEffect, resolveFileManagerPaneKeysForPath]);

  return {
    paneViewStateRef, getPaneViewState, pendingViewRestoreRef,
    paneEffectStateRef, getPaneEffectState, rowEffectTimersRef,
    activeRowEffects, setActiveRowEffects, activeRowEffectsRef,
    captureFileListViewAnchor, queueFileListViewRestore, updateItemsPreservingView,
    applyPanePendingRestoreIfReady, confirmCreatedItem,
    isDeletedPlaceholderItem, queueRowEffect, clearRowEffectTimer, clearActiveRowEffect, startRowEffect,
    isFileManagerActuallyVisible, isRowVisibleInViewport, revealRowInViewport, flushPendingRowEffects,
    didItemMetadataChange, buildItemsWithTrackedDiff,
    getInactiveFileManagerPaneState, resolveFileManagerPaneKeysForPath, queueRowEffectForMatchingPanes,
  };
}
