import { ArrowLeftRight, ArrowRight, Hash, MonitorSmartphone, Server } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import { Button } from '../ui';

const INPUT_CLASS =
  'w-full box-border px-2.5 py-2 text-base bg-sunken border border-line rounded-sm text-primary outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_18%,transparent)]';

const isSafeListenHost = (host: string) => {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
};

interface AddressFieldCardProps {
  keyName: string;
  roleText: string;
  roleColor: string;
  roleIcon: React.ReactNode;
  hostValue: string;
  onHostChange: (event: ChangeEvent<HTMLInputElement>) => void;
  portValue: string;
  onPortChange: (event: ChangeEvent<HTMLInputElement>) => void;
  isListen: boolean;
}

function AddressFieldCard({
  keyName,
  roleText,
  roleColor,
  roleIcon,
  hostValue,
  onHostChange,
  portValue,
  onPortChange,
  isListen,
}: AddressFieldCardProps) {
  const { t } = useTranslation();
  const showListenWarning = isListen && hostValue.trim() !== '' && !isSafeListenHost(hostValue);

  return (
    <div
      key={keyName}
      className="px-3.5 py-3 rounded-md border border-line bg-raised flex flex-col gap-2.5"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-xs shrink-0"
          style={{
            background: `color-mix(in srgb, ${roleColor} 14%, transparent)`,
            color: roleColor,
          }}
        >
          {roleIcon}
        </span>
        <span className="text-base font-semibold text-primary">{roleText}</span>
      </div>
      <div className="grid grid-cols-[1fr_108px] gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor={`pf-${keyName}-host`} className="flex items-center gap-[5px] text-xs text-tertiary">
            <Server size={11} /> {t('主机地址')}
          </label>
          <input
            type="text"
            id={`pf-${keyName}-host`}
            name={`pf-${keyName}-host`}
            autoComplete="off"
            value={hostValue}
            onChange={onHostChange}
            placeholder="127.0.0.1"
            className={cn(INPUT_CLASS, showListenWarning && 'border-danger')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`pf-${keyName}-port`} className="flex items-center gap-[5px] text-xs text-tertiary">
            <Hash size={11} /> {t('端口')}
          </label>
          <input
            type="text"
            id={`pf-${keyName}-port`}
            name={`pf-${keyName}-port`}
            autoComplete="off"
            value={portValue}
            onChange={onPortChange}
            placeholder="0"
            className={INPUT_CLASS}
          />
        </div>
      </div>
      {showListenWarning && (
        <div className="text-xs leading-[1.4] text-danger">
          {t('警告: 0.0.0.0、:: 或其他非本地地址可能暴露监听端口')}
        </div>
      )}
    </div>
  );
}

export interface PortForwardNewTabProps {
  kind: string;
  setKind: (kind: string) => void;
  localHost: string;
  setLocalHost: (val: string) => void;
  localPort: string;
  setLocalPort: (val: string) => void;
  remoteHost: string;
  setRemoteHost: (val: string) => void;
  remotePort: string;
  setRemotePort: (val: string) => void;
  error: string;
  submitting: boolean;
  onClose: () => void;
  onCreate: () => Promise<void>;
}

export function PortForwardNewTab({
  kind,
  setKind,
  localHost,
  setLocalHost,
  localPort,
  setLocalPort,
  remoteHost,
  setRemoteHost,
  remotePort,
  setRemotePort,
  error,
  submitting,
  onClose,
  onCreate,
}: PortForwardNewTabProps) {
  const { t } = useTranslation();

  const kindOptions = [
    {
      value: 'local',
      title: t('本地转发到远程'),
      desc: t('在本机监听一个端口，连接会被转发到远程可达的服务'),
    },
    {
      value: 'remote',
      title: t('远程转发到本地'),
      desc: t('在远程监听一个端口，连接会被转发回本机的服务'),
    },
  ];

  const localFieldBlock = (
    <AddressFieldCard
      key="local"
      keyName="local"
      roleText={kind === 'local' ? t('本地监听地址') : t('本地目标地址')}
      roleColor="var(--accent)"
      roleIcon={<MonitorSmartphone size={14} />}
      hostValue={localHost}
      onHostChange={(event) => setLocalHost(event.target.value)}
      portValue={localPort}
      onPortChange={(event) => setLocalPort(event.target.value)}
      isListen={kind === 'local'}
    />
  );

  const remoteFieldBlock = (
    <AddressFieldCard
      key="remote"
      keyName="remote"
      roleText={kind === 'local' ? t('远程目标地址') : t('远程监听地址')}
      roleColor="var(--success)"
      roleIcon={<Server size={14} />}
      hostValue={remoteHost}
      onHostChange={(event) => setRemoteHost(event.target.value)}
      portValue={remotePort}
      onPortChange={(event) => setRemotePort(event.target.value)}
      isListen={kind === 'remote'}
    />
  );

  const orderedFieldBlocks = kind === 'local'
    ? [localFieldBlock, remoteFieldBlock]
    : [remoteFieldBlock, localFieldBlock];

  return (
    <div className="grid gap-y-4">
      <div className="grid grid-cols-2 gap-3">
        {kindOptions.map((option) => {
          const selected = kind === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              className={cn(
                'text-left px-3.5 py-3 rounded-xl border cursor-pointer transition-colors duration-100 flex flex-col gap-1.5',
                selected
                  ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]'
                  : 'border-line bg-raised',
              )}
            >
              <span className={cn('flex items-center gap-1.5 font-semibold', selected ? 'text-accent' : 'text-primary')}>
                <ArrowLeftRight size={14} />
                {option.title}
              </span>
              <span className="text-sm text-secondary leading-normal">
                {option.desc}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-3 py-1.5 text-secondary text-sm">
        <span className="px-2.5 py-[3px] rounded-full border border-line bg-raised">
          {kind === 'local' ? t('本地监听') : t('远程监听')}
        </span>
        <ArrowRight size={16} className="text-accent" />
        <span className="px-2.5 py-[3px] rounded-full border border-line bg-raised">
          {kind === 'local' ? t('远程目标') : t('本机目标')}
        </span>
      </div>

      <div className="grid gap-y-3">
        {orderedFieldBlocks}
      </div>

      {error && (
        <div className="text-danger mt-1">{error}</div>
      )}

      <div className="flex justify-end gap-2.5 mt-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t('关闭')}
        </Button>
        <Button variant="primary" onClick={() => void onCreate()} disabled={submitting}>
          {submitting ? t('创建中...') : t('创建映射')}
        </Button>
      </div>
    </div>
  );
}
