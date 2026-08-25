import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { normalizeAIConversationSearchQuery } from './aiChatLogic.ts'
import { searchAIConversationMessages, type AIConversationMessageSearchResult } from './aiConversationBridge.ts'

// 全局对话搜索状态簇：搜索框开关/关键词/加载态/结果、输入聚焦与 180ms 防抖检索。
// 从 AIConversationTabPanel 原样搬移，闭包依赖经参数同名注入，代码零改动。
export function useAIGlobalSearch({ panelMountedRef }: {
  panelMountedRef: React.RefObject<boolean>
}) {
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState<AIConversationMessageSearchResult[]>([])
  const globalSearchRequestRef = useRef(0)
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null)
  const resetGlobalSearchState = useCallback(() => {
    setGlobalSearchOpen(false)
    setGlobalSearchQuery('')
    setGlobalSearchLoading(false)
    setGlobalSearchResults([])
  }, [])
  const normalizedGlobalSearchQuery = useMemo(() => normalizeAIConversationSearchQuery(globalSearchQuery), [globalSearchQuery])
  useEffect(() => {
    if (!globalSearchOpen || !globalSearchInputRef.current) {
      return
    }
    globalSearchInputRef.current.focus()
    globalSearchInputRef.current.select()
  }, [globalSearchOpen])
  useEffect(() => {
    if (!globalSearchOpen) {
      setGlobalSearchLoading(false)
      setGlobalSearchResults([])
      return
    }
    if (!normalizedGlobalSearchQuery) {
      setGlobalSearchLoading(false)
      setGlobalSearchResults([])
      return
    }
    const requestId = globalSearchRequestRef.current + 1
    globalSearchRequestRef.current = requestId
    setGlobalSearchLoading(true)
    const timer = window.setTimeout(() => {
      searchAIConversationMessages(normalizedGlobalSearchQuery, '', 50)
        .then((results) => {
          if (!panelMountedRef.current || globalSearchRequestRef.current !== requestId) {
            return
          }
          setGlobalSearchResults(results)
        })
        .catch(() => {
          if (!panelMountedRef.current || globalSearchRequestRef.current !== requestId) {
            return
          }
          setGlobalSearchResults([])
        })
        .finally(() => {
          if (!panelMountedRef.current || globalSearchRequestRef.current !== requestId) {
            return
          }
          setGlobalSearchLoading(false)
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [globalSearchOpen, normalizedGlobalSearchQuery])
  const handleOpenGlobalSearch = useCallback(() => {
    setGlobalSearchOpen((current) => {
      const next = !current
      if (!next) {
        setGlobalSearchQuery('')
        setGlobalSearchLoading(false)
        setGlobalSearchResults([])
      }
      return next
    })
  }, [])
  return {
    globalSearchOpen,
    setGlobalSearchOpen,
    globalSearchQuery,
    setGlobalSearchQuery,
    globalSearchLoading,
    setGlobalSearchLoading,
    globalSearchResults,
    setGlobalSearchResults,
    globalSearchRequestRef,
    globalSearchInputRef,
    resetGlobalSearchState,
    normalizedGlobalSearchQuery,
    handleOpenGlobalSearch,
  }
}
