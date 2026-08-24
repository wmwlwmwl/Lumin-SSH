// 桥接模块（自 .js 收编后类型化）：AI 输入区 mention/@ 提及解析与远端路径补全
import { t, getLanguage } from '../../i18n.ts'

const longTextWrapExtension = '.long_text_wrap'

export const mentionRegex = /(?:^|(?<=\s))(?<!\\)@((?:\/)(?:[^\s\\]|\\\\|\\ )+\/?|terminal\b)(?=[.,;:!?]?(?=[\s\r\n]|$))/i
export const mentionRegexGlobal = new RegExp(mentionRegex.source, 'gi')

const terminalMentionRegexGlobal = /(?:^|(?<=\s))(?<!\\)@(terminal)(?=[.,;:!?]?(?=[\s\r\n]|$))/gi
const remotePathMentionRegexGlobal = /(?:^|(?<=\s))(?<!\\)@((?:\/)(?:[^\s\\]|\\\\|\\ )+\/?)(?=[.,;:!?]?(?=[\s\r\n]|$))/g

const maxRemoteMentionResults = 60
const maxRemoteMentionVisitedDirs = 160
const maxRemoteMentionDepth = 6

// 路径 → 提及文本 的完整转义:反斜杠与空格都转义,保证任意文件名可无损往返
// (此前仅转义空格,含字面反斜杠的远端文件名无法被正则重新解析)
function escapeMentionPathSpaces(value: unknown): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/ /g, '\\ ')
}

function unescapeMentionPathSpaces(value: unknown): string {
  return String(value || '').replace(/\\([\\ ])/g, '$1')
}

function normalizeMentionAbsolutePath(value: unknown): string {
  let normalized = String(value || '').trim()
  normalized = normalized.replace(/^['"]|['"]$/g, '')
  if (normalized.startsWith('@')) {
    normalized = normalized.slice(1)
  }
  return normalized.startsWith('/') ? normalized : ''
}

export function isValidRemoteAbsolutePath(value: unknown): string {
  return normalizeMentionAbsolutePath(value)
}

function isLongTextWrapPath(value: unknown): boolean {
  const normalized = normalizeMentionAbsolutePath(value)
  return normalized.toLowerCase().endsWith(longTextWrapExtension)
}

export function buildRemoteFileMention(value: unknown): string {
  const remotePath = isValidRemoteAbsolutePath(value)
  if (!remotePath) {
    return ''
  }
  return `@${escapeMentionPathSpaces(remotePath.replace(/\/+$/g, ''))}`
}

export function buildRemoteFolderMention(value: unknown): string {
  const remotePath = isValidRemoteAbsolutePath(value)
  if (!remotePath) {
    return ''
  }
  const normalizedPath = remotePath.replace(/\/+$/g, '')
  return `@${escapeMentionPathSpaces(`${normalizedPath}/`)}`
}

export function buildTerminalMention(): string {
  return '@terminal'
}

export function insertRemoteFileMention(text: unknown, position: number, mention: unknown): { newValue: string; mentionIndex: number } {
  const sourceText = typeof text === 'string' ? text : ''
  const mentionValue = String(mention || '').trim().replace(/^@/, '')
  const beforeCursor = sourceText.slice(0, position)
  const afterCursor = sourceText.slice(position)
  const lastAtIndex = beforeCursor.lastIndexOf('@')
  let newValue = ''
  let mentionIndex = position

  if (lastAtIndex !== -1) {
    const beforeMention = sourceText.slice(0, lastAtIndex)
    const afterCursorContent = /^[a-zA-Z0-9\s]*$/.test(afterCursor)
      ? afterCursor.replace(/^[^\s]*/, '')
      : afterCursor
    newValue = `${beforeMention}@${mentionValue} ${afterCursorContent}`
    mentionIndex = lastAtIndex
  } else {
    newValue = `${beforeCursor}@${mentionValue} ${afterCursor}`
    mentionIndex = position
  }

  return { newValue, mentionIndex }
}

export function removeMention(text: unknown, position: number): { newText: string; newPosition: number } {
  const sourceText = typeof text === 'string' ? text : ''
  const beforeCursor = sourceText.slice(0, position)
  const afterCursor = sourceText.slice(position)
  const matchEnd = beforeCursor.match(new RegExp(`${mentionRegex.source}$`, 'i'))

  if (matchEnd) {
    const mentionLength = matchEnd[0].length
    const newText = sourceText.slice(0, position - mentionLength) + afterCursor.replace(/^\s/, '')
    const newPosition = position - mentionLength
    return { newText, newPosition }
  }

  return { newText: sourceText, newPosition: position }
}

/** 光标处的 mention 上下文（@ 之后到光标前的文本） */
export interface MentionContext {
  mentionIndex: number
  query: string
  afterCursor: string
}

export function getMentionContext(text: unknown, position: unknown): MentionContext | null {
  const sourceText = typeof text === 'string' ? text : ''
  const cursorPosition = typeof position === 'number' && Number.isFinite(position) ? position : sourceText.length
  const beforeCursor = sourceText.slice(0, cursorPosition)
  const lastAtIndex = beforeCursor.lastIndexOf('@')
  if (lastAtIndex === -1) {
    return null
  }

  const textAfterAt = beforeCursor.slice(lastAtIndex + 1)
  if (/(?<!\\)\s/.test(textAfterAt)) {
    return null
  }
  if (textAfterAt.toLowerCase().startsWith('http')) {
    return null
  }

  return {
    mentionIndex: lastAtIndex,
    query: textAfterAt,
    afterCursor: sourceText.slice(cursorPosition),
  }
}

/** 远端目录条目（listDir 回调产出的宽松形状归一化） */
interface NormalizedRemoteDirEntry {
  name: string
  isDirectory: boolean
}

/** 远端 mention 补全候选 */
export interface RemoteMentionCandidate {
  type: 'folder' | 'file'
  path: string
  label: string
  description: string
}

function normalizeRemoteDirEntries(entries: unknown): NormalizedRemoteDirEntry[] {
  return Array.isArray(entries)
    ? entries
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
          name: typeof entry.name === 'string' ? entry.name.trim() : '',
          isDirectory: Boolean(entry.isDirectory),
        }))
        .filter((entry) => entry.name)
    : []
}

