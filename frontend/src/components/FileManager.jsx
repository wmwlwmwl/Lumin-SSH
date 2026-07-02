import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { createPortal } from 'react-dom';
import * as AppGo from '../../wailsjs/go/main/App.js';
const FileEditor = React.lazy(() => import('./FileEditor.jsx'));
import { EventsOn } from '../../wailsjs/runtime/runtime.js';
import { useTranslation, t as tKey, getLanguage } from '../i18n.js';
import { clampMenuPosition } from '../utils/menuPosition.js';
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
  const locale = lang === 'en-US' ? 'en-US' : 'zh-CN';
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
  const ext = (name.split('.').pop() || '').toLowerCase();
  const editable = [
    'txt', 'md', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'config',
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

// 上传文件大小上限
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB

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

// 读取文件为 base64 字符串（去掉 data URL 前缀），避免将 Uint8Array 展开为
// 普通 Array 导致的内存爆炸（8-16 倍开销）。base64 仅 1.33 倍开销。
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_SIZE) {
      reject(new Error(`${tKey('文件过大')} (${(file.size / 1024 / 1024).toFixed(1)}MB)，${tKey('最大支持')} 100MB`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── Chmod Dialog ──────────────────────────────────────────────
function ChmodDialog({ path, permission, mode, onSave, onClose, t }) {
  // 从 permission string 解析初始状态 (e.g. "-rwxr-xr-x" or "drwxr-xr-x")
  const parsePerms = (permStr) => {
    const p = permStr && permStr.length >= 10 ? permStr.slice(1) : '---------';
    return {
      user: { r: p[0] === 'r', w: p[1] === 'w', x: p[2] === 'x' },
      group: { r: p[3] === 'r', w: p[4] === 'w', x: p[5] === 'x' },
      other: { r: p[6] === 'r', w: p[7] === 'w', x: p[8] === 'x' },
    };
  };

  const [perms, setPerms] = useState(parsePerms(permission || ''));
  const [octal, setOctal] = useState(mode || '644');

  // 从复选框计算八进制
  const calcOctal = (p) => {
    const u = (p.user.r ? 4 : 0) + (p.user.w ? 2 : 0) + (p.user.x ? 1 : 0);
    const g = (p.group.r ? 4 : 0) + (p.group.w ? 2 : 0) + (p.group.x ? 1 : 0);
    const o = (p.other.r ? 4 : 0) + (p.other.w ? 2 : 0) + (p.other.x ? 1 : 0);
    return `${u}${g}${o}`;
  };

  const togglePerm = (cat, key) => {
    setPerms(prev => {
      const next = { ...prev, [cat]: { ...prev[cat], [key]: !prev[cat][key] } };
      setOctal(calcOctal(next));
      return next;
    });
  };

  const handleOctalChange = (e) => {
    const val = e.target.value.replace(/[^0-7]/g, '').slice(0, 3);
    setOctal(val);
    // 从八进制更新复选框
    if (val.length === 3) {
      const u = parseInt(val[0], 8);
      const g = parseInt(val[1], 8);
      const o = parseInt(val[2], 8);
      setPerms({
        user: { r: !!(u & 4), w: !!(u & 2), x: !!(u & 1) },
        group: { r: !!(g & 4), w: !!(g & 2), x: !!(g & 1) },
        other: { r: !!(o & 4), w: !!(o & 2), x: !!(o & 1) },
      });
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
              {/* Header */}
              <div className="chmod-row">
                <span></span>
                <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('读取')}</span>
                <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('写入')}</span>
                <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>{t('执行')}</span>
              </div>
              {/* User row */}
              <div className="chmod-row">
                <span className="chmod-row-label">{t('用户')}</span>
                {['r','w','x'].map(k => (
                  <label key={k} className="chmod-checkbox" style={{ justifyContent: 'center' }}>
                    <input type="checkbox" checked={perms.user[k]} onChange={() => togglePerm('user', k)} />
                  </label>
                ))}
              </div>
              {/* Group row */}
              <div className="chmod-row">
                <span className="chmod-row-label">{t('组')}</span>
                {['r','w','x'].map(k => (
                  <label key={k} className="chmod-checkbox" style={{ justifyContent: 'center' }}>
                    <input type="checkbox" checked={perms.group[k]} onChange={() => togglePerm('group', k)} />
                  </label>
                ))}
              </div>
              {/* Other row */}
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
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('取消')}</button>
          <button className="btn btn-primary" onClick={() => onSave(octal)}>{t('确定')}</button>
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
      {item && !item.isDirectory && (
        <div className="context-menu-item" onClick={onDownload}>
          <Download size={14} /> {t('下载到本地')}
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

export default function FileManager({ sessionId, addToast, isActive = true }) {
  const { t } = useTranslation();
  const joinPath = (base, name) => base === '/' ? `/${name}` : `${base}/${name}`;
  const [currentPath, setCurrentPath] = useState('/');
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
  useEffect(() => {
    if (!sessionId) return;
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
  const fileListRef = useRef(null);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [contextMenu, setContextMenu] = useState(null); // { pos, item }
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [chmodTarget, setChmodTarget] = useState(null); // { item, path }
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
  const [transferInfo, setTransferInfo] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

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

  const loadDir = useCallback(async (path, silent = false) => {
    setLoading(true);
    try {
      const data = await AppGo.ListDir(sessionId, path);
      if (!mountedRef.current) return false;
      setItems(data || []);
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

  // ── 初始化：依次尝试 CWD → /root → /，用第一个可访问的 ──
  useEffect(() => {
    (async () => {
      const paths = [];
      try {
        const cwd = await AppGo.GetTerminalCwd(sessionId);
        if (cwd && cwd !== '/') {
          // 跳过 Docker/系统深层路径
          const depth = cwd.split('/').filter(Boolean).length;
          if (depth <= 3 || cwd === '/root' || cwd.startsWith('/home/')) {
            paths.push(cwd);
          }
        }
      } catch (_) {}
      paths.push('/root', '/');
      for (const p of paths) {
        if (await loadDir(p, true)) return;
      }
    })();
  }, [sessionId, loadDir]);

  // ── 监听终端内的目录切换事件 ─────────────────────────────
  useEffect(() => {
    // 向全局标志位注册订阅，告知 Terminal 组件"文件管理器已挂载，需要 CWD 探测"
    if (!window.__cwdListeners) window.__cwdListeners = {};
    window.__cwdListeners[sessionId] = true;

    const handleTerminalCwd = async (e) => {
      if (e.detail && e.detail.sessionId === sessionId) {
        const newPath = e.detail.cwd;
        if (newPath && newPath !== currentPathRef.current) {
          const ok = await loadDir(newPath, true);
          if (!ok) loadDir('/');
        }
      }
    };
    window.addEventListener('ssh-terminal-cwd-changed', handleTerminalCwd);
    return () => {
      // 注销订阅，文件管理器不可见时不再触发 CWD 探测
      if (window.__cwdListeners) delete window.__cwdListeners[sessionId];
      window.removeEventListener('ssh-terminal-cwd-changed', handleTerminalCwd);
    };
  }, [sessionId, loadDir]);

  useEffect(() => {
    const off = EventsOn(`transfer-progress-${sessionId}`, (progress) => {
      setTransferInfo(prev => {
        if (!prev) return prev;
        return { ...prev, progress };
      });
    });
    return off;
  }, [sessionId]);

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

  // Upload file via Wails native file dialog
  const handleUpload = async () => {
    try {
      setTransferInfo({ name: t('正在选择文件...'), progress: 0, direction: 'upload' });
      await AppGo.UploadFile(sessionId, currentPath);
      addToast(t('上传成功'), 'success');
      await loadDir(currentPath);
    } catch (err) {
      if (err) addToast(`${t('上传失败')}: ${err}`, 'error');
    } finally {
      if (mountedRef.current) setTransferInfo(null);
    }
  };

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

  const handleDownload = async (item) => {
    const remotePath = joinPath(currentPath, item.name);
    
    try {
      setTransferInfo({ name: item.name, progress: 0, direction: 'download' });
      await AppGo.DownloadFile(sessionId, remotePath);
      addToast(`${t('下载成功')}: ${item.name}`, 'success');
    } catch (err) {
      if (err) addToast(`${t('下载失败')}: ${err}`, 'error');
    } finally {
      setTransferInfo(null);
    }
  };

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
    if (!(await window.luminDialog?.confirm(`${t('确定删除')}${item.name}？${t('此操作不可撤销')}`))) return;
    try {
      await AppGo.DeleteItem(sessionId, remotePath, item.isDirectory);
      addToast(`${t('已删除')}: ${item.name}`, 'success');
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('删除失败')}: ${err}`, 'error');
    }
  };

  // Delete via rm -rf
  const handleDeleteShell = async (item) => {
    const remotePath = joinPath(currentPath, item.name);
    if (!(await window.luminDialog?.confirm(`${t('确定删除')}${item.name}？(rm -rf) ${t('此操作不可撤销')}`))) return;
    try {
      await AppGo.DeleteItemShell(sessionId, remotePath);
      addToast(`${t('已删除')}: ${item.name}`, 'success');
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
  const handleChmod = (item) => {
    const itemPath = joinPath(currentPath, item.name);
    setChmodTarget({ item, path: itemPath });
  };

  const handleChmodSave = async (modeStr) => {
    if (!chmodTarget) return;
    try {
      await AppGo.ChmodFile(sessionId, chmodTarget.path, modeStr);
      addToast(t('权限修改成功'), 'success');
      setChmodTarget(null);
      await loadDir(currentPath);
    } catch (err) {
      addToast(`${t('权限修改失败')}: ${err}`, 'error');
    }
  };

  // ── 拖拽上传 ────────────────────────────────────────────────

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const droppedItems = Array.from(e.dataTransfer.items);
    const droppedFiles = Array.from(e.dataTransfer.files || []).filter(f => !isHiddenFile(f.name));
    if (droppedItems.length === 0 && droppedFiles.length === 0) return;

    setTransferInfo({ name: t('正在上传...'), progress: 0, direction: 'upload' });

    let fileCount = 0;
    const uploadedNames = new Set(); // 追踪所有已成功上传的文件名
    const pendingFailures = new Set(); // 记录首次上传失败的文件名，待 droppedFiles 兜底后确认

    try {
      // ── 方式一：通过 items + webkitGetAsEntry API（支持文件夹结构） ──
      for (const item of droppedItems) {
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();

        if (entry && entry.isFile) {
          // ── 单文件上传（读取内容 → 传后端） ──
          let file;
          try { file = item.getAsFile(); } catch (_) { file = null; }
          if (!file) {
            // getAsFile 读取失败不记为失败，留给 droppedFiles 兜底重试
            continue;
          }
          try {
            const content = await readFileAsBase64(file);
            await AppGo.UploadFileContentBase64(sessionId, file.name, currentPath, content);
            fileCount++;
            uploadedNames.add(file.name);
          } catch (err) {
            if (err.name === 'NotFoundError') {
              console.warn('跳过文件夹占位符:', file.name);
            } else {
              console.warn('上传文件失败，待 droppedFiles 兜底:', file.name, err);
              pendingFailures.add(file.name);
            }
          }

        } else if (entry && entry.isDirectory) {
          // ── 文件夹上传（遍历 + 按目录结构上传） ──
          const files = await traverseEntry(entry);
          if (files.length === 0) continue;

          const dirName = entry.name;
          const baseRemote = joinPath(currentPath, dirName);

          // 收集目录结构和文件任务
          const subDirs = new Set();
          const fileJobs = [];
          for (const f of files) {
            let relPath = f._fullPath;
            if (relPath.startsWith(entry.fullPath)) {
              relPath = relPath.slice(entry.fullPath.length);
            }
            relPath = relPath.replace(/^\//, '');
            const parts = relPath.split('/');
            parts.pop(); // 去掉文件名
            const subDir = parts.join('/');
            if (subDir) subDirs.add(subDir);
            fileJobs.push({ file: f, subDir });
          }

          // 创建远程目录结构
          try {
            await AppGo.Mkdir(sessionId, baseRemote);
            for (const sd of subDirs) {
              await AppGo.Mkdir(sessionId, `${baseRemote}/${sd}`);
            }
          } catch (err) {
            console.warn('创建目录失败:', baseRemote, err);
          }

          // 读取文件内容并上传（每个文件独立 try-catch，避免一个失败中断全部）
          for (const job of fileJobs) {
            const remoteDir = job.subDir
              ? `${baseRemote}/${job.subDir}`
              : baseRemote;
            try {
              const content = await readFileAsBase64(job.file);
              await AppGo.UploadFileContentBase64(sessionId, job.file.name, remoteDir, content);
              fileCount++;
              uploadedNames.add(job.file.name);
            } catch (err) {
              console.warn('上传文件失败:', job.file.name, err);
              pendingFailures.add(job.file.name);
            }
          }

        } else if (!entry) {
          // webkitGetAsEntry 返回 null（混合拖拽时常见），尝试 getAsFile 上传
          // 失败不记为最终失败，留给 droppedFiles 兜底
          let file;
          try { file = item.getAsFile(); } catch (_) { file = null; }
          if (!file) continue;
          try {
            const content = await readFileAsBase64(file);
            await AppGo.UploadFileContentBase64(sessionId, file.name, currentPath, content);
            fileCount++;
            uploadedNames.add(file.name);
          } catch (err) {
            console.warn('getAsFile 上传失败，留给 droppedFiles 兜底:', file.name, err);
            // 不加入 uploadedNames，让 droppedFiles 回退重新尝试
          }
        }
      }

      // ── 方式二：droppedFiles 兜底（无条件执行，避免 fileCount/droppedFiles.length 比较不准） ──
      for (const file of droppedFiles) {
        if (uploadedNames.has(file.name)) continue;
        try {
          const content = await readFileAsBase64(file);
          await AppGo.UploadFileContentBase64(sessionId, file.name, currentPath, content);
          fileCount++;
          uploadedNames.add(file.name);
          pendingFailures.delete(file.name); // 兜底成功，移出失败记录
        } catch (err) {
          // 某些浏览器会把拖拽的文件夹本身放入 droppedFiles 作为占位符，读取时报 NotFoundError
          if (err.name === 'NotFoundError') {
            console.warn('跳过文件夹占位符:', file.name);
          } else {
            console.warn('上传文件失败:', file.name, err);
            pendingFailures.add(file.name);
          }
        }
      }

      const failCount = pendingFailures.size;
      if (failCount > 0) {
        const failedNames = Array.from(pendingFailures).slice(0, 3).join(', ');
        addToast(`${t('上传完成')}: ${fileCount}${t('项成功')}, ${failCount}${t('项失败')} (${failedNames})`, 'warning');
      } else {
        addToast(`${t('上传成功')}: ${fileCount}${t('项')}`, 'success');
      }
      await loadDir(currentPath);
    } catch (err) {
      if (err) addToast(`${t('上传失败')}: ${err}`, 'error');
    } finally {
      if (mountedRef.current) setTransferInfo(null);
    }
  };

  return (
    <div
      className="file-manager"
      style={{ position: 'relative' }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ pos: { x: e.clientX, y: e.clientY }, item: null });
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
          <button className="btn btn-secondary btn-sm" onClick={handleNewFile}><FilePlus size={14} /> {t('新建文件')}</button>
          <button className="btn btn-secondary btn-sm" onClick={handleMkdir}><FolderPlus size={14} /> {t('新建文件夹')}</button>
          <button className="btn btn-secondary btn-sm" onClick={handleUpload}>
            <Upload size={14} /> {t('上传文件')}
          </button>
          {currentPath !== '/' && (
            <button
              className="btn btn-ghost btn-sm btn-icon"
              title={tKey('返回上级')}
              onClick={() => {
                const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
                loadDir(parent);
              }}
            >
              <FolderUp size={14} />
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            title={t('刷新')}
            onClick={() => loadDir(currentPath)}
          >
            <RefreshCw size={14} />
          </button>
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
                <span className="file-permission" onClick={(e) => { e.stopPropagation(); handleChmod(item); }}>{item.permission || '-'}</span>
                <span className="file-date">{fmtDate(item.modifyTime)}</span>

                <div className="file-actions">
                  {!item.isDirectory && isEditable(item.name) && (
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      title={t('编辑')}
                      onClick={(e) => { e.stopPropagation(); handleEdit(item); }}
                    ><SquarePen size={14} /></button>
                  )}
                  {!item.isDirectory && (
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      title={t('下载到本地')}
                      onClick={(e) => { e.stopPropagation(); handleDownload(item); }}
                    ><Download size={14} /></button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    title={t('重命名')}
                    onClick={(e) => { e.stopPropagation(); startRename(item); }}
                  ><PenLine size={14} /></button>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    title={t('删除')}
                    style={{ color: 'var(--danger)' }}
                    onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                  ><Trash2 size={14} /></button>
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
          onChmod={() => { handleChmod(contextMenu.item); closeContextMenu(); }}
          onDelete={() => { handleDelete(contextMenu.item); closeContextMenu(); }}
          onDeleteShell={() => { handleDeleteShell(contextMenu.item); closeContextMenu(); }}
          onMkdir={() => { handleMkdir(); closeContextMenu(); }}
          onNewFile={() => { handleNewFile(); closeContextMenu(); }}
          onCompress={() => { handleCompress(contextMenu.item); closeContextMenu(); }}
          onUncompress={() => { handleUncompress(contextMenu.item); closeContextMenu(); }}
        />,
        document.body
      )}

      {/* Transfer Progress Toast */}
      {transferInfo && (
        <div className="transfer-toast">
          <div className="transfer-toast-title">
            {transferInfo.direction === 'upload' ? <><Upload size={14} /> {t('上传中') || '上传中'}</> : <><Download size={14} /> {t('下载中') || '下载中'}</>}: {transferInfo.name}
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${transferInfo.progress}%` }}
            />
          </div>
        </div>
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
          />
        </Suspense>
      )}

      {/* Chmod Dialog */}
      {chmodTarget && (
        <ChmodDialog
          path={chmodTarget.path}
          permission={chmodTarget.item.permission}
          mode={chmodTarget.item.mode}
          onSave={handleChmodSave}
          onClose={() => setChmodTarget(null)}
          t={t}
        />
      )}
    </div>
  );
}
