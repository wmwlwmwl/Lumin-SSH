const AI_WORKSPACE_TAB_STATE_KEY = '__luminAIWorkspaceTabState'
const AI_WORKSPACE_TAB_CHANGED_EVENT = 'lumin-ai-workspace-tabs-changed'

type StoreHost = Window & typeof globalThis

export interface AIWorkspaceTab {
  id: string
  conversationId: string
  title: string
  transient?: boolean
}

export interface AIWorkspaceTabGroup {
  activeTabId: string
  tabs: AIWorkspaceTab[]
}

function getRoot(): StoreHost {
  return typeof window !== 'undefined' ? window : globalThis as StoreHost
}

function normalizeTerminalId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function tabGroupEventName(terminalId: string): string {
  return `lumin-ai-workspace-tabs:${terminalId}`
}

function createStore(): Record<string, unknown> {
  const root = getRoot() as unknown as Record<string, unknown>
  const current = root[AI_WORKSPACE_TAB_STATE_KEY]
  if (current && typeof current === 'object') {
    return current as Record<string, unknown>
  }
  const next: Record<string, unknown> = {}
  root[AI_WORKSPACE_TAB_STATE_KEY] = next
  return next
}

function cloneTab(tab: AIWorkspaceTab): AIWorkspaceTab {
  return {
    id: tab.id,
    conversationId: tab.conversationId,
    title: tab.title,
    transient: tab.transient === true,
  }
}

function cloneGroup(group: AIWorkspaceTabGroup): AIWorkspaceTabGroup {
  return {
    activeTabId: group.activeTabId,
    tabs: group.tabs.map(cloneTab),
  }
}

export function createAIWorkspaceTabId(): string {
  const randomUUID = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `ai-tab-${randomUUID}`
}

function normalizeAIWorkspaceTabGroup(value: unknown): AIWorkspaceTabGroup {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const seenIds = new Set<string>()
  const seenConversationIds = new Set<string>()
  const tabs = (Array.isArray(source.tabs) ? source.tabs : []).flatMap((item, index) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const tab = item as Record<string, unknown>
    const baseId = typeof tab.id === 'string' && tab.id.trim() ? tab.id.trim() : `ai-tab-restored-${index + 1}`
    let id = baseId
    let duplicateIndex = 2
    while (seenIds.has(id)) {
      id = `${baseId}-${duplicateIndex}`
      duplicateIndex += 1
    }
    const conversationId = typeof tab.conversationId === 'string' ? tab.conversationId.trim() : ''
    if (conversationId && seenConversationIds.has(conversationId)) {
      return []
    }
    seenIds.add(id)
    if (conversationId) {
      seenConversationIds.add(conversationId)
    }
    return [{
      id,
      conversationId,
      title: typeof tab.title === 'string' ? tab.title.trim() : '',
      transient: tab.transient === true,
    }]
  })
  const requestedActiveTabId = typeof source.activeTabId === 'string' ? source.activeTabId.trim() : ''
  return {
    activeTabId: tabs.some((tab) => tab.id === requestedActiveTabId) ? requestedActiveTabId : '',
    tabs,
  }
}

export function getAIWorkspaceTabGroup(terminalId: unknown): AIWorkspaceTabGroup {
  const key = normalizeTerminalId(terminalId)
  if (!key) {
    return { activeTabId: '', tabs: [] }
  }
  return cloneGroup(normalizeAIWorkspaceTabGroup(createStore()[key]))
}

function emitAIWorkspaceTabGroupChange(terminalId: string, group: AIWorkspaceTabGroup) {
  const root = getRoot()
  const detail = {
    terminalId,
    group: cloneGroup(group),
  }
  root.dispatchEvent(new CustomEvent<AIWorkspaceTabGroup>(tabGroupEventName(terminalId), { detail: detail.group }))
  root.dispatchEvent(new CustomEvent<typeof detail>(AI_WORKSPACE_TAB_CHANGED_EVENT, { detail }))
}

