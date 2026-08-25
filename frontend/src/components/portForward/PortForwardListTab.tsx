import { ExternalLink, Play, Power, Trash2 } from 'lucide-react';
import type { sshmanager } from '../../../wailsjs/go/models.ts';
import { useTranslation } from '../../i18n.ts';
import { Button } from '../ui';

export interface PortForwardListTabProps {
  portForwards: sshmanager.PortForwardInfo[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function PortForwardListTab({
  portForwards,
  loading,
  onRefresh,
  onRestart,
  onStop,
  onDelete,
}: PortForwardListTabProps) {
  const { t } = useTranslation();

  const renderMappingLabel = (info: sshmanager.PortForwardInfo) => {
    if (info.Kind === 'local') {
      return `${t('本地监听')} ${info.LocalAddr} → ${t('远程目标')} ${info.RemoteAddr}`;
    }
    return `${t('远程监听')} ${info.RemoteAddr} → ${t('本机目标')} ${info.LocalAddr}`;
  };

  return (
    <div>
      <div className="mb-4 flex justify-between items-center">
        <div className="font-medium">{t('当前会话端口映射')}</div>
        <Button variant="secondary" size="sm" onClick={() => void onRefresh()} disabled={loading}>
          {t('刷新')}
        </Button>
      </div>
      {loading ? (
        <div>{t('加载中...')}</div>
      ) : (portForwards.length === 0 ? (
        <div className="text-tertiary">{t('当前会话没有端口映射。')}</div>
      ) : (
        <div className="grid gap-y-3">
          {portForwards.map((info) => {
            const stopped = info.Enabled === false;
            return (
              <div
                key={info.ID}
                className="p-3 border border-line rounded-xl grid grid-cols-[1fr_auto] gap-3 items-center"
                style={{ opacity: stopped ? 0.65 : 1 }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-semibold">{renderMappingLabel(info)}</span>
                    {stopped && (
                      <span className="shrink-0 text-xs px-2 py-px rounded-full bg-[color-mix(in_srgb,var(--text-tertiary)_18%,transparent)] text-tertiary">{t('已停止')}</span>
                    )}
                  </div>
                  <div className="text-secondary text-sm">{info.ID}</div>
                  {!stopped && info.Kind === 'local' && info.LocalAddr && (
                    <a
                      href={`http://${info.LocalAddr}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-accent text-sm"
                    >
                      {t('打开本地地址')} <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {stopped ? (
                    <Button variant="secondary" size="sm" onClick={() => void onRestart(info.ID)} className="gap-[5px] text-success">
                      <Play size={13} /> {t('重启')}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => void onStop(info.ID)} className="gap-[5px] text-warning">
                      <Power size={13} /> {t('停止')}
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => void onDelete(info.ID)} className="gap-[5px] text-danger">
                    <Trash2 size={13} /> {t('删除')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
