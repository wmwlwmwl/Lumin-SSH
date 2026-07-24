import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from '../i18n.js';
import { formatShortcut } from '../utils/platform.js';
import { clampMenuPosition } from '../utils/menuPosition.js';
import { getTerminalTheme } from '../utils/theme.js';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { c, cpp, java, csharp } from '@codemirror/legacy-modes/mode/clike';
import { X, Pencil, Save, SquarePen, Upload, ExternalLink, AppWindow } from 'lucide-react';
import { Z } from '../constants/zIndex';
import { getSessionWorkbenchState, setSessionWorkbenchState, subscribeSessionWorkbenchState } from '../utils/fileWorkbench.js';
import Tiptop from './Tiptop.jsx';

const EXTERNAL_PREFERRED_APP_KEY = 'fileEditorPreferredApp';

function readPreferredExternalApp() {
  return (localStorage.getItem(EXTERNAL_PREFERRED_APP_KEY) || '').trim();
}

function preferredExternalAppLabel(path) {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const base = normalized.split('/').pop() || path;
  return base.replace(/\.exe$/i, '').replace(/\.app$/i, '');
}

// Debian sources.list 语法高亮
const debianList = StreamLanguage.define({
  startState: () => ({ inUrl: false }),
  token: (stream, state) => {
    if (stream.eatSpace()) return null;
    // 注释
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    // 行首关键字
    if (stream.match(/deb-src\b/)) return 'keyword';
    if (stream.match(/deb\b/)) return 'keyword';
    // URL
    if (stream.match(/https?:\/\/[^\s]+/)) return 'string';
    // 行末架构标记
    if (stream.match(/[a-z-]+=/)) return 'attribute';
    return stream.next();
  }
});

// RHEL .repo 文件语法高亮 (INI 风格)
const rhelRepo = StreamLanguage.define({
  startState: () => ({}),
  token: (stream) => {
    if (stream.eatSpace()) return null;
    // 注释
    if (stream.match('#') || stream.match(';')) {
      stream.skipToEnd();
      return 'comment';
    }
    // [section]
    if (stream.match(/^\[.*\]/)) return 'keyword';
    // key=value
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*=/)) return 'attribute';
    // $变量
    if (stream.match(/\$[a-zA-Z_][a-zA-Z0-9_]*/)) return 'string';
    return stream.next();
  }
});

// 根据完整路径/文件名返回 CodeMirror 语言（带缓存）。
// .conf 不能一律当 nginx：仅 nginx 相关路径用 nginx，其余 conf 走 ini/properties。
const LANG_CACHE = {};

function isNginxConfigPath(fullPath, baseName) {
  const path = String(fullPath || '').replace(/\\/g, '/').toLowerCase();
  const base = String(baseName || '').toLowerCase();
  if (!base) return false;
  if (base === 'nginx.conf' || base.endsWith('.nginx')) return true;
  if (base.endsWith('.conf') && (path.includes('/nginx/') || path.includes('/nginx-') || path.includes('nginx'))) {
    return true;
  }
  // common site config names under nginx trees
  if ((base.endsWith('.conf') || base.endsWith('.vhost')) && /(^|\/)(sites-available|sites-enabled|conf\.d)(\/|$)/.test(path)) {
    return true;
  }
  return false;
}

