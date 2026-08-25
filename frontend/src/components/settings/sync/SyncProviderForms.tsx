import { t as $t } from '../../../i18n.ts';
import { Button } from '../../ui';
import { FolderOpen } from 'lucide-react';
import { settings } from '../settingDefinitions';
import type { ProviderForm, FieldSetter } from './syncTabTypes';

// settingDefinitions.ts 已类型化，直接使用 settings 注册表
const syncSettings = settings.sync;

export function WebdavFormFields({ webdavForm, setWebdavField }: { webdavForm: ProviderForm; setWebdavField: FieldSetter }) {
  return (
    <>
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
    </>
  );
}

export function R2FormFields({ r2Form, setR2Field }: { r2Form: ProviderForm; setR2Field: FieldSetter }) {
  return (
    <>
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
    </>
  );
}

export function FtpFormFields({ ftpForm, setFTPField }: { ftpForm: ProviderForm; setFTPField: FieldSetter }) {
  return (
    <>
      <div className="form-group" data-settings-field-id={syncSettings.fields.ftpMode.id}>
        <label htmlFor="sync-ftp-mode" className="form-label">{$t('连接模式')}</label>
        <select id="sync-ftp-mode" name="sync-ftp-mode" className="input" value={ftpForm.mode || 'explicit_tls'} onChange={setFTPField('mode')}>
          <option value="explicit_tls">{$t('显式 FTPS（推荐）')}</option>
          <option value="plain">{$t('普通 FTP（不安全）')}</option>
        </select>
      </div>
      {ftpForm.mode === 'plain' ? (
        <div className="px-3.5 py-2.5 rounded-lg bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.35)] text-warning text-sm leading-[1.6]">
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
    </>
  );
}

export function SftpFormFields({ sftpForm, setSFTPField, onLoadPrivateKey }: { sftpForm: ProviderForm; setSFTPField: FieldSetter; onLoadPrivateKey: () => void }) {
  return (
    <>
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
            <textarea id="sync-sftp-private-key" name="sync-sftp-private-key" className="input min-h-[100px] font-mono text-sm" value={sftpForm.privateKey} onChange={setSFTPField('privateKey')} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="ghost" className="text-sm" onClick={onLoadPrivateKey}>
              <FolderOpen size={14} /> {$t('从文件加载私钥')}
            </Button>
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
    </>
  );
}
