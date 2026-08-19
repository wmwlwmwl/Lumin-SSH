import React from 'react';
import { t as $t, type I18nKey } from '../../i18n.ts';
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js';
import { Save, Cloud, Database, Folder, FolderOpen, Lock, RefreshCw, Sparkles, Plug, type LucideIcon } from 'lucide-react';
import { SettingsPanel, SettingsSectionTitle, SettingsTabRoot, type SettingsDefinitionNode } from './SharedComponents';
import { settings } from './settingDefinitions';

const PROVIDER_ICON_CMP: Record<string, LucideIcon> = { webdav: Cloud, r2: Database, ftp: Folder, sftp: Lock };

/** 同步提供方描述（来自 SettingsModal，宽松形状） */
interface SyncProviderDef {
  accent: string;
  titleKey: I18nKey;
  subtitleKey: I18nKey;
  successMsgKey: I18nKey;
  summaryFields: (form: Record<string, string | number>) => Array<{ label: string; value: string; primary?: boolean; fullWidth?: boolean }>;
}

/** 提供方表单（字段由 SettingsModal 定义，宽松键值） */
type ProviderForm = Record<string, string | number>;

type FieldSetter = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;

function formatSyncTime(timestamp: number | null | undefined) {
  if (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) <= 0) return '';
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