function getLanguage(filename) {
  const raw = String(filename || '');
  const normalized = raw.replace(/\\/g, '/');
  const base = (normalized.split('/').pop() || '').toLowerCase();
  const ext = (base.split('.').pop() || '').toLowerCase();
  // cache by full path for .conf (same name can be nginx or ini in different dirs)
  const cacheKey = (ext === 'conf' || base === 'nginx.conf' || base.endsWith('.nginx') || base === 'dockerfile' || base.startsWith('dockerfile.') || base === 'cmakelists.txt' || base.endsWith('.cmake'))
    ? normalized.toLowerCase()
    : ext;

  if (Object.prototype.hasOwnProperty.call(LANG_CACHE, cacheKey)) return LANG_CACHE[cacheKey];

  let lang = null;
  // special filenames / path-sensitive first
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    lang = StreamLanguage.define(dockerFile);
  } else if (base === 'cmakelists.txt' || base.endsWith('.cmake')) {
    lang = StreamLanguage.define(cmake);
  } else if (isNginxConfigPath(normalized, base) || ext === 'nginx') {
    lang = StreamLanguage.define(nginx);
  } else {
    switch (ext) {
      case 'js': case 'mjs': case 'cjs': lang = javascript(); break;
      case 'jsx': lang = javascript({ jsx: true }); break;
      case 'ts': lang = javascript({ typescript: true }); break;
      case 'tsx': lang = javascript({ jsx: true, typescript: true }); break;
      case 'py': case 'pyw': case 'pyi': lang = python(); break;
      case 'html': case 'htm': lang = html(); break;
      case 'css': case 'scss': case 'less': lang = css(); break;
      case 'json': case 'jsonc': lang = json(); break;
      case 'xml': case 'svg': case 'xsl': case 'xsd': lang = xml(); break;
      case 'sql': lang = sql(); break;
      case 'sh': case 'bash': case 'zsh': case 'ksh': lang = StreamLanguage.define(shell); break;
      case 'lua': lang = StreamLanguage.define(lua); break;
      case 'go': lang = StreamLanguage.define(go); break;
      case 'rs': lang = StreamLanguage.define(rust); break;
      case 'yml': case 'yaml': lang = StreamLanguage.define(yaml); break;
      case 'toml': lang = StreamLanguage.define(toml); break;
      case 'rb': case 'rake': case 'gemspec': lang = StreamLanguage.define(ruby); break;
      case 'pl': case 'pm': case 't': lang = StreamLanguage.define(perl); break;
      case 'ps1': case 'psm1': case 'psd1': lang = StreamLanguage.define(powerShell); break;
      case 'dockerfile': lang = StreamLanguage.define(dockerFile); break;
      // generic conf/cfg/ini/env → properties (ini-like). nginx-specific handled above.
      case 'conf': case 'ini': case 'cfg': case 'env': case 'properties':
        lang = StreamLanguage.define(properties); break;
      case 'diff': case 'patch': lang = StreamLanguage.define(diff); break;
      case 'cmake': lang = StreamLanguage.define(cmake); break;
      case 'c': case 'h': lang = StreamLanguage.define(c); break;
      case 'cc': case 'cpp': case 'cxx': case 'hpp': case 'hh': case 'hxx':
        lang = StreamLanguage.define(cpp); break;
      case 'java': lang = StreamLanguage.define(java); break;
      case 'cs': lang = StreamLanguage.define(csharp); break;
      case 'list': case 'sources': lang = debianList; break;
      case 'repo': lang = rhelRepo; break;
      default:
        break;
    }
  }
  LANG_CACHE[cacheKey] = lang;
  return lang;
}

const BASIC_SETUP = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  history: true,
  foldGutter: true,
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  rectangularSelection: true,
  crosshairCursor: false,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: true,
  defaultKeymap: true,
  searchKeymap: true,
  historyKeymap: true,
  foldKeymap: true,
  completionKeymap: true,
  lintKeymap: true,
};

