// 终端屏幕模拟（ANSI 归一化）：把原始终端输出还原为可见文本，
// 供 AI 提示词使用。纯函数，无 React / 后端依赖。

export type TerminalScreenLine = string[]
export type TerminalCursorState = { row: number; col: number }

export function splitTerminalOutputLinesKeepNewline(content: unknown) {
  if (!content) {
    return []
  }
  const matches = String(content).match(/[^\n]*\n|[^\n]+/g)
  return Array.isArray(matches) ? matches : []
}

export function truncateTerminalOutputForPrompt(content: unknown, lineLimit: unknown, characterLimit: unknown) {
  const normalizedContent = String(content || '')
  const normalizedLineLimit = Number.isFinite(Number(lineLimit)) ? Math.trunc(Number(lineLimit)) : 0
  const normalizedCharacterLimit = Number.isFinite(Number(characterLimit)) ? Math.trunc(Number(characterLimit)) : 0
  if (normalizedLineLimit <= 0 && normalizedCharacterLimit <= 0) {
    return normalizedContent
  }
  if (normalizedCharacterLimit > 0) {
    const runes = Array.from(normalizedContent)
    if (runes.length > normalizedCharacterLimit) {
      const beforeLimit = Math.floor(normalizedCharacterLimit / 5)
      const afterLimit = normalizedCharacterLimit - beforeLimit
      const startSection = runes.slice(0, beforeLimit).join('')
      const endSection = runes.slice(runes.length - afterLimit).join('')
      const omittedChars = runes.length - normalizedCharacterLimit
      return `${startSection}\n[...${omittedChars} characters omitted...]\n${endSection}`
    }
  }
  if (normalizedLineLimit <= 0) {
    return normalizedContent
  }
  const lines = splitTerminalOutputLinesKeepNewline(normalizedContent)
  const totalLines = lines.length
  if (totalLines <= normalizedLineLimit) {
    return normalizedContent
  }
  const beforeLimit = Math.floor(normalizedLineLimit / 5)
  const afterLimit = normalizedLineLimit - beforeLimit
  const startSection = lines.slice(0, beforeLimit).join('')
  const endSection = lines.slice(totalLines - afterLimit).join('')
  const omittedLines = totalLines - normalizedLineLimit
  return `${startSection}\n[...${omittedLines} lines omitted...]\n\n${endSection}`
}

export function applyTerminalOutputRunLengthEncoding(content: unknown) {
  if (!content) {
    return content
  }
  const lines = splitTerminalOutputLinesKeepNewline(content)
  if (lines.length === 0) {
    return content
  }
  let result = ''
  let prevLine = lines[0]
  let repeatCount = 0
  const flush = () => {
    if (repeatCount > 0) {
      const compressionDesc = `<previous line repeated ${repeatCount} additional times>\n`
      if (compressionDesc.length < prevLine.length * (repeatCount + 1)) {
        result += prevLine
        result += compressionDesc
      } else {
        for (let index = 0; index <= repeatCount; index += 1) {
          result += prevLine
        }
      }
      repeatCount = 0
      return
    }
    result += prevLine
  }
  for (let index = 1; index < lines.length; index += 1) {
    const currentLine = lines[index]
    if (currentLine === prevLine) {
      repeatCount += 1
      continue
    }
    flush()
    prevLine = currentLine
  }
  flush()
  return result
}

function ensureTerminalScreenRow(lines: TerminalScreenLine[], row: number) {
  while (lines.length <= row) {
    lines.push([])
  }
}

function trimTerminalScreenRightSpaces(line: TerminalScreenLine) {
  let end = line.length
  while (end > 0 && line[end - 1] === ' ') {
    end -= 1
  }
  return end === line.length ? line : line.slice(0, end)
}

function writeTerminalScreenChar(lines: TerminalScreenLine[], state: TerminalCursorState, char: string) {
  ensureTerminalScreenRow(lines, state.row)
  const line = lines[state.row]
  while (line.length < state.col) {
    line.push(' ')
  }
  if (state.col === line.length) {
    line.push(char)
  } else {
    line[state.col] = char
  }
  state.col += 1
}

function moveTerminalScreenCursor(lines: TerminalScreenLine[], state: TerminalCursorState, rowDelta: number, colDelta: number) {
  state.row += rowDelta
  if (state.row < 0) {
    state.row = 0
  }
  ensureTerminalScreenRow(lines, state.row)
  state.col += colDelta
  if (state.col < 0) {
    state.col = 0
  }
}

function eraseTerminalScreenLine(lines: TerminalScreenLine[], state: TerminalCursorState, mode: number) {
  ensureTerminalScreenRow(lines, state.row)
  const line = lines[state.row]
  if (mode === 1) {
    const limit = Math.min(state.col, line.length)
    for (let index = 0; index < limit; index += 1) {
      line[index] = ' '
    }
    lines[state.row] = trimTerminalScreenRightSpaces(line)
    return
  }
  if (mode === 2) {
    lines[state.row] = []
    state.col = 0
    return
  }
  if (state.col < line.length) {
    lines[state.row] = line.slice(0, state.col)
  }
}

function parseTerminalCSIParams(raw: unknown) {
  if (!raw) {
    return []
  }
  return String(raw).split(';').map((part) => {
    const value = Number.parseInt(String(part || '').trim(), 10)
    return Number.isFinite(value) ? value : 0
  })
}