function joinRemotePath(basePath: string, name: string): string {
  const normalizedBasePath = isValidRemoteAbsolutePath(basePath) || '/'
  const trimmedBasePath = normalizedBasePath === '/' ? '/' : normalizedBasePath.replace(/\/+$/g, '')
  return trimmedBasePath === '/' ? `/${name}` : `${trimmedBasePath}/${name}`
}

function sortRemoteMentionCandidates(candidates: RemoteMentionCandidate[]): RemoteMentionCandidate[] {
  const locale = getLanguage() || 'zh-CN'
  return [...candidates].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'folder' ? -1 : 1
    }
    return left.path.localeCompare(right.path, locale)
  })
}

interface RemoteMentionSearchOptions {
  sessionId: string
  explicitAbsoluteQuery: string
  selectedType: 'folder' | 'file' | null
  listDir: (sessionId: string, path: string) => Promise<unknown> | unknown
  maxResults: number
}

async function searchDirectAbsoluteMentionCandidates({
  sessionId,
  explicitAbsoluteQuery,
  selectedType,
  listDir,
  maxResults = maxRemoteMentionResults,
}: RemoteMentionSearchOptions): Promise<RemoteMentionCandidate[]> {
  const normalizedAbsoluteQuery = isValidRemoteAbsolutePath(explicitAbsoluteQuery)
  if (!normalizedAbsoluteQuery || typeof listDir !== 'function' || !sessionId) {
    return []
  }

  const isRootQuery = normalizedAbsoluteQuery === '/'
  const browseChildren = !isRootQuery && normalizedAbsoluteQuery.endsWith('/')
  const normalizedQueryWithoutTrailingSlash = isRootQuery ? '/' : normalizedAbsoluteQuery.replace(/\/+$/g, '')
  const parentDir = browseChildren
    ? normalizedQueryWithoutTrailingSlash
    : (() => {
        const lastSlashIndex = normalizedQueryWithoutTrailingSlash.lastIndexOf('/')
        return lastSlashIndex <= 0 ? '/' : normalizedQueryWithoutTrailingSlash.slice(0, lastSlashIndex)
      })()
  const partialName = browseChildren || isRootQuery
    ? ''
    : normalizedQueryWithoutTrailingSlash.slice(normalizedQueryWithoutTrailingSlash.lastIndexOf('/') + 1).toLowerCase()

  let entries: NormalizedRemoteDirEntry[] = []
  try {
    entries = normalizeRemoteDirEntries(await listDir(sessionId, parentDir))
  } catch {
    return []
  }

  const results: RemoteMentionCandidate[] = []
  for (const entry of entries) {
    const absolutePath = joinRemotePath(parentDir, entry.name)
    const mentionPath = entry.isDirectory ? `${absolutePath.replace(/\/+$/g, '')}/` : absolutePath
    const candidateType = entry.isDirectory ? 'folder' : 'file'
    const typeMatches = selectedType ? candidateType === selectedType : true
    const matchesQuery = partialName === ''
      ? true
      : entry.name.toLowerCase().includes(partialName) || mentionPath.toLowerCase().startsWith(normalizedAbsoluteQuery.toLowerCase())

    if (typeMatches && matchesQuery) {
      results.push({
        type: candidateType,
        path: mentionPath,
        label: entry.name,
        description: candidateType === 'folder' ? t('远端文件夹') : t('远端文件'),
      })
      if (results.length >= maxResults) {
        break
      }
    }
  }

  return sortRemoteMentionCandidates(results)
}

