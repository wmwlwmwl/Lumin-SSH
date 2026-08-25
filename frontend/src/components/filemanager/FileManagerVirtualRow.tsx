import React from 'react';
import { FolderUp, RefreshCw, SquarePen, Download, PenLine, Trash2 } from 'lucide-react';
import { isArchive, isBinaryLike, isViewable } from '../../utils/fileTypeClassify.ts';
import {
  FILE_MANAGER_INTERNAL_DRAG_MIME,
  FILE_MANAGER_VIRTUAL_ROW_ITEM,
  FILE_MANAGER_VIRTUAL_ROW_PARENT,
  fmtDate,
  fmtSize,
  formatPermissionDisplay,
  fileIcon,
  getParentPath,
  isEditable,
} from '../../utils/fileManagerHelpers.tsx';
import Tiptop from '../Tiptop.tsx';
import { Button } from '../ui';
import RenameInput from './RenameInput.tsx';
import type { FileManagerController } from './fileManagerController.ts';
import type { FileManagerPaneStateLike, FileManagerVirtualRow } from './fileManagerTypes.ts';
import type { FileManagerVirtualRow as VRow } from '../../utils/fileManagerItems.ts';

// 虚拟列表行渲染：父目录行（..）与文件/文件夹行（选中态、行动画、
// 双击打开、右键菜单、双面板拖拽源、行内重命名与快捷操作按钮）
export function renderFileManagerVirtualRow(fm: FileManagerController, row: VRow, paneState: FileManagerPaneStateLike, options: Record<string, unknown> = {}) {
  const {
    t, sessionId, addToast,
    loadDir, normalizePath, joinPath, isDeletedPlaceholderItem,
    renamingItem, setRenamingItem, renamingInputMountedRef, confirmRename,
    setSelectedPaths, selectedPathsRef, fileListRef, setContextMenu,
    contextMenuTargetPath, clipboard, activeRowEffects, effectiveLocatorActiveRowKey,
    fileManagerDoubleClickUncompressArchive, fileManagerDualPaneDragTransferEnabled,
    isDualPaneLayout, activePaneKey,
    buildFileManagerDragPayload, internalFileManagerDragPayloadRef,
    updateFileManagerDragTip, setFileManagerPaneDropTarget, hideFileManagerDragTip,
    navigate, handleUncompress, handleEdit, handleOpenSystemEditor, handleOpenWithEditor,
    defaultOpenMode, handleChmod, handleDownload, startRename,
    handleDelete, operationInProgressRef, openingFiles,
    lastClickedPathRef,
  } = fm;
    const isInteractive = options.interactive === true;
    const basePath = paneState?.path || '/';
    const normalizedBasePath = normalizePath(basePath) || '/';

    if (row?.rowType === FILE_MANAGER_VIRTUAL_ROW_PARENT) {
      return (
        <div
          data-file-row-key={row.rowKey}
          className="file-item"
          onDoubleClick={isInteractive ? () => {
            const parent = getParentPath(normalizedBasePath);
            void loadDir(parent, {
              preserveView: false,
              trackDiff: false,
              showLoading: true,
            });
          } : undefined}
          onClick={isInteractive ? (event) => {
            if ((event.detail || 1) >= 2) return;
            if (renamingItem) {
              const staleRenameEl = renamingInputMountedRef.current;
              if (!(staleRenameEl && document.body.contains(staleRenameEl))) {
                void confirmRename(staleRenameEl ? staleRenameEl.value : '');
              }
            }
            setSelectedPaths([]);
            fileListRef.current?.focus();
          } : undefined}
        >
          <div className="file-name-cell">
            <span className="file-icon"><FolderUp size={16} /></span>
            <span className="file-name is-dir">..</span>
          </div>
          <span className="file-col-size" />
          <span className="file-col-permission" />
          <span className="file-col-modified" />
          <span className="file-col-actions" />
        </div>
      );
    }

    const item = row?.item;
    if (!item) {
      return null;
    }

    const itemPath = row.logicalPath || joinPath(normalizedBasePath, item.name);
    const rowKey = row.rowKey || item.__rowKey || itemPath;
    const isDeletedPlaceholder = isDeletedPlaceholderItem(item);
    const isSelected = Array.isArray(paneState?.selectedPaths) && paneState.selectedPaths.includes(itemPath);
    const isContextMenuAnchor = contextMenuTargetPath === itemPath;
    const isLocatorActive = rowKey === effectiveLocatorActiveRowKey;
    const clipboardMode = isDeletedPlaceholder ? '' : (clipboard?.paths?.includes(itemPath) ? clipboard.mode : '');
    const rowEffectState = activeRowEffects[rowKey] || null;
    const rowEffect = rowEffectState?.effect || '';
    const rowEffectDurationMs = Number(rowEffectState?.durationMs || 0);
    const rowEffectElapsedMs = rowEffectState?.startedAt
      ? Math.max(0, Date.now() - Number(rowEffectState.startedAt || 0))
      : 0;
    const permissionDisplay = formatPermissionDisplay(item.permission || '-');

    const handleItemClick = (event: React.MouseEvent) => {
      if (!isInteractive || isDeletedPlaceholder) return;
      if ((event.detail || 1) >= 2) return;
      // 重命名 input 已被虚拟化卸载时（renamingItem 残留、onBlur 不会触发），
      // 先提交残留重命名（读取脱离 DOM 元素的最后值），再处理本次点击
      if (renamingItem) {
        const staleRenameEl = renamingInputMountedRef.current;
        if (!(staleRenameEl && document.body.contains(staleRenameEl))) {
          void confirmRename(staleRenameEl ? staleRenameEl.value : '');
        }
      }
      fileListRef.current?.focus();
      if (event.ctrlKey || event.metaKey) {
        setSelectedPaths((previousSelectedPaths: string[]) => (
          previousSelectedPaths.includes(itemPath)
            ? previousSelectedPaths.filter((path: string) => path !== itemPath)
            : [...previousSelectedPaths, itemPath]
        ));
        lastClickedPathRef.current = itemPath;
      } else if (event.shiftKey && lastClickedPathRef.current) {
        window.getSelection()?.removeAllRanges();
        const lastIndex = paneState.rows.findIndex((entry: FileManagerVirtualRow) => entry?.logicalPath === lastClickedPathRef.current);
        const currentIndex = paneState.rows.findIndex((entry: FileManagerVirtualRow) => entry?.logicalPath === itemPath);
        if (lastIndex >= 0 && currentIndex >= 0) {
          const startIndex = Math.min(lastIndex, currentIndex);
          const endIndex = Math.max(lastIndex, currentIndex);
          setSelectedPaths(
            paneState.rows
              .slice(startIndex, endIndex + 1)
              .filter((entry: FileManagerVirtualRow) => entry?.rowType === FILE_MANAGER_VIRTUAL_ROW_ITEM && !isDeletedPlaceholderItem(entry?.item))
              .map((entry: FileManagerVirtualRow) => entry.logicalPath)
          );
        }
      } else {
        setSelectedPaths([itemPath]);
        lastClickedPathRef.current = itemPath;
      }
    };

    const rowStyle: React.CSSProperties = isDeletedPlaceholder ? ({ '--file-row-height': `${item.__rowHeight || 36}px` } as React.CSSProperties) : {};
    if (rowEffect && rowEffectDurationMs > 0) {
      rowStyle.animationDuration = `${rowEffectDurationMs}ms`;
      rowStyle.animationDelay = `-${Math.min(rowEffectElapsedMs, Math.max(0, rowEffectDurationMs - 16))}ms`;
    }

    return (
      <div
        key={rowKey}
        data-file-row-key={rowKey}
        className={`file-item${isSelected ? ' selected' : ''}${isContextMenuAnchor ? ' context-menu-anchor' : ''}${isLocatorActive ? ' file-item-locator-active' : ''}${clipboardMode === 'copy' ? ' clipboard-copy' : ''}${clipboardMode === 'cut' ? ' clipboard-cut' : ''}${isDeletedPlaceholder ? ' deleted-placeholder' : ''}${rowEffect ? ` visual-effect visual-effect-${rowEffect}` : ''}`}
        style={Object.keys(rowStyle).length > 0 ? rowStyle : undefined}
        draggable={isInteractive && isDualPaneLayout && fileManagerDualPaneDragTransferEnabled && !isDeletedPlaceholder}
        onDragStart={isInteractive ? (event) => {
          const payload = buildFileManagerDragPayload(itemPath);
          if (!payload) {
            event.preventDefault();
            return;
          }
          internalFileManagerDragPayloadRef.current = payload;
          event.dataTransfer.effectAllowed = 'copyMove';
          event.dataTransfer.setData(FILE_MANAGER_INTERNAL_DRAG_MIME, JSON.stringify(payload));
          event.dataTransfer.setData('text/plain', payload.paths.join('\n'));
          updateFileManagerDragTip(event.clientX, event.clientY, options.oppositePanePath || normalizedBasePath, event.ctrlKey);
          setFileManagerPaneDropTarget(activePaneKey === 'right' ? 'left' : 'right');
        } : undefined}
        onDragEnd={isInteractive ? () => {
          internalFileManagerDragPayloadRef.current = null;
          hideFileManagerDragTip();
          setFileManagerPaneDropTarget('');
        } : undefined}
        onClick={isInteractive ? handleItemClick : undefined}
        onDoubleClick={isInteractive ? () => {
          if (isDeletedPlaceholder) return;
          setSelectedPaths([itemPath]);
          lastClickedPathRef.current = itemPath;
          if (item.isDirectory) {
            navigate(item);
          } else if (isArchive(item.name)) {
            // 压缩包永不进入编辑器路径：开关开启时解压，否则仅提示
            if (fileManagerDoubleClickUncompressArchive) {
              void handleUncompress(item);
            } else {
              addToast?.(t('该文件是压缩包，可通过右键菜单解压'), 'warning');
            }
          } else if (isBinaryLike(item.name)) {
            // 二进制文件不适合编辑，直接拦截
            addToast?.(t('该文件类型不适合用编辑器打开'), 'warning');
          } else if (isEditable(item.name)) {
            void handleEdit(item);
          } else if (isViewable(item.name)) {
            // 媒体类可看不可编：一律走系统关联程序，不受“指定编辑器”模式影响
            // readOnly=true：只下载查看，不监听修改回写远程
            void handleOpenSystemEditor({ path: itemPath, name: item.name, size: item.size }, '', true);
          } else {
            const file = { path: itemPath, name: item.name };
            if (defaultOpenMode === 'external') {
              void handleOpenWithEditor(file, '', false);
            } else {
              void handleOpenSystemEditor(file, '');
            }
          }
        } : undefined}
        onContextMenu={isInteractive ? (event) => {
          if (isDeletedPlaceholder) return;
          event.preventDefault();
          event.stopPropagation();
          const currentSelectedPaths = selectedPathsRef.current;
          const useSelectedPathsDelete = currentSelectedPaths.length > 1 && currentSelectedPaths.includes(itemPath);
          const useSelectedPathsClipboard = currentSelectedPaths.length > 1 && currentSelectedPaths.includes(itemPath);
          setContextMenu({
            pos: { x: event.clientX, y: event.clientY },
            item,
            mode: 'item',
            itemBasePath: normalizedBasePath,
            createBasePath: normalizedBasePath,
            showCreateActions: false,
            deleteUsesSelectedPaths: useSelectedPathsDelete,
            deleteItemCount: useSelectedPathsDelete ? currentSelectedPaths.length : 1,
            clipboardUsesSelectedPaths: useSelectedPathsClipboard,
            clipboardItemCount: useSelectedPathsClipboard ? currentSelectedPaths.length : 1,
          });
        } : undefined}
      >
        <div className="file-name-cell">
          <span className="file-icon">
            {openingFiles.has(`${sessionId}:${itemPath}`) ? (
              <RefreshCw className="animate-[spin_1s_linear_infinite] text-accent" size={14} />
            ) : (
              fileIcon(item.name, item.isDirectory, item.isSymlink)
            )}
          </span>
          {isInteractive && renamingItem?.name === item.name ? (
            <RenameInput
              initialValue={item.name}
              isDirectory={item.isDirectory}
              mountedRef={renamingInputMountedRef}
              onConfirm={(value, refocus) => confirmRename(value, refocus)}
              onCancel={() => {
                setRenamingItem(null);
                fileListRef.current?.focus();
              }}
            />
          ) : (
            <span className={`file-name ${item.isDirectory ? 'is-dir' : ''}${isDeletedPlaceholder ? ' is-deleted-placeholder' : ''}`}>
              {item.name}
            </span>
          )}
        </div>

        <span className="file-size file-col-size">{item.isDirectory ? '-' : fmtSize(item.size)}</span>
        <span
          className="file-permission file-col-permission"
          title={permissionDisplay}
          onClick={isInteractive ? (event) => {
            if (isDeletedPlaceholder) return;
            event.stopPropagation();
            void handleChmod(item, normalizedBasePath);
          } : undefined}
        >
          {permissionDisplay}
        </span>
        <span className="file-date file-col-modified">{fmtDate(item.modifyTime)}</span>

        {isInteractive ? (
          <div className="file-actions file-col-actions">
            {!item.isDirectory && isEditable(item.name) && (
              <Tiptop text={openingFiles.has(`${sessionId}:${itemPath}`) ? t('正在打开文件...') : t('编辑')}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('编辑')}
                  disabled={openingFiles.has(`${sessionId}:${itemPath}`)}
                  onClick={(event) => { event.stopPropagation(); void handleEdit(item); }}
                >
                  {openingFiles.has(`${sessionId}:${itemPath}`) ? <RefreshCw className="animate-[spin_1s_linear_infinite]" size={14} /> : <SquarePen size={14} />}
                </Button>
              </Tiptop>
            )}
            <Tiptop text={item.isDirectory ? t('下载文件夹到本地') : t('下载到本地')}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={item.isDirectory ? t('下载文件夹到本地') : t('下载到本地')}
                onClick={(event) => { event.stopPropagation(); void handleDownload(item, { basePath: normalizedBasePath }); }}
              ><Download size={14} /></Button>
            </Tiptop>
            <Tiptop text={t('重命名')}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('重命名')}
                onClick={(event) => { event.stopPropagation(); startRename(item); }}
              ><PenLine size={14} /></Button>
            </Tiptop>
            <Tiptop text={t('删除')}>
              {/* text-danger 工具类保留危险色，hover 行为与 ghost 变体一致 */}
              <Button
                variant="ghost"
                size="icon"
                className="text-danger"
                aria-label={t('删除')}
                onClick={(event) => {
                  event.stopPropagation();
                  if (operationInProgressRef.current) {
                    addToast?.(t('有操作正在进行，请稍候'), 'warning');
                  } else {
                    void handleDelete(item);
                  }
                }}
                ><Trash2 size={14} /></Button>
            </Tiptop>
          </div>
        ) : (
          <span className="file-col-actions" />
        )}
      </div>
    );
}
