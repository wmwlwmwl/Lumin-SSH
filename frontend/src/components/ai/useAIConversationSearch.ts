import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildAIConversationSearchSnippet, extractAIConversationSearchText, normalizeAIConversationSearchQuery } from './aiChatLogic.ts'
import { normalizeAIConversationMessageSearchResult } from './aiConversationBridge.ts'
import type { AIConversationSnapshot, PanelState } from './aiChatLogic.ts'

// 当前对话内搜索状态簇：搜索框开关/关键词/命中索引、结果过滤、输入聚焦与命中定位。
// 从 AIConversationTabPanel 原样搬移，闭包依赖经参数同名注入，代码零改动。
export function useAIConversationSearch({ sessionId, terminalId, workspaceTabId, panelState, activeConversation }: {
  sessionId: string
  terminalId: string
  workspaceTabId: string
  panelState: PanelState
  activeConversation: AIConversationSnapshot | null
}) {
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false)
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [conversationSearchIndex, setConversationSearchIndex] = useState(0)
  const conversationSearchInputRef = useRef<HTMLInputElement | null>(null)
  const resetConversationSearchState = useCallback(() => {
    setConversationSearchOpen(false)
    setConversationSearchQuery('')
    setConversationSearchIndex(0)
  }, [])
  const normalizedConversationSearchQuery = useMemo(() => normalizeAIConversationSearchQuery(conversationSearchQuery), [conversationSearchQuery])
  const conversationSearchResults = useMemo(() => {
    if (!activeConversation || !normalizedConversationSearchQuery) {
      return []
    }
    const normalizedNeedle = normalizedConversationSearchQuery.toLowerCase()
    return (Array.isArray(panelState.messages) ? panelState.messages : []).flatMap((message) => {
      const body = extractAIConversationSearchText(message)
      if (!body || !body.toLowerCase().includes(normalizedNeedle)) {
        return []
      }
      return [normalizeAIConversationMessageSearchResult({
        conversationId: activeConversation.id,
        conversationTitle: activeConversation.title,
        messageId: message.id,
        role: message.kind === 'user' ? 'user' : 'assistant',
        snippet: buildAIConversationSearchSnippet(body, normalizedConversationSearchQuery),
        updatedAt: activeConversation.updatedAt,
      })]
    })
  }, [activeConversation, normalizedConversationSearchQuery, panelState.messages])
  useEffect(() => {
    if (!conversationSearchOpen || !conversationSearchInputRef.current) {
      return
    }
    conversationSearchInputRef.current.focus()
    conversationSearchInputRef.current.select()
  }, [conversationSearchOpen])
  useEffect(() => {
    if (!conversationSearchOpen) {
      return
    }
    if (conversationSearchResults.length === 0) {
      setConversationSearchIndex(0)
      return
    }
    setConversationSearchIndex((current) => (current >= conversationSearchResults.length ? 0 : current))
  }, [conversationSearchOpen, conversationSearchResults.length])
  useEffect(() => {
    if (!conversationSearchOpen || !normalizedConversationSearchQuery || conversationSearchResults.length === 0) {
      return
    }
    const activeResult = conversationSearchResults[conversationSearchIndex] || conversationSearchResults[0]
    if (!activeResult?.messageId || typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-conversation-diff-locate', {
      detail: {
        sessionId: sessionId || '',
        terminalId: terminalId || '',
        tabId: workspaceTabId,
        messageId: activeResult.messageId,
      },
    }))
  }, [conversationSearchIndex, conversationSearchOpen, conversationSearchResults, normalizedConversationSearchQuery, sessionId, terminalId])
  const locateConversationMessage = useCallback((messageId: string) => {
    const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : ''
    if (!normalizedMessageId || typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-conversation-diff-locate', {
      detail: {
        sessionId: sessionId || '',
        terminalId: terminalId || '',
        tabId: workspaceTabId,
        messageId: normalizedMessageId,
      },
    }))
  }, [sessionId, terminalId, workspaceTabId])
  const handleOpenConversationSearch = useCallback(() => {
    setConversationSearchOpen((current) => {
      const next = !current
      if (!next) {
        setConversationSearchQuery('')
        setConversationSearchIndex(0)
      }
      return next
    })
  }, [])
  const handleCycleConversationSearchResult = useCallback((direction: number) => {
    if (conversationSearchResults.length === 0) {
      return
    }
    setConversationSearchIndex((current) => {
      const total = conversationSearchResults.length
      return (current + direction + total) % total
    })
  }, [conversationSearchResults.length])
  return {
    conversationSearchOpen,
    setConversationSearchOpen,
    conversationSearchQuery,
    setConversationSearchQuery,
    conversationSearchIndex,
    setConversationSearchIndex,
    conversationSearchInputRef,
    resetConversationSearchState,
    normalizedConversationSearchQuery,
    conversationSearchResults,
    locateConversationMessage,
    handleOpenConversationSearch,
    handleCycleConversationSearchResult,
  }
}
