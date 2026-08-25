import { ChevronDown, ChevronUp, Folder, FolderOpen, Trash } from 'lucide-react';
import type React from 'react';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';

export interface ServerGroupHeaderProps {
  groupName: string;
  count: number;
  collapsed: boolean;
  selectionMode: boolean;
  isGroupSelected: (g: string) => boolean;
  isGroupPartiallySelected: (g: string) => boolean;
  handleGroupToggleSelect: (g: string) => void;
  toggleGroup: (g: string) => void;
  openGroupHeaderMenu: (e: React.MouseEvent, g: string) => void;
  onGroupDelete?: (groupName: string, ids: string[]) => void;
  allGroupServerIds: Record<string, string[]>;
  moveGroup: (g: string, dir: number) => void;
  isTableView?: boolean;
}

export function ServerGroupHeader({
  groupName,
  count,
  collapsed,
  selectionMode,
  isGroupSelected,
  isGroupPartiallySelected,
  handleGroupToggleSelect,
  toggleGroup,
  openGroupHeaderMenu,
  onGroupDelete,
  allGroupServerIds,
  moveGroup,
  isTableView = false,
}: ServerGroupHeaderProps) {
  const { t } = useTranslation();

  const content = (
    <>
      {selectionMode && (
        <div
          className={cn('custom-checkbox', isGroupSelected(groupName) ? 'checked' : (isGroupPartiallySelected(groupName) ? 'indeterminate' : ''))}
          onClick={(e) => {
            e.stopPropagation();
            handleGroupToggleSelect(groupName);
          }}
        >
          {isGroupSelected(groupName) ? (
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (isGroupPartiallySelected(groupName) ? (
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="12" x2="20" y2="12" />
            </svg>
          ) : null)}
        </div>
      )}
      <span onClick={() => toggleGroup(groupName)} className={cn('items-center gap-1.5 cursor-pointer flex-1', isTableView ? 'inline-flex' : 'flex')}>
        {collapsed ? <Folder size={isTableView ? 13 : 14} /> : <FolderOpen size={isTableView ? 13 : 14} />}
        <span>{groupName || t('未分组')}</span>
        <span className="text-xs text-tertiary">({count})</span>
      </span>
      {selectionMode && groupName && onGroupDelete && (
        <Tiptop text={t('删除分组')} placement="bottom">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const ids = allGroupServerIds[groupName];
              if (ids && ids.length > 0 && onGroupDelete) {
                onGroupDelete(groupName, ids);
              }
            }}
            className={cn('bg-transparent border-none cursor-pointer p-0.5 text-danger rounded-sm', isTableView ? 'inline-flex' : 'flex')}
            aria-label={t('删除分组')}
          >
            <Trash size={isTableView ? 12 : 13} />
          </button>
        </Tiptop>
      )}
      {groupName && (
        <span className={cn('gap-0.5', isTableView ? 'inline-flex' : 'flex')}>
          <Tiptop text={t('上移')}>
            <button onClick={(e) => { e.stopPropagation(); moveGroup(groupName, -1); }} className={cn('bg-transparent border-none cursor-pointer p-0.5 text-tertiary', isTableView ? 'inline-flex' : 'flex')} aria-label={t('上移')}>
              <ChevronUp size={isTableView ? 12 : 13} />
            </button>
          </Tiptop>
          <Tiptop text={t('下移')}>
            <button onClick={(e) => { e.stopPropagation(); moveGroup(groupName, 1); }} className={cn('bg-transparent border-none cursor-pointer p-0.5 text-tertiary', isTableView ? 'inline-flex' : 'flex')} aria-label={t('下移')}>
              <ChevronDown size={isTableView ? 12 : 13} />
            </button>
          </Tiptop>
        </span>
      )}
    </>
  );

  if (isTableView) {
    return (
      <tr key={`__group_${groupName || 'ungrouped'}`}>
        <td
          colSpan={6 + (selectionMode ? 1 : 0)}
          onContextMenu={(e) => openGroupHeaderMenu(e, groupName)}
          className="px-2 py-1.5 text-base text-secondary font-medium select-none bg-sunken"
        >
          <span className="inline-flex items-center gap-1.5 w-full">
            {content}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <div
      key={`__group_${groupName || 'ungrouped'}`}
      onContextMenu={(e) => openGroupHeaderMenu(e, groupName)}
      className={cn(
        'col-span-full flex items-center gap-1.5 py-1 pt-2 mt-1 border-t border-line-subtle text-sm text-secondary font-medium select-none',
        collapsed ? 'mb-0' : 'mb-1',
      )}
    >
      {content}
    </div>
  );
}
