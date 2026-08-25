import React from 'react';
import { Virtuoso } from 'react-virtuoso';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { EmptyState } from '../ui';
import { renderFileManagerVirtualRow } from './FileManagerVirtualRow.tsx';
import type { FileManagerController } from './fileManagerController.ts';
import type { FileManagerPaneStateLike } from './fileManagerTypes.ts';

// 虚拟滚动视口（Virtuoso + 可视区/滚动位置回写 + 空态/加载态）
export function renderFileManagerVirtualViewport(fm: FileManagerController, paneState: FileManagerPaneStateLike, options: Record<string, unknown> = {}) {
  const {
    t, activePaneKey,
    getPaneVirtuosoRefCallback, getPaneScrollerRefCallback,
    paneScrollerRefOptionsRef, paneVisibleRangesRef,
    fileListRef, inactivePaneListRefs, paneScrollerElementsRef,
    captureFileListViewAnchor, syncFileManagerPaneScrollTop, flushPendingRowEffects,
  } = fm;
    const normalizedPaneKey = paneState?.key === 'right' ? 'right' : 'left';
    const paneRows = Array.isArray(paneState?.rows) ? paneState.rows : [];
    const showEmptyState = options.loading !== true && Array.isArray(paneState?.items) && paneState.items.length === 0;

    const emptyPlaceholderComponent = showEmptyState
      ? () => (
        <EmptyState icon={<FolderOpen size={48} strokeWidth={1.5} />} text={t('目录为空')} />
      )
      : undefined;

    paneScrollerRefOptionsRef.current[normalizedPaneKey] = {
      active: options.active === true,
      scrollTop: paneState?.scrollTop,
    };

    return (
      <div className="file-list-viewport">
        <div className="file-list-body h-full">
          <Virtuoso
            ref={getPaneVirtuosoRefCallback(normalizedPaneKey)}
            className="h-full"
            data={paneRows}
            computeItemKey={(index, row) => row?.rowKey || `${normalizedPaneKey}-${index}`}
            scrollerRef={getPaneScrollerRefCallback(normalizedPaneKey)}
            rangeChanged={(range) => {
              paneVisibleRangesRef.current[normalizedPaneKey] = range;
              const listElement = normalizedPaneKey === activePaneKey
                ? fileListRef.current
                : (inactivePaneListRefs.current[normalizedPaneKey] || paneScrollerElementsRef.current[normalizedPaneKey]);
              if (listElement) {
                captureFileListViewAnchor(normalizedPaneKey, listElement);
                if (options.active !== true) {
                  syncFileManagerPaneScrollTop(normalizedPaneKey, listElement);
                }
              }
              flushPendingRowEffects(normalizedPaneKey, paneRows, listElement);
            }}
            itemContent={(index, row) => renderFileManagerVirtualRow(fm, row, paneState, {
              interactive: options.active === true,
              oppositePanePath: options.oppositePanePath || '',
            })}
            components={emptyPlaceholderComponent ? { EmptyPlaceholder: emptyPlaceholderComponent } : {}}
          />
        </div>
        {options.loading === true && (
          <div className="file-list-loading" role="status" aria-live="polite">
            <div className="file-list-loading-spinner">
              <RefreshCw className="animate-[spin_1s_linear_infinite]" size={28} />
            </div>
            <div className="file-list-loading-text">{t('加载中...')}</div>
          </div>
        )}
      </div>
    );
}

// 双面板布局下的非激活面板（点击/右键聚焦激活，拖拽目标高亮）
export function renderInactiveFileManagerPane(fm: FileManagerController, paneState: FileManagerPaneStateLike) {
  const {
    t, fileManagerPaneDropTarget, setFileManagerPaneDropTarget,
    closeContextMenu, activateFileManagerPane,
    handleDualPaneTransferDragOver, handleDualPaneTransferDrop, hideFileManagerDragTip,
  } = fm;
    const isDropTarget = fileManagerPaneDropTarget === paneState.key;
    return (
      <div
        key={`inactive-pane-${paneState.key}`}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: paneState.key === 'left' ? '1px solid var(--border)' : 'none',
          overflow: 'hidden',
          background: isDropTarget ? 'var(--accent-dim)' : 'var(--surface-raised)',
          position: 'relative',
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeContextMenu();
          void activateFileManagerPane(paneState.key);
        }}
        onDragEnter={(event) => {
          handleDualPaneTransferDragOver(event, paneState);
        }}
        onDragOver={(event) => {
          handleDualPaneTransferDragOver(event, paneState);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) {
            return;
          }
          hideFileManagerDragTip();
          setFileManagerPaneDropTarget((current) => current === paneState.key ? '' : current);
        }}
        onDrop={(event) => {
          void handleDualPaneTransferDrop(event, paneState);
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-t-2 border-t-transparent border-b border-line bg-canvas">
          <span className="text-sm font-semibold text-primary">{String(paneState.label ?? '')}</span>
          <span className="text-xs text-secondary truncate">{String(paneState.path || '/')}</span>
        </div>
        <div className="file-list flex-1 min-w-0">
          <div className="file-list-header">
            <span className="file-col-name">{t('名称')} {paneState.sortField === 'name' ? (paneState.sortDir === 'asc' ? '↑' : '↓') : ''}</span>
            <span className="file-col-size">{t('大小')} {paneState.sortField === 'size' ? (paneState.sortDir === 'asc' ? '↑' : '↓') : ''}</span>
            <span className="file-col-permission">{t('权限')} {paneState.sortField === 'permissions' ? (paneState.sortDir === 'asc' ? '↑' : '↓') : ''}</span>
            <span className="file-col-modified">{t('修改时间')} {paneState.sortField === 'modified' ? (paneState.sortDir === 'asc' ? '↑' : '↓') : ''}</span>
            <span className="file-col-actions"></span>
          </div>
          {renderFileManagerVirtualViewport(fm, paneState, { active: false, loading: false })}
        </div>
        <button
          type="button"
          aria-label={t('点击以聚焦此窗口')}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            closeContextMenu();
            void activateFileManagerPane(paneState.key);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeContextMenu();
            void activateFileManagerPane(paneState.key);
          }}
          onDragEnter={(event) => {
            handleDualPaneTransferDragOver(event, paneState);
          }}
          onDragOver={(event) => {
            handleDualPaneTransferDragOver(event, paneState);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) {
              return;
            }
            hideFileManagerDragTip();
            setFileManagerPaneDropTarget((current: string) => current === paneState.key ? '' : current);
          }}
          onDrop={(event) => {
            void handleDualPaneTransferDrop(event, paneState);
          }}
          className="absolute inset-0 bg-transparent border-none cursor-pointer"
        />
      </div>
    );
}
