import { useEffect, useState } from 'react';
import * as AppGo from '../../../../wailsjs/go/wailsapp/App.js';
import { t as $t } from '../../../i18n.ts';
import type { config } from '../../../../wailsjs/go/models.ts';
import { settingsChoice } from '../settingsDialogs.ts';
import {
  PROVIDERS,
  PROVIDER_LIST,
  defaultFTPForm,
  defaultR2Form,
  defaultSFTPForm,
  defaultWebdavForm,
  parseConnectionTestPort,
  type FTPForm,
  type ProviderFormMap,
  type ProviderKey,
  type ProviderStateEntry,
  type ProviderTestResult,
  type SFTPForm,
} from './syncProviders.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

interface UseSyncProvidersOptions {
  addToast: AddToast;
  onRestored?: () => void;
  refreshSyncMeta: () => Promise<void>;
  setSyncProvider: React.Dispatch<React.SetStateAction<string>>;
}

/** 四个云同步提供方（WebDAV/R2/FTP/SFTP）的表单状态、连接测试与保存逻辑 */
export function useSyncProviders({ addToast, onRestored, refreshSyncMeta, setSyncProvider }: UseSyncProvidersOptions) {
  // WebDAV state
  const [webdavForm, setWebdavForm] = useState(defaultWebdavForm);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult>(null); // null | 'ok' | 'fail'

  // R2 state
  const [r2Form, setR2Form] = useState(defaultR2Form);
  const [r2Configured, setR2Configured] = useState(false);
  const [r2Editing, setR2Editing] = useState(false);
  const [r2Loading, setR2Loading] = useState(false);
  const [r2Testing, setR2Testing] = useState(false);
  const [r2TestResult, setR2TestResult] = useState<ProviderTestResult>(null);

  // FTP state
  const [ftpForm, setFtpForm] = useState<FTPForm>(defaultFTPForm);
  const [ftpConfigured, setFtpConfigured] = useState(false);
  const [ftpEditing, setFtpEditing] = useState(false);
  const [ftpLoading, setFtpLoading] = useState(false);
  const [ftpTesting, setFtpTesting] = useState(false);
  const [ftpTestResult, setFtpTestResult] = useState<ProviderTestResult>(null);

  // SFTP state
  const [sftpForm, setSftpForm] = useState<SFTPForm>(defaultSFTPForm);
  const [sftpConfigured, setSftpConfigured] = useState(false);
  const [sftpEditing, setSftpEditing] = useState(false);
  const [sftpLoading, setSftpLoading] = useState(false);
  const [sftpTesting, setSftpTesting] = useState(false);
  const [sftpTestResult, setSftpTestResult] = useState<ProviderTestResult>(null);

  useEffect(() => {
    let cancelled = false;
    let hasWebdav = false;
    let hasR2 = false;

    Promise.all([
      AppGo.GetWebdavConfig().then((data) => {
        if (cancelled || !data) return;
        setWebdavForm((f) => ({
          ...f,
          url: data.url || f.url,
          username: data.username || '',
          password: data.password || '',
          remotePath: data.remotePath || f.remotePath,
          maxBackups: data.maxBackups || '',
        }));
        if (data.username) {
          setIsConfigured(true);
          hasWebdav = true;
        }
      }).catch(() => {}),
      AppGo.GetR2Config().then((data) => {
        if (cancelled || !data) return;
        setR2Form((f) => ({
          ...f,
          accessKeyId: data.accessKeyId || '',
          secretAccessKey: data.secretAccessKey || '',
          bucket: data.bucket || '',
          endpoint: data.endpoint || '',
          region: data.region || f.region,
          prefix: data.prefix || f.prefix,
          maxBackups: data.maxBackups || '',
        }));
        if (data.bucket && data.endpoint) {
          setR2Configured(true);
          hasR2 = true;
        }
      }).catch(() => {}),
    ]).then(() => {
      if (cancelled) return;
      // Auto-select provider: R2 if only R2 configured, else WebDAV
      if (hasR2 && !hasWebdav) {
        setSyncProvider('r2');
      }
    });

    // Load FTP config
    Promise.all([
      AppGo.GetFTPConfig().then(c => {
        if (cancelled || !c || !c.host) return;
        setFtpForm(prev => ({ ...prev, mode: c.mode || 'explicit_tls', host: c.host, port: c.port, username: c.username, password: c.password, remoteDir: c.remoteDir, maxBackups: c.maxBackups || '' }));
        setFtpConfigured(true);
      }).catch(() => {}),
      AppGo.GetSFTPConfig().then(c => {
        if (cancelled || !c || !c.host) return;
        setSftpForm(prev => ({ ...prev, host: c.host, port: c.port, username: c.username, password: c.password, authMethod: c.authMethod || 'password', privateKey: c.privateKey || '', remoteDir: c.remoteDir, maxBackups: c.maxBackups || '' }));
        setSftpConfigured(true);
      }).catch(() => {}),
    ]);

    return () => { cancelled = true; };
  }, [setSyncProvider]);

  const setWebdav = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setWebdavForm((f) => ({ ...f, [key]: e.target.value }));
  const setR2 = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setR2Form((f) => ({ ...f, [key]: e.target.value }));
  const setFTP = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setFtpForm((f) => ({ ...f, [field]: e.target.value }));
  const setSFTP = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setSftpForm((f) => ({ ...f, [field]: e.target.value }));

  // ────────────────────── Cloud Sync Handlers ──────────────────────
  const providerState: { [K in ProviderKey]: ProviderStateEntry<ProviderFormMap[K]> } = {
    webdav: { form: webdavForm, setForm: setWebdavForm, configured: isConfigured, setConfigured: setIsConfigured, editing: isEditing, setEditing: setIsEditing, loading, setLoading, testing, setTesting, testResult, setTestResult },
    r2: { form: r2Form, setForm: setR2Form, configured: r2Configured, setConfigured: setR2Configured, editing: r2Editing, setEditing: setR2Editing, loading: r2Loading, setLoading: setR2Loading, testing: r2Testing, setTesting: setR2Testing, testResult: r2TestResult, setTestResult: setR2TestResult },
    ftp: { form: ftpForm, setForm: setFtpForm, configured: ftpConfigured, setConfigured: setFtpConfigured, editing: ftpEditing, setEditing: setFtpEditing, loading: ftpLoading, setLoading: setFtpLoading, testing: ftpTesting, setTesting: setFtpTesting, testResult: ftpTestResult, setTestResult: setFtpTestResult },
    sftp: { form: sftpForm, setForm: setSftpForm, configured: sftpConfigured, setConfigured: setSftpConfigured, editing: sftpEditing, setEditing: setSftpEditing, loading: sftpLoading, setLoading: setSftpLoading, testing: sftpTesting, setTesting: setSftpTesting, testResult: sftpTestResult, setTestResult: setSftpTestResult },
  };
  const configuredProviderIds = () => PROVIDER_LIST.map(p => p.id).filter((id): id is ProviderKey => providerState[id as ProviderKey]?.configured);

  function makeTestHandler<K extends ProviderKey>(key: K) {
    const p = PROVIDERS[key];
    const s = providerState[key];
    return async () => {
      s.setTesting(true);
      s.setTestResult(null);
      try {
        await p.test(s.form);
        s.setTestResult('ok');
        addToast(`${p.name} ${$t('连接测试成功 ✓')}`, 'success');
      } catch (err) {
        s.setTestResult('fail');
        addToast(`${p.name} ` + $t('连接测试失败') + `: ${err}`, 'error');
      } finally {
        s.setTesting(false);
      }
    };
  }

  function makeSaveHandler<K extends ProviderKey>(key: K, beforeSave?: (form: ProviderFormMap[K]) => Promise<void> | void) {
    const p = PROVIDERS[key];
    const s = providerState[key];
    return async () => {
      const form = { ...s.form };
      s.setLoading(true);
      try {
        await beforeSave?.(form);
        await p.save(form);
        if (p.isConfigured(form)) {
          s.setConfigured(true);
          s.setEditing(false);
          try {
            const res = await p.sync();
            await refreshSyncMeta();
            addToast(`${p.name} ${$t('同步成功！本地')} ${res.localCount} ${$t('个 + 云端')} ${res.remoteCount} ${$t('个 =')} ${res.mergedCount} ${$t('个')}`, 'success');
            onRestored?.();
          } catch (_) {
            try {
              const data = await p.backup();
              await refreshSyncMeta();
              addToast(`${p.name} ${$t('配置已保存，已上传')} ${data.count} ${$t('个服务器')}`, 'success');
            } catch (_) {
              addToast(`${p.name} ${$t('配置已保存，但同步失败，可稍后手动上传')}`, 'warning');
            }
          }
        } else {
          addToast(`${p.name} ${$t('配置已保存')}`, 'success');
        }
      } catch (err) {
        addToast(err instanceof Error ? err : String(err), 'error');
      } finally {
        s.setLoading(false);
      }
    };
  }

  const confirmFTPConnection = async (form: FTPForm) => {
    const port = parseConnectionTestPort(form.port);
    // ProviderDefinition.test 声明为 Promise<unknown>，此处按 wailsjs 模型收窄
    const result = await PROVIDERS.ftp.test(form) as config.FTPConnectionTestResult;
    const certificate = result?.certificateApprovalRequired;
    if (!certificate) return;

    const names = [...(certificate.dnsNames || []), ...(certificate.ipAddresses || [])].join(', ') || '-';
    const action = await settingsChoice(
      [
        $t('FTPS 服务器证书不受系统信任。'),
        $t('请先通过可信渠道核对证书指纹，再决定是否接受。'),
        '',
        `${$t('主机:')} ${certificate.endpoint}`,
        `${$t('证书指纹:')} ${certificate.fingerprint}`,
        `${$t('证书主题:')} ${certificate.subject}`,
        `${$t('证书签发者:')} ${certificate.issuer}`,
        `${$t('证书名称:')} ${names}`,
        `${$t('有效期:')} ${certificate.notBefore} — ${certificate.notAfter}`,
        ...(certificate.pinnedFingerprint ? ['', `${$t('旧证书指纹:')} ${certificate.pinnedFingerprint}`] : []),
      ].join('\n'),
      $t('FTPS 证书确认'),
      [
        { label: $t('接受并保存'), value: 1, primary: true },
        { label: $t('取消'), value: 0, secondary: true },
      ]
    );
    if (action !== 1) throw new Error($t('已取消证书信任'));
    await AppGo.TestFTPConnectionWithCertificateApproval(
      form.host, port, form.username, form.password, form.mode,
      certificate.fingerprint, certificate.pinnedFingerprint || ''
    );
  };

  const confirmSFTPConnection = async (form: SFTPForm) => {
    const port = parseConnectionTestPort(form.port);
    // ProviderDefinition.test 声明为 Promise<unknown>，此处按 wailsjs 模型收窄
    const result = await PROVIDERS.sftp.test(form) as config.SFTPConnectionTestResult;
    const mismatch = result?.hostKeyMismatch;
    if (!mismatch) return;

    const action = await settingsChoice(
      [
        $t('远程主机密钥已变更，可能存在中间人攻击！'),
        '',
        `${$t('主机:')} ${form.host}:${port}`,
        '',
        $t('新密钥指纹:'),
        mismatch.newFingerprint,
        '',
        $t('旧密钥指纹:'),
        ...(mismatch.oldFingerprints || []),
        '',
        $t('请先通过可信渠道核对新指纹。确认这是预期变更后，才能接受并保存。'),
      ].join('\n'),
      $t('SFTP 主机密钥已变更'),
      [
        { label: $t('接受并保存'), value: 1, primary: true },
        { label: $t('取消'), value: 0, secondary: true },
      ]
    );
    if (action !== 1) throw new Error($t('已取消主机密钥更新'));
    await AppGo.TestSFTPConnectionWithHostKeyApproval(
      form.host, port, form.username, form.password, form.authMethod, form.privateKey, '', mismatch.newFingerprint
    );
  };

  const confirmSecureProviders = async (providerIds: ProviderKey[]) => {
    for (const providerId of new Set(providerIds)) {
      if (providerId === 'ftp' && providerState.ftp.configured) {
        await confirmFTPConnection({ ...providerState.ftp.form });
      } else if (providerId === 'sftp' && providerState.sftp.configured) {
        await confirmSFTPConnection({ ...providerState.sftp.form });
      }
    }
  };

  function makeSecureTestHandler<K extends ProviderKey>(key: K, confirmConnection: (form: ProviderFormMap[K]) => Promise<void>) {
    const p = PROVIDERS[key];
    const s = providerState[key];
    return async () => {
      const form = { ...s.form };
      s.setTesting(true);
      s.setTestResult(null);
      try {
        await confirmConnection(form);
        s.setTestResult('ok');
        addToast(`${p.name} ${$t('连接测试成功 ✓')}`, 'success');
      } catch (err) {
        s.setTestResult('fail');
        addToast(`${p.name} ${$t('连接测试失败')}: ${err}`, 'error');
      } finally {
        s.setTesting(false);
      }
    };
  }

  const handleTest = makeTestHandler('webdav');
  const handleSave = makeSaveHandler('webdav');
  const handleR2Test = makeTestHandler('r2');
  const handleR2Save = makeSaveHandler('r2');
  const handleTestFTP = makeSecureTestHandler('ftp', confirmFTPConnection);
  const handleSaveFTP = makeSaveHandler('ftp', confirmFTPConnection);
  const handleTestSFTP = makeSecureTestHandler('sftp', confirmSFTPConnection);
  const handleSaveSFTP = makeSaveHandler('sftp', confirmSFTPConnection);

  return {
    // WebDAV
    webdavForm, setWebdavForm, isConfigured, setIsConfigured, isEditing, setIsEditing, loading, testing, testResult, setWebdav, handleTest, handleSave,
    // R2
    r2Form, r2Configured, r2Editing, setR2Editing, r2Loading, r2Testing, r2TestResult, setR2, handleR2Test, handleR2Save,
    // FTP
    ftpForm, ftpConfigured, ftpEditing, setFtpEditing, ftpLoading, ftpTesting, ftpTestResult, setFTP, handleTestFTP, handleSaveFTP,
    // SFTP
    sftpForm, sftpConfigured, sftpEditing, setSftpEditing, sftpLoading, sftpTesting, sftpTestResult, setSFTP, handleTestSFTP, handleSaveSFTP, setSftpForm,
    // 共享
    providerState, configuredProviderIds, confirmSecureProviders,
  };
}