async function resolveRemoteMentionBaseDir(sessionId: string, getCurrentCwd: unknown): Promise<string> {
  if (!sessionId || typeof getCurrentCwd !== 'function') {
    return '/'
  }
  try {
    const cwd = await (getCurrentCwd as (sessionId: string) => Promise<unknown> | unknown)(sessionId)
    return isValidRemoteAbsolutePath(cwd) || '/'
  } catch {
    return '/'
  }
}

export interface RemoteMentionQueryOptions {
  sessionId?: string
  query?: string
  selectedType?: 'folder' | 'file' | null
  getCurrentCwd?: (sessionId: string) => Promise<unknown> | unknown
  listDir?: (sessionId: string, path: string) => Promise<unknown> | unknown
  maxResults?: number
  maxVisitedDirs?: number
  maxDepth?: number
}

export async function searchRemoteMentionCandidates({
  sessionId,
  query = '',
  selectedType = null,
  getCurrentCwd,
  listDir,
  maxResults = maxRemoteMentionResults,
  maxVisitedDirs = maxRemoteMentionVisitedDirs,
  maxDepth = maxRemoteMentionDepth,
}: RemoteMentionQueryOptions): Promise<RemoteMentionCandidate[]> {
  if (!sessionId || typeof listDir !== 'function') {
    return []
  }

  const baseDir = await resolveRemoteMentionBaseDir(sessionId, getCurrentCwd)
  const normalizedQuery = unescapeMentionPathSpaces(String(query || '').trim().replace(/^@/, ''))
  const explicitAbsoluteQuery = normalizedQuery.startsWith('/') ? normalizedQuery : ''

  if (explicitAbsoluteQuery) {
    return searchDirectAbsoluteMentionCandidates({
      sessionId,
      explicitAbsoluteQuery,
      selectedType,
      listDir,
      maxResults,
    })
  }

  const queryNeedle = normalizedQuery.toLowerCase()
  const shouldRecurse = queryNeedle.length > 0
  const seen = new Set<string>()
  const results: RemoteMentionCandidate[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: baseDir, depth: 0 }]
  let visitedDirs = 0

  while (queue.length > 0 && results.length < maxResults && visitedDirs < maxVisitedDirs) {
    const current = queue.shift()
    if (!current) {
      break
    }

    visitedDirs += 1

    let entries: NormalizedRemoteDirEntry[] = []
    try {
      entries = normalizeRemoteDirEntries(await listDir(sessionId, current.path))
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolutePath = joinRemotePath(current.path, entry.name)
      const mentionPath = entry.isDirectory ? `${absolutePath.replace(/\/+$/g, '')}/` : absolutePath
      const candidateType = entry.isDirectory ? 'folder' : 'file'
      const typeMatches = selectedType ? candidateType === selectedType : true
      const matchesQuery = !queryNeedle || mentionPath.toLowerCase().includes(queryNeedle) || entry.name.toLowerCase().includes(queryNeedle)

      if (typeMatches && matchesQuery && !seen.has(mentionPath)) {
        results.push({
          type: candidateType,
          path: mentionPath,
          label: entry.name,
          description: candidateType === 'folder' ? t('远端文件夹') : t('远端文件'),
        })
        seen.add(mentionPath)
        if (results.length >= maxResults) {
          break
        }
      }

      if (entry.isDirectory && shouldRecurse && current.depth < maxDepth) {
        queue.push({
          path: absolutePath,
          depth: current.depth + 1,
        })
      }
    }

    if (!shouldRecurse) {
      break
    }
  }

  return sortRemoteMentionCandidates(results)
}