export function setAIWorkspaceTabGroup(
  terminalId: unknown,
  updater: AIWorkspaceTabGroup | ((current: AIWorkspaceTabGroup) => AIWorkspaceTabGroup),
): AIWorkspaceTabGroup {
  const key = normalizeTerminalId(terminalId)
  if (!key) {
    return { activeTabId: '', tabs: [] }
  }
  const store = createStore()
  const current = getAIWorkspaceTabGroup(key)
  const nextValue = typeof updater === 'function' ? updater(current) : updater
  const next = normalizeAIWorkspaceTabGroup(nextValue)
  store[key] = next
  emitAIWorkspaceTabGroupChange(key, next)
  return cloneGroup(next)
}

export function clearAIWorkspaceTabGroup(terminalId: unknown) {
  const key = normalizeTerminalId(terminalId)
  if (!key) {
    return
  }
  const store = createStore()
  clearAIWorkspaceTabPendingLocationsForTerminal(key)
  if (!Object.prototype.hasOwnProperty.call(store, key)) {
    return
  }
  delete store[key]
  emitAIWorkspaceTabGroupChange(key, { activeTabId: '', tabs: [] })
}

export function subscribeAIWorkspaceTabGroup(terminalId: unknown, callback: (group: AIWorkspaceTabGroup) => void): () => void {
  const root = getRoot()
  const key = normalizeTerminalId(terminalId)
  if (!key) {
    callback({ activeTabId: '', tabs: [] })
    return () => {}
  }
  const handler = (event: Event) => callback((event as CustomEvent<AIWorkspaceTabGroup>).detail)
  callback(getAIWorkspaceTabGroup(key))
  root.addEventListener(tabGroupEventName(key), handler)
  return () => root.removeEventListener(tabGroupEventName(key), handler)
}

export function findAIWorkspaceConversationTab(conversationId: unknown): { terminalId: string; tabId: string } | null {
  const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!normalizedConversationId) {
    return null
  }
  for (const [terminalId, group] of Object.entries(getAllAIWorkspaceTabGroups())) {
    const tab = group.tabs.find((item) => item.conversationId === normalizedConversationId)
    if (tab) {
      return {
        terminalId,
        tabId: tab.id,
      }
    }
  }
  return null
}

export interface AIWorkspaceTabPendingLocation {
  conversationId: string
  messageId: string
}

const aiWorkspaceTabPendingLocations = new Map<string, AIWorkspaceTabPendingLocation>()

function aiWorkspaceTabPendingLocationKey(terminalId: unknown, tabId: unknown): string {
  const normalizedTerminalId = normalizeTerminalId(terminalId)
  const normalizedTabId = typeof tabId === 'string' ? tabId.trim() : ''
  return normalizedTerminalId && normalizedTabId ? `${normalizedTerminalId}::${normalizedTabId}` : ''
}

export function setAIWorkspaceTabPendingLocation(terminalId: unknown, tabId: unknown, location: AIWorkspaceTabPendingLocation): void {
  const key = aiWorkspaceTabPendingLocationKey(terminalId, tabId)
  const conversationId = typeof location?.conversationId === 'string' ? location.conversationId.trim() : ''
  const messageId = typeof location?.messageId === 'string' ? location.messageId.trim() : ''
  if (!key || !conversationId || !messageId) {
    return
  }
  aiWorkspaceTabPendingLocations.set(key, { conversationId, messageId })
}

export function getAIWorkspaceTabPendingLocation(terminalId: unknown, tabId: unknown): AIWorkspaceTabPendingLocation | null {
  const key = aiWorkspaceTabPendingLocationKey(terminalId, tabId)
  const location = key ? aiWorkspaceTabPendingLocations.get(key) : null
  return location ? { ...location } : null
}

export function clearAIWorkspaceTabPendingLocation(terminalId: unknown, tabId: unknown): void {
  const key = aiWorkspaceTabPendingLocationKey(terminalId, tabId)
  if (key) {
    aiWorkspaceTabPendingLocations.delete(key)
  }
}

function clearAIWorkspaceTabPendingLocationsForTerminal(terminalId: unknown): void {
  const normalizedTerminalId = normalizeTerminalId(terminalId)
  if (!normalizedTerminalId) {
    return
  }
  const prefix = `${normalizedTerminalId}::`
  Array.from(aiWorkspaceTabPendingLocations.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      aiWorkspaceTabPendingLocations.delete(key)
    }
  })
}

