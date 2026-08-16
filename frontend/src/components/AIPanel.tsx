import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, FolderOpen, Loader2, Pencil, Scissors, Search } from 'lucide-react'
import { EventsOn } from '../../wailsjs/runtime/runtime.js'
import * as AppGo from '../../wailsjs/go/wailsapp/App.js'
import { useTranslation, t as translate, getLanguage, type I18nKey } from '../i18n.ts'
import AIPanelHeader from './ai/AIPanelHeader.tsx'
import AIConversationBackupSettings from './ai/AIConversationBackupSettings.tsx'
import AIPanelSettingsOverlay from './ai/AIPanelSettingsOverlay.tsx'
import AIComposer from './ai/AIComposer.tsx'
import { approveAIChatTools, assignAIChatToolTerminal, cancelAIChat, continueAIChatTool, disableAIChatCollaboration, listAIChatCommandTerminalCandidates, previewAIChatToolDiff, previewAIChatToolRestore, rejectAIChatTools, rejectAIChatToolsForQueuedSubmission, resolveAIChatFollowup, restoreAIChatTool, setAIChatSkipNextAutomaticRequest, startAIChat, startAIChatCollaboration, terminateAIChatTool } from './ai/aiChatBridge.ts'
import { buildAIConversationTokenLedger, condenseAIConversationContext, countAIConversationAPIMessageRawTokens, createAIConversation, createAIConversationSummarySubtask, deleteAIConversation, getAIAssistantFirstReply, getAIConversation, listAIConversations, normalizeAIConversationMessageSearchResult, normalizeAIConversationSnapshot, normalizeAIConversationTaskSettings, openAIConversationFolder, preprocessAIConversationLongText, readAIConversationWrappedFile, saveAIConversation, searchAIConversationMessages, subscribeAIConversationChanges, type AIConversationMessageSearchResult } from './ai/aiConversationBridge.ts'
import { buildExecutionContextDetails, getExecutionContextSnapshot } from './ai/aiExecutionContext.ts'
import { getAIGlobalSettings, normalizeAIGlobalSettings, saveAIGlobalSettings, type AIGlobalSettings } from './ai/aiGlobalSettingsBridge.ts'
import { getAIProviderState, getAIProviderTokenGroup, type AIProviderState } from './ai/aiProviderBridge.ts'
import type { AIProviderLike } from './ai/AIProviderSelector.tsx'
import { clearThemeToolPreviewPackage, loadThemePackages, setThemeToolPreviewPackage } from '../utils/theme.ts'
import { getMCPSettingsState, saveMCPGlobalServer, reloadMCPGlobalServers, deleteMCPGlobalServer, restartMCPClientServer, toggleMCPClientServer, toggleMCPClientServerDisabledForPrompts, updateMCPClientServerTimeout } from './ai/mcpClientBridge.ts'
import { processRemoteFileMentions } from './ai/aiMentions.ts'
import { expandFirstSlashCommandForPrompt } from './ai/aiSlashCommands.ts'
import AIChatConversation from './ai/chat/AIChatConversation.tsx'
import { getConversationBranchAnchor } from './ai/chat/aiChatMessageTopology.ts'
import { isCallMyVipProviderHost } from './ai/providerSpecialHosts.ts'
import { getAIProviderDefinition } from './ai/providers/index.ts'
import assistantThinkingActiveImg from '../assets/assistant-thinking-active.webm'
import Tiptop from './Tiptop.tsx'

// ============================================================
// AIPanel 类型契约（props 见 AIPanelProps；内部数据模型见下）
// ============================================================
// 来自 Go 桥或事件 payload 的外部数据形状：字段均以 typeof 守卫读取，
// 无索引签名（字段名拼错编译期报错）；新增字段时在此补充。
// ============================================================

/** AI 事件 payload 的宽松形状（按需取用字段） */
interface AIEventPayloadShape {
  sound?: unknown
}

/** AI 请求指标/耗时 payload（buildMetrics/buildReasoningDuration 输入） */
interface AIMetricsPayload {
  firstTokenMs?: unknown
  elapsedMs?: unknown
  tokensPerSecond?: unknown
}

/** API 历史消息的宽松形状（upsertAPIHistoryMessage 输入，字段守卫读取） */
interface AIAPIHistoryMessageLike {
  role?: unknown
  content?: unknown
  images?: unknown
  uiMessageIds?: unknown
  turnId?: unknown
  messageId?: unknown
  ts?: unknown
  cacheObjects?: unknown
}

/** AIPanel props 传入的设置形状（防御性可选，App 当前不传） */
interface AIPanelSettings {
  terminalOutputLineLimit?: unknown
  terminalOutputCharacterLimit?: unknown
}

interface AIPanelProps {
  width: string
  side: 'left' | 'right'
  sessionId: string
  terminalId: string
  sessionTerminals?: Array<{ id: string; label?: string }>
  settings?: AIPanelSettings
  onDevilModeChange?: (enabled: boolean) => void
  addToast?: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number
}

// AI 会话快照（来自 Go 侧 normalizeAIConversationSnapshot，字段可选、运行时确定）
interface AIConversationSnapshot {
  id: string
  title?: string
  createdAt?: number
  updatedAt?: number
  status?: string
  toolProtocol?: string
  messageCount?: number
  messages?: AIMessage[]
  apiMessages?: APIHistoryMessage[]
  settings?: unknown
  transient?: boolean
  toolScope?: string
  toolScopeSlot?: string
  archived?: boolean
  relationType?: string
  relationSource?: string
  parentConversationId?: string
  rootConversationId?: string
  parentTitleSnapshot?: string
  promptCacheBypassTimestamp?: string
  [key: string]: unknown
}

// AI 对话消息节点（kind 覆盖 user/assistant/reasoning/tool/command/followup/completion）
interface AIMessage {
  id: string
  turnId?: string
  kind: string
  text?: string
  images?: string[]
  time?: string
  metrics?: string[]
  streaming?: boolean
  status?: string
  duration?: string
  summary?: string
  actionLabel?: string
  question?: string
  questions?: Array<{ text?: string; options?: Array<{ answer?: string }> }>
  suggestions?: string[]
  requestId?: string
  extra?: Record<string, unknown>
  [key: string]: unknown
}

interface APIHistoryMessage {
  role: string
  content: string
  messageId: string
  uiMessageIds: string[]
  images: string[]
  cacheObjects: unknown
  ts: number
}

// 发送给 AI 桥的请求消息（buildRequestMessages 的产物，缺少 API 历史消息的簿记字段）
interface AIRequestMessage {
  role: string
  content: string
  images: string[]
  cacheObjects: unknown
}

interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  status?: string
  toolProtocol?: string
  messageCount: number
  promptCacheBypassTimestamp?: string
  parentConversationId?: string
  rootConversationId?: string
  relationType?: string
  relationSource?: string
  parentTitleSnapshot?: string
  archived: boolean
  messages?: unknown[]
}

interface DisplayConversationItem extends ConversationSummary {
  depth: number
  parentDisplayTitle: string
}

interface AIQueuedSubmission {
  id: string
  kind: string
  text: string
  images: string[]
  targetMessageId: string
  targetMessageText: string
  toolScope: string
  toolScopeSlot: string
  forceNewConversation: boolean
  queuedAt: number
}

interface AIToolExecution {
  executionId: string
  allowContinue: boolean
  allowTerminate: boolean
  allowTerminalAssignment: boolean
}

// 每个会话面板的运行时状态（createEmptyPanelState 的返回形状）
interface PanelState {
  activeConversationId: string
  conversation: AIConversationSnapshot | null
  messages: AIMessage[]
  apiMessages: APIHistoryMessage[]
  activeRequestId: string
  activeAssistantMessageId: string
  activeToolExecution: AIToolExecution | null
  toolApprovalMode: string
  requestPhase: string
  runtimePhase: string
  queuedSubmission: AIQueuedSubmission | null
  isFlushingQueuedSubmission: boolean
  skipNextAutomaticRequest: boolean
  resumeAfterCancelRequestId: string
  recoverableToolStopReason: string
  lastAssistantTurnId: string
  lastTurnBusinessMessageKind: string
  contextTokens: number
  isCondensingContext: boolean
  activeChangeReview: unknown
  collaborationLocked: boolean
  collaborationActive: boolean
  collaborationMode: string
  collaborationStreamBuffer: string
  collaborationAwaitingManualFollowup: boolean
  collaborationFollowupRequestId: string
  collaborationPendingMode: string
  collaborationPendingRequestId: string
  collaborationInterruptedRequestId: string
  collaborationStatusStartedAtMs: number
  collaborationStatusFirstTokenAtMs: number
  collaborationStatusText: string
  collaborationStatusReasoningText: string
}

interface TokenLedger {
  systemRawTokens: number
  entries: Map<string, number>
}

interface PerfRecord {
  stages: Array<{ label: string; ms: number }>
  total: number
  at: number
}

interface ComposerEditState {
  mode: string
  targetMessageId: string
  targetMessageText: string
}

interface McpInfoState {
  url: string
  transport: string
  endpoint: string
  instructions: string
  logs: string
  tools: unknown[]
}

// 终端屏幕模拟（ANSI 归一化）
type TerminalScreenLine = string[]
type TerminalCursorState = { row: number; col: number }


function getAIBridge() {
  return window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.App || null
}

function formatMessageTime() {
  return new Date().toLocaleTimeString(getLanguage() || 'zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function padAIHistoryDateTimePart(value: unknown) {
  return String(value).padStart(2, '0')
}

function formatAIHistoryDateTime(value: unknown) {
  const numericValue = Number(value)
  const date = Number.isFinite(numericValue) && numericValue > 0
    ? new Date(numericValue)
    : new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) {
    return String(value || '')
  }
  return `${date.getFullYear()}-${padAIHistoryDateTimePart(date.getMonth() + 1)}-${padAIHistoryDateTimePart(date.getDate())} ${padAIHistoryDateTimePart(date.getHours())}:${padAIHistoryDateTimePart(date.getMinutes())}:${padAIHistoryDateTimePart(date.getSeconds())}`
}

function formatAIHistoryRelativeTime(value: unknown, language: unknown) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return ''
  }
  const diffMs = numericValue - Date.now()
  const absDiffMs = Math.abs(diffMs)
  if (absDiffMs < 60 * 1000) {
    return translate('刚刚')
  }
  const divisions = [
    { unit: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
    { unit: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
    { unit: 'week', ms: 1000 * 60 * 60 * 24 * 7 },
    { unit: 'day', ms: 1000 * 60 * 60 * 24 },
    { unit: 'hour', ms: 1000 * 60 * 60 },
    { unit: 'minute', ms: 1000 * 60 },
  ]
  for (const division of divisions) {
    if (absDiffMs >= division.ms) {
      const unitValue = Math.round(diffMs / division.ms)
      return new Intl.RelativeTimeFormat(String(language || 'zh-CN'), { numeric: 'always' }).format(unitValue, division.unit as Intl.RelativeTimeFormatUnit)
    }
  }
  return translate('刚刚')
}

function buildAIHistoryDisplayTimeParts(value: unknown, language: unknown) {
  const absoluteText = formatAIHistoryDateTime(value)
  const relativeText = formatAIHistoryRelativeTime(value, language)
  return {
    absoluteText,
    relativeText,
  }
}

function buildAIConversationSummarySubtaskContinuePrompt(summaryText: unknown, language: unknown) {
  const trimmedSummaryText = typeof summaryText === 'string' ? summaryText.trim() : ''
  if (!trimmedSummaryText) {
    return ''
  }
  const normalizedLanguage = String(language || '').toLowerCase()
  const handoffInstruction = normalizedLanguage.startsWith('zh')
    ? '您是本次新的对接工程师,以上是交接文档!请继续工作,可能需要您先检查当前的基线工作进度确保交接内容属实'
    : 'You are the new handoff engineer for this task. The content above is the handoff document. Please continue the work, and you may need to first verify the current baseline progress to ensure the handoff is accurate.'
  return `${trimmedSummaryText}\n\n${handoffInstruction}`
}

function getAIHistoryRelativeTimeToneStyle(value: unknown) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return { color: 'var(--text-tertiary)', opacity: 0.5 }
  }
  const diffMs = Math.abs(Date.now() - numericValue)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  if (diffMs <= 5 * minuteMs) {
    return { color: 'var(--success)', opacity: 1 }
  }
  if (diffMs <= 10 * minuteMs) {
    return { color: 'var(--success)', opacity: 0.9 }
  }
  if (diffMs <= 30 * minuteMs) {
    return { color: 'var(--accent)', opacity: 1 }
  }
  if (diffMs <= hourMs) {
    return { color: 'var(--accent)', opacity: 0.9 }
  }
  if (diffMs <= 3 * hourMs) {
    return { color: 'var(--text-secondary)', opacity: 1 }
  }
  if (diffMs <= 6 * hourMs) {
    return { color: 'var(--text-secondary)', opacity: 0.9 }
  }
  if (diffMs <= 12 * hourMs) {
    return { color: 'var(--text-tertiary)', opacity: 0.8 }
  }
  if (diffMs <= 24 * hourMs) {
    return { color: 'var(--text-tertiary)', opacity: 0.7 }
  }
  return { color: 'var(--text-tertiary)', opacity: 0.5 }
}

function splitTerminalOutputLinesKeepNewline(content: unknown) {
  if (!content) {
    return []
  }
  const matches = String(content).match(/[^\n]*\n|[^\n]+/g)
  return Array.isArray(matches) ? matches : []
}

function truncateTerminalOutputForPrompt(content: unknown, lineLimit: unknown, characterLimit: unknown) {
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

function applyTerminalOutputRunLengthEncoding(content: unknown) {
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
        const finalChar = source[endIndex]
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

function normalizeTerminalOutputScreen(input: unknown) {
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

function compressTerminalOutputForPrompt(input: unknown, lineLimit: unknown, characterLimit: unknown) {
  const processed = normalizeTerminalOutputScreen(input)
  return truncateTerminalOutputForPrompt(applyTerminalOutputRunLengthEncoding(processed), lineLimit, characterLimit)
}

const AI_COLLABORATION_CONTINUE_PREFIX = '[Continue]'
const AI_COLLABORATION_DONE_PREFIX = '[Done]'
const AI_COLLABORATION_COMPRESSION_PREFIX = '[Compression]'
const AI_COLLABORATION_RETRY_PREFIX = '[Retry]'

function createEmptyPanelState(): PanelState {
  return {
    activeConversationId: '',
    conversation: null,
    messages: [],
    apiMessages: [],
    activeRequestId: '',
    activeAssistantMessageId: '',
    activeToolExecution: null,
    toolApprovalMode: '',
    requestPhase: 'idle',
    runtimePhase: 'ready',
    queuedSubmission: null,
    isFlushingQueuedSubmission: false,
    skipNextAutomaticRequest: false,
    resumeAfterCancelRequestId: '',
    recoverableToolStopReason: '',
    lastAssistantTurnId: '',
    lastTurnBusinessMessageKind: '',
    contextTokens: 0,
    isCondensingContext: false,
    activeChangeReview: null,
    collaborationLocked: false,
    collaborationActive: false,
    collaborationMode: '',
    collaborationStreamBuffer: '',
    collaborationAwaitingManualFollowup: false,
    collaborationFollowupRequestId: '',
    collaborationPendingMode: '',
    collaborationPendingRequestId: '',
    collaborationInterruptedRequestId: '',
    collaborationStatusStartedAtMs: 0,
    collaborationStatusFirstTokenAtMs: 0,
    collaborationStatusText: '',
    collaborationStatusReasoningText: '',
  }
}

function normalizeAIMessageStatus(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

const AI_FOLLOWUP_PENDING_STATUS_KEY = '等待处理'
const AI_FOLLOWUP_COMPLETED_STATUS_KEY = '已完成'

function truncateConversationTitle(text: unknown) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return translate('新对话')
  }
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized
}

function normalizeMessageImages(images: unknown) {
  return Array.isArray(images)
    ? images.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

function normalizeAIRuntimePhase(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (nextValue === 'api_request' || nextValue === 'tool_session' || nextValue === 'between_tool_and_next_api') {
    return nextValue
  }
  return 'ready'
}

function isAIQueueBlocked(runtimePhase: unknown) {
  return normalizeAIRuntimePhase(runtimePhase) !== 'ready'
}

function buildAIQueuedSubmission({ kind, text = '', images = [], targetMessageId = '', targetMessageText = '', toolScope = '', toolScopeSlot = '', forceNewConversation = false }: { kind: string; text?: string; images?: unknown; targetMessageId?: string; targetMessageText?: string; toolScope?: string; toolScopeSlot?: string; forceNewConversation?: boolean }): AIQueuedSubmission {
  return {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    text: typeof text === 'string' ? text : '',
    images: normalizeMessageImages(images),
    targetMessageId: typeof targetMessageId === 'string' ? targetMessageId : '',
    targetMessageText: typeof targetMessageText === 'string' ? targetMessageText : '',
    toolScope: typeof toolScope === 'string' ? toolScope : '',
    toolScopeSlot: typeof toolScopeSlot === 'string' ? toolScopeSlot : '',
    forceNewConversation: forceNewConversation === true,
    queuedAt: Date.now(),
  }
}

function normalizeAIContextTokensValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

function cloneAIConversationCacheObjects(cacheObjects: unknown) {
  if (!cacheObjects || typeof cacheObjects !== 'object') {
    return null
  }
  const cacheObject = cacheObjects as Record<string, unknown>
  const openaiResponses = cacheObject.openaiResponses && typeof cacheObject.openaiResponses === 'object'
    ? (() => {
        const source = cacheObject.openaiResponses as Record<string, unknown>
        const rawOutput = source.output
        const rawInclude = source.include
        return {
          responseId: typeof source.responseId === 'string' ? source.responseId.trim() : '',
          output: Array.isArray(rawOutput)
            ? rawOutput.filter((item) => item && typeof item === 'object').map((item) => JSON.parse(JSON.stringify(item)))
            : [],
          include: Array.isArray(rawInclude)
            ? rawInclude.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
            : [],
          store: source.store === true,
          capturedAt: typeof source.capturedAt === 'number' ? source.capturedAt : 0,
        }
      })()
    : null
  if (!openaiResponses || (!openaiResponses.responseId && openaiResponses.output.length === 0 && openaiResponses.include.length === 0 && !openaiResponses.store && openaiResponses.capturedAt === 0)) {
    return null
  }
  return {
    openaiResponses,
  }
}

function buildRequestMessages(apiMessages: unknown): AIRequestMessage[] {
  return Array.isArray(apiMessages)
    ? apiMessages
        .filter((message) => message && typeof message === 'object')
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
          content: typeof message.content === 'string' ? message.content.trim() : '',
          images: normalizeMessageImages(message.images),
          cacheObjects: cloneAIConversationCacheObjects(message.cacheObjects),
        }))
        .filter((message) => message.content || message.images.length > 0 || (message.cacheObjects?.openaiResponses?.output?.length || 0) > 0)
    : []
}

function createAPIHistoryMessage({ role, content, messageId = '', uiMessageIds = [], images = [], cacheObjects = null, ts = Date.now() }: { role: 'user' | 'assistant' | 'system'; content: string; messageId?: string; uiMessageIds?: string[]; images?: unknown; cacheObjects?: unknown; ts?: number }): APIHistoryMessage {
  return {
    role,
    content,
    messageId,
    uiMessageIds,
    images: normalizeMessageImages(images),
    cacheObjects: cloneAIConversationCacheObjects(cacheObjects),
    ts,
  }
}

function shouldUseAssistantFirstReplyForConversation(conversation: AIConversationSnapshot | null) {
  const rawUiMessages = conversation?.messages
  const rawApiMessages = conversation?.apiMessages
  const uiMessages = Array.isArray(rawUiMessages) ? rawUiMessages : []
  const apiMessages = Array.isArray(rawApiMessages) ? rawApiMessages : []
  const hasAssistantUIMessage = uiMessages.some((message) => message && typeof message === 'object' && message.kind === 'assistant')
  const hasAssistantAPIMessage = apiMessages.some((message) => message && typeof message === 'object' && message.role === 'assistant')
  return !hasAssistantUIMessage && !hasAssistantAPIMessage
}

function buildAIFollowupAnswerPayload(answer: string | AIMessage) {
  if (typeof answer === 'string' && answer.trim()) {
    const readableText = answer.trim()
    return {
      readableText,
      content: `<user_message>\n${readableText}\n</user_message>`,
    }
  }
  if (!answer || typeof answer !== 'object') {
    return {
      readableText: '',
      content: '',
    }
  }
  const readableText = typeof answer.readableText === 'string' && answer.readableText.trim()
    ? answer.readableText.trim()
    : ''
  if (!readableText) {
    return {
      readableText: '',
      content: '',
    }
  }
  let surveyResponseBlock = ''
  try {
    surveyResponseBlock = `\n<survey_response>\n${JSON.stringify(answer, null, 2)}\n</survey_response>`
  } catch {}
  return {
    readableText,
    content: `<user_message>\n${readableText}\n</user_message>${surveyResponseBlock}`,
  }
}

function findLatestAIFollowupMessageByRequestId(messages: unknown, requestId: unknown) {
  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : ''
  if (!normalizedRequestId || !Array.isArray(messages)) {
    return null
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object' || message.kind !== 'followup') {
      continue
    }
    if (typeof message.requestId === 'string' && message.requestId.trim() === normalizedRequestId) {
      return message
    }
  }
  return null
}

function collectTurnUiMessageIds(messages: unknown, assistantMessageId: unknown) {
  const ids = new Set()
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') {
      continue
    }
    if (message.id === assistantMessageId || message.turnId === assistantMessageId) {
      if (typeof message.id === 'string' && message.id.trim()) {
        ids.add(message.id.trim())
      }
    }
  }
  return [...ids]
}

function findApiAnchorIndexByUiMessageId(apiMessages: unknown, uiMessageId: unknown) {
  const targetId = typeof uiMessageId === 'string' ? uiMessageId.trim() : ''
  if (!targetId) {
    return -1
  }
  return Array.isArray(apiMessages)
    ? apiMessages.findIndex((message) => Array.isArray(message?.uiMessageIds) && message.uiMessageIds.includes(targetId))
    : -1
}

function upsertAPIHistoryMessage(apiMessages: unknown, rawMessage: AIAPIHistoryMessageLike, currentMessages: unknown = []): APIHistoryMessage[] {
  const role = rawMessage?.role === 'assistant' ? 'assistant' : rawMessage?.role === 'system' ? 'system' : 'user'
  const content = typeof rawMessage?.content === 'string' ? rawMessage.content.trim() : ''
  const images = normalizeMessageImages(rawMessage?.images)
  if (!content && images.length === 0) {
    return Array.isArray(apiMessages) ? apiMessages : []
  }

  const rawUIMessageIDs = rawMessage?.uiMessageIds
  const directUIMessageIDs = Array.isArray(rawUIMessageIDs)
    ? rawUIMessageIDs.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
  const turnId = typeof rawMessage?.turnId === 'string' ? rawMessage.turnId.trim() : ''
  const uiMessageIds = directUIMessageIDs.length > 0 ? [...new Set(directUIMessageIDs)] : collectTurnUiMessageIds(currentMessages, turnId)
  const nextMessage = createAPIHistoryMessage({
    role,
    content,
    messageId: typeof rawMessage?.messageId === 'string' ? rawMessage.messageId.trim() : '',
    uiMessageIds,
    images,
    cacheObjects: rawMessage?.cacheObjects,
    ts: typeof rawMessage?.ts === 'number' ? rawMessage.ts : Date.now(),
  })

  const list = Array.isArray(apiMessages) ? [...apiMessages] : []
  const existingIndex = nextMessage.messageId ? list.findIndex((message) => message.messageId === nextMessage.messageId) : -1
  if (existingIndex >= 0) {
    list[existingIndex] = nextMessage
  } else {
    list.push(nextMessage)
  }
  return list
}

function trimLatestAssistantAPIHistoryMessage(apiMessages: unknown) {
  const list = Array.isArray(apiMessages) ? [...apiMessages] : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === 'assistant') {
      list.splice(index, 1)
      break
    }
  }
  return list
}

function buildMetrics(payload: AIMetricsPayload) {
  const metrics = []

  if (typeof payload.firstTokenMs === 'number' && payload.firstTokenMs > 0) {
    metrics.push(`${translate('首字')} ${(payload.firstTokenMs / 1000).toFixed(1)}s`)
  }

  if (typeof payload.elapsedMs === 'number' && payload.elapsedMs > 0) {
    metrics.push(`${(payload.elapsedMs / 1000).toFixed(1)}s`)
  }

  if (typeof payload.tokensPerSecond === 'number' && Number.isFinite(payload.tokensPerSecond) && payload.tokensPerSecond > 0) {
    metrics.push(`${payload.tokensPerSecond.toFixed(1)} tok/s`)
  }

  return metrics
}

