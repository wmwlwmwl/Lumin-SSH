import { useState, useEffect } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { getAvailableLanguages, setLanguage as setGlobalLanguage, t as $t } from '../i18n.js';
import { getModKey } from '../utils/platform.js';
import logoImg from '../assets/logo.png';
import { APP_BUILD_TIME, APP_VERSION } from '../config.js';
import { useUpdateChecker } from '../hooks/useUpdateChecker.js';
import { Sun, Monitor, Moon, Keyboard, Cloud, Info, Database, Folder, X, RefreshCw, Globe, Palette, Lock, SlidersHorizontal } from 'lucide-react';
import { Z } from '../constants/zIndex';
import { WindowSetSize, WindowUnmaximise } from '../../wailsjs/runtime/runtime.js';
import { hexToRgb } from '../utils/theme.js';
import AppTab from './settings/AppTab';
import GeneralTab from './settings/GeneralTab';
import NetworkTab from './settings/NetworkTab';
import AppearanceTab from './settings/AppearanceTab';
import FileManagerTab from './settings/FileManagerTab';
import ShortcutsTab from './settings/ShortcutsTab';
import SyncTab from './settings/SyncTab';

const TAB_ICON = { general: SlidersHorizontal, network: Globe, fileManager: Folder, appearance: Palette, shortcuts: Keyboard, sync: Cloud, app: Info };

const TAB_LABELS = { general: '通用', network: '网络', fileManager: '文件管理器', appearance: '外观', shortcuts: '快捷键', sync: '同步与云', app: '关于' };

const TABS = [
  { id: 'general' },
  { id: 'network' },
  { id: 'fileManager' },
  { id: 'appearance' },
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

const DEFAULT_FILE_MANAGER_DOWNLOAD_DIR = '${APP_DIR}\\download';
const AVAILABLE_LANGUAGES = getAvailableLanguages();

function resolveFileManagerDownloadDirPreview(template, programDirectory) {
  const baseDir = String(programDirectory || '').trim();
  const rawTemplate = String(template || '').trim() || DEFAULT_FILE_MANAGER_DOWNLOAD_DIR;
  const separator = baseDir.includes('\\') ? '\\' : '/';
  const replaced = rawTemplate
    .replaceAll('${APP_DIR}', baseDir)
    .replaceAll('%APP_DIR%', baseDir)
    .replace(/[\\/]+/g, separator);
  if (!replaced) {
    return '';
  }
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(replaced) || !baseDir) {
    return replaced;
  }
  return `${baseDir}${baseDir.endsWith('\\') || baseDir.endsWith('/') ? '' : separator}${replaced}`;
}

