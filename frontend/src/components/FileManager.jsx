import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { createPortal } from 'react-dom';
import * as AppGo from '../../wailsjs/go/main/App.js';
const FileEditor = React.lazy(() => import('./FileEditor.jsx'));
import { CanResolveFilePaths, EventsOn, OnFileDrop, OnFileDropOff } from '../../wailsjs/runtime/runtime.js';
import { useTranslation, t as tKey, getLanguage } from '../i18n.js';
import { Z } from '../constants/zIndex.js';
import { clampMenuPosition } from '../utils/menuPosition.js';
import FileUploadQueuePanel from './FileUploadQueuePanel.jsx';
import Tiptop from './Tiptop.jsx';
import {
  getSessionCachedFileManagerPathItems,
  getSessionFileManagerWorkspace,
  getSessionUploadQueue,
  getSessionWorkbenchState,
  setSessionCachedFileManagerPathItems,
  setSessionFileManagerWorkspace,
  setSessionWorkbenchState,
  subscribeSessionFileManagerWorkspace,
  subscribeSessionUploadQueue,
  subscribeSessionWorkbenchState,
  updateSessionUploadQueue,
} from '../utils/fileWorkbench.js';
import {
  Folder, FolderOpen, FolderPlus, File, FileText, FilePlus, FileCode,
  FileArchive, Settings, ClipboardList, Wrench, Image, Code, Globe, House,
  Palette, Database, Terminal, Film, Music, Archive, HardDrive, BookOpen,
  Pencil, PenLine, Download, Upload, Trash2, RefreshCw, Lock, FolderUp, SquarePen, Copy,
  Pin, X, ClipboardPaste, Plus, ChevronLeft, ChevronRight,
} from 'lucide-react';

// 格式化文件大小
const FILE_LIST_ACTIONS_COLUMN_WIDTH = 110;
const FILE_LIST_NAME_MIN_WIDTH = 120;
const FILE_LIST_SIZE_MIN_WIDTH = 60;
const FILE_LIST_PERMISSION_MIN_WIDTH = 120;
const FILE_LIST_MODIFIED_MIN_WIDTH = 110;
const FILE_LIST_SIZE_MAX_WIDTH = 160;
const FILE_LIST_PERMISSION_MAX_WIDTH = 420;
const FILE_LIST_MODIFIED_MAX_WIDTH = 210;

const fileListMeasureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function measureFileListTextWidth(text, font) {
  if (!fileListMeasureCanvas) {
    return String(text || '').length * 8;
  }
  const ctx = fileListMeasureCanvas.getContext('2d');
  if (!ctx) {
    return String(text || '').length * 8;
  }
  ctx.font = font;
  return ctx.measureText(String(text || '')).width;
}

function clampFileListColumnWidth(width, min, max) {
  return Math.max(min, Math.min(max, Math.ceil(width)));
}

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
const UPLOAD_PANEL_CLOSE_ANIMATION_MS = 100;
const FILE_LIST_SWITCH_ANIMATION_MS = 420;
const FILE_MANAGER_NEW_TAB_PATH_MODE_INHERIT_CURRENT = 'inherit_current';
const FILE_MANAGER_NEW_TAB_PATH_MODE_ROOT = 'root';
const FILE_MANAGER_NEW_TAB_PATH_MODE_SESSION_INITIAL_PATH = 'session_initial_path';
const FILE_MANAGER_NEW_TAB_PATH_MODE_TERMINAL_CWD = 'terminal_cwd';
const FILE_MANAGER_SYSTEM_TAB_KIND_HOME = 'home';
const FILE_MANAGER_SYSTEM_TAB_KIND_CWD = 'cwd';

function getFileManagerSystemTabType(tab) {
  if (String(tab?.systemPinnedType || '').trim() === FILE_MANAGER_SYSTEM_TAB_KIND_CWD) {
    return '';
  }
  if (tab?.systemPinned === true) {
    return FILE_MANAGER_SYSTEM_TAB_KIND_HOME;
  }
  return '';
}

function areFileManagerTabStatesEqual(left, right) {
  if (!left || !right) {
    return false;
  }
  const leftSelectedPaths = Array.isArray(left.selectedPaths) ? left.selectedPaths : [];
  const rightSelectedPaths = Array.isArray(right.selectedPaths) ? right.selectedPaths : [];
  return String(left.id || '').trim() === String(right.id || '').trim()
    && String(left.path || '').trim() === String(right.path || '').trim()
    && String(left.customTitle || '').trim() === String(right.customTitle || '').trim()
    && String(left.sortField || '').trim() === String(right.sortField || '').trim()
    && String(left.sortDir || '').trim() === String(right.sortDir || '').trim()
    && leftSelectedPaths.length === rightSelectedPaths.length
    && leftSelectedPaths.every((path, index) => path === rightSelectedPaths[index])
    && Number.isFinite(Number(left.scrollTop)) === Number.isFinite(Number(right.scrollTop))
    && Number(left.scrollTop || 0) === Number(right.scrollTop || 0)
    && (left.pinned === true) === (right.pinned === true)
    && (left.systemPinned === true) === (right.systemPinned === true)
    && getFileManagerSystemTabType(left) === getFileManagerSystemTabType(right);
}

function createLocalItemShell(name, isDirectory, sourceItem = {}) {
  const normalizedName = String(name || '').trim();
  return {
    name: normalizedName,
    isDirectory: Boolean(isDirectory),
    size: Boolean(isDirectory) ? 0 : Number(sourceItem?.size || 0),
    permission: String(sourceItem?.permission || '').trim(),
    mode: String(sourceItem?.mode || '').trim(),
    modifyTime: sourceItem?.modifyTime || Date.now(),
    uid: String(sourceItem?.uid || '-').trim() || '-',
    gid: String(sourceItem?.gid || '-').trim() || '-',
  };
}

function upsertLocalItem(items, nextItem) {
  const currentItems = Array.isArray(items) ? items : [];
  const normalizedName = String(nextItem?.name || '').trim();
  if (!normalizedName) {
    return currentItems;
  }
  const filteredItems = currentItems.filter((item) => String(item?.name || '').trim() !== normalizedName);
  return [...filteredItems, { ...nextItem, name: normalizedName }];
}

let fileManagerTabSequence = 0;

function getFileManagerNewTabPathMode() {
  return localStorage.getItem('fileManagerNewTabPathMode') || FILE_MANAGER_NEW_TAB_PATH_MODE_INHERIT_CURRENT;
}

function getFileManagerInitialPathMode() {
  return localStorage.getItem('fileManagerInitialPathMode') || FILE_MANAGER_NEW_TAB_PATH_MODE_SESSION_INITIAL_PATH;
}

function shouldShowFileManagerTabIcons() {
  return localStorage.getItem('fileManagerShowTabIcons') !== 'false';
}

function shouldHideFileManagerTabCloseButton() {
  return localStorage.getItem('fileManagerHideTabCloseButton') === 'true';
}

function createFileManagerTab(path = '', options = {}) {
  fileManagerTabSequence += 1;
  return {
    id: `file-manager-tab-${Date.now()}-${fileManagerTabSequence}`,
    path: String(path || '').trim(),
    customTitle: String(options.customTitle || '').trim(),
    sortField: 'name',
    sortDir: 'asc',
    selectedPaths: [],
    scrollTop: 0,
    pinned: options.pinned === true || options.systemPinned === true,
    systemPinned: options.systemPinned === true,
    systemPinnedType: options.systemPinned === true ? FILE_MANAGER_SYSTEM_TAB_KIND_HOME : '',
  };
}

function getFileManagerTabLabel(path, t, customTitle = '') {
  const normalizedCustomTitle = String(customTitle || '').trim();
  if (normalizedCustomTitle) {
    return normalizedCustomTitle;
  }
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath || normalizedPath === '/') {
    return t('目录根');
  }
  const parts = normalizedPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || t('目录根');
}

function renderFileManagerTabTitle(tab, t) {
  const systemTabType = getFileManagerSystemTabType(tab);
  if (systemTabType === FILE_MANAGER_SYSTEM_TAB_KIND_HOME) {
    return <House size={12} />;
  }
  return <span>{getFileManagerTabLabel(tab?.path, t, tab?.customTitle)}</span>;
}

function cloneFileManagerItemsForCache(items) {
  return Array.isArray(items)
    ? items
      .filter((item) => item && typeof item === 'object' && !item.__luminDeletedPlaceholder)
      .map((item) => ({ ...item }))
    : [];
}

function getParentPath(path) {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  const parts = normalizedPath.split('/').filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `/${parts.join('/')}` : '/';
}

function buildDirectoryItemFromPath(path) {
  const normalizedPath = String(path || '').trim();
  const safePath = !normalizedPath ? '/' : normalizedPath;
  if (safePath === '/') {
    return {
      name: '',
      isDirectory: true,
      permission: '',
      mode: '',
      modifyTime: 0,
      size: 0,
    };
  }
  const parts = safePath.split('/').filter(Boolean);
  return {
    name: parts[parts.length - 1] || '',
    isDirectory: true,
    permission: '',
    mode: '',
    modifyTime: 0,
    size: 0,
  };
}

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

