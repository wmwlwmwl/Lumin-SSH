import * as AppGo from '../../wailsjs/go/main/App.js';

const THEME_PACKAGE_SCHEMA_VERSION = 1;
const DEFAULT_LIGHT_THEME_PACKAGE_ID = 'lumin-light';
const DEFAULT_DARK_THEME_PACKAGE_ID = 'lumin-dark';

const LEGACY_THEME_PACKAGE_MAP = {
  lumin: { light: 'lumin-light', dark: 'lumin-dark' },
  'tokyo-night': { light: 'tokyo-night-light', dark: 'tokyo-night-dark' },
  catppuccin: { light: 'catppuccin-light', dark: 'catppuccin-dark' },
  dracula: { light: 'dracula-light', dark: 'dracula-dark' },
};

const TERMINAL_THEME_FAMILIES = {
  lumin: {
    dark: {
      name: '天青',
      description: '默认蓝调深色',
      accent: '#4d9eff',
      xterm: {
        background: '#00000000', foreground: '#e6edf3', cursor: '#4d9eff',
        cursorAccent: '#0e1218', selectionBackground: '#2563eb',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: '#2563eb',
        black: '#484f58', red: '#ff6b6b', green: '#3dd68c', yellow: '#ffcc33',
        blue: '#6cb6ff', magenta: '#d2a8ff', cyan: '#39d0d6', white: '#d0d7de',
        brightBlack: '#8b949e', brightRed: '#ff8a80', brightGreen: '#56f09c',
        brightYellow: '#ffe066', brightBlue: '#91cbff', brightMagenta: '#e2b6ff',
        brightCyan: '#5ce1e6', brightWhite: '#ffffff',
      },
      container: {
        containerBg: '#0b111a',
        tint: 'rgba(77, 158, 255, 0.10)',
        statusBarBg: 'rgba(12, 28, 48, 0.96)', statusBarBorder: '1px solid rgba(77,158,255,0.42)',
        statusBarColor: '#4d9eff', serverNameColor: '#eaf0f7',
        inputBarBg: 'rgba(12, 28, 48, 0.98)', inputBarBorder: '1px solid rgba(77,158,255,0.36)',
        inputBg: 'rgba(8, 18, 32, 0.94)', inputColor: '#eaf0f7', inputPlaceholder: '#5a6578',
        popupBg: '#121a26', popupBorder: '1px solid rgba(77,158,255,0.28)',
        popupShadow: '0 -8px 32px rgba(0,5,20,0.5), 0 2px 8px rgba(0,5,20,0.3)',
        contextBg: '#121a26', contextBorder: '1px solid rgba(77,158,255,0.28)',
        contextShadow: '0 8px 32px rgba(0,5,20,0.6), 0 2px 8px rgba(0,5,20,0.4)',
        separator: 'rgba(77,158,255,0.22)', mutedColor: '#5a6578',
        btnBorder: 'rgba(77,158,255,0.28)', btnMuted: '#5a6578',
      },
    },
    light: {
      name: '天青',
      description: '默认蓝调浅色',
      accent: '#2563eb',
      xterm: {
        background: '#00000000', foreground: '#0f172a', cursor: '#2563eb',
        cursorAccent: '#ffffff', selectionBackground: '#2563eb',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: '#2563eb',
        black: '#0a0f1a', red: '#b91c1c', green: '#15803d', yellow: '#854d0e',
        blue: '#1d4ed8', magenta: '#7e22ce', cyan: '#0f766e', white: '#e2e8f0',
        brightBlack: '#475569', brightRed: '#dc2626', brightGreen: '#16a34a',
        brightYellow: '#a16207', brightBlue: '#2563eb', brightMagenta: '#9333ea',
        brightCyan: '#0891b2', brightWhite: '#f8fafc',
      },
      container: {
        containerBg: '#f7f9fc', tint: 'rgba(37, 99, 235, 0.10)',
        statusBarBg: 'rgba(232, 240, 254, 0.98)', statusBarBorder: '1px solid rgba(37,99,235,0.38)',
        statusBarColor: '#1d4ed8', serverNameColor: '#0f172a',
        inputBarBg: 'rgba(232, 240, 254, 0.98)', inputBarBorder: '1px solid rgba(37,99,235,0.30)',
        inputBg: 'rgba(255,255,255,0.95)', inputColor: '#0f172a', inputPlaceholder: '#64748b',
        popupBg: '#ffffff', popupBorder: '1px solid rgba(37,99,235,0.22)',
        popupShadow: '0 -8px 32px rgba(28,25,23,0.1), 0 2px 8px rgba(28,25,23,0.06)',
        contextBg: '#ffffff', contextBorder: '1px solid rgba(37,99,235,0.22)',
        contextShadow: '0 8px 32px rgba(28,25,23,0.12), 0 2px 8px rgba(28,25,23,0.06)',
        separator: 'rgba(37,99,235,0.16)', mutedColor: '#64748b',
        btnBorder: 'rgba(37,99,235,0.24)', btnMuted: '#64748b',
      },
    },
  },
  'tokyo-night': {
    dark: {
      name: '夜空',
      description: '靛蓝夜色',
      accent: '#7aa2f7',
      xterm: {
        background: '#00000000', foreground: '#c0caf5', cursor: '#7aa2f7',
        cursorAccent: '#1a1b26', selectionBackground: '#3d59a1',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: '#3d59a1',
        black: '#32344a', red: '#ff7a93', green: '#9ece6a', yellow: '#e0af68',
        blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
        brightBlack: '#565f89', brightRed: '#ff9db0', brightGreen: '#b9f27c',
        brightYellow: '#ffc777', brightBlue: '#89b4fa', brightMagenta: '#cbb2ff',
        brightCyan: '#89ddff', brightWhite: '#ffffff',
      },
      container: {
        containerBg: '#161821',
        tint: 'rgba(122, 162, 247, 0.12)',
        statusBarBg: 'rgba(28, 32, 58, 0.97)', statusBarBorder: '1px solid rgba(122,162,247,0.48)',
        statusBarColor: '#7aa2f7', serverNameColor: '#c0caf5',
        inputBarBg: 'rgba(28, 32, 58, 0.98)', inputBarBorder: '1px solid rgba(122,162,247,0.40)',
        inputBg: 'rgba(18, 22, 40, 0.94)', inputColor: '#c0caf5', inputPlaceholder: '#565f89',
        popupBg: '#1a1b2e', popupBorder: '1px solid rgba(122,162,247,0.32)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        contextBg: '#1a1b2e', contextBorder: '1px solid rgba(122,162,247,0.32)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        separator: 'rgba(122,162,247,0.24)', mutedColor: '#565f89',
        btnBorder: 'rgba(122,162,247,0.30)', btnMuted: '#565f89',
      },
    },
    light: {
      name: '晨雾',
      description: '蓝灰浅色',
      accent: '#1d4ed8',
      xterm: {
        background: '#00000000', foreground: '#1f2335', cursor: '#1d4ed8',
        cursorAccent: '#ffffff', selectionBackground: '#1d4ed8',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: '#1d4ed8',
        black: '#0c0e18', red: '#b8344e', green: '#286214', yellow: '#724905',
        blue: '#1d57c4', magenta: '#7a30cb', cyan: '#005b76', white: '#d5d9e8',
        brightBlack: '#444b6a', brightRed: '#cf2d4c', brightGreen: '#387a21',
        brightYellow: '#8f5e15', brightBlue: '#245fcb', brightMagenta: '#8536f5',
        brightCyan: '#007197', brightWhite: '#f4f5f9',
      },
      container: {
        containerBg: '#e8ecf7', tint: 'rgba(61, 89, 161, 0.14)',
        statusBarBg: 'rgba(214, 222, 245, 0.98)', statusBarBorder: '1px solid rgba(61,89,161,0.42)',
        statusBarColor: '#1d4ed8', serverNameColor: '#1f2335',
        inputBarBg: 'rgba(214, 222, 245, 0.98)', inputBarBorder: '1px solid rgba(61,89,161,0.34)',
        inputBg: 'rgba(255,255,255,0.94)', inputColor: '#1f2335', inputPlaceholder: '#5b6388',
        popupBg: '#eef1f8', popupBorder: '1px solid rgba(61,89,161,0.28)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
        contextBg: '#eef1f8', contextBorder: '1px solid rgba(61,89,161,0.28)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        separator: 'rgba(61,89,161,0.18)', mutedColor: '#5b6388',
        btnBorder: 'rgba(61,89,161,0.28)', btnMuted: '#5b6388',
      },
    },
  },
  catppuccin: {
    dark: {
      name: '紫雾',
      description: '淡紫深色',
      accent: '#cba6f7',
      xterm: {
        background: '#00000000', foreground: '#cdd6f4', cursor: '#f5c2e7',
        cursorAccent: '#1e1e2e', selectionBackground: '#7c3aed',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: '#7c3aed',
        black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
        blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#cdd6f4',
        brightBlack: '#6c7086', brightRed: '#f38ba8', brightGreen: '#b4f0a7',
        brightYellow: '#ffe6a8', brightBlue: '#a6c8ff', brightMagenta: '#f5c2e7',
        brightCyan: '#a6f0e2', brightWhite: '#ffffff',
      },
      container: {
        containerBg: '#181825',
        tint: 'rgba(203, 166, 247, 0.12)',
        statusBarBg: 'rgba(36, 28, 52, 0.97)', statusBarBorder: '1px solid rgba(203,166,247,0.50)',
        statusBarColor: '#cba6f7', serverNameColor: '#cdd6f4',
        inputBarBg: 'rgba(36, 28, 52, 0.98)', inputBarBorder: '1px solid rgba(203,166,247,0.42)',
        inputBg: 'rgba(26, 22, 40, 0.94)', inputColor: '#cdd6f4', inputPlaceholder: '#6c7086',
        popupBg: '#1e1e2e', popupBorder: '1px solid rgba(203,166,247,0.34)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        contextBg: '#1e1e2e', contextBorder: '1px solid rgba(203,166,247,0.34)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        separator: 'rgba(203,166,247,0.24)', mutedColor: '#6c7086',
        btnBorder: 'rgba(203,166,247,0.30)', btnMuted: '#6c7086',
      },
    },
    light: {
      name: '丁香',
      description: '淡紫浅色',
      accent: '#8839ef',
      xterm: {
        background: '#00000000', foreground: '#2c2f3a', cursor: '#d20f39',
        cursorAccent: '#ffffff', selectionBackground: '#1e66f5',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: '#1e66f5',
        black: '#11111b', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
        blue: '#1e66f5', magenta: '#8839ef', cyan: '#179299', white: '#dce0e8',
        brightBlack: '#6c6f85', brightRed: '#e64553', brightGreen: '#40a02b',
        brightYellow: '#df8e1d', brightBlue: '#04a5e5', brightMagenta: '#ea76cb',
        brightCyan: '#209fb5', brightWhite: '#eff1f5',
      },
      container: {
        containerBg: '#eff1f5', tint: 'rgba(136, 57, 239, 0.06)',
        statusBarBg: 'rgba(220, 214, 240, 0.98)', statusBarBorder: '1px solid rgba(136,57,239,0.45)',
        statusBarColor: '#8839ef', serverNameColor: '#2c2f3a',
        inputBarBg: 'rgba(220, 214, 240, 0.98)', inputBarBorder: '1px solid rgba(136,57,239,0.36)',
        inputBg: 'rgba(255,255,255,0.96)', inputColor: '#2c2f3a', inputPlaceholder: '#6c6f85',
        popupBg: '#eff1f5', popupBorder: '1px solid rgba(136,57,239,0.30)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
        contextBg: '#eff1f5', contextBorder: '1px solid rgba(136,57,239,0.30)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        separator: 'rgba(136,57,239,0.20)', mutedColor: '#6c6f85',
        btnBorder: 'rgba(136,57,239,0.30)', btnMuted: '#6c6f85',
      },
    },
  },
  dracula: {
    dark: {
      name: '粉紫',
      description: '粉紫深色',
      accent: '#ff79c6',
      xterm: {
        background: '#00000000', foreground: '#f8f8f2', cursor: '#f8f8f2',
        cursorAccent: '#282a36', selectionBackground: '#bd93f9',
        selectionForeground: '#1e1f29',
        selectionInactiveBackground: '#bd93f9',
        black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
        blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
        brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
        brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
        brightCyan: '#a4ffff', brightWhite: '#ffffff',
      },
      container: {
        containerBg: '#2b2d3a',
        tint: 'rgba(255, 121, 198, 0.10)',
        statusBarBg: 'rgba(52, 42, 66, 0.97)', statusBarBorder: '1px solid rgba(255,121,198,0.48)',
        statusBarColor: '#ff79c6', serverNameColor: '#f8f8f2',
        inputBarBg: 'rgba(52, 42, 66, 0.98)', inputBarBorder: '1px solid rgba(189,147,249,0.40)',
        inputBg: 'rgba(40, 34, 54, 0.94)', inputColor: '#f8f8f2', inputPlaceholder: '#6272a4',
        popupBg: '#2b2d3a', popupBorder: '1px solid rgba(189,147,249,0.34)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        contextBg: '#2b2d3a', contextBorder: '1px solid rgba(189,147,249,0.34)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        separator: 'rgba(255,121,198,0.22)', mutedColor: '#6272a4',
        btnBorder: 'rgba(255,121,198,0.30)', btnMuted: '#6272a4',
      },
    },
    light: {
      name: '玫粉',
      description: '粉紫浅色',
      accent: '#be185d',
      xterm: {
        background: '#00000000', foreground: '#1f1f2e', cursor: '#be185d',
        cursorAccent: '#ffffff', selectionBackground: '#7c3aed',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: '#7c3aed',
        black: '#0a0a0f', red: '#b91c1c', green: '#15803d', yellow: '#854d0e',
        blue: '#6d28d9', magenta: '#be185d', cyan: '#0e7490', white: '#9ca3af',
        brightBlack: '#4b5563', brightRed: '#dc2626', brightGreen: '#16a34a',
        brightYellow: '#a16207', brightBlue: '#5b21b6', brightMagenta: '#9d174d',
        brightCyan: '#007788', brightWhite: '#f3f4f6',
      },
      container: {
        containerBg: '#f4f4f5',
        tint: 'rgba(219, 39, 119, 0.03)',
        statusBarBg: 'rgba(253, 242, 248, 0.98)', statusBarBorder: '1px solid rgba(190,24,93,0.40)',
        statusBarColor: '#be185d', serverNameColor: '#1f1f2e',
        inputBarBg: 'rgba(253, 242, 248, 0.98)', inputBarBorder: '1px solid rgba(124,58,237,0.32)',
        inputBg: 'rgba(255,255,255,0.97)', inputColor: '#1f1f2e', inputPlaceholder: '#6b7280',
        popupBg: '#fafafa', popupBorder: '1px solid rgba(124,58,237,0.26)',
        popupShadow: '0 -8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
        contextBg: '#fafafa', contextBorder: '1px solid rgba(124,58,237,0.26)',
        contextShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        separator: 'rgba(190,24,93,0.16)', mutedColor: '#6b7280',
        btnBorder: 'rgba(190,24,93,0.26)', btnMuted: '#6b7280',
      },
    },
  },
};

