import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Copy, Clipboard, Trash2, CheckSquare, Play, Clock, X, Zap, MessageSquarePlus, ExternalLink, Search, ChevronUp, ChevronDown, CaseSensitive } from 'lucide-react';
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
import Tiptop from './Tiptop.jsx';
import '@xterm/xterm/css/xterm.css';
import { useTranslation } from '../i18n.js';
import defaultTermBg from '../assets/term_bg.png';
import { Z } from '../constants/zIndex';
import { getTerminalTheme, getAppThemeMode, isDarkTerminalSurface } from '../utils/theme.js';
import { getResolvedProgramFontPreferences } from '../utils/programFonts.js';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// SearchAddon 只上背景、不改字色。按终端底色选高亮，不按界面 mode。
// 深色终端必须用「够深」的底：偏亮的半透明底会触发 minimumContrastRatio 把白字压成黑字。
function getTermSearchDecorations(terminalTheme) {
  if (!isDarkTerminalSurface(terminalTheme)) {
    return {
      matchBackground: '#fbbf24',
      matchOverviewRuler: '#fbbf24',
      activeMatchBackground: '#ea580c',
      activeMatchColorOverviewRuler: '#ea580c',
    };
  }
  return {
    matchBackground: '#1d4ed8',
    matchOverviewRuler: '#3b82f6',
    activeMatchBackground: '#be123c',
    activeMatchColorOverviewRuler: '#fb7185',
  };
}

function formatTerminalTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  // 固定 [HH:MM:SS]，括号内不加空格，避免 gutter 对齐时看起来「多一格」
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

// 手写 URL 规则（不依赖 addon-web-links）；provider 负责点击，覆盖层负责常驻下划线
// 排除 ; | 等 shell 分隔符，避免 curl ...sh;else 把后续命令粘进链接
const TERMINAL_URL_REGEX = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`;]*[^\s"':,.!?{}|\\^~\[\]`()<>;]/;

function isTerminalHttpUrl(urlString) {
  try {
    const url = new URL(urlString);
    const base = url.password && url.username
      ? `${url.protocol}//${url.username}:${url.password}@${url.host}`
      : url.username
        ? `${url.protocol}//${url.username}@${url.host}`
        : `${url.protocol}//${url.host}`;
    return urlString.toLocaleLowerCase().startsWith(base.toLocaleLowerCase());
  } catch {
    return false;
  }
}

/**
 * 当前正在输入的逻辑行起始（0-based，含上键历史回显 / 多行 wrap）。
 * 该行及之后不识别链接：只有「已经执行过」滚到输出区的内容才可点/高亮。
 */
function getTerminalInputStartLine(term) {
  const buf = term?.buffer?.active;
  if (!buf) return Number.POSITIVE_INFINITY;
  let line = (buf.baseY || 0) + (buf.cursorY || 0);
  while (line > 0) {
    const row = buf.getLine(line);
    if (row?.isWrapped) line -= 1;
    else break;
  }
  return line;
}

/**
 * 一行 buffer → 文本 + 每个字符对应的 0-based 列。
 * 宽字符（CJK/emoji 等）占 2 列，不能用字符串下标当列号，否则高亮会整体偏左。
 * 行为对齐 translateToString(true)：跳过 width=0 的占位格，并去掉行尾空白。
 */
function lineToTextAndCols(line) {
  if (!line) return { text: '', colAt: [], widthAt: [] };
  let text = '';
  const colAt = [];
  const widthAt = [];
  const len = line.length;
  let col = 0;
  while (col < len) {
    const cell = line.getCell(col);
    if (!cell) break;
    const w = cell.getWidth();
    if (w === 0) {
      col += 1;
      continue;
    }
    const chars = cell.getChars() || ' ';
    const advance = w > 0 ? w : 1;
    for (let i = 0; i < chars.length; i += 1) {
      text += chars[i];
      colAt.push(col);
      widthAt.push(advance);
    }
    col += advance;
  }
  let end = text.length;
  while (end > 0 && text[end - 1] === ' ') end -= 1;
  return {
    text: text.slice(0, end),
    colAt: colAt.slice(0, end),
    widthAt: widthAt.slice(0, end),
  };
}

/**
 * 取含 bufferLine0 的逻辑行各段（处理 isWrapped 换行 URL）。
 * isWrapped=true 表示本行是上一行的续行。
 */
function getLogicalLineSegments(term, bufferLine0) {
  const buf = term.buffer.active;
  let start = bufferLine0;
  while (start > 0) {
    const line = buf.getLine(start);
    if (!line?.isWrapped) break;
    start -= 1;
  }
  const segs = [];
  let y = start;
  for (;;) {
    const line = buf.getLine(y);
    if (!line) break;
    const mapped = lineToTextAndCols(line);
    segs.push({ y0: y, text: mapped.text, colAt: mapped.colAt, widthAt: mapped.widthAt });
    const next = buf.getLine(y + 1);
    if (!next?.isWrapped) break;
    y += 1;
  }
  return segs;
}

/**
 * joined 串 0-based 下标 → buffer 1-based 列/行。
 * edge='start'：该字符起始列（1-based）；edge='end'：该字符占用的末列（1-based 含），
 * 供下划线绘制 endCol = end.x 使用（与单宽时「末字符 1-based 列」一致，宽字符覆盖两列）。
 */
function joinedIndexToPos(segs, index, edge = 'start') {
  if (!segs.length) return { x: 1, y: 1 };
  let rem = index;
  for (const seg of segs) {
    if (rem < seg.text.length) {
      const col0 = seg.colAt[rem] ?? rem;
      const w = seg.widthAt[rem] ?? 1;
      const x = edge === 'end' ? col0 + w : col0 + 1;
      return { x: Math.max(1, x), y: seg.y0 + 1 };
    }
    rem -= seg.text.length;
  }
  const last = segs[segs.length - 1];
  if (!last.text.length) return { x: 1, y: last.y0 + 1 };
  const lastIdx = last.text.length - 1;
  const col0 = last.colAt[lastIdx] ?? lastIdx;
  const w = last.widthAt[lastIdx] ?? 1;
  return { x: Math.max(1, col0 + w), y: last.y0 + 1 };
}

/**
 * 扫描逻辑行（含 wrap）上的 http(s) 链接。
 * 换行 URL 会拼完整再匹配，range 可跨多行。输入逻辑行返回空。
 */
