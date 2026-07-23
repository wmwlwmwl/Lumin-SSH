import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import {
  formatCapacity,
  formatPartitionCapacity,
  formatRate,
  formatTransferTotal,
} from './probeFormatting.js';
import { BarChart3, Cpu, HardDrive, Globe, ClipboardList, Clipboard, Search, Check, Monitor, EyeOff, Eye, RefreshCw, MemoryStick, ArrowLeftRight, Gauge, GripVertical } from 'lucide-react';
import Tiptop from './Tiptop.jsx';
import { Z } from '../constants/zIndex';
import { useTranslation } from '../i18n.js';

const HISTORY_SIZE = 30;
const clampPct = (value) => Math.min(Math.max(Number(value) || 0, 0), 100);
const pctColor = (pct, warn = 60, danger = 85) => pct >= danger ? 'var(--danger)' : pct >= warn ? 'var(--warning)' : 'var(--success)';
const createEmptyHist = () => ({ cpu: Array(HISTORY_SIZE).fill(0), up: Array(HISTORY_SIZE).fill(0), down: Array(HISTORY_SIZE).fill(0) });
const PROBE_CARD_ORDER_KEY = 'probePanelCardOrder';
const PROBE_CARD_ORDER_CHANGED_EVENT = 'probeCardOrderChanged';
const PROBE_CARD_LONG_PRESS_MS = 0;
const DEFAULT_PROBE_CARD_ORDER = ['overview', 'cpu', 'memory', 'network', 'disk', 'process'];

const normalizeProbeCardOrder = (value) => {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const next = [];
  source.forEach((item) => {
    if (DEFAULT_PROBE_CARD_ORDER.includes(item) && !seen.has(item)) {
      seen.add(item);
      next.push(item);
    }
  });
  DEFAULT_PROBE_CARD_ORDER.forEach((item) => {
    if (!seen.has(item)) next.push(item);
  });
  return next;
};

const readProbeCardOrder = () => {
  try {
    return normalizeProbeCardOrder(JSON.parse(localStorage.getItem(PROBE_CARD_ORDER_KEY) || '[]'));
  } catch (_) {
    return [...DEFAULT_PROBE_CARD_ORDER];
  }
};

const persistProbeCardOrder = (order) => {
  const next = normalizeProbeCardOrder(order);
  localStorage.setItem(PROBE_CARD_ORDER_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(PROBE_CARD_ORDER_CHANGED_EVENT, { detail: next }));
};

const reorderProbeCard = (order, activeId, targetId, position) => {
  if (!activeId || !targetId || activeId === targetId) return order;
  const next = order.filter((item) => item !== activeId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex === -1) return order;
  next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, activeId);
  return next;
};

