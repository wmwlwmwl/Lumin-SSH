import { useEffect } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime.js'
import {
  AI_CONVERSATION_DIFF_SUCCESS_STATUSES, AI_FOLLOWUP_PENDING_STATUS_KEY, buildAIQueuedSubmission, buildMetrics, buildReasoningDuration, insertMessageBeforeAssistant, normalizeAICollaborationDecision, normalizeAICollaborationMode, normalizeAIContextTokensValue, normalizeAIMessageStatus, normalizeAIRuntimePhase, parseAICollaborationStreamBuffer, resolveAIEventSound, trimLatestAssistantAPIHistoryMessage, updateAILastAssistantTurnState, upsertAPIHistoryMessage, upsertMessageBeforeAssistant,
} from './aiChatLogic.ts'
import type { AIConversationSnapshot, AIMessage, PanelState } from './aiChatLogic.ts'
import { disableAIChatCollaboration, startAIChatCollaboration } from './aiChatBridge.ts'
import { normalizeAIConversationSnapshot } from './aiConversationBridge.ts'
import { formatMessageTime } from './aiTimeFormat.ts'
import { upsertConversationSummary, type ConversationSummary } from './aiConversationSummary.ts'
import { loadThemePackages } from '../../utils/theme.ts'
import { t as translate } from '../../i18n.ts'
import type * as React from 'react'

// ai-chat-stream 流式事件总入口（runtime_phase / collaboration_* / assistant_* /
// tool_* / delta / done / error / cancelled 等分支）+ 协同 pending 卡片确认与
// 协同锁自动上锁三个 effect。从 AIConversationTabPanel 原样搬移；
// 闭包依赖经 deps 注入，保持同名解构、代码零改动。
export interface AIChatStreamEventsDeps {
  terminalId: string
  sessionId: string
  workspaceTabId: string
  panelInstanceKey: string
  terminalPanelsRef: React.RefObject<Record<string, PanelState>>
  shouldLockAssistantCollaboration: boolean
  activeConversation: AIConversationSnapshot | null
  panelState: PanelState
  setPanelState: (panelKey: string, updater: ((current: PanelState) => PanelState) | Partial<PanelState>) => PanelState
  enrichAIChatCommandMessage: (message: AIMessage) => AIMessage
  playAISound: (type: string) => void
  rebuildAIConversationTokenLedger: (snapshot: AIConversationSnapshot, targetPanelKey?: string) => Promise<number>
  saveConversationSnapshot: (snapshot: AIConversationSnapshot, targetPanelKey?: string, options?: { hydrate?: boolean }) => Promise<AIConversationSnapshot | undefined>
  resumeAIChatFromConversation: (conversationSnapshot: AIConversationSnapshot, targetPanelKey?: string, options?: Record<string, unknown>) => Promise<boolean>
  runAIConversationSummarySubtaskFlow: (conversationSnapshot: AIConversationSnapshot, options?: Record<string, unknown>) => Promise<boolean>
  setThemeToolPreview: React.Dispatch<React.SetStateAction<unknown>>
  setConversationList: React.Dispatch<React.SetStateAction<ConversationSummary[]>>
  setComposerInputValue: React.Dispatch<React.SetStateAction<string>>
  setComposerImages: React.Dispatch<React.SetStateAction<string[]>>
  setProviderBalanceRefreshSignal: React.Dispatch<React.SetStateAction<number>>
}

