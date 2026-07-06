import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';
import { formatRate, formatTransferTotal } from './probeFormatting.js';
import { Globe, RefreshCw, ArrowDown, ArrowUp, Info, ArrowUpDown } from 'lucide-react';

const HISTORY_SIZE = 60;
const connectionSortFns = {
  pid: (a, b) => Number(a.pid || 0) - Number(b.pid || 0),
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  listenIP: (a, b) => (a.listenIP || '').localeCompare(b.listenIP || ''),
  port: (a, b) => Number(a.port || 0) - Number(b.port || 0),
  ipCount: (a, b) => (a.ipCount || 0) - (b.ipCount || 0),
  connCount: (a, b) => (a.connCount || 0) - (b.connCount || 0),
  upload: (a, b) => (a.upload || 0) - (b.upload || 0),
  download: (a, b) => (a.download || 0) - (b.download || 0),
};
const defaultConnectionColWidths = { pid: 70, name: 150, listenIP: 150, port: 80, ipCount: 70, connCount: 80, upload: 90, download: 90 };

function Sparkline({ data, color }) {
  const points = data || [];
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const max = Math.max(...points, 1);
    return points.map((v, i) => `${(i / (points.length - 1)) * 100},${34 - (v / max) * 32}`).join(' ');
  }, [points]);
  if (!path) return <div style={{ height: 34 }} />;
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" style={{ width: '100%', height: 34, display: 'block' }}>
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NetworkPage({ sessionId, active }) {
  const { t } = useTranslation();
  const [network, setNetwork] = useState(null);
  const [history, setHistory] = useState({ up: Array(HISTORY_SIZE).fill(0), down: Array(HISTORY_SIZE).fill(0) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAllListeners, setShowAllListeners] = useState(() => localStorage.getItem('networkShowAllListeners') === 'true');
  const [showInstallTips, setShowInstallTips] = useState(false);
  const [detailConnections, setDetailConnections] = useState([]);
  const [activeDetailKey, setActiveDetailKey] = useState(null);
  const [connectionSortKey, setConnectionSortKey] = useState('download');
  const [connectionSortAsc, setConnectionSortAsc] = useState(false);
  const [connectionColWidths, setConnectionColWidths] = useState(() => {
    const saved = localStorage.getItem('networkConnectionColWidths');
    if (saved) try { return { ...defaultConnectionColWidths, ...JSON.parse(saved) }; } catch {}
    return defaultConnectionColWidths;
  });
  const [detailHeight, setDetailHeight] = useState(() => parseFloat(localStorage.getItem('networkDetailHeight') || '220'));
  const timerRef = useRef(null);
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
      setHistory(prev => ({
        up: [...prev.up, next.uploadSpeed || 0].slice(-HISTORY_SIZE),
        down: [...prev.down, next.downloadSpeed || 0].slice(-HISTORY_SIZE),
      }));
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e?.message || String(e));
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
    : connections.filter(item => (item.connCount || 0) > 0 || (item.upload || 0) > 0 || (item.download || 0) > 0);
  const visibleConnections = [...filteredConnections].sort((a, b) => {
    const fn = connectionSortFns[connectionSortKey] || connectionSortFns.download;
    return connectionSortAsc ? fn(a, b) : fn(b, a);
  });
  const hiddenConnectionCount = connections.length - filteredConnections.length;
  const connectionTableColumns = `${connectionColWidths.pid}px ${connectionColWidths.name}px ${connectionColWidths.listenIP}px ${connectionColWidths.port}px ${connectionColWidths.ipCount}px ${connectionColWidths.connCount}px ${connectionColWidths.upload}px minmax(${connectionColWidths.download}px, 1fr)`;
  const connectionTableMinWidth = Math.max(840, Object.values(connectionColWidths).reduce((sum, width) => sum + width, 0));
  const activeDetailConnection = detailConnections.find(item => item.key === activeDetailKey) || null;
  const formatOptionalTransfer = (value) => value == null ? '--' : formatTransferTotal(value);
  const handleShowAllListenersChange = (checked) => {
    setShowAllListeners(checked);
    localStorage.setItem('networkShowAllListeners', checked ? 'true' : 'false');
  };
  const handleConnectionSort = (key) => {
    if (key === connectionSortKey) setConnectionSortAsc(v => !v);
    else { setConnectionSortKey(key); setConnectionSortAsc(false); }
  };
  const renderConnectionSortIcon = (key) => {
    if (key !== connectionSortKey) return <ArrowUpDown size={13} style={{ opacity: 0.65, marginLeft: 2, flexShrink: 0 }} />;
    return connectionSortAsc
      ? <ArrowUp size={13} style={{ marginLeft: 2, flexShrink: 0, color: 'var(--accent)' }} />
      : <ArrowDown size={13} style={{ marginLeft: 2, flexShrink: 0, color: 'var(--accent)' }} />;
  };
  const startDetailDrag = useCallback((event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = detailHeight;
    const onMove = (ev) => {
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
  const startConnectionColResize = useCallback((colKey, event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = connectionColWidths[colKey];
    colDragging.current = false;
    const onMove = (ev) => {
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
  const getConnectionKey = (item, index) => `${item.pid}-${item.name}-${item.listenIP}-${item.port}-${index}`;
  const formatLocation = (value) => value === 'reserved' ? t('保留地址') : (value || '-');
  const openConnectionDetail = (item, key) => {
    if (!Array.isArray(item.peers) || item.peers.length === 0) return;
    setDetailConnections(prev => {
      if (prev.some(detail => detail.key === key)) return prev;
      return [...prev, { key, item }];
    });
    setActiveDetailKey(key);
  };
  const closeConnectionDetail = (key) => {
    setDetailConnections(prev => {
      const index = prev.findIndex(detail => detail.key === key);
      const next = prev.filter(detail => detail.key !== key);
      if (activeDetailKey === key) {
        setActiveDetailKey(next.length ? next[Math.min(index, next.length - 1)].key : null);
      }
      return next;
    });
  };

  return (
    <div style={{ height: '100%', width: '100%', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-base)', overflow: 'hidden' }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)', flexShrink: 0 }}>
        <Globe size={16} style={{ color: 'var(--text-tertiary)' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{t('网络监控')}</div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> {t('刷新')}
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 14 }}>
        {error ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>{t('加载失败')}: {error}</div>
        ) : (
          <div style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[
                { icon: <ArrowUp size={14} />, label: t('上传速度'), value: formatRate(network?.uploadSpeed || 0), color: 'var(--success)' },
                { icon: <ArrowDown size={14} />, label: t('下载速度'), value: formatRate(network?.downloadSpeed || 0), color: 'var(--accent)' },
                { icon: <ArrowUp size={14} />, label: t('总上传'), value: formatTransferTotal(network?.uploadTotal || 0), color: 'var(--success)' },
                { icon: <ArrowDown size={14} />, label: t('总下载'), value: formatTransferTotal(network?.downloadTotal || 0), color: 'var(--accent)' },
              ].map(item => (
                <div key={item.label} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 8 }}>{item.icon}{item.label}</div>
                  <div style={{ color: item.color, fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700 }}>{item.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>{t('上传速度')}</div>
                <Sparkline data={history.up} color="var(--success)" />
              </div>
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>{t('下载速度')}</div>
                <Sparkline data={history.down} color="var(--accent)" />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>
              <Info size={14} style={{ marginTop: 2, color: 'var(--accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{t('网络监控默认使用 /proc 和 iproute2/ss 采集数据，通常无需安装；lsof 与 net-tools 仅作为旧系统兼容补充。')}</span>
                  <button type="button" onClick={() => setShowInstallTips(v => !v)} style={{ border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', borderRadius: 6, padding: '3px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{showInstallTips ? t('收起') : t('可选安装命令')}</button>
                </div>
                {showInstallTips ? (
                  <div style={{ marginTop: 6 }}>
                    <div>{t('安装以下工具包后，可提升旧系统兼容性，并让 PID、进程名、端口、连接和网卡统计更完整准确')}:</div>
                    <div style={{ display: 'grid', gap: 5, marginTop: 6, fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
                      {[
                        ['Debian/Ubuntu', 'apt update && apt install iproute2 lsof net-tools -y'],
                        ['RHEL/CentOS/Rocky/Alma', 'yum install iproute lsof net-tools -y'],
                        ['Fedora', 'dnf install iproute lsof net-tools -y'],
                        ['Arch', 'pacman -Sy --noconfirm iproute2 lsof net-tools'],
                        ['Alpine', 'apk add iproute2 lsof net-tools'],
                        ['openSUSE', 'zypper install -y iproute2 lsof net-tools'],
                      ].map(([name, command]) => (
                        <code key={name} style={{ display: 'block', padding: '5px 8px', borderRadius: 6, background: 'var(--surface-sunken)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{name}</span><span style={{ color: 'var(--text-tertiary)' }}>: </span><span style={{ color: 'var(--success)' }}>{command}</span></code>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)', fontSize: 12, fontWeight: 700 }}>
                <span>{t('网卡')}</span>
                <span>{t('上传速度')}</span>
                <span>{t('下载速度')}</span>
                <span>{t('总上传')}</span>
                <span>{t('总下载')}</span>
              </div>
              {interfaces.length > 0 ? interfaces.map(item => (
                <div key={item.name} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{item.name}</span>
                  <span style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{formatRate(item.uploadSpeed || 0)}</span>
                  <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{formatRate(item.downloadSpeed || 0)}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{formatTransferTotal(item.uploadTotal || 0)}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{formatTransferTotal(item.downloadTotal || 0)}</span>
                </div>
              )) : (
                <div style={{ padding: 18, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>{loading ? t('加载中...') : t('暂无网络接口数据')}</div>
              )}
            </div>

            <div className="data-table-shell" style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('连接端口')}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showAllListeners} onChange={(event) => handleShowAllListenersChange(event.target.checked)} />
                  <span>{t('显示全部监听端口')}</span>
                  {!showAllListeners && hiddenConnectionCount > 0 ? <span>({t('已隐藏空闲监听端口')}: {hiddenConnectionCount})</span> : null}
                </label>
              </div>
              <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: connectionTableColumns, gap: 0, minWidth: connectionTableMinWidth, background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)', fontSize: 12, fontWeight: 700, userSelect: 'none' }}>
                {[
                  ['pid', 'PID'], ['name', t('名称')], ['listenIP', t('监听IP')], ['port', t('端口')],
                  ['ipCount', t('IP数')], ['connCount', t('连接数')], ['upload', t('上传')], ['download', t('下载')]
                ].map(([key, label]) => (
                  <div key={key} onClick={(event) => { if (colDragging.current) { colDragging.current = false; return; } handleConnectionSort(key); }} style={{ padding: '8px 6px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: ['pid', 'port', 'ipCount', 'connCount', 'upload', 'download'].includes(key) ? 'flex-end' : 'flex-start', gap: 2, cursor: 'pointer', userSelect: 'none', minWidth: 0, borderRight: key === 'download' ? 'none' : '1px solid var(--border-light)', background: connectionSortKey === key ? 'var(--surface-active)' : 'transparent', color: connectionSortKey === key ? 'var(--text-primary)' : undefined }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>{renderConnectionSortIcon(key)}
                    {key !== 'download' && <div onMouseDown={(event) => { event.stopPropagation(); startConnectionColResize(key, event); }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 12, cursor: 'col-resize', zIndex: 2 }} />}
                  </div>
                ))}
              </div>
              {visibleConnections.length > 0 ? visibleConnections.map((item, index) => {
                const key = getConnectionKey(item, index);
                const peers = Array.isArray(item.peers) ? item.peers : [];
                const active = activeDetailKey === key;
                return (
                  <div key={key} title={peers.length > 0 ? t('点击查看连接明细') : t('无连接可展开')} onClick={() => openConnectionDetail(item, key)} style={{ display: 'grid', gridTemplateColumns: connectionTableColumns, gap: 0, minWidth: connectionTableMinWidth, borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', fontSize: 12.5, cursor: peers.length > 0 ? 'pointer' : 'not-allowed', opacity: peers.length > 0 ? 1 : 0.72, background: active ? 'var(--surface-active)' : 'transparent' }}>
                    <span style={{ padding: '8px 6px', textAlign: 'right', borderRight: '1px solid var(--border-light)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{item.pid || '-'}</span>
                    <span style={{ padding: '8px 6px', borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name || '-'}>{item.name || '-'}</span>
                    <span style={{ padding: '8px 6px', borderRight: '1px solid var(--border-light)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.listenIP || '*'}>{item.listenIP || '*'}</span>
                    <span style={{ padding: '8px 6px', textAlign: 'right', borderRight: '1px solid var(--border-light)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{item.port || '-'}</span>
                    <span style={{ padding: '8px 6px', textAlign: 'right', borderRight: '1px solid var(--border-light)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{item.ipCount ?? 0}</span>
                    <span style={{ padding: '8px 6px', textAlign: 'right', borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.connCount ?? 0}</span>
                    <span style={{ padding: '8px 6px', textAlign: 'right', borderRight: '1px solid var(--border-light)', color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{formatOptionalTransfer(item.upload)}</span>
                    <span style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{formatOptionalTransfer(item.download)}</span>
                  </div>
                );
              }) : (
                <div style={{ minWidth: connectionTableMinWidth, padding: 18, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>{loading ? t('加载中...') : connections.length > 0 ? t('空闲监听端口已隐藏') : t('暂无网络连接数据')}</div>
              )}
              </div>
            </div>

          </div>
        )}
      </div>

      {detailConnections.length > 0 ? (
        <>
          <div className="split-resizer-h" onMouseDown={startDetailDrag} style={{ flexShrink: 0, zIndex: 10 }} />
          <div style={{ height: detailHeight, flexShrink: 0, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-sunken)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid var(--border-light)', background: 'var(--surface-raised)', gap: 4 }}>
            <div style={{ display: 'flex', gap: 3, overflow: 'hidden', flex: 1 }}>
              {detailConnections.map(({ key, item }) => (
                <div key={key} onClick={() => setActiveDetailKey(key)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer', fontFamily: 'var(--font-mono)', userSelect: 'none', whiteSpace: 'nowrap', border: '1px solid', borderColor: activeDetailKey === key ? 'var(--accent)' : 'var(--border)', background: activeDetailKey === key ? 'var(--surface-active)' : 'var(--surface-sunken)', color: activeDetailKey === key ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  <span>{item.listenIP || '*'}:{item.port || '-'}</span>
                  <span style={{ color: 'var(--text-tertiary)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name || '-'}</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); closeConnectionDetail(key); }} style={{ border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDetailConnections([]); setActiveDetailKey(null); }}>{t('关闭全部')}</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 8 }}>{activeDetailConnection?.item?.listenIP || '*'}:{activeDetailConnection?.item?.port || '-'} {t('连接明细')}</div>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.4fr) minmax(130px,1fr) 80px 90px 90px', gap: 10, padding: '7px 10px', color: 'var(--text-tertiary)', fontSize: 12, fontWeight: 700, border: '1px solid var(--border-subtle)', borderBottom: 'none', borderRadius: '6px 6px 0 0' }}>
                <span>{t('位置')}</span>
                <span>IP</span>
                <span>{t('端口')}</span>
                <span>{t('上传')}</span>
                <span>{t('下载')}</span>
              </div>
              {Array.isArray(activeDetailConnection?.item?.peers) && activeDetailConnection.item.peers.length > 0 ? activeDetailConnection.item.peers.map((peer, peerIndex) => (
                <div key={`${activeDetailConnection.key}-peer-${peerIndex}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.4fr) minmax(130px,1fr) 80px 90px 90px', gap: 10, padding: '7px 10px', color: 'var(--text-primary)', fontSize: 12.5, border: '1px solid var(--border-subtle)', borderTop: 'none' }}>
                  <span style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={formatLocation(peer.location)}>{formatLocation(peer.location)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{peer.ip || '-'}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{peer.port || '-'}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>{formatOptionalTransfer(peer.upload)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatOptionalTransfer(peer.download)}</span>
                </div>
              )) : (
                <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 12, border: '1px solid var(--border-subtle)', borderTop: 'none' }}>{t('暂无连接明细')}</div>
              )}
            </div>
          </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