function terminalCSIParamValue(params: unknown, index: number, fallback: number) {
  if (!Array.isArray(params) || index < 0 || index >= params.length) {
    return fallback
  }
  return params[index] > 0 ? params[index] : fallback
}

function applyTerminalCSICommand(finalChar: string, params: number[], lines: TerminalScreenLine[], state: TerminalCursorState) {
  if (finalChar === 'A') {
    moveTerminalScreenCursor(lines, state, -terminalCSIParamValue(params, 0, 1), 0)
  } else if (finalChar === 'B') {
    moveTerminalScreenCursor(lines, state, terminalCSIParamValue(params, 0, 1), 0)
  } else if (finalChar === 'C') {
    moveTerminalScreenCursor(lines, state, 0, terminalCSIParamValue(params, 0, 1))
  } else if (finalChar === 'D') {
    moveTerminalScreenCursor(lines, state, 0, -terminalCSIParamValue(params, 0, 1))
  } else if (finalChar === 'G') {
    state.col = Math.max(0, terminalCSIParamValue(params, 0, 1) - 1)
    ensureTerminalScreenRow(lines, state.row)
  } else if (finalChar === 'H' || finalChar === 'f') {
    state.row = Math.max(0, terminalCSIParamValue(params, 0, 1) - 1)
    state.col = Math.max(0, terminalCSIParamValue(params, 1, 1) - 1)
    ensureTerminalScreenRow(lines, state.row)
  } else if (finalChar === 'J') {
    const mode = terminalCSIParamValue(params, 0, 0)
    if (mode === 2 || mode === 3) {
      lines.splice(0, lines.length, [])
      state.row = 0
      state.col = 0
    }
  } else if (finalChar === 'K') {
    eraseTerminalScreenLine(lines, state, terminalCSIParamValue(params, 0, 0))
  }
}

function processTerminalOutputANSISequence(source: string, startIndex: number, lines: TerminalScreenLine[], state: TerminalCursorState) {
  if (startIndex + 1 >= source.length) {
    return 1
  }
  const nextChar = source[startIndex + 1]
  if (nextChar === '[') {
    let endIndex = startIndex + 2
    while (endIndex < source.length) {
      const code = source.charCodeAt(endIndex)
      if (code >= 0x40 && code <= 0x7e) {
        let rawParams = source.slice(startIndex + 2, endIndex)
        if (rawParams.startsWith('?') || rawParams.startsWith('>') || rawParams.startsWith('!')) {
          rawParams = rawParams.slice(1)
        }
        const params = parseTerminalCSIParams(rawParams)
        applyTerminalCSICommand(source[endIndex], params, lines, state)
        return endIndex - startIndex + 1
      }
      endIndex += 1
    }
    return source.length - startIndex
  }
  if (nextChar === ']') {
    let endIndex = startIndex + 2
    while (endIndex < source.length) {
      if (source.charCodeAt(endIndex) === 0x07) {
        return endIndex - startIndex + 1
      }
      if (source.charCodeAt(endIndex) === 0x1b && source[endIndex + 1] === '\\') {
        return endIndex - startIndex + 2
      }
      endIndex += 1
    }
    return source.length - startIndex
  }
  return 2
}

export function normalizeTerminalOutputScreen(input: unknown): string {
  const source = String(input || '')
  if (!source) {
    return ''
  }
  const lines = [[]]
  const state = { row: 0, col: 0 }
  for (let index = 0; index < source.length;) {
    const char = source[index]
    if (char === '\r') {
      state.col = 0
      index += 1
      continue
    }
    if (char === '\n') {
      state.row += 1
      state.col = 0
      ensureTerminalScreenRow(lines, state.row)
      index += 1
      continue
    }
    if (char === '\b') {
      if (state.col > 0) {
        state.col -= 1
      }
      index += 1
      continue
    }
    if (char === '\t') {
      let tabWidth = 4 - (state.col % 4)
      if (tabWidth <= 0) {
        tabWidth = 4
      }
      for (let step = 0; step < tabWidth; step += 1) {
        writeTerminalScreenChar(lines, state, ' ')
      }
      index += 1
      continue
    }
    if (source.charCodeAt(index) === 0x1b) {
      const consumed = processTerminalOutputANSISequence(source, index, lines, state)
      index += consumed > 0 ? consumed : 1
      continue
    }
    const codePoint = source.codePointAt(index) ?? -1
    if (!Number.isFinite(codePoint)) {
      index += 1
      continue
    }
    if ((codePoint >= 0 && codePoint < 0x20) || codePoint === 0x7f) {
      index += codePoint > 0xffff ? 2 : 1
      continue
    }
    const printable = String.fromCodePoint(codePoint)
    writeTerminalScreenChar(lines, state, printable)
    index += printable.length
  }
  let lastNonEmpty = lines.length - 1
  while (lastNonEmpty > 0 && trimTerminalScreenRightSpaces(lines[lastNonEmpty]).length === 0) {
    lastNonEmpty -= 1
  }
  return lines
    .slice(0, lastNonEmpty + 1)
    .map((line) => trimTerminalScreenRightSpaces(line).join(''))
    .join('\n')
}

export function compressTerminalOutputForPrompt(input: unknown, lineLimit: unknown, characterLimit: unknown) {
  const processed = normalizeTerminalOutputScreen(input)
  return truncateTerminalOutputForPrompt(applyTerminalOutputRunLengthEncoding(processed), lineLimit, characterLimit)
}
