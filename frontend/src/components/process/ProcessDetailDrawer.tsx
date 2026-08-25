import { X } from 'lucide-react';
import type React from 'react';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';
import { Button } from '../ui';
import { fmem, type DetailAction, type ProcessInfo } from './processTypes.ts';

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="flex gap-2 items-center py-[3px]">
      <span className="text-tertiary min-w-[60px] shrink-0 text-sm">{label}</span>
      <span className="text-primary font-medium">{value}</span>
    </div>
  );
}

export interface ProcessDetailDrawerProps {
  detailProcesses: ProcessInfo[];
  activePid: string | null;
  activeProcess: ProcessInfo | null;
  detailDispatch: React.Dispatch<DetailAction>;
  detailHeight: number;
  onStartDetailDrag: (e: React.MouseEvent) => void;
  envLoading: boolean;
  envVars: string[] | null;
  showEnv: boolean;
  setShowEnv: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ProcessDetailDrawer({
  detailProcesses,
  activePid,
  activeProcess,
  detailDispatch,
  detailHeight,
  onStartDetailDrag,
  envLoading,
  envVars,
  showEnv,
  setShowEnv,
}: ProcessDetailDrawerProps) {
  const { t } = useTranslation();

  if (detailProcesses.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className="split-resizer-h hotzone-bottom"
        onMouseDown={onStartDetailDrag}
      />
      <div style={{ height: detailHeight }} className="shrink-0 border-t border-line flex flex-col overflow-hidden bg-sunken">
        <div className="flex justify-between items-center px-2 py-1 border-b border-line-light bg-raised gap-1">
          <div className="flex gap-[3px] overflow-hidden flex-1">
            {detailProcesses.map((p) => {
              const isActive = activePid === p.pid;
              return (
                <div
                  key={p.pid}
                  onClick={() => detailDispatch({ type: 'toggle', process: p })}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-[3px] text-sm rounded-sm cursor-pointer font-mono select-none whitespace-nowrap border transition-all duration-150',
                    isActive
                      ? 'border-accent bg-active text-primary font-medium'
                      : 'border-line bg-sunken text-secondary hover:border-focus hover:bg-hover hover:text-primary',
                  )}
                >
                  <span>{p.pid}</span>
                  <span className={cn(
                    'max-w-[100px] truncate',
                    isActive ? 'text-primary' : 'text-tertiary',
                  )}>
                    {p.name}
                  </span>
                  <Tiptop text={t('关闭')} placement="bottom">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        detailDispatch({ type: 'close', pid: p.pid });
                      }}
                      aria-label={t('关闭')}
                      className="ml-0.5 opacity-40 cursor-pointer text-base leading-none"
                    >
                      ×
                    </span>
                  </Tiptop>
                </div>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => detailDispatch({ type: 'closeAll' })}
            className="p-0.5 text-tertiary shrink-0"
          >
            <X size={14} />
          </Button>
        </div>

        <div className="p-3 overflow-auto flex-1" key={activeProcess?.pid}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-base">
            <DetailRow label="PID" value={<span className="font-mono">{activeProcess?.pid}</span>} />
            <DetailRow label={t('状态')} value={activeProcess?.stat || '-'} />
            <DetailRow label={t('进程名')} value={activeProcess?.name} />
            <DetailRow label={t('线程数')} value={activeProcess?.nlwp != null ? String(activeProcess.nlwp) : '-'} />
            <DetailRow
              label="CPU"
              value={(
                <span style={{ color: (activeProcess?.cpu || 0) > 50 ? 'var(--danger)' : ((activeProcess?.cpu || 0) > 10 ? 'var(--warning)' : 'inherit') }}>
                  {activeProcess?.cpu?.toFixed(1)}%
                </span>
              )}
            />
            <DetailRow label={t('运行时间')} value={activeProcess?.etime || '-'} />
            <DetailRow label={t('内存')} value={fmem(activeProcess?.mem)} />
            <DetailRow label={t('用户')} value={activeProcess?.user} />
          </div>
          {activeProcess?.loc ? (
            <div className="mt-1.5">
              <DetailRow label={t('位置')} value={activeProcess.loc} />
            </div>
          ) : null}
          <div className="mt-3">
            <div className="text-sm text-tertiary mb-1">{t('完整命令行')}:</div>
            <div className="text-[12.5px] font-mono text-primary bg-canvas px-2.5 py-2 rounded-md break-all border border-line-light">
              {activeProcess?.cmd || activeProcess?.name}
            </div>
          </div>

          {envLoading ? (
            <div className="mt-3 text-sm text-tertiary">
              {t('加载环境变量...')}
            </div>
          ) : envVars && envVars.length > 0 ? (
            <div className="mt-3">
              <div
                className="text-sm text-tertiary mb-1 cursor-pointer select-none flex items-center gap-1"
                onClick={() => setShowEnv((v) => !v)}
              >
                <span className="inline-block transition-transform duration-150" style={{ transform: showEnv ? 'rotate(90deg)' : 'none' }}>▶</span>
                {t('环境变量')} <span className="text-muted text-xs">({envVars.length})</span>
              </div>
              {showEnv ? (
                <div className="text-sm font-mono text-primary bg-canvas px-2.5 py-2 rounded-md border border-line-light max-h-[180px] overflow-auto leading-[1.6] whitespace-pre-wrap break-all">
                  {envVars.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : envVars && envVars.length === 0 ? (
            <div className="mt-3 text-sm text-tertiary">
              {t('无环境变量')}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