export default function SettingsModal({
  onClose,
  addToast,
  onRestored,
  probePanelPosition,
  onProbePanelPositionChange,
}) {
  const CURRENT_VERSION = APP_VERSION;
  const CURRENT_BUILD_TIME = APP_BUILD_TIME;
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
  const [confirmRestoreProvider, setConfirmRestoreProvider] = useState(false);
  const [backupsList, setBackupsList] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [restoreProvider, setRestoreProvider] = useState(null);
  const [failedRestoreProviders, setFailedRestoreProviders] = useState([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'ok' | 'fail'
  const [lastBackup, setLastBackup] = useState(null);

  // Sync provider selection
  const [syncProvider, setSyncProvider] = useState('webdav');

  // Auto sync mode
  const [syncMode, setSyncMode] = useState('webdav');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

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
  const [pingEnabled, setPingEnabled] = useState(localStorage.getItem('pingEnabled') !== 'false');
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
  const [applyBgGlobally, setApplyBgGlobally] = useState(localStorage.getItem('applyBgGlobally') === 'true');
  const [terminalColorTheme, setTerminalColorTheme] = useState(localStorage.getItem('terminalColorTheme') || 'lumin');
  const [terminalLocalEcho, setTerminalLocalEcho] = useState(localStorage.getItem('terminalLocalEcho') === 'true');
  const [terminalTimestamps, setTerminalTimestamps] = useState(localStorage.getItem('terminalTimestamps') === 'true');
  const [rememberWindowSize, setRememberWindowSize] = useState(localStorage.getItem('rememberWindowSize') !== 'false');
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

  const handleLanguageChange = async (e) => {
    const lang = e.target.value;
    setLanguage(lang);
    await setGlobalLanguage(lang);
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

  const handleTerminalTimestampsChange = (enabled) => {
    setTerminalTimestamps(enabled);
    localStorage.setItem('terminalTimestamps', String(enabled));
    window.dispatchEvent(new CustomEvent('terminal-timestamps-changed', { detail: enabled }));
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

  const handleToggleApplyBgGlobally = () => {
    const nextVal = !applyBgGlobally;
    setApplyBgGlobally(nextVal);
    localStorage.setItem('applyBgGlobally', String(nextVal));
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
    WindowUnmaximise();
    const w = Math.min(1440, Math.floor(screen.width * 0.9));
    const h = Math.min(900, Math.floor(screen.height * 0.9));
    WindowSetSize(w, h);
    addToast($t('窗口大小已恢复默认'), 'success');
  };

  // 操作确认开关
  const [confirmCloseSession, setConfirmCloseSession] = useState(localStorage.getItem('skipCloseSessionConfirm') !== 'true');
  const [confirmCloseAll, setConfirmCloseAll] = useState(localStorage.getItem('skipCloseAllConfirm') !== 'true');
  const [confirmFileDelete, setConfirmFileDelete] = useState(localStorage.getItem('skipFileDeleteConfirm') !== 'true');
  const [windowCloseAction, setWindowCloseAction] = useState(localStorage.getItem('windowCloseAction') || 'ask');
  const [updateUseProxy, setUpdateUseProxy] = useState(localStorage.getItem('updateUseProxy') === 'true');
  const [rememberWorkspace, setRememberWorkspace] = useState(false);
  const [supportsWebviewGpuDisable, setSupportsWebviewGpuDisable] = useState(false);
  const [webviewGpuDisabled, setWebviewGpuDisabled] = useState(false);
  const [programDirectory, setProgramDirectory] = useState('');
  const [fileManagerFollowTerminalCwd, setFileManagerFollowTerminalCwd] = useState(localStorage.getItem('fileManagerFollowTerminalCwd') !== 'false');
  const [fileManagerCompressedTransfer, setFileManagerCompressedTransfer] = useState(localStorage.getItem('fileManagerCompressedTransfer') !== 'false');
  const [fileManagerAskDownloadEveryTime, setFileManagerAskDownloadEveryTime] = useState(localStorage.getItem('fileManagerAskDownloadEveryTime') === 'true');
  const [fileManagerDownloadConflictStrategy, setFileManagerDownloadConflictStrategy] = useState(localStorage.getItem('fileManagerDownloadConflictStrategy') || 'auto_rename');
  const [fileManagerDownloadConflictDiffBySize, setFileManagerDownloadConflictDiffBySize] = useState(localStorage.getItem('fileManagerDownloadConflictDiffBySize') !== 'false');
  const [fileManagerDownloadConflictDiffByMtime, setFileManagerDownloadConflictDiffByMtime] = useState(localStorage.getItem('fileManagerDownloadConflictDiffByMtime') !== 'false');
  const [fileManagerDownloadRenameSuffixMode, setFileManagerDownloadRenameSuffixMode] = useState(localStorage.getItem('fileManagerDownloadRenameSuffixMode') || 'sequence');
  const [fileManagerDownloadDefaultDir, setFileManagerDownloadDefaultDir] = useState(localStorage.getItem('fileManagerDownloadDefaultDir') || DEFAULT_FILE_MANAGER_DOWNLOAD_DIR);
  const [fileManagerUploadChunkSizeKiB, setFileManagerUploadChunkSizeKiB] = useState(localStorage.getItem('fileManagerUploadChunkSizeKiB') || '256');
  const [fileManagerUploadMaxFiles, setFileManagerUploadMaxFiles] = useState(localStorage.getItem('fileManagerUploadMaxFiles') || '6');
  const [fileManagerUploadMaxChunksPerFile, setFileManagerUploadMaxChunksPerFile] = useState(localStorage.getItem('fileManagerUploadMaxChunksPerFile') || '8');
  const [fileManagerUploadGlobalInflightLimit, setFileManagerUploadGlobalInflightLimit] = useState(localStorage.getItem('fileManagerUploadGlobalInflightLimit') || '24');

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
  const handleToggleConfirmFileDelete = () => {
    const next = !confirmFileDelete;
    setConfirmFileDelete(next);
    if (next) localStorage.removeItem('skipFileDeleteConfirm');
    else localStorage.setItem('skipFileDeleteConfirm', 'true');
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
  const handleToggleRememberWorkspace = async () => {
    const next = !rememberWorkspace;
    setRememberWorkspace(next);
    try {
      await window?.go?.main?.App?.SetRememberWorkspace?.(next);
      window.dispatchEvent(new CustomEvent('workspace-remember-changed', { detail: next }));
    } catch (err) {
      setRememberWorkspace(!next);
      addToast($t('记忆工作区设置保存失败') + `: ${err}`, 'error');
    }
  };
  const handleToggleWebviewGpuDisabled = async () => {
    const next = !webviewGpuDisabled;
    setWebviewGpuDisabled(next);
    try {
      await window?.go?.main?.App?.SetWebviewGpuDisabled?.(next);
      addToast($t('设置已保存，重启后生效'), 'success');
    } catch (err) {
      setWebviewGpuDisabled(!next);
      addToast($t('硬件加速设置保存失败') + `: ${err}`, 'error');
    }
  };
  const handleToggleFileManagerFollowTerminalCwd = () => {
    const next = !fileManagerFollowTerminalCwd;
    setFileManagerFollowTerminalCwd(next);
    if (next) localStorage.removeItem('fileManagerFollowTerminalCwd');
    else localStorage.setItem('fileManagerFollowTerminalCwd', 'false');
    window.dispatchEvent(new CustomEvent('file-manager-follow-terminal-cwd-changed', { detail: next }));
  };
  const handleToggleFileManagerCompressedTransfer = () => {
    const next = !fileManagerCompressedTransfer;
    setFileManagerCompressedTransfer(next);
    if (next) localStorage.removeItem('fileManagerCompressedTransfer');
    else localStorage.setItem('fileManagerCompressedTransfer', 'false');
  };
  const handleToggleFileManagerAskDownloadEveryTime = () => {
    const next = !fileManagerAskDownloadEveryTime;
    setFileManagerAskDownloadEveryTime(next);
    if (next) localStorage.setItem('fileManagerAskDownloadEveryTime', 'true');
    else localStorage.removeItem('fileManagerAskDownloadEveryTime');
  };
  const handleFileManagerDownloadConflictStrategyChange = (value) => {
    setFileManagerDownloadConflictStrategy(value);
    localStorage.setItem('fileManagerDownloadConflictStrategy', value);
  };
  const handleToggleFileManagerDownloadConflictDiffBySize = () => {
    const next = !fileManagerDownloadConflictDiffBySize;
    if (!next && !fileManagerDownloadConflictDiffByMtime) return;
    setFileManagerDownloadConflictDiffBySize(next);
    if (next) localStorage.removeItem('fileManagerDownloadConflictDiffBySize');
    else localStorage.setItem('fileManagerDownloadConflictDiffBySize', 'false');
  };
  const handleToggleFileManagerDownloadConflictDiffByMtime = () => {
    const next = !fileManagerDownloadConflictDiffByMtime;
    if (!next && !fileManagerDownloadConflictDiffBySize) return;
    setFileManagerDownloadConflictDiffByMtime(next);
    if (next) localStorage.removeItem('fileManagerDownloadConflictDiffByMtime');
    else localStorage.setItem('fileManagerDownloadConflictDiffByMtime', 'false');
  };
  const handleFileManagerDownloadRenameSuffixModeChange = (value) => {
    setFileManagerDownloadRenameSuffixMode(value);
    localStorage.setItem('fileManagerDownloadRenameSuffixMode', value);
  };
  const handleFileManagerUploadSettingChange = (key, setter) => (e) => {
    const next = e.target.value;
    setter(next);
    if (next === '') localStorage.removeItem(key);
    else localStorage.setItem(key, next);
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
    Promise.resolve(window?.go?.main?.App?.GetAutoSyncEnabled?.())
      .then((enabled) => {
        if (!cancelled && typeof enabled === 'boolean') setAutoSyncEnabled(enabled);
      })
      .catch(() => {});

    Promise.resolve(window?.go?.main?.App?.GetProgramDirectory?.())
      .then((dir) => {
        if (!cancelled && dir) setProgramDirectory(dir);
      })
      .catch(() => {});

    Promise.resolve(window?.go?.main?.App?.GetRememberWorkspace?.())
      .then((enabled) => {
        if (!cancelled && typeof enabled === 'boolean') setRememberWorkspace(enabled);
      })
      .catch(() => {});

    Promise.resolve(window?.go?.main?.App?.SupportsWebviewGpuDisable?.())
      .then((supported) => {
        if (cancelled || supported !== true) return;
        setSupportsWebviewGpuDisable(true);
        Promise.resolve(window?.go?.main?.App?.GetWebviewGpuDisabled?.())
          .then((enabled) => {
            if (!cancelled && typeof enabled === 'boolean') setWebviewGpuDisabled(enabled);
          })
          .catch(() => {});
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
  const configuredProviderIds = () => PROVIDER_LIST.map(p => p.id).filter(id => providerState[id]?.configured);

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

  const loadRestoreBackups = async (providerId) => {
    setLoadingBackups(true);
    try {
      const p = PROVIDERS[providerId];
      const list = await p.list();
      if (!list || list.length === 0) {
        setFailedRestoreProviders(prev => [...new Set([...prev, providerId])]);
        addToast($t('云端未找到任何备份文件') + '，' + $t('请重新选择'), 'error');
        if (syncMode === 'all') setConfirmRestoreProvider(true);
        return;
      }
      list.sort((a, b) => new Date(b.time) - new Date(a.time));
      setRestoreProvider(providerId);
      setBackupsList(list);
      setSelectedBackup(list[0].name);
      setConfirmRestoreProvider(false);
      setConfirmRestore(true);
    } catch (err) {
      setFailedRestoreProviders(prev => [...new Set([...prev, providerId])]);
      addToast($t('获取备份列表失败') + ': ' + err + '，' + $t('请重新选择'), 'error');
      if (syncMode === 'all') setConfirmRestoreProvider(true);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleRestore = async () => {
    setFailedRestoreProviders([]);
    if (syncMode === 'all') {
      const availableProviders = configuredProviderIds();
      if (availableProviders.length === 1) {
        await loadRestoreBackups(availableProviders[0]);
      } else {
        setConfirmRestoreProvider(true);
      }
    } else {
      await loadRestoreBackups(syncMode);
    }
  };

  const doRestore = async () => {
    if (!selectedBackup || !restoreProvider) return;
    setRestoring(true);
    try {
      const p = PROVIDERS[restoreProvider];
      await p.restore(selectedBackup);
      if (syncMode === 'all') {
        await AppGo.SyncAllProviders();
      } else {
        await p.sync();
      }
      addToast($t('恢复成功'), 'success');
      onRestored?.();
      setConfirmRestore(false);
    } catch (err) {
      setFailedRestoreProviders(prev => [...new Set([...prev, restoreProvider])]);
      addToast($t('恢复失败') + `: ${err}，` + $t('请重新选择'), 'error');
      setConfirmRestore(false);
      if (syncMode === 'all') setConfirmRestoreProvider(true);
    } finally {
      setRestoring(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      if (syncMode === 'all') {
        const res = await AppGo.SyncAllProviders();
        addToast(`${$t('合并同步成功！本地')} ${res.localCount} ${$t('个 + 云端')} ${res.remoteCount} ${$t('个 =')} ${res.mergedCount} ${$t('个')}`, 'success');
        onRestored?.();
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
  const handleTogglePingEnabled = () => {
    const next = !pingEnabled;
    setPingEnabled(next);
    localStorage.setItem('pingEnabled', String(next));
    window.dispatchEvent(new Event('pingEnabledChanged'));
  };
  const handleProbeIntervalChange = (s) => { setProbeInterval(s); localStorage.setItem('probeInterval', String(s)); window.dispatchEvent(new Event('probeIntervalChanged')); };
  const handlePingIntervalChange = (s) => { setPingInterval(s); localStorage.setItem('pingInterval', String(s)); window.dispatchEvent(new Event('pingIntervalChanged')); };
  const handleTerminalColorThemeChange = (key) => { setTerminalColorTheme(key); localStorage.setItem('terminalColorTheme', key); window.dispatchEvent(new CustomEvent('terminal-theme-changed', { detail: key })); };
  const handleSyncModeChange = async (mode) => { setSyncMode(mode); try { await AppGo.SetSyncMode(mode); } catch (_) {} };
  const handleAutoSyncEnabledChange = async (enabled) => { setAutoSyncEnabled(enabled); try { await AppGo.SetAutoSyncEnabled(enabled); } catch (_) {} };

  const isAnyConfigured = isConfigured || r2Configured || ftpConfigured || sftpConfigured;

  return (
    <div className="modal-overlay" style={{ zIndex: Z.MODAL }}>
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
                BUILD_TIME={CURRENT_BUILD_TIME}
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
                availableLanguages={AVAILABLE_LANGUAGES}
                confirmCloseSession={confirmCloseSession}
                onToggleConfirmCloseSession={handleToggleConfirmCloseSession}
                confirmCloseAll={confirmCloseAll}
                onToggleConfirmCloseAll={handleToggleConfirmCloseAll}
                confirmFileDelete={confirmFileDelete}
                onToggleConfirmFileDelete={handleToggleConfirmFileDelete}
                windowCloseAction={windowCloseAction}
                onWindowCloseActionChange={handleWindowCloseActionChange}
                updateUseProxy={updateUseProxy}
                onToggleUpdateUseProxy={handleToggleUpdateUseProxy}
                rememberWorkspace={rememberWorkspace}
                onToggleRememberWorkspace={handleToggleRememberWorkspace}
                supportsWebviewGpuDisable={supportsWebviewGpuDisable}
                webviewGpuDisabled={webviewGpuDisabled}
                onToggleWebviewGpuDisabled={handleToggleWebviewGpuDisabled}
              />
            )}

            {activeTab === 'network' && (
              <NetworkTab
                pingEnabled={pingEnabled}
                onTogglePingEnabled={handleTogglePingEnabled}
                probeInterval={probeInterval}
                onProbeIntervalChange={handleProbeIntervalChange}
                pingInterval={pingInterval}
                onPingIntervalChange={handlePingIntervalChange}
              />
            )}

            {activeTab === 'fileManager' && (
              <FileManagerTab
                fileManagerFollowTerminalCwd={fileManagerFollowTerminalCwd}
                onToggleFileManagerFollowTerminalCwd={handleToggleFileManagerFollowTerminalCwd}
                fileManagerCompressedTransfer={fileManagerCompressedTransfer}
                onToggleFileManagerCompressedTransfer={handleToggleFileManagerCompressedTransfer}
                fileManagerAskDownloadEveryTime={fileManagerAskDownloadEveryTime}
                onToggleFileManagerAskDownloadEveryTime={handleToggleFileManagerAskDownloadEveryTime}
                fileManagerDownloadConflictStrategy={fileManagerDownloadConflictStrategy}
                onFileManagerDownloadConflictStrategyChange={handleFileManagerDownloadConflictStrategyChange}
                fileManagerDownloadConflictDiffBySize={fileManagerDownloadConflictDiffBySize}
                onToggleFileManagerDownloadConflictDiffBySize={handleToggleFileManagerDownloadConflictDiffBySize}
                fileManagerDownloadConflictDiffByMtime={fileManagerDownloadConflictDiffByMtime}
                onToggleFileManagerDownloadConflictDiffByMtime={handleToggleFileManagerDownloadConflictDiffByMtime}
                fileManagerDownloadRenameSuffixMode={fileManagerDownloadRenameSuffixMode}
                onFileManagerDownloadRenameSuffixModeChange={handleFileManagerDownloadRenameSuffixModeChange}
                fileManagerDownloadDefaultDir={fileManagerDownloadDefaultDir}
                onFileManagerDownloadDefaultDirChange={handleFileManagerUploadSettingChange('fileManagerDownloadDefaultDir', setFileManagerDownloadDefaultDir)}
                fileManagerDownloadDefaultDirPreview={resolveFileManagerDownloadDirPreview(fileManagerDownloadDefaultDir, programDirectory)}
                fileManagerUploadChunkSizeKiB={fileManagerUploadChunkSizeKiB}
                onFileManagerUploadChunkSizeKiBChange={handleFileManagerUploadSettingChange('fileManagerUploadChunkSizeKiB', setFileManagerUploadChunkSizeKiB)}
                fileManagerUploadMaxFiles={fileManagerUploadMaxFiles}
                onFileManagerUploadMaxFilesChange={handleFileManagerUploadSettingChange('fileManagerUploadMaxFiles', setFileManagerUploadMaxFiles)}
                fileManagerUploadMaxChunksPerFile={fileManagerUploadMaxChunksPerFile}
                onFileManagerUploadMaxChunksPerFileChange={handleFileManagerUploadSettingChange('fileManagerUploadMaxChunksPerFile', setFileManagerUploadMaxChunksPerFile)}
                fileManagerUploadGlobalInflightLimit={fileManagerUploadGlobalInflightLimit}
                onFileManagerUploadGlobalInflightLimitChange={handleFileManagerUploadSettingChange('fileManagerUploadGlobalInflightLimit', setFileManagerUploadGlobalInflightLimit)}
              />
            )}
            {activeTab === 'appearance' && (
              <AppearanceTab
                terminalFontSize={terminalFontSize}
                onTerminalFontSizeChange={handleTerminalFontChange}
                terminalLocalEcho={terminalLocalEcho}
                onTerminalLocalEchoChange={handleTerminalLocalEchoChange}
                terminalTimestamps={terminalTimestamps}
                onTerminalTimestampsChange={handleTerminalTimestampsChange}
                terminalColorTheme={terminalColorTheme}
                onTerminalColorThemeChange={(key) => { setTerminalColorTheme(key); localStorage.setItem('terminalColorTheme', key); window.dispatchEvent(new CustomEvent('terminal-theme-changed', { detail: key })); }}
                themeMode={themeMode}
                onThemeChange={handleThemeChange}
                probePanelPosition={probePanelPosition}
                onProbePanelPositionChange={onProbePanelPositionChange}
                themeAccent={themeAccent}
                onColorChange={handleColorChange}
                useCustomAccent={useCustomAccent}
                onToggleAccent={handleToggleAccent}
                termBgImage={termBgImage}
                onTermBgUpload={handleTermBgUpload}
                onTermBgReset={handleTermBgReset}
                termBgOpacity={termBgOpacity}
                onTermBgOpacityChange={handleTermBgOpacityChange}
                applyBgGlobally={applyBgGlobally}
                onToggleApplyBgGlobally={handleToggleApplyBgGlobally}
                rememberWindowSize={rememberWindowSize}
                onToggleRememberWindowSize={handleToggleRememberWindowSize}
                onResetWindowSize={handleResetWindowSize}
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
                onSyncModeChange={handleSyncModeChange}
                autoSyncEnabled={autoSyncEnabled}
                onAutoSyncEnabledChange={handleAutoSyncEnabledChange}
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
      {/* 选择恢复来源 */}
      {confirmRestoreProvider && (() => {
        const availableProviders = configuredProviderIds().filter(id => !failedRestoreProviders.includes(id));
        return (
          <div className="modal-overlay" style={{ zIndex: Z.MODAL }}>
            <div className="glass-card" style={{ width: 420, padding: 24, animation: 'scaleIn 0.18s ease' }}>
              <div style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 16, fontWeight: 'bold' }}>{$t('选择恢复来源')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {availableProviders.map(id => (
                  <button key={id} className="btn btn-secondary" disabled={loadingBackups} onClick={() => loadRestoreBackups(id)}>
                    {PROVIDER_LIST.find(p => p.id === id)?.label || id}
                  </button>
                ))}
                {availableProviders.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>{$t('没有可用的云端来源')}</div>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                <button className="btn btn-secondary" disabled={loadingBackups} onClick={() => setConfirmRestoreProvider(false)}>{$t('取消')}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 确认恢复弹窗（含列表选择） */}
      {confirmRestore && (
        <div className="modal-overlay" style={{ zIndex: Z.MODAL }}>
          <div className="glass-card" style={{ width: 450, padding: 24, animation: 'scaleIn 0.18s ease' }}>
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