function findTerminalHttpLinksOnLine(term, bufferLineNumber) {
  const line0 = bufferLineNumber - 1;
  if (line0 >= getTerminalInputStartLine(term)) return [];
  const segs = getLogicalLineSegments(term, line0);
  if (!segs.length) return [];
  const joined = segs.map((s) => s.text).join('');
  if (!joined) return [];
  const rex = new RegExp(TERMINAL_URL_REGEX.source, (TERMINAL_URL_REGEX.flags || '') + 'g');
  const links = [];
  let match;
  while ((match = rex.exec(joined))) {
    const value = match[0];
    if (!isTerminalHttpUrl(value)) continue;
    const start = joinedIndexToPos(segs, match.index, 'start');
    const end = joinedIndexToPos(segs, match.index + value.length - 1, 'end');
    links.push({ text: value, range: { start, end } });
  }
  return links;
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

function getTextareaAutocompletePopupPosition(textarea, popupWidth = 760, popupHeight = 260) {
  if (!textarea || typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  const style = window.getComputedStyle(textarea)
  const textareaRect = textarea.getBoundingClientRect()
  const selectionStart = textarea.selectionStart ?? textarea.value.length

  const mirror = document.createElement('div')
  const marker = document.createElement('span')
  const mirroredText = textarea.value.slice(0, selectionStart)

  const mirroredProperties = [
    'boxSizing',
    'width',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'textTransform',
    'textIndent',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'whiteSpace',
    'wordBreak',
    'overflowWrap',
    'tabSize',
  ]

  mirror.style.position = 'fixed'
  mirror.style.left = '0'
  mirror.style.top = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'break-word'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.overflow = 'hidden'

  mirroredProperties.forEach((property) => {
    mirror.style[property] = style[property]
  })

  mirror.textContent = mirroredText
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const mirrorRect = mirror.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const width = Math.min(Math.max(textareaRect.width, 420), window.innerWidth - 16)

  let left = textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft
  const top = textareaRect.bottom + 8
  const maxHeight = Math.max(120, window.innerHeight - top - 8)

  if (left + width > window.innerWidth - 8) {
    left = window.innerWidth - width - 8
  }
  if (left < 8) {
    left = 8
  }

  document.body.removeChild(mirror)

  return {
    left,
    top,
    width,
    maxHeight,
  }
}

function buildWrappedMultiLineCommand(command) {
  const source = String(command ?? '').replace(/\r\n?/g, '\n')
  let marker = '__LUMIN_WRAP_EOF__'
  while (source.includes(marker)) {
    marker += '_X'
  }
  return `bash <<'${marker}'\n${source}\n${marker}\n`
}

/** 粘贴到终端：统一成单个 \\r 换行，避免 Windows \\r\\n 把 \\ 续行拆成空行/多条命令 */
function normalizeTerminalPasteText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\r')
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

export default function Terminal({
  sessionId,
  serverId,
  historyServerId,
  status,
  isActive,
  serverName,
  connectedSessions = [],
  showCommands = false,
  onQuickCommandsOpenChange,
  quickCmdsRef,
}) {
  const { t } = useTranslation();
  const containerRef   = useRef(null);
  const wrapperRef     = useRef(null);
  const termRef        = useRef(null);
  const fitAddonRef    = useRef(null);
  const searchAddonRef = useRef(null);
  const termSearchInputRef = useRef(null);
  const wsRef          = useRef(null);
  const statusRef      = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const serverIdRef    = useRef(serverId);
  serverIdRef.current  = serverId;
  const [themeToggle, setThemeToggle]     = useState(0); // 用于强制重渲染（浅色/深色模式切换）
  const [contextMenu, setContextMenu]         = useState(null);
  const [linkMenu, setLinkMenu]               = useState(null); // { x, y, url }
  const [linkToast, setLinkToast]             = useState('');
  const [contextHasSelection, setContextHasSelection] = useState(false);
  const [justConnected, setJustConnected]     = useState(false);
  const [cmdInput, setCmdInput]               = useState('');
  const [showHistory, setShowHistory]         = useState(false);
  const [historyList, setHistoryList]         = useState([]);
  const historyListRef                        = useRef([]);
  useEffect(() => { historyListRef.current = historyList; }, [historyList]);
  const [historyMode, setHistoryMode]         = useState('server'); // 'server' | 'global'
  const [searchQuery, setSearchQuery]         = useState('');
  const [showTermSearch, setShowTermSearch]   = useState(false);
  const [termSearchQuery, setTermSearchQuery] = useState('');
  const [termSearchCaseSensitive, setTermSearchCaseSensitive] = useState(false);
  const [termSearchResult, setTermSearchResult] = useState({ resultIndex: -1, resultCount: 0 });
  const cmdInputRef                           = useRef(null);
  const historyBtnRef                         = useRef(null);
  const historyScrollRef                      = useRef(null);
  const [historyPopupPos, setHistoryPopupPos] = useState(null);
  const commandsBtnRef                        = useRef(null);
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
  const [commandAutocompletePopupPos, setCommandAutocompletePopupPos] = useState(null);

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
  // 命令块：左侧折叠钮 + 树线，可收起输出
  const commandBlocksEnabledRef = useRef(localStorage.getItem('terminalCommandBlocks') === 'true');
  const [commandBlocksVisible, setCommandBlocksVisible] = useState(localStorage.getItem('terminalCommandBlocks') === 'true');
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
    // 同 line 只保留最新戳（执行命令时要盖掉空提示符上的旧时间）
    const line = marker.line;
    if (typeof line === 'number' && line >= 0) {
      for (let j = 0; j < r.entries.length; j += 1) {
        if (r.entries[j]?.marker?.line === line) {
          r.entries[j].marker.dispose?.();
          r.entries[j] = null;
        }
      }
    }
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
  // 按 buffer 行号快照时间戳（收起/展开改写 buffer 后要还原，不能重新 now()）
  // 与 syncGutter 一致：ring 从旧到新扫，后写覆盖，保留「执行时刻」而非提示符出现时刻
  const tsSnapshotByLine = (term, lineCount) => {
    const total = typeof lineCount === 'number' ? lineCount : (term?.buffer?.active?.length || 0);
    const byLine = new Array(Math.max(0, total)).fill('');
    const ring = tsRingRef.current;
    for (let offset = 0; offset < ring.entries.length; offset += 1) {
      const index = (ring.next + offset) % ring.entries.length;
      const entry = ring.entries[index];
      const line = entry?.marker?.line;
      if (!entry || entry.marker?.isDisposed || typeof line !== 'number' || line < 0 || line >= byLine.length) continue;
      byLine[line] = entry.val;
    }
    return byLine;
  };
  const tsRemountFromList = (term, tsList) => {
    tsClear();
    if (!term?.buffer?.active || !Array.isArray(tsList) || !timestampsEnabledRef.current) return;
    const bufLen = term.buffer.active.length;
    const cursorLine = term.buffer.active.baseY + term.buffer.active.cursorY;
    const limit = Math.min(tsList.length, bufLen);
    for (let line = 0; line < limit; line += 1) {
      const val = tsList[line];
      if (!val) continue;
      try {
        const marker = term.registerMarker(line - cursorLine);
        if (marker) tsSet(marker, val);
      } catch (_) {}
    }
  };
  // 命令块：扫描 buffer 里「提示符行 → 下一提示符行」；收起时改写 buffer 只留一行摘要
  // 同名命令用「第几次出现」区分，避免收起第二个把第一个状态冲掉
  const CB_POOL = 400;
  const cbBlocksRef = useRef(null);
  if (!cbBlocksRef.current) {
    // key = `${commandLineText}#${occurrence}`；value = { id, commandLineText, occurrence, collapsed, savedOutput, savedOutputTs }
    cbBlocksRef.current = new Map();
  }
  const cbIdSeqRef = useRef(1);
  const cbRewriteLockRef = useRef(false);
  const isCollapseSummaryLine = (text) => /^⋯\s+\d+\s+lines\s*$/.test(String(text || '').trim());
  // 行首是 shell 提示符（后面可跟命令）。不能要求「整行以 # 结尾」，否则 `root@host:~# ping` 识别不到
  const isShellPromptLine = (text) => {
    const t = String(text || '').replace(/\s+$/g, '');
    if (!t || t.length < 2 || isCollapseSummaryLine(t)) return false;
    // user@host:path# cmd  /  user@host:path$ cmd
    if (/^[\w.-]+@[\w.-]+:[^\n]*?[#\$](?:\s+|$)/.test(t)) return true;
    // [user@host dir]$ cmd
    if (/^\[[^\]]+\][#\$%](?:\s+|$)/.test(t)) return true;
    // root@host ~]# cmd  一类
    if (/^[\w.-]+@[\w.-]+\s+[^\n]*[#\$%](?:\s+|$)/.test(t)) return true;
    // 极简：以 #/$ 单独起命令（少见）
    if (/^[#\$]\s+\S/.test(t)) return true;
    return false;
  };
  // 空提示符可以显示时间；真正执行（回车）时再更新该行时间戳
  const normalizeCmdLineKey = (text) => String(text || '').replace(/\s+$/g, '');
  const blockStateKey = (commandLineText, occurrence) => `${normalizeCmdLineKey(commandLineText)}#${occurrence}`;
  const readTerminalBufferLines = (term) => {
    const buf = term?.buffer?.active;
    if (!buf) return [];
    const lines = [];
    const total = buf.length;
    for (let i = 0; i < total; i += 1) {
      const bl = buf.getLine(i);
      lines.push(bl ? bl.translateToString(true) : '');
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  };
  // 扫描所有提示符行下标：块 i = prompt[i] .. prompt[i+1]-1
  const scanPromptIndexes = (lines) => {
    const idxs = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (isShellPromptLine(lines[i])) idxs.push(i);
    }
    return idxs;
  };
  // 在 buffer 里找「第 occurrence 次」出现的命令行（0-based）
  const findCommandLineOccurrence = (lines, commandLineText, occurrence) => {
    const key = normalizeCmdLineKey(commandLineText);
    let seen = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (normalizeCmdLineKey(lines[i]) !== key) continue;
      if (seen === occurrence) return i;
      seen += 1;
    }
    return -1;
  };
  const getOrCreateBlockState = (commandLineText, occurrence) => {
    const textKey = normalizeCmdLineKey(commandLineText);
    if (!textKey) return null;
    const occ = Math.max(0, Number(occurrence) || 0);
    const key = blockStateKey(textKey, occ);
    const map = cbBlocksRef.current;
    let block = map.get(key);
    if (!block) {
      if (map.size >= CB_POOL) {
        const firstKey = map.keys().next().value;
        if (firstKey != null) map.delete(firstKey);
      }
      block = {
        id: cbIdSeqRef.current++,
        commandLineText: textKey,
        occurrence: occ,
        collapsed: false,
        savedOutput: null,
        savedOutputTs: null,
      };
      map.set(key, block);
    }
    return block;
  };
  const rewriteTerminalBufferLines = (term, lines, nextTimestamps = null, options = {}) => {
    if (!term) return;
    const anchorLine = typeof options.anchorLine === 'number' ? options.anchorLine : -1;
    const bufBefore = term.buffer?.active;
    const viewportBefore = bufBefore ? bufBefore.viewportY : 0;
    const baseBefore = bufBefore ? bufBefore.baseY : 0;
    // 尽量保持视口相对锚点行的偏移，减少重写后整屏「跳一下」
    const anchorOffset = anchorLine >= 0 ? (anchorLine - viewportBefore) : 0;

    cbRewriteLockRef.current = true;
    // 一次 write 完成：清 scrollback + 清屏 + 回顶 + 写回。
    // 比 term.reset() 轻（不重置模式/字符集），并用 write 回调在同一渲染路径里恢复滚动与 gutter。
    const normalized = (Array.isArray(lines) ? lines : []).map((line) => String(line ?? ''));
    const body = normalized.length === 0
      ? ''
      : normalized.length === 1
        ? normalized[0]
        : `${normalized.slice(0, -1).join('\r\n')}\r\n${normalized[normalized.length - 1]}`;
    // \x1b[3J 清 scrollback，\x1b[2J 清屏，\x1b[H 光标回原点
    const payload = `\x1b[3J\x1b[2J\x1b[H${body}`;

    const finish = () => {
      try {
        if (Array.isArray(nextTimestamps)) {
          tsRemountFromList(term, nextTimestamps);
        }
        const buf = term.buffer.active;
        const maxVp = Math.max(0, buf.baseY);
        if (anchorLine >= 0) {
          const nextVp = Math.max(0, Math.min(maxVp, anchorLine - anchorOffset));
          term.scrollToLine(nextVp);
        } else if (baseBefore > 0) {
          const ratio = Math.min(1, viewportBefore / baseBefore);
          term.scrollToLine(Math.floor(maxVp * ratio));
        } else {
          term.scrollToBottom();
        }
      } catch (_) {}
      cbRewriteLockRef.current = false;
      // 直接 sync，少一帧 rAF 延迟，减轻「收起后 gutter 晚半拍」
      try { syncGutter(); } catch (_) { scheduleGutterSync(); }
    };

    try {
      // 只影响本地 xterm，不发给 SSH
      term.write(payload, finish);
    } catch (_) {
      finish();
    }
  };
  const cbToggleBlock = (blockId) => {
    const term = termRef.current;
    if (!term || term.buffer.active.type !== 'normal' || cbRewriteLockRef.current) return;
    let block = null;
    for (const b of cbBlocksRef.current.values()) {
      if (b.id === blockId) { block = b; break; }
    }
    if (!block) return;

    const lines = readTerminalBufferLines(term);
    const oldTs = tsSnapshotByLine(term, lines.length);
    // 用「命令文本 + 第几次出现」定位，避免两次 ping 绑到同一行
    const start = findCommandLineOccurrence(lines, block.commandLineText, block.occurrence);
    if (start < 0) return;

    if (!block.collapsed) {
      // 收起：start+1 到「下一提示符前」→ 换成一行摘要
      const prompts = scanPromptIndexes(lines);
      const pIdx = prompts.indexOf(start);
      let end = start;
      if (pIdx >= 0 && pIdx + 1 < prompts.length) {
        end = prompts[pIdx + 1] - 1;
      } else {
        // 最后一个提示符：若下一行是摘要则用摘要；否则跟到末尾有内容的行
        if (isCollapseSummaryLine(lines[start + 1])) {
          end = start + 1;
        } else {
          end = start;
          for (let i = start + 1; i < lines.length; i += 1) {
            if (String(lines[i] || '').trim()) end = i;
          }
        }
      }
      if (end <= start) return;
      // output / outputTs 同步构建，避免 filter 后 index 错位
      const output = [];
      const outputTs = [];
      for (let i = start + 1; i <= end; i += 1) {
        if (isCollapseSummaryLine(lines[i])) continue;
        output.push(lines[i]);
        outputTs.push(oldTs[i] || '');
      }
      if (output.length === 0) return;
      block.savedOutput = output;
      block.savedOutputTs = outputTs;
      block.collapsed = true;
      const nextLines = [
        ...lines.slice(0, start + 1),
        `⋯ ${output.length} lines`,
        ...lines.slice(end + 1),
      ];
      // 严格 index 手术：前缀 + 摘要 + 后缀（后缀行号整体前移，戳也整段切开）
      const summaryTs = outputTs.find(Boolean) || oldTs[start] || '';
      const nextTs = [
        ...oldTs.slice(0, start + 1),
        summaryTs,
        ...oldTs.slice(end + 1),
      ];
      // 以命令行作锚点，重写后视口尽量不跳
      rewriteTerminalBufferLines(term, nextLines, nextTs, { anchorLine: start });
      return;
    }

    // 展开
    if (!Array.isArray(block.savedOutput) || block.savedOutput.length === 0) {
      block.collapsed = false;
      scheduleGutterSync();
      return;
    }
    let summaryIdx = start + 1;
    if (!isCollapseSummaryLine(lines[summaryIdx])) {
      const nearby = lines.findIndex((l, idx) => idx > start && idx <= start + 3 && isCollapseSummaryLine(l));
      if (nearby < 0) {
        block.collapsed = false;
        block.savedOutput = null;
        block.savedOutputTs = null;
        scheduleGutterSync();
        return;
      }
      summaryIdx = nearby;
    }
    const restoredTs = Array.isArray(block.savedOutputTs) && block.savedOutputTs.length === block.savedOutput.length
      ? block.savedOutputTs
      : block.savedOutput.map(() => oldTs[start] || '');
    const nextLines = [
      ...lines.slice(0, start + 1),
      ...block.savedOutput,
      ...lines.slice(summaryIdx + 1),
    ];
    const nextTs = [
      ...oldTs.slice(0, start + 1),
      ...restoredTs,
      ...oldTs.slice(summaryIdx + 1),
    ];
    block.collapsed = false;
    rewriteTerminalBufferLines(term, nextLines, nextTs, { anchorLine: start });
  };
  // 关闭功能前：把所有已收起的块展开回 buffer，否则 savedOutput 清掉后无法再展开
  const cbExpandAllCollapsed = (term) => {
    if (!term || term.buffer.active.type !== 'normal' || cbRewriteLockRef.current) return false;
    const collapsed = [...cbBlocksRef.current.values()].filter(
      (b) => b && b.collapsed && Array.isArray(b.savedOutput) && b.savedOutput.length > 0,
    );
    if (collapsed.length === 0) return false;

    let lines = readTerminalBufferLines(term);
    let oldTs = tsSnapshotByLine(term, lines.length);
    // 从后往前展开，避免前面插入行导致后面 occurrence 定位错位
    collapsed.sort((a, b) => b.occurrence - a.occurrence || b.commandLineText.localeCompare(a.commandLineText));

    for (const block of collapsed) {
      const start = findCommandLineOccurrence(lines, block.commandLineText, block.occurrence);
      if (start < 0) {
        block.collapsed = false;
        block.savedOutput = null;
        block.savedOutputTs = null;
        continue;
      }
      let summaryIdx = start + 1;
      if (!isCollapseSummaryLine(lines[summaryIdx])) {
        const nearby = lines.findIndex((l, idx) => idx > start && idx <= start + 3 && isCollapseSummaryLine(l));
        if (nearby < 0) {
          block.collapsed = false;
          block.savedOutput = null;
          block.savedOutputTs = null;
          continue;
        }
        summaryIdx = nearby;
      }
      const restoredTs = Array.isArray(block.savedOutputTs) && block.savedOutputTs.length === block.savedOutput.length
        ? block.savedOutputTs
        : block.savedOutput.map(() => oldTs[start] || '');
      lines = [
        ...lines.slice(0, start + 1),
        ...block.savedOutput,
        ...lines.slice(summaryIdx + 1),
      ];
      oldTs = [
        ...oldTs.slice(0, start + 1),
        ...restoredTs,
        ...oldTs.slice(summaryIdx + 1),
      ];
      block.collapsed = false;
      block.savedOutput = null;
      block.savedOutputTs = null;
    }
    rewriteTerminalBufferLines(term, lines, oldTs);
    return true;
  };
  const cbClear = () => {
    cbBlocksRef.current = new Map();
  };
  const gutterRef = useRef(null);
  const gutterSyncRAFRef = useRef(null);
  const linkUnderlineLayerRef = useRef(null);
  const linkUnderlineSyncRAFRef = useRef(null);
  const smartWriteRef = useRef(null);

  // ponytail: getTerminalTheme() 每次渲染调用 30+ 次，缓存为 1 次
  const T = useMemo(() => getTerminalTheme(), [themeToggle]);

  // ── 时间轴 / 命令块：同步 gutter 到 xterm 视口 ─────────────────
  function scheduleGutterSync() {
    const gutterNeeded = timestampsEnabledRef.current || commandBlocksEnabledRef.current;
    if (gutterSyncRAFRef.current !== null || !gutterNeeded || alternateBufferActiveRef.current) return;
    gutterSyncRAFRef.current = requestAnimationFrame(() => {
      gutterSyncRAFRef.current = null;
      syncGutter();
    });
  }

  // ── 链接：可见区扫描缓存（下划线与 provider 共用，避免双扫） ────
  const viewportLinkCacheRef = useRef({ key: '', byLine: new Map() });

  function getViewportLinkCache(term) {
    const buf = term.buffer.active;
    const rows = term.rows || 0;
    const viewportY = buf.viewportY;
    // 简单 key：视口位置 + 行数 + 输入行起点（输入行变化时失效）
    const inputStart = getTerminalInputStartLine(term);
    const key = `${viewportY}|${rows}|${inputStart}|${buf.baseY}|${buf.cursorY}`;
    const cache = viewportLinkCacheRef.current;
    if (cache.key === key) return cache.byLine;
    const byLine = new Map();
    for (let row = 0; row < rows; row += 1) {
      const bufferLineNumber = viewportY + row + 1;
      const links = findTerminalHttpLinksOnLine(term, bufferLineNumber);
      if (links.length) byLine.set(bufferLineNumber, links);
    }
    viewportLinkCacheRef.current = { key, byLine };
    return byLine;
  }

  function invalidateViewportLinkCache() {
    viewportLinkCacheRef.current = { key: '', byLine: new Map() };
  }

  function scheduleLinkUnderlineSync() {
    if (linkUnderlineSyncRAFRef.current !== null) return;
    linkUnderlineSyncRAFRef.current = requestAnimationFrame(() => {
      linkUnderlineSyncRAFRef.current = null;
      invalidateViewportLinkCache();
      syncLinkUnderlines();
    });
  }

  function syncLinkUnderlines() {
    const layer = linkUnderlineLayerRef.current;
    const term = termRef.current;
    const container = containerRef.current;
    if (!layer) return;
    if (!term?.buffer?.active || !container) {
      layer.innerHTML = '';
      return;
    }
    const screen = container.querySelector('.xterm-screen');
    const rowsEl = container.querySelector('.xterm-rows');
    if (!screen || !rowsEl) {
      layer.innerHTML = '';
      return;
    }
    const cols = term.cols || 1;
    const rows = term.rows || 1;
    const screenRect = screen.getBoundingClientRect();
    const cellWidth = screenRect.width / cols;
    const cellHeight = screenRect.height / rows;
    const rowsRect = rowsEl.getBoundingClientRect();
    const offsetX = rowsRect.left - screenRect.left;
    const offsetY = rowsRect.top - screenRect.top;
    const byLine = getViewportLinkCache(term);
    const parts = [];
    const seen = new Set();
    const viewportY = term.buffer.active.viewportY;
    byLine.forEach((links) => {
      for (const link of links) {
        const id = `${link.range.start.y}:${link.range.start.x}-${link.range.end.y}:${link.range.end.x}:${link.text}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const y0 = link.range.start.y;
        const y1 = link.range.end.y;
        for (let by = y0; by <= y1; by += 1) {
          const row = by - 1 - viewportY;
          if (row < 0 || row >= rows) continue;
          const startCol = by === y0 ? Math.max(0, link.range.start.x - 1) : 0;
          const endCol = by === y1 ? Math.max(startCol + 1, link.range.end.x) : cols;
          const left = offsetX + startCol * cellWidth;
          const width = Math.max(cellWidth, (endCol - startCol) * cellWidth);
          const top = offsetY + (row + 1) * cellHeight - 2;
          parts.push(
            `<div style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:0;border-bottom:1px solid var(--accent, #4d9eff);pointer-events:none;"></div>`,
          );
        }
      }
    });
    layer.innerHTML = parts.join('');
  }

  function collectLiveCommandBlocks(term) {
    // 完全按 buffer 扫描提示符：prompt[i] .. prompt[i+1]-1
    // 同名命令按出现次序分块，避免两次 ping 共用状态
    const lines = readTerminalBufferLines(term);
    const prompts = scanPromptIndexes(lines);
    const list = [];
    const occurrenceByText = new Map();
    for (let i = 0; i < prompts.length; i += 1) {
      const start = prompts[i];
      const commandLineText = normalizeCmdLineKey(lines[start]);
      const occurrence = occurrenceByText.get(commandLineText) || 0;
      occurrenceByText.set(commandLineText, occurrence + 1);
      const block = getOrCreateBlockState(commandLineText, occurrence);
      if (!block) continue;
      let end = start;
      if (block.collapsed && isCollapseSummaryLine(lines[start + 1])) {
        end = start + 1;
      } else if (i + 1 < prompts.length) {
        end = Math.max(start, prompts[i + 1] - 1);
      } else if (isCollapseSummaryLine(lines[start + 1])) {
        end = start + 1;
      } else {
        end = start;
        for (let j = start + 1; j < lines.length; j += 1) {
          if (isShellPromptLine(lines[j])) break;
          if (String(lines[j] || '').trim()) end = j;
        }
      }
      list.push({ block, start, end, collapsed: Boolean(block.collapsed) });
    }
    return list;
  }

  function syncGutter() {
    const gutter = gutterRef.current;
    const term = termRef.current;
    const showTs = timestampsEnabledRef.current;
    const showCb = commandBlocksEnabledRef.current;
    if (!gutter || !term || (!showTs && !showCb) || term.buffer.active.type !== 'normal') {
      return;
    }
    const buf = term.buffer.active;
    const rows = term.rows;
    if (!rows || !containerRef.current) return;

    const timestampsByLine = new Map();
    if (showTs) {
      const ring = tsRingRef.current;
      // 从旧到新扫：后写覆盖先写，保证「执行时刻」压过「提示符出现时刻」
      for (let offset = 0; offset < ring.entries.length; offset += 1) {
        const index = (ring.next + offset) % ring.entries.length;
        const entry = ring.entries[index];
        const line = entry?.marker?.line;
        if (!entry || entry.marker.isDisposed || line < 0) {
          ring.entries[index] = null;
        } else {
          timestampsByLine.set(line, entry.val);
        }
      }
    }

    const liveBlocks = showCb ? collectLiveCommandBlocks(term) : [];
    // 行 → 所在块；块起点优先
    const blockByLine = new Map();
    liveBlocks.forEach((item) => {
      for (let line = item.start; line <= item.end; line += 1) {
        const existing = blockByLine.get(line);
        if (existing && existing.start === line && existing.start !== item.start) continue;
        blockByLine.set(line, item);
      }
    });

    const firstVisible = buf.viewportY; // buffer 中第一个可见行 (ydisp)

    // 通过 xterm screen/rows 的实际渲染尺寸计算行高，确保像素级对齐
    const screen = containerRef.current.querySelector('.xterm-screen');
    const rowsEl = containerRef.current.querySelector('.xterm-rows');
    let lineH;
    if (screen && rowsEl) {
      const screenRect = screen.getBoundingClientRect();
      const rowsRect = rowsEl.getBoundingClientRect();
      lineH = Math.max(rowsRect.height / rows, 1);
      const paddingTop = `${Math.max(rowsRect.top - screenRect.top, 0)}px`;
      if (gutter.style.paddingTop !== paddingTop) gutter.style.paddingTop = paddingTop;
    } else {
      lineH = term.options.fontSize * term.options.lineHeight;
    }

    // 时间戳用状态色；命令块树线/折叠钮用 accent，深色终端上更醒目
    const tsColor = 'var(--term-status-color)';
    const blockColor = 'var(--accent)';
    let html = '';
    for (let i = 0; i < rows; i++) {
      const tsIdx = firstVisible + i;
      const bufLine = buf.getLine(tsIdx);
      const lineText = bufLine ? bufLine.translateToString(true) : '';
      const isEmptyLine = !bufLine || lineText === '';
      const isWrapped = bufLine && bufLine.isWrapped;
      let ts = '';
      // 空提示符也可显示已有戳；当前光标行没有戳时补一个（出现提示符的时间）
      // 真正执行命令时会在回车路径更新为执行时刻
      if (showTs && !isEmptyLine && !isWrapped && tsIdx >= 0 && !isCollapseSummaryLine(lineText)) {
        ts = timestampsByLine.get(tsIdx)
          || (tsIdx === buf.baseY + buf.cursorY ? tsEnsureLine(term, tsIdx, timestampsByLine) : '');
      }

      const owning = showCb ? blockByLine.get(tsIdx) : null;
      const parts = [];
      // 固定列宽：时间戳列右对齐贴齐「]」，命令块列固定 14px，中间无 gap，避免看起来多一格空
      if (showTs) {
        // [HH:MM:SS] 共 10 字符；等宽 11px 约 66px，固定 70 够用
        parts.push(`<span style="display:inline-block;width:70px;min-width:70px;max-width:70px;text-align:right;flex-shrink:0;letter-spacing:0;box-sizing:border-box;color:${tsColor}">${ts || ''}</span>`);
      }
      if (showCb) {
        let blockCell = `<span style="display:inline-flex;width:14px;min-width:14px;height:14px;align-items:center;justify-content:center;flex-shrink:0"></span>`;
        if (owning && tsIdx === owning.start) {
          // 可折叠：展开有输出，或已收起可再展开
          const canFold = owning.collapsed || owning.end > owning.start;
          const icon = owning.collapsed ? '+' : '−';
          blockCell = canFold
            ? `<button type="button" data-cb-id="${owning.block.id}" title="${owning.collapsed ? '展开' : '收起'}" style="display:inline-flex;align-items:center;justify-content:center;width:14px;min-width:14px;height:14px;margin:0;padding:0;border:1px solid color-mix(in srgb, ${blockColor} 78%, transparent);border-radius:2px;background:color-mix(in srgb, ${blockColor} 16%, transparent);color:${blockColor};font-size:11px;line-height:1;cursor:pointer;font-family:var(--font-mono);flex-shrink:0;box-sizing:border-box;font-weight:700">${icon}</button>`
            : `<span style="display:inline-flex;width:14px;min-width:14px;height:14px;align-items:center;justify-content:center;border:1px solid color-mix(in srgb, ${blockColor} 55%, transparent);border-radius:2px;opacity:0.75;flex-shrink:0;box-sizing:border-box"></span>`;
        } else if (owning && !owning.collapsed && tsIdx > owning.start && tsIdx < owning.end) {
          blockCell = `<span style="display:inline-flex;width:14px;min-width:14px;height:14px;align-items:center;justify-content:center;opacity:0.88;color:${blockColor};flex-shrink:0;font-weight:600">│</span>`;
        } else if (owning && !owning.collapsed && tsIdx === owning.end && owning.end > owning.start) {
          blockCell = `<span style="display:inline-flex;width:14px;min-width:14px;height:14px;align-items:center;justify-content:center;opacity:0.88;color:${blockColor};flex-shrink:0;font-weight:600">└</span>`;
        }
        parts.push(blockCell);
      }
      html += `<div style="height:${lineH}px;line-height:${lineH}px;font-size:11px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;padding:0 2px 0 4px;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-end;gap:2px">${parts.join('')}</div>`;
    }
    gutter.innerHTML = html;
  }

  // gutter 点击折叠/展开（随显示状态重绑，避免首屏 display:none 时漏挂）
  useEffect(() => {
    const gutter = gutterRef.current;
    if (!gutter || !commandBlocksVisible) return undefined;
    const onClick = (event) => {
      const btn = event.target?.closest?.('button[data-cb-id]');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const id = Number(btn.getAttribute('data-cb-id'));
      if (Number.isFinite(id)) cbToggleBlock(id);
    };
    gutter.addEventListener('click', onClick);
    return () => gutter.removeEventListener('click', onClick);
  }, [commandBlocksVisible]);

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
      // background 保持透明，让底层主题色 + 壁纸透出来
      theme:            T.xterm,
      fontFamily:       getResolvedProgramFontPreferences().terminalFontFamily,
      fontSize:         fontSize,
      fontWeight:       500,
      fontWeightBold:   700,
      lineHeight:       1.22,
      letterSpacing:    0.3,
      // 关自动反差：搜索高亮底上白字会被压成黑字
      minimumContrastRatio: 0,
      cursorBlink:      true,
      cursorStyle:      'bar',
      cursorWidth:      1,
      scrollback:       5000,
      allowTransparency: true,
      // SearchAddon 高亮装饰依赖 proposed API
      allowProposedApi: true,
      fastScrollModifier: 'alt',
      macOptionIsMeta:  true,
      padding:          8,
      windowOptions: {
        setWinSizeChars: true
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const searchAddon = new SearchAddon({ highlightLimit: 1000 });
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const searchResultsDisposable = searchAddon.onDidChangeResults((result) => {
      setTermSearchResult({
        resultIndex: typeof result?.resultIndex === 'number' ? result.resultIndex : -1,
        resultCount: typeof result?.resultCount === 'number' ? result.resultCount : 0,
      });
    });
    // 点击/手型用 provider；常驻下划线用覆盖层。可见区扫描走 getViewportLinkCache
    const linkProviderDisposable = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const found = getViewportLinkCache(term).get(bufferLineNumber) || [];
        if (!found.length) {
          callback(undefined);
          return;
        }
        callback(found.map(({ text, range }) => ({
          text,
          range,
          decorations: { underline: false, pointerCursor: true },
          activate(event, uri) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            try { term.clearSelection(); } catch (_) {}
            requestAnimationFrame(() => { try { term.clearSelection(); } catch (_) {} });
            const x = event?.clientX ?? 0;
            const y = event?.clientY ?? 0;
            setContextMenu(null);
            setLinkMenu({ ...clampMenuPosition(x, y, 200, 96), url: uri });
          },
        })));
      },
    });
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
      scheduleLinkUnderlineSync();
    };
    const scrollDisposable = term.onScroll(onTermScroll);
    // 直接监听 xterm 视口 DOM scroll 事件作为更可靠的备选
    const vpEl = containerRef.current.querySelector('.xterm-viewport');
    if (vpEl) {
      vpEl.addEventListener('scroll', onTermScroll, { passive: true });
    }

    // ── 每行时间戳 / 命令块：marker 跟随 xterm scrollback 裁剪 ──
    const lineFeedDisposable = term.onLineFeed(() => {
      if (term.buffer.active.type !== 'normal') return;
      if (!timestampsEnabledRef.current && !commandBlocksEnabledRef.current) return;

      const buf = term.buffer.active;
      const cursorLine = buf.baseY + buf.cursorY;
      // 往回跳过 isWrapped 包裹行，记到逻辑行首行
      let pos = cursorLine - 1;
      while (pos > 0) {
        const line = buf.getLine(pos);
        if (line && line.isWrapped) { pos--; } else { break; }
      }
      if (pos < 0) return;

      // 收起/展开改写 buffer 时不要打新时间戳；摘要行不打。
      // 回车完成的行（含「空提示符出现」/「执行命令」）都用当前时刻覆盖旧戳。
      if (timestampsEnabledRef.current && !cbRewriteLockRef.current) {
        const posText = buf.getLine(pos)?.translateToString(true) || '';
        if (!isCollapseSummaryLine(posText)) {
          tsClearLine(pos);
          tsSet(term.registerMarker(pos - cursorLine), formatTerminalTimestamp());
        }
      }
      // 命令块由 gutter sync 扫描提示符决定，lineFeed 只需刷新
      if (commandBlocksEnabledRef.current && !cbRewriteLockRef.current) {
        scheduleGutterSync();
      }
    });
    const writeParsedDisposable = term.onWriteParsed(() => {
      scheduleGutterSync();
      scheduleLinkUnderlineSync();
    });
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
        if (linkUnderlineLayerRef.current) linkUnderlineLayerRef.current.innerHTML = '';
      } else {
        scheduleGutterSync();
        scheduleLinkUnderlineSync();
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
        shortcutsRef.current = saved ? JSON.parse(saved) : { copy: 'Ctrl+C', paste: 'Ctrl+V', clear: 'Ctrl+L', newTab: 'Ctrl+T', find: 'Ctrl+F' };
      } catch (_) {
        shortcutsRef.current = { copy: 'Ctrl+C', paste: 'Ctrl+V', clear: 'Ctrl+L', newTab: 'Ctrl+T', find: 'Ctrl+F' };
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
            const payload = normalizeTerminalPasteText(text);
            pendingCmdRef.current += payload.replace(/[\x00-\x1F\x7F]/g, '');
            wsRef.current.send(textEncoder.encode(payload));
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

      // ── 查找终端缓冲区（默认 Ctrl+F） ────────────────
      const findShortcut = customShortcuts.find || 'Ctrl+F';
      if (pressedStr === findShortcut) {
        e.preventDefault();
        const selection = term.getSelection();
        setShowTermSearch(true);
        if (selection && !selection.includes('\n') && selection.length <= 200) {
          setTermSearchQuery(selection);
        }
        requestAnimationFrame(() => {
          termSearchInputRef.current?.focus();
          termSearchInputRef.current?.select();
        });
        return false;
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

      // 粘贴等多字符输入：把 \\r\\n / \\n 收成单个 \\r，保证 bash 的 \\ 续行不断
      let out = data;
      if (out.length > 1 && /[\r\n]/.test(out)) {
        out = normalizeTerminalPasteText(out);
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(textEncoder.encode(out));
      }

      // ── 命令记录：回车时优先用逐字符累加的命令（用户真实输入），
      // 累加为空才 fallback 到 xterm buffer（方向键调历史 / Tab 补全 / 粘贴）。
      // ponytail: buffer 提取用 $/# 切提示符，交互脚本输出也含 $ 导致误抓整行，
      // 优先用 pendingCmdRef 可排除 y/1/3 等单字符脚本应答。
      if (out.includes('\r') || out.includes('\n')) {
        // 多行粘贴：只把最后一行之前的可见内容并入历史，避免把整段 paste 拆烂
        const lines = out.split(/\r/).filter((line, i, arr) => i < arr.length - 1 || line.length > 0);
        if (lines.length > 1) {
          for (const line of lines) {
            const piece = line.replace(/[\x00-\x1F\x7F]/g, '');
            if (piece) pendingCmdRef.current += (pendingCmdRef.current ? ' ' : '') + piece;
          }
        } else {
          const nlIdx = out.search(/[\r\n]/);
          if (nlIdx > 0) {
            pendingCmdRef.current += out.slice(0, nlIdx).replace(/[\x00-\x1F\x7F]/g, '');
          }
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
      } else if (out === '\x7F' || out === '\b') {
        pendingCmdRef.current = pendingCmdRef.current.slice(0, -1);
      } else if (!/[\x00-\x1F\x7F]/.test(out)) {
        pendingCmdRef.current += out;
      } else if (out === '\x03' || out === '\x04') {
        pendingCmdRef.current = '';
        awaitingPasswordRef.current = false; // Ctrl+C/D 取消当前输入，重置密码等待状态，避免下一条普通命令被误跳过
      }

      // Local Echo 逻辑 (恢复默认开启)
      if (localEchoRef.current) {
        // 如果输入中不包含控制字符（如方向键、Esc、退格等），则视作常规可见输入（支持多字符连击或粘贴）
        if (!/[\x00-\x1F\x7F]/.test(out)) {
          // 由于 JavaScript 中部分多字节字符的 length 表现，这里按照字符串常规长度累加是安全的。
          // 因为退格也是按字符来删的。
          localInputLength += out.length;
          for (let i = 0; i < out.length; i++) {
            pendingEchoes.push(out[i]);
          }
          term.write(out);
        } else if (out === '\x7F') { // Backspace
          // 仅当我们确信这是用户刚刚输入的字符时，才在本地执行退格预测。
          // 否则（localInputLength <= 0），将退格完全交还给服务器，保护提示符不被删除。
          if (localInputLength > 0) {
            localInputLength--;
            pendingEchoes.push(out);
            term.write('\b \b'); // 本地立即执行退格效果
          }
        } else if (out === '\r' || out === '\n' || out === '\r\n' || (out.length > 1 && /[\r\n]/.test(out))) {
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
      scheduleLinkUnderlineSync();
    });
    // 首帧同步常驻下划线
    scheduleLinkUnderlineSync();

    return () => {
      cancelled = true;
      scrollDisposable.dispose();
      lineFeedDisposable.dispose();
      writeParsedDisposable.dispose();
      bufferChangeDisposable.dispose();
      resizeDisposable.dispose();
      try { linkProviderDisposable.dispose(); } catch (_) {}
      try { searchResultsDisposable.dispose(); } catch (_) {}
      try { searchAddon.dispose(); } catch (_) {}
      if (gutterSyncRAFRef.current !== null) {
        cancelAnimationFrame(gutterSyncRAFRef.current);
        gutterSyncRAFRef.current = null;
      }
      if (linkUnderlineSyncRAFRef.current !== null) {
        cancelAnimationFrame(linkUnderlineSyncRAFRef.current);
        linkUnderlineSyncRAFRef.current = null;
      }
      if (linkUnderlineLayerRef.current) linkUnderlineLayerRef.current.innerHTML = '';
      clearTimeout(fitTimer);
      if (vpEl) vpEl.removeEventListener('scroll', onTermScroll);
      // 移除 wheel 监听器，避免内存泄漏
      containerRef.current?.removeEventListener('wheel', wheelHandler);
      if (ws) { try { ws.close(); } catch (_) {} }
      if (wsRef.current === ws) wsRef.current = null;
      tsClear(); // 清理时间戳
      cbClear(); // 清理命令块边框
      if (window.__luminTerminalSnapshots?.[sessionId]) {
        delete window.__luminTerminalSnapshots[sessionId];
      }
      smartWriteRef.current = null;
      alternateBufferActiveRef.current = false;
      termRef.current     = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
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
    const term = termRef.current;
    if (term) {
      // xterm 背景保持透明，底色由 wrapper(--term-container-bg) 提供，壁纸才能叠在上面
      const xtermTheme = { ...T.xterm };
      const darkTerm = isDarkTerminalSurface(T);
      // 搜索/选区当前匹配常走 selectionForeground：深色终端强制白字，浅色终端强制深字
      xtermTheme.selectionForeground = darkTerm ? '#ffffff' : '#0f172a';
      term.options.theme = xtermTheme;
      // ponytail: 对比度按终端底算。深色终端也关自动反差——搜索高亮底会参与计算，
      // 否则白字会被压成黑字（浅色 UI + 复制深色终端时尤其明显）
      term.options.minimumContrastRatio = 0;
      // 强制重绘已有缓冲，否则 ANSI 色板切换后旧行不更新
      try {
        const rows = Math.max(0, (term.rows || 1) - 1);
        term.refresh(0, rows);
      } catch (_) {}
    }
    // ponytail: container 颜色走 CSS 变量，JSX 中不再直接引用 T.container
    const el = wrapperRef.current;
    if (el) {
      const c = T.container;
      el.style.setProperty('--term-container-bg', c.containerBg);
      el.style.setProperty('--term-tint', c.tint || 'transparent');
      el.style.setProperty('--term-status-bg', c.statusBarBg);
      el.style.setProperty('--term-status-border', c.statusBarBorder);
      el.style.setProperty('--term-status-color', c.statusBarColor);
      el.style.setProperty('--term-server-color', c.serverNameColor);
      el.style.setProperty('--term-input-bar-bg', c.inputBarBg);
      el.style.setProperty('--term-input-bar-border', c.inputBarBorder);
      el.style.setProperty('--term-input-bg', c.inputBg);
      el.style.setProperty('--term-input-color', c.inputColor);
      el.style.setProperty('--term-input-placeholder', c.inputPlaceholder || c.mutedColor || '');
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
      if (!timestampsEnabledRef.current && !commandBlocksEnabledRef.current) {
        if (gutterRef.current) gutterRef.current.innerHTML = '';
      } else {
        scheduleGutterSync();
      }
    };
    const handleCommandBlocksChange = (e) => {
      const enabled = e.detail !== false;
      commandBlocksEnabledRef.current = enabled;
      setCommandBlocksVisible(enabled);
      if (!enabled) {
        // ponytail: 关开关前先展开，否则 buffer 里还留着 ⋯ N lines，但 savedOutput 被清掉，再开无法展开
        const term = termRef.current;
        if (term) {
          cbExpandAllCollapsed(term);
        }
        cbClear();
      }
      if (!timestampsEnabledRef.current && !enabled) {
        if (gutterRef.current) gutterRef.current.innerHTML = '';
      } else {
        // 下一帧再 sync，等 display/width 样式生效
        requestAnimationFrame(() => scheduleGutterSync());
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
    window.addEventListener('terminal-command-blocks-changed', handleCommandBlocksChange);
    window.addEventListener('program-font-settings-changed', handleProgramFontSettingsChange);
    return () => {
      window.removeEventListener('app-shortcuts-changed', handleShortcutsChange);
      window.removeEventListener('terminal-local-echo-changed', handleLocalEchoChange);
      window.removeEventListener('terminal-timestamps-changed', handleTimestampsChange);
      window.removeEventListener('terminal-command-blocks-changed', handleCommandBlocksChange);
      window.removeEventListener('program-font-settings-changed', handleProgramFontSettingsChange);
    };
  }, []);

  const handleContextMenu = (e) => {
    e.preventDefault();
    setLinkMenu(null);
    const hasSelection = !!(termRef.current && termRef.current.getSelection());
    setContextHasSelection(hasSelection);
    setContextMenu(clampMenuPosition(e.clientX, e.clientY, 190, 168));
  };

  const closeContextMenu = () => {
    if (contextMenu) setContextMenu(null);
  };

  const closeLinkMenu = () => {
    if (linkMenu) setLinkMenu(null);
  };

  const getTermSearchOptions = useCallback((incremental = false) => ({
    caseSensitive: termSearchCaseSensitive,
    incremental,
    // 高亮跟终端底色走，不跟界面 light/dark 走（浅色 UI + 深色终端时用深色方案）
    decorations: getTermSearchDecorations(T),
  }), [termSearchCaseSensitive, themeToggle, T]);

  const openTermSearch = useCallback((seedText) => {
    setShowTermSearch(true);
    if (typeof seedText === 'string' && seedText && !seedText.includes('\n') && seedText.length <= 200) {
      setTermSearchQuery(seedText);
    } else {
      const selection = termRef.current?.getSelection?.();
      if (selection && !selection.includes('\n') && selection.length <= 200) {
        setTermSearchQuery(selection);
      }
    }
    requestAnimationFrame(() => {
      termSearchInputRef.current?.focus();
      termSearchInputRef.current?.select();
    });
  }, []);

  const closeTermSearch = useCallback(() => {
    setShowTermSearch(false);
    setTermSearchResult({ resultIndex: -1, resultCount: 0 });
    try { searchAddonRef.current?.clearDecorations(); } catch (_) {}
    termRef.current?.focus();
  }, []);

  const findTermNext = useCallback((incremental = false) => {
    const addon = searchAddonRef.current;
    const query = termSearchQuery;
    if (!addon || !query) {
      setTermSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    addon.findNext(query, getTermSearchOptions(incremental));
  }, [getTermSearchOptions, termSearchQuery]);

  const findTermPrevious = useCallback(() => {
    const addon = searchAddonRef.current;
    const query = termSearchQuery;
    if (!addon || !query) {
      setTermSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    addon.findPrevious(query, getTermSearchOptions(false));
  }, [getTermSearchOptions, termSearchQuery]);

  // 查找栏打开后：输入变化 / 大小写切换 / 主题切换 → 清旧装饰再搜（避免浅深色装饰残留）
  useEffect(() => {
    if (!showTermSearch) return;
    if (!termSearchQuery) {
      try { searchAddonRef.current?.clearDecorations(); } catch (_) {}
      setTermSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    try { searchAddonRef.current?.clearDecorations(); } catch (_) {}
    findTermNext(true);
  }, [showTermSearch, termSearchQuery, termSearchCaseSensitive, themeToggle, findTermNext]);

  // 终端聚焦时 Ctrl+F；输入栏等区域同样可用
  useEffect(() => {
    if (!isActive) return undefined;
    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const keys = [];
      if (getModKey(e)) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      let keyName = e.key;
      if (keyName === ' ') keyName = 'Space';
      else if (keyName.length === 1) keyName = keyName.toUpperCase();
      keys.push(keyName);
      const pressedStr = keys.join('+');
      const findShortcut = shortcutsRef.current?.find || 'Ctrl+F';
      if (pressedStr !== findShortcut) return;
      const activeEl = document.activeElement;
      const inWrapper = !!(wrapperRef.current && (
        wrapperRef.current.contains(activeEl)
        || wrapperRef.current.contains(e.target)
      ));
      // xterm 辅助 textarea 有时不在 wrapper 内层级判断里，再兜一层
      const inXterm = !!(activeEl?.classList?.contains('xterm-helper-textarea')
        || e.target?.classList?.contains('xterm-helper-textarea'));
      if (!inWrapper && !inXterm) return;
      e.preventDefault();
      e.stopPropagation();
      openTermSearch();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isActive, openTermSearch]);

  const openExternalUrl = (url) => {
    if (!url) return;
    if (typeof window.runtime?.BrowserOpenURL === 'function') {
      window.runtime.BrowserOpenURL(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleLinkMenuAction = (action) => {
    const url = linkMenu?.url || '';
    closeLinkMenu();
    if (!url) return;
    if (action === 'copy') {
      navigator.clipboard.writeText(url).then(() => {
        setLinkToast(t('链接已复制'));
        setTimeout(() => setLinkToast(''), 1500);
      }).catch(() => {});
      termRef.current?.focus();
      return;
    }
    if (action === 'open') {
      openExternalUrl(url);
      termRef.current?.focus();
    }
  };

  // 点击外部关闭右键菜单 / 链接菜单
  useEffect(() => {
    if (!contextMenu && !linkMenu) return;
    const handler = (e) => {
      if (e.target?.closest?.('.context-menu')) return;
      setContextMenu(null);
      setLinkMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu, linkMenu]);

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
            const payload = normalizeTerminalPasteText(text);
            pendingCmdRef.current += payload.replace(/[\x00-\x1F\x7F]/g, '');
            wsRef.current.send(textEncoder.encode(payload));
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
      case 'find': {
        const selectedText = termRef.current.getSelection();
        openTermSearch(selectedText || undefined);
        break;
      }
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
  const [multiLineWrapEnabled, setMultiLineWrapEnabled] = useState(() => localStorage.getItem('terminalMultiLineWrapEnabled') !== 'false');

  const syncCommandInputHeight = useCallback(() => {
    const element = cmdInputRef.current
    if (!element) return
    element.style.height = '32px'
    element.style.overflowY = 'hidden'
    element.scrollTop = 0
    if (!element.value) {
      return
    }
    const scrollHeight = Math.max(element.scrollHeight, 32)
    const nextHeight = Math.min(scrollHeight, 132)
    element.style.height = `${nextHeight}px`
    if (scrollHeight > 132) {
      element.style.overflowY = 'auto'
    }
  }, [])

  const toggleMultiLineWrap = useCallback(() => {
    setMultiLineWrapEnabled((previous) => {
      const next = !previous
      localStorage.setItem('terminalMultiLineWrapEnabled', next ? 'true' : 'false')
      return next
    })
    requestAnimationFrame(() => {
      cmdInputRef.current?.focus()
      syncCommandInputHeight()
    })
  }, [syncCommandInputHeight])

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
      // 历史弹窗是浮动层，不再收起底部快捷命令面板
    } else {
      setHistoryPopupPos(null);
    }
    setShowHistory(willShow);
  };

  const toggleCommands = () => {
    const willShow = !showCommands;
    if (willShow) {
      if (showHistory) { setShowHistory(false); setHistoryPopupPos(null); }
      onQuickCommandsOpenChange?.(true);
      return;
    }
    // 关闭面板时检查是否有未保存的修改
    if (quickCmdsRef.current?.isDirty?.()) {
      quickCmdsRef.current.showCloseConfirm();
      return; // 让 onClose 回调来关闭
    }
    onQuickCommandsOpenChange?.(false);
  };

  const selectHistoryCmd = (cmd) => {
    setCmdInput(cmd);
    setShowHistory(false);
    setHistoryPopupPos(null);
    cmdInputRef.current?.focus();
  };

  const executeCommand = (directCmd) => {
    const rawCommand = directCmd ?? cmdInput;
    if (!isConnected) {
      if (isClosed || isError) {
        window.dispatchEvent(new CustomEvent('ssh-reconnect-trigger', { detail: sessionId }));
      }
      return;
    }
    const normalizedText = String(rawCommand ?? '').replace(/\r\n?/g, '\n');
    const text = normalizedText.trim();
    const isBlankSubmit = !text;
    const lineCount = normalizedText.split('\n').length;
    const finalPayload = isBlankSubmit
      ? '\r'
      : multiLineWrapEnabled && lineCount > 1
        ? buildWrappedMultiLineCommand(normalizedText)
        : text + '\r';
    AppGo.WriteTerminal(sessionId, finalPayload).catch((err) => {
      console.error('WriteTerminal failed:', err);
    });
    termRef.current?.scrollToBottom();
    if (!isBlankSubmit && text.length > 1 && !/^\d+$/.test(text) && !isInteractivePromptText(text) && !awaitingPasswordRef.current) {
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
    setCommandAutocompletePopupPos(null);
    setCommandAutocomplete(createCommandAutocompleteState());
  }, [clearCommandAutocompleteBlurTimer, clearCommandAutocompleteDebounce]);

  const updateCommandAutocompletePopupPosition = useCallback(() => {
    const nextPopupPos = getTextareaAutocompletePopupPosition(cmdInputRef.current)
    if (nextPopupPos) {
      setCommandAutocompletePopupPos(nextPopupPos)
    }
  }, [])

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

    updateCommandAutocompletePopupPosition();

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
  }, [closeCommandAutocomplete, ensureCommandAutocompleteData, sessionId, showCommands, showHistory, terminalCwd, updateCommandAutocompletePopupPosition]);

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
    syncCommandInputHeight()
    if (commandAutocomplete.open || commandAutocomplete.loading) {
      updateCommandAutocompletePopupPosition()
    }
  }, [cmdInput, commandAutocomplete.loading, commandAutocomplete.open, syncCommandInputHeight, updateCommandAutocompletePopupPosition])

  useEffect(() => {
    if (!commandAutocomplete.open && !commandAutocomplete.loading) {
      return undefined
    }
    const handleWindowChange = () => {
      updateCommandAutocompletePopupPosition()
    }
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [commandAutocomplete.loading, commandAutocomplete.open, updateCommandAutocompletePopupPosition])

  useLayoutEffect(() => {
    syncCommandInputHeight()
  }, [cmdInput, syncCommandInputHeight])

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
        // 主题底色 + 色调层；壁纸半透明叠在上面
        background: 'var(--term-container-bg)',
        overflow: 'hidden',
      }}
    >
      {/* 主题色调层：深色下拉开 Lumin/Tokyo/Catppuccin/Dracula 差异 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--term-tint, transparent)',
        pointerEvents: 'none',
        zIndex: Z.BG,
      }} />
      {/* 壁纸层：正常叠加，保留质感 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${bgInfo.image || defaultTermBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: Number.isFinite(bgInfo.opacity) ? bgInfo.opacity : 0.15,
        pointerEvents: 'none',
        zIndex: Z.BG,
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

      {/* ── 终端内容查找栏 ── */}
      {showTermSearch && (
        <div
          className="term-search-bar"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderBottom: '1px solid var(--term-separator)',
            background: 'var(--term-status-bg)',
            flexShrink: 0,
            zIndex: Z.SEARCH_PANEL,
          }}
        >
          <Search size={13} style={{ color: 'var(--term-muted)', flexShrink: 0 }} />
          <input
            ref={termSearchInputRef}
            value={termSearchQuery}
            onChange={(e) => setTermSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeTermSearch();
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) findTermPrevious();
                else findTermNext(false);
              }
            }}
            placeholder={t('查找...')}
            className="term-search-input"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '4px 8px',
              background: 'var(--term-input-bg)',
              border: '1px solid var(--term-btn-border)',
              borderRadius: 4,
              color: 'var(--term-input-color)',
              fontSize: 12,
              outline: 'none',
              fontFamily: 'var(--font-ui)',
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: termSearchQuery && termSearchResult.resultCount === 0
                ? 'var(--danger, #ff7b72)'
                : 'var(--term-muted)',
              fontFamily: 'var(--font-mono)',
              minWidth: 52,
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            {!termSearchQuery
              ? ''
              : termSearchResult.resultCount <= 0
                ? t('无匹配')
                : termSearchResult.resultIndex < 0
                  ? `${termSearchResult.resultCount}`
                  : `${termSearchResult.resultIndex + 1}/${termSearchResult.resultCount}`}
          </span>
          <Tiptop text={t('区分大小写')}>
            <button
              type="button"
              onClick={() => setTermSearchCaseSensitive((v) => !v)}
              aria-label={t('区分大小写')}
              aria-pressed={termSearchCaseSensitive}
              className={`term-btn${termSearchCaseSensitive ? ' active' : ''}`}
              style={{ padding: '4px 6px', minWidth: 28, height: 26 }}
            >
              <CaseSensitive size={13} />
            </button>
          </Tiptop>
          <Tiptop text={t('上一个')}>
            <button
              type="button"
              onClick={() => findTermPrevious()}
              aria-label={t('上一个')}
              className="term-btn"
              style={{ padding: '4px 6px', minWidth: 28, height: 26 }}
              disabled={!termSearchQuery}
            >
              <ChevronUp size={13} />
            </button>
          </Tiptop>
          <Tiptop text={t('下一个')}>
            <button
              type="button"
              onClick={() => findTermNext(false)}
              aria-label={t('下一个')}
              className="term-btn"
              style={{ padding: '4px 6px', minWidth: 28, height: 26 }}
              disabled={!termSearchQuery}
            >
              <ChevronDown size={13} />
            </button>
          </Tiptop>
          <Tiptop text={t('关闭')}>
            <button
              type="button"
              onClick={closeTermSearch}
              aria-label={t('关闭')}
              className="term-btn"
              style={{ padding: '4px 6px', minWidth: 28, height: 26 }}
            >
              <X size={13} />
            </button>
          </Tiptop>
        </div>
      )}

      {/* ── xterm 渲染层 + 时间轴 / 命令块边框 ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div ref={gutterRef} style={{
          display: (timestampsVisible || commandBlocksVisible) && !alternateBufferActive ? 'block' : 'none',
          // 时间戳约 72px；命令块约 16px；两者同时开约 96px
          // 时间戳列 70 + 命令块 14 + padding ≈ 90；仅时间戳 75；仅命令块 22
          width: timestampsVisible && commandBlocksVisible ? 90 : timestampsVisible ? 75 : 22,
          flexShrink: 0,
          paddingTop: 0,
          overflow: 'hidden',
          boxSizing: 'border-box',
        }} />
        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            ref={containerRef}
            style={{
              height: '100%',
              minHeight: 0,
              padding: '0',
              background: 'transparent',
            }}
          />
          {/* 常驻链接下划线（pointer-events:none，不挡点击/选区） */}
          <div
            ref={linkUnderlineLayerRef}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
              zIndex: 2,
            }}
          />
          </div>
      </div>

      {/* ── 底部命令输入栏 ── */}
      <div className="term-input-bar">
        {/* 命令输入框 */}
        <textarea
          ref={cmdInputRef}
          className="input term-command-input"
          value={cmdInput}
          rows={1}
          spellCheck={false}
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
            updateCommandAutocompletePopupPosition();
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
          onScroll={() => {
            if (commandAutocomplete.open || commandAutocomplete.loading) {
              updateCommandAutocompletePopupPosition();
            }
          }}
          onSelect={() => {
            if (commandAutocomplete.open || commandAutocomplete.loading) {
              updateCommandAutocompletePopupPosition();
            }
            if (commandAutocompleteFocusedRef.current && cmdInput.trim()) {
              scheduleCommandAutocompleteSuggestions(cmdInput);
            }
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

            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              requestAnimationFrame(() => {
                if (commandAutocompleteFocusedRef.current && cmdInputRef.current) {
                  updateCommandAutocompletePopupPosition();
                  void loadCommandAutocompleteSuggestions(cmdInputRef.current.value);
                }
              });
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
              if (e.shiftKey || e.ctrlKey) {
                return;
              }
              e.preventDefault();
              closeCommandAutocomplete();
              executeCommand();
            }
          }}
          placeholder={t('输入命令(/ 快捷命令), 按Ctrl+回车 或 Shift+回车 换行')}
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: 'var(--font-terminal)',
            padding: '7px 10px',
            height: 32,
            minHeight: 32,
            background: 'var(--term-input-bg)',
            color: 'var(--term-input-color)',
            borderColor: cmdInput ? 'var(--border-focus)' : 'var(--term-btn-border)',
          }}
        />

        {/* 历史按钮 */}
        <Tiptop text={t('历史指令')}>
          <button
            ref={historyBtnRef}
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleHistory();
            }}
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
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleCommands();
            }}
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

        <Tiptop text={multiLineWrapEnabled ? t('函数/变量作用域:命令内部') : t('函数/变量作用域:终端会话')}>
          <button
            onClick={toggleMultiLineWrap}
            aria-label={multiLineWrapEnabled ? t('函数/变量作用域:命令内部') : t('函数/变量作用域:终端会话')}
            className={`term-btn${multiLineWrapEnabled ? ' active' : ''}`}
            style={{ padding: 0, width: 32, minWidth: 32, justifyContent: 'center' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
              &gt;_
            </span>
          </button>
        </Tiptop>
      </div>
      </div>

      {(commandAutocomplete.open || commandAutocomplete.loading) && !showHistory && !showCommands && commandAutocompletePopupPos && (
        <div
          className="term-popup"
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            left: commandAutocompletePopupPos.left,
            top: commandAutocompletePopupPos.top,
            width: commandAutocompletePopupPos.width,
            maxHeight: commandAutocompletePopupPos.maxHeight ?? 260,
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
          <div ref={commandAutocompleteListRef} style={{ maxHeight: 220, overflowY: 'auto', overflowX: 'hidden' }}>
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
                    minWidth: 0,
                    display: 'grid',
                    gap: 4,
                    padding: '9px 12px',
                    textAlign: 'left',
                    border: 'none',
                    borderBottom: index === commandAutocomplete.items.length - 1 && !commandAutocomplete.loading ? 'none' : '1px solid var(--term-separator)',
                    background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                    color: 'var(--term-input-color)',
                    cursor: 'pointer',
                    overflow: 'hidden',
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
            zIndex: Z.MENU,
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
            { icon: <Search size={13} />, label: t('查找'), action: 'find', shortcut: formatShortcut(shortcutsRef.current?.find || 'Ctrl+F') },
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

      {/* ── 终端链接菜单：复制 / 打开（对齐安卓） ── */}
      {linkMenu && (
        <>
          {/* 透明遮罩：挡住终端拖选，点击空白关闭 */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: Z.MENU_BACKDROP,
              background: 'transparent',
              cursor: 'default',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try { termRef.current?.clearSelection(); } catch (_) {}
              setLinkMenu(null);
            }}
            onMouseMove={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
          <div
            className="context-menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: linkMenu.x,
              top: linkMenu.y,
              backgroundColor: 'var(--term-context-bg)',
              border: 'var(--term-context-border)',
              borderRadius: '8px',
              boxShadow: 'var(--term-context-shadow)',
              zIndex: Z.MENU,
              padding: '4px 0',
              minWidth: '200px',
              maxWidth: '360px',
              fontFamily: 'var(--font-ui)',
            }}
          >
            <div
              style={{
                padding: '6px 12px 4px',
                fontSize: 11,
                color: 'var(--text-muted, #8899aa)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={linkMenu.url}
            >
              {linkMenu.url}
            </div>
            <div className="context-menu-separator" />
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                handleLinkMenuAction('copy');
              }}
            >
              <span className="item-icon"><Copy size={13} /></span>
              <span className="item-label">{t('复制')}</span>
            </div>
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                handleLinkMenuAction('open');
              }}
            >
              <span className="item-icon"><ExternalLink size={13} /></span>
              <span className="item-label">{t('打开')}</span>
            </div>
          </div>
        </>
      )}

      {linkToast && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 56,
            transform: 'translateX(-50%)',
            background: 'var(--term-context-bg, rgba(20,24,32,0.92))',
            border: 'var(--term-context-border, 1px solid rgba(255,255,255,0.08))',
            color: 'var(--text-primary, #eaf0f7)',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            zIndex: Z.POPUP,
            pointerEvents: 'none',
            boxShadow: 'var(--term-context-shadow)',
          }}
        >
          {linkToast}
        </div>
      )}
    </div>
  );
}
