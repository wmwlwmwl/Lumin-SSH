import { useCallback, useEffect } from 'react'
import type * as React from 'react'
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js'
import { getLanguage, t as translate, type I18nKey } from '../../i18n.ts'
import { getAIProviderState } from './aiProviderBridge.ts'
import { rejectAIChatToolsForQueuedSubmission, resolveAIChatFollowup, startAIChat } from './aiChatBridge.ts'
import { buildAIFollowupAnswerPayload, buildAIQueuedSubmission, buildRequestMessages, computeAILastAssistantTurnState, createAPIHistoryMessage, findLatestAIFollowupMessageByRequestId, normalizeMessageImages, shouldUseAssistantFirstReplyForConversation, truncateConversationTitle, AI_FOLLOWUP_COMPLETED_STATUS_KEY } from './aiChatLogic.ts'
import type { AIConversationSnapshot, AIMessage, PanelState } from './aiChatLogic.ts'
import { condenseAIConversationContext, createAIConversation, createAIConversationSummarySubtask, getAIAssistantFirstReply, normalizeAIConversationSnapshot, normalizeAIConversationTaskSettings, preprocessAIConversationLongText, readAIConversationWrappedFile } from './aiConversationBridge.ts'
import { buildExecutionContextDetails, getExecutionContextSnapshot } from './aiExecutionContext.ts'
import { saveAIGlobalSettings, type AIGlobalSettings } from './aiGlobalSettingsBridge.ts'
import { processRemoteFileMentions } from './aiMentions.ts'
import { expandFirstSlashCommandForPrompt } from './aiSlashCommands.ts'
import { compressTerminalOutputForPrompt } from './aiTerminalScreen.ts'
import { buildAIConversationSummarySubtaskContinuePrompt, formatMessageTime } from './aiTimeFormat.ts'
import { upsertConversationSummary, type ConversationSummary } from './aiConversationSummary.ts'
import type { AIProviderState } from './aiProviderBridge.ts'
import type { AIProviderLike } from './AIProviderSelector.tsx'

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

