import { t } from '../../i18n.js'

function getAppBridge() {
  return window?.go?.main?.AIBindings || window?.go?.main?.App
}

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

export function normalizeAIConversationSummary(summary) {
  return {
    id: typeof summary?.id === 'string' ? summary.id.trim() : '',
    title: typeof summary?.title === 'string' && summary.title.trim() ? summary.title.trim() : t('新对话'),
    createdAt: typeof summary?.createdAt === 'number' ? summary.createdAt : Date.now(),
    updatedAt: typeof summary?.updatedAt === 'number' ? summary.updatedAt : Date.now(),
    status: typeof summary?.status === 'string' && summary.status.trim() ? summary.status.trim() : 'idle',
    toolProtocol: typeof summary?.toolProtocol === 'string' && summary.toolProtocol.trim() ? summary.toolProtocol.trim() : 'xml',
    messageCount: typeof summary?.messageCount === 'number' ? summary.messageCount : 0,
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
    question: typeof message?.question === 'string' ? message.question : '',
    suggestions: Array.isArray(message?.suggestions) ? message.suggestions.filter((item) => typeof item === 'string') : [],
    extra: message?.extra && typeof message.extra === 'object' ? message.extra : {},
  }
}

export function normalizeAIConversationAPIMessage(message) {
  return {
    role: typeof message?.role === 'string' ? message.role : 'user',
    content: typeof message?.content === 'string' ? message.content : '',
    messageId: typeof message?.messageId === 'string' ? message.messageId : '',
    uiMessageIds: Array.isArray(message?.uiMessageIds) ? message.uiMessageIds.filter((item) => typeof item === 'string') : [],
    images: Array.isArray(message?.images) ? message.images.filter((item) => typeof item === 'string' && item.trim()) : [],
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
    messages: Array.isArray(snapshot?.messages) ? snapshot.messages.map(normalizeAIConversationMessage) : [],
    apiMessages: Array.isArray(snapshot?.apiMessages) ? snapshot.apiMessages.map(normalizeAIConversationAPIMessage) : [],
    settings: normalizeAIConversationTaskSettings(snapshot?.settings),
  }
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
  const snapshot = await bridge.CreateAIConversation(title)
  return normalizeAIConversationSnapshot(snapshot)
}

export async function getAIConversation(conversationId) {
  const bridge = getAppBridge()
  if (!bridge?.GetAIConversation) {
    throw new Error(t('读取对话能力未就绪'))
  }
  const snapshot = await bridge.GetAIConversation(conversationId)
  return normalizeAIConversationSnapshot(snapshot)
}

export async function saveAIConversation(snapshot) {
  const bridge = getAppBridge()
  if (!bridge?.SaveAIConversation) {
    return normalizeAIConversationSnapshot(snapshot)
  }
  const saved = await bridge.SaveAIConversation(JSON.stringify(snapshot))
  return normalizeAIConversationSnapshot(saved)
}

export async function deleteAIConversation(conversationId) {
  const bridge = getAppBridge()
  if (!bridge?.DeleteAIConversation) {
    return
  }
  await bridge.DeleteAIConversation(conversationId)
}