// AIPanel 的数据模型契约与纯逻辑（状态归一化、消息/API 历史操作、协作流解析等），
// 从 AIPanel.tsx 抽出，无 React 状态依赖。
import { t as translate } from '../../i18n.ts';
import type { AIProviderLike } from './AIProviderSelector.tsx';
import { getAIProviderDefinition } from './providers/index.ts';
import type { ConversationSummary } from './aiConversationSummary.ts';
// 来自 Go 桥或事件 payload 的外部数据形状：字段均以 typeof 守卫读取，
// 无索引签名（字段名拼错编译期报错）；新增字段时在此补充。
// ============================================================

/** AI 事件 payload 的宽松形状（按需取用字段） */
export interface AIEventPayloadShape {
  sound?: unknown
}

/** AI 请求指标/耗时 payload（buildMetrics/buildReasoningDuration 输入） */
export interface AIMetricsPayload {
  firstTokenMs?: unknown
  elapsedMs?: unknown
  tokensPerSecond?: unknown
}

/** API 历史消息的宽松形状（upsertAPIHistoryMessage 输入，字段守卫读取） */
export interface AIAPIHistoryMessageLike {
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
export interface AIPanelSettings {
  terminalOutputLineLimit?: unknown
  terminalOutputCharacterLimit?: unknown
}

export interface AIPanelProps {
  width: string
  side: 'left' | 'right'
  sessionId: string
  terminalId: string
  sessionTerminals?: Array<{ id: string; label?: string }>
  settings?: AIPanelSettings
  workspaceTabId?: string
  isHomeView?: boolean
  isPanelVisible?: boolean
  isWorkspaceTabActive?: boolean
  showComposer?: boolean
  initialConversationId?: string
  tabBar?: React.ReactNode
  onDevilModeChange?: (enabled: boolean, tabId?: string) => void
  onActiveTabChange?: (tabId: string) => void
  onActivateWorkspaceTab?: (terminalId: string, tabId: string) => void
  onGoHomeRequested?: () => void
  onOpenConversationRequested?: (conversationId: string, messageId?: string) => void | Promise<void>
  onWorkspaceTabStateChange?: (tabId: string, state: { conversationId: string; title: string; activeRequestId: string; transient: boolean }) => void
  addToast?: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number
}

// AI 会话快照（来自 Go 侧 normalizeAIConversationSnapshot，字段可选、运行时确定）
export interface AIConversationSnapshot {
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
export interface AIMessage {
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

export interface APIHistoryMessage {
  role: string
  content: string
  messageId: string
  uiMessageIds: string[]
  images: string[]
  cacheObjects: unknown
  ts: number
}

// 发送给 AI 桥的请求消息（buildRequestMessages 的产物，缺少 API 历史消息的簿记字段）
export interface AIRequestMessage {
  role: string
  content: string
  images: string[]
  cacheObjects: unknown
}

export interface DisplayConversationItem extends ConversationSummary {
  depth: number
  parentDisplayTitle: string
}

export interface AIQueuedSubmission {
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

export interface AIToolExecution {
  executionId: string
  allowContinue: boolean
  allowTerminate: boolean
  allowTerminalAssignment: boolean
}

// 每个会话面板的运行时状态（createEmptyPanelState 的返回形状）
export interface PanelState {
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

export interface TokenLedger {
  systemRawTokens: number
  entries: Map<string, number>
}

export interface PerfRecord {
  stages: Array<{ label: string; ms: number }>
  total: number
  at: number
}

export interface ComposerEditState {
  mode: string
  targetMessageId: string
  targetMessageText: string
}

export interface McpInfoState {
  url: string
  transport: string
  endpoint: string
  instructions: string
  logs: string
  tools: unknown[]
}


export function getAIBridge() {
  return window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.App || null
}
export const AI_COLLABORATION_CONTINUE_PREFIX = '[Continue]'
export const AI_COLLABORATION_DONE_PREFIX = '[Done]'
export const AI_COLLABORATION_COMPRESSION_PREFIX = '[Compression]'
export const AI_COLLABORATION_RETRY_PREFIX = '[Retry]'

export function createEmptyPanelState(): PanelState {
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

export function normalizeAIMessageStatus(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export const AI_FOLLOWUP_PENDING_STATUS_KEY = '等待处理'
export const AI_FOLLOWUP_COMPLETED_STATUS_KEY = '已完成'

export function truncateConversationTitle(text: unknown) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return translate('新对话')
  }
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized
}

export function normalizeMessageImages(images: unknown) {
  return Array.isArray(images)
    ? images.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

export function normalizeAIRuntimePhase(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  if (nextValue === 'api_request' || nextValue === 'tool_session' || nextValue === 'between_tool_and_next_api') {
    return nextValue
  }
  return 'ready'
}

export function isAIQueueBlocked(runtimePhase: unknown) {
  return normalizeAIRuntimePhase(runtimePhase) !== 'ready'
}

export function buildAIQueuedSubmission({ kind, text = '', images = [], targetMessageId = '', targetMessageText = '', toolScope = '', toolScopeSlot = '', forceNewConversation = false }: { kind: string; text?: string; images?: unknown; targetMessageId?: string; targetMessageText?: string; toolScope?: string; toolScopeSlot?: string; forceNewConversation?: boolean }): AIQueuedSubmission {
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

export function normalizeAIContextTokensValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

export function cloneAIConversationCacheObjects(cacheObjects: unknown) {
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

export function buildRequestMessages(apiMessages: unknown): AIRequestMessage[] {
  return Array.isArray(apiMessages)
    ? apiMessages
        .filter((message) => message && typeof message === 'object')
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : (message.role === 'system' ? 'system' : 'user'),
          content: typeof message.content === 'string' ? message.content.trim() : '',
          images: normalizeMessageImages(message.images),
          cacheObjects: cloneAIConversationCacheObjects(message.cacheObjects),
        }))
        .filter((message) => message.content || message.images.length > 0 || (message.cacheObjects?.openaiResponses?.output?.length || 0) > 0)
    : []
}

export function createAPIHistoryMessage({ role, content, messageId = '', uiMessageIds = [], images = [], cacheObjects = null, ts = Date.now() }: { role: 'user' | 'assistant' | 'system'; content: string; messageId?: string; uiMessageIds?: string[]; images?: unknown; cacheObjects?: unknown; ts?: number }): APIHistoryMessage {
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

export function shouldUseAssistantFirstReplyForConversation(conversation: AIConversationSnapshot | null) {
  const rawUiMessages = conversation?.messages
  const rawApiMessages = conversation?.apiMessages
  const uiMessages = Array.isArray(rawUiMessages) ? rawUiMessages : []
  const apiMessages = Array.isArray(rawApiMessages) ? rawApiMessages : []
  const hasAssistantUIMessage = uiMessages.some((message) => message && typeof message === 'object' && message.kind === 'assistant')
  const hasAssistantAPIMessage = apiMessages.some((message) => message && typeof message === 'object' && message.role === 'assistant')
  return !hasAssistantUIMessage && !hasAssistantAPIMessage
}

export function buildAIFollowupAnswerPayload(answer: string | AIMessage) {
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

export function findLatestAIFollowupMessageByRequestId(messages: unknown, requestId: unknown) {
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

export function collectTurnUiMessageIds(messages: unknown, assistantMessageId: unknown) {
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

export function findApiAnchorIndexByUiMessageId(apiMessages: unknown, uiMessageId: unknown) {
  const targetId = typeof uiMessageId === 'string' ? uiMessageId.trim() : ''
  if (!targetId) {
    return -1
  }
  return Array.isArray(apiMessages)
    ? apiMessages.findIndex((message) => Array.isArray(message?.uiMessageIds) && message.uiMessageIds.includes(targetId))
    : -1
}

export function upsertAPIHistoryMessage(apiMessages: unknown, rawMessage: AIAPIHistoryMessageLike, currentMessages: unknown = []): APIHistoryMessage[] {
  const role = rawMessage?.role === 'assistant' ? 'assistant' : (rawMessage?.role === 'system' ? 'system' : 'user')
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

export function trimLatestAssistantAPIHistoryMessage(apiMessages: unknown) {
  const list = Array.isArray(apiMessages) ? [...apiMessages] : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === 'assistant') {
      list.splice(index, 1)
      break
    }
  }
  return list
}

export function buildMetrics(payload: AIMetricsPayload) {
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

export function buildReasoningDuration(payload: AIMetricsPayload) {
  if (typeof payload.firstTokenMs === 'number' && payload.firstTokenMs > 0) {
    return `${(payload.firstTokenMs / 1000).toFixed(1)}s`
  }
  if (typeof payload.elapsedMs === 'number' && payload.elapsedMs > 0) {
    return `${(payload.elapsedMs / 1000).toFixed(1)}s`
  }
  return ''
}

export function buildAIRequestModelMeta(provider: AIProviderLike | null | undefined) {
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

export function normalizeAICollaborationMode(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return nextValue === 'followup' || nextValue === 'completion' || nextValue === 'forced' ? nextValue : ''
}

export function normalizeAICollaborationDecision(value: unknown) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return ['continue', 'done', 'compression', 'retry', 'fallback_followup', 'fallback_completion'].includes(nextValue) ? nextValue : ''
}

export function parseAICollaborationStreamBuffer(value: unknown) {
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

export function buildAIConversationDisplayList(list: unknown): DisplayConversationItem[] {
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

export function insertMessageBeforeAssistant(messages: unknown, requestId: unknown, nextMessage: AIMessage): AIMessage[] {
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

export function upsertMessageBeforeAssistant(messages: unknown, requestId: unknown, nextMessage: AIMessage): AIMessage[] {
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

export function isAIBusinessTurnMessageKind(kind: unknown) {
  return Boolean(kind) && kind !== 'assistant' && kind !== 'reasoning' && kind !== 'user'
}

export function updateAILastAssistantTurnState(currentState: Pick<PanelState, 'lastAssistantTurnId'>, message: AIMessage, fallbackTurnId = ''): Partial<Pick<PanelState, 'lastAssistantTurnId' | 'lastTurnBusinessMessageKind'>> {
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

export function computeAILastAssistantTurnState(messages: unknown): { lastAssistantTurnId: string; lastTurnBusinessMessageKind: string } {
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
      : (typeof message?.id === 'string' ? message.id.trim() : '')
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

export const AI_CONVERSATION_DIFF_TOOL_NAMES = new Set(['apply_diff', 'write_to_file', 'search_replace', 'edit_file', 'apply_patch'])
export const AI_CONVERSATION_DIFF_SUCCESS_STATUSES = new Set(['已执行', AI_FOLLOWUP_COMPLETED_STATUS_KEY])
export const AI_WORKSPACE_TAB_CLOSE_QUIET_MS = 250

export function extractAIConversationDiffPrimaryPath(copyContent: unknown, fallbackSummary: unknown) {
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

export function normalizeAIConversationSearchQuery(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function extractAIConversationSearchText(message: AIMessage) {
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

export function buildAIConversationSearchSnippet(text: unknown, query: unknown) {
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

export function resolveAIEventSound(payload: AIEventPayloadShape, fallbackSound = '', allowPayloadOverride = true) { 
  if (allowPayloadOverride && payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'sound')) {
    return typeof payload.sound === 'string' ? payload.sound.trim() : ''
  }
  return typeof fallbackSound === 'string' ? fallbackSound.trim() : ''
}
