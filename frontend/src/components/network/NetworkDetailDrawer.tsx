import type React from 'react';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import { Button } from '../ui';
import { formatTransferTotal } from '../../utils/probeFormatting.ts';
import type { NetworkConnection } from './networkTypes.ts';

export interface NetworkDetailDrawerProps {
  detailConnections: Array<{ key: string; item: NetworkConnection }>;
  activeDetailKey: string | null;
  setActiveDetailKey: (key: string) => void;
  onCloseConnectionDetail: (key: string) => void;
  onCloseAllDetails: () => void;
  detailHeight: number;
  onStartDetailDrag: (event: React.MouseEvent) => void;
}

export function NetworkDetailDrawer({
  detailConnections,
  activeDetailKey,
  setActiveDetailKey,
  onCloseConnectionDetail,
  onCloseAllDetails,
  detailHeight,
  onStartDetailDrag,
}: NetworkDetailDrawerProps) {
  const { t } = useTranslation();

  if (detailConnections.length === 0) {
    return null;
  }

  const activeDetailConnection = detailConnections.find((item) => item.key === activeDetailKey) || null;
  const formatLocation = (value: string | undefined) => (value === 'reserved' ? t('保留地址') : (value || '-'));
  const formatOptionalTransfer = (value: number | undefined) => (value == null ? '--' : formatTransferTotal(value));

  return (
    <>
      <div className="split-resizer-h hotzone-bottom" onMouseDown={onStartDetailDrag} />
      <div style={{ height: detailHeight }} className="shrink-0 border-t border-line flex flex-col overflow-hidden bg-sunken">
        <div className="flex justify-between items-center px-2 py-1 border-b border-line-light bg-raised gap-1">
          <div className="flex gap-[3px] overflow-hidden flex-1">
            {detailConnections.map(({ key, item }) => {
              const isActive = activeDetailKey === key;
              return (
                <div
                  key={key}
                  onClick={() => setActiveDetailKey(key)}
                  className={cn(
                    'flex items-center gap-[5px] px-2.5 py-[3px] text-sm rounded-sm cursor-pointer font-mono select-none whitespace-nowrap border',
                    isActive ? 'border-accent bg-active text-primary' : 'border-line bg-sunken text-secondary',
                  )}
                >
                  <span>{item.listenIP || '*'}:{item.port || '-'}</span>
                  <span className="text-tertiary max-w-[100px] truncate">{item.name || '-'}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseConnectionDetail(key);
                    }}
                    className="border-none bg-transparent text-tertiary cursor-pointer p-0 text-base leading-none"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" onClick={onCloseAllDetails}>{t('关闭全部')}</Button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <div className="text-tertiary text-sm mb-2">
            {activeDetailConnection?.item?.listenIP || '*'}:{activeDetailConnection?.item?.port || '-'} {t('连接明细')}
          </div>
          <div className="min-w-[640px]">
            <div style={{ gridTemplateColumns: 'minmax(180px,1.4fr) minmax(130px,1fr) 80px 90px 90px' }} className="grid gap-2.5 px-2.5 py-[7px] text-tertiary text-sm font-bold rounded-t-md border border-line-subtle border-b-0">
              <span>{t('位置')}</span>
              <span>IP</span>
              <span>{t('端口')}</span>
              <span>{t('上传')}</span>
              <span>{t('下载')}</span>
            </div>
            {Array.isArray(activeDetailConnection?.item?.peers) && activeDetailConnection.item.peers.length > 0 ? (
              activeDetailConnection.item.peers.map((peer, peerIndex) => (
                <div
                  key={`${activeDetailConnection.key}-peer-${peerIndex}`}
                  style={{ gridTemplateColumns: 'minmax(180px,1.4fr) minmax(130px,1fr) 80px 90px 90px' }}
                  className="grid gap-2.5 px-2.5 py-[7px] text-primary text-[12.5px] border border-line-subtle border-t-0"
                >
                  <span className="text-tertiary truncate" title={formatLocation(peer.location)}>{formatLocation(peer.location)}</span>
                  <span className="font-mono">{peer.ip || '-'}</span>
                  <span className="font-mono text-accent">{peer.port || '-'}</span>
                  <span className="font-mono text-success">{formatOptionalTransfer(peer.upload)}</span>
                  <span className="font-mono text-accent">{formatOptionalTransfer(peer.download)}</span>
                </div>
              ))
            ) : (
              <div className="p-3 text-tertiary text-sm border border-line-subtle border-t-0">{t('暂无连接明细')}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
