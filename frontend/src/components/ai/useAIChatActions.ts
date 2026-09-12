import { useCallback, useEffect } from 'react'
import type * as React from 'react'
import { approveAIChatTools, assignAIChatToolTerminal, cancelAIChat, continueAIChatTool, disableAIChatCollaboration, listAIChatCommandTerminalCandidates, previewAIChatToolDiff, previewAIChatToolRestore, reapplyAIChatTool, rejectAIChatTools, rejectAIChatToolsForQueuedSubmission, restoreAIChatTool, setAIChatSkipNextAutomaticRequest, terminateAIChatTool } from './aiChatBridge.ts'
import { AI_CONVERSATION_DIFF_SUCCESS_STATUSES, AI_CONVERSATION_DIFF_TOOL_NAMES, normalizeAIMessageStatus } from './aiChatLogic.ts'
import type { AIConversationSnapshot, AIPanelProps, PanelState } from './aiChatLogic.ts'
import { t as translate, type I18nKey } from '../../i18n.ts'
import { warnDev } from '../../utils/devLog.ts'
import type { AIGlobalSettings } from './aiGlobalSettingsBridge.ts'

// AI 请求动作 hook：取消/停止并恢复/恢复任务、工具批准/拒绝/继续/终止、
// 还原预览与应用、命令终端候选与指派、跳过下次自动请求、协同中断、
// 排队提交取消与队列冲刷 effect。
// 从 AIConversationTabPanel 原样搬移，闭包依赖经参数同名注入，代码零改动。
export function useAIChatActions({ addToast, terminalId, workspaceTabId, activeConversation, panelState, panelInstanceKey, terminalPanelsRef, panelMountedRef, setPanelState, showAlert, clearRestorePreview, terminalLabelMap, isQueueBlocked, handleSendMessage, handleRetryAssistantMessage, resumeAIChatFromConversation, normalizedGlobalAISettings }: {
  addToast?: AIPanelProps['addToast']
  terminalId: string
  workspaceTabId: string
  activeConversation: AIConversationSnapshot | null
  panelState: PanelState
  panelInstanceKey: string
  terminalPanelsRef: React.RefObject<Record<string, PanelState>>
  panelMountedRef: React.RefObject<boolean>
  setPanelState: (panelKey: string, updater: ((current: PanelState) => PanelState) | Partial<PanelState>) => PanelState
  showAlert: (message: string) => Promise<void>
  clearRestorePreview: () => void
  terminalLabelMap: Map<string, string>
  isQueueBlocked: boolean
  handleSendMessage: (text: string, sendOptionsOrEditState?: Record<string, unknown> | null, explicitEditState?: Record<string, unknown> | null, runtimeOptions?: Record<string, unknown>) => Promise<boolean>
  handleRetryAssistantMessage: (messageId: string) => Promise<boolean>
  resumeAIChatFromConversation: (conversationSnapshot: AIConversationSnapshot, targetPanelKey?: string, options?: Record<string, unknown>) => Promise<boolean>
  normalizedGlobalAISettings: AIGlobalSettings
}) {
  const handleCancelMessage = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await cancelAIChat(panelState.activeRequestId)
  }, [panelState.activeRequestId])
  const handleStopAndResumeMessage = useCallback(async () => {
    if (!panelState.activeRequestId || !activeConversation) {
      return
    }
    const requestId = panelState.activeRequestId
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      resumeAfterCancelRequestId: requestId,
    }))
    try {
      await cancelAIChat(requestId)
    } catch {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        resumeAfterCancelRequestId: '',
      }))
    }
  }, [activeConversation, panelInstanceKey, panelState.activeRequestId, setPanelState])
  const handleResumeTask = useCallback(async () => {
    const currentPanel = terminalPanelsRef.current[panelInstanceKey] || null
    const conversationSnapshot = currentPanel?.conversation || activeConversation
    if (!conversationSnapshot) {
      return false
    }
    return resumeAIChatFromConversation(conversationSnapshot, panelInstanceKey)
  }, [activeConversation, panelInstanceKey, resumeAIChatFromConversation])
  const handleApproveTools = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    try {
      await approveAIChatTools(panelState.activeRequestId)
    } catch (error) {
      // 批准失败（如批次已被丢弃）必须可见，否则按钮看起来像点不动
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('操作失败'))
    }
  }, [panelState.activeRequestId, showAlert])
  const handleRejectTools = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    try {
      if (normalizedGlobalAISettings.continueAfterToolRejection !== false) {
        await rejectAIChatTools(panelState.activeRequestId)
        return
      }
      await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
    } catch (error) {
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('操作失败'))
    }
  }, [normalizedGlobalAISettings.continueAfterToolRejection, panelState.activeRequestId, showAlert])
  const handleContinueTool = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await continueAIChatTool(panelState.activeRequestId)
  }, [panelState.activeRequestId])
  const handleTerminateTool = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return
    }
    await terminateAIChatTool(panelState.activeRequestId)
  }, [panelState.activeRequestId])
  const handlePreviewRestore = useCallback(async (restoreArtifactPath: string) => {
    try {
      const review = await previewAIChatToolRestore(restoreArtifactPath, terminalId)
      if (typeof window !== 'undefined' && review && typeof review === 'object') {
        window.dispatchEvent(new CustomEvent('ai-change-review-preview', {
          detail: { sessionId: terminalId, tabId: workspaceTabId, review },
        }))
      } else {
        // 后端成功但载荷不可用：不派发事件会导致预览窗口无任何表现，开发期必须可见
        warnDev('还原预览未派发：后端未返回有效的 review 载荷', { restoreArtifactPath, review })
      }
    } catch (error) {
      // error.message 为后端动态文案（可能不在翻译表），translate() 内部有兜底
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('当前状态不支持还原'))
    }
  }, [showAlert, terminalId, workspaceTabId])
  const handlePreviewDiff = useCallback(async (restoreArtifactPath: string) => {
    try {
      const review = await previewAIChatToolDiff(restoreArtifactPath, terminalId)
      return review && typeof review === 'object' ? review : null
    } catch {
      return null
    }
  }, [terminalId])
  const updateRestoreActionState = useCallback((artifactPaths: string[], restored: boolean) => {
    const targets = new Set(artifactPaths.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))
    if (targets.size === 0) {
      return
    }
    setPanelState(panelInstanceKey, (current) => {
      let changed = false
      const messages = current.messages.map((message) => {
        if (!message || typeof message !== 'object' || message.kind !== 'tool') {
          return message
        }
        const extra = message.extra && typeof message.extra === 'object' ? message.extra : {}
        const artifactPath = typeof extra.restoreArtifactPath === 'string' ? extra.restoreArtifactPath.trim() : ''
        if (!targets.has(artifactPath)) {
          return message
        }
        changed = true
        return { ...message, extra: { ...extra, restoreActionState: restored ? 'restored' : 'applied' } }
      })
      return changed ? { ...current, messages } : current
    })
  }, [panelInstanceKey, setPanelState])
  const handleApplyRestore = useCallback(async (restoreArtifactPath: string) => {
    try {
      await restoreAIChatTool(restoreArtifactPath, terminalId)
      updateRestoreActionState([restoreArtifactPath], true)
      clearRestorePreview()
      addToast?.(translate('已还原'), 'success', 3200)
      return true
    } catch (error) {
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('当前状态不支持还原'))
      return false
    }
  }, [addToast, clearRestorePreview, showAlert, terminalId, translate, updateRestoreActionState])
  const handleRestoreToHere = useCallback(async (restoreArtifactPath: string) => {
    const targetArtifactPath = typeof restoreArtifactPath === 'string' ? restoreArtifactPath.trim() : ''
    if (!targetArtifactPath) {
      return false
    }
    const paths: string[] = []
    for (let index = panelState.messages.length - 1; index >= 0; index -= 1) {
      const message = panelState.messages[index] as Record<string, unknown>
      if (!message || message.kind !== 'tool') {
        continue
      }
      const toolName = typeof message.actionLabel === 'string' ? message.actionLabel.trim() : ''
      const status = normalizeAIMessageStatus(message.status)
      const extra = message.extra && typeof message.extra === 'object' ? message.extra as Record<string, unknown> : {}
      const artifactPath = typeof extra.restoreArtifactPath === 'string' ? extra.restoreArtifactPath.trim() : ''
      if (!AI_CONVERSATION_DIFF_TOOL_NAMES.has(toolName) || !AI_CONVERSATION_DIFF_SUCCESS_STATUSES.has(status) || !artifactPath || extra.restoreActionState === 'restored') {
        continue
      }
      paths.push(artifactPath)
      if (artifactPath === targetArtifactPath) {
        break
      }
    }
    if (paths.length === 0 || paths[paths.length - 1] !== targetArtifactPath) {
      await showAlert(translate('当前状态不支持还原'))
      return false
    }
    try {
      for (const artifactPath of paths) {
        await restoreAIChatTool(artifactPath, terminalId)
        updateRestoreActionState([artifactPath], true)
      }
      clearRestorePreview()
      addToast?.(translate('已还原'), 'success', 3200)
      return true
    } catch (error) {
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('当前状态不支持还原'))
      return false
    }
  }, [addToast, clearRestorePreview, panelState.messages, showAlert, terminalId, translate, updateRestoreActionState])
  const handleReapplyRestore = useCallback(async (restoreArtifactPath: string) => {
    try {
      await reapplyAIChatTool(restoreArtifactPath, terminalId)
      updateRestoreActionState([restoreArtifactPath], false)
      clearRestorePreview()
      addToast?.(translate('已重新应用'), 'success', 3200)
      return true
    } catch (error) {
      await showAlert(error instanceof Error ? translate(error.message as I18nKey) : translate('当前状态不支持重新应用'))
      return false
    }
  }, [addToast, clearRestorePreview, showAlert, terminalId, translate, updateRestoreActionState])
  const handleListCommandTerminalCandidates = useCallback(async () => {
    if (!panelState.activeRequestId) {
      return []
    }
    const candidates = await listAIChatCommandTerminalCandidates(panelState.activeRequestId)
    return candidates.map((candidate) => ({
      ...candidate,
      label: terminalLabelMap.get(candidate.sessionId) || candidate.sessionId,
      current: candidate.current === true || candidate.sessionId === terminalId,
    }))
  }, [panelState.activeRequestId, terminalId, terminalLabelMap])
  const handleAssignToolTerminal = useCallback(async (targetSessionId: string) => {
    if (!panelState.activeRequestId) {
      return
    }
    await assignAIChatToolTerminal(panelState.activeRequestId, targetSessionId)
  }, [panelState.activeRequestId])
  const handleToggleSkipNextAutomaticRequest = useCallback(async (enabled: boolean) => {
    let targetRequestId = ''
    setPanelState(panelInstanceKey, (current) => {
      targetRequestId = current.activeRequestId || ''
      return {
        ...current,
        skipNextAutomaticRequest: Boolean(enabled),
      }
    })
    if (targetRequestId) {
      try {
        await setAIChatSkipNextAutomaticRequest(targetRequestId, Boolean(enabled))
      } catch {}
    }
  }, [panelInstanceKey, setPanelState])
  const handleInterruptCollaboration = useCallback(async () => {
    let targetRequestId = ''
    let targetMode = ''
    setPanelState(panelInstanceKey, (current) => {
      targetRequestId = current.activeRequestId || ''
      targetMode = typeof current.collaborationMode === 'string' ? current.collaborationMode.trim() : ''
      return {
        ...current,
        activeRequestId: targetMode === 'summary_subtask' ? '' : current.activeRequestId,
        isCondensingContext: targetMode === 'summary_subtask' ? false : current.isCondensingContext,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
        collaborationPendingMode: '',
        collaborationPendingRequestId: '',
        collaborationInterruptedRequestId: targetRequestId,
        collaborationStatusStartedAtMs: 0,
        collaborationStatusFirstTokenAtMs: 0,
        collaborationStatusText: '',
        collaborationStatusReasoningText: '',
      }
    })
    if (targetRequestId) {
      try {
        if (targetMode === 'summary_subtask') {
          await cancelAIChat(targetRequestId)
        } else {
          await disableAIChatCollaboration(targetRequestId)
        }
      } catch {}
    }
  }, [panelInstanceKey, setPanelState])
  const handleCancelQueuedSubmission = useCallback(() => {
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
    }))
  }, [panelInstanceKey, setPanelState])
  useEffect(() => {
    const queuedSubmission = panelState.queuedSubmission
    if (!queuedSubmission || panelState.isFlushingQueuedSubmission || isQueueBlocked) {
      return
    }

    let disposed = false

    setPanelState(panelInstanceKey, (current) => {
      if (!current.queuedSubmission || current.queuedSubmission.id !== queuedSubmission.id) {
        return current
      }
      return {
        ...current,
        isFlushingQueuedSubmission: true,
      }
    })

    void (async () => {
      try {
        if (queuedSubmission.kind === 'retry_assistant') {
          await handleRetryAssistantMessage(queuedSubmission.targetMessageId);
        } else {
          await handleSendMessage(
            queuedSubmission.text,
            { images: queuedSubmission.images },
            queuedSubmission.kind === 'chat'
              ? null
              : {
                  mode: queuedSubmission.kind === 'edit' ? 'edit' : 'retry',
                  targetMessageId: queuedSubmission.targetMessageId,
                  targetMessageText: queuedSubmission.targetMessageText,
                },
            {
              forceImmediate: true,
              toolScope: queuedSubmission.toolScope,
              toolScopeSlot: queuedSubmission.toolScopeSlot,
              forceNewConversation: queuedSubmission.forceNewConversation === true,
            },
          );
        }
      } finally {
        if (!disposed || panelMountedRef.current) {
          setPanelState(panelInstanceKey, (current) => {
            if (!current.queuedSubmission || current.queuedSubmission.id !== queuedSubmission.id) {
              return {
                ...current,
                isFlushingQueuedSubmission: false,
              }
            }
            return {
              ...current,
              queuedSubmission: null,
              isFlushingQueuedSubmission: false,
            }
          })
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [handleRetryAssistantMessage, handleSendMessage, isQueueBlocked, panelInstanceKey, panelState.isFlushingQueuedSubmission, panelState.queuedSubmission, setPanelState])
  return {
    handleCancelMessage,
    handleStopAndResumeMessage,
    handleResumeTask,
    handleApproveTools,
    handleRejectTools,
    handleContinueTool,
    handleTerminateTool,
    handlePreviewRestore,
    handlePreviewDiff,
    handleApplyRestore,
    handleRestoreToHere,
    handleReapplyRestore,
    handleListCommandTerminalCandidates,
    handleAssignToolTerminal,
    handleToggleSkipNextAutomaticRequest,
    handleInterruptCollaboration,
    handleCancelQueuedSubmission,
  }
}