// ── Sparkline SVG ──────────────────────────────────────────────────────────
const Sparkline = React.memo(function Sparkline({ data, series, height = 42 }) {
  const lines = useMemo(() => {
    if (Array.isArray(series) && series.length > 0) return series;
    return [{ data: data || [], color: 'var(--success)', fill: true }];
  }, [data, series]);
  const max = useMemo(() => Math.max(...lines.flatMap(item => item.data || []), 1), [lines]);
  const paths = useMemo(() => lines.map((item) => {
    const pts = item.data || [];
    if (pts.length < 2) return { ...item, points: '', fillPts: '' };
    const W = 200;
    const p = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${height - (clampPct(v / max * 100) / 100) * (height - 3) - 1}`).join(' ');
    return { ...item, points: p, fillPts: `0,${height} ${p} 200,${height}` };
  }), [height, lines, max]);
  if (!paths.some(item => item.points)) return <div className="probe-sparkline-empty" style={{ height }} />;
  return (
    <svg className="probe-sparkline" viewBox={`0 0 200 ${height}`} preserveAspectRatio="none" style={{ height }}>
      {paths.map((item, index) => item.points && item.fill ? (
        <polygon key={`fill-${index}`} points={item.fillPts} style={{ fill: item.color }} opacity={0.10} />
      ) : null)}
      {paths.map((item, index) => item.points ? (
        <polyline key={`line-${index}`} points={item.points} fill="none" style={{ stroke: item.color }} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
      ) : null)}
    </svg>
  );
});

// ── Memory Donut ──────────────────────────────────────────────────────────
const MemDonut = React.memo(function MemDonut({ used, free, total }) {
  const r = 27; const cx = 35; const cy = 35;
  const circ = 2 * Math.PI * r;
  // 用 available 分割，保证三段 = 100%
  const f1 = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;
  const reclaimable = Math.max(total - used - free, 0);
  const f2 = total > 0 ? Math.min(Math.max(reclaimable / total, 0), 1 - f1) : 0;
  const f3 = Math.max(1 - f1 - f2, 0);
  const seg = (frac, color, start) => frac > 0.005 ? (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={8}
      strokeDasharray={`${frac * circ} ${circ}`}
      strokeLinecap="butt"
      transform={`rotate(${-90 + start * 360} ${cx} ${cy})`} />
  ) : null;
  return (
    <svg width={70} height={70} className="probe-mem-donut" aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
      {seg(f1, 'var(--danger)', 0)}
      {seg(f2, 'var(--warning)', f1)}
      {seg(f3, 'var(--success)', f1 + f2)}
    </svg>
  );
});

// ── Common pieces ─────────────────────────────────────────────────────────
const ProgressBar = React.memo(function ProgressBar({ value, color }) {
  const pct = clampPct(value);
  return (
    <div className="probe-progress-track">
      <div className="probe-progress-fill" style={{ width: `${pct}%`, background: color || pctColor(pct) }} />
    </div>
  );
});

const Card = React.memo(function Card({ children, className = '', style }) {
  return <div className={`probe-card ${className}`} style={style}>{children}</div>;
});

const SectionHeader = React.memo(function SectionHeader({ icon, title, badge, action, dragHandleProps = null }) {
  return (
    <div className="probe-section-header">
      <div
        className={`probe-section-handle${dragHandleProps ? ' probe-section-handle-sortable' : ''}${dragHandleProps?.pressing ? ' is-pressing' : ''}${dragHandleProps?.dragReady ? ' is-ready' : ''}${dragHandleProps?.dragging ? ' is-dragging' : ''}`}
        draggable={dragHandleProps?.draggable || false}
        onPointerDown={dragHandleProps?.onPointerDown}
        onPointerMove={dragHandleProps?.onPointerMove}
        onPointerUp={dragHandleProps?.onPointerUp}
        onPointerLeave={dragHandleProps?.onPointerLeave}
        onPointerCancel={dragHandleProps?.onPointerCancel}
        onDragStart={dragHandleProps?.onDragStart}
        onDragEnd={dragHandleProps?.onDragEnd}
      >
        <span className="probe-section-icon">{icon}</span>
        <span className="probe-section-title">{title}</span>
        <span className="probe-section-spacer" />
        <span className="probe-section-handle-hint" aria-hidden="true"><GripVertical size={13} /></span>
      </div>
      {badge ? <span className="probe-section-badge">{badge}</span> : null}
      {action}
    </div>
  );
});

const MetricCard = React.memo(function MetricCard({ label, value, sub, color, icon, progress = null }) {
  const hasProgress = progress !== null;
  return (
    <div className="probe-metric-card">
      <div className="probe-metric-main">
        <div className="probe-metric-top">
          <span className="probe-metric-icon" style={{ color }}>{icon}</span>
          <span className="probe-metric-label" title={label}>{label}</span>
        </div>
        {sub ? <div className="probe-metric-sub" title={sub}>{sub}</div> : null}
      </div>
      <div className="probe-metric-value" style={{ color }}>{value}</div>
      {hasProgress ? <div className="probe-metric-bar"><ProgressBar value={progress} color={color} /></div> : null}
    </div>
  );
});

const CpuBar = React.memo(function CpuBar({ val = 0 }) {
  const pct = clampPct(val);
  return <ProgressBar value={pct} color={pctColor(pct, 50, 80)} />;
});

const CoreHeatGrid = React.memo(function CoreHeatGrid({ cores }) {
  return (
    <div className="probe-core-grid">
      {cores.map((val, i) => {
        const pct = clampPct(val);
        return (
          <div
            key={i}
            className="probe-core-cell"
            title={`CPU ${i}: ${pct.toFixed(1)}%`}
            style={{ background: pctColor(pct, 50, 80), opacity: 0.32 + (pct / 100) * 0.68 }}
          />
        );
      })}
    </div>
  );
});

const PartRow = React.memo(function PartRow({ mount, size, avail, usedPct }) {
  const pct = clampPct(usedPct);
  const color = pctColor(pct, 60, 85);
  return (
    <div className="probe-partition-row">
      <span className="probe-partition-mount" title={mount}>{mount}</span>
      <div className="probe-partition-bar">
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span className="probe-partition-value" title={String(size)}>{formatPartitionCapacity(size)}</span>
      <span className="probe-partition-value" title={String(avail)}>{formatPartitionCapacity(avail)}</span>
      <span className="probe-partition-percent" style={{ color }}>{Math.round(pct)}%</span>
    </div>
  );
});

const ProcessHotRow = React.memo(function ProcessHotRow({ process }) {
  const pct = clampPct(process.cpu || 0);
  return (
    <div className="probe-process-row">
      <div className="probe-process-cpu-cell">
        <span className="probe-process-cpu">{(process.cpu || 0).toFixed(1)}%</span>
        <CpuBar val={pct} />
      </div>
      <span className="probe-process-mem">{formatCapacity(process.mem || 0, 1)}</span>
      <span className="probe-process-cmd" title={process.cmd}>{process.cmd}</span>
    </div>
  );
});

// ── Format helpers ─────────────────────────────────────────────────────────
const fmem = (mb) => formatCapacity(mb, 1);
const fdisk = (gb) => formatCapacity((Number(gb) || 0) * 1024, 1);
const fspeed = (kb) => formatRate(kb);
const ftotal = (mb) => formatTransferTotal(mb);

function isInternalIP(ip) {
  if (!ip) return true;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return true;
  if (parts[0] === '10') return true;
  if (parts[0] === '127') return true;
  if (parts[0] === '172' && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return true;
  if (parts[0] === '192' && parts[1] === '168') return true;
  return false;
}

function ProbeHeader({ t, info, displayIP, hideIP, setHideIP, addToast }) {
  const osParts = info.os?.split(' ') || ['Linux'];
  return (
    <Card className="probe-header-card">
      <div className="probe-host-row">
        <div className="probe-host-title">
          <Monitor size={14} />
          <span>{t('系统监控')}</span>
        </div>
      </div>
      {displayIP && (
        <div className="probe-ip-actions">
          <span className="probe-ip-chip" title={hideIP ? '' : displayIP}>{hideIP ? '***.***.***.***' : displayIP}</span>
          <Tiptop text={t('复制 IP')} placement="bottom">
            <button onClick={() => { navigator.clipboard.writeText(displayIP); addToast?.(t('已复制') + ' ' + displayIP, 'success'); }} aria-label={t('复制 IP')} className="probe-icon-btn"><Clipboard size={13} /></button>
          </Tiptop>
          <Tiptop text={hideIP ? t('显示 IP') : t('隐藏 IP')} placement="bottom">
            <button onClick={() => setHideIP(p => { const next = !p; localStorage.setItem('probeHideIP', next); return next; })} aria-label={hideIP ? t('显示 IP') : t('隐藏 IP')} className="probe-icon-btn">{hideIP ? <Eye size={13} /> : <EyeOff size={13} />}</button>
          </Tiptop>
        </div>
      )}
      <div className="probe-system-grid">
        <div className="probe-os-row">
          <span className="probe-os-chip">{osParts[0]}</span>
          <span className="probe-os-detail" title={info.os}>{info.os?.replace(osParts[0], '').trim() || info.os}</span>
        </div>
        <span title={`${t('时区')} ${info.timezone}`}>{t('时区')} <b>{info.timezone}</b></span>
        <span title={`${t('运行')} ${info.uptime}`}>{t('运行')} <b>{info.uptime}</b></span>
      </div>
    </Card>
  );
}

function HealthOverview({ t, cpuAvg, memPct, diskPct, info, coreCount, dragHandleProps }) {
  const netSpeed = (info.netUp || 0) + (info.netDown || 0);
  const loadPct = coreCount > 0 ? clampPct((info.load1 || 0) / coreCount * 100) : 0;
  return (
    <Card className="probe-overview-card">
      <SectionHeader icon={<BarChart3 size={14} />} title={t('概览')} dragHandleProps={dragHandleProps} />
      <div className="probe-overview-grid">
        <MetricCard label={t('系统负载')} value={`${loadPct.toFixed(0)}%`} sub={`1m ${info.load1?.toFixed(2) || '0.00'} · 5m ${info.load5?.toFixed(2) || '0.00'} · 15m ${info.load15?.toFixed(2) || '0.00'}`} color={pctColor(loadPct, 70, 100)} icon={<Gauge size={13} />} progress={loadPct} />
        <MetricCard label="CPU" value={`${cpuAvg}%`} sub={t('平均占用')} color={pctColor(cpuAvg, 50, 80)} icon={<Cpu size={13} />} progress={cpuAvg} />
        <MetricCard label={t('内存')} value={`${memPct}%`} sub={`${fmem(info.memUsed)} / ${fmem(info.memTotal)}`} color={pctColor(memPct, 60, 85)} icon={<MemoryStick size={13} />} progress={memPct} />
        <MetricCard label={t('磁盘')} value={`${Math.round(diskPct)}%`} sub={`${fdisk(info.diskUsed)} / ${fdisk(info.diskTotal)}`} color={pctColor(diskPct, 70, 90)} icon={<HardDrive size={13} />} progress={diskPct} />
        <MetricCard label={t('网络')} value={fspeed(netSpeed)} sub={`↑ ${fspeed(info.netUp)} · ↓ ${fspeed(info.netDown)}`} color="var(--accent)" icon={<Globe size={13} />} />
      </div>
    </Card>
  );
}

function CpuSection({ t, info, hist, cores, cpuAvg, cpuExpanded, setCpuExpanded, dragHandleProps }) {
  const showBars = cores.length <= 8 || cpuExpanded;
  return (
    <Card>
      <SectionHeader icon={<Cpu size={14} />} title={`CPU ${cores.length > 0 ? `${cores.length}${t('核')}` : ''}`} badge={`${cpuAvg}%`} dragHandleProps={dragHandleProps} />
      <Sparkline data={hist.cpu} height={44} />
      {info.cpuModel ? <div className="probe-muted-line" title={info.cpuModel}>{info.cpuModel}</div> : null}
      <CoreHeatGrid cores={cores} />
      {showBars && (
        <div className="probe-core-bars">
          {cores.map((val, i) => (
            <div key={i} className="probe-core-row">
              <span>{i}</span>
              <CpuBar val={val} />
              <b>{val.toFixed(1)}%</b>
            </div>
          ))}
        </div>
      )}
      {cores.length > 8 && (
        <button onClick={() => setCpuExpanded(v => !v)} className="probe-expand-btn">
          {cpuExpanded ? t('收起') : `${t('展开全部')} ${cores.length} ${t('核')}`}
        </button>
      )}
    </Card>
  );
}

function MemorySection({ t, info, memPct, dragHandleProps }) {
  const memItems = [
    { dot: 'var(--danger)', label: t('已用'), val: fmem(info.memUsed) },
    { dot: 'var(--warning)', label: t('缓存'), val: fmem(info.memCache) },
    { dot: 'var(--success)', label: t('空闲'), val: fmem(info.memFree) },
  ];
  const swapPct = info.swapTotal > 0 ? clampPct(info.swapUsed / info.swapTotal * 100) : 0;
  return (
    <Card>
      <SectionHeader icon={<MemoryStick size={14} />} title={t('内存')} badge={fmem(info.memTotal)} dragHandleProps={dragHandleProps} />
      <div className="probe-memory-layout">
        <MemDonut used={info.memUsed} free={info.memFree} total={info.memTotal} />
        <div className="probe-memory-main">
          <div className="probe-memory-total">
            <span>{t('使用率')}</span>
            <b style={{ color: pctColor(memPct, 60, 85) }}>{memPct}%</b>
          </div>
          <ProgressBar value={memPct} color={pctColor(memPct, 60, 85)} />
          <div className="probe-legend-list">
            {memItems.map(({ dot, label, val }) => (
              <div key={label} className="probe-legend-row">
                <span className="probe-dot" style={{ background: dot }} />
                <span>{label}</span>
                <b>{val}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      {info.swapTotal > 0 && (
        <div className="probe-swap-box">
          <div className="probe-swap-head"><span><ArrowLeftRight size={12} /> SWAP</span><b>{fmem(info.swapUsed)} / {fmem(info.swapTotal)}</b></div>
          <ProgressBar value={swapPct} color="var(--info)" />
        </div>
      )}
    </Card>
  );
}

function NetworkSection({ t, info, hist, onShowNetworkDetails, dragHandleProps }) {
  const interfaces = Array.isArray(info.networkInterfaces) ? info.networkInterfaces : [];
  const topInterfaces = [...interfaces]
    .sort((a, b) => ((b.uploadSpeed || 0) + (b.downloadSpeed || 0)) - ((a.uploadSpeed || 0) + (a.downloadSpeed || 0)))
    .slice(0, 3);
  return (
    <Card>
      <SectionHeader
        icon={<Globe size={14} />}
        title={t('网络')}
        action={<button type="button" onClick={onShowNetworkDetails} className="probe-link-btn">{t('查看详情')}</button>}
        dragHandleProps={dragHandleProps}
      />
      <Sparkline
        height={46}
        series={[
          { data: hist.down, color: 'var(--accent)', fill: true },
          { data: hist.up, color: 'var(--success)', fill: false },
        ]}
      />
      <div className="probe-network-grid">
        {[
          { dot: 'var(--success)', label: t('上传'), speed: fspeed(info.netUp), total: ftotal(info.netUpTotal) },
          { dot: 'var(--accent)', label: t('下载'), speed: fspeed(info.netDown), total: ftotal(info.netDownTotal) },
        ].map(({ dot, label, speed, total }) => (
          <div key={label} className="probe-network-stat">
            <span><i style={{ background: dot }} />{label}</span>
            <b>{speed}</b>
            <small>{total}</small>
          </div>
        ))}
      </div>
      {topInterfaces.length > 0 && (
        <div className="probe-interface-list">
          {topInterfaces.map((item) => (
            <div key={item.name} className="probe-interface-row">
              <span title={item.name}>{item.name}</span>
              <b>↑ {fspeed(item.uploadSpeed)} · ↓ {fspeed(item.downloadSpeed)}</b>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DiskSection({ t, info, diskPartitions, visibleDiskPartitions, diskExpanded, setDiskExpanded, dragHandleProps }) {
  const diskPct = clampPct(info.diskPercent);
  return (
    <Card>
      <SectionHeader icon={<HardDrive size={14} />} title={t('磁盘')} badge={`${fdisk(info.diskUsed)} / ${fdisk(info.diskTotal)}`} dragHandleProps={dragHandleProps} />
      <div className="probe-disk-main">
        <div className="probe-disk-head">
          <span title={info.diskDevice}>/ ({info.diskDevice})</span>
          <b style={{ color: pctColor(diskPct, 70, 90) }}>{Math.round(diskPct)}%</b>
        </div>
        <ProgressBar value={diskPct} color={pctColor(diskPct, 70, 90)} />
      </div>
      <div className="probe-io-grid">
        {[
          { label: t('读/s'), val: fspeed(info.diskReadSpeed), color: 'var(--success)' },
          { label: t('写/s'), val: fspeed(info.diskWriteSpeed), color: 'var(--warning)' },
        ].map(({ label, val, color }) => (
          <div key={label} className="probe-io-card">
            <span>{label}</span>
            <b style={{ color }}>{val}</b>
          </div>
        ))}
      </div>
      <div className="probe-partition-header">
        <span>{t('挂载')}</span>
        <span></span>
        <span>{t('大小')}</span>
        <span>{t('可用')}</span>
        <span>{t('已用%')}</span>
      </div>
      {visibleDiskPartitions.map((p, i) => (
        <PartRow key={`${p.mount}-${i}`} mount={p.mount} size={p.size} avail={p.avail} usedPct={p.usedPct} />
      ))}
      {diskPartitions.length > 4 && (
        <button onClick={() => setDiskExpanded(v => !v)} className="probe-expand-btn">
          {diskExpanded ? t('收起') : `${t('展开全部')} ${diskPartitions.length} ${t('项')}`}
        </button>
      )}
    </Card>
  );
}

function ProcessSection({ t, info, onShowAllProcesses, dragHandleProps }) {
  return (
    <Card className="probe-process-card">
      <SectionHeader
        icon={<ClipboardList size={14} />}
        title={t('进程管理')}
        action={<button type="button" onClick={onShowAllProcesses} className="probe-link-btn">{t('查看全部')}</button>}
        dragHandleProps={dragHandleProps}
      />
      <div className="probe-process-head">
        <span>CPU</span>
        <span>{t('内存')}</span>
        <span>{t('进程')}</span>
      </div>
      {info.processes?.length > 0 ? info.processes.slice(0, 5).map((p, i) => (
        <ProcessHotRow key={`${p.pid || i}-${p.cmd || ''}`} process={p} />
      )) : (
        <div className="probe-empty-row">{t('暂无热点进程')}</div>
      )}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════
export default function ProbePanel({ sessionId, host, addToast, enabled, active, onEnable, onShowAllProcesses, onShowNetworkDetails, snapshot, onSnapshot }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState(() => snapshot?.info || null);
  // ponytail: 合并 3 个历史数组为 1 个状态更新，减少 3 次渲染为 1 次
  const [hist, setHist] = useState(() => snapshot?.hist || createEmptyHist());
  const histRef = useRef(hist);
  histRef.current = hist;
  const [showConfirm, setShowConfirm] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [hideIP, setHideIP] = useState(() => localStorage.getItem('probeHideIP') === 'true');
  const [cpuExpanded, setCpuExpanded] = useState(false);
  const [diskExpanded, setDiskExpanded] = useState(false);
  const [probeError, setProbeError] = useState(null);
  const [probeErrorDetail, setProbeErrorDetail] = useState('');
  const probeErrorCountRef = useRef(0);
  const staticInfoRef = useRef(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  // ponytail: 跟踪当前 sessionId，用于丢弃切换服务器前在飞的异步响应（key remount 下冗余但安全）
  const activeSessionIdRef = useRef(sessionId);
  const onSnapshotRef = useRef(onSnapshot);
  const [cardOrder, setCardOrder] = useState(readProbeCardOrder);
  const [pressingCardId, setPressingCardId] = useState(null);
  const [dragReadyId, setDragReadyId] = useState(null);
  const [draggingCardId, setDraggingCardId] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);
  const dragPressTimerRef = useRef(null);
  const dragPressMetaRef = useRef(null);
  const dragGhostRef = useRef(null);
  useEffect(() => { activeSessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => {
    const handleOrderChanged = (event) => {
      setCardOrder(normalizeProbeCardOrder(event.detail));
    };
    window.addEventListener(PROBE_CARD_ORDER_CHANGED_EVENT, handleOrderChanged);
    return () => window.removeEventListener(PROBE_CARD_ORDER_CHANGED_EVENT, handleOrderChanged);
  }, []);

  const clearCardPressTimer = useCallback(() => {
    if (!dragPressTimerRef.current) return;
    clearTimeout(dragPressTimerRef.current);
    dragPressTimerRef.current = null;
  }, []);

  const clearCardDragGhost = useCallback(() => {
    if (dragGhostRef.current?.parentNode) {
      dragGhostRef.current.parentNode.removeChild(dragGhostRef.current);
    }
    dragGhostRef.current = null;
    document.body.classList.remove('probe-card-dragging-cursor');
  }, []);

  const resetCardDragState = useCallback(() => {
    clearCardPressTimer();
    dragPressMetaRef.current = null;
    setPressingCardId(null);
    setDragReadyId(null);
    setDraggingCardId(null);
    setDropIndicator(null);
    clearCardDragGhost();
  }, [clearCardDragGhost, clearCardPressTimer]);

  useEffect(() => () => {
    clearCardPressTimer();
    clearCardDragGhost();
  }, [clearCardDragGhost, clearCardPressTimer]);

  useEffect(() => {
    if (!dragReadyId || draggingCardId) return;
    const handlePointerRelease = () => {
      clearCardPressTimer();
      dragPressMetaRef.current = null;
      setPressingCardId(null);
      setDragReadyId(null);
    };
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    return () => {
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
    };
  }, [clearCardPressTimer, dragReadyId, draggingCardId]);

  const handleCardHandlePointerDown = useCallback((cardId, event) => {
    if (event.button !== 0) return;
    clearCardPressTimer();
    dragPressMetaRef.current = { cardId, startX: event.clientX, startY: event.clientY };
    if (PROBE_CARD_LONG_PRESS_MS <= 0) {
      setPressingCardId(null);
      setDragReadyId(cardId);
      return;
    }
    setPressingCardId(cardId);
    setDragReadyId(null);
    dragPressTimerRef.current = setTimeout(() => {
      dragPressTimerRef.current = null;
      if (dragPressMetaRef.current?.cardId === cardId) {
        setDragReadyId(cardId);
      }
    }, PROBE_CARD_LONG_PRESS_MS);
  }, [clearCardPressTimer]);

  const handleCardHandlePointerMove = useCallback((cardId, event) => {
    const meta = dragPressMetaRef.current;
    if (!meta || meta.cardId !== cardId || dragReadyId === cardId) return;
    if (Math.abs(event.clientX - meta.startX) > 6 || Math.abs(event.clientY - meta.startY) > 6) {
      clearCardPressTimer();
      dragPressMetaRef.current = null;
      setPressingCardId(null);
    }
  }, [clearCardPressTimer, dragReadyId]);

  const handleCardHandlePointerUp = useCallback((cardId) => {
    if (draggingCardId === cardId) return;
    clearCardPressTimer();
    dragPressMetaRef.current = null;
    setPressingCardId(null);
    if (dragReadyId === cardId) setDragReadyId(null);
  }, [clearCardPressTimer, dragReadyId, draggingCardId]);

  const handleCardHandlePointerLeave = useCallback((cardId) => {
    if (dragReadyId === cardId || draggingCardId === cardId) return;
    clearCardPressTimer();
    dragPressMetaRef.current = null;
    setPressingCardId(null);
  }, [clearCardPressTimer, dragReadyId, draggingCardId]);

  const handleCardDragStart = useCallback((cardId, event) => {
    if (dragReadyId !== cardId) {
      event.preventDefault();
      return;
    }
    dragPressMetaRef.current = null;
    setPressingCardId(null);
    setDraggingCardId(cardId);
    setDropIndicator(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', cardId);
    clearCardDragGhost();
    const sourceCard = event.currentTarget.closest('.probe-card-sortable');
    if (sourceCard) {
      const ghost = sourceCard.cloneNode(true);
      ghost.classList.add('probe-card-drag-ghost');
      ghost.style.width = `${sourceCard.getBoundingClientRect().width}px`;
      document.body.appendChild(ghost);
      dragGhostRef.current = ghost;
      event.dataTransfer.setDragImage(ghost, 28, 18);
    }
    document.body.classList.add('probe-card-dragging-cursor');
  }, [clearCardDragGhost, dragReadyId]);

  const handleCardDragEnd = useCallback(() => {
    resetCardDragState();
  }, [resetCardDragState]);

  const handleCardDragOver = useCallback((targetId, event) => {
    if (!draggingCardId || draggingCardId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicator((prev) => prev?.targetId === targetId && prev?.position === position ? prev : { targetId, position });
  }, [draggingCardId]);

  const handleCardDrop = useCallback((targetId, event) => {
    if (!draggingCardId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = dropIndicator?.targetId === targetId
      ? dropIndicator.position
      : (event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    const nextOrder = reorderProbeCard(cardOrder, draggingCardId, targetId, position);
    if (nextOrder.join('|') !== cardOrder.join('|')) {
      setCardOrder(nextOrder);
      persistProbeCardOrder(nextOrder);
    }
    resetCardDragState();
  }, [cardOrder, draggingCardId, dropIndicator, resetCardDragState]);

  const getSectionDragHandleProps = useCallback((cardId) => ({
    draggable: dragReadyId === cardId,
    pressing: pressingCardId === cardId && dragReadyId !== cardId,
    dragReady: dragReadyId === cardId,
    dragging: draggingCardId === cardId,
    onPointerDown: (event) => handleCardHandlePointerDown(cardId, event),
    onPointerMove: (event) => handleCardHandlePointerMove(cardId, event),
    onPointerUp: () => handleCardHandlePointerUp(cardId),
    onPointerLeave: () => handleCardHandlePointerLeave(cardId),
    onPointerCancel: () => handleCardHandlePointerUp(cardId),
    onDragStart: (event) => handleCardDragStart(cardId, event),
    onDragEnd: handleCardDragEnd,
  }), [dragReadyId, draggingCardId, handleCardDragEnd, handleCardDragStart, handleCardHandlePointerDown, handleCardHandlePointerLeave, handleCardHandlePointerMove, handleCardHandlePointerUp]);

  // 切换服务器时立即清空旧数据和静态缓存
  useEffect(() => {
    const nextHist = snapshot?.hist || createEmptyHist();
    setInfo(snapshot?.info || null);
    staticInfoRef.current = null;
    histRef.current = nextHist;
    setHist(nextHist);
    setCpuExpanded(false);
    setDiskExpanded(false);
    setProbeError(null);
    setProbeErrorDetail('');
    probeErrorCountRef.current = 0;
  }, [sessionId]);

  // 启用监控时获取一次静态信息（OS/时区/主机名/CPU 型号）
  // ponytail: 已缓存则跳过，避免重复 IPC
  useEffect(() => {
    if (!enabled || !active || !sessionId) return;
    if (staticInfoRef.current) return;
    let mounted = true;
    (async () => {
      try {
        const data = await AppGo.GetServerStaticInfo(sessionId);
        if (!mounted || !activeRef.current || activeSessionIdRef.current !== sessionId) return;
        staticInfoRef.current = {
          os: data.os || 'Linux',
          timezone: data.timezone || 'UTC',
          cpuModel: data.cpu?.model || '',
          ip: data.ip || '',
        };
      } catch (_) {
        if (!mounted || !activeRef.current || activeSessionIdRef.current !== sessionId) return;
        staticInfoRef.current = { os: 'Linux', timezone: 'UTC', cpuModel: '', ip: '' };
      }
    })();
    return () => { mounted = false; };
  }, [enabled, active, sessionId]);

  const handleShowAllProcesses = useCallback(() => {
    if (!sessionId || !onShowAllProcesses) return;
    onShowAllProcesses();
  }, [sessionId, onShowAllProcesses]);

  const handleShowNetworkDetails = useCallback(() => {
    if (!sessionId || !onShowNetworkDetails) return;
    onShowNetworkDetails();
  }, [sessionId, onShowNetworkDetails]);

  const fetchInfo = useCallback(async () => {
    if (!sessionId || !enabled || !activeRef.current) return;
    try {
      const data = await AppGo.SystemInfo(sessionId);
      if (!activeRef.current || activeSessionIdRef.current !== sessionId) return; // 切换服务器后丢弃旧响应
      const si = staticInfoRef.current || { os: 'Linux', timezone: 'UTC', cpuModel: '' };
      const uptimeData = data.uptime || {};
      let uptimeStr = t('0 小时');
      if (uptimeData.days > 0) {
        uptimeStr = `${uptimeData.days}${t('天')} ${uptimeData.hours}${t('小时')}`;
      } else if (uptimeData.hours > 0) {
        uptimeStr = `${uptimeData.hours}${t('小时')} ${uptimeData.mins}${t('分')}`;
      } else {
        uptimeStr = `${uptimeData.mins || 0}${t('分钟')}`;
      }
      const ni = {
        ...si,
        uptime: uptimeStr,
        load1: data.load?.load1 || 0,
        load5: data.load?.load5 || 0,
        load15: data.load?.load15 || 0,
        cpuUsage: data.cpu?.usage || 0,
        cpuCores: data.cpu?.cores || [],
        memUsed: data.memory?.used || 0,
        memTotal: data.memory?.total || 0,
        memCache: data.memory?.cache || 0,
        memFree: data.memory?.free || 0,
        swapTotal: data.memory?.swapTotal || 0,
        swapUsed: data.memory?.swapUsed || 0,
        diskDevice: data.disk?.device || 'disk',
        diskTotal: data.disk?.total || 0,
        diskUsed: data.disk?.used || 0,
        diskPercent: data.disk?.usage || 0,
        diskReadSpeed: data.disk?.readSpeed || 0,
        diskWriteSpeed: data.disk?.writeSpeed || 0,
        diskPartitions: data.disk?.partitions || [],
        netUp: data.network?.uploadSpeed || 0,
        netDown: data.network?.downloadSpeed || 0,
        netUpTotal: data.network?.uploadTotal || 0,
        netDownTotal: data.network?.downloadTotal || 0,
        networkInterfaces: data.network?.interfaces || [],
        processes: data.processes || [],
      };
      // 用 histRef 算 nextHist，避免在 setState updater 里调父组件 onSnapshot（渲染期 setState 警告）
      const prevHist = histRef.current || createEmptyHist();
      const nextHist = {
        cpu: [...prevHist.cpu, ni.cpuUsage].slice(-HISTORY_SIZE),
        up: [...prevHist.up, ni.netUp].slice(-HISTORY_SIZE),
        down: [...prevHist.down, ni.netDown].slice(-HISTORY_SIZE),
      };
      histRef.current = nextHist;
      setInfo(ni);
      setHist(nextHist);
      onSnapshotRef.current?.({ info: ni, hist: nextHist });
      probeErrorCountRef.current = 0;
      setProbeError(false);
      setProbeErrorDetail('');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err || '');
      probeErrorCountRef.current += 1;
      if (probeErrorCountRef.current >= 3) {
        setProbeError(true);
        setProbeErrorDetail(errorMessage);
      }
    }
  }, [sessionId, enabled, t]);

  const probeTimerRef = useRef(null);

  // ── 读取探针刷新间隔（localStorage，默认 3s）────────────
  const getProbeInterval = () => {
    const v = parseInt(localStorage.getItem('probeInterval') || '3', 10);
    return v >= 1 ? v : 5;
  };

  useEffect(() => {
    if (!enabled || !active) return;
    fetchInfo();
    // ponytail: 递归 setTimeout 替代 setInterval，确保上一次 fetchInfo 完成后才排下一次，
    // 避免慢网络下多个 SystemInfo 并发在飞（请求堆叠 + 加剧竞态）
    const scheduleNext = () => {
      probeTimerRef.current = setTimeout(async () => {
        await fetchInfo();
        if (probeTimerRef.current !== null && activeRef.current) scheduleNext();
      }, getProbeInterval() * 1000);
    };
    scheduleNext();
    const onIntervalChange = () => {
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
      if (activeRef.current) scheduleNext();
    };
    window.addEventListener('probeIntervalChanged', onIntervalChange);
    return () => {
      if (probeTimerRef.current) {
        clearTimeout(probeTimerRef.current);
        probeTimerRef.current = null;
      }
      window.removeEventListener('probeIntervalChanged', onIntervalChange);
    };
  }, [fetchInfo, enabled, active]);

  const handleConfirm = async () => {
    setShowConfirm(false);
    setEnabling(true);
    try {
      await onEnable();
      setProbeError(false);
      setProbeErrorDetail('');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err || '');
      setProbeError(true);
      setProbeErrorDetail(errorMessage);
      console.error('Probe enable failed:', err);
    } finally {
      setEnabling(false);
    }
  };

  // ── Not enabled: show welcome panel ──────────────────────────────────
  if (!enabled) {
    return (
      <div className="probe-welcome">
        <div className="probe-welcome-main">
          <div className="probe-welcome-icon"><BarChart3 size={26} /></div>
          <div className="probe-welcome-copy">
            <div>{t('系统监控')}</div>
            <p>{t('实时查看服务器 CPU、内存、网络和磁盘使用情况')}</p>
          </div>
          <div className="probe-welcome-list">
            {[[<Cpu size={14} />, t('CPU 每核心实时占用')], [<MemoryStick size={14} />, t('内存甜甜圈图分析')], [<Globe size={14} />, t('网络速率折线图')], [<HardDrive size={14} />, t('磁盘分区挂载表')], [<ClipboardList size={14} />, t('进程热点排行')]].map(([icon, text]) => (
              <div key={text}><span>{icon}</span><span>{text}</span></div>
            ))}
          </div>
          <button onClick={() => setShowConfirm(true)} className="btn btn-primary">{t('开启监控')}</button>
        </div>
        {showConfirm && (
          <div className="probe-confirm-overlay">
            <div className="probe-confirm-card">
              <div className="probe-confirm-title">
                <span><Search size={16} /></span>
                <div>
                  <div>{t('注入监控脚本')}</div>
                  <small>LuminSSH Probe v2</small>
                </div>
              </div>
              <div className="probe-confirm-desc">
                {t('将在服务器写入')} <code>~/.lumin/probe.sh</code>{t('，轻量监控脚本。')}
              </div>
              <div className="probe-confirm-list">
                {[
                  t('纯 Shell，读取 /proc 文件系统'),
                  t('无需安装任何软件或依赖'),
                  t('不修改系统配置，不常驻后台'),
                  t('断开连接后自动停止采集'),
                ].map((text) => <div key={text}><Check size={12} /> {text}</div>)}
              </div>
              <div className="probe-confirm-actions">
                <button onClick={() => setShowConfirm(false)} className="btn btn-secondary btn-sm">{t('取消')}</button>
                <button onClick={handleConfirm} disabled={enabling} className="btn btn-primary btn-sm">
                  {enabling ? t('注入中...') : t('确认开启')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Loading / Error state ─────────────────────────────────────────────
  if (!info) {
    if (probeError) {
      return (
        <div className="probe-state-panel">
          <div className="probe-error-icon">✕</div>
          <div className="probe-state-title">{t('写入失败，请重试')}</div>
          <div className="probe-state-desc">{t('监控脚本写入服务器失败，请检查连接或权限')}</div>
          {probeErrorDetail ? (
            <div style={{
              marginTop: 10,
              maxWidth: 360,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-overlay)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              textAlign: 'left',
            }}
            >
              {probeErrorDetail}
            </div>
          ) : null}
          <button onClick={() => { setProbeError(false); setProbeErrorDetail(''); probeErrorCountRef.current = 0; }} className="btn btn-primary btn-sm">{t('重试')}</button>
        </div>
      );
    }
    return (
      <div className="probe-loading-panel">
        <RefreshCw size={22} className="spin" />
        <div>{t('正在采集系统信息...')}</div>
      </div>
    );
  }

  const memPct = info.memTotal > 0 ? Math.round((info.memUsed / info.memTotal) * 100) : 0;
  const cores = info.cpuCores?.length > 0 ? info.cpuCores : [info.cpuUsage];
  const cpuAvg = Math.round(cores.reduce((a, b) => a + b, 0) / cores.length);
  const displayIP = info.ip && !isInternalIP(info.ip) ? info.ip : host;
  const diskPartitions = info.diskPartitions?.length > 0
    ? info.diskPartitions
    : [{ mount: '/', size: `${info.diskTotal?.toFixed(0)}G`, avail: `${(info.diskTotal - info.diskUsed)?.toFixed(1)}G`, usedPct: Math.round(info.diskPercent) }];
  const visibleDiskPartitions = diskPartitions.length > 4 && !diskExpanded ? diskPartitions.slice(0, 4) : diskPartitions;
  const orderedSections = {
    overview: <HealthOverview t={t} cpuAvg={cpuAvg} memPct={memPct} diskPct={info.diskPercent} info={info} coreCount={cores.length} dragHandleProps={getSectionDragHandleProps('overview')} />,
    cpu: <CpuSection t={t} info={info} hist={hist} cores={cores} cpuAvg={cpuAvg} cpuExpanded={cpuExpanded} setCpuExpanded={setCpuExpanded} dragHandleProps={getSectionDragHandleProps('cpu')} />,
    memory: <MemorySection t={t} info={info} memPct={memPct} dragHandleProps={getSectionDragHandleProps('memory')} />,
    network: <NetworkSection t={t} info={info} hist={hist} onShowNetworkDetails={handleShowNetworkDetails} dragHandleProps={getSectionDragHandleProps('network')} />,
    disk: <DiskSection t={t} info={info} diskPartitions={diskPartitions} visibleDiskPartitions={visibleDiskPartitions} diskExpanded={diskExpanded} setDiskExpanded={setDiskExpanded} dragHandleProps={getSectionDragHandleProps('disk')} />,
    process: <ProcessSection t={t} info={info} onShowAllProcesses={handleShowAllProcesses} dragHandleProps={getSectionDragHandleProps('process')} />,
  };

  return (
    <div className={`probe-panel${draggingCardId ? ' probe-panel-card-dragging' : ''}`}>
      <ProbeHeader t={t} info={info} displayIP={displayIP} hideIP={hideIP} setHideIP={setHideIP} addToast={addToast} />
      {cardOrder.map((cardId) => {
        const cardNode = orderedSections[cardId];
        if (!cardNode) return null;
        const dropClass = dropIndicator?.targetId === cardId ? ` probe-card-drop-${dropIndicator.position}` : '';
        return (
          <div
            key={cardId}
            className={`probe-card-sortable${draggingCardId === cardId ? ' probe-card-dragging' : ''}${dropClass}`}
            onDragOver={(event) => handleCardDragOver(cardId, event)}
            onDrop={(event) => handleCardDrop(cardId, event)}
          >
            {cardNode}
          </div>
        );
      })}
    </div>
  );
}
