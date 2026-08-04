/**
 * 终端关键字高亮模块
 *
 * 在终端输出写入 xterm 之前，对日志关键字（error / fail / warn / info / success 等）
 * 注入 ANSI SGR 前景色转义码，实现单词级着色。
 *
 * 设计要点：
 * - 默认使用 ANSI 16 色 SGR 码（31/32/33/36），自动适配所有主题的 xterm 调色板
 * - 用户自定义颜色时使用真彩色码（38;2;R;G;B）
 * - 仅对「当前无显式前景色」的纯文本段着色，不覆盖服务端已着色的输出
 * - 单次 O(n) 扫描，无 DOM 操作，性能开销极低
 * - 只改字体前景色，不加背景色
 * - 规则可动态更新（设置变更时重建正则缓存）
 */

// ── 默认关键字规则 ──────────────────────────────────────────────────
export const DEFAULT_KEYWORD_RULES = [
  {
    id: 'error',
    keywords: ['error', 'fatal', 'critical', 'panic'],
    colorMode: 'ansi16',
    sgr: 31,
    hex: '#ff6b6b',
  },
  {
    id: 'fail',
    keywords: ['fail', 'failed', 'failure', 'denied', 'refused', 'rejected'],
    colorMode: 'ansi16',
    sgr: 31,
    hex: '#ff6b6b',
  },
  {
    id: 'warning',
    keywords: ['warn', 'warning', 'deprecated'],
    colorMode: 'ansi16',
    sgr: 33,
    hex: '#ffcc33',
  },
  {
    id: 'info',
    keywords: ['info', 'notice', 'debug'],
    colorMode: 'ansi16',
    sgr: 36,
    hex: '#39d0d6',
  },
  {
    id: 'success',
    keywords: ['success', 'successful', 'completed', 'passed', 'resolved'],
    colorMode: 'ansi16',
    sgr: 32,
    hex: '#3dd68c',
  },
];

// ── 运行时状态 ──────────────────────────────────────────────────────
let activeRules = DEFAULT_KEYWORD_RULES;
let compiledRegex = null;
let keywordColorMap = new Map(); // 关键字(小写) → 颜色信息，避免下标对齐错位
// 跨调用保持的前景色状态：highlightKeywords 按 WebSocket 帧逐次调用，
// 服务端着色区间可能跨帧，必须跨帧跟踪才不会误注入/误清色
let persistentFgActive = false;

/**
 * 将 hex 颜色转为 RGB 三元组
 */
function hexToRgbParts(hex) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/**
 * 根据规则列表重建合并正则和颜色映射表。
 * 仅在规则变更时调用，热路径零开销。
 */
function rebuildRegex() {
  const sources = [];
  const colorMap = new Map();

  for (const rule of activeRules) {
    if (!rule.keywords || rule.keywords.length === 0) continue;
    const colorInfo = {
      colorMode: rule.colorMode || 'ansi16',
      sgr: rule.sgr || 31,
      hex: rule.hex || '#ff6b6b',
    };
    // 转义关键字中的正则特殊字符
    const escaped = rule.keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    sources.push(`(?:\\b(?:${escaped.join('|')})\\b)`);
    for (const kw of rule.keywords) {
      colorMap.set(String(kw).toLowerCase(), colorInfo);
    }
  }

  if (sources.length === 0) {
    compiledRegex = null;
    keywordColorMap = new Map();
    return;
  }

  compiledRegex = new RegExp(sources.join('|'), 'gi');
  keywordColorMap = colorMap;
}

// 初始化
rebuildRegex();

/**
 * 获取当前生效的规则列表
 */
export function getKeywordRules() {
  return activeRules;
}

/**
 * 设置规则列表并重建正则缓存。
 * @param {Array} rules - 规则数组
 */
export function setKeywordRules(rules) {
  // 空数组 = 用户删光规则 = 真正禁用高亮（与 UI 语义一致）
  if (Array.isArray(rules)) {
    activeRules = rules;
  } else {
    activeRules = DEFAULT_KEYWORD_RULES;
  }
  rebuildRegex();
}

/**
 * 从 localStorage 加载规则（如果有）
 */
export function loadKeywordRulesFromStorage() {
  try {
    const raw = localStorage.getItem('terminalKeywordRules');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setKeywordRules(parsed);
        return parsed;
      }
    }
  } catch (_) {}
  setKeywordRules(DEFAULT_KEYWORD_RULES);
  return DEFAULT_KEYWORD_RULES;
}

/**
 * 保存规则到 localStorage
 */
