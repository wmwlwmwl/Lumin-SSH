import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from '../i18n.js';
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
import { Maximize2, PictureInPicture, Columns2, X, PanelLeft, PanelRight, PanelBottom } from 'lucide-react';

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

const MODE_ICONS_KEYS = {
  modal: { icon: Maximize2, titleKey: '全屏弹窗' },
  popup: { icon: PictureInPicture, titleKey: '浮动面板' },
  split: { icon: Columns2, titleKey: '分栏编辑' },
};

const MODE_ORDER = ['modal', 'popup', 'split'];

const SPLIT_ICONS_KEYS = {
  left: { icon: PanelLeft, titleKey: '左侧分栏' },
  right: { icon: PanelRight, titleKey: '右侧分栏' },
  bottom: { icon: PanelBottom, titleKey: '底部分栏' },
};

const SPLIT_ORDER = ['left', 'right', 'bottom'];

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

  // 每个文件的编辑内容缓存：{ [path]: content }
  const [editedContents, setEditedContents] = useState({});
  const [saving, setSaving] = useState(false);
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
    const menuW = 160, menuH = 120;
    const x = e.clientX + menuW > window.innerWidth ? e.clientX - menuW : e.clientX;
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;
    setContextMenu({ x, y });
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

  const handleSave = async () => {
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
  };

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

  const toggleMode = () => {
    const idx = MODE_ORDER.indexOf(mode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    onModeChange?.(next);
  };

  const toggleSplitPosition = () => {
    const idx = SPLIT_ORDER.indexOf(splitPosition);
    const next = SPLIT_ORDER[(idx + 1) % SPLIT_ORDER.length];
    onSplitPositionChange?.(next);
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
        y: Math.max(0, Math.min(window.innerHeight - 100, dragStartRef.current.py + dy)),
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

  // memo 化 lang 和 extensions，避免每次渲染创建新 LanguageSupport 实例导致 CodeMirror 重新装配
  const lang = useMemo(() => activeFile ? getLanguage(activeFile.name) : null, [activeFile?.name]);
  const extensions = useMemo(() => lang ? [lang] : [], [lang]);
  const ext = activeFile ? (activeFile.name.split('.').pop() || '').toLowerCase() : '';

  // 控制 split host / container 布局
  useEffect(() => {
    const host = document.getElementById('editor-split-host');
    const container = document.getElementById('session-editor-container');
    if (!host || !container) return;

    if (!isActive || mode !== 'split') {
      // 非活跃或非分栏模式：隐藏 split host
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
      background: 'var(--bg-2)',
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
            onClick={() => onActivate(f.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              borderRadius: '4px 4px 0 0',
              border: '1px solid transparent',
              borderBottom: isActive ? '1px solid var(--bg-1)' : '1px solid var(--border)',
              background: isActive ? 'var(--bg-1)' : 'transparent',
              color: isActive ? 'var(--text-1)' : 'var(--text-3)',
              whiteSpace: 'nowrap',
              position: 'relative',
              top: '1px',
            }}
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
        }}
        onMouseDown={mode === 'popup' ? startPopupDrag : undefined}
      >
        <div className="modal-title" style={{ flex: 1, minWidth: 0 }}>
          <span>✏️</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
            {activeFile ? activeFile.name : t('编辑器')}
          </span>
          {isModified && (
            <span style={{
              fontSize: 11,
              background: 'var(--yellow-dim)',
              color: 'var(--yellow)',
              padding: '2px 8px',
              borderRadius: 4,
              fontWeight: 500,
            }}>
              {t('未保存')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            fontSize: 11,
            color: 'var(--text-4)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--bg-3)',
            padding: '2px 8px',
            borderRadius: 4,
          }}>
            {ext || 'text'}
          </span>

          {/* 分栏位置切换（仅在 split 模式显示） */}
          {mode === 'split' && (
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={toggleSplitPosition}
              title={t(SPLIT_ICONS_KEYS[splitPosition].titleKey)}
              style={{ padding: '4px 6px' }}
            >
              {(() => {
                const Icon = SPLIT_ICONS_KEYS[splitPosition].icon;
                return <Icon size={14} />;
              })()}
            </button>
          )}

          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={toggleMode}
            title={t(MODE_ICONS_KEYS[mode].titleKey)}
            style={{ padding: '4px 6px' }}
          >
            {(() => {
              const Icon = MODE_ICONS_KEYS[mode].icon;
              return <Icon size={14} />;
            })()}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving || !isModified}
          >
            {saving ? t('保存中...') : t('💾 保存')}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCloseCurrent} title={t('关闭当前文件')}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      {files.length > 1 && tabsBar}

      {/* File path */}
      <div style={{
        padding: '4px 16px 8px',
        fontSize: 11,
        color: 'var(--text-4)',
        fontFamily: 'var(--font-mono)',
        borderBottom: '1px solid var(--border)',
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
        color: 'var(--text-4)',
        fontFamily: 'var(--font-mono)',
      }}>
        <span>{currentContent.split('\n').length}{t('行')} · {byteSize}{t('字节')}</span>
        <span>UTF-8 · {lang ? ext.toUpperCase() : 'Text'}</span>
      </div>

      {/* 右键菜单 */}
      {contextMenu && createPortal(
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: '#161b22',
            border: '1px solid rgba(48,54,61,0.9)',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            zIndex: 10000,
            padding: '4px 0',
            minWidth: '160px',
            fontFamily: 'var(--font-ui)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {[
            { label: t('复制'), action: 'copy', shortcut: 'Ctrl+C' },
            { label: t('粘贴'), action: 'paste', shortcut: 'Ctrl+V' },
            { label: t('剪切'), action: 'cut', shortcut: 'Ctrl+X' },
            { label: t('全选'), action: 'selectAll', shortcut: 'Ctrl+A' },
          ].map((item) => (
            <div
              key={item.action}
              className="context-menu-item"
              style={{ padding: '6px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.08)'}
              onMouseLeave={(e) => e.target.style.background = 'none'}
              onClick={() => handleMenuAction(item.action)}
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

  if (mode === 'popup') {
    if (!isActive) return null;
    return createPortal(
      <div
        style={{
          position: 'fixed',
          left: popupPos.x,
          top: popupPos.y,
          width: popupPos.w,
          height: popupPos.h,
          zIndex: 9998,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-1)',
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
            zIndex: 2,
          }}
          title={t('调整大小')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ position: 'absolute', right: 2, bottom: 2, opacity: 0.3 }}>
            <path d="M8 12v-2h2v2H8zm0-4V6h2v2H8zm0-4V2h2v2H8zM4 12v-2h2v2H4z" fill="currentColor" />
          </svg>
        </div>
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
        {editorContent}
      </div>,
      host
    );
  }

  // modal mode (default)
  return (
    <div className="modal-overlay" onContextMenu={handleContextMenu}>
      <div className="modal modal-xl" style={{ display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        {editorContent}
      </div>
    </div>
  );
}