interface ProviderCardProps {
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

function ProviderCard({ provider, providerKey, form, configured, editing, onEdit, onCancelEdit, testing, testResult, onTest, loading, onSave, children, definition }: ProviderCardProps) {
  const accent = provider.accent;
  const IC = PROVIDER_ICON_CMP[providerKey];
  return (
    <SettingsPanel style={{ padding: 14 }}>
      <div data-settings-field-id={definition?.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--surface-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>{IC ? <IC size={20} /> : null}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{$t(provider.titleKey)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{$t(provider.subtitleKey)}</div>
        </div>
      </div>
      {configured && !editing ? (
        <div style={{ position: 'relative', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: 'none', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: accent, boxShadow: `0 0 12px ${accent}` }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent }}></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.3px' }}>{$t(provider.successMsgKey)}</div>
            </div>
            <button onClick={onEdit} style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500, background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6 }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              {$t('修改配置')}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '4px' }}>
            {provider.summaryFields(form).map((sf, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface-overlay)', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', ...(sf.fullWidth ? { gridColumn: '1 / -1' } : {}) }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>{sf.label}</span>
                <span style={{ fontSize: 14, color: sf.primary ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: sf.primary ? 600 : 400, fontFamily: 'var(--font-mono)', ...(sf.fullWidth ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>{sf.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={onTest} disabled={testing || loading}>
              {testing ? $t('测试中...') : <><Plug size={14} /> {$t('测试连接')}</>} {testResult === 'ok' && '✓'} {testResult === 'fail' && '✗'}
            </button>
            <button className="btn btn-primary" onClick={onSave} disabled={loading || testing}>
              {loading ? $t('保存中...') : <><Save size={14} /> {$t('保存配置')}</>}
            </button>
            {editing ? <button className="btn btn-ghost" onClick={onCancelEdit} style={{ marginLeft: 'auto' }}>{$t('取消')}</button> : null}
          </div>
        </div>
      )}
    </SettingsPanel>
  );
}

export interface SyncTabProps {
  syncProvider: string;
  onSyncProviderChange: (id: string) => void;
  syncMode: string;
  onSyncModeChange: (mode: string) => void;
  autoSyncEnabled: boolean;
  onAutoSyncEnabledChange: (v: boolean) => void;
  providers: Record<string, SyncProviderDef>;
  providerList: Array<{ id: string; label: React.ReactNode }>;
  webdavForm: ProviderForm;
  setWebdavField: FieldSetter;
  webdavConfigured: boolean;
  webdavEditing: boolean;
  setWebdavEditing: (v: boolean) => void;
  webdavLoading: boolean;
  webdavTesting: boolean;
  webdavTestResult: string | null;
  onWebdavTest: () => void;
  onWebdavSave: () => void;
  r2Form: ProviderForm;
  setR2Field: FieldSetter;
  r2Configured: boolean;
  r2Editing: boolean;
  setR2Editing: (v: boolean) => void;
  r2Loading: boolean;
  r2Testing: boolean;
  r2TestResult: string | null;
  onR2Test: () => void;
  onR2Save: () => void;
  ftpForm: ProviderForm;
  setFTPField: FieldSetter;
  ftpConfigured: boolean;
  ftpEditing: boolean;
  setFtpEditing: (v: boolean) => void;
  ftpLoading: boolean;
  ftpTesting: boolean;
  ftpTestResult: string | null;
  onTestFTP: () => void;
  onSaveFTP: () => void;
  sftpForm: ProviderForm;
  setSFTPField: FieldSetter;
  sftpConfigured: boolean;
  sftpEditing: boolean;
  setSftpEditing: (v: boolean) => void;
  sftpLoading: boolean;
  sftpTesting: boolean;
  sftpTestResult: string | null;
  onTestSFTP: () => void;
  onSaveSFTP: () => void;
  setSftpForm: React.Dispatch<React.SetStateAction<ProviderForm>>;
  lastSyncTime: number | null;
  syncTombstoneStats: { connections?: number; credentials?: number } | null;
  onPruneSyncTombstones?: (days: number) => void;
  pruningTombstones: boolean;
  syncing: boolean;
  onSync: () => void;
  loadingBackups: boolean;
  restoring: boolean;
  onRestore: () => void;
  isAnyConfigured: boolean;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  hasRecoveryPassword: boolean;
  recoveryPasswordEditing: boolean;
  setRecoveryPasswordEditing: (v: boolean) => void;
  recoveryPasswordInput: string;
  setRecoveryPasswordInput: (v: string) => void;
  recoveryPasswordChanging: boolean;
  onSaveRecoveryPassword: () => void;
  onClearRecoveryPassword: () => void;
}

export default function SyncTab({
  syncProvider, onSyncProviderChange,
  syncMode, onSyncModeChange,
  autoSyncEnabled, onAutoSyncEnabledChange,
  providers, providerList,
  webdavForm, setWebdavField, webdavConfigured, webdavEditing, setWebdavEditing, webdavLoading, webdavTesting, webdavTestResult, onWebdavTest, onWebdavSave,
  r2Form, setR2Field, r2Configured, r2Editing, setR2Editing, r2Loading, r2Testing, r2TestResult, onR2Test, onR2Save,
  ftpForm, setFTPField, ftpConfigured, ftpEditing, setFtpEditing, ftpLoading, ftpTesting, ftpTestResult, onTestFTP, onSaveFTP,
  sftpForm, setSFTPField, sftpConfigured, sftpEditing, setSftpEditing, sftpLoading, sftpTesting, sftpTestResult, onTestSFTP, onSaveSFTP, setSftpForm,
  lastSyncTime, syncTombstoneStats, onPruneSyncTombstones, pruningTombstones, syncing, onSync, loadingBackups, restoring, onRestore, isAnyConfigured, addToast,
  hasRecoveryPassword, recoveryPasswordEditing, setRecoveryPasswordEditing, recoveryPasswordInput, setRecoveryPasswordInput, recoveryPasswordChanging, onSaveRecoveryPassword, onClearRecoveryPassword
}: SyncTabProps) {
  const formattedLastSyncTime = formatSyncTime(lastSyncTime);
  const tombstoneConnections = Number(syncTombstoneStats?.connections || 0);
  const tombstoneCredentials = Number(syncTombstoneStats?.credentials || 0);
  const tombstoneTotal = tombstoneConnections + tombstoneCredentials;
  const [tombstoneDays, setTombstoneDays] = React.useState(30);
  // settingDefinitions.ts 已类型化，直接使用 settings 注册表
  const settingsData = settings;
  const syncSettings = settingsData.sync;
  return (
    <SettingsTabRoot>
      <SettingsPanel data-settings-section-id={syncSettings.sections.sync.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div data-settings-field-id={syncSettings.fields.autoSync.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginRight: 4 }}>{$t('自动同步')}</span>
          <button className={autoSyncEnabled ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => onAutoSyncEnabledChange(!autoSyncEnabled)}>
            {autoSyncEnabled ? $t('已开启') : $t('已关闭')}
          </button>
        </div>
        <div data-settings-field-id={syncSettings.fields.autoSyncMode.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginRight: 4 }}>{$t('自动同步模式')}</span>
          {[
            { id: 'webdav', label: <><Cloud size={14} /> WebDAV</> },
            { id: 'r2', label: <><Database size={14} /> R2 (S3)</> },
            { id: 'ftp', label: <><Folder size={14} /> FTP</> },
            { id: 'sftp', label: <><Lock size={14} /> SFTP</> },
            { id: 'all', label: <><RefreshCw size={14} /> {$t('全部')}</> },
          ].map((opt) => (
            <button key={opt.id} className={syncMode === opt.id ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => onSyncModeChange(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>
        <div data-settings-field-id={syncSettings.fields.encryption.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginRight: 4 }}>{$t('同步加密')}</span>
          {hasRecoveryPassword ? (
            <>
              <button className="btn btn-primary" disabled>
                <Lock size={14} /> {$t('已加密')}
              </button>
              <button className="btn btn-secondary" onClick={() => { setRecoveryPasswordEditing(true); setRecoveryPasswordInput(''); }} disabled={recoveryPasswordChanging}>
                {$t('修改密码')}
              </button>
              <button className="btn btn-ghost" onClick={onClearRecoveryPassword} disabled={recoveryPasswordChanging} style={{ color: 'var(--danger)' }}>
                {$t('关闭加密')}
              </button>
            </>
          ) : recoveryPasswordEditing ? (
            <>
              <input id="sync-recovery-password" name="sync-recovery-password" className="input" type="password" autoComplete="new-password" placeholder={$t('请输入恢复密码')} value={recoveryPasswordInput} disabled={recoveryPasswordChanging} onChange={(e) => setRecoveryPasswordInput(e.target.value)} autoFocus style={{ width: 200, height: 34, fontSize: 13 }} />
              <button className="btn btn-primary" onClick={onSaveRecoveryPassword} disabled={!recoveryPasswordInput.trim() || recoveryPasswordChanging}>
                {$t('开启加密')}
              </button>
              <button className="btn btn-ghost" onClick={() => { setRecoveryPasswordEditing(false); setRecoveryPasswordInput(''); }} disabled={recoveryPasswordChanging}>
                {$t('取消')}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" disabled>
                {$t('明文')}
              </button>
              <button className="btn btn-secondary" onClick={() => setRecoveryPasswordEditing(true)}>
                <Lock size={14} /> {$t('加密同步')}
              </button>
            </>
          )}
        </div>
        {hasRecoveryPassword && recoveryPasswordEditing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input id="sync-recovery-new-password" name="sync-recovery-new-password" className="input" type="password" autoComplete="new-password" placeholder={$t('请输入新恢复密码')} value={recoveryPasswordInput} disabled={recoveryPasswordChanging} onChange={(e) => setRecoveryPasswordInput(e.target.value)} autoFocus style={{ width: 200, height: 34, fontSize: 13 }} />
            <button className="btn btn-primary" onClick={onSaveRecoveryPassword} disabled={!recoveryPasswordInput.trim() || recoveryPasswordChanging}>
              {$t('保存')}
            </button>
            <button className="btn btn-ghost" onClick={() => { setRecoveryPasswordEditing(false); setRecoveryPasswordInput(''); }} disabled={recoveryPasswordChanging}>
              {$t('取消')}
            </button>
          </div>
        ) : null}
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {$t('默认明文同步，选择加密后需设置恢复密码。系统重装或云端凭据变更后，用恢复密码即可恢复备份。')}
          <div style={{ marginTop: 4, color: 'var(--warning)' }}>{$t('注意：多设备同步时，所有设备需使用相同的加密密码，否则其他设备无法解密同步数据。')}</div>
          {!hasRecoveryPassword ? <div style={{ marginTop: 4, color: 'var(--warning)' }}>{$t('未开启加密同步时会以明文保存到云端；如需保护云端备份，请选择加密并设置恢复密码。')}</div> : null}
        </div>
      </SettingsPanel>

      <SettingsPanel data-settings-section-id={syncSettings.sections.provider.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, padding: 8 }}>
        {providerList.map((item) => (
          <button
            key={item.id}
            onClick={() => onSyncProviderChange(item.id)}
            aria-pressed={syncProvider === item.id}
            style={{
              minWidth: 0,
              padding: '10px 16px',
              borderRadius: 'var(--radius-sm)',
              background: syncProvider === item.id ? 'var(--accent-dim)' : 'var(--surface-sunken)',
              border: `1px solid ${syncProvider === item.id ? 'var(--accent-border)' : 'var(--border)'}`,
              color: syncProvider === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: syncProvider === item.id ? 600 : 400,
              boxShadow: syncProvider === item.id ? '0 0 0 1px var(--accent-border) inset' : 'none',
              cursor: 'pointer',
              fontSize: 14,
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {(() => { const IconCmp = PROVIDER_ICON_CMP[item.id]; return IconCmp ? <IconCmp size={16} /> : null; })()} {item.label}
          </button>
        ))}
      </SettingsPanel>

      {syncProvider === 'webdav' ? (
        <ProviderCard
          definition={syncSettings.fields.webdav}
          providerKey="webdav"
          provider={providers.webdav}
          form={webdavForm}
          configured={webdavConfigured}
          editing={webdavEditing}
          onEdit={() => setWebdavEditing(true)}
          onCancelEdit={() => setWebdavEditing(false)}
          testing={webdavTesting}
          testResult={webdavTestResult}
          onTest={onWebdavTest}
          loading={webdavLoading}
          onSave={onWebdavSave}
        >
          <div className="form-group" data-settings-field-id={syncSettings.fields.endpoint.id}>
            <label htmlFor="sync-webdav-url" className="form-label">{$t('端点地址 (URL)')}</label>
            <input id="sync-webdav-url" name="sync-webdav-url" className="input" autoComplete="off" value={webdavForm.url} onChange={setWebdavField('url')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.webdavUsername.id}>
            <label htmlFor="sync-webdav-username" className="form-label">{$t('用户名')}</label>
            <input id="sync-webdav-username" name="sync-webdav-username" className="input" autoComplete="off" value={webdavForm.username} onChange={setWebdavField('username')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.webdavPassword.id}>
            <label htmlFor="sync-webdav-password" className="form-label">{$t('密码 / 授权码')}</label>
            <input id="sync-webdav-password" name="sync-webdav-password" className="input" type="password" autoComplete="current-password" value={webdavForm.password} onChange={setWebdavField('password')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.webdavRemoteDirectory.id}>
            <label htmlFor="sync-webdav-remote-path" className="form-label">{$t('远程保存目录')}</label>
            <input id="sync-webdav-remote-path" name="sync-webdav-remote-path" className="input" autoComplete="off" value={webdavForm.remotePath} onChange={setWebdavField('remotePath')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.webdavMaxBackups.id}>
            <label htmlFor="sync-webdav-max-backups" className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input id="sync-webdav-max-backups" name="sync-webdav-max-backups" className="input" type="number" min="0" autoComplete="off" value={webdavForm.maxBackups} onChange={setWebdavField('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      ) : null}

      {syncProvider === 'r2' ? (
        <ProviderCard
          definition={syncSettings.fields.r2}
          providerKey="r2"
          provider={providers.r2}
          form={r2Form}
          configured={r2Configured}
          editing={r2Editing}
          onEdit={() => setR2Editing(true)}
          onCancelEdit={() => setR2Editing(false)}
          testing={r2Testing}
          testResult={r2TestResult}
          onTest={onR2Test}
          loading={r2Loading}
          onSave={onR2Save}
        >
          <div className="form-group" data-settings-field-id={syncSettings.fields.accessKey.id}>
            <label htmlFor="sync-r2-access-key-id" className="form-label">{$t('访问密钥 ID (Access Key ID)')}</label>
            <input id="sync-r2-access-key-id" name="sync-r2-access-key-id" className="input" autoComplete="off" value={r2Form.accessKeyId} onChange={setR2Field('accessKeyId')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.r2SecretAccessKey.id}>
            <label htmlFor="sync-r2-secret-access-key" className="form-label">{$t('秘密访问密钥 (Secret Access Key)')}</label>
            <input id="sync-r2-secret-access-key" name="sync-r2-secret-access-key" className="input" type="password" autoComplete="current-password" value={r2Form.secretAccessKey} onChange={setR2Field('secretAccessKey')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.bucket.id}>
            <label htmlFor="sync-r2-bucket" className="form-label">{$t('存储桶 (Bucket)')}</label>
            <input id="sync-r2-bucket" name="sync-r2-bucket" className="input" autoComplete="off" value={r2Form.bucket} onChange={setR2Field('bucket')} placeholder="your-bucket" />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.r2Endpoint.id}>
            <label htmlFor="sync-r2-endpoint" className="form-label">{$t('端点地址 (Endpoint)')}</label>
            <input id="sync-r2-endpoint" name="sync-r2-endpoint" className="input" autoComplete="off" value={r2Form.endpoint} onChange={setR2Field('endpoint')} placeholder="https://your-account.r2.cloudflarestorage.com" />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.r2Region.id}>
            <label htmlFor="sync-r2-region" className="form-label">{$t('区域 (Region)')}</label>
            <input id="sync-r2-region" name="sync-r2-region" className="input" autoComplete="off" value={r2Form.region} onChange={setR2Field('region')} placeholder="auto" />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.r2Prefix.id}>
            <label htmlFor="sync-r2-prefix" className="form-label">{$t('前缀 (Prefix)')}</label>
            <input id="sync-r2-prefix" name="sync-r2-prefix" className="input" autoComplete="off" value={r2Form.prefix} onChange={setR2Field('prefix')} placeholder="Lumin/" />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.r2MaxBackups.id}>
            <label htmlFor="sync-r2-max-backups" className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input id="sync-r2-max-backups" name="sync-r2-max-backups" className="input" type="number" min="0" autoComplete="off" value={r2Form.maxBackups} onChange={setR2Field('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      ) : null}

      {syncProvider === 'ftp' ? (
        <ProviderCard
          definition={syncSettings.fields.ftp}
          providerKey="ftp"
          provider={providers.ftp}
          form={ftpForm}
          configured={ftpConfigured}
          editing={ftpEditing}
          onEdit={() => setFtpEditing(true)}
          onCancelEdit={() => setFtpEditing(false)}
          testing={ftpTesting}
          testResult={ftpTestResult}
          onTest={onTestFTP}
          loading={ftpLoading}
          onSave={onSaveFTP}
        >
          <div className="form-group" data-settings-field-id={syncSettings.fields.ftpMode.id}>
            <label htmlFor="sync-ftp-mode" className="form-label">{$t('连接模式')}</label>
            <select id="sync-ftp-mode" name="sync-ftp-mode" className="input" value={ftpForm.mode || 'explicit_tls'} onChange={setFTPField('mode')}>
              <option value="explicit_tls">{$t('显式 FTPS（推荐）')}</option>
              <option value="plain">{$t('普通 FTP（不安全）')}</option>
            </select>
          </div>
          {ftpForm.mode === 'plain' ? (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: 'var(--warning)', fontSize: 12, lineHeight: 1.6 }}>
              {$t('普通 FTP 不加密连接，用户名、密码、文件名和传输数据可能被截获。备份文件加密也无法保护 FTP 登录和传输元数据。')}
            </div>
          ) : null}
          <div className="form-group" data-settings-field-id={syncSettings.fields.host.id}>
            <label htmlFor="sync-ftp-host" className="form-label">{$t('主机地址')}</label>
            <input id="sync-ftp-host" name="sync-ftp-host" className="input" autoComplete="off" value={ftpForm.host} onChange={setFTPField('host')} placeholder="ftp.example.com" />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.port.id}>
            <label htmlFor="sync-ftp-port" className="form-label">{$t('端口')}</label>
            <input id="sync-ftp-port" name="sync-ftp-port" className="input" type="number" min="1" max="65535" autoComplete="off" value={ftpForm.port} onChange={setFTPField('port')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.username.id}>
            <label htmlFor="sync-ftp-username" className="form-label">{$t('用户名')}</label>
            <input id="sync-ftp-username" name="sync-ftp-username" className="input" autoComplete="off" value={ftpForm.username} onChange={setFTPField('username')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.password.id}>
            <label htmlFor="sync-ftp-password" className="form-label">{$t('密码')}</label>
            <input id="sync-ftp-password" name="sync-ftp-password" className="input" type="password" autoComplete="current-password" value={ftpForm.password} onChange={setFTPField('password')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.remoteDirectory.id}>
            <label htmlFor="sync-ftp-remote-dir" className="form-label">{$t('远程保存目录')}</label>
            <input id="sync-ftp-remote-dir" name="sync-ftp-remote-dir" className="input" autoComplete="off" value={ftpForm.remoteDir} onChange={setFTPField('remoteDir')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.ftpMaxBackups.id}>
            <label htmlFor="sync-ftp-max-backups" className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input id="sync-ftp-max-backups" name="sync-ftp-max-backups" className="input" type="number" min="0" autoComplete="off" value={ftpForm.maxBackups} onChange={setFTPField('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      ) : null}

      {syncProvider === 'sftp' ? (
        <ProviderCard
          definition={syncSettings.fields.sftp}
          providerKey="sftp"
          provider={providers.sftp}
          form={sftpForm}
          configured={sftpConfigured}
          editing={sftpEditing}
          onEdit={() => setSftpEditing(true)}
          onCancelEdit={() => setSftpEditing(false)}
          testing={sftpTesting}
          testResult={sftpTestResult}
          onTest={onTestSFTP}
          loading={sftpLoading}
          onSave={onSaveSFTP}
        >
          <div className="form-group" data-settings-field-id={syncSettings.fields.sftpHost.id}>
            <label htmlFor="sync-sftp-host" className="form-label">{$t('主机地址')}</label>
            <input id="sync-sftp-host" name="sync-sftp-host" className="input" autoComplete="off" value={sftpForm.host} onChange={setSFTPField('host')} placeholder="sftp.example.com" />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.sftpPort.id}>
            <label htmlFor="sync-sftp-port" className="form-label">{$t('端口')}</label>
            <input id="sync-sftp-port" name="sync-sftp-port" className="input" type="number" min="1" max="65535" autoComplete="off" value={sftpForm.port} onChange={setSFTPField('port')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.sftpUsername.id}>
            <label htmlFor="sync-sftp-username" className="form-label">{$t('用户名')}</label>
            <input id="sync-sftp-username" name="sync-sftp-username" className="input" autoComplete="off" value={sftpForm.username} onChange={setSFTPField('username')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.authMethod.id}>
            <label htmlFor="sync-sftp-auth-method" className="form-label">{$t('认证方式')}</label>
            <select id="sync-sftp-auth-method" name="sync-sftp-auth-method" className="input" value={sftpForm.authMethod} onChange={setSFTPField('authMethod')}>
              <option value="password">{$t('密码认证')}</option>
              <option value="key">{$t('密钥认证')}</option>
            </select>
          </div>
          {sftpForm.authMethod === 'password' ? (
            <div className="form-group" data-settings-field-id={syncSettings.fields.sftpPassword.id}>
              <label htmlFor="sync-sftp-password" className="form-label">{$t('密码')}</label>
              <input id="sync-sftp-password" name="sync-sftp-password" className="input" type="password" autoComplete="current-password" value={sftpForm.password} onChange={setSFTPField('password')} />
            </div>
          ) : (
            <>
              <div className="form-group" data-settings-field-id={syncSettings.fields.privateKey.id}>
                <label className="form-label" htmlFor="sync-sftp-private-key">{$t('私钥内容')}</label>
                <textarea id="sync-sftp-private-key" name="sync-sftp-private-key" className="input" style={{ minHeight: 100, fontFamily: 'monospace', fontSize: 12 }} value={sftpForm.privateKey} onChange={setSFTPField('privateKey')} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-ghost" onClick={async () => {
                  try {
                    const key = await AppGo.ReadPrivateKeyFile();
                    if (key) setSftpForm((prev) => ({ ...prev, privateKey: key }));
                  } catch (e) {
                    addToast($t('读取私钥文件失败') + ': ' + e, 'error');
                  }
                }} style={{ fontSize: 12 }}>
                  <FolderOpen size={14} /> {$t('从文件加载私钥')}
                </button>
              </div>
            </>
          )}
          <div className="form-group" data-settings-field-id={syncSettings.fields.sftpRemoteDirectory.id}>
            <label htmlFor="sync-sftp-remote-dir" className="form-label">{$t('远程保存目录')}</label>
            <input id="sync-sftp-remote-dir" name="sync-sftp-remote-dir" className="input" autoComplete="off" value={sftpForm.remoteDir} onChange={setSFTPField('remoteDir')} />
          </div>
          <div className="form-group" data-settings-field-id={syncSettings.fields.sftpMaxBackups.id}>
            <label htmlFor="sync-sftp-max-backups" className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input id="sync-sftp-max-backups" name="sync-sftp-max-backups" className="input" type="number" min="0" autoComplete="off" value={sftpForm.maxBackups} onChange={setSFTPField('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      ) : null}

      <SettingsPanel data-settings-section-id={syncSettings.sections.cloud.id} style={{ padding: 14 }}>
        <div data-settings-field-id={syncSettings.fields.cloudBackup.id} style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{$t('云端同步')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
          {hasRecoveryPassword ? $t('同步将写入 .lumin2 加密备份') : $t('未开启同步加密时写入明文 .json 备份')}
        </div>
        {autoSyncEnabled && isAnyConfigured ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, marginBottom: 20, color: 'var(--success)', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><Sparkles size={14} /></span> <span><strong>{$t('已开启自动云端备份：')}</strong>{$t('添加、编辑、删除时自动同步')}</span>
          </div>
        ) : null}
        {formattedLastSyncTime ? <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>{$t('上次同步')}: {formattedLastSyncTime}</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))', background: 'color-mix(in srgb, var(--warning) 8%, var(--surface-raised))', color: 'var(--text-secondary)', fontSize: 12, marginBottom: 16 }}>
          <div data-settings-field-id={syncSettings.fields.tombstones.id}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{$t('删除记录')}</span>
            <span style={{ marginLeft: 10, padding: '1px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--warning) 18%, transparent)', color: 'var(--warning)', fontWeight: 600 }}>
              {$t('连接')} {Number.isFinite(tombstoneConnections) ? tombstoneConnections : 0}
            </span>
            <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--text-secondary) 14%, transparent)', color: 'var(--text-primary)', fontWeight: 600 }}>
              {$t('凭据')} {Number.isFinite(tombstoneCredentials) ? tombstoneCredentials : 0}
            </span>
            <div style={{ marginTop: 6, color: 'var(--text-tertiary)', lineHeight: 1.45 }}>{$t('用于多设备同步删除，一般无需处理。')}</div>
          </div>
          {tombstoneTotal > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{$t('清理超过')}</span>
              <select id="sync-tombstone-days" name="sync-tombstone-days" className="input" value={tombstoneDays} disabled={pruningTombstones || syncing || loadingBackups || restoring} onChange={(e) => setTombstoneDays(Number(e.target.value))} style={{ width: 90, height: 32, fontSize: 12, padding: '0 8px' }}>
                <option value={7}>7</option>
                <option value={30}>30</option>
                <option value={90}>90</option>
                <option value={180}>180</option>
                <option value={0}>{$t('全部')}</option>
              </select>
              <span>{$t('天的删除记录')}</span>
              <button
                type="button"
                onClick={() => onPruneSyncTombstones?.(tombstoneDays)}
                disabled={pruningTombstones || syncing || loadingBackups || restoring}
                style={{
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid color-mix(in srgb, var(--warning) 70%, transparent)',
                  background: 'color-mix(in srgb, var(--warning) 16%, transparent)',
                  color: 'var(--warning)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: (pruningTombstones || syncing || loadingBackups || restoring) ? 0.55 : 1,
                }}
              >
                {pruningTombstones ? $t('同步中...') : $t('清理删除记录')}
              </button>
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button data-settings-field-id={syncSettings.fields.mergeSync.id} className="btn btn-secondary" onClick={onSync} disabled={syncing || loadingBackups || restoring}>
            {syncing ? $t('同步中...') : <><RefreshCw size={14} /> {$t('合并同步')}</>}
          </button>
          <button data-settings-field-id={syncSettings.fields.restore.id} className="btn btn-secondary" onClick={onRestore} disabled={loadingBackups || restoring || syncing}>
            {loadingBackups ? $t('加载备份列表中...') : <><RefreshCw size={14} /> {$t('从云端恢复')}</>}
          </button>
        </div>
      </SettingsPanel>
    </SettingsTabRoot>
  );
}