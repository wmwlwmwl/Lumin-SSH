// 面板内存中的临时 AI 会话存储（transient 会话在保存前只存在这里），
// 从 AIPanel.tsx 抽出的纯模块，跨面板通过 window 事件同步。

import type { ConversationSummary } from './aiConversationSummary.ts'

import { upsertConversationSummary, type AISnapshotLike } from './aiConversationSummary.ts'

type TemporaryConversationSnapshotInput = AISnapshotLike

const temporaryAIConversations = new Map<string, ConversationSummary>()
export const TEMPORARY_AI_CONVERSATIONS_CHANGED_EVENT = 'lumin:ai-temporary-conversations-changed'

export function listTemporaryAIConversations() {
  return Array.from(temporaryAIConversations.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export function getTemporaryAIConversationSummary(conversationId: string) {
  return temporaryAIConversations.get(conversationId)
}

/** 从磁盘加载的临时会话摘要灌入内存 Map（启动/刷新时同步用） */
export function seedTemporaryAIConversations(summaries: ConversationSummary[]) {
  summaries.forEach((summary) => temporaryAIConversations.set(summary.id, { ...summary, transient: true }))
}

function notifyTemporaryAIConversationsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TEMPORARY_AI_CONVERSATIONS_CHANGED_EVENT))
}

export function upsertTemporaryAIConversation(snapshot: TemporaryConversationSnapshotInput) {
  const normalized = {
    ...snapshot,
    transient: true,
    updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
    messageCount: typeof snapshot.messageCount === 'number' ? snapshot.messageCount : (Array.isArray(snapshot.messages) ? snapshot.messages.length : 0),
  }
  temporaryAIConversations.set(normalized.id, {
    ...upsertConversationSummary([], normalized)[0],
    transient: true,
  })
  notifyTemporaryAIConversationsChanged()
  return normalized
}

export function removeTemporaryAIConversation(conversationId: string) {
  const removed = temporaryAIConversations.delete(conversationId)
  if (removed) notifyTemporaryAIConversationsChanged()
  return removed
}
