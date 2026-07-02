import { t } from '../../i18n.js'

const slashCommandNamePattern = /^[a-zA-Z0-9_.-]+$/
export const commandRegex = /^(\s*)(\/([a-zA-Z0-9_.-]+))(?=(\s|$))/
export function normalizeSlashCommandName(value) {
  const normalized = String(value || '').trim().replace(/^\/+/, '')
  if (!normalized || !slashCommandNamePattern.test(normalized)) {
    return ''
  }
  return normalized
}
function normalizeSlashCommandPrompt(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}
export function normalizeAISlashCommands(commands) {
  if (!Array.isArray(commands)) {
    return []
  }
  const seen = new Set()
  const normalized = []
  commands.forEach((command) => {
    if (!command || typeof command !== 'object') {
      return
    }
    const name = normalizeSlashCommandName(command.name)
    const prompt = normalizeSlashCommandPrompt(command.prompt)
    if (!name || !prompt) {
      return
    }
    const dedupeKey = name.toLowerCase()
    if (seen.has(dedupeKey)) {
      return
    }
    seen.add(dedupeKey)
    normalized.push({ name, prompt })
  })
  return normalized
}
export function findAISlashCommandByName(commands, name) {
  const normalizedCommands = normalizeAISlashCommands(commands)
  const normalizedName = normalizeSlashCommandName(name).toLowerCase()
  if (!normalizedName) {
    return null
  }
  return normalizedCommands.find((command) => command.name.toLowerCase() === normalizedName) || null
}
export function getSlashCommandMenuContext(text, position) {
  const sourceText = typeof text === 'string' ? text : ''
  const cursorPosition = Number.isFinite(position) ? position : sourceText.length
  const firstLineEnd = sourceText.search(/\r?\n/)
  const firstLine = firstLineEnd === -1 ? sourceText : sourceText.slice(0, firstLineEnd)
  if (!firstLine.startsWith('/')) {
    return null
  }
  const firstWhitespaceIndex = firstLine.search(/\s/)
  const tokenEnd = firstWhitespaceIndex === -1 ? firstLine.length : firstWhitespaceIndex
  if (cursorPosition > tokenEnd) {
    return null
  }
  const token = sourceText.slice(0, tokenEnd)
  const match = token.match(/^\/([a-zA-Z0-9_.-]*)$/)
  if (!match) {
    return null
  }
  return {
    query: match[1] || '',
    replaceStart: 0,
    replaceEnd: tokenEnd,
  }
}
function summarizeSlashCommandPrompt(prompt) {
  const normalized = normalizeSlashCommandPrompt(prompt).replace(/\s+/g, ' ')
  if (!normalized) {
    return t('未填写提示词内容')
  }
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized
}
export function buildSlashCommandMenuItems(commands, query) {
  const normalizedCommands = normalizeAISlashCommands(commands)
  const normalizedQuery = String(query || '').trim().toLowerCase()
  return normalizedCommands
    .filter((command) => {
      if (!normalizedQuery) {
        return true
      }
      return command.name.toLowerCase().includes(normalizedQuery) || command.prompt.toLowerCase().includes(normalizedQuery)
    })
    .map((command) => ({
      kind: 'slash_command',
      name: command.name,
      title: `/${command.name}`,
      description: summarizeSlashCommandPrompt(command.prompt),
    }))
}
export function insertSlashCommandToken(text, position, commandName) {
  const sourceText = typeof text === 'string' ? text : ''
  const normalizedName = normalizeSlashCommandName(commandName)
  const context = getSlashCommandMenuContext(sourceText, position)
  if (!context || !normalizedName) {
    return {
      newValue: sourceText,
      nextCursorPosition: Number.isFinite(position) ? position : sourceText.length,
    }
  }
  const trailingText = sourceText.slice(context.replaceEnd).replace(/^\s*/, '')
  const commandToken = `/${normalizedName} `
  return {
    newValue: `${commandToken}${trailingText}`,
    nextCursorPosition: commandToken.length,
  }
}
function escapeSlashCommandXMLAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
export function expandFirstSlashCommandForPrompt(text, commands) {
  const sourceText = typeof text === 'string' ? text : ''
  const match = sourceText.match(commandRegex)
  if (!match) {
    return {
      transformedText: sourceText,
      command: null,
    }
  }
  const commandName = match[3]
  const command = findAISlashCommandByName(commands, commandName)
  if (!command) {
    return {
      transformedText: sourceText,
      command: null,
    }
  }
  const transformedText = sourceText.replace(
    commandRegex,
    `${match[1]}Command '${command.name}' (see below for command content)`,
  )
  return {
    transformedText: `${transformedText}\n\n<command name="${escapeSlashCommandXMLAttribute(command.name)}">\n${command.prompt}\n</command>`,
    command,
  }
}