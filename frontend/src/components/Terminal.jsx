import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Copy, Clipboard, Trash2, CheckSquare, Play, Clock, X, Zap, MessageSquarePlus } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { EventsOn } from '../../wailsjs/runtime/runtime.js';
import { getModKey, formatShortcut } from '../utils/platform.js';
import { clampMenuPosition } from '../utils/menuPosition.js';
import {
  buildPathAutocompleteContext,
  buildStaticAutocompleteItems,
  createCommandAutocompleteState,
  loadPathAutocompleteItems,
  normalizeHistoryCommands,
  normalizeQuickCommandItems,
  normalizeRemoteAbsolutePath,
} from '../utils/terminalCommandAutocomplete.js';
import QuickCommands from './QuickCommands.jsx';
import Tiptop from './Tiptop.jsx';
import '@xterm/xterm/css/xterm.css';
import { useTranslation } from '../i18n.js';
import defaultTermBg from '../assets/term_bg.png';
import { Z } from '../constants/zIndex';
import { getTerminalTheme, getAppThemeMode } from '../utils/theme.js';
import { getResolvedProgramFontPreferences } from '../utils/programFonts.js';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function formatTerminalTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `[${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}]`;
}

function getTerminalBufferSnapshotText(term) {
  if (!term?.buffer?.active) {
    return ''
  }
  const buffer = term.buffer.active
  const totalLines = Math.max(Number(buffer.length) || 0, (Number(buffer.baseY) || 0) + (Number(term.rows) || 0))
  const lines = []
  for (let index = 0; index < totalLines; index += 1) {
    const line = buffer.getLine(index)
    if (!line) {
      continue
    }
    lines.push(line.translateToString(true))
  }
  return lines.join('\n').trim()
}

function isInteractivePromptText(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^(choose|select|enter|input|please enter|press enter|would you like|do you have|port to use)\b/i.test(text)) return true
  if (/\b(default|leave empty|skip|y\/n|yes\/no|option|selection)\b/i.test(text) && /[:?]\s*(?:\d+)?\s*$/.test(text)) return true
  return /\[[yn0-9/\-]+\]:?\s*(?:\d+)?\s*$/i.test(text)
}

function splitTrailingIncompleteEscapeSequence(input) {
  if (!input) {
    return { complete: '', carry: '' }
  }

  const lastEscapeIndex = input.lastIndexOf('\x1b')
  if (lastEscapeIndex === -1) {
    return { complete: input, carry: '' }
  }

  const suffix = input.slice(lastEscapeIndex)
  if (suffix.length === 1) {
    return { complete: input.slice(0, lastEscapeIndex), carry: suffix }
  }

  if (suffix[1] === '[') {
    for (let index = 2; index < suffix.length; index += 1) {
      const code = suffix.charCodeAt(index)
      if (code >= 0x40 && code <= 0x7E) {
        return { complete: input, carry: '' }
      }
    }
    return { complete: input.slice(0, lastEscapeIndex), carry: suffix }
  }

  if (suffix[1] === ']') {
    for (let index = 2; index < suffix.length; index += 1) {
      if (suffix[index] === '\x07') {
        return { complete: input, carry: '' }
      }
      if (suffix[index] === '\x1b' && index + 1 < suffix.length && suffix[index + 1] === '\\') {
        return { complete: input, carry: '' }
      }
    }
    return { complete: input.slice(0, lastEscapeIndex), carry: suffix }
  }

  return { complete: input, carry: '' }
}

// 命令栏按钮样式辅助函数
const btnStyle = (color) => ({
  border: '1px solid var(--border)',
  background: 'var(--surface-raised)',
  color: color === 'red' ? 'var(--danger)' : 'var(--text-secondary)',
  cursor: 'pointer',
  borderRadius: 'var(--radius-xs)',
  padding: '3px 8px',
});
const iconBtnStyle = (color) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24,
  background: 'var(--surface-raised)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-xs)',
  color,
  cursor: 'pointer',
  transition: 'var(--transition-fast)',
});

