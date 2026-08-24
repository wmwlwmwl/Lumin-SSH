// 桥接模块（自 .js 收编后类型化）：AI 对话备份的归一化与恢复
import { normalizeAIConversationSnapshot, publishAIConversationUpsert } from './aiConversationBridge.ts'

function getAppBridge() {
  return window?.go?.wailsapp?.AIBindings || window?.go?.wailsapp?.App
}

/** 归一化后的对话备份项（type 而非 interface 以兼容消费方索引签名） */
export type AIConversationBackup = {
  id: string
  ts: number
  message: string
  messageRole: string
  type: string
}

/** 归一化后的备份历史条目 */
export type AIConversationBackupHistoryEntry = {
  role: string
  content: string | unknown[]
  ts: number
  messageId: string
  uiMessageIds: string[]
  images: string[]
}

function normalizeAIConversationBackup(backup: unknown): AIConversationBackup {
  const b = (backup ?? {}) as Record<string, unknown>
  return {
    id: typeof b.id === 'string' ? b.id.trim() : '',
    ts: typeof b.ts === 'number' ? b.ts : 0,
    message: typeof b.message === 'string' ? b.message : '',
    messageRole: typeof b.messageRole === 'string' ? b.messageRole : '',
    type: typeof b.type === 'string' ? b.type : 'auto',
  }
}

function normalizeAIConversationBackupHistoryEntry(entry: unknown): AIConversationBackupHistoryEntry {
  const e = (entry ?? {}) as Record<string, unknown>
  return {
    role: typeof e.role === 'string' ? e.role : '',
    content: typeof e.content === 'string' || Array.isArray(e.content) ? e.content : '',
    ts: typeof e.ts === 'number' ? e.ts : 0,
    messageId: typeof e.messageId === 'string' ? e.messageId : '',
    uiMessageIds: Array.isArray(e.uiMessageIds) ? e.uiMessageIds.filter((item) => typeof item === 'string') : [],
    images: Array.isArray(e.images) ? e.images.filter((item) => typeof item === 'string') : [],
  }
}

export async function listAIConversationBackups(conversationId: string): Promise<AIConversationBackup[]> {
  const bridge = getAppBridge()
  if (!bridge?.ListAIConversationBackups) {
    return []
  }
  const result = await bridge.ListAIConversationBackups(conversationId)
  return Array.isArray(result) ? result.map(normalizeAIConversationBackup) : []
}

export async function getAIConversationBackupHistory(conversationId: string, backupId: string): Promise<AIConversationBackupHistoryEntry[]> {
  const bridge = getAppBridge()
  if (!bridge?.GetAIConversationBackupHistory) {
    return []
  }
  const result = await bridge.GetAIConversationBackupHistory(conversationId, backupId)
  return Array.isArray(result) ? result.map(normalizeAIConversationBackupHistoryEntry) : []
}

export async function restoreAIConversationBackup(conversationId: string, backupId: string): Promise<unknown> {
  const bridge = getAppBridge()
  if (!bridge?.RestoreAIConversationBackup) {
    return null
  }
  const snapshot = normalizeAIConversationSnapshot(await bridge.RestoreAIConversationBackup(conversationId, backupId))
  publishAIConversationUpsert(snapshot)
  return snapshot
}

export async function deleteAIConversationBackup(conversationId: string, backupId: string): Promise<void> {
  const bridge = getAppBridge()
  if (!bridge?.DeleteAIConversationBackup) {
    return
  }
  await bridge.DeleteAIConversationBackup(conversationId, backupId)
}
