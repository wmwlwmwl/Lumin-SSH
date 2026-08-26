import type * as React from 'react'
import AIComposer from './AIComposer.tsx'
import AIPanelSettingsOverlay from './AIPanelSettingsOverlay.tsx'
import type { AIConversationSnapshot, PanelState } from './aiChatLogic.ts'
import { type I18nKey } from '../../i18n.ts'
import type { AIGlobalSettings } from './aiGlobalSettingsBridge.ts'

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

// 输入区渲染段：AIComposer 全量 props（发送/取消/排队/协同状态/自动审批设置/
// 供应商切换与余额刷新等）。从 AIConversationTabPanel return JSX 原样搬移，
// 闭包依赖经 deps 同名注入，代码零改动。
export interface AIComposerSectionDeps {
  t: LooseT
  terminalId: string
  showComposer: boolean
  panelState: PanelState
  activeConversation: AIConversationSnapshot | null
  isStreaming: boolean
  isQueueBlocked: boolean
  isAwaitingToolApproval: boolean
  isToolRunning: boolean
  isAwaitingCommandAction: boolean
  isAwaitingTerminalAssignment: boolean
  collaborationLocked: boolean
  collaborationActive: boolean
  toolResumeAvailable: boolean
  shouldPersistProviderSelection: boolean
  composerInteractionLocked: boolean
  composerInteractionLockedLabel: string
  effectiveProviderId: string
  effectiveAutoApprovalSettings: import('./aiConversationBridge.ts').AIConversationTaskSettings & { allowedCommands?: unknown; deniedCommands?: unknown }
  providerBalanceRefreshSignal: number
  approvalButtonOrder: React.ComponentProps<typeof AIComposer>['approvalButtonOrder']
  commandActionButtonOrder: React.ComponentProps<typeof AIComposer>['commandActionButtonOrder']
  composerEditState: import('./aiChatLogic.ts').ComposerEditState
  composerInputValue: string
  setComposerInputValue: React.Dispatch<React.SetStateAction<string>>
  composerImages: string[]
  setComposerImages: React.Dispatch<React.SetStateAction<string[]>>
  temporarySessionEnabled: boolean
  setTemporarySessionEnabled: React.Dispatch<React.SetStateAction<boolean>>
  normalizedGlobalAISettings: AIGlobalSettings
  popupDismissVersion: number
  handleComposerSendMessage: React.ComponentProps<typeof AIComposer>['onSend']
  handleCancelMessage: () => Promise<void>
  handleStopAndResumeMessage: () => Promise<void>
  handleProviderChange: (providerId: string) => Promise<void>
  handleResumeTask: () => Promise<boolean>
  handleListCommandTerminalCandidates: () => Promise<unknown[]>
  handleAssignToolTerminal: (targetSessionId: string) => Promise<void>
  handleCancelQueuedSubmission: () => void
  handleToggleSkipNextAutomaticRequest: (enabled: boolean) => Promise<void>
  handlePatchAutoApprovalSettings: (patch: Record<string, unknown>) => Promise<void>
  handleCollaborationExtraPromptChange: (nextValue: string) => Promise<void>
  handleCollaborationPromptPresetsChange: (nextPresets: unknown) => Promise<void>
  handleInterruptCollaboration: () => Promise<void>
  handleApproveTools: () => Promise<void>
  handleRejectTools: () => Promise<void>
  handleContinueTool: () => Promise<void>
  handleTerminateTool: () => Promise<void>
  resetComposerEditState: () => void
}

