// ── 终端主题定义（深色/浅色两套配色） ──────────────────────────────────────────────
// 四个主题：Lumin Default / Tokyo Night / Catppuccin / Dracula
// 每个主题含 dark 和 light 两套变体，自动跟随 App 浅色/深色模式切换

const TERMINAL_THEMES = {
  'lumin': {
    name: 'Lumin Default',
    swatches: ['#22c55e', '#58a6ff', '#bc8cff', '#0d1117'],
    dark: {
      xterm: {
        background: '#00000000', foreground: '#cdd9e5', cursor: '#4d9eff',
        cursorAccent: '#0e1218', selectionBackground: 'rgba(77,158,255,0.35)',
        selectionForeground: '#ffffff',
        black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#e6aa32',
        blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
        brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
      },
      container: {
        containerBg: '#0e1218', statusBarBg: 'rgba(19,25,34,0.80)', statusBarBorder: '1px solid rgba(77,158,255,0.08)',
        statusBarColor: '#818fa0', serverNameColor: '#eaf0f7',
        inputBarBg: 'rgba(19,25,34,0.88)', inputBarBorder: '1px solid rgba(77,158,255,0.08)',
        inputBg: 'rgba(14,18,24,0.8)', inputColor: '#eaf0f7', inputPlaceholder: '#5a6578',
        popupBg: '#131922', popupBorder: '1px solid rgba(56,68,90,0.8)',
        popupShadow: '0 -8px 32px rgba(0,5,20,0.5), 0 2px 8px rgba(0,5,20,0.3)',
        contextBg: '#131922', contextBorder: '1px solid rgba(56,68,90,0.8)',
        contextShadow: '0 8px 32px rgba(0,5,20,0.6), 0 2px 8px rgba(0,5,20,0.4)',
        separator: 'rgba(77,158,255,0.08)', mutedColor: '#5a6578',
        btnBorder: 'rgba(77,158,255,0.1)', btnMuted: '#5a6578',
      },
    },
    light: {
      xterm: {
        background: '#00000000', foreground: '#1c1917', cursor: '#2563eb',
        cursorAccent: '#fefdfb', selectionBackground: 'rgba(37,99,235,0.25)',
        selectionForeground: '#ffffff',
        black: '#292524', red: '#dc2626', green: '#16a34a', yellow: '#b45309',
        blue: '#2563eb', magenta: '#7c3aed', cyan: '#0e7490', white: '#78716c',
        brightBlack: '#57534e', brightRed: '#ef4444', brightGreen: '#22c55e',
        brightYellow: '#eab308', brightBlue: '#3b82f6', brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee', brightWhite: '#a8a29e',
      },
      container: {
        containerBg: '#fefdfb', statusBarBg: 'rgba(244,241,238,0.92)', statusBarBorder: '1px solid rgba(60,50,40,0.1)',
        statusBarColor: '#78716c', serverNameColor: '#1c1917',
        inputBarBg: 'rgba(244,241,238,0.92)', inputBarBorder: '1px solid rgba(60,50,40,0.1)',
        inputBg: 'rgba(244,241,238,0.9)', inputColor: '#1c1917', inputPlaceholder: '#a8a29e',
        popupBg: '#fefdfb', popupBorder: '1px solid rgba(60,50,40,0.12)',
        popupShadow: '0 -8px 32px rgba(28,25,23,0.1), 0 2px 8px rgba(28,25,23,0.06)',
        contextBg: '#fefdfb', contextBorder: '1px solid rgba(60,50,40,0.12)',
        contextShadow: '0 8px 32px rgba(28,25,23,0.12), 0 2px 8px rgba(28,25,23,0.06)',
        separator: 'rgba(60,50,40,0.1)', mutedColor: '#a8a29e',
        btnBorder: 'rgba(60,50,40,0.12)', btnMuted: '#a8a29e',
      },
    },
  },
  'tokyo-night': {
    name: 'Tokyo Night',
    swatches: ['#7aa2f7', '#bb9af7', '#73daca', '#1a1b26'],
    dark: {
      xterm: {
        background: '#00000000', foreground: '#a9b1d6', cursor: '#7aa2f7',
        cursorAccent: '#1a1b26', selectionBackground: 'rgba(122,162,247,0.40)',
        selectionForeground: '#ffffff',
        black: '#32344a', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
        blue: '#7aa2f7', magenta: '#ad8ee6', cyan: '#449dab', white: '#787c99',
        brightBlack: '#444b6a', brightRed: '#ff7a93', brightGreen: '#b9f27c',
        brightYellow: '#ff9e64', brightBlue: '#7da6ff', brightMagenta: '#bb9af7',
        brightCyan: '#0db9d7', brightWhite: '#acb0d0',
      },
      container: {
        containerBg: '#1a1b26', statusBarBg: 'rgba(26,27,38,0.85)', statusBarBorder: '1px solid rgba(255,255,255,0.06)',
        statusBarColor: '#787c99', serverNameColor: '#a9b1d6',
        inputBarBg: 'rgba(26,27,38,0.9)', inputBarBorder: '1px solid rgba(255,255,255,0.06)',
        inputBg: 'rgba(26,27,38,0.8)', inputColor: '#a9b1d6', inputPlaceholder: '#565f89',
        popupBg: '#1a1b26', popupBorder: '1px solid rgba(255,255,255,0.08)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        contextBg: '#1a1b26', contextBorder: '1px solid rgba(255,255,255,0.08)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        separator: 'rgba(255,255,255,0.06)', mutedColor: '#565f89',
        btnBorder: 'rgba(255,255,255,0.08)', btnMuted: '#565f89',
      },
    },
    light: {
      xterm: {
        background: '#00000000', foreground: '#1f2335', cursor: '#1f6feb',
        cursorAccent: '#e1e2e7', selectionBackground: 'rgba(31,111,235,0.30)',
        selectionForeground: '#e1e2e7',
        black: '#1f2335', red: '#7f1d1d', green: '#365314', yellow: '#854d0e',
        blue: '#1d4ed8', magenta: '#6d28d9', cyan: '#155e75', white: '#5b6388',
        brightBlack: '#3b405c', brightRed: '#991b1b', brightGreen: '#3f6212',
        brightYellow: '#a16207', brightBlue: '#2563eb', brightMagenta: '#7c3aed',
        brightCyan: '#0e7490', brightWhite: '#848cb5',
      },
      container: {
        containerBg: '#e1e2e7', statusBarBg: 'rgba(225,226,231,0.92)', statusBarBorder: '1px solid rgba(0,0,0,0.08)',
        statusBarColor: '#848cb5', serverNameColor: '#343b58',
        inputBarBg: 'rgba(225,226,231,0.92)', inputBarBorder: '1px solid rgba(0,0,0,0.08)',
        inputBg: 'rgba(225,226,231,0.9)', inputColor: '#343b58', inputPlaceholder: '#848cb5',
        popupBg: '#e1e2e7', popupBorder: '1px solid rgba(0,0,0,0.12)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
        contextBg: '#e1e2e7', contextBorder: '1px solid rgba(0,0,0,0.12)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        separator: 'rgba(0,0,0,0.08)', mutedColor: '#848cb5',
        btnBorder: 'rgba(0,0,0,0.12)', btnMuted: '#848cb5',
      },
    },
  },
  'catppuccin': {
    name: 'Catppuccin',
    swatches: ['#cba6f7', '#89b4fa', '#a6e3a1', '#1e1e2e'],
    dark: {
      xterm: {
        background: '#00000000', foreground: '#cdd6f4', cursor: '#f5c2e7',
        cursorAccent: '#1e1e2e', selectionBackground: 'rgba(203,166,247,0.40)',
        selectionForeground: '#ffffff',
        black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
        blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
        brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5', brightWhite: '#a6adc8',
      },
      container: {
        containerBg: '#1e1e2e', statusBarBg: 'rgba(30,30,46,0.85)', statusBarBorder: '1px solid rgba(255,255,255,0.06)',
        statusBarColor: '#bac2de', serverNameColor: '#cdd6f4',
        inputBarBg: 'rgba(30,30,46,0.9)', inputBarBorder: '1px solid rgba(255,255,255,0.06)',
        inputBg: 'rgba(30,30,46,0.8)', inputColor: '#cdd6f4', inputPlaceholder: '#585b70',
        popupBg: '#1e1e2e', popupBorder: '1px solid rgba(255,255,255,0.08)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        contextBg: '#1e1e2e', contextBorder: '1px solid rgba(255,255,255,0.08)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        separator: 'rgba(255,255,255,0.06)', mutedColor: '#585b70',
        btnBorder: 'rgba(255,255,255,0.08)', btnMuted: '#585b70',
      },
    },
    light: {
      xterm: {
        background: '#00000000', foreground: '#4c4f69', cursor: '#dc8a78',
        cursorAccent: '#eff1f5', selectionBackground: 'rgba(137,180,250,0.35)',
        selectionForeground: '#eff1f5',
        black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
        blue: '#1e66f5', magenta: '#8839ef', cyan: '#179299', white: '#acb0be',
        brightBlack: '#6c6f85', brightRed: '#e64553', brightGreen: '#40a02b',
        brightYellow: '#df8e1d', brightBlue: '#1e66f5', brightMagenta: '#8839ef',
        brightCyan: '#179299', brightWhite: '#bcc0cc',
      },
      container: {
        containerBg: '#eff1f5', statusBarBg: 'rgba(239,241,245,0.92)', statusBarBorder: '1px solid rgba(0,0,0,0.08)',
        statusBarColor: '#acb0be', serverNameColor: '#4c4f69',
        inputBarBg: 'rgba(239,241,245,0.92)', inputBarBorder: '1px solid rgba(0,0,0,0.08)',
        inputBg: 'rgba(239,241,245,0.9)', inputColor: '#4c4f69', inputPlaceholder: '#acb0be',
        popupBg: '#eff1f5', popupBorder: '1px solid rgba(0,0,0,0.12)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
        contextBg: '#eff1f5', contextBorder: '1px solid rgba(0,0,0,0.12)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        separator: 'rgba(0,0,0,0.08)', mutedColor: '#acb0be',
        btnBorder: 'rgba(0,0,0,0.12)', btnMuted: '#acb0be',
      },
    },
  },
  'dracula': {
    name: 'Dracula',
    swatches: ['#ff79c6', '#bd93f9', '#50fa7b', '#282a36'],
    dark: {
      xterm: {
        background: '#00000000', foreground: '#f8f8f2', cursor: '#f8f8f2',
        cursorAccent: '#282a36', selectionBackground: 'rgba(189,147,249,0.40)',
        selectionForeground: '#ffffff',
        black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
        blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
        brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
        brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
        brightCyan: '#a4ffff', brightWhite: '#ffffff',
      },
      container: {
        containerBg: '#282a36', statusBarBg: 'rgba(40,42,54,0.85)', statusBarBorder: '1px solid rgba(255,255,255,0.06)',
        statusBarColor: '#6272a4', serverNameColor: '#f8f8f2',
        inputBarBg: 'rgba(40,42,54,0.9)', inputBarBorder: '1px solid rgba(255,255,255,0.06)',
        inputBg: 'rgba(40,42,54,0.8)', inputColor: '#f8f8f2', inputPlaceholder: '#6272a4',
        popupBg: '#282a36', popupBorder: '1px solid rgba(255,255,255,0.08)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        contextBg: '#282a36', contextBorder: '1px solid rgba(255,255,255,0.08)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        separator: 'rgba(255,255,255,0.06)', mutedColor: '#6272a4',
        btnBorder: 'rgba(255,255,255,0.08)', btnMuted: '#6272a4',
      },
    },
    light: {
      xterm: {
        background: '#00000000', foreground: '#1f2937', cursor: '#1f2937',
        cursorAccent: '#f8f8f2', selectionBackground: 'rgba(124,58,237,0.30)',
        selectionForeground: '#f8f8f2',
        black: '#1f2937', red: '#dc2626', green: '#15803d', yellow: '#a16207',
        blue: '#6d28d9', magenta: '#be185d', cyan: '#0e7490', white: '#4b5563',
        brightBlack: '#374151', brightRed: '#ef4444', brightGreen: '#16a34a',
        brightYellow: '#ca8a04', brightBlue: '#7c3aed', brightMagenta: '#db2777',
        brightCyan: '#0891b2', brightWhite: '#6b7280',
      },
      container: {
        containerBg: '#f8f8f2', statusBarBg: 'rgba(248,248,242,0.92)', statusBarBorder: '1px solid rgba(0,0,0,0.08)',
        statusBarColor: '#6272a4', serverNameColor: '#282a36',
        inputBarBg: 'rgba(248,248,242,0.92)', inputBarBorder: '1px solid rgba(0,0,0,0.08)',
        inputBg: 'rgba(248,248,242,0.9)', inputColor: '#282a36', inputPlaceholder: '#6272a4',
        popupBg: '#f8f8f2', popupBorder: '1px solid rgba(0,0,0,0.12)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
        contextBg: '#f8f8f2', contextBorder: '1px solid rgba(0,0,0,0.12)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        separator: 'rgba(0,0,0,0.08)', mutedColor: '#6272a4',
        btnBorder: 'rgba(0,0,0,0.12)', btnMuted: '#6272a4',
      },
    },
  },
};

// 检测 App 浅色/深色模式
export function getAppThemeMode() {
  if (typeof window !== 'undefined' && window.__luminForceDarkTheme === true) {
    return 'dark';
  }
  const mode = localStorage.getItem('themeMode') || 'dark';
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode;
}

export function getTerminalTheme() {
  const key = localStorage.getItem('terminalColorTheme') || 'lumin';
  const theme = TERMINAL_THEMES[key] || TERMINAL_THEMES['lumin'];
  const mode = getAppThemeMode() === 'light' ? 'light' : 'dark';
  return theme[mode] || theme.dark;
}

// ponytail: hex 颜色转 "r, g, b" 字符串，供 CSS rgba() 使用
export function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}