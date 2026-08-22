export type AIConversationGroup = {
  id: string
  name: string
  createdAt: number
}

export type AIConversationOrganizerState = {
  groups: AIConversationGroup[]
  assignments: Record<string, string>
}

const STORAGE_KEY = 'lumin:ai-conversation-organizer:v1'

function normalizeState(value: unknown): AIConversationOrganizerState {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const seen = new Set<string>()
  const groups = (Array.isArray(source.groups) ? source.groups : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const group = item as Record<string, unknown>
    const id = typeof group.id === 'string' ? group.id.trim() : ''
    const name = typeof group.name === 'string' ? group.name.trim() : ''
    if (!id || !name || seen.has(id)) return []
    seen.add(id)
    return [{ id, name, createdAt: typeof group.createdAt === 'number' ? group.createdAt : Date.now() }]
  })
  const assignments = Object.fromEntries(Object.entries(
    source.assignments && typeof source.assignments === 'object' ? source.assignments as Record<string, unknown> : {},
  ).flatMap(([conversationId, groupId]) => (
    conversationId.trim() && typeof groupId === 'string' && seen.has(groupId.trim())
      ? [[conversationId.trim(), groupId.trim()]]
      : []
  )))
  return { groups, assignments }
}

export function loadAIConversationOrganizer(): AIConversationOrganizerState {
  try {
    return normalizeState(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'))
  } catch {
    return { groups: [], assignments: {} }
  }
}

export function saveAIConversationOrganizer(state: AIConversationOrganizerState): AIConversationOrganizerState {
  const normalized = normalizeState(state)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // Keep the in-memory organizer usable when storage is unavailable or full.
  }
  return normalized
}

export function createAIConversationGroup(name: string): AIConversationGroup {
  return {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    createdAt: Date.now(),
  }
}