async function buildRemoteFolderMentionContent(
  sessionId: string,
  remotePath: string | undefined,
  listDir: unknown,
  readFile: unknown,
): Promise<string> {
  const normalizedFolderPath = isValidRemoteAbsolutePath(remotePath)
  if (!normalizedFolderPath) {
    throw new Error('Invalid remote folder path')
  }

  if (typeof listDir !== 'function') {
    throw new Error('Folder listing is unavailable')
  }

  const folderPathWithoutTrailingSlash = normalizedFolderPath.replace(/\/+$/g, '')
  const entries = normalizeRemoteDirEntries(await (listDir as (sessionId: string, path: string) => Promise<unknown> | unknown)(sessionId, folderPathWithoutTrailingSlash))
  if (entries.length === 0) {
    return '(Empty folder)'
  }

  const treeLines: string[] = []
  const fileContents: string[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const childPath = joinRemotePath(folderPathWithoutTrailingSlash, entry.name)
    const treePrefix = index === entries.length - 1 ? '└── ' : '├── '
    treeLines.push(`${treePrefix}${entry.name}${entry.isDirectory ? '/' : ''}`)

    if (entry.isDirectory || typeof readFile !== 'function') {
      continue
    }

    try {
      const content = await (readFile as (sessionId: string, path: string) => Promise<unknown> | unknown)(sessionId, childPath)
      fileContents.push(
        `<file_content path="${escapeMentionPathSpaces(childPath)}">\n${String(content || '').trim()}\n</file_content>`,
      )
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      fileContents.push(
        `<file_content path="${escapeMentionPathSpaces(childPath)}">\nError fetching content: ${errorText}\n</file_content>`,
      )
    }
  }

  return `${treeLines.join('\n')}${fileContents.length > 0 ? `\n\n${fileContents.join('\n\n')}` : ''}`.trim()
}

/** AI 输入区 @mention 种类 */
type AIMentionKind = 'terminal' | 'file' | 'folder' | 'wrapped'

interface AIMention {
  kind: AIMentionKind
  path?: string
}

interface AIMentionProcessOptions {
  sessionId?: string
  readFile?: (sessionId: string, path: string) => Promise<unknown> | unknown
  listDir?: (sessionId: string, path: string) => Promise<unknown> | unknown
  getTerminalOutput?: () => Promise<unknown> | unknown
  readLocalWrappedFile?: (path: string) => Promise<unknown> | unknown
}

