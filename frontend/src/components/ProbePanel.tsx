import type { ReactNode } from 'react';
import {
  BarChart3,
  Check,
  ClipboardList,
  Cpu,
  Globe,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from './ui';
import { ProbeHeader } from './probe/ProbeHeader.tsx';
import { PortForwardSection } from './probe/ProbePortForwardSection.tsx';
import {
  CpuSection,
  DiskSection,
  HealthOverview,
  MemorySection,
  NetworkSection,
  ProcessSection,
} from './probe/ProbeSections.tsx';
import { isInternalIP, type ProbePanelProps } from './probe/probeTypes.ts';
import { useProbePanel } from './probe/useProbePanel.ts';

export type { ProbeHist, ProbeInfo, ProbePanelProps, ProbeSnapshot } from './probe/probeTypes.ts';

export default function ProbePanel(props: ProbePanelProps) {
  const {
    sessionId,
    host,
    addToast,
    enabled,
    active,
    onOpenPortForward,
  } = props;

  const {
    t,
    info,
    hist,
    showConfirm,
    setShowConfirm,
    hideIP,
    cpuExpanded,
    setCpuExpanded,
    diskExpanded,
    setDiskExpanded,
    probeError,
    setProbeError,
    probeErrorDetail,
    setProbeErrorDetail,
    probeErrorCountRef,
    cardOrder,
    draggingCardId,
    dropIndicator,
    handleConfirm,
    handleShowAllProcesses,
    handleShowNetworkDetails,
    getSectionDragHandleProps,
    handleCardDragOver,
    handleCardDrop,
    handlePanelDragOver,
    handlePanelDrop,
  } = useProbePanel(props);

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
            {[
              { icon: <Cpu size={14} />, text: t('CPU 每核心实时占用') },
              { icon: <MemoryStick size={14} />, text: t('内存甜甜圈图分析') },
              { icon: <Globe size={14} />, text: t('网络速率折线图') },
              { icon: <HardDrive size={14} />, text: t('磁盘分区挂载表') },
              { icon: <ClipboardList size={14} />, text: t('进程热点排行') },
            ].map(({ icon, text }) => (
              <div key={String(text)}><span>{icon}</span><span>{text}</span></div>
            ))}
          </div>
          <Button variant="primary" onClick={() => setShowConfirm(true)}>{t('开启监控')}</Button>
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
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowConfirm(false)}>{t('取消')}</Button>
                <Button variant="primary" size="sm" className="flex-1" onClick={handleConfirm}>{t('确认开启')}</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!info) {
    if (probeError) {
      return (
        <div className="probe-state-panel">
          <div className="probe-error-icon">✕</div>
          <div className="probe-state-title">{t('写入失败，请重试')}</div>
          <div className="probe-state-desc">{t('监控脚本写入服务器失败，请检查连接或权限')}</div>
          {probeErrorDetail ? (
            <div className="mt-2.5 max-w-[360px] px-3 py-2.5 rounded-lg border border-line bg-overlay text-secondary text-sm leading-[1.6] whitespace-pre-wrap [word-break:break-word] text-left">
              {probeErrorDetail}
            </div>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setProbeError(false);
              setProbeErrorDetail('');
              probeErrorCountRef.current = 0;
            }}
          >
            {t('重试')}
          </Button>
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

  const memPct = (info.memTotal || 0) > 0 ? Math.round(((info.memUsed || 0) / (info.memTotal || 1)) * 100) : 0;
  const cores = info.cpuCores && info.cpuCores.length > 0 ? info.cpuCores : [info.cpuUsage || 0];
  const cpuAvg = Math.round(cores.reduce((a, b) => a + b, 0) / cores.length);
  const displayIP = info.ip && !isInternalIP(info.ip) ? info.ip : host;
  const diskPartitions = info.diskPartitions && info.diskPartitions.length > 0
    ? info.diskPartitions
    : [{ mount: '/', size: `${(info.diskTotal || 0).toFixed(0)}G`, avail: `${((info.diskTotal || 0) - (info.diskUsed || 0)).toFixed(1)}G`, usedPct: Math.round(info.diskPercent || 0) }];
  const visibleDiskPartitions = diskPartitions.length > 4 && !diskExpanded ? diskPartitions.slice(0, 4) : diskPartitions;

  const orderedSections: Record<string, ReactNode> = {
    overview: <HealthOverview t={t} cpuAvg={cpuAvg} memPct={memPct} diskPct={info.diskPercent} info={info} coreCount={cores.length} dragHandleProps={getSectionDragHandleProps('overview')} />,
    cpu: <CpuSection t={t} info={info} hist={hist} cores={cores} cpuAvg={cpuAvg} cpuExpanded={cpuExpanded} setCpuExpanded={setCpuExpanded} dragHandleProps={getSectionDragHandleProps('cpu')} />,
    memory: <MemorySection t={t} info={info} memPct={memPct} dragHandleProps={getSectionDragHandleProps('memory')} />,
    network: <NetworkSection t={t} info={info} hist={hist} onShowNetworkDetails={handleShowNetworkDetails} dragHandleProps={getSectionDragHandleProps('network')} />,
    disk: <DiskSection t={t} info={info} diskPartitions={diskPartitions} visibleDiskPartitions={visibleDiskPartitions} diskExpanded={diskExpanded} setDiskExpanded={setDiskExpanded} dragHandleProps={getSectionDragHandleProps('disk')} />,
    process: <ProcessSection t={t} info={info} onShowAllProcesses={handleShowAllProcesses} dragHandleProps={getSectionDragHandleProps('process')} />,
    portforward: <PortForwardSection t={t} sessionId={sessionId} active={active} onOpenPortForward={onOpenPortForward} dragHandleProps={getSectionDragHandleProps('portforward')} />,
  };

  return (
    <div
      className={`probe-panel${draggingCardId ? ' probe-panel-card-dragging' : ''}`}
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
    >
      <ProbeHeader t={t} info={info} displayIP={displayIP} hideIP={hideIP} addToast={addToast} />
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
