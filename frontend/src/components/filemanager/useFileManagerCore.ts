import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  DEFAULT_MAX_EDIT_SIZE_MB,
  FILE_LIST_ACTIONS_COLUMN_WIDTH,
  FILE_LIST_MODIFIED_MAX_WIDTH,
  FILE_LIST_MODIFIED_MIN_WIDTH,
  FILE_LIST_NAME_MIN_WIDTH,
  FILE_LIST_PERMISSION_MAX_WIDTH,
  FILE_LIST_PERMISSION_MIN_WIDTH,
  FILE_LIST_SIZE_MAX_WIDTH,
  FILE_LIST_SIZE_MIN_WIDTH,
  FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL,
  buildFileManagerVirtualRows,
  clampFileListColumnWidth,
  cloneFileManagerItemsForCache,
  fmtDate,
  fmtSize,
  formatPermissionDisplay,
  getFileManagerLayoutMode,
  isFileManagerDualPaneDragTransferEnabled,
  isFileManagerSharedPinnedTabsEnabled,
  measureFileListTextWidth,
  FILE_MANAGER_LAYOUT_MODE_CLASSIC,
  normalizeFileManagerPaneKey,
  shouldHideFileManagerTabCloseButton,
  shouldInvertFileManagerDualPaneDragModifier,
  shouldPromptFileManagerDualPaneDragDirectory,
  shouldShowFileManagerTabIcons,
  sortFileManagerItems,
  globalOpeningFiles,
  globalOpeningListeners,
} from '../../utils/fileManagerHelpers.tsx';
import {
  getSessionCachedFileManagerPathItems,
  getSessionFileManagerWorkspace,
  setSessionCachedFileManagerPathItems,
  subscribeSessionFileManagerWorkspace,
} from '../../utils/fileWorkbench.ts';
import type {
  FileManagerFileItem,
  FileManagerTabDropIndicator,
  LooseT,
  PaneSelectionRestore,
} from './fileManagerTypes.ts';

