import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation, getLanguage } from '../../i18n.ts'
import { Z } from '../../constants/zIndex'
import AIPanelHeader from './AIPanelHeader.tsx'
import { normalizeAIConversationTaskSettings } from './aiConversationBridge.ts'
import { useAIChatStreamEvents } from './useAIChatStreamEvents.ts'
import { useAIPanelCoreState } from './useAIPanelCoreState.ts'
import { useAIPanelSettingsState } from './useAIPanelSettingsState.ts'
import { useAIGlobalSearch } from './useAIGlobalSearch.ts'
import { useAIConversationSearch } from './useAIConversationSearch.ts'
import { useAIConversationOrganizer } from './useAIConversationOrganizer.ts'
import { useAIConversationHome } from './useAIConversationHome.ts'
import { useAIAutoApprovalSettings } from './useAIAutoApprovalSettings.ts'
import { useAIChatRequests } from './useAIChatRequests.ts'
import { useAIChatActions } from './useAIChatActions.ts'
import { renderAIHomeView } from './AIHomeView.tsx'
import { renderAIConversationStage } from './AIConversationStage.tsx'
import { renderAIComposerSection, renderAISettingsOverlaySection } from './AIConversationPanelSections.tsx'
import { AIWorkspaceTabProvider } from './aiWorkspaceTabContext.ts'
import type { AIPanelProps } from './aiChatLogic.ts'
import type { ConversationSummary } from './aiConversationSummary.ts'

// ============================================================
// AIConversationTabPanel：单个工作区标签页的对话面板（外壳见 ../../AIPanel.tsx）。
// ============================================================
// ============================================================

