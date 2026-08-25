import { BarChart3, RefreshCw } from 'lucide-react';
import type { config } from '../../../wailsjs/go/models.ts';
import type { PingCounts } from '../../hooks/useServerPing.ts';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';
import { Button } from '../ui';

export interface DashboardStatusOverviewProps {
  servers: config.Connection[];
  pingEnabled: boolean;
  pingCounts: PingCounts;
  isRefreshingPing: boolean;
  onRefreshPing: () => void;
}

export function DashboardStatusOverview({
  servers,
  pingEnabled,
  pingCounts,
  isRefreshingPing,
  onRefreshPing,
}: DashboardStatusOverviewProps) {
  const { t } = useTranslation();

  return (
    <div className="glass-card status-overview-box">
      <div className="card-header-icon-title">
        <span className="card-header-icon"><BarChart3 size={18} /></span>
        <span className="card-header-title">{t('系统状态')}</span>
        {pingEnabled && (
          <Tiptop text={t('刷新延迟')} placement="bottom">
            <Button
              variant="ghost"
              size="icon"
              className={cn('ml-auto btn-icon-spin', isRefreshingPing && 'spinning')}
              onClick={onRefreshPing}
              aria-label={t('刷新延迟')}
            >
              <RefreshCw size={14} />
            </Button>
          </Tiptop>
        )}
      </div>
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-val">{servers.length}</div>
          <div className="stat-lbl">{t('服务器总数')}</div>
        </div>
        <div className="stat-item">
          <div className="stat-val" style={{ color: 'var(--success)' }}>{pingEnabled ? pingCounts.online : '—'}</div>
          <div className="stat-lbl">{t('在线节点')}</div>
        </div>
        <div className="stat-item">
          <div className="stat-val" style={{ color: 'var(--danger)' }}>{pingEnabled ? pingCounts.offline : '—'}</div>
          <div className="stat-lbl">{t('离线节点')}</div>
        </div>
      </div>
    </div>
  );
}
