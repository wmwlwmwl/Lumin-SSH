import { useMemo } from 'react';
import { Check, ListEnd, X } from 'lucide-react';
import { useTranslation } from '../../i18n.ts';
import { useAIWorkspaceTabContext } from './aiWorkspaceTabContext.ts';
import AIChatReasoningBlock from './chat/AIChatReasoningBlock.tsx';
import AIChatRequestStatusRow from './chat/AIChatRequestStatusRow.tsx';
import { AIComposerTopBar } from './composer/AIComposerTopBar.tsx';
import { AIComposerInputZone } from './composer/AIComposerInputZone.tsx';
import { AIComposerBottomBar } from './composer/AIComposerBottomBar.tsx';
import { useAIComposer } from './composer/useAIComposer.ts';

export interface AIComposerProps {
  onSend?: (text: string, options: { images: string[] }) => Promise<boolean | void> | boolean | void;
  onCancel?: () => void;
  onStopAndResume?: () => void;
  isSending?: boolean;
  currentProviderId?: string;
  onCurrentProviderChange?: (providerId: string) => void;
  providerBalanceRefreshSignal?: number;
  persistProviderSelection?: boolean;
  autoApprovalSettings?: Record<string, unknown> | null;
  onPatchAutoApprovalSettings?: (patch: Record<string, unknown>) => void;
  onInterruptCollaboration?: () => void;
  approvalRequired?: boolean;
  toolRunning?: boolean;
  commandActionRequired?: boolean;
  terminalAssignmentRequired?: boolean;
  toolResumeAvailable?: boolean;
  onResumeTask?: () => void;
  onApproveTools?: () => void;
  onRejectTools?: () => void;
  onContinueTool?: () => void;
  onTerminateTool?: () => void;
  onListCommandTerminalCandidates?: () => Promise<unknown> | unknown;
  onAssignToolTerminal?: (sessionId: string) => Promise<void> | void;
  approvalButtonOrder?: 'reject-approve' | 'approve-reject';
  commandActionButtonOrder?: 'terminate-continue' | 'continue-terminate';
  inputValue?: string;
  onInputValueChange?: (value: string) => void;
  selectedImages?: string[];
  onSelectedImagesChange?: (images: string[]) => void;
  terminalSessionId?: string;
  queueBlocked?: boolean;
  queuedSubmissionKind?: string;
  onCancelQueuedSubmission?: () => void;
  skipNextAutomaticRequest?: boolean;
  onToggleSkipNextAutomaticRequest?: (next: boolean) => void;
  editModeLabel?: string;
  slashCommands?: unknown[];
  onCancelEdit?: () => void;
  collaborationLocked?: boolean;
  collaborationActive?: boolean;
  collaborationMode?: string;
  collaborationExtraPrompt?: string;
  onCollaborationExtraPromptChange?: (value: string) => void;
  collaborationPromptPresets?: unknown;
  onCollaborationPromptPresetsChange?: (presets: unknown) => void;
  collaborationPromptScopeIsTask?: boolean;
  temporarySessionEnabled?: boolean;
  onTemporarySessionEnabledChange?: (enabled: boolean) => void;
  conversationInputLocked?: boolean;
  conversationInputLockedLabel?: string;
  collaborationStatus?: Record<string, unknown> | null;
  dismissSignal?: number;
}

