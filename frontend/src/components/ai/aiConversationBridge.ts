// 桥接模块（自 .js 收编后类型化）：AI 对话快照/摘要/消息的归一化与持久化
import { t } from '../../i18n.ts'

function getAppBridge() {
  return window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.App
}

const AI_CONVERSATION_CHANGED_EVENT = 'lumin:ai-conversations-changed'

type AIExecuteApprovalMode = 'basic' | 'read_only' | 'all'

const _DEFAULT_TASK_SETTINGS = {
  currentProviderId: '',
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowReadOnlyOutsideWorkspace: false,
  alwaysAllowWrite: false,
  alwaysAllowWriteOutsideWorkspace: false,
  alwaysAllowWriteProtected: false,
  alwaysAllowExecute: false,
  executeApprovalMode: 'basic' as AIExecuteApprovalMode,
  alwaysAllowMcp: false,
  alwaysAllowModeSwitch: false,
  alwaysAllowSubtasks: false,
  alwaysAllowFollowupQuestions: false,
}

export type AIConversationSummary = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  status: string
  toolProtocol: string
  messageCount: number
  promptCacheBypassTimestamp: string
  parentConversationId: string
  rootConversationId: string
  relationType: string
  relationSource: string
  parentTitleSnapshot: string
  archived: boolean
  transient?: boolean
}

export type AIConversationTaskSettings = {
  currentProviderId: string
  autoApprovalEnabled: boolean
  alwaysAllowReadOnly: boolean
  alwaysAllowReadOnlyOutsideWorkspace: boolean
  alwaysAllowWrite: boolean
  alwaysAllowWriteOutsideWorkspace: boolean
  alwaysAllowWriteProtected: boolean
  alwaysAllowExecute: boolean
  executeApprovalMode: AIExecuteApprovalMode
  alwaysAllowMcp: boolean
  alwaysAllowModeSwitch: boolean
  alwaysAllowSubtasks: boolean
  alwaysAllowFollowupQuestions: boolean
  collaborationExtraPrompt: string
}

/** 追问选项 */
type AIFollowUpOption = {
  id: string
  answer: string
  mode: string
  disabled: boolean
  recommended: boolean
}

/** 追问问题 */
type AIFollowUpQuestion = {
  id: string
  text: string
  type: 'single' | 'multiple' | 'free_text'
  options: AIFollowUpOption[]
}

/** 归一化后的对话消息 */
type AIConversationMessage = {
  id: string
  turnId: string
  kind: string
  text: string
  time: string
  metrics: string[]
  streaming: boolean
  duration: string
  actionLabel: string
  title: string
  summary: string
  code: string
  status: string
  result: string
  remainingFileEdits: number
  purpose: string
  command: string
  output: string
  images: string[]
  serverName: string
  toolName: string
  args: string
  response: string
  requestId: string
  question: string
  questions: AIFollowUpQuestion[]
  suggestions: string[]
  extra: Record<string, unknown>
}

/** 供应商缓存对象（OpenAI Responses 兼容） */
type AIConversationCacheObject = {
  responseId: string
  output: unknown[]
  include: string[]
  store: boolean
  capturedAt: number
}

/** 供应商缓存对象组 */
type AIConversationProviderCacheObjects = {
  openaiResponses: AIConversationCacheObject
}

/** 归一化后的 API 消息 */
type AIConversationAPIMessage = {
  role: string
  content: string
  messageId: string
  uiMessageIds: string[]
  images: string[]
  cacheObjects: AIConversationProviderCacheObjects | null
  ts: number
}

/** 归一化后的对话快照 */
export type AIConversationSnapshot = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  status: string
  toolProtocol: string
  promptCacheBypassTimestamp: string
  parentConversationId: string
  rootConversationId: string
  relationType: string
  relationSource: string
  parentTitleSnapshot: string
  archived: boolean
  transient?: boolean
  messages: AIConversationMessage[]
  apiMessages: AIConversationAPIMessage[]
  settings: AIConversationTaskSettings
}

