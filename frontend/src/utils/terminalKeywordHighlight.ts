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

type KeywordColorMode = 'ansi16' | 'truecolor';

export interface KeywordRule {
  id: string;
  keywords: string[];
  colorMode: KeywordColorMode;
  sgr: number;
  hex: string;
}

interface KeywordColorInfo {
  colorMode: KeywordColorMode;
  sgr: number;
  hex: string;
}

/** 单会话高亮状态（per-session 跨帧跟踪前景色） */
export interface HighlightState {
  fgActive: boolean;
}

// ── 默认关键字规则 ──────────────────────────────────────────────────
export const DEFAULT_KEYWORD_RULES: KeywordRule[] = [
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
// 注意：compiledRegex / keywordColorMap 是「只读结构」，多终端共享安全；
// 但「前景色激活状态」必须 per-session 跟踪（见 createHighlightState），
// 绝不能放模块级——否则多标签/分屏会互相污染，导致误注入/误跳过高亮。
let activeRules: KeywordRule[] = DEFAULT_KEYWORD_RULES;
let compiledRegex: RegExp | null = null;
let keywordColorMap = new Map<string, KeywordColorInfo>(); // 关键字(小写) → 颜色信息，避免下标对齐错位

/**
 * 为单个终端会话创建一个独立的高亮状态对象。
 * highlightKeywords 按 WebSocket 帧逐次调用，服务端着色区间可能跨帧，
 * 必须跨帧跟踪前景色才不会误注入/误清色。
 * 每个终端连接应持有自己的状态，避免多标签/分屏互相干扰。
 */
export function createHighlightState(): HighlightState {
  return { fgActive: false };
}

/**
 * 将 hex 颜色转为 RGB 三元组
 */
function hexToRgbParts(hex: string): number[] | null {
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
function rebuildRegex(): void {
  const sources: string[] = [];
  const colorMap = new Map<string, KeywordColorInfo>();

  for (const rule of activeRules) {
    if (!rule.keywords || rule.keywords.length === 0) continue;
    const colorInfo: KeywordColorInfo = {
      colorMode: rule.colorMode || 'ansi16',
      sgr: rule.sgr || 31,
      hex: rule.hex || '#ff6b6b',
    };
    for (const kw of rule.keywords) {
      const raw = String(kw);
      // 转义关键字中的正则特殊字符
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // \b 基于 \w=[A-Za-z0-9_]：纯 ASCII 词字符的关键字用 \b 做精确整词边界，
      // 避免「terror」里的「error」被误命中；
      // 含非 ASCII（CJK / emoji 等）的关键字 \b 不生效甚至会令匹配失败，
      // 此时去掉边界约束（子串匹配，如「失败」命中「大失败」，符合中文直觉）。
      const isAsciiWord = /^[\w]+$/.test(raw);
      const part = isAsciiWord ? `\\b${escaped}\\b` : escaped;
      sources.push(`(?:${part})`);
      colorMap.set(raw.toLowerCase(), colorInfo);
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

/** 将外部（localStorage/设置）数据规整为规则列表，坏项跳过（与旧运行时行为一致） */
function normalizeKeywordRules(rules: unknown): KeywordRule[] {
  if (!Array.isArray(rules)) {
    return DEFAULT_KEYWORD_RULES;
  }
  const normalized: KeywordRule[] = [];
  for (const item of rules) {
    if (!item || typeof item !== 'object') continue;
    const rule = item as Partial<KeywordRule>;
    normalized.push({
      id: typeof rule.id === 'string' ? rule.id : '',
      keywords: Array.isArray(rule.keywords) ? rule.keywords.map((kw) => String(kw)) : [],
      colorMode: rule.colorMode === 'truecolor' ? 'truecolor' : 'ansi16',
      sgr: Number.isFinite(Number(rule.sgr)) ? Number(rule.sgr) : 31,
      hex: typeof rule.hex === 'string' ? rule.hex : '#ff6b6b',
    });
  }
  return normalized;
}


/**
 * 设置规则列表并重建正则缓存。
 * @param rules - 规则数组
 */
export function setKeywordRules(rules: unknown): void {
  // 空数组 = 用户删光规则 = 真正禁用高亮（与 UI 语义一致）
  if (Array.isArray(rules)) {
    activeRules = normalizeKeywordRules(rules);
  } else {
    activeRules = DEFAULT_KEYWORD_RULES;
  }
  rebuildRegex();
}

/**
 * 从 localStorage 加载规则（如果有）
 */
export function loadKeywordRulesFromStorage(): KeywordRule[] {
  try {
    const raw = localStorage.getItem('terminalKeywordRules');
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setKeywordRules(parsed);
        return activeRules;
      }
    }
  } catch (_) {}
  setKeywordRules(DEFAULT_KEYWORD_RULES);
  return DEFAULT_KEYWORD_RULES;
}

/**
 * 保存规则到 localStorage
 */
export function saveKeywordRulesToStorage(rules: KeywordRule[]): void {
  try {
    localStorage.setItem('terminalKeywordRules', JSON.stringify(rules));
  } catch (_) {}
}

/**
 * 清除自定义规则，恢复默认
 */
export function resetKeywordRulesToDefault(): KeywordRule[] {
  try {
    localStorage.removeItem('terminalKeywordRules');
  } catch (_) {}
  setKeywordRules(DEFAULT_KEYWORD_RULES);
  return DEFAULT_KEYWORD_RULES;
}

/**
 * 根据匹配文本找到对应的颜色信息（直接查 Map，无下标对齐问题）
 */
function getColorInfoForMatch(matchText: string): KeywordColorInfo {
  return keywordColorMap.get(String(matchText).toLowerCase())
    || { colorMode: 'ansi16', sgr: 31, hex: '#ff6b6b' };
}

/**
 * 生成 ANSI 前景色开启码。
 *
 * 故意只设前景色、不带 intensity(1)：
 * 若注入 `1;31m`、关闭用 `22;39m`，22 会把关键词之后「服务端已加粗」的文字一起还原成常规，
 * 等于篡改了原文的字重。改用 ANSI 亮色档（90-97 / 真彩色）保证观感鲜亮，
 * 关闭码只用 `\x1b[39m`（恢复默认前景，不碰字重），对原文 intensity 零副作用。
 */
function buildColorOpen(colorInfo: KeywordColorInfo): string {
  if (colorInfo.colorMode === 'truecolor') {
    const rgb = hexToRgbParts(colorInfo.hex);
    if (rgb) return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  }
  // sgr 30-37（标准色）映射到 90-97（亮色档），既鲜亮又不触发加粗
  const sgr = Number(colorInfo.sgr) || 31;
  const bright = sgr >= 30 && sgr <= 37 ? sgr + 60 : sgr;
  return `\x1b[${bright}m`;
}

// 颜色关闭码：仅恢复默认前景色，绝不动 intensity（避免篡改服务端已加粗文本）
const COLOR_CLOSE = '\x1b[39m';

/**
 * 从 SGR 参数字符串中提取前景色状态变化。
 * 返回: 'set' | 'reset' | 'none'
 */
function sgrForegroundAction(sgrParams: string): 'set' | 'reset' | 'none' {
  if (!sgrParams || sgrParams === '') return 'reset';
  const parts = sgrParams.split(';');
  let action: 'set' | 'reset' | 'none' = 'none';
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

// ANSI 转义序列匹配（按优先级顺序）：
// 1. CSI        : ESC [ ... <0x40-0x7E>
// 2. OSC        : ESC ] ... (BEL | ST)   ST = ESC \
// 3. 字符串序列  : ESC P / X / ^ / _ ... (BEL | ST)   （DCS / SOS / PM / APC）
//    —— Sixel 图、终端查询响应等走这里；串体里若含关键字绝不能注入 SGR，
//       否则会破坏图形/响应序列。必须把整段串体连同结束符一起吞掉。
// 4. 其他单字符 ESC: ESC <一个字符>（如 ESC c 重置）
// 第三分支末尾 `\x1b[^^PX^_]` 等价于「ESC 后跟非 [ 非 字符串序列引导符 的单字符」。
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[PX^_]/g;

interface TextSegment {
  type: 'text' | 'ansi';
  value: string;
}

/**
 * 对终端输出文本注入关键字高亮 ANSI 码。
 *
 * @param text - 原始终端输出（可能包含 ANSI 转义序列）
 * @param state - per-session 前景色状态。
 *        跨帧跟踪服务端着色区间，避免误注入/误清色。由调用方（每个终端会话）
 *        用 useRef 持有并通过 createHighlightState() 创建，多终端互不干扰。
 *        传 null/undefined 时退化为「按帧无状态」高亮（兼容旧调用，不推荐）。
 * @returns 注入高亮后的文本
 */
export function highlightKeywords(text: string, state: HighlightState | null | undefined): string {
  if (!text || typeof text !== 'string') return text;
  if (text.length < 3) return text;
  if (!compiledRegex) return text;

  const result: string[] = [];
  let lastEnd = 0;
  // 读取该会话的跨帧前景色状态（per-session，杜绝多终端互相污染）
  let fgActive = state ? !!state.fgActive : false;

  ANSI_ESCAPE_REGEX.lastIndex = 0;

  let ansiMatch: RegExpExecArray | null;
  const segments: TextSegment[] = [];

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
    // 纯文本不含 SGR，前景状态不变；写回保持值（仅当调用方提供了 state）
    if (state) state.fgActive = fgActive;
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

  // 写回跨帧状态，供下一帧使用（仅当调用方提供了 state）
  if (state) state.fgActive = fgActive;

  return result.join('');
}

/**
 * 对纯文本段进行关键字着色。
 */
function highlightPlainText(text: string): string {
  if (!text || !compiledRegex) return text;

  compiledRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
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
