export function normalizeRemoteAbsolutePath(value) {
  let normalized = String(value || '').trim().replace(/^['"]|['"]$/g, '')
  if (normalized.startsWith('@')) {
    normalized = normalized.slice(1)
  }
  return normalized.startsWith('/') ? normalized : ''
}

function getSafeCursorPosition(inputValue, cursorPosition) {
  const raw = String(inputValue || '')
  const fallback = raw.length
  if (!Number.isFinite(cursorPosition)) {
    return fallback
  }
  return Math.max(0, Math.min(raw.length, Number(cursorPosition)))
}

function splitShellSegments(raw) {
  const segments = []
  let segmentStart = 0
  let quote = null
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

function findActiveSegment(segments, safeCursor) {
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

function tokenizeShellSegment(raw, start, end) {
  const tokens = []
  let tokenStart = null
  let quote = null
  let escaped = false

  const pushToken = (tokenEnd) => {
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

function getCurrentTokenInfo(raw, tokens, safeCursor) {
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

export function finalizeReplacementValue(prefix, replacement, suffix, appendSpace = false) {
  let normalizedReplacement = String(replacement || '')
  if (appendSpace && (!suffix || !/^[\s;&|]/.test(suffix))) {
    normalizedReplacement = `${normalizedReplacement} `
  }
  return `${prefix}${normalizedReplacement}${suffix}`
}

export function buildCommandReplacementValue(context, replacement, appendSpace = false) {
  return finalizeReplacementValue(
    context.raw.slice(0, context.commandStart),
    replacement,
    context.raw.slice(context.segmentEnd),
    appendSpace,
  )
}

export function buildTokenReplacementValue(context, replacement, appendSpace = false) {
  return finalizeReplacementValue(
    context.raw.slice(0, context.tokenStart),
    replacement,
    context.raw.slice(context.tokenEnd),
    appendSpace,
  )
}

export function parseCommandInputContext(inputValue, { cursorPosition, currentCwd } = {}) {
  const raw = String(inputValue || '')
  const safeCursor = getSafeCursorPosition(raw, cursorPosition)
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
    currentCwd: normalizeRemoteAbsolutePath(currentCwd) || '/',
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