export default function FileEditor({
  files,
  activePath,
  onSave,
  onCloseFile,
  onCloseAll,
  onActivate,
  mode = 'modal',
  onModeChange,
  splitPosition = 'right',
  onSplitPositionChange,
  isActive = true,
  workbenchSessionId = '',
  workbenchOwnerId = '',
  onOpenSystemEditor,
  onOpenWithEditor,
  externalOpening = false,
}) {
  const { t } = useTranslation();
  const C = getTerminalTheme().container;

  // 每个文件的编辑内容缓存：{ [path]: content }
  const [editedContents, setEditedContents] = useState({});
  const [saving, setSaving] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [preferredExternalApp, setPreferredExternalApp] = useState(() => readPreferredExternalApp());

  useEffect(() => {
    const refreshPreferred = () => setPreferredExternalApp(readPreferredExternalApp());
    window.addEventListener('storage', refreshPreferred);
    window.addEventListener('focus', refreshPreferred);
    return () => {
      window.removeEventListener('storage', refreshPreferred);
      window.removeEventListener('focus', refreshPreferred);
    };
  }, []);

  // 打开文件时自动恢复
  useEffect(() => {
    if (minimized && activePath) setMinimized(false);
  }, [activePath]);
  const [contextMenu, setContextMenu] = useState(null);
  const [workbenchState, setWorkbenchStateState] = useState(() => getSessionWorkbenchState(workbenchSessionId));

  const activeFile = files.find(f => f.path === activePath) || files[0];
  const showWorkbenchTabs = !!workbenchState.uploadOpen;
  const activeWorkbenchTab = showWorkbenchTabs && workbenchState.activeTab === 'upload' ? 'upload' : 'editor';

  // popup 模式的位置状态
  const [popupPos, setPopupPos] = useState(() => {
    const saved = localStorage.getItem('fileEditorPopupPos');
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
    return { x: window.innerWidth - 660, y: 60, w: 620, h: 500 };
  });
  const popupPosRef = useRef(popupPos);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  useEffect(() => {
    popupPosRef.current = popupPos;
  }, [popupPos]);

  useEffect(() => {
    if (!workbenchSessionId) return undefined;
    return subscribeSessionWorkbenchState(workbenchSessionId, setWorkbenchStateState);
  }, [workbenchSessionId]);

  useEffect(() => {
    if (!workbenchSessionId || !workbenchOwnerId) return undefined;
    if (mode === 'split' && isActive) {
      const current = getSessionWorkbenchState(workbenchSessionId);
      setSessionWorkbenchState(workbenchSessionId, {
        editorSplitOpen: true,
        editorOwnerId: workbenchOwnerId,
        activeTab: current.uploadOpen ? current.activeTab || 'upload' : 'editor',
      });
      return () => {
        const latest = getSessionWorkbenchState(workbenchSessionId);
        if (latest.editorOwnerId === workbenchOwnerId) {
          setSessionWorkbenchState(workbenchSessionId, {
            editorSplitOpen: false,
            editorOwnerId: '',
            activeTab: latest.uploadOpen ? 'upload' : 'editor',
          });
        }
      };
    }
    const latest = getSessionWorkbenchState(workbenchSessionId);
    if (latest.editorOwnerId === workbenchOwnerId && latest.editorSplitOpen) {
      setSessionWorkbenchState(workbenchSessionId, {
        editorSplitOpen: false,
        editorOwnerId: '',
        activeTab: latest.uploadOpen ? 'upload' : 'editor',
      });
    }
    return undefined;
  }, [mode, isActive, workbenchOwnerId, workbenchSessionId]);

  const handleWorkbenchTabChange = useCallback((tab) => {
    if (!workbenchSessionId) return;
    setSessionWorkbenchState(workbenchSessionId, { activeTab: tab });
  }, [workbenchSessionId]);

  // 当前激活文件的内容（优先使用编辑缓存）
  const currentContent = activeFile
    ? (editedContents[activeFile.path] !== undefined ? editedContents[activeFile.path] : activeFile.content)
    : '';

  const isModified = activeFile ? currentContent !== activeFile.content : false;

  const byteSize = useMemo(() => new Blob([currentContent]).size, [currentContent]);

  const handleChange = useCallback((value) => {
    if (!activeFile) return;
    setEditedContents(prev => ({ ...prev, [activeFile.path]: value }));
  }, [activeFile]);

  // ── 右键菜单（复制/粘贴/剪切） ──
  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = window.getSelection()?.toString() || '';
    const pos = clampMenuPosition(e.clientX, e.clientY, 160, 120);
    setContextMenu({ ...pos, hasSelection: sel.length > 0 });
  };

  const handleMenuAction = (action) => {
    setContextMenu(null);
    switch (action) {
      case 'copy':
        document.execCommand('copy');
        break;
      case 'paste':
        navigator.clipboard.readText().then(text => {
          document.execCommand('insertText', false, text);
        }).catch(() => {});
        break;
      case 'cut':
        document.execCommand('cut');
        break;
      case 'selectAll':
        document.execCommand('selectAll');
        break;
    }
  };

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const handleSave = useCallback(async () => {
    if (!activeFile || !isModified) return;
    setSaving(true);
    try {
      await onSave(activeFile.path, currentContent);
      // 保存成功后清除该文件的编辑缓存
      setEditedContents(prev => {
        const next = { ...prev };
        delete next[activeFile.path];
        return next;
      });
    } finally {
      setSaving(false);
    }
  }, [activeFile, isModified, currentContent, onSave]);

  // Ctrl+S 保存
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isModified && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isModified, saving, handleSave]);

  const closeFileWithConfirm = async (path) => {
    const f = files.find((x) => x.path === path);
    const edited = editedContents[path];
    if (f && edited !== undefined && edited !== f.content) {
      const ok = await window.luminDialog?.confirm(t('文件有未保存的修改，确定关闭？'));
      if (!ok) return;
    }
    setEditedContents(prev => { const next = { ...prev }; delete next[path]; return next; });
    onCloseFile(path);
  };

  const handleCloseCurrent = async () => {
    if (activeFile) {
      await closeFileWithConfirm(activeFile.path);
    }
  };

  const handleCloseAllEditors = async () => {
    const hasModified = files.some(f => {
      const edited = editedContents[f.path];
      return edited !== undefined && edited !== f.content;
    });
    if (hasModified && !(await window.luminDialog?.confirm(t('有文件未保存，确定全部关闭？')))) return;
    onCloseAll();
  };

  // popup 拖拽逻辑
  const startPopupDrag = (e) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, px: popupPosRef.current.x, py: popupPosRef.current.y };
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      if (!isDraggingRef.current) return;
      const dx = ev.clientX - dragStartRef.current.x;
      const dy = ev.clientY - dragStartRef.current.y;
      const next = {
        ...popupPosRef.current,
        x: Math.max(0, Math.min(window.innerWidth - 200, dragStartRef.current.px + dx)),
        y: Math.max(64, Math.min(window.innerHeight - 100, dragStartRef.current.py + dy)),
      };
      setPopupPos(next);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
      localStorage.setItem('fileEditorPopupPos', JSON.stringify(popupPosRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // popup 右下角 resize 逻辑
  const startPopupResize = (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = popupPosRef.current.w;
    const startH = popupPosRef.current.h;
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const next = {
        ...popupPosRef.current,
        w: Math.max(320, Math.min(window.innerWidth - popupPosRef.current.x - 20, startW + dx)),
        h: Math.max(200, Math.min(window.innerHeight - popupPosRef.current.y - 20, startH + dy)),
      };
      setPopupPos(next);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
      localStorage.setItem('fileEditorPopupPos', JSON.stringify(popupPosRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // memo 化 lang 和 extensions，避免每次渲染创建新的 LanguageSupport 实例导致 CodeMirror 重新装配
  const lang = useMemo(
    () => (activeFile ? getLanguage(activeFile.path || activeFile.name) : null),
    [activeFile?.path, activeFile?.name],
  );
  const extensions = useMemo(() => lang ? [lang] : [], [lang]);
  const ext = activeFile ? (activeFile.name.split('.').pop() || '').toLowerCase() : '';

  // 控制 split host / container 布局
  useEffect(() => {
    const host = document.getElementById('editor-split-host');
    const container = document.getElementById('session-editor-container');
    if (!host || !container) return;
    if (!isActive || mode !== 'split') return;

    const resizer = document.getElementById('editor-split-resizer');
    const mainContent = document.getElementById('editor-main-content');
    if (resizer) {
      resizer.style.display = '';
    }
    if (splitPosition === 'left') {
      host.style.order = '0';
      if (resizer) resizer.style.order = '1';
      if (mainContent) mainContent.style.order = '2';
    } else {
      if (mainContent) mainContent.style.order = '0';
      if (resizer) resizer.style.order = '1';
      host.style.order = '2';
    }

    if (splitPosition === 'bottom') {
      container.style.flexDirection = 'column';
      host.style.width = '100%';
      host.style.height = '50%';
      host.style.minWidth = '0px';
      host.style.maxWidth = 'none';
      host.style.minHeight = '200px';
      host.style.maxHeight = '70%';
      host.style.borderTop = '1px solid var(--border)';
      host.style.borderLeft = 'none';
      host.style.borderRight = 'none';
      host.style.order = '2';
    } else {
      container.style.flexDirection = 'row';
      host.style.width = '50%';
      host.style.height = '100%';
      host.style.minWidth = '320px';
      host.style.maxWidth = '70%';
      host.style.minHeight = '0px';
      host.style.maxHeight = 'none';
      host.style.borderTop = 'none';
      host.style.borderLeft = splitPosition === 'right' ? '1px solid var(--border)' : 'none';
      host.style.borderRight = splitPosition === 'left' ? '1px solid var(--border)' : 'none';
      host.style.order = splitPosition === 'left' ? '0' : '2';
    }

    return () => {
      const latest = getSessionWorkbenchState(workbenchSessionId);
      if (latest.uploadOpen) return;
      const nextResizer = document.getElementById('editor-split-resizer');
      const nextMainContent = document.getElementById('editor-main-content');
      if (nextResizer) nextResizer.style.display = 'none';
      if (nextMainContent) nextMainContent.style.order = '1';
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
  }, [mode, splitPosition, isActive, workbenchSessionId]);

  // 标签页栏
  const tabsBar = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '4px 8px 0',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface-overlay)',
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      {files.map(f => {
        const isActive = f.path === activeFile?.path;
        const fEdited = editedContents[f.path];
        const fModified = fEdited !== undefined && fEdited !== f.content;
        return (
          <div
            key={f.path}
            className={`terminal-sub-tab ${isActive ? 'active' : ''}`}
            onClick={() => onActivate(f.path)}
            style={{ fontFamily: 'var(--font-mono)', padding: '5px 12px' }}
          >
            <span>{f.name}{fModified ? ' ●' : ''}</span>
            <span
              onClick={(e) => { e.stopPropagation(); closeFileWithConfirm(f.path); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 14,
                height: 14,
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 10,
                opacity: 0.5,
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
            >
              <X size={10} />
            </span>
          </div>
        );
      })}
    </div>
  );

  // 编辑器核心内容
  const editorContent = (
    <>
      {/* Header：最小化/关闭固定右上角；操作行加大右 padding，避免与保存重叠 */}
      <div
        className="modal-header file-editor-toolbar"
        style={{
          cursor: mode === 'popup' ? 'move' : 'default',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          rowGap: 6,
          // 非 split：最小化+关闭；split：仅关闭。留足空隙不压住保存
          padding: mode === 'split' ? '8px 40px 6px 12px' : '16px 72px 8px 16px',
          position: 'relative',
          minWidth: 0,
        }}
        onMouseDown={mode === 'popup' ? startPopupDrag : undefined}
      >
        <div
          className="modal-title"
          style={{
            flex: '1 1 140px',
            minWidth: 0,
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <SquarePen size={14} style={{ flexShrink: 0 }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
            title={activeFile ? activeFile.name : t('编辑器')}
          >
            {activeFile ? activeFile.name : t('编辑器')}
          </span>
          {isModified && (
            <span style={{
              fontSize: 11,
              background: 'var(--warning-dim)',
              color: 'var(--warning)',
              padding: '2px 8px',
              borderRadius: 4,
              fontWeight: 500,
              flexShrink: 0,
            }}>
              {t('未保存')}
            </span>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flex: '1 1 auto',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            justifyContent: 'flex-end',
            minWidth: 0,
          }}
        >
          <span style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--surface-sunken)',
            padding: '2px 8px',
            borderRadius: 4,
            flexShrink: 0,
          }}>
            {ext || 'text'}
          </span>

          {mode === 'split' && (
            <Tiptop text={t('分栏位置')} placement="bottom">
              <select
                className="btn btn-ghost btn-sm"
                value={splitPosition}
                onChange={(e) => onSplitPositionChange && onSplitPositionChange(e.target.value)}
                aria-label={t('分栏位置')}
                style={{
                  padding: '4px 6px',
                  fontSize: 11,
                  cursor: 'pointer',
                  border: 'none',
                  background: 'var(--surface-overlay)',
                  color: 'var(--text-primary)',
                  borderRadius: 6,
                  flexShrink: 0,
                }}
              >
                <option value="left">{t('左侧分栏')}</option>
                <option value="right">{t('右侧分栏')}</option>
                <option value="bottom">{t('底部分栏')}</option>
              </select>
            </Tiptop>
          )}

          <Tiptop text={t('编辑模式')} placement="bottom">
            <select
              className="btn btn-ghost btn-sm"
              value={mode}
              onChange={(e) => onModeChange && onModeChange(e.target.value)}
              aria-label={t('编辑模式')}
              style={{
                padding: '4px 6px',
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                background: 'var(--surface-overlay)',
                color: 'var(--text-primary)',
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              <option value="modal">{t('全屏弹窗')}</option>
              <option value="popup">{t('浮动面板')}</option>
              <option value="split">{t('分栏编辑')}</option>
            </select>
          </Tiptop>

          <Tiptop text={t('使用系统编辑器')} placement="bottom">
            <button
              className="btn btn-ghost btn-sm"
              disabled={!activeFile || externalOpening || !onOpenSystemEditor}
              onClick={() => onOpenSystemEditor?.(activeFile, currentContent)}
              aria-label={t('使用系统编辑器')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                fontSize: 11,
                flexShrink: 0,
                maxWidth: '100%',
              }}
            >
              <ExternalLink size={13} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('使用系统编辑器')}
              </span>
            </button>
          </Tiptop>

          <Tiptop
            text={preferredExternalApp
              ? `${t('用已记住的编辑器打开')} (${preferredExternalAppLabel(preferredExternalApp)})`
              : t('用…编辑')}
            placement="bottom"
          >
            <button
              className="btn btn-ghost btn-sm"
              disabled={!activeFile || externalOpening || !onOpenWithEditor}
              onClick={() => {
                onOpenWithEditor?.(activeFile, currentContent, false);
                setTimeout(() => setPreferredExternalApp(readPreferredExternalApp()), 0);
              }}
              aria-label={preferredExternalApp
                ? `${t('用已记住的编辑器打开')} (${preferredExternalAppLabel(preferredExternalApp)})`
                : t('用…编辑')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                fontSize: 11,
                flexShrink: 0,
                maxWidth: preferredExternalApp ? 110 : undefined,
                minWidth: 0,
              }}
            >
              <AppWindow size={13} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {preferredExternalApp
                  ? `${t('用')} ${preferredExternalAppLabel(preferredExternalApp)}`
                  : t('用…编辑')}
              </span>
            </button>
          </Tiptop>

          {preferredExternalApp && (
            <Tiptop text={t('更换外部编辑器')} placement="bottom">
              <button
                className="btn btn-ghost btn-sm"
                disabled={!activeFile || externalOpening || !onOpenWithEditor}
                onClick={() => {
                  onOpenWithEditor?.(activeFile, currentContent, true);
                  setTimeout(() => setPreferredExternalApp(readPreferredExternalApp()), 0);
                }}
                aria-label={t('更换外部编辑器')}
                style={{ padding: '4px 8px', fontSize: 11, flexShrink: 0 }}
              >
                {t('更换…')}
              </button>
            </Tiptop>
          )}

          <Tiptop text={saving ? t('保存中...') : t('保存')} placement="bottom">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving || !isModified}
              aria-label={t('保存')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '4px 10px',
                fontSize: 11,
                flexShrink: 0,
                minHeight: 28,
              }}
            >
              <Save size={13} style={{ flexShrink: 0 }} />
              {saving ? t('保存中...') : t('保存')}
            </button>
          </Tiptop>
        </div>

        {mode !== 'split' && (
          <Tiptop text={t('最小化')} placement="bottom" style={{ position: 'absolute', top: 8, right: 36, zIndex: Z.PANEL_BUTTON }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMinimized(true)} aria-label={t('最小化')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </Tiptop>
        )}
        <Tiptop text={t('关闭当前文件')} placement="bottom" style={{ position: 'absolute', top: 8, right: 8, zIndex: Z.PANEL_BUTTON }}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCloseCurrent} aria-label={t('关闭当前文件')}>
            <X size={14} />
          </button>
        </Tiptop>
      </div>

      {/* Tabs */}
      {files.length > 1 && tabsBar}

      {/* File path */}
      <div style={{
        padding: '4px 16px 8px',
        fontSize: 11,
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
        borderBottom: '1px solid var(--border)',
        overflow: 'auto',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {activeFile ? activeFile.path : ''}
      </div>

      {/* Editor */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {activeFile && (
          <CodeMirror
            key={activeFile.path}
            value={currentContent}
            height="100%"
            minHeight="200px"
            theme={oneDark}
            extensions={extensions}
            onChange={handleChange}
            style={{ fontSize: 14, height: '100%' }}
            basicSetup={BASIC_SETUP}
          />
        )}
      </div>

      {/* Footer status bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 16px',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
      }}>
        <span>{currentContent.split('\n').length}{t('行')} · {byteSize}{t('字节')}</span>
        <span>UTF-8 · {lang ? ext.toUpperCase() : t('文本')}</span>
      </div>

      {/* 右键菜单 */}
      {contextMenu && createPortal(
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: C.contextBg,
            border: '1px solid ' + C.btnBorder,
            borderRadius: '8px',
            boxShadow: C.contextShadow,
            zIndex: Z.FLOATING_EDITOR_MENU,
            padding: '4px 0',
            minWidth: '160px',
            fontFamily: 'var(--font-ui)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {[
            { label: t('复制'), action: 'copy', shortcut: formatShortcut('Ctrl+C'), disabled: !contextMenu?.hasSelection },
            { label: t('粘贴'), action: 'paste', shortcut: formatShortcut('Ctrl+V') },
            { label: t('剪切'), action: 'cut', shortcut: formatShortcut('Ctrl+X'), disabled: !contextMenu?.hasSelection },
            { label: t('全选'), action: 'selectAll', shortcut: formatShortcut('Ctrl+A') },
          ].map((item) => (
            <div
              key={item.action}
              className="context-menu-item"
              style={{ padding: '6px 12px', cursor: item.disabled ? 'default' : 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 13, opacity: item.disabled ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = 'rgba(128,128,128,0.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              onClick={() => { if (!item.disabled) handleMenuAction(item.action); }}
            >
              <span>{item.label}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{item.shortcut}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );

  // 最小化浮动条
  if (minimized) {
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div
        onClick={() => setMinimized(false)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: Z.FLOATING_EDITOR,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          background: 'var(--surface-overlay)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-md)',
          cursor: 'pointer',
          userSelect: 'none',
          animation: 'fadeIn 0.15s ease',
          pointerEvents: 'auto',
        }}
      >
        <SquarePen size={14} style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeFile ? activeFile.name : t('编辑器')}
        </span>
        {files.length > 1 && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--surface-sunken)', padding: '1px 6px', borderRadius: 4 }}>
            {files.length}
          </span>
        )}
        {isModified && <span style={{ fontSize: 11, color: 'var(--warning)' }}>{t('未保存')}</span>}
      </div>,
      document.body
    );
  }

  if (mode === 'popup') {
    if (!isActive || typeof document === 'undefined') return null;
    return createPortal(
      <div
        style={{
          position: 'fixed',
          left: popupPos.x,
          top: popupPos.y,
          width: popupPos.w,
          height: popupPos.h,
          zIndex: Z.FLOATING_EDITOR,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
        onContextMenu={handleContextMenu}
      >
        {editorContent}
        {/* resize handle */}
        <Tiptop text={t('调整大小')} style={{ position: 'absolute', right: 0, bottom: 0, zIndex: Z.STACK }}>
          <div
            onMouseDown={startPopupResize}
            aria-label={t('调整大小')}
            style={{
              width: 16,
              height: 16,
              cursor: 'se-resize',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" style={{ position: 'absolute', right: 2, bottom: 2, opacity: 0.3 }}>
              <path d="M8 12v-2h2v2H8zm0-4V6h2v2H8zm0-4V2h2v2H8zM4 12v-2h2v2H4z" fill="currentColor" />
            </svg>
          </div>
        </Tiptop>
      </div>,
      document.body
    );
  }

  if (mode === 'split') {
    if (!isActive) return null;
    const host = document.getElementById('editor-split-host');
    if (!host) return null;
    return createPortal(
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }} onContextMenu={handleContextMenu}>
        {showWorkbenchTabs && (
          <div className="terminal-sub-tab-bar">
            <button
              className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${activeWorkbenchTab === 'editor' ? 'active' : ''}`}
              onClick={() => handleWorkbenchTabChange('editor')}
            >
              <SquarePen size={14} />
              {t('编辑器')}
            </button>
            <button
              className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${activeWorkbenchTab === 'upload' ? 'active' : ''}`}
              onClick={() => handleWorkbenchTabChange('upload')}
            >
              <Upload size={14} />
              {t('上传队列')}
            </button>
          </div>
        )}
        <div
          id={`workbench-editor-panel-${workbenchSessionId}`}
          style={{
            display: activeWorkbenchTab === 'editor' ? 'flex' : 'none',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          {editorContent}
        </div>
        {showWorkbenchTabs && (
          <div
            id={`workbench-upload-panel-${workbenchSessionId}`}
            style={{
              display: activeWorkbenchTab === 'upload' ? 'flex' : 'none',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
            }}
          />
        )}
      </div>,
      host
    );
  }

  // modal mode (default) — portal to body so file-manager stacking context cannot bury the editor
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay" style={{ zIndex: Z.MODAL }} onContextMenu={handleContextMenu}>
      <div className="modal modal-xl" style={{ display: 'flex', flexDirection: 'column', maxHeight: '90vh', marginTop: 48 }}>
        {editorContent}
      </div>
    </div>,
    document.body,
  );
}