export function renderAIComposerSection({
  t,
  terminalId,
  showComposer,
  panelState,
  activeConversation,
  isStreaming,
  isQueueBlocked,
  isAwaitingToolApproval,
  isToolRunning,
  isAwaitingCommandAction,
  isAwaitingTerminalAssignment,
  collaborationLocked,
  collaborationActive,
  toolResumeAvailable,
  shouldPersistProviderSelection,
  composerInteractionLocked,
  composerInteractionLockedLabel,
  effectiveProviderId,
  effectiveAutoApprovalSettings,
  providerBalanceRefreshSignal,
  approvalButtonOrder,
  commandActionButtonOrder,
  composerEditState,
  composerInputValue,
  setComposerInputValue,
  composerImages,
  setComposerImages,
  temporarySessionEnabled,
  setTemporarySessionEnabled,
  normalizedGlobalAISettings,
  popupDismissVersion,
  handleComposerSendMessage,
  handleCancelMessage,
  handleStopAndResumeMessage,
  handleProviderChange,
  handleResumeTask,
  handleListCommandTerminalCandidates,
  handleAssignToolTerminal,
  handleCancelQueuedSubmission,
  handleToggleSkipNextAutomaticRequest,
  handlePatchAutoApprovalSettings,
  handleCollaborationExtraPromptChange,
  handleCollaborationPromptPresetsChange,
  handleInterruptCollaboration,
  handleApproveTools,
  handleRejectTools,
  handleContinueTool,
  handleTerminateTool,
  resetComposerEditState,
}: AIComposerSectionDeps) {
  return (
        showComposer ? (
        <AIComposer
          onSend={handleComposerSendMessage}
          onCancel={handleCancelMessage}
          onStopAndResume={handleStopAndResumeMessage}
          conversationInputLocked={composerInteractionLocked}
          conversationInputLockedLabel={composerInteractionLockedLabel}
          isSending={isStreaming}
          currentProviderId={effectiveProviderId}
          onCurrentProviderChange={handleProviderChange}
          providerBalanceRefreshSignal={providerBalanceRefreshSignal}
          terminalSessionId={terminalId}
          queueBlocked={isQueueBlocked || panelState.isFlushingQueuedSubmission}
          queuedSubmissionKind={panelState.queuedSubmission?.kind || ''}
          collaborationLocked={collaborationLocked}
          collaborationActive={collaborationActive}
          collaborationMode={panelState.collaborationMode}
          collaborationStatus={collaborationActive ? {
            startedAtMs: panelState.collaborationStatusStartedAtMs,
            firstTokenAtMs: panelState.collaborationStatusFirstTokenAtMs,
            text: panelState.collaborationStatusText,
            reasoningText: panelState.collaborationStatusReasoningText,
          } : null}
          terminalAssignmentRequired={isAwaitingTerminalAssignment}
          toolResumeAvailable={toolResumeAvailable}
          onResumeTask={handleResumeTask}
          onListCommandTerminalCandidates={handleListCommandTerminalCandidates}
          onAssignToolTerminal={handleAssignToolTerminal}
          onCancelQueuedSubmission={handleCancelQueuedSubmission}
          skipNextAutomaticRequest={Boolean(panelState.skipNextAutomaticRequest)}
          onToggleSkipNextAutomaticRequest={handleToggleSkipNextAutomaticRequest}
          persistProviderSelection={shouldPersistProviderSelection}
          autoApprovalSettings={effectiveAutoApprovalSettings}
          onPatchAutoApprovalSettings={handlePatchAutoApprovalSettings}
          collaborationExtraPrompt={effectiveAutoApprovalSettings.collaborationExtraPrompt || ''}
          onCollaborationExtraPromptChange={handleCollaborationExtraPromptChange}
          collaborationPromptPresets={normalizedGlobalAISettings.collaborationPromptPresets}
          onCollaborationPromptPresetsChange={handleCollaborationPromptPresetsChange}
          collaborationPromptScopeIsTask={Boolean(activeConversation)}
          temporarySessionEnabled={temporarySessionEnabled}
          onTemporarySessionEnabledChange={setTemporarySessionEnabled}
          onInterruptCollaboration={handleInterruptCollaboration}
          approvalRequired={isAwaitingToolApproval}
          toolRunning={isToolRunning}
          commandActionRequired={isAwaitingCommandAction}
          onApproveTools={handleApproveTools}
          onRejectTools={handleRejectTools}
          onContinueTool={handleContinueTool}
          onTerminateTool={handleTerminateTool}
          approvalButtonOrder={approvalButtonOrder}
          commandActionButtonOrder={commandActionButtonOrder}
          inputValue={composerInputValue}
          onInputValueChange={setComposerInputValue}
          selectedImages={composerImages}
          onSelectedImagesChange={setComposerImages}
          editModeLabel={composerEditState.mode === 'edit' ? t('编辑消息后将从该消息起重建后续对话') : ''}
          slashCommands={normalizedGlobalAISettings.slashCommands}
          onCancelEdit={resetComposerEditState}
          dismissSignal={popupDismissVersion}
        />
        ) : null
  )
}

// 设置浮层渲染段：AIPanelSettingsOverlay 全量 props（MCP 信息/全局设置/备份恢复/
// 输出压缩限制/MCP 客户端服务器管理）。从 AIConversationTabPanel return JSX 原样搬移，
// 闭包依赖经 deps 同名注入，代码零改动。
export interface AISettingsOverlaySectionDeps {
  showSettingsPanel: boolean
  setShowSettingsPanel: React.Dispatch<React.SetStateAction<boolean>>
  activeSettingsTab: string
  setActiveSettingsTab: React.Dispatch<React.SetStateAction<string>>
  mcpInfo: React.ComponentProps<typeof AIPanelSettingsOverlay>['mcpInfo']
  configText: string
  configRows: number
  normalizedGlobalAISettings: AIGlobalSettings
  activeConversation: AIConversationSnapshot | null
  panelState: PanelState
  runtimePhase: string
  terminalOutputLineLimit: number
  terminalOutputCharacterLimit: number
  mcpClientServers: unknown[]
  mcpClientGlobalConfigPath: string
  mcpClientGlobalConfigText: string
  handleSaveAIPanelGlobalSettings: (patch: Record<string, unknown>) => Promise<unknown>
  handleToggleAiTerminalIsolation: () => Promise<void>
  handleToggleConfirmDelete: () => Promise<void>
  handleRestoreConversationBackup: (snapshot: unknown) => Promise<void>
  handleTerminalOutputLineLimitChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handleTerminalOutputCharacterLimitChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handleSaveMCPGlobalServer: (name: string, configText: string) => Promise<void>
  handleReloadMCPGlobalServers: () => Promise<void>
  handleDeleteMCPGlobalServer: (name: string) => Promise<void>
  handleRestartMCPClientServer: (name: string, source: string) => Promise<void>
  handleToggleMCPClientServer: (name: string, source: string, disabled: boolean) => Promise<void>
  handleToggleMCPClientServerDisabledForPrompts: (name: string, source: string, disabledForPrompts: boolean) => Promise<void>
  handleToggleMCPClientServerToolDisabledForPrompts: (name: string, source: string, toolName: string, disabledForPrompts: boolean) => Promise<void>
  handleUpdateMCPClientServerTimeout: (name: string, source: string, timeout: number) => Promise<void>
  setTasksDirMigrating: React.Dispatch<React.SetStateAction<boolean>>
}

