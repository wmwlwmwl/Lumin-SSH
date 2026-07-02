import { isValidRemoteAbsolutePath } from './aiMentions.js'

function normalizeFilePaths(paths) {
  return Array.isArray(paths)
    ? paths
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim())
    : []
}

function formatUserTimeZone(now) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60
  return `${timeZone}, UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function buildExecutionContextLines(snapshot) {
  const lines = []

  lines.push('# 当前终端会话')
  if (snapshot.sessionId) {
    lines.push(`会话ID: ${snapshot.sessionId}`)
  }
  if (snapshot.terminalId) {
    lines.push(`终端ID: ${snapshot.terminalId}`)
  }

  lines.push('')
  lines.push('# 当��目录')
  lines.push(snapshot.currentPath || '/')

  if (snapshot.openFilePaths.length > 0) {
    lines.push('')
    lines.push('# 当前打开文件')
    snapshot.openFilePaths.forEach((filePath) => {
      lines.push(filePath)
    })
  }

  if (snapshot.activeFilePath) {
    lines.push('')
    lines.push('# 当前活动文件')
    lines.push(snapshot.activeFilePath)
  }

  lines.push('')
  lines.push('# 当前时间')
  lines.push(`UTC时间: ${snapshot.currentTimeISO}`)
  lines.push(`用户时区: ${snapshot.userTimeZone}`)

  return lines
}

export function getExecutionContextSnapshot({ sessionId = '', terminalId = '' } = {}) {
  const now = new Date()
  const editorState = window?.__luminEditorStates?.[sessionId] || {}
  const openFilePaths = normalizeFilePaths(editorState.openFilePaths)
  const activeFilePath = normalizeFilePaths([editorState.activeFilePath])[0] || ''
  const currentPath = isValidRemoteAbsolutePath(window?.__luminFileManagerPaths?.[sessionId]) || '/'

  return {
    sessionId: typeof sessionId === 'string' ? sessionId.trim() : '',
    terminalId: typeof terminalId === 'string' ? terminalId.trim() : '',
    currentPath,
    openFilePaths,
    activeFilePath,
    currentTimeISO: now.toISOString(),
    userTimeZone: formatUserTimeZone(now),
  }
}

export function buildExecutionContextCardText(snapshot) {
  const lines = buildExecutionContextLines(snapshot)
  return lines.join('\n').trim()
}

export function buildExecutionContextDetails(snapshot) {
  const detailsText = buildExecutionContextCardText(snapshot)
  if (!detailsText) {
    return ''
  }
  return `<environment_details>\n${detailsText}\n</environment_details>`
}