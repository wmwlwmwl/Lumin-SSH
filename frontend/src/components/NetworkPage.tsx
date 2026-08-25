import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/wailsapp/App.js';
import { useTranslation } from '../i18n.ts';
import { cn } from '../utils/cn.ts';
import { Button } from './ui';
import { NetworkOverviewCards } from './network/NetworkOverviewCards.tsx';
import { NetworkConnectionTable } from './network/NetworkConnectionTable.tsx';
import { NetworkDetailDrawer } from './network/NetworkDetailDrawer.tsx';
import {
  connectionSortFns,
  defaultConnectionColWidths,
  HISTORY_SIZE,
  type NetworkConnection,
  type NetworkState,
} from './network/networkTypes.ts';

export interface NetworkPageProps {
  sessionId: string;
  active: boolean;
}

export default function NetworkPage({ sessionId, active }: NetworkPageProps) {
  const { t } = useTranslation();
  const [network, setNetwork] = useState<NetworkState | null>(null);
  const [history, setHistory] = useState<{ up: number[]; down: number[] }>({
    up: Array(HISTORY_SIZE).fill(0),
    down: Array(HISTORY_SIZE).fill(0),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllListeners, setShowAllListeners] = useState(() => localStorage.getItem('networkShowAllListeners') === 'true');
  const [connectionSearchQuery, setConnectionSearchQuery] = useState('');
  const [detailConnections, setDetailConnections] = useState<Array<{ key: string; item: NetworkConnection }>>([]);
  const [activeDetailKey, setActiveDetailKey] = useState<string | null>(null);
  const [connectionSortKey, setConnectionSortKey] = useState('download');
  const [connectionSortAsc, setConnectionSortAsc] = useState(false);
  const [connectionColWidths, setConnectionColWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('networkConnectionColWidths');
    if (saved) {
      try {
        return { ...defaultConnectionColWidths, ...JSON.parse(saved) };
      } catch {}
    }
    return defaultConnectionColWidths;
  });
  const [detailHeight, setDetailHeight] = useState(() => parseFloat(localStorage.getItem('networkDetailHeight') || '220'));
  const timerRef = useRef<number | null>(null);
  const colDragging = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await AppGo.NetworkInfo(sessionId);
      const next = data?.network || {};
      if (!mountedRef.current) return;
      setNetwork(next);
      setHistory((prev) => ({
        up: [...prev.up, next.uploadSpeed || 0].slice(-HISTORY_SIZE),
        down: [...prev.down, next.downloadSpeed || 0].slice(-HISTORY_SIZE),
      }));
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setNetwork(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const scheduleNext = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const interval = parseInt(localStorage.getItem('probeInterval') || '3', 10);
      timerRef.current = setTimeout(async () => {
        await load();
        if (!stopped) scheduleNext();
      }, Math.max(interval, 1) * 1000);
    };
    const run = async () => {
      await load();
      if (!stopped) scheduleNext();
    };
    run();
    const onIntervalChange = () => scheduleNext();
    window.addEventListener('probeIntervalChanged', onIntervalChange);
    return () => {
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('probeIntervalChanged', onIntervalChange);
    };
  }, [active, load]);

  const interfaces = Array.isArray(network?.interfaces) ? network.interfaces : [];
  const connections = Array.isArray(network?.connections) ? network.connections : [];
  const filteredConnections = showAllListeners
    ? connections
    : connections.filter((item) => (item.connCount || 0) > 0 || (item.upload || 0) > 0 || (item.download || 0) > 0);
  const connectionSearchTokens = useMemo(() => (
    connectionSearchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
  ), [connectionSearchQuery]);

  const searchedConnections = useMemo(() => {
    if (connectionSearchTokens.length === 0) {
      return filteredConnections;
    }
    return filteredConnections.filter((item) => {
      const peers = Array.isArray(item.peers) ? item.peers : [];
      const searchableText = [
        item.pid,
        item.name,
        item.listenIP,
        item.port,
        item.ipCount,
        item.connCount,
        ...peers.flatMap((peer) => [peer.ip, peer.port, peer.location]),
      ].filter((value) => value != null).join(' ').toLowerCase();
      return connectionSearchTokens.every((token) => searchableText.includes(token));
    });
  }, [connectionSearchTokens, filteredConnections]);

  const visibleConnections = useMemo(() => (
    [...searchedConnections].sort((a, b) => {
      const fn = connectionSortFns[connectionSortKey] || connectionSortFns.download;
      return connectionSortAsc ? fn(a, b) : fn(b, a);
    })
  ), [connectionSortAsc, connectionSortKey, searchedConnections]);

  const hiddenConnectionCount = connections.length - filteredConnections.length;
  const connectionTableColumns = `${connectionColWidths.pid}px ${connectionColWidths.name}px ${connectionColWidths.listenIP}px ${connectionColWidths.port}px ${connectionColWidths.ipCount}px ${connectionColWidths.connCount}px ${connectionColWidths.upload}px minmax(${connectionColWidths.download}px, 1fr)`;
  const connectionTableMinWidth = Math.max(840, Object.values(connectionColWidths).reduce((sum, width) => sum + width, 0));

  const handleShowAllListenersChange = (checked: boolean) => {
    setShowAllListeners(checked);
    localStorage.setItem('networkShowAllListeners', checked ? 'true' : 'false');
  };

  const handleConnectionSort = (key: string) => {
    if (colDragging.current) {
      colDragging.current = false;
      return;
    }
    if (key === connectionSortKey) {
      setConnectionSortAsc((v) => !v);
    } else {
      setConnectionSortKey(key);
      setConnectionSortAsc(false);
    }
  };

  const startDetailDrag = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = detailHeight;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(120, Math.min(600, startH - (ev.clientY - startY)));
      setDetailHeight(next);
      localStorage.setItem('networkDetailHeight', String(next));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [detailHeight]);

  const startConnectionColResize = useCallback((colKey: string, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = connectionColWidths[colKey];
    colDragging.current = false;
    const onMove = (ev: MouseEvent) => {
      colDragging.current = true;
      const next = { ...connectionColWidths, [colKey]: Math.max(50, Math.min(420, startW + (ev.clientX - startX))) };
      setConnectionColWidths(next);
      localStorage.setItem('networkConnectionColWidths', JSON.stringify(next));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [connectionColWidths]);

  const getConnectionKey = (item: NetworkConnection, index: number) => `${item.pid}-${item.name}-${item.listenIP}-${item.port}-${index}`;

  const openConnectionDetail = (item: NetworkConnection, key: string) => {
    if (!Array.isArray(item.peers) || item.peers.length === 0) return;
    setDetailConnections((prev) => {
      if (prev.some((detail) => detail.key === key)) return prev;
      return [...prev, { key, item }];
    });
    setActiveDetailKey(key);
  };

  const closeConnectionDetail = (key: string) => {
    setDetailConnections((prev) => {
      const index = prev.findIndex((detail) => detail.key === key);
      const next = prev.filter((detail) => detail.key !== key);
      if (activeDetailKey === key) {
        setActiveDetailKey(next.length ? next[Math.min(index, next.length - 1)].key : null);
      }
      return next;
    });
  };

  const closeAllDetails = () => {
    setDetailConnections([]);
    setActiveDetailKey(null);
  };

  return (
    <div className="h-full w-full flex-1 min-w-0 flex flex-col bg-canvas overflow-hidden">
      <div className="h-11 flex items-center gap-2.5 px-3.5 border-b border-line bg-raised shrink-0">
        <Globe size={16} className="text-tertiary" />
        <div className="text-md font-bold text-primary flex-1">{t('网络监控')}</div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} /> {t('刷新')}
        </Button>
      </div>

      <div className="flex-1 min-w-0 overflow-auto p-3.5">
        {error ? (
          <div className="text-danger text-base">{t('加载失败')}: {error}</div>
        ) : (
          <div className="w-full min-w-0 flex flex-col gap-3">
            <NetworkOverviewCards
              network={network}
              history={history}
              interfaces={interfaces}
              loading={loading}
            />

            <NetworkConnectionTable
              connections={connections}
              visibleConnections={visibleConnections}
              connectionSearchQuery={connectionSearchQuery}
              setConnectionSearchQuery={setConnectionSearchQuery}
              showAllListeners={showAllListeners}
              onShowAllListenersChange={handleShowAllListenersChange}
              hiddenConnectionCount={hiddenConnectionCount}
              connectionTableColumns={connectionTableColumns}
              connectionTableMinWidth={connectionTableMinWidth}
              connectionSortKey={connectionSortKey}
              connectionSortAsc={connectionSortAsc}
              onConnectionSort={handleConnectionSort}
              onStartConnectionColResize={startConnectionColResize}
              activeDetailKey={activeDetailKey}
              onOpenConnectionDetail={openConnectionDetail}
              loading={loading}
              getConnectionKey={getConnectionKey}
            />
          </div>
        )}
      </div>

      <NetworkDetailDrawer
        detailConnections={detailConnections}
        activeDetailKey={activeDetailKey}
        setActiveDetailKey={setActiveDetailKey}
        onCloseConnectionDetail={closeConnectionDetail}
        onCloseAllDetails={closeAllDetails}
        detailHeight={detailHeight}
        onStartDetailDrag={startDetailDrag}
      />
    </div>
  );
}
