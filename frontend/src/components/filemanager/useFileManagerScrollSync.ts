import { useEffect, useCallback, useRef } from 'react';
import { OnFileDrop, OnFileDropOff } from '../../../wailsjs/runtime/runtime.js';
import { isCompressedTransferEnabled } from '../../utils/fileManagerHelpers.tsx';
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { useFileManagerWorkspaceSync } from './useFileManagerWorkspaceSync.ts';
import type { useFileManagerPaneView } from './useFileManagerPaneView.ts';
import type { useFileManagerUploadPanel } from './useFileManagerUploadPanel.ts';
import type { useFileManagerTransfers } from './useFileManagerTransfers.ts';
import type { useFileManagerItemOps } from './useFileManagerItemOps.ts';

// 滚动同步与原生拖放：文件列表滚动防抖回写 workspace、
// Wails 原生 OnFileDrop 上传桥接
export function useFileManagerScrollSync(deps: ReturnType<typeof useFileManagerCore> & ReturnType<typeof useFileManagerWorkspaceSync> & ReturnType<typeof useFileManagerPaneView> & ReturnType<typeof useFileManagerUploadPanel> & ReturnType<typeof useFileManagerTransfers> & ReturnType<typeof useFileManagerItemOps>) {
  const {
    isActive,
    captureFileListViewAnchor, fileListRef,
    syncCurrentTabToWorkspace,
    handleFileListScrollRef, handleFileListKeyDownRef,
    paneScrollerCleanupRef,
    fileManagerRootRef, nativeDropHandledUntilRef,
    setIsDragOver, dragCounterRef,
    uploadNativePaths,
    handleFileListKeyDown,
  } = deps;
  const scrollSyncTimerRef = useRef<number>(0);
  const syncCurrentTabToWorkspaceRef = useRef(syncCurrentTabToWorkspace);
  const handleFileListScroll = useCallback(() => {
    if (!isActive) return;
    captureFileListViewAnchor();
    const currentScrollTop = fileListRef.current?.scrollTop || 0;
    if (scrollSyncTimerRef.current) {
      window.clearTimeout(scrollSyncTimerRef.current);
    }
    scrollSyncTimerRef.current = window.setTimeout(() => {
      syncCurrentTabToWorkspace({ scrollTop: currentScrollTop, reason: 'scroll-effect' });
    }, 150);
  }, [captureFileListViewAnchor, isActive, syncCurrentTabToWorkspace]);

  handleFileListScrollRef.current = handleFileListScroll;
  handleFileListKeyDownRef.current = handleFileListKeyDown;
  syncCurrentTabToWorkspaceRef.current = syncCurrentTabToWorkspace;

  useEffect(() => () => {
    if (scrollSyncTimerRef.current) {
      window.clearTimeout(scrollSyncTimerRef.current);
      scrollSyncTimerRef.current = 0;
      if (fileListRef.current) {
        syncCurrentTabToWorkspaceRef.current({ scrollTop: fileListRef.current.scrollTop, reason: 'unmount-flush' });
      }
    }
    Object.values(paneScrollerCleanupRef.current).forEach((cleanup) => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    });
  }, []);

  useEffect(() => {
    if (!isActive) return undefined;
    OnFileDrop((x, y, paths) => {
      const rect = fileManagerRootRef.current?.getBoundingClientRect?.();
      const compressedEnabled = isCompressedTransferEnabled();
      const hit = !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (!rect || !hit || !compressedEnabled) return;
      nativeDropHandledUntilRef.current = Date.now() + 5000;
      setIsDragOver(false);
      dragCounterRef.current = 0;
      void uploadNativePaths(paths || []);
    }, true);
    return () => OnFileDropOff();
  }, [isActive, uploadNativePaths]);

  return {
    scrollSyncTimerRef, syncCurrentTabToWorkspaceRef,
    handleFileListScroll,
  };
}
