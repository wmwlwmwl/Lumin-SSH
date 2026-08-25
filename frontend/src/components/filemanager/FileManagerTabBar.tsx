import React from 'react';
import { ChevronLeft, ChevronRight, Folder, Pin, X, Plus } from 'lucide-react';
import {
  FILE_MANAGER_SYSTEM_TAB_KIND_CWD,
  buildDirectoryItemFromPath,
  getParentPath,
  renderFileManagerTabTitle,
} from '../../utils/fileManagerHelpers.tsx';
import Tiptop from '../Tiptop.tsx';
import { Button } from '../ui';
import type { FileManagerController } from './fileManagerController.ts';
import type { FileManagerTabDropIndicator } from './fileManagerTypes.ts';

// 经典布局标签栏：溢出滚动、标签拖拽重排与放置指示、固定/关闭、
// 标签右键菜单与新建标签
export function renderFileManagerTabBar(fm: FileManagerController) {
  const {
    t, isDualPaneLayout,
    fileManagerTabOverflow, fileManagerTabCanScrollLeft, fileManagerTabCanScrollRight,
    scrollFileManagerTabs, fileManagerTabScrollRef,
    handleFileManagerTabWheel, handleFileManagerTabScroll,
    draggingFileManagerTabIdRef, draggingFileManagerTabId, setDraggingFileManagerTabId,
    fileManagerTabDropIndicator,
    resolveFileManagerTabAppendTarget, setFileManagerTabDropIndicator,
    clearFileManagerTabDragState, reorderFileManagerTabs,
    fileManagerWorkspace, activeFileManagerTab, cwdSystemTabHighlight,
    getFileManagerTabDropPreviewText, resolveFileManagerTabDropSide,
    activateFileManagerTab, handleCloseFileManagerTab,
    normalizePath, setContextMenu,
    showFileManagerTabIcons, hideFileManagerTabCloseButton,
    handleCreateFileManagerTab,
  } = fm;
  if (isDualPaneLayout) return null;
  return (
    <div className="terminal-sub-tab-bar">
        {fileManagerTabOverflow && (
          <button
            type="button"
            className={`terminal-sub-tab-nav terminal-sub-tab-nav-left${fileManagerTabCanScrollLeft ? '' : ' disabled'}`}
            onClick={() => scrollFileManagerTabs(-1)}
            aria-label={t('向左滚动标签')}
            title={t('向左滚动标签')}
            disabled={!fileManagerTabCanScrollLeft}
          >
            <ChevronLeft size={14} />
          </button>
        )}
        <div
          ref={fileManagerTabScrollRef}
          className="terminal-sub-tab-scroll"
          onWheel={handleFileManagerTabWheel}
          onScroll={handleFileManagerTabScroll}
          onDragOver={(event) => {
            const draggedTabId = draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
            if (!draggedTabId) {
              return;
            }
            if ((event.target as HTMLElement | null)?.closest?.('.terminal-sub-tab')) {
              return;
            }
            const appendTarget = resolveFileManagerTabAppendTarget();
            if (!appendTarget || appendTarget.id === draggedTabId) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setFileManagerTabDropIndicator((current: FileManagerTabDropIndicator | null) => (
              current?.tabId === appendTarget.id && current?.side === 'after'
                ? current
                : { tabId: appendTarget.id, side: 'after' }
            ));
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) {
              return;
            }
            setFileManagerTabDropIndicator((current: FileManagerTabDropIndicator | null) => (
              current?.side === 'after' ? null : current
            ));
          }}
          onDrop={(event) => {
            const draggedTabId = event.dataTransfer.getData('text/plain') || draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
            if (!draggedTabId) {
              clearFileManagerTabDragState();
              return;
            }
            if ((event.target as HTMLElement | null)?.closest?.('.terminal-sub-tab')) {
              return;
            }
            const appendTarget = resolveFileManagerTabAppendTarget();
            if (!appendTarget || appendTarget.id === draggedTabId) {
              clearFileManagerTabDragState();
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            reorderFileManagerTabs(draggedTabId, appendTarget.id, 'after');
            clearFileManagerTabDragState();
          }}
        >
          {fileManagerWorkspace.tabs.map((tab) => {
            const isActiveTab = activeFileManagerTab?.id === tab.id;
            const isPinnedTab = tab.pinned === true;
            const isSystemPinnedTab = tab.systemPinned === true;
            const isCwdSystemPinnedTab = String(tab.systemPinnedType || '').trim() === FILE_MANAGER_SYSTEM_TAB_KIND_CWD;
            const isCwdSystemTabHighlightVisible = isCwdSystemPinnedTab && cwdSystemTabHighlight.tabId === tab.id;
            const isDraggingTab = draggingFileManagerTabId === tab.id;
            const showDropIndicator = fileManagerTabDropIndicator?.tabId === tab.id;
            const dropIndicatorSide = typeof fileManagerTabDropIndicator?.side === 'string' ? fileManagerTabDropIndicator.side : 'after';
            const tabDropPreviewText = showDropIndicator
              ? getFileManagerTabDropPreviewText(draggingFileManagerTabIdRef.current || draggingFileManagerTabId, tab, dropIndicatorSide)
              : '';
            const tabDefaultTiptopText = draggingFileManagerTabId
              ? null
              : (
                <>
                  <div>{tab.path || '/'}</div>
                  <div className="mt-0.5 text-xs opacity-[0.78]">{t('双击关闭标签,长按拖拽调整')}</div>
                </>
              );
            return (
              <div
                key={tab.id}
                className={`terminal-sub-tab ${isActiveTab ? 'active' : ''}${isCwdSystemPinnedTab ? ' terminal-sub-tab-cwd' : ''}`}
                draggable={!isSystemPinnedTab}
                onDragStart={(event) => {
                  if (isSystemPinnedTab) {
                    return;
                  }
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', tab.id);
                  draggingFileManagerTabIdRef.current = tab.id;
                  setDraggingFileManagerTabId(tab.id);
                  setFileManagerTabDropIndicator(null);
                }}
                onDragOver={(event) => {
                  const draggedTabId = draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                  if (!draggedTabId || draggedTabId === tab.id) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const side = resolveFileManagerTabDropSide(event, tab);
                  setFileManagerTabDropIndicator((current: FileManagerTabDropIndicator | null) => (
                    current?.tabId === tab.id && current?.side === side
                      ? current
                      : { tabId: tab.id, side }
                  ));
                }}
                onDragLeave={(event) => {
                  event.stopPropagation();
                  setFileManagerTabDropIndicator((current: FileManagerTabDropIndicator | null) => (current?.tabId === tab.id ? null : current));
                }}
                onDrop={(event) => {
                  const draggedTabId = event.dataTransfer.getData('text/plain') || draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                  if (!draggedTabId || draggedTabId === tab.id) {
                    clearFileManagerTabDragState();
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const side = resolveFileManagerTabDropSide(event, tab);
                  reorderFileManagerTabs(draggedTabId, tab.id, side);
                  clearFileManagerTabDragState();
                }}
                onDragEnd={() => {
                  clearFileManagerTabDragState();
                }}
                onClick={() => { void activateFileManagerTab(tab.id); }}
                onDoubleClick={(event) => { void handleCloseFileManagerTab(tab.id, event); }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const tabPath = normalizePath(tab.path) || '/';
                  setContextMenu({
                    pos: { x: event.clientX, y: event.clientY },
                    item: buildDirectoryItemFromPath(tabPath),
                    mode: 'tab',
                    tabId: tab.id,
                    tabPath,
                    tabPinned: isPinnedTab,
                    tabSystemPinned: isSystemPinnedTab,
                    itemBasePath: getParentPath(tabPath),
                    createBasePath: tabPath,
                    showCreateActions: true,
                  });
                }}
                style={{
                  position: 'relative',
                  opacity: isDraggingTab ? 0.45 : 1,
                  gap: isPinnedTab ? 4 : undefined,
                  paddingLeft: isPinnedTab ? 9 : undefined,
                  paddingRight: isPinnedTab ? 10 : undefined,
                }}
              >
                {isCwdSystemTabHighlightVisible && (
                  <span
                    key={`cwd-system-tab-highlight-${cwdSystemTabHighlight.token}`}
                    className="terminal-sub-tab-change-ring"
                    aria-hidden="true"
                  />
                )}
                {showDropIndicator && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      bottom: 4,
                      [dropIndicatorSide === 'before' ? 'left' : 'right']: -1,
                      width: 2,
                      borderRadius: 999,
                      background: 'var(--accent)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
                {showFileManagerTabIcons && !isSystemPinnedTab && <Folder size={11} />}
                {isPinnedTab && !isSystemPinnedTab && <Pin size={9} className="opacity-[0.78] -ml-px -mr-0.5" />}
                <Tiptop
                  text={tabDropPreviewText || tabDefaultTiptopText}
                  placement="bottom"
                  forceVisible={showDropIndicator && Boolean(tabDropPreviewText)}
                >
                  {renderFileManagerTabTitle(tab, t)}
                </Tiptop>
                {!hideFileManagerTabCloseButton && fileManagerWorkspace.tabs.length > 1 && !isPinnedTab && (
                  <span
                    className="terminal-sub-tab-close"
                    onClick={(event) => { void handleCloseFileManagerTab(tab.id, event); }}
                  >
                    <X size={10} />
                  </span>
                )}
              </div>
            );
          })}
          {draggingFileManagerTabId && (
            <div
              onDragOver={(event) => {
                const draggedTabId = draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                const appendTarget = resolveFileManagerTabAppendTarget();
                if (!draggedTabId || !appendTarget || appendTarget.id === draggedTabId) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setFileManagerTabDropIndicator((current: FileManagerTabDropIndicator | null) => (
                  current?.tabId === appendTarget.id && current?.side === 'after'
                    ? current
                    : { tabId: appendTarget.id, side: 'after' }
                ));
              }}
              onDrop={(event) => {
                const draggedTabId = event.dataTransfer.getData('text/plain') || draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                const appendTarget = resolveFileManagerTabAppendTarget();
                if (!draggedTabId || !appendTarget || appendTarget.id === draggedTabId) {
                  clearFileManagerTabDragState();
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                reorderFileManagerTabs(draggedTabId, appendTarget.id, 'after');
                clearFileManagerTabDragState();
              }}
              className="flex-[1_0_24px] min-w-6 self-stretch"
            />
          )}
        </div>
        {fileManagerTabOverflow && (
          <button
            type="button"
            className={`terminal-sub-tab-nav terminal-sub-tab-nav-right${fileManagerTabCanScrollRight ? '' : ' disabled'}`}
            onClick={() => scrollFileManagerTabs(1)}
            aria-label={t('向右滚动标签')}
            title={t('向右滚动标签')}
            disabled={!fileManagerTabCanScrollRight}
          >
            <ChevronRight size={14} />
          </button>
        )}
        <div className="terminal-sub-tab-actions">
          {/* terminal-create-btn 为 terminal 标签栏系统类，保留并去掉 .btn 基类 */}
          <Button
            variant="ghost"
            size="sm"
            className="terminal-create-btn"
            onClick={() => { void handleCreateFileManagerTab(); }}
            aria-label={t('新建标签')}
            title={t('新建标签')}
          >
            <Plus size={14} />
            {t('新建标签')}
          </Button>
        </div>
      </div>
  );
}
