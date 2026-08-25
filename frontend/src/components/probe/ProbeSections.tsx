import type React from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  ClipboardList,
  Cpu,
  Gauge,
  Globe,
  HardDrive,
  MemoryStick,
} from 'lucide-react';
import type { I18nKey } from '../../i18n.ts';
import { formatCapacity, formatRate, formatTransferTotal } from '../../utils/probeFormatting.ts';
import {
  Card,
  CoreHeatGrid,
  CpuBar,
  MemDonut,
  MetricCard,
  PartRow,
  ProcessHotRow,
  ProgressBar,
  SectionHeader,
  Sparkline,
} from './ProbeVisuals.tsx';
import {
  clampPct,
  pctColor,
  type DragHandleProps,
  type ProbeHist,
  type ProbeInfo,
} from './probeTypes.ts';

const fmem = (mb: number) => formatCapacity(mb, 1);
const fdisk = (gb: number) => formatCapacity((Number(gb) || 0) * 1024, 1);
const fspeed = (kb: number) => formatRate(kb);
const ftotal = (mb: number) => formatTransferTotal(mb);

export function HealthOverview({
  t,
  cpuAvg,
  memPct,
  diskPct,
  info,
  coreCount,
  dragHandleProps,
}: {
  t: (key: I18nKey) => string;
  cpuAvg: number;
  memPct: number;
  diskPct?: number;
  info: ProbeInfo;
  coreCount: number;
  dragHandleProps?: DragHandleProps | null;
}) {
  const netSpeed = (info.netUp || 0) + (info.netDown || 0);
  const loadPct = coreCount > 0 ? clampPct(((info.load1 || 0) / coreCount) * 100) : 0;
  return (
    <Card className="probe-overview-card">
      <SectionHeader icon={<BarChart3 size={14} />} title={t('概览')} dragHandleProps={dragHandleProps} />
      <div className="probe-overview-grid">
        <MetricCard label={t('系统负载')} value={`${loadPct.toFixed(0)}%`} sub={`1m ${info.load1?.toFixed(2) || '0.00'} · 5m ${info.load5?.toFixed(2) || '0.00'} · 15m ${info.load15?.toFixed(2) || '0.00'}`} color={pctColor(loadPct, 70, 100)} icon={<Gauge size={13} />} progress={loadPct} />
        <MetricCard label="CPU" value={`${cpuAvg}%`} sub={t('平均占用')} color={pctColor(cpuAvg, 50, 80)} icon={<Cpu size={13} />} progress={cpuAvg} />
        <MetricCard label={t('内存')} value={`${memPct}%`} sub={`${fmem(info.memUsed || 0)} / ${fmem(info.memTotal || 0)}`} color={pctColor(memPct, 60, 85)} icon={<MemoryStick size={13} />} progress={memPct} />
        <MetricCard label={t('磁盘')} value={`${Math.round(diskPct || 0)}%`} sub={`${fdisk(info.diskUsed || 0)} / ${fdisk(info.diskTotal || 0)}`} color={pctColor(diskPct || 0, 70, 90)} icon={<HardDrive size={13} />} progress={diskPct || 0} />
        <MetricCard label={t('网络')} value={fspeed(netSpeed)} sub={`↑ ${fspeed(info.netUp || 0)} · ↓ ${fspeed(info.netDown || 0)}`} color="var(--accent)" icon={<Globe size={13} />} />
      </div>
    </Card>
  );
}

export function CpuSection({
  t,
  info,
  hist,
  cores,
  cpuAvg,
  cpuExpanded,
  setCpuExpanded,
  dragHandleProps,
}: {
  t: (key: I18nKey) => string;
  info: ProbeInfo;
  hist: ProbeHist;
  cores: number[];
  cpuAvg: number;
  cpuExpanded: boolean;
  setCpuExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  dragHandleProps?: DragHandleProps | null;
}) {
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
        <button onClick={() => setCpuExpanded((v) => !v)} className="probe-expand-btn">
          {cpuExpanded ? t('收起') : `${t('展开全部')} ${cores.length} ${t('核')}`}
        </button>
      )}
    </Card>
  );
}