/** 消息搜索结果 */
export type AIConversationMessageSearchResult = {
  conversationId: string
  conversationTitle: string
  messageId: string
  role: 'user' | 'assistant'
  snippet: string
  updatedAt: number
}

/** Token 账本条目 */
export type AIConversationTokenLedgerEntry = {
  messageId: string
  rawTokens: number
}

/** Token 账本 */
export type AIConversationTokenLedger = {
  systemRawTokens: number
  entries: AIConversationTokenLedgerEntry[]
  contextTokens: number
}

function normalizeAIPromptCacheBypassTimestamp(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeAIFollowUpOption(option: unknown, index = 0, questionId = 'question-1'): AIFollowUpOption | null {
  const o = (option ?? {}) as Record<string, unknown>
  const answer = typeof o.answer === 'string' ? o.answer.trim() : ''
  if (!answer) {
    return null
  }
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `${questionId}-option-${index + 1}`
  return {
    id,
    answer,
    mode: typeof o.mode === 'string' && o.mode.trim() ? o.mode.trim() : '',
    disabled: o.disabled === true,
    recommended: o.recommended === true,
  }
}

function normalizeAIFollowUpQuestion(question: unknown, index = 0, fallbackQuestion = ''): AIFollowUpQuestion | null {
  const q = (question ?? {}) as Record<string, unknown>
  const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `question-${index + 1}`
  const text = typeof q.text === 'string' && q.text.trim()
    ? q.text.trim()
    : (index === 0 && typeof fallbackQuestion === 'string' && fallbackQuestion.trim()
      ? fallbackQuestion.trim()
      : `Question ${index + 1}`)
  const rawType = String(q.type || '').trim().toLowerCase()
  const type = rawType === 'multiple' || rawType === 'multi_select'
    ? 'multiple'
    : (rawType === 'free_text' || rawType === 'text'
      ? 'free_text'
      : 'single')
  const options = Array.isArray(q.options)
    ? q.options
      .map((item, optionIndex) => normalizeAIFollowUpOption(item, optionIndex, id))
      .filter((item): item is AIFollowUpOption => item !== null)
    : []
  if (type !== 'free_text' && options.length === 0) {
    return null
  }
  return {
    id,
    text,
    type,
    options,
  }
}

function normalizeAIConversationSummary(summary: unknown): AIConversationSummary {
  const s = (summary ?? {}) as Record<string, unknown>
  return {
    id: typeof s.id === 'string' ? s.id.trim() : '',
    title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : t('新对话'),
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
    status: typeof s.status === 'string' && s.status.trim() ? s.status.trim() : 'idle',
    toolProtocol: typeof s.toolProtocol === 'string' && s.toolProtocol.trim() ? s.toolProtocol.trim() : 'xml',
    messageCount: typeof s.messageCount === 'number' ? s.messageCount : 0,
    promptCacheBypassTimestamp: normalizeAIPromptCacheBypassTimestamp(s.promptCacheBypassTimestamp),
    parentConversationId: typeof s.parentConversationId === 'string' ? s.parentConversationId.trim() : '',
    rootConversationId: typeof s.rootConversationId === 'string' ? s.rootConversationId.trim() : '',
    relationType: typeof s.relationType === 'string' ? s.relationType.trim() : '',
    relationSource: typeof s.relationSource === 'string' ? s.relationSource.trim() : '',
    parentTitleSnapshot: typeof s.parentTitleSnapshot === 'string' ? s.parentTitleSnapshot.trim() : '',
    archived: s.archived === true,
    transient: s.transient === true,
  }
}

export function normalizeAIConversationTaskSettings(settings: unknown): AIConversationTaskSettings {
  const s = (settings ?? {}) as Record<string, unknown>
  const alwaysAllowReadOnly = Boolean(s.alwaysAllowReadOnly)
  const alwaysAllowWrite = Boolean(s.alwaysAllowWrite)
  const alwaysAllowExecute = Boolean(s.alwaysAllowExecute)
  const rawExecuteApprovalMode = typeof s.executeApprovalMode === 'string' ? s.executeApprovalMode.trim() : ''
  const executeApprovalMode: AIExecuteApprovalMode = rawExecuteApprovalMode === 'read_only'
    ? 'read_only'
    : (rawExecuteApprovalMode === 'all'
      ? 'all'
      : 'basic')

  return {
    currentProviderId: typeof s.currentProviderId === 'string' ? s.currentProviderId.trim() : '',
    autoApprovalEnabled: alwaysAllowReadOnly || alwaysAllowWrite || alwaysAllowExecute,
    alwaysAllowReadOnly,
    alwaysAllowReadOnlyOutsideWorkspace: Boolean(s.alwaysAllowReadOnlyOutsideWorkspace),
    alwaysAllowWrite,
    alwaysAllowWriteOutsideWorkspace: Boolean(s.alwaysAllowWriteOutsideWorkspace),
    alwaysAllowWriteProtected: Boolean(s.alwaysAllowWriteProtected),
    alwaysAllowExecute,
    executeApprovalMode,
    alwaysAllowMcp: Boolean(s.alwaysAllowMcp),
    alwaysAllowModeSwitch: Boolean(s.alwaysAllowModeSwitch),
    alwaysAllowSubtasks: Boolean(s.alwaysAllowSubtasks),
    alwaysAllowFollowupQuestions: Boolean(s.alwaysAllowFollowupQuestions),
    collaborationExtraPrompt: typeof s.collaborationExtraPrompt === 'string' ? s.collaborationExtraPrompt.replace(/\r\n/g, '\n').trim() : '',
  }
}

function normalizeAIConversationMessage(message: unknown): AIConversationMessage {
  const m = (message ?? {}) as Record<string, unknown>
  const question = typeof m.question === 'string' ? m.question : ''
  const questions = Array.isArray(m.questions)
    ? m.questions
      .map((item, questionIndex) => normalizeAIFollowUpQuestion(item, questionIndex, question))
      .filter((item): item is AIFollowUpQuestion => item !== null)
    : []
  return {
    id: typeof m.id === 'string' ? m.id : '',
    turnId: typeof m.turnId === 'string' ? m.turnId : '',
    kind: typeof m.kind === 'string' ? m.kind : 'assistant',
    text: typeof m.text === 'string' ? m.text : '',
    time: typeof m.time === 'string' ? m.time : '',
    metrics: Array.isArray(m.metrics) ? m.metrics.filter((item) => typeof item === 'string') : [],
    streaming: Boolean(m.streaming),
    duration: typeof m.duration === 'string' ? m.duration : '',
    actionLabel: typeof m.actionLabel === 'string' ? m.actionLabel : '',
    title: typeof m.title === 'string' ? m.title : '',
    summary: typeof m.summary === 'string' ? m.summary : '',
    code: typeof m.code === 'string' ? m.code : '',
    status: typeof m.status === 'string' ? m.status : '',
    result: typeof m.result === 'string' ? m.result : '',
    remainingFileEdits: typeof m.remainingFileEdits === 'number' ? m.remainingFileEdits : 0,
    purpose: typeof m.purpose === 'string' ? m.purpose : '',
    command: typeof m.command === 'string' ? m.command : '',
    output: typeof m.output === 'string' ? m.output : '',
    images: Array.isArray(m.images) ? m.images.filter((item) => typeof item === 'string' && item.trim()) : [],
    serverName: typeof m.serverName === 'string' ? m.serverName : '',
    toolName: typeof m.toolName === 'string' ? m.toolName : '',
    args: typeof m.args === 'string' ? m.args : '',
    response: typeof m.response === 'string' ? m.response : '',
    requestId: typeof m.requestId === 'string' ? m.requestId : '',
    question,
    questions,
    suggestions: Array.isArray(m.suggestions) ? m.suggestions.filter((item) => typeof item === 'string') : [],
    extra: m.extra && typeof m.extra === 'object' ? m.extra as Record<string, unknown> : {},
  }
}

function normalizeAIConversationOpenAIResponsesCacheObject(cacheObject: unknown): AIConversationCacheObject | null {
  if (!cacheObject || typeof cacheObject !== 'object') {
    return null
  }
  const c = cacheObject as Record<string, unknown>
  const responseId = typeof c.responseId === 'string' ? c.responseId.trim() : ''
  const output = Array.isArray(c.output)
    ? c.output.filter((item) => item && typeof item === 'object').map((item) => JSON.parse(JSON.stringify(item)))
    : []
  const include = Array.isArray(c.include)
    ? c.include.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
  const store = c.store === true
  const capturedAt = typeof c.capturedAt === 'number' ? c.capturedAt : 0
  if (!responseId && output.length === 0 && include.length === 0 && !store && capturedAt === 0) {
    return null
  }
  return {
    responseId,
    output,
    include,
    store,
    capturedAt,
  }
}

function normalizeAIConversationProviderCacheObjects(cacheObjects: unknown): AIConversationProviderCacheObjects | null {
  if (!cacheObjects || typeof cacheObjects !== 'object') {
    return null
  }
  const c = cacheObjects as Record<string, unknown>
  const openaiResponses = normalizeAIConversationOpenAIResponsesCacheObject(c.openaiResponses)
  if (!openaiResponses) {
    return null
  }
  return {
    openaiResponses,
  }
}

function normalizeAIConversationAPIMessage(message: unknown): AIConversationAPIMessage {
  const m = (message ?? {}) as Record<string, unknown>
  return {
    role: typeof m.role === 'string' ? m.role : 'user',
    content: typeof m.content === 'string' ? m.content : '',
    messageId: typeof m.messageId === 'string' ? m.messageId : '',
    uiMessageIds: Array.isArray(m.uiMessageIds) ? m.uiMessageIds.filter((item) => typeof item === 'string') : [],
    images: Array.isArray(m.images) ? m.images.filter((item) => typeof item === 'string' && item.trim()) : [],
    cacheObjects: normalizeAIConversationProviderCacheObjects(m.cacheObjects),
    ts: typeof m.ts === 'number' ? m.ts : Date.now(),
  }
}

export function normalizeAIConversationSnapshot(snapshot: unknown): AIConversationSnapshot {
  const s = (snapshot ?? {}) as Record<string, unknown>
  return {
    id: typeof s.id === 'string' ? s.id.trim() : '',
    title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : t('新对话'),
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
    status: typeof s.status === 'string' && s.status.trim() ? s.status.trim() : 'idle',
    toolProtocol: typeof s.toolProtocol === 'string' && s.toolProtocol.trim() ? s.toolProtocol.trim() : 'xml',
    promptCacheBypassTimestamp: normalizeAIPromptCacheBypassTimestamp(s.promptCacheBypassTimestamp),
    parentConversationId: typeof s.parentConversationId === 'string' ? s.parentConversationId.trim() : '',
    rootConversationId: typeof s.rootConversationId === 'string' ? s.rootConversationId.trim() : '',
    relationType: typeof s.relationType === 'string' ? s.relationType.trim() : '',
    relationSource: typeof s.relationSource === 'string' ? s.relationSource.trim() : '',
    parentTitleSnapshot: typeof s.parentTitleSnapshot === 'string' ? s.parentTitleSnapshot.trim() : '',
    archived: s.archived === true,
    transient: s.transient === true,
    messages: Array.isArray(s.messages) ? s.messages.map(normalizeAIConversationMessage) : [],
    apiMessages: Array.isArray(s.apiMessages) ? s.apiMessages.map(normalizeAIConversationAPIMessage) : [],
    settings: normalizeAIConversationTaskSettings(s.settings),
  }
}

export function normalizeAIConversationMessageSearchResult(result: unknown): AIConversationMessageSearchResult {
  const r = (result ?? {}) as Record<string, unknown>
  return {
    conversationId: typeof r.conversationId === 'string' ? r.conversationId.trim() : '',
    conversationTitle: typeof r.conversationTitle === 'string' && r.conversationTitle.trim() ? r.conversationTitle.trim() : t('新对话'),
    messageId: typeof r.messageId === 'string' ? r.messageId.trim() : '',
    role: r.role === 'user' ? 'user' : 'assistant',
    snippet: typeof r.snippet === 'string' ? r.snippet : '',
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
}

function buildAIConversationSummary(snapshot: AIConversationSnapshot): AIConversationSummary {
  const s = snapshot as AIConversationSnapshot & { messageCount?: number }
  return normalizeAIConversationSummary({
    ...s,
    messageCount: Array.isArray(s?.messages) ? s.messages.length : s?.messageCount,
  })
}

export function publishAIConversationUpsert(snapshot: AIConversationSnapshot): void {
  if (typeof window === 'undefined') {
    return
  }
  const summary = buildAIConversationSummary(snapshot)
  if (!summary.id) {
    return
  }
  window.dispatchEvent(new CustomEvent(AI_CONVERSATION_CHANGED_EVENT, {
    detail: { type: 'upsert', summary },
  }))
}

function publishAIConversationDelete(conversationId: unknown): void {
  if (typeof window === 'undefined') {
    return
  }
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!id) {
    return
  }
  window.dispatchEvent(new CustomEvent(AI_CONVERSATION_CHANGED_EVENT, {
    detail: { type: 'delete', conversationId: id },
  }))
}

export function subscribeAIConversationChanges(callback: (detail: unknown) => void): () => void {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return () => {}
  }
  const handler = (event: Event) => callback((event as CustomEvent)?.detail)
  window.addEventListener(AI_CONVERSATION_CHANGED_EVENT, handler)
  return () => window.removeEventListener(AI_CONVERSATION_CHANGED_EVENT, handler)
}

