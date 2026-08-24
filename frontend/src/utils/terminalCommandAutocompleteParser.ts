export function normalizeRemoteAbsolutePath(value: string): string {
  let normalized = String(value || '').trim().replace(/^['"]|['"]$/g, '')
  if (normalized.startsWith('@')) {
    normalized = normalized.slice(1)
  }
  return normalized.startsWith('/') ? normalized : ''
}

function getSafeCursorPosition(inputValue: string, cursorPosition: unknown): number {
  const raw = String(inputValue || '')
  const fallback = raw.length
  if (!Number.isFinite(cursorPosition as number)) {
    return fallback
  }
  return Math.max(0, Math.min(raw.length, Number(cursorPosition)))
}

/** shell 命令段（按 && / || / ; / | / 换行切分） */
interface ShellSegment {
  start: number;
  end: number;
  boundaryEnd: number;
  separator: string;
}

/** 段内按空白切分的词元 */
interface ShellToken {
  text: string;
  lowerText: string;
  start: number;
  end: number;
}

/** 解析后的命令输入上下文 */
export interface CommandInputContext {
  raw: string;
  safeCursor: number;
  currentCwd: string;
  segmentStart: number;
  segmentEnd: number;
  commandStart: number;
  command: string;
  commandLower: string;
  tokens: ShellToken[];
  currentTokenIndex: number;
  tokenStart: number;
  tokenEnd: number;
  token: string;
  tokenLower: string;
  hasTrailingSpace: boolean;
}

function splitShellSegments(raw: string): ShellSegment[] {
  const segments: ShellSegment[] = []
  let segmentStart = 0
  let quote: string | null = null
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (quote === "'") {
      if (character === "'") {
        quote = null
      }
      continue
    }

    if (quote === '"') {
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') {
        quote = null
      }
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      continue
    }

    const doubleOperator = raw.slice(index, index + 2)
    if (doubleOperator === '&&' || doubleOperator === '||') {
      segments.push({
        start: segmentStart,
        end: index,
        boundaryEnd: index + 2,
        separator: doubleOperator,
      })
      segmentStart = index + 2
      index += 1
      continue
    }

    if (character === '\n' || character === '\r') {
      const boundaryEnd = character === '\r' && raw[index + 1] === '\n' ? index + 2 : index + 1
      segments.push({
        start: segmentStart,
        end: index,
        boundaryEnd,
        separator: character,
      })
      segmentStart = boundaryEnd
      if (boundaryEnd === index + 2) {
        index += 1
      }
      continue
    }

    if (character === ';' || character === '|') {
      segments.push({
        start: segmentStart,
        end: index,
        boundaryEnd: index + 1,
        separator: character,
      })
      segmentStart = index + 1
    }
  }

  segments.push({
    start: segmentStart,
    end: raw.length,
    boundaryEnd: raw.length,
    separator: '',
  })

  return segments
}

function findActiveSegment(segments: ShellSegment[], safeCursor: number): ShellSegment {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (safeCursor >= segment.start && safeCursor <= segment.boundaryEnd) {
      return segment
    }
  }
  return segments[segments.length - 1] || {
    start: 0,
    end: 0,
    boundaryEnd: 0,
    separator: '',
  }
}

function tokenizeShellSegment(raw: string, start: number, end: number): ShellToken[] {
  const tokens: ShellToken[] = []
  let tokenStart: number | null = null
  let quote: string | null = null
  let escaped = false

  const pushToken = (tokenEnd: number) => {
    if (tokenStart === null) {
      return
    }
    const text = raw.slice(tokenStart, tokenEnd)
    tokens.push({
      text,
      lowerText: text.toLowerCase(),
      start: tokenStart,
      end: tokenEnd,
    })
    tokenStart = null
  }

  for (let index = start; index < end; index += 1) {
    const character = raw[index]

    if (tokenStart === null) {
      if (/\s/.test(character)) {
        continue
      }
      tokenStart = index
    }

    if (escaped) {
      escaped = false
      continue
    }

    if (quote === "'") {
      if (character === "'") {
        quote = null
      }
      continue
    }

    if (quote === '"') {
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') {
        quote = null
      }
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      continue
    }

    if (/\s/.test(character)) {
      pushToken(index)
    }
  }

  pushToken(end)
  return tokens
}

interface CurrentTokenInfo {
  index: number;
  start: number;
  end: number;
  textBeforeCursor: string;
  isVirtual: boolean;
}

function getCurrentTokenInfo(raw: string, tokens: ShellToken[], safeCursor: number): CurrentTokenInfo {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (safeCursor >= token.start && safeCursor <= token.end) {
      return {
        index,
        start: token.start,
        end: token.end,
        textBeforeCursor: raw.slice(token.start, safeCursor),
        isVirtual: false,
      }
    }
  }

  const completedTokenCount = tokens.filter((token) => token.end <= safeCursor).length
  return {
    index: completedTokenCount,
    start: safeCursor,
    end: safeCursor,
    textBeforeCursor: '',
    isVirtual: true,
  }
}

function finalizeReplacementValue(prefix: string, replacement: string, suffix: string, appendSpace = false): string {
  let normalizedReplacement = String(replacement || '')
  if (appendSpace && (!suffix || !/^[\s;&|]/.test(suffix))) {
    normalizedReplacement = `${normalizedReplacement} `
  }
  return `${prefix}${normalizedReplacement}${suffix}`
}

export function buildCommandReplacementValue(context: CommandInputContext, replacement: string, appendSpace = false): string {
  return finalizeReplacementValue(
    context.raw.slice(0, context.commandStart),
    replacement,
    context.raw.slice(context.segmentEnd),
    appendSpace,
  )
}

export function buildTokenReplacementValue(context: CommandInputContext, replacement: string, appendSpace = false): string {
  return finalizeReplacementValue(
    context.raw.slice(0, context.tokenStart),
    replacement,
    context.raw.slice(context.tokenEnd),
    appendSpace,
  )
}

export function parseCommandInputContext(
  inputValue: string,
  options: { cursorPosition?: unknown; currentCwd?: string } = {},
): CommandInputContext {
  const raw = String(inputValue || '')
  const safeCursor = getSafeCursorPosition(raw, options.cursorPosition)
  const segments = splitShellSegments(raw)
  const activeSegment = findActiveSegment(segments, safeCursor)
  const tokens = tokenizeShellSegment(raw, activeSegment.start, activeSegment.end)
  const currentToken = getCurrentTokenInfo(raw, tokens, safeCursor)

  let firstNonWhitespace = activeSegment.start
  while (firstNonWhitespace < activeSegment.end && /\s/.test(raw[firstNonWhitespace])) {
    firstNonWhitespace += 1
  }

  const commandToken = tokens[0] || null
  const command = commandToken ? commandToken.text : ''
  const commandLower = commandToken ? commandToken.lowerText : ''

  return {
    raw,
    safeCursor,
    currentCwd: normalizeRemoteAbsolutePath(options.currentCwd || '') || '/',
    segmentStart: activeSegment.start,
    segmentEnd: activeSegment.end,
    commandStart: commandToken ? commandToken.start : firstNonWhitespace,
    command,
    commandLower,
    tokens,
    currentTokenIndex: currentToken.index,
    tokenStart: currentToken.start,
    tokenEnd: currentToken.end,
    token: currentToken.textBeforeCursor,
    tokenLower: currentToken.textBeforeCursor.toLowerCase(),
    hasTrailingSpace: currentToken.isVirtual,
  }
}
