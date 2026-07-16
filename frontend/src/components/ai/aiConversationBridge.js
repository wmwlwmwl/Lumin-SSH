import { t } from '../../i18n.js'

function getAppBridge() {
  return window?.go?.main?.AIBindings || window?.go?.main?.App
}

const AI_CONVERSATION_CHANGED_EVENT = 'lumin:ai-conversations-changed'

const DEFAULT_TASK_SETTINGS = {
  currentProviderId: '',
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowReadOnlyOutsideWorkspace: false,
  alwaysAllowWrite: false,
  alwaysAllowWriteOutsideWorkspace: false,
  alwaysAllowWriteProtected: false,
  alwaysAllowExecute: false,
  alwaysAllowExecuteReadOnly: false,
  alwaysAllowExecuteAllCommands: false,
  alwaysAllowMcp: false,
  alwaysAllowModeSwitch: false,
  alwaysAllowSubtasks: false,
  alwaysAllowFollowupQuestions: false,
}

function normalizeAIPromptCacheBypassTimestamp(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeAIFollowUpOption(option, index = 0, questionId = 'question-1') {
  const answer = typeof option?.answer === 'string' ? option.answer.trim() : ''
  if (!answer) {
    return null
  }
  const id = typeof option?.id === 'string' && option.id.trim() ? option.id.trim() : `${questionId}-option-${index + 1}`
  return {
    id,
    answer,
    mode: typeof option?.mode === 'string' && option.mode.trim() ? option.mode.trim() : '',
    disabled: option?.disabled === true,
    recommended: option?.recommended === true,
  }
}

function normalizeAIFollowUpQuestion(question, index = 0, fallbackQuestion = '') {
  const id = typeof question?.id === 'string' && question.id.trim() ? question.id.trim() : `question-${index + 1}`
  const text = typeof question?.text === 'string' && question.text.trim()
    ? question.text.trim()
    : index === 0 && typeof fallbackQuestion === 'string' && fallbackQuestion.trim()
      ? fallbackQuestion.trim()
      : `Question ${index + 1}`
  const type = String(question?.type || '').trim().toLowerCase() === 'multiple' ? 'multiple' : 'single'
  const options = Array.isArray(question?.options)
    ? question.options
      .map((item, optionIndex) => normalizeAIFollowUpOption(item, optionIndex, id))
      .filter(Boolean)
    : []
  if (options.length === 0) {
    return null
  }
  return {
    id,
    text,
    type,
    options,
  }
}

export function normalizeAIConversationSummary(summary) {
  return {
    id: typeof summary?.id === 'string' ? summary.id.trim() : '',
    title: typeof summary?.title === 'string' && summary.title.trim() ? summary.title.trim() : t('新对话'),
    createdAt: typeof summary?.createdAt === 'number' ? summary.createdAt : Date.now(),
    updatedAt: typeof summary?.updatedAt === 'number' ? summary.updatedAt : Date.now(),
    status: typeof summary?.status === 'string' && summary.status.trim() ? summary.status.trim() : 'idle',
    toolProtocol: typeof summary?.toolProtocol === 'string' && summary.toolProtocol.trim() ? summary.toolProtocol.trim() : 'xml',
    messageCount: typeof summary?.messageCount === 'number' ? summary.messageCount : 0,
    promptCacheBypassTimestamp: normalizeAIPromptCacheBypassTimestamp(summary?.promptCacheBypassTimestamp),
  }
}

export function normalizeAIConversationTaskSettings(settings) {
  const alwaysAllowReadOnly = Boolean(settings?.alwaysAllowReadOnly)
  const alwaysAllowWrite = Boolean(settings?.alwaysAllowWrite)
  const alwaysAllowExecute = Boolean(settings?.alwaysAllowExecute)
  const alwaysAllowExecuteReadOnly = Boolean(settings?.alwaysAllowExecuteReadOnly)

  return {
    currentProviderId: typeof settings?.currentProviderId === 'string' ? settings.currentProviderId.trim() : '',
    autoApprovalEnabled: alwaysAllowReadOnly || alwaysAllowWrite || alwaysAllowExecute || alwaysAllowExecuteReadOnly,
    alwaysAllowReadOnly,
    alwaysAllowReadOnlyOutsideWorkspace: Boolean(settings?.alwaysAllowReadOnlyOutsideWorkspace),
    alwaysAllowWrite,
    alwaysAllowWriteOutsideWorkspace: Boolean(settings?.alwaysAllowWriteOutsideWorkspace),
    alwaysAllowWriteProtected: Boolean(settings?.alwaysAllowWriteProtected),
    alwaysAllowExecute,
    alwaysAllowExecuteReadOnly,
    alwaysAllowExecuteAllCommands: false,
    alwaysAllowMcp: Boolean(settings?.alwaysAllowMcp),
    alwaysAllowModeSwitch: Boolean(settings?.alwaysAllowModeSwitch),
    alwaysAllowSubtasks: Boolean(settings?.alwaysAllowSubtasks),
    alwaysAllowFollowupQuestions: Boolean(settings?.alwaysAllowFollowupQuestions),
  }
}

export function normalizeAIConversationMessage(message) {
  const question = typeof message?.question === 'string' ? message.question : ''
  const questions = Array.isArray(message?.questions)
    ? message.questions
      .map((item, questionIndex) => normalizeAIFollowUpQuestion(item, questionIndex, question))
      .filter(Boolean)
    : []
  return {
    id: typeof message?.id === 'string' ? message.id : '',
    turnId: typeof message?.turnId === 'string' ? message.turnId : '',
    kind: typeof message?.kind === 'string' ? message.kind : 'assistant',
    text: typeof message?.text === 'string' ? message.text : '',
    time: typeof message?.time === 'string' ? message.time : '',
    metrics: Array.isArray(message?.metrics) ? message.metrics.filter((item) => typeof item === 'string') : [],
    streaming: Boolean(message?.streaming),
    duration: typeof message?.duration === 'string' ? message.duration : '',
    actionLabel: typeof message?.actionLabel === 'string' ? message.actionLabel : '',
    title: typeof message?.title === 'string' ? message.title : '',
    summary: typeof message?.summary === 'string' ? message.summary : '',
    code: typeof message?.code === 'string' ? message.code : '',
    status: typeof message?.status === 'string' ? message.status : '',
    result: typeof message?.result === 'string' ? message.result : '',
    remainingFileEdits: typeof message?.remainingFileEdits === 'number' ? message.remainingFileEdits : 0,
    purpose: typeof message?.purpose === 'string' ? message.purpose : '',
    command: typeof message?.command === 'string' ? message.command : '',
    output: typeof message?.output === 'string' ? message.output : '',
    images: Array.isArray(message?.images) ? message.images.filter((item) => typeof item === 'string' && item.trim()) : [],
    serverName: typeof message?.serverName === 'string' ? message.serverName : '',
    toolName: typeof message?.toolName === 'string' ? message.toolName : '',
    args: typeof message?.args === 'string' ? message.args : '',
    response: typeof message?.response === 'string' ? message.response : '',
    requestId: typeof message?.requestId === 'string' ? message.requestId : '',
    question,
    questions,
    suggestions: Array.isArray(message?.suggestions) ? message.suggestions.filter((item) => typeof item === 'string') : [],
    extra: message?.extra && typeof message.extra === 'object' ? message.extra : {},
  }
}

function normalizeAIConversationOpenAIResponsesCacheObject(cacheObject) {
  if (!cacheObject || typeof cacheObject !== 'object') {
    return null
  }
  const responseId = typeof cacheObject?.responseId === 'string' ? cacheObject.responseId.trim() : ''
  const output = Array.isArray(cacheObject?.output)
    ? cacheObject.output.filter((item) => item && typeof item === 'object').map((item) => JSON.parse(JSON.stringify(item)))
    : []
  const include = Array.isArray(cacheObject?.include)
    ? cacheObject.include.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
  const store = cacheObject?.store === true
  const capturedAt = typeof cacheObject?.capturedAt === 'number' ? cacheObject.capturedAt : 0
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

function normalizeAIConversationProviderCacheObjects(cacheObjects) {
  if (!cacheObjects || typeof cacheObjects !== 'object') {
    return null
  }
  const openaiResponses = normalizeAIConversationOpenAIResponsesCacheObject(cacheObjects?.openaiResponses)
  if (!openaiResponses) {
    return null
  }
  return {
    openaiResponses,
  }
}

export function normalizeAIConversationAPIMessage(message) {
  return {
    role: typeof message?.role === 'string' ? message.role : 'user',
    content: typeof message?.content === 'string' ? message.content : '',
    messageId: typeof message?.messageId === 'string' ? message.messageId : '',
    uiMessageIds: Array.isArray(message?.uiMessageIds) ? message.uiMessageIds.filter((item) => typeof item === 'string') : [],
    images: Array.isArray(message?.images) ? message.images.filter((item) => typeof item === 'string' && item.trim()) : [],
    cacheObjects: normalizeAIConversationProviderCacheObjects(message?.cacheObjects),
    ts: typeof message?.ts === 'number' ? message.ts : Date.now(),
  }
}

export function normalizeAIConversationSnapshot(snapshot) {
  return {
    id: typeof snapshot?.id === 'string' ? snapshot.id.trim() : '',
    title: typeof snapshot?.title === 'string' && snapshot.title.trim() ? snapshot.title.trim() : t('新对话'),
    createdAt: typeof snapshot?.createdAt === 'number' ? snapshot.createdAt : Date.now(),
    updatedAt: typeof snapshot?.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
    status: typeof snapshot?.status === 'string' && snapshot.status.trim() ? snapshot.status.trim() : 'idle',
    toolProtocol: typeof snapshot?.toolProtocol === 'string' && snapshot.toolProtocol.trim() ? snapshot.toolProtocol.trim() : 'xml',
    promptCacheBypassTimestamp: normalizeAIPromptCacheBypassTimestamp(snapshot?.promptCacheBypassTimestamp),
    messages: Array.isArray(snapshot?.messages) ? snapshot.messages.map(normalizeAIConversationMessage) : [],
    apiMessages: Array.isArray(snapshot?.apiMessages) ? snapshot.apiMessages.map(normalizeAIConversationAPIMessage) : [],
    settings: normalizeAIConversationTaskSettings(snapshot?.settings),
  }
}

export function normalizeAIConversationMessageSearchResult(result) {
  return {
    conversationId: typeof result?.conversationId === 'string' ? result.conversationId.trim() : '',
    conversationTitle: typeof result?.conversationTitle === 'string' && result.conversationTitle.trim() ? result.conversationTitle.trim() : t('新对话'),
    messageId: typeof result?.messageId === 'string' ? result.messageId.trim() : '',
    role: result?.role === 'user' ? 'user' : 'assistant',
    snippet: typeof result?.snippet === 'string' ? result.snippet : '',
    updatedAt: typeof result?.updatedAt === 'number' ? result.updatedAt : 0,
  }
}

function buildAIConversationSummary(snapshot) {
  return normalizeAIConversationSummary({
    ...snapshot,
    messageCount: Array.isArray(snapshot?.messages) ? snapshot.messages.length : snapshot?.messageCount,
  })
}

export function publishAIConversationUpsert(snapshot) {
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

function publishAIConversationDelete(conversationId) {
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

export function subscribeAIConversationChanges(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return () => {}
  }
  const handler = (event) => callback(event?.detail)
  window.addEventListener(AI_CONVERSATION_CHANGED_EVENT, handler)
  return () => window.removeEventListener(AI_CONVERSATION_CHANGED_EVENT, handler)
}

export async function listAIConversations() {
  const bridge = getAppBridge()
  if (!bridge?.ListAIConversations) {
    return []
  }
  const result = await bridge.ListAIConversations()
  return Array.isArray(result) ? result.map(normalizeAIConversationSummary) : []
}

export async function createAIConversation(title) {
  const bridge = getAppBridge()
  if (!bridge?.CreateAIConversation) {
    throw new Error(t('创建对话能力未就绪'))
  }
  const snapshot = normalizeAIConversationSnapshot(await bridge.CreateAIConversation(title))
  publishAIConversationUpsert(snapshot)
  return snapshot
}

export async function getAIConversation(conversationId) {
  const bridge = getAppBridge()
  if (!bridge?.GetAIConversation) {
    throw new Error(t('读取对话能力未就绪'))
  }
  const snapshot = await bridge.GetAIConversation(conversationId)
  return normalizeAIConversationSnapshot(snapshot)
}

export async function searchAIConversationMessages(query, conversationId = '', limit = 20) {
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

export async function saveAIConversation(snapshot) {
  const bridge = getAppBridge()
  if (!bridge?.SaveAIConversation) {
    return normalizeAIConversationSnapshot(snapshot)
  }
  const outgoingSnapshot = normalizeAIConversationSnapshot(snapshot)
  const saved = normalizeAIConversationSnapshot(await bridge.SaveAIConversation(JSON.stringify(outgoingSnapshot)))
  publishAIConversationUpsert(saved)
  return saved
}

export async function deleteAIConversation(conversationId) {
  const bridge = getAppBridge()
  if (!bridge?.DeleteAIConversation) {
    return
  }
  await bridge.DeleteAIConversation(conversationId)
  publishAIConversationDelete(conversationId)
}

export async function condenseAIConversationContext(conversationId, sessionId) {
  const bridge = getAppBridge()
  if (!bridge?.CondenseAIConversationContext) {
    throw new Error(t('上下文压缩能力未就绪'))
  }
  const result = await bridge.CondenseAIConversationContext(conversationId, sessionId)
  const snapshot = normalizeAIConversationSnapshot(result?.snapshot || result)
  publishAIConversationUpsert(snapshot)
  return result?.snapshot ? { ...result, snapshot } : snapshot
}

export async function openAIConversationFolder(conversationId) {
  const bridge = getAppBridge()
  if (!bridge?.OpenAIConversationFolder) {
    throw new Error(t('打开任务所在文件夹能力未就绪'))
  }
  await bridge.OpenAIConversationFolder(conversationId)
}

export async function preprocessAIConversationLongText(conversationId, text) {
  const bridge = getAppBridge()
  if (!bridge?.PreprocessAIConversationLongText) {
    return typeof text === 'string' ? text : ''
  }
  return bridge.PreprocessAIConversationLongText(conversationId, typeof text === 'string' ? text : '')
}

export async function readAIConversationWrappedFile(conversationId, localPath) {
  const bridge = getAppBridge()
  if (!bridge?.ReadAIConversationWrappedFile) {
    throw new Error(t('读取长文本包装文件能力未就绪'))
  }
  return bridge.ReadAIConversationWrappedFile(conversationId, localPath)
}