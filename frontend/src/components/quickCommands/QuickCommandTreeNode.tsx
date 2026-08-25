import { useEffect, useState } from 'react';
import type React from 'react';
import { Folder } from 'lucide-react';
import { useTranslation } from '../../i18n.ts';
import Tiptop from '../Tiptop.tsx';
import type { ContextMenuState, QuickCommandItem } from './quickCommandTypes.ts';

export interface TreeNodeProps {
  item: QuickCommandItem;
  index: number;
  path: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  contextMenu: ContextMenuState | null;
  onContextMenu: (e: React.MouseEvent, path: string, type: 'group' | 'command', index: number) => void;
  closeContextMenu: () => void;
  onExecute: (item: QuickCommandItem) => void;
  onMove: (path: string, direction: number) => void;
  onDragStart: (path: string) => void;
  onDropItem: (path: string, pos: string) => void;
  onDragEnd: () => void;
  dragVersion: number;
}

export function TreeNode({
  item,
  index,
  path,
  selectedPath,
  onSelect,
  contextMenu,
  onContextMenu,
  closeContextMenu,
  onExecute,
  onMove,
  onDragStart,
  onDropItem,
  onDragEnd,
  dragVersion,
}: TreeNodeProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const [dropPos, setDropPos] = useState<'before' | 'inside' | 'after' | null>(null);

  useEffect(() => { setDropPos(null); }, [dragVersion]);

  const arrowBtn = (dir: number) => (
    <Tiptop text={dir === -1 ? t('上移') : t('下移')}>
      <span
        onClick={(e) => { e.stopPropagation(); onMove?.(path, dir); }}
        className="text-[10px] cursor-pointer text-muted px-[3px] leading-[14px] select-none"
        style={{ visibility: hover ? 'visible' : 'hidden' }}
      >
        {dir === -1 ? '▲' : '▼'}
      </span>
    </Tiptop>
  );

  const commonDragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', path);
      onDragStart?.(path);
    },
    onDragEnd: (e: React.DragEvent) => { e.stopPropagation(); onDragEnd?.(); },
  };

  const calcDropPos = (e: React.DragEvent, allowInside: boolean): 'before' | 'inside' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (y < 0.25) return 'before';
    if (allowInside && y < 0.75) return 'inside';
    return 'after';
  };

  const dropIndicator = (pos: 'before' | 'after') => {
    if (dropPos !== pos) return null;

    return (
      <div
        className="absolute left-1 right-1 h-0.5 bg-success rounded-full z-[5]"
        style={{ [pos === 'before' ? 'top' : 'bottom']: -1 }}
      />
    );
  };

  if (item.type === 'group') {
    const isExpanded = item.expanded !== false;
    const isSelected = selectedPath === path;
    const childrenList = item._filteredChildren || item.children;
    return (
      <div className="relative">
        {dropIndicator('before')}
        {dropIndicator('after')}
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, true)); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, true)); }}
          onDragLeave={(e) => { e.stopPropagation(); setDropPos(null); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const pos = dropPos; setDropPos(null); onDropItem?.(path, pos || 'inside'); }}
        >
          <div
            onClick={() => onSelect(path)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, path, 'group', index); }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            {...commonDragProps}
            className={`flex items-center gap-1 px-2 py-[5px] cursor-pointer rounded-xs text-base select-none transition-colors duration-100 ${
              dropPos === 'inside'
                ? 'bg-active outline outline-1 outline-dashed outline-accent'
                : isSelected
                  ? 'bg-active text-primary'
                  : hover
                    ? 'bg-hover text-primary'
                    : 'text-secondary'
            }`}
          >
            <span className="text-[10px] w-3.5 text-center shrink-0">
              {isExpanded ? '▼' : '▶'}
            </span>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm">
              <Folder size={14} className="shrink-0" /> {item.name}
            </span>
            {arrowBtn(-1)}
            {arrowBtn(1)}
          </div>
          {isExpanded && childrenList && childrenList.map((child, ci) => (
            <div key={ci} className="pl-4">
              <TreeNode
                item={child}
                index={ci}
                path={`${path}/${ci}`}
                selectedPath={selectedPath}
                onSelect={onSelect}
                contextMenu={contextMenu}
                onContextMenu={onContextMenu}
                closeContextMenu={closeContextMenu}
                onExecute={onExecute}
                onMove={onMove}
                onDragStart={onDragStart}
                onDropItem={onDropItem}
                onDragEnd={onDragEnd}
                dragVersion={dragVersion}
              />
            </div>
          ))}
          {isExpanded && (!item.children || item.children.length === 0) && (
            <div className="italic py-1 pr-2 pl-[30px] text-xs text-muted">
              {t('(空分组，右键添加命令)')}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isSelected = selectedPath === path;
  return (
    <div className="relative">
      {dropIndicator('before')}
      {dropIndicator('after')}
      <div
        onClick={() => onSelect(path)}
        onDoubleClick={(e) => { e.stopPropagation(); onExecute(item); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, path, 'command', index); }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, false)); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDropPos(calcDropPos(e, false)); }}
        onDragLeave={(e) => { e.stopPropagation(); setDropPos(null); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const pos = calcDropPos(e, false); setDropPos(null); onDropItem?.(path, pos || 'after'); }}
        {...commonDragProps}
        className={`flex items-center px-2 py-[5px] cursor-pointer rounded-xs text-sm select-none transition-colors duration-100 ${
          isSelected ? 'bg-active text-primary' : (hover ? 'bg-hover text-primary' : 'text-secondary')
        }`}
      >
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {item.name}
        </span>
        {arrowBtn(-1)}
        {arrowBtn(1)}
      </div>
    </div>
  );
}
