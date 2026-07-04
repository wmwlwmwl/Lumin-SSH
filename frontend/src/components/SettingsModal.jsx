import { useState, useEffect } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { setLanguage as setGlobalLanguage, t as $t } from '../i18n.js';
import { getModKey } from '../utils/platform.js';
import logoImg from '../assets/logo.png';
import { APP_VERSION } from '../config.js';
import { useUpdateChecker } from '../hooks/useUpdateChecker.js';
import { Sun, Monitor, Moon, Keyboard, Cloud, Info, Database, Folder, X, RefreshCw, Globe, Palette, Lock, Bot, SlidersHorizontal } from 'lucide-react';
import { Z } from '../constants/zIndex';
import { WindowSetSize } from '../../wailsjs/runtime/runtime.js';
import { hexToRgb } from '../utils/theme.js';
import AppTab from './settings/AppTab';
import GeneralTab from './settings/GeneralTab';
import NetworkTab from './settings/NetworkTab';
import AppearanceTab from './settings/AppearanceTab';
import AITab from './settings/AITab';
import ShortcutsTab from './settings/ShortcutsTab';
import SyncTab from './settings/SyncTab';

const TAB_ICON = { general: SlidersHorizontal, network: Globe, appearance: Palette, ai: Bot, shortcuts: Keyboard, sync: Cloud, app: Info };

const TAB_LABELS = { general: '通用', network: '网络', appearance: '外观', ai: 'AI 集成', shortcuts: '快捷键', sync: '同步与云', app: '关于' };