function buildReasoningDuration(payload: AIMetricsPayload) {
  if (typeof payload.firstTokenMs === 'number' && payload.firstTokenMs > 0) {
    return `${(payload.firstTokenMs / 1000).toFixed(1)}s`
  }
  if (typeof payload.elapsedMs === 'number' && payload.elapsedMs > 0) {
    return `${(payload.elapsedMs / 1000).toFixed(1)}s`
  }
  return ''
}

function buildAIRequestModelMeta(provider: AIProviderLike | null | undefined) {
  const providerName = typeof provider?.name === 'string' ? provider.name.trim() : ''
  const providerType = typeof provider?.provider === 'string' && provider.provider.trim() ? provider.provider.trim() : 'Compatible'
  const providerDefinition = getAIProviderDefinition(providerType)
  const configuredModelName = typeof provider?.model === 'string' ? provider.model.trim() : ''
  const defaultModelName = typeof providerDefinition?.defaultModel === 'string' ? providerDefinition.defaultModel.trim() : ''
  const requestModelName = configuredModelName || defaultModelName
  const requestModelLabel = requestModelName || providerName || providerType
  if (!requestModelLabel) {
    return {}
  }
  return {
    requestModelLabel,
    requestModelName,
    requestProviderName: providerName,
    requestProviderType: providerType,
  }
}

function normalizeAICollaborationMode(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return nextValue === 'followup' || nextValue === 'completion' || nextValue === 'forced' ? nextValue : ''
}

function normalizeAICollaborationDecision(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return ['continue', 'done', 'compression', 'retry', 'fallback_followup', 'fallback_completion'].includes(nextValue) ? nextValue : ''
}

function parseAICollaborationStreamBuffer(value: unknown) {
  const nextValue = typeof value === 'string' ? value : ''
  if (nextValue.startsWith(AI_COLLABORATION_CONTINUE_PREFIX)) {
    return {
      decision: 'continue',
      bodyText: nextValue.slice(AI_COLLABORATION_CONTINUE_PREFIX.length).replace(/^\s+/, ''),
    }
  }
  if (nextValue.startsWith(AI_COLLABORATION_DONE_PREFIX)) {
    return {
      decision: 'done',
      bodyText: '',
    }
  }
  if (nextValue.startsWith(AI_COLLABORATION_COMPRESSION_PREFIX)) {
    return {
      decision: 'compression',
      bodyText: '',
    }
  }
  if (nextValue.startsWith(AI_COLLABORATION_RETRY_PREFIX)) {
    return {
      decision: 'retry',
      bodyText: '',
    }
  }
  return {
    decision: '',
    bodyText: '',
  }
}

function upsertConversationSummary(list: unknown, snapshot: AIConversationSnapshot): ConversationSummary[] {
  const nextSummary = {
    id: snapshot.id,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    status: snapshot.status,
    toolProtocol: snapshot.toolProtocol,
    messageCount: typeof snapshot.messageCount === 'number'
      ? snapshot.messageCount
      : Array.isArray(snapshot.messages) ? snapshot.messages.length : 0,
    promptCacheBypassTimestamp: snapshot.promptCacheBypassTimestamp || '',
    parentConversationId: typeof snapshot.parentConversationId === 'string' ? snapshot.parentConversationId : '',
    rootConversationId: typeof snapshot.rootConversationId === 'string' ? snapshot.rootConversationId : '',
    relationType: typeof snapshot.relationType === 'string' ? snapshot.relationType : '',
    relationSource: typeof snapshot.relationSource === 'string' ? snapshot.relationSource : '',
    parentTitleSnapshot: typeof snapshot.parentTitleSnapshot === 'string' ? snapshot.parentTitleSnapshot : '',
    archived: snapshot.archived === true,
  }

  const nextList = Array.isArray(list) ? [...list] : []
  const existingIndex = nextList.findIndex((item) => item.id === nextSummary.id)

  if (existingIndex >= 0) {
    nextList[existingIndex] = {
      ...nextList[existingIndex],
      ...nextSummary,
    }
  } else {
    nextList.unshift(nextSummary)
  }

  nextList.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt
    }
    return String(right.id).localeCompare(String(left.id))
  })

  return nextList
}

function buildAIConversationDisplayList(list: unknown): DisplayConversationItem[] {
  const items = Array.isArray(list)
    ? list.filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim())
    : []
  if (items.length === 0) {
    return []
  }
  const normalizedItems = items.map((item) => ({
    ...item,
    id: String(item.id).trim(),
    title: typeof item.title === 'string' ? item.title : '',
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
    parentConversationId: typeof item.parentConversationId === 'string' ? item.parentConversationId.trim() : '',
    rootConversationId: typeof item.rootConversationId === 'string' ? item.rootConversationId.trim() : '',
    relationType: typeof item.relationType === 'string' ? item.relationType.trim() : '',
    relationSource: typeof item.relationSource === 'string' ? item.relationSource.trim() : '',
    parentTitleSnapshot: typeof item.parentTitleSnapshot === 'string' ? item.parentTitleSnapshot.trim() : '',
    archived: item.archived === true,
  }))
  const byId = new Map(normalizedItems.map((item) => [item.id, item]))
  const resolveRootConversationId = (item: ConversationSummary) => {
    if (item.rootConversationId) {
      return item.rootConversationId
    }
    const visited = new Set([item.id])
    let current = item
    let resolvedRootId = item.id
    while (current?.parentConversationId) {
      const parentId = typeof current.parentConversationId === 'string' ? current.parentConversationId.trim() : ''
      if (!parentId || visited.has(parentId)) {
        break
      }
      visited.add(parentId)
      resolvedRootId = parentId
      if (!byId.has(parentId)) {
        return parentId
      }
      current = byId.get(parentId)
    }
    return resolvedRootId
  }
  const resolveDepth = (item: ConversationSummary) => {
    const initialParentId = typeof item.parentConversationId === 'string' ? item.parentConversationId.trim() : ''
    if (!initialParentId) {
      return 0
    }
    let depth = 0
    let parentId = initialParentId
    const visited = new Set([item.id])
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      depth += 1
      if (!byId.has(parentId)) {
        break
      }
      const parentItem = byId.get(parentId)
      parentId = typeof parentItem?.parentConversationId === 'string' ? parentItem.parentConversationId.trim() : ''
    }
    return Math.max(1, Math.min(depth, 4))
  }
  const resolveParentDisplayTitle = (item: ConversationSummary) => {
    const parentId = typeof item.parentConversationId === 'string' ? item.parentConversationId.trim() : ''
    if (parentId && byId.has(parentId)) {
      const parentItem = byId.get(parentId)
      if (typeof parentItem?.title === 'string' && parentItem.title.trim()) {
        return parentItem.title.trim()
      }
    }
    return item.parentTitleSnapshot
  }
  const groups = new Map<string, { rootId: string; groupUpdatedAt: number; items: ConversationSummary[] }>()
  normalizedItems.forEach((item) => {
    const rootId = resolveRootConversationId(item) || item.id
    const existingGroup = groups.get(rootId) || {
      rootId,
      groupUpdatedAt: 0,
      items: [] as ConversationSummary[],
    }
    existingGroup.items.push(item)
    existingGroup.groupUpdatedAt = Math.max(existingGroup.groupUpdatedAt, item.updatedAt || 0)
    groups.set(rootId, existingGroup)
  })
  return Array.from(groups.values())
    .sort((left, right) => {
      if (left.groupUpdatedAt !== right.groupUpdatedAt) {
        return right.groupUpdatedAt - left.groupUpdatedAt
      }
      return String(right.rootId).localeCompare(String(left.rootId))
    })
    .flatMap((group) => group.items
      .slice()
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt
        }
        if (left.updatedAt !== right.updatedAt) {
          return right.updatedAt - left.updatedAt
        }
        return String(left.id).localeCompare(String(right.id))
      })
      .map((item) => ({
        ...item,
        depth: resolveDepth(item),
        parentDisplayTitle: resolveParentDisplayTitle(item),
      })))
}

function insertMessageBeforeAssistant(messages: unknown, requestId: unknown, nextMessage: AIMessage): AIMessage[] {
  const list = Array.isArray(messages) ? messages : []
  const assistantIndex = list.findIndex((message) => message.id === requestId && message.kind === 'assistant')
  if (assistantIndex === -1) {
    return [...list, nextMessage]
  }
  return [
    ...list.slice(0, assistantIndex),
    nextMessage,
    ...list.slice(assistantIndex),
  ]
}

function upsertMessageBeforeAssistant(messages: unknown, requestId: unknown, nextMessage: AIMessage): AIMessage[] {
  const list = Array.isArray(messages) ? messages : []
  const existingIndex = list.findIndex((message) => message.id === nextMessage?.id)
  if (existingIndex >= 0) {
    const nextMessages = [...list]
    const previousMessage = nextMessages[existingIndex]
    const previousExtra = previousMessage?.extra && typeof previousMessage.extra === 'object' ? previousMessage.extra : null
    const nextExtra = nextMessage?.extra && typeof nextMessage.extra === 'object' ? nextMessage.extra : null
    nextMessages[existingIndex] = {
      ...previousMessage,
      ...nextMessage,
      ...(previousExtra || nextExtra ? { extra: { ...(previousExtra || {}), ...(nextExtra || {}) } } : {}),
    }
    return nextMessages
  }
  return insertMessageBeforeAssistant(list, requestId, nextMessage)
}

function isAIBusinessTurnMessageKind(kind: unknown) {
  return Boolean(kind) && kind !== 'assistant' && kind !== 'reasoning' && kind !== 'user'
}

function updateAILastAssistantTurnState(currentState: Pick<PanelState, 'lastAssistantTurnId'>, message: AIMessage, fallbackTurnId = ''): Partial<Pick<PanelState, 'lastAssistantTurnId' | 'lastTurnBusinessMessageKind'>> {
  const kind = typeof message?.kind === 'string' ? message.kind.trim() : ''
  if (!kind) {
    return {}
  }
  if (kind === 'assistant') {
    const turnId = typeof message?.turnId === 'string' && message.turnId.trim()
      ? message.turnId.trim()
      : typeof message?.id === 'string' && message.id.trim()
        ? message.id.trim()
        : typeof fallbackTurnId === 'string' ? fallbackTurnId.trim() : ''
    return turnId ? { lastAssistantTurnId: turnId, lastTurnBusinessMessageKind: '' } : {}
  }
  if (!isAIBusinessTurnMessageKind(kind)) {
    return {}
  }
  const turnId = typeof message?.turnId === 'string' && message.turnId.trim()
    ? message.turnId.trim()
    : typeof fallbackTurnId === 'string' && fallbackTurnId.trim()
      ? fallbackTurnId.trim()
      : typeof currentState?.lastAssistantTurnId === 'string' ? currentState.lastAssistantTurnId.trim() : ''
  return turnId ? { lastAssistantTurnId: turnId, lastTurnBusinessMessageKind: kind } : {}
}

function computeAILastAssistantTurnState(messages: unknown): { lastAssistantTurnId: string; lastTurnBusinessMessageKind: string } {
  const list = Array.isArray(messages) ? messages : []
  let lastAssistantTurnId = ''
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    const kind = typeof message?.kind === 'string' ? message.kind.trim() : ''
    if (kind !== 'assistant') {
      continue
    }
    lastAssistantTurnId = typeof message?.turnId === 'string' && message.turnId.trim()
      ? message.turnId.trim()
      : typeof message?.id === 'string' ? message.id.trim() : ''
    break
  }
  if (!lastAssistantTurnId) {
    return { lastAssistantTurnId: '', lastTurnBusinessMessageKind: '' }
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    const turnId = typeof message?.turnId === 'string' ? message.turnId.trim() : ''
    if (turnId !== lastAssistantTurnId) {
      continue
    }
    const kind = typeof message?.kind === 'string' ? message.kind.trim() : ''
    if (!isAIBusinessTurnMessageKind(kind)) {
      continue
    }
    return { lastAssistantTurnId, lastTurnBusinessMessageKind: kind }
  }
  return { lastAssistantTurnId, lastTurnBusinessMessageKind: '' }
}

const AI_CONVERSATION_DIFF_TOOL_NAMES = new Set(['apply_diff', 'write_to_file', 'search_replace', 'edit_file', 'apply_patch'])
const AI_CONVERSATION_DIFF_SUCCESS_STATUSES = new Set(['已执行', AI_FOLLOWUP_COMPLETED_STATUS_KEY])

function extractAIConversationDiffPrimaryPath(copyContent: unknown, fallbackSummary: unknown) {
  const normalizedCopyContent = typeof copyContent === 'string' ? copyContent.trim() : ''
  if (normalizedCopyContent) {
    const matches = normalizedCopyContent.match(/^File:(.+)$/gm)
    if (Array.isArray(matches) && matches.length > 0) {
      const firstPath = String(matches[0]).replace(/^File:/, '').trim()
      if (matches.length === 1) {
        return firstPath
      }
      return translate('{path} 等 {count} 个文件', { path: firstPath, count: matches.length })
    }
  }
  return typeof fallbackSummary === 'string' ? fallbackSummary.trim() : ''
}

function normalizeAIConversationSearchQuery(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function extractAIConversationSearchText(message: AIMessage) {
  const kind = typeof message?.kind === 'string' ? message.kind.trim() : ''
  if (kind === 'followup') {
    const parts = []
    const question = typeof message?.question === 'string' ? message.question.trim() : ''
    if (question) {
      parts.push(question)
    }
    const rawQuestions = message?.questions
    const questions = Array.isArray(rawQuestions) ? rawQuestions : []
    questions.forEach((item) => {
      const title = typeof item?.text === 'string' ? item.text.trim() : ''
      if (title) {
        parts.push(title)
      }
      const rawOptions = item?.options
      const options = Array.isArray(rawOptions) ? rawOptions : []
      options.forEach((option) => {
        const answer = typeof option?.answer === 'string' ? option.answer.trim() : ''
        if (answer) {
          parts.push(answer)
        }
      })
    })
    const rawSuggestions = message?.suggestions
    const suggestions = Array.isArray(rawSuggestions)
      ? rawSuggestions.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : []
    parts.push(...suggestions)
    return parts.join('\n\n').trim()
  }
  if (kind === 'completion') {
    const parts = []
    const summary = typeof message?.summary === 'string' ? message.summary.trim() : ''
    const result = typeof message?.result === 'string' ? message.result.trim() : ''
    const title = typeof message?.title === 'string' ? message.title.trim() : ''
    if (summary) {
      parts.push(summary)
    }
    if (result) {
      parts.push(result)
    }
    if (parts.length === 0 && title) {
      parts.push(title)
    }
    return parts.join('\n\n').trim()
  }
  if (kind !== 'user' && kind !== 'assistant') {
    return ''
  }
  const primary = typeof message?.text === 'string' ? message.text.replace(/▍$/u, '').trim() : ''
  const fallback = typeof message?.summary === 'string' ? message.summary.trim() : ''
  return primary || fallback
}

function buildAIConversationSearchSnippet(text: unknown, query: unknown) {
  const normalizedText = String(text || '').trim()
  const normalizedQuery = normalizeAIConversationSearchQuery(query)
  if (!normalizedText) {
    return ''
  }
  if (!normalizedQuery) {
    const runes = Array.from(normalizedText)
    return runes.length <= 72 ? normalizedText : `${runes.slice(0, 72).join('')}…`
  }
  const lowerText = normalizedText.toLowerCase()
  const lowerQuery = normalizedQuery.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)
  if (matchIndex < 0) {
    const runes = Array.from(normalizedText)
    return runes.length <= 72 ? normalizedText : `${runes.slice(0, 72).join('')}…`
  }
  const prefixRuneCount = Array.from(normalizedText.slice(0, matchIndex)).length
  const queryRuneCount = Array.from(normalizedText.slice(matchIndex, matchIndex + normalizedQuery.length)).length
  const runes = Array.from(normalizedText)
  const start = Math.max(0, prefixRuneCount - 24)
  const end = Math.min(runes.length, prefixRuneCount + queryRuneCount + 36)
  let snippet = runes.slice(start, end).join('')
  if (start > 0) {
    snippet = `…${snippet}`
  }
  if (end < runes.length) {
    snippet = `${snippet}…`
  }
  return snippet
}

function resolveAIEventSound(payload: AIEventPayloadShape, fallbackSound = '', allowPayloadOverride = true) { 
  if (allowPayloadOverride && payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'sound')) {
    return typeof payload.sound === 'string' ? payload.sound.trim() : ''
  }
  return typeof fallbackSound === 'string' ? fallbackSound.trim() : ''
}