export async function listAIConversations(): Promise<AIConversationSummary[]> {
  const bridge = getAppBridge()
  if (!bridge?.ListAIConversations) {
    return []
  }
  const result = await bridge.ListAIConversations()
  return Array.isArray(result) ? result.map(normalizeAIConversationSummary) : []
}

export async function listTemporaryAIConversations(): Promise<AIConversationSummary[]> {
  const bridge = getAppBridge()
  if (!bridge?.ListTemporaryAIConversations) return []
  const result = await bridge.ListTemporaryAIConversations()
  return Array.isArray(result) ? result.map(normalizeAIConversationSummary) : []
}

export async function getTemporaryAIConversation(conversationId: string): Promise<AIConversationSnapshot> {
  const bridge = getAppBridge()
  if (!bridge?.GetTemporaryAIConversation) throw new Error(t('读取对话能力未就绪'))
  return normalizeAIConversationSnapshot(await bridge.GetTemporaryAIConversation(conversationId))
}

export async function saveTemporaryAIConversation(snapshot: unknown): Promise<AIConversationSnapshot> {
  const bridge = getAppBridge()
  const outgoing = { ...normalizeAIConversationSnapshot(snapshot), transient: true }
  if (!bridge?.SaveTemporaryAIConversation) return outgoing
  return normalizeAIConversationSnapshot(await bridge.SaveTemporaryAIConversation(JSON.stringify(outgoing)))
}