export function AIConversationTabPanel({ width, side, terminalId = 'global', sessionId = '', sessionTerminals = [], workspaceTabId = '', isHomeView = false, isWorkspaceTabActive = true, showComposer = true, initialConversationId = '', tabBar = null, onDevilModeChange, onGoHomeRequested, onOpenConversationRequested, onWorkspaceTabStateChange, addToast }: AIPanelProps) {
  const { t } = useTranslation()
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([])
  const {
    panelInstanceKey, terminalPanelsRef, deletedConversationIdsRef, isReturningHomeRef,
    conversationLoadRequestRef, panelMountedRef, tokenLedgerRef, sendPerfMetricsRef,
    pendingConversationId, setPendingConversationId,
    composerInputValue, setComposerInputValue, composerImages, setComposerImages,
    composerEditState, setComposerEditState, resetComposerEditState,
    conversationScrollSignal, requestConversationSmoothScrollToBottom, clearRestorePreview,
    panelState, activeConversation, normalizedInitialConversationId, isConversationLoading,
    activeConversationRelationType, activeConversationArchived, isThemeTuningConversation,
    runtimePhase, isStreaming, isAwaitingToolApproval, isToolRunning,
    isAwaitingCommandAction, isAwaitingTerminalAssignment, isQueueBlocked,
    setPanelState, truncateConversationAfterMessage, rebuildAIConversationTokenLedger,
    saveConversationSnapshot,
  } = useAIPanelCoreState({ terminalId, sessionId, workspaceTabId, initialConversationId, isWorkspaceTabActive, onWorkspaceTabStateChange, setConversationList })

  const {
    globalSearchOpen, globalSearchQuery, setGlobalSearchQuery, globalSearchLoading,
    globalSearchResults, globalSearchInputRef, resetGlobalSearchState, normalizedGlobalSearchQuery, handleOpenGlobalSearch,
  } = useAIGlobalSearch({ panelMountedRef })

  const {
    conversationSearchOpen, conversationSearchQuery, setConversationSearchQuery,
    conversationSearchIndex, conversationSearchInputRef,
    resetConversationSearchState, conversationSearchResults,
    locateConversationMessage, handleOpenConversationSearch, handleCycleConversationSearchResult,
  } = useAIConversationSearch({ sessionId, terminalId, workspaceTabId, panelState, activeConversation })

  const {
    mcpInfo, mcpClientServers, mcpClientGlobalConfigPath, mcpClientGlobalConfigText,
    showSettingsPanel, setShowSettingsPanel, popupDismissVersion, setPopupDismissVersion,
    activeSettingsTab, setActiveSettingsTab, tasksDirMigrating, setTasksDirMigrating,
    temporarySessionEnabled, setTemporarySessionEnabled, themeToolPreview: _themeToolPreview, setThemeToolPreview,
    globalAISettings, setGlobalAISettings, terminalOutputLineLimit, terminalOutputCharacterLimit,
    providerBalanceRefreshSignal, setProviderBalanceRefreshSignal, refreshMCPServerInfo,
    refreshMCPOutputCompressionSettings, showAlert, playAISound, requestDeleteConfirmation,
    normalizedGlobalAISettings, handleSaveAIPanelGlobalSettings, handleSaveMCPGlobalServer,
    handleReloadMCPGlobalServers, handleDeleteMCPGlobalServer, handleRestartMCPClientServer,
    handleToggleMCPClientServer, handleToggleMCPClientServerDisabledForPrompts,
    handleUpdateMCPClientServerTimeout, handleToggleAiTerminalIsolation,
    handleToggleConfirmDelete, handleToggleSettingsPanel, handleTerminalOutputLineLimitChange,
    handleTerminalOutputCharacterLimitChange,
  } = useAIPanelSettingsState({ t, isWorkspaceTabActive, panelMountedRef, activeConversation, resetGlobalSearchState, resetConversationSearchState })

  const {
    aiProviderState, setAIProviderState, isDevilMode,
    terminalLabelMap, enrichAIChatCommandMessage,
    availableAIProviders, canToggleAIMode, handleToggleDevilMode,
    resolveAvailableProviderId, buildConversationWithProviderId,
    resolveAIRequestModelMeta, effectiveProviderId,
    handleOpenConversationDiff, handleGoHome,
    handleOpenConversation, handleRestoreConversationBackup, handleOpenConversationFolder,
    handleRenameConversationTitle, handleSelectGlobalSearchResult, handleDeleteConversation,
    refreshConversationList, handleProviderChange,
  } = useAIConversationHome({
    t, addToast, terminalId, sessionId, workspaceTabId, initialConversationId, isWorkspaceTabActive, sessionTerminals,
    onDevilModeChange, onGoHomeRequested, onOpenConversationRequested, panelInstanceKey, panelState, activeConversation,
    pendingConversationId, setPendingConversationId, setPanelState, setComposerEditState, terminalPanelsRef,
    deletedConversationIdsRef, isReturningHomeRef, conversationLoadRequestRef, panelMountedRef, tokenLedgerRef,
    rebuildAIConversationTokenLedger, saveConversationSnapshot, clearRestorePreview, resetComposerEditState,
    setThemeToolPreview, setShowSettingsPanel, setPopupDismissVersion, showAlert, refreshMCPServerInfo,
    refreshMCPOutputCompressionSettings, globalAISettings, setGlobalAISettings, conversationList, setConversationList,
    resetGlobalSearchState, resetConversationSearchState, locateConversationMessage, requestDeleteConfirmation,
  })

  const effectiveAutoApprovalSettings = useMemo(() => {
    if (!activeConversation) {
      return normalizedGlobalAISettings
    }
    const normalizedTaskSettings = normalizeAIConversationTaskSettings(activeConversation.settings)
    return {
      ...normalizedTaskSettings,
      allowedCommands: normalizedGlobalAISettings.allowedCommands,
      deniedCommands: normalizedGlobalAISettings.deniedCommands,
    }
  }, [activeConversation, normalizedGlobalAISettings])
  const effectiveAutoApprovalEnabled = effectiveAutoApprovalSettings.autoApprovalEnabled
  const shouldPersistProviderSelection = !activeConversation
  const approvalButtonOrder = normalizedGlobalAISettings.approvalButtonOrder
  const commandActionButtonOrder = normalizedGlobalAISettings.commandActionButtonOrder
  const messageActionBarAtBottom = Boolean(normalizedGlobalAISettings.messageActionBarAtBottom)
  const messageNavEnabled = normalizedGlobalAISettings.messageNavEnabled !== false
  const shouldLockAssistantCollaboration = Boolean(effectiveAutoApprovalSettings.alwaysAllowFollowupQuestions)
  const collaborationLocked = Boolean(panelState.collaborationLocked) && Boolean(activeConversation)
  const collaborationActive = Boolean(panelState.collaborationActive)
  const isSummarySubtaskCollaborationActive = collaborationActive && panelState.collaborationMode === 'summary_subtask'
  const isArchivedAgentConversation = activeConversationArchived && activeConversationRelationType === 'agent'
  const canQuickCondenseConversation = Boolean(activeConversation) && runtimePhase === 'ready' && !panelState.isCondensingContext && !isArchivedAgentConversation
  const canSummaryCondenseConversation = Boolean(activeConversation) && runtimePhase === 'ready' && !panelState.isCondensingContext
  const composerInteractionLocked = isConversationLoading || (isArchivedAgentConversation && !isSummarySubtaskCollaborationActive)
  const composerInteractionLockedLabel = isConversationLoading
    ? t('加载中...')
    : t('当前子代理任务已归档,仅可摘要压缩创建新的子阶段任务')
  const collaborationFollowupInteractionLocked = collaborationLocked && collaborationActive && panelState.collaborationMode === 'followup'
  const showAssistantCollaborationActiveImage = !isConversationLoading && collaborationActive && Boolean(activeConversation)
  const toolResumeAvailable = Boolean(activeConversation)
    && !isArchivedAgentConversation
    && panelState.requestPhase === 'idle'
    && runtimePhase === 'ready'
    && !panelState.queuedSubmission
    && !panelState.isFlushingQueuedSubmission
    && !collaborationActive
    && !panelState.isCondensingContext
    && (!panelState.lastTurnBusinessMessageKind || (panelState.lastTurnBusinessMessageKind !== 'completion' && panelState.lastTurnBusinessMessageKind !== 'followup'))

  const {
    conversationOrganizer, conversationFilter, setConversationFilter,
    conversationSelectionMode, setConversationSelectionMode, selectedConversationIds,
    moveToGroupOpen, setMoveToGroupOpen, editingConversationGroupId,
    editingConversationGroupName, setEditingConversationGroupName, draggingConversationGroupId,
    dragOverConversationGroupId, setDraggingConversationGroupId, setDragOverConversationGroupId,
    conversationGroupRenameInputRef,
    handleMakeConversationPermanent, handleCreateConversationGroup, beginRenameConversationGroup,
    cancelRenameConversationGroup, commitRenameConversationGroup, reorderConversationGroup,
    showSystemGroupRenameUnsupported, handleDeleteConversationGroup, toggleConversationSelection,
    clearConversationSelection, handleMoveSelectedConversations, handleSetSelectedArchived,
    handleDeleteSelectedConversations,
  } = useAIConversationOrganizer({
    t, addToast, showAlert, requestDeleteConfirmation, isWorkspaceTabActive,
    refreshConversationList, handleOpenConversation, setConversationList,
  })

  const {
    handlePatchAutoApprovalSettings, handleCollaborationExtraPromptChange,
    handleCollaborationPromptPresetsChange,
  } = useAIAutoApprovalSettings({ activeConversation, globalAISettings, normalizedGlobalAISettings, panelState, panelInstanceKey, saveConversationSnapshot, setPanelState, setGlobalAISettings, setComposerInputValue })

  const {
    handleSendMessage, handleConversationUserMessage, handleComposerSendMessage,
    handleRetryUserMessage, handleRetryAssistantMessage, handleEditUserMessage, handleDeleteMessage,
    handleCondenseContext, runAIConversationSummarySubtaskFlow,
    handleCondenseContextFullSummary, resumeAIChatFromConversation,
  } = useAIChatRequests({
    t, terminalId, sessionId, workspaceTabId, isWorkspaceTabActive, activeConversation,
    panelState, panelInstanceKey, terminalPanelsRef, sendPerfMetricsRef, setPanelState,
    setConversationList, setAIProviderState, setGlobalAISettings, setComposerEditState,
    setComposerInputValue, setComposerImages, resetComposerEditState,
    requestConversationSmoothScrollToBottom, clearRestorePreview, truncateConversationAfterMessage,
    saveConversationSnapshot, rebuildAIConversationTokenLedger, showAlert, requestDeleteConfirmation,
    resolveAvailableProviderId, buildConversationWithProviderId, resolveAIRequestModelMeta,
    setThemeToolPreview, globalAISettings, normalizedGlobalAISettings, aiProviderState,
    availableAIProviders, composerEditState, composerImages, temporarySessionEnabled, isDevilMode,
    isQueueBlocked, isArchivedAgentConversation, runtimePhase, effectiveProviderId,
    effectiveAutoApprovalEnabled, shouldLockAssistantCollaboration,
    collaborationFollowupInteractionLocked, terminalOutputLineLimit, terminalOutputCharacterLimit,
  })

  useAIChatStreamEvents({
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
  })


  const {
    handleCancelMessage, handleStopAndResumeMessage, handleResumeTask, handleApproveTools,
    handleRejectTools, handleContinueTool, handleTerminateTool, handlePreviewRestore,
    handlePreviewDiff, handleApplyRestore, handleListCommandTerminalCandidates,
    handleAssignToolTerminal, handleToggleSkipNextAutomaticRequest, handleInterruptCollaboration,
    handleCancelQueuedSubmission,
  } = useAIChatActions({
    addToast, terminalId, workspaceTabId, activeConversation, panelState, panelInstanceKey,
    terminalPanelsRef, panelMountedRef, setPanelState, showAlert, clearRestorePreview,
    terminalLabelMap, isQueueBlocked, handleSendMessage, handleRetryAssistantMessage,
    resumeAIChatFromConversation, normalizedGlobalAISettings,
  })


  // ponytail: mcpInfo.transport 是 MCP 协议层名称（streamable-http），
  // 客户端配置文件（如 ~/.claude.json）期望的 type 值为 "http"，这里做映射。
  // 仅 streamable-http 需要转换，其他值（如 sse、stdio）保持原样。
  const mcpConfigType = mcpInfo.transport === 'streamable-http' ? 'http' : (mcpInfo.transport || 'http')
  const configText = `"lumin-ssh": {
  "type": "${mcpConfigType}",
  "url": "${mcpInfo.url || ''}",
  "oauth": false,
  "alwaysAllow": [],
  "disabled": false,
  "timeout": 0,
  "disabledForPrompts": false
}`
  const configRows = Math.max(configText.split('\n').length, 1)

  const renderedConversationList = useMemo(() => renderAIHomeView({ t, conversationList, conversationOrganizer, conversationFilter, setConversationFilter, conversationSelectionMode, setConversationSelectionMode, selectedConversationIds, moveToGroupOpen, setMoveToGroupOpen, editingConversationGroupId, editingConversationGroupName, setEditingConversationGroupName, draggingConversationGroupId, dragOverConversationGroupId, setDraggingConversationGroupId, setDragOverConversationGroupId, panelState, globalSearchOpen, globalSearchQuery, setGlobalSearchQuery, normalizedGlobalSearchQuery, globalSearchLoading, globalSearchResults, globalSearchInputRef, conversationGroupRenameInputRef, resetGlobalSearchState, handleOpenGlobalSearch, handleSelectGlobalSearchResult, toggleConversationSelection, clearConversationSelection, handleOpenConversation, handleMakeConversationPermanent, handleOpenConversationFolder, handleRenameConversationTitle, handleDeleteConversation, handleCreateConversationGroup, beginRenameConversationGroup, cancelRenameConversationGroup, commitRenameConversationGroup, reorderConversationGroup, showSystemGroupRenameUnsupported, handleDeleteConversationGroup, handleMoveSelectedConversations, handleSetSelectedArchived, handleDeleteSelectedConversations }), [beginRenameConversationGroup, cancelRenameConversationGroup, clearConversationSelection, commitRenameConversationGroup, conversationFilter, conversationList, conversationOrganizer, conversationSelectionMode, dragOverConversationGroupId, draggingConversationGroupId, editingConversationGroupId, editingConversationGroupName, getLanguage, globalSearchLoading, globalSearchOpen, globalSearchQuery, globalSearchResults, handleCreateConversationGroup, handleDeleteConversation, handleDeleteConversationGroup, handleDeleteSelectedConversations, handleMakeConversationPermanent, handleMoveSelectedConversations, handleOpenConversation, handleOpenConversationFolder, handleOpenGlobalSearch, handleSelectGlobalSearchResult, handleSetSelectedArchived, isDevilMode, moveToGroupOpen, normalizedGlobalSearchQuery, panelState.activeConversationId, reorderConversationGroup, resetGlobalSearchState, selectedConversationIds, showSystemGroupRenameUnsupported, t, toggleConversationSelection])


  return (
    <AIWorkspaceTabProvider value={{ sessionId: sessionId || '', terminalId: terminalId || '', tabId: workspaceTabId || '' }}>
      <div
        data-ai-panel-root="true"
      data-ai-devil-mode={isDevilMode ? 'true' : 'false'}
      style={{
        width,
        minWidth: width,
        height: '100%',
        minHeight: 0,
        background: isDevilMode ? 'rgba(10, 0, 2, 0.96)' : 'var(--surface-raised)',
        flexShrink: 0,
        borderRight: side === 'right' ? '1px solid var(--border)' : 'none',
        borderLeft: side === 'left' ? '1px solid var(--border)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        position: 'relative',
        fontFamily: 'var(--font-ai-panel)',
        ...(isDevilMode ? {
          '--surface-raised': 'rgba(17, 2, 4, 0.84)',
          '--surface-base': 'rgba(8, 1, 2, 0.90)',
          '--surface-overlay': 'rgba(18, 2, 4, 0.90)',
          '--surface-sunken': 'rgba(10, 1, 2, 0.96)',
          '--text-primary': '#fff5f5',
          '--text-secondary': 'rgba(255, 112, 112, 0.92)',
          '--text-tertiary': 'rgba(255, 82, 82, 0.72)',
          '--border': 'rgba(255, 68, 68, 0.22)',
          '--border-subtle': 'rgba(255, 56, 56, 0.16)',
          '--accent': '#ff3b3b',
          '--accent-rgb': '255, 59, 59',
          '--accent-border': 'rgba(255, 72, 72, 0.46)',
          backgroundImage: [
            'radial-gradient(circle at 50% 72%, rgba(140, 0, 20, 0.34) 0%, rgba(140, 0, 20, 0.12) 20%, transparent 46%)',
            'radial-gradient(circle at 50% 8%, rgba(255, 0, 51, 0.16) 0%, transparent 24%)',
            'radial-gradient(circle at 0% 0%, rgba(255, 0, 32, 0.12) 0%, transparent 18%)',
            'radial-gradient(circle at 100% 0%, rgba(255, 0, 32, 0.12) 0%, transparent 18%)',
            'repeating-linear-gradient(135deg, rgba(255, 0, 38, 0.035) 0 1px, transparent 1px 26px)',
            'linear-gradient(180deg, rgba(22, 0, 3, 0.96) 0%, rgba(8, 0, 1, 0.99) 100%)',
          ].join(', '),
          boxShadow: 'inset 0 0 0 1px rgba(255, 56, 56, 0.14), inset 0 0 60px rgba(255, 0, 38, 0.08)',
        } : {}),
      }}
    >
      {tasksDirMigrating ? (
        <div className="absolute inset-0 bg-[rgba(5,10,18,0.6)] backdrop-blur-[3px] flex flex-col items-center justify-center gap-3" style={{ zIndex: Z.SETTINGS }}>
          <Loader2 size={36} className="animate-[spin_1s_linear_infinite] text-accent" />
          <div className="text-md font-semibold text-primary">{t('正在迁移对话数据...')}</div>
          <div className="text-sm text-tertiary">{t('迁移期间请勿使用 AI 对话')}</div>
        </div>
      ) : null}
      <AIPanelHeader
        showSettingsPanel={showSettingsPanel}
        onToggleSettings={handleToggleSettingsPanel}
        onGoHome={handleGoHome}
        showModeToggle={canToggleAIMode}
        isDevilMode={isDevilMode}
        onToggleMode={handleToggleDevilMode}
        onOpenConversationSearch={handleOpenConversationSearch}
        onOpenConversationDiff={handleOpenConversationDiff}
        showConversationSearchButton={Boolean(activeConversation) && !isConversationLoading}
        showConversationDiffButton={Boolean(activeConversation) && !isConversationLoading}
        conversationSearchActive={conversationSearchOpen}
        showContextTokens={Boolean(activeConversation) && !isConversationLoading}
        contextTokens={panelState.contextTokens}
        apiMessageCount={Array.isArray(panelState.apiMessages) ? panelState.apiMessages.length : 0}
        isCondensingContext={Boolean(panelState.isCondensingContext)}
        canCondenseContext={canQuickCondenseConversation || canSummaryCondenseConversation}
        canQuickCondenseContext={canQuickCondenseConversation}
        canSummaryCondenseContext={canSummaryCondenseConversation}
        onCondenseContext={handleCondenseContext}
        onCondenseContextFullSummary={handleCondenseContextFullSummary}
        fullSummaryCondenseAvailable={true}
      />
      {tabBar}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {renderAIConversationStage({ t, side, sessionId, terminalId, workspaceTabId, isHomeView, activeConversation, isThemeTuningConversation, isConversationLoading, normalizedInitialConversationId, conversationSearchOpen, conversationSearchQuery, setConversationSearchQuery, conversationSearchInputRef, resetConversationSearchState, handleCycleConversationSearchResult, conversationSearchResults, conversationSearchIndex, panelState, handleConversationUserMessage, handleRetryUserMessage, handleRetryAssistantMessage, handleEditUserMessage, handleDeleteMessage, handlePreviewRestore, handlePreviewDiff, handleApplyRestore, collaborationFollowupInteractionLocked, messageActionBarAtBottom, messageNavEnabled, conversationScrollSignal, sendPerfMetricsRef, composerEditState, showAssistantCollaborationActiveImage, renderedConversationList, handleGoHome })}
        {renderAIComposerSection({ t, terminalId, showComposer, panelState, activeConversation, isStreaming, isQueueBlocked, isAwaitingToolApproval, isToolRunning, isAwaitingCommandAction, isAwaitingTerminalAssignment, collaborationLocked, collaborationActive, toolResumeAvailable, shouldPersistProviderSelection, composerInteractionLocked, composerInteractionLockedLabel, effectiveProviderId, effectiveAutoApprovalSettings, providerBalanceRefreshSignal, approvalButtonOrder, commandActionButtonOrder, composerEditState, composerInputValue, setComposerInputValue, composerImages, setComposerImages, temporarySessionEnabled, setTemporarySessionEnabled, normalizedGlobalAISettings, popupDismissVersion, handleComposerSendMessage, handleCancelMessage, handleStopAndResumeMessage, handleProviderChange, handleResumeTask, handleListCommandTerminalCandidates, handleAssignToolTerminal, handleCancelQueuedSubmission, handleToggleSkipNextAutomaticRequest, handlePatchAutoApprovalSettings, handleCollaborationExtraPromptChange, handleCollaborationPromptPresetsChange, handleInterruptCollaboration, handleApproveTools, handleRejectTools, handleContinueTool, handleTerminateTool, resetComposerEditState })}
      </div>
      {renderAISettingsOverlaySection({ showSettingsPanel, setShowSettingsPanel, activeSettingsTab, setActiveSettingsTab, mcpInfo, configText, configRows, normalizedGlobalAISettings, activeConversation, panelState, runtimePhase, terminalOutputLineLimit, terminalOutputCharacterLimit, mcpClientServers, mcpClientGlobalConfigPath, mcpClientGlobalConfigText, handleSaveAIPanelGlobalSettings, handleToggleAiTerminalIsolation, handleToggleConfirmDelete, handleRestoreConversationBackup, handleTerminalOutputLineLimitChange, handleTerminalOutputCharacterLimitChange, handleSaveMCPGlobalServer, handleReloadMCPGlobalServers, handleDeleteMCPGlobalServer, handleRestartMCPClientServer, handleToggleMCPClientServer, handleToggleMCPClientServerDisabledForPrompts, handleUpdateMCPClientServerTimeout, setTasksDirMigrating })}
      </div>
    </AIWorkspaceTabProvider>
  )
}