export default function AIPanel({ width, side, terminalId = 'global', sessionId = '', sessionTerminals = [], onDevilModeChange, addToast }: AIPanelProps) {
  const { t } = useTranslation()
  const audioPlayersRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const [mcpInfo, setMcpInfo] = useState<McpInfoState>({ url: '', transport: 'streamable-http', endpoint: '/mcp', instructions: '', logs: '', tools: [] })
  const [aiProviderState, setAIProviderState] = useState<AIProviderState>({ currentProviderId: '', providers: [] })
  const [mcpClientServers, setMCPClientServers] = useState<unknown[]>([])
  const [mcpClientGlobalConfigPath, setMCPClientGlobalConfigPath] = useState('')
  const [mcpClientGlobalConfigText, setMCPClientGlobalConfigText] = useState('{\n  "mcpServers": {}\n}')
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [popupDismissVersion, setPopupDismissVersion] = useState(0)
  const [activeSettingsTab, setActiveSettingsTab] = useState('')
  const [tasksDirMigrating, setTasksDirMigrating] = useState(false)
  const [isDevilMode, setIsDevilMode] = useState(false)
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([])
  const [globalAISettings, setGlobalAISettings] = useState<AIGlobalSettings | null>(null)
  const [terminalOutputLineLimit, setTerminalOutputLineLimit] = useState(500)
  const [terminalOutputCharacterLimit, setTerminalOutputCharacterLimit] = useState(35000)
  const [terminalPanels, setTerminalPanels] = useState<Record<string, PanelState>>({})
  const [composerInputValue, setComposerInputValue] = useState('')
  const [composerImages, setComposerImages] = useState<string[]>([])
  const [composerEditState, setComposerEditState] = useState<ComposerEditState>({ mode: 'new', targetMessageId: '', targetMessageText: '' })
  const [conversationScrollSignal, setConversationScrollSignal] = useState(0)
  const [providerBalanceRefreshSignal, setProviderBalanceRefreshSignal] = useState(0)
  const [hoveredConversationActionKey, setHoveredConversationActionKey] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState<AIConversationMessageSearchResult[]>([])
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false)
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [conversationSearchIndex, setConversationSearchIndex] = useState(0)
  const terminalPanelsRef = useRef<Record<string, PanelState>>({})
  const panelMountedRef = useRef(true)
  const tokenLedgerRef = useRef<Map<string, TokenLedger>>(new Map())
  const sendPerfMetricsRef = useRef<Map<string, PerfRecord>>(new Map())
  const panelInstanceKey = `${sessionId || 'session'}::${terminalId || 'terminal'}`
  const globalSearchRequestRef = useRef(0)
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null)
  const conversationSearchInputRef = useRef<HTMLInputElement | null>(null)
  const resetGlobalSearchState = useCallback(() => {
    setGlobalSearchOpen(false)
    setGlobalSearchQuery('')
    setGlobalSearchLoading(false)
    setGlobalSearchResults([])
  }, [])

  const resetConversationSearchState = useCallback(() => {
    setConversationSearchOpen(false)
    setConversationSearchQuery('')
    setConversationSearchIndex(0)
  }, [])

  const applyMCPInfo = useCallback((info: unknown) => {
    const rawInfo = info && typeof info === 'object' ? info as Record<string, unknown> : null
    if (!panelMountedRef.current || !rawInfo) {
      return
    }
    setMcpInfo({
      url: typeof rawInfo.url === 'string' ? rawInfo.url : '',
      transport: typeof rawInfo.transport === 'string' ? rawInfo.transport : 'streamable-http',
      endpoint: typeof rawInfo.endpoint === 'string' ? rawInfo.endpoint : '/mcp',
      instructions: typeof rawInfo.instructions === 'string' ? rawInfo.instructions : '',
      logs: typeof rawInfo.logs === 'string' ? rawInfo.logs : '',
      tools: Array.isArray(rawInfo.tools) ? rawInfo.tools : [],
    })
  }, [])
  const applyMCPSettingsState = useCallback((state: unknown) => {
    const rawState = state && typeof state === 'object' ? state as Record<string, unknown> : null
    if (!panelMountedRef.current || !rawState) {
      return
    }
    applyMCPInfo(rawState.service || {})
    const rawClient = rawState.client && typeof rawState.client === 'object' ? rawState.client as Record<string, unknown> : null
    setMCPClientServers(Array.isArray(rawClient?.servers) ? rawClient.servers : [])
    setMCPClientGlobalConfigPath(typeof rawClient?.globalConfigPath === 'string' ? rawClient.globalConfigPath : '')
    setMCPClientGlobalConfigText(typeof rawClient?.globalConfigText === 'string' && rawClient.globalConfigText.trim() ? rawClient.globalConfigText : '{\n  "mcpServers": {}\n}')
  }, [applyMCPInfo])
  const refreshMCPServerInfo = useCallback(async () => {
    try {
      const state = await getMCPSettingsState()
      applyMCPSettingsState(state)
      return state
    } catch {
      return null
    }
  }, [applyMCPSettingsState])
  const refreshMCPOutputCompressionSettings = useCallback(async () => {
    try {
      const settings = await AppGo.GetMCPOutputCompressionSettings()
      if (!panelMountedRef.current || !settings) {
        return null
      }
      const nextLineLimit = Math.max(10, Math.min(5000, settings.terminalOutputLineLimit || 0))
      const nextCharacterLimit = Math.max(1000, Math.min(500000, settings.terminalOutputCharacterLimit || 0))
      setTerminalOutputLineLimit(nextLineLimit)
      setTerminalOutputCharacterLimit(nextCharacterLimit)
      return settings
    } catch {
      return null
    }
  }, [])
  const refreshAIHomeData = useCallback(async () => {
    void getAIGlobalSettings()
      .then((value) => {
        if (!panelMountedRef.current) {
          return
        }
        setGlobalAISettings(value)
      })
      .catch(() => {
        if (!panelMountedRef.current) {
          return
        }
        setGlobalAISettings(null)
      })
    void getAIProviderState()
      .then((value) => {
        if (!panelMountedRef.current) {
          return
        }
        setAIProviderState(value)
      })
      .catch(() => {
        if (!panelMountedRef.current) {
          return
        }
        setAIProviderState({ currentProviderId: '', providers: [] })
      })
    void refreshMCPServerInfo()
    void refreshMCPOutputCompressionSettings()
    try {
      const conversations = await listAIConversations()
      if (!panelMountedRef.current) {
        return
      }
      setConversationList(Array.isArray(conversations) ? conversations : [])
    } catch {
      if (!panelMountedRef.current) {
        return
      }
      setConversationList([])
    }
  }, [refreshMCPOutputCompressionSettings, refreshMCPServerInfo])

  const showAlert = useCallback(async (message: string) => {
    // message 为动态内容（可能不在翻译表），t() 内部有兜底
    const finalMessage = typeof message === 'string' && message.trim() ? translate(message.trim() as I18nKey) : translate('当前状态不支持还原')
    if (window?.luminDialog?.alert) {
      await window.luminDialog.alert(finalMessage, t('提示'))
      return
    }
    window.alert(finalMessage)
  }, [t])

  const clearRestorePreview = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-change-review-preview-clear', {
      detail: { sessionId: terminalId },
    }))
  }, [terminalId])

  useEffect(() => {
    terminalPanelsRef.current = terminalPanels
  }, [terminalPanels])

  useEffect(() => {
    panelMountedRef.current = true
    return () => {
      panelMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleAppendComposerText = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const targetSessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : ''
      const targetTerminalId = typeof detail?.terminalId === 'string' ? detail.terminalId.trim() : ''
      const preserveWhitespace = detail?.preserveWhitespace === true
      const rawAppendedText = typeof detail?.text === 'string' ? detail.text : ''
      const appendedText = preserveWhitespace ? rawAppendedText : rawAppendedText.trim()
      if (!(preserveWhitespace ? rawAppendedText.trim() : appendedText)) {
        return
      }
      if (targetSessionId !== (sessionId || '').trim() || targetTerminalId !== (terminalId || '').trim()) {
        return
      }
      setComposerInputValue((current) => {
        const currentValue = typeof current === 'string' ? current : ''
        if (!currentValue.trim()) {
          return appendedText
        }
        return currentValue.endsWith('\n') ? `${currentValue}${appendedText}` : `${currentValue}\n${appendedText}`
      })
    }
    window.addEventListener('ai-composer-append', handleAppendComposerText)
    return () => window.removeEventListener('ai-composer-append', handleAppendComposerText)
  }, [sessionId, terminalId])

  const panelState = terminalPanels[panelInstanceKey] || createEmptyPanelState()
  const terminalLabelMap = useMemo(() => {
    const map = new Map()
    ;(Array.isArray(sessionTerminals) ? sessionTerminals : []).forEach((terminal) => {
      const nextTerminalId = typeof terminal?.id === 'string' ? terminal.id.trim() : ''
      if (!nextTerminalId) {
        return
      }
      const nextLabel = typeof terminal?.label === 'string' && terminal.label.trim() ? terminal.label.trim() : nextTerminalId
      map.set(nextTerminalId, nextLabel)
    })
    return map
  }, [sessionTerminals])
  const enrichAIChatCommandMessage = useCallback((message: AIMessage) => {
    if (!message || typeof message !== 'object' || message.kind !== 'command') {
      return message
    }
    const nextExtra = message.extra && typeof message.extra === 'object' ? { ...message.extra } : {}
    const targetSessionId = typeof nextExtra.targetSessionId === 'string' && nextExtra.targetSessionId.trim()
      ? nextExtra.targetSessionId.trim()
      : ''
    if (targetSessionId) {
      nextExtra.targetLabel = terminalLabelMap.get(targetSessionId) || targetSessionId
    }
    return Object.keys(nextExtra).length > 0
      ? { ...message, extra: nextExtra }
      : message
  }, [terminalLabelMap])
  const activeConversation = panelState.conversation
  const activeConversationRelationType = typeof activeConversation?.relationType === 'string' ? activeConversation.relationType.trim() : ''
  const activeConversationArchived = activeConversation?.archived === true
  const isThemeTuningConversation = activeConversation?.transient === true
  const runtimePhase = normalizeAIRuntimePhase(panelState.runtimePhase)
  const isStreaming = panelState.requestPhase === 'streaming'
  const isAwaitingToolApproval = panelState.requestPhase === 'awaiting_tool_approval'
  const isToolRunning = panelState.requestPhase === 'running_tool'
  const isAwaitingCommandAction = panelState.requestPhase === 'awaiting_command_action'
  const isAwaitingTerminalAssignment = panelState.requestPhase === 'awaiting_terminal_assignment'
  const isQueueBlocked = isAIQueueBlocked(runtimePhase) || isStreaming || isAwaitingToolApproval || isToolRunning || isAwaitingCommandAction || isAwaitingTerminalAssignment
  const normalizedGlobalAISettings = useMemo(() => normalizeAIGlobalSettings(globalAISettings), [globalAISettings])
  const selectedAIProvider = useMemo(() => {
    const currentProviderId = typeof aiProviderState?.currentProviderId === 'string' ? aiProviderState.currentProviderId.trim() : ''
    if (!currentProviderId) {
      return null
    }
    return (Array.isArray(aiProviderState?.providers) ? aiProviderState.providers : []).find((item) => item?.id === currentProviderId) || null
  }, [aiProviderState])
  const availableAIProviders = useMemo(
    () => (Array.isArray(aiProviderState?.providers) ? aiProviderState.providers : []),
    [aiProviderState],
  )
  const canToggleAIMode = useMemo(() => isCallMyVipProviderHost(selectedAIProvider?.baseUrl), [selectedAIProvider])
  useEffect(() => {
    if (!canToggleAIMode) {
      setIsDevilMode(false)
    }
  }, [canToggleAIMode])
  useEffect(() => {
    onDevilModeChange?.(canToggleAIMode ? isDevilMode : false)
  }, [canToggleAIMode, isDevilMode, onDevilModeChange])
  const handleToggleDevilMode = useCallback(async () => {
    if (isDevilMode) {
      setIsDevilMode(false)
      return
    }
    try {
      const tokenGroup = await getAIProviderTokenGroup(selectedAIProvider || {})
      const normalizedTokenGroup = typeof tokenGroup === 'string' ? tokenGroup.replace(/\s+/g, '') : ''
      if (!normalizedTokenGroup.includes('支持破限')) {
        addToast?.(t('当前供应商渠道不支持恶魔模式'), 'warning', 2400)
        return
      }
      setIsDevilMode(true)
    } catch (error) {
      const errorText = error instanceof Error ? error.message.trim() : ''
      if (errorText === t('Token 分组查询能力未就绪')) {
        addToast?.(errorText, 'warning', 2400)
        return
      }
      addToast?.(t('当前Token分组校验失败,无法进入恶魔模式'), 'warning', 2400)
    }
  }, [addToast, isDevilMode, selectedAIProvider, t])
  const resolveFirstAvailableProviderId = useCallback((providers: AIProviderLike[] = []) => {
    return typeof providers[0]?.id === 'string' ? providers[0].id.trim() : ''
  }, [])
  const resolveAvailableProviderId = useCallback((providers: AIProviderLike[] = [], preferredProviderId = '') => {
    const normalizedPreferredProviderId = typeof preferredProviderId === 'string' ? preferredProviderId.trim() : ''
    if (normalizedPreferredProviderId && providers.some((item) => item?.id === normalizedPreferredProviderId)) {
      return normalizedPreferredProviderId
    }
    return resolveFirstAvailableProviderId(providers)
  }, [resolveFirstAvailableProviderId])
  const buildConversationWithProviderId = useCallback((snapshot: AIConversationSnapshot, providerId: string) => {
    if (!snapshot || typeof snapshot !== 'object') {
      return snapshot
    }
    const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
    const rawSettings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings as Record<string, unknown> : null
    const currentProviderId = typeof rawSettings?.currentProviderId === 'string' ? rawSettings.currentProviderId.trim() : ''
    if (currentProviderId === normalizedProviderId) {
      return snapshot
    }
    return {
      ...snapshot,
      updatedAt: Date.now(),
      settings: normalizeAIConversationTaskSettings({
        ...(rawSettings || {}),
        currentProviderId: normalizedProviderId,
      }),
    }
  }, [])
  const effectiveProviderId = selectedAIProvider?.id || resolveAvailableProviderId(
    availableAIProviders,
    typeof aiProviderState?.currentProviderId === 'string' ? aiProviderState.currentProviderId.trim() : '',
  )
  const resolveAIRequestModelMeta = useCallback((providerId = '', providers: AIProviderLike[] | null = null) => {
    const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
    const sourceProviders = Array.isArray(providers) ? providers : (Array.isArray(aiProviderState?.providers) ? aiProviderState.providers : [])
    const matchedProvider = normalizedProviderId
      ? sourceProviders.find((item) => item?.id === normalizedProviderId) || null
      : null
    return buildAIRequestModelMeta(matchedProvider)
  }, [aiProviderState])
  const effectiveAutoApprovalSettings = useMemo(() => {
    if (!activeConversation) {
      return normalizedGlobalAISettings
    }
    const normalizedTaskSettings = normalizeAIConversationTaskSettings(activeConversation.settings)
    return {
      ...normalizedTaskSettings,
      allowedCommands: normalizedGlobalAISettings.allowedCommands,
      deniedCommands: normalizedGlobalAISettings.deniedCommands,
    }
  }, [activeConversation, normalizedGlobalAISettings])
  const effectiveAutoApprovalEnabled = effectiveAutoApprovalSettings.autoApprovalEnabled
  const shouldPersistProviderSelection = !activeConversation
  const approvalButtonOrder = normalizedGlobalAISettings.approvalButtonOrder
  const commandActionButtonOrder = normalizedGlobalAISettings.commandActionButtonOrder
  const messageActionBarAtBottom = Boolean(normalizedGlobalAISettings.messageActionBarAtBottom)
  const messageNavEnabled = normalizedGlobalAISettings.messageNavEnabled !== false
  const shouldLockAssistantCollaboration = Boolean(effectiveAutoApprovalSettings.alwaysAllowFollowupQuestions)
  const collaborationLocked = Boolean(panelState.collaborationLocked) && Boolean(activeConversation)
  const collaborationActive = Boolean(panelState.collaborationActive)
  const isSummarySubtaskCollaborationActive = collaborationActive && panelState.collaborationMode === 'summary_subtask'
  const isArchivedAgentConversation = activeConversationArchived && activeConversationRelationType === 'agent'
  const canQuickCondenseConversation = Boolean(activeConversation) && runtimePhase === 'ready' && !panelState.isCondensingContext && !isArchivedAgentConversation
  const canSummaryCondenseConversation = Boolean(activeConversation) && runtimePhase === 'ready' && !panelState.isCondensingContext
  const composerInteractionLocked = isArchivedAgentConversation && !isSummarySubtaskCollaborationActive
  const composerInteractionLockedLabel = t('当前子代理任务已归档,仅可摘要压缩创建新的子阶段任务')
  const collaborationFollowupInteractionLocked = collaborationLocked && collaborationActive && panelState.collaborationMode === 'followup'
  const showAssistantCollaborationActiveImage = collaborationActive && Boolean(activeConversation)
  const toolResumeAvailable = Boolean(activeConversation)
    && !isArchivedAgentConversation
    && panelState.requestPhase === 'idle'
    && runtimePhase === 'ready'
    && !panelState.queuedSubmission
    && !panelState.isFlushingQueuedSubmission
    && !collaborationActive
    && !panelState.isCondensingContext
    && (!panelState.lastTurnBusinessMessageKind || (panelState.lastTurnBusinessMessageKind !== 'completion' && panelState.lastTurnBusinessMessageKind !== 'followup'))
  const playAISound = useCallback((type: string) => {
    if (normalizedGlobalAISettings.soundEnabled === false) {
      return
    }
    const parsedVolume = Number(normalizedGlobalAISettings.soundVolume)
    const volume = Number.isFinite(parsedVolume) ? Math.max(0, Math.min(1, parsedVolume)) : 0.06
    if (volume <= 0) {
      return
    }
    const soundKey = typeof type === 'string' ? type.trim() : ''
    const audioPathByType: Record<string, string> = {
      completion: '/audio/celebration.wav',
      notification: '/audio/notification.wav',
      progress: '/audio/progress_loop.wav',
    }
    const audioPath = audioPathByType[soundKey]
    if (!audioPath) {
      return
    }
    try {
      let audio = audioPlayersRef.current.get(soundKey)
      if (!(audio instanceof Audio)) {
        audio = new Audio(audioPath)
        audio.preload = 'auto'
        audioPlayersRef.current.set(soundKey, audio)
      }
      audio.pause()
      audio.currentTime = 0
      audio.volume = volume
      void audio.play().catch(() => {})
    } catch {}
  }, [normalizedGlobalAISettings.soundEnabled, normalizedGlobalAISettings.soundVolume])
  const normalizedGlobalSearchQuery = useMemo(() => normalizeAIConversationSearchQuery(globalSearchQuery), [globalSearchQuery])
  const normalizedConversationSearchQuery = useMemo(() => normalizeAIConversationSearchQuery(conversationSearchQuery), [conversationSearchQuery])
  const conversationSearchResults = useMemo(() => {
    if (!activeConversation || !normalizedConversationSearchQuery) {
      return []
    }
    const normalizedNeedle = normalizedConversationSearchQuery.toLowerCase()
    return (Array.isArray(panelState.messages) ? panelState.messages : []).flatMap((message) => {
      const body = extractAIConversationSearchText(message)
      if (!body || !body.toLowerCase().includes(normalizedNeedle)) {
        return []
      }
      return [normalizeAIConversationMessageSearchResult({
        conversationId: activeConversation.id,
        conversationTitle: activeConversation.title,
        messageId: message.id,
        role: message.kind === 'user' ? 'user' : 'assistant',
        snippet: buildAIConversationSearchSnippet(body, normalizedConversationSearchQuery),
        updatedAt: activeConversation.updatedAt,
      })]
    })
  }, [activeConversation, normalizedConversationSearchQuery, panelState.messages])
  const requestConversationSmoothScrollToBottom = useCallback(() => {
    setConversationScrollSignal((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!activeConversation && activeSettingsTab === 'backup') {
      setActiveSettingsTab('')
    }
  }, [activeConversation, activeSettingsTab])

  useEffect(() => {
    if (!globalSearchOpen || !globalSearchInputRef.current) {
      return
    }
    globalSearchInputRef.current.focus()
    globalSearchInputRef.current.select()
  }, [globalSearchOpen])

  useEffect(() => {
    if (!conversationSearchOpen || !conversationSearchInputRef.current) {
      return
    }
    conversationSearchInputRef.current.focus()
    conversationSearchInputRef.current.select()
  }, [conversationSearchOpen])

  useEffect(() => {
    if (!conversationSearchOpen) {
      return
    }
    if (conversationSearchResults.length === 0) {
      setConversationSearchIndex(0)
      return
    }
    setConversationSearchIndex((current) => (current >= conversationSearchResults.length ? 0 : current))
  }, [conversationSearchOpen, conversationSearchResults.length])

  useEffect(() => {
    if (!conversationSearchOpen || !normalizedConversationSearchQuery || conversationSearchResults.length === 0) {
      return
    }
    const activeResult = conversationSearchResults[conversationSearchIndex] || conversationSearchResults[0]
    if (!activeResult?.messageId || typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-conversation-diff-locate', {
      detail: {
        sessionId: sessionId || '',
        terminalId: terminalId || '',
        messageId: activeResult.messageId,
      },
    }))
  }, [conversationSearchIndex, conversationSearchOpen, conversationSearchResults, normalizedConversationSearchQuery, sessionId, terminalId])

  useEffect(() => {
    if (!globalSearchOpen) {
      setGlobalSearchLoading(false)
      setGlobalSearchResults([])
      return
    }
    if (!normalizedGlobalSearchQuery) {
      setGlobalSearchLoading(false)
      setGlobalSearchResults([])
      return
    }
    const requestId = globalSearchRequestRef.current + 1
    globalSearchRequestRef.current = requestId
    setGlobalSearchLoading(true)
    const timer = window.setTimeout(() => {
      searchAIConversationMessages(normalizedGlobalSearchQuery, '', 50)
        .then((results) => {
          if (!panelMountedRef.current || globalSearchRequestRef.current !== requestId) {
            return
          }
          setGlobalSearchResults(results)
        })
        .catch(() => {
          if (!panelMountedRef.current || globalSearchRequestRef.current !== requestId) {
            return
          }
          setGlobalSearchResults([])
        })
        .finally(() => {
          if (!panelMountedRef.current || globalSearchRequestRef.current !== requestId) {
            return
          }
          setGlobalSearchLoading(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [globalSearchOpen, normalizedGlobalSearchQuery])

  const resetComposerEditState = useCallback(() => {
    setComposerEditState({ mode: 'new', targetMessageId: '', targetMessageText: '' })
    setComposerInputValue('')
    setComposerImages([])
  }, [])

  const setPanelState = useCallback((panelKey: string, updater: ((current: PanelState) => PanelState) | Partial<PanelState>) => {
    const previousPanels = terminalPanelsRef.current || {}
    const current = previousPanels[panelKey] || createEmptyPanelState()
    const nextState = typeof updater === 'function' ? updater(current) : {
      ...current,
      ...(updater || {}),
    }
    const nextPanels = {
      ...previousPanels,
      [panelKey]: nextState,
    }
    terminalPanelsRef.current = nextPanels
    setTerminalPanels(nextPanels)
    return nextState
  }, [])

  const getMessageApiLengthBefore = useCallback((message: AIMessage) => {
    const rawValue = message?.extra?.apiLengthBefore
    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0
  }, [])

  const truncateConversationAfterMessage = useCallback((conversation: AIConversationSnapshot, messageId: string) => {
    if (!conversation || !Array.isArray(conversation.messages)) {
      return conversation
    }

    const messages = conversation.messages
    const messageIndex = messages.findIndex((message) => message.id === messageId)
    if (messageIndex === -1) {
      return conversation
    }

    const { cutIndex, turnId: targetTurnId } = getConversationBranchAnchor(messages, messageId)
    const anchorMessage = messages[cutIndex]
    const nextMessages = messages.slice(0, cutIndex)
    // Assistant-turn child messages truncate from their owning assistant turn.
    // Plain user messages remain independent round boundaries.
    const apiAnchorUIMessageId = targetTurnId || anchorMessage?.id || messageId
    let apiCutIndex = findApiAnchorIndexByUiMessageId(conversation.apiMessages, apiAnchorUIMessageId)

    if (apiCutIndex < 0) {
      apiCutIndex = getMessageApiLengthBefore(anchorMessage)
    }
    if (apiCutIndex < 0) {
      apiCutIndex = 0
    }

    return {
      ...conversation,
      updatedAt: Date.now(),
      status: 'idle',
      messages: nextMessages,
      apiMessages: Array.isArray(conversation.apiMessages) ? conversation.apiMessages.slice(0, apiCutIndex) : [],
    }
  }, [getMessageApiLengthBefore])

  const applyAITokenFudgeFactor = useCallback((rawTokens: unknown) => {
    if (!Number.isFinite(Number(rawTokens)) || Number(rawTokens) <= 0) {
      return 0
    }
    return Math.trunc(Number(rawTokens))
  }, [])

  const computeAITokenLedgerContextTokens = useCallback((ledger: { systemRawTokens?: unknown; entries?: unknown[] }) => {
    if (!ledger || typeof ledger !== 'object') {
      return 0
    }
    const systemRawTokens = Number(ledger.systemRawTokens) || 0
    let totalRawTokens = systemRawTokens
    ledger.entries?.forEach((rawTokens) => {
      totalRawTokens += Number(rawTokens) || 0
    })
    return applyAITokenFudgeFactor(totalRawTokens)
  }, [applyAITokenFudgeFactor])

  const buildAIConversationCurrentApiMessageIds = useCallback((snapshot: AIConversationSnapshot) => {
    const apiMessages = Array.isArray(snapshot?.apiMessages) ? snapshot.apiMessages : []
    return apiMessages
      .map((message) => (typeof message?.messageId === 'string' ? message.messageId.trim() : ''))
      .filter((messageId) => messageId)
  }, [])

  // 全量重建账本: 进入任务/恢复备份/压缩后调用,对每个节点逐条重算 raw token 并持久化到内存账本
  const rebuildAIConversationTokenLedger = useCallback(async (snapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey) => {
    if (!snapshot?.id) {
      return 0
    }
    try {
      const ledger = await buildAIConversationTokenLedger(terminalId, snapshot)
      if (!ledger) {
        return 0
      }
      const entryMap = new Map<string, number>()
      ledger.entries.forEach((entry) => {
        if (entry.messageId) {
          entryMap.set(entry.messageId, entry.rawTokens)
        }
      })
      const nextLedger = {
        systemRawTokens: ledger.systemRawTokens,
        entries: entryMap,
      }
      tokenLedgerRef.current.set(snapshot.id, nextLedger)
      const contextTokens = ledger.contextTokens || computeAITokenLedgerContextTokens({
        systemRawTokens: nextLedger.systemRawTokens,
        entries: Array.from(entryMap.values()),
      })
      setPanelState(targetPanelKey, (current) => {
        if (current.activeConversationId !== snapshot.id) {
          return current
        }
        return {
          ...current,
          contextTokens,
        }
      })
      return contextTokens
    } catch {
      return 0
    }
  }, [computeAITokenLedgerContextTokens, panelInstanceKey, setPanelState, terminalId])

  // 增量刷新账本: 只对账本里尚未记录的新增节点算 raw token, 已删除节点从账本移除, 然后按剩余节点求和
  const refreshAIConversationContextTokens = useCallback(async (snapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey) => {
    if (!snapshot?.id) {
      return 0
    }
    const existingLedger = tokenLedgerRef.current.get(snapshot.id)
    if (!existingLedger) {
      return rebuildAIConversationTokenLedger(snapshot, targetPanelKey)
    }
    const currentApiMessageIds = buildAIConversationCurrentApiMessageIds(snapshot)
    const currentIdSet = new Set(currentApiMessageIds)
    // 删除/编辑/重试导致的节点消失: 从账本移除
    const nextEntries = new Map<string, number>()
    existingLedger.entries.forEach((rawTokens, messageId) => {
      if (currentIdSet.has(messageId)) {
        nextEntries.set(messageId, rawTokens)
      }
    })
    // 追加的新节点: 只算账本里没有的那几条
    const apiMessages = Array.isArray(snapshot.apiMessages) ? snapshot.apiMessages : []
    const missingMessages = apiMessages.filter((message) => {
      const messageId = typeof message?.messageId === 'string' ? message.messageId.trim() : ''
      return messageId && !nextEntries.has(messageId)
    })
    if (missingMessages.length > 0) {
      try {
        const entries = await countAIConversationAPIMessageRawTokens(terminalId, snapshot.id, missingMessages)
        entries.forEach((entry) => {
          if (entry.messageId) {
            nextEntries.set(entry.messageId, entry.rawTokens)
          }
        })
      } catch {
        return rebuildAIConversationTokenLedger(snapshot, targetPanelKey)
      }
    }
    const nextLedger = {
      systemRawTokens: existingLedger.systemRawTokens,
      entries: nextEntries,
    }
    tokenLedgerRef.current.set(snapshot.id, nextLedger)
    const contextTokens = computeAITokenLedgerContextTokens({
      systemRawTokens: nextLedger.systemRawTokens,
      entries: Array.from(nextEntries.values()),
    })
    setPanelState(targetPanelKey, (current) => {
      if (current.activeConversationId !== snapshot.id) {
        return current
      }
      return {
        ...current,
        contextTokens,
      }
    })
    return contextTokens
  }, [buildAIConversationCurrentApiMessageIds, computeAITokenLedgerContextTokens, panelInstanceKey, rebuildAIConversationTokenLedger, setPanelState, terminalId])

  const saveConversationSnapshot = useCallback(async (snapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey, options: { hydrate?: boolean } = {}) => {
    const shouldHydrate = options?.hydrate === true
    const isTransientConversation = snapshot?.transient === true
    const saved = isTransientConversation
      ? {
          ...snapshot,
          updatedAt: typeof snapshot?.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
          messageCount: typeof snapshot?.messageCount === 'number'
            ? snapshot.messageCount
            : Array.isArray(snapshot?.messages) ? snapshot.messages.length : 0,
        }
      : await saveAIConversation(snapshot)
    if (!isTransientConversation) {
      setConversationList((prev) => upsertConversationSummary(prev, saved))
    }
    setPanelState(targetPanelKey, (current) => {
      if (current.activeConversationId !== saved.id) {
        return current
      }
      if (!shouldHydrate) {
        return {
          ...current,
          conversation: {
            ...saved,
            messages: current.messages,
            apiMessages: current.apiMessages,
          },
        }
      }
      return {
        ...current,
        conversation: saved,
        messages: saved.messages || [],
        apiMessages: saved.apiMessages || [],
      }
    })
    void refreshAIConversationContextTokens(saved, targetPanelKey)
    return saved
  }, [panelInstanceKey, refreshAIConversationContextTokens, setPanelState])

  useEffect(() => {
    if (terminalPanelsRef.current[panelInstanceKey]) {
      return
    }
    setTerminalPanels((prev) => ({
      ...prev,
      [panelInstanceKey]: createEmptyPanelState(),
    }))
  }, [panelInstanceKey])

  useEffect(() => {
    void refreshAIHomeData()
  }, [refreshAIHomeData])

  // 代理节点变更时刷新 AI 设置中的代理列表
  useEffect(() => {
    const handler = (event: Event) => {
      const newProxyNodes = (event as CustomEvent).detail
      if (!Array.isArray(newProxyNodes)) return
      setGlobalAISettings((prev) => prev ? { ...prev, proxyNodes: newProxyNodes } : prev)
    }
    window.addEventListener('lumin:proxy-nodes-changed', handler)
    return () => window.removeEventListener('lumin:proxy-nodes-changed', handler)
  }, [])

  useEffect(() => subscribeAIConversationChanges((change: unknown) => {
    const rawChange = change && typeof change === 'object' ? change as Record<string, unknown> : null
    if (!rawChange) {
      return
    }
    const summary = rawChange.summary as AIConversationSnapshot | null | undefined
    if (rawChange.type === 'upsert' && summary?.id) {
      setConversationList((current) => upsertConversationSummary(current, summary))
      return
    }
    if (rawChange.type !== 'delete' || !rawChange.conversationId) {
      return
    }
    setConversationList((current) => current.filter((item) => item.id !== rawChange.conversationId))
    const panel = terminalPanelsRef.current[panelInstanceKey]
    if (panel?.activeConversationId !== rawChange.conversationId) {
      return
    }
    const requestId = panel.activeRequestId
    setPanelState(panelInstanceKey, createEmptyPanelState())
    clearThemeToolPreviewPackage()
    clearRestorePreview()
    resetComposerEditState()
    resetGlobalSearchState()
    resetConversationSearchState()
    if (requestId) {
      void cancelAIChat(requestId)
    }
  }), [clearRestorePreview, panelInstanceKey, resetComposerEditState, resetConversationSearchState, resetGlobalSearchState, setPanelState])

  useEffect(() => () => {
    audioPlayersRef.current.forEach((audio) => {
      try {
        audio.pause()
        audio.src = ''
      } catch {}
    })
    audioPlayersRef.current.clear()
  }, [])

  useEffect(() => {
    if (!showSettingsPanel) {
      return
    }
    getAIGlobalSettings()
      .then((settings) => {
        setGlobalAISettings(settings)
      })
      .catch(() => {})
  }, [showSettingsPanel])


  useEffect(() => {
    const unbind = EventsOn('ai-chat-stream', (payload) => {
      const requestId = payload?.requestId
      if (!requestId) {
        return
      }

      const panels = terminalPanelsRef.current
      const matchedEntry = Object.entries(panels).find(([, state]) => state?.activeRequestId === requestId)
      if (!matchedEntry) {
        return
      }

      const [matchedPanelKey, matchedPanel] = matchedEntry
      const conversation = matchedPanel.conversation
      if (!conversation) {
        return
      }

      if (payload.kind === 'runtime_phase') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          runtimePhase: normalizeAIRuntimePhase(payload.phase),
        }))
        return
      }

      if (payload.kind === 'theme_tool_preview' && payload.theme) {
        setThemeToolPreviewPackage(payload.theme)
        return
      }

      if (payload.kind === 'theme_tool_reverted') {
        clearThemeToolPreviewPackage()
        return
      }

      if (payload.kind === 'theme_tool_committed') {
        clearThemeToolPreviewPackage()
        void loadThemePackages().catch(() => {})
        return
      }

      if (payload.kind === 'collaboration_pending') {
        let shouldInterruptPendingCollaboration = false
        const pendingMode = normalizeAICollaborationMode(payload.mode)
        setPanelState(matchedPanelKey, (current) => {
          if (current.collaborationInterruptedRequestId === requestId || (pendingMode !== 'forced' && !shouldLockAssistantCollaboration)) {
            shouldInterruptPendingCollaboration = true
            return {
              ...current,
              collaborationLocked: false,
              collaborationActive: false,
              collaborationMode: '',
              collaborationStreamBuffer: '',
              collaborationAwaitingManualFollowup: false,
              collaborationFollowupRequestId: '',
              collaborationPendingMode: '',
              collaborationPendingRequestId: '',
              collaborationInterruptedRequestId: requestId,
              collaborationStatusStartedAtMs: 0,
              collaborationStatusFirstTokenAtMs: 0,
              collaborationStatusText: '',
              collaborationStatusReasoningText: '',
            }
          }
          return {
            ...current,
            collaborationPendingMode: pendingMode,
            collaborationPendingRequestId: requestId,
          }
        })
        if (shouldInterruptPendingCollaboration) {
          void disableAIChatCollaboration(requestId).catch(() => {})
        }
        return
      }

      if (payload.kind === 'collaboration_started') {
        if (matchedPanel.collaborationMode === 'summary_subtask') {
          return
        }
        setComposerInputValue('')
        setComposerImages([])
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          requestPhase: 'idle',
          activeToolExecution: null,
          collaborationLocked: true,
          collaborationActive: true,
          collaborationMode: normalizeAICollaborationMode(payload.mode),
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
          collaborationInterruptedRequestId: '',
          collaborationStatusStartedAtMs: Date.now(),
          collaborationStatusFirstTokenAtMs: 0,
          collaborationStatusText: '',
          collaborationStatusReasoningText: '',
        }))
        return
      }

      if (payload.kind === 'collaboration_reasoning_delta') {
        const nextDelta = typeof payload.delta === 'string' ? payload.delta : ''
        if (!nextDelta) {
          return
        }
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          collaborationStatusFirstTokenAtMs: current.collaborationStatusFirstTokenAtMs || Date.now(),
          collaborationStatusReasoningText: `${typeof current.collaborationStatusReasoningText === 'string' ? current.collaborationStatusReasoningText : ''}${nextDelta}`,
        }))
        return
      }

      if (payload.kind === 'collaboration_delta') {
        let streamedCollaborationText = null
        setPanelState(matchedPanelKey, (current) => {
          const nextDelta = typeof payload.delta === 'string' ? payload.delta : ''
          const nextBuffer = `${typeof current.collaborationStreamBuffer === 'string' ? current.collaborationStreamBuffer : ''}${nextDelta}`
          if (current.collaborationMode === 'summary_subtask') {
            const displayBuffer = nextBuffer
              .replace(/<subtask_title>[\s\S]*?<\/subtask_title>/giu, '')
              .replace(/<subtask_summary>/giu, '')
              .replace(/<\/subtask_summary>/giu, '')
              .trim()
            streamedCollaborationText = displayBuffer
            return {
              ...current,
              collaborationStreamBuffer: nextBuffer,
              collaborationStatusFirstTokenAtMs: current.collaborationStatusFirstTokenAtMs || (nextDelta.trim() ? Date.now() : 0),
              collaborationStatusText: displayBuffer,
            }
          }
          const parsedCollaborationBuffer = parseAICollaborationStreamBuffer(nextBuffer)
          if (parsedCollaborationBuffer.decision === 'continue') {
            streamedCollaborationText = parsedCollaborationBuffer.bodyText
          }
          return {
            ...current,
            collaborationStreamBuffer: nextBuffer,
            collaborationStatusFirstTokenAtMs: current.collaborationStatusFirstTokenAtMs || (nextDelta.trim() ? Date.now() : 0),
            collaborationStatusText: `${typeof current.collaborationStatusText === 'string' ? current.collaborationStatusText : ''}${nextDelta}`,
          }
        })
        if (streamedCollaborationText !== null) {
          setComposerInputValue(streamedCollaborationText)
        }
        return
      }

      if (payload.kind === 'collaboration_context_condensed' && payload.snapshot) {
        const nextSnapshot = normalizeAIConversationSnapshot(payload.snapshot)
        setConversationList((prev) => upsertConversationSummary(prev, nextSnapshot))
        setPanelState(matchedPanelKey, (current) => {
          if (current.activeConversationId !== nextSnapshot.id) {
            return current
          }
          return {
            ...current,
            conversation: nextSnapshot,
            messages: nextSnapshot.messages,
            apiMessages: nextSnapshot.apiMessages,
            contextTokens: normalizeAIContextTokensValue(payload.newContextTokens),
          }
        })
        void rebuildAIConversationTokenLedger(nextSnapshot, matchedPanelKey)
        return
      }

      if (payload.kind === 'auto_recovery_started') {
        const recoveryRequestId = typeof payload.recoveryRequestId === 'string' ? payload.recoveryRequestId.trim() : ''
        setComposerInputValue('')
        setComposerImages([])
        setPanelState(matchedPanelKey, (current) => {
          const previousAssistantMessageId = typeof current.activeAssistantMessageId === 'string' && current.activeAssistantMessageId.trim()
            ? current.activeAssistantMessageId.trim()
            : (typeof current.activeRequestId === 'string' ? current.activeRequestId.trim() : '')
          const nextMessages = (Array.isArray(current.messages) ? current.messages : []).filter((message) => {
            if (!message || typeof message !== 'object') {
              return true
            }
            if (previousAssistantMessageId && message.id === previousAssistantMessageId && message.kind === 'assistant') {
              return false
            }
            if (previousAssistantMessageId && message.id === `${previousAssistantMessageId}-reasoning` && message.kind === 'reasoning') {
              return false
            }
            return true
          })
          const nextConversation = current.conversation
            ? {
                ...current.conversation,
                messages: nextMessages,
              }
            : current.conversation
          return {
            ...current,
            conversation: nextConversation,
            messages: nextMessages,
            activeRequestId: recoveryRequestId || current.activeRequestId,
            activeAssistantMessageId: '',
            activeToolExecution: null,
            requestPhase: 'idle',
            runtimePhase: 'ready',
            isCondensingContext: true,
            collaborationLocked: true,
            collaborationActive: true,
            collaborationMode: 'summary_subtask',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
            collaborationPendingMode: '',
            collaborationPendingRequestId: '',
            collaborationInterruptedRequestId: '',
            collaborationStatusStartedAtMs: Date.now(),
            collaborationStatusFirstTokenAtMs: 0,
            collaborationStatusText: typeof payload.text === 'string' ? payload.text : '',
            collaborationStatusReasoningText: typeof payload.reasoningText === 'string' ? payload.reasoningText : '',
          }
        })
        return
      }

      if (payload.kind === 'auto_recovery_status') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          collaborationLocked: true,
          collaborationActive: true,
          collaborationMode: 'summary_subtask',
          collaborationStatusText: typeof payload.text === 'string' ? payload.text : '',
          collaborationStatusReasoningText: typeof payload.reasoningText === 'string' ? payload.reasoningText : '',
        }))
        return
      }

      if (payload.kind === 'auto_recovery_run_full_summary') {
        // 统一复用“手动全量摘要”的标准入口，不再保留自动链自己的特殊 requestId/协同态初始化路径
        // 这样子任务创建、摘要请求、继续任务都与手动全量摘要保持同一执行源
        void runAIConversationSummarySubtaskFlow(matchedPanel.conversation || conversation, {
          autoRecoverySubtaskHops: 1,
        })
        return
      }

      if (payload.kind === 'collaboration_finished') {
        if (matchedPanel.collaborationMode === 'summary_subtask') {
          return
        }
        const decision = normalizeAICollaborationDecision(payload.decision)
        const finalCollaborationText = typeof payload.text === 'string' ? payload.text : ''
        const isFallbackFollowup = decision === 'fallback_followup'
        setComposerImages([])
        if (decision === 'continue' && finalCollaborationText.trim()) {
          setComposerInputValue(finalCollaborationText)
          setPanelState(matchedPanelKey, (current) => ({
            ...current,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
            collaborationPendingMode: '',
            collaborationPendingRequestId: '',
            collaborationInterruptedRequestId: '',
            collaborationStatusStartedAtMs: 0,
            collaborationStatusFirstTokenAtMs: 0,
            collaborationStatusText: '',
            collaborationStatusReasoningText: '',
            queuedSubmission: buildAIQueuedSubmission({
              kind: 'chat',
              text: finalCollaborationText,
              images: [],
            }),
            isFlushingQueuedSubmission: false,
          }))
          return
        }
        setComposerInputValue('')
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          collaborationLocked: isFallbackFollowup ? false : current.collaborationLocked,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: isFallbackFollowup,
          collaborationFollowupRequestId: isFallbackFollowup ? requestId : '',
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
          collaborationInterruptedRequestId: '',
          collaborationStatusStartedAtMs: 0,
          collaborationStatusFirstTokenAtMs: 0,
          collaborationStatusText: '',
          collaborationStatusReasoningText: '',
        }))
        return
      }

      if (payload.kind === 'assistant_retry_reset') {
        const assistantMessageId = typeof payload.messageId === 'string' && payload.messageId.trim()
          ? payload.messageId.trim()
          : (matchedPanel.activeAssistantMessageId || requestId)
        setPanelState(matchedPanelKey, (current) => {
          const nextMessages = (Array.isArray(current.messages) ? current.messages : [])
            .filter((message) => {
              if (!message || typeof message !== 'object') {
                return true
              }
              if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
                return false
              }
              if (message.id !== assistantMessageId && message.turnId === assistantMessageId) {
                return false
              }
              return true
            })
            .map((message) => {
              if (message.id !== assistantMessageId || message.kind !== 'assistant') {
                return message
              }
              return {
                ...message,
                text: '▍',
                metrics: [],
                streaming: true,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: true,
                  firstTokenAtMs: 0,
                  statusStartedAtMs: Date.now(),
                  errorText: '',
                },
              }
            })
          const nextApiMessages = trimLatestAssistantAPIHistoryMessage(current.apiMessages)
          return {
            ...current,
            activeAssistantMessageId: assistantMessageId,
            requestPhase: 'streaming',
            runtimePhase: 'api_request',
            messages: nextMessages,
            apiMessages: nextApiMessages,
            lastAssistantTurnId: assistantMessageId,
            lastTurnBusinessMessageKind: '',
          }
        })
        return
      }

      if (payload.kind === 'assistant_replace') {
        let snapshotBeforeAssistantMessagePersist = null
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nextMessages = current.messages.map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            return {
              ...message,
              text: typeof payload.text === 'string' ? payload.text : '',
              metrics: buildMetrics(payload),
              streaming: Boolean(payload.streaming),
              extra: {
                ...(message.extra || {}),
                requestStatusLive: false,
                finishedAtMs: Date.now(),
                errorText: '',
              },
            }
          })
          if (current.conversation) {
            snapshotBeforeAssistantMessagePersist = {
              ...current.conversation,
              updatedAt: Date.now(),
              status: current.conversation.status,
              messages: Array.isArray(current.messages)
                ? current.messages.filter((message) => {
                    if (!message || typeof message !== 'object') {
                      return false
                    }
                    if (message.id === assistantMessageId && (message.kind === 'assistant' || message.kind === 'reasoning')) {
                      return false
                    }
                    return true
                  })
                : [],
              apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
            }
          }
          return {
            ...current,
            messages: nextMessages,
          }
        })
        setProviderBalanceRefreshSignal((current) => current + 1)
        if (snapshotBeforeAssistantMessagePersist) {
          void saveConversationSnapshot(snapshotBeforeAssistantMessagePersist, matchedPanelKey, { hydrate: false })
        }
        return
      }

      if (payload.kind === 'assistant_continue' && typeof payload.messageId === 'string' && payload.messageId.trim()) {
        let snapshotBeforeNextRequest = null
        setPanelState(matchedPanelKey, (current) => {
          if (current.conversation) {
            snapshotBeforeNextRequest = {
              ...current.conversation,
              updatedAt: Date.now(),
              status: 'streaming',
              messages: Array.isArray(current.messages) ? [...current.messages] : [],
              apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
            }
          }
          // 智能压缩就地重试：正式 AI 请求开始的这一刻已不属于助理协同态。
          // 收到 assistant_continue 且当前处于 summary_subtask 协同态时，退出协同态并回落为普通流式。
          const shouldExitSummarySubtaskCollaboration = current.collaborationMode === 'summary_subtask'
          return {
            ...current,
            activeAssistantMessageId: payload.messageId,
            activeToolExecution: null,
            requestPhase: 'streaming',
            messages: [
              ...(Array.isArray(current.messages) ? current.messages : []),
              {
                id: payload.messageId,
                turnId: payload.messageId,
                kind: 'assistant',
                text: '▍',
                time: formatMessageTime(),
                metrics: buildMetrics(payload),
                streaming: true,
                extra: {
                  statusStartedAtMs: Date.now(),
                  firstTokenAtMs: 0,
                  requestStatusLive: true,
                  errorText: '',
                },
              },
            ],
            lastAssistantTurnId: payload.messageId,
            lastTurnBusinessMessageKind: '',
            ...(shouldExitSummarySubtaskCollaboration ? {
              isCondensingContext: false,
              collaborationLocked: shouldLockAssistantCollaboration,
              collaborationActive: false,
              collaborationMode: '',
              collaborationStreamBuffer: '',
              collaborationAwaitingManualFollowup: false,
              collaborationFollowupRequestId: '',
              collaborationPendingMode: '',
              collaborationPendingRequestId: '',
              collaborationInterruptedRequestId: '',
              collaborationStatusStartedAtMs: 0,
              collaborationStatusFirstTokenAtMs: 0,
              collaborationStatusText: '',
              collaborationStatusReasoningText: '',
            } : {}),
          }
        })
        if (snapshotBeforeNextRequest) {
          void saveConversationSnapshot(snapshotBeforeNextRequest, matchedPanelKey, { hydrate: false })
        }
        return
      }

      if (payload.kind === 'append_message' && payload.message) {
        setPanelState(matchedPanelKey, (current) => {
          const fallbackTurnId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            messages: payload.message.kind === 'user'
              ? [...(Array.isArray(current.messages) ? current.messages : []), payload.message]
              : insertMessageBeforeAssistant(current.messages, fallbackTurnId, payload.message),
            ...updateAILastAssistantTurnState(current, payload.message, fallbackTurnId),
          }
        })
        return
      }

      if (payload.kind === 'upsert_message' && payload.message) {
        const completionSound = resolveAIEventSound(
          payload,
          payload.message.kind === 'completion' && String(payload.message.status || '').trim() === '已完成' ? 'completion' : '',
        )
        if (completionSound) {
          playAISound(completionSound)
        }
        const nextMessage = (() => {
          const normalizedMessage = enrichAIChatCommandMessage(payload.message)
          if (normalizedMessage?.kind === 'followup' && normalizeAIMessageStatus(normalizedMessage.status) !== AI_FOLLOWUP_PENDING_STATUS_KEY) {
            return {
              ...normalizedMessage,
              requestId: '',
            }
          }
          return normalizedMessage
        })()
        setPanelState(matchedPanelKey, (current) => {
          const fallbackTurnId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            messages: upsertMessageBeforeAssistant(current.messages, fallbackTurnId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, fallbackTurnId),
          }
        })
        return
      }

      if (payload.kind === 'api_message_append' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          apiMessages: upsertAPIHistoryMessage(current.apiMessages, payload.message, current.messages),
        }))
        return
      }

      if (payload.kind === 'collaboration_force_user_takeover') {
        const takeoverText = typeof payload.text === 'string' ? payload.text.trim() : ''
        if (takeoverText) {
          setComposerInputValue((current) => {
            const currentValue = typeof current === 'string' ? current : ''
            return currentValue ? `${takeoverText}${currentValue}` : takeoverText
          })
        }
        return
      }

      if (payload.kind === 'followup_required' && payload.message) {
        const followupSound = resolveAIEventSound(payload, 'notification')
        if (followupSound) {
          playAISound(followupSound)
        }
        const nextMessage = payload.message
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          const nextMessages = upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage)
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: nextMessages,
                apiMessages: current.apiMessages,
              }
            : null
          return {
            ...current,
            activeRequestId: requestId,
            activeAssistantMessageId: anchorAssistantMessageId,
            activeToolExecution: null,
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            resumeAfterCancelRequestId: '',
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            messages: nextMessages,
            lastAssistantTurnId: anchorAssistantMessageId,
            lastTurnBusinessMessageKind: 'followup',
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'change_review_required' && payload.review) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeChangeReview: payload.review,
        }))
        return
      }

      if (payload.kind === 'tool_approval_required' && Array.isArray(payload.messages)) {
        const toolApprovalSound = resolveAIEventSound(payload, 'notification', false)
        if (toolApprovalSound) {
          playAISound(toolApprovalSound)
        }
        const rawToolMessages = payload.messages
        const toolMessages = rawToolMessages
          .filter((message: AIMessage) => message && typeof message === 'object')
          .map((message: AIMessage) => message)
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          const lastToolMessage = toolMessages.length > 0 ? toolMessages[toolMessages.length - 1] : null
          let nextMessages = Array.isArray(current.messages) ? [...current.messages] : []
          nextMessages = nextMessages.filter((message) => !toolMessages.some((toolMessage: AIMessage) => toolMessage.id && toolMessage.id === message.id))
          toolMessages.forEach((toolMessage: AIMessage) => {
            nextMessages = insertMessageBeforeAssistant(nextMessages, anchorAssistantMessageId, toolMessage)
          })
          nextConversation = {
            ...conversation,
            updatedAt: Date.now(),
            status: 'awaiting_tool_approval',
            messages: nextMessages,
            apiMessages: current.apiMessages,
          }
          return {
            ...current,
            activeAssistantMessageId: anchorAssistantMessageId,
            activeToolExecution: null,
            toolApprovalMode: typeof payload.approvalMode === 'string' ? payload.approvalMode : '',
            requestPhase: 'awaiting_tool_approval',
            activeChangeReview: typeof payload.approvalMode === 'string' && payload.approvalMode === 'change_review' ? current.activeChangeReview : null,
            conversation: nextConversation,
            messages: nextMessages,
            ...updateAILastAssistantTurnState(current, lastToolMessage, anchorAssistantMessageId),
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_approval_resolved') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          toolApprovalMode: '',
          requestPhase: 'streaming',
          activeChangeReview: null,
        }))
        return
      }

      if (payload.kind === 'tool_execution_started' && payload.message) {
        const nextMessage = enrichAIChatCommandMessage(payload.message)
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            requestPhase: 'running_tool',
            toolApprovalMode: '',
            activeChangeReview: null,
            activeToolExecution: {
              executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
              allowContinue: false,
              allowTerminate: payload.allowTerminate !== false,
              allowTerminalAssignment: false,
            },
            messages: upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, anchorAssistantMessageId),
          }
        })
        return
      }

      if (payload.kind === 'tool_execution_terminal_assignment_required' && payload.message) {
        const terminalAssignmentSound = resolveAIEventSound(payload, 'notification')
        if (terminalAssignmentSound) {
          playAISound(terminalAssignmentSound)
        }
        const nextMessage = enrichAIChatCommandMessage(payload.message)
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            requestPhase: 'awaiting_terminal_assignment',
            toolApprovalMode: '',
            activeChangeReview: null,
            activeToolExecution: {
              executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
              allowContinue: false,
              allowTerminate: payload.allowTerminate !== false,
              allowTerminalAssignment: true,
            },
            messages: upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, anchorAssistantMessageId),
          }
        })
        return
      }

      if (payload.kind === 'tool_execution_action_required' && payload.message) {
        const commandActionSound = resolveAIEventSound(payload, 'notification')
        if (commandActionSound) {
          playAISound(commandActionSound)
        }
        const nextMessage = enrichAIChatCommandMessage(payload.message)
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            requestPhase: 'awaiting_command_action',
            toolApprovalMode: '',
            activeChangeReview: null,
            activeToolExecution: {
              executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
              allowContinue: payload.allowContinue === true,
              allowTerminate: payload.allowTerminate !== false,
              allowTerminalAssignment: false,
            },
            messages: upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, anchorAssistantMessageId),
          }
        })
        return
      }

      if (payload.kind === 'tool_execution_action_resolved') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          toolApprovalMode: '',
          requestPhase: 'streaming',
          activeChangeReview: null,
        }))
        return
      }

      if (payload.kind === 'tool_execution_persist_requested') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          if (!current.conversation) {
            return current
          }
          nextConversation = {
            ...current.conversation,
            updatedAt: Date.now(),
            status: current.requestPhase === 'streaming' ? 'streaming' : current.conversation.status,
            messages: Array.isArray(current.messages) ? [...current.messages] : [],
            apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
          }
          return {
            ...current,
            conversation: nextConversation,
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_execution_terminated') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: Array.isArray(current.messages) ? [...current.messages] : [],
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            activeToolExecution: null,
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            resumeAfterCancelRequestId: '',
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            messages: nextConversation ? nextConversation.messages : current.messages,
            apiMessages: nextConversation ? nextConversation.apiMessages : current.apiMessages,
            recoverableToolStopReason: 'terminated',
            collaborationLocked: false,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_rejected') {
        let nextConversation = null
        const shouldResumeAfterCancel = matchedPanel.resumeAfterCancelRequestId === requestId
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nextMessages = current.messages.map((message) => {
            if (message.id === assistantMessageId && message.kind === 'assistant') {
              return {
                ...message,
                metrics: Array.isArray(message.metrics) ? message.metrics : [],
                streaming: false,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: false,
                },
              }
            }
            if ((message.kind === 'tool' || message.kind === 'command') && AI_CONVERSATION_DIFF_SUCCESS_STATUSES.size >= 0 && ['待批准', '执行中', AI_FOLLOWUP_PENDING_STATUS_KEY, '排队中, 等待终端空闲'].includes(normalizeAIMessageStatus(message.status))) {
              return {
                ...message,
                status: '已拒绝',
              }
            }
            return message
          })
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: nextMessages,
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            resumeAfterCancelRequestId: '',
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            messages: nextMessages,
            activeToolExecution: null,
            recoverableToolStopReason: 'rejected',
            collaborationLocked: false,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
          }
        })
        if (nextConversation) {
          if (shouldResumeAfterCancel) {
            void (async () => {
              const resumed = await resumeAIChatFromConversation(nextConversation, matchedPanelKey)
              if (!resumed) {
                await saveConversationSnapshot(nextConversation, matchedPanelKey)
              }
            })()
          } else {
            void saveConversationSnapshot(nextConversation, matchedPanelKey)
          }
        }
        return
      }

      if (payload.kind === 'automatic_request_skipped') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          const shouldKeepCollaborationLock = current.collaborationLocked && !current.collaborationAwaitingManualFollowup && Boolean(current.queuedSubmission)
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: Array.isArray(current.messages) ? [...current.messages] : [],
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            activeToolExecution: null,
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            recoverableToolStopReason: '',
            collaborationLocked: shouldKeepCollaborationLock,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: current.collaborationAwaitingManualFollowup,
            collaborationFollowupRequestId: current.collaborationAwaitingManualFollowup ? current.collaborationFollowupRequestId : '',
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'reasoning_delta') {
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const reasoningId = `${assistantMessageId}-reasoning`
          const currentMessages = Array.isArray(current.messages) ? current.messages : []
          const reasoningIndex = currentMessages.findIndex((message) => message.id === reasoningId && message.kind === 'reasoning')
          const nowMs = Date.now()

          const markAssistantFirstOutput = (messages: AIMessage[]) => messages.map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            const previousFirstTokenAtMs = Number(message.extra?.firstTokenAtMs)
            return {
              ...message,
              extra: {
                ...(message.extra || {}),
                requestStatusLive: true,
                firstTokenAtMs: Number.isFinite(previousFirstTokenAtMs) && previousFirstTokenAtMs > 0 ? previousFirstTokenAtMs : nowMs,
                errorText: '',
              },
            }
          })

          if (reasoningIndex >= 0) {
            const nextMessages = [...currentMessages]
            const previousText = typeof nextMessages[reasoningIndex].text === 'string' ? nextMessages[reasoningIndex].text : ''
            nextMessages[reasoningIndex] = {
              ...nextMessages[reasoningIndex],
              turnId: assistantMessageId,
              text: `${previousText}${payload.delta || ''}`,
              duration: '',
            }
            return {
              ...current,
              messages: markAssistantFirstOutput(nextMessages),
            }
          }

          return {
            ...current,
            messages: markAssistantFirstOutput(insertMessageBeforeAssistant(currentMessages, assistantMessageId, {
              id: reasoningId,
              turnId: assistantMessageId,
              kind: 'reasoning',
              text: payload.delta || '',
              duration: '',
            })),
          }
        })
        return
      }

      if (payload.kind === 'delta') {
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nowMs = Date.now()
          return {
            ...current,
            messages: current.messages.map((message) => {
              if (message.id !== assistantMessageId || message.kind !== 'assistant') {
                return message
              }
              const baseText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '') : ''
              const previousFirstTokenAtMs = Number(message.extra?.firstTokenAtMs)
              return {
                ...message,
                text: `${baseText}${payload.delta || ''}▍`,
                metrics: [],
                streaming: true,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: true,
                  firstTokenAtMs: Number.isFinite(previousFirstTokenAtMs) && previousFirstTokenAtMs > 0 ? previousFirstTokenAtMs : nowMs,
                  errorText: '',
                },
              }
            }),
          }
        })
        return
      }

      if (payload.kind === 'done') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const metrics = buildMetrics(payload)
        const reasoningDuration = buildReasoningDuration(payload)
        const shouldClearSummarySubtaskCollaboration = matchedPanel.collaborationMode === 'summary_subtask'
        const nextMessages = matchedPanel.messages.map((message) => {
          if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
            return {
              ...message,
              duration: reasoningDuration,
            }
          }
          if (message.id !== assistantMessageId || message.kind !== 'assistant') {
            return message
          }
          return {
            ...message,
            text: payload.text || String(message.text || '').replace(/▍$/u, ''),
            metrics,
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              finishedAtMs: Date.now(),
              errorText: '',
            },
          }
        })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'idle',
          messages: nextMessages,
          apiMessages: upsertAPIHistoryMessage(
            matchedPanel.apiMessages,
            {
              role: 'assistant',
              content: payload.text || '',
              messageId: `api-${assistantMessageId}`,
              turnId: assistantMessageId,
              ts: Date.now(),
            },
            nextMessages,
          ),
        }

        if (shouldClearSummarySubtaskCollaboration) {
          setComposerInputValue('')
          setComposerImages([])
        }
        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          skipNextAutomaticRequest: false,
          isCondensingContext: false,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: nextConversation.apiMessages,
          recoverableToolStopReason: '',
          collaborationLocked: shouldClearSummarySubtaskCollaboration ? false : matchedPanel.collaborationLocked,
          collaborationActive: shouldClearSummarySubtaskCollaboration ? false : matchedPanel.collaborationActive,
          collaborationMode: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationMode,
          collaborationStreamBuffer: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationStreamBuffer,
          collaborationAwaitingManualFollowup: shouldClearSummarySubtaskCollaboration ? false : matchedPanel.collaborationAwaitingManualFollowup,
          collaborationFollowupRequestId: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationFollowupRequestId,
          collaborationPendingMode: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationPendingMode,
          collaborationPendingRequestId: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationPendingRequestId,
          collaborationInterruptedRequestId: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationInterruptedRequestId,
          collaborationStatusStartedAtMs: shouldClearSummarySubtaskCollaboration ? 0 : matchedPanel.collaborationStatusStartedAtMs,
          collaborationStatusFirstTokenAtMs: shouldClearSummarySubtaskCollaboration ? 0 : matchedPanel.collaborationStatusFirstTokenAtMs,
          collaborationStatusText: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationStatusText,
          collaborationStatusReasoningText: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationStatusReasoningText,
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        setProviderBalanceRefreshSignal((current) => current + 1)
        return
      }

      if (payload.kind === 'error') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const finalErrorText = payload.error || translate('请求失败')
        playAISound('progress')

        const nextMessages = matchedPanel.messages
          .filter((message) => !(message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning'))
          .map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            return {
              ...message,
              text: '',
              metrics: [],
              streaming: false,
              extra: {
                ...(message.extra || {}),
                requestStatusLive: false,
                errorText: finalErrorText,
              },
            }
          })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'error',
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        }

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          toolApprovalMode: '',
          runtimePhase: 'ready',
          skipNextAutomaticRequest: false,
          isCondensingContext: false,
          activeChangeReview: null,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
          recoverableToolStopReason: '',
          collaborationLocked: false,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }

      if (payload.kind === 'cancelled') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const nextMessages = matchedPanel.messages.filter((message) => {
          if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
            return false
          }
          if (message.id === assistantMessageId && message.kind === 'assistant') {
            return false
          }
          return true
        })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'idle',
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        }

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          toolApprovalMode: '',
          runtimePhase: 'ready',
          skipNextAutomaticRequest: false,
          isCondensingContext: false,
          activeChangeReview: null,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
          recoverableToolStopReason: '',
          collaborationLocked: false,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }
    })

    return () => {
      if (unbind) {
        unbind()
      }
    }
  }, [enrichAIChatCommandMessage, playAISound, rebuildAIConversationTokenLedger, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration])

  useEffect(() => {
    const pendingRequestId = typeof panelState.collaborationPendingRequestId === 'string' ? panelState.collaborationPendingRequestId.trim() : ''
    const pendingMode = typeof panelState.collaborationPendingMode === 'string' ? panelState.collaborationPendingMode.trim() : ''
    if (!pendingRequestId || pendingRequestId !== panelState.activeRequestId || !activeConversation) {
      return undefined
    }
    if (!shouldLockAssistantCollaboration && pendingMode !== 'forced') {
      setPanelState(panelInstanceKey, (current) => {
        if (current.collaborationPendingRequestId !== pendingRequestId) {
          return current
        }
        return {
          ...current,
          collaborationLocked: false,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
          collaborationInterruptedRequestId: pendingRequestId,
          collaborationStatusStartedAtMs: 0,
          collaborationStatusFirstTokenAtMs: 0,
          collaborationStatusText: '',
          collaborationStatusReasoningText: '',
        }
      })
      return undefined
    }
    const hasRenderedPendingCard = pendingMode === 'followup'
      ? panelState.messages.some((message) => message?.kind === 'followup' && typeof message?.requestId === 'string' && message.requestId.trim() === pendingRequestId)
      : pendingMode === 'completion'
        ? panelState.messages.some((message) => message?.kind === 'completion' && message?.turnId === panelState.activeAssistantMessageId && normalizeAIMessageStatus(message?.status) === '等待处理')
        : false
    if (!hasRenderedPendingCard) {
      return undefined
    }
    let disposed = false
    const frameId = window.requestAnimationFrame(() => {
      if (disposed) {
        return
      }
      setPanelState(panelInstanceKey, (current) => {
        if (current.activeRequestId !== pendingRequestId || current.collaborationPendingRequestId !== pendingRequestId) {
          return current
        }
        return {
          ...current,
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
        }
      })
      void startAIChatCollaboration(pendingRequestId).catch(() => {
        if (disposed) {
          return
        }
        setPanelState(panelInstanceKey, (current) => {
          if (current.activeRequestId !== pendingRequestId) {
            return current
          }
          return {
            ...current,
            collaborationLocked: false,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
            collaborationPendingMode: '',
            collaborationPendingRequestId: '',
            collaborationStatusStartedAtMs: 0,
            collaborationStatusFirstTokenAtMs: 0,
            collaborationStatusText: '',
            collaborationStatusReasoningText: '',
          }
        })
      })
    })
    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
    }
  }, [activeConversation, panelInstanceKey, panelState.activeAssistantMessageId, panelState.activeRequestId, panelState.collaborationPendingMode, panelState.collaborationPendingRequestId, panelState.messages, setPanelState, shouldLockAssistantCollaboration])

  const conversationDiffItems = useMemo(() => {
    const sourceMessages = Array.isArray(panelState.messages) ? panelState.messages : []
    const collected = sourceMessages.flatMap((message, index) => {
      if (!message || typeof message !== 'object' || message.kind !== 'tool') {
        return []
      }
      const toolName = typeof message.actionLabel === 'string' ? message.actionLabel.trim() : ''
      const status = normalizeAIMessageStatus(message.status)
      const artifactPath = typeof message?.extra?.restoreArtifactPath === 'string' ? message.extra.restoreArtifactPath.trim() : ''
      const hasPreview = message?.extra?.conversationDiffHasPreview === true
      if (!AI_CONVERSATION_DIFF_TOOL_NAMES.has(toolName) || !AI_CONVERSATION_DIFF_SUCCESS_STATUSES.has(status) || !artifactPath || !hasPreview) {
        return []
      }
      const copyContent = typeof message?.extra?.copyContent === 'string' ? message.extra.copyContent : ''
      const summaryText = typeof message.summary === 'string' ? message.summary.trim() : ''
      const primaryPath = typeof message?.extra?.conversationDiffPrimaryPath === 'string' ? message.extra.conversationDiffPrimaryPath.trim() : ''
      const fileCountRaw = Number(message?.extra?.conversationDiffFileCount)
      const fileCount = Number.isFinite(fileCountRaw) && fileCountRaw > 0 ? Math.trunc(fileCountRaw) : 0
      const title = primaryPath
        ? fileCount > 1
          ? translate('{path} 等 {count} 个文件', { path: primaryPath, count: fileCount })
          : primaryPath
        : extractAIConversationDiffPrimaryPath(copyContent, summaryText)
      return [{
        id: typeof message.id === 'string' && message.id.trim() ? message.id.trim() : `conversation-diff-${index}`,
        messageId: typeof message.id === 'string' && message.id.trim() ? message.id.trim() : '',
        artifactPath,
        toolName,
        title,
        summary: summaryText,
        status,
        copyContent,
        order: index,
      }]
    })
    return collected
      .reverse()
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }))
  }, [panelState.messages])

  const handleOpenConversationDiff = useCallback(() => {
    if (typeof window === 'undefined' || conversationDiffItems.length === 0) {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-conversation-diff-open', {
      detail: {
        sessionId: sessionId || terminalId || '',
        terminalId: terminalId || '',
        items: conversationDiffItems,
      },
    }))
  }, [conversationDiffItems, sessionId, terminalId])

  const handleGoHome = useCallback(async () => {
    if (typeof window !== 'undefined') {
      if (terminalId) {
        window.dispatchEvent(new CustomEvent('ai-change-review-clear', {
          detail: { sessionId: terminalId },
        }))
      }
      window.dispatchEvent(new CustomEvent('ai-conversation-diff-close', {
        detail: {
          sessionId: sessionId || '',
          terminalId: terminalId || '',
        },
      }))
    }
    clearThemeToolPreviewPackage()
    clearRestorePreview()
    setShowSettingsPanel(false)
    setPopupDismissVersion((current) => current + 1)
    resetComposerEditState()
    resetGlobalSearchState()
    resetConversationSearchState()
    const previousRequestId = terminalPanelsRef.current[panelInstanceKey]?.activeRequestId
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      activeConversationId: '',
      conversation: null,
      messages: [],
      apiMessages: [],
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      toolApprovalMode: '',
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      contextTokens: 0,
      isCondensingContext: false,
      activeChangeReview: null,
      collaborationLocked: false,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
    }))
    if (previousRequestId) {
      try {
        await cancelAIChat(previousRequestId)
      } catch {}
    }
    await refreshAIHomeData()
  }, [clearRestorePreview, panelInstanceKey, refreshAIHomeData, resetComposerEditState, sessionId, setPanelState, terminalId])

  // ponytail: unmount/会话关闭时取消未决的 AI 请求，避免后端 aiPendingToolBatches 等 map 残留
  useEffect(() => {
    return () => {
      const id = terminalPanelsRef.current[panelInstanceKey]?.activeRequestId
      if (id) {
        void cancelAIChat(id)
      }
    }
  }, [panelInstanceKey])

  const handleOpenConversation = useCallback(async (conversationId: string) => {
    clearThemeToolPreviewPackage()
    clearRestorePreview()
    resetComposerEditState()
    resetGlobalSearchState()
    resetConversationSearchState()
    const snapshot = await getAIConversation(conversationId)
    const latestProviderState = await getAIProviderState().catch(() => ({
      currentProviderId: typeof aiProviderState?.currentProviderId === 'string' ? aiProviderState.currentProviderId.trim() : '',
      providers: availableAIProviders,
    }))
    const latestProviders = Array.isArray(latestProviderState?.providers) ? latestProviderState.providers : []
    const resolvedProviderId = resolveAvailableProviderId(latestProviders, snapshot?.settings?.currentProviderId)
    const nextSnapshot = buildConversationWithProviderId(snapshot, resolvedProviderId)
    setAIProviderState({
      currentProviderId: resolvedProviderId,
      providers: latestProviders,
    })
    setConversationList((prev) => upsertConversationSummary(prev, nextSnapshot))
    setPanelState(panelInstanceKey, {
      activeConversationId: nextSnapshot.id,
      conversation: nextSnapshot,
      messages: nextSnapshot.messages,
      apiMessages: nextSnapshot.apiMessages,
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      toolApprovalMode: '',
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      ...computeAILastAssistantTurnState(nextSnapshot.messages),
      contextTokens: 0,
      isCondensingContext: false,
      activeChangeReview: null,
      collaborationLocked: false,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
    })
    if (nextSnapshot !== snapshot) {
      await saveConversationSnapshot(nextSnapshot, panelInstanceKey)
      return
    }
    // 进入任务: 全量重建账本 (100% 可靠)
    void rebuildAIConversationTokenLedger(nextSnapshot, panelInstanceKey)
  }, [aiProviderState, availableAIProviders, buildConversationWithProviderId, panelInstanceKey, rebuildAIConversationTokenLedger, resetComposerEditState, resolveAvailableProviderId, saveConversationSnapshot, setPanelState])

  const handleRestoreConversationBackup = useCallback(async (snapshot: unknown) => {
    const rawSnapshot = snapshot && typeof snapshot === 'object' ? snapshot as AIConversationSnapshot : null
    if (!rawSnapshot?.id) {
      return
    }
    clearThemeToolPreviewPackage()
    clearRestorePreview()
    resetComposerEditState()
    resetGlobalSearchState()
    resetConversationSearchState()
    setConversationList((prev) => upsertConversationSummary(prev, rawSnapshot))
    setPanelState(panelInstanceKey, {
      activeConversationId: rawSnapshot.id,
      conversation: rawSnapshot,
      messages: rawSnapshot.messages,
      apiMessages: rawSnapshot.apiMessages,
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      toolApprovalMode: '',
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      ...computeAILastAssistantTurnState(rawSnapshot.messages),
      contextTokens: 0,
      isCondensingContext: false,
      activeChangeReview: null,
      collaborationLocked: false,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
    })
    // 恢复备份: 全量重建账本 (100% 可靠)
    void rebuildAIConversationTokenLedger(rawSnapshot, panelInstanceKey)
  }, [panelInstanceKey, rebuildAIConversationTokenLedger, resetComposerEditState, setPanelState])

  const handleOpenConversationFolder = useCallback(async (conversationId: string) => {
    try {
      await openAIConversationFolder(conversationId)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('打开任务所在文件夹失败')
      await showAlert(message)
    }
  }, [showAlert, t])

  const handleRenameConversationTitle = useCallback(async (targetConversationId = '') => {
    const normalizedTargetConversationId = typeof targetConversationId === 'string' ? targetConversationId.trim() : ''
    let conversationToRename = activeConversation
    if (!conversationToRename || (normalizedTargetConversationId && conversationToRename.id !== normalizedTargetConversationId)) {
      if (!normalizedTargetConversationId) {
        return
      }
      try {
        conversationToRename = await getAIConversation(normalizedTargetConversationId)
      } catch {
        return
      }
    }
    if (!conversationToRename || conversationToRename.transient === true) {
      return
    }
    const currentTitle = typeof conversationToRename.title === 'string' ? conversationToRename.title.trim() : ''
    const nextTitle = window?.luminDialog?.prompt
      ? await window.luminDialog.prompt(
          t('请输入任务标题'),
          currentTitle,
          t('编辑任务标题'),
          '',
          {
            validate: (value) => (String(value || '').trim() ? '' : t('任务标题不能为空')),
          },
        )
      : window.prompt(t('请输入任务标题'), currentTitle)
    if (nextTitle === null || nextTitle === undefined) {
      return
    }
    const trimmedTitle = String(nextTitle).trim()
    if (!trimmedTitle || trimmedTitle === currentTitle) {
      return
    }
    const nextConversation = {
      ...conversationToRename,
      title: trimmedTitle,
      updatedAt: Date.now(),
    }
    if (activeConversation?.id === nextConversation.id) {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversation,
      }))
    }
    await saveConversationSnapshot(nextConversation, panelInstanceKey)
    addToast?.(t('任务标题已更新'), 'success')
  }, [activeConversation, addToast, panelInstanceKey, saveConversationSnapshot, setPanelState, t])

  const locateConversationMessage = useCallback((messageId: string) => {
    const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : ''
    if (!normalizedMessageId || typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-conversation-diff-locate', {
      detail: {
        sessionId: sessionId || '',
        terminalId: terminalId || '',
        messageId: normalizedMessageId,
      },
    }))
  }, [sessionId, terminalId])

  const handleOpenGlobalSearch = useCallback(() => {
    setGlobalSearchOpen((current) => {
      const next = !current
      if (!next) {
        setGlobalSearchQuery('')
        setGlobalSearchLoading(false)
        setGlobalSearchResults([])
      }
      return next
    })
  }, [])

  const handleOpenConversationSearch = useCallback(() => {
    setConversationSearchOpen((current) => {
      const next = !current
      if (!next) {
        setConversationSearchQuery('')
        setConversationSearchIndex(0)
      }
      return next
    })
  }, [])

  const handleCycleConversationSearchResult = useCallback((direction: number) => {
    if (conversationSearchResults.length === 0) {
      return
    }
    setConversationSearchIndex((current) => {
      const total = conversationSearchResults.length
      return (current + direction + total) % total
    })
  }, [conversationSearchResults.length])

  const handleSelectGlobalSearchResult = useCallback(async (result: AIConversationMessageSearchResult) => {
    const conversationId = typeof result?.conversationId === 'string' ? result.conversationId.trim() : ''
    const messageId = typeof result?.messageId === 'string' ? result.messageId.trim() : ''
    if (!conversationId || !messageId) {
      return
    }
    if (conversationId !== panelState.activeConversationId) {
      await handleOpenConversation(conversationId)
    } else {
      resetGlobalSearchState()
    }
    window.setTimeout(() => {
      locateConversationMessage(messageId)
    }, 40)
  }, [handleOpenConversation, locateConversationMessage, panelState.activeConversationId, resetGlobalSearchState])

  const handleDeleteConversation = useCallback(async (conversationId: string) => {
    const deletingActiveConversation = panelState.activeConversationId === conversationId
    if (deletingActiveConversation) {
      clearThemeToolPreviewPackage()
    }
    clearRestorePreview()
    const confirmed = await requestDeleteConfirmation(t('确定删除这条对话吗？此操作不可撤销。'))
    if (!confirmed) {
      return
    }
    await deleteAIConversation(conversationId)
    tokenLedgerRef.current.delete(conversationId)
    setComposerEditState((current) => (
      current.mode !== 'new' && deletingActiveConversation
        ? { mode: 'new', targetMessageId: '', targetMessageText: '' }
        : current
    ))
    if (deletingActiveConversation) {
      await handleGoHome()
      return
    }
    const refreshedConversations = await listAIConversations().catch(() => [])
    setConversationList(Array.isArray(refreshedConversations) ? refreshedConversations : [])
    const currentActiveConversationId = typeof terminalPanelsRef.current?.[panelInstanceKey]?.activeConversationId === 'string'
      ? terminalPanelsRef.current[panelInstanceKey].activeConversationId.trim()
      : ''
    if (currentActiveConversationId && currentActiveConversationId !== conversationId && refreshedConversations.some((item) => item?.id === currentActiveConversationId)) {
      await handleOpenConversation(currentActiveConversationId)
    }
  }, [clearRestorePreview, handleGoHome, handleOpenConversation, panelInstanceKey, panelState.activeConversationId, requestDeleteConfirmation, t])

  const handleProviderChange = useCallback(async (providerId: string) => {
    const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
    const syncLatestProviderState = async () => {
      try {
        const latestProviderState = await getAIProviderState()
        setAIProviderState({
          currentProviderId: normalizedProviderId || latestProviderState.currentProviderId || '',
          providers: Array.isArray(latestProviderState?.providers) ? latestProviderState.providers : [],
        })
      } catch {
        setAIProviderState((current) => ({
          ...current,
          currentProviderId: normalizedProviderId,
        }))
      }
    }

    setAIProviderState((current) => ({
      ...current,
      currentProviderId: normalizedProviderId,
    }))
    if (activeConversation) {
      const nextConversation = {
        ...activeConversation,
        updatedAt: Date.now(),
        settings: {
          ...((activeConversation?.settings as Record<string, unknown> | null) || {}),
          currentProviderId: normalizedProviderId,
        },
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversation,
      }))
      await saveConversationSnapshot(nextConversation, panelInstanceKey)
      await syncLatestProviderState()
      return
    }

    const nextSettings = await saveAIGlobalSettings({
      ...(globalAISettings || {}),
      currentProviderId: normalizedProviderId,
    })
    setGlobalAISettings(nextSettings)
    await syncLatestProviderState()
  }, [activeConversation, globalAISettings, panelInstanceKey, saveConversationSnapshot, setPanelState])

  useEffect(() => {
    if (
      !shouldLockAssistantCollaboration
      || !activeConversation
      || panelState.requestPhase !== 'streaming'
      || !panelState.activeRequestId
      || panelState.collaborationLocked
      || panelState.collaborationInterruptedRequestId === panelState.activeRequestId
    ) {
      return
    }
    setPanelState(panelInstanceKey, (current) => {
      if (
        !current.conversation
        || current.requestPhase !== 'streaming'
        || !current.activeRequestId
        || current.collaborationLocked
        || current.collaborationInterruptedRequestId === current.activeRequestId
      ) {
        return current
      }
      return {
        ...current,
        collaborationLocked: true,
      }
    })
  }, [activeConversation, panelInstanceKey, panelState.activeRequestId, panelState.collaborationInterruptedRequestId, panelState.collaborationLocked, panelState.requestPhase, setPanelState, shouldLockAssistantCollaboration])

  const handlePatchAutoApprovalSettings = useCallback(async (patch: Record<string, unknown>) => {
    const { allowedCommands, deniedCommands, ...taskPatch } = patch || {}
    const hasGlobalOnlyPatch = allowedCommands !== undefined || deniedCommands !== undefined

    if (hasGlobalOnlyPatch) {
      const nextGlobalSettings = await saveAIGlobalSettings({
        ...normalizeAIGlobalSettings(globalAISettings),
        ...(allowedCommands !== undefined ? { allowedCommands } : {}),
        ...(deniedCommands !== undefined ? { deniedCommands } : {}),
      })
      setGlobalAISettings(nextGlobalSettings)
    }

    if (activeConversation && Object.keys(taskPatch).length > 0) {
      const nextConversation = {
        ...activeConversation,
        updatedAt: Date.now(),
        settings: normalizeAIConversationTaskSettings({
          ...((activeConversation?.settings as Record<string, unknown> | null) || {}),
          ...taskPatch,
        }),
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversation,
      }))
      await saveConversationSnapshot(nextConversation, panelInstanceKey)
    } else if (!activeConversation && Object.keys(taskPatch).length > 0) {
      const nextSettings = await saveAIGlobalSettings({
        ...normalizeAIGlobalSettings(globalAISettings),
        ...taskPatch,
      })
      setGlobalAISettings(nextSettings)
    }

    if (taskPatch.alwaysAllowFollowupQuestions === false) {
      let shouldDisableCurrentCollaboration = false
      let shouldMarkInterruptedRequestId = ''
      setComposerInputValue('')
      setPanelState(panelInstanceKey, (current) => {
        const activeMode = typeof current.collaborationMode === 'string' ? current.collaborationMode.trim() : ''
        const pendingMode = typeof current.collaborationPendingMode === 'string' ? current.collaborationPendingMode.trim() : ''
        const activeRequestId = typeof current.activeRequestId === 'string' ? current.activeRequestId.trim() : ''
        const pendingRequestId = typeof current.collaborationPendingRequestId === 'string' ? current.collaborationPendingRequestId.trim() : ''
        const isForcedActive = activeMode === 'forced'
        const isForcedPending = pendingMode === 'forced'
        if (!isForcedActive && !isForcedPending) {
          shouldDisableCurrentCollaboration = Boolean(activeRequestId)
          shouldMarkInterruptedRequestId = activeRequestId || pendingRequestId
        }
        return {
          ...current,
          collaborationLocked: false,
          collaborationActive: isForcedActive ? current.collaborationActive : false,
          collaborationMode: isForcedActive ? current.collaborationMode : '',
          collaborationStreamBuffer: isForcedActive ? current.collaborationStreamBuffer : '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
          collaborationPendingMode: isForcedPending ? current.collaborationPendingMode : '',
          collaborationPendingRequestId: isForcedPending ? current.collaborationPendingRequestId : '',
          collaborationInterruptedRequestId: shouldMarkInterruptedRequestId,
          collaborationStatusStartedAtMs: isForcedActive ? current.collaborationStatusStartedAtMs : 0,
          collaborationStatusFirstTokenAtMs: isForcedActive ? current.collaborationStatusFirstTokenAtMs : 0,
          collaborationStatusText: isForcedActive ? current.collaborationStatusText : '',
          collaborationStatusReasoningText: isForcedActive ? current.collaborationStatusReasoningText : '',
        }
      })
      if (shouldDisableCurrentCollaboration && panelState.activeRequestId) {
        void disableAIChatCollaboration(panelState.activeRequestId).catch(() => {})
      }
    }
  }, [activeConversation, globalAISettings, panelInstanceKey, panelState.activeRequestId, saveConversationSnapshot, setPanelState])

  const handleCollaborationExtraPromptChange = useCallback(async (nextValue: string) => {
    await handlePatchAutoApprovalSettings({ collaborationExtraPrompt: typeof nextValue === 'string' ? nextValue : '' })
  }, [handlePatchAutoApprovalSettings])

  const handleCollaborationPromptPresetsChange = useCallback(async (nextPresets: unknown) => {
    const nextGlobalSettings = await saveAIGlobalSettings({
      ...normalizeAIGlobalSettings(globalAISettings),
      collaborationPromptPresets: Array.isArray(nextPresets) ? nextPresets : [],
    })
    setGlobalAISettings(nextGlobalSettings)
  }, [globalAISettings])

  const handleSaveAIPanelGlobalSettings = useCallback(async (patch: Record<string, unknown>) => {
    const nextSettings = await saveAIGlobalSettings({
      ...normalizedGlobalAISettings,
      ...patch,
    })
    setGlobalAISettings(nextSettings)
    await refreshMCPServerInfo()
    return nextSettings
  }, [normalizedGlobalAISettings, refreshMCPServerInfo])
  const handleSaveMCPGlobalServer = useCallback(async (name: string, configText: string) => {
    await saveMCPGlobalServer(name, configText)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleReloadMCPGlobalServers = useCallback(async () => {
    await reloadMCPGlobalServers()
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleDeleteMCPGlobalServer = useCallback(async (name: string) => {
    await deleteMCPGlobalServer(name)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleRestartMCPClientServer = useCallback(async (name: string, source: string) => {
    await restartMCPClientServer(name, source)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleToggleMCPClientServer = useCallback(async (name: string, source: string, disabled: boolean) => {
    await toggleMCPClientServer(name, source, disabled)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleToggleMCPClientServerDisabledForPrompts = useCallback(async (name: string, source: string, disabledForPrompts: boolean) => {
    await toggleMCPClientServerDisabledForPrompts(name, source, disabledForPrompts)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleUpdateMCPClientServerTimeout = useCallback(async (name: string, source: string, timeout: number) => {
    await updateMCPClientServerTimeout(name, source, timeout)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])

  const saveMCPOutputCompressionSettings = useCallback(async (lineLimit: number, characterLimit: number) => {
    const nextLineLimit = Math.max(10, Math.min(5000, lineLimit || 0))
    const nextCharacterLimit = Math.max(1000, Math.min(500000, characterLimit || 0))
    setTerminalOutputLineLimit(nextLineLimit)
    setTerminalOutputCharacterLimit(nextCharacterLimit)
    await AppGo.SaveMCPOutputCompressionSettings(nextLineLimit, nextCharacterLimit)
  }, [])

  async function requestDeleteConfirmation(message: string) {
    if (!normalizedGlobalAISettings.confirmDelete) {
      return true
    }
    const confirm = window?.luminDialog?.confirm
    if (typeof confirm !== 'function') {
      return true
    }
    const result = await confirm(message, t('操作确认'))
    return result === true || (typeof result === 'object' && result !== null && result.confirmed === true)
  }

  const handleToggleAiTerminalIsolation = useCallback(async () => {
    await handleSaveAIPanelGlobalSettings({
      terminalIsolation: !normalizedGlobalAISettings.terminalIsolation,
    })
  }, [handleSaveAIPanelGlobalSettings, normalizedGlobalAISettings.terminalIsolation])

  const handleToggleConfirmDelete = useCallback(async () => {
    await handleSaveAIPanelGlobalSettings({
      confirmDelete: !normalizedGlobalAISettings.confirmDelete,
    })
  }, [handleSaveAIPanelGlobalSettings, normalizedGlobalAISettings.confirmDelete])

  const handleToggleSettingsPanel = useCallback(() => {
    setShowSettingsPanel((previous) => {
      const next = !previous
      if (next) {
        setActiveSettingsTab('')
      }
      return next
    })
  }, [])

  const handleTerminalOutputLineLimitChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10) || 0
    saveMCPOutputCompressionSettings(value, terminalOutputCharacterLimit).catch(() => {})
  }, [saveMCPOutputCompressionSettings, terminalOutputCharacterLimit])

  const handleTerminalOutputCharacterLimitChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10) || 0
    saveMCPOutputCompressionSettings(terminalOutputLineLimit, value).catch(() => {})
  }, [saveMCPOutputCompressionSettings, terminalOutputLineLimit])

  const handleSendMessage = useCallback(async (text: string, sendOptionsOrEditState: Record<string, unknown> | null = null, explicitEditState: Record<string, unknown> | null = null, runtimeOptions: Record<string, unknown> = {}) => {
    const perfStages: Array<{ label: string; ms: number }> = []
    let perfLastMark = performance.now()
    const recordPerfStage = (label: string) => {
      const now = performance.now()
      perfStages.push({ label, ms: now - perfLastMark })
      perfLastMark = now
    }
    let sendOptions = null
    let overrideEditState = explicitEditState
    if (sendOptionsOrEditState && typeof sendOptionsOrEditState === 'object' && (sendOptionsOrEditState.mode === 'edit' || sendOptionsOrEditState.mode === 'retry')) {
      overrideEditState = sendOptionsOrEditState
    } else {
      sendOptions = sendOptionsOrEditState
    }

    const normalizedRuntimeOptions = runtimeOptions && typeof runtimeOptions === 'object' ? runtimeOptions : {}
    const nextText = typeof text === 'string' ? text.trim() : ''
    const messageImages = normalizeMessageImages(sendOptions?.images ?? composerImages)
    if (!nextText && messageImages.length === 0) {
      return false
    }

    clearRestorePreview()

    const targetConversationFromOptions = normalizedRuntimeOptions?.targetConversationSnapshot && typeof normalizedRuntimeOptions.targetConversationSnapshot === 'object'
      ? normalizedRuntimeOptions.targetConversationSnapshot as AIConversationSnapshot
      : null
    const activeConversationToolScope = typeof activeConversation?.toolScope === 'string' ? activeConversation.toolScope.trim() : ''
    const activeConversationToolScopeSlot = typeof activeConversation?.toolScopeSlot === 'string' ? activeConversation.toolScopeSlot.trim() : ''
    const effectiveToolScope = typeof normalizedRuntimeOptions?.toolScope === 'string' && normalizedRuntimeOptions.toolScope.trim()
      ? normalizedRuntimeOptions.toolScope.trim()
      : activeConversationToolScope
    const effectiveToolScopeSlot = typeof normalizedRuntimeOptions?.toolScopeSlot === 'string' && normalizedRuntimeOptions.toolScopeSlot.trim()
      ? normalizedRuntimeOptions.toolScopeSlot.trim()
      : activeConversationToolScopeSlot
    const isThemeTuningConversation = effectiveToolScope === 'theme_tuning'
    let targetConversationSnapshot = normalizedRuntimeOptions?.forceNewConversation === true ? null : (targetConversationFromOptions || activeConversation)
    if (targetConversationSnapshot?.transient === true && !effectiveToolScope) {
      targetConversationSnapshot = null
    }
    if (targetConversationSnapshot?.archived === true && targetConversationSnapshot?.relationType === 'agent') {
      return false
    }
    const activeComposerState = overrideEditState || composerEditState
    const isEditingExistingMessage = activeComposerState?.mode === 'edit' && activeComposerState?.targetMessageId
    const isRetryingMessage = activeComposerState?.mode === 'retry' && activeComposerState?.targetMessageId

    const latestProviderState = await getAIProviderState().catch(() => ({
      currentProviderId: typeof aiProviderState?.currentProviderId === 'string' ? aiProviderState.currentProviderId.trim() : '',
      providers: availableAIProviders,
    }))
    recordPerfStage('获取供应商状态')
    const latestProviders = Array.isArray(latestProviderState?.providers) ? latestProviderState.providers : []
    const preferredProviderId = targetConversationSnapshot
      ? (targetConversationSnapshot.settings && typeof targetConversationSnapshot.settings === 'object'
        ? (targetConversationSnapshot.settings as Record<string, unknown>).currentProviderId
        : undefined)
      : latestProviderState?.currentProviderId
    const resolvedProviderId = resolveAvailableProviderId(latestProviders, typeof preferredProviderId === 'string' ? preferredProviderId : undefined)
    const nextConversationSnapshot = targetConversationSnapshot
      ? buildConversationWithProviderId(targetConversationSnapshot, resolvedProviderId)
      : null

    setAIProviderState({
      currentProviderId: resolvedProviderId,
      providers: latestProviders,
    })

    if (targetConversationSnapshot && nextConversationSnapshot !== targetConversationSnapshot) {
      targetConversationSnapshot = nextConversationSnapshot
      setConversationList((prev) => upsertConversationSummary(prev, nextConversationSnapshot!))
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversationSnapshot,
      }))
      // 此分支内 targetConversationSnapshot 非空，nextConversationSnapshot 必为快照
      await saveConversationSnapshot(nextConversationSnapshot!, panelInstanceKey)
    } else if (!targetConversationSnapshot && !isThemeTuningConversation) {
      const currentGlobalProviderId = typeof latestProviderState?.currentProviderId === 'string' ? latestProviderState.currentProviderId.trim() : ''
      if (resolvedProviderId && resolvedProviderId !== currentGlobalProviderId) {
        const nextSettings = await saveAIGlobalSettings({
          ...(globalAISettings || {}),
          currentProviderId: resolvedProviderId,
        })
        setGlobalAISettings(nextSettings)
      }
    }

    if (!resolvedProviderId) {
      return false
    }

    if (runtimeOptions?.forceImmediate !== true && isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: isEditingExistingMessage ? 'edit' : isRetryingMessage ? 'retry_user' : 'chat',
        text: nextText,
        images: messageImages,
        targetMessageId: typeof activeComposerState?.targetMessageId === 'string' ? activeComposerState.targetMessageId : '',
        targetMessageText: typeof activeComposerState?.targetMessageText === 'string' ? activeComposerState.targetMessageText : nextText,
        toolScope: effectiveToolScope,
        toolScopeSlot: effectiveToolScopeSlot,
        forceNewConversation: runtimeOptions?.forceNewConversation === true,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return false
    }

    let targetConversation = targetConversationSnapshot
    if (!targetConversation) {
      if (isThemeTuningConversation) {
        const now = Date.now()
        targetConversation = {
          id: `theme-tuning-${now}-${Math.random().toString(36).slice(2, 8)}`,
          title: translate('AI调色'),
          createdAt: now,
          updatedAt: now,
          status: 'idle',
          toolProtocol: 'xml',
          messageCount: 0,
          messages: [],
          apiMessages: [],
          settings: normalizeAIConversationTaskSettings({
            currentProviderId: resolvedProviderId,
          }),
          transient: true,
          toolScope: effectiveToolScope,
          toolScopeSlot: effectiveToolScopeSlot,
        }
      } else {
        targetConversation = await createAIConversation(truncateConversationTitle(nextText))
        setConversationList((prev) => upsertConversationSummary(prev, targetConversation!))
      }
    }

    const executionContextSnapshot = getExecutionContextSnapshot({
      sessionId,
      terminalId,
    })
    const environmentDetailsBlock = buildExecutionContextDetails(executionContextSnapshot)
    const { transformedText: slashExpandedPromptText } = expandFirstSlashCommandForPrompt(
      nextText,
      normalizedGlobalAISettings.slashCommands,
    )
    const preprocessedPromptText = slashExpandedPromptText && targetConversation?.id
      ? await preprocessAIConversationLongText(targetConversation.id, slashExpandedPromptText)
      : (slashExpandedPromptText || '')
    recordPerfStage('长文本预处理')
    const baseUserPromptText = preprocessedPromptText
      ? `<user_message>\n${preprocessedPromptText}\n</user_message>`
      : ''
    const promptWithMentions = baseUserPromptText
      ? await processRemoteFileMentions(baseUserPromptText, {
          sessionId: terminalId,
          readFile: (activeSessionId: string, remotePath: string) => AppGo.ReadFile(activeSessionId, remotePath),
          listDir: (activeSessionId: string, remotePath: string) => AppGo.ListDir(activeSessionId, remotePath),
          getTerminalOutput: () => {
            const snapshotProvider = window?.__luminTerminalSnapshots?.[terminalId]
            const rawOutput = typeof snapshotProvider === 'function' ? snapshotProvider() : ''
            return compressTerminalOutputForPrompt(rawOutput, terminalOutputLineLimit, terminalOutputCharacterLimit)
          },
          readLocalWrappedFile: (localPath: string) => readAIConversationWrappedFile(targetConversation.id, localPath),
        })
      : ''
    recordPerfStage('远程@提及')
    const processedPromptText = [promptWithMentions, environmentDetailsBlock]
      .filter((item) => typeof item === 'string' && item.trim())
      .join('\n\n')
      .trim()

    const baseConversation = isEditingExistingMessage || isRetryingMessage
      ? truncateConversationAfterMessage(targetConversation, String(activeComposerState.targetMessageId || ''))
      : targetConversation
    const shouldInjectAssistantFirstReply = shouldUseAssistantFirstReplyForConversation(baseConversation)

    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const baseApiMessages = Array.isArray(baseConversation.apiMessages) ? baseConversation.apiMessages : []
    const requestModelMeta = resolveAIRequestModelMeta(resolvedProviderId, latestProviders)
    const userMessage = {
      id: `user-${requestId}`,
      kind: 'user',
      text: nextText,
      images: messageImages,
      time: formatMessageTime(),
      extra: requestModelMeta,
    }
    const nextApiMessages = [
      ...baseApiMessages,
      createAPIHistoryMessage({
        role: 'user',
        content: processedPromptText,
        messageId: `api-user-${requestId}`,
        uiMessageIds: [userMessage.id],
        images: messageImages,
        ts: Date.now(),
      }),
    ]
    const requestMessages = buildRequestMessages(nextApiMessages)
    recordPerfStage('净化构建')
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: nextApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
      },
    }
    const persistedConversation = {
      ...baseConversation,
      title: baseConversation.title && baseConversation.title !== translate('新对话') ? baseConversation.title : truncateConversationTitle(nextText),
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(baseConversation.messages || []), userMessage],
      apiMessages: nextApiMessages,
    }
    const nextConversation = {
      ...persistedConversation,
      messages: [...persistedConversation.messages, assistantMessage],
    }

    let assistantFirstReplyText = ''
    if (!normalizedRuntimeOptions.skipAssistantFirstReply && shouldInjectAssistantFirstReply) {
      assistantFirstReplyText = (await getAIAssistantFirstReply(getLanguage())).trim()
    }
    recordPerfStage('首字预取')

    resetComposerEditState()
    requestConversationSmoothScrollToBottom()
    if (!targetConversation.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    }
    setPanelState(panelInstanceKey, {
      activeConversationId: targetConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      recoverableToolStopReason: '',
      lastAssistantTurnId: requestId,
      lastTurnBusinessMessageKind: '',
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      isCondensingContext: normalizedRuntimeOptions.keepCondensingContext === true,
      collaborationLocked: shouldLockAssistantCollaboration,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: '',
      collaborationStatusReasoningText: '',
    })

    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })
    recordPerfStage('落库快照')

    try {
      await startAIChat(requestId, {
        conversationId: targetConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: Boolean(panelState.skipNextAutomaticRequest),
        assistantFirstReplyText: assistantFirstReplyText || undefined,
        isDemon: Boolean(isDevilMode),
        toolScope: effectiveToolScope || undefined,
        toolScopeSlot: effectiveToolScopeSlot || undefined,
        autoRecoverySubtaskHops: Number.isFinite(Number(normalizedRuntimeOptions.autoRecoverySubtaskHops))
          ? Math.max(0, Math.trunc(Number(normalizedRuntimeOptions.autoRecoverySubtaskHops)))
          : undefined,
        messages: requestMessages,
      })
      recordPerfStage('发起请求')
      const perfTotal = perfStages.reduce((sum, stage) => sum + stage.ms, 0)
      const perfRecord = { stages: perfStages, total: perfTotal, at: Date.now() }
      sendPerfMetricsRef.current.set(userMessage.id, perfRecord)
      sendPerfMetricsRef.current.set(requestId, perfRecord)
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: (nextConversation.messages || []).map((message: AIMessage) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          const preservedText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '').trim() : ''
          return {
            ...message,
            text: preservedText,
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(panelInstanceKey, {
        activeConversationId: targetConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: nextApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        recoverableToolStopReason: '',
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, aiProviderState, availableAIProviders, buildConversationWithProviderId, composerEditState, composerImages, effectiveAutoApprovalEnabled, getAIAssistantFirstReply, globalAISettings, isDevilMode, isQueueBlocked, normalizedGlobalAISettings.slashCommands, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, requestConversationSmoothScrollToBottom, resetComposerEditState, resolveAIRequestModelMeta, resolveAvailableProviderId, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, terminalId, terminalOutputCharacterLimit, terminalOutputLineLimit, truncateConversationAfterMessage])

  const handleFollowupResponse = useCallback(async (payload: Record<string, unknown>) => {
    if (!payload || typeof payload !== 'object') {
      return false
    }
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : ''
    if (!requestId) {
      return false
    }
    const followupImages = normalizeMessageImages(payload.images)
    try {
      await resolveAIChatFollowup(requestId, payload.answer, followupImages)
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        collaborationLocked: shouldLockAssistantCollaboration,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
        collaborationInterruptedRequestId: '',
        collaborationStatusStartedAtMs: 0,
        collaborationStatusFirstTokenAtMs: 0,
        collaborationStatusText: '',
        collaborationStatusReasoningText: '',
      }))
      return true
    } catch {}
    const currentPanel = terminalPanelsRef.current[panelInstanceKey] || null
    const currentConversation = currentPanel?.conversation || activeConversation
    const currentConversationToolScope = typeof currentConversation?.toolScope === 'string' ? currentConversation.toolScope.trim() : ''
    const currentConversationToolScopeSlot = typeof currentConversation?.toolScopeSlot === 'string' ? currentConversation.toolScopeSlot.trim() : ''
    if (!currentConversation?.id) {
      return false
    }
    const { readableText, content: followupContent } = buildAIFollowupAnswerPayload(payload.answer as string | AIMessage)
    if (!readableText || !followupContent) {
      return false
    }
    const currentMessages = Array.isArray(currentPanel?.messages) ? currentPanel.messages : (Array.isArray(currentConversation.messages) ? currentConversation.messages : [])
    const currentApiMessages = Array.isArray(currentPanel?.apiMessages) ? currentPanel.apiMessages : (Array.isArray(currentConversation.apiMessages) ? currentConversation.apiMessages : [])
    const followupMessage = findLatestAIFollowupMessageByRequestId(currentMessages, requestId)
    const followupMessageId = typeof followupMessage?.id === 'string' ? followupMessage.id.trim() : ''
    const timestamp = Date.now()
    const userMessageId = `${followupMessageId || requestId}-followup-answer-${timestamp}`
    const rawFollowupSettings = currentConversation?.settings && typeof currentConversation.settings === 'object' ? currentConversation.settings as Record<string, unknown> : null
    const followupProviderId = typeof rawFollowupSettings?.currentProviderId === 'string' ? rawFollowupSettings.currentProviderId.trim() : ''
    const requestModelMeta = resolveAIRequestModelMeta(followupProviderId)
    const userMessage = {
      id: userMessageId,
      kind: 'user',
      text: readableText,
      images: followupImages,
      time: formatMessageTime(),
      extra: requestModelMeta,
    }
    const resolvedMessages = currentMessages.map((message) => {
      if (!followupMessageId || message?.id !== followupMessageId || message?.kind !== 'followup') {
        return message
      }
      return {
        ...message,
        status: AI_FOLLOWUP_COMPLETED_STATUS_KEY,
        requestId: '',
      }
    })
    const nextMessages = [...resolvedMessages, userMessage]
    const nextApiMessages = [
      ...currentApiMessages,
      createAPIHistoryMessage({
        role: 'user',
        content: followupContent,
        messageId: `api-user-followup-${timestamp}`,
        uiMessageIds: [userMessageId],
        images: followupImages,
        ts: timestamp,
      }),
    ]
    const requestMessages = buildRequestMessages(nextApiMessages)
    const nextRequestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const assistantMessage = {
      id: nextRequestId,
      turnId: nextRequestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: nextApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
        errorText: '',
      },
    }
    const persistedConversation = {
      ...currentConversation,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: nextMessages,
      apiMessages: nextApiMessages,
    }
    const nextConversation = {
      ...persistedConversation,
      messages: [...nextMessages, assistantMessage],
    }
    requestConversationSmoothScrollToBottom()
    if (!currentConversation.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    }
    setPanelState(panelInstanceKey, {
      activeConversationId: currentConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextApiMessages,
      activeRequestId: nextRequestId,
      activeAssistantMessageId: nextRequestId,
      activeToolExecution: null,
      toolApprovalMode: '',
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      lastAssistantTurnId: nextRequestId,
      lastTurnBusinessMessageKind: '',
      activeChangeReview: null,
      collaborationLocked: shouldLockAssistantCollaboration,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: '',
      collaborationStatusReasoningText: '',
    })
    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })
    try {
      await startAIChat(nextRequestId, {
        conversationId: currentConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: false,
        isDemon: Boolean(isDevilMode),
        toolScope: currentConversationToolScope || undefined,
        toolScopeSlot: currentConversationToolScopeSlot || undefined,
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: nextConversation.messages.map((message) => {
          if (message.id !== nextRequestId || message.kind !== 'assistant') {
            return message
          }
          return {
            ...message,
            text: '',
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }
      setPanelState(panelInstanceKey, {
        activeConversationId: currentConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: nextApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        queuedSubmission: null,
        isFlushingQueuedSubmission: false,
        skipNextAutomaticRequest: false,
        resumeAfterCancelRequestId: '',
        recoverableToolStopReason: '',
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, effectiveAutoApprovalEnabled, isDevilMode, panelInstanceKey, requestConversationSmoothScrollToBottom, resolveAIRequestModelMeta, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, terminalId])

  const handleConversationUserMessage = useCallback(async (payload: string | Record<string, unknown>) => {
    if (payload && typeof payload === 'object' && payload.kind === 'followup-response') {
      if (collaborationFollowupInteractionLocked) {
        return false
      }
      return handleFollowupResponse(payload)
    }
    const text = typeof payload === 'string' ? payload : ''
    return handleSendMessage(text, { images: [] })
  }, [collaborationFollowupInteractionLocked, handleFollowupResponse, handleSendMessage])

  const handleComposerSendMessage = useCallback(async (text: string, sendOptionsOrEditState: Record<string, unknown> | null = null, explicitEditState: Record<string, unknown> | null = null, runtimeOptions: Record<string, unknown> = {}) => {
    const pendingFollowupRequestId = panelState.collaborationAwaitingManualFollowup ? panelState.collaborationFollowupRequestId : ''
    if (pendingFollowupRequestId) {
      const followupImages = normalizeMessageImages(sendOptionsOrEditState?.images)
      const accepted = await handleFollowupResponse({
        kind: 'followup-response',
        requestId: pendingFollowupRequestId,
        answer: typeof text === 'string' ? text : '',
        images: followupImages,
      })
      if (accepted !== false) {
        resetComposerEditState()
      }
      return accepted
    }
    return handleSendMessage(text, sendOptionsOrEditState, explicitEditState, runtimeOptions)
  }, [handleFollowupResponse, handleSendMessage, panelState.collaborationAwaitingManualFollowup, panelState.collaborationFollowupRequestId, resetComposerEditState])

  useEffect(() => {
    const handleStartThemeTuning = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const targetSessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : ''
      const targetTerminalId = typeof detail?.terminalId === 'string' ? detail.terminalId.trim() : ''
      const slot = typeof detail?.slot === 'string' ? detail.slot.trim() : ''
      if ((sessionId || '').trim() !== targetSessionId || (terminalId || '').trim() !== targetTerminalId) {
        return
      }
      if (slot !== 'light' && slot !== 'dark') {
        return
      }
      clearThemeToolPreviewPackage()
      const starterText = slot === 'light'
        ? '请帮我实时调整当前浅色主题包的配色,先调用 help,随后只用 preview 或 inspect 逐步预览,满意后再 commit.'
        : '请帮我实时调整当前深色主题包的配色,先调用 help,随后只用 preview 或 inspect 逐步预览,满意后再 commit.'
      void handleSendMessage(starterText, { images: [] }, null, {
        toolScope: 'theme_tuning',
        toolScopeSlot: slot,
        forceNewConversation: true,
      })
    }
    window.addEventListener('ai-theme-tuning-start', handleStartThemeTuning)
    return () => window.removeEventListener('ai-theme-tuning-start', handleStartThemeTuning)
  }, [handleSendMessage, sessionId, terminalId])

  const handleRetryUserMessage = useCallback(async (messageId: string, text: string, images: unknown[] = []) => {
    if (!activeConversation) {
      return
    }
    if (isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: 'retry_user',
        text,
        images,
        targetMessageId: messageId,
        targetMessageText: text,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return
    }
    await handleSendMessage(text, { images }, {
      mode: 'retry',
      targetMessageId: messageId,
      targetMessageText: text,
    }, { forceImmediate: true })
  }, [activeConversation, handleSendMessage, isQueueBlocked, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, setPanelState])

  const handleRetryAssistantMessage = useCallback(async (messageId: string) => {
    if (!activeConversation || isArchivedAgentConversation) {
      return false
    }
    clearRestorePreview()
    if (isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: 'retry_assistant',
        targetMessageId: messageId,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return false
    }

    const targetAssistantMessage = (activeConversation.messages || []).find((message) => message.id === messageId && message.kind === 'assistant')
    if (!targetAssistantMessage) {
      return false
    }

    const baseConversation = truncateConversationAfterMessage(activeConversation, messageId)
    const requestApiMessages = Array.isArray(baseConversation.apiMessages) ? baseConversation.apiMessages : []
    if (requestApiMessages.length === 0) {
      return false
    }

    const requestMessages = buildRequestMessages(requestApiMessages)
    let assistantFirstReplyText = ''
    if (shouldUseAssistantFirstReplyForConversation(baseConversation)) {
      assistantFirstReplyText = (await getAIAssistantFirstReply(getLanguage())).trim()
    }
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: requestMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
      },
    }
    const persistedConversation = {
      ...baseConversation,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(baseConversation.messages || [])],
      apiMessages: requestApiMessages,
    }
    const nextConversation = {
      ...persistedConversation,
      messages: [...persistedConversation.messages, assistantMessage],
    }

    resetComposerEditState()
    requestConversationSmoothScrollToBottom()
    if (!activeConversation.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    }
    setPanelState(panelInstanceKey, {
      activeConversationId: activeConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: requestApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      recoverableToolStopReason: '',
      lastAssistantTurnId: requestId,
      lastTurnBusinessMessageKind: '',
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      collaborationLocked: shouldLockAssistantCollaboration,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: '',
      collaborationStatusReasoningText: '',
    })

    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })

    try {
      await startAIChat(requestId, {
        conversationId: activeConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: Boolean(panelState.skipNextAutomaticRequest),
        assistantFirstReplyText: assistantFirstReplyText || undefined,
        isDemon: Boolean(isDevilMode),
        toolScope: typeof activeConversation?.toolScope === 'string' && activeConversation.toolScope.trim() ? activeConversation.toolScope.trim() : undefined,
        toolScopeSlot: typeof activeConversation?.toolScopeSlot === 'string' && activeConversation.toolScopeSlot.trim() ? activeConversation.toolScopeSlot.trim() : undefined,
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: (nextConversation.messages || []).map((message: AIMessage) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          const preservedText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '').trim() : ''
          return {
            ...message,
            text: preservedText,
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(panelInstanceKey, {
        activeConversationId: activeConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: requestApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        recoverableToolStopReason: '',
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, effectiveAutoApprovalEnabled, isDevilMode, isQueueBlocked, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, requestConversationSmoothScrollToBottom, resetComposerEditState, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, terminalId, truncateConversationAfterMessage])

  const handleEditUserMessage = useCallback((messageId: string, text: string, images: unknown[] = []) => {
    if (!activeConversation) {
      return
    }
    setComposerEditState({
      mode: 'edit',
      targetMessageId: messageId,
      targetMessageText: text,
    })
    setComposerInputValue(text || '')
    setComposerImages(normalizeMessageImages(images))
    requestConversationSmoothScrollToBottom()
  }, [activeConversation, requestConversationSmoothScrollToBottom])

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!activeConversation) {
      return
    }
    clearRestorePreview()
    const confirmed = await requestDeleteConfirmation(t('确定删除这条消息及其后续对话吗？此操作不可撤销。'))
    if (!confirmed) {
      return
    }
    const nextConversation = truncateConversationAfterMessage(activeConversation, messageId)
    const nextLastTurnState = computeAILastAssistantTurnState(nextConversation.messages)
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      conversation: nextConversation,
      messages: nextConversation.messages || [],
      apiMessages: nextConversation.apiMessages || [],
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      ...nextLastTurnState,
      collaborationLocked: false,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
    }))
    if (composerEditState.targetMessageId === messageId) {
      resetComposerEditState()
    }
    requestConversationSmoothScrollToBottom()
    await saveConversationSnapshot(nextConversation, panelInstanceKey)
  }, [activeConversation, composerEditState.targetMessageId, panelInstanceKey, requestConversationSmoothScrollToBottom, requestDeleteConfirmation, resetComposerEditState, saveConversationSnapshot, setPanelState, t, truncateConversationAfterMessage])

  const handleCondenseContext = useCallback(async () => {
    if (!activeConversation || isArchivedAgentConversation || runtimePhase !== 'ready' || panelState.isCondensingContext) {
      return
    }
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      isCondensingContext: true,
    }))
    try {
      const result = await condenseAIConversationContext(activeConversation.id, terminalId)
      const nextSnapshot = normalizeAIConversationSnapshot((result as { snapshot?: unknown } | null)?.snapshot || result)
      setConversationList((prev) => upsertConversationSummary(prev, nextSnapshot))
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextSnapshot,
        messages: nextSnapshot.messages,
        apiMessages: nextSnapshot.apiMessages,
        isCondensingContext: false,
      }))
      // 压缩改写了历史节点: 全量重建账本 (对每个节点重算并重新持久化压缩后的 Token)
      void rebuildAIConversationTokenLedger(nextSnapshot, panelInstanceKey)
    } catch {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        isCondensingContext: false,
      }))
    }
  }, [activeConversation, panelInstanceKey, panelState.isCondensingContext, rebuildAIConversationTokenLedger, runtimePhase, setPanelState, terminalId])

  const continueAIConversationSummarySubtask = useCallback(async (conversationSnapshot: AIConversationSnapshot, continueText: string, options: Record<string, unknown> = {}) => {
    const nextConversationSnapshot = normalizeAIConversationSnapshot(conversationSnapshot)
    const normalizedContinueText = typeof continueText === 'string' ? continueText.trim() : ''
    const normalizedOptions = options && typeof options === 'object' ? options : {}
    const finalContinueText = buildAIConversationSummarySubtaskContinuePrompt(normalizedContinueText, getLanguage())
    if (!nextConversationSnapshot?.id || !finalContinueText) {
      return false
    }
    return handleSendMessage(finalContinueText, { images: [] }, null, {
      forceImmediate: true,
      targetConversationSnapshot: nextConversationSnapshot,
      autoRecoverySubtaskHops: Number.isFinite(Number(normalizedOptions.autoRecoverySubtaskHops))
        ? Math.max(0, Math.trunc(Number(normalizedOptions.autoRecoverySubtaskHops)))
        : undefined,
    })
  }, [handleSendMessage])

  const runAIConversationSummarySubtaskFlow = useCallback(async (conversationSnapshot: AIConversationSnapshot, options: Record<string, unknown> = {}) => {
    const nextConversationSnapshot = normalizeAIConversationSnapshot(conversationSnapshot)
    const normalizedOptions = options && typeof options === 'object' ? options : {}
    const summaryRequestId = typeof normalizedOptions.requestId === 'string' && normalizedOptions.requestId.trim()
      ? normalizedOptions.requestId.trim()
      : `summary-subtask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const preserveExistingCollaboration = normalizedOptions.preserveExistingCollaboration === true
    if (!nextConversationSnapshot?.id) {
      return false
    }
    if (!preserveExistingCollaboration) {
      setComposerInputValue('')
      setComposerImages([])
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        activeRequestId: summaryRequestId,
        isCondensingContext: true,
        collaborationLocked: true,
        collaborationActive: true,
        collaborationMode: 'summary_subtask',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
        collaborationPendingMode: '',
        collaborationPendingRequestId: '',
        collaborationInterruptedRequestId: '',
        collaborationStatusStartedAtMs: Date.now(),
        collaborationStatusFirstTokenAtMs: 0,
        collaborationStatusText: '',
        collaborationStatusReasoningText: '',
      }))
    }
    try {
      const subtaskResult = await createAIConversationSummarySubtask(nextConversationSnapshot.id, terminalId, summaryRequestId)
      const childSnapshot = normalizeAIConversationSnapshot(subtaskResult?.snapshot || subtaskResult)
      const continueText = typeof subtaskResult?.continueText === 'string' ? subtaskResult.continueText.trim() : ''
      if (!childSnapshot?.id || !continueText) {
        throw new Error(t('摘要创建子任务失败'))
      }
      const accepted = await continueAIConversationSummarySubtask(childSnapshot, continueText, {
        autoRecoverySubtaskHops: Number.isFinite(Number(normalizedOptions.autoRecoverySubtaskHops))
          ? Math.max(0, Math.trunc(Number(normalizedOptions.autoRecoverySubtaskHops)))
          : undefined,
      })
      if (!accepted) {
        throw new Error(t('摘要创建子任务失败'))
      }
      return true
    } catch (error) {
      const interruptedRequestId = typeof terminalPanelsRef.current?.[panelInstanceKey]?.collaborationInterruptedRequestId === 'string'
        ? terminalPanelsRef.current[panelInstanceKey].collaborationInterruptedRequestId.trim()
        : ''
      if (interruptedRequestId !== summaryRequestId) {
        const message = error instanceof Error && error.message ? error.message : t('摘要创建子任务失败')
        await showAlert(message)
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        activeRequestId: '',
        isCondensingContext: false,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
        collaborationPendingMode: '',
        collaborationPendingRequestId: '',
        collaborationInterruptedRequestId: '',
        collaborationStatusStartedAtMs: 0,
        collaborationStatusFirstTokenAtMs: 0,
        collaborationStatusText: '',
        collaborationStatusReasoningText: '',
      }))
      return false
    }
  }, [continueAIConversationSummarySubtask, panelInstanceKey, setComposerImages, setComposerInputValue, setPanelState, showAlert, t, terminalId])

  const handleCondenseContextFullSummary = useCallback(async () => {
    if (!activeConversation || runtimePhase !== 'ready' || panelState.isCondensingContext) {
      return
    }
    void runAIConversationSummarySubtaskFlow(activeConversation)
  }, [activeConversation, panelState.isCondensingContext, runAIConversationSummarySubtaskFlow, runtimePhase])

  const resumeAIChatFromConversation = useCallback(async (conversationSnapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey, options: Record<string, unknown> = {}) => {
    if (!conversationSnapshot || !effectiveProviderId) {
      return false
    }
    const normalizedOptions = options && typeof options === 'object' ? options : {}
    const requestApiMessages = Array.isArray(conversationSnapshot.apiMessages) ? conversationSnapshot.apiMessages : []
    if (requestApiMessages.length === 0) {
      return false
    }
    const requestMessages = buildRequestMessages(requestApiMessages)
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const keepCollaborationActive = normalizedOptions.keepCollaborationActive === true
    const collaborationMode = keepCollaborationActive
      ? (typeof normalizedOptions.collaborationMode === 'string' && normalizedOptions.collaborationMode.trim() ? normalizedOptions.collaborationMode.trim() : 'summary_subtask')
      : ''
    const collaborationStatusText = typeof normalizedOptions.collaborationStatusText === 'string' ? normalizedOptions.collaborationStatusText : ''
    const collaborationStatusReasoningText = typeof normalizedOptions.collaborationStatusReasoningText === 'string' ? normalizedOptions.collaborationStatusReasoningText : ''
    const recoverableToolStopReason = typeof normalizedOptions.recoverableToolStopReason === 'string' ? normalizedOptions.recoverableToolStopReason : ''
    const autoRecoverySubtaskHops = Number.isFinite(Number(normalizedOptions.autoRecoverySubtaskHops))
      ? Math.max(0, Math.trunc(Number(normalizedOptions.autoRecoverySubtaskHops)))
      : 0
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: requestApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
        errorText: '',
      },
    }
    const nextConversation = {
      ...conversationSnapshot,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(conversationSnapshot.messages || []), assistantMessage],
      apiMessages: requestApiMessages,
    }

    requestConversationSmoothScrollToBottom()
    if (!conversationSnapshot.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, nextConversation))
    }
    setPanelState(targetPanelKey, {
      activeConversationId: conversationSnapshot.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: requestApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      lastAssistantTurnId: requestId,
      lastTurnBusinessMessageKind: '',
      isCondensingContext: keepCollaborationActive,
      collaborationLocked: keepCollaborationActive ? true : shouldLockAssistantCollaboration,
      collaborationActive: keepCollaborationActive,
      collaborationMode,
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: keepCollaborationActive ? Date.now() : 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: keepCollaborationActive ? collaborationStatusText : '',
      collaborationStatusReasoningText: keepCollaborationActive ? collaborationStatusReasoningText : '',
    })

    try {
      await startAIChat(requestId, {
        conversationId: conversationSnapshot.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: false,
        isDemon: Boolean(isDevilMode),
        toolScope: typeof conversationSnapshot?.toolScope === 'string' && conversationSnapshot.toolScope.trim() ? conversationSnapshot.toolScope.trim() : undefined,
        toolScopeSlot: typeof conversationSnapshot?.toolScopeSlot === 'string' && conversationSnapshot.toolScopeSlot.trim() ? conversationSnapshot.toolScopeSlot.trim() : undefined,
        autoRecoverySubtaskHops,
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: (nextConversation.messages || []).map((message: AIMessage) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          return {
            ...message,
            text: '',
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(targetPanelKey, {
        activeConversationId: conversationSnapshot.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: requestApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        queuedSubmission: null,
        isFlushingQueuedSubmission: false,
        skipNextAutomaticRequest: false,
        resumeAfterCancelRequestId: '',
        recoverableToolStopReason,
        isCondensingContext: false,
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, targetPanelKey)
      return false
    }
  }, [effectiveAutoApprovalEnabled, effectiveProviderId, isDevilMode, panelInstanceKey, requestConversationSmoothScrollToBottom, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, terminalId])

  const handleCancelMessage = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await cancelAIChat(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleStopAndResumeMessage = useCallback(async () => {
    if (!panelState.activeRequestId || !activeConversation) {
      return
    }
    const requestId = panelState.activeRequestId
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      resumeAfterCancelRequestId: requestId,
    }))
    try {
      await cancelAIChat(requestId)
    } catch {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        resumeAfterCancelRequestId: '',
      }))
    }
  }, [activeConversation, panelInstanceKey, panelState.activeRequestId, setPanelState])

  const handleResumeTask = useCallback(async () => {
    const currentPanel = terminalPanelsRef.current[panelInstanceKey] || null
    const conversationSnapshot = currentPanel?.conversation || activeConversation
    if (!conversationSnapshot) {
      return false
    }
    return resumeAIChatFromConversation(conversationSnapshot, panelInstanceKey)
  }, [activeConversation, panelInstanceKey, resumeAIChatFromConversation])

  const handleApproveTools = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await approveAIChatTools(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleRejectTools = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    if (normalizedGlobalAISettings.continueAfterToolRejection !== false) {
      await rejectAIChatTools(panelState.activeRequestId)
      return
    }
    await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
  }, [normalizedGlobalAISettings.continueAfterToolRejection, panelState.activeRequestId])

  const handleContinueTool = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await continueAIChatTool(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handleTerminateTool = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await terminateAIChatTool(panelState.activeRequestId)
  }, [panelState.activeRequestId])

  const handlePreviewRestore = useCallback(async (restoreArtifactPath: string) => {
    try {
      const review = await previewAIChatToolRestore(restoreArtifactPath, terminalId)
      if (typeof window !== 'undefined' && review && typeof review === 'object') {
        window.dispatchEvent(new CustomEvent('ai-change-review-preview', {
          detail: { sessionId: terminalId, review },
        }))
      }
    } catch (error) {
      // error.message 为后端动态文案（可能不在翻译表），translate() 内部有兜底
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('当前状态不支持还原'))
    }
  }, [showAlert, terminalId])

  const handlePreviewDiff = useCallback(async (restoreArtifactPath: string) => {
    try {
      const review = await previewAIChatToolDiff(restoreArtifactPath, terminalId)
      return review && typeof review === 'object' ? review : null
    } catch {
      return null
    }
  }, [terminalId])

  const handleApplyRestore = useCallback(async (restoreArtifactPath: string) => {
    try {
      await restoreAIChatTool(restoreArtifactPath, terminalId)
      clearRestorePreview()
      addToast?.(translate('已还原'), 'success', 3200)
      return true
    } catch (error) {
      // error.message 为后端动态文案（可能不在翻译表），translate() 内部有兜底
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('当前状态不支持还原'))
      return false
    }
  }, [addToast, clearRestorePreview, showAlert, terminalId, translate])

  const handleListCommandTerminalCandidates = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return []
    }
    const candidates = await listAIChatCommandTerminalCandidates(panelState.activeRequestId)
    return candidates.map((candidate) => ({
      ...candidate,
      label: terminalLabelMap.get(candidate.sessionId) || candidate.sessionId,
      current: candidate.current === true || candidate.sessionId === terminalId,
    }))
  }, [panelState.activeRequestId, terminalId, terminalLabelMap])

  const handleAssignToolTerminal = useCallback(async (targetSessionId: string) => {
    if (!panelState.activeRequestId) {
      return
    }
    await assignAIChatToolTerminal(panelState.activeRequestId, targetSessionId)
  }, [panelState.activeRequestId])

  const handleToggleSkipNextAutomaticRequest = useCallback(async (enabled: boolean) => {
    let targetRequestId = ''
    setPanelState(panelInstanceKey, (current) => {
      targetRequestId = current.activeRequestId || ''
      return {
        ...current,
        skipNextAutomaticRequest: Boolean(enabled),
      }
    })
    if (targetRequestId) {
      try {
        await setAIChatSkipNextAutomaticRequest(targetRequestId, Boolean(enabled))
      } catch {}
    }
  }, [panelInstanceKey, setPanelState])

  const handleInterruptCollaboration = useCallback(async () => {
    let targetRequestId = ''
    let targetMode = ''
    setPanelState(panelInstanceKey, (current) => {
      targetRequestId = current.activeRequestId || ''
      targetMode = typeof current.collaborationMode === 'string' ? current.collaborationMode.trim() : ''
      return {
        ...current,
        activeRequestId: targetMode === 'summary_subtask' ? '' : current.activeRequestId,
        isCondensingContext: targetMode === 'summary_subtask' ? false : current.isCondensingContext,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
        collaborationPendingMode: '',
        collaborationPendingRequestId: '',
        collaborationInterruptedRequestId: targetRequestId,
        collaborationStatusStartedAtMs: 0,
        collaborationStatusFirstTokenAtMs: 0,
        collaborationStatusText: '',
        collaborationStatusReasoningText: '',
      }
    })
    if (targetRequestId) {
      try {
        if (targetMode === 'summary_subtask') {
          await cancelAIChat(targetRequestId)
        } else {
          await disableAIChatCollaboration(targetRequestId)
        }
      } catch {}
    }
  }, [panelInstanceKey, setPanelState])

  const handleCancelQueuedSubmission = useCallback(() => {
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
    }))
  }, [panelInstanceKey, setPanelState])

  useEffect(() => {
    const queuedSubmission = panelState.queuedSubmission
    if (!queuedSubmission || panelState.isFlushingQueuedSubmission || isQueueBlocked) {
      return
    }

    let disposed = false

    setPanelState(panelInstanceKey, (current) => {
      if (!current.queuedSubmission || current.queuedSubmission.id !== queuedSubmission.id) {
        return current
      }
      return {
        ...current,
        isFlushingQueuedSubmission: true,
      }
    })

    void (async () => {
      let accepted = false
      try {
        if (queuedSubmission.kind === 'retry_assistant') {
          accepted = await handleRetryAssistantMessage(queuedSubmission.targetMessageId) === true
        } else {
          accepted = await handleSendMessage(
            queuedSubmission.text,
            { images: queuedSubmission.images },
            queuedSubmission.kind === 'chat'
              ? null
              : {
                  mode: queuedSubmission.kind === 'edit' ? 'edit' : 'retry',
                  targetMessageId: queuedSubmission.targetMessageId,
                  targetMessageText: queuedSubmission.targetMessageText,
                },
            {
              forceImmediate: true,
              toolScope: queuedSubmission.toolScope,
              toolScopeSlot: queuedSubmission.toolScopeSlot,
              forceNewConversation: queuedSubmission.forceNewConversation === true,
            },
          ) !== false
        }
      } finally {
        if (disposed && !panelMountedRef.current) {
          return
        }
        setPanelState(panelInstanceKey, (current) => {
          if (!current.queuedSubmission || current.queuedSubmission.id !== queuedSubmission.id) {
            return {
              ...current,
              isFlushingQueuedSubmission: false,
            }
          }
          return {
            ...current,
            queuedSubmission: null,
            isFlushingQueuedSubmission: false,
          }
        })
      }
    })()

    return () => {
      disposed = true
    }
  }, [handleRetryAssistantMessage, handleSendMessage, isQueueBlocked, panelInstanceKey, panelState.isFlushingQueuedSubmission, panelState.queuedSubmission, setPanelState])

  // ponytail: mcpInfo.transport 是 MCP 协议层名称（streamable-http），
  // 客户端配置文件（如 ~/.claude.json）期望的 type 值为 "http"，这里做映射。
  // 仅 streamable-http 需要转换，其他值（如 sse、stdio）保持原样。
  const mcpConfigType = mcpInfo.transport === 'streamable-http' ? 'http' : (mcpInfo.transport || 'http')
  const configText = `"lumin-ssh": {
  "type": "${mcpConfigType}",
  "url": "${mcpInfo.url || ''}",
  "oauth": false,
  "alwaysAllow": [],
  "disabled": false,
  "timeout": 0,
  "disabledForPrompts": false
}`
  const configRows = Math.max(configText.split('\n').length, 1)

  const renderedConversationList = useMemo(() => {
    let content = null

    if (globalSearchOpen) {
      content = (
        <div style={{ display: 'grid', minHeight: 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-base)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <input
                id="ai-panel-main-global-search"
                name="ai-panel-main-global-search"
                autoComplete="off"
                ref={globalSearchInputRef}
                value={globalSearchQuery}
                onChange={(event) => setGlobalSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    resetGlobalSearchState()
                  }
                }}
                placeholder={t('输入关键词搜索全部对话')}
                style={{
                  height: 34,
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-sunken)',
                  color: 'var(--text-primary)',
                  padding: '0 10px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                title={t('关闭搜索')}
                aria-label={t('关闭搜索')}
                onClick={resetGlobalSearchState}
                style={{
                  width: 34,
                  height: 34,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-base)',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          </div>
          {normalizedGlobalSearchQuery ? (
            globalSearchLoading ? (
              <div style={{ minHeight: 'calc(100% - 101px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.8 }}>
                {t('加载中...')}
              </div>
            ) : globalSearchResults.length === 0 ? (
              <div style={{ minHeight: 'calc(100% - 101px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.8 }}>
                {t('没有找到匹配内容')}
              </div>
            ) : (
              <div style={{ display: 'grid' }}>
                {globalSearchResults.map((result) => {
                  const historyTimeParts = buildAIHistoryDisplayTimeParts(result.updatedAt || 0, getLanguage() || 'zh-CN')
                  const historyRelativeToneStyle = getAIHistoryRelativeTimeToneStyle(result.updatedAt || 0)
                  return (
                  <button
                    key={`${result.conversationId}:${result.messageId}`}
                    type="button"
                    onClick={() => {
                      void handleSelectGlobalSearchResult(result)
                    }}
                    style={{
                      width: '100%',
                      display: 'grid',
                      gap: 8,
                      padding: '12px 14px',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      background: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{result.conversationTitle}</div>
                      <div style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>{result.role === 'user' ? t('用户') : t('AI')}</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
                      <span>{historyTimeParts.absoluteText}</span>
                      {historyTimeParts.relativeText ? (
                        <span style={historyRelativeToneStyle}>({historyTimeParts.relativeText})</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result.snippet}</div>
                  </button>
                  )
                })}
              </div>
            )
          ) : (
            <div style={{ minHeight: 'calc(100% - 101px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.8 }}>
              {t('搜索全部对话中的消息')}
            </div>
          )}
        </div>
      )
    } else if (conversationList.length === 0) {
      content = (
        <div style={{ minHeight: 'calc(100% - 53px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.8 }}>
          <div style={{ maxWidth: '80%', display: 'grid', gap: 2 }}>
            <div>{t('当前还没有对话.点击下方发送消息后')}</div>
            <div>{t('将自动创建一条新对话.')}</div>
          </div>
        </div>
      )
    } else {
      content = buildAIConversationDisplayList(conversationList).map((item) => {
        const isFolderHovered = hoveredConversationActionKey === `${item.id}:folder`
        const isRenameHovered = hoveredConversationActionKey === `${item.id}:rename`
        const isDeleteHovered = hoveredConversationActionKey === `${item.id}:delete`
        const isAgentSubtask = item.relationType === 'agent'
        const isArchivedAgentSubtask = isAgentSubtask && item.archived === true
        const isSummarySubtask = item.relationType === 'phase' && item.relationSource === 'summary_condense'
        const historyTimeParts = buildAIHistoryDisplayTimeParts(item.updatedAt, getLanguage() || 'zh-CN')
        const historyRelativeToneStyle = getAIHistoryRelativeTimeToneStyle(item.updatedAt)
        const displayTitle = typeof item.title === 'string'
          ? item.title.replace(/\s*·\s*摘要子任务\s*$/u, '').replace(/\s*·\s*子代理任务\s*$/u, '').trim()
          : ''
        return (
          <div
            key={item.id}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              background: panelState.activeConversationId === item.id ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent',
              borderLeft: panelState.activeConversationId === item.id ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'var(--transition)',
              opacity: item.archived === true ? 0.72 : 1,
            }}
          >
            <button
              type="button"
              onClick={() => void handleOpenConversation(item.id)}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2, paddingLeft: item.depth > 0 ? `${item.depth * 12}px` : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {isAgentSubtask ? (
                    <Tiptop text={t('子代理任务')} placement="top">
                      <span
                        aria-label={t('子代理任务')}
                        style={{
                          width: 18,
                          height: 18,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 999,
                          border: isArchivedAgentSubtask ? '1px solid var(--border)' : '1px solid rgba(var(--accent-rgb), 0.22)',
                          background: isArchivedAgentSubtask ? 'var(--surface-sunken)' : 'rgba(var(--accent-rgb), 0.10)',
                          color: isArchivedAgentSubtask ? 'var(--text-tertiary)' : 'var(--accent)',
                          flexShrink: 0,
                        }}
                      >
                        <Bot size={11} />
                      </span>
                    </Tiptop>
                  ) : null}
                  {isSummarySubtask ? (
                    <Tiptop text={t('摘要子任务')} placement="top">
                      <span
                        aria-label={t('摘要子任务')}
                        style={{
                          width: 18,
                          height: 18,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 999,
                          border: '1px solid rgba(var(--accent-rgb), 0.22)',
                          background: 'rgba(var(--accent-rgb), 0.10)',
                          color: 'var(--accent)',
                          flexShrink: 0,
                        }}
                      >
                        <Scissors size={11} />
                      </span>
                    </Tiptop>
                  ) : null}
                  <div style={{ minWidth: 0, fontSize: 13, fontWeight: panelState.activeConversationId === item.id ? 600 : 500, color: isArchivedAgentSubtask ? 'var(--text-secondary)' : 'var(--text-primary)', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayTitle || item.title}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 0 }}>
                    <span>{historyTimeParts.absoluteText}</span>
                    {historyTimeParts.relativeText ? (
                      <span style={historyRelativeToneStyle}>({historyTimeParts.relativeText})</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>·{item.messageCount}</div>
                </div>
              </div>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 10, flexShrink: 0 }}>
              <button
                type="button"
                title={t('打开任务所在文件夹')}
                aria-label={t('打开任务所在文件夹')}
                onClick={() => void handleOpenConversationFolder(item.id)}
                onMouseEnter={() => setHoveredConversationActionKey(`${item.id}:folder`)}
                onMouseLeave={() => setHoveredConversationActionKey((current) => (current === `${item.id}:folder` ? '' : current))}
                onFocus={() => setHoveredConversationActionKey(`${item.id}:folder`)}
                onBlur={() => setHoveredConversationActionKey((current) => (current === `${item.id}:folder` ? '' : current))}
                style={{
                  width: 26,
                  height: 26,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  color: isFolderHovered ? 'var(--accent)' : 'var(--text-muted)',
                  background: isFolderHovered ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                  border: isFolderHovered ? '1px solid rgba(var(--accent-rgb), 0.22)' : '1px solid transparent',
                  boxShadow: 'none',
                  flexShrink: 0,
                  cursor: 'pointer',
                  transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
                }}
              >
                <FolderOpen size={13} />
              </button>
              <button
                type="button"
                title={t('编辑任务标题')}
                aria-label={t('编辑任务标题')}
                onClick={() => void handleRenameConversationTitle(item.id)}
                onMouseEnter={() => setHoveredConversationActionKey(`${item.id}:rename`)}
                onMouseLeave={() => setHoveredConversationActionKey((current) => (current === `${item.id}:rename` ? '' : current))}
                onFocus={() => setHoveredConversationActionKey(`${item.id}:rename`)}
                onBlur={() => setHoveredConversationActionKey((current) => (current === `${item.id}:rename` ? '' : current))}
                style={{
                  width: 26,
                  height: 26,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  color: isRenameHovered ? 'var(--accent)' : 'var(--text-muted)',
                  background: isRenameHovered ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                  border: isRenameHovered ? '1px solid rgba(var(--accent-rgb), 0.22)' : '1px solid transparent',
                  boxShadow: 'none',
                  flexShrink: 0,
                  cursor: 'pointer',
                  transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                title={t('删除')}
                aria-label={t('删除')}
                onClick={() => {
                  setHoveredConversationActionKey('')
                  void handleDeleteConversation(item.id)
                }}
                onMouseEnter={() => setHoveredConversationActionKey(`${item.id}:delete`)}
                onMouseLeave={() => setHoveredConversationActionKey((current) => (current === `${item.id}:delete` ? '' : current))}
                onFocus={() => setHoveredConversationActionKey(`${item.id}:delete`)}
                onBlur={() => setHoveredConversationActionKey((current) => (current === `${item.id}:delete` ? '' : current))}
                style={{
                  width: 26,
                  height: 26,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  color: isDeleteHovered ? 'var(--danger)' : 'var(--text-muted)',
                  background: isDeleteHovered ? 'var(--danger-dim)' : 'transparent',
                  border: isDeleteHovered ? '1px solid rgba(var(--danger-rgb), 0.28)' : '1px solid transparent',
                  boxShadow: 'none',
                  flexShrink: 0,
                  cursor: 'pointer',
                  transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
                }}
              >
                ×
              </button>
            </div>
          </div>
        )
      })
    }

    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--surface-base)' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-raised)', position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('对话历史')}</div>
          <button
            type="button"
            title={t('全局搜索对话')}
            aria-label={t('全局搜索对话')}
            onClick={handleOpenGlobalSearch}
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: globalSearchOpen ? '1px solid var(--accent-border)' : '1px solid var(--border-subtle)',
              background: globalSearchOpen ? 'rgba(var(--accent-rgb), 0.10)' : 'var(--surface-sunken)',
              color: globalSearchOpen ? 'var(--accent)' : 'var(--text-tertiary)',
              cursor: 'pointer',
              transition: 'var(--transition-fast)',
              flexShrink: 0,
            }}
          >
            <Search size={14} />
          </button>
        </div>
        {content}
      </div>
    )
  }, [conversationList, getLanguage, globalSearchLoading, globalSearchOpen, globalSearchQuery, globalSearchResults, handleDeleteConversation, handleOpenConversation, handleOpenConversationFolder, handleOpenGlobalSearch, handleSelectGlobalSearchResult, hoveredConversationActionKey, isDevilMode, normalizedGlobalSearchQuery, panelState.activeConversationId, resetGlobalSearchState, t])

  return (
    <div
      data-ai-panel-root="true"
      data-ai-devil-mode={isDevilMode ? 'true' : 'false'}
      style={{
        width,
        minWidth: width,
        height: '100%',
        minHeight: 0,
        background: isDevilMode ? 'rgba(10, 0, 2, 0.96)' : 'var(--surface-raised)',
        flexShrink: 0,
        borderRight: side === 'right' ? '1px solid var(--border)' : 'none',
        borderLeft: side === 'left' ? '1px solid var(--border)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        position: 'relative',
        fontFamily: 'var(--font-ai-panel)',
        ...(isDevilMode ? {
          '--surface-raised': 'rgba(17, 2, 4, 0.84)',
          '--surface-base': 'rgba(8, 1, 2, 0.90)',
          '--surface-overlay': 'rgba(18, 2, 4, 0.90)',
          '--surface-sunken': 'rgba(10, 1, 2, 0.96)',
          '--text-primary': '#fff5f5',
          '--text-secondary': 'rgba(255, 112, 112, 0.92)',
          '--text-tertiary': 'rgba(255, 82, 82, 0.72)',
          '--border': 'rgba(255, 68, 68, 0.22)',
          '--border-subtle': 'rgba(255, 56, 56, 0.16)',
          '--accent': '#ff3b3b',
          '--accent-rgb': '255, 59, 59',
          '--accent-border': 'rgba(255, 72, 72, 0.46)',
          backgroundImage: [
            'radial-gradient(circle at 50% 72%, rgba(140, 0, 20, 0.34) 0%, rgba(140, 0, 20, 0.12) 20%, transparent 46%)',
            'radial-gradient(circle at 50% 8%, rgba(255, 0, 51, 0.16) 0%, transparent 24%)',
            'radial-gradient(circle at 0% 0%, rgba(255, 0, 32, 0.12) 0%, transparent 18%)',
            'radial-gradient(circle at 100% 0%, rgba(255, 0, 32, 0.12) 0%, transparent 18%)',
            'repeating-linear-gradient(135deg, rgba(255, 0, 38, 0.035) 0 1px, transparent 1px 26px)',
            'linear-gradient(180deg, rgba(22, 0, 3, 0.96) 0%, rgba(8, 0, 1, 0.99) 100%)',
          ].join(', '),
          boxShadow: 'inset 0 0 0 1px rgba(255, 56, 56, 0.14), inset 0 0 60px rgba(255, 0, 38, 0.08)',
        } : {}),
      }}
    >
      {tasksDirMigrating ? (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(5, 10, 18, 0.6)', backdropFilter: 'blur(3px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Loader2 size={36} className="spin" style={{ color: 'var(--accent)' }} />
          <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}>{t('正在迁移对话数据...')}</div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('迁移期间请勿使用 AI 对话')}</div>
        </div>
      ) : null}
      <AIPanelHeader
        showSettingsPanel={showSettingsPanel}
        onToggleSettings={handleToggleSettingsPanel}
        onGoHome={handleGoHome}
        showModeToggle={canToggleAIMode}
        isDevilMode={isDevilMode}
        onToggleMode={handleToggleDevilMode}
        onOpenConversationSearch={handleOpenConversationSearch}
        onOpenConversationDiff={handleOpenConversationDiff}
        showConversationSearchButton={Boolean(activeConversation)}
        showConversationDiffButton={Boolean(activeConversation)}
        conversationSearchActive={conversationSearchOpen}
        showContextTokens={Boolean(activeConversation)}
        contextTokens={panelState.contextTokens}
        apiMessageCount={Array.isArray(panelState.apiMessages) ? panelState.apiMessages.length : 0}
        isCondensingContext={Boolean(panelState.isCondensingContext)}
        canCondenseContext={canQuickCondenseConversation || canSummaryCondenseConversation}
        canQuickCondenseContext={canQuickCondenseConversation}
        canSummaryCondenseContext={canSummaryCondenseConversation}
        onCondenseContext={handleCondenseContext}
        onCondenseContextFullSummary={handleCondenseContextFullSummary}
        fullSummaryCondenseAvailable={true}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div data-ai-chat-stage="true" style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeConversation ? (
            <>
              {isThemeTuningConversation ? (
                <div
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--accent-border)',
                    background: 'rgba(var(--accent-rgb), 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {t('当前处于配色模式,对话记录不会保存')}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => { void handleGoHome() }}
                    style={{ flexShrink: 0 }}
                  >
                    {t('退出配色模式')}
                  </button>
                </div>
              ) : null}
              {conversationSearchOpen ? (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 8, alignItems: 'center' }}>
                  <input
                    id="ai-panel-main-conversation-search"
                    name="ai-panel-main-conversation-search"
                    autoComplete="off"
                    ref={conversationSearchInputRef}
                    value={conversationSearchQuery}
                    onChange={(event) => setConversationSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        resetConversationSearchState()
                        return
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleCycleConversationSearchResult(event.shiftKey ? -1 : 1)
                      }
                    }}
                    placeholder={t('输入关键词搜索当前对话')}
                    style={{
                      height: 34,
                      width: '100%',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-sunken)',
                      color: 'var(--text-primary)',
                      padding: '0 10px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                  <div style={{ minWidth: 48, textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                    {conversationSearchResults.length > 0 ? `${conversationSearchIndex + 1}/${conversationSearchResults.length}` : '0/0'}
                  </div>
                  <button
                    type="button"
                    title={t('上一个搜索结果')}
                    aria-label={t('上一个搜索结果')}
                    onClick={() => handleCycleConversationSearchResult(-1)}
                    disabled={conversationSearchResults.length === 0}
                    style={{
                      width: 34,
                      height: 34,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-base)',
                      color: conversationSearchResults.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                      cursor: conversationSearchResults.length > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    title={t('下一个搜索结果')}
                    aria-label={t('下一个搜索结果')}
                    onClick={() => handleCycleConversationSearchResult(1)}
                    disabled={conversationSearchResults.length === 0}
                    style={{
                      width: 34,
                      height: 34,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-base)',
                      color: conversationSearchResults.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                      cursor: conversationSearchResults.length > 0 ? 'pointer' : 'not-allowed',
                    }}
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    title={t('关闭搜索')}
                    aria-label={t('关闭搜索')}
                    onClick={resetConversationSearchState}
                    style={{
                      width: 34,
                      height: 34,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-base)',
                      color: 'var(--text-tertiary)',
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <AIChatConversation
                messages={panelState.messages}
                sessionId={sessionId}
                terminalId={terminalId}
                conversationId={activeConversation?.id || ''}
                onSendUserMessage={handleConversationUserMessage}
                onRetryUserMessage={handleRetryUserMessage}
                onRetryAssistantMessage={handleRetryAssistantMessage}
                onEditUserMessage={handleEditUserMessage}
                onDeleteMessage={handleDeleteMessage}
                onPreviewRestore={handlePreviewRestore}
                onPreviewDiffFetch={handlePreviewDiff}
                onApplyRestore={handleApplyRestore}
                followupInteractionLocked={collaborationFollowupInteractionLocked}
                messageActionBarAtBottom={messageActionBarAtBottom}
                messageNavEnabled={messageNavEnabled}
                side={side}
                scrollToBottomSignal={conversationScrollSignal}
                sendPerfMetricsRef={sendPerfMetricsRef}
                editingTargetMessageId={composerEditState.mode === 'edit' ? composerEditState.targetMessageId : ''}
              />
            </>
          ) : renderedConversationList}
          {showAssistantCollaborationActiveImage ? (
            <video
              src={assistantThinkingActiveImg}
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: 18,
                bottom: 0,
                width: 'min(32%, 180px)',
                minWidth: 120,
                maxWidth: '42vw',
                maxHeight: 280,
                objectFit: 'contain',
                pointerEvents: 'none',
                userSelect: 'none',
                opacity: 0.96,
                zIndex: 2,
                filter: 'drop-shadow(0 10px 24px rgba(0, 0, 0, 0.22))',
              }}
            />
          ) : null}
        </div>
        <AIComposer
          onSend={handleComposerSendMessage}
          onCancel={handleCancelMessage}
          onStopAndResume={handleStopAndResumeMessage}
          conversationInputLocked={composerInteractionLocked}
          conversationInputLockedLabel={composerInteractionLockedLabel}
          isSending={isStreaming}
          currentProviderId={effectiveProviderId}
          onCurrentProviderChange={handleProviderChange}
          providerBalanceRefreshSignal={providerBalanceRefreshSignal}
          terminalSessionId={terminalId}
          queueBlocked={isQueueBlocked || panelState.isFlushingQueuedSubmission}
          queuedSubmissionKind={panelState.queuedSubmission?.kind || ''}
          collaborationLocked={collaborationLocked}
          collaborationActive={collaborationActive}
          collaborationMode={panelState.collaborationMode}
          collaborationStatus={collaborationActive ? {
            startedAtMs: panelState.collaborationStatusStartedAtMs,
            firstTokenAtMs: panelState.collaborationStatusFirstTokenAtMs,
            text: panelState.collaborationStatusText,
            reasoningText: panelState.collaborationStatusReasoningText,
          } : null}
          terminalAssignmentRequired={isAwaitingTerminalAssignment}
          toolResumeAvailable={toolResumeAvailable}
          onResumeTask={handleResumeTask}
          onListCommandTerminalCandidates={handleListCommandTerminalCandidates}
          onAssignToolTerminal={handleAssignToolTerminal}
          onCancelQueuedSubmission={handleCancelQueuedSubmission}
          skipNextAutomaticRequest={Boolean(panelState.skipNextAutomaticRequest)}
          onToggleSkipNextAutomaticRequest={handleToggleSkipNextAutomaticRequest}
          persistProviderSelection={shouldPersistProviderSelection}
          autoApprovalSettings={effectiveAutoApprovalSettings}
          onPatchAutoApprovalSettings={handlePatchAutoApprovalSettings}
          collaborationExtraPrompt={effectiveAutoApprovalSettings.collaborationExtraPrompt || ''}
          onCollaborationExtraPromptChange={handleCollaborationExtraPromptChange}
          collaborationPromptPresets={normalizedGlobalAISettings.collaborationPromptPresets}
          onCollaborationPromptPresetsChange={handleCollaborationPromptPresetsChange}
          collaborationPromptScopeIsTask={Boolean(activeConversation)}
          onInterruptCollaboration={handleInterruptCollaboration}
          approvalRequired={isAwaitingToolApproval}
          toolRunning={isToolRunning}
          commandActionRequired={isAwaitingCommandAction}
          onApproveTools={handleApproveTools}
          onRejectTools={handleRejectTools}
          onContinueTool={handleContinueTool}
          onTerminateTool={handleTerminateTool}
          approvalButtonOrder={approvalButtonOrder}
          commandActionButtonOrder={commandActionButtonOrder}
          inputValue={composerInputValue}
          onInputValueChange={setComposerInputValue}
          selectedImages={composerImages}
          onSelectedImagesChange={setComposerImages}
          editModeLabel={composerEditState.mode === 'edit' ? t('编辑消息后将从该消息起重建后续对话') : ''}
          slashCommands={normalizedGlobalAISettings.slashCommands}
          onCancelEdit={resetComposerEditState}
          dismissSignal={popupDismissVersion}
        />
      </div>
      <AIPanelSettingsOverlay
        show={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        activeTab={activeSettingsTab}
        onChangeTab={setActiveSettingsTab}
        mcpInfo={mcpInfo}
        configText={configText}
        configRows={configRows}
        globalAISettings={normalizedGlobalAISettings}
        onSaveGlobalAISettings={handleSaveAIPanelGlobalSettings}
        aiTerminalIsolation={normalizedGlobalAISettings.terminalIsolation}
        onToggleAiTerminalIsolation={handleToggleAiTerminalIsolation}
        confirmDelete={normalizedGlobalAISettings.confirmDelete}
        onToggleConfirmDelete={handleToggleConfirmDelete}
        activeConversationId={activeConversation?.id || ''}
        conversationUpdatedAt={activeConversation?.updatedAt || 0}
        backupRequestInFlight={panelState.requestPhase !== 'idle' || runtimePhase !== 'ready'}
        onRestoreConversationBackup={handleRestoreConversationBackup}
        autoBackupEnabled={normalizedGlobalAISettings.conversationAutoBackupEnabled !== false}
        onToggleAutoBackup={() => handleSaveAIPanelGlobalSettings({
          conversationAutoBackupEnabled: !normalizedGlobalAISettings.conversationAutoBackupEnabled,
        })}
        soundEnabled={normalizedGlobalAISettings.soundEnabled !== false}
        soundVolume={normalizedGlobalAISettings.soundVolume ?? 0.06}
        terminalOutputLineLimit={terminalOutputLineLimit}
        onTerminalOutputLineLimitChange={handleTerminalOutputLineLimitChange}
        terminalOutputCharacterLimit={terminalOutputCharacterLimit}
        onTerminalOutputCharacterLimitChange={handleTerminalOutputCharacterLimitChange}
        mcpClientServers={mcpClientServers}
        mcpClientGlobalConfigPath={mcpClientGlobalConfigPath}
        mcpClientGlobalConfigText={mcpClientGlobalConfigText}
        onSaveMCPGlobalServer={handleSaveMCPGlobalServer}
        onReloadMCPGlobalServers={handleReloadMCPGlobalServers}
        onDeleteMCPGlobalServer={handleDeleteMCPGlobalServer}
        onRestartMCPClientServer={handleRestartMCPClientServer}
        onToggleMCPClientServer={handleToggleMCPClientServer}
        onToggleMCPClientServerDisabledForPrompts={handleToggleMCPClientServerDisabledForPrompts}
        onUpdateMCPClientServerTimeout={handleUpdateMCPClientServerTimeout}
        onMigratingChange={setTasksDirMigrating}
      />
    </div>
  )
}