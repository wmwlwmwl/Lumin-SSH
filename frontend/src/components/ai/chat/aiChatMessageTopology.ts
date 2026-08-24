// 桥接模块（自 .js 收编后类型化）：AI 对话消息分组与回合拓扑
/** 宽松消息形状（来自 Go 桥/事件 payload，字段按需读取） */
interface AIChatMessageLike {
  kind?: unknown;
  id?: unknown;
  turnId?: unknown;
  [key: string]: unknown;
}

/** 助手回合条目（assistant 消息 + 其子消息分组） */
interface AssistantTurnEntry {
  type: 'assistant-turn';
  id: unknown;
  turnId: string;
  assistant: AIChatMessageLike;
  reasoning: AIChatMessageLike[];
  tools: AIChatMessageLike[];
}

/** 分组后的对话条目 */
export type ConversationGroup =
  | { type: 'user'; id: unknown; message: AIChatMessageLike }
  | { type: 'context-condense'; id: unknown; message: AIChatMessageLike }
  | AssistantTurnEntry
  | { type: 'reasoning'; id: unknown; message: AIChatMessageLike }
  | { type: 'tool-session'; id: unknown; tools: AIChatMessageLike[] };

/** 分支锚点（getConversationBranchAnchor 输出） */
export interface ConversationBranchAnchor {
  message: AIChatMessageLike | null;
  messageIndex: number;
  cutIndex: number;
  turnId: string;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const ASSISTANT_TURN_CHILD_KINDS = new Set([
  'reasoning',
  'tool',
  'completion',
  'command',
  'mcp',
  'followup',
])

const TURN_ID_MARKERS = ['-tool-', '-command-', '-mcp-', '-followup-']

function isAssistantTurnChildMessage(message: AIChatMessageLike | null | undefined): boolean {
  return ASSISTANT_TURN_CHILD_KINDS.has(normalizeString(message?.kind))
}

function deriveAssistantTurnId(message: AIChatMessageLike | null | undefined): string {
  const kind = normalizeString(message?.kind)
  const explicitTurnId = normalizeString(message?.turnId)

  if (kind === 'assistant') {
    return explicitTurnId || normalizeString(message?.id)
  }

  if (!isAssistantTurnChildMessage(message)) {
    return ''
  }

  if (explicitTurnId) {
    return explicitTurnId
  }

  const messageId = normalizeString(message?.id)
  if (!messageId) {
    return ''
  }

  for (const marker of TURN_ID_MARKERS) {
    const index = messageId.indexOf(marker)
    if (index > 0) {
      return messageId.slice(0, index)
    }
  }

  if (messageId.endsWith('-reasoning')) {
    return messageId.slice(0, -'-reasoning'.length)
  }

  return ''
}

function createAssistantTurnEntry(message: AIChatMessageLike): AssistantTurnEntry {
  return {
    type: 'assistant-turn',
    id: message.id,
    turnId: deriveAssistantTurnId(message) || normalizeString(message?.id),
    assistant: message,
    reasoning: [],
    tools: [],
  }
}

function attachMessageToTurn(turnEntry: AssistantTurnEntry | null | undefined, message: AIChatMessageLike): void {
  if (!turnEntry || !message) {
    return
  }

  if (normalizeString(message.kind) === 'reasoning') {
    turnEntry.reasoning.push(message)
    return
  }

  turnEntry.tools.push(message)
}

export function groupConversationMessages(messages: unknown = []): ConversationGroup[] {
  const list = (Array.isArray(messages) ? messages : []) as AIChatMessageLike[]
  const grouped: ConversationGroup[] = []
  const turnMap = new Map<string, AssistantTurnEntry>()
  const pendingChildren = new Map<string, AIChatMessageLike[]>()

  for (const message of list) {
    if (!message || typeof message !== 'object') {
      continue
    }

    const kind = normalizeString(message.kind)

    if (kind === 'user') {
      grouped.push({ type: 'user', id: message.id, message })
      continue
    }

    if (kind === 'condense_context') {
      grouped.push({ type: 'context-condense', id: message.id, message })
      continue
    }

    if (kind === 'assistant') {
      const turnEntry = createAssistantTurnEntry(message)
      if (turnEntry.turnId) {
        turnMap.set(turnEntry.turnId, turnEntry)
        const queuedChildren = pendingChildren.get(turnEntry.turnId)
        if (Array.isArray(queuedChildren) && queuedChildren.length > 0) {
          queuedChildren.forEach((child) => attachMessageToTurn(turnEntry, child))
          pendingChildren.delete(turnEntry.turnId)
        }
      }
      grouped.push(turnEntry)
      continue
    }

    if (!isAssistantTurnChildMessage(message)) {
      continue
    }

    const turnId = deriveAssistantTurnId(message)
    if (turnId && turnMap.has(turnId)) {
      attachMessageToTurn(turnMap.get(turnId), message)
      continue
    }

    if (turnId) {
      const currentPending = pendingChildren.get(turnId) || []
      pendingChildren.set(turnId, [...currentPending, message])
      continue
    }

    if (kind === 'reasoning') {
      grouped.push({ type: 'reasoning', id: message.id, message })
    } else {
      grouped.push({ type: 'tool-session', id: message.id, tools: [message] })
    }
  }

  for (const [turnId, queuedChildren] of pendingChildren.entries()) {
    const fallbackReasoning = queuedChildren.filter((item) => normalizeString(item?.kind) === 'reasoning')
    const fallbackTools = queuedChildren.filter((item) => normalizeString(item?.kind) !== 'reasoning')

    if (fallbackReasoning.length > 0) {
      fallbackReasoning.forEach((item) => grouped.push({ type: 'reasoning', id: item.id, message: item }))
    }

    if (fallbackTools.length > 0) {
      grouped.push({ type: 'tool-session', id: `orphan-${turnId}`, tools: fallbackTools })
    }
  }

  return grouped
}

export function getConversationBranchAnchor(messages: unknown = [], messageId = ''): ConversationBranchAnchor {
  const list = (Array.isArray(messages) ? messages : []) as AIChatMessageLike[]
  const targetMessageId = normalizeString(messageId)
  if (!targetMessageId) {
    return {
      message: null,
      messageIndex: -1,
      cutIndex: -1,
      turnId: '',
    }
  }

  const messageIndex = list.findIndex((message) => normalizeString(message?.id) === targetMessageId)
  if (messageIndex < 0) {
    return {
      message: null,
      messageIndex: -1,
      cutIndex: -1,
      turnId: '',
    }
  }

  const message = list[messageIndex]
  const turnId = deriveAssistantTurnId(message)
  if (!turnId) {
    return {
      message,
      messageIndex,
      cutIndex: messageIndex,
      turnId: '',
    }
  }

  const turnStartIndex = list.findIndex((candidate) => deriveAssistantTurnId(candidate) === turnId)
  return {
    message,
    messageIndex,
    cutIndex: turnStartIndex >= 0 ? turnStartIndex : messageIndex,
    turnId,
  }
}
