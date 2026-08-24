// 桥接模块（自 .js 收编后类型化）：AI 斜杠命令解析与菜单构建
import { t } from '../../i18n.ts'

const slashCommandNamePattern = /^[a-zA-Z0-9_.-]+$/
export const commandRegex = /^(\s*)(\/([a-zA-Z0-9_.-]+))(?=(\s|$))/

/** 归一化后的斜杠命令 */
export interface AISlashCommand {
  name: string
  prompt: string
}

/** 斜杠命令菜单项（buildSlashCommandMenuItems 输出） */
export interface SlashCommandMenuItem {
  kind: 'slash_command'
  name: string
  title: string
  description: string
}

export function normalizeSlashCommandName(value: unknown): string {
  const normalized = String(value || '').trim().replace(/^\/+/, '')
  if (!normalized || !slashCommandNamePattern.test(normalized)) {
    return ''
  }
  return normalized
}
function normalizeSlashCommandPrompt(value: unknown): string {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}
export function normalizeAISlashCommands(commands: unknown): AISlashCommand[] {
  if (!Array.isArray(commands)) {
    return []
  }
  const seen = new Set<string>()
  const normalized: AISlashCommand[] = []
  commands.forEach((command) => {
    if (!command || typeof command !== 'object') {
      return
    }
    const c = command as Record<string, unknown>
    const name = normalizeSlashCommandName(c.name)
    const prompt = normalizeSlashCommandPrompt(c.prompt)
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
function findAISlashCommandByName(commands: unknown, name: unknown): AISlashCommand | null {
  const normalizedCommands = normalizeAISlashCommands(commands)
  const normalizedName = normalizeSlashCommandName(name).toLowerCase()
  if (!normalizedName) {
    return null
  }
  return normalizedCommands.find((command) => command.name.toLowerCase() === normalizedName) || null
}
export function getSlashCommandMenuContext(text: unknown, position: unknown): { query: string; replaceStart: number; replaceEnd: number } | null {
  const sourceText = typeof text === 'string' ? text : ''
  const cursorPosition = typeof position === 'number' && Number.isFinite(position) ? position : sourceText.length
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
function summarizeSlashCommandPrompt(prompt: unknown): string {
  const normalized = normalizeSlashCommandPrompt(prompt).replace(/\s+/g, ' ')
  if (!normalized) {
    return t('未填写提示词内容')
  }
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized
}
export function buildSlashCommandMenuItems(commands: unknown, query: unknown): SlashCommandMenuItem[] {
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
      kind: 'slash_command' as const,
      name: command.name,
      title: `/${command.name}`,
      description: summarizeSlashCommandPrompt(command.prompt),
    }))
}
export function insertSlashCommandToken(text: unknown, position: unknown, commandName: unknown): { newValue: string; nextCursorPosition: number } {
  const sourceText = typeof text === 'string' ? text : ''
  const normalizedName = normalizeSlashCommandName(commandName)
  const context = getSlashCommandMenuContext(sourceText, position)
  if (!context || !normalizedName) {
    return {
      newValue: sourceText,
      nextCursorPosition: typeof position === 'number' && Number.isFinite(position) ? position : sourceText.length,
    }
  }
  const trailingText = sourceText.slice(context.replaceEnd).replace(/^\s*/, '')
  const commandToken = `/${normalizedName} `
  return {
    newValue: `${commandToken}${trailingText}`,
    nextCursorPosition: commandToken.length,
  }
}
function escapeSlashCommandXMLAttribute(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
export function expandFirstSlashCommandForPrompt(text: unknown, commands: unknown): { transformedText: string; command: AISlashCommand | null } {
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
