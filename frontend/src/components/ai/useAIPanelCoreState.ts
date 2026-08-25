import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cancelAIChat } from './aiChatBridge.ts'
import { buildAIConversationTokenLedger, countAIConversationAPIMessageRawTokens, saveAIConversation, saveTemporaryAIConversation } from './aiConversationBridge.ts'
import { getConversationBranchAnchor } from './chat/aiChatMessageTopology.ts'
import { createEmptyPanelState, findApiAnchorIndexByUiMessageId, isAIQueueBlocked, normalizeAIRuntimePhase } from './aiChatLogic.ts'
import type { AIConversationSnapshot, AIMessage, AIPanelProps, ComposerEditState, PanelState, PerfRecord, TokenLedger } from './aiChatLogic.ts'
import { upsertTemporaryAIConversation } from './aiTemporaryConversations.ts'
import { upsertConversationSummary, type ConversationSummary } from './aiConversationSummary.ts'
import type * as React from 'react'

// AI 面板状态基座：终端面板状态机（terminalPanels/setPanelState）、composer 草稿、
// token 账本（全量重建/增量刷新）、会话快照保存、滚动信号与生命周期 ref。
// 从 AIConversationTabPanel 原样搬移，闭包依赖经参数同名注入，代码零改动。
export function useAIPanelCoreState({ terminalId, sessionId, workspaceTabId, initialConversationId, isWorkspaceTabActive, onWorkspaceTabStateChange, setConversationList }: {
  terminalId: string
  sessionId: string
  workspaceTabId: string
  initialConversationId: string
  isWorkspaceTabActive: boolean
  onWorkspaceTabStateChange?: AIPanelProps['onWorkspaceTabStateChange']
  setConversationList: React.Dispatch<React.SetStateAction<ConversationSummary[]>>
}) {
  const [pendingConversationId, setPendingConversationId] = useState('')
  const [terminalPanels, setTerminalPanels] = useState<Record<string, PanelState>>({})
  const [composerInputValue, setComposerInputValue] = useState('')
  const [composerImages, setComposerImages] = useState<string[]>([])
  const [composerEditState, setComposerEditState] = useState<ComposerEditState>({ mode: 'new', targetMessageId: '', targetMessageText: '' })
  const [conversationScrollSignal, setConversationScrollSignal] = useState(0)
  const terminalPanelsRef = useRef<Record<string, PanelState>>({})
  const deletedConversationIdsRef = useRef<Set<string>>(new Set())
  const isReturningHomeRef = useRef(false)
  const conversationLoadRequestRef = useRef(0)
  const panelMountedRef = useRef(true)
  const tokenLedgerRef = useRef<Map<string, TokenLedger>>(new Map())
  const sendPerfMetricsRef = useRef<Map<string, PerfRecord>>(new Map())
  const panelInstanceKey = `${sessionId || 'session'}::${terminalId || 'terminal'}`
  const clearRestorePreview = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-change-review-preview-clear', {
      detail: { sessionId: terminalId, tabId: workspaceTabId },
    }))
  }, [terminalId, workspaceTabId])
  useEffect(() => {
    terminalPanelsRef.current = terminalPanels
  }, [terminalPanels])

  useEffect(() => {
    panelMountedRef.current = true
    return () => {
      panelMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleAppendComposerText = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const targetSessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : ''
      const targetTerminalId = typeof detail?.terminalId === 'string' ? detail.terminalId.trim() : ''
      const targetTabId = typeof detail?.tabId === 'string' ? detail.tabId.trim() : ''
      const preserveWhitespace = detail?.preserveWhitespace === true
      const rawAppendedText = typeof detail?.text === 'string' ? detail.text : ''
      const appendedText = preserveWhitespace ? rawAppendedText : rawAppendedText.trim()
      if (!(preserveWhitespace ? rawAppendedText.trim() : appendedText)) {
        return
      }
      if (
        !isWorkspaceTabActive
        || (targetTabId && targetTabId !== workspaceTabId)
        || targetSessionId !== (sessionId || '').trim()
        || targetTerminalId !== (terminalId || '').trim()
      ) {
        return
      }
      setComposerInputValue((current) => {
        const currentValue = typeof current === 'string' ? current : ''
        if (!currentValue.trim()) {
          return appendedText
        }
        return currentValue.endsWith('\n') ? `${currentValue}${appendedText}` : `${currentValue}\n${appendedText}`
      })
    }
    window.addEventListener('ai-composer-append', handleAppendComposerText)
    return () => window.removeEventListener('ai-composer-append', handleAppendComposerText)
  }, [isWorkspaceTabActive, sessionId, terminalId, workspaceTabId])
  const panelState = terminalPanels[panelInstanceKey] || createEmptyPanelState()
  const activeConversation = panelState.conversation
  useLayoutEffect(() => {
    const normalizedTabId = workspaceTabId.trim()
    const normalizedInitialConversationId = initialConversationId.trim()
    if (!normalizedTabId) {
      return
    }
    if (isReturningHomeRef.current) {
      if (activeConversation) {
        return
      }
      isReturningHomeRef.current = false
    }
    if (normalizedInitialConversationId && activeConversation?.id !== normalizedInitialConversationId) {
      return
    }
    onWorkspaceTabStateChange?.(normalizedTabId, {
      conversationId: activeConversation?.id || '',
      title: activeConversation?.title || '',
      activeRequestId: panelState.activeRequestId,
      transient: activeConversation?.transient === true,
    })
  }, [activeConversation?.id, activeConversation?.title, initialConversationId, onWorkspaceTabStateChange, panelState.activeRequestId, workspaceTabId])
  const normalizedInitialConversationId = initialConversationId.trim()
  const isConversationLoading = Boolean(
    pendingConversationId
    || (normalizedInitialConversationId && activeConversation?.id !== normalizedInitialConversationId),
  )
  const activeConversationRelationType = typeof activeConversation?.relationType === 'string' ? activeConversation.relationType.trim() : ''
  const activeConversationArchived = activeConversation?.archived === true
  const isThemeTuningConversation = activeConversation?.toolScope === 'theme_tuning'
  const runtimePhase = normalizeAIRuntimePhase(panelState.runtimePhase)
  const isStreaming = panelState.requestPhase === 'streaming'
  const isAwaitingToolApproval = panelState.requestPhase === 'awaiting_tool_approval'
  const isToolRunning = panelState.requestPhase === 'running_tool'
  const isAwaitingCommandAction = panelState.requestPhase === 'awaiting_command_action'
  const isAwaitingTerminalAssignment = panelState.requestPhase === 'awaiting_terminal_assignment'
  const isQueueBlocked = isAIQueueBlocked(runtimePhase) || isStreaming || isAwaitingToolApproval || isToolRunning || isAwaitingCommandAction || isAwaitingTerminalAssignment
  const requestConversationSmoothScrollToBottom = useCallback(() => {
    setConversationScrollSignal((current) => current + 1)
  }, [])
  const resetComposerEditState = useCallback(() => {
    setComposerEditState({ mode: 'new', targetMessageId: '', targetMessageText: '' })
    setComposerInputValue('')
    setComposerImages([])
  }, [])
  const setPanelState = useCallback((panelKey: string, updater: ((current: PanelState) => PanelState) | Partial<PanelState>) => {
    const previousPanels = terminalPanelsRef.current || {}
    const current = previousPanels[panelKey] || createEmptyPanelState()
    const nextState = typeof updater === 'function' ? updater(current) : {
      ...current,
      ...(updater || {}),
    }
    const nextPanels = {
      ...previousPanels,
      [panelKey]: nextState,
    }
    terminalPanelsRef.current = nextPanels
    setTerminalPanels(nextPanels)
    return nextState
  }, [])
  const getMessageApiLengthBefore = useCallback((message: AIMessage) => {
    const rawValue = message?.extra?.apiLengthBefore
    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0
  }, [])

  const truncateConversationAfterMessage = useCallback((conversation: AIConversationSnapshot, messageId: string) => {
    if (!conversation || !Array.isArray(conversation.messages)) {
      return conversation
    }

    const messages = conversation.messages
    const messageIndex = messages.findIndex((message) => message.id === messageId)
    if (messageIndex === -1) {
      return conversation
    }

    const { cutIndex, turnId: targetTurnId } = getConversationBranchAnchor(messages, messageId)
    const anchorMessage = messages[cutIndex]
    const nextMessages = messages.slice(0, cutIndex)
    // Assistant-turn child messages truncate from their owning assistant turn.
    // Plain user messages remain independent round boundaries.
    const apiAnchorUIMessageId = targetTurnId || anchorMessage?.id || messageId
    let apiCutIndex = findApiAnchorIndexByUiMessageId(conversation.apiMessages, apiAnchorUIMessageId)

    if (apiCutIndex < 0) {
      apiCutIndex = getMessageApiLengthBefore(anchorMessage)
    }
    if (apiCutIndex < 0) {
      apiCutIndex = 0
    }

    return {
      ...conversation,
      updatedAt: Date.now(),
      status: 'idle',
      messages: nextMessages,
      apiMessages: Array.isArray(conversation.apiMessages) ? conversation.apiMessages.slice(0, apiCutIndex) : [],
    }
  }, [getMessageApiLengthBefore])

  const applyAITokenFudgeFactor = useCallback((rawTokens: unknown) => {
    if (!Number.isFinite(Number(rawTokens)) || Number(rawTokens) <= 0) {
      return 0
    }
    return Math.trunc(Number(rawTokens))
  }, [])

  const computeAITokenLedgerContextTokens = useCallback((ledger: { systemRawTokens?: unknown; entries?: unknown[] }) => {
    if (!ledger || typeof ledger !== 'object') {
      return 0
    }
    const systemRawTokens = Number(ledger.systemRawTokens) || 0
    let totalRawTokens = systemRawTokens
    ledger.entries?.forEach((rawTokens) => {
      totalRawTokens += Number(rawTokens) || 0
    })
    return applyAITokenFudgeFactor(totalRawTokens)
  }, [applyAITokenFudgeFactor])

  const buildAIConversationCurrentApiMessageIds = useCallback((snapshot: AIConversationSnapshot) => {
    const apiMessages = Array.isArray(snapshot?.apiMessages) ? snapshot.apiMessages : []
    return apiMessages
      .map((message) => (typeof message?.messageId === 'string' ? message.messageId.trim() : ''))
      .filter((messageId) => messageId)
  }, [])

  // 全量重建账本: 进入任务/恢复备份/压缩后调用,对每个节点逐条重算 raw token 并持久化到内存账本
  const rebuildAIConversationTokenLedger = useCallback(async (snapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey) => {
    if (!snapshot?.id) {
      return 0
    }
    try {
      const ledger = await buildAIConversationTokenLedger(terminalId, snapshot)
      if (!ledger) {
        return 0
      }
      const entryMap = new Map<string, number>()
      ledger.entries.forEach((entry) => {
        if (entry.messageId) {
          entryMap.set(entry.messageId, entry.rawTokens)
        }
      })
      const nextLedger = {
        systemRawTokens: ledger.systemRawTokens,
        entries: entryMap,
      }
      tokenLedgerRef.current.set(snapshot.id, nextLedger)
      const contextTokens = ledger.contextTokens || computeAITokenLedgerContextTokens({
        systemRawTokens: nextLedger.systemRawTokens,
        entries: Array.from(entryMap.values()),
      })
      setPanelState(targetPanelKey, (current) => {
        if (current.activeConversationId !== snapshot.id) {
          return current
        }
        return {
          ...current,
          contextTokens,
        }
      })
      return contextTokens
    } catch {
      return 0
    }
  }, [computeAITokenLedgerContextTokens, panelInstanceKey, setPanelState, terminalId])

  // 增量刷新账本: 只对账本里尚未记录的新增节点算 raw token, 已删除节点从账本移除, 然后按剩余节点求和
  const refreshAIConversationContextTokens = useCallback(async (snapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey) => {
    if (!snapshot?.id) {
      return 0
    }
    const existingLedger = tokenLedgerRef.current.get(snapshot.id)
    if (!existingLedger) {
      return rebuildAIConversationTokenLedger(snapshot, targetPanelKey)
    }
    const currentApiMessageIds = buildAIConversationCurrentApiMessageIds(snapshot)
    const currentIdSet = new Set(currentApiMessageIds)
    // 删除/编辑/重试导致的节点消失: 从账本移除
    const nextEntries = new Map<string, number>()
    existingLedger.entries.forEach((rawTokens, messageId) => {
      if (currentIdSet.has(messageId)) {
        nextEntries.set(messageId, rawTokens)
      }
    })
    // 追加的新节点: 只算账本里没有的那几条
    const apiMessages = Array.isArray(snapshot.apiMessages) ? snapshot.apiMessages : []
    const missingMessages = apiMessages.filter((message) => {
      const messageId = typeof message?.messageId === 'string' ? message.messageId.trim() : ''
      return messageId && !nextEntries.has(messageId)
    })
    if (missingMessages.length > 0) {
      try {
        const entries = await countAIConversationAPIMessageRawTokens(terminalId, snapshot.id, missingMessages)
        entries.forEach((entry) => {
          if (entry.messageId) {
            nextEntries.set(entry.messageId, entry.rawTokens)
          }
        })
      } catch {
        return rebuildAIConversationTokenLedger(snapshot, targetPanelKey)
      }
    }
    const nextLedger = {
      systemRawTokens: existingLedger.systemRawTokens,
      entries: nextEntries,
    }
    tokenLedgerRef.current.set(snapshot.id, nextLedger)
    const contextTokens = computeAITokenLedgerContextTokens({
      systemRawTokens: nextLedger.systemRawTokens,
      entries: Array.from(nextEntries.values()),
    })
    setPanelState(targetPanelKey, (current) => {
      if (current.activeConversationId !== snapshot.id) {
        return current
      }
      return {
        ...current,
        contextTokens,
      }
    })
    return contextTokens
  }, [buildAIConversationCurrentApiMessageIds, computeAITokenLedgerContextTokens, panelInstanceKey, rebuildAIConversationTokenLedger, setPanelState, terminalId])

  const saveConversationSnapshot = useCallback(async (snapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey, options: { hydrate?: boolean } = {}) => {
    // 已删除会话不允许被并发保存请求写回（避免流式输出中删除后被重新创建）
    if (deletedConversationIdsRef.current.has(snapshot.id)) {
      return
    }
    const shouldHydrate = options?.hydrate === true
    const isTransientConversation = snapshot?.transient === true
    const saved = isTransientConversation
      ? await saveTemporaryAIConversation(snapshot)
      : await saveAIConversation(snapshot)
    if (isTransientConversation) upsertTemporaryAIConversation(saved)
    setConversationList((prev) => upsertConversationSummary(prev, saved))
    setPanelState(targetPanelKey, (current) => {
      if (current.activeConversationId !== saved.id) {
        return current
      }
      if (!shouldHydrate) {
        return {
          ...current,
          conversation: {
            ...saved,
            messages: current.messages,
            apiMessages: current.apiMessages,
          },
        }
      }
      return {
        ...current,
        conversation: saved,
        messages: saved.messages || [],
        apiMessages: saved.apiMessages || [],
      }
    })
    void refreshAIConversationContextTokens(saved, targetPanelKey)
    return saved
  }, [panelInstanceKey, refreshAIConversationContextTokens, setPanelState])
  useEffect(() => {
    if (terminalPanelsRef.current[panelInstanceKey]) {
      return
    }
    setTerminalPanels((prev) => ({
      ...prev,
      [panelInstanceKey]: createEmptyPanelState(),
    }))
  }, [panelInstanceKey])
  // ponytail: unmount/会话关闭时取消未决的 AI 请求，避免后端 aiPendingToolBatches 等 map 残留
  useEffect(() => {
    return () => {
      const panel = terminalPanelsRef.current[panelInstanceKey]
      const requestId = panel?.activeRequestId
      if (!requestId) {
        return
      }
      const conversation = panel.conversation
      if (conversation && !conversation.transient && !deletedConversationIdsRef.current.has(conversation.id)) {
        const assistantMessageId = panel.activeAssistantMessageId || requestId
        const messages = (Array.isArray(panel.messages) ? panel.messages : []).filter((message) => (
          !(
            (message.id === assistantMessageId || message.id === `${assistantMessageId}-reasoning`)
            && (message.kind === 'assistant' || message.kind === 'reasoning')
          )
        ))
        void saveAIConversation({
          ...conversation,
          updatedAt: Date.now(),
          status: 'idle',
          messages,
          apiMessages: Array.isArray(panel.apiMessages) ? panel.apiMessages : [],
        }).catch(() => {})
      }
      void cancelAIChat(requestId)
    }
  }, [panelInstanceKey])

  return {
    panelInstanceKey,
    terminalPanels,
    setTerminalPanels,
    terminalPanelsRef,
    deletedConversationIdsRef,
    isReturningHomeRef,
    conversationLoadRequestRef,
    panelMountedRef,
    tokenLedgerRef,
    sendPerfMetricsRef,
    pendingConversationId,
    setPendingConversationId,
    composerInputValue,
    setComposerInputValue,
    composerImages,
    setComposerImages,
    composerEditState,
    setComposerEditState,
    resetComposerEditState,
    conversationScrollSignal,
    requestConversationSmoothScrollToBottom,
    clearRestorePreview,
    panelState,
    activeConversation,
    normalizedInitialConversationId,
    isConversationLoading,
    activeConversationRelationType,
    activeConversationArchived,
    isThemeTuningConversation,
    runtimePhase,
    isStreaming,
    isAwaitingToolApproval,
    isToolRunning,
    isAwaitingCommandAction,
    isAwaitingTerminalAssignment,
    isQueueBlocked,
    setPanelState,
    getMessageApiLengthBefore,
    truncateConversationAfterMessage,
    rebuildAIConversationTokenLedger,
    refreshAIConversationContextTokens,
    saveConversationSnapshot,
  }
}