export default function Terminal({ sessionId, serverId, historyServerId, status, isActive, serverName, connectedSessions = [] }) {
  const { t } = useTranslation();
  const containerRef   = useRef(null);
  const wrapperRef     = useRef(null);
  const termRef        = useRef(null);
  const fitAddonRef    = useRef(null);
  const wsRef          = useRef(null);
  const statusRef      = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const serverIdRef    = useRef(serverId);
  serverIdRef.current  = serverId;
  const [themeToggle, setThemeToggle]     = useState(0); // 用于强制重渲染（浅色/深色模式切换）
  const [contextMenu, setContextMenu]         = useState(null);
  const [contextHasSelection, setContextHasSelection] = useState(false);
  const [justConnected, setJustConnected]     = useState(false);
  const [cmdInput, setCmdInput]               = useState('');
  const [showHistory, setShowHistory]         = useState(false);
  const [historyList, setHistoryList]         = useState([]);
  const historyListRef                        = useRef([]);
  useEffect(() => { historyListRef.current = historyList; }, [historyList]);
  const [historyMode, setHistoryMode]         = useState('server'); // 'server' | 'global'
  const [searchQuery, setSearchQuery]         = useState('');
  const cmdInputRef                           = useRef(null);
  const historyBtnRef                         = useRef(null);
  const historyScrollRef                      = useRef(null);
  const [historyPopupPos, setHistoryPopupPos] = useState(null);
  const [showCommands, setShowCommands]       = useState(false);
  const [commandsPopupPos, setCommandsPopupPos] = useState(null);
  const commandsBtnRef                        = useRef(null);
  const quickCmdsRef                          = useRef(null);
  const quickCmdsPopupRef                     = useRef(null);
  const historyPopupRef                       = useRef(null);
  const pendingCmdRef                         = useRef('');
  const awaitingPasswordRef                   = useRef(false); // 检测到密码提示后，下一行输入不记入命令历史
  const [terminalCwd, setTerminalCwd]         = useState('/');
  const [commandAutocomplete, setCommandAutocomplete] = useState(createCommandAutocompleteState());
  const commandAutocompleteRequestRef         = useRef(0);
  const commandAutocompleteFocusedRef         = useRef(false);
  const commandAutocompleteKeyboardNavigationRef = useRef(false);
  const commandAutocompleteDebounceRef        = useRef(null);
  const commandAutocompleteBlurTimerRef       = useRef(null);
  const commandAutocompleteDataRef            = useRef({
    historyServerId: '',
    serverHistory: [],
    globalHistory: [],
    quickCommands: [],
    serverLoaded: false,
    globalLoaded: false,
    quickLoaded: false,
  });
  const commandAutocompleteListRef            = useRef(null);

  // ── 点击快捷命令弹窗外关闭（document 级 mousedown，不阻塞 click） ──
  useEffect(() => {
    if (!showCommands) return;
    const handler = (e) => {
      if (quickCmdsPopupRef.current && !quickCmdsPopupRef.current.contains(e.target)) {
        if (quickCmdsRef.current?.isDirty?.()) {
          quickCmdsRef.current.showCloseConfirm();
        } else {
          setShowCommands(false);
          setCommandsPopupPos(null);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCommands]);

  // ── 点击历史弹窗外关闭（document 级 mousedown） ──
  useEffect(() => {
    if (!showHistory) return;
    const handler = (e) => {
      if (historyPopupRef.current && !historyPopupRef.current.contains(e.target)) {
        setShowHistory(false);
        setHistoryPopupPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  // 热路径缓存：避免在按键和消息回调中频繁读取 localStorage
  const shortcutsRef = useRef(null);
  const localEchoRef = useRef(localStorage.getItem('terminalLocalEcho') === 'true');
  const timestampsEnabledRef = useRef(localStorage.getItem('terminalTimestamps') === 'true');
  const [timestampsVisible, setTimestampsVisible] = useState(localStorage.getItem('terminalTimestamps') === 'true');
  const [alternateBufferActive, setAlternateBufferActive] = useState(false);
  const alternateBufferActiveRef = useRef(false);
  // Ring buffer 时间戳：用 xterm marker 跟随 scrollback 裁剪，避免 buffer 行号复用后错位
  const TS_POOL = 6000;
  const tsRingRef = useRef(null);
  if (!tsRingRef.current) {
    tsRingRef.current = { entries: new Array(TS_POOL), next: 0 };
  }
  const tsSet = (marker, val) => {
    if (!marker) return;
    const r = tsRingRef.current;
    const i = r.next;
    r.entries[i]?.marker?.dispose?.();
    r.entries[i] = { marker, val };
    r.next = (i + 1) % TS_POOL;
  };
  const tsEnsureLine = (term, line, timestampsByLine) => {
    if (term.buffer.active.type !== 'normal') return '';
    const existing = timestampsByLine.get(line);
    if (existing) return existing;
    const currentLine = term.buffer.active.baseY + term.buffer.active.cursorY;
    const ts = formatTerminalTimestamp();
    const marker = term.registerMarker(line - currentLine);
    tsSet(marker, ts);
    if (marker) timestampsByLine.set(line, ts);
    return marker ? ts : '';
  };
  const tsClearLine = (line) => {
    const entries = tsRingRef.current.entries;
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i]?.marker?.line === line) {
        entries[i].marker.dispose?.();
        entries[i] = null;
      }
    }
  };
  const tsClear = () => {
    tsRingRef.current.entries.forEach((entry) => entry?.marker?.dispose?.());
    tsRingRef.current.entries.fill(null);
    tsRingRef.current.next = 0;
  };
  const gutterRef = useRef(null);
  const gutterSyncRAFRef = useRef(null);
  const smartWriteRef = useRef(null);

  // ponytail: getTerminalTheme() 每次渲染调用 30+ 次，缓存为 1 次
  const T = useMemo(() => getTerminalTheme(), [themeToggle]);

  // ── 时间轴：同步 gutter 到 xterm 视口 ───────────────────────────
  function scheduleGutterSync() {
    if (gutterSyncRAFRef.current !== null || !timestampsEnabledRef.current || alternateBufferActiveRef.current) return;
    gutterSyncRAFRef.current = requestAnimationFrame(() => {
      gutterSyncRAFRef.current = null;
      syncGutter();
    });
  }

  function syncGutter() {
    const gutter = gutterRef.current;
    const term = termRef.current;
    if (!gutter || !term || !timestampsEnabledRef.current || term.buffer.active.type !== 'normal') return;
    const buf = term.buffer.active;
    const rows = term.rows;
    if (!rows || !containerRef.current) return;

    const timestampsByLine = new Map();
    const ring = tsRingRef.current;
    for (let offset = 0; offset < ring.entries.length; offset += 1) {
      const index = (ring.next + offset) % ring.entries.length;
      const entry = ring.entries[index];
      const line = entry?.marker?.line;
      if (!entry || entry.marker.isDisposed || line < 0) {
        ring.entries[index] = null;
      } else if (timestampsByLine.has(line)) {
        entry.marker.dispose?.();
        ring.entries[index] = null;
      } else {
        timestampsByLine.set(line, entry.val);
      }
    }

    const firstVisible = buf.viewportY; // buffer 中第一个可见行 (ydisp)

    // 通过 xterm screen/rows 的实际渲染尺寸计算行高，确保像素级对齐
    // viewport 包含滚动容器尺寸，不能代表文本起点；screen 才是实际文本层。
    const screen = containerRef.current.querySelector('.xterm-screen');
    const rowsEl = containerRef.current.querySelector('.xterm-rows');
    let lineH;
    if (screen && rowsEl) {
      const screenRect = screen.getBoundingClientRect();
      const rowsRect = rowsEl.getBoundingClientRect();
      lineH = Math.max(rowsRect.height / rows, 1);
      const top = Math.max(rowsRect.top - screenRect.top, 0);
      const paddingTop = `${top}px`;
      if (gutter.style.paddingTop !== paddingTop) gutter.style.paddingTop = paddingTop;
    } else {
      lineH = term.options.fontSize * term.options.lineHeight;
    }

    let html = '';
    for (let i = 0; i < rows; i++) {
      const tsIdx = firstVisible + i;
      const bufLine = buf.getLine(tsIdx);
      const isEmptyLine = !bufLine || bufLine.translateToString(true) === '';
      // 空行或包裹行（超长行续行）不显示时间戳
      const isWrapped = bufLine && bufLine.isWrapped;
      let ts = '';
      if (!isEmptyLine && !isWrapped && tsIdx >= 0) {
        ts = timestampsByLine.get(tsIdx) || (tsIdx === buf.baseY + buf.cursorY ? tsEnsureLine(term, tsIdx, timestampsByLine) : '');
      }
      html += `<div style="height:${lineH}px;line-height:${lineH}px;font-size:11px;color:var(--term-status-color);font-family:var(--font-mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;overflow:hidden;padding:0 4px;box-sizing:border-box">${ts}</div>`;
    }
    gutter.innerHTML = html;
  }

  // ── 终端清屏处理：清空视口对应的时间戳 ─────────────────────
  function handleClearScreen() {
    const term = termRef.current;
    if (!term || term.buffer.active.type !== 'normal') return;
    const buf = term.buffer.active;
    const rows = term.rows || 24;
    const firstVisible = buf.viewportY;
    for (let i = 0; i < rows; i++) {
      tsClearLine(firstVisible + i);
    }
    scheduleGutterSync();
  }

  // ── 初始化 xterm + WebSocket 终端通道 ────────────────────────────────
  // xterm.js 通过 AttachAddon + WebSocket 直接连到本地 Go WebSocket 服务器
  // 完全绕开 Wails IPC跨进程通信，走 TCP loopback 延迟极低
  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const fontSize = parseInt(localStorage.getItem('terminalFontSize') || '13', 10);

    const term = new XTerm({
      theme:            T.xterm,
      fontFamily:       getResolvedProgramFontPreferences().terminalFontFamily,
      fontSize:         fontSize,
      fontWeight:       500,
      fontWeightBold:   700,
      lineHeight:       1.22,
      letterSpacing:    0.3,
      minimumContrastRatio: 3,
      cursorBlink:      true,
      cursorStyle:      'bar',
      cursorWidth:      1,
      scrollback:       5000,
      allowTransparency: true,
      fastScrollModifier: 'alt',
      macOptionIsMeta:  true,
      padding:          8,
      windowOptions: {
        setWinSizeChars: true
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    alternateBufferActiveRef.current = false;
    setAlternateBufferActive(false);

    // ── 智能写入：用户手动滚动上时保持位置 ─────────────────────────
    let userPinned = false; // 用户手动往上滚后锁定
    const onTermScroll = () => {
      const buf = term.buffer.active;
      // 滚到底部时解除锁定
      if (buf.viewportY >= buf.baseY) {
        userPinned = false;
      }
      scheduleGutterSync();
    };
    const scrollDisposable = term.onScroll(onTermScroll);
    // 直接监听 xterm 视口 DOM scroll 事件作为更可靠的备选
    const vpEl = containerRef.current.querySelector('.xterm-viewport');
    if (vpEl) {
      vpEl.addEventListener('scroll', onTermScroll, { passive: true });
    }

    // ── 每行时间戳追踪：marker 会跟随 xterm scrollback 裁剪同步移动 ──
    const lineFeedDisposable = term.onLineFeed(() => {
      if (!timestampsEnabledRef.current || term.buffer.active.type !== 'normal') return;

      const buf = term.buffer.active;
      const cursorLine = buf.baseY + buf.cursorY;
      // 往回跳过 isWrapped 包裹行，记到逻辑行首行
      let pos = cursorLine - 1;
      while (pos > 0) {
        const line = buf.getLine(pos);
        if (line && line.isWrapped) { pos--; } else { break; }
      }
      if (pos >= 0) {
        tsSet(term.registerMarker(pos - cursorLine), formatTerminalTimestamp());
      }
    });
    const writeParsedDisposable = term.onWriteParsed(scheduleGutterSync);
    const bufferChangeDisposable = term.buffer.onBufferChange((buffer) => {
      const alternate = buffer.type === 'alternate';
      alternateBufferActiveRef.current = alternate;
      setAlternateBufferActive(alternate);
      if (alternate) {
        if (gutterSyncRAFRef.current !== null) {
          cancelAnimationFrame(gutterSyncRAFRef.current);
          gutterSyncRAFRef.current = null;
        }
        if (gutterRef.current) gutterRef.current.innerHTML = '';
      } else {
        scheduleGutterSync();
      }
    });
    const wheelHandler = (e) => {
      // 无论向上还是向下滚动，都检查当前位置并更新锁定状态
      requestAnimationFrame(() => {
        const buf = term.buffer.active;
        userPinned = buf.viewportY < buf.baseY;
      });
    };
    containerRef.current?.addEventListener('wheel', wheelHandler, { passive: true });

    const isClearScreenData = (d) => {
      if (!d) return false;
      if (typeof d === 'string') return d.includes('\x1b[2J') || d.includes('\x1b[3J');
      // Binary: scan for \x1b[2J (clear) or \x1b[3J (clear scrollback)
      if (!d.includes(0x1b)) return false;
      for (let i = 0; i <= d.length - 4; i++) {
        if (d[i] === 0x1b && d[i+1] === 0x5b && (d[i+2] === 0x32 || d[i+2] === 0x33) && d[i+3] === 0x4a) {
          return true;
        }
      }
      return false;
    };
    const smartWrite = (data) => {
      if (isClearScreenData(data)) handleClearScreen();
      if (userPinned) {
        // xterm.js 在用户不在底部时已经会保持滚动位置。
        // 之前用 scrollToLine(savedY) 在异步回调中执行，会在用户向下滚动后
        // 把视图拉回旧位置，导致用户无法追上最新输出。
        // 现在仅在 xterm.js 自动滚动打断时才恢复（用相对偏移检测）。
        const buf = term.buffer.active;
        const offset = buf.baseY - buf.viewportY;
        term.write(data, () => {
          const newBuf = term.buffer.active;
          // 只有当 offset 变小（说明 xterm 自动滚动了）才恢复
          if (newBuf.baseY - newBuf.viewportY < offset) {
            const newY = newBuf.baseY - offset;
            if (newY >= 0) term.scrollToLine(newY);
          }
        });
      } else {
        term.write(data);
      }
    };
    smartWriteRef.current = smartWrite;

    // ── DOM 渲染器（WebGL 在 CJK/宽字符支持差，使用默认 DOM 渲染确保中文正常显示）──

    termRef.current    = term;
    fitAddonRef.current = fitAddon;
    window.__luminTerminalSnapshots = window.__luminTerminalSnapshots || {};
    window.__luminTerminalSnapshots[sessionId] = () => getTerminalBufferSnapshotText(termRef.current || term);

    const fitTimer = setTimeout(() => {
      try { fitAddon.fit(); } catch (_) {}
    }, 100);

    // ── 自定义快捷键 ──────────────────────────────────────────────

    // 初始化快捷键缓存（移出按键热路径，仅在首次或变更时读取）
    if (shortcutsRef.current === null) {
      try {
        const saved = localStorage.getItem('appShortcuts');
        shortcutsRef.current = saved ? JSON.parse(saved) : { copy: 'Ctrl+C', paste: 'Ctrl+V', clear: 'Ctrl+L', newTab: 'Ctrl+T' };
      } catch (_) {
        shortcutsRef.current = { copy: 'Ctrl+C', paste: 'Ctrl+V', clear: 'Ctrl+L', newTab: 'Ctrl+T' };
      }
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // 1. 获取用户自定义的快捷键配置（从 ref 缓存读取，避免热路径访问 localStorage）
      const customShortcuts = shortcutsRef.current;

      // 2. 解析当前按下的组合键字符串（如 "Ctrl+C", "Ctrl+Shift+V"）
      const keys = [];
      if (getModKey(e))  keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey)   keys.push('Alt');

      let keyName = e.key;
      if (keyName === ' ')           keyName = 'Space';
      else if (keyName.length === 1) keyName = keyName.toUpperCase();
      keys.push(keyName);
      const pressedStr = keys.join('+');

      // ── 自定义复制键（默认 Ctrl+C）：智能处理 ────────
      if (pressedStr === customShortcuts.copy) {
        const selection = term.getSelection();
        if (selection) {
          e.preventDefault();
          navigator.clipboard.writeText(selection);
          term.clearSelection();
          return false; // 已复制，阻止 xterm 把按键发给服务器
        }
        // 【关键】如果没有选区，则直接放行 (return true)
        // 这样如果你用的是 Ctrl+C，它就能变成标准的终端中断符 (\x03) 发给服务器
        return true; 
      }

      // ── Ctrl+Shift+C：强制系统级复制，作为备用方案 ────────
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key === 'C') {
        e.preventDefault();
        const selection = term.getSelection();
        if (selection) navigator.clipboard.writeText(selection);
        return false;
      }

      // ── 自定义粘贴键 ───────────────────────────
      if (pressedStr === customShortcuts.paste) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text && wsRef.current?.readyState === WebSocket.OPEN) {
            pendingCmdRef.current += text.replace(/[\x00-\x1F\x7F]/g, '');
            wsRef.current.send(textEncoder.encode(text));
          }
        }).catch((err) => {
          console.error('Clipboard read failed:', err);
          termRef.current?.focus();
        });
        return false;
      }

      // ── 自定义清屏键 ───────────────────────────
      if (pressedStr === customShortcuts.clear) {
        e.preventDefault();
        term.clear();
        return false;
      }

      // 新建标签页的快捷键放行给外层 App 处理
      if (pressedStr === customShortcuts.newTab) {
        return true;
      }

      // ── 自定义控制信号（向服务器发送对应的控制字符） ────────────────
      const signalMap = {
        sigint: new Uint8Array([0x03]),     // Ctrl+C (ETX)
        eof: new Uint8Array([0x04]),        // Ctrl+D (EOT)
        suspend: new Uint8Array([0x1a]),    // Ctrl+Z (SUB)
        clearLine: new Uint8Array([0x15])   // Ctrl+U (NAK)
      };

      for (const [key, bytes] of Object.entries(signalMap)) {
        if (customShortcuts[key] && pressedStr === customShortcuts[key]) {
          e.preventDefault();
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(bytes);
          }
          return false;
        }
      }

      // ── 其他标准控制字符全部透传给服务器处理 ────────────────────────
      return true;
    });

    // ── WebSocket 连接 & Predictive Local Echo ─────────────────────
    let ws = null;
    let cancelled = false;
    const pendingEchoes = [];
    let predictiveDecoder = new TextDecoder();
    let predictiveTextCarry = '';

    // 并行获取端口与鉴权 token，后端要求连接时通过 ?token=xxx 携带，防止本机恶意进程注入命令
    Promise.all([AppGo.GetWsPort(), AppGo.GetWsToken()]).then(([port, token]) => {
      if (cancelled || !port || !termRef.current) return;
      const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${sessionId}${tokenQuery}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (!termRef.current) return;

        // 在原始数据上检测清屏序列（不依赖后续文本处理路径）
        const rawBytes = typeof ev.data === 'string' ? null : new Uint8Array(ev.data);
        if (timestampsEnabledRef.current) {
          if (typeof ev.data === 'string' && (ev.data.includes('\x1b[2J') || ev.data.includes('\x1b[3J'))) {
            handleClearScreen();
          } else if (rawBytes && rawBytes.includes(0x1b)) {
            for (let i = 0; i <= rawBytes.length - 4; i++) {
              if (rawBytes[i] === 0x1b && rawBytes[i+1] === 0x5b && (rawBytes[i+2] === 0x32 || rawBytes[i+2] === 0x33) && rawBytes[i+3] === 0x4a) {
                handleClearScreen();
                break;
              }
            }
          }
        }

        // 检测密码提示，标记下一行输入为密码（不记入命令历史）
        if (!awaitingPasswordRef.current) {
          const probeText = typeof ev.data === 'string' ? ev.data : textDecoder.decode(ev.data);
          // ponytail: 只在最后一行像密码/验证码提示时触发（关键词 + 行尾冒号），
          // 避免 "admin password: xxx" 之类信息性输出误判，导致下一条普通命令被跳过。
          // 行尾冒号是强约束，关键词可适度放宽：覆盖 OTP/MFA/Token 等验证码提示
          const lastLine = probeText.split(/\r?\n/).pop().trim();
          if (/(password|passwd|passphrase|密码|verification|otp|token|2fa|mfa|auth.*code)/i.test(lastLine) && /[:：]\s*$/.test(lastLine)) {
            awaitingPasswordRef.current = true;
          }
        }

        const shouldFilterIncomingText = (localEchoRef.current && pendingEchoes.length > 0) || predictiveTextCarry.length > 0

        if (!shouldFilterIncomingText) {
          predictiveDecoder = new TextDecoder()
          predictiveTextCarry = ''
          smartWrite(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
          return;
        }

        let text = typeof ev.data === 'string' ? ev.data : predictiveDecoder.decode(new Uint8Array(ev.data), { stream: true });
        if (predictiveTextCarry) {
          text = predictiveTextCarry + text;
          predictiveTextCarry = '';
        }

        const splitText = splitTrailingIncompleteEscapeSequence(text);
        predictiveTextCarry = splitText.carry;
        text = splitText.complete;
        if (!text) {
          return;
        }

        let i = 0;
        const parts = [];
        
        while (i < text.length) {
          // 1. 强大且健壮的 ANSI 转义序列跳过逻辑 (CSI、OSC 及其他单字符转义)
          if (text[i] === '\x1b') {
            let j = i + 1;
            if (j >= text.length) { parts.push(text[i]); i++; continue; }
            if (text[j] === '[') {
               // CSI 序列
               j++;
               while (j < text.length) {
                 const c = text.charCodeAt(j);
                 if (c >= 0x40 && c <= 0x7E) { j++; break; }
                 j++;
               }
            } else if (text[j] === ']') {
               // OSC 序列 (如 Window Title)
               j++;
               while (j < text.length) {
                 if (text[j] === '\x07') { j++; break; }
                 if (text[j] === '\x1b' && j + 1 < text.length && text[j+1] === '\\') { j += 2; break; }
                 j++;
               }
            } else {
               // 其他 ESC 序列（跳过后面一个字符）
               j++;
            }
            parts.push(text.substring(i, j));
            i = j;
            continue;
          }

          // 2. 匹配回显字符并丢弃
          if (pendingEchoes.length > 0) {
            const expected = pendingEchoes[0];
            if (text[i] === expected) {
              pendingEchoes.shift();
              i++;
              continue;
            }
            if (expected === '\x7F' && text[i] === '\b') {
              pendingEchoes.shift();
              i++;
              continue;
            }
            // 遇到非打印控制字符（如 \r, \n, \x07 等），直接放行打印，不破坏当前的预测队列
            const charCode = text.charCodeAt(i);
            if (charCode < 32 || charCode === 127) {
              parts.push(text[i]);
              i++;
              continue;
            }
          }
          
          // 真正的冲突（服务器发来了与预测不符的可打印字符），视为脱轨，清空队列并接受服务器输出
          pendingEchoes.length = 0;
          parts.push(text[i]);
          i++;
        }
        
        // 写回经过滤的文本
        const newText = parts.join('');
        smartWrite(newText);
      };

      ws.onerror = (e) => console.error('[Terminal] WebSocket error', e);
    });

    // ── 历史指令记录 + 输入直觉 + Local Echo ────────────────────────
    let localInputLength = 0; // 用于保护提示符，防止退格越界

    term.onData((data) => {
      if ((statusRef.current === 'closed' || statusRef.current === 'error') && (data.includes('\r') || data.includes('\n'))) {
        window.dispatchEvent(new CustomEvent('ssh-reconnect-trigger', { detail: sessionId }));
        return;
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(textEncoder.encode(data));
      }

      // ── 命令记录：回车时优先用逐字符累加的命令（用户真实输入），
      // 累加为空才 fallback 到 xterm buffer（方向键调历史 / Tab 补全 / 粘贴）。
      // ponytail: buffer 提取用 $/# 切提示符，交互脚本输出也含 $ 导致误抓整行，
      // 优先用 pendingCmdRef 可排除 y/1/3 等单字符脚本应答。
      if (data.includes('\r') || data.includes('\n')) {
        const nlIdx = data.search(/[\r\n]/);
        if (nlIdx > 0) {
          pendingCmdRef.current += data.slice(0, nlIdx).replace(/[\x00-\x1F\x7F]/g, '');
        }
        let cmd = pendingCmdRef.current.trim();
        if (!cmd) {
          const buf = term.buffer.active;
          const bufLine = buf.getLine(buf.baseY + buf.cursorY);
          if (bufLine) {
            const text = bufLine.translateToString(true);
            const idx = Math.max(text.lastIndexOf('#'), text.lastIndexOf('$'));
            cmd = idx >= 0 ? text.slice(idx + 1).trim() : text.trim();
            // ponytail: buffer 提取只作兜底，过滤安装向导这类交互提示，避免把问题文本当命令。
            if (/[^\x20-\x7E]/.test(cmd) || isInteractivePromptText(cmd)) cmd = '';
          }
        }
        if (!awaitingPasswordRef.current && cmd.length > 1 && !/^\d+$/.test(cmd)) {
          window.dispatchEvent(new CustomEvent('ssh-command-history', {
            detail: { sessionId: serverIdRef.current, command: cmd, time: new Date().toISOString(), source: 'input' }
          }));
        }
        awaitingPasswordRef.current = false;
        pendingCmdRef.current = '';
      } else if (data === '\x7F' || data === '\b') {
        pendingCmdRef.current = pendingCmdRef.current.slice(0, -1);
      } else if (!/[\x00-\x1F\x7F]/.test(data)) {
        pendingCmdRef.current += data;
      } else if (data === '\x03' || data === '\x04') {
        pendingCmdRef.current = '';
        awaitingPasswordRef.current = false; // Ctrl+C/D 取消当前输入，重置密码等待状态，避免下一条普通命令被误跳过
      }

      // Local Echo 逻辑 (恢复默认开启)
      if (localEchoRef.current) {
        // 如果输入中不包含控制字符（如方向键、Esc、退格等），则视作常规可见输入（支持多字符连击或粘贴）
        if (!/[\x00-\x1F\x7F]/.test(data)) {
          // 由于 JavaScript 中部分多字节字符的 length 表现，这里按照字符串常规长度累加是安全的。
          // 因为退格也是按字符来删的。
          localInputLength += data.length;
          for (let i = 0; i < data.length; i++) {
            pendingEchoes.push(data[i]);
          }
          term.write(data);
        } else if (data === '\x7F') { // Backspace
          // 仅当我们确信这是用户刚刚输入的字符时，才在本地执行退格预测。
          // 否则（localInputLength <= 0），将退格完全交还给服务器，保护提示符不被删除。
          if (localInputLength > 0) {
            localInputLength--;
            pendingEchoes.push(data);
            term.write('\b \b'); // 本地立即执行退格效果
          }
        } else if (data === '\r' || data === '\n' || data === '\r\n') {
          localInputLength = 0;
        } else {
          // 遇到方向键、Ctrl快捷键（如 Ctrl+C/D/Z）等控制符，
          // 立刻清零预测输入长度，安全退回到服务器渲染模式
          localInputLength = 0;
        }
      }

    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      AppGo.ResizeTerminal(sessionId, cols, rows);
      scheduleGutterSync();
    });

    return () => {
      cancelled = true;
      scrollDisposable.dispose();
      lineFeedDisposable.dispose();
      writeParsedDisposable.dispose();
      bufferChangeDisposable.dispose();
      resizeDisposable.dispose();
      if (gutterSyncRAFRef.current !== null) {
        cancelAnimationFrame(gutterSyncRAFRef.current);
        gutterSyncRAFRef.current = null;
      }
      clearTimeout(fitTimer);
      if (vpEl) vpEl.removeEventListener('scroll', onTermScroll);
      // 移除 wheel 监听器，避免内存泄漏
      containerRef.current?.removeEventListener('wheel', wheelHandler);
      if (ws) { try { ws.close(); } catch (_) {} }
      if (wsRef.current === ws) wsRef.current = null;
      tsClear(); // 清理时间戳
      if (window.__luminTerminalSnapshots?.[sessionId]) {
        delete window.__luminTerminalSnapshots[sessionId];
      }
      smartWriteRef.current = null;
      alternateBufferActiveRef.current = false;
      termRef.current     = null;
      fitAddonRef.current = null;
      try { term.dispose(); } catch (_) {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── 监听字体大小修改事件 ──────────────────────────────────────
  useEffect(() => {
    const handleFontSizeChange = (e) => {
      if (termRef.current) {
        termRef.current.options.fontSize = e.detail;
        if (fitAddonRef.current) {
          try { fitAddonRef.current.fit(); } catch (_) {}
        }
        scheduleGutterSync();
      }
    };
    window.addEventListener('terminal-font-size-changed', handleFontSizeChange);
    return () => window.removeEventListener('terminal-font-size-changed', handleFontSizeChange);
  }, []);

  // ── 状态变化提示 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!termRef.current) return;
    const sw = smartWriteRef.current;
    if (status === 'error') {
      sw ? sw('\r\n\x1b[31m✗ ' + t('连接失败') + '\x1b[0m\r\n') : termRef.current.write('\r\n\x1b[31m✗ ' + t('连接失败') + '\x1b[0m\r\n');
    } else if (status === 'closed') {
      sw ? sw('\r\n\x1b[33m⚠ ' + t('已断开') + '\x1b[0m\r\n') : termRef.current.write('\r\n\x1b[33m⚠ ' + t('已断开') + '\x1b[0m\r\n');
    }
  }, [status]);

  // ── 监听容器大小变化进行自适应 ───────────────────────────────────
  useEffect(() => {
    if (!isActive || !containerRef.current || !fitAddonRef.current || !termRef.current) return;

    let resizeTimer = null;
    const observer = new ResizeObserver((entries) => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!termRef.current || !fitAddonRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        try {
          fitAddonRef.current.fit();
          const { cols, rows } = termRef.current;
          AppGo.ResizeTerminal(sessionId, cols, rows);
        } catch (e) {
          console.error('[Terminal] Resize error:', e);
        }
      }, 50);
    });

    observer.observe(containerRef.current);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [isActive, sessionId]);

  // ── 终端切换回来时，重新 fit ────────────────────────────────────
  useEffect(() => {
    if (!isActive || !termRef.current || !fitAddonRef.current) return;
    const raf = requestAnimationFrame(() => {
      try {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          fitAddonRef.current.fit();
          const { cols, rows } = termRef.current;
          AppGo.ResizeTerminal(sessionId, cols, rows);
        }
      } catch (e) {
        console.error('[Terminal] activate fit error:', e);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive, sessionId]);

  // ── 背景管理与刷新 ─────────────────────────────────────────────────
  const [bgInfo, setBgInfo] = useState({
    image: localStorage.getItem('termBgImage') || '',
    opacity: parseFloat(localStorage.getItem('termBgOpacity') || '0.15')
  });

  useEffect(() => {
    const handleBgChange = () => {
      setBgInfo({
        image: localStorage.getItem('termBgImage') || '',
        opacity: parseFloat(localStorage.getItem('termBgOpacity') || '0.15')
      });
    };
    window.addEventListener('terminal-bg-changed', handleBgChange);
    return () => window.removeEventListener('terminal-bg-changed', handleBgChange);
  }, []);

  // 监听终端颜色主题切换，即时更新 xterm 主题
  // 同时监听 App 浅色/深色模式切换
  useEffect(() => {
    const handleThemeChange = () => {
      // setThemeToggle 触发重渲染，让 useMemo 重新计算 T（从 localStorage 读取最新主题）
      setThemeToggle(v => v + 1);
    };
    const handleModeChange = () => {
      // 同上，触发重渲染以更新 xterm 主题 + 容器颜色
      setThemeToggle(v => v + 1);
    };
    window.addEventListener('terminal-theme-changed', handleThemeChange);
    window.addEventListener('theme-mode-changed', handleModeChange);
    return () => {
      window.removeEventListener('terminal-theme-changed', handleThemeChange);
      window.removeEventListener('theme-mode-changed', handleModeChange);
    };
  }, []);

  // T 更新后同步 xterm 主题 + 容器 CSS 变量
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = T.xterm;
      // ponytail: 透明背景下自动对比度补偿以 #000 为背景计算，浅色主题反杀文字亮度，深色可正常增强
      termRef.current.options.minimumContrastRatio = getAppThemeMode() === 'light' ? 0 : 3;
    }
    // ponytail: container 颜色走 CSS 变量，JSX 中不再直接引用 T.container
    const el = wrapperRef.current;
    if (el) {
      const c = T.container;
      el.style.setProperty('--term-container-bg', c.containerBg);
      el.style.setProperty('--term-status-bg', c.statusBarBg);
      el.style.setProperty('--term-status-border', c.statusBarBorder);
      el.style.setProperty('--term-status-color', c.statusBarColor);
      el.style.setProperty('--term-server-color', c.serverNameColor);
      el.style.setProperty('--term-input-bar-bg', c.inputBarBg);
      el.style.setProperty('--term-input-bar-border', c.inputBarBorder);
      el.style.setProperty('--term-input-bg', c.inputBg);
      el.style.setProperty('--term-input-color', c.inputColor);
      el.style.setProperty('--term-btn-border', c.btnBorder);
      el.style.setProperty('--term-separator', c.separator);
      el.style.setProperty('--term-muted', c.mutedColor);
      el.style.setProperty('--term-context-bg', c.contextBg);
      el.style.setProperty('--term-context-border', c.contextBorder);
      el.style.setProperty('--term-context-shadow', c.contextShadow);
    }
  }, [T]);

  // 监听快捷键 / 本地回显 / 字体变更，同步更新 ref 缓存（保持设置即时生效）
  useEffect(() => {
    const handleShortcutsChange = (e) => {
      shortcutsRef.current = e.detail;
    };
    const handleLocalEchoChange = (e) => {
      localEchoRef.current = e.detail !== false;
    };
    const handleTimestampsChange = (e) => {
      timestampsEnabledRef.current = e.detail !== false;
      setTimestampsVisible(e.detail !== false);
      if (e.detail === false) {
        if (gutterRef.current) gutterRef.current.innerHTML = '';
      } else {
        scheduleGutterSync();
      }
    };
    const handleProgramFontSettingsChange = (e) => {
      const nextFontFamily = typeof e?.detail?.terminalFontFamily === 'string' && e.detail.terminalFontFamily.trim()
        ? e.detail.terminalFontFamily
        : getResolvedProgramFontPreferences().terminalFontFamily;
      if (termRef.current) {
        termRef.current.options.fontFamily = nextFontFamily;
        if (fitAddonRef.current) {
          try { fitAddonRef.current.fit(); } catch (_) {}
        }
        scheduleGutterSync();
      }
    };
    window.addEventListener('app-shortcuts-changed', handleShortcutsChange);
    window.addEventListener('terminal-local-echo-changed', handleLocalEchoChange);
    window.addEventListener('terminal-timestamps-changed', handleTimestampsChange);
    window.addEventListener('program-font-settings-changed', handleProgramFontSettingsChange);
    return () => {
      window.removeEventListener('app-shortcuts-changed', handleShortcutsChange);
      window.removeEventListener('terminal-local-echo-changed', handleLocalEchoChange);
      window.removeEventListener('terminal-timestamps-changed', handleTimestampsChange);
      window.removeEventListener('program-font-settings-changed', handleProgramFontSettingsChange);
    };
  }, []);

  const handleContextMenu = (e) => {
    e.preventDefault();
    const hasSelection = !!(termRef.current && termRef.current.getSelection());
    setContextHasSelection(hasSelection);
    setContextMenu(clampMenuPosition(e.clientX, e.clientY, 190, 140));
  };

  const closeContextMenu = () => {
    if (contextMenu) setContextMenu(null);
  };

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const handleMenuAction = (action) => {
    closeContextMenu();
    if (!termRef.current) return;
    switch (action) {
      case 'copy': {
        const selectedText = termRef.current.getSelection();
        if (selectedText) {
          navigator.clipboard.writeText(selectedText);
          termRef.current.clearSelection();
        }
        termRef.current.focus();
        break;
      }
      case 'paste':
        navigator.clipboard.readText().then(text => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            pendingCmdRef.current += text.replace(/[\x00-\x1F\x7F]/g, '');
            wsRef.current.send(textEncoder.encode(text));
          }
          termRef.current.focus();
        }).catch(err => {
          console.error('Failed to read clipboard:', err);
          termRef.current.focus();
        });
        break;
      case 'sendToAssistant': {
        const selectedText = termRef.current.getSelection();
        if (selectedText) {
          window.dispatchEvent(new CustomEvent('ai-terminal-send-to-assistant', {
            detail: {
              sessionId: serverIdRef.current,
              terminalId: sessionId,
              text: selectedText,
            },
          }));
          termRef.current.clearSelection();
        }
        termRef.current.focus();
        break;
      }
      case 'clear':
        termRef.current.clear();
        termRef.current.focus();
        break;
      case 'selectAll':
        termRef.current.selectAll();
        termRef.current.focus();
        break;
      default:
        termRef.current.focus();
        break;
    }
  };

  const isConnected  = status === 'connected';
  const isConnecting = status === 'connecting';
  const isError      = status === 'error';
  const isClosed     = status === 'closed';
  const statusColor  = isConnected ? 'var(--success)' : isConnecting ? 'var(--warning)' : isError ? 'var(--danger)' : 'var(--text-tertiary)';
  const cmdTrimmed   = cmdInput.trim();

  // 连接成功时触发一次性涟漪动画
  useEffect(() => {
    if (isConnected) {
      setJustConnected(true);
      const timer = setTimeout(() => setJustConnected(false), 1400);
      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  // ── 底部命令输入栏逻辑 ──────────────────────────────────────

  // 监听清除事件（CommandHistory 标签页清空时同步）
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.sessionId === serverId) setHistoryList([]);
    };
    window.addEventListener('ssh-history-cleared', handler);
    return () => window.removeEventListener('ssh-history-cleared', handler);
  }, [serverId]);

  const scrollOnNextUpdate = useRef(false);

  // 弹窗打开或切换模式时加载历史数据
  useEffect(() => {
    if (!showHistory) return;
    scrollOnNextUpdate.current = true;
    let cancelled = false;
    (async () => {
      try {
        const raw = historyMode === 'global'
          ? await AppGo.GetGlobalCommandHistory()
          : await AppGo.GetCommandHistory(historyServerId);
        if (cancelled) return;
        const entries = JSON.parse(raw);
        const arr = Array.isArray(entries) ? entries : [];
        setHistoryList(arr);
        // 数据为空则无需滚动，直接清空列表
        if (arr.length === 0) scrollOnNextUpdate.current = false;
      } catch {
        if (cancelled) return;
        setHistoryList([]);
        scrollOnNextUpdate.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [showHistory, historyMode]);

  // 数据渲染后滚到底部（仅首次打开时，删除条目不滚动）
  useEffect(() => {
    if (!showHistory || !scrollOnNextUpdate.current) return;
    // 数据还没加载完（空状态），等待下一次更新
    if (historyList.length === 0) return;
    const el = historyScrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    scrollOnNextUpdate.current = false;
  }, [historyList, showHistory]);

  const filteredHistory = useMemo(() => {
    if (!searchQuery) return historyList;
    const q = searchQuery.toLowerCase();
    return historyList.filter(item => item.command.toLowerCase().includes(q));
  }, [historyList, searchQuery]);

  // 反转后用于显示：最早的在上边，最新的在底部
  const displayHistory = useMemo(() => [...filteredHistory].reverse(), [filteredHistory]);

  const toggleHistory = () => {
    const willShow = !showHistory;
    if (willShow) {
      // 数据加载由 useEffect(showHistory) 负责
      const rect = historyBtnRef.current?.getBoundingClientRect();
      if (rect) {
        setHistoryPopupPos({
          left: Math.max(8, Math.min(rect.right - 480, window.innerWidth - 490)),
          bottom: window.innerHeight - rect.top + 4,
        });
      }
      if (showCommands) { setShowCommands(false); setCommandsPopupPos(null); }
    } else {
      setHistoryPopupPos(null);
    }
    setShowHistory(willShow);
  };

  const toggleCommands = () => {
    const willShow = !showCommands;
    if (willShow) {
      const rect = commandsBtnRef.current?.getBoundingClientRect();
      if (rect) {
        setCommandsPopupPos({
          left: Math.max(8, Math.min(rect.right - 680, window.innerWidth - 690)),
          bottom: window.innerHeight - rect.top + 4,
        });
      }
      if (showHistory) { setShowHistory(false); setHistoryPopupPos(null); }
      setShowCommands(true);
    } else {
      // 关闭面板时检查是否有未保存的修改
      if (quickCmdsRef.current?.isDirty?.()) {
        quickCmdsRef.current.showCloseConfirm();
        return; // 让 onClose 回调来关闭
      }
      setCommandsPopupPos(null);
      setShowCommands(false);
    }
  };

  const selectHistoryCmd = (cmd) => {
    setCmdInput(cmd);
    setShowHistory(false);
    setHistoryPopupPos(null);
    cmdInputRef.current?.focus();
  };

  const executeCommand = (directCmd) => {
    const cmd = directCmd || cmdInput;
    if (!isConnected) {
      if (isClosed || isError) {
        window.dispatchEvent(new CustomEvent('ssh-reconnect-trigger', { detail: sessionId }));
      }
      return;
    }
    const text = (cmd ?? '').trim();
    AppGo.WriteTerminal(sessionId, text + '\r').catch((err) => {
      console.error('WriteTerminal failed:', err);
    });
    termRef.current?.scrollToBottom();
    if (text && text.length > 1 && !/^\d+$/.test(text) && !isInteractivePromptText(text) && !awaitingPasswordRef.current) {
      window.dispatchEvent(new CustomEvent('ssh-command-history', {
        detail: { sessionId: serverId, command: text, time: new Date().toISOString(), source: 'input' }
      }));
    }
    awaitingPasswordRef.current = false;
    setCmdInput('');
    setShowHistory(false);
    setHistoryPopupPos(null);
  };

  const copyCommand = () => {
    if (!cmdTrimmed) return;
    navigator.clipboard.writeText(cmdInput).catch(() => {});
  };

  const deleteHistoryItem = (id) => {
    const next = historyListRef.current.filter(item => item.id !== id);
    setHistoryList(next);
    if (historyMode === 'global') {
      AppGo.SaveGlobalCommandHistory(JSON.stringify(next)).catch(() => {});
    } else {
      AppGo.SaveCommandHistory(historyServerId, JSON.stringify(next)).catch(() => {});
    }
  };

  const clearCommandAutocompleteDebounce = useCallback(() => {
    if (commandAutocompleteDebounceRef.current) {
      clearTimeout(commandAutocompleteDebounceRef.current);
      commandAutocompleteDebounceRef.current = null;
    }
  }, []);

  const clearCommandAutocompleteBlurTimer = useCallback(() => {
    if (commandAutocompleteBlurTimerRef.current) {
      clearTimeout(commandAutocompleteBlurTimerRef.current);
      commandAutocompleteBlurTimerRef.current = null;
    }
  }, []);

  const closeCommandAutocomplete = useCallback(() => {
    commandAutocompleteRequestRef.current += 1;
    commandAutocompleteKeyboardNavigationRef.current = false;
    clearCommandAutocompleteDebounce();
    clearCommandAutocompleteBlurTimer();
    setCommandAutocomplete(createCommandAutocompleteState());
  }, [clearCommandAutocompleteBlurTimer, clearCommandAutocompleteDebounce]);

  const ensureCommandAutocompleteData = useCallback(async () => {
    const cache = commandAutocompleteDataRef.current;
    const normalizedHistoryId = String(historyServerId || '').trim();

    if (cache.historyServerId !== normalizedHistoryId) {
      cache.historyServerId = normalizedHistoryId;
      cache.serverHistory = [];
      cache.serverLoaded = false;
    }

    if (!normalizedHistoryId) {
      cache.serverHistory = [];
      cache.serverLoaded = true;
    }

    const tasks = [];

    if (!cache.quickLoaded) {
      tasks.push(
        AppGo.GetQuickCommands()
          .then((raw) => {
            cache.quickCommands = normalizeQuickCommandItems(raw);
            cache.quickLoaded = true;
          })
          .catch(() => {
            cache.quickCommands = [];
            cache.quickLoaded = true;
          }),
      );
    }

    if (!cache.globalLoaded) {
      tasks.push(
        AppGo.GetGlobalCommandHistory()
          .then((raw) => {
            cache.globalHistory = normalizeHistoryCommands(raw);
            cache.globalLoaded = true;
          })
          .catch(() => {
            cache.globalHistory = [];
            cache.globalLoaded = true;
          }),
      );
    }

    if (normalizedHistoryId && !cache.serverLoaded) {
      tasks.push(
        AppGo.GetCommandHistory(normalizedHistoryId)
          .then((raw) => {
            cache.serverHistory = normalizeHistoryCommands(raw);
            cache.serverLoaded = true;
          })
          .catch(() => {
            cache.serverHistory = [];
            cache.serverLoaded = true;
          }),
      );
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    return cache;
  }, [historyServerId]);

  const loadCommandAutocompleteSuggestions = useCallback(async (nextValue) => {
    if (!commandAutocompleteFocusedRef.current || showHistory || showCommands) {
      closeCommandAutocomplete();
      return [];
    }

    const normalizedValue = String(nextValue || '');
    if (!normalizedValue.trim()) {
      closeCommandAutocomplete();
      return [];
    }

    const cursorPosition = cmdInputRef.current ? (cmdInputRef.current.selectionStart ?? normalizedValue.length) : normalizedValue.length
    const requestId = commandAutocompleteRequestRef.current + 1;
    commandAutocompleteRequestRef.current = requestId;

    const cache = await ensureCommandAutocompleteData();
    if (commandAutocompleteRequestRef.current !== requestId) {
      return [];
    }

    const staticItems = buildStaticAutocompleteItems(normalizedValue, cache, {
      cursorPosition,
      currentCwd: terminalCwd,
    })
    const shouldLoadPathItems = Boolean(buildPathAutocompleteContext(normalizedValue, terminalCwd, { cursorPosition }))

    if (!shouldLoadPathItems) {
      setCommandAutocomplete(createCommandAutocompleteState({
        open: staticItems.length > 0,
        items: staticItems,
        selectedIndex: staticItems.length > 0 ? 0 : -1,
      }));
      return staticItems;
    }

    setCommandAutocomplete(createCommandAutocompleteState({
      open: true,
      loading: true,
      items: staticItems,
      selectedIndex: staticItems.length > 0 ? 0 : -1,
    }));

    const pathItems = await loadPathAutocompleteItems({
      sessionId,
      inputValue: normalizedValue,
      currentCwd: terminalCwd,
      cursorPosition,
      listDir: (activeSessionId, remotePath) => AppGo.ListDir(activeSessionId, remotePath),
    })
    if (commandAutocompleteRequestRef.current !== requestId) {
      return [];
    }

    const resolvedItems = [...pathItems, ...staticItems].slice(0, 10)
    setCommandAutocomplete(createCommandAutocompleteState({
      open: resolvedItems.length > 0,
      items: resolvedItems,
      loading: false,
      selectedIndex: resolvedItems.length > 0 ? 0 : -1,
    }));
    return resolvedItems;
  }, [closeCommandAutocomplete, ensureCommandAutocompleteData, sessionId, showCommands, showHistory, terminalCwd]);

  const scheduleCommandAutocompleteSuggestions = useCallback((nextValue) => {
    clearCommandAutocompleteDebounce();
    commandAutocompleteDebounceRef.current = setTimeout(() => {
      void loadCommandAutocompleteSuggestions(nextValue);
    }, 140);
  }, [clearCommandAutocompleteDebounce, loadCommandAutocompleteSuggestions]);

  const applyCommandAutocompleteItem = useCallback((item) => {
    if (!item || !item.value) {
      return;
    }
    const nextValue = String(item.value);
    setCmdInput(nextValue);
    closeCommandAutocomplete();
    requestAnimationFrame(() => {
      if (!cmdInputRef.current) {
        return;
      }
      cmdInputRef.current.focus();
      cmdInputRef.current.setSelectionRange(nextValue.length, nextValue.length);
      commandAutocompleteFocusedRef.current = true;
      void loadCommandAutocompleteSuggestions(nextValue);
    });
  }, [closeCommandAutocomplete, loadCommandAutocompleteSuggestions]);

  useEffect(() => {
    let cancelled = false;
    setTerminalCwd('/');

    if (!sessionId) {
      return () => {
        cancelled = true;
      };
    }

    if (typeof AppGo.GetTerminalCwd === 'function') {
      AppGo.GetTerminalCwd(sessionId)
        .then((cwd) => {
          if (!cancelled) {
            setTerminalCwd(normalizeRemoteAbsolutePath(cwd) || '/');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTerminalCwd('/');
          }
        });
    }

    const off = EventsOn(`ssh-terminal-cwd-${sessionId}`, (cwd) => {
      if (cancelled) {
        return;
      }
      const normalizedCwd = normalizeRemoteAbsolutePath(cwd);
      if (normalizedCwd) {
        setTerminalCwd(normalizedCwd);
      }
    });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [sessionId]);

  useEffect(() => {
    const invalidate = () => {
      const cache = commandAutocompleteDataRef.current;
      cache.serverLoaded = false;
      cache.globalLoaded = false;
    };

    window.addEventListener('ssh-command-history', invalidate);
    window.addEventListener('ssh-history-cleared', invalidate);
    return () => {
      window.removeEventListener('ssh-command-history', invalidate);
      window.removeEventListener('ssh-history-cleared', invalidate);
    };
  }, []);

  useEffect(() => {
    if (!showCommands) {
      commandAutocompleteDataRef.current.quickLoaded = false;
    }
  }, [showCommands]);

  useEffect(() => {
    if (showHistory || showCommands) {
      closeCommandAutocomplete();
    }
  }, [closeCommandAutocomplete, showCommands, showHistory]);

  useEffect(() => {
    if (!cmdInput.trim()) {
      closeCommandAutocomplete();
    }
  }, [closeCommandAutocomplete, cmdInput]);

  useEffect(() => () => {
    clearCommandAutocompleteDebounce();
    clearCommandAutocompleteBlurTimer();
  }, [clearCommandAutocompleteBlurTimer, clearCommandAutocompleteDebounce]);

  useLayoutEffect(() => {
    if (!commandAutocompleteKeyboardNavigationRef.current) {
      return;
    }
    if (!commandAutocomplete.open || !commandAutocompleteListRef.current || commandAutocomplete.selectedIndex < 0) {
      commandAutocompleteKeyboardNavigationRef.current = false;
      return;
    }
    const selectedNode = commandAutocompleteListRef.current.querySelector('[data-command-autocomplete-selected="true"]');
    if (!selectedNode || typeof selectedNode.scrollIntoView !== 'function') {
      commandAutocompleteKeyboardNavigationRef.current = false;
      return;
    }
    selectedNode.scrollIntoView({
      block: 'center',
      inline: 'nearest',
    });
    commandAutocompleteKeyboardNavigationRef.current = false;
  }, [commandAutocomplete.open, commandAutocomplete.selectedIndex, commandAutocomplete.items.length]);

  return (
    <div
      ref={wrapperRef}
      onContextMenu={handleContextMenu}
      onClick={closeContextMenu}
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: bgInfo.image ? 'transparent' : 'var(--term-container-bg)',
        overflow: 'hidden',
      }}
    >
      {/* 底层壁纸 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${bgInfo.image || defaultTermBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: bgInfo.opacity,
        pointerEvents: 'none',
        zIndex: Z.BG
      }} />
      
      {/* 内容层（置于背景之上) */}
      <div style={{ position: 'relative', zIndex: Z.CONTENT, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Session 状态栏 ── */}
      <div className="term-status-bar">
        {/* 状态指示灯 - 使用全局 CSS 类，连接成功时触发涟漪动画 */}
        <div className={[
          'status-dot',
          isConnected  ? (justConnected ? 'just-connected' : 'online') : '',
          isConnecting ? 'connecting' : '',
          isError      ? 'offline' : '',
          !isConnected && !isConnecting && !isError ? 'offline' : '',
        ].filter(Boolean).join(' ')} style={{ flexShrink: 0 }} />
        <span style={{ color: 'var(--term-server-color)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
          {serverName || 'Terminal'}
        </span>
        
        {/* 右侧极简状态显示 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: statusColor, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {isConnected  ? t('已连接')
             : isConnecting ? t('连接中...')
             : isError      ? t('错误')
             : t('离线')}
          </span>
          {(isError || isClosed) && (
            <button
              className="term-reconnect-btn"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('ssh-reconnect-trigger', { detail: sessionId }));
              }}
            >
              {t('重新连接')}
            </button>
          )}
        </div>
      </div>

      {/* ── xterm 渲染层 + 时间轴 ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div ref={gutterRef} style={{
          display: timestampsVisible && !alternateBufferActive ? 'block' : 'none',
          width: 75,
          flexShrink: 0,
          paddingTop: 0,
          overflow: 'hidden',
          boxSizing: 'border-box',
        }} />
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 0,
            padding: '0',
            background: 'transparent',
          }}
        />
      </div>

      {/* ── 底部命令输入栏 ── */}
      <div className="term-input-bar">
        {/* 命令输入框 */}
        <input
          ref={cmdInputRef}
          className="input"
          value={cmdInput}
          autoComplete="off"
          onChange={e => {
            const nextValue = e.target.value;
            setCmdInput(nextValue);
            if (commandAutocompleteFocusedRef.current) {
              scheduleCommandAutocompleteSuggestions(nextValue);
            }
          }}
          onFocus={() => {
            commandAutocompleteFocusedRef.current = true;
            clearCommandAutocompleteBlurTimer();
            if (cmdInput.trim()) {
              scheduleCommandAutocompleteSuggestions(cmdInput);
            }
          }}
          onBlur={() => {
            commandAutocompleteFocusedRef.current = false;
            clearCommandAutocompleteBlurTimer();
            commandAutocompleteBlurTimerRef.current = setTimeout(() => {
              closeCommandAutocomplete();
            }, 120);
          }}
          onKeyDown={async (e) => {
            if (commandAutocomplete.open && e.key === 'ArrowDown') {
              e.preventDefault();
              if (commandAutocomplete.items.length === 0) {
                return;
              }
              commandAutocompleteKeyboardNavigationRef.current = true;
              setCommandAutocomplete((previous) => ({
                ...previous,
                selectedIndex: previous.selectedIndex < 0
                  ? 0
                  : (previous.selectedIndex + 1) % previous.items.length,
              }));
              return;
            }

            if (commandAutocomplete.open && e.key === 'ArrowUp') {
              e.preventDefault();
              if (commandAutocomplete.items.length === 0) {
                return;
              }
              commandAutocompleteKeyboardNavigationRef.current = true;
              setCommandAutocomplete((previous) => ({
                ...previous,
                selectedIndex: previous.selectedIndex < 0
                  ? previous.items.length - 1
                  : (previous.selectedIndex - 1 + previous.items.length) % previous.items.length,
              }));
              return;
            }

            if (e.key === 'Tab' && cmdInput.trim()) {
              e.preventDefault();
              let items = commandAutocomplete.items;
              if (items.length === 0) {
                items = await loadCommandAutocompleteSuggestions(cmdInput);
              }
              const selectedIndex = commandAutocomplete.selectedIndex >= 0 ? commandAutocomplete.selectedIndex : 0;
              const selectedItem = items[selectedIndex] || items[0];
              if (selectedItem) {
                applyCommandAutocompleteItem(selectedItem);
              }
              return;
            }

            if (e.key === 'Escape') {
              if (commandAutocomplete.open) {
                e.preventDefault();
                closeCommandAutocomplete();
                return;
              }
              setShowHistory(false);
            }

            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              closeCommandAutocomplete();
              executeCommand();
            }
          }}
          placeholder={`${t('输入命令')}(/ ${t('快捷命令')})`}
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: 'var(--font-terminal)',
            padding: '7px 10px',
            minHeight: 32,
            background: 'var(--term-input-bg)',
            borderColor: cmdInput ? 'var(--border-focus)' : 'var(--term-btn-border)',
          }}
        />

        {/* 历史按钮 */}
        <Tiptop text={t('历史指令')}>
          <button
            ref={historyBtnRef}
            onClick={toggleHistory}
            aria-label={t('历史指令')}
            className={`term-btn${showHistory ? ' active' : ''}`}
          >
            <Clock size={13} />
            <span>{t('历史')}</span>
          </button>
        </Tiptop>

        {/* 快捷命令按钮 */}
        <Tiptop text={t('快捷命令')}>
          <button
            ref={commandsBtnRef}
            onClick={toggleCommands}
            aria-label={t('快捷命令')}
            className={`term-btn${showCommands ? ' active' : ''}`}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><Zap size={13} /></span>
            <span>{t('命令')}</span>
          </button>
        </Tiptop>

        {/* 执行按钮（绿色） */}
        <Tiptop text={t('执行')}>
          <button
            onClick={() => executeCommand()}
            disabled={!cmdTrimmed || !isConnected}
            aria-label={t('执行')}
            className={`term-btn-icon success${(cmdTrimmed && isConnected) ? ' enabled' : ''}`}
          >
            <Play size={13} />
          </button>
        </Tiptop>

        {/* 复制按钮（蓝色） */}
        <Tiptop text={t('复制')}>
          <button
            onClick={copyCommand}
            disabled={!cmdTrimmed}
            aria-label={t('复制')}
            className={`term-btn-icon accent${cmdTrimmed ? ' enabled' : ''}`}
          >
            <Clipboard size={13} />
          </button>
        </Tiptop>
      </div>
      </div>

      {(commandAutocomplete.open || commandAutocomplete.loading) && !showHistory && !showCommands && (
        <div
          className="term-popup"
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            left: 8,
            bottom: 42,
            width: 'min(760px, calc(100% - 16px))',
            maxHeight: 260,
            display: 'flex',
            flexDirection: 'column',
            zIndex: Z.POPUP,
            overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '7px 10px',
            borderBottom: '1px solid var(--term-separator)',
            fontSize: 11,
            color: 'var(--term-status-color)',
          }}>
            <span>{t('命令')}</span>
            <span style={{ color: 'var(--term-muted)', fontFamily: 'var(--font-mono)' }}>Tab</span>
          </div>
          <div ref={commandAutocompleteListRef} style={{ maxHeight: 220, overflowY: 'auto' }}>
            {commandAutocomplete.loading && commandAutocomplete.items.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--term-muted)' }}>
                {t('正在搜索...')}
              </div>
            ) : commandAutocomplete.items.map((item, index) => {
              const isSelected = index === commandAutocomplete.selectedIndex;
              return (
                <button
                  key={`${item.source}-${item.value}-${index}`}
                  data-command-autocomplete-selected={isSelected ? 'true' : 'false'}
                  type="button"
                  onMouseEnter={() => {
                    setCommandAutocomplete((previous) => ({
                      ...previous,
                      selectedIndex: index,
                    }));
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyCommandAutocompleteItem(item);
                  }}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gap: 4,
                    padding: '9px 12px',
                    textAlign: 'left',
                    border: 'none',
                    borderBottom: index === commandAutocomplete.items.length - 1 && !commandAutocomplete.loading ? 'none' : '1px solid var(--term-separator)',
                    background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                    color: 'var(--term-input-color)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontFamily: 'var(--font-terminal)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.label}
                    </span>
                    <span style={{
                      flexShrink: 0,
                      padding: '2px 6px',
                      borderRadius: 999,
                      border: '1px solid var(--term-btn-border)',
                      color: 'var(--term-status-color)',
                      fontSize: 10,
                      lineHeight: 1.2,
                    }}>
                      {item.badge}
                    </span>
                  </div>
                  {item.description ? (
                    <span style={{
                      fontSize: 11,
                      color: 'var(--term-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.description}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {commandAutocomplete.loading && commandAutocomplete.items.length > 0 ? (
              <div style={{
                padding: '8px 12px',
                fontSize: 11,
                color: 'var(--term-muted)',
                borderTop: '1px solid var(--term-separator)',
              }}>
                {t('正在刷新结果...')}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── 历史指令弹窗（fixed 定位，不受 overflow:hidden 裁剪） ── */}
      {showHistory && historyPopupPos && (
        <div ref={historyPopupRef} className="term-popup" style={{
            left: historyPopupPos.left,
            bottom: historyPopupPos.bottom,
            width: 480,
            maxHeight: 280,
            display: 'flex', flexDirection: 'column',
            zIndex: Z.POPUP,
            fontFamily: 'var(--font-terminal)',
            fontSize: 12,
          }}>
            {/* 弹窗头部（标题 + 操作按钮） */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 10px',
              borderBottom: '1px solid var(--term-separator)',
              flexShrink: 0,
            }}>
              <span style={{ color: 'var(--term-status-color)', fontSize: 11 }}>{t('历史命令')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => {
                    setHistoryList([]);
                    if (historyMode === 'global') {
                      AppGo.SaveGlobalCommandHistory('[]').catch(() => {});
                    } else {
                      AppGo.SaveCommandHistory(historyServerId, '[]').catch(() => {});
                    }
                  }}
                  style={{ ...btnStyle('red'), fontSize: 11, padding: '2px 8px' }}
                >
                  {t('清空列表')}
                </button>
                <button
                  onClick={() => { setShowHistory(false); setHistoryPopupPos(null); }}
                  aria-label={t('关闭')}
                  style={btnStyle('red')}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* 历史列表（可滚动） */}
            <div ref={historyScrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {filteredHistory.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--term-muted)', fontSize: 12 }}>
                {searchQuery ? t('无匹配结果') : t('暂无历史记录')}
              </div>
            ) : displayHistory.map(item => (
              <div
                key={item.id}
                className="history-item"
                onClick={() => selectHistoryCmd(item.command)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--term-separator)',
                  transition: 'background 0.1s',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    color: 'var(--term-input-color)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    paddingRight: 8,
                  }}
                  title={item.command}
                >
                  {item.command}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                  {/* 执行（绿色） */}
                  <Tiptop text={t('执行')}>
                    <button
                      onClick={(e) => { e.stopPropagation(); executeCommand(item.command); }}
                      aria-label={t('执行')}
                      style={{ ...iconBtnStyle('var(--text-secondary)') }}
                    >
                      <Play size={12} />
                    </button>
                  </Tiptop>
                  {/* 复制（蓝色） */}
                  <Tiptop text={t('复制')}>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(item.command).catch(() => {}); }}
                      aria-label={t('复制')}
                      style={{ ...iconBtnStyle('var(--text-secondary)') }}>
                      <Clipboard size={12} />
                    </button>
                  </Tiptop>
                  {/* 删除（红色） */}
                  <Tiptop text={t('删除')}>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                      aria-label={t('删除')}
                      style={{ ...iconBtnStyle('var(--danger)', 'rgba(255,123,114,0.15)') }}
                    >
                      <X size={12} />
                    </button>
                  </Tiptop>
                </div>
              </div>
            ))}
            </div>

            {/* 搜索 + 模式切换 */}
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center',
              padding: '6px 10px',
              borderTop: '1px solid var(--term-separator)',
              flexShrink: 0,
            }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('搜索命令...')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: 'var(--term-input-bg)',
                  border: '1px solid var(--term-btn-border)',
                  borderRadius: 4,
                  color: 'var(--term-input-color)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <div className="segment-control">
                <button className={historyMode === 'server' ? 'active' : ''} onClick={() => setHistoryMode('server')}>
                  {t('当前服务器')}
                </button>
                <button className={historyMode === 'global' ? 'active' : ''} onClick={() => setHistoryMode('global')}>
                  {t('全部服务器')}
                </button>
              </div>
            </div>
          </div>
      )}

      {/* ── 快捷命令弹窗（fixed 定位，不受 overflow:hidden 裁剪） ── */}
      {showCommands && commandsPopupPos && (
        <div ref={quickCmdsPopupRef} className="term-popup" style={{
            left: commandsPopupPos.left,
            bottom: commandsPopupPos.bottom,
            width: 680,
            height: 420,
            zIndex: Z.POPUP,
            overflow: 'hidden',
          }}>
            <QuickCommands ref={quickCmdsRef} sessionId={sessionId} addToast={() => {}} connectedSessions={connectedSessions} onClose={() => { setShowCommands(false); setCommandsPopupPos(null); }} />
          </div>
      )}

      {/* ── 右键上下文菜单（增强版：图标 + 边界检测 + disabled 状态） ── */}
      {contextMenu && (
        <div
          className="context-menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: 'var(--term-context-bg)',
            border: 'var(--term-context-border)',
            borderRadius: '8px',
            boxShadow: 'var(--term-context-shadow)',
            zIndex: Z.MODAL,
            padding: '4px 0',
            minWidth: '190px',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {[
            { icon: <Copy size={13} />, label: t('复制'), action: 'copy', shortcut: formatShortcut('Ctrl+C'), disabled: !contextHasSelection },
            { icon: <Clipboard size={13} />, label: t('粘贴'), action: 'paste', shortcut: formatShortcut('Ctrl+V') },
            { type: 'separator' },
            { icon: <CheckSquare size={13} />, label: t('全选'), action: 'selectAll' },
            { icon: <MessageSquarePlus size={13} />, label: t('添加到 AI助手'), action: 'sendToAssistant', disabled: !contextHasSelection },
            { icon: <Trash2 size={13} />, label: t('清空屏幕'), action: 'clear', shortcut: formatShortcut('Ctrl+L') },
          ].map((item, idx) =>
            item.type === 'separator' ? (
              <div key={idx} className="context-menu-separator" />
            ) : (
              <div
                key={idx}
                className={`context-menu-item${item.disabled ? ' disabled' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!item.disabled) handleMenuAction(item.action);
                }}
              >
                <span className="item-icon">{item.icon}</span>
                <span className="item-label">{item.label}</span>
                {item.shortcut && <span className="item-shortcut">{item.shortcut}</span>}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