function retainAIWorkspaceTabPendingLocations(groups: Record<string, AIWorkspaceTabGroup>): void {
  const validKeys = new Set(
    Object.entries(groups).flatMap(([terminalId, group]) => (
      group.tabs.map((tab) => aiWorkspaceTabPendingLocationKey(terminalId, tab.id))
    )),
  )
  Array.from(aiWorkspaceTabPendingLocations.keys()).forEach((key) => {
    if (!validKeys.has(key)) {
      aiWorkspaceTabPendingLocations.delete(key)
    }
  })
}

export function getAllAIWorkspaceTabGroups(): Record<string, AIWorkspaceTabGroup> {
  return Object.fromEntries(
    Object.entries(createStore())
      .map(([terminalId, value]) => {
        const group = normalizeAIWorkspaceTabGroup(value)
        return [normalizeTerminalId(terminalId), group] as const
      })
      .filter(([terminalId, group]) => terminalId && group.tabs.length > 0),
  )
}

export function getPersistableAIWorkspaceTabGroups(): Record<string, AIWorkspaceTabGroup> {
  return Object.fromEntries(
    Object.entries(getAllAIWorkspaceTabGroups()).flatMap(([terminalId, group]) => {
      const tabs = group.tabs.filter((tab) => tab.transient !== true)
      if (tabs.length === 0) return []
      return [[terminalId, {
        activeTabId: tabs.some((tab) => tab.id === group.activeTabId) ? group.activeTabId : tabs[0].id,
        tabs,
      }]]
    }),
  )
}

export function replaceAllAIWorkspaceTabGroups(nextState: unknown): Record<string, AIWorkspaceTabGroup> {
  const root = getRoot() as unknown as Record<string, unknown>
  const previousKeys = Object.keys(createStore())
  const normalized: Record<string, AIWorkspaceTabGroup> = {}
  const seenConversationIds = new Set<string>()
  Object.entries(nextState && typeof nextState === 'object' ? nextState as Record<string, unknown> : {}).forEach(([terminalId, value]) => {
    const key = normalizeTerminalId(terminalId)
    const group = normalizeAIWorkspaceTabGroup(value)
    const tabs = group.tabs.filter((tab) => {
      if (!tab.conversationId || !seenConversationIds.has(tab.conversationId)) {
        if (tab.conversationId) {
          seenConversationIds.add(tab.conversationId)
        }
        return true
      }
      return false
    })
    const nextGroup = normalizeAIWorkspaceTabGroup({
      activeTabId: group.activeTabId,
      tabs,
    })
    if (key && nextGroup.tabs.length > 0) {
      normalized[key] = nextGroup
    }
  })
  root[AI_WORKSPACE_TAB_STATE_KEY] = normalized
  retainAIWorkspaceTabPendingLocations(normalized)
  new Set([...previousKeys, ...Object.keys(normalized)]).forEach((terminalId) => {
    emitAIWorkspaceTabGroupChange(terminalId, normalized[terminalId] || { activeTabId: '', tabs: [] })
  })
  return getAllAIWorkspaceTabGroups()
}

export function remapAIWorkspaceTabGroups(idMap: Record<string, string> | null | undefined): Record<string, AIWorkspaceTabGroup> {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {}
  const remapped: Record<string, AIWorkspaceTabGroup> = {}
  Object.entries(getAllAIWorkspaceTabGroups()).forEach(([terminalId, group]) => {
    const mappedTerminalId = normalizeTerminalId(sourceMap[terminalId] || terminalId)
    if (!mappedTerminalId) {
      return
    }
    remapped[mappedTerminalId] = normalizeAIWorkspaceTabGroup(group)
  })
  return replaceAllAIWorkspaceTabGroups(remapped)
}

export function subscribeAIWorkspaceTabGroups(callback: () => void): () => void {
  const root = getRoot()
  root.addEventListener(AI_WORKSPACE_TAB_CHANGED_EVENT, callback)
  return () => root.removeEventListener(AI_WORKSPACE_TAB_CHANGED_EVENT, callback)
}