export function useAIChatStreamEvents({
  terminalId,
  sessionId,
  workspaceTabId,
  panelInstanceKey,
  terminalPanelsRef,
  shouldLockAssistantCollaboration,
  activeConversation,
  panelState,
  setPanelState,
  enrichAIChatCommandMessage,
  playAISound,
  rebuildAIConversationTokenLedger,
  saveConversationSnapshot,
  resumeAIChatFromConversation,
  runAIConversationSummarySubtaskFlow,
  setThemeToolPreview,
  setConversationList,
  setComposerInputValue,
  setComposerImages,
  setProviderBalanceRefreshSignal,
}: AIChatStreamEventsDeps) {
  useEffect(() => {
    const unbind = EventsOn('ai-chat-stream', (payload) => {
      const requestId = payload?.requestId
      if (!requestId) {
        return
      }

      const panels = terminalPanelsRef.current
      const matchedEntry = Object.entries(panels).find(([, state]) => state?.activeRequestId === requestId)
      if (!matchedEntry) {
        return
      }

      const [matchedPanelKey, matchedPanel] = matchedEntry
      const conversation = matchedPanel.conversation
      if (!conversation) {
        return
      }

      if (payload.kind === 'runtime_phase') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          runtimePhase: normalizeAIRuntimePhase(payload.phase),
        }))
        return
      }

      if (payload.kind === 'theme_tool_preview' && payload.theme) {
        setThemeToolPreview(payload.theme)
        return
      }

      if (payload.kind === 'theme_tool_reverted') {
        setThemeToolPreview(null)
        return
      }

      if (payload.kind === 'theme_tool_committed') {
        setThemeToolPreview(null)
        void loadThemePackages().catch(() => {})
        return
      }

      if (payload.kind === 'collaboration_pending') {
        let shouldInterruptPendingCollaboration = false
        const pendingMode = normalizeAICollaborationMode(payload.mode)
        setPanelState(matchedPanelKey, (current) => {
          if (current.collaborationInterruptedRequestId === requestId || (pendingMode !== 'forced' && !shouldLockAssistantCollaboration)) {
            shouldInterruptPendingCollaboration = true
            return {
              ...current,
              collaborationLocked: false,
              collaborationActive: false,
              collaborationMode: '',
              collaborationStreamBuffer: '',
              collaborationAwaitingManualFollowup: false,
              collaborationFollowupRequestId: '',
              collaborationPendingMode: '',
              collaborationPendingRequestId: '',
              collaborationInterruptedRequestId: requestId,
              collaborationStatusStartedAtMs: 0,
              collaborationStatusFirstTokenAtMs: 0,
              collaborationStatusText: '',
              collaborationStatusReasoningText: '',
            }
          }
          return {
            ...current,
            collaborationPendingMode: pendingMode,
            collaborationPendingRequestId: requestId,
          }
        })
        if (shouldInterruptPendingCollaboration) {
          void disableAIChatCollaboration(requestId).catch(() => {})
        }
        return
      }

      if (payload.kind === 'collaboration_started') {
        if (matchedPanel.collaborationMode === 'summary_subtask') {
          return
        }
        setComposerInputValue('')
        setComposerImages([])
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          requestPhase: 'idle',
          activeToolExecution: null,
          collaborationLocked: true,
          collaborationActive: true,
          collaborationMode: normalizeAICollaborationMode(payload.mode),
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
          collaborationInterruptedRequestId: '',
          collaborationStatusStartedAtMs: Date.now(),
          collaborationStatusFirstTokenAtMs: 0,
          collaborationStatusText: '',
          collaborationStatusReasoningText: '',
        }))
        return
      }

      if (payload.kind === 'collaboration_reasoning_delta') {
        const nextDelta = typeof payload.delta === 'string' ? payload.delta : ''
        if (!nextDelta) {
          return
        }
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          collaborationStatusFirstTokenAtMs: current.collaborationStatusFirstTokenAtMs || Date.now(),
          collaborationStatusReasoningText: `${typeof current.collaborationStatusReasoningText === 'string' ? current.collaborationStatusReasoningText : ''}${nextDelta}`,
        }))
        return
      }

      if (payload.kind === 'collaboration_delta') {
        let streamedCollaborationText = null
        setPanelState(matchedPanelKey, (current) => {
          const nextDelta = typeof payload.delta === 'string' ? payload.delta : ''
          const nextBuffer = `${typeof current.collaborationStreamBuffer === 'string' ? current.collaborationStreamBuffer : ''}${nextDelta}`
          if (current.collaborationMode === 'summary_subtask') {
            const displayBuffer = nextBuffer
              .replace(/<subtask_title>[\s\S]*?<\/subtask_title>/giu, '')
              .replace(/<subtask_summary>/giu, '')
              .replace(/<\/subtask_summary>/giu, '')
              .trim()
            streamedCollaborationText = displayBuffer
            return {
              ...current,
              collaborationStreamBuffer: nextBuffer,
              collaborationStatusFirstTokenAtMs: current.collaborationStatusFirstTokenAtMs || (nextDelta.trim() ? Date.now() : 0),
              collaborationStatusText: displayBuffer,
            }
          }
          const parsedCollaborationBuffer = parseAICollaborationStreamBuffer(nextBuffer)
          if (parsedCollaborationBuffer.decision === 'continue') {
            streamedCollaborationText = parsedCollaborationBuffer.bodyText
          }
          return {
            ...current,
            collaborationStreamBuffer: nextBuffer,
            collaborationStatusFirstTokenAtMs: current.collaborationStatusFirstTokenAtMs || (nextDelta.trim() ? Date.now() : 0),
            collaborationStatusText: `${typeof current.collaborationStatusText === 'string' ? current.collaborationStatusText : ''}${nextDelta}`,
          }
        })
        if (streamedCollaborationText !== null) {
          setComposerInputValue(streamedCollaborationText)
        }
        return
      }

      if (payload.kind === 'collaboration_context_condensed' && payload.snapshot) {
        const nextSnapshot = normalizeAIConversationSnapshot(payload.snapshot)
        setConversationList((prev) => upsertConversationSummary(prev, nextSnapshot))
        setPanelState(matchedPanelKey, (current) => {
          if (current.activeConversationId !== nextSnapshot.id) {
            return current
          }
          return {
            ...current,
            conversation: nextSnapshot,
            messages: nextSnapshot.messages,
            apiMessages: nextSnapshot.apiMessages,
            contextTokens: normalizeAIContextTokensValue(payload.newContextTokens),
          }
        })
        void rebuildAIConversationTokenLedger(nextSnapshot, matchedPanelKey)
        return
      }

      if (payload.kind === 'auto_recovery_started') {
        const recoveryRequestId = typeof payload.recoveryRequestId === 'string' ? payload.recoveryRequestId.trim() : ''
        setComposerInputValue('')
        setComposerImages([])
        setPanelState(matchedPanelKey, (current) => {
          const previousAssistantMessageId = typeof current.activeAssistantMessageId === 'string' && current.activeAssistantMessageId.trim()
            ? current.activeAssistantMessageId.trim()
            : (typeof current.activeRequestId === 'string' ? current.activeRequestId.trim() : '')
          const nextMessages = (Array.isArray(current.messages) ? current.messages : []).filter((message) => {
            if (!message || typeof message !== 'object') {
              return true
            }
            if (previousAssistantMessageId && message.id === previousAssistantMessageId && message.kind === 'assistant') {
              return false
            }
            if (previousAssistantMessageId && message.id === `${previousAssistantMessageId}-reasoning` && message.kind === 'reasoning') {
              return false
            }
            return true
          })
          const nextConversation = current.conversation
            ? {
                ...current.conversation,
                messages: nextMessages,
              }
            : current.conversation
          return {
            ...current,
            conversation: nextConversation,
            messages: nextMessages,
            activeRequestId: recoveryRequestId || current.activeRequestId,
            activeAssistantMessageId: '',
            activeToolExecution: null,
            requestPhase: 'idle',
            runtimePhase: 'ready',
            isCondensingContext: true,
            collaborationLocked: true,
            collaborationActive: true,
            collaborationMode: 'summary_subtask',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
            collaborationPendingMode: '',
            collaborationPendingRequestId: '',
            collaborationInterruptedRequestId: '',
            collaborationStatusStartedAtMs: Date.now(),
            collaborationStatusFirstTokenAtMs: 0,
            collaborationStatusText: typeof payload.text === 'string' ? payload.text : '',
            collaborationStatusReasoningText: typeof payload.reasoningText === 'string' ? payload.reasoningText : '',
          }
        })
        return
      }

      if (payload.kind === 'auto_recovery_status') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          collaborationLocked: true,
          collaborationActive: true,
          collaborationMode: 'summary_subtask',
          collaborationStatusText: typeof payload.text === 'string' ? payload.text : '',
          collaborationStatusReasoningText: typeof payload.reasoningText === 'string' ? payload.reasoningText : '',
        }))
        return
      }

      if (payload.kind === 'auto_recovery_run_full_summary') {
        // 统一复用“手动全量摘要”的标准入口，不再保留自动链自己的特殊 requestId/协同态初始化路径
        // 这样子任务创建、摘要请求、继续任务都与手动全量摘要保持同一执行源
        void runAIConversationSummarySubtaskFlow(matchedPanel.conversation || conversation, {
          autoRecoverySubtaskHops: 1,
        })
        return
      }

      if (payload.kind === 'collaboration_finished') {
        if (matchedPanel.collaborationMode === 'summary_subtask') {
          return
        }
        const decision = normalizeAICollaborationDecision(payload.decision)
        const finalCollaborationText = typeof payload.text === 'string' ? payload.text : ''
        const isFallbackFollowup = decision === 'fallback_followup'
        setComposerImages([])
        if (decision === 'continue' && finalCollaborationText.trim()) {
          setComposerInputValue(finalCollaborationText)
          setPanelState(matchedPanelKey, (current) => ({
            ...current,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
            collaborationPendingMode: '',
            collaborationPendingRequestId: '',
            collaborationInterruptedRequestId: '',
            collaborationStatusStartedAtMs: 0,
            collaborationStatusFirstTokenAtMs: 0,
            collaborationStatusText: '',
            collaborationStatusReasoningText: '',
            queuedSubmission: buildAIQueuedSubmission({
              kind: 'chat',
              text: finalCollaborationText,
              images: [],
            }),
            isFlushingQueuedSubmission: false,
          }))
          return
        }
        setComposerInputValue('')
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          collaborationLocked: isFallbackFollowup ? false : current.collaborationLocked,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: isFallbackFollowup,
          collaborationFollowupRequestId: isFallbackFollowup ? requestId : '',
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
          collaborationInterruptedRequestId: '',
          collaborationStatusStartedAtMs: 0,
          collaborationStatusFirstTokenAtMs: 0,
          collaborationStatusText: '',
          collaborationStatusReasoningText: '',
        }))
        return
      }

      if (payload.kind === 'assistant_retry_reset') {
        const assistantMessageId = typeof payload.messageId === 'string' && payload.messageId.trim()
          ? payload.messageId.trim()
          : (matchedPanel.activeAssistantMessageId || requestId)
        setPanelState(matchedPanelKey, (current) => {
          const nextMessages = (Array.isArray(current.messages) ? current.messages : [])
            .filter((message) => {
              if (!message || typeof message !== 'object') {
                return true
              }
              if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
                return false
              }
              if (message.id !== assistantMessageId && message.turnId === assistantMessageId) {
                return false
              }
              return true
            })
            .map((message) => {
              if (message.id !== assistantMessageId || message.kind !== 'assistant') {
                return message
              }
              return {
                ...message,
                text: '▍',
                metrics: [],
                streaming: true,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: true,
                  firstTokenAtMs: 0,
                  statusStartedAtMs: Date.now(),
                  errorText: '',
                },
              }
            })
          const nextApiMessages = trimLatestAssistantAPIHistoryMessage(current.apiMessages)
          return {
            ...current,
            activeAssistantMessageId: assistantMessageId,
            requestPhase: 'streaming',
            runtimePhase: 'api_request',
            messages: nextMessages,
            apiMessages: nextApiMessages,
            lastAssistantTurnId: assistantMessageId,
            lastTurnBusinessMessageKind: '',
          }
        })
        return
      }

      if (payload.kind === 'assistant_replace') {
        let snapshotBeforeAssistantMessagePersist = null
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nextMessages = current.messages.map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            return {
              ...message,
              text: typeof payload.text === 'string' ? payload.text : '',
              metrics: buildMetrics(payload),
              streaming: Boolean(payload.streaming),
              extra: {
                ...(message.extra || {}),
                requestStatusLive: false,
                finishedAtMs: Date.now(),
                errorText: '',
              },
            }
          })
          if (current.conversation) {
            snapshotBeforeAssistantMessagePersist = {
              ...current.conversation,
              updatedAt: Date.now(),
              status: current.conversation.status,
              messages: Array.isArray(current.messages)
                ? current.messages.filter((message) => {
                    if (!message || typeof message !== 'object') {
                      return false
                    }
                    if (message.id === assistantMessageId && (message.kind === 'assistant' || message.kind === 'reasoning')) {
                      return false
                    }
                    return true
                  })
                : [],
              apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
            }
          }
          return {
            ...current,
            messages: nextMessages,
          }
        })
        setProviderBalanceRefreshSignal((current) => current + 1)
        if (snapshotBeforeAssistantMessagePersist) {
          void saveConversationSnapshot(snapshotBeforeAssistantMessagePersist, matchedPanelKey, { hydrate: false })
        }
        return
      }

      if (payload.kind === 'assistant_continue' && typeof payload.messageId === 'string' && payload.messageId.trim()) {
        let snapshotBeforeNextRequest = null
        setPanelState(matchedPanelKey, (current) => {
          if (current.conversation) {
            snapshotBeforeNextRequest = {
              ...current.conversation,
              updatedAt: Date.now(),
              status: 'streaming',
              messages: Array.isArray(current.messages) ? [...current.messages] : [],
              apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
            }
          }
          // 智能压缩就地重试：正式 AI 请求开始的这一刻已不属于助理协同态。
          // 收到 assistant_continue 且当前处于 summary_subtask 协同态时，退出协同态并回落为普通流式。
          const shouldExitSummarySubtaskCollaboration = current.collaborationMode === 'summary_subtask'
          return {
            ...current,
            activeAssistantMessageId: payload.messageId,
            activeToolExecution: null,
            requestPhase: 'streaming',
            messages: [
              ...(Array.isArray(current.messages) ? current.messages : []),
              {
                id: payload.messageId,
                turnId: payload.messageId,
                kind: 'assistant',
                text: '▍',
                time: formatMessageTime(),
                metrics: buildMetrics(payload),
                streaming: true,
                extra: {
                  statusStartedAtMs: Date.now(),
                  firstTokenAtMs: 0,
                  requestStatusLive: true,
                  errorText: '',
                },
              },
            ],
            lastAssistantTurnId: payload.messageId,
            lastTurnBusinessMessageKind: '',
            ...(shouldExitSummarySubtaskCollaboration ? {
              isCondensingContext: false,
              collaborationLocked: shouldLockAssistantCollaboration,
              collaborationActive: false,
              collaborationMode: '',
              collaborationStreamBuffer: '',
              collaborationAwaitingManualFollowup: false,
              collaborationFollowupRequestId: '',
              collaborationPendingMode: '',
              collaborationPendingRequestId: '',
              collaborationInterruptedRequestId: '',
              collaborationStatusStartedAtMs: 0,
              collaborationStatusFirstTokenAtMs: 0,
              collaborationStatusText: '',
              collaborationStatusReasoningText: '',
            } : {}),
          }
        })
        if (snapshotBeforeNextRequest) {
          void saveConversationSnapshot(snapshotBeforeNextRequest, matchedPanelKey, { hydrate: false })
        }
        return
      }

      if (payload.kind === 'append_message' && payload.message) {
        setPanelState(matchedPanelKey, (current) => {
          const fallbackTurnId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            messages: payload.message.kind === 'user'
              ? [...(Array.isArray(current.messages) ? current.messages : []), payload.message]
              : insertMessageBeforeAssistant(current.messages, fallbackTurnId, payload.message),
            ...updateAILastAssistantTurnState(current, payload.message, fallbackTurnId),
          }
        })
        return
      }

      if (payload.kind === 'upsert_message' && payload.message) {
        const completionSound = resolveAIEventSound(
          payload,
          payload.message.kind === 'completion' && String(payload.message.status || '').trim() === '已完成' ? 'completion' : '',
        )
        if (completionSound) {
          playAISound(completionSound)
        }
        const nextMessage = (() => {
          const normalizedMessage = enrichAIChatCommandMessage(payload.message)
          if (normalizedMessage?.kind === 'followup' && normalizeAIMessageStatus(normalizedMessage.status) !== AI_FOLLOWUP_PENDING_STATUS_KEY) {
            return {
              ...normalizedMessage,
              requestId: '',
            }
          }
          return normalizedMessage
        })()
        setPanelState(matchedPanelKey, (current) => {
          const fallbackTurnId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            messages: upsertMessageBeforeAssistant(current.messages, fallbackTurnId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, fallbackTurnId),
          }
        })
        return
      }

      if (payload.kind === 'api_message_append' && payload.message) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          apiMessages: upsertAPIHistoryMessage(current.apiMessages, payload.message, current.messages),
        }))
        return
      }

      if (payload.kind === 'collaboration_force_user_takeover') {
        const takeoverText = typeof payload.text === 'string' ? payload.text.trim() : ''
        if (takeoverText) {
          setComposerInputValue((current) => {
            const currentValue = typeof current === 'string' ? current : ''
            return currentValue ? `${takeoverText}${currentValue}` : takeoverText
          })
        }
        return
      }

      if (payload.kind === 'followup_required' && payload.message) {
        const followupSound = resolveAIEventSound(payload, 'notification')
        if (followupSound) {
          playAISound(followupSound)
        }
        const nextMessage = payload.message
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          const nextMessages = upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage)
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: nextMessages,
                apiMessages: current.apiMessages,
              }
            : null
          return {
            ...current,
            activeRequestId: requestId,
            activeAssistantMessageId: anchorAssistantMessageId,
            activeToolExecution: null,
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            resumeAfterCancelRequestId: '',
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            messages: nextMessages,
            lastAssistantTurnId: anchorAssistantMessageId,
            lastTurnBusinessMessageKind: 'followup',
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'change_review_required' && payload.review) {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeChangeReview: payload.review,
        }))
        if (workspaceTabId && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ai-change-review-required', {
            detail: {
              review: payload.review,
              sessionId: sessionId || '',
              terminalId: terminalId || '',
              tabId: workspaceTabId,
            },
          }))
        }
        return
      }

      if (payload.kind === 'tool_approval_required' && Array.isArray(payload.messages)) {
        const toolApprovalSound = resolveAIEventSound(payload, 'notification', false)
        if (toolApprovalSound) {
          playAISound(toolApprovalSound)
        }
        const rawToolMessages = payload.messages
        const toolMessages = rawToolMessages
          .filter((message: AIMessage) => message && typeof message === 'object')
          .map((message: AIMessage) => message)
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          const lastToolMessage = toolMessages.length > 0 ? toolMessages[toolMessages.length - 1] : null
          let nextMessages = Array.isArray(current.messages) ? [...current.messages] : []
          nextMessages = nextMessages.filter((message) => !toolMessages.some((toolMessage: AIMessage) => toolMessage.id && toolMessage.id === message.id))
          toolMessages.forEach((toolMessage: AIMessage) => {
            nextMessages = insertMessageBeforeAssistant(nextMessages, anchorAssistantMessageId, toolMessage)
          })
          nextConversation = {
            ...conversation,
            updatedAt: Date.now(),
            status: 'awaiting_tool_approval',
            messages: nextMessages,
            apiMessages: current.apiMessages,
          }
          return {
            ...current,
            activeAssistantMessageId: anchorAssistantMessageId,
            activeToolExecution: null,
            toolApprovalMode: typeof payload.approvalMode === 'string' ? payload.approvalMode : '',
            requestPhase: 'awaiting_tool_approval',
            activeChangeReview: typeof payload.approvalMode === 'string' && payload.approvalMode === 'change_review' ? current.activeChangeReview : null,
            conversation: nextConversation,
            messages: nextMessages,
            ...updateAILastAssistantTurnState(current, lastToolMessage, anchorAssistantMessageId),
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_approval_resolved') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          toolApprovalMode: '',
          requestPhase: 'streaming',
          activeChangeReview: null,
        }))
        return
      }

      if (payload.kind === 'tool_execution_started' && payload.message) {
        const nextMessage = enrichAIChatCommandMessage(payload.message)
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            requestPhase: 'running_tool',
            toolApprovalMode: '',
            activeChangeReview: null,
            activeToolExecution: {
              executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
              allowContinue: false,
              allowTerminate: payload.allowTerminate !== false,
              allowTerminalAssignment: false,
            },
            messages: upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, anchorAssistantMessageId),
          }
        })
        return
      }

      if (payload.kind === 'tool_execution_terminal_assignment_required' && payload.message) {
        const terminalAssignmentSound = resolveAIEventSound(payload, 'notification')
        if (terminalAssignmentSound) {
          playAISound(terminalAssignmentSound)
        }
        const nextMessage = enrichAIChatCommandMessage(payload.message)
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            requestPhase: 'awaiting_terminal_assignment',
            toolApprovalMode: '',
            activeChangeReview: null,
            activeToolExecution: {
              executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
              allowContinue: false,
              allowTerminate: payload.allowTerminate !== false,
              allowTerminalAssignment: true,
            },
            messages: upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, anchorAssistantMessageId),
          }
        })
        return
      }

      if (payload.kind === 'tool_execution_action_required' && payload.message) {
        const commandActionSound = resolveAIEventSound(payload, 'notification')
        if (commandActionSound) {
          playAISound(commandActionSound)
        }
        const nextMessage = enrichAIChatCommandMessage(payload.message)
        setPanelState(matchedPanelKey, (current) => {
          const anchorAssistantMessageId = current.activeAssistantMessageId || requestId
          return {
            ...current,
            requestPhase: 'awaiting_command_action',
            toolApprovalMode: '',
            activeChangeReview: null,
            activeToolExecution: {
              executionId: typeof payload.executionId === 'string' ? payload.executionId.trim() : '',
              allowContinue: payload.allowContinue === true,
              allowTerminate: payload.allowTerminate !== false,
              allowTerminalAssignment: false,
            },
            messages: upsertMessageBeforeAssistant(current.messages, anchorAssistantMessageId, nextMessage),
            ...updateAILastAssistantTurnState(current, nextMessage, anchorAssistantMessageId),
          }
        })
        return
      }

      if (payload.kind === 'tool_execution_action_resolved') {
        setPanelState(matchedPanelKey, (current) => ({
          ...current,
          activeToolExecution: null,
          toolApprovalMode: '',
          requestPhase: 'streaming',
          activeChangeReview: null,
        }))
        return
      }

      if (payload.kind === 'tool_execution_persist_requested') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          if (!current.conversation) {
            return current
          }
          nextConversation = {
            ...current.conversation,
            updatedAt: Date.now(),
            status: current.requestPhase === 'streaming' ? 'streaming' : current.conversation.status,
            messages: Array.isArray(current.messages) ? [...current.messages] : [],
            apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
          }
          return {
            ...current,
            conversation: nextConversation,
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_execution_terminated') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: Array.isArray(current.messages) ? [...current.messages] : [],
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            activeToolExecution: null,
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            resumeAfterCancelRequestId: '',
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            messages: nextConversation ? nextConversation.messages : current.messages,
            apiMessages: nextConversation ? nextConversation.apiMessages : current.apiMessages,
            recoverableToolStopReason: 'terminated',
            collaborationLocked: false,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'tool_rejected') {
        let nextConversation = null
        const shouldResumeAfterCancel = matchedPanel.resumeAfterCancelRequestId === requestId
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nextMessages = current.messages.map((message) => {
            if (message.id === assistantMessageId && message.kind === 'assistant') {
              return {
                ...message,
                metrics: Array.isArray(message.metrics) ? message.metrics : [],
                streaming: false,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: false,
                },
              }
            }
            if ((message.kind === 'tool' || message.kind === 'command') && AI_CONVERSATION_DIFF_SUCCESS_STATUSES.size >= 0 && ['待批准', '执行中', AI_FOLLOWUP_PENDING_STATUS_KEY, '排队中, 等待终端空闲'].includes(normalizeAIMessageStatus(message.status))) {
              return {
                ...message,
                status: '已拒绝',
              }
            }
            return message
          })
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: nextMessages,
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            resumeAfterCancelRequestId: '',
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            messages: nextMessages,
            activeToolExecution: null,
            recoverableToolStopReason: 'rejected',
            collaborationLocked: false,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
          }
        })
        if (nextConversation) {
          if (shouldResumeAfterCancel) {
            void (async () => {
              const resumed = await resumeAIChatFromConversation(nextConversation, matchedPanelKey)
              if (!resumed) {
                await saveConversationSnapshot(nextConversation, matchedPanelKey)
              }
            })()
          } else {
            void saveConversationSnapshot(nextConversation, matchedPanelKey)
          }
        }
        return
      }

      if (payload.kind === 'automatic_request_skipped') {
        let nextConversation = null
        setPanelState(matchedPanelKey, (current) => {
          const shouldKeepCollaborationLock = current.collaborationLocked && !current.collaborationAwaitingManualFollowup && Boolean(current.queuedSubmission)
          nextConversation = current.conversation
            ? {
                ...current.conversation,
                updatedAt: Date.now(),
                status: 'idle',
                messages: Array.isArray(current.messages) ? [...current.messages] : [],
                apiMessages: Array.isArray(current.apiMessages) ? [...current.apiMessages] : [],
              }
            : null
          return {
            ...current,
            activeRequestId: '',
            activeAssistantMessageId: '',
            activeToolExecution: null,
            requestPhase: 'idle',
            toolApprovalMode: '',
            runtimePhase: 'ready',
            skipNextAutomaticRequest: false,
            activeChangeReview: null,
            conversation: nextConversation || current.conversation,
            recoverableToolStopReason: '',
            collaborationLocked: shouldKeepCollaborationLock,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: current.collaborationAwaitingManualFollowup,
            collaborationFollowupRequestId: current.collaborationAwaitingManualFollowup ? current.collaborationFollowupRequestId : '',
          }
        })
        if (nextConversation) {
          void saveConversationSnapshot(nextConversation, matchedPanelKey)
        }
        return
      }

      if (payload.kind === 'reasoning_delta') {
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const reasoningId = `${assistantMessageId}-reasoning`
          const currentMessages = Array.isArray(current.messages) ? current.messages : []
          const reasoningIndex = currentMessages.findIndex((message) => message.id === reasoningId && message.kind === 'reasoning')
          const nowMs = Date.now()

          const markAssistantFirstOutput = (messages: AIMessage[]) => messages.map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            const previousFirstTokenAtMs = Number(message.extra?.firstTokenAtMs)
            return {
              ...message,
              extra: {
                ...(message.extra || {}),
                requestStatusLive: true,
                firstTokenAtMs: Number.isFinite(previousFirstTokenAtMs) && previousFirstTokenAtMs > 0 ? previousFirstTokenAtMs : nowMs,
                errorText: '',
              },
            }
          })

          if (reasoningIndex >= 0) {
            const nextMessages = [...currentMessages]
            const previousText = typeof nextMessages[reasoningIndex].text === 'string' ? nextMessages[reasoningIndex].text : ''
            nextMessages[reasoningIndex] = {
              ...nextMessages[reasoningIndex],
              turnId: assistantMessageId,
              text: `${previousText}${payload.delta || ''}`,
              duration: '',
            }
            return {
              ...current,
              messages: markAssistantFirstOutput(nextMessages),
            }
          }

          return {
            ...current,
            messages: markAssistantFirstOutput(insertMessageBeforeAssistant(currentMessages, assistantMessageId, {
              id: reasoningId,
              turnId: assistantMessageId,
              kind: 'reasoning',
              text: payload.delta || '',
              duration: '',
            })),
          }
        })
        return
      }

      if (payload.kind === 'delta') {
        setPanelState(matchedPanelKey, (current) => {
          const assistantMessageId = current.activeAssistantMessageId || requestId
          const nowMs = Date.now()
          return {
            ...current,
            messages: current.messages.map((message) => {
              if (message.id !== assistantMessageId || message.kind !== 'assistant') {
                return message
              }
              const baseText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '') : ''
              const previousFirstTokenAtMs = Number(message.extra?.firstTokenAtMs)
              return {
                ...message,
                text: `${baseText}${payload.delta || ''}▍`,
                metrics: [],
                streaming: true,
                extra: {
                  ...(message.extra || {}),
                  requestStatusLive: true,
                  firstTokenAtMs: Number.isFinite(previousFirstTokenAtMs) && previousFirstTokenAtMs > 0 ? previousFirstTokenAtMs : nowMs,
                  errorText: '',
                },
              }
            }),
          }
        })
        return
      }

      if (payload.kind === 'done') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const metrics = buildMetrics(payload)
        const reasoningDuration = buildReasoningDuration(payload)
        const shouldClearSummarySubtaskCollaboration = matchedPanel.collaborationMode === 'summary_subtask'
        const nextMessages = matchedPanel.messages.map((message) => {
          if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
            return {
              ...message,
              duration: reasoningDuration,
            }
          }
          if (message.id !== assistantMessageId || message.kind !== 'assistant') {
            return message
          }
          return {
            ...message,
            text: payload.text || String(message.text || '').replace(/▍$/u, ''),
            metrics,
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              finishedAtMs: Date.now(),
              errorText: '',
            },
          }
        })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'idle',
          messages: nextMessages,
          apiMessages: upsertAPIHistoryMessage(
            matchedPanel.apiMessages,
            {
              role: 'assistant',
              content: payload.text || '',
              messageId: `api-${assistantMessageId}`,
              turnId: assistantMessageId,
              ts: Date.now(),
            },
            nextMessages,
          ),
        }

        if (shouldClearSummarySubtaskCollaboration) {
          setComposerInputValue('')
          setComposerImages([])
        }
        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          skipNextAutomaticRequest: false,
          isCondensingContext: false,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: nextConversation.apiMessages,
          recoverableToolStopReason: '',
          collaborationLocked: shouldClearSummarySubtaskCollaboration ? false : matchedPanel.collaborationLocked,
          collaborationActive: shouldClearSummarySubtaskCollaboration ? false : matchedPanel.collaborationActive,
          collaborationMode: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationMode,
          collaborationStreamBuffer: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationStreamBuffer,
          collaborationAwaitingManualFollowup: shouldClearSummarySubtaskCollaboration ? false : matchedPanel.collaborationAwaitingManualFollowup,
          collaborationFollowupRequestId: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationFollowupRequestId,
          collaborationPendingMode: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationPendingMode,
          collaborationPendingRequestId: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationPendingRequestId,
          collaborationInterruptedRequestId: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationInterruptedRequestId,
          collaborationStatusStartedAtMs: shouldClearSummarySubtaskCollaboration ? 0 : matchedPanel.collaborationStatusStartedAtMs,
          collaborationStatusFirstTokenAtMs: shouldClearSummarySubtaskCollaboration ? 0 : matchedPanel.collaborationStatusFirstTokenAtMs,
          collaborationStatusText: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationStatusText,
          collaborationStatusReasoningText: shouldClearSummarySubtaskCollaboration ? '' : matchedPanel.collaborationStatusReasoningText,
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        setProviderBalanceRefreshSignal((current) => current + 1)
        return
      }

      if (payload.kind === 'error') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const finalErrorText = payload.error || translate('请求失败')
        playAISound('progress')

        const nextMessages = matchedPanel.messages
          .filter((message) => !(message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning'))
          .map((message) => {
            if (message.id !== assistantMessageId || message.kind !== 'assistant') {
              return message
            }
            return {
              ...message,
              text: '',
              metrics: [],
              streaming: false,
              extra: {
                ...(message.extra || {}),
                requestStatusLive: false,
                errorText: finalErrorText,
              },
            }
          })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'error',
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        }

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          toolApprovalMode: '',
          runtimePhase: 'ready',
          skipNextAutomaticRequest: false,
          isCondensingContext: false,
          activeChangeReview: null,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
          recoverableToolStopReason: '',
          collaborationLocked: false,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }

      if (payload.kind === 'cancelled') {
        const assistantMessageId = matchedPanel.activeAssistantMessageId || requestId
        const nextMessages = matchedPanel.messages.filter((message) => {
          if (message.id === `${assistantMessageId}-reasoning` && message.kind === 'reasoning') {
            return false
          }
          if (message.id === assistantMessageId && message.kind === 'assistant') {
            return false
          }
          return true
        })
        const nextConversation = {
          ...conversation,
          updatedAt: Date.now(),
          status: 'idle',
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
        }

        setPanelState(matchedPanelKey, {
          ...matchedPanel,
          activeRequestId: '',
          activeAssistantMessageId: '',
          activeToolExecution: null,
          requestPhase: 'idle',
          toolApprovalMode: '',
          runtimePhase: 'ready',
          skipNextAutomaticRequest: false,
          isCondensingContext: false,
          activeChangeReview: null,
          conversation: nextConversation,
          messages: nextMessages,
          apiMessages: matchedPanel.apiMessages,
          recoverableToolStopReason: '',
          collaborationLocked: false,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
        })

        void saveConversationSnapshot(nextConversation, matchedPanelKey)
        return
      }
    })

    return () => {
      if (unbind) {
        unbind()
      }
    }
  }, [enrichAIChatCommandMessage, playAISound, rebuildAIConversationTokenLedger, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration])

  useEffect(() => {
    const pendingRequestId = typeof panelState.collaborationPendingRequestId === 'string' ? panelState.collaborationPendingRequestId.trim() : ''
    const pendingMode = typeof panelState.collaborationPendingMode === 'string' ? panelState.collaborationPendingMode.trim() : ''
    if (!pendingRequestId || pendingRequestId !== panelState.activeRequestId || !activeConversation) {
      return undefined
    }
    if (!shouldLockAssistantCollaboration && pendingMode !== 'forced') {
      setPanelState(panelInstanceKey, (current) => {
        if (current.collaborationPendingRequestId !== pendingRequestId) {
          return current
        }
        return {
          ...current,
          collaborationLocked: false,
          collaborationActive: false,
          collaborationMode: '',
          collaborationStreamBuffer: '',
          collaborationAwaitingManualFollowup: false,
          collaborationFollowupRequestId: '',
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
          collaborationInterruptedRequestId: pendingRequestId,
          collaborationStatusStartedAtMs: 0,
          collaborationStatusFirstTokenAtMs: 0,
          collaborationStatusText: '',
          collaborationStatusReasoningText: '',
        }
      })
      return undefined
    }
    const hasRenderedPendingCard = pendingMode === 'followup'
      ? panelState.messages.some((message) => message?.kind === 'followup' && typeof message?.requestId === 'string' && message.requestId.trim() === pendingRequestId)
      : (pendingMode === 'completion'
        ? panelState.messages.some((message) => message?.kind === 'completion' && message?.turnId === panelState.activeAssistantMessageId && normalizeAIMessageStatus(message?.status) === '等待处理')
        : false)
    if (!hasRenderedPendingCard) {
      return undefined
    }
    let disposed = false
    const frameId = window.requestAnimationFrame(() => {
      if (disposed) {
        return
      }
      setPanelState(panelInstanceKey, (current) => {
        if (current.activeRequestId !== pendingRequestId || current.collaborationPendingRequestId !== pendingRequestId) {
          return current
        }
        return {
          ...current,
          collaborationPendingMode: '',
          collaborationPendingRequestId: '',
        }
      })
      void startAIChatCollaboration(pendingRequestId).catch(() => {
        if (disposed) {
          return
        }
        setPanelState(panelInstanceKey, (current) => {
          if (current.activeRequestId !== pendingRequestId) {
            return current
          }
          return {
            ...current,
            collaborationLocked: false,
            collaborationActive: false,
            collaborationMode: '',
            collaborationStreamBuffer: '',
            collaborationAwaitingManualFollowup: false,
            collaborationFollowupRequestId: '',
            collaborationPendingMode: '',
            collaborationPendingRequestId: '',
            collaborationStatusStartedAtMs: 0,
            collaborationStatusFirstTokenAtMs: 0,
            collaborationStatusText: '',
            collaborationStatusReasoningText: '',
          }
        })
      })
    })
    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
    }
  }, [activeConversation, panelInstanceKey, panelState.activeAssistantMessageId, panelState.activeRequestId, panelState.collaborationPendingMode, panelState.collaborationPendingRequestId, panelState.messages, setPanelState, shouldLockAssistantCollaboration])  useEffect(() => {
    if (
      !shouldLockAssistantCollaboration
      || !activeConversation
      || panelState.requestPhase !== 'streaming'
      || !panelState.activeRequestId
      || panelState.collaborationLocked
      || panelState.collaborationInterruptedRequestId === panelState.activeRequestId
    ) {
      return
    }
    setPanelState(panelInstanceKey, (current) => {
      if (
        !current.conversation
        || current.requestPhase !== 'streaming'
        || !current.activeRequestId
        || current.collaborationLocked
        || current.collaborationInterruptedRequestId === current.activeRequestId
      ) {
        return current
      }
      return {
        ...current,
        collaborationLocked: true,
      }
    })
  }, [activeConversation, panelInstanceKey, panelState.activeRequestId, panelState.collaborationInterruptedRequestId, panelState.collaborationLocked, panelState.requestPhase, setPanelState, shouldLockAssistantCollaboration])}