async function processAIMentions(
  text: unknown,
  {
    sessionId = '',
    readFile,
    listDir,
    getTerminalOutput,
    readLocalWrappedFile,
  }: AIMentionProcessOptions = {},
): Promise<string> {
  const sourceText = typeof text === 'string' ? text : ''
  const trimmedText = sourceText.trim()
  if (!trimmedText) {
    return trimmedText
  }

  const mentions: AIMention[] = []
  const mentionKeys = new Set<string>()

  let replacedText = trimmedText.replace(terminalMentionRegexGlobal, () => {
    if (!mentionKeys.has('terminal')) {
      mentionKeys.add('terminal')
      mentions.push({ kind: 'terminal' })
    }
    return 'Terminal Output (see below for output)'
  })

  replacedText = replacedText.replace(remotePathMentionRegexGlobal, (match: string, mention: string) => {
    const unescapedPath = unescapeMentionPathSpaces(mention)
    const normalizedPath = normalizeMentionAbsolutePath(unescapedPath)
    if (!normalizedPath) {
      return match
    }

    const isWrappedFile = isLongTextWrapPath(normalizedPath)
    const isFolder = !isWrappedFile && normalizedPath.endsWith('/')
    const mentionKey = `${isWrappedFile ? 'wrapped' : isFolder ? 'folder' : 'file'}:${normalizedPath}`
    if (!mentionKeys.has(mentionKey)) {
      mentionKeys.add(mentionKey)
      mentions.push({
        kind: isWrappedFile ? 'wrapped' : isFolder ? 'folder' : 'file',
        path: normalizedPath,
      })
    }

    return `'${mention}' (see below for ${isWrappedFile ? 'wrapped text' : isFolder ? 'folder' : 'file'} content)`
  })

  if (mentions.length === 0) {
    return trimmedText
  }

  const contentBlocks: string[] = []

  for (const mention of mentions) {
    if (mention.kind === 'terminal') {
      try {
        const output = typeof getTerminalOutput === 'function' ? await getTerminalOutput() : ''
        const terminalText = String(output || '').trim() || '(No terminal output available)'
        contentBlocks.push(`<terminal_output>\n${terminalText}\n</terminal_output>`)
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error)
        contentBlocks.push(`<terminal_output>\nError fetching terminal output: ${errorText}\n</terminal_output>`)
      }
      continue
    }

    if (!sessionId) {
      const pathLabel = escapeMentionPathSpaces(mention.path)
      contentBlocks.push(
        mention.kind === 'folder'
          ? `<folder_content path="${pathLabel}">\nError fetching content: Missing terminal session\n</folder_content>`
          : `<file_content path="${pathLabel}">\nError fetching content: Missing terminal session\n</file_content>`,
      )
      continue
    }

    if (mention.kind === 'wrapped') {
      const pathLabel = escapeMentionPathSpaces(mention.path)
      try {
        const content = typeof readLocalWrappedFile === 'function' ? await readLocalWrappedFile(mention.path || '') : ''
        contentBlocks.push(`<file_content path="${pathLabel}">\n${String(content || '').trim()}\n</file_content>`)
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error)
        contentBlocks.push(`<file_content path="${pathLabel}">\nError fetching content: ${errorText}\n</file_content>`)
      }
      continue
    }

    if (mention.kind === 'folder') {
      const pathLabel = escapeMentionPathSpaces(mention.path)
      try {
        const content = await buildRemoteFolderMentionContent(sessionId, mention.path, listDir, readFile)
        contentBlocks.push(`<folder_content path="${pathLabel}">\n${content}\n</folder_content>`)
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error)
        contentBlocks.push(`<folder_content path="${pathLabel}">\nError fetching content: ${errorText}\n</folder_content>`)
      }
      continue
    }

    const pathLabel = escapeMentionPathSpaces(mention.path)
    try {
      const content = typeof readFile === 'function' ? await readFile(sessionId, mention.path || '') : ''
      contentBlocks.push(`<file_content path="${pathLabel}">\n${String(content || '').trim()}\n</file_content>`)
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      contentBlocks.push(`<file_content path="${pathLabel}">\nError fetching content: ${errorText}\n</file_content>`)
    }
  }

  return `${replacedText.trim()}\n\n${contentBlocks.join('\n\n')}`.trim()
}

export async function processRemoteFileMentions(
  text: unknown,
  sessionIdOrOptions: unknown,
  readFile?: (sessionId: string, path: string) => Promise<unknown> | unknown,
): Promise<string> {
  if (sessionIdOrOptions && typeof sessionIdOrOptions === 'object') {
    return processAIMentions(text, sessionIdOrOptions as AIMentionProcessOptions)
  }
  return processAIMentions(text, {
    sessionId: (sessionIdOrOptions as string | undefined) || '',
    readFile,
  })
}