export async function deleteTemporaryAIConversation(conversationId: string): Promise<void> {
  const bridge = getAppBridge()
  if (bridge?.DeleteTemporaryAIConversation) await bridge.DeleteTemporaryAIConversation(conversationId)
}

export async function createAIConversation(title: unknown): Promise<AIConversationSnapshot> {
  const bridge = getAppBridge()
  if (!bridge?.CreateAIConversation) {
    throw new Error(t('创建对话能力未就绪'))
  }
  const snapshot = normalizeAIConversationSnapshot(await bridge.CreateAIConversation(typeof title === 'string' ? title : ''))
  publishAIConversationUpsert(snapshot)
  return snapshot
}

export async function getAIAssistantFirstReply(language = ''): Promise<string> {
  const bridge = getAppBridge()
  if (!bridge?.GetAIAssistantFirstReply) {
    return ''
  }
  const result = await bridge.GetAIAssistantFirstReply(typeof language === 'string' ? language : '')
  return typeof result === 'string' ? result : ''
}

export async function getAIConversation(conversationId: string): Promise<AIConversationSnapshot> {
  const bridge = getAppBridge()
  if (!bridge?.GetAIConversation) {
    throw new Error(t('读取对话能力未就绪'))
  }
  const snapshot = await bridge.GetAIConversation(conversationId)
  return normalizeAIConversationSnapshot(snapshot)
}

