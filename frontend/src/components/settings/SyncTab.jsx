import React from 'react';
import { t as $t } from '../../i18n.js';
import * as AppGo from '../../../wailsjs/go/main/App.js';
import { Save, Cloud, Database, Folder, FolderOpen, Lock, RefreshCw, Sparkles, Plug } from 'lucide-react';

const PROVIDER_ICON_CMP = { webdav: Cloud, r2: Database, ftp: Folder, sftp: Lock };

function ProviderCard({ provider, providerKey, form, configured, editing, onEdit, onCancelEdit, testing, testResult, onTest, loading, onSave, children }) {
  const accent = provider.accent;
  const accentRgb = provider.accentRgb;
  const IC = PROVIDER_ICON_CMP[providerKey];
  return (
    <div style={{ background: 'var(--surface-overlay)', padding: 24, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--surface-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>{IC ? <IC size={20} /> : null}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{$t(provider.titleKey)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{$t(provider.subtitleKey)}</div>
        </div>
      </div>

      {configured && !editing ? (
        <div style={{
          position: 'relative',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          boxShadow: 'none',
          overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '4px', height: '100%',
            background: accent,
            boxShadow: `0 0 12px ${accent}`
          }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent }}></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.3px' }}>{$t(provider.successMsgKey)}</div>
            </div>
            <button onClick={onEdit} style={{
              padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
              background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              {$t('修改配置')}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '4px' }}>
            {provider.summaryFields(form).map((sf, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface-overlay)',
                padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
                ...(sf.fullWidth ? { gridColumn: '1 / -1' } : {})
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>{sf.label}</span>
                <span style={{
                  fontSize: 14, color: sf.primary ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: sf.primary ? 600 : 400, fontFamily: 'var(--font-mono)',
                  ...(sf.fullWidth ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {})
                }}>{sf.value}</span>
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
            {editing && (
              <button className="btn btn-ghost" onClick={onCancelEdit} style={{ marginLeft: 'auto' }}>{$t('取消')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
  lastBackup, syncing, onSync, loadingBackups, restoring, onRestore, isAnyConfigured, addToast,
  recoveryPassword, recoveryPasswordEditing, setRecoveryPasswordEditing, recoveryPasswordInput, setRecoveryPasswordInput, onSaveRecoveryPassword, onClearRecoveryPassword
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* 自动同步 */}
      <div style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginRight: 4 }}>{$t('自动同步')}</span>
          <button className={autoSyncEnabled ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => onAutoSyncEnabledChange(!autoSyncEnabled)}>
            {autoSyncEnabled ? $t('已开启') : $t('已关闭')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginRight: 4 }}>{$t('自动同步模式')}</span>
          {[
            { id: 'webdav', label: <><Cloud size={14} /> WebDAV</> },
            { id: 'r2', label: <><Database size={14} /> R2 (S3)</> },
            { id: 'ftp', label: <><Folder size={14} /> FTP</> },
            { id: 'sftp', label: <><Lock size={14} /> SFTP</> },
            { id: 'all', label: <><RefreshCw size={14} /> {$t('全部')}</> },
          ].map(opt => (
            <button
              key={opt.id}
              className={syncMode === opt.id ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => onSyncModeChange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginRight: 4 }}>{$t('同步加密')}</span>
          {recoveryPassword ? (
            <>
              <button className="btn btn-primary" disabled>
                <Lock size={14} /> {$t('已加密')}
              </button>
              <button className="btn btn-secondary" onClick={() => { setRecoveryPasswordEditing(true); setRecoveryPasswordInput(''); }}>
                {$t('修改密码')}
              </button>
              <button className="btn btn-ghost" onClick={onClearRecoveryPassword} style={{ color: 'var(--danger)' }}>
                {$t('关闭加密')}
              </button>
            </>
          ) : recoveryPasswordEditing ? (
            <>
              <input
                className="input"
                type="password"
                placeholder={$t('请输入恢复密码')}
                value={recoveryPasswordInput}
                onChange={(e) => setRecoveryPasswordInput(e.target.value)}
                autoFocus
                style={{ width: 200, height: 34, fontSize: 13 }}
              />
              <button className="btn btn-primary" onClick={onSaveRecoveryPassword} disabled={!recoveryPasswordInput.trim()}>
                {$t('开启加密')}
              </button>
              <button className="btn btn-ghost" onClick={() => { setRecoveryPasswordEditing(false); setRecoveryPasswordInput(''); }}>
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
        {recoveryPassword && recoveryPasswordEditing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              type="password"
              placeholder={$t('请输入新恢复密码')}
              value={recoveryPasswordInput}
              onChange={(e) => setRecoveryPasswordInput(e.target.value)}
              autoFocus
              style={{ width: 200, height: 34, fontSize: 13 }}
            />
            <button className="btn btn-primary" onClick={onSaveRecoveryPassword} disabled={!recoveryPasswordInput.trim()}>
              {$t('保存')}
            </button>
            <button className="btn btn-ghost" onClick={() => { setRecoveryPasswordEditing(false); setRecoveryPasswordInput(''); }}>
              {$t('取消')}
            </button>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {$t('默认明文同步，选择加密后需设置恢复密码。系统重装或云端凭据变更后，用恢复密码即可恢复备份。')}
          <div style={{ marginTop: 4, color: 'var(--warning)' }}>{$t('注意：多设备同步时，所有设备需使用相同的加密密码，否则其他设备无法解密同步数据。')}</div>
          {!recoveryPassword && (
            <div style={{ marginTop: 4, color: 'var(--warning)' }}>{$t('未开启加密同步时会以明文保存到云端；如需保护云端备份，请选择加密并设置恢复密码。')}</div>
          )}
          <div style={{ marginTop: 4, color: 'var(--text-tertiary)', opacity: 0.7 }}>
            {$t('旧版用云端凭据派生密钥加密的备份仍可解密（兼容），但将在 v1.2.0+ 移除。')}
          </div>
        </div>
      </div>

      {/* Provider Selector */}
      <div style={{ display: 'flex', gap: 8, background: 'var(--surface-overlay)', padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        {providerList.map(p => (
          <button
            key={p.id}
            onClick={() => onSyncProviderChange(p.id)}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 'var(--radius-sm)',
              background: syncProvider === p.id ? 'var(--surface-raised)' : 'transparent',
              border: syncProvider === p.id ? '1px solid var(--border)' : '1px solid transparent',
              color: syncProvider === p.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: syncProvider === p.id ? 600 : 400,
              cursor: 'pointer', fontSize: 14, transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {(() => { const IC = PROVIDER_ICON_CMP[p.id]; return IC ? <IC size={16} /> : null; })()} {p.label}
          </button>
        ))}
      </div>

      {/* WebDAV Config */}
      {syncProvider === 'webdav' && (
        <ProviderCard
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
          <div className="form-group">
            <label className="form-label">{$t('端点地址 (URL)')}</label>
            <input className="input" value={webdavForm.url} onChange={setWebdavField('url')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('用户名')}</label>
            <input className="input" value={webdavForm.username} onChange={setWebdavField('username')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('密码 / 授权码')}</label>
            <input className="input" type="password" value={webdavForm.password} onChange={setWebdavField('password')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('远程保存目录')}</label>
            <input className="input" value={webdavForm.remotePath} onChange={setWebdavField('remotePath')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input className="input" type="number" min="0" value={webdavForm.maxBackups} onChange={setWebdavField('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      )}

      {/* R2 Config */}
      {syncProvider === 'r2' && (
        <ProviderCard
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
          <div className="form-group">
            <label className="form-label">{$t('访问密钥 ID (Access Key ID)')}</label>
            <input className="input" value={r2Form.accessKeyId} onChange={setR2Field('accessKeyId')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('秘密访问密钥 (Secret Access Key)')}</label>
            <input className="input" type="password" value={r2Form.secretAccessKey} onChange={setR2Field('secretAccessKey')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('存储桶 (Bucket)')}</label>
            <input className="input" value={r2Form.bucket} onChange={setR2Field('bucket')} placeholder="your-bucket" />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('端点地址 (Endpoint)')}</label>
            <input className="input" value={r2Form.endpoint} onChange={setR2Field('endpoint')} placeholder="https://your-account.r2.cloudflarestorage.com" />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('区域 (Region)')}</label>
            <input className="input" value={r2Form.region} onChange={setR2Field('region')} placeholder="auto" />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('前缀 (Prefix)')}</label>
            <input className="input" value={r2Form.prefix} onChange={setR2Field('prefix')} placeholder="Lumin/" />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input className="input" type="number" min="0" value={r2Form.maxBackups} onChange={setR2Field('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      )}

      {/* FTP Config */}
      {syncProvider === 'ftp' && (
        <ProviderCard
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
          <div className="form-group">
            <label className="form-label">{$t('连接模式')}</label>
            <select className="input" value={ftpForm.mode || 'explicit_tls'} onChange={setFTPField('mode')}>
              <option value="explicit_tls">{$t('显式 FTPS（推荐）')}</option>
              <option value="plain">{$t('普通 FTP（不安全）')}</option>
            </select>
          </div>
          {ftpForm.mode === 'plain' && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: 'var(--warning)', fontSize: 12, lineHeight: 1.6 }}>
              {$t('普通 FTP 不加密连接，用户名、密码、文件名和传输数据可能被截获。备份文件加密也无法保护 FTP 登录和传输元数据。')}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">{$t('主机地址')}</label>
            <input className="input" value={ftpForm.host} onChange={setFTPField('host')} placeholder="ftp.example.com" />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('端口')}</label>
            <input className="input" type="number" min="1" max="65535" value={ftpForm.port} onChange={setFTPField('port')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('用户名')}</label>
            <input className="input" value={ftpForm.username} onChange={setFTPField('username')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('密码')}</label>
            <input className="input" type="password" value={ftpForm.password} onChange={setFTPField('password')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('远程保存目录')}</label>
            <input className="input" value={ftpForm.remoteDir} onChange={setFTPField('remoteDir')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input className="input" type="number" min="0" value={ftpForm.maxBackups} onChange={setFTPField('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      )}

      {/* SFTP Config */}
      {syncProvider === 'sftp' && (
        <ProviderCard
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
          <div className="form-group">
            <label className="form-label">{$t('主机地址')}</label>
            <input className="input" value={sftpForm.host} onChange={setSFTPField('host')} placeholder="sftp.example.com" />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('端口')}</label>
            <input className="input" type="number" min="1" max="65535" value={sftpForm.port} onChange={setSFTPField('port')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('用户名')}</label>
            <input className="input" value={sftpForm.username} onChange={setSFTPField('username')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('认证方式')}</label>
            <select className="input" value={sftpForm.authMethod} onChange={setSFTPField('authMethod')}>
              <option value="password">{$t('密码认证')}</option>
              <option value="key">{$t('密钥认证')}</option>
            </select>
          </div>
          {sftpForm.authMethod === 'password' ? (
            <div className="form-group">
              <label className="form-label">{$t('密码')}</label>
              <input className="input" type="password" value={sftpForm.password} onChange={setSFTPField('password')} />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">{$t('私钥内容')}</label>
                <textarea className="input" style={{ minHeight: 100, fontFamily: 'monospace', fontSize: 12 }} value={sftpForm.privateKey} onChange={setSFTPField('privateKey')} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-ghost" onClick={async () => {
                  try {
                    const key = await AppGo.ReadPrivateKeyFile();
                    if (key) setSftpForm(prev => ({ ...prev, privateKey: key }));
                  } catch (e) {
                    addToast($t('读取私钥文件失败') + ': ' + e, 'error');
                  }
                }} style={{ fontSize: 12 }}>
                  <FolderOpen size={14} /> {$t('从文件加载私钥')}
                </button>
              </div>
            </>
          )}
          <div className="form-group">
            <label className="form-label">{$t('远程保存目录')}</label>
            <input className="input" value={sftpForm.remoteDir} onChange={setSFTPField('remoteDir')} />
          </div>
          <div className="form-group">
            <label className="form-label">{$t('保留份数 (0=不限)')}</label>
            <input className="input" type="number" min="0" value={sftpForm.maxBackups} onChange={setSFTPField('maxBackups')} placeholder="0" />
          </div>
        </ProviderCard>
      )}

      {/* 云端同步 */}
      <div style={{ background: 'var(--surface-overlay)', padding: 24, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{$t('云端同步')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
          {recoveryPassword ? $t('同步将写入 .lumin2 加密备份') : $t('未开启同步加密时写入明文 .json 备份')}
        </div>

        {autoSyncEnabled && isAnyConfigured && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, marginBottom: 20, color: 'var(--success)', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><Sparkles size={14} /></span> <span><strong>{$t('已开启自动云端备份：')}</strong>{$t('添加、编辑、删除时自动同步')}</span>
          </div>
        )}

        {lastBackup && <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>{$t('上次同步')}: {lastBackup}</div>}

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={onSync} disabled={syncing || loadingBackups || restoring}>
            {syncing ? $t('同步中...') : <><RefreshCw size={14} /> {$t('合并同步')}</>}
          </button>
          <button className="btn btn-secondary" onClick={onRestore} disabled={loadingBackups || restoring || syncing}>
            {loadingBackups ? $t('加载备份列表中...') : <><RefreshCw size={14} /> {$t('从云端恢复')}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
