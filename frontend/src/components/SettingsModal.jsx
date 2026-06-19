import { useState, useEffect } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { setLanguage as setGlobalLanguage, t as $t } from '../i18n.js';
import logoImg from '../assets/logo.png';
import { APP_VERSION } from '../config.js';
import { useUpdateChecker } from '../hooks/useUpdateChecker.js';

const I18N = {
  'zh-CN': {
    title: '设置',
    tabs: { network: '网络', appearance: '外观', shortcuts: '快捷键', sync: '同步与云', app: '关于' },
    about: {
      version: '版本',
      reportTitle: '反馈问题',
      reportDesc: '生成预填的 GitHub issue',
      communityTitle: '社区',
      communityDesc: '参与 GitHub Discussions 讨论',
      githubTitle: 'GitHub',
      githubDesc: '源代码',
      changelogTitle: '更新内容',
      changelogDesc: '查看发布说明',
    },
    network: {
      pingProtocolTitle: '延迟检测协议',
      pingProtocolDesc: '选择如何测量服务器网络延迟，不同协议适用于不同的网络环境。',
      sshLabel: 'SSH Banner RTT',
      sshDesc: '通过读取 SSH 握手包测速，穿透 TUN 代理测出真实网络延迟，推荐',
      sshTag: '推荐',
      tcpLabel: 'TCP Dial',
      tcpDesc: '通过 TCP 连接建立测速，适用于局域网/私有网络或未开代理的环境',
      tip: '如果您使用 TUN 模式代理（Clash/V2Ray），推荐使用 SSH Banner RTT 模式，可以穿透代理测出真实延迟。',
      refreshTitle: '监控刷新频率',
      refreshDesc: '设置探针数据和延迟测试的自动刷新间隔。越高的频率越实时，但资源占用越大。',
      probeRefresh: '探针刷新间隔',
      pingRefresh: '延迟检测间隔',
      fixed30s: '2 秒（固定）',
    },
    appearance: {
      langTitle: '语言',
      langLabel: '语言',
      langDesc: '选择界面语言',
      fontLabel: '界面字体',
      fontDesc: '选择软件界面使用的字体',
      termFontLabel: '终端字体大小',
      termFontDesc: '调节终端的字符显示大小',
      termEchoLabel: '终端输入回显',
      termEchoDesc: '关闭后输入密码等敏感内容时不会显示字符',
      themeTitle: '界面主题',
      themeLabel: '主题',
      themeDesc: '选择浅色、深色或跟随系统设置',
      themeLight: '☀️ 浅色',
      themeSys: '💻 系统',
      themeDark: '🌙 深色',
      accentTitle: '强调色',
      accentLabel: '使用自定义强调色',
      accentDesc: '覆盖主题自带的强调色',
      termBgTitle: '终端背景',
      termBgLabel: '自定义终端壁纸',
      termBgDesc: '设置终端底部的自定义背景图片',
      termBgOpacityLabel: '壁纸可见度',
      termBgUpload: '上传图片',
      termBgReset: '恢复默认',
    }
  },
  'en-US': {
    title: 'Settings',
    tabs: { network: 'Network', appearance: 'Appearance', shortcuts: 'Shortcuts', sync: 'Sync & Cloud', app: 'About' },
    about: {
      version: 'Version',
      reportTitle: 'Report an Issue',
      reportDesc: 'Generate a pre-filled GitHub issue',
      communityTitle: 'Community',
      communityDesc: 'Join GitHub Discussions',
      githubTitle: 'GitHub',
      githubDesc: 'Source code',
      changelogTitle: 'Changelog',
      changelogDesc: 'View release notes',
    },
    network: {
      pingProtocolTitle: 'Ping Protocol',
      pingProtocolDesc: 'Choose how to measure server latency. Different protocols suit different networks.',
      sshLabel: 'SSH Banner RTT',
      sshDesc: 'Test via SSH handshake. Can penetrate TUN proxies to show real latency. Recommended.',
      sshTag: 'Recommended',
      tcpLabel: 'TCP Dial',
      tcpDesc: 'Test via TCP connection. Best for LAN or non-proxied environments.',
      tip: 'If using a TUN proxy (Clash/V2Ray), SSH Banner RTT is recommended to bypass the proxy and measure true latency.',
      refreshTitle: 'Refresh Frequency',
      refreshDesc: 'Set auto-refresh intervals for probe data and latency testing. Higher means more real-time, but uses more resources.',
      probeRefresh: 'Probe Refresh Interval',
      pingRefresh: 'Ping Interval',
      fixed30s: '2 seconds (fixed)',
    },
    appearance: {
      langTitle: 'Language',
      langLabel: 'Language',
      langDesc: 'Choose interface language',
      fontLabel: 'Interface Font',
      fontDesc: 'Choose the font used in the interface',
      termFontLabel: 'Terminal Font Size',
      termFontDesc: 'Adjust terminal font size',
      termEchoLabel: 'Terminal Input Echo',
      termEchoDesc: 'When disabled, sensitive input like passwords will not be displayed',
      themeTitle: 'Interface Theme',
      themeLabel: 'Theme',
      themeDesc: 'Choose Light, Dark or System',
      themeLight: '☀️ Light',
      themeSys: '💻 System',
      themeDark: '🌙 Dark',
      accentTitle: 'Accent Color',
      accentLabel: 'Use Custom Accent',
      accentDesc: 'Override default accent color',
      termBgTitle: 'Terminal Background',
      termBgLabel: 'Custom Wallpaper',
      termBgDesc: 'Set custom background image for terminals',
      termBgOpacityLabel: 'Wallpaper Visibility',
      termBgUpload: 'Upload Image',
      termBgReset: 'Reset Default',
    }
  }
};

const TABS = [
  { id: 'network', icon: '🌐' },
  { id: 'appearance', icon: '🎨' },
  { id: 'shortcuts', icon: '⌨️' },
  { id: 'sync', icon: '☁️' },
  { id: 'app', icon: 'ℹ️' },
];

const defaultWebdavForm = {
  url: '',
  username: '',
  password: '',
  remotePath: '/Lumin/',
  maxBackups: '',
};

const defaultR2Form = {
  accessKeyId: '',
  secretAccessKey: '',
  bucket: '',
  endpoint: '',
  region: 'auto',
  prefix: 'Lumin/',
  maxBackups: '',
};

const defaultFTPForm = {
  host: '',
  port: 21,
  username: '',
  password: '',
  remoteDir: '/Lumin/',
  maxBackups: '',
};

const defaultSFTPForm = {
  host: '',
  port: 22,
  username: '',
  password: '',
  authMethod: 'password',
  privateKey: '',
  remoteDir: '/Lumin/',
  maxBackups: '',
};

