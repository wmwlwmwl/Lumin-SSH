import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Search } from 'lucide-react'
import { EventsOn } from '../../wailsjs/runtime/runtime.js'
import * as AppGo from '../../wailsjs/go/main/App.js'
import { useTranslation, t as translate, getLanguage } from '../i18n.js'
import AIPanelHeader from './ai/AIPanelHeader.jsx'
import AIConversationBackupSettings from './ai/AIConversationBackupSettings.jsx'
import AIPanelSettingsOverlay from './ai/AIPanelSettingsOverlay.jsx'
import AIComposer from './ai/AIComposer.jsx'
import { approveAIChatTools, assignAIChatToolTerminal, cancelAIChat, continueAIChatTool, listAIChatCommandTerminalCandidates, previewAIChatToolRestore, rejectAIChatTools, rejectAIChatToolsForQueuedSubmission, resolveAIChatFollowup, restoreAIChatTool, setAIChatSkipNextAutomaticRequest, startAIChat, terminateAIChatTool } from './ai/aiChatBridge.js'
import { condenseAIConversationContext, createAIConversation, deleteAIConversation, getAIAssistantFirstReply, getAIConversation, listAIConversations, normalizeAIConversationMessageSearchResult, normalizeAIConversationSnapshot, normalizeAIConversationTaskSettings, openAIConversationFolder, preprocessAIConversationLongText, readAIConversationWrappedFile, saveAIConversation, searchAIConversationMessages, subscribeAIConversationChanges } from './ai/aiConversationBridge.js'
import { buildExecutionContextDetails, getExecutionContextSnapshot } from './ai/aiExecutionContext.js'
import { getAIGlobalSettings, normalizeAIGlobalSettings, saveAIGlobalSettings } from './ai/aiGlobalSettingsBridge.js'
import { getAIProviderState, getAIProviderTokenGroup } from './ai/aiProviderBridge.js'
import { getMCPSettingsState, saveMCPGlobalServer, reloadMCPGlobalServers, deleteMCPGlobalServer, restartMCPClientServer, toggleMCPClientServer, toggleMCPClientServerDisabledForPrompts, updateMCPClientServerTimeout } from './ai/mcpClientBridge.js'
import { processRemoteFileMentions } from './ai/aiMentions.js'
import { expandFirstSlashCommandForPrompt } from './ai/aiSlashCommands.js'
import AIChatConversation from './ai/chat/AIChatConversation.jsx'
import { getConversationBranchAnchor } from './ai/chat/aiChatMessageTopology.js'

function formatMessageTime() {
  return new Date().toLocaleTimeString(getLanguage() || 'zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function splitTerminalOutputLinesKeepNewline(content) {
  if (!content) {
    return []
  }
  const matches = String(content).match(/[^\n]*\n|[^\n]+/g)
  return Array.isArray(matches) ? matches : []
}

function processTerminalOutputLineWithCarriageReturns(line) {
  const segments = String(line).split('\r')
  if (segments.length === 1) {
    return line
  }
  let current = Array.from(segments[0] || '')
  for (const segment of segments.slice(1)) {
    if (!segment) {
      continue
    }
    const segmentRunes = Array.from(segment)
    if (segmentRunes.length >= current.length) {
      current = segmentRunes
      continue
    }
    const next = [...current]
    for (let index = 0; index < segmentRunes.length; index += 1) {
      next[index] = segmentRunes[index]
    }
    current = next
  }
  return current.join('')
}

function processTerminalOutputCarriageReturns(input) {
  const source = String(input || '')
  if (!source.includes('\r')) {
    return source
  }
  return source.split('\n').map(processTerminalOutputLineWithCarriageReturns).join('\n')
}

function processTerminalOutputBackspaces(input) {
  const source = String(input || '')
  if (!source.includes('\b')) {
    return source
  }
  const output = []
  for (const ch of Array.from(source)) {
    if (ch === '\b') {
      if (output.length > 0) {
        output.pop()
      }
      continue
    }
    output.push(ch)
  }
  return output.join('')
}

function truncateTerminalOutputForPrompt(content, lineLimit, characterLimit) {
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

function applyTerminalOutputRunLengthEncoding(content) {
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

function compressTerminalOutputForPrompt(input, lineLimit, characterLimit) {
  let processed = String(input || '')
  processed = processTerminalOutputCarriageReturns(processed)
  processed = processTerminalOutputBackspaces(processed)
  return truncateTerminalOutputForPrompt(applyTerminalOutputRunLengthEncoding(processed), lineLimit, characterLimit)
}

function createEmptyPanelState() {
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
    contextTokens: 0,
    isCondensingContext: false,
    activeChangeReview: null,
  }
}

function normalizeAIMessageStatus(value) {
  return typeof value === 'string' ? value.trim() : ''
}

const AI_FOLLOWUP_PENDING_STATUS_KEY = '等待处理'
const AI_FOLLOWUP_COMPLETED_STATUS_KEY = '已完成'

function truncateConversationTitle(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return translate('新对话')
  }
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized
}

function normalizeMessageImages(images) {
  return Array.isArray(images)
    ? images.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

function normalizeAIRuntimePhase(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (nextValue === 'api_request' || nextValue === 'tool_session' || nextValue === 'between_tool_and_next_api') {
    return nextValue
  }
  return 'ready'
}

function isAIQueueBlocked(runtimePhase) {
  return normalizeAIRuntimePhase(runtimePhase) !== 'ready'
}

function buildAIQueuedSubmission({ kind, text = '', images = [], targetMessageId = '', targetMessageText = '' }) {
  return {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    text: typeof text === 'string' ? text : '',
    images: normalizeMessageImages(images),
    targetMessageId: typeof targetMessageId === 'string' ? targetMessageId : '',
    targetMessageText: typeof targetMessageText === 'string' ? targetMessageText : '',
    queuedAt: Date.now(),
  }
}

function normalizeAIContextTokensValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

function cloneAIConversationCacheObjects(cacheObjects) {
  if (!cacheObjects || typeof cacheObjects !== 'object') {
    return null
  }
  const openaiResponses = cacheObjects?.openaiResponses && typeof cacheObjects.openaiResponses === 'object'
    ? {
        responseId: typeof cacheObjects.openaiResponses.responseId === 'string' ? cacheObjects.openaiResponses.responseId.trim() : '',
        output: Array.isArray(cacheObjects.openaiResponses.output)
          ? cacheObjects.openaiResponses.output.filter((item) => item && typeof item === 'object').map((item) => JSON.parse(JSON.stringify(item)))
          : [],
        include: Array.isArray(cacheObjects.openaiResponses.include)
          ? cacheObjects.openaiResponses.include.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
          : [],
        store: cacheObjects.openaiResponses.store === true,
        capturedAt: typeof cacheObjects.openaiResponses.capturedAt === 'number' ? cacheObjects.openaiResponses.capturedAt : 0,
      }
    : null
  if (!openaiResponses || (!openaiResponses.responseId && openaiResponses.output.length === 0 && openaiResponses.include.length === 0 && !openaiResponses.store && openaiResponses.capturedAt === 0)) {
    return null
  }
  return {
    openaiResponses,
  }
}

function buildRequestMessages(apiMessages) {
  return Array.isArray(apiMessages)
    ? apiMessages
        .filter((message) => message && typeof message === 'object')
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
          content: typeof message.content === 'string' ? message.content.trim() : '',
          images: normalizeMessageImages(message.images),
          cacheObjects: cloneAIConversationCacheObjects(message.cacheObjects),
        }))
        .filter((message) => message.content || message.images.length > 0 || message.cacheObjects?.openaiResponses?.output?.length > 0)
    : []
}