export function renderAISettingsOverlaySection({
  showSettingsPanel,
  setShowSettingsPanel,
  activeSettingsTab,
  setActiveSettingsTab,
  mcpInfo,
  configText,
  configRows,
  normalizedGlobalAISettings,
  activeConversation,
  panelState,
  runtimePhase,
  terminalOutputLineLimit,
  terminalOutputCharacterLimit,
  mcpClientServers,
  mcpClientGlobalConfigPath,
  mcpClientGlobalConfigText,
  handleSaveAIPanelGlobalSettings,
  handleToggleAiTerminalIsolation,
  handleToggleConfirmDelete,
  handleRestoreConversationBackup,
  handleTerminalOutputLineLimitChange,
  handleTerminalOutputCharacterLimitChange,
  handleSaveMCPGlobalServer,
  handleReloadMCPGlobalServers,
  handleDeleteMCPGlobalServer,
  handleRestartMCPClientServer,
  handleToggleMCPClientServer,
  handleToggleMCPClientServerDisabledForPrompts,
  handleToggleMCPClientServerToolDisabledForPrompts,
  handleUpdateMCPClientServerTimeout,
  setTasksDirMigrating,
}: AISettingsOverlaySectionDeps) {
  return (
      <AIPanelSettingsOverlay
        show={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        activeTab={activeSettingsTab}
        onChangeTab={setActiveSettingsTab}
        mcpInfo={mcpInfo}
        configText={configText}
        configRows={configRows}
        globalAISettings={normalizedGlobalAISettings}
        onSaveGlobalAISettings={handleSaveAIPanelGlobalSettings}
        aiTerminalIsolation={normalizedGlobalAISettings.terminalIsolation}
        onToggleAiTerminalIsolation={handleToggleAiTerminalIsolation}
        confirmDelete={normalizedGlobalAISettings.confirmDelete}
        onToggleConfirmDelete={handleToggleConfirmDelete}
        activeConversationId={activeConversation?.id || ''}
        conversationUpdatedAt={activeConversation?.updatedAt || 0}
        backupRequestInFlight={panelState.requestPhase !== 'idle' || runtimePhase !== 'ready'}
        onRestoreConversationBackup={handleRestoreConversationBackup}
        autoBackupEnabled={normalizedGlobalAISettings.conversationAutoBackupEnabled !== false}
        onToggleAutoBackup={() => handleSaveAIPanelGlobalSettings({
          conversationAutoBackupEnabled: !normalizedGlobalAISettings.conversationAutoBackupEnabled,
        })}
        soundEnabled={normalizedGlobalAISettings.soundEnabled !== false}
        soundVolume={normalizedGlobalAISettings.soundVolume ?? 0.06}
        terminalOutputLineLimit={terminalOutputLineLimit}
        onTerminalOutputLineLimitChange={handleTerminalOutputLineLimitChange}
        terminalOutputCharacterLimit={terminalOutputCharacterLimit}
        onTerminalOutputCharacterLimitChange={handleTerminalOutputCharacterLimitChange}
        mcpClientServers={mcpClientServers}
        mcpClientGlobalConfigPath={mcpClientGlobalConfigPath}
        mcpClientGlobalConfigText={mcpClientGlobalConfigText}
        onSaveMCPGlobalServer={handleSaveMCPGlobalServer}
        onReloadMCPGlobalServers={handleReloadMCPGlobalServers}
        onDeleteMCPGlobalServer={handleDeleteMCPGlobalServer}
        onRestartMCPClientServer={handleRestartMCPClientServer}
        onToggleMCPClientServer={handleToggleMCPClientServer}
        onToggleMCPClientServerDisabledForPrompts={handleToggleMCPClientServerDisabledForPrompts}
        onToggleMCPClientServerToolDisabledForPrompts={handleToggleMCPClientServerToolDisabledForPrompts}
        onUpdateMCPClientServerTimeout={handleUpdateMCPClientServerTimeout}
        onMigratingChange={setTasksDirMigrating}
      />
  )
}