export async function searchAIConversationMessages(query: unknown, conversationId = '', limit = 20): Promise<AIConversationMessageSearchResult[]> {
  const bridge = getAppBridge()
  if (!bridge?.SearchAIConversationMessages) {
    return []
  }
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Math.trunc(Number(limit)))) : 20
  const result = await bridge.SearchAIConversationMessages(
    typeof query === 'string' ? query : '',
    typeof conversationId === 'string' ? conversationId : '',
    normalizedLimit,
  )
  return Array.isArray(result) ? result.map(normalizeAIConversationMessageSearchResult) : []
}

export async function saveAIConversation(snapshot: unknown): Promise<AIConversationSnapshot> {
  const bridge = getAppBridge()
  if (!bridge?.SaveAIConversation) {
    return normalizeAIConversationSnapshot(snapshot)
  }
  const outgoingSnapshot = normalizeAIConversationSnapshot(snapshot)
  const saved = normalizeAIConversationSnapshot(await bridge.SaveAIConversation(JSON.stringify(outgoingSnapshot)))
  publishAIConversationUpsert(saved)
  return saved
}

export async function deleteAIConversation(conversationId: unknown): Promise<void> {
  const bridge = getAppBridge()
  if (!bridge?.DeleteAIConversation) {
    return
  }
  await bridge.DeleteAIConversation(typeof conversationId === 'string' ? conversationId : '')
  publishAIConversationDelete(conversationId)
}

