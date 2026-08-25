import {
  FolderOpen, FilePlus, FolderPlus, FileArchive, Download, Archive, PenLine,
  Lock, Trash2, Pin, X, Copy, Scissors, ClipboardPaste, SquarePen,
  MonitorSmartphone, PencilLine,
  type LucideIcon,
} from 'lucide-react';
import { Z } from '../../constants/zIndex.ts';
import { isArchive } from '../../utils/fileTypeClassify.ts';
import { isEditable } from '../../utils/fileManagerFormat.ts';
import { ContextMenu as UiContextMenu, type MenuItem as UiMenuItem } from '../ui';
import type { ContextMenuProps } from './fileManagerTypes.ts';

// Context menu component（视觉迁移：手写 DOM 换 ui/ContextMenu，业务条件原样映射为 items）
export default function ContextMenu({ pos, item, mode = 'item', isPinned = false, isSystemPinned = false, canTogglePinned = false, canCloseTab = false, showCreateActions = false, deleteItemCount = 1, clipboardItemCount = 1, canPaste = false, clipboardActionArrow = '', onClose, onDownload, onEdit, onOpenSystemEditor, onOpenWithEditor, onRename, onDelete, onMkdir, onNewFile, onCompress, onUncompress, onChmod, onCopyPath, onCopyItem, onCutItem, onPaste, onOpenInNewTab, onTogglePinned, onCloseTab, t }: ContextMenuProps) {
  const isTabMenu = mode === 'tab';
  const shouldShowCreateActions = showCreateActions || !item;
  const shouldShowDividerBeforeCreate = Boolean(item && shouldShowCreateActions);
  const shouldShowDeleteActions = Boolean(item) && !isTabMenu;
  const shouldShowDividerBeforeDelete = shouldShowDeleteActions;
  const icon = (Icon: LucideIcon) => <Icon size={14} />;

  return (
    <UiContextMenu x={pos.x} y={pos.y} items={((): UiMenuItem[] => {
      const entries: UiMenuItem[] = [];
      if (item && item.isDirectory) {
        entries.push({ label: t('在新标签页打开'), icon: icon(FolderOpen), onSelect: onOpenInNewTab });
      }
      if (isTabMenu && canTogglePinned && !isSystemPinned) {
        entries.push({ label: isPinned ? t('取消固定') : t('固定'), icon: icon(Pin), onSelect: onTogglePinned });
      }
      if (canCloseTab) {
        entries.push({ label: t('关闭标签'), icon: icon(X), onSelect: onCloseTab });
      }
      if (item) {
        entries.push({ label: t('复制路径'), icon: icon(Copy), onSelect: onCopyPath });
      }
      if (item && !isTabMenu) {
        entries.push({
          label: `${clipboardActionArrow === '<-' ? `${clipboardActionArrow} ${t('复制')}` : `${t('复制')}${clipboardActionArrow ? ` ${clipboardActionArrow}` : ''}`}${clipboardItemCount > 1 ? ` (${clipboardItemCount}${t('项')})` : ''}`,
          icon: icon(Copy),
          onSelect: onCopyItem,
        });
      }
      if (item && !isTabMenu) {
        entries.push({
          label: `${clipboardActionArrow === '<-' ? `${clipboardActionArrow} ${t('剪切')}` : `${t('剪切')}${clipboardActionArrow ? ` ${clipboardActionArrow}` : ''}`}${clipboardItemCount > 1 ? ` (${clipboardItemCount}${t('项')})` : ''}`,
          icon: icon(Scissors),
          onSelect: onCutItem,
        });
      }
      if (!isTabMenu && canPaste) {
        entries.push({ label: t('粘贴'), icon: icon(ClipboardPaste), onSelect: onPaste });
      }
      if (item && !item.isDirectory && isEditable(item.name)) {
        entries.push({ label: t('编辑'), icon: icon(SquarePen), onSelect: onEdit });
      }
      if (item && !item.isDirectory) {
        entries.push({ label: t('系统编辑器打开'), icon: icon(MonitorSmartphone), onSelect: onOpenSystemEditor });
      }
      if (item && !item.isDirectory) {
        entries.push({ label: t('指定编辑器打开'), icon: icon(PencilLine), onSelect: onOpenWithEditor });
      }
      if (item) {
        entries.push({ label: item.isDirectory ? t('下载文件夹到本地') : t('下载到本地'), icon: icon(Download), onSelect: onDownload });
      }
      if (item) {
        entries.push({ label: t('压缩 (tar.gz)'), icon: icon(Archive), onSelect: onCompress });
      }
      if (item && !item.isDirectory && isArchive(item.name)) {
        entries.push({ label: t('解压'), icon: icon(FileArchive), onSelect: onUncompress });
      }
      if (item && (!isTabMenu || !isSystemPinned)) {
        entries.push({ label: isTabMenu ? t('重命名标签标题') : t('重命名'), icon: icon(PenLine), onSelect: onRename });
      }
      if (item) {
        entries.push({ label: t('修改权限'), icon: icon(Lock), onSelect: onChmod });
      }
      if (shouldShowDividerBeforeCreate) {
        entries.push('separator');
      }
      if (shouldShowCreateActions) {
        entries.push({ label: t('新建文件'), icon: icon(FilePlus), onSelect: onNewFile });
        entries.push({ label: t('新建文件夹'), icon: icon(FolderPlus), onSelect: onMkdir });
      }
      if (shouldShowDividerBeforeDelete) {
        entries.push('separator');
      }
      if (shouldShowDeleteActions) {
        entries.push({
          label: `${t('删除')}${deleteItemCount > 1 ? ` (${deleteItemCount}${t('项')})` : ''}`,
          icon: icon(Trash2),
          danger: true,
          onSelect: onDelete,
        });
      }
      return entries;
    })()} onClose={onClose} zIndex={Z.MENU} />
  );
}