export function MemorySection({
  t,
  info,
  memPct,
  dragHandleProps,
}: {
  t: (key: I18nKey) => string;
  info: ProbeInfo;
  memPct: number;
  dragHandleProps?: DragHandleProps | null;
}) {
  const memItems = [
    { dot: 'var(--danger)', label: t('已用'), val: fmem(info.memUsed || 0) },
    { dot: 'var(--warning)', label: t('缓存'), val: fmem(info.memCache || 0) },
    { dot: 'var(--success)', label: t('空闲'), val: fmem(info.memFree || 0) },
  ];
  const swapPct = (info.swapTotal || 0) > 0 ? clampPct(((info.swapUsed || 0) / (info.swapTotal || 1)) * 100) : 0;
  return (
    <Card>
      <SectionHeader icon={<MemoryStick size={14} />} title={t('内存')} badge={fmem(info.memTotal || 0)} dragHandleProps={dragHandleProps} />
      <div className="probe-memory-layout">
        <MemDonut used={info.memUsed || 0} free={info.memFree || 0} total={info.memTotal || 0} />
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
      {(info.swapTotal || 0) > 0 && (
        <div className="probe-swap-box">
          <div className="probe-swap-head"><span><ArrowLeftRight size={12} /> SWAP</span><b>{fmem(info.swapUsed || 0)} / {fmem(info.swapTotal || 0)}</b></div>
          <ProgressBar value={swapPct} color="var(--info)" />
        </div>
      )}
    </Card>
  );
}

export function NetworkSection({
  t,
  info,
  hist,
  onShowNetworkDetails,
  dragHandleProps,
}: {
  t: (key: I18nKey) => string;
  info: ProbeInfo;
  hist: ProbeHist;
  onShowNetworkDetails: () => void;
  dragHandleProps?: DragHandleProps | null;
}) {
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
          { dot: 'var(--success)', label: t('上传'), speed: fspeed(info.netUp || 0), total: ftotal(info.netUpTotal || 0) },
          { dot: 'var(--accent)', label: t('下载'), speed: fspeed(info.netDown || 0), total: ftotal(info.netDownTotal || 0) },
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
              <b>↑ {fspeed(item.uploadSpeed || 0)} · ↓ {fspeed(item.downloadSpeed || 0)}</b>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function DiskSection({
  t,
  info,
  diskPartitions,
  visibleDiskPartitions,
  diskExpanded,
  setDiskExpanded,
  dragHandleProps,
}: {
  t: (key: I18nKey) => string;
  info: ProbeInfo;
  diskPartitions: Array<{ mount?: string; size?: string; avail?: string; usedPct?: number }>;
  visibleDiskPartitions: Array<{ mount?: string; size?: string; avail?: string; usedPct?: number }>;
  diskExpanded: boolean;
  setDiskExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  dragHandleProps?: DragHandleProps | null;
}) {
  const diskPct = clampPct(info.diskPercent || 0);
  return (
    <Card>
      <SectionHeader icon={<HardDrive size={14} />} title={t('磁盘')} badge={`${fdisk(info.diskUsed || 0)} / ${fdisk(info.diskTotal || 0)}`} dragHandleProps={dragHandleProps} />
      <div className="probe-disk-main">
        <div className="probe-disk-head">
          <span title={info.diskDevice}>/ ({info.diskDevice})</span>
          <b style={{ color: pctColor(diskPct, 70, 90) }}>{Math.round(diskPct)}%</b>
        </div>
        <ProgressBar value={diskPct} color={pctColor(diskPct, 70, 90)} />
      </div>
      <div className="probe-io-grid">
        {[
          { label: t('读/s'), val: fspeed(info.diskReadSpeed || 0), color: 'var(--success)' },
          { label: t('写/s'), val: fspeed(info.diskWriteSpeed || 0), color: 'var(--warning)' },
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
        <button onClick={() => setDiskExpanded((v) => !v)} className="probe-expand-btn">
          {diskExpanded ? t('收起') : `${t('展开全部')} ${diskPartitions.length} ${t('项')}`}
        </button>
      )}
    </Card>
  );
}

export function ProcessSection({
  t,
  info,
  onShowAllProcesses,
  dragHandleProps,
}: {
  t: (key: I18nKey) => string;
  info: ProbeInfo;
  onShowAllProcesses: () => void;
  dragHandleProps?: DragHandleProps | null;
}) {
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
      {Array.isArray(info.processes) && info.processes.length > 0 ? (
        info.processes.slice(0, 5).map((p, i) => (
          <ProcessHotRow key={`${p.pid || i}-${p.cmd || ''}`} process={p} />
        ))
      ) : (
        <div className="probe-empty-row">{t('暂无热点进程')}</div>
      )}
    </Card>
  );
}
