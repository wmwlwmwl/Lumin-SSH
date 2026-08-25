import React from 'react';
import { ChevronLeft, ChevronRight, Plus, Folder, Pin, X } from 'lucide-react';
import { renderFileManagerTabTitle } from '../../utils/fileManagerHelpers.tsx';
import { Button } from '../ui';
import { renderFileManagerVirtualViewport, renderInactiveFileManagerPane } from './FileManagerPanes.tsx';
import type { FileManagerController } from './fileManagerController.ts';

// 内容区：双面板侧栏（历史标签）+ 激活面板（列头排序/虚拟列表视口）+
// 非激活面板，以及 typeahead HUD
export function renderFileManagerContent(fm: FileManagerController) {
  const {
    t, isDualPaneLayout,
    fileManagerSidebarOpen, setFileManagerSidebarOpen, handleCreateFileManagerTab,
    fileManagerWorkspace, currentPaneTabId,
    activateFileManagerTab, handleCloseFileManagerTab,
    showFileManagerTabIcons, hideFileManagerTabCloseButton,
    activePaneKey, activePaneLabel, currentPath, loading,
    fileListTypeaheadQuery, handleSort, sortField, sortDir,
    currentFileManagerPane, leftFileManagerPane, rightFileManagerPane,
    activateFileManagerPane,
  } = fm;
  return (
    <>
      {/* Content area: file list + optional split editor */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {isDualPaneLayout && (
          <div className="flex shrink-0 items-stretch gap-2">
            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label={fileManagerSidebarOpen ? t('收起标签侧栏') : t('展开标签侧栏')}
                title={fileManagerSidebarOpen ? t('收起标签侧栏') : t('展开标签侧栏')}
                onClick={() => setFileManagerSidebarOpen((current) => !current)}
              >
                {fileManagerSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('新建标签')}
                title={t('新建标签')}
                onClick={() => { void handleCreateFileManagerTab(); }}
              >
                <Plus size={14} />
              </Button>
            </div>
            {fileManagerSidebarOpen && (
              <div className="w-[220px] min-w-[220px] border border-line rounded-md bg-raised flex flex-col overflow-hidden">
                <div className="py-2.5 px-3 border-b border-line text-sm font-semibold text-primary">{t('历史标签')}</div>
                <div className="flex flex-col gap-1.5 p-2 overflow-y-auto">
                  {fileManagerWorkspace.tabs.map((tab) => {
                    const isSidebarActive = tab.id === currentPaneTabId;
                    const isPinnedTab = tab.pinned === true;
                    const isSystemPinnedTab = tab.systemPinned === true;
                    return (
                      <button
                        key={`sidebar-tab-${tab.id}`}
                        type="button"
                        onClick={() => { void activateFileManagerTab(tab.id); }}
                        onDoubleClick={(event) => { void handleCloseFileManagerTab(tab.id, event); }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void activateFileManagerTab(tab.id);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: isPinnedTab ? 6 : 8,
                          width: '100%',
                          padding: isPinnedTab ? '8px 10px 8px 8px' : '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid',
                          borderColor: isSidebarActive ? 'var(--accent)' : 'var(--border)',
                          background: isSidebarActive ? 'var(--surface-overlay)' : 'transparent',
                          color: isSidebarActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {showFileManagerTabIcons && !isSystemPinnedTab && <Folder size={12} />}
                        {isPinnedTab && !isSystemPinnedTab && <Pin size={10} className="opacity-[0.78] -ml-px -mr-0.5" />}
                        <span className="flex-1 min-w-0 truncate">{renderFileManagerTabTitle(tab, t)}</span>
                        {!hideFileManagerTabCloseButton && fileManagerWorkspace.tabs.length > 1 && !isPinnedTab && (
                          <span
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleCloseFileManagerTab(tab.id, event);
                            }}
                            className="inline-flex items-center"
                          >
                            <X size={11} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {isDualPaneLayout && activePaneKey === 'right' && renderInactiveFileManagerPane(fm, leftFileManagerPane)}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            border: 'none',
            borderRight: isDualPaneLayout && activePaneKey === 'left' ? '1px solid var(--border)' : 'none',
            borderRadius: 0,
            overflow: 'hidden',
            background: isDualPaneLayout ? 'var(--surface-raised)' : 'transparent',
          }}
          onMouseDown={(event) => {
            if (!isDualPaneLayout || event.button !== 0) {
              return;
            }
            void activateFileManagerPane(activePaneKey);
          }}
        >
          {isDualPaneLayout && (
            <div className="flex items-center gap-2 px-3 py-2 border-t-2 border-accent border-b border-line bg-canvas">
              <span className="text-sm font-semibold text-accent">{activePaneLabel}</span>
              <span className="text-xs text-secondary truncate">{currentPath || '/'}</span>
            </div>
          )}
          <div className="file-list flex-1 min-w-0" aria-busy={loading}>
            {fileListTypeaheadQuery ? (
              <div className="file-list-typeahead-hud">{fileListTypeaheadQuery}</div>
            ) : null}
            <div className="file-list-header">
              <span className="file-col-name cursor-pointer" onClick={() => handleSort('name')}>
                {t('名称')} {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </span>
              <span className="file-col-size cursor-pointer" onClick={() => handleSort('size')}>
                {t('大小')} {sortField === 'size' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </span>
              <span className="file-col-permission cursor-pointer" onClick={() => handleSort('permissions')}>
                {t('权限')} {sortField === 'permissions' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </span>
              <span className="file-col-modified cursor-pointer" onClick={() => handleSort('modified')}>
                {t('修改时间')} {sortField === 'modified' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </span>
              <span className="file-col-actions"></span>
            </div>

            {renderFileManagerVirtualViewport(fm, currentFileManagerPane, {
              active: true,
              loading,
              oppositePanePath: activePaneKey === 'right' ? leftFileManagerPane.path : rightFileManagerPane.path,
            })}
          </div>
        </div>
        {isDualPaneLayout && activePaneKey === 'left' && renderInactiveFileManagerPane(fm, rightFileManagerPane)}
      </div>
    </>
  );
}