// FileManager 状态基座：工作区/路径/排序/设置项等基础 state、ref 与派生值，
// 以及标签项缓存。所有后续 hook 均以此为依赖源头。
export function useFileManagerCore({ sessionId, sessionGroupId, isActive, t }: {
  sessionId: string
  sessionGroupId: string
  isActive: boolean
  t: LooseT
}) {
  const [openingFiles, setOpeningFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOpeningFiles(new Set(globalOpeningFiles));
    const listener = (newSet: Set<string>) => {
      setOpeningFiles(newSet);
    };
    globalOpeningListeners.add(listener);
    return () => {
      globalOpeningListeners.delete(listener);
    };
  }, []);

  const openingFilesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    openingFilesRef.current = openingFiles;
  }, [openingFiles]);
  const joinPath = (base: string, name: string) => base === '/' ? `/${name}` : `${base}/${name}`;
  const normalizePath = useCallback((value: unknown) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const normalizedSlashes = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/');
    const parts: string[] = [];
    normalizedSlashes.split('/').forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') {
        if (parts.length > 0) parts.pop();
        return;
      }
      parts.push(part);
    });
    return parts.length > 0 ? `/${parts.join('/')}` : '/';
  }, []);
  const [fileManagerWorkspace, setFileManagerWorkspaceState] = useState(() => getSessionFileManagerWorkspace(sessionId));
  const fileManagerWorkspaceRef = useRef(fileManagerWorkspace);
  const [currentPath, setCurrentPath] = useState('/');
  const currentPathRef = useRef(currentPath);
  const currentPathHydratedRef = useRef(false);
  const initializingPathRef = useRef(true);
  const pendingTerminalCwdRef = useRef('');
  const preserveWorkspacePathRef = useRef(false);
  const isActiveRef = useRef(isActive);
  const paneSelectionRestoreRef = useRef<{ left: Partial<PaneSelectionRestore> | null; right: Partial<PaneSelectionRestore> | null }>({ left: null, right: null });
  const getPaneSelectionRestore = useCallback((paneKey: string) => (
    paneSelectionRestoreRef.current[normalizeFileManagerPaneKey(paneKey)]
  ), []);
  const setPaneSelectionRestore = useCallback((paneKey: string, selectionRestore: Partial<PaneSelectionRestore> | null) => {
    paneSelectionRestoreRef.current[normalizeFileManagerPaneKey(paneKey)] = selectionRestore;
  }, []);
  const activePaneKey: 'left' | 'right' = fileManagerWorkspace?.activePane === 'right' ? 'right' : 'left';
  const pendingTabSelectionRestoreRef = useMemo(() => ({
    get current() {
      return getPaneSelectionRestore(activePaneKey);
    },
    set current(value) {
      setPaneSelectionRestore(activePaneKey, value);
    },
  }), [activePaneKey, getPaneSelectionRestore, setPaneSelectionRestore]);
  const activeFileManagerTab = useMemo(() => {
    const tabs = Array.isArray(fileManagerWorkspace?.tabs) ? fileManagerWorkspace.tabs : [];
    const activeTabId = typeof fileManagerWorkspace?.activeTabId === 'string' ? fileManagerWorkspace.activeTabId : '';
    return tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null;
  }, [fileManagerWorkspace]);
  const activeFileManagerTabIdRef = useRef(activeFileManagerTab?.id || '');
  const lastStateTabIdRef = useRef(activeFileManagerTab?.id || '');
  const displayedTabIdRef = useRef(activeFileManagerTab?.id || '');
  const [cwdSystemTabHighlight, setCwdSystemTabHighlight] = useState({ tabId: '', token: 0 });
  const cwdSystemTabHighlightTimerRef = useRef(0);
  const loadRequestSeqRef = useRef(0);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
  useEffect(() => { fileManagerWorkspaceRef.current = fileManagerWorkspace; }, [fileManagerWorkspace]);
  useEffect(() => {
    const stateId = activeFileManagerTab?.id || '';
    if (stateId !== lastStateTabIdRef.current) {
      activeFileManagerTabIdRef.current = stateId;
      lastStateTabIdRef.current = stateId;
    }
  }, [activeFileManagerTab]);
  useEffect(() => () => {
    if (cwdSystemTabHighlightTimerRef.current) {
      window.clearTimeout(cwdSystemTabHighlightTimerRef.current);
      cwdSystemTabHighlightTimerRef.current = 0;
    }
  }, []);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { setFileManagerWorkspaceState(getSessionFileManagerWorkspace(sessionId)); }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return undefined;
    return subscribeSessionFileManagerWorkspace(sessionId, setFileManagerWorkspaceState);
  }, [sessionId]);
  const [showFileManagerTabIcons, setShowFileManagerTabIcons] = useState(() => shouldShowFileManagerTabIcons());
  const [hideFileManagerTabCloseButton, setHideFileManagerTabCloseButton] = useState(() => shouldHideFileManagerTabCloseButton());
  const [fileManagerLayoutMode, setFileManagerLayoutMode] = useState(() => getFileManagerLayoutMode());
  const [fileManagerSharedPinnedTabsEnabled, setFileManagerSharedPinnedTabsEnabled] = useState(() => isFileManagerSharedPinnedTabsEnabled());
  const fileManagerSharedPinnedTabsEnabledRef = useRef(fileManagerSharedPinnedTabsEnabled);
  const applyingSharedPinnedTabsRef = useRef(false);
  const [fileManagerDualPaneDragTransferEnabled, setFileManagerDualPaneDragTransferEnabled] = useState(() => isFileManagerDualPaneDragTransferEnabled());
  const [fileManagerDualPaneDragPromptOnDirectory, setFileManagerDualPaneDragPromptOnDirectory] = useState(() => shouldPromptFileManagerDualPaneDragDirectory());
  const [fileManagerDualPaneDragInvertModifier, setFileManagerDualPaneDragInvertModifier] = useState(() => shouldInvertFileManagerDualPaneDragModifier());
  const [fileManagerPaneDropTarget, setFileManagerPaneDropTarget] = useState('');
  const internalFileManagerDragPayloadRef = useRef<Record<string, unknown> | null>(null);
  const [fileManagerDragTip, setFileManagerDragTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [fileManagerSidebarOpen, setFileManagerSidebarOpen] = useState(false);
  const [fileManagerDoubleClickUncompressArchive, setFileManagerDoubleClickUncompressArchive] = useState(false);
  const [fileManagerSmartUncompressConflictStrategy, setFileManagerSmartUncompressConflictStrategy] = useState('auto_rename');
  const [fileManagerAutoRefreshDisabled, setFileManagerAutoRefreshDisabled] = useState(false);
  const [maxEditSizeMB, setMaxEditSizeMB] = useState(DEFAULT_MAX_EDIT_SIZE_MB);
  const fileManagerAutoRefreshDisabledRef = useRef(false);
  useEffect(() => { fileManagerAutoRefreshDisabledRef.current = fileManagerAutoRefreshDisabled; }, [fileManagerAutoRefreshDisabled]);
  useEffect(() => {
    const handleChange = (e: Event) => setShowFileManagerTabIcons((e as CustomEvent).detail !== false);
    window.addEventListener('file-manager-show-tab-icons-changed', handleChange);
    return () => window.removeEventListener('file-manager-show-tab-icons-changed', handleChange);
  }, []);
  useEffect(() => {
    const handleChange = (e: Event) => setHideFileManagerTabCloseButton((e as CustomEvent).detail === true);
    window.addEventListener('file-manager-hide-tab-close-button-changed', handleChange);
    return () => window.removeEventListener('file-manager-hide-tab-close-button-changed', handleChange);
  }, []);
  useEffect(() => {
    const handleChange = (e: Event) => setFileManagerLayoutMode(
      (e as CustomEvent).detail === FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL
        ? FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL
        : FILE_MANAGER_LAYOUT_MODE_CLASSIC
    );
    window.addEventListener('file-manager-layout-mode-changed', handleChange);
    return () => window.removeEventListener('file-manager-layout-mode-changed', handleChange);
  }, []);
  useEffect(() => { fileManagerSharedPinnedTabsEnabledRef.current = fileManagerSharedPinnedTabsEnabled; }, [fileManagerSharedPinnedTabsEnabled]);
  useEffect(() => {
    const handleChange = (e: Event) => setFileManagerSharedPinnedTabsEnabled((e as CustomEvent).detail === true);
    window.addEventListener('file-manager-shared-pinned-tabs-changed', handleChange);
    return () => window.removeEventListener('file-manager-shared-pinned-tabs-changed', handleChange);
  }, []);
  useEffect(() => {
    const handleChange = (e: Event) => setFileManagerDualPaneDragTransferEnabled((e as CustomEvent).detail !== false);
    window.addEventListener('file-manager-dual-pane-drag-transfer-enabled-changed', handleChange);
    return () => window.removeEventListener('file-manager-dual-pane-drag-transfer-enabled-changed', handleChange);
  }, []);
  useEffect(() => {
    const handleChange = (e: Event) => setFileManagerDualPaneDragPromptOnDirectory((e as CustomEvent).detail !== false);
    window.addEventListener('file-manager-dual-pane-drag-prompt-on-directory-changed', handleChange);
    return () => window.removeEventListener('file-manager-dual-pane-drag-prompt-on-directory-changed', handleChange);
  }, []);
  useEffect(() => {
    const handleChange = (e: Event) => setFileManagerDualPaneDragInvertModifier((e as CustomEvent).detail === true);
    window.addEventListener('file-manager-dual-pane-drag-invert-modifier-changed', handleChange);
    return () => window.removeEventListener('file-manager-dual-pane-drag-invert-modifier-changed', handleChange);
  }, []);
  useEffect(() => {
    if (fileManagerLayoutMode !== FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL) {
      setFileManagerSidebarOpen(false);
      setFileManagerPaneDropTarget('');
      internalFileManagerDragPayloadRef.current = null;
      setFileManagerDragTip(null);
    }
  }, [fileManagerLayoutMode]);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(window?.go?.wailsapp?.App?.GetFileManagerSettings?.())
      .then((settings) => {
        if (cancelled || !settings) return;
        setFileManagerDoubleClickUncompressArchive(settings.doubleClickUncompressArchive === true);
        setFileManagerSmartUncompressConflictStrategy(
          settings.smartUncompressConflictStrategy === 'overwrite' || settings.smartUncompressConflictStrategy === 'prompt'
            ? settings.smartUncompressConflictStrategy
            : 'auto_rename'
        );
        setFileManagerAutoRefreshDisabled(settings.autoRefreshDisabled === true);
        if (Number.isFinite(Number(settings.maxEditSizeMB)) && Number(settings.maxEditSizeMB) >= 1) {
          setMaxEditSizeMB(Number(settings.maxEditSizeMB));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const handleDoubleClickChange = (e: Event) => setFileManagerDoubleClickUncompressArchive((e as CustomEvent).detail === true);
    const handleStrategyChange = (e: Event) => setFileManagerSmartUncompressConflictStrategy(
      (e as CustomEvent).detail === 'overwrite' || (e as CustomEvent).detail === 'prompt' ? (e as CustomEvent).detail : 'auto_rename'
    );
    const handleAutoRefreshChange = (e: Event) => setFileManagerAutoRefreshDisabled((e as CustomEvent).detail === true);
    const handleMaxEditSizeChange = (e: Event) => {
      const v = Number((e as CustomEvent).detail);
      if (Number.isFinite(v) && v >= 1) setMaxEditSizeMB(v);
    };
    window.addEventListener('file-manager-double-click-uncompress-archive-changed', handleDoubleClickChange);
    window.addEventListener('file-manager-smart-uncompress-conflict-strategy-changed', handleStrategyChange);
    window.addEventListener('file-manager-auto-refresh-disabled-changed', handleAutoRefreshChange);
    window.addEventListener('file-manager-max-edit-size-changed', handleMaxEditSizeChange);
    return () => {
      window.removeEventListener('file-manager-double-click-uncompress-archive-changed', handleDoubleClickChange);
      window.removeEventListener('file-manager-smart-uncompress-conflict-strategy-changed', handleStrategyChange);
      window.removeEventListener('file-manager-auto-refresh-disabled-changed', handleAutoRefreshChange);
      window.removeEventListener('file-manager-max-edit-size-changed', handleMaxEditSizeChange);
    };
  }, []);
  useEffect(() => {
    if (!sessionId || !currentPathHydratedRef.current || !isActive) return;
    window.__luminFileManagerPaths = window.__luminFileManagerPaths || {};
    window.__luminFileManagerPaths[sessionId] = currentPath;
    window.dispatchEvent(new CustomEvent('ssh-file-manager-path-changed', {
      detail: { sessionId, path: currentPath }
    }));
  }, [currentPath, isActive, sessionId]);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [items, setItems] = useState<FileManagerFileItem[]>([]);
  const [sortField, setSortField] = useState('name');  // name, size, permissions, modified
  const [sortDir, setSortDir] = useState('asc');  // asc, desc
  const [fileLocatorQuery, setFileLocatorQuery] = useState('');
  const [fileLocatorActiveIndex, setFileLocatorActiveIndex] = useState(0);
  const [fileLocatorActiveRowKey, setFileLocatorActiveRowKey] = useState('');
  const [fileListTypeaheadQuery, setFileListTypeaheadQuery] = useState('');
  const [fileListTypeaheadActiveIndex, setFileListTypeaheadActiveIndex] = useState(0);
  const [fileListTypeaheadActiveRowKey, setFileListTypeaheadActiveRowKey] = useState('');
  const fileListTypeaheadTimerRef = useRef(0);
  const fileListTypeaheadLastInputAtRef = useRef(0);
  const fileListTypeaheadBufferRef = useRef('');
  const dualPaneColumnMeasureItems = useMemo(() => {
    if (fileManagerLayoutMode !== FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL) {
      return items;
    }
    const collectPaneItems = (paneKey: string) => {
      const normalizedPaneKey = paneKey === 'right' ? 'right' : 'left';
      if (normalizedPaneKey === activePaneKey) {
        return Array.isArray(items) ? items : [];
      }
      const paneSnapshot = fileManagerWorkspace?.panes?.[normalizedPaneKey] || {};
      const panePath = normalizePath(paneSnapshot.path) || '/';
      return getSessionCachedFileManagerPathItems(sessionId, panePath) || [];
    };
    return [
      ...collectPaneItems('left'),
      ...collectPaneItems('right'),
    ];
  }, [activePaneKey, fileManagerLayoutMode, fileManagerWorkspace, items, normalizePath, sessionId]);

  const fileListColumnWidths = useMemo(() => {
    const headerFont = '600 12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const cellFont = '12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const monoFont = '12px "JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
    const isDual = fileManagerLayoutMode === FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL;
    const actionsColumnWidth = isDual ? 0 : FILE_LIST_ACTIONS_COLUMN_WIDTH;
    const measureItems = Array.isArray(dualPaneColumnMeasureItems) ? dualPaneColumnMeasureItems : [];
    const sizeTexts = [t('大小'), ...measureItems.map((item) => (item.isDirectory ? '-' : fmtSize(item.size)))];
    const permissionTexts = [t('权限'), ...measureItems.map((item) => formatPermissionDisplay(item.permission || '-'))];
    const modifiedTexts = [t('修改时间'), ...measureItems.map((item) => fmtDate(item.modifyTime))];
    const sizeWidth = clampFileListColumnWidth(
      Math.max(
        ...sizeTexts.map((text, index) => measureFileListTextWidth(text, index === 0 ? headerFont : monoFont))
      ) + 24,
      FILE_LIST_SIZE_MIN_WIDTH,
      FILE_LIST_SIZE_MAX_WIDTH,
    );
    const permissionWidth = clampFileListColumnWidth(
      Math.max(
        ...permissionTexts.map((text, index) => measureFileListTextWidth(text, index === 0 ? headerFont : monoFont))
      ) + 28,
      FILE_LIST_PERMISSION_MIN_WIDTH,
      FILE_LIST_PERMISSION_MAX_WIDTH,
    );
    const modifiedWidth = clampFileListColumnWidth(
      Math.max(
        ...modifiedTexts.map((text, index) => measureFileListTextWidth(text, index === 0 ? headerFont : cellFont))
      ) + 28,
      FILE_LIST_MODIFIED_MIN_WIDTH,
      FILE_LIST_MODIFIED_MAX_WIDTH,
    );
    return {
      size: sizeWidth,
      permission: permissionWidth,
      modified: modifiedWidth,
      actions: actionsColumnWidth,
      minWidth: `${FILE_LIST_NAME_MIN_WIDTH + sizeWidth + permissionWidth + modifiedWidth + actionsColumnWidth}px`,
    };
  }, [dualPaneColumnMeasureItems, fileManagerLayoutMode, t]);

  const sortedItems = useMemo(() => sortFileManagerItems(items, sortField, sortDir), [items, sortField, sortDir]);
  const activeVirtualRows = useMemo(() => buildFileManagerVirtualRows(sortedItems, currentPath), [currentPath, sortedItems]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const fileManagerRootRef = useRef<HTMLDivElement | null>(null);
  const nativeDropHandledUntilRef = useRef(0);
  const abortedUploadIdsRef = useRef<Set<string>>(new Set());
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const fileLocatorInputRef = useRef<HTMLInputElement | null>(null);
  const handleFileListScrollRef = useRef<((event?: React.UIEvent<HTMLDivElement>) => void) | null>(null);
  const handleFileListKeyDownRef = useRef<((event: React.KeyboardEvent<HTMLDivElement>) => void) | null>(null);
  const paneVirtuosoRefCallbacksRef = useRef<{ left: unknown; right: unknown }>({ left: null, right: null });
  const paneScrollerRefCallbacksRef = useRef<{ left: unknown; right: unknown }>({ left: null, right: null });
  const paneScrollerRefOptionsRef = useRef<{ left: Record<string, unknown>; right: Record<string, unknown> }>({ left: {}, right: {} });
  const paneVirtuosoRefs = useRef<{ left: unknown; right: unknown }>({ left: null, right: null });
  const paneVisibleRangesRef = useRef<{ left: { startIndex: number; endIndex: number }; right: { startIndex: number; endIndex: number } }>({
    left: { startIndex: 0, endIndex: -1 },
    right: { startIndex: 0, endIndex: -1 },
  });
  const paneScrollerCleanupRef = useRef<{ left: (() => void) | null; right: (() => void) | null }>({ left: null, right: null });
  const paneScrollerElementsRef = useRef<{ left: HTMLElement | null; right: HTMLElement | null }>({ left: null, right: null });
  const inactivePaneListRefs = useRef<{ left: HTMLElement | null; right: HTMLElement | null }>({ left: null, right: null });
  const fileManagerTabScrollRef = useRef<HTMLDivElement | null>(null);
  const fileManagerTabScrollTargetRef = useRef(0);
  const fileManagerTabScrollFrameRef = useRef(0);
  const [fileManagerTabOverflow, setFileManagerTabOverflow] = useState(false);
  const [fileManagerTabCanScrollLeft, setFileManagerTabCanScrollLeft] = useState(false);
  const [fileManagerTabCanScrollRight, setFileManagerTabCanScrollRight] = useState(false);
  const [draggingFileManagerTabId, setDraggingFileManagerTabId] = useState('');
  const draggingFileManagerTabIdRef = useRef('');
  const [fileManagerTabDropIndicator, setFileManagerTabDropIndicator] = useState<FileManagerTabDropIndicator | null>(null);
  const tabItemsCacheRef = useRef<Map<string, { path: string; items: FileManagerFileItem[] }>>(new Map());
  const getCachedTabItems = useCallback((tabId: unknown, path = '') => {
    const key = String(tabId || '').trim();
    if (!key) return null;
    const cached = tabItemsCacheRef.current.get(key);
    if (!cached) return null;
    const normalizedTarget = normalizePath(path);
    if (normalizedTarget && cached.path && cached.path !== normalizedTarget) {
      return null;
    }
    return Array.isArray(cached.items) ? cloneFileManagerItemsForCache(cached.items) : null;
  }, [normalizePath]);
  const getCachedPathItems = useCallback((path: unknown): FileManagerFileItem[] | null => (
    getSessionCachedFileManagerPathItems(sessionId, path) as FileManagerFileItem[] | null
  ), [sessionId]);
  const cacheCurrentTabItems = useCallback((tabId: unknown, path: unknown, nextItems: FileManagerFileItem[]) => {
    const key = String(tabId || '').trim();
    if (!key) return;
    const normalized = normalizePath(path) || '/';
    tabItemsCacheRef.current.set(key, {
      path: normalized,
      items: cloneFileManagerItemsForCache(nextItems),
    });
  }, [normalizePath]);
  const cachePathItems = useCallback((path: unknown, nextItems: FileManagerFileItem[]) => {
    setSessionCachedFileManagerPathItems(sessionId, path, nextItems);
  }, [sessionId]);
  const removeCachedTabItems = useCallback((tabId: unknown) => {
    const key = String(tabId || '').trim();
    if (!key) return;
    tabItemsCacheRef.current.delete(key);
  }, []);
  useEffect(() => {
    tabItemsCacheRef.current.clear();
  }, [sessionId]);
  return {
    sessionId, sessionGroupId, isActive, t,
    openingFiles, openingFilesRef, joinPath, normalizePath,
    fileManagerWorkspace, setFileManagerWorkspaceState, fileManagerWorkspaceRef,
    currentPath, setCurrentPath, currentPathRef, currentPathHydratedRef, initializingPathRef,
    pendingTerminalCwdRef, preserveWorkspacePathRef, isActiveRef,
    paneSelectionRestoreRef, getPaneSelectionRestore, setPaneSelectionRestore,
    pendingTabSelectionRestoreRef, activeFileManagerTab, activeFileManagerTabIdRef,
    lastStateTabIdRef, displayedTabIdRef,
    cwdSystemTabHighlight, setCwdSystemTabHighlight, cwdSystemTabHighlightTimerRef, loadRequestSeqRef,
    showFileManagerTabIcons, hideFileManagerTabCloseButton, fileManagerLayoutMode,
    fileManagerSharedPinnedTabsEnabled, fileManagerSharedPinnedTabsEnabledRef, applyingSharedPinnedTabsRef,
    fileManagerDualPaneDragTransferEnabled, fileManagerDualPaneDragPromptOnDirectory, fileManagerDualPaneDragInvertModifier,
    fileManagerPaneDropTarget, setFileManagerPaneDropTarget, internalFileManagerDragPayloadRef,
    fileManagerDragTip, setFileManagerDragTip, fileManagerSidebarOpen, setFileManagerSidebarOpen,
    fileManagerDoubleClickUncompressArchive, fileManagerSmartUncompressConflictStrategy,
    fileManagerAutoRefreshDisabled, fileManagerAutoRefreshDisabledRef, maxEditSizeMB,
    editingPath, setEditingPath, items, setItems,
    sortField, setSortField, sortDir, setSortDir,
    fileLocatorQuery, setFileLocatorQuery, fileLocatorActiveIndex, setFileLocatorActiveIndex,
    fileLocatorActiveRowKey, setFileLocatorActiveRowKey,
    fileListTypeaheadQuery, setFileListTypeaheadQuery,
    fileListTypeaheadActiveIndex, setFileListTypeaheadActiveIndex,
    fileListTypeaheadActiveRowKey, setFileListTypeaheadActiveRowKey,
    fileListTypeaheadTimerRef, fileListTypeaheadLastInputAtRef, fileListTypeaheadBufferRef,
    dualPaneColumnMeasureItems, fileListColumnWidths, sortedItems, activeVirtualRows, handleSort,
    loading, setLoading, mountedRef, fileManagerRootRef, nativeDropHandledUntilRef, abortedUploadIdsRef,
    fileListRef, fileLocatorInputRef, handleFileListScrollRef, handleFileListKeyDownRef,
    paneVirtuosoRefCallbacksRef, paneScrollerRefCallbacksRef, paneScrollerRefOptionsRef,
    paneVirtuosoRefs, paneVisibleRangesRef, paneScrollerCleanupRef, paneScrollerElementsRef,
    inactivePaneListRefs, fileManagerTabScrollRef, fileManagerTabScrollTargetRef, fileManagerTabScrollFrameRef,
    fileManagerTabOverflow, setFileManagerTabOverflow,
    fileManagerTabCanScrollLeft, setFileManagerTabCanScrollLeft,
    fileManagerTabCanScrollRight, setFileManagerTabCanScrollRight,
    setFileManagerLayoutMode, setFileManagerSharedPinnedTabsEnabled,
    setFileManagerDualPaneDragTransferEnabled, setFileManagerDualPaneDragPromptOnDirectory,
    setFileManagerDualPaneDragInvertModifier, setFileManagerDoubleClickUncompressArchive,
    setFileManagerSmartUncompressConflictStrategy, setFileManagerAutoRefreshDisabled, setMaxEditSizeMB,
    draggingFileManagerTabId, setDraggingFileManagerTabId, draggingFileManagerTabIdRef,
    fileManagerTabDropIndicator, setFileManagerTabDropIndicator,
    tabItemsCacheRef, getCachedTabItems, getCachedPathItems, cacheCurrentTabItems, cachePathItems, removeCachedTabItems,
    activePaneKey,
  };
}
