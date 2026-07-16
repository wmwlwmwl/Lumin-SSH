import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { createPortal } from 'react-dom';
import * as AppGo from '../../wailsjs/go/main/App.js';
const FileEditor = React.lazy(() => import('./FileEditor.jsx'));
import { CanResolveFilePaths, EventsOn, OnFileDrop, OnFileDropOff } from '../../wailsjs/runtime/runtime.js';
import { useTranslation, t as tKey, getLanguage } from '../i18n.js';
import { clampMenuPosition } from '../utils/menuPosition.js';
import FileUploadQueuePanel from './FileUploadQueuePanel.jsx';
import Tiptop from './Tiptop.jsx';
import { getSessionUploadQueue, getSessionWorkbenchState, setSessionWorkbenchState, subscribeSessionUploadQueue, subscribeSessionWorkbenchState, updateSessionUploadQueue } from '../utils/fileWorkbench.js';
import {
  Folder, FolderOpen, FolderPlus, File, FileText, FilePlus, FileCode,
  FileArchive, Settings, ClipboardList, Wrench, Image, Code, Globe,
  Palette, Database, Terminal, Film, Music, Archive, HardDrive, BookOpen,
  Pencil, PenLine, Download, Upload, Trash2, RefreshCw, Lock, FolderUp, SquarePen, Copy,
} from 'lucide-react';

// 格式化文件大小
function fmtSize(bytes) {
  if (!bytes || bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// 格式化日期
function fmtDate(ts) {
  if (!ts) return '-';
  const lang = getLanguage();
  const locale = typeof lang === 'string' && lang.trim() ? lang : 'zh-CN';
  return new Date(ts).toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// 文件图标
const ICON_SIZE = 16;
function fileIcon(name, isDir) {
  if (isDir) return <Folder size={ICON_SIZE} style={{ color: 'var(--warning)' }} />;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const colorMap = {
    js: '#f7df1e', jsx: '#f7df1e', ts: '#3178c6', tsx: '#3178c6', vue: '#42b883',
    py: '#3572a5', rb: '#cc342d', go: '#00add8', rs: '#dea584', java: '#b07219',
    c: '#555555', cpp: '#f34b7d', h: '#555555', cs: '#178600',
    html: '#e34c26', css: '#563d7c', scss: '#c6538c', less: '#1d365d',
    json: '#4b5563', yaml: '#4b5563', yml: '#4b5563', toml: '#9c4221', ini: '#4b5563', env: '#4b5563',
    md: '#083fa1', txt: '#4b5563', log: '#4b5563',
    png: '#a855f7', jpg: '#a855f7', jpeg: '#a855f7', gif: '#a855f7', svg: '#a855f7', webp: '#a855f7',
    zip: '#eab308', tar: '#eab308', gz: '#eab308', rar: '#eab308', '7z': '#eab308',
    sh: '#89e051', bash: '#89e051', zsh: '#89e051',
    pdf: '#ff0000', sql: '#e38c00', xml: '#f16529', php: '#4f5d95',
    mp4: '#6366f1', mkv: '#6366f1', avi: '#6366f1',
    mp3: '#1db954', wav: '#1db954',
  };
  const iconMap = {
    js: Code, jsx: Code, ts: Code, tsx: Code, vue: Code,
    py: Terminal, rb: HardDrive, go: Code, rs: Code, java: Code,
    c: Code, cpp: Code, h: Code, cs: Code,
    html: Globe, css: Palette, scss: Palette, less: Palette,
    json: Settings, yaml: Settings, yml: Settings, toml: Settings, ini: Settings, env: Settings,
    md: FileText, txt: File, log: ClipboardList,
    png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image,
    zip: FileArchive, tar: FileArchive, gz: FileArchive, rar: FileArchive, '7z': FileArchive,
    sh: Wrench, bash: Wrench, zsh: Wrench,
    pdf: BookOpen, sql: Database, xml: FileCode, php: Terminal,
    mp4: Film, mkv: Film, avi: Film,
    mp3: Music, wav: Music,
  };
  const IconComp = iconMap[ext] || File;
  const color = colorMap[ext] || '#4b5563';
  return <IconComp size={ICON_SIZE} style={{ color }} />;
}

// 判断是否可以编辑（文本文件）
function isEditable(name) {
  // ponytail: 以 . 开头的文件（如 .htaccess, .bashrc, .env）视为配置文件，默认可编辑
  if (name.startsWith('.')) return true;
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.ca-bundle')) return true;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const editable = [
    'txt', 'md', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'config',
    'cer', 'crt', 'cert', 'pem', 'key', 'csr', 'pub', 'header', 'ca-bundle',
    'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs',
    'php', 'html', 'css', 'scss', 'less', 'xml', 'sql', 'sh', 'bash', 'zsh', 'vue', 'svelte',
    'list', 'sources', 'repo', 'nginx', 'gitignore', 'dockerfile', 'makefile',
  ];
  if (editable.includes(ext)) return true;
  // No extension (like Dockerfile, Makefile)
  if (!name.includes('.')) return true;
  return false;
}

// 判断是否为压缩包
function isArchive(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ['zip', 'tar', 'gz', 'bz2', 'tgz', 'rar', '7z'].includes(ext) || name.toLowerCase().endsWith('.tar.gz');
}

// 文件编辑大小上限
const MAX_EDIT_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CHUNK_UPLOAD_RETRIES = 5;
const UPLOAD_ABORT_SENTINEL = '__LUMIN_UPLOAD_ABORTED__';
const DEFAULT_FILE_MANAGER_DOWNLOAD_DIR = '${APP_DIR}\\download';
const DOWNLOAD_CONFLICT_STRATEGY_DIFF_OVERWRITE = 'diff_overwrite';
const DOWNLOAD_CONFLICT_STRATEGY_FORCE_OVERWRITE = 'force_overwrite';
const DOWNLOAD_CONFLICT_STRATEGY_PROMPT = 'prompt';
const DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME = 'auto_rename';
const DOWNLOAD_RENAME_SUFFIX_TIMESTAMP = 'timestamp';
const DOWNLOAD_RENAME_SUFFIX_RANDOM = 'random';
const DOWNLOAD_RENAME_SUFFIX_SEQUENCE = 'sequence';

// Check if a file name is a hidden/system file that should be skipped
function isHiddenFile(name) {
  return /^\./.test(name) || /^Thumbs\.db$/i.test(name) || /^desktop\.ini$/i.test(name);
}

// Recursively traverse a FileSystemEntry to collect all File objects
function traverseEntry(entry) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      if (isHiddenFile(entry.name)) {
        resolve([]);
        return;
      }
      entry.file((file) => {
        file._fullPath = entry.fullPath;
        resolve([file]);
      }, () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const allEntries = [];
      let emptyCount = 0;
      function readBatch() {
        reader.readEntries((entries) => {
          if (entries.length === 0) {
            emptyCount++;
            // 连续两次返回空数组才确认读取完成（规避 Chrome readEntries 提前返回的 bug）
            if (emptyCount >= 2) {
              Promise.all(allEntries.map((e) => traverseEntry(e))).then((results) => {
                resolve(results.flat());
              });
            } else {
              readBatch();
            }
          } else {
            allEntries.push(...entries);
            emptyCount = 0;
            readBatch();
          }
        }, () => resolve([]));
      }
      readBatch();
    } else {
      resolve([]);
    }
  });
}

// 读取 Blob 为 base64 字符串（去掉 data URL 前缀）
function readBlobAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function debugUploadFileInfo(file) {
  if (!file) return null;
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    webkitRelativePath: file.webkitRelativePath,
    fullPath: file._fullPath,
    path: file.path,
    constructorName: file.constructor?.name,
    keys: Object.keys(file),
  };
}

function debugUploadItemInfo(item) {
  if (!item) return null;
  let entry = null;
  let file = null;
  try {
    const rawEntry = item.webkitGetAsEntry?.();
    if (rawEntry) {
      entry = {
        name: rawEntry.name,
        fullPath: rawEntry.fullPath,
        isFile: rawEntry.isFile,
        isDirectory: rawEntry.isDirectory,
        filesystemName: rawEntry.filesystem?.name,
      };
    }
  } catch (err) {
    entry = { error: String(err) };
  }
  try {
    file = item.kind === 'file' ? debugUploadFileInfo(item.getAsFile?.()) : null;
  } catch (err) {
    file = { error: String(err) };
  }
  return {
    kind: item.kind,
    type: item.type,
    entry,
    file,
  };
}

function isCompressedTransferEnabled() {
  return localStorage.getItem('fileManagerCompressedTransfer') !== 'false';
}

function getDownloadConflictSettingsFromStorage() {
  return {
    strategy: localStorage.getItem('fileManagerDownloadConflictStrategy') || DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME,
    diffBySize: localStorage.getItem('fileManagerDownloadConflictDiffBySize') !== 'false',
    diffByMtime: localStorage.getItem('fileManagerDownloadConflictDiffByMtime') !== 'false',
    renameSuffixMode: localStorage.getItem('fileManagerDownloadRenameSuffixMode') || DOWNLOAD_RENAME_SUFFIX_SEQUENCE,
  };
}

function buildDownloadConflictOptionsPayload(settings, overrides = {}) {
  const next = { ...settings, ...overrides };
  return JSON.stringify({
    strategy: next.strategy || DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME,
    diffBySize: next.diffBySize !== false,
    diffByMtime: next.diffByMtime !== false,
    renameSuffixMode: next.renameSuffixMode || DOWNLOAD_RENAME_SUFFIX_SEQUENCE,
    pathStrategies: next.pathStrategies || {},
  });
}

