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
import { X, Pencil, Save, SquarePen } from 'lucide-react';
import { Z } from '../constants/zIndex';

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

// 根据文件扩展名返回对应的 CodeMirror 语言（带缓存，避免每次创建新实例）
const LANG_CACHE = {};
function getLanguage(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (LANG_CACHE[ext]) return LANG_CACHE[ext];
  let lang = null;
  switch (ext) {
    case 'js': lang = javascript(); break;
    case 'jsx': lang = javascript({ jsx: true }); break;
    case 'ts': lang = javascript({ typescript: true }); break;
    case 'tsx': lang = javascript({ jsx: true, typescript: true }); break;
    case 'py': lang = python(); break;
    case 'html': case 'htm': lang = html(); break;
    case 'css': case 'scss': case 'less': lang = css(); break;
    case 'json': lang = json(); break;
    case 'xml': case 'svg': lang = xml(); break;
    case 'sql': lang = sql(); break;
    case 'sh': case 'bash': case 'zsh': lang = StreamLanguage.define(shell); break;
    case 'list': case 'sources': lang = debianList; break;
    case 'repo': lang = rhelRepo; break;
  }
  LANG_CACHE[ext] = lang;
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
}) {
  const { t } = useTranslation();
  const C = getTerminalTheme().container;

  // 每个文件的编辑内容缓存：{ [path]: content }
  const [editedContents, setEditedContents] = useState({});
  const [saving, setSaving] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // 打开文件时自动恢复
  useEffect(() => {
    if (minimized && activePath) setMinimized(false);
  }, [activePath]);
  const [contextMenu, setContextMenu] = useState(null);

  const activeFile = files.find(f => f.path === activePath) || files[0];

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
  const lang = useMemo(() => activeFile ? getLanguage(activeFile.name) : null, [activeFile?.name]);
  const extensions = useMemo(() => lang ? [lang] : [], [lang]);
  const ext = activeFile ? (activeFile.name.split('.').pop() || '').toLowerCase() : '';

  // 控制 split host / container 布局
  useEffect(() => {
    const host = document.getElementById('editor-split-host');
    const container = document.getElementById('session-editor-container');
    if (!host || !container) return;

    if (!isActive || mode !== 'split') {
      // 非活跃或非分栏模式：隐藏 split host 和 resizer
      const resizer = document.getElementById('editor-split-resizer');
      const mainContent = document.getElementById('editor-main-content');
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
      return;
    }

    // 显示 resize handle
    const resizer = document.getElementById('editor-split-resizer');
    const mainContent = document.getElementById('editor-main-content');
    if (resizer) {
      resizer.style.display = '';
    }
    // 分栏在左：split=0, resizer=1, main=2；分栏在右：main=1, resizer=2, split=3 → 改为 main=0, resizer=1, split=2
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
      // 组件卸载时重置 split host 和 container 样式
      if (!host || !container) return;
      const resizer = document.getElementById('editor-split-resizer');
      const mainContent = document.getElementById('editor-main-content');
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
  }, [mode, splitPosition, isActive]);

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
      {/* Header */}
      <div
        className="modal-header"
        style={{
          paddingBottom: 8,
          cursor: mode === 'popup' ? 'move' : 'default',
          flexWrap: 'wrap',
          gap: 8,
          padding: mode === 'split' ? '8px 56px 4px 12px' : '20px 64px 0 24px',
          position: 'relative',
        }}
        onMouseDown={mode === 'popup' ? startPopupDrag : undefined}
      >
        <div className="modal-title" style={{ flexShrink: 0, minWidth: 0 }}>
          <SquarePen size={14} style={{ flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
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
            }}>
              {t('未保存')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <span style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--surface-sunken)',
            padding: '2px 8px',
            borderRadius: 4,
          }}>
            {ext || 'text'}
          </span>

          {/* 分栏位置选择（仅在 split 模式显示） */}
          {mode === 'split' && (
            <select
              className="btn btn-ghost btn-sm"
              value={splitPosition}
              onChange={(e) => onSplitPositionChange && onSplitPositionChange(e.target.value)}
              style={{ padding: '4px 6px', fontSize: 11, cursor: 'pointer', border: 'none', background: 'var(--surface-overlay)', color: 'var(--text-primary)', borderRadius: 6 }}
            >
              <option value="left">{t('左侧分栏')}</option>
              <option value="right">{t('右侧分栏')}</option>
              <option value="bottom">{t('底部分栏')}</option>
            </select>
          )}

          <select
            className="btn btn-ghost btn-sm"
            value={mode}
            onChange={(e) => onModeChange && onModeChange(e.target.value)}
            style={{ padding: '4px 6px', fontSize: 11, cursor: 'pointer', border: 'none', background: 'var(--surface-overlay)', color: 'var(--text-primary)', borderRadius: 6 }}
          >
            <option value="modal">{t('全屏弹窗')}</option>
            <option value="popup">{t('浮动面板')}</option>
            <option value="split">{t('分栏编辑')}</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !isModified}>
            {saving ? t('保存中...') : <><Save size={13} /> {t('保存')}</>}
          </button>
        </div>
        {mode !== 'split' && (
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMinimized(true)} title={t('最小化')}
            style={{ position: 'absolute', top: 8, right: 28, zIndex: Z.PANEL_BUTTON }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        )}
        <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCloseCurrent} title={t('关闭当前文件')}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: Z.PANEL_BUTTON }}>
          <X size={14} />
        </button>
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
            zIndex: Z.SEARCH_PANEL,
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
    return (
      <div
        onClick={() => setMinimized(false)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: Z.EDITOR_TOOLBAR,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          background: 'var(--surface-overlay)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          cursor: 'pointer',
          userSelect: 'none',
          animation: 'fadeIn 0.15s ease',
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
      </div>
    );
  }

  if (mode === 'popup') {
    if (!isActive) return null;
    return (
      <div
        style={{
          position: 'fixed',
          left: popupPos.x,
          top: popupPos.y,
          width: popupPos.w,
          height: popupPos.h,
          zIndex: Z.EDITOR_TOOLBAR,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
        onContextMenu={handleContextMenu}
      >
        {editorContent}
        {/* resize handle */}
        <div
          onMouseDown={startPopupResize}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            cursor: 'se-resize',
            zIndex: Z.STACK,
          }}
          title={t('调整大小')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ position: 'absolute', right: 2, bottom: 2, opacity: 0.3 }}>
            <path d="M8 12v-2h2v2H8zm0-4V6h2v2H8zm0-4V2h2v2H8zM4 12v-2h2v2H4z" fill="currentColor" />
          </svg>
        </div>
      </div>
    );
  }

  if (mode === 'split') {
    if (!isActive) return null;
    const host = document.getElementById('editor-split-host');
    if (!host) return null;
    return createPortal(
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }} onContextMenu={handleContextMenu}>
        {editorContent}
      </div>,
      host
    );
  }

  // modal mode (default)
  return (
    <div className="modal-overlay" onContextMenu={handleContextMenu}>
      <div className="modal modal-xl" style={{ display: 'flex', flexDirection: 'column', maxHeight: '90vh', marginTop: 48 }}>
        {editorContent}
      </div>
    </div>
  );
}
