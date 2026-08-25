import { SquarePen, X } from 'lucide-react';
import type React from 'react';
import type { config } from '../../../wailsjs/go/models.ts';
import type { ServerPingResult } from '../../hooks/useServerPing.ts';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';
import { getOSInfo, LATENCY_CLASS } from './serverIcons.tsx';

export interface ServerCardItemProps {
  server: config.Connection;
  flatIdx: number;
  pingEnabled: boolean;
  pings: Record<string, ServerPingResult>;
  connectedSessionMap: Map<string, { id?: string; serverId?: string; status?: string; osInfo?: unknown; [key: string]: unknown }>;
  isActive: (server: config.Connection) => boolean | undefined;
  hasSession: (server: config.Connection) => boolean;
  getSaveFlowTokens: (server: config.Connection) => { rowToken: unknown; nameToken: unknown; hostToken: unknown };
  selectedSet: Set<string>;
  selectionMode: boolean;
  handleShiftClick: (server: config.Connection, flatIdx: number) => void;
  handleServerClick: (server: config.Connection, flatIdx: number) => void;
  tryConnect: (server: config.Connection) => void;
  pointerSelectHandlers: Record<string, unknown>;
  handleContextMenu: (e: React.MouseEvent, server: config.Connection) => void;
  onSelectChange: (id: string) => void;
  hideSensitive: boolean;
  mask: (text: string) => string;
  triggerEdit: (server: config.Connection, root: HTMLElement | null) => void;
}

export function ServerCardItem({
  server,
  flatIdx,
  pingEnabled,
  pings,
  connectedSessionMap,
  isActive,
  hasSession,
  getSaveFlowTokens,
  selectedSet,
  selectionMode,
  handleShiftClick,
  handleServerClick,
  tryConnect,
  pointerSelectHandlers,
  handleContextMenu,
  onSelectChange,
  hideSensitive,
  mask,
  triggerEdit,
}: ServerCardItemProps) {
  const { t } = useTranslation();
  const ping = pingEnabled ? pings[server.id] : undefined;
  const latClass = ping ? LATENCY_CLASS(ping.latency) : 'offline';
  const active = isActive(server);
  const connected = hasSession(server);
  const sessionForServer = connectedSessionMap.get(server.id);
  const osInfo = getOSInfo(server.name, server.os, (sessionForServer?.osInfo as Record<string, unknown> | null | undefined) || null);
  const { rowToken, nameToken, hostToken } = getSaveFlowTokens(server);
  const isChecked = selectedSet.has(server.id);

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.stopPropagation();
      if (e.shiftKey) {
        handleShiftClick(server, flatIdx);
      } else {
        handleServerClick(server, flatIdx);
      }
      return;
    }
    tryConnect(server);
  };

  return (
    <Tiptop key={`${server.id}-${rowToken || 'stable'}`} text={`${server.username}@${server.host}:${server.port || 22}`}>
      <div
        data-server-update-id={server.id}
        className={cn('server-card group m-0', active && 'active', Boolean(rowToken) && 'save-flow-hit', selectionMode && isChecked && 'selected')}
        {...pointerSelectHandlers}
        onClick={handleCardClick}
        onContextMenu={(e) => handleContextMenu(e, server)}
      >
        {selectionMode && (
          <div
            className={cn('custom-checkbox mr-2', isChecked && 'checked')}
            onClick={(e) => {
              e.stopPropagation();
              onSelectChange(server.id);
            }}
          >
            {isChecked && (
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        )}
        <div
          className="w-7 h-7 rounded-sm flex items-center justify-center text-lg shrink-0 border border-line-subtle"
          style={{ background: osInfo.bg }}
        >
          {osInfo.icon}
        </div>
        <div className="server-info flex flex-col gap-px flex-1 min-w-0">
          <div className="server-name flex items-center gap-[5px] text-base text-primary font-medium">
            <span
              key={`name-${nameToken || 'stable'}`}
              data-edit-source-field="name"
              className={cn('save-flow-target overflow-hidden text-ellipsis whitespace-nowrap', Boolean(nameToken) && 'save-flow-target-active')}
            >
              {server.name || server.host}
            </span>
            {connected && (
              <span className="text-[10px] text-success font-mono shrink-0">
                ● {t('已连接')}
              </span>
            )}
          </div>
          <div className="server-host text-tertiary overflow-hidden text-ellipsis whitespace-nowrap" data-edit-source-field="hostPort">
            <span
              key={`host-${hostToken || 'stable'}`}
              className={cn('save-flow-target', Boolean(hostToken) && 'save-flow-target-active')}
            >
              {hideSensitive ? mask(`${server.username}@${server.host}`) : `${server.username}@${server.host}:${server.port || 22}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {ping?.online && ping?.latency !== undefined && ping?.latency !== null ? (
            <>
              <span className={cn(
                'text-xs font-mono',
                latClass === 'good' ? 'text-success' : (latClass === 'warn' ? 'text-warning' : 'text-danger'),
              )}>
                {ping.latency === -1 ? t('<1毫秒') : `${ping.latency}${t('毫秒')}`}
              </span>
              <div className={cn(
                'w-[7px] h-[7px] rounded-full',
                latClass === 'good' ? 'bg-success' : (latClass === 'warn' ? 'bg-warning' : 'bg-danger'),
              )} />
            </>
          ) : (
            ping !== undefined && !ping?.online ? (
              <Tiptop text={t('服务器离线或不可达')}>
                <span className="text-md text-danger font-bold leading-none" aria-label={t('服务器离线或不可达')}><X size={13} /></span>
              </Tiptop>
            ) : null
          )}
          <Tiptop text={t('编辑服务器')}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerEdit(server, e.currentTarget.closest('.server-card'));
              }}
              aria-label={t('编辑服务器')}
              className="flex items-center bg-transparent border-none cursor-pointer py-[3px] px-1 rounded-sm text-base text-muted opacity-0 group-hover:opacity-100 group-hover:text-primary transition-[opacity,color] duration-[120ms]"
            >
              <SquarePen size={13} />
            </button>
          </Tiptop>
        </div>
      </div>
    </Tiptop>
  );
}