function downloadConflictKindLabel(kind, t) {
  if (kind === 'directory') return t('文件夹');
  if (kind === 'file') return t('文件');
  return '-';
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function computeCompressedOverallProgress(phase, phaseProgress, currentProgress = 0) {
  const safePhaseProgress = Math.max(0, Math.min(100, Number(phaseProgress) || 0));
  const baseline = Math.max(0, Math.min(100, Number(currentProgress) || 0));
  switch (phase) {
    case 'compressing':
      return Math.max(baseline, safePhaseProgress * 0.5);
    case 'uploading':
      return Math.max(baseline, 50 + safePhaseProgress * 0.49);
    case 'uploading-file':
      return Math.max(baseline, safePhaseProgress);
    case 'completed':
      return 100;
    case 'preparing':
    case 'scanning':
    case 'extracting':
    case 'cleanup-local':
    case 'cleanup-remote':
    case 'failed':
    default:
      return baseline;
  }
}

function normalizeChmodMode(value) {
  const cleaned = String(value || '').replace(/[^0-7]/g, '');
  if (cleaned.length === 4 && cleaned[0] === '0') {
    return cleaned.slice(1);
  }
  return cleaned.slice(0, 3);
}

function calcChmodOctal(perms) {
  const u = (perms.user.r ? 4 : 0) + (perms.user.w ? 2 : 0) + (perms.user.x ? 1 : 0);
  const g = (perms.group.r ? 4 : 0) + (perms.group.w ? 2 : 0) + (perms.group.x ? 1 : 0);
  const o = (perms.other.r ? 4 : 0) + (perms.other.w ? 2 : 0) + (perms.other.x ? 1 : 0);
  return `${u}${g}${o}`;
}

function permsFromChmodMode(modeStr) {
  const normalized = normalizeChmodMode(modeStr) || '644';
  const u = parseInt(normalized[0], 8);
  const g = parseInt(normalized[1], 8);
  const o = parseInt(normalized[2], 8);
  return {
    user: { r: !!(u & 4), w: !!(u & 2), x: !!(u & 1) },
    group: { r: !!(g & 4), w: !!(g & 2), x: !!(g & 1) },
    other: { r: !!(o & 4), w: !!(o & 2), x: !!(o & 1) },
  };
}

function createLimiter(limit) {
  const max = Math.max(1, limit);
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) {
      return;
    }
    const { fn, resolve, reject } = queue.shift();
    active++;
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

function runWithLimit(items, limit, handler) {
  const limiter = createLimiter(limit);
  return Promise.all(items.map((item, index) => limiter(() => handler(item, index))));
}

function runWithLimitSettled(items, limit, handler) {
  const limiter = createLimiter(limit);
  return Promise.all(items.map((item, index) => limiter(() => handler(item, index))
    .then((value) => ({ status: 'fulfilled', value }))
    .catch((reason) => ({ status: 'rejected', reason }))));
}

async function uploadChunkWithRetry(label, uploadFn, onAttempt) {
  let firstError = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_CHUNK_UPLOAD_RETRIES; attempt++) {
    try {
      onAttempt?.(attempt, null);
      return await uploadFn();
    } catch (error) {
      if (!firstError) firstError = error;
      lastError = error;
      onAttempt?.(attempt, error);
    }
  }
  const firstMessage = firstError instanceof Error ? firstError.message : String(firstError || '');
  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError || '');
  if (firstMessage && lastMessage && firstMessage !== lastMessage) {
    throw new Error(`${label} 重试 ${MAX_CHUNK_UPLOAD_RETRIES} 次后仍失败。首次错误: ${firstMessage}；最终错误: ${lastMessage}`);
  }
  throw new Error(`${label} 重试 ${MAX_CHUNK_UPLOAD_RETRIES} 次后仍失败: ${lastMessage || '未知错误'}`);
}

// ── Chmod Dialog ──────────────────────────────────────────────
function ChmodDialog({ path, permission, mode, includeSubdirectories = false, showIncludeSubdirectories = false, onSave, onClose, t }) {
  const parsePerms = (permStr) => {
    const p = permStr && permStr.length >= 10 ? permStr.slice(1) : '---------';
    return {
      user: { r: p[0] === 'r', w: p[1] === 'w', x: p[2] === 'x' },
      group: { r: p[3] === 'r', w: p[4] === 'w', x: p[5] === 'x' },
      other: { r: p[6] === 'r', w: p[7] === 'w', x: p[8] === 'x' },
    };
  };

  const rememberedMode = normalizeChmodMode(mode);
  const fallbackPerms = parsePerms(permission || '');
  const [perms, setPerms] = useState(rememberedMode ? permsFromChmodMode(rememberedMode) : fallbackPerms);
  const [octal, setOctal] = useState(rememberedMode || calcChmodOctal(fallbackPerms));
  const [includeChildren, setIncludeChildren] = useState(Boolean(includeSubdirectories));

  const togglePerm = (cat, key) => {
    setPerms(prev => {
      const next = { ...prev, [cat]: { ...prev[cat], [key]: !prev[cat][key] } };
      setOctal(calcChmodOctal(next));
      return next;
    });
  };

  const handleOctalChange = (e) => {
    const val = normalizeChmodMode(e.target.value);
    setOctal(val);
    if (val.length === 3) {
      setPerms(permsFromChmodMode(val));
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-sm">
        <div className="modal-header">
          <div className="modal-title"><Lock size={14} /> {t('修改权限')}</div>
        </div>
        <div className="modal-body">
          <div className="chmod-dialog-body">
            <div className="chmod-dialog-path">{path}</div>
            <div className="chmod-grid">
              <div className="chmod-row">
                <span></span>
                <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('读取')}</span>
                <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('写入')}</span>
                <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('执行')}</span>
              </div>
              <div className="chmod-row">
                <span className="chmod-row-label">{t('用户')}</span>
                {['r','w','x'].map(k => (
                  <label key={k} className="chmod-checkbox" style={{ justifyContent: 'center' }}>
                    <input type="checkbox" checked={perms.user[k]} onChange={() => togglePerm('user', k)} />
                  </label>
                ))}
              </div>
              <div className="chmod-row">
                <span className="chmod-row-label">{t('组')}</span>
                {['r','w','x'].map(k => (
                  <label key={k} className="chmod-checkbox" style={{ justifyContent: 'center' }}>
                    <input type="checkbox" checked={perms.group[k]} onChange={() => togglePerm('group', k)} />
                  </label>
                ))}
              </div>
              <div className="chmod-row">
                <span className="chmod-row-label">{t('其他')}</span>
                {['r','w','x'].map(k => (
                  <label key={k} className="chmod-checkbox" style={{ justifyContent: 'center' }}>
                    <input type="checkbox" checked={perms.other[k]} onChange={() => togglePerm('other', k)} />
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('八进制:')}</span>
              <input className="chmod-octal-input" value={octal} onChange={handleOctalChange} />
            </div>
            {showIncludeSubdirectories && (
              <label className="chmod-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={includeChildren} onChange={(e) => setIncludeChildren(e.target.checked)} />
                <span>{t('包含子目录')}</span>
              </label>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('取消')}</button>
          <button className="btn btn-primary" onClick={() => onSave(octal.length === 3 ? octal : calcChmodOctal(perms), includeChildren)}>{t('确定')}</button>
        </div>
      </div>
    </div>
  );
}

// Context menu component
function ContextMenu({ pos, item, onClose, onDownload, onEdit, onRename, onDelete, onDeleteShell, onMkdir, onNewFile, onCompress, onUncompress, onChmod, onCopyPath, t }) {
  const ref = useRef(null);
  const [adjusted, setAdjusted] = useState({ left: pos.x, top: pos.y });

  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const clamped = clampMenuPosition(pos.x, pos.y, rect.width, rect.height);
    setAdjusted({ left: clamped.x, top: clamped.y });
  }, [pos.x, pos.y]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: adjusted.left, top: adjusted.top }}
    >
      {item && (
        <div className="context-menu-item" onClick={onCopyPath}>
          <Copy size={14} /> {t('复制路径')}
        </div>
      )}
      {item && !item.isDirectory && isEditable(item.name) && (
        <div className="context-menu-item" onClick={onEdit}>
          <SquarePen size={14} /> {t('编辑')}
        </div>
      )}
      {item && (
        <div className="context-menu-item" onClick={onDownload}>
          <Download size={14} /> {item.isDirectory ? t('下载文件夹到本地') : t('下载到本地')}
        </div>
      )}
      {item && (
        <div className="context-menu-item" onClick={onCompress}>
          <Archive size={14} /> {t('压缩 (tar.gz)')}
        </div>
      )}
      {item && !item.isDirectory && isArchive(item.name) && (
        <div className="context-menu-item" onClick={onUncompress}>
          <FileArchive size={14} /> {t('解压')}
        </div>
      )}
      {item && (
        <div className="context-menu-item" onClick={onRename}>
          <PenLine size={14} /> {t('重命名')}
        </div>
      )}
      {item && (
        <div className="context-menu-item" onClick={onChmod}>
          <Lock size={14} /> {t('修改权限')}
        </div>
      )}
      {item && <div className="context-menu-divider" />}
      {!item && (
        <div className="context-menu-item" onClick={onNewFile}>
          <FilePlus size={14} /> {t('新建文件')}
        </div>
      )}
      {!item && (
        <div className="context-menu-item" onClick={onMkdir}>
          <FolderPlus size={14} /> {t('新建文件夹')}
        </div>
      )}
      {item && (
        <div className="context-menu-item danger" onClick={onDelete}>
          <Trash2 size={14} /> {t('删除')} (SFTP)
        </div>
      )}
      {item && (
        <div className="context-menu-item danger" onClick={onDeleteShell}>
          <Terminal size={14} /> {t('删除')} (rm -rf)
        </div>
      )}
    </div>
  );
}