// AI 请求主链路 hook：发送消息（含队列排队/临时会话/主题调色/@提及/斜杠命令展开）、
// followup 应答、用户消息重试/编辑/删除、助理消息重试、上下文压缩（快速/全量摘要子任务）、
// 会话恢复请求与主题调色启动事件。
// 从 AIConversationTabPanel 原样搬移，闭包依赖经参数同名注入，代码零改动。
export function useAIChatRequests({ t, terminalId, sessionId, workspaceTabId, isWorkspaceTabActive, activeConversation, panelState, panelInstanceKey, terminalPanelsRef, sendPerfMetricsRef, setPanelState, setConversationList, setAIProviderState, setGlobalAISettings, setComposerEditState, setComposerInputValue, setComposerImages, resetComposerEditState, requestConversationSmoothScrollToBottom, clearRestorePreview, truncateConversationAfterMessage, saveConversationSnapshot, rebuildAIConversationTokenLedger, showAlert, requestDeleteConfirmation, resolveAvailableProviderId, buildConversationWithProviderId, resolveAIRequestModelMeta, setThemeToolPreview, globalAISettings, normalizedGlobalAISettings, aiProviderState, availableAIProviders, composerEditState, composerImages, temporarySessionEnabled, isDevilMode, isQueueBlocked, isArchivedAgentConversation, runtimePhase, effectiveProviderId, effectiveAutoApprovalEnabled, shouldLockAssistantCollaboration, collaborationFollowupInteractionLocked, terminalOutputLineLimit, terminalOutputCharacterLimit }: {
  t: LooseT
  terminalId: string
  sessionId: string
  workspaceTabId: string
  isWorkspaceTabActive: boolean
  activeConversation: AIConversationSnapshot | null
  panelState: PanelState
  panelInstanceKey: string
  terminalPanelsRef: React.RefObject<Record<string, PanelState>>
  sendPerfMetricsRef: React.RefObject<Map<string, import('./aiChatLogic.ts').PerfRecord>>
  setPanelState: (panelKey: string, updater: ((current: PanelState) => PanelState) | Partial<PanelState>) => PanelState
  setConversationList: React.Dispatch<React.SetStateAction<ConversationSummary[]>>
  setAIProviderState: React.Dispatch<React.SetStateAction<AIProviderState>>
  setGlobalAISettings: React.Dispatch<React.SetStateAction<AIGlobalSettings | null>>
  setComposerEditState: React.Dispatch<React.SetStateAction<import('./aiChatLogic.ts').ComposerEditState>>
  setComposerInputValue: React.Dispatch<React.SetStateAction<string>>
  setComposerImages: React.Dispatch<React.SetStateAction<string[]>>
  resetComposerEditState: () => void
  requestConversationSmoothScrollToBottom: () => void
  clearRestorePreview: () => void
  truncateConversationAfterMessage: (conversation: AIConversationSnapshot, messageId: string) => AIConversationSnapshot
  saveConversationSnapshot: (snapshot: AIConversationSnapshot, targetPanelKey?: string, options?: { hydrate?: boolean }) => Promise<AIConversationSnapshot | undefined>
  rebuildAIConversationTokenLedger: (snapshot: AIConversationSnapshot, targetPanelKey?: string) => Promise<number>
  showAlert: (message: string) => Promise<void>
  requestDeleteConfirmation: (message: string) => Promise<boolean>
  resolveAvailableProviderId: (providers: AIProviderLike[], preferredProviderId?: string) => string
  buildConversationWithProviderId: (snapshot: AIConversationSnapshot, providerId: string) => AIConversationSnapshot
  resolveAIRequestModelMeta: (providerId?: string, providers?: AIProviderLike[] | null) => Record<string, unknown>
  setThemeToolPreview: React.Dispatch<React.SetStateAction<unknown>>
  globalAISettings: AIGlobalSettings | null
  normalizedGlobalAISettings: AIGlobalSettings
  aiProviderState: AIProviderState
  availableAIProviders: Awaited<ReturnType<typeof getAIProviderState>>['providers']
  composerEditState: import('./aiChatLogic.ts').ComposerEditState
  composerImages: string[]
  temporarySessionEnabled: boolean
  isDevilMode: boolean
  isQueueBlocked: boolean
  isArchivedAgentConversation: boolean
  runtimePhase: string
  effectiveProviderId: string
  effectiveAutoApprovalEnabled: unknown
  shouldLockAssistantCollaboration: boolean
  collaborationFollowupInteractionLocked: boolean
  terminalOutputLineLimit: number
  terminalOutputCharacterLimit: number
}) {
  const handleSendMessage = useCallback(async (text: string, sendOptionsOrEditState: Record<string, unknown> | null = null, explicitEditState: Record<string, unknown> | null = null, runtimeOptions: Record<string, unknown> = {}) => {
    const perfStages: Array<{ label: string; ms: number }> = []
    let perfLastMark = performance.now()
    const recordPerfStage = (label: string) => {
      const now = performance.now()
      perfStages.push({ label, ms: now - perfLastMark })
      perfLastMark = now
    }
    let sendOptions = null
    let overrideEditState = explicitEditState
    if (sendOptionsOrEditState && typeof sendOptionsOrEditState === 'object' && (sendOptionsOrEditState.mode === 'edit' || sendOptionsOrEditState.mode === 'retry')) {
      overrideEditState = sendOptionsOrEditState
    } else {
      sendOptions = sendOptionsOrEditState
    }

    const normalizedRuntimeOptions = runtimeOptions && typeof runtimeOptions === 'object' ? runtimeOptions : {}
    const nextText = typeof text === 'string' ? text.trim() : ''
    const messageImages = normalizeMessageImages(sendOptions?.images ?? composerImages)
    if (!nextText && messageImages.length === 0) {
      return false
    }

    clearRestorePreview()

    const targetConversationFromOptions = normalizedRuntimeOptions?.targetConversationSnapshot && typeof normalizedRuntimeOptions.targetConversationSnapshot === 'object'
      ? normalizedRuntimeOptions.targetConversationSnapshot as AIConversationSnapshot
      : null
    const activeConversationToolScope = typeof activeConversation?.toolScope === 'string' ? activeConversation.toolScope.trim() : ''
    const activeConversationToolScopeSlot = typeof activeConversation?.toolScopeSlot === 'string' ? activeConversation.toolScopeSlot.trim() : ''
    const effectiveToolScope = typeof normalizedRuntimeOptions?.toolScope === 'string' && normalizedRuntimeOptions.toolScope.trim()
      ? normalizedRuntimeOptions.toolScope.trim()
      : activeConversationToolScope
    const effectiveToolScopeSlot = typeof normalizedRuntimeOptions?.toolScopeSlot === 'string' && normalizedRuntimeOptions.toolScopeSlot.trim()
      ? normalizedRuntimeOptions.toolScopeSlot.trim()
      : activeConversationToolScopeSlot
    const isThemeTuningConversation = effectiveToolScope === 'theme_tuning'
    let targetConversationSnapshot = normalizedRuntimeOptions?.forceNewConversation === true ? null : (targetConversationFromOptions || activeConversation)
    if (temporarySessionEnabled && targetConversationSnapshot?.transient !== true && !effectiveToolScope) {
      targetConversationSnapshot = null
    }
    if (!temporarySessionEnabled && targetConversationSnapshot?.transient === true && !effectiveToolScope) {
      targetConversationSnapshot = null
    }
    if (targetConversationSnapshot?.archived === true && targetConversationSnapshot?.relationType === 'agent') {
      return false
    }
    const activeComposerState = overrideEditState || composerEditState
    const isEditingExistingMessage = activeComposerState?.mode === 'edit' && activeComposerState?.targetMessageId
    const isRetryingMessage = activeComposerState?.mode === 'retry' && activeComposerState?.targetMessageId

    const latestProviderState = await getAIProviderState().catch(() => ({
      currentProviderId: typeof aiProviderState?.currentProviderId === 'string' ? aiProviderState.currentProviderId.trim() : '',
      providers: availableAIProviders,
    }))
    recordPerfStage('获取供应商状态')
    const latestProviders = Array.isArray(latestProviderState?.providers) ? latestProviderState.providers : []
    const preferredProviderId = targetConversationSnapshot
      ? (targetConversationSnapshot.settings && typeof targetConversationSnapshot.settings === 'object'
        ? (targetConversationSnapshot.settings as Record<string, unknown>).currentProviderId
        : undefined)
      : latestProviderState?.currentProviderId
    const resolvedProviderId = resolveAvailableProviderId(latestProviders, typeof preferredProviderId === 'string' ? preferredProviderId : undefined)
    const nextConversationSnapshot = targetConversationSnapshot
      ? buildConversationWithProviderId(targetConversationSnapshot, resolvedProviderId)
      : null

    setAIProviderState({
      currentProviderId: resolvedProviderId,
      providers: latestProviders,
    })

    if (targetConversationSnapshot && nextConversationSnapshot !== targetConversationSnapshot) {
      targetConversationSnapshot = nextConversationSnapshot
      setConversationList((prev) => upsertConversationSummary(prev, nextConversationSnapshot!))
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextConversationSnapshot,
      }))
      // 此分支内 targetConversationSnapshot 非空，nextConversationSnapshot 必为快照
      await saveConversationSnapshot(nextConversationSnapshot!, panelInstanceKey)
    } else if (!targetConversationSnapshot && !isThemeTuningConversation) {
      const currentGlobalProviderId = typeof latestProviderState?.currentProviderId === 'string' ? latestProviderState.currentProviderId.trim() : ''
      if (resolvedProviderId && resolvedProviderId !== currentGlobalProviderId) {
        const nextSettings = await saveAIGlobalSettings({
          ...(globalAISettings || {}),
          currentProviderId: resolvedProviderId,
        })
        setGlobalAISettings(nextSettings)
      }
    }

    if (!resolvedProviderId) {
      return false
    }

    if (runtimeOptions?.forceImmediate !== true && isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: isEditingExistingMessage ? 'edit' : (isRetryingMessage ? 'retry_user' : 'chat'),
        text: nextText,
        images: messageImages,
        targetMessageId: typeof activeComposerState?.targetMessageId === 'string' ? activeComposerState.targetMessageId : '',
        targetMessageText: typeof activeComposerState?.targetMessageText === 'string' ? activeComposerState.targetMessageText : nextText,
        toolScope: effectiveToolScope,
        toolScopeSlot: effectiveToolScopeSlot,
        forceNewConversation: runtimeOptions?.forceNewConversation === true,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return false
    }

    let targetConversation = targetConversationSnapshot
    if (!targetConversation) {
      if (isThemeTuningConversation || temporarySessionEnabled) {
        const now = Date.now()
        targetConversation = {
          id: `${isThemeTuningConversation ? 'theme-tuning' : 'temporary'}-${now}-${Math.random().toString(36).slice(2, 8)}`,
          title: isThemeTuningConversation ? translate('AI调色') : truncateConversationTitle(nextText),
          createdAt: now,
          updatedAt: now,
          status: 'idle',
          toolProtocol: 'xml',
          messageCount: 0,
          messages: [],
          apiMessages: [],
          settings: normalizeAIConversationTaskSettings({
            currentProviderId: resolvedProviderId,
          }),
          transient: true,
          toolScope: effectiveToolScope,
          toolScopeSlot: effectiveToolScopeSlot,
        }
      } else {
        targetConversation = await createAIConversation(truncateConversationTitle(nextText))
        setConversationList((prev) => upsertConversationSummary(prev, targetConversation!))
      }
    }

    const executionContextSnapshot = getExecutionContextSnapshot({
      sessionId,
      terminalId,
    })
    const environmentDetailsBlock = buildExecutionContextDetails(executionContextSnapshot)
    const { transformedText: slashExpandedPromptText } = expandFirstSlashCommandForPrompt(
      nextText,
      normalizedGlobalAISettings.slashCommands,
    )
    const preprocessedPromptText = slashExpandedPromptText && targetConversation?.id
      ? await preprocessAIConversationLongText(targetConversation.id, slashExpandedPromptText)
      : (slashExpandedPromptText || '')
    recordPerfStage('长文本预处理')
    const baseUserPromptText = preprocessedPromptText
      ? `<user_message>\n${preprocessedPromptText}\n</user_message>`
      : ''
    const promptWithMentions = baseUserPromptText
      ? await processRemoteFileMentions(baseUserPromptText, {
          sessionId: terminalId,
          readFile: (activeSessionId: string, remotePath: string) => AppGo.ReadFile(activeSessionId, remotePath),
          listDir: (activeSessionId: string, remotePath: string) => AppGo.ListDir(activeSessionId, remotePath),
          getTerminalOutput: () => {
            const snapshotProvider = window?.__luminTerminalSnapshots?.[terminalId]
            const rawOutput = typeof snapshotProvider === 'function' ? snapshotProvider() : ''
            return compressTerminalOutputForPrompt(rawOutput, terminalOutputLineLimit, terminalOutputCharacterLimit)
          },
          readLocalWrappedFile: (localPath: string) => readAIConversationWrappedFile(targetConversation.id, localPath),
        })
      : ''
    recordPerfStage('远程@提及')
    const processedPromptText = [promptWithMentions, environmentDetailsBlock]
      .filter((item) => typeof item === 'string' && item.trim())
      .join('\n\n')
      .trim()

    const baseConversation = isEditingExistingMessage || isRetryingMessage
      ? truncateConversationAfterMessage(targetConversation, String(activeComposerState.targetMessageId || ''))
      : targetConversation
    const shouldInjectAssistantFirstReply = shouldUseAssistantFirstReplyForConversation(baseConversation)

    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const baseApiMessages = Array.isArray(baseConversation.apiMessages) ? baseConversation.apiMessages : []
    const requestModelMeta = resolveAIRequestModelMeta(resolvedProviderId, latestProviders)
    const userMessage = {
      id: `user-${requestId}`,
      kind: 'user',
      text: nextText,
      images: messageImages,
      time: formatMessageTime(),
      extra: requestModelMeta,
    }
    const nextApiMessages = [
      ...baseApiMessages,
      createAPIHistoryMessage({
        role: 'user',
        content: processedPromptText,
        messageId: `api-user-${requestId}`,
        uiMessageIds: [userMessage.id],
        images: messageImages,
        ts: Date.now(),
      }),
    ]
    const requestMessages = buildRequestMessages(nextApiMessages)
    recordPerfStage('净化构建')
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: nextApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
      },
    }
    const persistedConversation = {
      ...baseConversation,
      title: baseConversation.title && baseConversation.title !== translate('新对话') ? baseConversation.title : truncateConversationTitle(nextText),
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(baseConversation.messages || []), userMessage],
      apiMessages: nextApiMessages,
    }
    const nextConversation = {
      ...persistedConversation,
      messages: [...persistedConversation.messages, assistantMessage],
    }

    let assistantFirstReplyText = ''
    if (!normalizedRuntimeOptions.skipAssistantFirstReply && shouldInjectAssistantFirstReply) {
      assistantFirstReplyText = (await getAIAssistantFirstReply(getLanguage())).trim()
    }
    recordPerfStage('首字预取')

    resetComposerEditState()
    requestConversationSmoothScrollToBottom()
    if (!targetConversation.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    }
    setPanelState(panelInstanceKey, {
      activeConversationId: targetConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      recoverableToolStopReason: '',
      lastAssistantTurnId: requestId,
      lastTurnBusinessMessageKind: '',
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      isCondensingContext: normalizedRuntimeOptions.keepCondensingContext === true,
      collaborationLocked: shouldLockAssistantCollaboration,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: '',
      collaborationStatusReasoningText: '',
    })

    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })
    recordPerfStage('落库快照')

    try {
      await startAIChat(requestId, {
        conversationId: targetConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: Boolean(panelState.skipNextAutomaticRequest),
        assistantFirstReplyText: assistantFirstReplyText || undefined,
        isDemon: Boolean(isDevilMode),
        toolScope: effectiveToolScope || undefined,
        toolScopeSlot: effectiveToolScopeSlot || undefined,
        autoRecoverySubtaskHops: Number.isFinite(Number(normalizedRuntimeOptions.autoRecoverySubtaskHops))
          ? Math.max(0, Math.trunc(Number(normalizedRuntimeOptions.autoRecoverySubtaskHops)))
          : undefined,
        messages: requestMessages,
      })
      recordPerfStage('发起请求')
      const perfTotal = perfStages.reduce((sum, stage) => sum + stage.ms, 0)
      const perfRecord = { stages: perfStages, total: perfTotal, at: Date.now() }
      sendPerfMetricsRef.current.set(userMessage.id, perfRecord)
      sendPerfMetricsRef.current.set(requestId, perfRecord)
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: (nextConversation.messages || []).map((message: AIMessage) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          const preservedText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '').trim() : ''
          return {
            ...message,
            text: preservedText,
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(panelInstanceKey, {
        activeConversationId: targetConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: nextApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        recoverableToolStopReason: '',
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, aiProviderState, availableAIProviders, buildConversationWithProviderId, composerEditState, composerImages, effectiveAutoApprovalEnabled, getAIAssistantFirstReply, globalAISettings, isDevilMode, isQueueBlocked, normalizedGlobalAISettings.slashCommands, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, requestConversationSmoothScrollToBottom, resetComposerEditState, resolveAIRequestModelMeta, resolveAvailableProviderId, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, temporarySessionEnabled, terminalId, terminalOutputCharacterLimit, terminalOutputLineLimit, truncateConversationAfterMessage])
  const handleFollowupResponse = useCallback(async (payload: Record<string, unknown>) => {
    if (!payload || typeof payload !== 'object') {
      return false
    }
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : ''
    if (!requestId) {
      return false
    }
    const followupImages = normalizeMessageImages(payload.images)
    try {
      await resolveAIChatFollowup(requestId, payload.answer, followupImages)
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        collaborationLocked: shouldLockAssistantCollaboration,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
        collaborationInterruptedRequestId: '',
        collaborationStatusStartedAtMs: 0,
        collaborationStatusFirstTokenAtMs: 0,
        collaborationStatusText: '',
        collaborationStatusReasoningText: '',
      }))
      return true
    } catch {}
    const currentPanel = terminalPanelsRef.current[panelInstanceKey] || null
    const currentConversation = currentPanel?.conversation || activeConversation
    const currentConversationToolScope = typeof currentConversation?.toolScope === 'string' ? currentConversation.toolScope.trim() : ''
    const currentConversationToolScopeSlot = typeof currentConversation?.toolScopeSlot === 'string' ? currentConversation.toolScopeSlot.trim() : ''
    if (!currentConversation?.id) {
      return false
    }
    const { readableText, content: followupContent } = buildAIFollowupAnswerPayload(payload.answer as string | AIMessage)
    if (!readableText || !followupContent) {
      return false
    }
    const currentMessages = Array.isArray(currentPanel?.messages) ? currentPanel.messages : (Array.isArray(currentConversation.messages) ? currentConversation.messages : [])
    const currentApiMessages = Array.isArray(currentPanel?.apiMessages) ? currentPanel.apiMessages : (Array.isArray(currentConversation.apiMessages) ? currentConversation.apiMessages : [])
    const followupMessage = findLatestAIFollowupMessageByRequestId(currentMessages, requestId)
    const followupMessageId = typeof followupMessage?.id === 'string' ? followupMessage.id.trim() : ''
    const timestamp = Date.now()
    const userMessageId = `${followupMessageId || requestId}-followup-answer-${timestamp}`
    const rawFollowupSettings = currentConversation?.settings && typeof currentConversation.settings === 'object' ? currentConversation.settings as Record<string, unknown> : null
    const followupProviderId = typeof rawFollowupSettings?.currentProviderId === 'string' ? rawFollowupSettings.currentProviderId.trim() : ''
    const requestModelMeta = resolveAIRequestModelMeta(followupProviderId)
    const userMessage = {
      id: userMessageId,
      kind: 'user',
      text: readableText,
      images: followupImages,
      time: formatMessageTime(),
      extra: requestModelMeta,
    }
    const resolvedMessages = currentMessages.map((message) => {
      if (!followupMessageId || message?.id !== followupMessageId || message?.kind !== 'followup') {
        return message
      }
      return {
        ...message,
        status: AI_FOLLOWUP_COMPLETED_STATUS_KEY,
        requestId: '',
      }
    })
    const nextMessages = [...resolvedMessages, userMessage]
    const nextApiMessages = [
      ...currentApiMessages,
      createAPIHistoryMessage({
        role: 'user',
        content: followupContent,
        messageId: `api-user-followup-${timestamp}`,
        uiMessageIds: [userMessageId],
        images: followupImages,
        ts: timestamp,
      }),
    ]
    const requestMessages = buildRequestMessages(nextApiMessages)
    const nextRequestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const assistantMessage = {
      id: nextRequestId,
      turnId: nextRequestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: nextApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
        errorText: '',
      },
    }
    const persistedConversation = {
      ...currentConversation,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: nextMessages,
      apiMessages: nextApiMessages,
    }
    const nextConversation = {
      ...persistedConversation,
      messages: [...nextMessages, assistantMessage],
    }
    requestConversationSmoothScrollToBottom()
    if (!currentConversation.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    }
    setPanelState(panelInstanceKey, {
      activeConversationId: currentConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: nextApiMessages,
      activeRequestId: nextRequestId,
      activeAssistantMessageId: nextRequestId,
      activeToolExecution: null,
      toolApprovalMode: '',
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      lastAssistantTurnId: nextRequestId,
      lastTurnBusinessMessageKind: '',
      activeChangeReview: null,
      collaborationLocked: shouldLockAssistantCollaboration,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: '',
      collaborationStatusReasoningText: '',
    })
    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })
    try {
      await startAIChat(nextRequestId, {
        conversationId: currentConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: false,
        isDemon: Boolean(isDevilMode),
        toolScope: currentConversationToolScope || undefined,
        toolScopeSlot: currentConversationToolScopeSlot || undefined,
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: nextConversation.messages.map((message) => {
          if (message.id !== nextRequestId || message.kind !== 'assistant') {
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
              errorText,
            },
          }
        }),
      }
      setPanelState(panelInstanceKey, {
        activeConversationId: currentConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: nextApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        queuedSubmission: null,
        isFlushingQueuedSubmission: false,
        skipNextAutomaticRequest: false,
        resumeAfterCancelRequestId: '',
        recoverableToolStopReason: '',
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, effectiveAutoApprovalEnabled, isDevilMode, panelInstanceKey, requestConversationSmoothScrollToBottom, resolveAIRequestModelMeta, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, terminalId])
  const handleConversationUserMessage = useCallback(async (payload: string | Record<string, unknown>) => {
    if (payload && typeof payload === 'object' && payload.kind === 'followup-response') {
      if (collaborationFollowupInteractionLocked) {
        return false
      }
      return handleFollowupResponse(payload)
    }
    const text = typeof payload === 'string' ? payload : ''
    return handleSendMessage(text, { images: [] })
  }, [collaborationFollowupInteractionLocked, handleFollowupResponse, handleSendMessage])
  const handleComposerSendMessage = useCallback(async (text: string, sendOptionsOrEditState: Record<string, unknown> | null = null, explicitEditState: Record<string, unknown> | null = null, runtimeOptions: Record<string, unknown> = {}) => {
    const pendingFollowupRequestId = panelState.collaborationAwaitingManualFollowup ? panelState.collaborationFollowupRequestId : ''
    if (pendingFollowupRequestId) {
      const followupImages = normalizeMessageImages(sendOptionsOrEditState?.images)
      const accepted = await handleFollowupResponse({
        kind: 'followup-response',
        requestId: pendingFollowupRequestId,
        answer: typeof text === 'string' ? text : '',
        images: followupImages,
      })
      if (accepted !== false) {
        resetComposerEditState()
      }
      return accepted
    }
    return handleSendMessage(text, sendOptionsOrEditState, explicitEditState, runtimeOptions)
  }, [handleFollowupResponse, handleSendMessage, panelState.collaborationAwaitingManualFollowup, panelState.collaborationFollowupRequestId, resetComposerEditState])
  useEffect(() => {
    const handleStartThemeTuning = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const targetSessionId = typeof detail?.sessionId === 'string' ? detail.sessionId.trim() : ''
      const targetTerminalId = typeof detail?.terminalId === 'string' ? detail.terminalId.trim() : ''
      const targetTabId = typeof detail?.tabId === 'string' ? detail.tabId.trim() : ''
      const slot = typeof detail?.slot === 'string' ? detail.slot.trim() : ''
      if (
        !isWorkspaceTabActive
        || (targetTabId && targetTabId !== workspaceTabId)
        || (sessionId || '').trim() !== targetSessionId
        || (terminalId || '').trim() !== targetTerminalId
      ) {
        return
      }
      if (slot !== 'light' && slot !== 'dark') {
        return
      }
      setThemeToolPreview(null)
      const starterText = slot === 'light'
        ? '请帮我实时调整当前浅色主题包的配色,先调用 help,随后只用 preview 或 inspect 逐步预览,满意后再 commit.'
        : '请帮我实时调整当前深色主题包的配色,先调用 help,随后只用 preview 或 inspect 逐步预览,满意后再 commit.'
      void handleSendMessage(starterText, { images: [] }, null, {
        toolScope: 'theme_tuning',
        toolScopeSlot: slot,
        forceNewConversation: true,
      })
    }
    window.addEventListener('ai-theme-tuning-start', handleStartThemeTuning)
    return () => window.removeEventListener('ai-theme-tuning-start', handleStartThemeTuning)
  }, [handleSendMessage, isWorkspaceTabActive, sessionId, terminalId, workspaceTabId])
  const handleRetryUserMessage = useCallback(async (messageId: string, text: string, images: unknown[] = []) => {
    if (!activeConversation) {
      return
    }
    if (isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: 'retry_user',
        text,
        images,
        targetMessageId: messageId,
        targetMessageText: text,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return
    }
    await handleSendMessage(text, { images }, {
      mode: 'retry',
      targetMessageId: messageId,
      targetMessageText: text,
    }, { forceImmediate: true })
  }, [activeConversation, handleSendMessage, isQueueBlocked, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, setPanelState])
  const handleRetryAssistantMessage = useCallback(async (messageId: string) => {
    if (!activeConversation || isArchivedAgentConversation) {
      return false
    }
    clearRestorePreview()
    if (isQueueBlocked) {
      const queuedSubmission = buildAIQueuedSubmission({
        kind: 'retry_assistant',
        targetMessageId: messageId,
      })
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        queuedSubmission,
        isFlushingQueuedSubmission: false,
      }))
      if (panelState.requestPhase === 'awaiting_tool_approval' && panelState.activeRequestId) {
        try {
          await rejectAIChatToolsForQueuedSubmission(panelState.activeRequestId)
        } catch {}
      }
      return false
    }

    const targetAssistantMessage = (activeConversation.messages || []).find((message) => message.id === messageId && message.kind === 'assistant')
    if (!targetAssistantMessage) {
      return false
    }

    const baseConversation = truncateConversationAfterMessage(activeConversation, messageId)
    const requestApiMessages = Array.isArray(baseConversation.apiMessages) ? baseConversation.apiMessages : []
    if (requestApiMessages.length === 0) {
      return false
    }

    const requestMessages = buildRequestMessages(requestApiMessages)
    let assistantFirstReplyText = ''
    if (shouldUseAssistantFirstReplyForConversation(baseConversation)) {
      assistantFirstReplyText = (await getAIAssistantFirstReply(getLanguage())).trim()
    }
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: requestMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
      },
    }
    const persistedConversation = {
      ...baseConversation,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(baseConversation.messages || [])],
      apiMessages: requestApiMessages,
    }
    const nextConversation = {
      ...persistedConversation,
      messages: [...persistedConversation.messages, assistantMessage],
    }

    resetComposerEditState()
    requestConversationSmoothScrollToBottom()
    if (!activeConversation.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, persistedConversation))
    }
    setPanelState(panelInstanceKey, {
      activeConversationId: activeConversation.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: requestApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      recoverableToolStopReason: '',
      lastAssistantTurnId: requestId,
      lastTurnBusinessMessageKind: '',
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      collaborationLocked: shouldLockAssistantCollaboration,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: '',
      collaborationStatusReasoningText: '',
    })

    await saveConversationSnapshot(persistedConversation, panelInstanceKey, { hydrate: false })

    try {
      await startAIChat(requestId, {
        conversationId: activeConversation.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: Boolean(panelState.skipNextAutomaticRequest),
        assistantFirstReplyText: assistantFirstReplyText || undefined,
        isDemon: Boolean(isDevilMode),
        toolScope: typeof activeConversation?.toolScope === 'string' && activeConversation.toolScope.trim() ? activeConversation.toolScope.trim() : undefined,
        toolScopeSlot: typeof activeConversation?.toolScopeSlot === 'string' && activeConversation.toolScopeSlot.trim() ? activeConversation.toolScopeSlot.trim() : undefined,
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: (nextConversation.messages || []).map((message: AIMessage) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
            return message
          }
          const preservedText = typeof message.text === 'string' ? message.text.replace(/▍$/u, '').trim() : ''
          return {
            ...message,
            text: preservedText,
            metrics: [],
            streaming: false,
            extra: {
              ...(message.extra || {}),
              requestStatusLive: false,
              errorText,
            },
          }
        }),
      }

      setPanelState(panelInstanceKey, {
        activeConversationId: activeConversation.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: requestApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        recoverableToolStopReason: '',
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        skipNextAutomaticRequest: false,
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, panelInstanceKey)
      return false
    }
  }, [activeConversation, effectiveAutoApprovalEnabled, isDevilMode, isQueueBlocked, panelInstanceKey, panelState.activeRequestId, panelState.requestPhase, requestConversationSmoothScrollToBottom, resetComposerEditState, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, terminalId, truncateConversationAfterMessage])
  const handleEditUserMessage = useCallback((messageId: string, text: string, images: unknown[] = []) => {
    if (!activeConversation) {
      return
    }
    setComposerEditState({
      mode: 'edit',
      targetMessageId: messageId,
      targetMessageText: text,
    })
    setComposerInputValue(text || '')
    setComposerImages(normalizeMessageImages(images))
    requestConversationSmoothScrollToBottom()
  }, [activeConversation, requestConversationSmoothScrollToBottom])
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!activeConversation) {
      return
    }
    clearRestorePreview()
    const confirmed = await requestDeleteConfirmation(t('确定删除这条消息及其后续对话吗？此操作不可撤销。'))
    if (!confirmed) {
      return
    }
    const nextConversation = truncateConversationAfterMessage(activeConversation, messageId)
    const nextLastTurnState = computeAILastAssistantTurnState(nextConversation.messages)
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      conversation: nextConversation,
      messages: nextConversation.messages || [],
      apiMessages: nextConversation.apiMessages || [],
      activeRequestId: '',
      activeAssistantMessageId: '',
      activeToolExecution: null,
      requestPhase: 'idle',
      runtimePhase: 'ready',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      ...nextLastTurnState,
      collaborationLocked: false,
      collaborationActive: false,
      collaborationMode: '',
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
    }))
    if (composerEditState.targetMessageId === messageId) {
      resetComposerEditState()
    }
    requestConversationSmoothScrollToBottom()
    await saveConversationSnapshot(nextConversation, panelInstanceKey)
  }, [activeConversation, composerEditState.targetMessageId, panelInstanceKey, requestConversationSmoothScrollToBottom, requestDeleteConfirmation, resetComposerEditState, saveConversationSnapshot, setPanelState, t, truncateConversationAfterMessage])
  const handleCondenseContext = useCallback(async () => {
    if (!activeConversation || isArchivedAgentConversation || runtimePhase !== 'ready' || panelState.isCondensingContext) {
      return
    }
    setPanelState(panelInstanceKey, (current) => ({
      ...current,
      isCondensingContext: true,
    }))
    try {
      const result = await condenseAIConversationContext(activeConversation.id, terminalId)
      const nextSnapshot = normalizeAIConversationSnapshot((result as { snapshot?: unknown } | null)?.snapshot || result)
      setConversationList((prev) => upsertConversationSummary(prev, nextSnapshot))
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        conversation: nextSnapshot,
        messages: nextSnapshot.messages,
        apiMessages: nextSnapshot.apiMessages,
        isCondensingContext: false,
      }))
      // 压缩改写了历史节点: 全量重建账本 (对每个节点重算并重新持久化压缩后的 Token)
      void rebuildAIConversationTokenLedger(nextSnapshot, panelInstanceKey)
    } catch {
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        isCondensingContext: false,
      }))
    }
  }, [activeConversation, panelInstanceKey, panelState.isCondensingContext, rebuildAIConversationTokenLedger, runtimePhase, setPanelState, terminalId])
  const continueAIConversationSummarySubtask = useCallback(async (conversationSnapshot: AIConversationSnapshot, continueText: string, options: Record<string, unknown> = {}) => {
    const nextConversationSnapshot = normalizeAIConversationSnapshot(conversationSnapshot)
    const normalizedContinueText = typeof continueText === 'string' ? continueText.trim() : ''
    const normalizedOptions = options && typeof options === 'object' ? options : {}
    const finalContinueText = buildAIConversationSummarySubtaskContinuePrompt(normalizedContinueText, getLanguage())
    if (!nextConversationSnapshot?.id || !finalContinueText) {
      return false
    }
    return handleSendMessage(finalContinueText, { images: [] }, null, {
      forceImmediate: true,
      targetConversationSnapshot: nextConversationSnapshot,
      autoRecoverySubtaskHops: Number.isFinite(Number(normalizedOptions.autoRecoverySubtaskHops))
        ? Math.max(0, Math.trunc(Number(normalizedOptions.autoRecoverySubtaskHops)))
        : undefined,
    })
  }, [handleSendMessage])
  const runAIConversationSummarySubtaskFlow = useCallback(async (conversationSnapshot: AIConversationSnapshot, options: Record<string, unknown> = {}) => {
    const nextConversationSnapshot = normalizeAIConversationSnapshot(conversationSnapshot)
    const normalizedOptions = options && typeof options === 'object' ? options : {}
    const summaryRequestId = typeof normalizedOptions.requestId === 'string' && normalizedOptions.requestId.trim()
      ? normalizedOptions.requestId.trim()
      : `summary-subtask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const preserveExistingCollaboration = normalizedOptions.preserveExistingCollaboration === true
    if (!nextConversationSnapshot?.id) {
      return false
    }
    if (!preserveExistingCollaboration) {
      setComposerInputValue('')
      setComposerImages([])
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        activeRequestId: summaryRequestId,
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
        collaborationStatusText: '',
        collaborationStatusReasoningText: '',
      }))
    }
    try {
      const subtaskResult = await createAIConversationSummarySubtask(nextConversationSnapshot.id, terminalId, summaryRequestId)
      const childSnapshot = normalizeAIConversationSnapshot(subtaskResult?.snapshot || subtaskResult)
      const continueText = typeof subtaskResult?.continueText === 'string' ? subtaskResult.continueText.trim() : ''
      if (!childSnapshot?.id || !continueText) {
        throw new Error(t('摘要创建子任务失败'))
      }
      const accepted = await continueAIConversationSummarySubtask(childSnapshot, continueText, {
        autoRecoverySubtaskHops: Number.isFinite(Number(normalizedOptions.autoRecoverySubtaskHops))
          ? Math.max(0, Math.trunc(Number(normalizedOptions.autoRecoverySubtaskHops)))
          : undefined,
      })
      if (!accepted) {
        throw new Error(t('摘要创建子任务失败'))
      }
      return true
    } catch (error) {
      const interruptedRequestId = typeof terminalPanelsRef.current?.[panelInstanceKey]?.collaborationInterruptedRequestId === 'string'
        ? terminalPanelsRef.current[panelInstanceKey].collaborationInterruptedRequestId.trim()
        : ''
      if (interruptedRequestId !== summaryRequestId) {
        const message = error instanceof Error && error.message ? error.message : t('摘要创建子任务失败')
        await showAlert(message)
      }
      setPanelState(panelInstanceKey, (current) => ({
        ...current,
        activeRequestId: '',
        isCondensingContext: false,
        collaborationLocked: false,
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
      }))
      return false
    }
  }, [continueAIConversationSummarySubtask, panelInstanceKey, setComposerImages, setComposerInputValue, setPanelState, showAlert, t, terminalId])
  const handleCondenseContextFullSummary = useCallback(async () => {
    if (!activeConversation || runtimePhase !== 'ready' || panelState.isCondensingContext) {
      return
    }
    void runAIConversationSummarySubtaskFlow(activeConversation)
  }, [activeConversation, panelState.isCondensingContext, runAIConversationSummarySubtaskFlow, runtimePhase])
  const resumeAIChatFromConversation = useCallback(async (conversationSnapshot: AIConversationSnapshot, targetPanelKey = panelInstanceKey, options: Record<string, unknown> = {}) => {
    if (!conversationSnapshot || !effectiveProviderId) {
      return false
    }
    const normalizedOptions = options && typeof options === 'object' ? options : {}
    const requestApiMessages = Array.isArray(conversationSnapshot.apiMessages) ? conversationSnapshot.apiMessages : []
    if (requestApiMessages.length === 0) {
      return false
    }
    const requestMessages = buildRequestMessages(requestApiMessages)
    const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const keepCollaborationActive = normalizedOptions.keepCollaborationActive === true
    const collaborationMode = keepCollaborationActive
      ? (typeof normalizedOptions.collaborationMode === 'string' && normalizedOptions.collaborationMode.trim() ? normalizedOptions.collaborationMode.trim() : 'summary_subtask')
      : ''
    const collaborationStatusText = typeof normalizedOptions.collaborationStatusText === 'string' ? normalizedOptions.collaborationStatusText : ''
    const collaborationStatusReasoningText = typeof normalizedOptions.collaborationStatusReasoningText === 'string' ? normalizedOptions.collaborationStatusReasoningText : ''
    const recoverableToolStopReason = typeof normalizedOptions.recoverableToolStopReason === 'string' ? normalizedOptions.recoverableToolStopReason : ''
    const autoRecoverySubtaskHops = Number.isFinite(Number(normalizedOptions.autoRecoverySubtaskHops))
      ? Math.max(0, Math.trunc(Number(normalizedOptions.autoRecoverySubtaskHops)))
      : 0
    const assistantMessage = {
      id: requestId,
      turnId: requestId,
      kind: 'assistant',
      text: '▍',
      time: formatMessageTime(),
      metrics: [],
      streaming: true,
      extra: {
        apiLengthBefore: requestApiMessages.length,
        statusStartedAtMs: Date.now(),
        firstTokenAtMs: 0,
        requestStatusLive: true,
        errorText: '',
      },
    }
    const nextConversation = {
      ...conversationSnapshot,
      updatedAt: Date.now(),
      status: 'streaming',
      messages: [...(conversationSnapshot.messages || []), assistantMessage],
      apiMessages: requestApiMessages,
    }

    requestConversationSmoothScrollToBottom()
    if (!conversationSnapshot.transient) {
      setConversationList((prev) => upsertConversationSummary(prev, nextConversation))
    }
    setPanelState(targetPanelKey, {
      activeConversationId: conversationSnapshot.id,
      conversation: nextConversation,
      messages: nextConversation.messages,
      apiMessages: requestApiMessages,
      activeRequestId: requestId,
      activeAssistantMessageId: requestId,
      activeToolExecution: null,
      requestPhase: 'streaming',
      runtimePhase: 'api_request',
      queuedSubmission: null,
      isFlushingQueuedSubmission: false,
      skipNextAutomaticRequest: false,
      resumeAfterCancelRequestId: '',
      recoverableToolStopReason: '',
      lastAssistantTurnId: requestId,
      lastTurnBusinessMessageKind: '',
      isCondensingContext: keepCollaborationActive,
      collaborationLocked: keepCollaborationActive ? true : shouldLockAssistantCollaboration,
      collaborationActive: keepCollaborationActive,
      collaborationMode,
      collaborationStreamBuffer: '',
      collaborationAwaitingManualFollowup: false,
      collaborationFollowupRequestId: '',
      collaborationInterruptedRequestId: '',
      collaborationStatusStartedAtMs: keepCollaborationActive ? Date.now() : 0,
      collaborationStatusFirstTokenAtMs: 0,
      collaborationStatusText: keepCollaborationActive ? collaborationStatusText : '',
      collaborationStatusReasoningText: keepCollaborationActive ? collaborationStatusReasoningText : '',
    })

    try {
      await startAIChat(requestId, {
        conversationId: conversationSnapshot.id,
        sessionId: terminalId,
        autoApprove: effectiveAutoApprovalEnabled,
        skipNextAutomaticRequest: false,
        isDemon: Boolean(isDevilMode),
        toolScope: typeof conversationSnapshot?.toolScope === 'string' && conversationSnapshot.toolScope.trim() ? conversationSnapshot.toolScope.trim() : undefined,
        toolScopeSlot: typeof conversationSnapshot?.toolScopeSlot === 'string' && conversationSnapshot.toolScopeSlot.trim() ? conversationSnapshot.toolScopeSlot.trim() : undefined,
        autoRecoverySubtaskHops,
        messages: requestMessages,
      })
      return true
    } catch (error) {
      const errorText = error instanceof Error ? error.message : translate('请求失败')
      const erroredConversation = {
        ...nextConversation,
        updatedAt: Date.now(),
        status: 'error',
        messages: (nextConversation.messages || []).map((message: AIMessage) => {
          if (message.id !== requestId || message.kind !== 'assistant') {
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
              errorText,
            },
          }
        }),
      }

      setPanelState(targetPanelKey, {
        activeConversationId: conversationSnapshot.id,
        conversation: erroredConversation,
        messages: erroredConversation.messages,
        apiMessages: requestApiMessages,
        activeRequestId: '',
        activeAssistantMessageId: '',
        activeToolExecution: null,
        requestPhase: 'idle',
        toolApprovalMode: '',
        runtimePhase: 'ready',
        queuedSubmission: null,
        isFlushingQueuedSubmission: false,
        skipNextAutomaticRequest: false,
        resumeAfterCancelRequestId: '',
        recoverableToolStopReason,
        isCondensingContext: false,
        activeChangeReview: null,
        collaborationLocked: false,
        collaborationActive: false,
        collaborationMode: '',
        collaborationStreamBuffer: '',
        collaborationAwaitingManualFollowup: false,
        collaborationFollowupRequestId: '',
      })
      await saveConversationSnapshot(erroredConversation, targetPanelKey)
      return false
    }
  }, [effectiveAutoApprovalEnabled, effectiveProviderId, isDevilMode, panelInstanceKey, requestConversationSmoothScrollToBottom, saveConversationSnapshot, setPanelState, shouldLockAssistantCollaboration, terminalId])
  return {
    handleSendMessage,
    handleFollowupResponse,
    handleConversationUserMessage,
    handleComposerSendMessage,
    handleRetryUserMessage,
    handleRetryAssistantMessage,
    handleEditUserMessage,
    handleDeleteMessage,
    handleCondenseContext,
    continueAIConversationSummarySubtask,
    runAIConversationSummarySubtaskFlow,
    handleCondenseContextFullSummary,
    resumeAIChatFromConversation,
  }
}
