// 会话摘要的归一化与排序（从 AIPanel.tsx 抽出的纯函数）。

export interface ConversationSummary {
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
  transient?: boolean
  messages?: unknown[]
}

/** 与 Go 侧 normalizeAIConversationSnapshot 对齐的宽松快照形状 */
export interface AISnapshotLike {
  id: string
  title?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  status?: unknown
  toolProtocol?: unknown
  messageCount?: unknown
  messages?: unknown[]
  promptCacheBypassTimestamp?: unknown
  parentConversationId?: unknown
  rootConversationId?: unknown
  relationType?: unknown
  relationSource?: unknown
  parentTitleSnapshot?: unknown
  archived?: unknown
  transient?: unknown
}

export function upsertConversationSummary(list: unknown, snapshot: AISnapshotLike): ConversationSummary[] {
  const nextSummary = {
    id: snapshot.id,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    status: snapshot.status,
    toolProtocol: snapshot.toolProtocol,
    messageCount: typeof snapshot.messageCount === 'number'
      ? snapshot.messageCount
      : (Array.isArray(snapshot.messages) ? snapshot.messages.length : 0),
    promptCacheBypassTimestamp: snapshot.promptCacheBypassTimestamp || '',
    parentConversationId: typeof snapshot.parentConversationId === 'string' ? snapshot.parentConversationId : '',
    rootConversationId: typeof snapshot.rootConversationId === 'string' ? snapshot.rootConversationId : '',
    relationType: typeof snapshot.relationType === 'string' ? snapshot.relationType : '',
    relationSource: typeof snapshot.relationSource === 'string' ? snapshot.relationSource : '',
    parentTitleSnapshot: typeof snapshot.parentTitleSnapshot === 'string' ? snapshot.parentTitleSnapshot : '',
    archived: snapshot.archived === true,
    transient: snapshot.transient === true,
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
