import React from 'react';
import { t as $t } from '../../../i18n.ts';
import { Save, Cloud, Database, Folder, Lock, Plug, type LucideIcon } from 'lucide-react';
import { cn } from '../../../utils/cn.ts';
import { Button } from '../../ui';
import { SettingsPanel, type SettingsDefinitionNode } from '../SharedComponents';
import type { SyncProviderDef, ProviderForm } from './syncTabTypes';

export const PROVIDER_ICON_CMP: Record<string, LucideIcon> = { webdav: Cloud, r2: Database, ftp: Folder, sftp: Lock };

export interface ProviderCardProps {
  provider: SyncProviderDef;
  providerKey: string;
  form: ProviderForm;
  configured: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  testing: boolean;
  testResult: string | null;
  onTest: () => void;
  loading: boolean;
  onSave: () => void;
  children: React.ReactNode;
  definition?: SettingsDefinitionNode;
}

export default function ProviderCard({ provider, providerKey, form, configured, editing, onEdit, onCancelEdit, testing, testResult, onTest, loading, onSave, children, definition }: ProviderCardProps) {
  const accent = provider.accent;
  const IC = PROVIDER_ICON_CMP[providerKey];
  return (
    <SettingsPanel className="p-3.5">
      <div data-settings-field-id={definition?.id} className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-lg bg-sunken flex items-center justify-center text-secondary">{IC ? <IC size={20} /> : null}</div>
        <div>
          <div className="text-[16px] font-semibold text-primary">{$t(provider.titleKey)}</div>
          <div className="text-sm text-tertiary">{$t(provider.subtitleKey)}</div>
        </div>
      </div>
      {configured && !editing ? (
        <div className="relative bg-raised border border-line rounded-md p-3.5 flex flex-col gap-5 shadow-none overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accent, boxShadow: `0 0 12px ${accent}` }} />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: accent }}></div>
              <div className="text-[16px] font-bold text-primary tracking-[0.3px]">{$t(provider.successMsgKey)}</div>
            </div>
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-sm text-base font-medium bg-hover border border-line text-secondary cursor-pointer transition-colors duration-200 hover:bg-sunken hover:text-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              {$t('修改配置')}
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mt-1">
            {provider.summaryFields(form).map((sf, i) => (
              <div key={i} className={cn('flex flex-col gap-1.5 bg-overlay px-3 py-2.5 rounded-md border border-line', sf.fullWidth && 'col-span-full')}>
                <span className="text-sm text-tertiary uppercase font-semibold tracking-[0.5px]">{sf.label}</span>
                <span className={cn('text-md font-mono', sf.primary ? 'text-primary font-semibold' : 'text-secondary', sf.fullWidth && 'truncate')}>{sf.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {children}
          <div className="flex gap-3 mt-3 items-center">
            <Button onClick={onTest} disabled={testing || loading}>
              {testing ? $t('测试中...') : <><Plug size={14} /> {$t('测试连接')}</>} {testResult === 'ok' && '✓'} {testResult === 'fail' && '✗'}
            </Button>
            <Button variant="primary" onClick={onSave} disabled={loading || testing}>
              {loading ? $t('保存中...') : <><Save size={14} /> {$t('保存配置')}</>}
            </Button>
            {editing ? <Button variant="ghost" onClick={onCancelEdit} className="ml-auto">{$t('取消')}</Button> : null}
          </div>
        </div>
      )}
    </SettingsPanel>
  );
}