const TABS = [
  { id: 'general' },
  { id: 'network' },
  { id: 'appearance' },
  { id: 'ai' },
  { id: 'shortcuts' },
  { id: 'sync' },
  { id: 'app' },
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
    titleKey: 'WebDAV 配置',
    subtitleKey: '配置 WebDAV 端点用于加密同步服务器列表',
    accent: 'var(--success)',
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
    titleKey: 'SFTP (SSH) 配置',
    subtitleKey: '配置 SFTP 服务器用于加密同步服务器列表',
    accent: 'var(--success)',
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
  { id: 'webdav', label: 'WebDAV' },
  { id: 'r2', label: 'R2 (S3)' },
  { id: 'ftp', label: 'FTP' },
  { id: 'sftp', label: 'SFTP' },
];

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

  const [activeTab, setActiveTab] = useState('general');

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
  const [terminalFontSize, setTerminalFontSize] = useState(parseInt(localStorage.getItem('terminalFontSize') || '13', 10));
  const [termBgImage, setTermBgImage] = useState(localStorage.getItem('termBgImage') || '');
  const [termBgOpacity, setTermBgOpacity] = useState(parseFloat(localStorage.getItem('termBgOpacity') || '0.15'));
  const [terminalColorTheme, setTerminalColorTheme] = useState(localStorage.getItem('terminalColorTheme') || 'lumin');
  const [terminalLocalEcho, setTerminalLocalEcho] = useState(localStorage.getItem('terminalLocalEcho') === 'true');
  const [rememberWindowSize, setRememberWindowSize] = useState(localStorage.getItem('rememberWindowSize') !== 'false');
  const [showAIPanel, setShowAIPanel] = useState(localStorage.getItem('showAIPanel') === 'true');
  const [terminalOutputLineLimit, setTerminalOutputLineLimit] = useState(500);
  const [terminalOutputCharacterLimit, setTerminalOutputCharacterLimit] = useState(35000);

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

  // Esc 关闭模态框（仅在未监听快捷键时生效）
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !listeningKey) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [listeningKey, onClose]);

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
      if (getModKey(e)) keys.push('Ctrl');
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
    const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const applyLight = mode === 'light' || (mode === 'system' && isSystemLight);
    if (applyLight) document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    window.dispatchEvent(new CustomEvent('theme-mode-changed'));
  };

  const handleColorChange = (color) => {
    setThemeAccent(color);
    localStorage.setItem('themeAccent', color);
    if (useCustomAccent) {
      document.body.style.setProperty('--accent', color);
      document.body.style.setProperty('--accent-rgb', hexToRgb(color));
    }
  };

  const handleToggleAccent = () => {
    const nextVal = !useCustomAccent;
    setUseCustomAccent(nextVal);
    localStorage.setItem('useCustomAccent', String(nextVal));
    if (nextVal) {
      document.body.style.setProperty('--accent', themeAccent);
      document.body.style.setProperty('--accent-rgb', hexToRgb(themeAccent));
    } else {
      document.body.style.setProperty('--accent', null);
      document.body.style.setProperty('--accent-rgb', null);
    }
    addToast(nextVal ? $t('已启用自定义强调色') : $t('已恢复默认强调色'), 'success');
  };

  const handleLanguageChange = (e) => {
    const lang = e.target.value;
    setLanguage(lang);
    setGlobalLanguage(lang);
    addToast(lang === 'en-US' ? 'Language switched to English' : $t('语言已切换至 简体中文'), 'success');
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

  const handleToggleRememberWindowSize = () => {
    const next = !rememberWindowSize;
    setRememberWindowSize(next);
    localStorage.setItem('rememberWindowSize', String(next));
    if (!next) localStorage.removeItem('windowSize');
  };

  const handleResetWindowSize = () => {
    localStorage.removeItem('windowSize');
    const w = Math.min(1440, Math.floor(screen.width * 0.9));
    const h = Math.min(900, Math.floor(screen.height * 0.9));
    WindowSetSize(w, h);
    addToast($t('窗口大小已恢复默认'), 'success');
  };

  // 操作确认开关
  const [confirmCloseSession, setConfirmCloseSession] = useState(localStorage.getItem('skipCloseSessionConfirm') !== 'true');
  const [confirmCloseAll, setConfirmCloseAll] = useState(localStorage.getItem('skipCloseAllConfirm') !== 'true');
  const [windowCloseAction, setWindowCloseAction] = useState(localStorage.getItem('windowCloseAction') || 'ask');
  const [updateUseProxy, setUpdateUseProxy] = useState(localStorage.getItem('updateUseProxy') === 'true');

  const handleToggleConfirmCloseSession = () => {
    const next = !confirmCloseSession;
    setConfirmCloseSession(next);
    if (next) localStorage.removeItem('skipCloseSessionConfirm');
    else localStorage.setItem('skipCloseSessionConfirm', 'true');
  };
  const handleToggleConfirmCloseAll = () => {
    const next = !confirmCloseAll;
    setConfirmCloseAll(next);
    if (next) localStorage.removeItem('skipCloseAllConfirm');
    else localStorage.setItem('skipCloseAllConfirm', 'true');
  };
  const handleWindowCloseActionChange = (value) => {
    setWindowCloseAction(value);
    if (value === 'ask') localStorage.removeItem('windowCloseAction');
    else localStorage.setItem('windowCloseAction', value);
  };
  const handleToggleUpdateUseProxy = () => {
    const next = !updateUseProxy;
    setUpdateUseProxy(next);
    if (next) localStorage.setItem('updateUseProxy', 'true');
    else localStorage.removeItem('updateUseProxy');
  };

  const handleToggleShowAIPanel = () => {
    const next = !showAIPanel;
    setShowAIPanel(next);
    localStorage.setItem('showAIPanel', String(next));
    window.dispatchEvent(new CustomEvent('ai-panel-visibility-changed', { detail: next }));
  };

  const clampTerminalOutputLineLimit = (value) => Math.max(10, Math.min(5000, value || 0));
  const clampTerminalOutputCharacterLimit = (value) => Math.max(1000, Math.min(500000, value || 0));

  const saveMCPOutputCompressionSettings = async (lineLimit, characterLimit) => {
    const nextLineLimit = clampTerminalOutputLineLimit(lineLimit);
    const nextCharacterLimit = clampTerminalOutputCharacterLimit(characterLimit);
    setTerminalOutputLineLimit(nextLineLimit);
    setTerminalOutputCharacterLimit(nextCharacterLimit);
    await AppGo.SaveMCPOutputCompressionSettings(nextLineLimit, nextCharacterLimit);
  };

  const handleTerminalOutputLineLimitChange = (e) => {
    const value = parseInt(e.target.value, 10) || 0;
    saveMCPOutputCompressionSettings(value, terminalOutputCharacterLimit).catch(() => {});
  };

  const handleTerminalOutputCharacterLimitChange = (e) => {
    const value = parseInt(e.target.value, 10) || 0;
    saveMCPOutputCompressionSettings(terminalOutputLineLimit, value).catch(() => {});
  };

  
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

    // Load sync mode
    AppGo.GetSyncMode()
      .then((mode) => {
        if (!cancelled && mode) setSyncMode(mode);
      })
      .catch(() => {});

    // Load FTP config
    Promise.all([
      AppGo.GetFTPConfig().then(c => {
        if (cancelled || !c || !c.host) return;
        setFtpForm(prev => ({ ...prev, host: c.host, port: c.port, username: c.username, password: c.password, remoteDir: c.remoteDir, maxBackups: c.maxBackups || '' }));
        setFtpConfigured(true);
      }).catch(() => {}),
      AppGo.GetSFTPConfig().then(c => {
        if (cancelled || !c || !c.host) return;
        setSftpForm(prev => ({ ...prev, host: c.host, port: c.port, username: c.username, password: c.password, authMethod: c.authMethod || 'password', privateKey: c.privateKey || '', remoteDir: c.remoteDir, maxBackups: c.maxBackups || '' }));
        setSftpConfigured(true);
      }).catch(() => {}),
      AppGo.GetMCPOutputCompressionSettings().then(c => {
        if (cancelled || !c) return;
        setTerminalOutputLineLimit(clampTerminalOutputLineLimit(c.terminalOutputLineLimit || 0));
        setTerminalOutputCharacterLimit(clampTerminalOutputCharacterLimit(c.terminalOutputCharacterLimit || 0));
      }).catch(() => {}),
    ]);

    return () => { cancelled = true; };
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

  // ── Tab prop wrappers ──
  const handlePingProtocolChange = (id) => { setPingProtocol(id); localStorage.setItem('pingProtocol', id); };
  const handleProbeIntervalChange = (s) => { setProbeInterval(s); localStorage.setItem('probeInterval', String(s)); window.dispatchEvent(new Event('probeIntervalChanged')); };
  const handlePingIntervalChange = (s) => { setPingInterval(s); localStorage.setItem('pingInterval', String(s)); window.dispatchEvent(new Event('pingIntervalChanged')); };
  const handleTerminalColorThemeChange = (key) => { setTerminalColorTheme(key); localStorage.setItem('terminalColorTheme', key); window.dispatchEvent(new CustomEvent('terminal-theme-changed', { detail: key })); };
  const handleSyncModeChange = async (mode) => { setSyncMode(mode); try { await AppGo.SetSyncMode(mode); } catch (_) {} };

  const isAnyConfigured = isConfigured || r2Configured || ftpConfigured || sftpConfigured;

  return (
    <div className="modal-overlay">
      <div className="modal modal-xl" style={{ display: 'flex', flexDirection: 'column', height: '80vh', background: 'var(--surface-raised)' }}>
        
        {/* Settings Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{$t('设置')}</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ color: 'var(--text-secondary)' }}><X size={16} /></button>
        </div>

        {/* Settings Body Layout */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          {/* Settings Sidebar */}
          <div style={{ width: 220, borderRight: '1px solid var(--border)', padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface-base)' }}>
            {TABS.map(tab => (
              <div 
                key={tab.id}
                className={`sidebar-menu-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                style={{ 
                  padding: '8px 12px', 
                  borderRadius: 'var(--radius-sm)', 
                  cursor: 'pointer',
                  color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: activeTab === tab.id ? 'var(--surface-overlay)' : 'transparent',
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>{(() => { const IC = TAB_ICON[tab.id]; return IC ? <IC size={16} /> : null; })()}</span> {$t(TAB_LABELS[tab.id])}
              </div>
            ))}
          </div>

          {/* Settings Content */}
          <div style={{ flex: 1, padding: '32px 48px', overflowY: 'auto', background: 'var(--surface-raised)' }}>
            
            {activeTab === 'app' && (
              <AppTab
                CURRENT_VERSION={CURRENT_VERSION}
                updateInfo={updateInfo}
                checkingUpdate={checkingUpdate}
                downloadProgress={downloadProgress}
                onCheckUpdate={handleCheckUpdate}
                onApplyUpdate={handleApplyUpdate}
              />
            )}

            {activeTab === 'general' && (
              <GeneralTab
                language={language}
                onLanguageChange={handleLanguageChange}
                confirmCloseSession={confirmCloseSession}
                onToggleConfirmCloseSession={handleToggleConfirmCloseSession}
                confirmCloseAll={confirmCloseAll}
                onToggleConfirmCloseAll={handleToggleConfirmCloseAll}
                windowCloseAction={windowCloseAction}
                onWindowCloseActionChange={handleWindowCloseActionChange}
                updateUseProxy={updateUseProxy}
                onToggleUpdateUseProxy={handleToggleUpdateUseProxy}
              />
            )}

            {activeTab === 'network' && (
              <NetworkTab
                pingProtocol={pingProtocol}
                onPingProtocolChange={(id) => { setPingProtocol(id); localStorage.setItem('pingProtocol', id); }}
                probeInterval={probeInterval}
                onProbeIntervalChange={(s) => { setProbeInterval(s); localStorage.setItem('probeInterval', String(s)); window.dispatchEvent(new Event('probeIntervalChanged')); }}
                pingInterval={pingInterval}
                onPingIntervalChange={(s) => { setPingInterval(s); localStorage.setItem('pingInterval', String(s)); window.dispatchEvent(new Event('pingIntervalChanged')); }}
              />
            )}
            {activeTab === 'appearance' && (
              <AppearanceTab
                terminalFontSize={terminalFontSize}
                onTerminalFontSizeChange={handleTerminalFontChange}
                terminalLocalEcho={terminalLocalEcho}
                onTerminalLocalEchoChange={handleTerminalLocalEchoChange}
                terminalColorTheme={terminalColorTheme}
                onTerminalColorThemeChange={(key) => { setTerminalColorTheme(key); localStorage.setItem('terminalColorTheme', key); window.dispatchEvent(new CustomEvent('terminal-theme-changed', { detail: key })); }}
                themeMode={themeMode}
                onThemeChange={handleThemeChange}
                themeAccent={themeAccent}
                onColorChange={handleColorChange}
                useCustomAccent={useCustomAccent}
                onToggleAccent={handleToggleAccent}
                termBgImage={termBgImage}
                onTermBgUpload={handleTermBgUpload}
                onTermBgReset={handleTermBgReset}
                termBgOpacity={termBgOpacity}
                onTermBgOpacityChange={handleTermBgOpacityChange}
                rememberWindowSize={rememberWindowSize}
                onToggleRememberWindowSize={handleToggleRememberWindowSize}
                onResetWindowSize={handleResetWindowSize}
              />
            )}

            {activeTab === 'ai' && (
              <AITab
                showAIPanel={showAIPanel}
                onToggleShowAIPanel={handleToggleShowAIPanel}
                terminalOutputLineLimit={terminalOutputLineLimit}
                onTerminalOutputLineLimitChange={handleTerminalOutputLineLimitChange}
                terminalOutputCharacterLimit={terminalOutputCharacterLimit}
                onTerminalOutputCharacterLimitChange={handleTerminalOutputCharacterLimitChange}
              />
            )}

            {activeTab === 'shortcuts' && (
              <ShortcutsTab shortcuts={shortcuts} listeningKey={listeningKey} onSetListeningKey={setListeningKey} />
            )}

            {activeTab === 'sync' && (
              <SyncTab
                syncProvider={syncProvider}
                onSyncProviderChange={setSyncProvider}
                syncMode={syncMode}
                onSyncModeChange={async (id) => { setSyncMode(id); try { await AppGo.SetSyncMode(id); } catch (_) {} }}
                providers={PROVIDERS}
                providerList={PROVIDER_LIST}
                webdavForm={webdavForm}
                setWebdavField={setWebdav}
                webdavConfigured={isConfigured}
                webdavEditing={isEditing}
                setWebdavEditing={setIsEditing}
                webdavLoading={loading}
                webdavTesting={testing}
                webdavTestResult={testResult}
                onWebdavTest={handleTest}
                onWebdavSave={handleSave}
                r2Form={r2Form}
                setR2Field={setR2}
                r2Configured={r2Configured}
                r2Editing={r2Editing}
                setR2Editing={setR2Editing}
                r2Loading={r2Loading}
                r2Testing={r2Testing}
                r2TestResult={r2TestResult}
                onR2Test={handleR2Test}
                onR2Save={handleR2Save}
                ftpForm={ftpForm}
                setFTPField={setFTP}
                ftpConfigured={ftpConfigured}
                ftpEditing={ftpEditing}
                setFtpEditing={setFtpEditing}
                ftpLoading={ftpLoading}
                ftpTesting={ftpTesting}
                ftpTestResult={ftpTestResult}
                onTestFTP={handleTestFTP}
                onSaveFTP={handleSaveFTP}
                sftpForm={sftpForm}
                setSFTPField={setSFTP}
                sftpConfigured={sftpConfigured}
                sftpEditing={sftpEditing}
                setSftpEditing={setSftpEditing}
                sftpLoading={sftpLoading}
                sftpTesting={sftpTesting}
                sftpTestResult={sftpTestResult}
                onTestSFTP={handleTestSFTP}
                onSaveSFTP={handleSaveSFTP}
                setSftpForm={setSftpForm}
                lastBackup={lastBackup}
                syncing={syncing}
                onSync={handleSync}
                loadingBackups={loadingBackups}
                restoring={restoring}
                onRestore={handleRestore}
                isAnyConfigured={isConfigured || r2Configured || ftpConfigured || sftpConfigured}
                addToast={addToast}
              />
            )}


          </div>
        </div>

      </div>
      {/* 确认恢复弹窗（含列表选择） */}
      {confirmRestore && (
        <div className="modal-overlay" style={{ zIndex: Z.MODAL, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-card" style={{ width: 450, padding: 24, animation: 'scaleIn 0.2s ease-out' }}>
            <div style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 16, fontWeight: 'bold' }}>{$t('选择要恢复的云端备份')}</div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
              {$t('此操作将覆盖当前所有的本地服务器配置，且无法撤销。请选择要恢复的备份时间：')}
            </div>
            
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 20, background: 'var(--surface-base)', borderRadius: 'var(--radius-md)', padding: 8 }}>
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
                  <div style={{ color: selectedBackup === bk.name ? 'var(--primary)' : 'var(--text-primary)' }}>
                    {bk.time}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {(bk.size / 1024).toFixed(1)} KB
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" style={{ padding: '0 20px' }} onClick={() => setConfirmRestore(false)}>{$t('取消')}</button>
              <button className="btn" style={{ backgroundColor: 'var(--danger)', color: '#fff', border: 'none', padding: '0 20px' }} onClick={doRestore} disabled={!selectedBackup || restoring}>
                {restoring ? $t('恢复中...') : $t('确定恢复')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
