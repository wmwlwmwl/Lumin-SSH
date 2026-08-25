import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import type React from 'react';
import { Z } from '../../constants/zIndex.ts';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';
import { formatTransferTotal } from '../../utils/probeFormatting.ts';
import type { NetworkConnection } from './networkTypes.ts';

export interface NetworkConnectionTableProps {
  connections: NetworkConnection[];
  visibleConnections: NetworkConnection[];
  connectionSearchQuery: string;
  setConnectionSearchQuery: (query: string) => void;
  showAllListeners: boolean;
  onShowAllListenersChange: (checked: boolean) => void;
  hiddenConnectionCount: number;
  connectionTableColumns: string;
  connectionTableMinWidth: number;
  connectionSortKey: string;
  connectionSortAsc: boolean;
  onConnectionSort: (key: string) => void;
  onStartConnectionColResize: (colKey: string, event: React.MouseEvent) => void;
  activeDetailKey: string | null;
  onOpenConnectionDetail: (item: NetworkConnection, key: string) => void;
  loading: boolean;
  getConnectionKey: (item: NetworkConnection, index: number) => string;
}

export function NetworkConnectionTable({
  connections,
  visibleConnections,
  connectionSearchQuery,
  setConnectionSearchQuery,
  showAllListeners,
  onShowAllListenersChange,
  hiddenConnectionCount,
  connectionTableColumns,
  connectionTableMinWidth,
  connectionSortKey,
  connectionSortAsc,
  onConnectionSort,
  onStartConnectionColResize,
  activeDetailKey,
  onOpenConnectionDetail,
  loading,
  getConnectionKey,
}: NetworkConnectionTableProps) {
  const { t } = useTranslation();

  const renderConnectionSortIcon = (key: string) => {
    if (key !== connectionSortKey) return <ArrowUpDown size={13} className="opacity-65 ml-0.5 shrink-0" />;
    return connectionSortAsc
      ? <ArrowUp size={13} className="ml-0.5 shrink-0 text-accent" />
      : <ArrowDown size={13} className="ml-0.5 shrink-0 text-accent" />;
  };

  const formatOptionalTransfer = (value: number | undefined) => (value == null ? '--' : formatTransferTotal(value));

  const connectionSearchTokens = connectionSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return (
    <div className="data-table-shell w-full min-w-0 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-line flex-wrap">
        <div className="text-base font-bold text-primary mr-0.5">{t('连接端口')}</div>
        <div className="relative flex-[1_1_240px] max-w-[420px] min-w-[180px]">
          <Search size={13} className="absolute left-[9px] top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            className={cn('input w-full h-7 py-1 pl-7 text-xs', connectionSearchQuery ? 'pr-[30px]' : 'pr-2')}
            type="search"
            name="network-connection-search"
            autoComplete="off"
            value={connectionSearchQuery}
            onChange={(event) => setConnectionSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && connectionSearchQuery) {
                event.preventDefault();
                setConnectionSearchQuery('');
              }
            }}
            placeholder={t('搜索PID、名称、IP或端口...')}
            aria-label={t('搜索网络连接')}
          />
          {connectionSearchQuery ? (
            <button
              type="button"
              onClick={() => setConnectionSearchQuery('')}
              aria-label={t('清除搜索')}
              className="absolute right-[5px] top-1/2 -translate-y-1/2 border-none bg-transparent text-muted cursor-pointer p-[3px] flex"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
        <label className="flex items-center gap-2 ml-auto text-sm text-tertiary cursor-pointer">
          <input
            id="network-page-show-all-listeners"
            name="network-page-show-all-listeners"
            autoComplete="off"
            type="checkbox"
            checked={showAllListeners}
            onChange={(event) => onShowAllListenersChange(event.target.checked)}
          />
          <span>{t('显示全部监听端口')}</span>
          {!showAllListeners && hiddenConnectionCount > 0 ? <span>({t('已隐藏空闲监听端口')}: {hiddenConnectionCount})</span> : null}
        </label>
      </div>

      <div className="overflow-x-auto">
        <div style={{ gridTemplateColumns: connectionTableColumns, minWidth: connectionTableMinWidth }} className="grid gap-0 bg-sunken border-b border-line text-tertiary text-sm font-bold select-none">
          {[
            ['pid', 'PID'], ['name', t('名称')], ['listenIP', t('监听IP')], ['port', t('端口')],
            ['ipCount', t('IP数')], ['connCount', t('连接数')], ['upload', t('上传')], ['download', t('下载')],
          ].map(([key, label]) => (
            <div
              key={key}
              onClick={() => onConnectionSort(key)}
              className={cn(
                'py-2 px-1.5 relative flex items-center gap-0.5 cursor-pointer select-none min-w-0',
                key === 'download' ? null : 'border-r border-line-light',
                ['pid', 'port', 'ipCount', 'connCount', 'upload', 'download'].includes(key) ? 'justify-end' : 'justify-start',
                connectionSortKey === key && 'bg-active text-primary',
              )}
            >
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
              {renderConnectionSortIcon(key)}
              {key !== 'download' && (
                <div
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    onStartConnectionColResize(key, event);
                  }}
                  className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize"
                  style={{ zIndex: Z.STACK }}
                />
              )}
            </div>
          ))}
        </div>

        {visibleConnections.length > 0 ? visibleConnections.map((item, index) => {
          const key = getConnectionKey(item, index);
          const peers = Array.isArray(item.peers) ? item.peers : [];
          const active = activeDetailKey === key;
          return (
            <Tiptop key={key} text={peers.length > 0 ? t('点击查看连接明细') : t('无连接可展开')}>
              <div
                onClick={() => onOpenConnectionDetail(item, key)}
                style={{ gridTemplateColumns: connectionTableColumns, minWidth: connectionTableMinWidth }}
                className={cn(
                  'grid gap-0 border-b border-line-subtle items-center text-[12.5px]',
                  peers.length > 0 ? 'cursor-pointer' : 'cursor-not-allowed opacity-[0.72]',
                  active && 'bg-active',
                )}
              >
                <span className="py-2 px-1.5 text-right border-r border-line-light text-tertiary font-mono">{item.pid || '-'}</span>
                <span className="py-2 px-1.5 border-r border-line-light text-primary truncate" title={item.name || '-'}>{item.name || '-'}</span>
                <span className="py-2 px-1.5 border-r border-line-light text-tertiary font-mono truncate" title={item.listenIP || '*'}>{item.listenIP || '*'}</span>
                <span className="py-2 px-1.5 text-right border-r border-line-light text-accent font-mono font-bold">{item.port || '-'}</span>
                <span className="py-2 px-1.5 text-right border-r border-line-light text-tertiary font-mono">{item.ipCount ?? 0}</span>
                <span className="py-2 px-1.5 text-right border-r border-line-light text-primary font-mono">{item.connCount ?? 0}</span>
                <span className="py-2 px-1.5 text-right border-r border-line-light text-success font-mono">{formatOptionalTransfer(item.upload)}</span>
                <span className="py-2 px-1.5 text-right text-accent font-mono">{formatOptionalTransfer(item.download)}</span>
              </div>
            </Tiptop>
          );
        }) : (
          <div style={{ minWidth: connectionTableMinWidth }} className="p-[18px] text-tertiary text-base text-center">
            {loading ? t('加载中...') : connectionSearchTokens.length > 0 ? t('未找到匹配的网络连接') : connections.length > 0 ? t('空闲监听端口已隐藏') : t('暂无网络连接数据')}
          </div>
        )}
      </div>
    </div>
  );
}
