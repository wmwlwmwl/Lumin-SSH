import { ArrowDown, ArrowUp, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import { formatRate, formatTransferTotal } from '../../utils/probeFormatting.ts';
import { CARD_SHELL, type NetworkInterfaceInfo, type NetworkState } from './networkTypes.ts';

interface SparklineProps {
  data: number[];
  color: string;
}

function Sparkline({ data, color }: SparklineProps) {
  const points = data || [];
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const max = Math.max(...points, 1);
    return points.map((v, i) => `${(i / (points.length - 1)) * 100},${34 - (v / max) * 32}`).join(' ');
  }, [points]);
  if (!path) return <div className="h-[34px]" />;
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="w-full h-[34px] block">
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface NetworkOverviewCardsProps {
  network: NetworkState | null;
  history: { up: number[]; down: number[] };
  interfaces: NetworkInterfaceInfo[];
  loading: boolean;
}

export function NetworkOverviewCards({
  network,
  history,
  interfaces,
  loading,
}: NetworkOverviewCardsProps) {
  const { t } = useTranslation();
  const [showInstallTips, setShowInstallTips] = useState(false);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {[
          { icon: <ArrowUp size={14} />, label: t('上传速度'), value: formatRate(network?.uploadSpeed || 0), color: 'var(--success)' },
          { icon: <ArrowDown size={14} />, label: t('下载速度'), value: formatRate(network?.downloadSpeed || 0), color: 'var(--accent)' },
          { icon: <ArrowUp size={14} />, label: t('总上传'), value: formatTransferTotal(network?.uploadTotal || 0), color: 'var(--success)' },
          { icon: <ArrowDown size={14} />, label: t('总下载'), value: formatTransferTotal(network?.downloadTotal || 0), color: 'var(--accent)' },
        ].map((item) => (
          <div key={item.label} className={`${CARD_SHELL} px-3.5 py-3`}>
            <div className="flex items-center gap-1.5 text-tertiary text-sm mb-2">{item.icon}{item.label}</div>
            <div className="font-mono text-2xl font-bold" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2.5">
        <div className={`${CARD_SHELL} p-3`}>
          <div className="text-sm text-tertiary mb-2">{t('上传速度')}</div>
          <Sparkline data={history.up} color="var(--success)" />
        </div>
        <div className={`${CARD_SHELL} p-3`}>
          <div className="text-sm text-tertiary mb-2">{t('下载速度')}</div>
          <Sparkline data={history.down} color="var(--accent)" />
        </div>
      </div>

      <div className={cn(CARD_SHELL, 'flex items-start gap-2 px-3 py-2 text-tertiary text-sm leading-[1.6]')}>
        <Info size={14} className="mt-0.5 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span>{t('网络监控默认使用 /proc 和 iproute2/ss 采集数据，通常无需安装；lsof 与 net-tools 仅作为旧系统兼容补充。')}</span>
            <button type="button" onClick={() => setShowInstallTips((v) => !v)} className="border border-accent bg-accent/[0.14] text-accent rounded-md px-[9px] py-[3px] text-sm font-bold cursor-pointer">
              {showInstallTips ? t('收起') : t('可选安装命令')}
            </button>
          </div>
          {showInstallTips ? (
            <div className="mt-1.5">
              <div>{t('安装以下工具包后，可提升旧系统兼容性，并让 PID、进程名、端口、连接和网卡统计更完整准确')}:</div>
              <div className="grid gap-[5px] mt-1.5 font-mono overflow-x-auto">
                {[
                  ['Debian/Ubuntu', 'apt update && apt install iproute2 lsof net-tools -y'],
                  ['RHEL/CentOS/Rocky/Alma', 'yum install iproute lsof net-tools -y'],
                  ['Fedora', 'dnf install iproute lsof net-tools -y'],
                  ['Arch', 'pacman -Sy --noconfirm iproute2 lsof net-tools'],
                  ['Alpine', 'apk add iproute2 lsof net-tools'],
                  ['openSUSE', 'zypper install -y iproute2 lsof net-tools'],
                ].map(([name, command]) => (
                  <code key={name} className="block px-2 py-[5px] rounded-md bg-sunken border border-line-light text-primary whitespace-nowrap">
                    <span className="text-accent font-bold">{name}</span>
                    <span className="text-tertiary">: </span>
                    <span className="text-success">{command}</span>
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${CARD_SHELL} overflow-hidden`}>
        <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-2.5 py-[9px] px-3 border-b border-line text-tertiary text-sm font-bold">
          <span>{t('网卡')}</span>
          <span>{t('上传速度')}</span>
          <span>{t('下载速度')}</span>
          <span>{t('总上传')}</span>
          <span>{t('总下载')}</span>
        </div>
        {interfaces.length > 0 ? interfaces.map((item) => (
          <div key={item.name} className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-2.5 py-[9px] px-3 border-b border-line-subtle items-center text-[12.5px]">
            <span className="text-primary font-mono font-bold">{item.name}</span>
            <span className="text-success font-mono">{formatRate(item.uploadSpeed || 0)}</span>
            <span className="text-accent font-mono">{formatRate(item.downloadSpeed || 0)}</span>
            <span className="text-tertiary font-mono">{formatTransferTotal(item.uploadTotal || 0)}</span>
            <span className="text-tertiary font-mono">{formatTransferTotal(item.downloadTotal || 0)}</span>
          </div>
        )) : (
          <div className="p-[18px] text-tertiary text-base text-center">{loading ? t('加载中...') : t('暂无网络接口数据')}</div>
        )}
      </div>
    </>
  );
}
