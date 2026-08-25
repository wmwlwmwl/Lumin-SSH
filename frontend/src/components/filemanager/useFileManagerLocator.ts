import { useEffect, useCallback, useMemo } from 'react';
import {
  FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL,
  FILE_MANAGER_VIRTUAL_ROW_ITEM,
  buildFileManagerVirtualRows,
  sortFileManagerItems,
} from '../../utils/fileManagerHelpers.tsx';
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { useFileManagerWorkspaceSync } from './useFileManagerWorkspaceSync.ts';
import type { useFileManagerPaneView } from './useFileManagerPaneView.ts';
import type { FileManagerVirtualRow } from './fileManagerTypes.ts';

// 面板快照构建与文件定位：左右面板状态（buildFileManagerPaneState）、
// 定位输入框匹配、文件列表 typeahead 快速跳转
export function useFileManagerLocator(deps: ReturnType<typeof useFileManagerCore> & ReturnType<typeof useFileManagerWorkspaceSync> & ReturnType<typeof useFileManagerPaneView>) {
  const {
    t, fileManagerLayoutMode,
    fileManagerWorkspace, activeFileManagerTab, activePaneKey,
    currentPath, items, sortField, sortDir,
    getCachedTabItems, getCachedPathItems, normalizePath, fileListRef,
    selectedPaths, selectedPathsRef,
    fileLocatorQuery, fileLocatorActiveIndex, fileLocatorActiveRowKey,
    setFileLocatorQuery, setFileLocatorActiveIndex, setFileLocatorActiveRowKey,
    fileListTypeaheadQuery, fileListTypeaheadActiveRowKey,
    setFileListTypeaheadQuery, setFileListTypeaheadActiveIndex, setFileListTypeaheadActiveRowKey,
    fileListTypeaheadTimerRef, fileListTypeaheadLastInputAtRef, fileListTypeaheadBufferRef,
    isDeletedPlaceholderItem, revealRowInViewport,
  } = deps;
  const isDualPaneLayout = fileManagerLayoutMode === FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL;
  const currentPaneTabId = useMemo(() => {
    const paneTabId = String(fileManagerWorkspace?.panes?.[activePaneKey]?.tabId || '').trim();
    if (paneTabId && Array.isArray(fileManagerWorkspace?.tabs) && fileManagerWorkspace.tabs.some((tab) => tab.id === paneTabId)) {
      return paneTabId;
    }
    return String(activeFileManagerTab?.id || '').trim();
  }, [activeFileManagerTab?.id, activePaneKey, fileManagerWorkspace]);
  const activePaneLabel = activePaneKey === 'right' ? t('右侧') : t('左侧');
  const buildFileManagerPaneState = useCallback((paneKey: unknown) => {
    const normalizedPaneKey = paneKey === 'right' ? 'right' : 'left';
    const paneSnapshot = fileManagerWorkspace?.panes?.[normalizedPaneKey] || {};
    const panePath = normalizedPaneKey === activePaneKey
      ? currentPath
      : (normalizePath(paneSnapshot.path) || '/');
    const paneTabId = normalizedPaneKey === activePaneKey
      ? String(activeFileManagerTab?.id || paneSnapshot.tabId || '').trim()
      : String(paneSnapshot.tabId || '').trim();
    const paneSortField = normalizedPaneKey === activePaneKey
      ? sortField
      : (typeof paneSnapshot.sortField === 'string' ? paneSnapshot.sortField : 'name');
    const paneSortDir = normalizedPaneKey === activePaneKey
      ? sortDir
      : (paneSnapshot.sortDir === 'desc' ? 'desc' : 'asc');
    const paneItems = normalizedPaneKey === activePaneKey
      ? items
      : (getCachedTabItems(paneTabId, panePath) || getCachedPathItems(panePath) || []);
    const sortedPaneItems = sortFileManagerItems(paneItems, paneSortField, paneSortDir);
    return {
      key: normalizedPaneKey,
      label: normalizedPaneKey === 'right' ? t('右侧') : t('左侧'),
      path: panePath || '/',
      tabId: paneTabId,
      sortField: paneSortField,
      sortDir: paneSortDir,
      scrollTop: normalizedPaneKey === activePaneKey
        ? (fileListRef.current?.scrollTop || Number(paneSnapshot.scrollTop) || 0)
        : (Number(paneSnapshot.scrollTop) || 0),
      selectedPaths: normalizedPaneKey === activePaneKey
        ? selectedPaths
        : (Array.isArray(paneSnapshot.selectedPaths) ? paneSnapshot.selectedPaths : []),
      items: sortedPaneItems,
      rows: buildFileManagerVirtualRows(sortedPaneItems, panePath || '/'),
    };
  }, [activeFileManagerTab, activePaneKey, currentPath, fileManagerWorkspace, getCachedPathItems, getCachedTabItems, items, normalizePath, selectedPaths, sortDir, sortField, t]);
  const leftFileManagerPane = useMemo(() => buildFileManagerPaneState('left'), [buildFileManagerPaneState]);
  const rightFileManagerPane = useMemo(() => buildFileManagerPaneState('right'), [buildFileManagerPaneState]);
  const currentFileManagerPane = activePaneKey === 'right' ? rightFileManagerPane : leftFileManagerPane;
  const activePaneLocatorRows = useMemo(() => (
    Array.isArray(currentFileManagerPane?.rows)
      ? currentFileManagerPane.rows.filter((row) => row?.rowType === FILE_MANAGER_VIRTUAL_ROW_ITEM && !isDeletedPlaceholderItem(row?.item))
      : []
  ), [currentFileManagerPane, isDeletedPlaceholderItem]);
  const fileLocatorMatches = useMemo(() => {
    const normalizedQuery = String(fileLocatorQuery || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }
    return activePaneLocatorRows.filter((row) => String(row?.name || '').toLowerCase().startsWith(normalizedQuery));
  }, [activePaneLocatorRows, fileLocatorQuery]);
  const getFileLocatorAnchorRowKey = useCallback(() => {
    if (fileLocatorActiveRowKey) {
      return fileLocatorActiveRowKey;
    }
    const selectedPath = Array.isArray(selectedPathsRef.current) ? selectedPathsRef.current[0] : '';
    if (selectedPath) {
      const selectedRow = activePaneLocatorRows.find((row) => row?.logicalPath === selectedPath);
      if (selectedRow?.rowKey) {
        return selectedRow.rowKey;
      }
    }
    return '';
  }, [activePaneLocatorRows, fileLocatorActiveRowKey]);
  const clearFileListTypeahead = useCallback(() => {
    if (fileListTypeaheadTimerRef.current) {
      window.clearTimeout(fileListTypeaheadTimerRef.current);
      fileListTypeaheadTimerRef.current = 0;
    }
    fileListTypeaheadBufferRef.current = '';
    fileListTypeaheadLastInputAtRef.current = 0;
    setFileListTypeaheadQuery('');
    setFileListTypeaheadActiveIndex(0);
    setFileListTypeaheadActiveRowKey('');
  }, []);
  const scheduleFileListTypeaheadClear = useCallback(() => {
    if (fileListTypeaheadTimerRef.current) {
      window.clearTimeout(fileListTypeaheadTimerRef.current);
    }
    fileListTypeaheadTimerRef.current = window.setTimeout(() => {
      fileListTypeaheadTimerRef.current = 0;
      fileListTypeaheadBufferRef.current = '';
      fileListTypeaheadLastInputAtRef.current = 0;
      setFileListTypeaheadQuery('');
      setFileListTypeaheadActiveIndex(0);
      setFileListTypeaheadActiveRowKey('');
    }, 2000);
  }, []);
  const getFileListTypeaheadMatches = useCallback((query: unknown) => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }
    return activePaneLocatorRows.filter((row) => String(row?.name || '').toLowerCase().startsWith(normalizedQuery));
  }, [activePaneLocatorRows]);
  const getFileListTypeaheadAnchorRowKey = useCallback(() => {
    if (fileListTypeaheadActiveRowKey) {
      return fileListTypeaheadActiveRowKey;
    }
    const selectedPath = Array.isArray(selectedPathsRef.current) ? selectedPathsRef.current[0] : '';
    if (selectedPath) {
      const selectedRow = activePaneLocatorRows.find((row) => row?.logicalPath === selectedPath);
      if (selectedRow?.rowKey) {
        return selectedRow.rowKey;
      }
    }
    return '';
  }, [activePaneLocatorRows, fileListTypeaheadActiveRowKey]);
  const resolveFileListTypeaheadMatchIndex = useCallback((matches: FileManagerVirtualRow[], anchorRowKey: unknown, cycleCurrent = false) => {
    if (!Array.isArray(matches) || matches.length === 0) {
      return -1;
    }
    if (!anchorRowKey) {
      return 0;
    }
    const anchorMatchIndex = matches.findIndex((row) => row?.rowKey === anchorRowKey);
    if (cycleCurrent && anchorMatchIndex >= 0) {
      return (anchorMatchIndex + 1) % matches.length;
    }
    const anchorRowIndex = activePaneLocatorRows.findIndex((row) => row?.rowKey === anchorRowKey);
    if (anchorRowIndex < 0) {
      return 0;
    }
    for (let offset = 1; offset <= activePaneLocatorRows.length; offset += 1) {
      const candidateRow = activePaneLocatorRows[(anchorRowIndex + offset) % activePaneLocatorRows.length];
      const candidateMatchIndex = matches.findIndex((row) => row?.rowKey === candidateRow?.rowKey);
      if (candidateMatchIndex >= 0) {
        return candidateMatchIndex;
      }
    }
    return anchorMatchIndex >= 0 ? anchorMatchIndex : 0;
  }, [activePaneLocatorRows]);
  const applyFileListTypeaheadState = useCallback((query: unknown, matches: FileManagerVirtualRow[], matchIndex = 0) => {
    if (!Array.isArray(matches) || matches.length === 0) {
      return false;
    }
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const normalizedIndex = ((matchIndex % matches.length) + matches.length) % matches.length;
    const nextRow = matches[normalizedIndex];
    const nextRowKey = nextRow?.rowKey || '';
    fileListTypeaheadLastInputAtRef.current = Date.now();
    setFileListTypeaheadQuery(normalizedQuery);
    setFileListTypeaheadActiveIndex(normalizedIndex);
    setFileListTypeaheadActiveRowKey(nextRowKey);
    scheduleFileListTypeaheadClear();
    if (nextRowKey) {
      revealRowInViewport(nextRowKey, {
        paneKey: activePaneKey,
        paneRows: currentFileManagerPane?.rows || [],
        listElement: fileListRef.current,
      });
    }
    return true;
  }, [activePaneKey, currentFileManagerPane, revealRowInViewport, scheduleFileListTypeaheadClear]);
  const handleFileListTypeaheadKey = useCallback((rawKey: unknown) => {
    const normalizedKey = String(rawKey || '').trim().toLowerCase();
    if (!/^[a-z]$/.test(normalizedKey)) {
      return false;
    }
    const now = Date.now();
    const currentQuery = String(fileListTypeaheadBufferRef.current || '').trim().toLowerCase();
    const withinWindow = fileListTypeaheadLastInputAtRef.current > 0 && (now - fileListTypeaheadLastInputAtRef.current) <= 2000;
    const anchorRowKey = getFileListTypeaheadAnchorRowKey();

    if (!withinWindow || !currentQuery) {
      const freshMatches = getFileListTypeaheadMatches(normalizedKey);
      if (freshMatches.length === 0) {
        clearFileListTypeahead();
        return false;
      }
      fileListTypeaheadBufferRef.current = normalizedKey;
      const nextIndex = resolveFileListTypeaheadMatchIndex(freshMatches, anchorRowKey, false);
      return applyFileListTypeaheadState(normalizedKey, freshMatches, nextIndex >= 0 ? nextIndex : 0);
    }

    const nextQuery = `${currentQuery}${normalizedKey}`;
    const expandedMatches = getFileListTypeaheadMatches(nextQuery);
    if (expandedMatches.length > 0) {
      fileListTypeaheadBufferRef.current = nextQuery;
      const currentStillMatchesIndex = expandedMatches.findIndex((row) => row?.rowKey === anchorRowKey);
      if (currentStillMatchesIndex >= 0) {
        return applyFileListTypeaheadState(nextQuery, expandedMatches, currentStillMatchesIndex);
      }
      const nextIndex = resolveFileListTypeaheadMatchIndex(expandedMatches, anchorRowKey, false);
      return applyFileListTypeaheadState(nextQuery, expandedMatches, nextIndex >= 0 ? nextIndex : 0);
    }

    const currentMatches = getFileListTypeaheadMatches(currentQuery);
    if (currentQuery.length === 1 && currentQuery === normalizedKey && currentMatches.length > 0) {
      fileListTypeaheadBufferRef.current = currentQuery;
      const nextIndex = resolveFileListTypeaheadMatchIndex(currentMatches, anchorRowKey, true);
      return applyFileListTypeaheadState(currentQuery, currentMatches, nextIndex >= 0 ? nextIndex : 0);
    }

    const restartedMatches = getFileListTypeaheadMatches(normalizedKey);
    if (restartedMatches.length > 0) {
      fileListTypeaheadBufferRef.current = normalizedKey;
      const nextIndex = resolveFileListTypeaheadMatchIndex(restartedMatches, anchorRowKey, false);
      return applyFileListTypeaheadState(normalizedKey, restartedMatches, nextIndex >= 0 ? nextIndex : 0);
    }

    clearFileListTypeahead();
    return false;
  }, [applyFileListTypeaheadState, clearFileListTypeahead, getFileListTypeaheadAnchorRowKey, getFileListTypeaheadMatches, resolveFileListTypeaheadMatchIndex]);
  const effectiveLocatorActiveRowKey = fileListTypeaheadQuery ? fileListTypeaheadActiveRowKey : fileLocatorActiveRowKey;
  const applyFileLocatorMatch = useCallback((matchIndex: number, shouldReveal = true) => {
    if (fileLocatorMatches.length === 0) {
      setFileLocatorActiveIndex(0);
      setFileLocatorActiveRowKey('');
      return;
    }
    const normalizedIndex = ((matchIndex % fileLocatorMatches.length) + fileLocatorMatches.length) % fileLocatorMatches.length;
    const nextRow = fileLocatorMatches[normalizedIndex];
    const nextRowKey = nextRow?.rowKey || '';
    setFileLocatorActiveIndex(normalizedIndex);
    setFileLocatorActiveRowKey(nextRowKey);
    if (shouldReveal && nextRowKey) {
      revealRowInViewport(nextRowKey, {
        paneKey: activePaneKey,
        paneRows: currentFileManagerPane?.rows || [],
        listElement: fileListRef.current,
      });
    }
  }, [activePaneKey, currentFileManagerPane, fileLocatorMatches, revealRowInViewport]);
  const navigateFileLocatorMatch = useCallback((step: number) => {
    if (fileLocatorMatches.length === 0) {
      return;
    }
    const currentMatchIndex = fileLocatorMatches.findIndex((row) => row?.rowKey === fileLocatorActiveRowKey);
    if (currentMatchIndex < 0) {
      applyFileLocatorMatch(step < 0 ? fileLocatorMatches.length - 1 : 0, true);
      return;
    }
    applyFileLocatorMatch(currentMatchIndex + step, true);
  }, [applyFileLocatorMatch, fileLocatorActiveRowKey, fileLocatorMatches]);
  useEffect(() => {
    if (!String(fileLocatorQuery || '').trim() || fileLocatorMatches.length === 0) {
      if (fileLocatorActiveIndex !== 0) {
        setFileLocatorActiveIndex(0);
      }
      if (fileLocatorActiveRowKey) {
        setFileLocatorActiveRowKey('');
      }
      return;
    }
    const currentMatchIndex = fileLocatorMatches.findIndex((row) => row?.rowKey === fileLocatorActiveRowKey);
    if (currentMatchIndex >= 0) {
      if (currentMatchIndex !== fileLocatorActiveIndex) {
        setFileLocatorActiveIndex(currentMatchIndex);
      }
      return;
    }
    applyFileLocatorMatch(0, true);
  }, [applyFileLocatorMatch, fileLocatorActiveIndex, fileLocatorActiveRowKey, fileLocatorMatches, fileLocatorQuery]);
  useEffect(() => {
    setFileLocatorQuery('');
    setFileLocatorActiveIndex(0);
    setFileLocatorActiveRowKey('');
    clearFileListTypeahead();
  }, [activePaneKey, clearFileListTypeahead, currentPath]);
  useEffect(() => () => {
    if (fileListTypeaheadTimerRef.current) {
      window.clearTimeout(fileListTypeaheadTimerRef.current);
      fileListTypeaheadTimerRef.current = 0;
    }
  }, []);

  return {
    isDualPaneLayout, currentPaneTabId, activePaneLabel,
    buildFileManagerPaneState,
    leftFileManagerPane, rightFileManagerPane, currentFileManagerPane,
    activePaneLocatorRows, fileLocatorMatches, getFileLocatorAnchorRowKey,
    clearFileListTypeahead, scheduleFileListTypeaheadClear,
    getFileListTypeaheadMatches, getFileListTypeaheadAnchorRowKey,
    resolveFileListTypeaheadMatchIndex, applyFileListTypeaheadState, handleFileListTypeaheadKey,
    effectiveLocatorActiveRowKey,
    applyFileLocatorMatch, navigateFileLocatorMatch,
  };
}