/** 上下文压缩结果（含快照的透传对象） */
export type AIConversationContextCondenseResult = {
  snapshot: AIConversationSnapshot
  [key: string]: unknown
}

export async function condenseAIConversationContext(conversationId: string, sessionId: string): Promise<AIConversationSnapshot | AIConversationContextCondenseResult> {
  const bridge = getAppBridge()
  if (!bridge?.CondenseAIConversationContext) {
    throw new Error(t('上下文压缩能力未就绪'))
  }
  const result = await bridge.CondenseAIConversationContext(conversationId, sessionId)
  const resultRecord = result as unknown as Record<string, unknown> | null
  const snapshot = normalizeAIConversationSnapshot(resultRecord?.snapshot || result)
  publishAIConversationUpsert(snapshot)
  return resultRecord?.snapshot ? { ...resultRecord, snapshot } : snapshot
}



/** 摘要子任务结果 */
export interface AIConversationSummarySubtaskResult {
  snapshot: AIConversationSnapshot
  continueText: string
}

export async function createAIConversationSummarySubtask(conversationId: string, sessionId: string, requestId = ''): Promise<AIConversationSummarySubtaskResult> {
  const bridge = getAppBridge()
  if (!bridge?.CreateAIConversationSummarySubtask) {
    throw new Error(t('摘要创建子任务能力未就绪'))
  }
  const result = await bridge.CreateAIConversationSummarySubtask(
    conversationId,
    sessionId,
    typeof requestId === 'string' ? requestId : '',
  )
  const resultRecord = result as unknown as Record<string, unknown>
  const snapshot = normalizeAIConversationSnapshot(resultRecord.snapshot || result)
  publishAIConversationUpsert(snapshot)
  return {
    snapshot,
    continueText: typeof resultRecord.continueText === 'string' ? resultRecord.continueText : '',
  }
}