export default function FileManager({ sessionId, sessionGroupId = sessionId, addToast, isActive = true, initialPath = '' }) {
  const { t } = useTranslation();
  const joinPath = (base, name) => base === '/' ? `/${name}` : `${base}/${name}`;
  const normalizePath = useCallback((value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }, []);
  const [currentPath, setCurrentPath] = useState('/');
  const currentPathRef = useRef(currentPath);
  const currentPathHydratedRef = useRef(false);
  const skipNextTerminalFollowRef = useRef(false);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
  const [followTerminalCwd, setFollowTerminalCwd] = useState(() => localStorage.getItem('fileManagerFollowTerminalCwd') !== 'false');
  useEffect(() => {
    const handleChange = (e) => setFollowTerminalCwd(e.detail !== false);
    window.addEventListener('file-manager-follow-terminal-cwd-changed', handleChange);
    return () => window.removeEventListener('file-manager-follow-terminal-cwd-changed', handleChange);
  }, []);
  useEffect(() => {
    if (!sessionId || !currentPathHydratedRef.current) return;
    window.__luminFileManagerPaths = window.__luminFileManagerPaths || {};
    window.__luminFileManagerPaths[sessionId] = currentPath;
    window.dispatchEvent(new CustomEvent('ssh-file-manager-path-changed', {
      detail: { sessionId, path: currentPath }
    }));
  }, [currentPath, sessionId]);
  const [editingPath, setEditingPath] = useState(null);
  const [items, setItems] = useState([]);
  const [sortField, setSortField] = useState('name');  // name, size, permissions, modified
  const [sortDir, setSortDir] = useState('asc');  // asc, desc

  // 排序后的列表（目录在前）
  const sortedItems = useMemo(() => [...items].sort((a, b) => {
    // 目录始终在前
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let cmp = 0;
    switch (sortField) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'size': cmp = (a.size || 0) - (b.size || 0); break;
      case 'permissions': cmp = (a.permission || '').localeCompare(b.permission || ''); break;
      case 'modified': cmp = new Date(a.modifyTime || 0) - new Date(b.modifyTime || 0); break;
      default: cmp = 0;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }), [items, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const fileManagerRootRef = useRef(null);
  const nativeDropHandledUntilRef = useRef(0);
  const nativeUploadQueueIdRef = useRef('');
  const abortedUploadIdsRef = useRef(new Set());
  const fileListRef = useRef(null);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [contextMenu, setContextMenu] = useState(null); // { pos, item }
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [chmodTarget, setChmodTarget] = useState(null); // { item, path, mode, includeSubdirectories, showIncludeSubdirectories }
  const [openEditFiles, setOpenEditFiles] = useState([]);      // [{ path, name, content }]
  const openEditFilesRef = useRef([]);
  useEffect(() => { openEditFilesRef.current = openEditFiles; }, [openEditFiles]);
  const [activeEditPath, setActiveEditPath] = useState(null);  // 当前激活的文件路径
  useEffect(() => {
    if (!sessionId) return;
    window.__luminEditorStates = window.__luminEditorStates || {};
    window.__luminEditorStates[sessionId] = {
      openFilePaths: openEditFiles.map((file) => file?.path).filter(Boolean),
      activeFilePath: activeEditPath || '',
    };
  }, [activeEditPath, openEditFiles, sessionId]);
  useEffect(() => {
    return () => {
      if (sessionId && window.__luminEditorStates) {
        delete window.__luminEditorStates[sessionId];
      }
    };
  }, [sessionId]);
  const [editorMode, setEditorMode] = useState(() => localStorage.getItem('fileEditorMode') || 'modal');
  const [editorSplitPosition, setEditorSplitPosition] = useState(() => localStorage.getItem('editorSplitPosition') || 'right');
  const setTransferInfo = useCallback(() => {}, []);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const uploadInputRef = useRef(null);
  const uploadFolderInputRef = useRef(null);
  const [workbenchState, setWorkbenchStateState] = useState(() => getSessionWorkbenchState(sessionGroupId));
  const [uploadQueueItems, setUploadQueueItems] = useState(() => getSessionUploadQueue(sessionGroupId));
  const activeUploadCount = useMemo(() => uploadQueueItems.filter((item) => item.status === 'queued' || item.status === 'uploading').length, [uploadQueueItems]);

  // 当所有文件关闭时，重置分栏 host 宽度
  useEffect(() => {
    if (openEditFiles.length === 0) {
      const host = document.getElementById('editor-split-host');
      const container = document.getElementById('session-editor-container');
      if (host) {
        host.style.width = '0px';
        host.style.height = '100%';
        host.style.minWidth = '0px';
        host.style.maxWidth = '0px';
        host.style.minHeight = '0px';
        host.style.maxHeight = '0px';
        host.style.borderLeft = 'none';
        host.style.borderRight = 'none';
        host.style.borderTop = 'none';
        host.style.order = '2';
      }
      if (container) {
        container.style.flexDirection = 'row';
      }
    }
  }, [openEditFiles.length]);

  useEffect(() => {
    if (!sessionGroupId) return undefined;
    return subscribeSessionWorkbenchState(sessionGroupId, setWorkbenchStateState);
  }, [sessionGroupId]);

  useEffect(() => {
    if (!sessionGroupId) return undefined;
    return subscribeSessionUploadQueue(sessionGroupId, setUploadQueueItems);
  }, [sessionGroupId]);

  const setUploadPanelOpen = useCallback((open) => {
    const current = getSessionWorkbenchState(sessionGroupId);
    setSessionWorkbenchState(sessionGroupId, {
      uploadOpen: open,
      activeTab: open ? 'upload' : (current.editorSplitOpen ? 'editor' : current.activeTab),
    });
  }, [sessionGroupId]);

  const toggleUploadPanel = useCallback(() => {
    const current = getSessionWorkbenchState(sessionGroupId);
    setSessionWorkbenchState(sessionGroupId, {
      uploadOpen: !current.uploadOpen,
      activeTab: current.uploadOpen ? (current.editorSplitOpen ? 'editor' : current.activeTab) : 'upload',
    });
  }, [sessionGroupId]);

  useEffect(() => {
    const host = document.getElementById('editor-split-host');
    const container = document.getElementById('session-editor-container');
    const resizer = document.getElementById('editor-split-resizer');
    const mainContent = document.getElementById('editor-main-content');
    if (!host || !container) return undefined;

    const resetLayout = () => {
      if (resizer) resizer.style.display = 'none';
      if (mainContent) mainContent.style.order = '1';
      container.style.flexDirection = 'row';
      host.style.width = '0px';
      host.style.height = '100%';
      host.style.minWidth = '0px';
      host.style.maxWidth = '0px';
      host.style.minHeight = '0px';
      host.style.maxHeight = '0px';
      host.style.borderLeft = 'none';
      host.style.borderRight = 'none';
      host.style.borderTop = 'none';
      host.style.order = '2';
    };

    if (!isActive || !workbenchState.uploadOpen || workbenchState.editorSplitOpen) {
      if (!workbenchState.editorSplitOpen) resetLayout();
      return undefined;
    }

    if (mainContent) mainContent.style.order = '0';
    if (resizer) {
      resizer.style.display = '';
      resizer.style.order = '1';
    }
    container.style.flexDirection = 'row';
    host.style.width = '42%';
    host.style.height = '100%';
    host.style.minWidth = '320px';
    host.style.maxWidth = '70%';
    host.style.minHeight = '0px';
    host.style.maxHeight = 'none';
    host.style.borderLeft = '1px solid var(--border)';
    host.style.borderRight = 'none';
    host.style.borderTop = 'none';
    host.style.order = '2';

    return () => {
      const latest = getSessionWorkbenchState(sessionGroupId);
      if (!latest.uploadOpen && !latest.editorSplitOpen) {
        resetLayout();
      }
    };
  }, [isActive, sessionGroupId, workbenchState.editorSplitOpen, workbenchState.uploadOpen]);

  const loadDir = useCallback(async (path, silent = false) => {
    setLoading(true);
    try {
      const data = await AppGo.ListDir(sessionId, path);
      if (!mountedRef.current) return false;
      setItems(data || []);
      currentPathHydratedRef.current = true;
      setCurrentPath(path);
      if (fileListRef.current) fileListRef.current.scrollTop = 0;
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      if (!silent) {
        const msg = String(err).toLowerCase().includes('permission denied')
          ? `${t('权限不足')}: SFTP ${t('仍以')} ${sessionId ? t('原用户') : ''} ${t('身份运行，终端内 sudo 不影响文件管理器')}`
          : `${t('读取目录失败')}: ${err}`;
        addToast(`${msg} [${path}]`, 'error');
      }
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [sessionId, addToast, t]);

  useEffect(() => {
    let cancelled = false;
    currentPathHydratedRef.current = false;
    (async () => {
      const paths = [];
      const pushPath = (value) => {
        const normalized = normalizePath(value);
        if (normalized && !paths.includes(normalized)) {
          paths.push(normalized);
        }
      };

      const rememberedPath = normalizePath(window.__luminFileManagerPaths?.[sessionId]);
      const normalizedInitialPath = normalizePath(initialPath);
      const shouldPreferInitialPath = !rememberedPath && !!normalizedInitialPath;

      skipNextTerminalFollowRef.current = shouldPreferInitialPath;

      pushPath(rememberedPath);
      pushPath(normalizedInitialPath);

      if (!rememberedPath && !normalizedInitialPath && followTerminalCwd) {
        try {
          const cwd = await AppGo.GetTerminalCwd(sessionId);
          if (!cancelled) {
            pushPath(cwd);
          }
        } catch (_) {}
      }

      pushPath('/root');
      pushPath('/');

      for (const p of paths) {
        if (cancelled) return;
        if (await loadDir(p, true)) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadDir, initialPath, followTerminalCwd, normalizePath]);

  useEffect(() => {
    if (!followTerminalCwd) return undefined;
    const off = EventsOn(`ssh-terminal-cwd-${sessionId}`, async (cwd) => {
      const newPath = normalizePath(cwd);
      if (!newPath) return;
      if (skipNextTerminalFollowRef.current) {
        skipNextTerminalFollowRef.current = false;
        if (newPath !== currentPathRef.current) {
          return;
        }
      }
      if (newPath !== currentPathRef.current) {
        const ok = await loadDir(newPath, true);
        if (!ok) loadDir('/');
      }
    });
    return off;
  }, [sessionId, loadDir, followTerminalCwd, normalizePath]);

  useEffect(() => {
    const offCompressed = EventsOn(`compressed-upload-progress-${sessionId}`, (payload = {}) => {
      const uploadId = typeof payload.uploadId === 'string' ? payload.uploadId.trim() : '';
      if (!uploadId) return;
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => {
        if (item.id !== uploadId) return item;
        const nextPhase = payload.phase || item.phase || 'preparing';
        const nextPhaseProgress = Math.max(0, Math.min(100, Number(payload.phaseProgress) || 0));
        const hasBytesDone = payload.bytesDone !== undefined && payload.bytesDone !== null && Number.isFinite(Number(payload.bytesDone));
        const hasBytesTotal = payload.bytesTotal !== undefined && payload.bytesTotal !== null && Number.isFinite(Number(payload.bytesTotal));
        return {
          ...item,
          phase: nextPhase,
          phaseProgress: nextPhaseProgress,
          progress: computeCompressedOverallProgress(nextPhase, nextPhaseProgress, item.progress),
          bytesUploaded: hasBytesDone ? Number(payload.bytesDone) : item.bytesUploaded,
          bytesTotal: hasBytesTotal ? Number(payload.bytesTotal) : item.bytesTotal,
          phaseCurrent: payload.current || '',
          phaseDetail: payload.detail || '',
          updatedAt: Date.now(),
        };
      }));
    });
    return () => {
      offCompressed?.();
    };
  }, [sessionId, sessionGroupId]);

  useEffect(() => {
    const offDownload = EventsOn(`download-transfer-progress-${sessionId}`, (payload = {}) => {
      const downloadId = typeof payload.downloadId === 'string' ? payload.downloadId.trim() : '';
      if (!downloadId) return;
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => {
        if (item.id !== downloadId) return item;
        const nextStatus = payload.status || item.status || 'uploading';
        const nextPhase = payload.phase || item.phase || '';
        const nextProgress = Math.max(0, Math.min(100, Number.isFinite(Number(payload.progress)) ? Number(payload.progress) : (nextStatus === 'completed' ? 100 : (item.progress || 0))));
        const hasBytesDone = payload.bytesDone !== undefined && payload.bytesDone !== null && Number.isFinite(Number(payload.bytesDone));
        const hasBytesTotal = payload.bytesTotal !== undefined && payload.bytesTotal !== null && Number.isFinite(Number(payload.bytesTotal));
        return {
          ...item,
          direction: 'download',
          mode: payload.mode || item.mode || 'download-file',
          status: nextStatus,
          phase: nextPhase,
          progress: nextProgress,
          bytesUploaded: hasBytesDone ? Number(payload.bytesDone) : item.bytesUploaded,
          bytesTotal: hasBytesTotal ? Number(payload.bytesTotal) : item.bytesTotal,
          phaseCurrent: payload.current || item.phaseCurrent || '',
          phaseDetail: payload.detail || item.phaseDetail || '',
          updatedAt: Date.now(),
        };
      }));
    });
    return () => {
      offDownload?.();
    };
  }, [sessionId, sessionGroupId]);

  // Breadcrumb parts
  const pathParts = currentPath === '/'
    ? [{ label: t('目录根'), path: '/' }]
    : currentPath.split('/').filter(Boolean).reduce((acc, part, i, arr) => {
        const path = '/' + arr.slice(0, i + 1).join('/');
        acc.push({ label: part, path });
        return acc;
      }, [{ label: t('目录根'), path: '/' }]);

  // Navigate into folder
  const navigate = (item) => {
    if (!item.isDirectory) return;
    const newPath = currentPath === '/'
      ? `/${item.name}`
      : `${currentPath}/${item.name}`;
    loadDir(newPath);
  };

  const getUploadSettings = useCallback(() => ({
    chunkSizeKiB: parsePositiveInt(localStorage.getItem('fileManagerUploadChunkSizeKiB'), 256),
    maxFiles: parsePositiveInt(localStorage.getItem('fileManagerUploadMaxFiles'), 6),
    maxChunksPerFile: parsePositiveInt(localStorage.getItem('fileManagerUploadMaxChunksPerFile'), 8),
    globalInflightLimit: parsePositiveInt(localStorage.getItem('fileManagerUploadGlobalInflightLimit'), 24),
  }), []);
  const getDefaultDownloadDir = useCallback(() => (
    localStorage.getItem('fileManagerDownloadDefaultDir') || DEFAULT_FILE_MANAGER_DOWNLOAD_DIR
  ).trim() || DEFAULT_FILE_MANAGER_DOWNLOAD_DIR, []);
  const getDownloadConflictSettings = useCallback(() => getDownloadConflictSettingsFromStorage(), []);
  const buildDownloadConflictMessage = useCallback((conflict, fallbackName) => {
    const relativePath = String(conflict?.relativePath || '').trim() || fallbackName || t('当前文件');
    const localSize = conflict?.localSize === undefined || conflict?.localSize === null ? '-' : fmtSize(Number(conflict.localSize) || 0);
    const remoteSize = conflict?.remoteSize === undefined || conflict?.remoteSize === null ? '-' : fmtSize(Number(conflict.remoteSize) || 0);
    const localModifyTime = conflict?.localModifyTime === undefined || conflict?.localModifyTime === null ? '-' : fmtDate(Number(conflict.localModifyTime));
    const remoteModifyTime = conflict?.remoteModifyTime === undefined || conflict?.remoteModifyTime === null ? '-' : fmtDate(Number(conflict.remoteModifyTime));
    const lines = [
      `${t('冲突项')}: ${relativePath}`,
      `${t('本地路径')}: ${conflict?.localPath || '-'}`,
      `${t('本地类型')}: ${downloadConflictKindLabel(conflict?.localKind, t)}`,
      `${t('远端类型')}: ${downloadConflictKindLabel(conflict?.remoteKind, t)}`,
    ];
    if (conflict?.localKind === 'file' || conflict?.remoteKind === 'file') {
      lines.push(`${t('本地大小')}: ${localSize}`);
      lines.push(`${t('远端大小')}: ${remoteSize}`);
      lines.push(`${t('本地修改时间')}: ${localModifyTime}`);
      lines.push(`${t('远端修改时间')}: ${remoteModifyTime}`);
    }
    lines.push('');
    lines.push(t('请选择本次冲突的处理方式'));
    return lines.join('\n');
  }, [t]);
  const resolvePromptDownloadConflict = useCallback(async (item, remotePath, localPath, settings) => {
    const previewDownloadConflicts = window?.go?.main?.App?.PreviewDownloadConflicts;
    const resolveDownloadLocalPath = window?.go?.main?.App?.ResolveDownloadLocalPath;
    if (typeof previewDownloadConflicts !== 'function') {
      throw new Error(t('当前环境不支持下载冲突处理'));
    }
    const conflicts = await previewDownloadConflicts(sessionId, remotePath, localPath, item.isDirectory);
    if (!Array.isArray(conflicts) || conflicts.length === 0) {
      return {
        localPath,
        optionsJSON: buildDownloadConflictOptionsPayload(settings, {
          strategy: DOWNLOAD_CONFLICT_STRATEGY_FORCE_OVERWRITE,
          pathStrategies: {},
        }),
      };
    }
    const buttons = [
      { label: t('差异覆盖'), value: DOWNLOAD_CONFLICT_STRATEGY_DIFF_OVERWRITE, primary: true },
      { label: t('强制覆盖'), value: DOWNLOAD_CONFLICT_STRATEGY_FORCE_OVERWRITE },
      { label: t('自动重命名'), value: DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME },
      { label: t('取消'), value: 'cancel', secondary: true },
    ];
    const autoRenameOptionsJSON = buildDownloadConflictOptionsPayload(settings, {
      strategy: DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME,
      pathStrategies: {},
    });
    for (const conflict of conflicts) {
      const choice = await window.luminDialog?.choice(
        buildDownloadConflictMessage(conflict, item.name),
        t('下载同名冲突'),
        buttons,
        t('应用到本次剩余冲突'),
      );
      if (!choice?.value || choice.value === 'cancel') {
        return null;
      }
      if (choice.checked) {
        if (choice.value === DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME) {
          const renamedPath = typeof resolveDownloadLocalPath === 'function'
            ? await resolveDownloadLocalPath(localPath, item.isDirectory, autoRenameOptionsJSON)
            : localPath;
          return {
            localPath: renamedPath || localPath,
            optionsJSON: autoRenameOptionsJSON,
          };
        }
        return {
          localPath,
          optionsJSON: buildDownloadConflictOptionsPayload(settings, {
            strategy: choice.value,
            pathStrategies: {},
          }),
        };
      }
      const conflictKey = String(conflict?.key || '.').trim() || '.';
      if (conflictKey === '.' && choice.value === DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME) {
        const renamedPath = typeof resolveDownloadLocalPath === 'function'
          ? await resolveDownloadLocalPath(localPath, item.isDirectory, autoRenameOptionsJSON)
          : localPath;
        return {
          localPath: renamedPath || localPath,
          optionsJSON: autoRenameOptionsJSON,
        };
      }
      settings = {
        ...settings,
        pathStrategies: {
          ...(settings.pathStrategies || {}),
          [conflictKey]: choice.value,
        },
      };
    }
    return {
      localPath,
      optionsJSON: buildDownloadConflictOptionsPayload(settings, {
        strategy: DOWNLOAD_CONFLICT_STRATEGY_FORCE_OVERWRITE,
        pathStrategies: settings.pathStrategies || {},
      }),
    };
  }, [buildDownloadConflictMessage, sessionId, t]);

  const isUploadAbortable = useCallback((item) => {
    if (!item) return false;
    if (item.direction === 'download') {
      if (item.mode === 'download-compressed') {
        return ['preparing', 'compressing', 'downloading', 'extracting'].includes(item.phase);
      }
      return item.status === 'queued' || item.status === 'uploading';
    }
    if (item.mode === 'compressed') {
      return ['preparing', 'scanning', 'compressing', 'uploading', 'uploading-file', 'verifying', 'extracting'].includes(item.phase);
    }
    return item.status === 'queued' || item.status === 'uploading';
  }, []);

  const markUploadAborted = useCallback((queueId, detail = t('已终止')) => {
    if (!queueId) return;
    abortedUploadIdsRef.current.add(queueId);
    updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => (
      item.id === queueId
        ? {
            ...item,
            status: 'failed',
            phase: item.mode === 'compressed' ? 'failed' : item.phase,
            phaseDetail: detail,
            error: detail,
            updatedAt: Date.now(),
          }
        : item
    )));
  }, [sessionGroupId, t]);

  const abortUploadItem = useCallback(async (item, detail = t('已终止')) => {
    if (!item) return;
    markUploadAborted(item.id, detail);
    try {
      if (item.direction === 'download') {
        await window?.go?.main?.App?.AbortDownloadTransfer?.(item.id);
        return;
      }
      if (item.mode === 'compressed') {
        await window?.go?.main?.App?.AbortCompressedUpload?.(item.id);
        return;
      }
      if (item.taskId && item.fileId) {
        await AppGo.AbortChunkedUploadFile(item.taskId, item.fileId).catch(() => {});
      }
    } catch (_) {}
  }, [markUploadAborted, t]);

  const removeUploadItems = useCallback((ids) => {
    const normalizedIds = new Set(
      Array.from(ids || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    if (normalizedIds.size === 0) {
      return;
    }
    normalizedIds.forEach((id) => abortedUploadIdsRef.current.delete(id));
    updateSessionUploadQueue(sessionGroupId, (current) => current.filter((item) => !normalizedIds.has(item.id)));
  }, [sessionGroupId]);

  const abortUploadItems = useCallback((items, detail = t('已终止')) => {
    (items || []).forEach((item) => {
      if (item) {
        void abortUploadItem(item, detail);
      }
    });
  }, [abortUploadItem, t]);

  const abortActiveUploadsForSession = useCallback((disconnectedSessionId, detail = t('已终止')) => {
    if (!disconnectedSessionId || disconnectedSessionId !== sessionId) return;
    const queue = getSessionUploadQueue(sessionGroupId)
      .filter((item) => item?.sourceTerminalId === disconnectedSessionId)
      .filter((item) => isUploadAbortable(item));
    queue.forEach((item) => {
      void abortUploadItem(item, detail);
    });
  }, [abortUploadItem, isUploadAbortable, sessionGroupId, sessionId, t]);

  useEffect(() => () => {
    abortActiveUploadsForSession(sessionId, t('已终止'));
  }, [abortActiveUploadsForSession, sessionId, t]);

  const uploadNativePaths = useCallback(async (paths) => {
    const localPaths = Array.from(paths || []).map((path) => String(path || '').trim()).filter(Boolean);
    if (localPaths.length === 0) {
      return;
    }
    setUploadPanelOpen(true);
    const settings = getUploadSettings();
    const createdAt = Date.now();
    const name = localPaths.length === 1
      ? localPaths[0].split(/[\\/]/).filter(Boolean).pop()
      : `${localPaths.length} ${t('项')}`;
    const queueId = `native-upload-${createdAt}`;
    updateSessionUploadQueue(sessionGroupId, (current) => [{
      id: queueId,
      name,
      relativePath: name,
      remotePath: currentPath,
      status: 'uploading',
      progress: 0,
      bytesUploaded: 0,
      bytesTotal: 0,
      chunkSizeBytes: Math.max(1, settings.chunkSizeKiB * 1024),
      chunksTotal: 0,
      chunksCompleted: 0,
      chunksFailed: 0,
      chunks: [],
      error: '',
      sourceTerminalId: sessionId,
      mode: 'compressed',
      phase: 'preparing',
      phaseProgress: 0,
      phaseCurrent: '',
      phaseDetail: t('准备上传'),
      localPathCount: localPaths.length,
      createdAt,
      updatedAt: createdAt,
    }, ...current]);
    try {
      nativeUploadQueueIdRef.current = queueId;
      abortedUploadIdsRef.current.delete(queueId);
      await window?.go?.main?.App?.UploadLocalPathsCompressed?.(
        sessionId,
        queueId,
        Math.max(1, localPaths.length === 1 ? settings.maxChunksPerFile : settings.maxFiles),
        localPaths,
        currentPath,
      );
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => (
        item.id === queueId
          ? {
              ...item,
              status: 'completed',
              phase: item.phase === 'uploading-file' ? 'uploading-file-completed' : 'completed',
              phaseProgress: 100,
              progress: 100,
              error: '',
              phaseDetail: t('已完成'),
              updatedAt: Date.now(),
            }
          : item
      )));
      addToast(`${t('上传成功')}: ${name}`, 'success');
      await loadDir(currentPath);
    } catch (err) {
      const isAborted = abortedUploadIdsRef.current.has(queueId) || String(err).toLowerCase().includes('context canceled');
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => (
        item.id === queueId
          ? {
              ...item,
              status: 'failed',
              phase: 'failed',
              phaseDetail: isAborted ? t('已终止') : String(err),
              error: isAborted ? t('已终止') : String(err),
              updatedAt: Date.now(),
            }
          : item
      )));
      if (!isAborted) {
        addToast(`${t('上传失败')}: ${err}`, 'error');
      }
    } finally {
      if (nativeUploadQueueIdRef.current === queueId) {
        nativeUploadQueueIdRef.current = '';
      }
    }
  }, [sessionId, sessionGroupId, currentPath, addToast, loadDir, t, markUploadAborted, getUploadSettings, setUploadPanelOpen]);

  const uploadEntries = useCallback(async (entries) => {
    const uploadEntriesList = entries
      .filter((entry) => entry?.file && entry?.relativePath)
      .map((entry) => ({
        file: entry.file,
        relativePath: String(entry.relativePath).replace(/^\/+/, '').replace(/\\/g, '/'),
      }))
      .filter((entry) => entry.relativePath !== '');
    if (uploadEntriesList.length === 0) {
      return;
    }

    setUploadPanelOpen(true);
    const settings = getUploadSettings();
    const chunkSizeBytes = Math.max(1, settings.chunkSizeKiB * 1024);
    const maxFiles = Math.max(1, settings.maxFiles);
    const maxChunksPerFile = Math.max(1, settings.maxChunksPerFile);
    const globalInflightLimit = Math.max(1, settings.globalInflightLimit);
    const uploadPoolSize = Math.max(1, Math.min(maxFiles, globalInflightLimit));
    const totalFiles = uploadEntriesList.length;
    const totalBytes = uploadEntriesList.reduce((sum, entry) => sum + entry.file.size, 0);
    const createdAt = Date.now();
    const queueSeed = uploadEntriesList.map((entry, index) => {
      const totalChunks = entry.file.size > 0 ? Math.ceil(entry.file.size / chunkSizeBytes) : 0;
      return {
        id: `upload-${createdAt}-${index}`,
        name: entry.file.name,
        relativePath: entry.relativePath,
        remotePath: joinPath(currentPath, entry.relativePath),
        status: 'queued',
        progress: 0,
        bytesUploaded: 0,
        bytesTotal: entry.file.size,
        chunkSizeBytes,
        chunksTotal: totalChunks,
        chunksCompleted: 0,
        chunksFailed: 0,
        chunks: Array.from({ length: totalChunks }, (_, chunkIndex) => {
          const start = chunkIndex * chunkSizeBytes;
          const end = Math.min(entry.file.size, start + chunkSizeBytes);
          return {
            index: chunkIndex,
            start,
            end,
            size: end - start,
            status: 'queued',
            attempt: 0,
            error: '',
            updatedAt: createdAt + index,
          };
        }),
        error: '',
        sourceTerminalId: sessionId,
        createdAt: createdAt + index,
        updatedAt: createdAt + index,
      };
    });
    updateSessionUploadQueue(sessionGroupId, (current) => [...queueSeed, ...current]);

    let uploadedBytes = 0;
    let completedFiles = 0;
    let taskId = '';
    const queueIds = new Set(queueSeed.map((item) => item.id));
    const failures = [];
    const patchQueueItem = (queueId, patch) => {
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => (
        item.id === queueId
          ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) }
          : item
      )));
    };
    const patchQueueChunk = (queueId, chunkIndex, patch) => {
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => {
        if (item.id !== queueId) return item;
        const chunks = Array.isArray(item.chunks) ? item.chunks.map((chunk) => (
          chunk.index === chunkIndex ? { ...chunk, ...(typeof patch === 'function' ? patch(chunk) : patch) } : chunk
        )) : [];
        return {
          ...item,
          chunks,
          chunksCompleted: chunks.filter((chunk) => chunk.status === 'completed').length,
          chunksFailed: chunks.filter((chunk) => chunk.status === 'failed').length,
          updatedAt: Date.now(),
        };
      }));
    };
    const updateTransfer = (activeName = '') => {
      const progress = totalBytes > 0
        ? Math.min(100, (uploadedBytes / totalBytes) * 100)
        : (completedFiles / totalFiles) * 100;
      setTransferInfo({
        name: activeName ? `${completedFiles}/${totalFiles} · ${activeName}` : `${completedFiles}/${totalFiles}`,
        progress,
        direction: 'upload',
      });
    };

    try {
      setTransferInfo({ name: `0/${totalFiles}`, progress: 0, direction: 'upload' });
      const globalChunkLimiter = createLimiter(globalInflightLimit);
      taskId = await AppGo.BeginChunkedUploadTask(sessionId, currentPath, uploadPoolSize);

      await runWithLimit(uploadEntriesList, maxFiles, async ({ file, relativePath }, fileIndex) => {
        const queueId = queueSeed[fileIndex]?.id;
        let fileId = '';
        let fileUploadedBytes = 0;
        try {
          patchQueueItem(queueId, { status: 'uploading', updatedAt: Date.now() });
          const totalChunks = file.size > 0 ? Math.ceil(file.size / chunkSizeBytes) : 0;
          fileId = await AppGo.BeginChunkedUploadFile(taskId, relativePath, file.size, totalChunks);
          const chunkIndexes = Array.from({ length: totalChunks }, (_, index) => index);
          const chunkResults = await runWithLimitSettled(chunkIndexes, maxChunksPerFile, async (chunkIndex) => {
            const start = chunkIndex * chunkSizeBytes;
            const end = Math.min(file.size, start + chunkSizeBytes);
            const chunkLabel = `${file.name} 分块 ${chunkIndex + 1}/${Math.max(totalChunks, 1)} [${start}-${end})`;
            await globalChunkLimiter(async () => {
              if (abortedUploadIdsRef.current.has(queueId)) {
                throw new Error(UPLOAD_ABORT_SENTINEL);
              }
              patchQueueChunk(queueId, chunkIndex, { status: 'reading', attempt: 0, error: '', updatedAt: Date.now() });
              const content = await readBlobAsBase64(file.slice(start, end));
              await uploadChunkWithRetry(chunkLabel, () => AppGo.UploadChunkBase64(taskId, fileId, chunkIndex, start, content), (attempt, error) => {
                patchQueueChunk(queueId, chunkIndex, {
                  status: error ? 'retrying' : 'uploading',
                  attempt,
                  error: error ? String(error) : '',
                  updatedAt: Date.now(),
                });
              });
              patchQueueChunk(queueId, chunkIndex, { status: 'completed', error: '', updatedAt: Date.now() });
              const delta = end - start;
              uploadedBytes += delta;
              fileUploadedBytes += delta;
              patchQueueItem(queueId, {
                status: 'uploading',
                bytesUploaded: fileUploadedBytes,
                progress: file.size > 0 ? Math.min(100, (fileUploadedBytes / file.size) * 100) : 100,
                updatedAt: Date.now(),
              });
              updateTransfer(file.name);
            });
          });
          const failedChunks = chunkResults
            .map((result, index) => ({ result, index }))
            .filter(({ result }) => result.status === 'rejected');
          if (failedChunks.length > 0) {
            failedChunks.forEach(({ result, index }) => {
              patchQueueChunk(queueId, index, {
                status: 'failed',
                attempt: MAX_CHUNK_UPLOAD_RETRIES,
                error: String(result.reason),
                updatedAt: Date.now(),
              });
            });
            throw new Error(failedChunks.map(({ result }) => String(result.reason)).slice(0, 3).join('；'));
          }
          await AppGo.CompleteChunkedUploadFile(taskId, fileId);
          completedFiles++;
          patchQueueItem(queueId, {
            status: 'completed',
            bytesUploaded: file.size,
            progress: 100,
            error: '',
            updatedAt: Date.now(),
          });
          updateTransfer(file.name);
        } catch (err) {
          const isAborted = abortedUploadIdsRef.current.has(queueId) || String(err).includes(UPLOAD_ABORT_SENTINEL);
          if (!isAborted) {
            failures.push(`${relativePath}: ${err}`);
          }
          patchQueueItem(queueId, {
            status: 'failed',
            error: isAborted ? t('已终止') : String(err),
            updatedAt: Date.now(),
          });
          if (fileId) {
            await AppGo.AbortChunkedUploadFile(taskId, fileId).catch(() => {});
          } else if (isAborted) {
            markUploadAborted(queueId);
          }
        }
      });

      if (failures.length > 0) {
        addToast(`${t('上传完成')}: ${completedFiles}${t('项成功')}, ${failures.length}${t('项失败')} (${failures.slice(0, 3).join(', ')})`, 'error');
      } else {
        addToast(`${t('上传成功')}: ${completedFiles}${t('项')}`, 'success');
      }
      await loadDir(currentPath);
    } catch (err) {
      if (taskId) {
        await AppGo.AbortChunkedUploadTask(taskId).catch(() => {});
      }
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((item) => (
        queueIds.has(item.id) && (item.status === 'queued' || item.status === 'uploading')
          ? { ...item, status: 'failed', error: String(err), updatedAt: Date.now() }
          : item
      )));
      if (err) addToast(`${t('上传失败')}: ${err}`, 'error');
    } finally {
      if (taskId) {
        await AppGo.FinishChunkedUploadTask(taskId).catch(() => {});
      }
      if (mountedRef.current) setTransferInfo(null);
    }
  }, [sessionId, sessionGroupId, currentPath, getUploadSettings, addToast, loadDir, t, markUploadAborted, setUploadPanelOpen]);

  useEffect(() => {
    const off = EventsOn('ssh-disconnected', (disconnectedSessionId) => {
      abortActiveUploadsForSession(disconnectedSessionId, t('已终止'));
    });
    return () => {
      off?.();
    };
  }, [abortActiveUploadsForSession, t]);

  const handleSelectedFiles = useCallback(async (e) => {
    const rawSelectedFiles = Array.from(e.target.files || []);
    console.log('[FileManager][click upload] input files', {
      files: rawSelectedFiles.map(debugUploadFileInfo),
      rawFiles: rawSelectedFiles,
    });
    const selectedFiles = rawSelectedFiles
      .filter((file) => !isHiddenFile(file.name))
      .map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
      }));
    console.log('[FileManager][click upload] normalized entries', selectedFiles.map((entry) => ({
      relativePath: entry.relativePath,
      file: debugUploadFileInfo(entry.file),
    })));
    e.target.value = '';
    if (selectedFiles.length === 0) {
      return;
    }
    await uploadEntries(selectedFiles);
  }, [uploadEntries]);

  const handleUpload = async () => {
    if (!isCompressedTransferEnabled()) {
      uploadInputRef.current?.click();
      return;
    }
    try {
      const paths = await AppGo.SelectUploadFiles();
      console.log('[FileManager][native click upload] paths', paths);
      await uploadNativePaths(paths || []);
    } catch (err) {
      if (err) addToast(`${t('上传失败')}: ${err}`, 'error');
    }
  };

  const handleUploadFolder = useCallback(async () => {
    if (!isCompressedTransferEnabled()) {
      uploadFolderInputRef.current?.click();
      return;
    }
    try {
      const dirPath = await AppGo.SelectUploadDirectory();
      console.log('[FileManager][native click upload folder] path', dirPath);
      if (!dirPath) {
        return;
      }

      await uploadNativePaths([dirPath]);
    } catch (err) {
      if (err) addToast(`${t('上传失败')}: ${err}`, 'error');
    }
  }, [uploadNativePaths, addToast, t]);

  // Download file via Wails native file dialog
  const handleCopyPath = (item) => {
    let fullPath = joinPath(currentPath, item.name);
    if (item.isDirectory && !fullPath.endsWith('/')) fullPath += '/';
    navigator.clipboard?.writeText(fullPath).then(() => {
      addToast(`${t('已复制')}: ${fullPath}`, 'success');
    }).catch(() => {
      addToast(t('复制失败'), 'error');
    });
  };

  const handleDownload = useCallback(async (item) => {
    const remotePath = joinPath(currentPath, item.name);
    const defaultDownloadDir = getDefaultDownloadDir();
    const askDownloadEveryTime = localStorage.getItem('fileManagerAskDownloadEveryTime') === 'true';
    const resolveDownloadPath = window?.go?.main?.App?.ResolveDownloadPath;
    const resolveDownloadLocalPath = window?.go?.main?.App?.ResolveDownloadLocalPath;
    const selectDownloadFilePath = window?.go?.main?.App?.SelectDownloadFilePath;
    const selectDownloadDirectory = window?.go?.main?.App?.SelectDownloadDirectory;
    const downloadFileToLocal = window?.go?.main?.App?.DownloadFileToLocal;
    const downloadDirectoryToLocal = window?.go?.main?.App?.DownloadDirectoryToLocal;
    const downloadDirectoryCompressed = window?.go?.main?.App?.DownloadDirectoryCompressed;
    const createdAt = Date.now();
    let queueId = '';

    const patchQueueItem = (id, patch) => {
      if (!id) return;
      updateSessionUploadQueue(sessionGroupId, (current) => current.map((queueItem) => (
        queueItem.id === id
          ? { ...queueItem, ...(typeof patch === 'function' ? patch(queueItem) : patch) }
          : queueItem
      )));
    };

    try {
      const conflictSettings = getDownloadConflictSettings();
      const initialPathOptionsJSON = buildDownloadConflictOptionsPayload(conflictSettings, {
        strategy: conflictSettings.strategy === DOWNLOAD_CONFLICT_STRATEGY_PROMPT
          ? DOWNLOAD_CONFLICT_STRATEGY_FORCE_OVERWRITE
          : conflictSettings.strategy,
        pathStrategies: {},
      });
      let localPath = '';

      if (askDownloadEveryTime) {
        if (item.isDirectory) {
          const selectedDir = await selectDownloadDirectory?.(defaultDownloadDir);
          if (!selectedDir) return;
          const separator = selectedDir.includes('\\') ? '\\' : '/';
          const rawLocalPath = `${selectedDir}${selectedDir.endsWith('\\') || selectedDir.endsWith('/') ? '' : separator}${item.name}`;
          localPath = typeof resolveDownloadLocalPath === 'function'
            ? await resolveDownloadLocalPath(rawLocalPath, true, initialPathOptionsJSON)
            : rawLocalPath;
        } else {
          const selectedFilePath = await selectDownloadFilePath?.(remotePath, defaultDownloadDir);
          if (!selectedFilePath) return;
          localPath = typeof resolveDownloadLocalPath === 'function'
            ? await resolveDownloadLocalPath(selectedFilePath, false, initialPathOptionsJSON)
            : selectedFilePath;
        }
      } else {
        if (typeof resolveDownloadPath !== 'function') {
          throw new Error(item.isDirectory ? t('当前环境不支持下载文件夹') : t('下载失败'));
        }
        localPath = await resolveDownloadPath(remotePath, defaultDownloadDir, item.isDirectory, initialPathOptionsJSON);
      }

      if (!localPath) return;

      let optionsJSON = buildDownloadConflictOptionsPayload(conflictSettings, { pathStrategies: {} });
      if (conflictSettings.strategy === DOWNLOAD_CONFLICT_STRATEGY_PROMPT) {
        const resolvedConflict = await resolvePromptDownloadConflict(item, remotePath, localPath, {
          ...conflictSettings,
          pathStrategies: {},
        });
        if (!resolvedConflict) return;
        localPath = resolvedConflict.localPath;
        optionsJSON = resolvedConflict.optionsJSON;
      }

      if (!item.isDirectory) {
        queueId = `download-file-${createdAt}`;
        setUploadPanelOpen(true);
        updateSessionUploadQueue(sessionGroupId, (current) => [{
          id: queueId,
          name: item.name,
          relativePath: item.name,
          remotePath,
          localPath,
          direction: 'download',
          mode: 'download-file',
          status: 'queued',
          progress: 0,
          bytesUploaded: 0,
          bytesTotal: item.size || 0,
          phase: '',
          phaseProgress: 0,
          phaseCurrent: '',
          phaseDetail: '',
          error: '',
          sourceTerminalId: sessionId,
          createdAt,
          updatedAt: createdAt,
        }, ...current]);
        patchQueueItem(queueId, { status: 'uploading', updatedAt: Date.now() });
        if (typeof downloadFileToLocal !== 'function') {
          throw new Error(t('下载失败'));
        }
        await downloadFileToLocal(sessionId, queueId, remotePath, localPath, optionsJSON);
        patchQueueItem(queueId, {
          status: 'completed',
          progress: 100,
          bytesUploaded: item.size || 0,
          bytesTotal: item.size || 0,
          error: '',
          updatedAt: Date.now(),
        });
        addToast(`${t('下载成功')}: ${item.name}`, 'success');
        return;
      }

      const compressedEnabled = isCompressedTransferEnabled();
      queueId = `${compressedEnabled ? 'download-dir-compressed' : 'download-dir'}-${createdAt}`;
      setUploadPanelOpen(true);
      updateSessionUploadQueue(sessionGroupId, (current) => [{
        id: queueId,
        name: item.name,
        relativePath: item.name,
        remotePath,
        localPath,
        direction: 'download',
        mode: compressedEnabled ? 'download-compressed' : 'download-directory',
        status: 'queued',
        progress: 0,
        bytesUploaded: 0,
        bytesTotal: 0,
        phase: compressedEnabled ? 'preparing' : '',
        phaseProgress: 0,
        phaseCurrent: '',
        phaseDetail: compressedEnabled ? t('准备下载') : '',
        error: '',
        sourceTerminalId: sessionId,
        createdAt,
        updatedAt: createdAt,
      }, ...current]);
      patchQueueItem(queueId, { status: 'uploading', updatedAt: Date.now() });
      if (compressedEnabled) {
        if (typeof downloadDirectoryCompressed !== 'function') {
          throw new Error(t('当前环境不支持下载文件夹'));
        }
        await downloadDirectoryCompressed(sessionId, queueId, remotePath, localPath, optionsJSON);
      } else {
        if (typeof downloadDirectoryToLocal !== 'function') {
          throw new Error(t('当前环境不支持下载文件夹'));
        }
        await downloadDirectoryToLocal(sessionId, queueId, remotePath, localPath, optionsJSON);
      }
      patchQueueItem(queueId, {
        status: 'completed',
        phase: 'completed',
        progress: 100,
        error: '',
        updatedAt: Date.now(),
      });
      addToast(`${t('下载成功')}: ${item.name}`, 'success');
    } catch (err) {
      const isAborted = abortedUploadIdsRef.current.has(queueId) || String(err).toLowerCase().includes('context canceled');
      patchQueueItem(queueId, {
        status: 'failed',
        phase: 'failed',
        phaseDetail: isAborted ? t('已终止') : String(err),
        error: isAborted ? t('已终止') : String(err),
        updatedAt: Date.now(),
      });
      if (!isAborted && err) addToast(`${t('下载失败')}: ${err}`, 'error');
    }
  }, [sessionId, sessionGroupId, currentPath, addToast, t, getDefaultDownloadDir, getDownloadConflictSettings, resolvePromptDownloadConflict, setUploadPanelOpen]);

  // Open file editor
  const handleEdit = async (item) => {
    const remotePath = joinPath(currentPath, item.name);

    // 文件大小检查，避免加载过大文件导致卡顿
    if (item.size && item.size > MAX_EDIT_SIZE) {
      addToast(`${t('文件过大')} (${(item.size / 1024 / 1024).toFixed(1)}MB)，${t('最大支持 5MB 编辑')}`, 'error');
      return;
    }

    // 如果文件已在打开列表中，直接激活
    if (openEditFiles.some(f => f.path === remotePath)) {
      setActiveEditPath(null);
      setTimeout(() => setActiveEditPath(remotePath), 0);
      return;
    }

    try {
      const content = await AppGo.ReadFile(sessionId, remotePath);
      const newFile = { path: remotePath, name: item.name, content };
      setOpenEditFiles(prev => [...prev, newFile]);
      setActiveEditPath(remotePath);
    } catch (err) {
      addToast(`${t('无法打开文件')}: ${err}`, 'error');
    }
  };

  // Save file from editor
  const handleSaveFile = async (path, content) => {
    try {
      await AppGo.WriteFile(sessionId, path, content);
      addToast(t('文件保存成功'), 'success');
      // 更新 openEditFiles 中对应文件的内容
      setOpenEditFiles(prev => prev.map(f => f.path === path ? { ...f, content } : f));
      // 只有弹窗模式才在保存后自动关闭编辑器，popup/split 保持打开
      if (editorMode === 'modal') {
        closeEditFile(path);
      }
    } catch (err) {
      addToast(`${t('保存失败')}: ${err}`, 'error');
    }
  };

  // 关闭单个文件
  const closeEditFile = (path) => {
    const prev = openEditFilesRef.current;
    const next = prev.filter(f => f.path !== path);
    setOpenEditFiles(next);
    // 如果关闭的是当前激活文件，激活下一个
    if (activeEditPath === path) {
      const idx = prev.findIndex(f => f.path === path);
      const nextActive = next[idx] || next[idx - 1] || next[0] || null;
      setActiveEditPath(nextActive?.path || null);
    }
  };

  // 关闭所有文件
  const closeAllEditFiles = () => {
    setOpenEditFiles([]);
    setActiveEditPath(null);
  };

  // 激活文件
  const activateEditFile = (path) => {
    setActiveEditPath(path);
  };

  const handleEditorModeChange = (mode) => {
    setEditorMode(mode);
    localStorage.setItem('fileEditorMode', mode);
  };

  const handleEditorSplitPositionChange = (pos) => {
    setEditorSplitPosition(pos);
    localStorage.setItem('editorSplitPosition', pos);
  };

  // Delete
  const handleDelete = async (item) => {
    const remotePath = joinPath(currentPath, item.name);
    const needConfirm = localStorage.getItem('skipFileDeleteConfirm') !== 'true';
    if (needConfirm && !(await window.luminDialog?.confirm(`${t('确定删除')}${item.name}？${t('此操作不可撤销')}`))) return;
    try {
      await AppGo.DeleteItem(sessionId, remotePath, item.isDirectory);
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('删除失败')}: ${err}`, 'error');
    }
  };

  // Delete via rm -rf
  const handleDeleteShell = async (item) => {
    const remotePath = joinPath(currentPath, item.name);
    const needConfirm = localStorage.getItem('skipFileDeleteConfirm') !== 'true';
    if (needConfirm && !(await window.luminDialog?.confirm(`${t('确定删除')}${item.name}？(rm -rf) ${t('此操作不可撤销')}`))) return;
    try {
      await AppGo.DeleteItemShell(sessionId, remotePath);
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('删除失败')}: ${err}`, 'error');
    }
  };

  // Create directory
  const handleMkdir = async () => {
    const name = await window.luminDialog?.prompt(t('新文件夹名称:'));
    if (!name) return;
    const remotePath = joinPath(currentPath, name);
    try {
      await AppGo.Mkdir(sessionId, remotePath);
      addToast(`${t('文件夹创建成功')}: ${name}`, 'success');
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('创建失败')}: ${err}`, 'error');
    }
  };

  // Create file
  const handleNewFile = async () => {
    const name = await window.luminDialog?.prompt(t('新文件名称:'));
    if (!name) return;
    const remotePath = joinPath(currentPath, name);
    try {
      await AppGo.WriteFile(sessionId, remotePath, '');
      addToast(`${t('文件创建成功')}: ${name}`, 'success');
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('创建失败')}: ${err}`, 'error');
    }
  };

  // Compress
  const handleCompress = async (item) => {
    const remotePath = joinPath(currentPath, item.name);
    try {
      setLoading(true);
      addToast(`${t('正在压缩')} ${item.name}...`, 'info');
      await AppGo.CompressItem(sessionId, remotePath);
      addToast(t('压缩成功'), 'success');
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('压缩失败')}: ${err}`, 'error');
      setLoading(false);
    }
  };

  // Uncompress
  const handleUncompress = async (item) => {
    const remotePath = joinPath(currentPath, item.name);
    try {
      setLoading(true);
      addToast(`${t('正在解压')} ${item.name}...`, 'info');
      await AppGo.UncompressItem(sessionId, remotePath);
      addToast(t('解压成功'), 'success');
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('解压失败')}: ${err}`, 'error');
      setLoading(false);
    }
  };

  // Rename
  const startRename = (item) => {
    setRenamingItem(item);
    setRenameValue(item.name);
  };

  const confirmRename = async () => {
    if (!renamingItem || !renameValue.trim() || renameValue === renamingItem.name) {
      setRenamingItem(null);
      return;
    }
    const oldPath = joinPath(currentPath, renamingItem.name);
    const newPath = joinPath(currentPath, renameValue);
    try {
      await AppGo.RenameItem(sessionId, oldPath, newPath);
      addToast(t('重命名成功'), 'success');
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('重命名失败')}: ${err}`, 'error');
    } finally {
      setRenamingItem(null);
    }
  };

  const closeContextMenu = () => setContextMenu(null);

  // Chmod
  const handleChmod = async (item) => {
    const itemPath = joinPath(currentPath, item.name);
    let rememberedMode = '';
    let rememberedIncludeSubdirectories = false;
    try {
      const settings = await AppGo.GetChmodDialogSettings();
      rememberedMode = normalizeChmodMode(settings?.mode);
      rememberedIncludeSubdirectories = settings?.includeSubdirectories === true;
    } catch (_) {}
    setChmodTarget({
      item,
      path: itemPath,
      mode: rememberedMode || normalizeChmodMode(item.mode),
      includeSubdirectories: rememberedIncludeSubdirectories,
      showIncludeSubdirectories: item.isDirectory,
    });
  };

  const handleChmodSave = async (modeStr, includeSubdirectories) => {
    if (!chmodTarget) return;
    const normalizedMode = normalizeChmodMode(modeStr) || '644';
    const rememberedIncludeSubdirectories = Boolean(includeSubdirectories);
    const recursive = Boolean(chmodTarget.showIncludeSubdirectories && rememberedIncludeSubdirectories);
    try {
      try {
        await AppGo.SaveChmodDialogSettings(normalizedMode, rememberedIncludeSubdirectories);
      } catch (saveErr) {
        console.warn('SaveChmodDialogSettings failed:', saveErr);
      }
      await AppGo.ChmodFile(sessionId, chmodTarget.path, normalizedMode, recursive);
      addToast(t('权限修改成功'), 'success');
      setChmodTarget(null);
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('权限修改失败')}: ${err}`, 'error');
    }
  };

  useEffect(() => {
    if (!isActive) return undefined;
    console.log('[FileManager][native drop upload] register', {
      canResolveFilePaths: CanResolveFilePaths?.(),
      flags: window.wails?.flags,
    });
    OnFileDrop((x, y, paths) => {
      const rect = fileManagerRootRef.current?.getBoundingClientRect?.();
      const compressedEnabled = isCompressedTransferEnabled();
      const hit = !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      console.log('[FileManager][native drop upload] callback', {
        x,
        y,
        paths,
        compressedEnabled,
        hit,
        rect: rect ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        } : null,
      });
      if (!rect || !hit || !compressedEnabled) return;
      nativeDropHandledUntilRef.current = Date.now() + 5000;
      setIsDragOver(false);
      dragCounterRef.current = 0;
      void uploadNativePaths(paths || []);
    }, true);
    return () => OnFileDropOff();
  }, [isActive, uploadNativePaths]);

  // ── 拖拽上传 ────────────────────────────────────────────────

  const handleDragEnter = (e) => {
    e.preventDefault();
    if (!isCompressedTransferEnabled()) {
      e.stopPropagation();
    }
    dragCounterRef.current++;
    setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!isCompressedTransferEnabled()) {
      e.stopPropagation();
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (!isCompressedTransferEnabled()) {
      e.stopPropagation();
    }
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    if (!isCompressedTransferEnabled()) {
      e.stopPropagation();
    }
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const droppedItems = Array.from(e.dataTransfer.items || []);
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    console.log('[FileManager][drop upload] dataTransfer', {
      types: Array.from(e.dataTransfer.types || []),
      items: droppedItems.map(debugUploadItemInfo),
      files: droppedFiles.map(debugUploadFileInfo),
      rawItems: droppedItems,
      rawFiles: droppedFiles,
    });
    if (droppedItems.length === 0 && droppedFiles.length === 0) return;

    const entryMap = new Map();
    const addEntry = (file, relativePath) => {
      if (!file || isHiddenFile(file.name)) return;
      const normalizedPath = String(relativePath || file.webkitRelativePath || file.name)
        .replace(/^\/+/, '')
        .replace(/\\/g, '/');
      if (!normalizedPath) return;
      const key = `${normalizedPath}|${file.size}|${file.lastModified}`;
      if (!entryMap.has(key)) {
        entryMap.set(key, { file, relativePath: normalizedPath });
      }
    };

    for (const item of droppedItems) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) {
        const files = await traverseEntry(entry);
        files.forEach((file) => addEntry(file, file._fullPath || file.webkitRelativePath || file.name));
        continue;
      }
      let file;
      try { file = item.getAsFile(); } catch (_) { file = null; }
      if (file) addEntry(file, file.webkitRelativePath || file.name);
    }

    droppedFiles.forEach((file) => addEntry(file, file.webkitRelativePath || file.name));

    console.log('[FileManager][drop upload] normalized entries', Array.from(entryMap.values()).map((entry) => ({
      relativePath: entry.relativePath,
      file: debugUploadFileInfo(entry.file),
    })));
    if (isCompressedTransferEnabled()) {
      console.log('[FileManager][drop upload] compressed transfer enabled, waiting for native drop handoff');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (Date.now() < nativeDropHandledUntilRef.current) {
        console.log('[FileManager][drop upload] native drop handled, skip browser File/Blob fallback');
        return;
      }
      console.warn('[FileManager][drop upload] native drop did not handle in time, fallback to browser File/Blob upload');
    }
    await uploadEntries(Array.from(entryMap.values()));
  };

  const uploadPanelTarget = isActive && workbenchState.uploadOpen
    ? (
      workbenchState.editorSplitOpen
        ? document.getElementById(`workbench-upload-panel-${sessionGroupId}`)
        : document.getElementById('editor-split-host')
    )
    : null;

  return (
    <div
      ref={fileManagerRootRef}
      className="file-manager"
      style={{ position: 'relative', '--wails-drop-target': 'drop' }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ pos: { x: e.clientX, y: e.clientY }, item: null });
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { void handleSelectedFiles(e); }}
      />
      <input
        ref={uploadFolderInputRef}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        style={{ display: 'none' }}
        onChange={(e) => { void handleSelectedFiles(e); }}
      />
      {/* Toolbar */}
      <div className="file-toolbar">
        {/* Editable path input */}
        <input
          className="path-input"
          type="text"
          value={editingPath !== null ? editingPath : currentPath}
          onChange={(e) => setEditingPath(e.target.value)}
          onFocus={() => setEditingPath(currentPath)}
          onBlur={() => {
            if (editingPath !== null) {
              const p = editingPath.trim();
              if (p && p !== currentPath) loadDir(p.startsWith('/') ? p : '/' + p);
              setEditingPath(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.target.blur();
            } else if (e.key === 'Escape') {
              setEditingPath(null);
              e.target.blur();
            }
          }}
          style={{ flex: 1, minWidth: 0 }}
        />

        <div className="file-toolbar-actions">
          <Tiptop text={t('新建文件')} placement="bottom">
            <button
              className="btn file-toolbar-outline-btn"
              aria-label={t('新建文件')}
              onClick={handleNewFile}
            >
              <FilePlus size={14} />
            </button>
          </Tiptop>
          <Tiptop text={t('新建文件夹')} placement="bottom">
            <button
              className="btn file-toolbar-outline-btn"
              aria-label={t('新建文件夹')}
              onClick={handleMkdir}
            >
              <FolderPlus size={14} />
            </button>
          </Tiptop>
          <Tiptop text={t('上传文件或右键上传文件夹')} placement="bottom">
            <button
              className="btn file-toolbar-outline-btn"
              aria-label={t('上传文件或右键上传文件夹')}
              onClick={handleUpload}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleUploadFolder();
              }}
            >
              <Upload size={14} />
            </button>
          </Tiptop>
          <Tiptop text={t('传输队列')} placement="bottom">
            <button
              className={`btn btn-ghost btn-sm btn-icon${workbenchState.uploadOpen ? ' active' : ''}`}
              aria-label={t('传输队列')}
              onClick={toggleUploadPanel}
              style={{ position: 'relative' }}
            >
              <ClipboardList size={14} />
              {activeUploadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    minWidth: 15,
                    height: 15,
                    padding: '0 4px',
                    borderRadius: 999,
                    background: 'var(--accent)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: '15px',
                    textAlign: 'center',
                  }}
                >
                  {activeUploadCount > 99 ? '99+' : activeUploadCount}
                </span>
              )}
            </button>
          </Tiptop>
          {currentPath !== '/' && (
            <Tiptop text={tKey('返回上级')} placement="bottom">
              <button
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={tKey('返回上级')}
                onClick={() => {
                  const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
                  loadDir(parent);
                }}
              >
                <FolderUp size={14} />
              </button>
            </Tiptop>
          )}
          <Tiptop text={t('刷新')} placement="bottom">
            <button
              className="btn btn-ghost btn-sm btn-icon"
              aria-label={t('刷新')}
              onClick={() => loadDir(currentPath)}
            >
              <RefreshCw size={14} />
            </button>
          </Tiptop>
        </div>
      </div>

      {/* Content area: file list + optional split editor */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* File List */}
        <div className="file-list" ref={fileListRef} style={{ flex: 1, minWidth: 0 }}>
          <div className="file-list-header">
            <span onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
              {t('名称')} {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span onClick={() => handleSort('size')} style={{ cursor: 'pointer' }}>
              {t('大小')} {sortField === 'size' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span onClick={() => handleSort('permissions')} style={{ cursor: 'pointer' }}>
              {t('权限')} {sortField === 'permissions' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span onClick={() => handleSort('modified')} style={{ cursor: 'pointer' }}>
              {t('修改时间')} {sortField === 'modified' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span></span>
          </div>

          {/* Back button */}
          {currentPath !== '/' && (
            <div
              className="file-item"
              onClick={() => {
                const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
                loadDir(parent);
              }}
            >
              <div className="file-name-cell">
                <span className="file-icon"><FolderUp size={16} /></span>
                <span className="file-name is-dir">..</span>
              </div>
              <span />
              <span />
              <span />
              <span />
            </div>
          )}

          {loading && (
            <div className="empty-state">
              <div className="spin" style={{ fontSize: 24 }}><RefreshCw size={24} /></div>
              <div className="empty-state-text">{t('加载中...')}</div>
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon"><FolderOpen size={48} strokeWidth={1.5} /></div>
              <div className="empty-state-text">{t('目录为空')}</div>
            </div>
          )}

          {!loading && sortedItems.map((item) => {
            const isRenaming = renamingItem?.name === item.name;

            return (
              <div
                key={item.name}
                className="file-item"
                onDoubleClick={() => item.isDirectory ? navigate(item) : isEditable(item.name) && handleEdit(item)}
                onClick={() => item.isDirectory && navigate(item)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ pos: { x: e.clientX, y: e.clientY }, item });
                }}
              >
                <div className="file-name-cell">
                  <span className="file-icon">{fileIcon(item.name, item.isDirectory)}</span>
                  {isRenaming ? (
                    <input
                      className="rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename();
                        if (e.key === 'Escape') setRenamingItem(null);
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={`file-name ${item.isDirectory ? 'is-dir' : ''}`}>
                      {item.name}
                    </span>
                  )}
                </div>

                <span className="file-size">{item.isDirectory ? '-' : fmtSize(item.size)}</span>
                <span className="file-permission" onClick={(e) => { e.stopPropagation(); void handleChmod(item); }}>{item.permission || '-'}</span>
                <span className="file-date">{fmtDate(item.modifyTime)}</span>

                <div className="file-actions">
                  {!item.isDirectory && isEditable(item.name) && (
                    <Tiptop text={t('编辑')}>
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        aria-label={t('编辑')}
                        onClick={(e) => { e.stopPropagation(); handleEdit(item); }}
                      ><SquarePen size={14} /></button>
                    </Tiptop>
                  )}
                  <Tiptop text={item.isDirectory ? t('下载文件夹到本地') : t('下载到本地')}>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      aria-label={item.isDirectory ? t('下载文件夹到本地') : t('下载到本地')}
                      onClick={(e) => { e.stopPropagation(); handleDownload(item); }}
                    ><Download size={14} /></button>
                  </Tiptop>
                  <Tiptop text={t('重命名')}>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      aria-label={t('重命名')}
                      onClick={(e) => { e.stopPropagation(); startRename(item); }}
                    ><PenLine size={14} /></button>
                  </Tiptop>
                  <Tiptop text={t('删除')}>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      aria-label={t('删除')}
                      style={{ color: 'var(--danger)' }}
                      onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                    ><Trash2 size={14} /></button>
                  </Tiptop>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Context Menu */}
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-text"><Upload size={14} /> {t('释放以上传文件/文件夹')}</div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && createPortal(
        <ContextMenu
          pos={contextMenu.pos}
          item={contextMenu.item}
          t={t}
          onClose={closeContextMenu}
          onCopyPath={() => { handleCopyPath(contextMenu.item); closeContextMenu(); }}
          onDownload={() => { handleDownload(contextMenu.item); closeContextMenu(); }}
          onEdit={() => { handleEdit(contextMenu.item); closeContextMenu(); }}
          onRename={() => { startRename(contextMenu.item); closeContextMenu(); }}
          onChmod={() => { void handleChmod(contextMenu.item); closeContextMenu(); }}
          onDelete={() => { handleDelete(contextMenu.item); closeContextMenu(); }}
          onDeleteShell={() => { handleDeleteShell(contextMenu.item); closeContextMenu(); }}
          onMkdir={() => { handleMkdir(); closeContextMenu(); }}
          onNewFile={() => { handleNewFile(); closeContextMenu(); }}
          onCompress={() => { handleCompress(contextMenu.item); closeContextMenu(); }}
          onUncompress={() => { handleUncompress(contextMenu.item); closeContextMenu(); }}
        />,
        document.body
      )}

      {uploadPanelTarget && createPortal(
        <FileUploadQueuePanel
          items={uploadQueueItems}
          onClose={() => setUploadPanelOpen(false)}
          isAbortable={isUploadAbortable}
          onAbortItem={(item) => { void abortUploadItem(item, t('已终止')); }}
          onAbortItems={(items) => abortUploadItems(items, t('已终止'))}
          onRemoveItems={removeUploadItems}
        />,
        uploadPanelTarget
      )}

      {/* File Editor (modal/popup/split 均由 FileEditor 内部决定渲染方式) */}
      {openEditFiles.length > 0 && (
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>{t('加载中...')}</div>}>
          <FileEditor
            files={openEditFiles}
            activePath={activeEditPath}
            onSave={handleSaveFile}
            onCloseFile={closeEditFile}
            onCloseAll={closeAllEditFiles}
            onActivate={activateEditFile}
            mode={editorMode}
            onModeChange={handleEditorModeChange}
            splitPosition={editorSplitPosition}
            onSplitPositionChange={handleEditorSplitPositionChange}
            isActive={isActive}
            workbenchSessionId={sessionGroupId}
            workbenchOwnerId={sessionId}
          />
        </Suspense>
      )}

      {/* Chmod Dialog */}
      {chmodTarget && (
        <ChmodDialog
          path={chmodTarget.path}
          permission={chmodTarget.item.permission}
          mode={chmodTarget.mode}
          includeSubdirectories={chmodTarget.includeSubdirectories}
          showIncludeSubdirectories={chmodTarget.showIncludeSubdirectories}
          onSave={handleChmodSave}
          onClose={() => setChmodTarget(null)}
          t={t}
        />
      )}
    </div>
  );
}