const PROVIDERS = {
  webdav: {
    name: 'WebDAV',
    icon: '☁️',
    titleKey: 'WebDAV 配置',
    subtitleKey: '配置 WebDAV 端点用于加密同步服务器列表',
    accent: 'var(--green)',
    accentRgb: '16, 185, 129',
    successMsgKey: '已成功绑定 WebDAV 服务',
    defaultForm: defaultWebdavForm,
    test: (f) => AppGo.TestWebdavConnection(f.url, f.username, f.password),
    save: (f) => AppGo.SaveWebdavConfig(f),
    sync: () => AppGo.SyncFromWebdav(),
    backup: () => AppGo.BackupToWebdav(),
    list: () => AppGo.ListWebdavBackups(),
    restore: (name) => AppGo.RestoreFromWebdavFile(name),
    getConfig: () => AppGo.GetWebdavConfig(),
    isConfigured: (f) => !!f.username,
    applyConfig: (data) => ({ url: data.url || '', username: data.username || '', password: data.password || '', remotePath: data.remotePath || '/Lumin/', maxBackups: data.maxBackups || '' }),
    summaryFields: (f) => [
      { label: $t('绑定账号'), value: f.username, primary: true },
      { label: $t('备份目录'), value: f.remotePath },
      { label: $t('保留份数'), value: f.maxBackups || $t('不限') },
      { label: $t('服务器地址'), value: f.url, fullWidth: true },
    ],
  },
  r2: {
    name: 'R2',
    icon: '🗄️',
    titleKey: 'R2 (S3 兼容) 配置',
    subtitleKey: '配置 Cloudflare R2 或任意 S3 兼容对象存储用于加密同步',
    accent: '#3b82f6',
    accentRgb: '59, 130, 246',
    successMsgKey: '已成功绑定 R2 对象存储',
    defaultForm: defaultR2Form,
    test: (f) => AppGo.TestR2Connection(f.accessKeyId, f.secretAccessKey, f.bucket, f.endpoint),
    save: (f) => AppGo.SaveR2Config(f),
    sync: () => AppGo.SyncFromR2(),
    backup: () => AppGo.BackupToR2(),
    list: () => AppGo.ListR2Backups(),
    restore: (name) => AppGo.RestoreFromR2File(name),
    getConfig: () => AppGo.GetR2Config(),
    isConfigured: (f) => !!(f.bucket && f.endpoint),
    applyConfig: (data) => ({ accessKeyId: data.accessKeyId || '', secretAccessKey: data.secretAccessKey || '', bucket: data.bucket || '', endpoint: data.endpoint || '', region: data.region || 'auto', prefix: data.prefix || 'Lumin/', maxBackups: data.maxBackups || '' }),
    summaryFields: (f) => [
      { label: 'Bucket', value: f.bucket, primary: true },
      { label: $t('前缀目录'), value: f.prefix },
      { label: $t('端点地址'), value: f.endpoint, fullWidth: true },
      { label: $t('保留份数'), value: f.maxBackups || $t('不限') },
    ],
  },
  ftp: {
    name: 'FTP',
    icon: '📁',
    titleKey: 'FTP 配置',
    subtitleKey: '配置 FTP 服务器用于加密同步服务器列表',
    accent: '#f472b6',
    accentRgb: '244, 114, 182',
    successMsgKey: '已成功绑定 FTP 服务器',
    defaultForm: defaultFTPForm,
    test: (f) => AppGo.TestFTPConnection(f.host, f.port, f.username, f.password),
    save: (f) => AppGo.SaveFTPConfig({ host: f.host, port: String(f.port), username: f.username, password: f.password, remoteDir: f.remoteDir, maxBackups: String(f.maxBackups || '') }),
    sync: () => AppGo.SyncFromFTP(),
    backup: () => AppGo.BackupToFTP(),
    list: () => AppGo.ListFTPBackups(),
    restore: (name) => AppGo.RestoreFromFTPFile(name),
    getConfig: () => AppGo.GetFTPConfig(),
    isConfigured: (f) => !!f.host,
    applyConfig: (data) => ({ host: data.host || '', port: data.port || 21, username: data.username || '', password: data.password || '', remoteDir: data.remoteDir || '/Lumin/', maxBackups: data.maxBackups || '' }),
    summaryFields: (f) => [
      { label: $t('主机地址'), value: f.host, primary: true },
      { label: $t('端口'), value: f.port },
      { label: $t('用户名'), value: f.username, primary: true },
      { label: $t('远程目录'), value: f.remoteDir },
      { label: $t('保留份数'), value: f.maxBackups || $t('不限') },
    ],
  },
  sftp: {
    name: 'SFTP',
    icon: '🔒',
    titleKey: 'SFTP (SSH) 配置',
    subtitleKey: '配置 SFTP 服务器用于加密同步服务器列表',
    accent: '#22c55e',
    accentRgb: '34, 197, 94',
    successMsgKey: '已成功绑定 SFTP 服务器',
    defaultForm: defaultSFTPForm,
    test: (f) => AppGo.TestSFTPConnection(f.host, f.port, f.username, f.password, f.authMethod, f.privateKey),
    save: (f) => AppGo.SaveSFTPConfig({ host: f.host, port: String(f.port), username: f.username, password: f.password, authMethod: f.authMethod, privateKey: f.privateKey, remoteDir: f.remoteDir, maxBackups: String(f.maxBackups || '') }),
    sync: () => AppGo.SyncFromSFTP(),
    backup: () => AppGo.BackupToSFTP(),
    list: () => AppGo.ListSFTPBackups(),
    restore: (name) => AppGo.RestoreFromSFTPFile(name),
    getConfig: () => AppGo.GetSFTPConfig(),
    isConfigured: (f) => !!f.host,
    applyConfig: (data) => ({ host: data.host || '', port: data.port || 22, username: data.username || '', password: data.password || '', authMethod: data.authMethod || 'password', privateKey: data.privateKey || '', remoteDir: data.remoteDir || '/Lumin/', maxBackups: data.maxBackups || '' }),
    summaryFields: (f) => [
      { label: $t('主机地址'), value: f.host, primary: true },
      { label: $t('端口'), value: f.port },
      { label: $t('用户名'), value: f.username, primary: true },
      { label: $t('远程目录'), value: f.remoteDir },
      { label: $t('保留份数'), value: f.maxBackups || $t('不限') },
    ],
  },
};

const PROVIDER_LIST = [
  { id: 'webdav', icon: '☁️', label: 'WebDAV' },
  { id: 'r2', icon: '🗄️', label: 'R2 (S3)' },
  { id: 'ftp', icon: '📁', label: 'FTP' },
  { id: 'sftp', icon: '🔒', label: 'SFTP' },
];