export function saveKeywordRulesToStorage(rules) {
  try {
    localStorage.setItem('terminalKeywordRules', JSON.stringify(rules));
  } catch (_) {}
}

/**
 * 清除自定义规则，恢复默认
 */
export function resetKeywordRulesToDefault() {
  try {
    localStorage.removeItem('terminalKeywordRules');
  } catch (_) {}
  setKeywordRules(DEFAULT_KEYWORD_RULES);
  return DEFAULT_KEYWORD_RULES;
}

/**
 * 根据匹配文本找到对应的颜色信息（直接查 Map，无下标对齐问题）
 */
function getColorInfoForMatch(matchText) {
  return keywordColorMap.get(String(matchText).toLowerCase())
    || { colorMode: 'ansi16', sgr: 31, hex: '#ff6b6b' };
}

/**
 * 生成 ANSI 前景色开启码
 */
function buildColorOpen(colorInfo) {
  if (colorInfo.colorMode === 'truecolor') {
    const rgb = hexToRgbParts(colorInfo.hex);
    if (rgb) return `\x1b[1;38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  }
  return `\x1b[1;${colorInfo.sgr}m`;
}

// 颜色关闭码：取消加粗 + 恢复默认前景
const COLOR_CLOSE = '\x1b[22;39m';

/**
 * 从 SGR 参数字符串中提取前景色状态变化。
 * 返回: 'set' | 'reset' | 'none'
 */
function sgrForegroundAction(sgrParams) {
  if (!sgrParams || sgrParams === '') return 'reset';
  const parts = sgrParams.split(';');
  let action = 'none';
  for (let i = 0; i < parts.length; i += 1) {
    const code = parseInt(parts[i], 10);
    if (Number.isNaN(code) || code === 0) {
      action = 'reset';
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97) || code === 38) {
      action = 'set';
    } else if (code === 39) {
      action = 'reset';
    }
  }
  return action;
}

// ANSI 转义序列匹配：CSI（含 SGR）、OSC、其他单字符 ESC
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]/g;

/**
 * 对终端输出文本注入关键字高亮 ANSI 码。
 *
 * @param {string} text - 原始终端输出（可能包含 ANSI 转义序列）
 * @returns {string} 注入高亮后的文本
 */
export function highlightKeywords(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.length < 3) return text;
  if (!compiledRegex) return text;

  const result = [];
  let lastEnd = 0;
  // 使用跨帧保持的前景色状态
  let fgActive = persistentFgActive;

  ANSI_ESCAPE_REGEX.lastIndex = 0;

  let ansiMatch;
  const segments = [];

  while ((ansiMatch = ANSI_ESCAPE_REGEX.exec(text)) !== null) {
    if (ansiMatch.index > lastEnd) {
      segments.push({ type: 'text', value: text.slice(lastEnd, ansiMatch.index) });
    }
    segments.push({ type: 'ansi', value: ansiMatch[0] });
    lastEnd = ansiMatch.index + ansiMatch[0].length;
  }
  if (lastEnd < text.length) {
    segments.push({ type: 'text', value: text.slice(lastEnd) });
  }

  // 纯文本快速路径
  if (segments.length === 1 && segments[0].type === 'text') {
    // 纯文本不含 SGR，前景状态不变；写回保持值
    persistentFgActive = fgActive;
    return highlightPlainText(segments[0].value);
  }

  for (const seg of segments) {
    if (seg.type === 'ansi') {
      result.push(seg.value);
      if (seg.value.length > 2 && seg.value[1] === '[' && seg.value[seg.value.length - 1] === 'm') {
        const params = seg.value.slice(2, -1);
        const action = sgrForegroundAction(params);
        if (action === 'set') fgActive = true;
        else if (action === 'reset') fgActive = false;
      }
    } else {
      if (fgActive) {
        result.push(seg.value);
      } else {
        result.push(highlightPlainText(seg.value));
      }
    }
  }

  // 写回跨帧状态，供下一帧使用
  persistentFgActive = fgActive;

  return result.join('');
}

/**
 * 对纯文本段进行关键字着色。
 */
function highlightPlainText(text) {
  if (!text || !compiledRegex) return text;

  compiledRegex.lastIndex = 0;
  let match;
  let output = '';
  let lastIdx = 0;

  while ((match = compiledRegex.exec(text)) !== null) {
    const matched = match[0];
    const colorInfo = getColorInfoForMatch(matched);

    output += text.slice(lastIdx, match.index);
    output += buildColorOpen(colorInfo) + matched + COLOR_CLOSE;
    lastIdx = match.index + matched.length;
  }

  if (lastIdx === 0) return text;
  output += text.slice(lastIdx);
  return output;
}
