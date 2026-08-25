import { useEffect, useCallback } from 'react';
import { normalizeFileManagerPaneKey } from '../../utils/fileManagerHelpers.tsx';
import type { FileManagerPaneState, FileManagerWorkspaceState } from '../../utils/fileWorkbench.ts';
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { useFileManagerWorkspaceSync } from './useFileManagerWorkspaceSync.ts';
import type { useFileManagerPaneView } from './useFileManagerPaneView.ts';
import type { useFileManagerLocator } from './useFileManagerLocator.ts';

// 面板滚动容器绑定：Virtuoso ref/scrollerRef 回调缓存、
// 非激活面板滚动位置回写与可视区恢复
export function useFileManagerPaneScroller(deps: ReturnType<typeof useFileManagerCore> & ReturnType<typeof useFileManagerWorkspaceSync> & ReturnType<typeof useFileManagerPaneView> & ReturnType<typeof useFileManagerLocator>) {
  const {
    activePaneKey,
    fileListRef, inactivePaneListRefs,
    paneScrollerElementsRef, paneScrollerCleanupRef,
    paneScrollerRefCallbacksRef, paneScrollerRefOptionsRef,
    paneVirtuosoRefCallbacksRef, paneVirtuosoRefs,
    handleFileListScrollRef, handleFileListKeyDownRef,
    commitFileManagerWorkspace,
    applyPanePendingRestoreIfReady, flushPendingRowEffects,
    leftFileManagerPane, rightFileManagerPane,
  } = deps;
  const syncFileManagerPaneScrollTop = useCallback((paneKey: unknown, listElement: HTMLElement | null) => {
    const normalizedPaneKey = normalizeFileManagerPaneKey(paneKey);
    if (!(listElement instanceof HTMLElement)) {
      return;
    }
    const nextScrollTop = Number(listElement.scrollTop || 0);
    commitFileManagerWorkspace((current) => {
      const currentPanes = (current?.panes && typeof current.panes === 'object'
        ? current.panes
        : {}) as FileManagerWorkspaceState['panes'];
      const currentPane = (currentPanes[normalizedPaneKey] && typeof currentPanes[normalizedPaneKey] === 'object'
        ? currentPanes[normalizedPaneKey]
        : {}) as FileManagerPaneState;
      if (Number(currentPane.scrollTop || 0) === nextScrollTop) {
        return current;
      }
      return {
        ...current,
        activeTabId: current?.activeTabId || '',
        panes: {
          ...currentPanes,
          [normalizedPaneKey]: {
            ...currentPane,
            scrollTop: nextScrollTop,
          },
        },
      };
    });
  }, [commitFileManagerWorkspace]);

  useEffect(() => {
    const leftListElement = activePaneKey === 'left'
      ? fileListRef.current
      : (inactivePaneListRefs.current.left || paneScrollerElementsRef.current.left);
    const rightListElement = activePaneKey === 'right'
      ? fileListRef.current
      : (inactivePaneListRefs.current.right || paneScrollerElementsRef.current.right);
    applyPanePendingRestoreIfReady('left', leftListElement);
    applyPanePendingRestoreIfReady('right', rightListElement);
    flushPendingRowEffects('left', leftFileManagerPane.rows, leftListElement);
    flushPendingRowEffects('right', rightFileManagerPane.rows, rightListElement);
  }, [activePaneKey, flushPendingRowEffects, leftFileManagerPane.rows, rightFileManagerPane.rows]);

  const bindFileManagerPaneScroller = useCallback((paneKey: unknown, element: HTMLElement | null, options: Record<string, unknown> = {}) => {
    const normalizedPaneKey = paneKey === 'right' ? 'right' : 'left';
    const previousElement = paneScrollerElementsRef.current[normalizedPaneKey];
    const previousCleanup = paneScrollerCleanupRef.current[normalizedPaneKey];
    if (typeof previousCleanup === 'function') {
      previousCleanup();
    }
    paneScrollerCleanupRef.current[normalizedPaneKey] = null;
    paneScrollerElementsRef.current[normalizedPaneKey] = element instanceof HTMLElement ? element : null;

    if (!(element instanceof HTMLElement)) {
      if (options.active === true) {
        fileListRef.current = null;
      } else {
        inactivePaneListRefs.current[normalizedPaneKey] = null;
      }
      return;
    }

    if (previousElement !== element && Number.isFinite(Number(options.scrollTop))) {
      const nextScrollTop = Number(options.scrollTop);
      if (Math.abs(element.scrollTop - nextScrollTop) > 1) {
        element.scrollTop = nextScrollTop;
      }
    }

    if (options.active === true) {
      fileListRef.current = element as HTMLDivElement;
      element.tabIndex = 0;
      const handleScroll = () => handleFileListScrollRef.current?.();
      const handleKeyDown = (event: KeyboardEvent) => handleFileListKeyDownRef.current?.(event as unknown as React.KeyboardEvent<HTMLDivElement>);
      element.addEventListener('scroll', handleScroll, { passive: true });
      element.addEventListener('keydown', handleKeyDown);
      paneScrollerCleanupRef.current[normalizedPaneKey] = () => {
        element.removeEventListener('scroll', handleScroll);
        element.removeEventListener('keydown', handleKeyDown);
      };
      return;
    }

    inactivePaneListRefs.current[normalizedPaneKey] = element;
  }, []);

  const getPaneVirtuosoRefCallback = useCallback((paneKey: unknown) => {
    const normalizedPaneKey = normalizeFileManagerPaneKey(paneKey);
    if (!paneVirtuosoRefCallbacksRef.current[normalizedPaneKey]) {
      paneVirtuosoRefCallbacksRef.current[normalizedPaneKey] = (handle: unknown) => {
        paneVirtuosoRefs.current[normalizedPaneKey] = handle;
      };
    }
    return paneVirtuosoRefCallbacksRef.current[normalizedPaneKey] as ((handle: unknown) => void) | undefined;
  }, []);

  const getPaneScrollerRefCallback = useCallback((paneKey: unknown) => {
    const normalizedPaneKey = normalizeFileManagerPaneKey(paneKey);
    if (!paneScrollerRefCallbacksRef.current[normalizedPaneKey]) {
      paneScrollerRefCallbacksRef.current[normalizedPaneKey] = (element: HTMLElement | null) => {
        bindFileManagerPaneScroller(normalizedPaneKey, element, paneScrollerRefOptionsRef.current[normalizedPaneKey] || {});
      };
    }
    return paneScrollerRefCallbacksRef.current[normalizedPaneKey] as ((ref: unknown) => void) | undefined;
  }, [bindFileManagerPaneScroller]);

  return {
    syncFileManagerPaneScrollTop,
    bindFileManagerPaneScroller,
    getPaneVirtuosoRefCallback,
    getPaneScrollerRefCallback,
  };
}