function normalizeThemeModePreference(value) {
  if (value === 'light' || value === 'system') return value;
  return 'dark';
}

function normalizeModeHint(value) {
  return value === 'light' ? 'light' : 'dark';
}

function rgbTripletFromHexColor(hex, fallback = '37, 99, 235') {
  if (!/^#[\da-fA-F]{6}$/.test(String(hex || '').trim())) return fallback;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function rgbaFromHexColor(hex, alpha, fallback) {
  if (!/^#[\da-fA-F]{6}$/.test(String(hex || '').trim())) return fallback;
  return `rgba(${rgbTripletFromHexColor(hex, '0, 0, 0')}, ${alpha})`;
}

function buildBaseThemeTokens(modeHint, accent) {
  if (normalizeModeHint(modeHint) === 'light') {
    return {
      surfaceBase: '#f3f4f6',
      surfaceRaised: '#ffffff',
      surfaceOverlay: '#ffffff',
      surfaceSunken: '#e9ecef',
      surfaceHover: '#e2e6eb',
      surfaceActive: '#d6dbe2',
      border: 'rgba(28, 35, 45, 0.14)',
      borderLight: 'rgba(28, 35, 45, 0.08)',
      borderSubtle: 'rgba(28, 35, 45, 0.10)',
      borderFocus: accent,
      textPrimary: '#111827',
      textSecondary: '#334155',
      textTertiary: '#526176',
      textMuted: '#6b7a8f',
      probeLabel: '#1f2937',
      probeDetail: '#334155',
      probeFaint: '#526176',
      accent,
      accentRgb: rgbTripletFromHexColor(accent, '37, 99, 235'),
      accentHover: accent,
      accentDim: rgbaFromHexColor(accent, 0.08, 'rgba(37, 99, 235, 0.08)'),
      accentBorder: rgbaFromHexColor(accent, 0.22, 'rgba(37, 99, 235, 0.22)'),
      success: '#16a34a',
      successRgb: '22, 163, 74',
      successDim: 'rgba(22, 163, 74, 0.08)',
      danger: '#dc2626',
      dangerRgb: '220, 38, 38',
      dangerDim: 'rgba(220, 38, 38, 0.08)',
      warning: '#ca8a04',
      warningRgb: '202, 138, 4',
      warningDim: 'rgba(202, 138, 4, 0.08)',
      info: '#7c3aed',
      infoRgb: '124, 58, 237',
      infoDim: 'rgba(124, 58, 237, 0.08)',
      fileIconShell: '#15803d',
    };
  }
  return {
    surfaceBase: '#0f1319',
    surfaceRaised: '#141a23',
    surfaceOverlay: '#1a2130',
    surfaceSunken: '#1b2230',
    surfaceHover: '#243042',
    surfaceActive: '#2c384c',
    border: 'rgba(72, 86, 110, 0.55)',
    borderLight: 'rgba(72, 86, 110, 0.28)',
    borderSubtle: 'rgba(72, 86, 110, 0.32)',
    borderFocus: accent,
    textPrimary: '#eef3f9',
    textSecondary: '#c8d1dd',
    textTertiary: '#a0aabc',
    textMuted: '#7a8698',
    probeLabel: '#d8e0ea',
    probeDetail: '#b9c4d2',
    probeFaint: '#93a0b2',
    accent,
    accentRgb: rgbTripletFromHexColor(accent, '77, 158, 255'),
    accentHover: accent,
    accentDim: rgbaFromHexColor(accent, 0.12, 'rgba(77, 158, 255, 0.12)'),
    accentBorder: rgbaFromHexColor(accent, 0.28, 'rgba(77, 158, 255, 0.28)'),
    success: '#3fb950',
    successRgb: '63, 185, 80',
    successDim: 'rgba(63, 185, 80, 0.12)',
    danger: '#f87171',
    dangerRgb: '248, 113, 113',
    dangerDim: 'rgba(248, 113, 113, 0.12)',
    warning: '#d9a434',
    warningRgb: '217, 164, 52',
    warningDim: 'rgba(217, 164, 52, 0.12)',
    info: '#a78bfa',
    infoRgb: '167, 139, 250',
    infoDim: 'rgba(167, 139, 250, 0.12)',
    fileIconShell: '#89e051',
  };
}

function buildTabsComponent(modeHint) {
  if (normalizeModeHint(modeHint) === 'light') {
    return {
      inactiveBg: '#e4e8ee',
      inactiveBgHover: '#d8dee6',
      inactiveBorder: 'rgba(28, 35, 45, 0.16)',
      inactiveText: '#1f2937',
      activeBg: 'color-mix(in srgb, var(--accent) 14%, #ffffff)',
      activeBorder: 'color-mix(in srgb, var(--accent) 42%, var(--border))',
      activeText: '#0f172a',
      radius: '0',
    };
  }
  return {
    inactiveBg: 'var(--surface-active)',
    inactiveBgHover: 'color-mix(in srgb, var(--surface-active) 82%, var(--accent) 8%)',
    inactiveBorder: 'color-mix(in srgb, var(--border) 88%, #6b7a90)',
    inactiveText: 'var(--text-primary)',
    activeBg: 'color-mix(in srgb, var(--accent) 18%, var(--surface-raised))',
    activeBorder: 'color-mix(in srgb, var(--accent) 48%, var(--border))',
    activeText: 'var(--text-primary)',
    radius: '0',
  };
}

function buildDerivedComponentDefaults(modeHint, tokens = {}, terminalContainer = {}) {
  const isLight = normalizeModeHint(modeHint) === 'light';
  const fileManager = {
    panelBg: tokens.surfaceBase || (isLight ? '#f3f4f6' : '#0f1319'),
    toolbarBg: tokens.surfaceRaised || (isLight ? '#ffffff' : '#141a23'),
    borderColor: tokens.borderSubtle || (isLight ? 'rgba(28, 35, 45, 0.10)' : 'rgba(72, 86, 110, 0.32)'),
    rowHoverBg: isLight ? 'rgba(37, 99, 235, 0.08)' : 'rgba(77, 158, 255, 0.08)',
    selectedRowBg: isLight ? 'rgba(37, 99, 235, 0.16)' : 'rgba(77, 158, 255, 0.16)',
    textColor: tokens.textPrimary || (isLight ? '#111827' : '#eef3f9'),
    secondaryTextColor: tokens.textSecondary || (isLight ? '#334155' : '#c8d1dd'),
    mutedTextColor: tokens.textMuted || (isLight ? '#6b7a8f' : '#7a8698'),
    headerTextColor: tokens.textTertiary || (isLight ? '#526176' : '#a0aabc'),
    pathBg: tokens.surfaceSunken || (isLight ? '#e9ecef' : '#1b2230'),
    pathTextColor: tokens.textPrimary || (isLight ? '#111827' : '#eef3f9'),
    folderTextColor: tokens.accent || (isLight ? '#2563eb' : '#4d9eff'),
  };
  const topbar = {
    background: tokens.surfaceRaised || (isLight ? '#ffffff' : '#141a23'),
    borderBottomColor: tokens.borderSubtle || (isLight ? 'rgba(28, 35, 45, 0.10)' : 'rgba(72, 86, 110, 0.32)'),
    titleColor: tokens.textPrimary || (isLight ? '#111827' : '#eef3f9'),
  };
  const quickCommands = {
    panelBg: terminalContainer.popupBg || tokens.surfaceOverlay || (isLight ? '#ffffff' : '#1a2130'),
    borderColor: terminalContainer.popupBorder || tokens.borderSubtle || (isLight ? 'rgba(28, 35, 45, 0.10)' : 'rgba(72, 86, 110, 0.32)'),
    textColor: terminalContainer.inputColor || tokens.textPrimary || (isLight ? '#111827' : '#eef3f9'),
    secondaryTextColor: terminalContainer.statusBarColor || tokens.textSecondary || (isLight ? '#334155' : '#c8d1dd'),
    mutedTextColor: terminalContainer.mutedColor || tokens.textMuted || (isLight ? '#6b7a8f' : '#7a8698'),
    inputBg: terminalContainer.inputBg || tokens.surfaceSunken || (isLight ? '#e9ecef' : '#1b2230'),
    inputBorderColor: terminalContainer.btnBorder || tokens.border || (isLight ? 'rgba(28, 35, 45, 0.14)' : 'rgba(72, 86, 110, 0.55)'),
    menuBg: terminalContainer.contextBg || terminalContainer.popupBg || tokens.surfaceOverlay || (isLight ? '#ffffff' : '#1a2130'),
    menuBorderColor: terminalContainer.contextBorder || terminalContainer.popupBorder || tokens.borderSubtle || (isLight ? 'rgba(28, 35, 45, 0.10)' : 'rgba(72, 86, 110, 0.32)'),
    separatorColor: terminalContainer.separator || tokens.borderSubtle || (isLight ? 'rgba(28, 35, 45, 0.10)' : 'rgba(72, 86, 110, 0.32)'),
  };
  quickCommands.popupBg = quickCommands.panelBg;
  quickCommands.btnBorder = quickCommands.inputBorderColor;
  quickCommands.inputColor = quickCommands.textColor;
  quickCommands.statusBarColor = quickCommands.secondaryTextColor;
  quickCommands.mutedColor = quickCommands.mutedTextColor;
  quickCommands.separator = quickCommands.separatorColor;
  const connectingCard = {
    overlayBg: 'rgba(0, 0, 0, 0.42)',
    cardBg: terminalContainer.popupBg || tokens.surfaceOverlay || (isLight ? '#ffffff' : '#1a2130'),
    borderColor: terminalContainer.btnBorder || tokens.borderSubtle || (isLight ? 'rgba(28, 35, 45, 0.10)' : 'rgba(72, 86, 110, 0.32)'),
    titleColor: terminalContainer.inputColor || tokens.textPrimary || (isLight ? '#111827' : '#eef3f9'),
    secondaryTextColor: terminalContainer.statusBarColor || tokens.textSecondary || (isLight ? '#334155' : '#c8d1dd'),
    mutedTextColor: terminalContainer.mutedColor || tokens.textMuted || (isLight ? '#6b7a8f' : '#7a8698'),
    buttonBg: tokens.surfaceHover || (isLight ? '#e2e6eb' : '#243042'),
    buttonTextColor: terminalContainer.statusBarColor || tokens.textSecondary || (isLight ? '#334155' : '#c8d1dd'),
    progressTrackColor: terminalContainer.separator || tokens.borderSubtle || (isLight ? 'rgba(28, 35, 45, 0.10)' : 'rgba(72, 86, 110, 0.32)'),
    shadow: terminalContainer.contextShadow || '',
  };
  connectingCard.popupBg = connectingCard.cardBg;
  connectingCard.btnBorder = connectingCard.borderColor;
  connectingCard.contextShadow = connectingCard.shadow;
  connectingCard.inputColor = connectingCard.titleColor;
  connectingCard.statusBarColor = connectingCard.secondaryTextColor;
  connectingCard.mutedColor = connectingCard.mutedTextColor;
  connectingCard.separator = connectingCard.progressTrackColor;
  return { fileManager, topbar, quickCommands, connectingCard };
}

function getResolvedThemeComponentTheme(themePackage, name) {
  const defaults = buildDerivedComponentDefaults(
    themePackage?.modeHint || 'dark',
    themePackage?.tokens || {},
    themePackage?.components?.terminal?.container || {},
  );
  return {
    ...(defaults[name] || {}),
    ...(themePackage?.components?.[name] || {}),
  };
}

function applyComponentThemeVariables(themePackage) {
  if (typeof document === 'undefined') return;
  const target = document.body;
  if (!target) return;
  const fileManager = getResolvedThemeComponentTheme(themePackage, 'fileManager');
  const topbar = getResolvedThemeComponentTheme(themePackage, 'topbar');
  const mappings = {
    '--file-manager-panel-bg': fileManager.panelBg,
    '--file-manager-toolbar-bg': fileManager.toolbarBg,
    '--file-manager-border-color': fileManager.borderColor,
    '--file-manager-row-hover-bg': fileManager.rowHoverBg,
    '--file-manager-row-selected-bg': fileManager.selectedRowBg,
    '--file-manager-text-color': fileManager.textColor,
    '--file-manager-secondary-text-color': fileManager.secondaryTextColor,
    '--file-manager-muted-text-color': fileManager.mutedTextColor,
    '--file-manager-header-text-color': fileManager.headerTextColor,
    '--file-manager-path-bg': fileManager.pathBg,
    '--file-manager-path-text-color': fileManager.pathTextColor,
    '--file-manager-folder-text-color': fileManager.folderTextColor,
    '--topbar-bg': topbar.background,
    '--topbar-border-color': topbar.borderBottomColor,
    '--topbar-title-color': topbar.titleColor,
  };
  Object.entries(mappings).forEach(([cssVar, value]) => {
    if (value) {
      target.style.setProperty(cssVar, value);
    }
  });
}

function buildBuiltinThemePackages() {
  return Object.entries(TERMINAL_THEME_FAMILIES).flatMap(([familyKey, family]) => (
    ['dark', 'light'].map((modeHint) => {
      const themeKey = `${familyKey}-${modeHint}`;
      const modeTheme = family[modeHint];
      return {
        schemaVersion: THEME_PACKAGE_SCHEMA_VERSION,
        id: themeKey,
        name: modeTheme.name,
        description: modeTheme.description || '',
        modeHint,
        source: 'builtin',
        path: '',
        tokens: buildBaseThemeTokens(modeHint, modeTheme.accent),
        components: {
          tabs: buildTabsComponent(modeHint),
          terminal: {
            xterm: { ...modeTheme.xterm },
            container: { ...modeTheme.container },
          },
        },
        resources: {},
      };
    })
  ));
}

function buildThemePackagePreview(themePackage) {
  const preview = themePackage?.preview;
  if (preview && typeof preview === 'object') {
    return {
      surfaceBase: preview.surfaceBase || themePackage?.tokens?.surfaceBase || '',
      surfaceRaised: preview.surfaceRaised || themePackage?.tokens?.surfaceRaised || '',
      accent: preview.accent || themePackage?.tokens?.accent || '',
      textPrimary: preview.textPrimary || themePackage?.tokens?.textPrimary || '',
      terminalBg: preview.terminalBg || themePackage?.components?.terminal?.container?.containerBg || '',
      terminalFg: preview.terminalFg || themePackage?.components?.terminal?.xterm?.foreground || '',
      terminalStatusBg: preview.terminalStatusBg || themePackage?.components?.terminal?.container?.statusBarBg || '',
      terminalStatusColor: preview.terminalStatusColor || themePackage?.components?.terminal?.container?.statusBarColor || '',
    };
  }
  return {
    surfaceBase: themePackage?.tokens?.surfaceBase || '',
    surfaceRaised: themePackage?.tokens?.surfaceRaised || '',
    accent: themePackage?.tokens?.accent || '',
    textPrimary: themePackage?.tokens?.textPrimary || '',
    terminalBg: themePackage?.components?.terminal?.container?.containerBg || '',
    terminalFg: themePackage?.components?.terminal?.xterm?.foreground || '',
    terminalStatusBg: themePackage?.components?.terminal?.container?.statusBarBg || '',
    terminalStatusColor: themePackage?.components?.terminal?.container?.statusBarColor || '',
  };
}

const BUILTIN_THEME_PACKAGES = buildBuiltinThemePackages();

function buildThemePackageMap(packages) {
  return new Map((Array.isArray(packages) ? packages : []).map((item) => [item.id, item]));
}

function getFallbackThemePackageId(modeHint) {
  return normalizeModeHint(modeHint) === 'light'
    ? DEFAULT_LIGHT_THEME_PACKAGE_ID
    : DEFAULT_DARK_THEME_PACKAGE_ID;
}

function mergeLegacyThemePackageSettings(rawSettings) {
  const next = { ...(rawSettings || {}) };
  if (next.lightThemePackageId && next.darkThemePackageId) {
    return next;
  }
  const legacyFamilyKey = localStorage.getItem('terminalColorTheme') || 'lumin';
  const mapped = LEGACY_THEME_PACKAGE_MAP[legacyFamilyKey] || LEGACY_THEME_PACKAGE_MAP.lumin;
  return {
    ...next,
    lightThemePackageId: next.lightThemePackageId || mapped.light,
    darkThemePackageId: next.darkThemePackageId || mapped.dark,
  };
}

function readThemePackageSettingsFromLocalStorage() {
  if (typeof window === 'undefined') {
    return {
      themeMode: 'dark',
      lightThemePackageId: DEFAULT_LIGHT_THEME_PACKAGE_ID,
      darkThemePackageId: DEFAULT_DARK_THEME_PACKAGE_ID,
    };
  }
  return mergeLegacyThemePackageSettings({
    themeMode: localStorage.getItem('themeMode') || 'dark',
    lightThemePackageId: localStorage.getItem('lightThemePackageId') || '',
    darkThemePackageId: localStorage.getItem('darkThemePackageId') || '',
  });
}

function normalizeThemePackageRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = String(record.id || '').trim();
  if (!id) return null;
  const builtin = BUILTIN_THEME_PACKAGES.find((item) => item.id === id);
  const modeHint = normalizeModeHint(record.modeHint || builtin?.modeHint || (id.endsWith('-light') ? 'light' : 'dark'));
  const tokens = { ...(builtin?.tokens || {}), ...(record.tokens || {}) };
  const builtinTabs = builtin?.components?.tabs || {};
  const builtinTerminal = builtin?.components?.terminal || {};
  const components = {
    ...(builtin?.components || {}),
    ...(record.components || {}),
    tabs: {
      ...builtinTabs,
      ...(record?.components?.tabs || {}),
    },
    terminal: {
      ...builtinTerminal,
      ...(record?.components?.terminal || {}),
      xterm: {
        ...(builtinTerminal.xterm || {}),
        ...(record?.components?.terminal?.xterm || {}),
      },
      container: {
        ...(builtinTerminal.container || {}),
        ...(record?.components?.terminal?.container || {}),
      },
    },
  };
  return {
    schemaVersion: Number(record.schemaVersion || builtin?.schemaVersion || THEME_PACKAGE_SCHEMA_VERSION),
    id,
    name: String(record.name || builtin?.name || id).trim() || id,
    description: String(record.description || builtin?.description || '').trim(),
    modeHint,
    source: String(record.source || builtin?.source || 'builtin').trim() || 'builtin',
    path: String(record.path || '').trim(),
    tokens,
    components,
    resources: { ...(builtin?.resources || {}), ...(record.resources || {}) },
    preview: buildThemePackagePreview({
      ...builtin,
      ...record,
      tokens,
      components,
    }),
  };
}

let themePackagesCache = BUILTIN_THEME_PACKAGES.map((item) => normalizeThemePackageRecord(item)).filter(Boolean);
let themePackageMapCache = buildThemePackageMap(themePackagesCache);
let themePackageSettingsCache = null;
let themeRuntimeListenersBound = false;
let systemThemeChangeUnbind = null;
let themeToolPreviewPackageCache = null;

function normalizeThemePackageSettings(settings, packageMap = themePackageMapCache) {
  const next = mergeLegacyThemePackageSettings({
    themeMode: settings?.themeMode,
    lightThemePackageId: settings?.lightThemePackageId ?? settings?.LightThemePackageID,
    darkThemePackageId: settings?.darkThemePackageId ?? settings?.DarkThemePackageID,
  });
  const themeMode = normalizeThemeModePreference(next.themeMode);
  let lightThemePackageId = String(next.lightThemePackageId || '').trim();
  let darkThemePackageId = String(next.darkThemePackageId || '').trim();
  if (!packageMap.has(lightThemePackageId) || packageMap.get(lightThemePackageId)?.modeHint !== 'light') {
    lightThemePackageId = getFallbackThemePackageId('light');
  }
  if (!packageMap.has(darkThemePackageId) || packageMap.get(darkThemePackageId)?.modeHint !== 'dark') {
    darkThemePackageId = getFallbackThemePackageId('dark');
  }
  return {
    themeMode,
    lightThemePackageId,
    darkThemePackageId,
  };
}

function persistThemePackageSettingsToLocalStorage(settings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('themeMode', settings.themeMode);
  localStorage.setItem('lightThemePackageId', settings.lightThemePackageId);
  localStorage.setItem('darkThemePackageId', settings.darkThemePackageId);
}

function getSystemThemeMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function getThemePackageSettings() {
  if (!themePackageSettingsCache) {
    themePackageSettingsCache = normalizeThemePackageSettings(readThemePackageSettingsFromLocalStorage());
  }
  return { ...themePackageSettingsCache };
}

export function getAppThemeMode() {
  if (typeof window !== 'undefined' && window.__luminForceDarkTheme === true) {
    return 'dark';
  }
  if (themeToolPreviewPackageCache?.modeHint) {
    return normalizeModeHint(themeToolPreviewPackageCache.modeHint);
  }
  const settings = getThemePackageSettings();
  return settings.themeMode === 'system'
    ? getSystemThemeMode()
    : normalizeModeHint(settings.themeMode);
}

function getActiveThemePackageId(mode = getAppThemeMode()) {
  const settings = getThemePackageSettings();
  return mode === 'light'
    ? settings.lightThemePackageId
    : settings.darkThemePackageId;
}

function getActiveThemePackage(mode = getAppThemeMode()) {
  if (themeToolPreviewPackageCache) {
    return themeToolPreviewPackageCache;
  }
  const id = getActiveThemePackageId(mode);
  return themePackageMapCache.get(id) || themePackageMapCache.get(getFallbackThemePackageId(mode)) || themePackagesCache[0];
}

function toCssVarName(key) {
  return `--${String(key || '').replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

function applyTabsThemeComponent(themePackage) {
  if (typeof document === 'undefined') return;
  const target = document.body;
  if (!target) return;
  const tabs = themePackage?.components?.tabs || {};
  const mappings = {
    inactiveBg: '--tab-inactive-bg',
    inactiveBgHover: '--tab-inactive-bg-hover',
    inactiveBorder: '--tab-inactive-border',
    inactiveText: '--tab-inactive-text',
    activeBg: '--tab-active-bg',
    activeBorder: '--tab-active-border',
    activeText: '--tab-active-text',
    radius: '--tab-radius',
  };
  Object.entries(mappings).forEach(([sourceKey, cssVar]) => {
    const value = tabs[sourceKey];
    if (value) {
      target.style.setProperty(cssVar, value);
    }
  });
}

export function applyStoredThemePackage() {
  if (typeof document === 'undefined') return;
  if (!themePackageSettingsCache) {
    themePackageSettingsCache = normalizeThemePackageSettings(readThemePackageSettingsFromLocalStorage());
  }
  persistThemePackageSettingsToLocalStorage(themePackageSettingsCache);
  const resolvedMode = getAppThemeMode();
  const activeThemePackage = getActiveThemePackage(resolvedMode);
  const target = document.body;
  if (!target) return;
  target.classList.toggle('theme-light', resolvedMode === 'light' && window.__luminForceDarkTheme !== true);
  Object.entries(activeThemePackage?.tokens || {}).forEach(([key, value]) => {
    if (value) {
      target.style.setProperty(toCssVarName(key), value);
    }
  });
  applyComponentThemeVariables(activeThemePackage);
  applyTabsThemeComponent(activeThemePackage);
}

async function syncThemePackageSettingsToBackend(settings) {
  const normalizedSettings = normalizeThemePackageSettings(settings);
  try {
    await AppGo.SaveThemePackageSettings({
      themeMode: normalizedSettings.themeMode,
      lightThemePackageId: normalizedSettings.lightThemePackageId,
      darkThemePackageId: normalizedSettings.darkThemePackageId,
    });
  } catch (_) {}
}

function mergeThemePackagesFromBackend(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return themePackagesCache;
  }
  const normalized = records
    .map((record) => normalizeThemePackageRecord(record))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : themePackagesCache;
}

function handleThemeRuntimeRefresh({ syncBackend = false } = {}) {
  const nextSettings = normalizeThemePackageSettings(readThemePackageSettingsFromLocalStorage());
  const changed = JSON.stringify(nextSettings) !== JSON.stringify(themePackageSettingsCache || {});
  themePackageSettingsCache = nextSettings;
  persistThemePackageSettingsToLocalStorage(nextSettings);
  applyStoredThemePackage();
  if (syncBackend && changed) {
    void syncThemePackageSettingsToBackend(nextSettings);
  }
}

function bindThemeRuntimeListeners() {
  if (themeRuntimeListenersBound || typeof window === 'undefined') return;
  themeRuntimeListenersBound = true;
  window.addEventListener('theme-mode-changed', () => {
    handleThemeRuntimeRefresh({ syncBackend: true });
  });
  window.addEventListener('theme-package-changed', () => {
    handleThemeRuntimeRefresh({ syncBackend: true });
  });
  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      if (getThemePackageSettings().themeMode === 'system') {
        applyStoredThemePackage();
        window.dispatchEvent(new CustomEvent('terminal-theme-changed'));
      }
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handler);
      systemThemeChangeUnbind = () => media.removeEventListener('change', handler);
    } else if (typeof media.addListener === 'function') {
      media.addListener(handler);
      systemThemeChangeUnbind = () => media.removeListener(handler);
    }
  }
}

export async function loadThemePackages() {
  bindThemeRuntimeListeners();
  themePackageSettingsCache = normalizeThemePackageSettings(readThemePackageSettingsFromLocalStorage());
  persistThemePackageSettingsToLocalStorage(themePackageSettingsCache);
  applyStoredThemePackage();
  try {
    const [packageSettings, packageRecords] = await Promise.all([
      AppGo.GetThemePackageSettings().catch(() => null),
      AppGo.ListThemePackages().catch(() => []),
    ]);
    themePackagesCache = mergeThemePackagesFromBackend(packageRecords);
    themePackageMapCache = buildThemePackageMap(themePackagesCache);
    themePackageSettingsCache = normalizeThemePackageSettings(packageSettings || themePackageSettingsCache, themePackageMapCache);
    persistThemePackageSettingsToLocalStorage(themePackageSettingsCache);
    applyStoredThemePackage();
    await syncThemePackageSettingsToBackend(themePackageSettingsCache);
  } catch (_) {
    themePackagesCache = BUILTIN_THEME_PACKAGES.map((item) => normalizeThemePackageRecord(item)).filter(Boolean);
    themePackageMapCache = buildThemePackageMap(themePackagesCache);
    themePackageSettingsCache = normalizeThemePackageSettings(themePackageSettingsCache, themePackageMapCache);
    persistThemePackageSettingsToLocalStorage(themePackageSettingsCache);
    applyStoredThemePackage();
  }
  return {
    packages: listThemePackages(),
    settings: getThemePackageSettings(),
  };
}

export async function saveThemePackageSettings(nextSettings) {
  bindThemeRuntimeListeners();
  themePackageSettingsCache = normalizeThemePackageSettings({
    ...getThemePackageSettings(),
    ...(nextSettings || {}),
  }, themePackageMapCache);
  persistThemePackageSettingsToLocalStorage(themePackageSettingsCache);
  applyStoredThemePackage();
  await syncThemePackageSettingsToBackend(themePackageSettingsCache);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('theme-package-changed', { detail: { ...themePackageSettingsCache } }));
    window.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: themePackageSettingsCache.themeMode }));
    window.dispatchEvent(new CustomEvent('terminal-theme-changed'));
  }
  return { ...themePackageSettingsCache };
}

export function listThemePackages() {
  return themePackagesCache.map((item) => ({ ...item }));
}

export function getThemeComponentTheme(name) {
  return getResolvedThemeComponentTheme(getActiveThemePackage(), String(name || '').trim());
}

export function setThemeToolPreviewPackage(record) {
  const normalized = normalizeThemePackageRecord(record);
  if (!normalized) {
    return;
  }
  themeToolPreviewPackageCache = normalized;
  applyStoredThemePackage();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('theme-preview-changed', { detail: { id: normalized.id, modeHint: normalized.modeHint } }));
    window.dispatchEvent(new CustomEvent('terminal-theme-changed'));
  }
}

export function clearThemeToolPreviewPackage() {
  if (!themeToolPreviewPackageCache) {
    return;
  }
  themeToolPreviewPackageCache = null;
  applyStoredThemePackage();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('theme-preview-changed', { detail: { id: '', modeHint: '' } }));
    window.dispatchEvent(new CustomEvent('terminal-theme-changed'));
  }
}

export function getTerminalTheme() {
  const activeThemePackage = getActiveThemePackage();
  return activeThemePackage?.components?.terminal || {
    xterm: {},
    container: {},
  };
}

export function hexToRgb(hex) {
  if (!/^#[\da-fA-F]{6}$/.test(String(hex || '').trim())) {
    return '0, 0, 0';
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

bindThemeRuntimeListeners();
themePackageSettingsCache = normalizeThemePackageSettings(readThemePackageSettingsFromLocalStorage(), themePackageMapCache);
persistThemePackageSettingsToLocalStorage(themePackageSettingsCache);
applyStoredThemePackage();