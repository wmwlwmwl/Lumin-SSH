import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ArrowRight, Play, Plus, Power, Trash2 } from 'lucide-react';
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js';
import type { sshmanager } from '../../../wailsjs/go/models.ts';
import type { I18nKey } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';
import { Card, SectionHeader } from './ProbeVisuals.tsx';
import type { DragHandleProps } from './probeTypes.ts';

export interface ProbePortForwardSectionProps {
  t: (key: I18nKey) => string;
  sessionId: string;
  active: boolean;
  onOpenPortForward: () => void;
  dragHandleProps?: DragHandleProps | null;
}

export function PortForwardSection({
  t,
  sessionId,
  active,
  onOpenPortForward,
  dragHandleProps,
}: ProbePortForwardSectionProps) {
  const [forwards, setForwards] = useState<sshmanager.PortForwardInfo[]>([]);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const list = await AppGo.ListPortForwards(sessionId);
      if (activeRef.current) setForwards(Array.isArray(list) ? list : []);
    } catch (_) {
      // 端口映射查询失败不应打断监控面板
    }
  }, [sessionId]);

  useEffect(() => {
    setForwards([]);
    if (!sessionId || !active) return undefined;
    refresh();
    const timer = setInterval(() => {
      if (activeRef.current) refresh();
    }, 5000);
    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown }>).detail || {};
      if (!detail?.sessionId || detail.sessionId === sessionId) refresh();
    };
    window.addEventListener('port-forward-changed', handleChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener('port-forward-changed', handleChanged);
    };
  }, [sessionId, active, refresh]);

  const handleStop = useCallback(async (id: string) => {
    try {
      await AppGo.StopPortForwardForSession(sessionId, id);
      refresh();
    } catch (_) {
      // 停止失败保持原状, 下次刷新自动纠正
    }
  }, [sessionId, refresh]);

  const handleRestart = useCallback(async (id: string) => {
    try {
      await AppGo.RestartPortForwardForSession(sessionId, id);
      refresh();
    } catch (_) {
      // 重启失败下次刷新自动纠正
    }
  }, [sessionId, refresh]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await AppGo.DeletePortForwardForSession(sessionId, id);
      setForwards((prev) => prev.filter((item) => item.ID !== id));
      refresh();
    } catch (_) {
      // 删除失败下次刷新自动纠正
    }
  }, [sessionId, refresh]);

  const renderLabel = (info: sshmanager.PortForwardInfo) => {
    if (info.Kind === 'local') {
      return `${t('本地监听')} ${info.LocalAddr} → ${t('远程目标')} ${info.RemoteAddr}`;
    }
    return `${t('远程监听')} ${info.RemoteAddr} → ${t('本机目标')} ${info.LocalAddr}`;
  };

  const isLoopbackHost = (host: string) => {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return h === '' || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::';
  };
  const compactAddr = (host: string, port: string) => (isLoopbackHost(host) ? `:${port}` : `${host}:${port}`);

  const renderCompactLabel = (info: sshmanager.PortForwardInfo) => {
    const listen = info.Kind === 'local'
      ? compactAddr(info.LocalHost, info.LocalPort)
      : compactAddr(info.RemoteHost, info.RemotePort);
    const target = info.Kind === 'local'
      ? compactAddr(info.RemoteHost, info.RemotePort)
      : compactAddr(info.LocalHost, info.LocalPort);
    return (
      <span className="inline-flex items-center gap-1.5 min-w-0 text-sm text-secondary font-mono">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{listen}</span>
        <ArrowRight size={12} className="shrink-0 text-accent" />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{target}</span>
      </span>
    );
  };

  const iconBtn = (onClick: () => void, title: string, color: string, node: ReactNode) => (
    <Tiptop text={title}>
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        className="shrink-0 w-[26px] h-[26px] inline-flex items-center justify-center border border-line rounded-xs bg-sunken cursor-pointer transition-colors duration-100"
        style={{ color }}
      >
        {node}
      </button>
    </Tiptop>
  );

  return (
    <Card>
      <SectionHeader
        icon={<ArrowLeftRight size={14} />}
        title={t('端口映射')}
        badge={forwards.length > 0 ? String(forwards.length) : undefined}
        action={(
          <Tiptop text={t('新建映射')}>
            <button type="button" onClick={onOpenPortForward} className="probe-icon-btn" aria-label={t('新建映射')}>
              <Plus size={14} />
            </button>
          </Tiptop>
        )}
        dragHandleProps={dragHandleProps}
      />
      {forwards.length === 0 ? (
        <div className="probe-empty-row">{t('当前会话没有端口映射。')}</div>
      ) : (
        <div className="flex flex-col gap-2 mt-2">
          {forwards.map((info) => {
            const isLocal = info.Kind === 'local';
            const stopped = info.Enabled === false;
            const label = renderLabel(info);
            return (
              <div
                key={info.ID}
                className="flex items-center justify-between gap-2.5 py-2 px-2.5 border border-line rounded-sm bg-raised"
                style={{ opacity: stopped ? 0.6 : 1 }}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span
                    className={cn(
                      'shrink-0 w-[15px] h-[15px] inline-flex items-center justify-center rounded-xs text-[9px] font-bold font-mono leading-none',
                      isLocal
                        ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent'
                        : 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-success',
                    )}
                  >
                    {isLocal ? 'L' : 'R'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Tiptop text={label} className="probe-portforward-label" style={{ minWidth: 0, flex: 1 }} triggerClassName="probe-portforward-label-trigger">
                        {renderCompactLabel(info)}
                      </Tiptop>
                      {stopped && (
                        <span className="shrink-0 text-[10px] px-1.5 py-[1px] rounded-full bg-[color-mix(in_srgb,var(--text-tertiary)_18%,transparent)] text-tertiary">{t('已停止')}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {stopped
                    ? iconBtn(() => handleRestart(info.ID), t('重启'), 'var(--success)', <Play size={13} />)
                    : iconBtn(() => handleStop(info.ID), t('停止'), 'var(--warning)', <Power size={13} />)}
                  {iconBtn(() => handleDelete(info.ID), t('删除'), 'var(--danger)', <Trash2 size={13} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