function shouldAutoOpenTransferQueue() {
  return localStorage.getItem('fileManagerAutoOpenTransferQueue') !== 'false';
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

const CHMOD_OWNER_PRESET_OPTIONS = [
  { id: '0', name: 'root' },
  { id: '26', name: 'postgres' },
  { id: '27', name: 'mysql' },
  { id: '33', name: 'www-data' },
  { id: '101', name: 'nginx' },
  { id: '999', name: 'redis' },
  { id: '1000', name: 'ubuntu' },
  { id: '65534', name: 'nobody' },
];

const CHMOD_GROUP_PRESET_OPTIONS = [
  { id: '0', name: 'root' },
  { id: '4', name: 'adm' },
  { id: '10', name: 'wheel' },
  { id: '27', name: 'sudo' },
  { id: '33', name: 'www-data' },
  { id: '101', name: 'nginx' },
  { id: '999', name: 'redis' },
  { id: '1000', name: 'users' },
  { id: '65534', name: 'nogroup' },
];

function normalizeIdentityId(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed && trimmed !== '-' ? trimmed : '';
}

function formatIdentityDisplay(name, id) {
  const normalizedId = normalizeIdentityId(id);
  if (!normalizedId) {
    return '-';
  }
  const trimmedName = String(name || '').trim();
  return trimmedName ? `${trimmedName}(${normalizedId})` : normalizedId;
}

function formatPermissionDisplay(permission) {
  return String(permission || '-').trim() || '-';
}

function buildIdentityOptionList(currentId, presets) {
  const normalizedCurrentId = normalizeIdentityId(currentId);
  const presetOptions = Array.isArray(presets) ? presets : [];
  const currentOption = normalizedCurrentId
    ? (presetOptions.find((item) => normalizeIdentityId(item.id) === normalizedCurrentId) || { id: normalizedCurrentId, name: '' })
    : null;
  const options = currentOption
    ? [currentOption, ...presetOptions.filter((item) => normalizeIdentityId(item.id) !== normalizedCurrentId)]
    : presetOptions;
  const seen = new Set();
  return options
    .map((item) => {
      const id = normalizeIdentityId(item.id);
      if (!id) {
        return null;
      }
      const name = String(item.name || '').trim();
      const label = formatIdentityDisplay(name, id);
      return {
        id,
        name,
        label,
        searchText: `${name} ${id} ${label}`.toLowerCase(),
      };
    })
    .filter((item) => {
      if (!item || seen.has(item.label)) {
        return false;
      }
      seen.add(item.label);
      return true;
    });
}

function resolveIdentityInputValue(currentId, presets) {
  const normalizedCurrentId = normalizeIdentityId(currentId);
  if (!normalizedCurrentId) {
    return '-';
  }
  const matched = (Array.isArray(presets) ? presets : []).find((item) => normalizeIdentityId(item.id) === normalizedCurrentId);
  return formatIdentityDisplay(matched?.name || '', normalizedCurrentId);
}

function resolveIdentityInputSpec(value, options, fallbackId = '') {
  const trimmed = String(value ?? '').trim();
  const candidates = Array.isArray(options) ? options : [];
  if (!trimmed || trimmed === '-') {
    return normalizeIdentityId(fallbackId);
  }
  const matched = candidates.find((item) => {
    const normalizedId = normalizeIdentityId(item.id);
    const label = formatIdentityDisplay(item.name, normalizedId);
    return trimmed === label || trimmed === String(item.name || '').trim() || trimmed === normalizedId;
  });
  if (matched) {
    return String(matched.name || '').trim() || normalizeIdentityId(matched.id);
  }
  const labelMatch = trimmed.match(/^(.*)\(([^()]+)\)$/);
  if (labelMatch) {
    const name = String(labelMatch[1] || '').trim();
    const id = normalizeIdentityId(labelMatch[2]);
    return name || id || normalizeIdentityId(fallbackId);
  }
  return trimmed;
}

function resolveIdentityCompareKey(value, options, fallbackId = '') {
  const trimmed = String(value ?? '').trim();
  const fallback = normalizeIdentityId(fallbackId);
  const candidates = Array.isArray(options) ? options : [];
  if (!trimmed || trimmed === '-') {
    return fallback ? `id:${fallback}` : '';
  }
  const matched = candidates.find((item) => {
    const normalizedId = normalizeIdentityId(item.id);
    const label = formatIdentityDisplay(item.name, normalizedId);
    return trimmed === label || trimmed === String(item.name || '').trim() || trimmed === normalizedId;
  });
  if (matched) {
    const normalizedId = normalizeIdentityId(matched.id);
    if (normalizedId) {
      return `id:${normalizedId}`;
    }
    const normalizedName = String(matched.name || '').trim().toLowerCase();
    return normalizedName ? `name:${normalizedName}` : '';
  }
  const labelMatch = trimmed.match(/^(.*)\(([^()]+)\)$/);
  if (labelMatch) {
    const name = String(labelMatch[1] || '').trim().toLowerCase();
    const id = normalizeIdentityId(labelMatch[2]);
    if (id) {
      return `id:${id}`;
    }
    return name ? `name:${name}` : '';
  }
  if (/^\d+$/.test(trimmed)) {
    return `id:${trimmed}`;
  }
  return `name:${trimmed.toLowerCase()}`;
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
function ChmodDialog({ path, permission, mode, rememberedMode = '', autoApplyLastSettings = false, uid, gid, ownerCandidates = [], groupCandidates = [], includeSubdirectories = false, showIncludeSubdirectories = false, onSave, onClose, t }) {
  const parsePerms = (permStr) => {
    const p = permStr && permStr.length >= 10 ? permStr.slice(1) : '---------';
    return {
      user: { r: p[0] === 'r', w: p[1] === 'w', x: p[2] === 'x' },
      group: { r: p[3] === 'r', w: p[4] === 'w', x: p[5] === 'x' },
      other: { r: p[6] === 'r', w: p[7] === 'w', x: p[8] === 'x' },
    };
  };

  const currentMode = normalizeChmodMode(mode);
  const lastMode = normalizeChmodMode(rememberedMode);
  const initialMode = autoApplyLastSettings && lastMode ? lastMode : currentMode;
  const fallbackPerms = parsePerms(permission || '');
  const [perms, setPerms] = useState(initialMode ? permsFromChmodMode(initialMode) : fallbackPerms);
  const [octal, setOctal] = useState(initialMode || calcChmodOctal(fallbackPerms));
  const [includeChildren, setIncludeChildren] = useState(autoApplyLastSettings ? Boolean(includeSubdirectories) : false);
  const ownerOptions = useMemo(() => buildIdentityOptionList(uid, ownerCandidates), [uid, ownerCandidates]);
  const groupOptions = useMemo(() => buildIdentityOptionList(gid, groupCandidates), [gid, groupCandidates]);
  const ownerDefaultValue = useMemo(() => resolveIdentityInputValue(uid, ownerCandidates), [uid, ownerCandidates]);
  const groupDefaultValue = useMemo(() => resolveIdentityInputValue(gid, groupCandidates), [gid, groupCandidates]);
  const [ownerInput, setOwnerInput] = useState(ownerDefaultValue);
  const [groupInput, setGroupInput] = useState(groupDefaultValue);
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [groupTouched, setGroupTouched] = useState(false);

  useEffect(() => {
    setOwnerTouched(false);
  }, [path, uid]);

  useEffect(() => {
    setGroupTouched(false);
  }, [path, gid]);

  useEffect(() => {
    if (!ownerTouched) {
      setOwnerInput(ownerDefaultValue);
    }
  }, [ownerDefaultValue, ownerTouched]);

  useEffect(() => {
    if (!groupTouched) {
      setGroupInput(groupDefaultValue);
    }
  }, [groupDefaultValue, groupTouched]);

  const filteredOwnerOptions = useMemo(() => {
    const query = String(ownerInput || '').trim().toLowerCase();
    const candidates = query
      ? ownerOptions.filter((option) => option.searchText.includes(query))
      : ownerOptions;
    return candidates.slice(0, 80);
  }, [ownerInput, ownerOptions]);

  const filteredGroupOptions = useMemo(() => {
    const query = String(groupInput || '').trim().toLowerCase();
    const candidates = query
      ? groupOptions.filter((option) => option.searchText.includes(query))
      : groupOptions;
    return candidates.slice(0, 80);
  }, [groupInput, groupOptions]);

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

  const canApplyLastSettings = Boolean(lastMode);
  const handleApplyLastSettings = () => {
    if (!lastMode) {
      return;
    }
    setOctal(lastMode);
    setPerms(permsFromChmodMode(lastMode));
    setIncludeChildren(Boolean(includeSubdirectories));
  };

  if (typeof document === 'undefined') {
    return null;
  }
  return createPortal(
    <div className="modal-overlay" style={{ zIndex: Z.MODAL }}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <div className="modal-title"><Lock size={14} /> {t('修改权限')}</div>
        </div>
        <div className="modal-body">
          <div className="chmod-dialog-body">
            <div className="chmod-dialog-path">{path}</div>
            <div style={{ display: 'grid', gap: 10, marginTop: 12, marginBottom: 12 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('属主')}</span>
                <input
                  className="input"
                  list="chmod-owner-options"
                  value={ownerInput}
                  onChange={(e) => {
                    setOwnerTouched(true);
                    setOwnerInput(e.target.value);
                  }}
                  placeholder={t('搜索或输入属主...')}
                />
              </div>
              <datalist id="chmod-owner-options">
                {filteredOwnerOptions.map((option) => (
                  <option key={option.label} value={option.label} />
                ))}
              </datalist>
              <div style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('属组')}</span>
                <input
                  className="input"
                  list="chmod-group-options"
                  value={groupInput}
                  onChange={(e) => {
                    setGroupTouched(true);
                    setGroupInput(e.target.value);
                  }}
                  placeholder={t('搜索或输入属组...')}
                />
              </div>
              <datalist id="chmod-group-options">
                {filteredGroupOptions.map((option) => (
                  <option key={option.label} value={option.label} />
                ))}
              </datalist>
            </div>
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
              <button className="btn btn-ghost btn-sm" type="button" onClick={handleApplyLastSettings} disabled={!canApplyLastSettings}>
                {t('应用上次')}
              </button>
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
          <button className="btn btn-primary" onClick={() => onSave(octal.length === 3 ? octal : calcChmodOctal(perms), includeChildren, ownerInput, groupInput)}>{t('确定')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Context menu component
function ContextMenu({ pos, item, mode = 'item', isPinned = false, isSystemPinned = false, canTogglePinned = false, canCloseTab = false, showCreateActions = false, deleteItemCount = 1, onClose, onDownload, onEdit, onRename, onDelete, onDeleteShell, onMkdir, onNewFile, onCompress, onUncompress, onChmod, onCopyPath, onOpenInNewTab, onTogglePinned, onCloseTab, t }) {
  const ref = useRef(null);
  const [adjusted, setAdjusted] = useState({ left: pos.x, top: pos.y });
  const isTabMenu = mode === 'tab';
  const shouldShowCreateActions = showCreateActions || !item;
  const shouldShowDividerBeforeCreate = Boolean(item && shouldShowCreateActions);
  const shouldShowDeleteActions = Boolean(item) && !isTabMenu;
  const shouldShowDividerBeforeDelete = shouldShowDeleteActions;

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
      style={{ left: adjusted.left, top: adjusted.top, zIndex: Z.MENU }}
    >
      {item && item.isDirectory && (
        <div className="context-menu-item" onClick={onOpenInNewTab}>
          <FolderOpen size={14} /> {t('在新标签页打开')}
        </div>
      )}
      {isTabMenu && canTogglePinned && !isSystemPinned && (
        <div className="context-menu-item" onClick={onTogglePinned}>
          <Pin size={14} /> {isPinned ? t('取消固定') : t('固定')}
        </div>
      )}
      {canCloseTab && (
        <div className="context-menu-item" onClick={onCloseTab}>
          <X size={14} /> {t('关闭标签')}
        </div>
      )}
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
      {item && (!isTabMenu || !isSystemPinned) && (
        <div className="context-menu-item" onClick={onRename}>
          <PenLine size={14} /> {isTabMenu ? t('重命名标签标题') : t('重命名')}
        </div>
      )}
      {item && (
        <div className="context-menu-item" onClick={onChmod}>
          <Lock size={14} /> {t('修改权限')}
        </div>
      )}
      {shouldShowDividerBeforeCreate && <div className="context-menu-divider" />}
      {shouldShowCreateActions && (
        <div className="context-menu-item" onClick={onNewFile}>
          <FilePlus size={14} /> {t('新建文件')}
        </div>
      )}
      {shouldShowCreateActions && (
        <div className="context-menu-item" onClick={onMkdir}>
          <FolderPlus size={14} /> {t('新建文件夹')}
        </div>
      )}
      {shouldShowDividerBeforeDelete && <div className="context-menu-divider" />}
      {shouldShowDeleteActions && (
        <div className="context-menu-item danger" onClick={onDelete}>
          <Trash2 size={14} /> {t('删除')}{deleteItemCount > 1 ? ` (${deleteItemCount}${t('项')})` : ''}
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
    const normalizedSlashes = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/');
    const parts = [];
    normalizedSlashes.split('/').forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') {
        if (parts.length > 0) parts.pop();
        return;
      }
      parts.push(part);
    });
    return parts.length > 0 ? `/${parts.join('/')}` : '/';
  }, []);
  const [fileManagerWorkspace, setFileManagerWorkspaceState] = useState(() => getSessionFileManagerWorkspace(sessionId));
  const fileManagerWorkspaceRef = useRef(fileManagerWorkspace);
  const [currentPath, setCurrentPath] = useState('/');
  const currentPathRef = useRef(currentPath);
  const currentPathHydratedRef = useRef(false);
  const initializingPathRef = useRef(true);
  const pendingTerminalCwdRef = useRef('');
  const preserveWorkspacePathRef = useRef(false);
  const isActiveRef = useRef(isActive);
  const pendingTabSelectionRestoreRef = useRef(null);
  const activeFileManagerTab = useMemo(() => {
    const tabs = Array.isArray(fileManagerWorkspace?.tabs) ? fileManagerWorkspace.tabs : [];
    const activeTabId = typeof fileManagerWorkspace?.activeTabId === 'string' ? fileManagerWorkspace.activeTabId : '';
    return tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null;
  }, [fileManagerWorkspace]);
  const activeFileManagerTabIdRef = useRef(activeFileManagerTab?.id || '');
  const displayedTabIdRef = useRef(activeFileManagerTab?.id || '');
  const [cwdSystemTabHighlight, setCwdSystemTabHighlight] = useState({ tabId: '', token: 0 });
  const cwdSystemTabHighlightTimerRef = useRef(0);
  const loadRequestSeqRef = useRef(0);
  const [fileListSwitchStage, setFileListSwitchStage] = useState('idle');
  const [fileListSwitchDirection, setFileListSwitchDirection] = useState('forward');
  const [fileListSwitchGhostHtml, setFileListSwitchGhostHtml] = useState('');
  const fileListSwitchTokenRef = useRef(0);
  const fileListSwitchFrameRef = useRef(0);
  const fileListSwitchStartedAtRef = useRef(0);
  const fileListBodyRef = useRef(null);
  const clearFileListSwitchFrame = useCallback(() => {
    if (!fileListSwitchFrameRef.current) return;
    cancelAnimationFrame(fileListSwitchFrameRef.current);
    fileListSwitchFrameRef.current = 0;
    fileListSwitchStartedAtRef.current = 0;
  }, []);
  const finishFileListSwitchFrame = useCallback((token) => {
    clearFileListSwitchFrame();
    const step = (timestamp) => {
      if (token !== fileListSwitchTokenRef.current) {
        fileListSwitchFrameRef.current = 0;
        fileListSwitchStartedAtRef.current = 0;
        return;
      }
      if (!fileListSwitchStartedAtRef.current) {
        fileListSwitchStartedAtRef.current = timestamp;
      }
      if (timestamp - fileListSwitchStartedAtRef.current >= FILE_LIST_SWITCH_ANIMATION_MS + 24) {
        setFileListSwitchGhostHtml('');
        setFileListSwitchStage('idle');
        fileListSwitchFrameRef.current = 0;
        fileListSwitchStartedAtRef.current = 0;
        return;
      }
      fileListSwitchFrameRef.current = requestAnimationFrame(step);
    };
    fileListSwitchFrameRef.current = requestAnimationFrame(step);
  }, [clearFileListSwitchFrame]);
  const beginFileListSwitch = useCallback((direction = 'forward') => {
    fileListSwitchTokenRef.current += 1;
    const nextToken = fileListSwitchTokenRef.current;
    clearFileListSwitchFrame();
    setFileListSwitchDirection(direction === 'backward' ? 'backward' : 'forward');
    const nextGhostHtml = currentPathHydratedRef.current ? (fileListBodyRef.current?.innerHTML || '') : '';
    if (!nextGhostHtml) {
      setFileListSwitchGhostHtml('');
      setFileListSwitchStage('idle');
      return 0;
    }
    setFileListSwitchGhostHtml(nextGhostHtml);
    setFileListSwitchStage('switch-waiting');
    return nextToken;
  }, [clearFileListSwitchFrame]);
  const cancelFileListSwitch = useCallback((token = 0) => {
    if (token && token !== fileListSwitchTokenRef.current) return;
    clearFileListSwitchFrame();
    setFileListSwitchGhostHtml('');
    setFileListSwitchStage('idle');
  }, [clearFileListSwitchFrame]);
  const commitFileListSwitch = useCallback((token, applyData) => {
    if (typeof applyData !== 'function') return;
    if (!token || token !== fileListSwitchTokenRef.current) {
      clearFileListSwitchFrame();
      setFileListSwitchGhostHtml('');
      applyData();
      setFileListSwitchStage('idle');
      return;
    }
    clearFileListSwitchFrame();
    setFileListSwitchStage('switch-prepare');
    applyData();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (token !== fileListSwitchTokenRef.current) return;
        setFileListSwitchStage('switch-entering');
        finishFileListSwitchFrame(token);
      });
    });
  }, [clearFileListSwitchFrame, finishFileListSwitchFrame]);
  useEffect(() => () => clearFileListSwitchFrame(), [clearFileListSwitchFrame]);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
  useEffect(() => { fileManagerWorkspaceRef.current = fileManagerWorkspace; }, [fileManagerWorkspace]);
  useEffect(() => { activeFileManagerTabIdRef.current = activeFileManagerTab?.id || ''; }, [activeFileManagerTab]);
  useEffect(() => () => {
    if (cwdSystemTabHighlightTimerRef.current) {
      window.clearTimeout(cwdSystemTabHighlightTimerRef.current);
      cwdSystemTabHighlightTimerRef.current = 0;
    }
  }, []);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { setFileManagerWorkspaceState(getSessionFileManagerWorkspace(sessionId)); }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return undefined;
    return subscribeSessionFileManagerWorkspace(sessionId, setFileManagerWorkspaceState);
  }, [sessionId]);
  const [showFileManagerTabIcons, setShowFileManagerTabIcons] = useState(() => shouldShowFileManagerTabIcons());
  const [hideFileManagerTabCloseButton, setHideFileManagerTabCloseButton] = useState(() => shouldHideFileManagerTabCloseButton());
  useEffect(() => {
    const handleChange = (e) => setShowFileManagerTabIcons(e.detail !== false);
    window.addEventListener('file-manager-show-tab-icons-changed', handleChange);
    return () => window.removeEventListener('file-manager-show-tab-icons-changed', handleChange);
  }, []);
  useEffect(() => {
    const handleChange = (e) => setHideFileManagerTabCloseButton(e.detail === true);
    window.addEventListener('file-manager-hide-tab-close-button-changed', handleChange);
    return () => window.removeEventListener('file-manager-hide-tab-close-button-changed', handleChange);
  }, []);
  useEffect(() => {
    if (!sessionId || !currentPathHydratedRef.current || !isActive) return;
    window.__luminFileManagerPaths = window.__luminFileManagerPaths || {};
    window.__luminFileManagerPaths[sessionId] = currentPath;
    window.dispatchEvent(new CustomEvent('ssh-file-manager-path-changed', {
      detail: { sessionId, path: currentPath }
    }));
  }, [currentPath, isActive, sessionId]);
  const [editingPath, setEditingPath] = useState(null);
  const [items, setItems] = useState([]);
  const [sortField, setSortField] = useState('name');  // name, size, permissions, modified
  const [sortDir, setSortDir] = useState('asc');  // asc, desc
  const fileListColumnWidths = useMemo(() => {
    const headerFont = '600 12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const cellFont = '12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const monoFont = '12px "JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
    const sizeTexts = [t('大小'), ...items.map((item) => (item.isDirectory ? '-' : fmtSize(item.size)))];
    const permissionTexts = [t('权限'), ...items.map((item) => formatPermissionDisplay(item.permission || '-'))];
    const modifiedTexts = [t('修改时间'), ...items.map((item) => fmtDate(item.modifyTime))];
    const sizeWidth = clampFileListColumnWidth(
      Math.max(
        ...sizeTexts.map((text, index) => measureFileListTextWidth(text, index === 0 ? headerFont : monoFont))
      ) + 24,
      FILE_LIST_SIZE_MIN_WIDTH,
      FILE_LIST_SIZE_MAX_WIDTH,
    );
    const permissionWidth = clampFileListColumnWidth(
      Math.max(
        ...permissionTexts.map((text, index) => measureFileListTextWidth(text, index === 0 ? headerFont : monoFont))
      ) + 28,
      FILE_LIST_PERMISSION_MIN_WIDTH,
      FILE_LIST_PERMISSION_MAX_WIDTH,
    );
    const modifiedWidth = clampFileListColumnWidth(
      Math.max(
        ...modifiedTexts.map((text, index) => measureFileListTextWidth(text, index === 0 ? headerFont : cellFont))
      ) + 28,
      FILE_LIST_MODIFIED_MIN_WIDTH,
      FILE_LIST_MODIFIED_MAX_WIDTH,
    );
    return {
      size: sizeWidth,
      permission: permissionWidth,
      modified: modifiedWidth,
      minWidth: `${FILE_LIST_NAME_MIN_WIDTH + sizeWidth + permissionWidth + modifiedWidth + FILE_LIST_ACTIONS_COLUMN_WIDTH}px`,
    };
  }, [items, t]);

  // 排序后的列表（目录在前）
  const sortedItems = useMemo(() => [...items].sort((a, b) => {
    // 目录始终在前
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let cmp = 0;
    switch (sortField) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'size': cmp = (a.size || 0) - (b.size || 0); break;
      case 'permissions': cmp = formatPermissionDisplay(a.permission || '-').localeCompare(formatPermissionDisplay(b.permission || '-')); break;
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
  const fileManagerTabScrollRef = useRef(null);
  const fileManagerTabScrollTargetRef = useRef(0);
  const fileManagerTabScrollFrameRef = useRef(0);
  const [fileManagerTabOverflow, setFileManagerTabOverflow] = useState(false);
  const [fileManagerTabCanScrollLeft, setFileManagerTabCanScrollLeft] = useState(false);
  const [fileManagerTabCanScrollRight, setFileManagerTabCanScrollRight] = useState(false);
  const [draggingFileManagerTabId, setDraggingFileManagerTabId] = useState('');
  const draggingFileManagerTabIdRef = useRef('');
  const [fileManagerTabDropIndicator, setFileManagerTabDropIndicator] = useState(null);
  const tabItemsCacheRef = useRef(new Map());
  const getCachedTabItems = useCallback((tabId) => {
    const cachedItems = tabItemsCacheRef.current.get(String(tabId || '').trim());
    return Array.isArray(cachedItems) ? cloneFileManagerItemsForCache(cachedItems) : null;
  }, []);
  const getCachedPathItems = useCallback((path) => (
    getSessionCachedFileManagerPathItems(sessionId, path)
  ), [sessionId]);
  const cacheCurrentTabItems = useCallback((tabId, nextItems) => {
    const key = String(tabId || '').trim();
    if (!key) return;
    tabItemsCacheRef.current.set(key, cloneFileManagerItemsForCache(nextItems));
  }, []);
  const cachePathItems = useCallback((path, nextItems) => {
    setSessionCachedFileManagerPathItems(sessionId, path, nextItems);
  }, [sessionId]);
  const removeCachedTabItems = useCallback((tabId) => {
    const key = String(tabId || '').trim();
    if (!key) return;
    tabItemsCacheRef.current.delete(key);
  }, []);
  useEffect(() => {
    tabItemsCacheRef.current.clear();
  }, [sessionId]);
  const syncFileManagerTabOverflowState = useCallback(() => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      setFileManagerTabOverflow(false);
      setFileManagerTabCanScrollLeft(false);
      setFileManagerTabCanScrollRight(false);
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const currentLeft = el.scrollLeft;
    const hasOverflow = maxLeft > 1;
    setFileManagerTabOverflow(hasOverflow);
    setFileManagerTabCanScrollLeft(hasOverflow && currentLeft > 1);
    setFileManagerTabCanScrollRight(hasOverflow && currentLeft < maxLeft - 1);
    if (!hasOverflow) {
      fileManagerTabScrollTargetRef.current = 0;
    }
  }, []);
  const stopFileManagerTabScrollAnimation = useCallback(() => {
    if (!fileManagerTabScrollFrameRef.current) {
      return;
    }
    cancelAnimationFrame(fileManagerTabScrollFrameRef.current);
    fileManagerTabScrollFrameRef.current = 0;
  }, []);
  const stepFileManagerTabScroll = useCallback(() => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      fileManagerTabScrollFrameRef.current = 0;
      return;
    }
    const currentLeft = el.scrollLeft;
    const targetLeft = fileManagerTabScrollTargetRef.current;
    const deltaLeft = targetLeft - currentLeft;
    if (Math.abs(deltaLeft) < 0.5) {
      el.scrollLeft = targetLeft;
      fileManagerTabScrollFrameRef.current = 0;
      syncFileManagerTabOverflowState();
      return;
    }
    const nextStep = Math.abs(deltaLeft) < 10
      ? Math.sign(deltaLeft) * Math.max(0.8, Math.abs(deltaLeft) * 0.45)
      : deltaLeft * 0.18;
    el.scrollLeft = currentLeft + nextStep;
    fileManagerTabScrollFrameRef.current = requestAnimationFrame(stepFileManagerTabScroll);
  }, [syncFileManagerTabOverflowState]);
  const setFileManagerTabScrollTarget = useCallback((nextLeft) => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const clampedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    fileManagerTabScrollTargetRef.current = clampedLeft;
    if (!fileManagerTabScrollFrameRef.current) {
      fileManagerTabScrollFrameRef.current = requestAnimationFrame(stepFileManagerTabScroll);
    }
  }, [stepFileManagerTabScroll]);
  const scrollFileManagerTabs = useCallback((direction) => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      return;
    }
    const step = Math.max(96, Math.round(el.clientWidth * 0.45));
    const baseLeft = fileManagerTabScrollFrameRef.current ? fileManagerTabScrollTargetRef.current : el.scrollLeft;
    setFileManagerTabScrollTarget(baseLeft + step * direction);
  }, [setFileManagerTabScrollTarget]);
  const handleFileManagerTabScroll = useCallback((event) => {
    if (!fileManagerTabScrollFrameRef.current) {
      fileManagerTabScrollTargetRef.current = event.currentTarget.scrollLeft;
    }
    syncFileManagerTabOverflowState();
  }, [syncFileManagerTabOverflowState]);
  const handleFileManagerTabWheel = useCallback((event) => {
    const el = fileManagerTabScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const baseLeft = fileManagerTabScrollFrameRef.current ? fileManagerTabScrollTargetRef.current : el.scrollLeft;
    setFileManagerTabScrollTarget(baseLeft + delta);
    event.preventDefault();
  }, [setFileManagerTabScrollTarget]);
  useEffect(() => () => stopFileManagerTabScrollAnimation(), [stopFileManagerTabScrollAnimation]);
  useEffect(() => {
    const el = fileManagerTabScrollRef.current;
    if (!el) return undefined;
    const handleResize = () => syncFileManagerTabOverflowState();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(handleResize) : null;
    observer?.observe(el);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [syncFileManagerTabOverflowState]);
  useEffect(() => {
    const frame = requestAnimationFrame(syncFileManagerTabOverflowState);
    return () => cancelAnimationFrame(frame);
  }, [fileManagerWorkspace, syncFileManagerTabOverflowState]);
  const commitFileManagerWorkspace = useCallback((updater) => {
    const next = setSessionFileManagerWorkspace(sessionId, updater);
    fileManagerWorkspaceRef.current = next;
    setFileManagerWorkspaceState(next);
    return next;
  }, [sessionId]);
  const triggerCwdSystemTabHighlight = useCallback((tabId) => {
    const normalizedTabId = String(tabId || '').trim();
    if (!normalizedTabId) {
      return;
    }
    if (cwdSystemTabHighlightTimerRef.current) {
      window.clearTimeout(cwdSystemTabHighlightTimerRef.current);
      cwdSystemTabHighlightTimerRef.current = 0;
    }
    setCwdSystemTabHighlight((current) => ({
      tabId: normalizedTabId,
      token: current.token + 1,
    }));
    cwdSystemTabHighlightTimerRef.current = window.setTimeout(() => {
      cwdSystemTabHighlightTimerRef.current = 0;
      setCwdSystemTabHighlight((current) => (
        current.tabId === normalizedTabId
          ? { ...current, tabId: '' }
          : current
      ));
    }, 1500);
  }, []);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const openFileManagerPathInNewTabRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { pos, item }
  const [selectedPaths, setSelectedPaths] = useState([]);
  const lastClickedPathRef = useRef(null);
  const sortFieldRef = useRef(sortField);
  const sortDirRef = useRef(sortDir);
  const selectedPathsRef = useRef(selectedPaths);
  useEffect(() => { sortFieldRef.current = sortField; }, [sortField]);
  useEffect(() => { sortDirRef.current = sortDir; }, [sortDir]);
  useEffect(() => { selectedPathsRef.current = selectedPaths; }, [selectedPaths]);
  useEffect(() => { draggingFileManagerTabIdRef.current = draggingFileManagerTabId; }, [draggingFileManagerTabId]);
  useEffect(() => {
    const pendingRestore = pendingTabSelectionRestoreRef.current;
    if (pendingRestore) {
      const nextSelectedPaths = Array.isArray(pendingRestore.selectedPaths) ? pendingRestore.selectedPaths : [];
      setSelectedPaths(nextSelectedPaths);
      lastClickedPathRef.current = pendingRestore.lastClickedPath || nextSelectedPaths[nextSelectedPaths.length - 1] || null;
      pendingTabSelectionRestoreRef.current = null;
    } else {
      setSelectedPaths([]);
      lastClickedPathRef.current = null;
    }
  }, [currentPath]);
  useEffect(() => {
    if (!currentPathHydratedRef.current) return;
    const displayedTabId = displayedTabIdRef.current || '';
    if (displayedTabId) {
      cacheCurrentTabItems(displayedTabId, items);
    }
    cachePathItems(currentPath || currentPathRef.current || '/', items);
  }, [cacheCurrentTabItems, cachePathItems, currentPath, items]);
  const syncCurrentTabToWorkspace = useCallback((overrides = {}) => {
    const displayedTabId = String(displayedTabIdRef.current || '').trim();
    const activeTabId = String(activeFileManagerTabIdRef.current || '').trim();
    const workspaceTabId = displayedTabId || activeTabId;
    if (!sessionId || !workspaceTabId) {
      return null;
    }
    const hasExplicitPath = Object.prototype.hasOwnProperty.call(overrides, 'path');
    return commitFileManagerWorkspace((currentWorkspace) => {
      if (!Array.isArray(currentWorkspace?.tabs) || currentWorkspace.tabs.length === 0) {
        return currentWorkspace;
      }
      return {
        activeTabId: currentWorkspace.activeTabId || activeTabId || workspaceTabId,
        tabs: currentWorkspace.tabs.map((tab) => {
          if (tab.id !== workspaceTabId) {
            return tab;
          }
          const nextPath = hasExplicitPath
            ? (overrides.path ?? currentPathRef.current)
            : (currentPathHydratedRef.current && !preserveWorkspacePathRef.current ? currentPathRef.current : tab.path);
          const normalizedTabPath = normalizePath(tab.path) || '/';
          const normalizedNextPath = normalizePath(nextPath) || '/';
          return {
            ...tab,
            path: tab.pinned === true && normalizedNextPath !== normalizedTabPath ? tab.path : normalizedNextPath,
            sortField: overrides.sortField ?? sortFieldRef.current,
            sortDir: overrides.sortDir ?? sortDirRef.current,
            selectedPaths: Array.isArray(overrides.selectedPaths) ? overrides.selectedPaths : selectedPathsRef.current,
            scrollTop: Number.isFinite(Number(overrides.scrollTop)) ? Number(overrides.scrollTop) : (fileListRef.current?.scrollTop || 0),
          };
        }),
      };
    });
  }, [commitFileManagerWorkspace, normalizePath, sessionId]);
  const restoreTabItemsFromCache = useCallback((tab, path) => {
    const resolvedTabId = String(tab?.id || '').trim();
    const cachedItems = getCachedTabItems(resolvedTabId);
    if (!cachedItems) {
      return false;
    }
    const resolvedPath = normalizePath(path ?? tab?.path) || '/';
    displayedTabIdRef.current = resolvedTabId;
    currentPathHydratedRef.current = true;
    currentPathRef.current = resolvedPath;
    setLoading(false);
    setItems(cachedItems);
    setCurrentPath(resolvedPath);
    return true;
  }, [getCachedTabItems, normalizePath]);
  const isFileManagerTabLoadSuperseded = useCallback((tabId) => {
    const normalizedTabId = String(tabId || '').trim();
    const activeTabId = String(activeFileManagerTabIdRef.current || '').trim();
    return Boolean(normalizedTabId && activeTabId && normalizedTabId !== activeTabId);
  }, []);
  useEffect(() => {
    if (!isActive || !currentPathHydratedRef.current) return;
    syncCurrentTabToWorkspace({
      ...(preserveWorkspacePathRef.current ? {} : { path: currentPath }),
      scrollTop: fileListRef.current?.scrollTop || 0,
      reason: 'currentPath-effect',
    });
  }, [currentPath, isActive, syncCurrentTabToWorkspace]);
  useEffect(() => {
    if (!isActive || !activeFileManagerTabIdRef.current) return;
    syncCurrentTabToWorkspace({ sortField, sortDir, reason: 'sort-effect' });
  }, [isActive, sortField, sortDir, syncCurrentTabToWorkspace]);
  useEffect(() => {
    if (!isActive || !activeFileManagerTabIdRef.current) return;
    syncCurrentTabToWorkspace({ selectedPaths, reason: 'selectedPaths-effect' });
  }, [isActive, selectedPaths, syncCurrentTabToWorkspace]);
  const pendingViewRestoreRef = useRef(null);
  const lastVisibleViewAnchorRef = useRef(null);
  const pendingVisualEffectsRef = useRef(new Map());
  const pendingAutoRevealRowKeysRef = useRef([]);
  const rowEffectTimersRef = useRef(new Map());
  const tombstoneSequenceRef = useRef(0);
  const suppressUserScrollTrackingUntilRef = useRef(0);
  const userHasScrolledInCurrentPathRef = useRef(false);
  const [activeRowEffects, setActiveRowEffects] = useState({});

  const captureFileListViewAnchor = useCallback(() => {
    const list = fileListRef.current;
    if (!list) return lastVisibleViewAnchorRef.current || null;
    const rootRect = fileManagerRootRef.current?.getBoundingClientRect?.();
    const canMeasure = !document.hidden && !!rootRect && rootRect.width > 1 && rootRect.height > 1;
    if (!canMeasure) {
      return lastVisibleViewAnchorRef.current || {
        key: '',
        offset: 0,
        scrollTop: list.scrollTop,
      };
    }
    const header = list.querySelector('.file-list-header');
    const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
    const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
    const anchorRow = rows.find((row) => row.getBoundingClientRect().bottom > viewportTop + 1);
    const anchorRect = anchorRow?.getBoundingClientRect?.();
    const nextAnchor = {
      key: anchorRow?.dataset?.fileRowKey || '',
      offset: anchorRect ? anchorRect.top - viewportTop : 0,
      scrollTop: list.scrollTop,
    };
    lastVisibleViewAnchorRef.current = nextAnchor;
    return nextAnchor;
  }, []);

  const queueFileListViewRestore = useCallback((anchor = captureFileListViewAnchor()) => {
    pendingViewRestoreRef.current = anchor;
  }, [captureFileListViewAnchor]);

  const updateItemsPreservingView = useCallback((updater, anchor = captureFileListViewAnchor()) => {
    pendingViewRestoreRef.current = anchor;
    setItems((current) => (typeof updater === 'function' ? updater(current) : updater));
  }, [captureFileListViewAnchor]);

  React.useLayoutEffect(() => {
    const pendingRestore = pendingViewRestoreRef.current;
    if (!pendingRestore) return;
    pendingViewRestoreRef.current = null;
    const list = fileListRef.current;
    if (!list) return;
    const header = list.querySelector('.file-list-header');
    const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
    const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
    if (pendingRestore.key) {
      const anchorRow = rows.find((row) => row.dataset?.fileRowKey === pendingRestore.key);
      if (anchorRow) {
        const delta = anchorRow.getBoundingClientRect().top - viewportTop - pendingRestore.offset;
        if (delta !== 0) {
          list.scrollTop += delta;
        }
        captureFileListViewAnchor();
        return;
      }
    }
    if (typeof pendingRestore.scrollTop === 'number') {
      list.scrollTop = pendingRestore.scrollTop;
    }
    captureFileListViewAnchor();
  }, [captureFileListViewAnchor, items]);

  const isDeletedPlaceholderItem = useCallback((item) => Boolean(item?.__luminDeletedPlaceholder), []);

  const captureRowHeight = useCallback((rowKey) => {
    if (!rowKey || !fileListRef.current) return 36;
    const rows = Array.from(fileListRef.current.querySelectorAll('[data-file-row-key]'));
    const row = rows.find((entry) => entry.dataset?.fileRowKey === rowKey);
    return Math.max(28, Math.round(row?.getBoundingClientRect?.().height || row?.offsetHeight || 36));
  }, []);

  const queueRowEffect = useCallback((logicalKey, rowKey, effect) => {
    if (!logicalKey || !rowKey || !effect) return;
    pendingVisualEffectsRef.current.set(logicalKey, { logicalKey, rowKey, effect });
    if (effect === 'added') {
      pendingAutoRevealRowKeysRef.current = [
        ...pendingAutoRevealRowKeysRef.current.filter((key) => key !== rowKey),
        rowKey,
      ];
    }
  }, []);

  const clearRowEffectTimer = useCallback((rowKey) => {
    const timer = rowEffectTimersRef.current.get(rowKey);
    if (timer) {
      window.clearTimeout(timer);
      rowEffectTimersRef.current.delete(rowKey);
    }
  }, []);

  const clearActiveRowEffect = useCallback((rowKey) => {
    clearRowEffectTimer(rowKey);
    setActiveRowEffects((current) => {
      if (!current[rowKey]) return current;
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
  }, [clearRowEffectTimer]);

  const finalizeDeletedPlaceholder = useCallback((rowKey) => {
    clearRowEffectTimer(rowKey);
    setActiveRowEffects((current) => {
      if (!current[rowKey]) return current;
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    setItems((current) => current.filter((entry) => entry.__rowKey !== rowKey));
  }, [clearRowEffectTimer]);

  const startRowEffect = useCallback((entry) => {
    if (!entry?.rowKey || !entry?.effect) return;
    clearRowEffectTimer(entry.rowKey);
    setActiveRowEffects((current) => (
      current[entry.rowKey] === entry.effect
        ? current
        : { ...current, [entry.rowKey]: entry.effect }
    ));
    const duration = entry.effect === 'added' ? 3200 : 3000;
    const timer = window.setTimeout(() => {
      if (entry.effect === 'removed') {
        finalizeDeletedPlaceholder(entry.rowKey);
      } else {
        clearActiveRowEffect(entry.rowKey);
      }
    }, duration);
    rowEffectTimersRef.current.set(entry.rowKey, timer);
  }, [clearActiveRowEffect, clearRowEffectTimer, finalizeDeletedPlaceholder]);

  const isFileManagerActuallyVisible = useCallback(() => {
    if (!isActive || document.hidden) return false;
    const root = fileManagerRootRef.current;
    if (!root) return false;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    const style = window.getComputedStyle(root);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }, [isActive]);

  const isListNearBottom = useCallback(() => {
    const list = fileListRef.current;
    if (!list) return false;
    return list.scrollHeight - (list.scrollTop + list.clientHeight) <= 8;
  }, []);

  const isRowVisibleInViewport = useCallback((rowKey) => {
    if (!rowKey || !fileListRef.current) return false;
    const list = fileListRef.current;
    const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
    const row = rows.find((entry) => entry.dataset?.fileRowKey === rowKey);
    if (!row) return false;
    const header = list.querySelector('.file-list-header');
    const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
    const viewportBottom = list.getBoundingClientRect().bottom;
    const rowRect = row.getBoundingClientRect();
    return rowRect.bottom > viewportTop + 1 && rowRect.top < viewportBottom - 1;
  }, []);

  const revealRowInViewport = useCallback((rowKey) => {
    if (!rowKey || !fileListRef.current) return false;
    const list = fileListRef.current;
    const rows = Array.from(list.querySelectorAll('[data-file-row-key]'));
    const row = rows.find((entry) => entry.dataset?.fileRowKey === rowKey);
    if (!row) return false;
    const header = list.querySelector('.file-list-header');
    const viewportTop = header ? header.getBoundingClientRect().bottom : list.getBoundingClientRect().top;
    const viewportBottom = list.getBoundingClientRect().bottom;
    const rowRect = row.getBoundingClientRect();
    if (rowRect.bottom > viewportTop + 1 && rowRect.top < viewportBottom - 1) {
      return true;
    }
    const viewportHeight = Math.max(1, viewportBottom - viewportTop);
    const targetScrollTop = Math.max(
      0,
      list.scrollTop + (rowRect.top - viewportTop) - Math.max(12, (viewportHeight - rowRect.height) / 2),
    );
    suppressUserScrollTrackingUntilRef.current = Date.now() + 400;
    list.scrollTop = targetScrollTop;
    captureFileListViewAnchor();
    return true;
  }, [captureFileListViewAnchor]);

  const flushPendingRowEffects = useCallback(() => {
    if (!isFileManagerActuallyVisible()) return;
    if (pendingAutoRevealRowKeysRef.current.length > 0 && (!userHasScrolledInCurrentPathRef.current || isListNearBottom())) {
      const pendingKeys = [...pendingAutoRevealRowKeysRef.current];
      for (const rowKey of pendingKeys) {
        if (isRowVisibleInViewport(rowKey) || revealRowInViewport(rowKey)) {
          pendingAutoRevealRowKeysRef.current = pendingAutoRevealRowKeysRef.current.filter((key) => key !== rowKey);
          break;
        }
      }
    }
    pendingVisualEffectsRef.current.forEach((entry, logicalKey) => {
      if (!isRowVisibleInViewport(entry.rowKey)) return;
      pendingVisualEffectsRef.current.delete(logicalKey);
      startRowEffect(entry);
    });
  }, [isFileManagerActuallyVisible, isListNearBottom, isRowVisibleInViewport, revealRowInViewport, startRowEffect]);

  const createDeletedPlaceholder = useCallback((item, logicalPath, rowHeight = captureRowHeight(logicalPath)) => ({
    ...(item || {}),
    __luminDeletedPlaceholder: true,
    __logicalPath: logicalPath,
    __rowKey: `__deleted__:${logicalPath}:${Date.now()}:${tombstoneSequenceRef.current++}`,
    __rowHeight: Math.max(28, rowHeight || 36),
  }), [captureRowHeight]);

  const didItemMetadataChange = useCallback((prevItem, nextItem) => (
    prevItem?.isDirectory !== nextItem?.isDirectory
    || Number(prevItem?.size || 0) !== Number(nextItem?.size || 0)
    || String(prevItem?.permission || '') !== String(nextItem?.permission || '')
    || String(prevItem?.mode || '') !== String(nextItem?.mode || '')
    || String(prevItem?.modifyTime || '') !== String(nextItem?.modifyTime || '')
  ), []);

  useEffect(() => {
    captureFileListViewAnchor();
    flushPendingRowEffects();
  }, [captureFileListViewAnchor, flushPendingRowEffects, items, loading, isActive]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      captureFileListViewAnchor();
      flushPendingRowEffects();
    }, 240);
    return () => {
      window.clearInterval(timer);
      rowEffectTimersRef.current.forEach((currentTimer) => window.clearTimeout(currentTimer));
      rowEffectTimersRef.current.clear();
      pendingVisualEffectsRef.current.clear();
    };
  }, [captureFileListViewAnchor, flushPendingRowEffects]);

  useEffect(() => {
    lastVisibleViewAnchorRef.current = null;
    pendingViewRestoreRef.current = null;
    pendingVisualEffectsRef.current.clear();
    pendingAutoRevealRowKeysRef.current = [];
    userHasScrolledInCurrentPathRef.current = false;
    suppressUserScrollTrackingUntilRef.current = 0;
    rowEffectTimersRef.current.forEach((currentTimer) => window.clearTimeout(currentTimer));
    rowEffectTimersRef.current.clear();
    setActiveRowEffects({});
  }, [activeFileManagerTab?.id, currentPath]);

  const [clipboard, setClipboard] = useState(null); // { paths: string[], mode: 'copy'|'cut', srcDir: string }
  const [operationProgress, setOperationProgress] = useState(null);
  // 并发互斥闸门：用 ref 在同步阶段立即生效，避免两个快速事件都读到 stale 的 state 而双双放行
  const operationInProgressRef = useRef(false);

  const updateClipboard = (newClipboard) => {
    if (!window.__luminClipboards) {
      window.__luminClipboards = {};
    }
    if (newClipboard) {
      window.__luminClipboards[sessionGroupId] = newClipboard;
    } else {
      delete window.__luminClipboards[sessionGroupId];
    }
    setClipboard(newClipboard);
    window.dispatchEvent(new CustomEvent('lumin-clipboard-changed', {
      detail: { sessionGroupId, clipboard: newClipboard }
    }));
  };

  useEffect(() => {
    const cached = (window.__luminClipboards && window.__luminClipboards[sessionGroupId]) || null;
    setClipboard(cached);

    const handleClipboardChange = (e) => {
      if (e.detail && e.detail.sessionGroupId === sessionGroupId) {
        setClipboard(e.detail.clipboard);
      }
    };

    window.addEventListener('lumin-clipboard-changed', handleClipboardChange);
    return () => {
      window.removeEventListener('lumin-clipboard-changed', handleClipboardChange);
    };
  }, [sessionGroupId]);

  // 卸载或切换 sessionGroup 时清理全局剪贴板缓存，防止内存泄漏与 sessionGroupId 复用时复活幽灵剪贴板
  useEffect(() => {
    return () => {
      if (window.__luminClipboards) {
        delete window.__luminClipboards[sessionGroupId];
      }
    };
  }, [sessionGroupId]);

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
  const [externalOpening, setExternalOpening] = useState(false);
  const setTransferInfo = useCallback(() => {}, []);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const uploadInputRef = useRef(null);
  const uploadFolderInputRef = useRef(null);
  const [workbenchState, setWorkbenchStateState] = useState(() => getSessionWorkbenchState(sessionGroupId));
  const [uploadQueueItems, setUploadQueueItems] = useState(() => getSessionUploadQueue(sessionGroupId));
  const activeUploadCount = useMemo(() => uploadQueueItems.filter((item) => item.status === 'queued' || item.status === 'uploading').length, [uploadQueueItems]);
  const uploadPanelCloseTimerRef = useRef(0);
  const [uploadPanelClosing, setUploadPanelClosing] = useState(false);

  const clearUploadPanelCloseTimer = useCallback(() => {
    if (uploadPanelCloseTimerRef.current) {
      window.clearTimeout(uploadPanelCloseTimerRef.current);
      uploadPanelCloseTimerRef.current = 0;
    }
  }, []);

  useEffect(() => () => {
    clearUploadPanelCloseTimer();
  }, [clearUploadPanelCloseTimer]);

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

  const openUploadPanel = useCallback(() => {
    clearUploadPanelCloseTimer();
    setUploadPanelClosing(false);
    setSessionWorkbenchState(sessionGroupId, {
      uploadOpen: true,
      activeTab: 'upload',
    });
  }, [clearUploadPanelCloseTimer, sessionGroupId]);

  const finishUploadPanelClose = useCallback(() => {
    clearUploadPanelCloseTimer();
    setUploadPanelClosing(false);
    const current = getSessionWorkbenchState(sessionGroupId);
    setSessionWorkbenchState(sessionGroupId, {
      uploadOpen: false,
      activeTab: current.editorSplitOpen ? 'editor' : current.activeTab,
    });
  }, [clearUploadPanelCloseTimer, sessionGroupId]);

  const closeUploadPanel = useCallback(() => {
    const current = getSessionWorkbenchState(sessionGroupId);
    if (!current.uploadOpen && !uploadPanelClosing) {
      return;
    }
    clearUploadPanelCloseTimer();
    setUploadPanelClosing(true);
    uploadPanelCloseTimerRef.current = window.setTimeout(() => {
      finishUploadPanelClose();
    }, UPLOAD_PANEL_CLOSE_ANIMATION_MS);
  }, [clearUploadPanelCloseTimer, finishUploadPanelClose, sessionGroupId, uploadPanelClosing]);

  const setUploadPanelOpen = useCallback((open) => {
    if (open) {
      openUploadPanel();
      return;
    }
    closeUploadPanel();
  }, [closeUploadPanel, openUploadPanel]);

  const openTransferQueueIfNeeded = useCallback(() => {
    if (shouldAutoOpenTransferQueue()) {
      setUploadPanelOpen(true);
    }
  }, [setUploadPanelOpen]);

  const toggleUploadPanel = useCallback(() => {
    if (uploadPanelClosing) {
      openUploadPanel();
      return;
    }
    const current = getSessionWorkbenchState(sessionGroupId);
    if (current.uploadOpen) {
      closeUploadPanel();
      return;
    }
    openUploadPanel();
  }, [closeUploadPanel, openUploadPanel, sessionGroupId, uploadPanelClosing]);

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

  const loadDir = useCallback(async (path, options = {}) => {
    const normalizedPath = normalizePath(path) || '/';
    const resolvedOptions = typeof options === 'boolean' ? { silent: options } : (options || {});
    const targetTabId = String(
      resolvedOptions.tabId
      || activeFileManagerTabIdRef.current
      || displayedTabIdRef.current
      || ''
    ).trim();
    const currentWorkspace = fileManagerWorkspaceRef.current;
    const targetWorkspaceTab = targetTabId && Array.isArray(currentWorkspace?.tabs)
      ? currentWorkspace.tabs.find((tab) => tab.id === targetTabId)
      : null;
    const normalizedTargetWorkspaceTabPath = normalizePath(targetWorkspaceTab?.path) || '/';
    const displayedTabId = String(displayedTabIdRef.current || '').trim();
    const isSwitchingDisplayedTab = !!(targetTabId && displayedTabId && targetTabId !== displayedTabId);
    if (
      targetWorkspaceTab?.pinned === true
      && normalizedPath !== normalizedTargetWorkspaceTabPath
      && !isSwitchingDisplayedTab
      && typeof openFileManagerPathInNewTabRef.current === 'function'
    ) {
      await openFileManagerPathInNewTabRef.current(normalizedPath);
      return true;
    }
    const requestSeq = ++loadRequestSeqRef.current;
    const canApplyResult = () => {
      if (!mountedRef.current) return false;
      if (requestSeq !== loadRequestSeqRef.current) return false;
      if (targetTabId && activeFileManagerTabIdRef.current && targetTabId !== activeFileManagerTabIdRef.current) {
        return false;
      }
      return true;
    };

    const explicitStaleWhileRevalidate = resolvedOptions.staleWhileRevalidate === true;
    const providedStaleItems = explicitStaleWhileRevalidate ? cloneFileManagerItemsForCache(resolvedOptions.staleItems) : null;
    const cachedPathItems = providedStaleItems ? null : getCachedPathItems(normalizedPath);
    const staleWhileRevalidate = explicitStaleWhileRevalidate || (!!cachedPathItems && normalizedPath !== currentPathRef.current);
    const staleItems = providedStaleItems || cachedPathItems;
    const transitionMode = resolvedOptions.transitionMode === 'directory' || resolvedOptions.transitionMode === 'tab'
      ? resolvedOptions.transitionMode
      : 'none';
    const transitionDirection = resolvedOptions.transitionDirection === 'backward'
      ? 'backward'
      : resolvedOptions.transitionDirection === 'forward'
        ? 'forward'
        : (transitionMode === 'directory' && normalizedPath === getParentPath(currentPathRef.current) ? 'backward' : 'forward');
    const preserveWorkspacePathOnSuccess = resolvedOptions.preserveWorkspacePathOnSuccess === true;
    const shouldAnimateSwitch = transitionMode !== 'none' && !staleWhileRevalidate;
    const switchToken = shouldAnimateSwitch ? beginFileListSwitch(transitionDirection) : 0;

    if (staleWhileRevalidate && staleItems) {
      displayedTabIdRef.current = targetTabId || displayedTabIdRef.current;
      currentPathHydratedRef.current = true;
      currentPathRef.current = normalizedPath;
      setLoading(false);
      setItems(staleItems);
      setCurrentPath(normalizedPath);
    }

    const samePathRefresh = currentPathHydratedRef.current && normalizedPath === currentPathRef.current;
    const preserveView = resolvedOptions.preserveView ?? (staleWhileRevalidate ? true : samePathRefresh);
    const trackDiff = resolvedOptions.trackDiff ?? (staleWhileRevalidate ? true : samePathRefresh);
    const showLoading = resolvedOptions.showLoading ?? (shouldAnimateSwitch ? false : (staleWhileRevalidate ? false : !(preserveView || trackDiff)));

    if (showLoading) {
      setLoading(true);
    } else if (shouldAnimateSwitch) {
      setLoading(false);
    }
    if (preserveView && !trackDiff) {
      queueFileListViewRestore();
    }

    try {
      const data = await AppGo.ListDir(sessionId, normalizedPath);
      if (!canApplyResult()) {
        return false;
      }
      const applyLoadedData = () => {
        if (trackDiff) {
          updateItemsPreservingView((current) => {
            const nextItems = Array.isArray(data) ? data : [];
            const currentVisibleItems = current.filter((entry) => !isDeletedPlaceholderItem(entry));
            const existingPlaceholders = current.filter((entry) => isDeletedPlaceholderItem(entry));
            const currentByName = new Map(currentVisibleItems.map((entry) => [entry.name, entry]));
            const nextByName = new Map(nextItems.map((entry) => [entry.name, entry]));

            nextItems.forEach((entry) => {
              const logicalPath = joinPath(normalizedPath, entry.name);
              const previousEntry = currentByName.get(entry.name);
              if (!previousEntry) {
                queueRowEffect(logicalPath, logicalPath, 'added');
                return;
              }
              if (didItemMetadataChange(previousEntry, entry)) {
                queueRowEffect(logicalPath, logicalPath, 'changed');
              }
            });

            const newDeletedPlaceholders = currentVisibleItems
              .filter((entry) => !nextByName.has(entry.name))
              .map((entry) => {
                const logicalPath = joinPath(normalizedPath, entry.name);
                const placeholder = createDeletedPlaceholder(entry, logicalPath);
                queueRowEffect(logicalPath, placeholder.__rowKey, 'removed');
                return placeholder;
              });

            const persistedPlaceholders = existingPlaceholders.filter((entry) => !nextByName.has(entry.name));
            return [...nextItems, ...persistedPlaceholders, ...newDeletedPlaceholders];
          });
        } else {
          setItems(data || []);
        }
        displayedTabIdRef.current = targetTabId || displayedTabIdRef.current;
        currentPathHydratedRef.current = true;
        currentPathRef.current = normalizedPath;
        preserveWorkspacePathRef.current = preserveWorkspacePathOnSuccess;
        setCurrentPath(normalizedPath);
        if (!preserveView && fileListRef.current) {
          fileListRef.current.scrollTop = 0;
        }
        setLoading(false);
      };

      if (shouldAnimateSwitch) {
        commitFileListSwitch(switchToken, applyLoadedData);
      } else {
        applyLoadedData();
      }
      return true;
    } catch (err) {
      pendingViewRestoreRef.current = null;
      if (!canApplyResult()) return false;
      cancelFileListSwitch(switchToken);
      setLoading(false);
      if (!resolvedOptions.silent) {
        const msg = String(err).toLowerCase().includes('permission denied')
          ? `${t('权限不足')}: SFTP ${t('仍以')} ${sessionId ? t('原用户') : ''} ${t('身份运行，终端内 sudo 不影响文件管理器')}`
          : `${t('读取目录失败')}: ${err}`;
        addToast(`${msg} [${normalizedPath}]`, 'error');
      }
      return false;
    } finally {
      if (!shouldAnimateSwitch && mountedRef.current && requestSeq === loadRequestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [sessionId, addToast, normalizePath, t, queueFileListViewRestore, updateItemsPreservingView, isDeletedPlaceholderItem, didItemMetadataChange, queueRowEffect, createDeletedPlaceholder, beginFileListSwitch, commitFileListSwitch, cancelFileListSwitch, getCachedPathItems]);

  const applyAnimatedFileListSnapshot = useCallback((path, nextItems, options = {}) => {
    const normalizedPath = normalizePath(path) || '/';
    const targetTabId = String(
      options.tabId
      || activeFileManagerTabIdRef.current
      || displayedTabIdRef.current
      || ''
    ).trim();
    const preserveView = options.preserveView === true;
    const token = beginFileListSwitch();
    commitFileListSwitch(token, () => {
      displayedTabIdRef.current = targetTabId || displayedTabIdRef.current;
      currentPathHydratedRef.current = true;
      currentPathRef.current = normalizedPath;
      setLoading(false);
      setItems(Array.isArray(nextItems) ? nextItems : []);
      setCurrentPath(normalizedPath);
      if (!preserveView && fileListRef.current) {
        fileListRef.current.scrollTop = 0;
      }
    });
  }, [normalizePath, beginFileListSwitch, commitFileListSwitch]);

  const buildNonRememberedInitialPathCandidates = useCallback(async () => {
    const candidates = [];
    const pushCandidate = (value) => {
      const normalized = normalizePath(value);
      if (!normalized || candidates.includes(normalized)) {
        return;
      }
      candidates.push(normalized);
    };
    const normalizedInitialPath = normalizePath(initialPath);
    const initialPathMode = getFileManagerInitialPathMode();
    pushCandidate(normalizedInitialPath);
    if (initialPathMode === FILE_MANAGER_NEW_TAB_PATH_MODE_ROOT) {
      pushCandidate('/');
    } else if (initialPathMode === FILE_MANAGER_NEW_TAB_PATH_MODE_SESSION_INITIAL_PATH || initialPathMode === FILE_MANAGER_NEW_TAB_PATH_MODE_TERMINAL_CWD) {
      try {
        const cwd = await AppGo.GetTerminalCwd(sessionId);
        pushCandidate(cwd);
      } catch (_) {}
    }
    pushCandidate('/root');
    pushCandidate('/');
    return candidates;
  }, [initialPath, normalizePath, sessionId]);

  const resolveNonRememberedInitialPath = useCallback(async () => {
    const candidates = await buildNonRememberedInitialPathCandidates();
    for (const candidatePath of candidates) {
      try {
        await AppGo.ListDir(sessionId, candidatePath);
        return candidatePath;
      } catch (_) {}
    }
    return candidates[candidates.length - 1] || '/';
  }, [buildNonRememberedInitialPathCandidates, sessionId]);

  const ensureForcedInitialFileManagerTab = useCallback((workspace, forcedPath, cwdPath = '') => {
    const normalizedForcedPath = normalizePath(forcedPath) || '/';
    const currentTabs = Array.isArray(workspace?.tabs) ? workspace.tabs.filter((tab) => tab && typeof tab === 'object') : [];
    const currentActiveTabId = typeof workspace?.activeTabId === 'string' ? workspace.activeTabId : '';
    const homeSystemTab = currentTabs.find((tab) => getFileManagerSystemTabType(tab) === FILE_MANAGER_SYSTEM_TAB_KIND_HOME) || null;
    const homeTabPath = normalizePath(homeSystemTab?.path) || normalizedForcedPath;
    const baseHomeTab = homeSystemTab || createFileManagerTab(homeTabPath, {
      pinned: true,
      systemPinned: true,
      systemPinnedType: FILE_MANAGER_SYSTEM_TAB_KIND_HOME,
    });
    const baseHomePath = normalizePath(baseHomeTab.path) || '/';
    const nextHomeTab = {
      ...baseHomeTab,
      customTitle: '',
      path: homeTabPath,
      pinned: true,
      systemPinned: true,
      systemPinnedType: FILE_MANAGER_SYSTEM_TAB_KIND_HOME,
      selectedPaths: baseHomePath === homeTabPath ? (Array.isArray(baseHomeTab.selectedPaths) ? baseHomeTab.selectedPaths : []) : [],
      scrollTop: baseHomePath === homeTabPath && Number.isFinite(Number(baseHomeTab.scrollTop)) ? Number(baseHomeTab.scrollTop) : 0,
    };
    const nextTabs = [nextHomeTab];
    currentTabs.forEach((tab) => {
      if (tab.id === nextHomeTab.id || tab.systemPinned === true) {
        return;
      }
      nextTabs.push(tab);
    });
    const nextActiveTabId = nextTabs.some((tab) => tab.id === currentActiveTabId) ? currentActiveTabId : nextHomeTab.id;
    const changed = currentTabs.length !== nextTabs.length
      || nextActiveTabId !== currentActiveTabId
      || currentTabs.some((tab, index) => !areFileManagerTabStatesEqual(tab, nextTabs[index]))
      || nextTabs.some((tab, index) => !areFileManagerTabStatesEqual(tab, currentTabs[index]));
    if (!changed) {
      return workspace;
    }
    return {
      activeTabId: nextActiveTabId,
      tabs: nextTabs,
    };
  }, [normalizePath]);

  const resolveTerminalCwdFollowTarget = useCallback((cwdPath) => {
    const normalizedCwdPath = normalizePath(cwdPath);
    if (!normalizedCwdPath) {
      return null;
    }
    const currentWorkspace = fileManagerWorkspaceRef.current;
    const currentTabs = Array.isArray(currentWorkspace?.tabs) ? currentWorkspace.tabs : [];
    const activeTabId = String(activeFileManagerTabIdRef.current || currentWorkspace?.activeTabId || '').trim();
    const activeTab = currentTabs.find((tab) => tab.id === activeTabId) || currentTabs[0] || null;
    if (!activeTab) {
      return null;
    }
    return {
      path: normalizedCwdPath,
      tabId: String(activeTab.id || '').trim(),
    };
  }, [normalizePath]);

  const applyTerminalCwdFollow = useCallback(async (cwd, options = {}) => {
    const followTarget = resolveTerminalCwdFollowTarget(cwd);
    if (!followTarget?.path || !followTarget?.tabId) {
      pendingTerminalCwdRef.current = '';
      return false;
    }
    if (initializingPathRef.current) {
      pendingTerminalCwdRef.current = followTarget.path;
      return false;
    }
    if (!isActiveRef.current && options.force !== true) {
      pendingTerminalCwdRef.current = followTarget.path;
      return false;
    }
    pendingTerminalCwdRef.current = '';
    if (followTarget.path === currentPathRef.current && followTarget.tabId === String(activeFileManagerTabIdRef.current || '').trim()) {
      return true;
    }
    return loadDir(followTarget.path, {
      tabId: followTarget.tabId,
      silent: true,
      preserveView: false,
      trackDiff: false,
      showLoading: options.showLoading === true,
      transitionMode: options.transitionMode || 'directory',
    });
  }, [loadDir, resolveTerminalCwdFollowTarget]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    let cancelled = false;
    currentPathHydratedRef.current = false;
    initializingPathRef.current = true;
    (async () => {
      try {
        let systemTerminalCwdPath = normalizePath(pendingTerminalCwdRef.current);
        if (!systemTerminalCwdPath) {
          try {
            systemTerminalCwdPath = normalizePath(await AppGo.GetTerminalCwd(sessionId));
          } catch (_) {
            systemTerminalCwdPath = '';
          }
        }
        const forcedInitialPath = systemTerminalCwdPath || await resolveNonRememberedInitialPath();
        const existingWorkspace = getSessionFileManagerWorkspace(sessionId);
        const repairedWorkspace = ensureForcedInitialFileManagerTab(existingWorkspace, forcedInitialPath, systemTerminalCwdPath || forcedInitialPath);
        const resolvedWorkspace = repairedWorkspace !== existingWorkspace
          ? setSessionFileManagerWorkspace(sessionId, (currentWorkspace) => ensureForcedInitialFileManagerTab(currentWorkspace, forcedInitialPath, systemTerminalCwdPath || forcedInitialPath))
          : repairedWorkspace;
        if (cancelled) {
          return;
        }
        fileManagerWorkspaceRef.current = resolvedWorkspace;
        setFileManagerWorkspaceState(resolvedWorkspace);
        const existingTab = resolvedWorkspace.tabs.find((tab) => tab.id === resolvedWorkspace.activeTabId) || resolvedWorkspace.tabs[0] || null;
        if (!existingTab) {
          return;
        }
        setSortField(existingTab.sortField || 'name');
        setSortDir(existingTab.sortDir === 'desc' ? 'desc' : 'asc');
        const nextSelectedPaths = Array.isArray(existingTab.selectedPaths) ? existingTab.selectedPaths : [];
        const tabPath = normalizePath(existingTab.path) || '/';
        const targetPath = tabPath;
        if (targetPath === currentPathRef.current) {
          displayedTabIdRef.current = existingTab.id;
          setSelectedPaths(nextSelectedPaths);
          lastClickedPathRef.current = nextSelectedPaths[nextSelectedPaths.length - 1] || null;
        } else {
          pendingTabSelectionRestoreRef.current = {
            selectedPaths: nextSelectedPaths,
            lastClickedPath: nextSelectedPaths[nextSelectedPaths.length - 1] || null,
          };
        }
        pendingViewRestoreRef.current = { scrollTop: Number(existingTab.scrollTop) || 0 };
        let ok = await loadDir(targetPath, {
          tabId: existingTab.id,
          silent: true,
          preserveView: false,
          trackDiff: false,
          showLoading: true,
        });
        if (!ok && isFileManagerTabLoadSuperseded(existingTab.id)) {
          return;
        }
        if (!ok && !cancelled && existingTab.pinned !== true) {
          pendingTabSelectionRestoreRef.current = { selectedPaths: [], lastClickedPath: null };
          pendingViewRestoreRef.current = { scrollTop: 0 };
          ok = await loadDir('/root', {
            tabId: existingTab.id,
            silent: true,
            preserveView: false,
            trackDiff: false,
            showLoading: true,
            preserveWorkspacePathOnSuccess: true,
          });
          if (!ok && isFileManagerTabLoadSuperseded(existingTab.id)) {
            return;
          }
          if (!ok) {
            await loadDir('/', {
              tabId: existingTab.id,
              silent: true,
              preserveView: false,
              trackDiff: false,
              showLoading: true,
              preserveWorkspacePathOnSuccess: true,
            });
          }
        }
      } finally {
        if (!cancelled) {
          initializingPathRef.current = false;
          // 初始化期间积压的 cwd 在此应用
          const pendingPath = normalizePath(pendingTerminalCwdRef.current);
          if (pendingPath && pendingPath !== currentPathRef.current) {
            void applyTerminalCwdFollow(pendingPath, { force: true, showLoading: false });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      initializingPathRef.current = false;
    };
  }, [applyTerminalCwdFollow, ensureForcedInitialFileManagerTab, isActive, loadDir, normalizePath, resolveNonRememberedInitialPath, sessionId]);

  // 始终订阅终端 cwd（不依赖 isActive），避免面板隐藏时丢事件
  useEffect(() => {
    if (!sessionId) return undefined;
    const off = EventsOn(`ssh-terminal-cwd-${sessionId}`, (cwd) => {
      void applyTerminalCwdFollow(cwd);
    });
    return () => {
      off?.();
    };
  }, [applyTerminalCwdFollow, sessionId]);

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
    void loadDir(newPath, {
      preserveView: false,
      trackDiff: false,
      showLoading: false,
      transitionMode: 'directory',
      transitionDirection: 'forward',
    });
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
    let shouldClosePanel = false;
    updateSessionUploadQueue(sessionGroupId, (current) => {
      const next = current.filter((item) => !normalizedIds.has(item.id));
      shouldClosePanel = next.length === 0;
      return next;
    });
    if (shouldClosePanel) {
      closeUploadPanel();
    }
  }, [closeUploadPanel, sessionGroupId]);

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

  const refreshDirectoryAfterTransfer = useCallback(async (targetPath) => {
    const normalizedTargetPath = normalizePath(targetPath) || '/';
    if (!normalizedTargetPath) {
      return;
    }
    if (normalizedTargetPath === currentPathRef.current) {
      await loadDir(currentPathRef.current, { preserveView: true, showLoading: false });
      return;
    }
    try {
      const nextItems = await AppGo.ListDir(sessionId, normalizedTargetPath);
      setSessionCachedFileManagerPathItems(
        sessionId,
        normalizedTargetPath,
        Array.isArray(nextItems) ? nextItems : [],
      );
    } catch (_) {}
  }, [loadDir, normalizePath, sessionId]);

  const uploadNativePaths = useCallback(async (paths) => {
    const localPaths = Array.from(paths || []).map((path) => String(path || '').trim()).filter(Boolean);
    if (localPaths.length === 0) {
      return;
    }
    const uploadTargetPath = normalizePath(currentPathRef.current || currentPath) || '/';
    openTransferQueueIfNeeded();
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
      remotePath: uploadTargetPath,
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
        uploadTargetPath,
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
      await refreshDirectoryAfterTransfer(uploadTargetPath);
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
  }, [sessionId, sessionGroupId, currentPath, addToast, t, getUploadSettings, openTransferQueueIfNeeded, normalizePath, refreshDirectoryAfterTransfer]);

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

    const uploadTargetPath = normalizePath(currentPathRef.current || currentPath) || '/';
    openTransferQueueIfNeeded();
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
        remotePath: joinPath(uploadTargetPath, entry.relativePath),
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
      taskId = await AppGo.BeginChunkedUploadTask(sessionId, uploadTargetPath, uploadPoolSize);

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
      await refreshDirectoryAfterTransfer(uploadTargetPath);
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
  }, [sessionId, sessionGroupId, currentPath, getUploadSettings, addToast, t, markUploadAborted, openTransferQueueIfNeeded, normalizePath, refreshDirectoryAfterTransfer]);

  useEffect(() => {
    const off = EventsOn('ssh-disconnected', (disconnectedSessionId) => {
      abortActiveUploadsForSession(disconnectedSessionId, t('已终止'));
    });
    return () => {
      off?.();
    };
  }, [abortActiveUploadsForSession, t]);

  useEffect(() => {
    if (!sessionId) return undefined;
    const offSynced = EventsOn('external-edit-synced', (payload = {}) => {
      if (payload.sessionId !== sessionId) return;
      const remotePath = payload.remotePath || '';
      addToast(`${t('外部编辑已同步到远程')}${remotePath ? `: ${remotePath}` : ''}`, 'success');
      // Refresh in-memory editor buffer if the same file is open internally.
      if (remotePath && openEditFilesRef.current.some((f) => f.path === remotePath)) {
        AppGo.ReadFile(sessionId, remotePath)
          .then((content) => {
            setOpenEditFiles((prev) => prev.map((f) => (f.path === remotePath ? { ...f, content } : f)));
          })
          .catch(() => {});
      }
    });
    const offError = EventsOn('external-edit-error', (payload = {}) => {
      if (payload.sessionId !== sessionId) return;
      addToast(`${t('外部编辑同步失败')}: ${payload.error || ''}`, 'error');
    });
    return () => {
      offSynced?.();
      offError?.();
    };
  }, [sessionId, addToast, t]);

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
  const handleCopyPath = (item, basePath = currentPath) => {
    let fullPath = joinPath(basePath, item.name);
    if (item.isDirectory && !fullPath.endsWith('/')) fullPath += '/';
    navigator.clipboard?.writeText(fullPath).then(() => {
      addToast(`${t('已复制')}: ${fullPath}`, 'success');
    }).catch(() => {
      addToast(t('复制失败'), 'error');
    });
  };

  const handleDownload = useCallback(async (item, options = {}) => {
    const basePath = typeof options === 'string' ? options : (options.basePath || currentPath);
    const remotePath = joinPath(basePath, item.name);
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
        openTransferQueueIfNeeded();
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
      openTransferQueueIfNeeded();
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
  }, [sessionId, sessionGroupId, currentPath, addToast, t, getDefaultDownloadDir, getDownloadConflictSettings, resolvePromptDownloadConflict, openTransferQueueIfNeeded]);

  const rememberExternalEditorPath = useCallback((path) => {
    const cleaned = String(path || '').trim();
    if (!cleaned) return;
    localStorage.setItem('fileEditorPreferredApp', cleaned);
    let recent = [];
    try {
      recent = JSON.parse(localStorage.getItem('fileEditorRecentApps') || '[]');
    } catch {
      recent = [];
    }
    if (!Array.isArray(recent)) recent = [];
    recent = [cleaned, ...recent.filter((item) => item !== cleaned)].slice(0, 5);
    localStorage.setItem('fileEditorRecentApps', JSON.stringify(recent));
  }, []);

  const openExternalEditor = useCallback(async (remotePath, content, editorPath = '') => {
    if (!sessionId || !remotePath) return false;
    setExternalOpening(true);
    try {
      if (editorPath) {
        await AppGo.OpenRemoteFileWithEditor(sessionId, remotePath, content || '', editorPath);
        rememberExternalEditorPath(editorPath);
        addToast(t('已用外部编辑器打开'), 'success');
      } else {
        await AppGo.OpenRemoteFileInSystemEditor(sessionId, remotePath, content || '');
        addToast(t('已用系统编辑器打开'), 'success');
      }
      return true;
    } catch (err) {
      addToast(`${t('打开外部编辑器失败')}: ${err}`, 'error');
      return false;
    } finally {
      setExternalOpening(false);
    }
  }, [sessionId, addToast, t, rememberExternalEditorPath]);

  const handleOpenSystemEditor = useCallback(async (file, content) => {
    if (!file?.path) return;
    await openExternalEditor(file.path, content ?? file.content ?? '');
  }, [openExternalEditor]);

  // forcePick=true：始终弹出选择框；false：有记忆路径则直接打开（对齐 electerm）
  const handleOpenWithEditor = useCallback(async (file, content, forcePick = false) => {
    if (!file?.path) return;
    try {
      let editorPath = '';
      if (!forcePick) {
        editorPath = (localStorage.getItem('fileEditorPreferredApp') || '').trim();
      }
      if (!editorPath) {
        editorPath = await AppGo.SelectExternalEditor();
        if (!editorPath) {
          addToast(t('未选择编辑器'), 'warning');
          return;
        }
      }
      const ok = await openExternalEditor(file.path, content ?? file.content ?? '', editorPath);
      // 记忆路径失效时，自动再选一次
      if (!ok && !forcePick && (localStorage.getItem('fileEditorPreferredApp') || '').trim()) {
        localStorage.removeItem('fileEditorPreferredApp');
        const nextPath = await AppGo.SelectExternalEditor();
        if (nextPath) {
          await openExternalEditor(file.path, content ?? file.content ?? '', nextPath);
        }
      }
    } catch (err) {
      addToast(`${t('打开外部编辑器失败')}: ${err}`, 'error');
    }
  }, [openExternalEditor, addToast, t]);

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
    if (sessionId && path) {
      AppGo.StopExternalEdit(sessionId, path).catch(() => {});
    }
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
    const prev = openEditFilesRef.current;
    if (sessionId) {
      prev.forEach((file) => {
        if (file?.path) AppGo.StopExternalEdit(sessionId, file.path).catch(() => {});
      });
    }
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

  const activateFileManagerTab = useCallback(async (tabId) => {
    if (!tabId || tabId === activeFileManagerTabIdRef.current) {
      return;
    }
    const currentWorkspace = syncCurrentTabToWorkspace({ scrollTop: fileListRef.current?.scrollTop || 0 }) || fileManagerWorkspace;
    const targetTab = currentWorkspace?.tabs?.find((tab) => tab.id === tabId);
    if (!targetTab) {
      return;
    }
    commitFileManagerWorkspace((current) => ({ ...current, activeTabId: tabId }));
    setSortField(targetTab.sortField || 'name');
    setSortDir(targetTab.sortDir === 'desc' ? 'desc' : 'asc');
    const nextSelectedPaths = Array.isArray(targetTab.selectedPaths) ? targetTab.selectedPaths : [];
    const targetPath = normalizePath(targetTab.path) || '/';
    const cachedItems = getCachedTabItems(tabId);
    const restoreSelectionAndScroll = () => {
      setSelectedPaths(nextSelectedPaths);
      lastClickedPathRef.current = nextSelectedPaths[nextSelectedPaths.length - 1] || null;
      requestAnimationFrame(() => {
        if (fileListRef.current) {
          fileListRef.current.scrollTop = Number(targetTab.scrollTop) || 0;
        }
      });
    };

    if (cachedItems) {
      if (targetPath !== currentPathRef.current) {
        pendingTabSelectionRestoreRef.current = {
          selectedPaths: nextSelectedPaths,
          lastClickedPath: nextSelectedPaths[nextSelectedPaths.length - 1] || null,
        };
        pendingViewRestoreRef.current = { scrollTop: Number(targetTab.scrollTop) || 0 };
      }
      applyAnimatedFileListSnapshot(targetPath, cachedItems, {
        tabId,
        preserveView: targetPath !== currentPathRef.current,
      });
      if (targetPath === currentPathRef.current) {
        restoreSelectionAndScroll();
      }
      await loadDir(targetPath, {
        tabId,
        silent: true,
        preserveView: true,
        trackDiff: true,
        showLoading: false,
      });
      return;
    }

    if (targetPath === currentPathRef.current) {
      displayedTabIdRef.current = tabId;
      restoreSelectionAndScroll();
      await loadDir(targetPath, {
        tabId,
        silent: true,
        preserveView: true,
        trackDiff: true,
        showLoading: false,
      });
      return;
    }

    pendingTabSelectionRestoreRef.current = {
      selectedPaths: nextSelectedPaths,
      lastClickedPath: nextSelectedPaths[nextSelectedPaths.length - 1] || null,
    };
    pendingViewRestoreRef.current = { scrollTop: Number(targetTab.scrollTop) || 0 };
    let resolvedPath = targetPath;
    let ok = await loadDir(targetPath, {
      tabId,
      silent: true,
      preserveView: false,
      trackDiff: false,
      showLoading: false,
      transitionMode: 'tab',
    });
    if (!ok && isFileManagerTabLoadSuperseded(tabId)) {
      return;
    }
    if (!ok && targetPath !== '/') {
      pendingTabSelectionRestoreRef.current = { selectedPaths: [], lastClickedPath: null };
      pendingViewRestoreRef.current = { scrollTop: 0 };
      resolvedPath = '/';
      ok = await loadDir('/', {
        tabId,
        silent: true,
        preserveView: false,
        trackDiff: false,
        showLoading: false,
        transitionMode: 'tab',
      });
      if (ok) {
        setSelectedPaths([]);
      }
    }
    if (ok && resolvedPath !== targetPath && targetTab?.pinned !== true) {
      commitFileManagerWorkspace((current) => ({
        activeTabId: current.activeTabId,
        tabs: (current.tabs || []).map((tab) => (
          tab.id === tabId
            ? { ...tab, path: resolvedPath, selectedPaths: [], scrollTop: 0 }
            : tab
        )),
      }));
    }
  }, [commitFileManagerWorkspace, fileManagerWorkspace, getCachedTabItems, loadDir, normalizePath, syncCurrentTabToWorkspace, applyAnimatedFileListSnapshot]);

  const resolveNewFileManagerTabPath = useCallback(async () => {
    const mode = getFileManagerNewTabPathMode();
    const activeTabPath = normalizePath(currentPathRef.current);
    const normalizedInitialPath = normalizePath(initialPath);
    if (mode === FILE_MANAGER_NEW_TAB_PATH_MODE_ROOT) {
      return '/';
    }
    if (mode === FILE_MANAGER_NEW_TAB_PATH_MODE_SESSION_INITIAL_PATH) {
      if (normalizedInitialPath) {
        return normalizedInitialPath;
      }
      try {
        const cwd = await AppGo.GetTerminalCwd(sessionId);
        const normalizedCwd = normalizePath(cwd);
        if (normalizedCwd) {
          return normalizedCwd;
        }
      } catch (_) {}
    }
    if (mode === FILE_MANAGER_NEW_TAB_PATH_MODE_TERMINAL_CWD) {
      try {
        const cwd = await AppGo.GetTerminalCwd(sessionId);
        const normalizedCwd = normalizePath(cwd);
        if (normalizedCwd) {
          return normalizedCwd;
        }
      } catch (_) {}
    }
    if (mode === FILE_MANAGER_NEW_TAB_PATH_MODE_INHERIT_CURRENT && activeTabPath) {
      return activeTabPath;
    }
    if (activeTabPath) {
      return activeTabPath;
    }
    return '/';
  }, [initialPath, normalizePath, sessionId]);

  const openFileManagerPathInNewTab = useCallback(async (targetPath) => {
    const normalizedTargetPath = normalizePath(targetPath) || '/';
    const fallbackCurrentPath = normalizePath(currentPathRef.current) || '/';
    const candidatePaths = Array.from(new Set([normalizedTargetPath, getParentPath(normalizedTargetPath), fallbackCurrentPath, '/']));
    const nextTab = createFileManagerTab(normalizedTargetPath);
    commitFileManagerWorkspace((current) => ({
      activeTabId: nextTab.id,
      tabs: [...(Array.isArray(current?.tabs) ? current.tabs : []), nextTab],
    }));
    setSortField(nextTab.sortField);
    setSortDir(nextTab.sortDir);
    if (candidatePaths[0] === currentPathRef.current) {
      displayedTabIdRef.current = nextTab.id;
      cacheCurrentTabItems(nextTab.id, items);
      setSelectedPaths([]);
      lastClickedPathRef.current = null;
      requestAnimationFrame(() => {
        if (fileListRef.current) {
          fileListRef.current.scrollTop = 0;
        }
      });
      return;
    }
    pendingTabSelectionRestoreRef.current = { selectedPaths: [], lastClickedPath: null };
    pendingViewRestoreRef.current = { scrollTop: 0 };
    let resolvedPath = candidatePaths[0];
    for (const candidatePath of candidatePaths) {
      const ok = await loadDir(candidatePath, {
        tabId: nextTab.id,
        silent: true,
        preserveView: false,
        trackDiff: false,
        showLoading: false,
        transitionMode: 'tab',
      });
      if (!ok && isFileManagerTabLoadSuperseded(nextTab.id)) {
        return;
      }
      if (ok) {
        resolvedPath = candidatePath;
        break;
      }
    }
    if (resolvedPath !== normalizedTargetPath) {
      commitFileManagerWorkspace((current) => ({
        activeTabId: current.activeTabId,
        tabs: (current.tabs || []).map((tab) => (
          tab.id === nextTab.id
            ? { ...tab, path: resolvedPath }
            : tab
        )),
      }));
    }
  }, [cacheCurrentTabItems, commitFileManagerWorkspace, items, loadDir, normalizePath]);
  openFileManagerPathInNewTabRef.current = openFileManagerPathInNewTab;

  const handleCreateFileManagerTab = useCallback(async () => {
    const nextPath = await resolveNewFileManagerTabPath();
    await openFileManagerPathInNewTab(nextPath);
  }, [openFileManagerPathInNewTab, resolveNewFileManagerTabPath]);

  const clearFileManagerTabDragState = useCallback(() => {
    draggingFileManagerTabIdRef.current = '';
    setDraggingFileManagerTabId('');
    setFileManagerTabDropIndicator(null);
  }, []);

  const resolveFileManagerTabDropSide = useCallback((event, tab) => {
    if (tab?.systemPinned === true) {
      return 'after';
    }
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
  }, []);

  const getFileManagerTabDropPreviewText = useCallback((draggedTabId, targetTab, side = 'after') => {
    if (!draggedTabId || !targetTab) {
      return '';
    }
    const currentTabs = Array.isArray(fileManagerWorkspaceRef.current?.tabs) ? fileManagerWorkspaceRef.current.tabs : [];
    const draggedTab = currentTabs.find((tab) => tab.id === draggedTabId);
    if (!draggedTab || draggedTab.id === targetTab.id) {
      return '';
    }
    const nextPinned = targetTab.systemPinned === true || targetTab.pinned === true;
    const positionText = t(
      side === 'before' ? '在 {label} 标签页之前,' : '在 {label} 标签页之后,',
      { label: getFileManagerTabLabel(targetTab.path, t, targetTab.customTitle) },
    );
    const stateText = draggedTab.pinned === nextPinned
      ? t(nextPinned ? '并保持固定' : '并保持未固定')
      : t(nextPinned ? '并进行固定' : '并解除固定');
    return `${positionText}${stateText}`;
  }, [t]);

  const resolveFileManagerTabAppendTarget = useCallback(() => {
    const currentTabs = Array.isArray(fileManagerWorkspaceRef.current?.tabs) ? fileManagerWorkspaceRef.current.tabs : [];
    const movableTabs = currentTabs.filter((tab) => tab && typeof tab === 'object' && tab.systemPinned !== true);
    return movableTabs[movableTabs.length - 1] || currentTabs[currentTabs.length - 1] || null;
  }, []);

  const reorderFileManagerTabs = useCallback((draggedTabId, targetTabId, side = 'after') => {
    if (!draggedTabId || !targetTabId || draggedTabId === targetTabId) {
      return;
    }
    commitFileManagerWorkspace((current) => {
      const currentTabs = Array.isArray(current?.tabs) ? current.tabs.filter((tab) => tab && typeof tab === 'object') : [];
      const draggedTab = currentTabs.find((tab) => tab.id === draggedTabId);
      const targetTab = currentTabs.find((tab) => tab.id === targetTabId);
      if (!draggedTab || !targetTab || draggedTab.systemPinned === true) {
        return current;
      }
      const systemPinnedTabs = currentTabs.filter((tab) => tab.systemPinned === true);
      const pinnedTabs = currentTabs.filter((tab) => tab.systemPinned !== true && tab.id !== draggedTabId && tab.pinned === true);
      const normalTabs = currentTabs.filter((tab) => tab.systemPinned !== true && tab.id !== draggedTabId && tab.pinned !== true);
      const nextPinned = targetTab.systemPinned === true || targetTab.pinned === true;
      const draggedNextTab = { ...draggedTab, pinned: nextPinned, systemPinned: false };
      const targetGroup = nextPinned ? pinnedTabs : normalTabs;
      let insertIndex = 0;
      if (targetTab.systemPinned === true) {
        insertIndex = 0;
      } else {
        const targetIndex = targetGroup.findIndex((tab) => tab.id === targetTabId);
        insertIndex = targetIndex < 0 ? targetGroup.length : (side === 'before' ? targetIndex : targetIndex + 1);
      }
      targetGroup.splice(insertIndex, 0, draggedNextTab);
      return {
        activeTabId: current?.activeTabId || draggedNextTab.id,
        tabs: [...systemPinnedTabs, ...pinnedTabs, ...normalTabs],
      };
    });
  }, [commitFileManagerWorkspace]);

  const handleToggleFileManagerTabPinned = useCallback((tabId) => {
    commitFileManagerWorkspace((current) => ({
      activeTabId: current?.activeTabId || '',
      tabs: (current?.tabs || []).map((tab) => (
        tab.id === tabId && tab.systemPinned !== true
          ? { ...tab, pinned: tab.pinned !== true }
          : tab
      )),
    }));
  }, [commitFileManagerWorkspace]);

  const handleCloseFileManagerTab = useCallback(async (tabId, event) => {
    event?.stopPropagation();
    const currentWorkspace = syncCurrentTabToWorkspace({ scrollTop: fileListRef.current?.scrollTop || 0 }) || fileManagerWorkspace;
    const currentTabs = Array.isArray(currentWorkspace?.tabs) ? currentWorkspace.tabs : [];
    if (currentTabs.length <= 1) {
      return;
    }
    const targetTab = currentTabs.find((tab) => tab.id === tabId);
    if (!targetTab) {
      return;
    }
    if (targetTab.pinned === true) {
      addToast(t('固定标签不能关闭'), 'warning');
      return;
    }
    const closingIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex < 0) {
      return;
    }
    const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
    const isClosingActive = tabId === activeFileManagerTabIdRef.current;
    const nextActiveTab = isClosingActive
      ? (nextTabs[closingIndex] || nextTabs[closingIndex - 1] || nextTabs[0] || null)
      : (nextTabs.find((tab) => tab.id === activeFileManagerTabIdRef.current) || nextTabs[0] || null);
    removeCachedTabItems(tabId);
    commitFileManagerWorkspace({
      activeTabId: nextActiveTab?.id || '',
      tabs: nextTabs,
    });
    if (!isClosingActive || !nextActiveTab) {
      return;
    }
    setSortField(nextActiveTab.sortField || 'name');
    setSortDir(nextActiveTab.sortDir === 'desc' ? 'desc' : 'asc');
    const nextSelectedPaths = Array.isArray(nextActiveTab.selectedPaths) ? nextActiveTab.selectedPaths : [];
    const targetPath = normalizePath(nextActiveTab.path) || '/';
    const cachedItems = getCachedTabItems(nextActiveTab.id);
    const restoreSelectionAndScroll = () => {
      setSelectedPaths(nextSelectedPaths);
      lastClickedPathRef.current = nextSelectedPaths[nextSelectedPaths.length - 1] || null;
      requestAnimationFrame(() => {
        if (fileListRef.current) {
          fileListRef.current.scrollTop = Number(nextActiveTab.scrollTop) || 0;
        }
      });
    };

    if (cachedItems) {
      if (targetPath !== currentPathRef.current) {
        pendingTabSelectionRestoreRef.current = {
          selectedPaths: nextSelectedPaths,
          lastClickedPath: nextSelectedPaths[nextSelectedPaths.length - 1] || null,
        };
        pendingViewRestoreRef.current = { scrollTop: Number(nextActiveTab.scrollTop) || 0 };
      }
      applyAnimatedFileListSnapshot(targetPath, cachedItems, {
        tabId: nextActiveTab.id,
        preserveView: targetPath !== currentPathRef.current,
      });
      if (targetPath === currentPathRef.current) {
        restoreSelectionAndScroll();
      }
      await loadDir(targetPath, {
        tabId: nextActiveTab.id,
        silent: true,
        preserveView: true,
        trackDiff: true,
        showLoading: false,
      });
      return;
    }

    if (targetPath === currentPathRef.current) {
      displayedTabIdRef.current = nextActiveTab.id;
      restoreSelectionAndScroll();
      await loadDir(targetPath, {
        tabId: nextActiveTab.id,
        silent: true,
        preserveView: true,
        trackDiff: true,
        showLoading: false,
      });
      return;
    }

    pendingTabSelectionRestoreRef.current = {
      selectedPaths: nextSelectedPaths,
      lastClickedPath: nextSelectedPaths[nextSelectedPaths.length - 1] || null,
    };
    pendingViewRestoreRef.current = { scrollTop: Number(nextActiveTab.scrollTop) || 0 };
    await loadDir(targetPath, {
      tabId: nextActiveTab.id,
      silent: true,
      preserveView: false,
      trackDiff: false,
      showLoading: false,
      transitionMode: 'tab',
    });
  }, [addToast, applyAnimatedFileListSnapshot, commitFileManagerWorkspace, fileManagerWorkspace, getCachedTabItems, loadDir, normalizePath, removeCachedTabItems, syncCurrentTabToWorkspace, t]);

  // Delete
  const handleDelete = async (item) => {
    if (operationInProgressRef.current) return;
    operationInProgressRef.current = true;
    const remotePath = joinPath(currentPath, item.name);
    const needConfirm = localStorage.getItem('skipFileDeleteConfirm') !== 'true';
    if (needConfirm) {
      const ok = await window.luminDialog?.confirm(`${t('确定删除')}${item.name}${t('？此操作不可撤销')}`);
      fileListRef.current?.focus();
      if (!ok) { operationInProgressRef.current = false; return; }
    }
    try {
      setOperationProgress({ message: `${t('正在删除')} ${item.name}` });
      await AppGo.DeleteItemShell(sessionId, remotePath);
      const deletedPlaceholder = createDeletedPlaceholder(item, remotePath);
      setSelectedPaths(prev => prev.filter(p => p !== remotePath));
      if (lastClickedPathRef.current === remotePath) {
        lastClickedPathRef.current = null;
      }
      queueRowEffect(remotePath, deletedPlaceholder.__rowKey, 'removed');
      updateItemsPreservingView((prev) => prev.map((entry) => (
        entry.name === item.name ? deletedPlaceholder : entry
      )));
    } catch (err) {
      addToast(`${t('删除失败')}: ${err}`, 'error');
    } finally {
      setOperationProgress(null);
      operationInProgressRef.current = false;
      fileListRef.current?.focus();
    }
  };

  // Delete via rm -rf
  const handleDeleteShell = async (item) => {
    if (operationInProgressRef.current) return;
    operationInProgressRef.current = true;
    const remotePath = joinPath(currentPath, item.name);
    const needConfirm = localStorage.getItem('skipFileDeleteConfirm') !== 'true';
    if (needConfirm) {
      const ok = await window.luminDialog?.confirm(`${t('确定删除')}${item.name}${t('？(rm -rf) 此操作不可撤销')}`);
      fileListRef.current?.focus();
      if (!ok) { operationInProgressRef.current = false; return; }
    }
    try {
      setOperationProgress({ message: `${t('正在删除')} ${item.name}` });
      await AppGo.DeleteItemShell(sessionId, remotePath);
      const deletedPlaceholder = createDeletedPlaceholder(item, remotePath);
      setSelectedPaths(prev => prev.filter(p => p !== remotePath));
      if (lastClickedPathRef.current === remotePath) {
        lastClickedPathRef.current = null;
      }
      queueRowEffect(remotePath, deletedPlaceholder.__rowKey, 'removed');
      updateItemsPreservingView((prev) => prev.map((entry) => (
        entry.name === item.name ? deletedPlaceholder : entry
      )));
    } catch (err) {
      addToast(`${t('删除失败')}: ${err}`, 'error');
    } finally {
      setOperationProgress(null);
      operationInProgressRef.current = false;
      fileListRef.current?.focus();
    }
  };

  // Delete multiple selected items
  const handleDeleteItems = async () => {
    if (operationInProgressRef.current) return;
    if (selectedPaths.length === 0) return;
    operationInProgressRef.current = true;
    const dirSet = new Set(items.filter(i => i.isDirectory).map(i => joinPath(currentPath, i.name)));
    const needConfirm = localStorage.getItem('skipFileDeleteConfirm') !== 'true';
    if (needConfirm) {
      const ok = await window.luminDialog?.confirm(`${t('确定删除所选')} (${selectedPaths.length}${t('项')})${t('？此操作不可撤销')}`);
      fileListRef.current?.focus();
      if (!ok) { operationInProgressRef.current = false; return; }
    }
    let successCount = 0;
    let failCount = 0;
    const removedPaths = [];
    const total = selectedPaths.length;
    setOperationProgress({ message: t('正在删除中...'), current: 0, total });
    try {
      for (let i = 0; i < total; i++) {
        const path = selectedPaths[i];
        const name = path.split('/').pop();
        setOperationProgress({ message: `${t('正在删除')} ${name}`, current: i + 1, total });
        try {
          await AppGo.DeleteItemShell(sessionId, path);
          successCount++;
          removedPaths.push(path);
        } catch (err) {
          failCount++;
          console.error('delete item failed:', path, err);
        }
      }
    } finally {
      setOperationProgress(null);
      operationInProgressRef.current = false;
    }
    if (successCount > 0) addToast(`${t('已删除')} ${successCount} ${t('项')}`, 'success');
    if (failCount > 0) addToast(`${t('删除失败')}: ${failCount} ${t('项')}`, 'error');
    const deletedPlaceholders = new Map(removedPaths.map((path) => {
      const existingItem = items.find((entry) => joinPath(currentPath, entry.name) === path);
      const fallbackName = path.split('/').pop() || '';
      const placeholder = createDeletedPlaceholder(existingItem || {
        name: fallbackName,
        isDirectory: dirSet.has(path),
        size: 0,
        permission: '',
        mode: '',
        modifyTime: Date.now(),
      }, path);
      queueRowEffect(path, placeholder.__rowKey, 'removed');
      return [path, placeholder];
    }));
    if (lastClickedPathRef.current && removedPaths.includes(lastClickedPathRef.current)) {
      lastClickedPathRef.current = null;
    }
    setSelectedPaths([]);
    updateItemsPreservingView((prev) => prev.map((entry) => {
      const logicalPath = joinPath(currentPath, entry.name);
      return deletedPlaceholders.get(logicalPath) || entry;
    }));
    fileListRef.current?.focus();
  };

  // Keyboard shortcuts for file list
  const handleFileListKeyDown = (e) => {
    if (operationInProgressRef.current) return;
    if (renamingItem) return;
    const isCtrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Del') {
      e.preventDefault();
      void handleDeleteItems();
      return;
    }
    if (isCtrl && e.key === 'a') {
      e.preventDefault();
      setSelectedPaths(sortedItems.filter((item) => !isDeletedPlaceholderItem(item)).map(i => joinPath(currentPath, i.name)));
      return;
    }
    if (isCtrl && e.key === 'c') {
      e.preventDefault();
      if (selectedPaths.length === 0) return;
      updateClipboard({ paths: [...selectedPaths], mode: 'copy', srcDir: currentPath });
      addToast(t('已复制'), 'info');
      return;
    }
    if (isCtrl && e.key === 'x') {
      e.preventDefault();
      if (selectedPaths.length === 0) return;
      updateClipboard({ paths: [...selectedPaths], mode: 'cut', srcDir: currentPath });
      addToast(t('已剪切'), 'info');
      return;
    }
    if (isCtrl && e.key === 'v') {
      e.preventDefault();
      if (!clipboard) return;
      void handlePaste();
      return;
    }
  };

  const handlePaste = async () => {
    if (operationInProgressRef.current) return;
    if (!clipboard || clipboard.paths.length === 0) return;
    if (clipboard.srcDir === currentPath && clipboard.mode === 'cut') {
      addToast(t('源目录与目标目录相同，无需移动'), 'warning');
      return;
    }
    operationInProgressRef.current = true;
    let count = 0;
    // 注意：existing 在循环内会被更新，反映本次粘贴已产生的文件名，避免同批同名互覆盖
    const existing = new Set(items.map(i => i.name));
    const localPatchedItems = [];
    let shouldFallbackRefresh = false;
    const total = clipboard.paths.length;
    setOperationProgress({ message: t('正在粘贴中...'), current: 0, total });
    try {
      for (let i = 0; i < total; i++) {
        const srcPath = clipboard.paths[i];
        const name = srcPath.split('/').pop();
        const sourceItem = clipboard.srcDir === currentPath
          ? items.find((entry) => entry.name === name)
          : null;
        let destPath = joinPath(currentPath, name);
        let destName = name;
        if (clipboard.mode === 'copy' && clipboard.srcDir === currentPath) {
          const base = name.replace(/(\.[^.]+)$/, '');
          const ext = name !== base ? name.slice(base.length) : '';
          let copyName = `${base}_copy${ext}`;
          let idx = 1;
          while (existing.has(copyName)) {
            idx++;
            copyName = `${base}_copy${idx}${ext}`;
          }
          destName = copyName;
          destPath = joinPath(currentPath, copyName);
        } else {
          if (existing.has(name)) {
            // 确认对话框缺失时显式报错并跳过，避免静默吞掉覆盖操作
            if (typeof window.luminDialog?.confirm !== 'function') {
              addToast(`${t('无法确认覆盖操作，已跳过')} ${name}`, 'error');
              continue;
            }
            const ok = await window.luminDialog.confirm(
              `${t('目标已存在同名项目')} "${name}"${t('，是否覆盖？')}`
            );
            if (!ok) continue;
          }
        }

        // Only update progress and show the copy/move text after confirmation passes
        setOperationProgress({
          message: `${clipboard.mode === 'copy' ? t('正在复制') : t('正在移动')} ${name}`,
          current: i + 1,
          total
        });
        try {
          if (clipboard.mode === 'copy') {
            await AppGo.CopyItem(sessionId, srcPath, destPath);
          } else {
            await AppGo.MoveItem(sessionId, srcPath, destPath);
          }
          // 把刚产生的目标名加入 existing，让同批后续迭代可见
          existing.add(destName);
          count++;
          if (clipboard.mode === 'copy' && sourceItem) {
            localPatchedItems.push(createLocalItemShell(destName, sourceItem.isDirectory, {
              ...sourceItem,
              name: destName,
            }));
          } else {
            shouldFallbackRefresh = true;
          }
        } catch (err) {
          addToast(`${t('操作失败')}: ${name} - ${err}`, 'error');
        }
      }
    } finally {
      setOperationProgress(null);
      operationInProgressRef.current = false;
    }
    if (count > 0) {
      addToast(`${t('操作完成')}: ${count} ${t('项')}`, 'success');
      // cut 成功移动后清空剪贴板，避免对已移动的源再次粘贴（标准文件管理器行为）
      if (clipboard.mode === 'cut') {
        updateClipboard(null);
      }
      if (!shouldFallbackRefresh && localPatchedItems.length === count) {
        localPatchedItems.forEach((localItem) => {
          const logicalPath = joinPath(currentPath, localItem.name);
          queueRowEffect(logicalPath, logicalPath, 'added');
        });
        updateItemsPreservingView((prev) => localPatchedItems.reduce(
          (next, localItem) => upsertLocalItem(next, localItem),
          prev,
        ));
      } else {
        await loadDir(currentPath, { preserveView: true, showLoading: false });
      }
    }
  };

  // Create directory
  const handleMkdir = async (targetDirPath = currentPath) => {
    const name = await window.luminDialog?.prompt(t('新文件夹名称:'));
    if (!name) return;
    const remotePath = joinPath(targetDirPath, name);
    try {
      await AppGo.Mkdir(sessionId, remotePath);
      addToast(`${t('文件夹创建成功')}: ${name}`, 'success');
      if (targetDirPath === currentPathRef.current) {
        queueRowEffect(remotePath, remotePath, 'added');
        updateItemsPreservingView((prev) => upsertLocalItem(prev, createLocalItemShell(name, true)));
      }
    } catch (err) {
      addToast(`${t('创建失败')}: ${err}`, 'error');
    }
  };

  // Create file
  const handleNewFile = async (targetDirPath = currentPath) => {
    const name = await window.luminDialog?.prompt(t('新文件名称:'));
    if (!name) return;
    const remotePath = joinPath(targetDirPath, name);
    try {
      await AppGo.WriteFile(sessionId, remotePath, '');
      addToast(`${t('文件创建成功')}: ${name}`, 'success');
      if (targetDirPath === currentPathRef.current) {
        queueRowEffect(remotePath, remotePath, 'added');
        updateItemsPreservingView((prev) => upsertLocalItem(prev, createLocalItemShell(name, false)));
      }
    } catch (err) {
      addToast(`${t('创建失败')}: ${err}`, 'error');
    }
  };

  const updateFileManagerTabPath = useCallback((tabId, nextPath, options = {}) => {
    const normalizedNextPath = normalizePath(nextPath) || '/';
    const resetSelection = options.resetSelection === true;
    const clearCache = options.clearCache === true;
    if (clearCache) {
      removeCachedTabItems(tabId);
    }
    commitFileManagerWorkspace((current) => ({
      activeTabId: current.activeTabId,
      tabs: (current.tabs || []).map((tab) => (
        tab.id === tabId
          ? {
              ...tab,
              path: normalizedNextPath,
              selectedPaths: resetSelection ? [] : tab.selectedPaths,
              scrollTop: resetSelection ? 0 : tab.scrollTop,
            }
          : tab
      )),
    }));
    if (tabId === activeFileManagerTabIdRef.current) {
      displayedTabIdRef.current = tabId;
      currentPathHydratedRef.current = true;
      currentPathRef.current = normalizedNextPath;
      setCurrentPath(normalizedNextPath);
      if (resetSelection) {
        setSelectedPaths([]);
        lastClickedPathRef.current = null;
      }
    }
  }, [commitFileManagerWorkspace, normalizePath, removeCachedTabItems]);

  const handleRenameFileManagerTabTitle = useCallback(async (tabId) => {
    const targetTab = (fileManagerWorkspaceRef.current?.tabs || []).find((tab) => tab.id === tabId);
    if (!targetTab) {
      return;
    }
    if (targetTab.systemPinned === true) {
      addToast(t('初始目录标签不可修改'), 'warning');
      return;
    }
    const currentCustomTitle = String(targetTab.customTitle || '').trim();
    const currentLabel = getFileManagerTabLabel(targetTab.path, t, currentCustomTitle);
    const defaultLabel = getFileManagerTabLabel(targetTab.path, t, '');
    const nextTitle = await window.luminDialog?.prompt(`${t('标签标题')}: ${currentLabel}`);
    if (nextTitle === null || nextTitle === undefined) {
      return;
    }
    const trimmedTitle = String(nextTitle).trim();
    const resolvedCustomTitle = trimmedTitle && trimmedTitle !== defaultLabel ? trimmedTitle : '';
    if (resolvedCustomTitle === currentCustomTitle) {
      return;
    }
    commitFileManagerWorkspace((current) => ({
      activeTabId: current?.activeTabId || '',
      tabs: (current?.tabs || []).map((tab) => (
        tab.id === tabId
          ? { ...tab, customTitle: resolvedCustomTitle }
          : tab
      )),
    }));
  }, [addToast, commitFileManagerWorkspace, t]);

  const handleDeleteTabDirectory = useCallback(async (tabId, targetPath, useShell = false) => {
    const normalizedTargetPath = normalizePath(targetPath) || '/';
    const targetTab = (fileManagerWorkspace?.tabs || []).find((tab) => tab.id === tabId);
    if (targetTab?.systemPinned === true) {
      addToast(t('初始目录标签不可修改'), 'warning');
      return;
    }
    if (targetTab?.pinned === true) {
      addToast(t('固定标签路径不可变，请先取消固定'), 'warning');
      return;
    }
    const displayName = normalizedTargetPath === '/' ? t('目录根') : (normalizedTargetPath.split('/').filter(Boolean).pop() || normalizedTargetPath);
    const needConfirm = localStorage.getItem('skipFileDeleteConfirm') !== 'true';
    if (needConfirm) {
      const ok = await window.luminDialog?.confirm(
        useShell
          ? `${t('确定删除')}${displayName}${t('？(rm -rf) 此操作不可撤销')}`
          : `${t('确定删除')}${displayName}${t('？此操作不可撤销')}`
      );
      fileListRef.current?.focus();
      if (!ok) {
        return;
      }
    }
    const parentPath = getParentPath(normalizedTargetPath);
    try {
      await AppGo.DeleteItemShell(sessionId, normalizedTargetPath);
      addToast(`${t('已删除')}: ${displayName}`, 'success');
      updateFileManagerTabPath(tabId, parentPath, { resetSelection: true, clearCache: true });
      if (tabId === activeFileManagerTabIdRef.current) {
        await loadDir(parentPath, {
          tabId,
          silent: true,
          preserveView: false,
          trackDiff: false,
          showLoading: false,
          transitionMode: 'directory',
        });
      }
    } catch (err) {
      addToast(`${t('删除失败')}: ${err}`, 'error');
    }
  }, [addToast, fileManagerWorkspace, loadDir, normalizePath, sessionId, t, updateFileManagerTabPath]);

  // Compress
  const handleCompress = async (item, options = {}) => {
    const basePath = typeof options === 'string' ? options : (options.basePath || currentPath);
    const remotePath = joinPath(basePath, item.name);
    try {
      addToast(`${t('正在压缩')} ${item.name}...`, 'info');
      await AppGo.CompressItem(sessionId, remotePath);
      addToast(t('压缩成功'), 'success');
      if (basePath === currentPathRef.current) {
        await loadDir(currentPathRef.current, { preserveView: true, showLoading: false });
      }
    } catch (err) {
      addToast(`${t('压缩失败')}: ${err}`, 'error');
    }
  };

  // Uncompress
  const handleUncompress = async (item, options = {}) => {
    const basePath = typeof options === 'string' ? options : (options.basePath || currentPath);
    const remotePath = joinPath(basePath, item.name);
    try {
      addToast(`${t('正在解压')} ${item.name}...`, 'info');
      await AppGo.UncompressItem(sessionId, remotePath);
      addToast(t('解压成功'), 'success');
      if (basePath === currentPathRef.current) {
        await loadDir(currentPathRef.current, { preserveView: true, showLoading: false });
      }
    } catch (err) {
      addToast(`${t('解压失败')}: ${err}`, 'error');
    }
  };

  // Rename
  const startRename = (item) => {
    setRenamingItem(item);
    setRenameValue(item.name);
  };

  const confirmRename = async (refocus = false) => {
    const nextName = renameValue.trim();
    if (!renamingItem || !nextName || nextName === renamingItem.name) {
      setRenamingItem(null);
      if (refocus) fileListRef.current?.focus();
      return;
    }
    const oldPath = joinPath(currentPath, renamingItem.name);
    const newPath = joinPath(currentPath, nextName);
    try {
      await AppGo.RenameItem(sessionId, oldPath, newPath);
      addToast(t('重命名成功'), 'success');
      const anchor = captureFileListViewAnchor();
      if (anchor?.key === oldPath) {
        anchor.key = newPath;
      }
      setSelectedPaths((prev) => prev.map((path) => (path === oldPath ? newPath : path)));
      if (lastClickedPathRef.current === oldPath) {
        lastClickedPathRef.current = newPath;
      }
      pendingVisualEffectsRef.current.delete(oldPath);
      clearActiveRowEffect(oldPath);
      queueRowEffect(newPath, newPath, 'changed');
      updateItemsPreservingView((prev) => prev.map((entry) => (
        entry.name === renamingItem.name
          ? { ...entry, name: nextName, modifyTime: Date.now() }
          : entry
      )), anchor);
    } catch (err) {
      addToast(`${t('重命名失败')}: ${err}`, 'error');
    } finally {
      setRenamingItem(null);
      if (refocus) fileListRef.current?.focus();
    }
  };

  const closeContextMenu = () => setContextMenu(null);

  const openChmodTarget = useCallback(async (itemPath, item) => {
    let rememberedMode = '';
    let rememberedIncludeSubdirectories = false;
    let rememberedAutoApplyLastSettings = false;
    try {
      const settings = await AppGo.GetChmodDialogSettings();
      rememberedMode = normalizeChmodMode(settings?.mode);
      rememberedIncludeSubdirectories = settings?.includeSubdirectories === true;
      rememberedAutoApplyLastSettings = settings?.autoApplyLastSettings === true;
    } catch (_) {}
    let resolvedItem = item;
    const getPathOwnership = window?.go?.main?.App?.GetPathOwnership;
    const needsMetadata = !item?.permission || !item?.mode || !item?.uid || item?.uid === '-' || !item?.gid || item?.gid === '-';
    if (needsMetadata && typeof getPathOwnership === 'function') {
      try {
        const ownership = await getPathOwnership(sessionId, itemPath);
        if (ownership && typeof ownership === 'object') {
          resolvedItem = {
            ...item,
            permission: ownership.permission || item?.permission || '',
            mode: ownership.mode || item?.mode || '',
            uid: ownership.uid || item?.uid || '-',
            gid: ownership.gid || item?.gid || '-',
          };
        }
      } catch (error) {
        console.warn('GetPathOwnership failed:', error);
      }
    }
    const actualMode = normalizeChmodMode(resolvedItem?.mode);
    setChmodTarget({
      item: resolvedItem,
      path: itemPath,
      mode: actualMode || '',
      rememberedMode,
      autoApplyLastSettings: rememberedAutoApplyLastSettings,
      ownerCandidates: [],
      groupCandidates: [],
      includeSubdirectories: rememberedIncludeSubdirectories,
      showIncludeSubdirectories: resolvedItem.isDirectory,
    });
    const listOwnershipCandidates = window?.go?.main?.App?.ListOwnershipCandidates;
    if (typeof listOwnershipCandidates !== 'function') {
      return;
    }
    try {
      const nextCandidates = await listOwnershipCandidates(sessionId);
      setChmodTarget((current) => {
        if (!current || current.path !== itemPath) {
          return current;
        }
        return {
          ...current,
          ownerCandidates: Array.isArray(nextCandidates?.users) ? nextCandidates.users : [],
          groupCandidates: Array.isArray(nextCandidates?.groups) ? nextCandidates.groups : [],
        };
      });
    } catch (error) {
      console.warn('ListOwnershipCandidates failed:', error);
    }
  }, [sessionId]);

  // Chmod
  const handleChmod = async (item, basePath = currentPath) => {
    const itemPath = joinPath(basePath, item.name);
    await openChmodTarget(itemPath, item);
  };

  const handleChmodSave = async (modeStr, includeSubdirectories, ownerValue, groupValue) => {
    if (!chmodTarget) return;
    const normalizedMode = normalizeChmodMode(modeStr) || '644';
    const currentMode = normalizeChmodMode(chmodTarget.item?.mode) || normalizeChmodMode(chmodTarget.mode) || normalizedMode;
    const modeChanged = normalizedMode !== currentMode;
    const rememberedIncludeSubdirectories = Boolean(includeSubdirectories);
    const recursive = Boolean(chmodTarget.showIncludeSubdirectories && rememberedIncludeSubdirectories);
    const ownerCandidates = Array.isArray(chmodTarget.ownerCandidates) ? chmodTarget.ownerCandidates : [];
    const groupCandidates = Array.isArray(chmodTarget.groupCandidates) ? chmodTarget.groupCandidates : [];
    const currentOwnerId = normalizeIdentityId(chmodTarget.item.uid);
    const currentGroupId = normalizeIdentityId(chmodTarget.item.gid);
    const ownerChanged = resolveIdentityCompareKey(ownerValue, ownerCandidates, currentOwnerId) !== (currentOwnerId ? `id:${currentOwnerId}` : '');
    const groupChanged = resolveIdentityCompareKey(groupValue, groupCandidates, currentGroupId) !== (currentGroupId ? `id:${currentGroupId}` : '');
    const ownerSpec = ownerChanged ? resolveIdentityInputSpec(ownerValue, ownerCandidates, currentOwnerId) : '';
    const groupSpec = groupChanged ? resolveIdentityInputSpec(groupValue, groupCandidates, currentGroupId) : '';
    if (!modeChanged && !ownerChanged && !groupChanged) {
      setChmodTarget(null);
      return;
    }
    try {
      try {
        await AppGo.SaveChmodDialogSettings(normalizedMode, rememberedIncludeSubdirectories);
      } catch (saveErr) {
        console.warn('SaveChmodDialogSettings failed:', saveErr);
      }
      if (ownerChanged || groupChanged) {
        const chownFile = window?.go?.main?.App?.ChownFile;
        if (typeof chownFile !== 'function') {
          throw new Error(t('应用不可用'));
        }
        await chownFile(sessionId, chmodTarget.path, ownerSpec, groupSpec, recursive);
      }
      if (modeChanged) {
        await AppGo.ChmodFile(sessionId, chmodTarget.path, normalizedMode, recursive);
      }
      addToast(t('权限修改成功'), 'success');
      setChmodTarget(null);
      if (getParentPath(chmodTarget.path) === currentPathRef.current) {
        await loadDir(currentPathRef.current, { preserveView: true, showLoading: false });
      }
    } catch (err) {
      addToast(`${t('权限修改失败')}: ${err}`, 'error');
    }
  };

  const handleFileListScroll = useCallback(() => {
    if (!isActive) return;
    captureFileListViewAnchor();
    syncCurrentTabToWorkspace({ scrollTop: fileListRef.current?.scrollTop || 0, reason: 'scroll-effect' });
    if (Date.now() < suppressUserScrollTrackingUntilRef.current) return;
    userHasScrolledInCurrentPathRef.current = true;
  }, [captureFileListViewAnchor, isActive, syncCurrentTabToWorkspace]);

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

  const isFileTransferDragEvent = useCallback((event) => {
    const types = Array.from(event?.dataTransfer?.types || []);
    if (types.includes('Files')) {
      return true;
    }
    const items = Array.from(event?.dataTransfer?.items || []);
    return items.some((item) => item?.kind === 'file');
  }, []);

  const handleDragEnter = (e) => {
    if (!isFileTransferDragEvent(e)) {
      return;
    }
    e.preventDefault();
    if (!isCompressedTransferEnabled()) {
      e.stopPropagation();
    }
    dragCounterRef.current++;
    setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    if (!isFileTransferDragEvent(e)) {
      return;
    }
    e.preventDefault();
    if (!isCompressedTransferEnabled()) {
      e.stopPropagation();
    }
  };

  const handleDragLeave = (e) => {
    if (!isFileTransferDragEvent(e)) {
      return;
    }
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
    if (!isFileTransferDragEvent(e)) {
      return;
    }
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
      style={{
        position: 'relative',
        '--wails-drop-target': 'drop',
        '--file-col-name-min': `${FILE_LIST_NAME_MIN_WIDTH}px`,
        '--file-col-size': `${fileListColumnWidths.size}px`,
        '--file-col-permission': `${fileListColumnWidths.permission}px`,
        '--file-col-modified': `${fileListColumnWidths.modified}px`,
        '--file-col-actions': `${FILE_LIST_ACTIONS_COLUMN_WIDTH}px`,
        '--file-list-min-width': fileListColumnWidths.minWidth,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({
          pos: { x: e.clientX, y: e.clientY },
          item: null,
          mode: 'blank',
          createBasePath: currentPath,
          showCreateActions: true,
        });
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
          onBlur={async () => {
            if (editingPath !== null) {
              const p = editingPath.trim();
              const normalizedTargetPath = normalizePath(p);
              if (normalizedTargetPath && normalizedTargetPath !== currentPath) {
                const resolveDirectoryPath = window?.go?.main?.App?.ResolveDirectoryPath;
                let resolvedDirectoryPath = normalizedTargetPath;
                if (typeof resolveDirectoryPath === 'function') {
                  try {
                    resolvedDirectoryPath = normalizePath(await resolveDirectoryPath(sessionId, normalizedTargetPath)) || normalizedTargetPath;
                  } catch (_) {}
                }
                if (resolvedDirectoryPath) {
                  void loadDir(resolvedDirectoryPath, {
                    preserveView: false,
                    trackDiff: false,
                    showLoading: false,
                    transitionMode: 'directory',
                    transitionDirection: resolvedDirectoryPath === getParentPath(currentPath) ? 'backward' : 'forward',
                  });
                }
              }
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

        {clipboard && (
          <>
            <Tiptop text={t('粘贴')} placement="bottom">
              <button
                className={`btn file-toolbar-outline-btn has-count ${clipboard.mode === 'cut' ? 'clipboard-cut' : 'clipboard-copy'}`}
                aria-label={t('粘贴')}
                onClick={() => {
                  if (operationInProgressRef.current) {
                    addToast(t('有操作正在进行，请稍候'), 'warning');
                  } else {
                    void handlePaste();
                  }
                }}
              >
                <ClipboardPaste size={14} />
                <span className={`clipboard-count-badge ${clipboard.mode === 'cut' ? 'clipboard-cut' : 'clipboard-copy'}`}>{clipboard.paths.length}</span>
              </button>
            </Tiptop>
            <Tiptop text={t('取消')} placement="bottom">
              <button
                className="btn file-toolbar-outline-btn"
                aria-label={t('取消')}
                onClick={() => updateClipboard(null)}
              >
                <X size={14} />
              </button>
            </Tiptop>
          </>
        )}

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
                  void loadDir(parent, {
                    preserveView: false,
                    trackDiff: false,
                    showLoading: false,
                    transitionMode: 'directory',
                    transitionDirection: 'backward',
                  });
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
              onClick={() => { void loadDir(currentPath); }}
            >
              <RefreshCw size={14} />
            </button>
          </Tiptop>
        </div>
      </div>

      <div className="terminal-sub-tab-bar">
        {fileManagerTabOverflow && (
          <button
            type="button"
            className={`terminal-sub-tab-nav terminal-sub-tab-nav-left${fileManagerTabCanScrollLeft ? '' : ' disabled'}`}
            onClick={() => scrollFileManagerTabs(-1)}
            aria-label={t('向左滚动标签')}
            title={t('向左滚动标签')}
            disabled={!fileManagerTabCanScrollLeft}
          >
            <ChevronLeft size={14} />
          </button>
        )}
        <div
          ref={fileManagerTabScrollRef}
          className="terminal-sub-tab-scroll"
          onWheel={handleFileManagerTabWheel}
          onScroll={handleFileManagerTabScroll}
          onDragOver={(event) => {
            const draggedTabId = draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
            if (!draggedTabId) {
              return;
            }
            if (event.target?.closest?.('.terminal-sub-tab')) {
              return;
            }
            const appendTarget = resolveFileManagerTabAppendTarget();
            if (!appendTarget || appendTarget.id === draggedTabId) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setFileManagerTabDropIndicator((current) => (
              current?.tabId === appendTarget.id && current?.side === 'after'
                ? current
                : { tabId: appendTarget.id, side: 'after' }
            ));
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) {
              return;
            }
            setFileManagerTabDropIndicator((current) => (
              current?.side === 'after' ? null : current
            ));
          }}
          onDrop={(event) => {
            const draggedTabId = event.dataTransfer.getData('text/plain') || draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
            if (!draggedTabId) {
              clearFileManagerTabDragState();
              return;
            }
            if (event.target?.closest?.('.terminal-sub-tab')) {
              return;
            }
            const appendTarget = resolveFileManagerTabAppendTarget();
            if (!appendTarget || appendTarget.id === draggedTabId) {
              clearFileManagerTabDragState();
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            reorderFileManagerTabs(draggedTabId, appendTarget.id, 'after');
            clearFileManagerTabDragState();
          }}
        >
          {fileManagerWorkspace.tabs.map((tab) => {
            const isActiveTab = activeFileManagerTab?.id === tab.id;
            const isPinnedTab = tab.pinned === true;
            const isSystemPinnedTab = tab.systemPinned === true;
            const isCwdSystemPinnedTab = getFileManagerSystemTabType(tab) === FILE_MANAGER_SYSTEM_TAB_KIND_CWD;
            const isCwdSystemTabHighlightVisible = isCwdSystemPinnedTab && cwdSystemTabHighlight.tabId === tab.id;
            const isDraggingTab = draggingFileManagerTabId === tab.id;
            const showDropIndicator = fileManagerTabDropIndicator?.tabId === tab.id;
            const dropIndicatorSide = fileManagerTabDropIndicator?.side || 'after';
            const tabDropPreviewText = showDropIndicator
              ? getFileManagerTabDropPreviewText(draggingFileManagerTabIdRef.current || draggingFileManagerTabId, tab, dropIndicatorSide)
              : '';
            const tabDefaultTiptopText = draggingFileManagerTabId
              ? null
              : (
                <>
                  <div>{tab.path || '/'}</div>
                  <div style={{ marginTop: 2, opacity: 0.78, fontSize: 11 }}>{t('双击关闭标签,长按拖拽调整')}</div>
                </>
              );
            return (
              <div
                key={tab.id}
                className={`terminal-sub-tab ${isActiveTab ? 'active' : ''}${isCwdSystemPinnedTab ? ' terminal-sub-tab-cwd' : ''}`}
                draggable={!isSystemPinnedTab}
                onDragStart={(event) => {
                  if (isSystemPinnedTab) {
                    return;
                  }
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', tab.id);
                  draggingFileManagerTabIdRef.current = tab.id;
                  setDraggingFileManagerTabId(tab.id);
                  setFileManagerTabDropIndicator(null);
                }}
                onDragOver={(event) => {
                  const draggedTabId = draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                  if (!draggedTabId || draggedTabId === tab.id) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const side = resolveFileManagerTabDropSide(event, tab);
                  setFileManagerTabDropIndicator((current) => (
                    current?.tabId === tab.id && current?.side === side
                      ? current
                      : { tabId: tab.id, side }
                  ));
                }}
                onDragLeave={(event) => {
                  event.stopPropagation();
                  setFileManagerTabDropIndicator((current) => (current?.tabId === tab.id ? null : current));
                }}
                onDrop={(event) => {
                  const draggedTabId = event.dataTransfer.getData('text/plain') || draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                  if (!draggedTabId || draggedTabId === tab.id) {
                    clearFileManagerTabDragState();
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const side = resolveFileManagerTabDropSide(event, tab);
                  reorderFileManagerTabs(draggedTabId, tab.id, side);
                  clearFileManagerTabDragState();
                }}
                onDragEnd={() => {
                  clearFileManagerTabDragState();
                }}
                onClick={() => { void activateFileManagerTab(tab.id); }}
                onDoubleClick={(event) => { void handleCloseFileManagerTab(tab.id, event); }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const tabPath = normalizePath(tab.path) || '/';
                  setContextMenu({
                    pos: { x: event.clientX, y: event.clientY },
                    item: buildDirectoryItemFromPath(tabPath),
                    mode: 'tab',
                    tabId: tab.id,
                    tabPath,
                    tabPinned: isPinnedTab,
                    tabSystemPinned: isSystemPinnedTab,
                    itemBasePath: getParentPath(tabPath),
                    createBasePath: tabPath,
                    showCreateActions: true,
                  });
                }}
                style={{
                  position: 'relative',
                  opacity: isDraggingTab ? 0.45 : 1,
                }}
              >
                {isCwdSystemTabHighlightVisible && (
                  <span
                    key={`cwd-system-tab-highlight-${cwdSystemTabHighlight.token}`}
                    className="terminal-sub-tab-change-ring"
                    aria-hidden="true"
                  />
                )}
                {showDropIndicator && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      bottom: 4,
                      [dropIndicatorSide === 'before' ? 'left' : 'right']: -1,
                      width: 2,
                      borderRadius: 999,
                      background: 'var(--accent)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
                {showFileManagerTabIcons && !isSystemPinnedTab && <Folder size={11} />}
                {isPinnedTab && !isSystemPinnedTab && <Pin size={10} style={{ opacity: 0.8 }} />}
                <Tiptop
                  text={tabDropPreviewText || tabDefaultTiptopText}
                  placement="bottom"
                  forceVisible={showDropIndicator && Boolean(tabDropPreviewText)}
                >
                  {renderFileManagerTabTitle(tab, t)}
                </Tiptop>
                {!hideFileManagerTabCloseButton && fileManagerWorkspace.tabs.length > 1 && !isPinnedTab && (
                  <span
                    className="terminal-sub-tab-close"
                    onClick={(event) => { void handleCloseFileManagerTab(tab.id, event); }}
                  >
                    <X size={10} />
                  </span>
                )}
              </div>
            );
          })}
          {draggingFileManagerTabId && (
            <div
              onDragOver={(event) => {
                const draggedTabId = draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                const appendTarget = resolveFileManagerTabAppendTarget();
                if (!draggedTabId || !appendTarget || appendTarget.id === draggedTabId) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setFileManagerTabDropIndicator((current) => (
                  current?.tabId === appendTarget.id && current?.side === 'after'
                    ? current
                    : { tabId: appendTarget.id, side: 'after' }
                ));
              }}
              onDrop={(event) => {
                const draggedTabId = event.dataTransfer.getData('text/plain') || draggingFileManagerTabIdRef.current || draggingFileManagerTabId;
                const appendTarget = resolveFileManagerTabAppendTarget();
                if (!draggedTabId || !appendTarget || appendTarget.id === draggedTabId) {
                  clearFileManagerTabDragState();
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                reorderFileManagerTabs(draggedTabId, appendTarget.id, 'after');
                clearFileManagerTabDragState();
              }}
              style={{ flex: '1 0 24px', minWidth: 24, alignSelf: 'stretch' }}
            />
          )}
        </div>
        {fileManagerTabOverflow && (
          <button
            type="button"
            className={`terminal-sub-tab-nav terminal-sub-tab-nav-right${fileManagerTabCanScrollRight ? '' : ' disabled'}`}
            onClick={() => scrollFileManagerTabs(1)}
            aria-label={t('向右滚动标签')}
            title={t('向右滚动标签')}
            disabled={!fileManagerTabCanScrollRight}
          >
            <ChevronRight size={14} />
          </button>
        )}
        <div className="terminal-sub-tab-actions">
          <button
            className="btn btn-ghost btn-sm terminal-create-btn"
            onClick={() => { void handleCreateFileManagerTab(); }}
            aria-label={t('新建标签')}
            title={t('新建标签')}
          >
            <Plus size={14} />
            {t('新建标签')}
          </button>
        </div>
      </div>

      {/* Content area: file list + optional split editor */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* File List */}
        <div className={`file-list${fileListSwitchStage !== 'idle' ? ` is-switching is-switch-${fileListSwitchDirection}` : ''}`} ref={fileListRef} tabIndex={0} onKeyDown={handleFileListKeyDown} onScroll={handleFileListScroll} style={{ flex: 1, minWidth: 0 }} aria-busy={loading || fileListSwitchStage !== 'idle'}>
          <div className="file-list-header">
            <span className="file-col-name" onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
              {t('名称')} {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span className="file-col-size" onClick={() => handleSort('size')} style={{ cursor: 'pointer' }}>
              {t('大小')} {sortField === 'size' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span className="file-col-permission" onClick={() => handleSort('permissions')} style={{ cursor: 'pointer' }}>
              {t('权限')} {sortField === 'permissions' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span className="file-col-modified" onClick={() => handleSort('modified')} style={{ cursor: 'pointer' }}>
              {t('修改时间')} {sortField === 'modified' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
            <span className="file-col-actions"></span>
          </div>

          <div className="file-list-viewport">
            {fileListSwitchGhostHtml && (
              <div
                className={`file-list-body file-list-body-ghost ${fileListSwitchStage !== 'idle' ? `${fileListSwitchStage} is-locked` : ''}`}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: fileListSwitchGhostHtml }}
              />
            )}
            <div ref={fileListBodyRef} className={`file-list-body file-list-body-live ${fileListSwitchStage !== 'idle' ? `${fileListSwitchStage} is-locked` : ''}`}>
              {currentPath !== '/' && (
              <div
                className="file-item"
                data-file-row-key="__parent__"
                onDoubleClick={() => {
                  const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
                  void loadDir(parent, {
                    preserveView: false,
                    trackDiff: false,
                    showLoading: false,
                    transitionMode: 'directory',
                    transitionDirection: 'backward',
                  });
                }}
                onClick={(e) => {
                  if ((e.detail || 1) >= 2) return;
                  setSelectedPaths([]);
                  fileListRef.current?.focus();
                }}
              >
                <div className="file-name-cell">
                  <span className="file-icon"><FolderUp size={16} /></span>
                  <span className="file-name is-dir">..</span>
                </div>
                <span className="file-col-size" />
                <span className="file-col-permission" />
                <span className="file-col-modified" />
                <span className="file-col-actions" />
              </div>
            )}

            {!loading && items.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon"><FolderOpen size={48} strokeWidth={1.5} /></div>
                <div className="empty-state-text">{t('目录为空')}</div>
              </div>
            )}

            {sortedItems.map((item) => {
              const isRenaming = renamingItem?.name === item.name;
              const itemPath = joinPath(currentPath, item.name);
              const rowKey = item.__rowKey || itemPath;
              const isDeletedPlaceholder = isDeletedPlaceholderItem(item);
              const isSelected = selectedPaths.includes(itemPath);
              const clipboardMode = isDeletedPlaceholder ? '' : (clipboard?.paths?.includes(itemPath) ? clipboard.mode : '');
              const rowEffect = activeRowEffects[rowKey] || '';
              const permissionDisplay = formatPermissionDisplay(item.permission || '-');

              const handleItemClick = (e) => {
                if (isRenaming || isDeletedPlaceholder) return;
                if ((e.detail || 1) >= 2) return;
                fileListRef.current?.focus();
                if (e.ctrlKey || e.metaKey) {
                  setSelectedPaths(prev =>
                    prev.includes(itemPath) ? prev.filter(p => p !== itemPath) : [...prev, itemPath]
                  );
                  lastClickedPathRef.current = itemPath;
                } else if (e.shiftKey && lastClickedPathRef.current) {
                  window.getSelection()?.removeAllRanges();
                  const lastIdx = sortedItems.findIndex(i => joinPath(currentPath, i.name) === lastClickedPathRef.current);
                  const currentIdx = sortedItems.findIndex(i => i.name === item.name);
                  if (lastIdx >= 0 && currentIdx >= 0) {
                    const start = Math.min(lastIdx, currentIdx);
                    const end = Math.max(lastIdx, currentIdx);
                    setSelectedPaths(sortedItems.slice(start, end + 1).filter((entry) => !isDeletedPlaceholderItem(entry)).map(i => joinPath(currentPath, i.name)));
                  }
                } else {
                  setSelectedPaths([itemPath]);
                  lastClickedPathRef.current = itemPath;
                }
              };

              return (
                <div
                  key={rowKey}
                  data-file-row-key={rowKey}
                  className={`file-item${isSelected ? ' selected' : ''}${clipboardMode === 'copy' ? ' clipboard-copy' : ''}${clipboardMode === 'cut' ? ' clipboard-cut' : ''}${isDeletedPlaceholder ? ' deleted-placeholder' : ''}${rowEffect ? ` visual-effect visual-effect-${rowEffect}` : ''}`}
                  style={isDeletedPlaceholder ? { '--file-row-height': `${item.__rowHeight || 36}px` } : undefined}
                  onClick={handleItemClick}
                  onDoubleClick={() => {
                    if (isDeletedPlaceholder) return;
                    setSelectedPaths([itemPath]);
                    lastClickedPathRef.current = itemPath;
                    if (item.isDirectory) {
                      navigate(item);
                    } else if (isEditable(item.name)) {
                      handleEdit(item);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (isDeletedPlaceholder) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const currentSelectedPaths = selectedPathsRef.current;
                    const useSelectedPathsDelete = currentSelectedPaths.length > 1 && currentSelectedPaths.includes(itemPath);
                    setContextMenu({
                      pos: { x: e.clientX, y: e.clientY },
                      item,
                      mode: 'item',
                      itemBasePath: currentPath,
                      createBasePath: currentPath,
                      showCreateActions: false,
                      deleteUsesSelectedPaths: useSelectedPathsDelete,
                      deleteItemCount: useSelectedPathsDelete ? currentSelectedPaths.length : 1,
                    });
                  }}
                >
                  <div className="file-name-cell">
                    <span className="file-icon">{fileIcon(item.name, item.isDirectory)}</span>
                    {isRenaming ? (
                      <input
                        className="rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => confirmRename(false)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') confirmRename(true);
                          if (e.key === 'Escape') {
                            setRenamingItem(null);
                            fileListRef.current?.focus();
                          }
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className={`file-name ${item.isDirectory ? 'is-dir' : ''}${isDeletedPlaceholder ? ' is-deleted-placeholder' : ''}`}>
                        {item.name}
                      </span>
                    )}
                  </div>

                  <span className="file-size file-col-size">{item.isDirectory ? '-' : fmtSize(item.size)}</span>
                  <span className="file-permission file-col-permission" title={permissionDisplay} onClick={(e) => { if (isDeletedPlaceholder) return; e.stopPropagation(); void handleChmod(item); }}>{permissionDisplay}</span>
                  <span className="file-date file-col-modified">{fmtDate(item.modifyTime)}</span>

                  <div className="file-actions file-col-actions">
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
                        onClick={(e) => {
                          e.stopPropagation();
                          if (operationInProgressRef.current) {
                            addToast(t('有操作正在进行，请稍候'), 'warning');
                          } else {
                            handleDelete(item);
                          }
                        }}
                      ><Trash2 size={14} /></button>
                    </Tiptop>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
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
          mode={contextMenu.mode || 'item'}
          isPinned={contextMenu.mode === 'tab' && contextMenu.tabPinned === true}
          isSystemPinned={contextMenu.mode === 'tab' && contextMenu.tabSystemPinned === true}
          canTogglePinned={contextMenu.mode === 'tab' && contextMenu.tabSystemPinned !== true}
          canCloseTab={contextMenu.mode === 'tab' && contextMenu.tabPinned !== true && fileManagerWorkspace.tabs.length > 1 && !hideFileManagerTabCloseButton}
          showCreateActions={Boolean(contextMenu.showCreateActions)}
          deleteItemCount={Number.isFinite(Number(contextMenu.deleteItemCount)) ? Number(contextMenu.deleteItemCount) : 1}
          t={t}
          onClose={closeContextMenu}
          onTogglePinned={() => {
            if (contextMenu.mode === 'tab') {
              handleToggleFileManagerTabPinned(contextMenu.tabId);
            }
            closeContextMenu();
          }}
          onCloseTab={() => {
            if (contextMenu.mode === 'tab') {
              void handleCloseFileManagerTab(contextMenu.tabId);
            }
            closeContextMenu();
          }}
          onCopyPath={() => {
            if (contextMenu.item) {
              handleCopyPath(contextMenu.item, contextMenu.itemBasePath || currentPath);
            }
            closeContextMenu();
          }}
          onDownload={() => {
            if (contextMenu.item) {
              void handleDownload(contextMenu.item, { basePath: contextMenu.itemBasePath || currentPath });
            }
            closeContextMenu();
          }}
          onOpenInNewTab={() => {
            const nextTabPath = contextMenu.mode === 'tab'
              ? contextMenu.tabPath
              : (contextMenu.item ? joinPath(contextMenu.itemBasePath || currentPath, contextMenu.item.name) : '');
            if (nextTabPath) {
              void openFileManagerPathInNewTab(nextTabPath);
            }
            closeContextMenu();
          }}
          onEdit={() => {
            if (contextMenu.item) {
              void handleEdit(contextMenu.item);
            }
            closeContextMenu();
          }}
          onRename={() => {
            if (contextMenu.mode === 'tab') {
              void handleRenameFileManagerTabTitle(contextMenu.tabId);
            } else if (contextMenu.item) {
              startRename(contextMenu.item);
            }
            closeContextMenu();
          }}
          onChmod={() => {
            if (contextMenu.mode === 'tab' && contextMenu.item) {
              void openChmodTarget(contextMenu.tabPath, contextMenu.item);
            } else if (contextMenu.item) {
              void handleChmod(contextMenu.item, contextMenu.itemBasePath || currentPath);
            }
            closeContextMenu();
          }}
          onDelete={() => {
            if (operationInProgressRef.current) {
              addToast(t('有操作正在进行，请稍候'), 'warning');
            } else if (contextMenu.deleteUsesSelectedPaths) {
              void handleDeleteItems();
            } else if (contextMenu.mode === 'tab') {
              void handleDeleteTabDirectory(contextMenu.tabId, contextMenu.tabPath, false);
            } else if (contextMenu.item) {
              void handleDelete(contextMenu.item);
            }
            closeContextMenu();
          }}
          onDeleteShell={() => {
            if (operationInProgressRef.current) {
              addToast(t('有操作正在进行，请稍候'), 'warning');
            } else if (contextMenu.mode === 'tab') {
              void handleDeleteTabDirectory(contextMenu.tabId, contextMenu.tabPath, true);
            } else if (contextMenu.item) {
              void handleDeleteShell(contextMenu.item);
            }
            closeContextMenu();
          }}
          onMkdir={() => { void handleMkdir(contextMenu.createBasePath || currentPath); closeContextMenu(); }}
          onNewFile={() => { void handleNewFile(contextMenu.createBasePath || currentPath); closeContextMenu(); }}
          onCompress={() => {
            if (contextMenu.item) {
              void handleCompress(contextMenu.item, { basePath: contextMenu.itemBasePath || currentPath });
            }
            closeContextMenu();
          }}
          onUncompress={() => { if (contextMenu.item) { void handleUncompress(contextMenu.item); } closeContextMenu(); }}
        />,
        document.body
      )}

      {uploadPanelTarget && createPortal(
        <FileUploadQueuePanel
          items={uploadQueueItems}
          closing={uploadPanelClosing}
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
            onOpenSystemEditor={handleOpenSystemEditor}
            onOpenWithEditor={handleOpenWithEditor}
            externalOpening={externalOpening}
          />
        </Suspense>
      )}

      {/* Chmod Dialog */}
      {chmodTarget && (
        <ChmodDialog
          path={chmodTarget.path}
          permission={chmodTarget.item.permission}
          mode={chmodTarget.mode}
          rememberedMode={chmodTarget.rememberedMode}
          autoApplyLastSettings={chmodTarget.autoApplyLastSettings}
          uid={chmodTarget.item.uid}
          gid={chmodTarget.item.gid}
          ownerCandidates={chmodTarget.ownerCandidates}
          groupCandidates={chmodTarget.groupCandidates}
          includeSubdirectories={chmodTarget.includeSubdirectories}
          showIncludeSubdirectories={chmodTarget.showIncludeSubdirectories}
          onSave={handleChmodSave}
          onClose={() => setChmodTarget(null)}
          t={t}
        />
      )}

      {/* Operation Progress Overlay */}
      {operationProgress && (
        <div className="file-operation-overlay">
          <div className="file-operation-card">
            <div className="file-operation-title">
              {operationProgress.message}
            </div>
            {operationProgress.total > 0 ? (
              <>
                <div className="file-operation-progress-container">
                  <div
                    className="file-operation-progress-bar"
                    style={{ width: `${(operationProgress.current / operationProgress.total) * 100}%` }}
                  />
                </div>
                <div className="file-operation-details">
                  <span>{Math.round((operationProgress.current / operationProgress.total) * 100)}%</span>
                  <span>{operationProgress.current} / {operationProgress.total}</span>
                </div>
              </>
            ) : (
              <div className="file-operation-spinner">
                <RefreshCw className="spin" size={20} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
