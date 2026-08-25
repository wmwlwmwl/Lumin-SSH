import { Clock, X } from 'lucide-react';
import type { config } from '../../../wailsjs/go/models.ts';
import { useTranslation } from '../../i18n.ts';
import { EmptyState } from '../ui';
import { maskSensitiveText, type DashboardSessionLike } from './dashboardTypes.ts';

export interface DashboardRecentTableProps {
  recentServers: config.Connection[];
  filteredRecentServers: config.Connection[];
  sessions: DashboardSessionLike[];
  activeSessionId: string | null;
  hideSensitive: boolean;
  onConnect?: (server: config.Connection) => void;
  onRemoveRecentConnection?: (id: string) => void;
}

export function DashboardRecentTable({
  recentServers,
  filteredRecentServers,
  sessions,
  activeSessionId,
  hideSensitive,
  onConnect,
  onRemoveRecentConnection,
}: DashboardRecentTableProps) {
  const { t } = useTranslation();

  if (recentServers.length === 0) {
    return (
      <EmptyState
        className="mt-[12vh]"
        icon={<Clock size={48} strokeWidth={1.5} />}
        text={t('暂无最近连接')}
        action={
          <div className="mt-2 text-xs text-tertiary">
            {t('连接成功后会出现在这里，方便快速再连')}
          </div>
        }
      />
    );
  }

  if (filteredRecentServers.length === 0) {
    return <EmptyState className="mt-[12vh]" text={t('无匹配结果')} />;
  }

  return (
    <div className="server-table-container">
      <table className="server-table">
        <thead>
          <tr>
            <th style={{ width: 48 }}>#</th>
            <th>{t('别名')}</th>
            <th>{t('主机地址')}</th>
            <th>{t('用户名')}</th>
            <th>{t('分组')}</th>
            <th style={{ width: 88 }}>{t('操作')}</th>
          </tr>
        </thead>
        <tbody>
          {filteredRecentServers.map((server, index) => {
            const connected = sessions?.some((s) => s.serverId === server.id && s.status === 'connected');
            const active = sessions?.some((s) => s.serverId === server.id && s.id === activeSessionId);
            const displayName = server.name || server.host;
            const hostText = hideSensitive
              ? maskSensitiveText(server.host)
              : `${server.host}${server.port && server.port !== 22 ? `:${server.port}` : ''}`;
            const userText = hideSensitive ? maskSensitiveText(server.username) : (server.username || '');
            const groupText = server.group || t('未分组');
            return (
              <tr
                key={server.id}
                className={`server-table-row${active ? ' active' : ''}`}
                onClick={() => onConnect?.(server)}
              >
                <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {index + 1}
                </td>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayName}
                  </span>
                  {connected && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--success)', padding: '2px 4px', background: 'var(--success-dim)', borderRadius: 4 }}>
                      {t('已连接')}
                    </span>
                  )}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>
                  {hostText}
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{userText || '-'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {groupText}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm recent-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRecentConnection?.(server.id);
                    }}
                  >
                    <X size={12} />
                    {t('移除')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
