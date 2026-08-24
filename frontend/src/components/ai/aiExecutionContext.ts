// 桥接模块（自 .js 收编后类型化）：AI 上下文快照（终端/文件/时区）
import { getLanguage } from '../../i18n.ts'
import { isValidRemoteAbsolutePath } from './aiMentions.ts'

function normalizeFilePaths(paths: unknown): string[] {
  return Array.isArray(paths)
    ? paths
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim())
    :[]
}

function formatUserTimeZone(now: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' :'-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60
  return `${timeZone}, UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** AI 上下文快照（getExecutionContextSnapshot 输出） */
export interface ExecutionContextSnapshot {
  sessionId: string
  terminalId: string
  currentPath: string
  openFilePaths: string[]
  activeFilePath: string
  currentTimeISO: string
  userTimeZone: string
}

function buildExecutionContextLines(snapshot: ExecutionContextSnapshot): string[] {
  const isChinese = String(getLanguage() || '').toLowerCase().startsWith('zh')
  const lines: string[] = []
  lines.push(isChinese ? '# 当前终端会话' : '# Current terminal session')
  if (snapshot.sessionId) {
    lines.push(`${isChinese ? '会话ID' : 'Session ID'}:${snapshot.sessionId}`)
  }
  if (snapshot.terminalId) {
    lines.push(`${isChinese ? '终端ID' : 'Terminal ID'}:${snapshot.terminalId}`)
  }
  if (snapshot.openFilePaths.length > 0) {
    lines.push('')
    lines.push(isChinese ? '# 当前打开文件' : '# Currently open files')
    snapshot.openFilePaths.forEach((filePath) => {
      lines.push(filePath)
    })
  }
  if (snapshot.activeFilePath) {
    lines.push('')
    lines.push(isChinese ? '# 当前活动文件' : '# Current active file')
    lines.push(snapshot.activeFilePath)
  }
  lines.push('')
  lines.push(isChinese ? '# 当前时间' : '# Current time')
  lines.push(`${isChinese ? 'UTC时间' : 'UTC time'}:${snapshot.currentTimeISO}`)
  return lines
}

export function getExecutionContextSnapshot({ sessionId = '', terminalId = '' } = {}): ExecutionContextSnapshot {
  const now = new Date()
  const editorState = (window?.__luminEditorStates?.[sessionId] ?? {}) as Record<string, unknown>
  const openFilePaths = normalizeFilePaths(editorState.openFilePaths)
  const activeFilePath = normalizeFilePaths([editorState.activeFilePath])[0] || ''
  const currentPath = isValidRemoteAbsolutePath(window?.__luminFileManagerPaths?.[sessionId]) || '/'

  return {
    sessionId:typeof sessionId === 'string' ? sessionId.trim() :'',
    terminalId:typeof terminalId === 'string' ? terminalId.trim() :'',
    currentPath,
    openFilePaths,
    activeFilePath,
    currentTimeISO:now.toISOString(),
    userTimeZone:formatUserTimeZone(now),
  }
}

function buildExecutionContextCardText(snapshot: ExecutionContextSnapshot): string {
  const lines = buildExecutionContextLines(snapshot)
  return lines.join('\n').trim()
}

export function buildExecutionContextDetails(snapshot: ExecutionContextSnapshot): string {
  const detailsText = buildExecutionContextCardText(snapshot)
  if (!detailsText) {
    return ''
  }
  return `<environment_details>\n${detailsText}\n</environment_details>`
}
