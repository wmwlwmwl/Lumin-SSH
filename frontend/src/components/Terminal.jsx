import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Copy, Clipboard, Trash2, CheckSquare, Play, Clock, X } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import QuickCommands from './QuickCommands.jsx';
import '@xterm/xterm/css/xterm.css';
import { t } from '../i18n';
import defaultTermBg from '../assets/term_bg.png';

// ── 多套终端主题定义 ──────────────────────────────────────────────
const TERMINAL_THEMES = {
  'lumin': {
    name: 'Lumin Default',
    swatches: ['#22c55e', '#58a6ff', '#bc8cff', '#0d1117'],
    theme: {
      background: '#00000000', foreground: '#cdd9e5', cursor: '#22c55e',
      cursorAccent: '#0d1117', selectionBackground: 'rgba(34,197,94,0.20)',
      black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
      brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
    },
  },
  'tokyo-night': {
    name: 'Tokyo Night',
    swatches: ['#7aa2f7', '#bb9af7', '#73daca', '#1a1b26'],
    theme: {
      background: '#00000000', foreground: '#a9b1d6', cursor: '#7aa2f7',
      cursorAccent: '#1a1b26', selectionBackground: 'rgba(122,162,247,0.20)',
      black: '#32344a', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
      blue: '#7aa2f7', magenta: '#ad8ee6', cyan: '#449dab', white: '#787c99',
      brightBlack: '#444b6a', brightRed: '#ff7a93', brightGreen: '#b9f27c',
      brightYellow: '#ff9e64', brightBlue: '#7da6ff', brightMagenta: '#bb9af7',
      brightCyan: '#0db9d7', brightWhite: '#acb0d0',
    },
  },
  'catppuccin': {
    name: 'Catppuccin',
    swatches: ['#cba6f7', '#89b4fa', '#a6e3a1', '#1e1e2e'],
    theme: {
      background: '#00000000', foreground: '#cdd6f4', cursor: '#f5c2e7',
      cursorAccent: '#1e1e2e', selectionBackground: 'rgba(203,166,247,0.20)',
      black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
      blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
      brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5', brightWhite: '#a6adc8',
    },
  },
  'dracula': {
    name: 'Dracula',
    swatches: ['#ff79c6', '#bd93f9', '#50fa7b', '#282a36'],
    theme: {
      background: '#00000000', foreground: '#f8f8f2', cursor: '#f8f8f2',
      cursorAccent: '#282a36', selectionBackground: 'rgba(189,147,249,0.25)',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
  },
};

// 根据 localStorage 获取当前主题
function getXtermTheme() {
  const key = localStorage.getItem('terminalColorTheme') || 'lumin';
  return (TERMINAL_THEMES[key] || TERMINAL_THEMES['lumin']).theme;
}

export default function Terminal({ sessionId, serverId, historyServerId, status, isActive, serverName, connectedSessions = [] }) {
  const containerRef   = useRef(null);
  const termRef        = useRef(null);
  const fitAddonRef    = useRef(null);
  const wsRef          = useRef(null);
  const serverIdRef    = useRef(serverId);
  serverIdRef.current  = serverId;
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
  const pendingCmdRef                         = useRef('');

  // 热路径缓存：避免在按键/消息回调中频繁读取 localStorage
  const shortcutsRef = useRef(null);
  const localEchoRef = useRef(localStorage.getItem('terminalLocalEcho') !== 'false');

  // ── 初始化 xterm + WebSocket 终端通道 ────────────────────────────────
  // xterm.js 通过 AttachAddon + WebSocket 直接连到本地 Go WebSocket 服务器
  // 完全绕开 Wails IPC跨进程通信，走 TCP loopback 延迟极低
  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const fontSize = parseInt(localStorage.getItem('terminalFontSize') || '13', 10);

    const term = new XTerm({
      theme:            getXtermTheme(),
      fontFamily:       "'JetBrains Mono', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Fira Code', monospace",
      fontSize:         fontSize,
      lineHeight:       1.22,
      letterSpacing:    0.3,
      cursorBlink:      true,
      cursorStyle:      'bar',
      cursorWidth:      1,
      scrollback:       5000,
      allowTransparency: true,
      fastScrollModifier: 'alt',
      macOptionIsMeta:  true,
      windowOptions: {
        setWinSizeChars: true
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // ── DOM 渲染器（WebGL 对 CJK/宽字符支持差，使用默认 DOM 渲染确保中文正常显示）──

    termRef.current    = term;
    fitAddonRef.current = fitAddon;

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
      if (e.ctrlKey)  keys.push('Ctrl');
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
        // 这样如果你用的是 Ctrl+C，它就能变成标准的终端中断指令 (\x03) 发给服务器
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
            wsRef.current.send(new TextEncoder().encode(text));
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

    // 并行获取端口与鉴权 token，后端要求连接时通过 ?token=xxx 携带，防止本机恶意进程注入命令
    Promise.all([AppGo.GetWsPort(), AppGo.GetWsToken()]).then(([port, token]) => {
      if (cancelled || !port || !termRef.current) return;
      const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${sessionId}${tokenQuery}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (!termRef.current) return;

        // 检测密码提示，标记下一行输入为密码（不记入命令历史）
        if (!awaitingPassword) {
          const probeText = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
          if (/[Pp]assword|密码|passphrase/i.test(probeText)) {
            awaitingPassword = true;
          }
        }

        // 如果没有正在预测的字符，直接使用原生 Uint8Array 交给 xterm.js 渲染（最快且无损，避免 TextDecoder 吃字符）
        if (!localEchoRef.current || pendingEchoes.length === 0) {
          termRef.current.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
          return;
        }

        // --- 预测匹配阶段 ---
        let text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
        let i = 0;
        let newText = '';
        
        while (i < text.length) {
          // 1. 强大且健壮的 ANSI 转义序列跳过逻辑 (CSI、OSC 及其他单字符转义)
          if (text[i] === '\x1b') {
            let j = i + 1;
            if (j >= text.length) { newText += text[i]; i++; continue; }
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
            newText += text.substring(i, j);
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
              newText += text[i];
              i++;
              continue;
            }
          }
          
          // 真正的冲突（服务器发来了与预测不符的可打印字符），视为脱轨，清空队列并接受服务器输出
          pendingEchoes.length = 0;
          newText += text[i];
          i++;
        }
        
        // 写回经过滤的文本
        termRef.current.write(newText);
      };

      ws.onerror = (e) => console.error('[Terminal] WebSocket error', e);
    });

    // ── 历史指令记录 + 输入直通 + Local Echo ────────────────────────
    let localInputLength = 0; // 用于保护提示符，防止退格越界
    let awaitingPassword = false; // 检测到密码提示后，下一行输入不记入命令历史

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(new TextEncoder().encode(data));
      }

      // ── 按键累计记录命令（仅跟踪可打印字符，方向键/控制序列自动放弃）──
      if (data === '\r' || data === '\n' || data === '\r\n') {
        // 密码输入不记入命令历史
        if (!awaitingPassword) {
          const cmd = pendingCmdRef.current.trim();
          if (cmd.length > 1 && !/^\d+$/.test(cmd)) {
            window.dispatchEvent(new CustomEvent('ssh-command-history', {
              detail: { sessionId: serverIdRef.current, command: cmd, time: new Date().toISOString(), source: 'input' }
            }));
          }
        }
        awaitingPassword = false;
        pendingCmdRef.current = '';
      } else if (data === '\x7F' || data === '\b') {
        pendingCmdRef.current = pendingCmdRef.current.slice(0, -1);
      } else if (!/[\x00-\x1F\x7F]/.test(data)) {
        pendingCmdRef.current += data;
      } else {
        pendingCmdRef.current = '';
      }

      // Local Echo 逻辑 (恢复默认开启)
      if (localEchoRef.current) {
        // 如果输入中不包含控制字符（如方向键、Esc、退格等），则视作常规可见输入（支持多字符连击或粘贴）
        if (!/[\x00-\x1F\x7F]/.test(data)) {
          // 由于 JavaScript 中部分多字节字符的 length 表现，这里按照字符串常规长度累加是安全的，
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

    term.onResize(({ cols, rows }) => {
      AppGo.ResizeTerminal(sessionId, cols, rows);
    });

    return () => {
      cancelled = true;
      clearTimeout(fitTimer);
      if (ws) { try { ws.close(); } catch (_) {} }
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
      }
    };
    window.addEventListener('terminal-font-size-changed', handleFontSizeChange);
    return () => window.removeEventListener('terminal-font-size-changed', handleFontSizeChange);
  }, []);

  // ── 状态变化提示 ────────────────────────────────────────────────
  useEffect(() => {
    if (!termRef.current) return;
    if (status === 'error') {
      termRef.current.write('\r\n\x1b[31m✗  Connection failed\x1b[0m\r\n');
    } else if (status === 'closed') {
      termRef.current.write('\r\n\x1b[33m●  Disconnected\x1b[0m\r\n');
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

  // ── 背景管理与刷新 ────────────────────────────────────────────────
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
  useEffect(() => {
    const handleThemeChange = () => {
      if (termRef.current) {
        termRef.current.options.theme = getXtermTheme();
      }
    };
    window.addEventListener('terminal-theme-changed', handleThemeChange);
    return () => window.removeEventListener('terminal-theme-changed', handleThemeChange);
  }, []);

  // 监听快捷键 & 本地回显变更，同步更新 ref 缓存（保持设置即时生效）
  useEffect(() => {
    const handleShortcutsChange = (e) => {
      shortcutsRef.current = e.detail;
    };
    const handleLocalEchoChange = (e) => {
      localEchoRef.current = e.detail !== false;
    };
    window.addEventListener('app-shortcuts-changed', handleShortcutsChange);
    window.addEventListener('terminal-local-echo-changed', handleLocalEchoChange);
    return () => {
      window.removeEventListener('app-shortcuts-changed', handleShortcutsChange);
      window.removeEventListener('terminal-local-echo-changed', handleLocalEchoChange);
    };
  }, []);

  const handleContextMenu = (e) => {
    e.preventDefault();
    const hasSelection = !!(termRef.current && termRef.current.getSelection());
    setContextHasSelection(hasSelection);
    // 边界检测：防止菜单溢出屏幕
    const menuW = 190;
    const menuH = 140;
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX;
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;
    setContextMenu({ x, y });
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
            wsRef.current.send(new TextEncoder().encode(text));
          }
          termRef.current.focus();
        }).catch(err => {
          console.error('Failed to read clipboard:', err);
          termRef.current.focus();
        });
        break;
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

  // 连接成功时触发一次性涟漪动画
  useEffect(() => {
    if (isConnected) {
      setJustConnected(true);
      const t = setTimeout(() => setJustConnected(false), 1400);
      return () => clearTimeout(t);
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
    (async () => {
      try {
        const raw = historyMode === 'global'
          ? await AppGo.GetGlobalCommandHistory()
          : await AppGo.GetCommandHistory(historyServerId);
        const entries = JSON.parse(raw);
        const arr = Array.isArray(entries) ? entries : [];
        setHistoryList(arr);
        // 数据为空则无需滚动，直接清空标记
        if (arr.length === 0) scrollOnNextUpdate.current = false;
      } catch {
        setHistoryList([]);
        scrollOnNextUpdate.current = false;
      }
    })();
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
          left: Math.min(rect.right - 480, window.innerWidth - 490),
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
          left: Math.min(rect.right - 680, window.innerWidth - 690),
          bottom: window.innerHeight - rect.top + 4,
        });
      }
      if (showHistory) { setShowHistory(false); setHistoryPopupPos(null); }
      setShowCommands(true);
    } else {
      // 关闭面板时检查是否有未保存的修改
      if (quickCmdsRef.current?.isDirty?.()) {
        quickCmdsRef.current.showCloseConfirm();
        return; // 由 onClose 回调来关闭
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
    if (!isConnected) return;
    const text = (cmd ?? '').trim();
    AppGo.WriteTerminal(sessionId, text + '\r').catch((err) => {
      console.error('WriteTerminal failed:', err);
    });
    termRef.current?.scrollToBottom();
    if (text && text.length > 1 && !/^\d+$/.test(text)) {
      window.dispatchEvent(new CustomEvent('ssh-command-history', {
        detail: { sessionId: serverId, command: text, time: new Date().toISOString(), source: 'input' }
      }));
    }
    setCmdInput('');
    setShowHistory(false);
    setHistoryPopupPos(null);
  };

  const copyCommand = () => {
    if (!cmdInput.trim()) return;
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

  // 命令栏按钮样式辅助函数
  const btnStyle = (color) => ({
    border: 'none',
    background: 'transparent',
    color: color === 'red' ? '#ff7b72' : '#8b949e',
    cursor: 'pointer',
    borderRadius: 3,
    padding: '2px 6px',
  });
  const iconBtnStyle = (color, bg) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22,
    background: bg,
    border: '1px solid transparent',
    borderRadius: 3,
    color,
    cursor: 'pointer',
    transition: 'all 0.1s',
  });

  return (
    <div 
      onContextMenu={handleContextMenu}
      onClick={closeContextMenu}
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1117', // Fallback color
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
        zIndex: 0
      }} />
      
      {/* 内容层(置于背景之上) */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Session 状态栏（极简、高颜值设计） ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'rgba(22, 27, 34, 0.75)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 12,
        color: '#8b949e',
        userSelect: 'none',
        flexShrink: 0,
      }}>
        {/* 状态指示灯 - 使用全局 CSS 类，连接成功时触发涟漪动画 */}
        <div className={[
          'status-dot',
          isConnected  ? (justConnected ? 'just-connected' : 'online') : '',
          isConnecting ? 'connecting' : '',
          isError      ? 'offline' : '',
          !isConnected && !isConnecting && !isError ? 'offline' : '',
        ].filter(Boolean).join(' ')} style={{ flexShrink: 0 }} />
        <span style={{ color: '#cdd9e5', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
          {serverName || 'Terminal'}
        </span>
        
        {/* 右侧极简状态显示 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, opacity: 0.5, fontFamily: 'var(--font-mono)' }}>
            {isConnected  ? 'Connected'
             : isConnecting ? 'Connecting...'
             : isError      ? 'Error'
             : 'Offline'}
          </span>
          {(isError || status === 'closed') && (
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('ssh-reconnect-trigger', { detail: sessionId }));
              }}
              style={{
                padding: '2px 8px',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '4px',
                color: '#22c55e',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(34, 197, 94, 0.25)';
                e.target.style.borderColor = 'rgba(34, 197, 94, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(34, 197, 94, 0.15)';
                e.target.style.borderColor = 'rgba(34, 197, 94, 0.3)';
              }}
            >
              {t('重新连接')}
            </button>
          )}
        </div>
      </div>

      {/* ── xterm 渲染区 ── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          padding: '8px 4px 6px 12px',
          background: 'transparent',
        }}
      />

      {/* ── 底部命令输入栏 ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: 'rgba(22, 27, 34, 0.85)',
        backdropFilter: 'blur(8px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
        position: 'relative',
      }}>
        {/* 命令输入框 */}
        <input
          ref={cmdInputRef}
          className="input"
          value={cmdInput}
          onChange={e => setCmdInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') executeCommand();
            if (e.key === 'Escape') setShowHistory(false);
          }}
          placeholder={t('输入命令')}
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            padding: '7px 10px',
            minHeight: 32,
            background: 'rgba(13,17,23,0.8)',
            borderColor: cmdInput ? 'rgba(34,197,94,0.3)' : 'rgba(48,54,61,0.5)',
          }}
        />

        {/* 历史按钮 */}
        <button
          ref={historyBtnRef}
          onClick={toggleHistory}
          title={t('历史指令')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '6px 10px',
            fontSize: 11,
            color: showHistory ? '#22c55e' : '#8b949e',
            background: showHistory ? 'rgba(34,197,94,0.1)' : 'transparent',
            border: `1px solid ${showHistory ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
        >
          <Clock size={13} />
          <span>{t('历史')}</span>
        </button>

        {/* 快捷命令按钮 */}
        <button
          ref={commandsBtnRef}
          onClick={toggleCommands}
          title={t('快捷命令')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '6px 10px',
            fontSize: 11,
            color: showCommands ? '#22c55e' : '#8b949e',
            background: showCommands ? 'rgba(34,197,94,0.1)' : 'transparent',
            border: `1px solid ${showCommands ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
        >
          <span>⚡</span>
          <span>{t('命令')}</span>
        </button>

        {/* 执行按钮（绿色） */}
        <button
          onClick={executeCommand}
          disabled={!cmdInput.trim() || !isConnected}
          title={t('执行')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30,
            background: (cmdInput.trim() && isConnected) ? 'rgba(34,197,94,0.15)' : 'transparent',
            border: `1px solid ${(cmdInput.trim() && isConnected) ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 4,
            color: (cmdInput.trim() && isConnected) ? '#22c55e' : '#484f58',
            cursor: (cmdInput.trim() && isConnected) ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          <Play size={13} />
        </button>

        {/* 复制按钮（蓝色） */}
        <button
          onClick={copyCommand}
          disabled={!cmdInput.trim()}
          title={t('复制')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30,
            background: cmdInput.trim() ? 'rgba(88,166,255,0.15)' : 'transparent',
            border: `1px solid ${cmdInput.trim() ? 'rgba(88,166,255,0.35)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 4,
            color: cmdInput.trim() ? '#58a6ff' : '#484f58',
            cursor: cmdInput.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          <Clipboard size={13} />
        </button>
      </div>
      </div>

      {/* ── 历史指令弹窗（fixed 定位，不受 overflow:hidden 裁剪） ── */}
      {showHistory && historyPopupPos && (
        <>
          {/* 透明遮罩层，点击关闭 */}
          <div
            onClick={() => { setShowHistory(false); setHistoryPopupPos(null); }}
            style={{
              position: 'fixed', inset: 0, zIndex: 99,
              background: 'transparent',
            }}
          />
          <div style={{
            position: 'fixed',
            left: historyPopupPos.left,
            bottom: historyPopupPos.bottom,
            width: 480,
            maxHeight: 280,
            display: 'flex', flexDirection: 'column',
            background: '#161b22',
            border: '1px solid rgba(48,54,61,0.9)',
            borderRadius: 8,
            boxShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 100,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
          }}>
            {/* 弹窗头部（标题 + 操作按钮） */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <span style={{ color: '#8b949e', fontSize: 11 }}>{t('历史命令')}</span>
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
                  style={btnStyle('red')}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* 历史列表（可滚动） */}
            <div ref={historyScrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {filteredHistory.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#6e7681', fontSize: 12 }}>
                {searchQuery ? t('无匹配结果') : t('暂无历史记录')}
              </div>
            ) : displayHistory.map(item => (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,197,94,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span
                  onClick={() => selectHistoryCmd(item.command)}
                  style={{
                    flex: 1,
                    color: '#cdd9e5',
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
                  <button
                    onClick={() => executeCommand(item.command)}
                    title={t('执行')}
                    style={{ ...iconBtnStyle('#22c55e', 'rgba(34,197,94,0.15)') }}
                  >
                    <Play size={12} />
                  </button>
                  {/* 复制（蓝色） */}
                  <button
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(item.command).catch(() => {}); }}
                    title={t('复制')}
                    style={{ ...iconBtnStyle('#58a6ff', 'rgba(88,166,255,0.15)') }}>
                    <Clipboard size={12} />
                  </button>
                  {/* 删除（红色） */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                    title={t('删除')}
                    style={{ ...iconBtnStyle('#ff7b72', 'rgba(255,123,114,0.15)') }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
            </div>

            {/* 搜索 + 模式切换 */}
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center',
              padding: '6px 10px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('搜索命令...')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: '#0d1117',
                  border: '1px solid rgba(48,54,61,0.8)',
                  borderRadius: 4,
                  color: '#cdd9e5',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <button
                onClick={() => setHistoryMode('server')}
                style={{
                  border: '1px solid ' + (historyMode === 'global' ? 'rgba(48,54,61,0.8)' : 'rgba(88,166,255,0.3)'),
                  borderRadius: 4,
                  padding: '3px 8px',
                  background: historyMode === 'server' ? 'rgba(88,166,255,0.15)' : 'transparent',
                  color: historyMode === 'server' ? '#58a6ff' : '#6e7681',
                  cursor: 'pointer', fontSize: 10,
                  whiteSpace: 'nowrap',
                }}
              >
                {t('当前服务器')}
              </button>
              <button
                onClick={() => setHistoryMode('global')}
                style={{
                  border: '1px solid ' + (historyMode === 'server' ? 'rgba(48,54,61,0.8)' : 'rgba(88,166,255,0.3)'),
                  borderRadius: 4,
                  padding: '3px 8px',
                  background: historyMode === 'global' ? 'rgba(88,166,255,0.15)' : 'transparent',
                  color: historyMode === 'global' ? '#58a6ff' : '#6e7681',
                  cursor: 'pointer', fontSize: 10,
                  whiteSpace: 'nowrap',
                }}
              >
                {t('全部服务器')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 快捷命令弹窗（fixed 定位，不受 overflow:hidden 裁剪） ── */}
      {showCommands && commandsPopupPos && (
        <>
          {/* 透明遮罩层，点击关闭（有未保存修改时弹出确认） */}
          <div
            onClick={() => {
              if (quickCmdsRef.current?.isDirty?.()) {
                quickCmdsRef.current.showCloseConfirm();
              } else {
                setShowCommands(false);
                setCommandsPopupPos(null);
              }
            }}
            style={{
              position: 'fixed', inset: 0, zIndex: 99,
              background: 'transparent',
            }}
          />
          <div style={{
            position: 'fixed',
            left: commandsPopupPos.left,
            bottom: commandsPopupPos.bottom,
            width: 680,
            height: 420,
            background: '#161b22',
            border: '1px solid rgba(48,54,61,0.9)',
            borderRadius: 8,
            boxShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 100,
            overflow: 'hidden',
          }}>
            <QuickCommands ref={quickCmdsRef} sessionId={sessionId} addToast={() => {}} connectedSessions={connectedSessions} onClose={() => { setShowCommands(false); setCommandsPopupPos(null); }} />
          </div>
        </>
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
            backgroundColor: '#161b22',
            border: '1px solid rgba(48,54,61,0.9)',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
            zIndex: 9999,
            padding: '4px 0',
            minWidth: '190px',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {[
            { icon: <Copy size={13} />, label: t('复制'), action: 'copy', shortcut: 'Ctrl+C', disabled: !contextHasSelection },
            { icon: <Clipboard size={13} />, label: t('粘贴'), action: 'paste', shortcut: 'Ctrl+V' },
            { type: 'separator' },
            { icon: <CheckSquare size={13} />, label: t('全选'), action: 'selectAll' },
            { icon: <Trash2 size={13} />, label: t('清空屏幕'), action: 'clear', shortcut: 'Ctrl+L' },
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