export async function openAIConversationFolder(conversationId: string): Promise<void> {
  const bridge = getAppBridge()
  if (!bridge?.OpenAIConversationFolder) {
    throw new Error(t('打开任务所在文件夹能力未就绪'))
  }
  await bridge.OpenAIConversationFolder(conversationId)
}

export async function preprocessAIConversationLongText(conversationId: string, text: unknown): Promise<unknown> {
  const bridge = getAppBridge()
  if (!bridge?.PreprocessAIConversationLongText) {
    return typeof text === 'string' ? text : ''
  }
  return bridge.PreprocessAIConversationLongText(conversationId, typeof text === 'string' ? text : '')
}

export async function readAIConversationWrappedFile(conversationId: string, localPath: string): Promise<unknown> {
  const bridge = getAppBridge()
  if (!bridge?.ReadAIConversationWrappedFile) {
    throw new Error(t('读取长文本包装文件能力未就绪'))
  }
  return bridge.ReadAIConversationWrappedFile(conversationId, localPath)
}

function normalizeAITokenLedgerEntry(entry: unknown): AIConversationTokenLedgerEntry {
  const e = (entry ?? {}) as Record<string, unknown>
  const messageId = typeof e.messageId === 'string' ? e.messageId.trim() : ''
  const rawTokens = Number(e.rawTokens)
  return {
    messageId,
    rawTokens: Number.isFinite(rawTokens) && rawTokens > 0 ? Math.trunc(rawTokens) : 0,
  }
}

export async function buildAIConversationTokenLedger(sessionId: unknown, snapshot: unknown): Promise<AIConversationTokenLedger | null> {
  const bridge = getAppBridge()
  if (!bridge?.BuildAIConversationTokenLedger) {
    return null
  }
  const outgoingSnapshot = normalizeAIConversationSnapshot(snapshot)
  const ledger = await bridge.BuildAIConversationTokenLedger(
    typeof sessionId === 'string' ? sessionId : '',
    JSON.stringify(outgoingSnapshot),
  )
  if (!ledger || typeof ledger !== 'object') {
    return null
  }
  const ledgerRecord = ledger as unknown as Record<string, unknown>
  const systemRawTokens = Number(ledgerRecord.systemRawTokens)
  const contextTokens = Number(ledgerRecord.contextTokens)
  return {
    systemRawTokens: Number.isFinite(systemRawTokens) && systemRawTokens > 0 ? Math.trunc(systemRawTokens) : 0,
    entries: Array.isArray(ledgerRecord.entries) ? ledgerRecord.entries.map(normalizeAITokenLedgerEntry) : [],
    contextTokens: Number.isFinite(contextTokens) && contextTokens > 0 ? Math.trunc(contextTokens) : 0,
  }
}

export async function countAIConversationAPIMessageRawTokens(sessionId: unknown, conversationId: unknown, apiMessages: unknown): Promise<AIConversationTokenLedgerEntry[]> {
  const bridge = getAppBridge()
  if (!bridge?.CountAIConversationAPIMessageRawTokens) {
    return []
  }
  const outgoingMessages = Array.isArray(apiMessages) ? apiMessages.map(normalizeAIConversationAPIMessage) : []
  const entries = await bridge.CountAIConversationAPIMessageRawTokens(
    typeof sessionId === 'string' ? sessionId : '',
    typeof conversationId === 'string' ? conversationId : '',
    JSON.stringify(outgoingMessages),
  )
  return Array.isArray(entries) ? entries.map(normalizeAITokenLedgerEntry) : []
}
