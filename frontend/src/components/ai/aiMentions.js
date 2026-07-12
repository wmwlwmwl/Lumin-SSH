import { t, getLanguage } from '../../i18n.js'

const longTextWrapExtension = '.long_text_wrap'

export const mentionRegex = /(?:^|(?<=\s))(?<!\\)@((?:\/)(?:[^\s\\]|\\ )+\/?|terminal\b)(?=[.,;:!?]?(?=[\s\r\n]|$))/i
export const mentionRegexGlobal = new RegExp(mentionRegex.source, 'gi')

const terminalMentionRegexGlobal = /(?:^|(?<=\s))(?<!\\)@(terminal)(?=[.,;:!?]?(?=[\s\r\n]|$))/gi
const remotePathMentionRegexGlobal = /(?:^|(?<=\s))(?<!\\)@((?:\/)(?:[^\s\\]|\\ )+\/?)(?=[.,;:!?]?(?=[\s\r\n]|$))/g

const maxRemoteMentionResults = 60
const maxRemoteMentionVisitedDirs = 160
const maxRemoteMentionDepth = 6

export function escapeMentionPathSpaces(value) {
  return String(value || '').replace(/ /g, '\\ ')
}

export function unescapeMentionPathSpaces(value) {
  return String(value || '').replace(/\\ /g, ' ')
}

export function normalizeMentionAbsolutePath(value) {
  let normalized = String(value || '').trim()
  normalized = normalized.replace(/^['"]|['"]$/g, '')
  if (normalized.startsWith('@')) {
    normalized = normalized.slice(1)
  }
  return normalized.startsWith('/') ? normalized : ''
}

export function isValidRemoteAbsolutePath(value) {
  return normalizeMentionAbsolutePath(value)
}

function isLongTextWrapPath(value) {
  const normalized = normalizeMentionAbsolutePath(value)
  return normalized.toLowerCase().endsWith(longTextWrapExtension)
}

export function buildRemoteFileMention(value) {
  const remotePath = isValidRemoteAbsolutePath(value)
  if (!remotePath) {
    return ''
  }
  return `@${escapeMentionPathSpaces(remotePath.replace(/\/+$/g, ''))}`
}

export function buildRemoteFolderMention(value) {
  const remotePath = isValidRemoteAbsolutePath(value)
  if (!remotePath) {
    return ''
  }
  const normalizedPath = remotePath.replace(/\/+$/g, '')
  return `@${escapeMentionPathSpaces(`${normalizedPath}/`)}`
}

export function buildTerminalMention() {
  return '@terminal'
}

export function insertRemoteFileMention(text, position, mention) {
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

export function removeMention(text, position) {
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

export function getMentionContext(text, position) {
  const sourceText = typeof text === 'string' ? text : ''
  const cursorPosition = Number.isFinite(position) ? position : sourceText.length
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


function normalizeRemoteDirEntries(entries) {
  return Array.isArray(entries)
    ? entries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          name: typeof entry.name === 'string' ? entry.name.trim() : '',
          isDirectory: Boolean(entry.isDirectory),
        }))
        .filter((entry) => entry.name)
    : []
}

function joinRemotePath(basePath, name) {
  const normalizedBasePath = isValidRemoteAbsolutePath(basePath) || '/'
  const trimmedBasePath = normalizedBasePath === '/' ? '/' : normalizedBasePath.replace(/\/+$/g, '')
  return trimmedBasePath === '/' ? `/${name}` : `${trimmedBasePath}/${name}`
}

function sortRemoteMentionCandidates(candidates) {
  const locale = getLanguage() || 'zh-CN'
  return [...candidates].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'folder' ? -1 : 1
    }
    return left.path.localeCompare(right.path, locale)
  })
}

async function searchDirectAbsoluteMentionCandidates({
  sessionId,
  explicitAbsoluteQuery,
  selectedType,
  listDir,
  maxResults = maxRemoteMentionResults,
}) {
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

  let entries = []
  try {
    entries = normalizeRemoteDirEntries(await listDir(sessionId, parentDir))
  } catch {
    return []
  }

  const results = []
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

async function resolveRemoteMentionBaseDir(sessionId, getCurrentCwd) {
  if (!sessionId || typeof getCurrentCwd !== 'function') {
    return '/'
  }
  try {
    const cwd = await getCurrentCwd(sessionId)
    return isValidRemoteAbsolutePath(cwd) || '/'
  } catch {
    return '/'
  }
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
}) {
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
  const seen = new Set()
  const results = []
  const queue = [{ path: baseDir, depth: 0 }]
  let visitedDirs = 0

  while (queue.length > 0 && results.length < maxResults && visitedDirs < maxVisitedDirs) {
    const current = queue.shift()
    if (!current) {
      break
    }

    visitedDirs += 1

    let entries = []
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

async function buildRemoteFolderMentionContent(sessionId, remotePath, listDir, readFile) {
  const normalizedFolderPath = isValidRemoteAbsolutePath(remotePath)
  if (!normalizedFolderPath) {
    throw new Error('Invalid remote folder path')
  }

  if (typeof listDir !== 'function') {
    throw new Error('Folder listing is unavailable')
  }

  const folderPathWithoutTrailingSlash = normalizedFolderPath.replace(/\/+$/g, '')
  const entries = normalizeRemoteDirEntries(await listDir(sessionId, folderPathWithoutTrailingSlash))
  if (entries.length === 0) {
    return '(Empty folder)'
  }

  const treeLines = []
  const fileContents = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const childPath = joinRemotePath(folderPathWithoutTrailingSlash, entry.name)
    const treePrefix = index === entries.length - 1 ? '└── ' : '├── '
    treeLines.push(`${treePrefix}${entry.name}${entry.isDirectory ? '/' : ''}`)

    if (entry.isDirectory || typeof readFile !== 'function') {
      continue
    }

    try {
      const content = await readFile(sessionId, childPath)
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

export async function processAIMentions(
  text,
  {
    sessionId = '',
    readFile,
    listDir,
    getTerminalOutput,
    readLocalWrappedFile,
  } = {},
) {
  const sourceText = typeof text === 'string' ? text : ''
  const trimmedText = sourceText.trim()
  if (!trimmedText) {
    return trimmedText
  }

  const mentions = []
  const mentionKeys = new Set()

  let replacedText = trimmedText.replace(terminalMentionRegexGlobal, () => {
    if (!mentionKeys.has('terminal')) {
      mentionKeys.add('terminal')
      mentions.push({ kind: 'terminal' })
    }
    return 'Terminal Output (see below for output)'
  })

  replacedText = replacedText.replace(remotePathMentionRegexGlobal, (match, mention) => {
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

  const contentBlocks = []

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
        const content = typeof readLocalWrappedFile === 'function' ? await readLocalWrappedFile(mention.path) : ''
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
      const content = typeof readFile === 'function' ? await readFile(sessionId, mention.path) : ''
      contentBlocks.push(`<file_content path="${pathLabel}">\n${String(content || '').trim()}\n</file_content>`)
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      contentBlocks.push(`<file_content path="${pathLabel}">\nError fetching content: ${errorText}\n</file_content>`)
    }
  }

  return `${replacedText.trim()}\n\n${contentBlocks.join('\n\n')}`.trim()
}

export async function processRemoteFileMentions(text, sessionIdOrOptions, readFile) {
  if (sessionIdOrOptions && typeof sessionIdOrOptions === 'object') {
    return processAIMentions(text, sessionIdOrOptions)
  }
  return processAIMentions(text, {
    sessionId: sessionIdOrOptions,
    readFile,
  })
}