export default function AIComposer({
  onSend,
  onCancel,
  onStopAndResume,
  isSending = false,
  currentProviderId,
  onCurrentProviderChange,
  providerBalanceRefreshSignal = 0,
  persistProviderSelection = true,
  autoApprovalSettings,
  onPatchAutoApprovalSettings,
  onInterruptCollaboration,
  approvalRequired = false,
  toolRunning = false,
  commandActionRequired = false,
  terminalAssignmentRequired = false,
  toolResumeAvailable = false,
  onResumeTask,
  onApproveTools,
  onRejectTools,
  onContinueTool,
  onTerminateTool,
  onListCommandTerminalCandidates,
  onAssignToolTerminal,
  approvalButtonOrder = 'reject-approve',
  commandActionButtonOrder = 'terminate-continue',
  inputValue,
  onInputValueChange,
  selectedImages = [],
  onSelectedImagesChange,
  terminalSessionId = '',
  queueBlocked = false,
  queuedSubmissionKind = '',
  onCancelQueuedSubmission,
  skipNextAutomaticRequest = false,
  onToggleSkipNextAutomaticRequest,
  editModeLabel = '',
  slashCommands = [],
  onCancelEdit,
  collaborationLocked = false,
  collaborationActive = false,
  collaborationMode = '',
  collaborationExtraPrompt = '',
  onCollaborationExtraPromptChange,
  collaborationPromptPresets = [],
  onCollaborationPromptPresetsChange,
  collaborationPromptScopeIsTask = false,
  temporarySessionEnabled = false,
  onTemporarySessionEnabledChange,
  conversationInputLocked = false,
  conversationInputLockedLabel = '',
  collaborationStatus = null,
  dismissSignal = 0,
}: AIComposerProps) {
  const { t } = useTranslation();
  const { sessionId, terminalId, tabId } = useAIWorkspaceTabContext();

  const {
    value,
    setValue: _setValue,
    textareaRef,
    highlightLayerRef,
    fileInputRef,
    mentionMenuListRef,
    terminalAssignmentRef,
    collaborationToggleRef,
    isDraggingOver,
    mentionMenu,
    setMentionMenu,
    slashCommandMenu: _slashCommandMenu,
    setSlashCommandMenu,
    currentCwd,
    activeInlineMenu,
    normalizedImages,
    setImages: _setImages,
    normalizedSlashCommands: _normalizedSlashCommands,
    terminalAssignmentOpen,
    setTerminalAssignmentOpen: _setTerminalAssignmentOpen,
    terminalAssignmentLoading,
    terminalAssignmentSubmitting,
    terminalAssignmentCandidates,
    terminalAssignmentSelectedIndex,
    setTerminalAssignmentSelectedIndex,
    terminalAssignmentError,
    collaborationPromptOpen,
    setCollaborationPromptOpen,
    isCollaborationBlocked,
    isQueuedSubmissionBlocked,
    isComposerInteractionLocked,
    isComposerBlocked,
    composerInteractionLockedLabel,
    recommendedTerminalCandidate,
    secondaryTerminalCandidates,
    queuedSubmissionVisualLabel,
    alwaysAllowAssistantCollaboration,
    canToggleAssistantCollaboration,
    canInterruptAssistantCollaboration: _canInterruptAssistantCollaboration,
    queuedSubmissionCancelHint,
    skipNextAutomaticRequestTitle,
    canClickQueuedSubmissionOverlay,
    showToolResumeBar,
    canSend,
    collaborationStatusAssistant,
    collaborationStatusReasoning,
    loadMentionSuggestions,
    handleMentionItemSelect,
    handleToggleAssistantCollaboration,
    handleSelectImages,
    handleImageInputChange,
    handleInsertRemotePathFromClipboard,
    handleRemoveImage,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleOpenTerminalAssignment,
    handleAssignTerminalCandidate,
    handleSubmit,
    handleTextareaChange,
    handleTextareaKeyUp,
    handleKeyDown,
    syncHighlightScroll,
    closeInlineMenus,
    updateCursorPosition,
    syncInlineMenusWithCursor,
  } = useAIComposer({
    inputValue,
    onInputValueChange,
    selectedImages,
    onSelectedImagesChange,
    terminalSessionId,
    slashCommands,
    onSend,
    onListCommandTerminalCandidates,
    onAssignToolTerminal,
    dismissSignal,
    collaborationLocked,
    collaborationActive,
    collaborationMode,
    collaborationStatus,
    queueBlocked,
    queuedSubmissionKind,
    conversationInputLocked,
    conversationInputLockedLabel,
    autoApprovalSettings,
    onPatchAutoApprovalSettings,
    onInterruptCollaboration,
    onCancelQueuedSubmission,
    toolResumeAvailable,
    onResumeTask,
    approvalButtonOrder,
    commandActionButtonOrder,
    onApproveTools,
    onRejectTools,
    onContinueTool,
    onTerminateTool,
    skipNextAutomaticRequest,
    currentProviderId,
    sessionId,
    terminalId,
    tabId,
  });

  const approvalButtons = useMemo(() => (
    approvalButtonOrder === 'approve-reject'
      ? [
          { key: 'approve', icon: Check, label: t('批准'), onClick: onApproveTools, primary: true },
          { key: 'reject', icon: X, label: t('拒绝'), onClick: onRejectTools, primary: false },
        ]
      : [
          { key: 'reject', icon: X, label: t('拒绝'), onClick: onRejectTools, primary: false },
          { key: 'approve', icon: Check, label: t('批准'), onClick: onApproveTools, primary: true },
        ]
  ), [approvalButtonOrder, onApproveTools, onRejectTools, t]);

  const commandActionButtons = useMemo(() => (
    commandActionButtonOrder === 'continue-terminate'
      ? [
          { key: 'continue', icon: ListEnd, label: t('强制继续'), onClick: onContinueTool, primary: true },
          { key: 'terminate', icon: X, label: t('终止工具'), onClick: onTerminateTool, primary: false },
        ]
      : [
          { key: 'terminate', icon: X, label: t('终止工具'), onClick: onTerminateTool, primary: false },
          { key: 'continue', icon: ListEnd, label: t('强制继续'), onClick: onContinueTool, primary: true },
        ]
  ), [commandActionButtonOrder, onContinueTool, onTerminateTool, t]);

  const composerTextPadding = editModeLabel ? '8px 14px 10px' : '14px 14px 10px';

  return (
    <div className="shrink-0 p-0 border-t border-line bg-raised">
      <AIComposerTopBar
        showToolResumeBar={showToolResumeBar}
        onResumeTask={onResumeTask}
        approvalRequired={approvalRequired}
        commandActionRequired={commandActionRequired}
        toolRunning={toolRunning}
        terminalAssignmentRequired={terminalAssignmentRequired}
        approvalButtons={approvalButtons}
        commandActionButtons={commandActionButtons}
        terminalAssignmentRef={terminalAssignmentRef}
        terminalAssignmentOpen={terminalAssignmentOpen}
        terminalAssignmentLoading={terminalAssignmentLoading}
        terminalAssignmentSubmitting={terminalAssignmentSubmitting}
        terminalAssignmentCandidates={terminalAssignmentCandidates}
        terminalAssignmentSelectedIndex={terminalAssignmentSelectedIndex}
        setTerminalAssignmentSelectedIndex={setTerminalAssignmentSelectedIndex}
        terminalAssignmentError={terminalAssignmentError}
        recommendedTerminalCandidate={recommendedTerminalCandidate}
        secondaryTerminalCandidates={secondaryTerminalCandidates}
        handleOpenTerminalAssignment={handleOpenTerminalAssignment}
        handleAssignTerminalCandidate={handleAssignTerminalCandidate}
        onTerminateTool={onTerminateTool}
      />

      <div data-ai-composer-root="true" className="w-full border-none rounded-none bg-raised shadow-none">
        {collaborationStatusAssistant ? (
          collaborationStatusReasoning.length > 0 ? (
            <div className="flex flex-col items-start gap-2 pt-2 px-3">
              <div className="flex justify-start">
                <AIChatRequestStatusRow assistant={collaborationStatusAssistant} reasoning={collaborationStatusReasoning} />
              </div>
              <div className="w-full min-w-0">
                <AIChatReasoningBlock
                  text={collaborationStatusReasoning[0]?.text || ''}
                  duration=""
                  isStreaming={true}
                  isLast={true}
                />
              </div>
            </div>
          ) : (
            <div className="min-h-12 flex items-center justify-end px-3">
              <AIChatRequestStatusRow assistant={collaborationStatusAssistant} reasoning={collaborationStatusReasoning} />
            </div>
          )
        ) : null}

        <input
          name="ai-composer-file-input"
          autoComplete="off"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={true}
          onChange={handleImageInputChange}
          className="hidden"
        />

        <AIComposerInputZone
          isDraggingOver={isDraggingOver}
          handleDragEnter={handleDragEnter}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
          activeInlineMenu={activeInlineMenu}
          mentionMenu={mentionMenu}
          currentCwd={currentCwd}
          mentionMenuListRef={mentionMenuListRef}
          setSlashCommandMenu={setSlashCommandMenu}
          setMentionMenu={setMentionMenu}
          loadMentionSuggestions={loadMentionSuggestions}
          handleMentionItemSelect={handleMentionItemSelect}
          value={value}
          textareaRef={textareaRef}
          isQueuedSubmissionBlocked={isQueuedSubmissionBlocked}
          isCollaborationBlocked={isCollaborationBlocked}
          canClickQueuedSubmissionOverlay={canClickQueuedSubmissionOverlay}
          onCancelQueuedSubmission={onCancelQueuedSubmission}
          onInterruptCollaboration={onInterruptCollaboration}
          queuedSubmissionVisualLabel={queuedSubmissionVisualLabel}
          queuedSubmissionCancelHint={queuedSubmissionCancelHint}
          isComposerInteractionLocked={isComposerInteractionLocked}
          composerInteractionLockedLabel={composerInteractionLockedLabel}
          editModeLabel={editModeLabel}
          onCancelEdit={onCancelEdit}
          highlightLayerRef={highlightLayerRef}
          composerTextPadding={composerTextPadding}
          handleTextareaChange={handleTextareaChange}
          handleKeyDown={handleKeyDown}
          handleTextareaKeyUp={handleTextareaKeyUp}
          updateCursorPosition={updateCursorPosition}
          syncInlineMenusWithCursor={syncInlineMenusWithCursor}
          closeInlineMenus={closeInlineMenus}
          handlePaste={handlePaste}
          syncHighlightScroll={syncHighlightScroll}
          normalizedImages={normalizedImages}
          handleRemoveImage={handleRemoveImage}
          isComposerBlocked={isComposerBlocked}
          handleSelectImages={handleSelectImages}
          handleInsertRemotePathFromClipboard={handleInsertRemotePathFromClipboard}
          skipNextAutomaticRequestTitle={skipNextAutomaticRequestTitle}
          skipNextAutomaticRequest={skipNextAutomaticRequest}
          onToggleSkipNextAutomaticRequest={onToggleSkipNextAutomaticRequest}
          isSending={isSending}
          canSend={canSend}
          onCancel={onCancel}
          handleSubmit={handleSubmit}
          onStopAndResume={onStopAndResume}
        />

        <AIComposerBottomBar
          currentProviderId={currentProviderId}
          onCurrentProviderChange={onCurrentProviderChange}
          providerBalanceRefreshSignal={providerBalanceRefreshSignal}
          persistProviderSelection={persistProviderSelection}
          dismissSignal={dismissSignal}
          autoApprovalSettings={autoApprovalSettings}
          onPatchAutoApprovalSettings={onPatchAutoApprovalSettings}
          collaborationPromptOpen={collaborationPromptOpen}
          setCollaborationPromptOpen={setCollaborationPromptOpen}
          alwaysAllowAssistantCollaboration={alwaysAllowAssistantCollaboration}
          collaborationExtraPrompt={collaborationExtraPrompt}
          onCollaborationExtraPromptChange={onCollaborationExtraPromptChange}
          collaborationPromptPresets={collaborationPromptPresets}
          onCollaborationPromptPresetsChange={onCollaborationPromptPresetsChange}
          collaborationToggleRef={collaborationToggleRef}
          collaborationPromptScopeIsTask={collaborationPromptScopeIsTask}
          canToggleAssistantCollaboration={canToggleAssistantCollaboration}
          handleToggleAssistantCollaboration={handleToggleAssistantCollaboration}
          temporarySessionEnabled={Boolean(temporarySessionEnabled)}
          onTemporarySessionEnabledChange={onTemporarySessionEnabledChange}
        />
      </div>
    </div>
  );
}