function ProviderCard({ provider, form, configured, editing, onEdit, onCancelEdit, testing, testResult, onTest, loading, onSave, children }) {
  const accent = provider.accent;
  const accentRgb = provider.accentRgb;
  return (
    <div style={{ background: 'var(--bg-2)', padding: 24, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{provider.icon}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>{$t(provider.titleKey)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{$t(provider.subtitleKey)}</div>
        </div>
      </div>

      {configured && !editing ? (
        <div style={{
          position: 'relative',
          background: `linear-gradient(135deg, rgba(${accentRgb},0.05) 0%, var(--bg-1) 100%)`,
          border: `1px solid rgba(${accentRgb}, 0.2)`,
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '4px', height: '100%',
            background: accent,
            boxShadow: `0 0 12px ${accent}`
          }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent, boxShadow: `0 0 10px ${accent}` }}></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '0.3px' }}>{$t(provider.successMsgKey)}</div>
            </div>
            <button onClick={onEdit} style={{
              padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--text-2)',
              cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-2)'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              {$t('修改配置')}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '4px' }}>
            {provider.summaryFields(form).map((sf, i) => (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-2)',
                padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
                ...(sf.fullWidth ? { gridColumn: '1 / -1' } : {})
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-4)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>{sf.label}</span>
                <span style={{
                  fontSize: 14, color: sf.primary ? 'var(--text-1)' : 'var(--text-2)',
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
            <button className="btn btn-secondary" onClick={onTest} disabled={testing}>
              {testing ? $t('测试中...') : $t('🔌 测试连接')} {testResult === 'ok' && '✓'} {testResult === 'fail' && '✗'}
            </button>
            <button className="btn btn-primary" onClick={onSave} disabled={loading}>
              {loading ? $t('保存中...') : $t('💾 保存配置')}
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

// 快捷键行配置
const SHORTCUT_ROWS = [
  { labelKey: '从终端复制', key: 'copy' },
  { labelKey: '粘贴到终端', key: 'paste' },
  { labelKey: '清空终端缓冲区', key: 'clear' },
  { labelKey: '新建本地标签页', key: 'newTab' },
  { labelKey: '打断当前指令 (SIGINT)', key: 'sigint' },
  { labelKey: '结束终端会话 (EOF)', key: 'eof' },
  { labelKey: '后台挂起进程 (SIGTSTP)', key: 'suspend' },
  { labelKey: '清空当前输入行', key: 'clearLine' },
];

// 单个快捷键行
function ShortcutRow({ label, keyName, shortcuts, listeningKey, onSetListening, withBorder }) {
  const isListening = listeningKey === keyName;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', ...(withBorder ? { borderBottom: '1px solid var(--border)' } : {}) }}>
      <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{label}</span>
      <button
        onClick={() => onSetListening(keyName)}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: isListening ? 'var(--green)' : 'var(--text-4)',
          background: 'var(--bg-1)', padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
          border: isListening ? '1px solid var(--green)' : '1px solid var(--border)',
          transition: 'var(--transition)'
        }}
      >
        {isListening ? $t('请按下快捷键...') : shortcuts[keyName]}
      </button>
    </div>
  );
}

export default function SettingsModal({ onClose, addToast, onRestored }) {
  const CURRENT_VERSION = APP_VERSION;
  const [updateInfo, setUpdateInfo] = useState(null);

  const { checking: checkingUpdate, downloadProgress, checkUpdate, applyUpdate } = useUpdateChecker({
    onResult: (result) => {
      if (result.hasUpdate) {
        setUpdateInfo({
          hasUpdate: true,
          latestVersion: 'v' + result.latestVersion,
          url: result.url,
          filename: result.filename,
        });
        addToast($t('发现新版本: v') + result.latestVersion, 'success');
      } else {
        addToast($t('当前已是最新版本'), 'info');
      }
    },
    onError: (err) => {
      addToast($t('检查更新失败: ') + (err?.message || err), 'error');
    },
  });

  const handleCheckUpdate = () => { checkUpdate(); };

  const handleApplyUpdate = () => {
    applyUpdate(updateInfo).catch((err) => {
      addToast($t('更新失败: ') + err, 'error');
    });
  };

  const [activeTab, setActiveTab] = useState('network');

  // WebDAV state
  const [webdavForm, setWebdavForm] = useState(defaultWebdavForm);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [backupsList, setBackupsList] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'ok' | 'fail'
  const [lastBackup, setLastBackup] = useState(null);

  // Sync provider selection
  const [syncProvider, setSyncProvider] = useState('webdav');

  // Auto sync mode
  const [syncMode, setSyncMode] = useState('webdav');

  // R2 state
  const [r2Form, setR2Form] = useState(defaultR2Form);
  const [r2Configured, setR2Configured] = useState(false);
  const [r2Editing, setR2Editing] = useState(false);
  const [r2Loading, setR2Loading] = useState(false);
  const [r2Testing, setR2Testing] = useState(false);
  const [r2TestResult, setR2TestResult] = useState(null);

  // FTP state
  const [ftpForm, setFtpForm] = useState(defaultFTPForm);
  const [ftpConfigured, setFtpConfigured] = useState(false);
  const [ftpEditing, setFtpEditing] = useState(false);
  const [ftpLoading, setFtpLoading] = useState(false);
  const [ftpTesting, setFtpTesting] = useState(false);
  const [ftpTestResult, setFtpTestResult] = useState(null);

  // SFTP state
  const [sftpForm, setSftpForm] = useState(defaultSFTPForm);
  const [sftpConfigured, setSftpConfigured] = useState(false);
  const [sftpEditing, setSftpEditing] = useState(false);
  const [sftpLoading, setSftpLoading] = useState(false);
  const [sftpTesting, setSftpTesting] = useState(false);
  const [sftpTestResult, setSftpTestResult] = useState(null);

  // Network/Ping state
  const [pingProtocol, setPingProtocol] = useState(localStorage.getItem('pingProtocol') || 'ssh');
  const [probeInterval, setProbeInterval] = useState(parseInt(localStorage.getItem('probeInterval') || '3', 10));
  const [pingInterval, setPingInterval] = useState(parseInt(localStorage.getItem('pingInterval') || '2', 10));

  // Appearance state
  const [themeMode, setThemeMode] = useState(localStorage.getItem('themeMode') || 'dark');
  const [themeAccent, setThemeAccent] = useState(localStorage.getItem('themeAccent') || '#10b981');
  const [useCustomAccent, setUseCustomAccent] = useState(localStorage.getItem('useCustomAccent') === 'true');
  const [language, setLanguage] = useState(localStorage.getItem('appLanguage') || 'zh-CN');
  const [appFont, setAppFont] = useState(localStorage.getItem('appFont') || 'system-ui');
  const [terminalFontSize, setTerminalFontSize] = useState(parseInt(localStorage.getItem('terminalFontSize') || '13', 10));
  const [termBgImage, setTermBgImage] = useState(localStorage.getItem('termBgImage') || '');
  const [termBgOpacity, setTermBgOpacity] = useState(parseFloat(localStorage.getItem('termBgOpacity') || '0.15'));
  const [terminalColorTheme, setTerminalColorTheme] = useState(localStorage.getItem('terminalColorTheme') || 'lumin');
  const [terminalLocalEcho, setTerminalLocalEcho] = useState(localStorage.getItem('terminalLocalEcho') === 'true');

  const t = I18N[language] || I18N['zh-CN'];

  // Shortcuts state
  const defaultShortcuts = {
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    clear: 'Ctrl+L',
    newTab: 'Ctrl+T',
    sigint: 'Ctrl+C',
    eof: 'Ctrl+D',
    suspend: 'Ctrl+Z',
    clearLine: 'Ctrl+U',
  };
  const [shortcuts, setShortcuts] = useState(() => {
    try {
      const saved = localStorage.getItem('appShortcuts');
      return saved ? { ...defaultShortcuts, ...JSON.parse(saved) } : defaultShortcuts;
    } catch {
      return defaultShortcuts;
    }
  });
  const [listeningKey, setListeningKey] = useState(null); // 'copy' | 'paste' | 'clear' | 'newTab' | null

  // 监听并捕捉组合快捷键
  useEffect(() => {
    if (!listeningKey) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setListeningKey(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      
      let keyName = e.key;
      if (keyName === ' ') keyName = 'Space';
      else if (keyName.length === 1) keyName = keyName.toUpperCase();
      
      keys.push(keyName);
      const combined = keys.join('+');

      const updated = { ...shortcuts, [listeningKey]: combined };
      setShortcuts(updated);
      localStorage.setItem('appShortcuts', JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('app-shortcuts-changed', { detail: updated }));

      addToast($t('终端快捷键已修改为') + ` ${combined}`, 'success');
      setListeningKey(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningKey, addToast]);

  const handleThemeChange = (mode) => {
    setThemeMode(mode);
    localStorage.setItem('themeMode', mode);
    if (mode === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
  };

  const handleColorChange = (color) => {
    setThemeAccent(color);
    localStorage.setItem('themeAccent', color);
    if (useCustomAccent) {
      document.documentElement.style.setProperty('--green', color);
    }
  };

  const handleToggleAccent = () => {
    const nextVal = !useCustomAccent;
    setUseCustomAccent(nextVal);
    localStorage.setItem('useCustomAccent', String(nextVal));
    if (nextVal) {
      document.documentElement.style.setProperty('--green', themeAccent);
    } else {
      document.documentElement.style.setProperty('--green', '#10b981');
    }
    addToast(nextVal ? $t('已启用自定义强调色') : $t('已恢复默认强调色'), 'success');
  };

  const handleLanguageChange = (e) => {
    const lang = e.target.value;
    setLanguage(lang);
    setGlobalLanguage(lang);
    addToast($t('语言已切换至 简体中文'), 'success');
  };

  const handleFontChange = (e) => {
    const font = e.target.value;
    setAppFont(font);
    localStorage.setItem('appFont', font);
    
    let fontVal = 'var(--font-ui)';
    if (font === 'Open Sans') fontVal = "'Open Sans', sans-serif";
    else if (font === 'Inter') fontVal = "'Inter', sans-serif";
    else if (font === 'JetBrains Mono') fontVal = "'JetBrains Mono', monospace";
    document.body.style.fontFamily = fontVal;
    
    addToast($t('界面字体已应用'), 'success');
  };

  const handleTerminalFontChange = (e) => {
    const size = parseInt(e.target.value, 10);
    setTerminalFontSize(size);
    localStorage.setItem('terminalFontSize', size);
    window.dispatchEvent(new CustomEvent('terminal-font-size-changed', { detail: size }));
  };

  const handleTerminalLocalEchoChange = (enabled) => {
    setTerminalLocalEcho(enabled);
    localStorage.setItem('terminalLocalEcho', String(enabled));
    window.dispatchEvent(new CustomEvent('terminal-local-echo-changed', { detail: enabled }));
  };

  const handleTermBgUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result;
      try {
        localStorage.setItem('termBgImage', base64);
        setTermBgImage(base64);
        window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
        addToast($t('终端壁纸已更新'), 'success');
      } catch (err) {
        addToast($t('图片过大，无法保存，请使用较小的图片'), 'error');
      }
    };
    reader.onerror = () => {
      addToast($t('读取图片失败'), 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleTermBgReset = () => {
    setTermBgImage('');
    localStorage.removeItem('termBgImage');
    window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
    addToast($t('已恢复默认壁纸'), 'success');
  };

  const handleTermBgOpacityChange = (e) => {
    const val = parseFloat(e.target.value);
    setTermBgOpacity(val);
    localStorage.setItem('termBgOpacity', String(val));
    window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
  };


  useEffect(() => {
    let hasWebdav = false;
    let hasR2 = false;

    Promise.all([
      AppGo.GetWebdavConfig().then((data) => {
        if (data) {
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
        }
      }).catch(() => {}),
      AppGo.GetR2Config().then((data) => {
        if (data) {
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
        }
      }).catch(() => {}),
    ]).then(() => {
      // Auto-select provider: R2 if only R2 configured, else WebDAV
      if (hasR2 && !hasWebdav) {
        setSyncProvider('r2');
      }
    });

    // Load sync mode
    AppGo.GetSyncMode()
      .then((mode) => {
        if (mode) setSyncMode(mode);
      })
      .catch(() => {});

    // Load FTP config
    Promise.all([
      AppGo.GetFTPConfig().then(c => {
        if (c && c.host) {
          setFtpForm(prev => ({ ...prev, host: c.host, port: c.port, username: c.username, password: c.password, remoteDir: c.remoteDir, maxBackups: c.maxBackups || '' }));
          setFtpConfigured(true);
        }
      }).catch(() => {}),
      AppGo.GetSFTPConfig().then(c => {
        if (c && c.host) {
          setSftpForm(prev => ({ ...prev, host: c.host, port: c.port, username: c.username, password: c.password, authMethod: c.authMethod || 'password', privateKey: c.privateKey || '', remoteDir: c.remoteDir, maxBackups: c.maxBackups || '' }));
          setSftpConfigured(true);
        }
      }).catch(() => {}),
    ]);
  }, []);

  const setWebdav = (key) => (e) => setWebdavForm((f) => ({ ...f, [key]: e.target.value }));
  const setR2 = (key) => (e) => setR2Form((f) => ({ ...f, [key]: e.target.value }));
  const setFTP = (field) => (e) => setFtpForm((f) => ({ ...f, [field]: e.target.value }));
  const setSFTP = (field) => (e) => setSftpForm((f) => ({ ...f, [field]: e.target.value }));

  // ────────────────────── Cloud Sync Handlers ──────────────────────
  const providerState = {
    webdav: { form: webdavForm, setForm: setWebdavForm, configured: isConfigured, setConfigured: setIsConfigured, editing: isEditing, setEditing: setIsEditing, loading, setLoading, testing, setTesting, testResult, setTestResult },
    r2: { form: r2Form, setForm: setR2Form, configured: r2Configured, setConfigured: setR2Configured, editing: r2Editing, setEditing: setR2Editing, loading: r2Loading, setLoading: setR2Loading, testing: r2Testing, setTesting: setR2Testing, testResult: r2TestResult, setTestResult: setR2TestResult },
    ftp: { form: ftpForm, setForm: setFtpForm, configured: ftpConfigured, setConfigured: setFtpConfigured, editing: ftpEditing, setEditing: setFtpEditing, loading: ftpLoading, setLoading: setFtpLoading, testing: ftpTesting, setTesting: setFtpTesting, testResult: ftpTestResult, setTestResult: setFtpTestResult },
    sftp: { form: sftpForm, setForm: setSftpForm, configured: sftpConfigured, setConfigured: setSftpConfigured, editing: sftpEditing, setEditing: setSftpEditing, loading: sftpLoading, setLoading: setSftpLoading, testing: sftpTesting, setTesting: setSftpTesting, testResult: sftpTestResult, setTestResult: setSftpTestResult },
  };

  const makeTestHandler = (key) => async () => {
    const p = PROVIDERS[key];
    const s = providerState[key];
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

  const makeSaveHandler = (key) => async () => {
    const p = PROVIDERS[key];
    const s = providerState[key];
    s.setLoading(true);
    try {
      await p.save(s.form);
      if (p.isConfigured(s.form)) {
        s.setConfigured(true);
        s.setEditing(false);
        try {
          const res = await p.sync();
          setLastBackup(res.backup?.time);
          addToast(`${p.name} ${$t('同步成功！本地')} ${res.localCount} ${$t('个 + 云端')} ${res.remoteCount} ${$t('个 =')} ${res.mergedCount} ${$t('个')}`, 'success');
          onRestored?.();
        } catch (_) {
          try {
            const data = await p.backup();
            setLastBackup(data.time);
            addToast(`${p.name} ${$t('配置已保存，已上传')} ${data.count} ${$t('个服务器')}`, 'success');
          } catch (e) {
            addToast(`${p.name} ${$t('配置已保存，但同步失败，可稍后手动上传')}`, 'warning');
          }
        }
      } else {
        addToast(`${p.name} ${$t('配置已保存')}`, 'success');
      }
    } catch (err) {
      addToast(err, 'error');
    } finally {
      s.setLoading(false);
    }
  };

  const handleTest = makeTestHandler('webdav');
  const handleSave = makeSaveHandler('webdav');
  const handleR2Test = makeTestHandler('r2');
  const handleR2Save = makeSaveHandler('r2');
  const handleTestFTP = makeTestHandler('ftp');
  const handleSaveFTP = makeSaveHandler('ftp');
  const handleTestSFTP = makeTestHandler('sftp');
  const handleSaveSFTP = makeSaveHandler('sftp');

  const handleRestore = async () => {
    setLoadingBackups(true);
    try {
      const p = PROVIDERS[syncMode] || PROVIDERS.webdav;
      const list = await p.list();
      if (!list || list.length === 0) {
        addToast($t('云端未找到任何备份文件'), 'error');
        return;
      }
      list.sort((a, b) => new Date(b.time) - new Date(a.time));
      setBackupsList(list);
      setSelectedBackup(list[0].name);
      setConfirmRestore(true);
    } catch (err) {
      addToast($t('获取备份列表失败') + ': ' + err, 'error');
    } finally {
      setLoadingBackups(false);
    }
  };

  const doRestore = async () => {
    if (!selectedBackup) return;
    setRestoring(true);
    try {
      const p = PROVIDERS[syncMode] || PROVIDERS.webdav;
      await p.restore(selectedBackup);
      try { await p.backup(); } catch (_) {}
      addToast($t('恢复成功'), 'success');
      onRestored?.();
    } catch (err) {
      addToast($t('恢复失败') + `: ${err}`, 'error');
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      if (syncMode === 'all') {
        let anyOk = false;
        for (const key of ['webdav', 'r2', 'ftp', 'sftp']) {
          const p = PROVIDERS[key];
          try {
            const res = await p.sync();
            anyOk = true;
            addToast(`${p.name} ${$t('合并同步成功！本地')} ${res.localCount} ${$t('个 + 云端')} ${res.remoteCount} ${$t('个 =')} ${res.mergedCount} ${$t('个')}`, 'success');
          } catch (e) {
            addToast(`${p.name} ${$t('同步失败')}: ${e}`, 'error');
          }
        }
        if (anyOk) onRestored?.();
      } else {
        const p = PROVIDERS[syncMode] || PROVIDERS.webdav;
        const res = await p.sync();
        addToast(`${$t('合并同步成功！本地')} ${res.localCount} ${$t('个 + 云端')} ${res.remoteCount} ${$t('个 =')} ${res.mergedCount} ${$t('个')}`, 'success');
        onRestored?.();
      }
    } catch (err) {
      addToast($t('合并同步失败') + ': ' + err, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-xl" style={{ display: 'flex', flexDirection: 'column', height: '80vh', background: 'var(--bg-1)' }}>
        
        {/* Settings Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>{t.title}</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ color: 'var(--text-3)' }}>✕</button>
        </div>

        {/* Settings Body Layout */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          {/* Settings Sidebar */}
          <div style={{ width: 220, borderRight: '1px solid var(--border)', padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-0)' }}>
            {TABS.map(tab => (
              <div 
                key={tab.id}
                className={`sidebar-menu-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                style={{ 
                  padding: '8px 12px', 
                  borderRadius: 'var(--radius-sm)', 
                  cursor: 'pointer',
                  color: activeTab === tab.id ? 'var(--text-1)' : 'var(--text-3)',
                  background: activeTab === tab.id ? 'var(--bg-2)' : 'transparent',
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                <span>{tab.icon}</span> {t.tabs[tab.id]}
              </div>
            ))}
          </div>

          {/* Settings Content */}
          <div style={{ flex: 1, padding: '32px 48px', overflowY: 'auto', background: 'var(--bg-1)' }}>
            
            {activeTab === 'app' && (
              <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 24px', gap: 32, maxWidth: 640 }}>
                {/* 顶部布局：图标与标题 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <img 
                    src={logoImg} 
                    alt="Lumin" 
                    style={{ 
                      width: 96, 
                      height: 96, 
                      borderRadius: 24, 
                      boxShadow: '0 12px 28px rgba(0, 0, 0, 0.25)',
                      border: '1px solid var(--border-light)'
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ 
                      fontSize: 32, 
                      fontWeight: 800, 
                      color: 'var(--text-1)',
                      letterSpacing: '-0.5px',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8
                    }}>
                      Lumin
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-4)', letterSpacing: '0' }}>by WuMing</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 14, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                        {CURRENT_VERSION}
                      </span>
                      {updateInfo?.hasUpdate && (
                        <span 
                          onClick={handleApplyUpdate}
                          style={{ 
                            background: downloadProgress >= 0 ? '#1e3a8a' : '#065f46', 
                            color: downloadProgress >= 0 ? '#93c5fd' : '#34d399', 
                            borderRadius: 12, 
                            padding: '2px 8px', 
                            fontSize: 12, 
                            fontWeight: 600,
                            cursor: downloadProgress >= 0 ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            boxShadow: downloadProgress >= 0 ? '0 2px 8px rgba(30,58,138,0.3)' : '0 2px 8px rgba(6,95,70,0.3)',
                            position: 'relative',
                            overflow: 'hidden',
                            minWidth: 80,
                            justifyContent: 'center'
                          }}
                        >
                          {downloadProgress >= 0 && (
                            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: 'rgba(59, 130, 246, 0.4)', width: `${downloadProgress}%`, transition: 'width 0.2s ease-out' }}></div>
                          )}
                          <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {downloadProgress >= 0 ? (
                               <>
                                 <svg className="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                                 {downloadProgress}%
                               </>
                            ) : (
                               <>
                                 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                                 {updateInfo.latestVersion} {$t('立即更新')}
                               </>
                            )}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 0 }}>
                  <button 
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    style={{ 
                      background: 'var(--bg-2)', 
                      color: 'var(--text-3)', 
                      border: '1px solid var(--border)', 
                      borderRadius: 8, 
                      padding: '6px 16px', 
                      fontSize: 13, 
                      fontWeight: 500,
                      cursor: checkingUpdate ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.2s',
                      opacity: checkingUpdate ? 0.7 : 1
                    }}
                    onMouseEnter={(e) => { if(!checkingUpdate) { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text-2)'; } }}
                    onMouseLeave={(e) => { if(!checkingUpdate) { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text-3)'; } }}
                  >
                    <svg className={checkingUpdate ? 'spin' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                    {checkingUpdate
                       ? $t('检查中...')
                       : $t('检查更新')}
                  </button>
                </div>

                {/* 列表项 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  <div 
                    onClick={() => window.runtime?.BrowserOpenURL('https://github.com/wmwlwmwl/Lumin-SSH/issues/new')}
                    className="about-list-item"
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s', background: 'var(--bg-2)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 15L15 15"></path><path d="M12 12L12 18"></path></svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{t.about.reportTitle}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{t.about.reportDesc}</span>
                    </div>
                  </div>

                  <div 
                    onClick={() => window.runtime?.BrowserOpenURL('https://github.com/wmwlwmwl/Lumin-SSH/discussions')}
                    className="about-list-item"
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s', background: 'var(--bg-2)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{t.about.communityTitle}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{t.about.communityDesc}</span>
                    </div>
                  </div>

                  <div 
                    onClick={() => window.runtime?.BrowserOpenURL('https://github.com/wmwlwmwl/Lumin-SSH')}
                    className="about-list-item"
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s', background: 'var(--bg-2)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{t.about.githubTitle}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{t.about.githubDesc}</span>
                    </div>
                  </div>

                  <div 
                    onClick={() => window.runtime?.BrowserOpenURL('https://github.com/wmwlwmwl/Lumin-SSH/releases')}
                    className="about-list-item"
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s', background: 'var(--bg-2)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{t.about.changelogTitle}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{t.about.changelogDesc}</span>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {activeTab === 'network' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {/* 延迟检测协议 */}
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>{t.network.pingProtocolTitle}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>{t.network.pingProtocolDesc}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      { id: 'ssh', label: t.network.sshLabel, desc: t.network.sshDesc, tag: t.network.sshTag },
                      { id: 'tcp', label: t.network.tcpLabel, desc: t.network.tcpDesc },
                    ].map(opt => (
                      <div
                        key={opt.id}
                        onClick={() => { setPingProtocol(opt.id); localStorage.setItem('pingProtocol', opt.id); }}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
                          background: pingProtocol === opt.id ? 'rgba(34,197,94,0.06)' : 'var(--bg-2)',
                          border: `1px solid ${pingProtocol === opt.id ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                          borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                          border: `2px solid ${pingProtocol === opt.id ? '#22c55e' : 'var(--border)'}`,
                          background: pingProtocol === opt.id ? '#22c55e' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {pingProtocol === opt.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{opt.label}</span>
                            {opt.tag && <span style={{ fontSize: 10, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{opt.tag}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 3 }}>{opt.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-4)', lineHeight: 1.7, border: '1px solid var(--border-light)' }}>
                    💡 <strong style={{ color: 'var(--text-3)' }}>{$t('提示：')}</strong>{t.network.tip}
                  </div>
                </div>

                {/* 监控刷新频率 */}
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>{t.network.refreshTitle}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>{t.network.refreshDesc}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{t.network.probeRefresh}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {[1, 3, 5, 10, 30].map(s => (
                          <button
                            key={s}
                            onClick={() => { setProbeInterval(s); localStorage.setItem('probeInterval', String(s)); window.dispatchEvent(new Event('probeIntervalChanged')); }}
                            style={{
                              padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                              borderColor: probeInterval === s ? '#22c55e' : 'var(--border)',
                              background: probeInterval === s ? 'rgba(34,197,94,0.1)' : 'var(--bg-3)',
                              color: probeInterval === s ? '#22c55e' : 'var(--text-3)',
                              transition: 'all 0.15s',
                            }}
                          >{s}s</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{t.network.pingRefresh}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {[2, 5, 10, 30].map(s => (
                          <button
                            key={s}
                            onClick={() => {
                              setPingInterval(s);
                              localStorage.setItem('pingInterval', String(s));
                              window.dispatchEvent(new Event('pingIntervalChanged'));
                            }}
                            style={{
                              padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                              borderColor: pingInterval === s ? '#22c55e' : 'var(--border)',
                              background: pingInterval === s ? 'rgba(34,197,94,0.1)' : 'var(--bg-3)',
                              color: pingInterval === s ? '#22c55e' : 'var(--text-3)',
                              transition: 'all 0.15s',
                            }}
                          >{s}s</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                <div>
                  <h3 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 12, fontWeight: 600 }}>{t.appearance.langTitle}</h3>
                  <div className="form-group" style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.langLabel}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.appearance.langDesc}</div>
                      </div>
                      <select className="select" style={{ width: 200 }} value={language} onChange={handleLanguageChange}>
                        <option value="zh-CN">简体中文</option>
                        <option value="en-US">English</option>
                      </select>
                    </div>
                    <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.fontLabel}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.appearance.fontDesc}</div>
                      </div>
                      <select className="select" style={{ width: 200 }} value={appFont} onChange={handleFontChange}>
                        <option value="system-ui">{$t('系统默认')}</option>
                        <option value="Open Sans">Open Sans</option>
                        <option value="Inter">Inter</option>
                        <option value="JetBrains Mono">JetBrains Mono</option>
                      </select>
                    </div>
                    <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.termFontLabel}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.appearance.termFontDesc}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <input
                          type="range"
                          min="10"
                          max="28"
                          step="1"
                          value={terminalFontSize}
                          onChange={handleTerminalFontChange}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 13, width: 32, textAlign: 'right', color: 'var(--text-1)' }}>{terminalFontSize}px</span>
                      </div>
                    </div>
                    <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.termEchoLabel}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.appearance.termEchoDesc}</div>
                      </div>
                      <label className="toggle-switch" style={{ position: 'relative', display: 'inline-block', width: 40, height: 22 }}>
                        <input
                          type="checkbox"
                          checked={terminalLocalEcho}
                          onChange={(e) => handleTerminalLocalEchoChange(e.target.checked)}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                          position: 'absolute',
                          cursor: 'pointer',
                          inset: 0,
                          background: terminalLocalEcho ? 'var(--green)' : 'var(--bg-3)',
                          borderRadius: 22,
                          transition: 'background 0.2s',
                        }}>
                          <span style={{
                            position: 'absolute',
                            height: 18,
                            width: 18,
                            left: terminalLocalEcho ? 20 : 2,
                            bottom: 2,
                            background: 'white',
                            borderRadius: '50%',
                            transition: 'left 0.2s',
                          }} />
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* ── 终端颜色主题 ── */}
                <div>
                  <h3 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 12, fontWeight: 600 }}>{$t('终端颜色主题')}</h3>
                  <div className="form-group" style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-4)', fontSize: 11, marginBottom: 12 }}>{$t('选择终端的配色风格，即时生效')}</div>
                    <div className="theme-palette-grid">
                      {[
                        { key: 'lumin',      name: 'Lumin Default', swatches: ['#22c55e', '#58a6ff', '#bc8cff', '#ff7b72'] },
                        { key: 'tokyo-night', name: 'Tokyo Night',    swatches: ['#7aa2f7', '#bb9af7', '#73daca', '#f7768e'] },
                        { key: 'catppuccin',  name: 'Catppuccin',     swatches: ['#cba6f7', '#89b4fa', '#a6e3a1', '#f38ba8'] },
                        { key: 'dracula',     name: 'Dracula',        swatches: ['#ff79c6', '#bd93f9', '#50fa7b', '#ff5555'] },
                      ].map(({ key, name, swatches }) => (
                        <div
                          key={key}
                          className={`theme-palette-card${terminalColorTheme === key ? ' active' : ''}`}
                          onClick={() => {
                            setTerminalColorTheme(key);
                            localStorage.setItem('terminalColorTheme', key);
                            window.dispatchEvent(new CustomEvent('terminal-theme-changed', { detail: key }));
                          }}
                        >
                          <div className="theme-palette-swatches">
                            {swatches.map((c, i) => (
                              <div key={i} className="theme-palette-swatch" style={{ background: c }} />
                            ))}
                          </div>
                          <div className="theme-palette-name">{name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 12, fontWeight: 600 }}>{t.appearance.themeTitle}</h3>
                  <div className="form-group" style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.themeLabel}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.appearance.themeDesc}</div>
                      </div>
                      <div style={{ display: 'flex', background: 'var(--bg-1)', borderRadius: 'var(--radius-xl)', padding: 4, border: '1px solid var(--border)' }}>
                        <button className={`btn btn-sm ${themeMode === 'light' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => handleThemeChange('light')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'light' ? 'var(--bg-3)' : 'transparent' }}>{t.appearance.themeLight}</button>
                        <button className={`btn btn-sm ${themeMode === 'system' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => handleThemeChange('system')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'system' ? 'var(--bg-3)' : 'transparent' }}>{t.appearance.themeSys}</button>
                        <button className={`btn btn-sm ${themeMode === 'dark' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => handleThemeChange('dark')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'dark' ? 'var(--bg-3)' : 'transparent' }}>{t.appearance.themeDark}</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 12, fontWeight: 600 }}>{t.appearance.accentTitle}</h3>
                  <div className="form-group" style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.accentLabel}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.appearance.accentDesc}</div>
                      </div>
                      <div 
                        onClick={handleToggleAccent}
                        style={{ 
                          width: 40, height: 24, 
                          background: useCustomAccent ? 'var(--green)' : 'var(--bg-4)', 
                          borderRadius: 12, position: 'relative', cursor: 'pointer',
                          transition: 'background 0.2s ease',
                          border: '1px solid var(--border)'
                        }}
                      >
                        <div style={{ 
                          position: 'absolute', 
                          left: useCustomAccent ? 18 : 2, 
                          top: 1, width: 20, height: 20, 
                          background: '#fff', borderRadius: '50%',
                          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                        }}></div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {['#3b82f6','#8b5cf6','#d946ef','#f43f5e','#f97316','#eab308','#84cc16','#10b981','#06b6d4','#64748b'].map((color, i) => (
                        <div key={i} onClick={() => handleColorChange(color)} style={{ 
                          width: 24, height: 24, borderRadius: '50%', background: color, cursor: 'pointer',
                          border: themeAccent === color ? '2px solid #fff' : 'none',
                          boxShadow: themeAccent === color ? `0 0 0 2px ${color}` : 'none'
                        }} />
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 12, fontWeight: 600 }}>{t.appearance.termBgTitle}</h3>
                  <div className="form-group" style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.termBgLabel}</div>
                        <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.appearance.termBgDesc}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {termBgImage && (
                          <button className="btn btn-ghost btn-sm" onClick={handleTermBgReset} style={{ fontSize: 12, color: 'var(--text-3)' }}>
                            {t.appearance.termBgReset}
                          </button>
                        )}
                        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 'var(--radius-sm)' }}>
                          {t.appearance.termBgUpload}
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleTermBgUpload} />
                        </label>
                      </div>
                    </div>
                    <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontSize: 13 }}>{t.appearance.termBgOpacityLabel}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <input 
                          type="range" 
                          min="0.0" 
                          max="1.0" 
                          step="0.05" 
                          value={termBgOpacity} 
                          onChange={handleTermBgOpacityChange} 
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 13, width: 32, textAlign: 'right', color: 'var(--text-1)' }}>{Math.round(termBgOpacity * 100)}%</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <h3 style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 12, fontWeight: 600 }}>{$t('终端快捷键')}</h3>
                  <div className="form-group" style={{ background: 'var(--bg-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    {SHORTCUT_ROWS.map((row, idx) => (
                      <ShortcutRow
                        key={row.key}
                        label={$t(row.labelKey)}
                        keyName={row.key}
                        shortcuts={shortcuts}
                        listeningKey={listeningKey}
                        onSetListening={setListeningKey}
                        withBorder={idx < SHORTCUT_ROWS.length - 1}
                      />
                    ))}
                  </div>
                  <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-4)' }}>{$t('注：部分快捷键行为受终端内的 Shell 设置影响。')}</p>
                </div>
              </div>
            )}

            {activeTab === 'sync' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                
                {/* Provider Selector */}
                <div style={{ display: 'flex', gap: 8, background: 'var(--bg-2)', padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  {PROVIDER_LIST.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSyncProvider(p.id)}
                      style={{
                        flex: 1, padding: '10px 16px', borderRadius: 'var(--radius-sm)',
                        background: syncProvider === p.id ? 'var(--bg-1)' : 'transparent',
                        border: syncProvider === p.id ? '1px solid var(--border)' : '1px solid transparent',
                        color: syncProvider === p.id ? 'var(--text-1)' : 'var(--text-3)',
                        fontWeight: syncProvider === p.id ? 600 : 400,
                        cursor: 'pointer', fontSize: 14, transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}
                    >
                      {p.icon} {p.label}
                    </button>
                  ))}
                </div>

                {/* WebDAV Config */}
                {syncProvider === 'webdav' && (
                  <ProviderCard
                    provider={PROVIDERS.webdav}
                    form={webdavForm}
                    configured={isConfigured}
                    editing={isEditing}
                    onEdit={() => setIsEditing(true)}
                    onCancelEdit={() => setIsEditing(false)}
                    testing={testing}
                    testResult={testResult}
                    onTest={handleTest}
                    loading={loading}
                    onSave={handleSave}
                  >
                    <div className="form-group">
                      <label className="form-label">{$t('端点地址 (URL)')}</label>
                      <input className="input" value={webdavForm.url} onChange={setWebdav('url')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('用户名')}</label>
                      <input className="input" value={webdavForm.username} onChange={setWebdav('username')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('密码 / 授权码')}</label>
                      <input className="input" type="password" value={webdavForm.password} onChange={setWebdav('password')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('远程保存目录')}</label>
                      <input className="input" value={webdavForm.remotePath} onChange={setWebdav('remotePath')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('保留份数 (0=不限)')}</label>
                      <input className="input" type="number" min="0" value={webdavForm.maxBackups} onChange={setWebdav('maxBackups')} placeholder="0" />
                    </div>
                  </ProviderCard>
                )}

                {/* R2 Config */}
                {syncProvider === 'r2' && (
                  <ProviderCard
                    provider={PROVIDERS.r2}
                    form={r2Form}
                    configured={r2Configured}
                    editing={r2Editing}
                    onEdit={() => setR2Editing(true)}
                    onCancelEdit={() => setR2Editing(false)}
                    testing={r2Testing}
                    testResult={r2TestResult}
                    onTest={handleR2Test}
                    loading={r2Loading}
                    onSave={handleR2Save}
                  >
                    <div className="form-group">
                      <label className="form-label">{$t('访问密钥 ID (Access Key ID)')}</label>
                      <input className="input" value={r2Form.accessKeyId} onChange={setR2('accessKeyId')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('秘密访问密钥 (Secret Access Key)')}</label>
                      <input className="input" type="password" value={r2Form.secretAccessKey} onChange={setR2('secretAccessKey')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('存储桶 (Bucket)')}</label>
                      <input className="input" value={r2Form.bucket} onChange={setR2('bucket')} placeholder="your-bucket" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('端点地址 (Endpoint)')}</label>
                      <input className="input" value={r2Form.endpoint} onChange={setR2('endpoint')} placeholder="https://your-account.r2.cloudflarestorage.com" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('区域 (Region)')}</label>
                      <input className="input" value={r2Form.region} onChange={setR2('region')} placeholder="auto" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('前缀 (Prefix)')}</label>
                      <input className="input" value={r2Form.prefix} onChange={setR2('prefix')} placeholder="Lumin/" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('保留份数 (0=不限)')}</label>
                      <input className="input" type="number" min="0" value={r2Form.maxBackups} onChange={setR2('maxBackups')} placeholder="0" />
                    </div>
                  </ProviderCard>
                )}

                {/* FTP Config */}
                {syncProvider === 'ftp' && (
                  <ProviderCard
                    provider={PROVIDERS.ftp}
                    form={ftpForm}
                    configured={ftpConfigured}
                    editing={ftpEditing}
                    onEdit={() => setFtpEditing(true)}
                    onCancelEdit={() => setFtpEditing(false)}
                    testing={ftpTesting}
                    testResult={ftpTestResult}
                    onTest={handleTestFTP}
                    loading={ftpLoading}
                    onSave={handleSaveFTP}
                  >
                    <div className="form-group">
                      <label className="form-label">{$t('主机地址')}</label>
                      <input className="input" value={ftpForm.host} onChange={setFTP('host')} placeholder="ftp.example.com" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('端口')}</label>
                      <input className="input" type="number" value={ftpForm.port} onChange={setFTP('port')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('用户名')}</label>
                      <input className="input" value={ftpForm.username} onChange={setFTP('username')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('密码')}</label>
                      <input className="input" type="password" value={ftpForm.password} onChange={setFTP('password')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('远程保存目录')}</label>
                      <input className="input" value={ftpForm.remoteDir} onChange={setFTP('remoteDir')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('保留份数 (0=不限)')}</label>
                      <input className="input" type="number" min="0" value={ftpForm.maxBackups} onChange={setFTP('maxBackups')} placeholder="0" />
                    </div>
                  </ProviderCard>
                )}

                {/* SFTP Config */}
                {syncProvider === 'sftp' && (
                  <ProviderCard
                    provider={PROVIDERS.sftp}
                    form={sftpForm}
                    configured={sftpConfigured}
                    editing={sftpEditing}
                    onEdit={() => setSftpEditing(true)}
                    onCancelEdit={() => setSftpEditing(false)}
                    testing={sftpTesting}
                    testResult={sftpTestResult}
                    onTest={handleTestSFTP}
                    loading={sftpLoading}
                    onSave={handleSaveSFTP}
                  >
                    <div className="form-group">
                      <label className="form-label">{$t('主机地址')}</label>
                      <input className="input" value={sftpForm.host} onChange={setSFTP('host')} placeholder="sftp.example.com" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('端口')}</label>
                      <input className="input" type="number" value={sftpForm.port} onChange={setSFTP('port')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('用户名')}</label>
                      <input className="input" value={sftpForm.username} onChange={setSFTP('username')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('认证方式')}</label>
                      <select className="input" value={sftpForm.authMethod} onChange={setSFTP('authMethod')}>
                        <option value="password">{$t('密码认证')}</option>
                        <option value="key">{$t('密钥认证')}</option>
                      </select>
                    </div>
                    {sftpForm.authMethod === 'password' ? (
                      <div className="form-group">
                        <label className="form-label">{$t('密码')}</label>
                        <input className="input" type="password" value={sftpForm.password} onChange={setSFTP('password')} />
                      </div>
                    ) : (
                      <>
                        <div className="form-group">
                          <label className="form-label">{$t('私钥内容')}</label>
                          <textarea className="input" style={{ minHeight: 100, fontFamily: 'monospace', fontSize: 12 }} value={sftpForm.privateKey} onChange={setSFTP('privateKey')} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
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
                            {$t('📂 从文件加载私钥')}
                          </button>
                        </div>
                      </>
                    )}
                    <div className="form-group">
                      <label className="form-label">{$t('远程保存目录')}</label>
                      <input className="input" value={sftpForm.remoteDir} onChange={setSFTP('remoteDir')} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{$t('保留份数 (0=不限)')}</label>
                      <input className="input" type="number" min="0" value={sftpForm.maxBackups} onChange={setSFTP('maxBackups')} placeholder="0" />
                    </div>
                  </ProviderCard>
                )}

                {/* 自动同步模式 */}
                <div style={{ background: 'var(--bg-2)', padding: 24, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>{$t('自动同步模式')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20 }}>{$t('选择自动同步使用的云服务，启动时按偏好执行合并同步')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      { id: 'webdav', label: '☁️ WebDAV', desc: $t('仅使用 WebDAV 同步（默认），若未配置则尝试其他') },
                      { id: 'r2', label: '🗄️ R2 (S3)', desc: $t('仅使用 R2 同步，若未配置则尝试其他') },
                      { id: 'ftp', label: '📁 FTP', desc: $t('仅使用 FTP 同步，若未配置则尝试其他') },
                      { id: 'sftp', label: '🔒 SFTP', desc: $t('仅使用 SFTP 同步，若未配置则尝试其他') },
                      { id: 'all', label: $t('🔄 全部同步'), desc: $t('同时同步所有已配置的云服务，按顺序分别合并') },
                    ].map(opt => (
                      <div
                        key={opt.id}
                        onClick={async () => {
                          setSyncMode(opt.id);
                          try { await AppGo.SetSyncMode(opt.id); } catch (_) {}
                        }}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
                          background: syncMode === opt.id ? 'rgba(34,197,94,0.06)' : 'var(--bg-1)',
                          border: `1px solid ${syncMode === opt.id ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                          borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                          border: `2px solid ${syncMode === opt.id ? '#22c55e' : 'var(--border)'}`,
                          background: syncMode === opt.id ? '#22c55e' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {syncMode === opt.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{opt.label}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 3 }}>{opt.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 云端同步 (shared for both providers) */}
                <div style={{ background: 'var(--bg-2)', padding: 24, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>{$t('云端同步')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20 }}>{$t('同步所有配置，全程 AES-256 高强加密')}</div>
                  
                  {(isConfigured || r2Configured || ftpConfigured || sftpConfigured) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, marginBottom: 20, color: 'var(--green)', fontSize: 13 }}>
                      <span>✨</span> <span><strong>{$t('已开启自动云端备份：')}</strong>{$t('当您添加、编辑、删除服务器或修改配置时，后台将静默保存至云端。')}</span>
                    </div>
                  )}

                  {lastBackup && <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>{$t('上次同步')}: {lastBackup}</div>}
                  
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button className="btn btn-secondary" onClick={handleSync} disabled={syncing}>
                      {syncing ? $t('同步中...') : $t('🔀 合并同步')}
                    </button>
                    <button className="btn btn-secondary" onClick={handleRestore} disabled={loadingBackups || restoring}>
                      {loadingBackups ? $t('加载备份列表中...') : $t('🔄 从云端恢复')}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>
      {/* 确认恢复弹窗（含列表选择） */}
      {confirmRestore && (
        <div className="modal-overlay" style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-card" style={{ width: 450, padding: 24, animation: 'scaleIn 0.2s ease-out' }}>
            <div style={{ fontSize: 18, color: 'var(--text-1)', marginBottom: 16, fontWeight: 'bold' }}>{$t('选择要恢复的云端备份')}</div>
            <div style={{ color: 'var(--text-2)', marginBottom: 16, fontSize: 14 }}>
              {$t('此操作将覆盖当前所有的本地服务器配置，且无法撤销。请选择要恢复的备份时间：')}
            </div>
            
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 20, background: 'var(--bg-0)', borderRadius: 'var(--radius-md)', padding: 8 }}>
              {backupsList.map(bk => (
                <div 
                  key={bk.name}
                  onClick={() => setSelectedBackup(bk.name)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: selectedBackup === bk.name ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                    border: `1px solid ${selectedBackup === bk.name ? 'var(--primary)' : 'transparent'}`,
                    marginBottom: 4,
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ color: selectedBackup === bk.name ? 'var(--primary)' : 'var(--text-1)' }}>
                    {bk.time}
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {(bk.size / 1024).toFixed(1)} KB
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" style={{ padding: '0 20px' }} onClick={() => setConfirmRestore(false)}>{$t('取消')}</button>
              <button className="btn" style={{ backgroundColor: 'var(--red)', color: '#fff', border: 'none', padding: '0 20px' }} onClick={doRestore} disabled={!selectedBackup || restoring}>
                {restoring ? $t('恢复中...') : $t('确定恢复')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