function createAPIHistoryMessage({ role, content, messageId = '', uiMessageIds = [], images = [], cacheObjects = null, ts = Date.now() }) {
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

function shouldUseAssistantFirstReplyForConversation(conversation) {
  const uiMessages = Array.isArray(conversation?.messages) ? conversation.messages : []
  const apiMessages = Array.isArray(conversation?.apiMessages) ? conversation.apiMessages : []
  const hasAssistantUIMessage = uiMessages.some((message) => message && typeof message === 'object' && message.kind === 'assistant')
  const hasAssistantAPIMessage = apiMessages.some((message) => message && typeof message === 'object' && message.role === 'assistant')
  return !hasAssistantUIMessage && !hasAssistantAPIMessage
}

function buildAIFollowupAnswerPayload(answer) {
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

function findLatestAIFollowupMessageByRequestId(messages, requestId) {
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

function collectTurnUiMessageIds(messages, assistantMessageId) {
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

function findApiAnchorIndexByUiMessageId(apiMessages, uiMessageId) {
  const targetId = typeof uiMessageId === 'string' ? uiMessageId.trim() : ''
  if (!targetId) {
    return -1
  }
  return Array.isArray(apiMessages)
    ? apiMessages.findIndex((message) => Array.isArray(message?.uiMessageIds) && message.uiMessageIds.includes(targetId))
    : -1
}

function upsertAPIHistoryMessage(apiMessages, rawMessage, currentMessages = []) {
  const role = rawMessage?.role === 'assistant' ? 'assistant' : rawMessage?.role === 'system' ? 'system' : 'user'
  const content = typeof rawMessage?.content === 'string' ? rawMessage.content.trim() : ''
  const images = normalizeMessageImages(rawMessage?.images)
  if (!content && images.length === 0) {
    return Array.isArray(apiMessages) ? apiMessages : []
  }

  const directUIMessageIDs = Array.isArray(rawMessage?.uiMessageIds)
    ? rawMessage.uiMessageIds.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
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

function buildMetrics(payload) {
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

function buildReasoningDuration(payload) {
  if (typeof payload.firstTokenMs === 'number' && payload.firstTokenMs > 0) {
    return `${(payload.firstTokenMs / 1000).toFixed(1)}s`
  }
  if (typeof payload.elapsedMs === 'number' && payload.elapsedMs > 0) {
    return `${(payload.elapsedMs / 1000).toFixed(1)}s`
  }
  return ''
}

function upsertConversationSummary(list, snapshot) {
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

function insertMessageBeforeAssistant(messages, requestId, nextMessage) {
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

function upsertMessageBeforeAssistant(messages, requestId, nextMessage) {
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

const AI_CONVERSATION_DIFF_TOOL_NAMES = new Set(['apply_diff', 'write_to_file', 'search_replace', 'edit_file', 'apply_patch'])
const AI_CONVERSATION_DIFF_SUCCESS_STATUSES = new Set(['已执行', AI_FOLLOWUP_COMPLETED_STATUS_KEY])

function extractAIConversationDiffPrimaryPath(copyContent, fallbackSummary) {
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

function normalizeAIConversationSearchQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function extractAIConversationSearchText(message) {
  const kind = typeof message?.kind === 'string' ? message.kind.trim() : ''
  if (kind === 'followup') {
    const parts = []
    const question = typeof message?.question === 'string' ? message.question.trim() : ''
    if (question) {
      parts.push(question)
    }
    const questions = Array.isArray(message?.questions) ? message.questions : []
    questions.forEach((item) => {
      const title = typeof item?.text === 'string' ? item.text.trim() : ''
      if (title) {
        parts.push(title)
      }
      const options = Array.isArray(item?.options) ? item.options : []
      options.forEach((option) => {
        const answer = typeof option?.answer === 'string' ? option.answer.trim() : ''
        if (answer) {
          parts.push(answer)
        }
      })
    })
    const suggestions = Array.isArray(message?.suggestions)
      ? message.suggestions.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
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

function buildAIConversationSearchSnippet(text, query) {
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

function resolveAIEventSound(payload, fallbackSound = '', allowPayloadOverride = true) { 
  if (allowPayloadOverride && payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'sound')) {
    return typeof payload.sound === 'string' ? payload.sound.trim() : ''
  }
  return typeof fallbackSound === 'string' ? fallbackSound.trim() : ''
}

export default function AIPanel({ width, side, terminalId = 'global', sessionId = '', sessionTerminals = [], onDevilModeChange, addToast }) {
  const { t } = useTranslation()
  const audioPlayersRef = useRef(new Map())
  const [mcpInfo, setMcpInfo] = useState({ url: '', transport: 'streamable-http', endpoint: '/mcp', instructions: '', logs: '', tools: [] })
  const [aiProviderState, setAIProviderState] = useState({ currentProviderId: '', providers: [] })
  const [mcpClientServers, setMCPClientServers] = useState([])
  const [mcpClientGlobalConfigPath, setMCPClientGlobalConfigPath] = useState('')
  const [mcpClientGlobalConfigText, setMCPClientGlobalConfigText] = useState('{\n  "mcpServers": {}\n}')
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [popupDismissVersion, setPopupDismissVersion] = useState(0)
  const [activeSettingsTab, setActiveSettingsTab] = useState('')
  const [isDevilMode, setIsDevilMode] = useState(false)
  const [conversationList, setConversationList] = useState([])
  const [globalAISettings, setGlobalAISettings] = useState(null)
  const [terminalOutputLineLimit, setTerminalOutputLineLimit] = useState(500)
  const [terminalOutputCharacterLimit, setTerminalOutputCharacterLimit] = useState(35000)
  const [terminalPanels, setTerminalPanels] = useState({})
  const [composerInputValue, setComposerInputValue] = useState('')
  const [composerImages, setComposerImages] = useState([])
  const [composerEditState, setComposerEditState] = useState({ mode: 'new', targetMessageId: '', targetMessageText: '' })
  const [conversationScrollSignal, setConversationScrollSignal] = useState(0)
  const [hoveredConversationActionKey, setHoveredConversationActionKey] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState([])
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false)
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [conversationSearchIndex, setConversationSearchIndex] = useState(0)
  const terminalPanelsRef = useRef({})
  const panelMountedRef = useRef(true)
  const panelInstanceKey = `${sessionId || 'session'}::${terminalId || 'terminal'}`
  const globalSearchRequestRef = useRef(0)
  const globalSearchInputRef = useRef(null)
  const conversationSearchInputRef = useRef(null)
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

  const applyMCPInfo = useCallback((info) => {
    if (!panelMountedRef.current || !info) {
      return
    }
    setMcpInfo({
      url: info.url || '',
      transport: info.transport || 'streamable-http',
      endpoint: info.endpoint || '/mcp',
      instructions: info.instructions || '',
      logs: info.logs || '',
      tools: Array.isArray(info.tools) ? info.tools : [],
    })
  }, [])
  const applyMCPSettingsState = useCallback((state) => {
    if (!panelMountedRef.current || !state) {
      return
    }
    applyMCPInfo(state.service || {})
    setMCPClientServers(Array.isArray(state.client?.servers) ? state.client.servers : [])
    setMCPClientGlobalConfigPath(typeof state.client?.globalConfigPath === 'string' ? state.client.globalConfigPath : '')
    setMCPClientGlobalConfigText(typeof state.client?.globalConfigText === 'string' && state.client.globalConfigText.trim() ? state.client.globalConfigText : '{\n  "mcpServers": {}\n}')
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

  const showAlert = useCallback(async (message) => {
    const finalMessage = typeof message === 'string' && message.trim() ? translate(message.trim()) : translate('当前状态不支持还原')
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
    const handleAppendComposerText = (event) => {
      const targetSessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : ''
      const targetTerminalId = typeof event?.detail?.terminalId === 'string' ? event.detail.terminalId.trim() : ''
      const preserveWhitespace = event?.detail?.preserveWhitespace === true
      const rawAppendedText = typeof event?.detail?.text === 'string' ? event.detail.text : ''
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
  const enrichAIChatCommandMessage = useCallback((message) => {
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
  const canToggleAIMode = useMemo(() => {
    const rawBaseURL = typeof selectedAIProvider?.baseUrl === 'string' ? selectedAIProvider.baseUrl.trim() : ''
    if (!rawBaseURL) {
      return false
    }
    const candidates = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawBaseURL) ? [rawBaseURL] : [rawBaseURL, `https://${rawBaseURL}`]
    return candidates.some((item) => {
      try {
        return new URL(item).hostname.toLowerCase() === 'newapi.callmy.vip'
      } catch {
        return false
      }
    })
  }, [selectedAIProvider])
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
  const resolveFirstAvailableProviderId = useCallback((providers = []) => {
    return typeof providers[0]?.id === 'string' ? providers[0].id.trim() : ''
  }, [])
  const resolveAvailableProviderId = useCallback((providers = [], preferredProviderId = '') => {
    const normalizedPreferredProviderId = typeof preferredProviderId === 'string' ? preferredProviderId.trim() : ''
    if (normalizedPreferredProviderId && providers.some((item) => item?.id === normalizedPreferredProviderId)) {
      return normalizedPreferredProviderId
    }
    return resolveFirstAvailableProviderId(providers)
  }, [resolveFirstAvailableProviderId])
  const buildConversationWithProviderId = useCallback((snapshot, providerId) => {
    if (!snapshot || typeof snapshot !== 'object') {
      return snapshot
    }
    const normalizedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
    const currentProviderId = typeof snapshot?.settings?.currentProviderId === 'string' ? snapshot.settings.currentProviderId.trim() : ''
    if (currentProviderId === normalizedProviderId) {
      return snapshot
    }
    return {
      ...snapshot,
      updatedAt: Date.now(),
      settings: normalizeAIConversationTaskSettings({
        ...snapshot.settings,
        currentProviderId: normalizedProviderId,
      }),
    }
  }, [])
  const effectiveProviderId = selectedAIProvider?.id || resolveAvailableProviderId(
    availableAIProviders,
    typeof aiProviderState?.currentProviderId === 'string' ? aiProviderState.currentProviderId.trim() : '',
  )
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
  const playAISound = useCallback((type) => {
    if (normalizedGlobalAISettings.soundEnabled === false) {
      return
    }
    const parsedVolume = Number(normalizedGlobalAISettings.soundVolume)
    const volume = Number.isFinite(parsedVolume) ? Math.max(0, Math.min(1, parsedVolume)) : 0.06
    if (volume <= 0) {
      return
    }
    const soundKey = typeof type === 'string' ? type.trim() : ''
    const audioPathByType = {
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

  const setPanelState = useCallback((panelKey, updater) => {
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

  const getMessageApiLengthBefore = useCallback((message) => {
    const rawValue = message?.extra?.apiLengthBefore
    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0
  }, [])

  const truncateConversationAfterMessage = useCallback((conversation, messageId) => {
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

  const refreshAIConversationContextTokens = useCallback(async (snapshot, targetPanelKey = panelInstanceKey) => {
    const bridge = window?.go?.main?.AIBindings || window?.go?.main?.App
    if (!snapshot?.id || !bridge?.CountAIConversationContextTokens) {
      return 0
    }
    try {
      const metrics = await bridge.CountAIConversationContextTokens(terminalId, JSON.stringify(snapshot))
      const contextTokens = normalizeAIContextTokensValue(metrics?.contextTokens)
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
  }, [panelInstanceKey, setPanelState, terminalId])

  const saveConversationSnapshot = useCallback(async (snapshot, targetPanelKey = panelInstanceKey, options = {}) => {
    const saved = await saveAIConversation(snapshot)
    const shouldHydrate = options?.hydrate === true
    setConversationList((prev) => upsertConversationSummary(prev, saved))
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
        messages: saved.messages,
        apiMessages: saved.apiMessages,
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

  useEffect(() => subscribeAIConversationChanges((change) => {
    if (change?.type === 'upsert' && change.summary?.id) {
      setConversationList((current) => upsertConversationSummary(current, change.summary))
      return
    }
    if (change?.type !== 'delete' || !change.conversationId) {
      return
    }
    setConversationList((current) => current.filter((item) => item.id !== change.conversationId))
    const panel = terminalPanelsRef.current[panelInstanceKey]
    if (panel?.activeConversationId !== change.conversationId) {
      return
    }
    const requestId = panel.activeRequestId
    setPanelState(panelInstanceKey, createEmptyPanelState())
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

      if (payload.kind === 'assistant_retry_reset') {
        const assistantMessageId = typeof payload.messageId === 'string' && payload.messageId.trim()
          ? payload.messageId.trim()
          : (matchedPanel.activeAssistantMessageId || requestId)
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeAssistantMessageId: assistantMessageId,
          requestPhase: 'streaming',
          runtimePhase: 'api_request',
          messages: current.messages
            .filter((message) => !(message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning'))
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
            }),
        }))
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
          }
        })
        if (snapshotBeforeNextRequest) {
          void saveConversationSnapshot(snapshotBeforeNextRequest, matchedPanelKey, { hydrate: false })
        }
        return
      }

      if (payload.kind === 'append_message' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          messages: payload.message.kind === 'user'
            ? [...(Array.isArray(current.messages) ? current.messages : []), payload.message]
            : insertMessageBeforeAssistant(current.messages, current.activeAssistantMessageId || requestId, payload.message),
        }))
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
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          messages: upsertMessageBeforeAssistant(current.messages, current.activeAssistantMessageId || requestId, nextMessage),
        }))
        return
      }

      if (payload.kind === 'api_message_append' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          apiMessages: upsertAPIHistoryMessage(current.apiMessages, payload.message, current.messages),
        }))
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
        const toolMessages = payload.messages
          .filter((message) => message && typeof message === 'object')
          .map((message) => message)
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          let nextMessages = Array.isArray(current.messages) ? [...current.messages] : []
          nextMessages = nextMessages.filter((message) => !toolMessages.some((toolMessage) => toolMessage.id && toolMessage.id === message.id))
          toolMessages.forEach((toolMessage) => {
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
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          requestPhase: 'idle',
        }))
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
                text: typeof payload.text === 'string' ? payload.text : translate('已拒绝执行工具调用'),
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

          const markAssistantFirstOutput = (messages) => messages.map((message) => {
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

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          skipNextAutomaticRequest: false,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: nextConversation.apiMessages,
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }

      if (payload.kind === 'error') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const finalErrorText = payload.error || translate('请求失败')

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
          activeChangeReview: null,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
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
          activeChangeReview: null,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
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
  }, [enrichAIChatCommandMessage, playAISound, saveConversationSnapshot, setPanelState])

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
      contextTokens: 0,
      isCondensingContext: false,
      activeChangeReview: null,
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

  const handleOpenConversation = useCallback(async (conversationId) => {
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
      contextTokens: 0,
      isCondensingContext: false,
      activeChangeReview: null,
    })
    if (nextSnapshot !== snapshot) {
      await saveConversationSnapshot(nextSnapshot, panelInstanceKey)
      return
    }
    void refreshAIConversationContextTokens(nextSnapshot, panelInstanceKey)
  }, [aiProviderState, availableAIProviders, buildConversationWithProviderId, panelInstanceKey, refreshAIConversationContextTokens, resetComposerEditState, resolveAvailableProviderId, saveConversationSnapshot, setPanelState])

  const handleRestoreConversationBackup = useCallback(async (snapshot) => {
    if (!snapshot?.id) {
      return
    }
    clearRestorePreview()
    resetComposerEditState()
    resetGlobalSearchState()
    resetConversationSearchState()
    setConversationList((prev) => upsertConversationSummary(prev, snapshot))
    setPanelState(panelInstanceKey, {
      activeConversationId: snapshot.id,
      conversation: snapshot,
      messages: snapshot.messages,
      apiMessages: snapshot.apiMessages,
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
      contextTokens: 0,
      isCondensingContext: false,
      activeChangeReview: null,
    })
    void refreshAIConversationContextTokens(snapshot, panelInstanceKey)
  }, [panelInstanceKey, refreshAIConversationContextTokens, resetComposerEditState, setPanelState])

  const handleOpenConversationFolder = useCallback(async (conversationId) => {
    try {
      await openAIConversationFolder(conversationId)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('打开任务所在文件夹失败')
      await showAlert(message)
    }
  }, [showAlert, t])

  const locateConversationMessage = useCallback((messageId) => {
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

  const handleCycleConversationSearchResult = useCallback((direction) => {
    if (conversationSearchResults.length === 0) {
      return
    }
    setConversationSearchIndex((current) => {
      const total = conversationSearchResults.length
      return (current + direction + total) % total
    })
  }, [conversationSearchResults.length])

  const handleSelectGlobalSearchResult = useCallback(async (result) => {
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

  const handleDeleteConversation = useCallback(async (conversationId) => {
    clearRestorePreview()
    const confirmed = await requestDeleteConfirmation(t('确定删除这条对话吗？此操作不可撤销。'))
    if (!confirmed) {
      return
    }
    await deleteAIConversation(conversationId)
    setConversationList((prev) => prev.filter((item) => item.id !== conversationId))
    setTerminalPanels((prev) => {
      const nextPanels = { ...prev }
      Object.keys(nextPanels).forEach((panelKey) => {
        const panel = nextPanels[panelKey]
        if (panel?.activeConversationId === conversationId) {
          nextPanels[panelKey] = createEmptyPanelState()
        }
      })
      return nextPanels
    })
    setComposerEditState((current) => (
      current.mode !== 'new' && panelState.activeConversationId === conversationId
        ? { mode: 'new', targetMessageId: '', targetMessageText: '' }
        : current
    ))
  }, [panelState.activeConversationId, requestDeleteConfirmation, t])

  const handleProviderChange = useCallback(async (providerId) => {
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
          ...activeConversation.settings,
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

  const handlePatchAutoApprovalSettings = useCallback(async (patch) => {
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
          ...activeConversation.settings,
          ...taskPatch,
        }),
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversation,
      }))
      await saveConversationSnapshot(nextConversation, panelInstanceKey)
      return
    }

    if (!activeConversation && Object.keys(taskPatch).length > 0) {
      const nextSettings = await saveAIGlobalSettings({
        ...normalizeAIGlobalSettings(globalAISettings),
        ...taskPatch,
      })
      setGlobalAISettings(nextSettings)
    }
  }, [activeConversation, globalAISettings, panelInstanceKey, saveConversationSnapshot, setPanelState])

  const handleSaveAIPanelGlobalSettings = useCallback(async (patch) => {
    const nextSettings = await saveAIGlobalSettings({
      ...normalizedGlobalAISettings,
      ...patch,
    })
    setGlobalAISettings(nextSettings)
    await refreshMCPServerInfo()
    return nextSettings
  }, [normalizedGlobalAISettings, refreshMCPServerInfo])
  const handleSaveMCPGlobalServer = useCallback(async (name, configText) => {
    await saveMCPGlobalServer(name, configText)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleReloadMCPGlobalServers = useCallback(async () => {
    await reloadMCPGlobalServers()
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleDeleteMCPGlobalServer = useCallback(async (name) => {
    await deleteMCPGlobalServer(name)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleRestartMCPClientServer = useCallback(async (name, source) => {
    await restartMCPClientServer(name, source)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleToggleMCPClientServer = useCallback(async (name, source, disabled) => {
    await toggleMCPClientServer(name, source, disabled)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleToggleMCPClientServerDisabledForPrompts = useCallback(async (name, source, disabledForPrompts) => {
    await toggleMCPClientServerDisabledForPrompts(name, source, disabledForPrompts)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])
  const handleUpdateMCPClientServerTimeout = useCallback(async (name, source, timeout) => {
    await updateMCPClientServerTimeout(name, source, timeout)
    await refreshMCPServerInfo()
  }, [refreshMCPServerInfo])

  const saveMCPOutputCompressionSettings = useCallback(async (lineLimit, characterLimit) => {
    const nextLineLimit = Math.max(10, Math.min(5000, lineLimit || 0))
    const nextCharacterLimit = Math.max(1000, Math.min(500000, characterLimit || 0))
    setTerminalOutputLineLimit(nextLineLimit)
    setTerminalOutputCharacterLimit(nextCharacterLimit)
    await AppGo.SaveMCPOutputCompressionSettings(nextLineLimit, nextCharacterLimit)
  }, [])

  async function requestDeleteConfirmation(message) {
    if (!normalizedGlobalAISettings.confirmDelete) {
      return true
    }
    const confirm = window?.luminDialog?.confirm
    if (typeof confirm !== 'function') {
      return true
    }
    const result = await confirm(message, t('操作确认'))
    return result === true || result?.confirmed === true
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

  const handleTerminalOutputLineLimitChange = useCallback((event) => {
    const value = parseInt(event.target.value, 10) || 0
    saveMCPOutputCompressionSettings(value, terminalOutputCharacterLimit).catch(() => {})
  }, [saveMCPOutputCompressionSettings, terminalOutputCharacterLimit])

  const handleTerminalOutputCharacterLimitChange = useCallback((event) => {
    const value = parseInt(event.target.value, 10) || 0
    saveMCPOutputCompressionSettings(terminalOutputLineLimit, value).catch(() => {})
  }, [saveMCPOutputCompressionSettings, terminalOutputLineLimit])

  const handleSendMessage = useCallback(async (text, sendOptionsOrEditState = null, explicitEditState = null, runtimeOptions = {}) => {
    let sendOptions = null
    let overrideEditState = explicitEditState
    if (sendOptionsOrEditState && typeof sendOptionsOrEditState === 'object' && (sendOptionsOrEditState.mode === 'edit' || sendOptionsOrEditState.mode === 'retry')) {
      overrideEditState = sendOptionsOrEditState
    } else {
      sendOptions = sendOptionsOrEditState
    }

    const nextText = typeof text === 'string' ? text.trim() : ''
    const messageImages = normalizeMessageImages(sendOptions?.images ?? composerImages)
    if (!nextText && messageImages.length === 0) {
      return false
    }

    clearRestorePreview()

    let targetConversationSnapshot = activeConversation
    const activeComposerState = overrideEditState || composerEditState
    const isEditingExistingMessage = activeComposerState?.mode === 'edit' && activeComposerState?.targetMessageId
    const isRetryingMessage = activeComposerState?.mode === 'retry' && activeComposerState?.targetMessageId

    const latestProviderState = await getAIProviderState().catch(() => ({
      currentProviderId: typeof aiProviderState?.currentProviderId === 'string' ? aiProviderState.currentProviderId.trim() : '',
      providers: availableAIProviders,
    }))
    const latestProviders = Array.isArray(latestProviderState?.providers) ? latestProviderState.providers : []
    const preferredProviderId = targetConversationSnapshot
      ? targetConversationSnapshot?.settings?.currentProviderId
      : latestProviderState?.currentProviderId
    const resolvedProviderId = resolveAvailableProviderId(latestProviders, preferredProviderId)
    const nextConversationSnapshot = targetConversationSnapshot
      ? buildConversationWithProviderId(targetConversationSnapshot, resolvedProviderId)
      : null

    setAIProviderState({
      currentProviderId: resolvedProviderId,
      providers: latestProviders,
    })

    if (targetConversationSnapshot && nextConversationSnapshot !== targetConversationSnapshot) {
      targetConversationSnapshot = nextConversationSnapshot
      setConversationList((prev) => upsertConversationSummary(prev, nextConversationSnapshot))
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversationSnapshot,
      }))
      await saveConversationSnapshot(nextConversationSnapshot, panelInstanceKey)
    } else if (!targetConversationSnapshot) {
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
        targetMessageId: activeComposerState?.targetMessageId || '',
        targetMessageText: activeComposerState?.targetMessageText || nextText,
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
      targetConversation = await createAIConversation(truncateConversationTitle(nextText))
      setConversationList((prev) => upsertConversationSummary(prev, targetConversation))
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
    const baseUserPromptText = preprocessedPromptText
      ? `<user_message>\n${preprocessedPromptText}\n</user_message>`
      : ''
    const promptWithMentions = baseUserPromptText
      ? await processRemoteFileMentions(baseUserPromptText, {
          sessionId: terminalId,
          readFile: (activeSessionId, remotePath) => AppGo.ReadFile(activeSessionId, remotePath),
          listDir: (activeSessionId, remotePath) => AppGo.ListDir(activeSessionId, remotePath),
          getTerminalOutput: () => {
            const snapshotProvider = window?.__luminTerminalSnapshots?.[terminalId]
            const rawOutput = typeof snapshotProvider === 'function' ? snapshotProvider() : ''
            return compressTerminalOutputForPrompt(rawOutput, terminalOutputLineLimit, terminalOutputCharacterLimit)
          },
          readLocalWrappedFile: (localPath) => readAIConversationWrappedFile(targetConversation.id, localPath),
        })
      : ''
    const processedPromptText = [promptWithMentions, environmentDetailsBlock]
      .filter((item) => typeof item === 'string' && item.trim())
      .join('\n\n')
      .trim()

    const baseConversation = isEditingExistingMessage || isRetryingMessage
      ? truncateConversationAfterMessage(targetConversation, activeComposerState.targetMessageId)
      : targetConversation
    const shouldInjectAssistantFirstReply = shouldUseAssistantFirstReplyForConversation(baseConversation)

    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const baseApiMessages = Array.isArray(baseConversation.apiMessages) ? baseConversation.apiMessages : []
    const userMessage = {
      id: `user-${requestId}`,
      kind: 'user',
      text: nextText,
      images: messageImages,
      time: formatMessageTime(),
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
    if (shouldInjectAssistantFirstReply) {
      assistantFirstReplyText = (await getAIAssistantFirstReply(getLanguage())).trim()
    }

    resetComposerEditState()
    requestConversationSmoothScrollToBottom()
    setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    setPanelState(panelInstanceKey, {
      activeConversationId: targetConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
    })

    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })

    try {
      await startAIChat(requestId, {
        conversationId: targetConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: Boolean(panelState.skipNextAutomaticRequest),
        assistantFirstReplyText: assistantFirstReplyText || undefined,
        isDemon: Boolean(isDevilMode),
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
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
        activeChangeReview: null,
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, aiProviderState, availableAIProviders, buildConversationWithProviderId, composerEditState, composerImages, effectiveAutoApprovalEnabled, getAIAssistantFirstReply, globalAISettings, isDevilMode, isQueueBlocked, normalizedGlobalAISettings.slashCommands, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, requestConversationSmoothScrollToBottom, resetComposerEditState, resolveAvailableProviderId, saveConversationSnapshot, setPanelState, terminalId, terminalOutputCharacterLimit, terminalOutputLineLimit, truncateConversationAfterMessage])

  const handleFollowupResponse = useCallback(async (payload) => {
    if (!payload || typeof payload !== 'object') {
      return false
    }
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : ''
    if (!requestId) {
      return false
    }
    try {
      await resolveAIChatFollowup(requestId, payload.answer, [])
      return true
    } catch {}
    const currentPanel = terminalPanelsRef.current[panelInstanceKey] || null
    const currentConversation = currentPanel?.conversation || activeConversation
    if (!currentConversation?.id) {
      return false
    }
    const { readableText, content: followupContent } = buildAIFollowupAnswerPayload(payload.answer)
    if (!readableText || !followupContent) {
      return false
    }
    const currentMessages = Array.isArray(currentPanel?.messages) ? currentPanel.messages : (Array.isArray(currentConversation.messages) ? currentConversation.messages : [])
    const currentApiMessages = Array.isArray(currentPanel?.apiMessages) ? currentPanel.apiMessages : (Array.isArray(currentConversation.apiMessages) ? currentConversation.apiMessages : [])
    const followupMessage = findLatestAIFollowupMessageByRequestId(currentMessages, requestId)
    const followupMessageId = typeof followupMessage?.id === 'string' ? followupMessage.id.trim() : ''
    const followupImages = normalizeMessageImages(payload.images)
    const timestamp = Date.now()
    const userMessageId = `${followupMessageId || requestId}-followup-answer-${timestamp}`
    const userMessage = {
      id: userMessageId,
      kind: 'user',
      text: readableText,
      images: followupImages,
      time: formatMessageTime(),
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
    setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
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
      activeChangeReview: null,
    })
    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })
    try {
      await startAIChat(nextRequestId, {
        conversationId: currentConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: false,
        isDemon: Boolean(isDevilMode),
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
        activeChangeReview: null,
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, effectiveAutoApprovalEnabled, isDevilMode, panelInstanceKey, requestConversationSmoothScrollToBottom, saveConversationSnapshot, setPanelState, terminalId])

  const handleConversationUserMessage = useCallback(async (payload) => {
    if (payload && typeof payload === 'object' && payload.kind === 'followup-response') {
      return handleFollowupResponse(payload)
    }
    const text = typeof payload === 'string' ? payload : ''
    return handleSendMessage(text, { images: [] })
  }, [handleFollowupResponse, handleSendMessage])

  const handleRetryUserMessage = useCallback(async (messageId, text, images = []) => {
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

  const handleRetryAssistantMessage = useCallback(async (messageId) => {
    if (!activeConversation) {
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

    const targetAssistantMessage = activeConversation.messages.find((message) => message.id === messageId && message.kind === 'assistant')
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
    setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    setPanelState(panelInstanceKey, {
      activeConversationId: activeConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: requestApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
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
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
        activeChangeReview: null,
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, effectiveAutoApprovalEnabled, isDevilMode, isQueueBlocked, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, requestConversationSmoothScrollToBottom, resetComposerEditState, saveConversationSnapshot, setPanelState, terminalId, truncateConversationAfterMessage])

  const handleEditUserMessage = useCallback((messageId, text, images = []) => {
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

  const handleDeleteMessage = useCallback(async (messageId) => {
    if (!activeConversation) {
      return
    }
    clearRestorePreview()
    const confirmed = await requestDeleteConfirmation(t('确定删除这条消息及其后续对话吗？此操作不可撤销。'))
    if (!confirmed) {
      return
    }
    const nextConversation = truncateConversationAfterMessage(activeConversation, messageId)
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextConversation.apiMessages,
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
    }))
    if (composerEditState.targetMessageId === messageId) {
      resetComposerEditState()
    }
    requestConversationSmoothScrollToBottom()
    await saveConversationSnapshot(nextConversation, panelInstanceKey)
  }, [activeConversation, composerEditState.targetMessageId, panelInstanceKey, requestConversationSmoothScrollToBottom, requestDeleteConfirmation, resetComposerEditState, saveConversationSnapshot, setPanelState, t, truncateConversationAfterMessage])

  const handleCondenseContext = useCallback(async () => {
    if (!activeConversation || runtimePhase !== 'ready' || panelState.isCondensingContext) {
      return
    }
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      isCondensingContext: true,
    }))
    try {
      const result = await condenseAIConversationContext(activeConversation.id, terminalId)
      const nextSnapshot = normalizeAIConversationSnapshot(result?.snapshot || result)
      setConversationList((prev) => upsertConversationSummary(prev, nextSnapshot))
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextSnapshot,
        messages: nextSnapshot.messages,
        apiMessages: nextSnapshot.apiMessages,
        isCondensingContext: false,
      }))
      void refreshAIConversationContextTokens(nextSnapshot, panelInstanceKey)
    } catch {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        isCondensingContext: false,
      }))
    }
  }, [activeConversation, panelInstanceKey, panelState.isCondensingContext, refreshAIConversationContextTokens, runtimePhase, setPanelState, terminalId])

  const resumeAIChatFromConversation = useCallback(async (conversationSnapshot, targetPanelKey = panelInstanceKey) => {
    if (!conversationSnapshot || !effectiveProviderId) {
      return false
    }
    const requestApiMessages = Array.isArray(conversationSnapshot.apiMessages) ? conversationSnapshot.apiMessages : []
    if (requestApiMessages.length === 0) {
      return false
    }
    const requestMessages = buildRequestMessages(requestApiMessages)
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
    setConversationList((prev) => upsertConversationSummary(prev, nextConversation))
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
    })


    try {
      await startAIChat(requestId, {
        conversationId: conversationSnapshot.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: false,
        isDemon: Boolean(isDevilMode),
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
        activeChangeReview: null,
      })
      await saveConversationSnapshot(erroredConversation, targetPanelKey)
      return false
    }
  }, [effectiveAutoApprovalEnabled, effectiveProviderId, isDevilMode, panelInstanceKey, requestConversationSmoothScrollToBottom, saveConversationSnapshot, setPanelState, terminalId])

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

  const handlePreviewRestore = useCallback(async (restoreArtifactPath) => {
    try {
      const review = await previewAIChatToolRestore(restoreArtifactPath, terminalId)
      if (typeof window !== 'undefined' && review && typeof review === 'object') {
        window.dispatchEvent(new CustomEvent('ai-change-review-preview', {
          detail: { sessionId: terminalId, review },
        }))
      }
    } catch (error) {
      await showAlert(error instanceof Error ? translate(error.message) : translate('当前状态不支持还原'))
    }
  }, [showAlert, terminalId])

  const handleApplyRestore = useCallback(async (restoreArtifactPath) => {
    try {
      await restoreAIChatTool(restoreArtifactPath, terminalId)
      clearRestorePreview()
      return true
    } catch (error) {
      await showAlert(error instanceof Error ? translate(error.message) : translate('当前状态不支持还原'))
      return false
    }
  }, [clearRestorePreview, showAlert, terminalId])

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

  const handleAssignToolTerminal = useCallback(async (targetSessionId) => {
    if (!panelState.activeRequestId) {
      return
    }
    await assignAIChatToolTerminal(panelState.activeRequestId, targetSessionId)
  }, [panelState.activeRequestId])

  const handleToggleSkipNextAutomaticRequest = useCallback(async (enabled) => {
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
            { forceImmediate: true },
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

  const configText = `"lumin-ssh": {
  "type": "${mcpInfo.transport || 'streamable-http'}",
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
                {globalSearchResults.map((result) => (
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
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(result.updatedAt || 0).toLocaleString(getLanguage() || 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result.snippet}</div>
                  </button>
                ))}
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
      content = conversationList.map((item) => {
        const isFolderHovered = hoveredConversationActionKey === `${item.id}:folder`
        const isDeleteHovered = hoveredConversationActionKey === `${item.id}:delete`
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
              <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                <div style={{ fontSize: 13, fontWeight: panelState.activeConversationId === item.id ? 600 : 500, color: 'var(--text-primary)', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{new Date(item.updatedAt).toLocaleString(getLanguage() || 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.messageCount} {t('消息')}</div>
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
        isCondensingContext={Boolean(panelState.isCondensingContext)}
        canCondenseContext={Boolean(activeConversation) && runtimePhase === 'ready' && !panelState.isCondensingContext}
        onCondenseContext={handleCondenseContext}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div data-ai-chat-stage="true" style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeConversation ? (
            <>
              {conversationSearchOpen ? (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)', display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 8, alignItems: 'center' }}>
                  <input
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
                onSendUserMessage={handleConversationUserMessage}
                onRetryUserMessage={handleRetryUserMessage}
                onRetryAssistantMessage={handleRetryAssistantMessage}
                onEditUserMessage={handleEditUserMessage}
                onDeleteMessage={handleDeleteMessage}
                onPreviewRestore={handlePreviewRestore}
                onApplyRestore={handleApplyRestore}
                messageActionBarAtBottom={messageActionBarAtBottom}
                scrollToBottomSignal={conversationScrollSignal}
              />
            </>
          ) : renderedConversationList}
        </div>
        <AIComposer
          onSend={handleSendMessage}
          onCancel={handleCancelMessage}
          onStopAndResume={handleStopAndResumeMessage}
          isSending={isStreaming}
          currentProviderId={effectiveProviderId}
          onCurrentProviderChange={handleProviderChange}
          terminalSessionId={terminalId}
          queueBlocked={isQueueBlocked || panelState.isFlushingQueuedSubmission}
          queuedSubmissionKind={panelState.queuedSubmission?.kind || ''}
          terminalAssignmentRequired={isAwaitingTerminalAssignment}
          onListCommandTerminalCandidates={handleListCommandTerminalCandidates}
          onAssignToolTerminal={handleAssignToolTerminal}
          onCancelQueuedSubmission={handleCancelQueuedSubmission}
          skipNextAutomaticRequest={Boolean(panelState.skipNextAutomaticRequest)}
          onToggleSkipNextAutomaticRequest={handleToggleSkipNextAutomaticRequest}
          persistProviderSelection={shouldPersistProviderSelection}
          autoApprovalSettings={effectiveAutoApprovalSettings}
          onPatchAutoApprovalSettings={handlePatchAutoApprovalSettings}
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
      />
    </div>
  )
}