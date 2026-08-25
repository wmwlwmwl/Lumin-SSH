import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import type React from 'react';
import { Z } from '../../constants/zIndex.ts';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import { Button, EmptyState } from '../ui';
import { fmem, ROW_H, TABLE_MIN_WIDTH, type ProcessContextMenu, type ProcessInfo } from './processTypes.ts';

export interface ProcessTableProps {
  processes: ProcessInfo[] | null;
  filtered: ProcessInfo[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  searchQuery: string;
  selectedPids: Set<string>;
  onSelectAll: () => void;
  onToggleSelect: (pid: string) => void;
  sortKey: string;
  sortAsc: boolean;
  onSort: (key: string) => void;
  onStartColResize: (colKey: string, e: React.MouseEvent) => void;
  tableColumns: string;
  visibleRange: { start: number; end: number };
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onRowClick: (p: ProcessInfo) => void;
  onRowContextMenu: (e: React.MouseEvent, p: ProcessInfo) => void;
  contextMenu: ProcessContextMenu | null;
  activePid: string | null;
}

export function ProcessTable({
  processes,
  filtered,
  loading,
  error,
  onRetry,
  searchQuery,
  selectedPids,
  onSelectAll,
  onToggleSelect,
  sortKey,
  sortAsc,
  onSort,
  onStartColResize,
  tableColumns,
  visibleRange,
  scrollRef,
  onScroll,
  onRowClick,
  onRowContextMenu,
  contextMenu,
  activePid,
}: ProcessTableProps) {
  const { t } = useTranslation();

  const renderSortIcon = (col: string) => {
    if (col !== sortKey) return <ArrowUpDown size={13} className="opacity-70 ml-0.5 shrink-0" />;
    return sortAsc
      ? <ArrowUp size={13} className="ml-0.5 shrink-0 text-accent" />
      : <ArrowDown size={13} className="ml-0.5 shrink-0 text-accent" />;
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {loading && !processes ? (
        <EmptyState
          className="mt-[10vh]"
          icon={<span className="text-[32px]">⟳</span>}
          text={<span className="text-md text-secondary">{t('正在加载进程列表...')}</span>}
        />
      ) : error ? (
        <EmptyState
          className="mt-[10vh]"
          icon={<span className="text-[32px]">✕</span>}
          text={<span className="text-md text-danger">{t('加载失败')}</span>}
          action={
            <>
              <span className="max-w-[400px] text-sm text-tertiary">{error}</span>
              <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">{t('重试')}</Button>
            </>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          className="mt-[10vh]"
          icon={<Search size={48} />}
          text={<span className="text-lg font-medium text-secondary">
            {searchQuery ? t('未找到匹配的进程') : t('没有可显示的进程')}
          </span>}
        />
      ) : (
        <div className="data-table-shell" style={{ minWidth: TABLE_MIN_WIDTH }}>
          <div
            className="grid bg-sunken border-b border-line text-sm font-bold text-tertiary select-none"
            style={{ gridTemplateColumns: tableColumns }}
          >
            <div className="px-1.5 py-2 flex items-center justify-center">
              <input
                type="checkbox"
                id="process-select-all"
                name="process-select-all"
                autoComplete="off"
                checked={selectedPids.size === filtered.length && filtered.length > 0}
                onChange={onSelectAll}
                className="cursor-pointer"
              />
            </div>
            {([
              { key: 'pid', label: 'PID', align: 'right' },
              { key: 'cpu', label: 'CPU%', align: 'right' },
              { key: 'mem', label: t('内存'), align: 'right' },
              { key: 'user', label: t('用户'), align: 'left' },
              { key: 'name', label: t('名称/命令行'), align: 'left' },
              { key: 'loc', label: t('位置'), align: 'left' },
            ] as Array<{ key: string; label: string; align: 'right' | 'left' }>).map(({ key, label, align }) => (
              <div
                key={key}
                className={cn(
                  'relative px-1.5 py-2 flex items-center gap-0.5 cursor-pointer min-w-0',
                  key !== 'loc' && 'border-r border-line-light',
                  align === 'right' ? 'justify-end' : 'justify-start',
                  sortKey === key && 'bg-active text-primary',
                )}
                onClick={() => onSort(key)}
              >
                {label} {key && renderSortIcon(key)}
                {key !== 'loc' && (
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onStartColResize(key, e);
                    }}
                    className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize"
                    style={{ zIndex: Z.STACK }}
                  />
                )}
              </div>
            ))}
          </div>

          <div>
            <div style={{ height: visibleRange.start * ROW_H }} />
            {filtered.slice(visibleRange.start, visibleRange.end).map((p) => (
              <div
                key={p.pid}
                onContextMenu={(e) => onRowContextMenu(e, p)}
                style={{ gridTemplateColumns: tableColumns }}
                className={cn(
                  'grid gap-0 border-b border-line-light text-[12.5px] font-mono text-primary cursor-pointer',
                  selectedPids.has(p.pid) || contextMenu?.process?.pid === p.pid || activePid === p.pid
                    ? 'bg-active'
                    : 'bg-transparent',
                )}
              >
                <div
                  className="px-1.5 py-1.5 flex items-center justify-center border-r border-line-light"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    id={`process-select-row-${p.pid}`}
                    name="process-select-row"
                    autoComplete="off"
                    checked={selectedPids.has(p.pid)}
                    onChange={() => onToggleSelect(p.pid)}
                    className="cursor-pointer"
                  />
                </div>
                <div className="px-1.5 py-1.5 text-right text-tertiary text-[11.5px] border-r border-line-light" onClick={() => onRowClick(p)}>
                  {p.pid}
                </div>
                <div
                  className="px-1.5 py-1.5 text-right border-r border-line-light"
                  style={{ color: (p.cpu || 0) > 50 ? 'var(--danger)' : ((p.cpu || 0) > 10 ? 'var(--warning)' : 'var(--text-primary)') }}
                  onClick={() => onRowClick(p)}
                >
                  {p.cpu?.toFixed(1)}%
                </div>
                <div className="px-1.5 py-1.5 text-right text-primary border-r border-line-light" onClick={() => onRowClick(p)}>
                  {fmem(p.mem)}
                </div>
                <div className="px-1.5 py-1.5 text-left text-tertiary text-[11.5px] truncate border-r border-line-light" title={p.user} onClick={() => onRowClick(p)}>
                  {p.user}
                </div>
                <div className="px-1.5 py-1.5 text-left truncate border-r border-line-light" title={`${p.name} ┊ ${p.cmd}`} onClick={() => onRowClick(p)}>
                  <span className="text-primary">{p.name}</span>
                  <span className="text-muted mx-0.5">┊</span>
                  <span className="text-secondary">{(p.cmd || p.name)}</span>
                </div>
                <div className="px-1.5 py-1.5 text-left text-tertiary text-[11.5px] truncate" title={p.loc} onClick={() => onRowClick(p)}>
                  {p.loc}
                </div>
              </div>
            ))}
            <div style={{ height: Math.max(0, (filtered.length - visibleRange.end) * ROW_H) }} />
          </div>
        </div>
      )}
    </div>
  );
}
