import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createLimiter, shouldAutoOpenTransferQueue, UPLOAD_PANEL_CLOSE_ANIMATION_MS } from '../../utils/fileManagerHelpers.tsx';
import {
  getSessionUploadPanelState,
  getSessionUploadQueue,
  getSessionWorkbenchState,
  setSessionUploadPanelState,
  setSessionWorkbenchState,
  subscribeSessionUploadPanelState,
  subscribeSessionUploadQueue,
  subscribeSessionWorkbenchState,
} from '../../utils/fileWorkbench.ts';
import type { TransferQueueItem } from '../../utils/fileWorkbench.ts';
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { useFileManagerEditorState } from './useFileManagerEditorState.ts';

// 上传/传输队列面板状态：面板开合（含关闭动画）、workbench 激活标签联动、
// 分块上传并发限速器，以及分栏 host 布局副作用
export function useFileManagerUploadPanel(deps: ReturnType<typeof useFileManagerCore> & ReturnType<typeof useFileManagerEditorState>) {
  const { sessionId, sessionGroupId, isActive, openEditFiles } = deps;
  const setTransferInfo = useCallback((_info: unknown) => {}, []);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [workbenchState, setWorkbenchStateState] = useState(() => getSessionWorkbenchState(sessionGroupId));
  const [uploadPanelState, setUploadPanelState] = useState(() => getSessionUploadPanelState(sessionGroupId, sessionId));
  const [uploadQueueItems, setUploadQueueItems] = useState<TransferQueueItem[]>(() => getSessionUploadQueue(sessionGroupId));
  const activeUploadCount = useMemo(() => uploadQueueItems.filter((item) => item.status === 'queued' || item.status === 'uploading').length, [uploadQueueItems]);
  const uploadPanelCloseTimerRef = useRef(0);
  const [uploadPanelClosing, setUploadPanelClosing] = useState(false);

  const clearUploadPanelCloseTimer = useCallback(() => {
    if (uploadPanelCloseTimerRef.current) {
      window.clearTimeout(uploadPanelCloseTimerRef.current);
      uploadPanelCloseTimerRef.current = 0;
    }
  }, []);

  useEffect(() => () => {
    clearUploadPanelCloseTimer();
  }, [clearUploadPanelCloseTimer]);

  // 当所有文件关闭时，重置分栏 host 宽度
  useEffect(() => {
    if (openEditFiles.length === 0) {
      const host = document.getElementById('editor-split-host');
      const container = document.getElementById('session-editor-container');
      if (host) {
        host.style.width = '0px';
        host.style.height = '100%';
        host.style.minWidth = '0px';
        host.style.maxWidth = '0px';
        host.style.minHeight = '0px';
        host.style.maxHeight = '0px';
        host.style.borderLeft = 'none';
        host.style.borderRight = 'none';
        host.style.borderTop = 'none';
        host.style.order = '2';
      }
      if (container) {
        container.style.flexDirection = 'row';
      }
    }
  }, [openEditFiles.length]);

  useEffect(() => {
    if (!sessionGroupId) return undefined;
    return subscribeSessionWorkbenchState(sessionGroupId, setWorkbenchStateState);
  }, [sessionGroupId]);

  useEffect(() => {
    if (!sessionGroupId || !sessionId) return undefined;
    return subscribeSessionUploadPanelState(sessionGroupId, sessionId, setUploadPanelState);
  }, [sessionGroupId, sessionId]);

  useEffect(() => {
    if (!sessionGroupId) return undefined;
    return subscribeSessionUploadQueue(sessionGroupId, setUploadQueueItems);
  }, [sessionGroupId]);

  useEffect(() => {
    if (isActive || !sessionGroupId || !sessionId) return;
    clearUploadPanelCloseTimer();
    setUploadPanelClosing(false);
    if (uploadPanelState.uploadOpen) {
      setSessionUploadPanelState(sessionGroupId, sessionId, { uploadOpen: false });
    }
  }, [clearUploadPanelCloseTimer, isActive, sessionGroupId, sessionId, uploadPanelState.uploadOpen]);

  const openUploadPanel = useCallback(() => {
    clearUploadPanelCloseTimer();
    setUploadPanelClosing(false);
    setSessionUploadPanelState(sessionGroupId, sessionId, {
      uploadOpen: true,
    });
    setSessionWorkbenchState(sessionGroupId, {
      activeTab: 'upload',
    });
  }, [clearUploadPanelCloseTimer, sessionGroupId, sessionId]);

  const finishUploadPanelClose = useCallback(() => {
    clearUploadPanelCloseTimer();
    setUploadPanelClosing(false);
    const current = getSessionWorkbenchState(sessionGroupId);
    setSessionUploadPanelState(sessionGroupId, sessionId, {
      uploadOpen: false,
    });
    setSessionWorkbenchState(sessionGroupId, {
      activeTab: current.editorSplitOpen ? 'editor' : current.activeTab,
    });
  }, [clearUploadPanelCloseTimer, sessionGroupId, sessionId]);

  const closeUploadPanel = useCallback(() => {
    const current = getSessionUploadPanelState(sessionGroupId, sessionId);
    if (!current.uploadOpen && !uploadPanelClosing) {
      return;
    }
    clearUploadPanelCloseTimer();
    setUploadPanelClosing(true);
    uploadPanelCloseTimerRef.current = window.setTimeout(() => {
      finishUploadPanelClose();
    }, UPLOAD_PANEL_CLOSE_ANIMATION_MS);
  }, [clearUploadPanelCloseTimer, finishUploadPanelClose, sessionGroupId, uploadPanelClosing]);

  const setUploadPanelOpen = useCallback((open: boolean) => {
    if (open) {
      openUploadPanel();
      return;
    }
    closeUploadPanel();
  }, [closeUploadPanel, openUploadPanel]);

  const openTransferQueueIfNeeded = useCallback(() => {
    if (shouldAutoOpenTransferQueue()) {
      setUploadPanelOpen(true);
    }
  }, [setUploadPanelOpen]);

  const transferTaskLimiterRef = useRef<{ limit: number; run: ((fn: () => unknown) => Promise<unknown>) | null }>({ limit: 0, run: null });
  const uploadChunkLimiterRef = useRef<{ limit: number; run: ((fn: () => unknown) => Promise<unknown>) | null }>({ limit: 0, run: null });

  const getTransferTaskRunner = useCallback((limit: number): (fn: () => unknown) => Promise<unknown> => {
    const normalizedLimit = Math.max(1, limit);
    const currentLimiter = transferTaskLimiterRef.current;
    if (!currentLimiter.run || currentLimiter.limit !== normalizedLimit) {
      transferTaskLimiterRef.current = {
        limit: normalizedLimit,
        run: createLimiter(normalizedLimit),
      };
    }
    return transferTaskLimiterRef.current.run as (fn: () => unknown) => Promise<unknown>;
  }, []);

  const getUploadChunkRunner = useCallback((limit: number): (fn: () => unknown) => Promise<unknown> => {
    const normalizedLimit = Math.max(1, limit);
    const currentLimiter = uploadChunkLimiterRef.current;
    if (!currentLimiter.run || currentLimiter.limit !== normalizedLimit) {
      uploadChunkLimiterRef.current = {
        limit: normalizedLimit,
        run: createLimiter(normalizedLimit),
      };
    }
    return uploadChunkLimiterRef.current.run as (fn: () => unknown) => Promise<unknown>;
  }, []);

  const toggleUploadPanel = useCallback(() => {
    if (uploadPanelClosing) {
      openUploadPanel();
      return;
    }
    const current = getSessionUploadPanelState(sessionGroupId, sessionId);
    if (current.uploadOpen) {
      closeUploadPanel();
      return;
    }
    openUploadPanel();
  }, [closeUploadPanel, openUploadPanel, sessionGroupId, sessionId, uploadPanelClosing]);

  useEffect(() => {
    const host = document.getElementById('editor-split-host');
    const container = document.getElementById('session-editor-container');
    const resizer = document.getElementById('editor-split-resizer');
    const mainContent = document.getElementById('editor-main-content');
    if (!host || !container) return undefined;

    const resetLayout = () => {
      if (resizer) resizer.style.display = 'none';
      if (mainContent) mainContent.style.order = '1';
      container.style.flexDirection = 'row';
      host.style.width = '0px';
      host.style.height = '100%';
      host.style.minWidth = '0px';
      host.style.maxWidth = '0px';
      host.style.minHeight = '0px';
      host.style.maxHeight = '0px';
      host.style.borderLeft = 'none';
      host.style.borderRight = 'none';
      host.style.borderTop = 'none';
      host.style.order = '2';
    };

    if (!isActive || !uploadPanelState.uploadOpen || workbenchState.editorSplitOpen) {
      if (!workbenchState.editorSplitOpen) resetLayout();
      return undefined;
    }

    if (mainContent) mainContent.style.order = '0';
    if (resizer) {
      resizer.style.display = '';
      resizer.style.order = '1';
      // 上传面板在右侧：热区偏右，避免终端划词误触
      resizer.classList.remove('hotzone-left', 'hotzone-right');
      resizer.classList.add('hotzone-right');
    }
    container.style.flexDirection = 'row';
    host.style.width = '42%';
    host.style.height = '100%';
    host.style.minWidth = '320px';
    host.style.maxWidth = '70%';
    host.style.minHeight = '0px';
    host.style.maxHeight = 'none';
    host.style.borderLeft = '1px solid var(--border)';
    host.style.borderRight = 'none';
    host.style.borderTop = 'none';
    host.style.order = '2';

    return () => {
      const latestWorkbench = getSessionWorkbenchState(sessionGroupId);
      const latestUploadPanel = getSessionUploadPanelState(sessionGroupId, sessionId);
      if (!latestUploadPanel.uploadOpen && !latestWorkbench.editorSplitOpen) {
        resetLayout();
      }
    };
  }, [isActive, sessionGroupId, sessionId, workbenchState.editorSplitOpen, uploadPanelState.uploadOpen]);

  return {
    setTransferInfo,
    isDragOver, setIsDragOver, dragCounterRef,
    uploadInputRef, uploadFolderInputRef,
    workbenchState, setWorkbenchStateState,
    uploadPanelState, uploadQueueItems,
    activeUploadCount, uploadPanelClosing, clearUploadPanelCloseTimer,
    openUploadPanel, finishUploadPanelClose, closeUploadPanel, setUploadPanelOpen,
    openTransferQueueIfNeeded,
    transferTaskLimiterRef, uploadChunkLimiterRef,
    getTransferTaskRunner, getUploadChunkRunner, toggleUploadPanel,
  };
}
