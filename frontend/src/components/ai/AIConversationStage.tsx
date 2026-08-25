import { Z } from '../../constants/zIndex'
import { cn } from '../../utils/cn.ts'
import { Button } from '../ui'
import AIChatConversation from './chat/AIChatConversation.tsx'
import assistantThinkingActiveImg from '../../assets/assistant-thinking-active.webm'
import type { AIConversationSnapshot, ComposerEditState, PanelState, PerfRecord } from './aiChatLogic.ts'
import type { AIConversationMessageSearchResult } from './aiConversationBridge.ts'
import type { I18nKey } from '../../i18n.ts'
import type * as React from 'react'

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

// 对话舞台渲染段：配色模式横幅 + 当前对话搜索条 + AIChatConversation 消息流 +
// 协同思考动效视频。从 AIConversationTabPanel return JSX 原样搬移，
// 闭包依赖经 deps 同名注入，代码零改动。
export interface AIConversationStageDeps {
  t: LooseT
  side: 'left' | 'right'
  sessionId: string
  terminalId: string
  workspaceTabId: string
  isHomeView: boolean
  activeConversation: AIConversationSnapshot | null
  isThemeTuningConversation: boolean
  isConversationLoading: boolean
  normalizedInitialConversationId: string
  conversationSearchOpen: boolean
  conversationSearchQuery: string
  setConversationSearchQuery: React.Dispatch<React.SetStateAction<string>>
  conversationSearchInputRef: React.RefObject<HTMLInputElement | null>
  resetConversationSearchState: () => void
  handleCycleConversationSearchResult: (direction: number) => void
  conversationSearchResults: AIConversationMessageSearchResult[]
  conversationSearchIndex: number
  panelState: PanelState
  handleConversationUserMessage: (payload: string | Record<string, unknown>) => Promise<boolean>
  handleRetryUserMessage: (messageId: string, text: string, images?: unknown[]) => Promise<void>
  handleRetryAssistantMessage: (messageId: string) => Promise<boolean>
  handleEditUserMessage: (messageId: string, text: string, images?: unknown[]) => void
  handleDeleteMessage: (messageId: string) => Promise<void>
  handlePreviewRestore: (restoreArtifactPath: string) => Promise<void>
  handlePreviewDiff: (restoreArtifactPath: string) => Promise<unknown>
  handleApplyRestore: (restoreArtifactPath: string) => Promise<boolean>
  collaborationFollowupInteractionLocked: boolean
  messageActionBarAtBottom: boolean
  messageNavEnabled: boolean
  conversationScrollSignal: number
  sendPerfMetricsRef: React.RefObject<Map<string, PerfRecord>>
  composerEditState: ComposerEditState
  showAssistantCollaborationActiveImage: boolean
  renderedConversationList: React.ReactNode
  handleGoHome: () => Promise<void>
}

export function renderAIConversationStage({
  t,
  side,
  sessionId,
  terminalId,
  workspaceTabId,
  isHomeView,
  activeConversation,
  isThemeTuningConversation,
  isConversationLoading,
  normalizedInitialConversationId,
  conversationSearchOpen,
  conversationSearchQuery,
  setConversationSearchQuery,
  conversationSearchInputRef,
  resetConversationSearchState,
  handleCycleConversationSearchResult,
  conversationSearchResults,
  conversationSearchIndex,
  panelState,
  handleConversationUserMessage,
  handleRetryUserMessage,
  handleRetryAssistantMessage,
  handleEditUserMessage,
  handleDeleteMessage,
  handlePreviewRestore,
  handlePreviewDiff,
  handleApplyRestore,
  collaborationFollowupInteractionLocked,
  messageActionBarAtBottom,
  messageNavEnabled,
  conversationScrollSignal,
  sendPerfMetricsRef,
  composerEditState,
  showAssistantCollaborationActiveImage,
  renderedConversationList,
  handleGoHome,
}: AIConversationStageDeps) {
  return (
        <div data-ai-chat-stage="true" className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
          {activeConversation || !isHomeView ? (
            <>
              {isThemeTuningConversation && !isConversationLoading ? (
                <div className="px-3 py-2 border-b border-accent-border bg-[rgba(var(--accent-rgb),0.08)] flex items-center justify-between gap-2.5">
                  <div className="text-sm text-secondary leading-normal">
                    {t('当前处于配色模式,对话记录不会保存')}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { void handleGoHome() }}
                    className="shrink-0"
                  >
                    {t('退出配色模式')}
                  </Button>
                </div>
              ) : null}
              {conversationSearchOpen ? (
                <div className="px-3 py-2 border-b border-line bg-raised grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                  <input
                    id="ai-panel-main-conversation-search"
                    name="ai-panel-main-conversation-search"
                    autoComplete="off"
                    ref={conversationSearchInputRef}
                    value={conversationSearchQuery}
                    onChange={(event) => setConversationSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        resetConversationSearchState()
                        return
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleCycleConversationSearchResult(event.shiftKey ? -1 : 1)
                      }
                    }}
                    placeholder={t('输入关键词搜索当前对话')}
                    className="h-[34px] w-full rounded-lg border border-line bg-sunken text-primary px-2.5 box-border outline-none"
                  />
                  <div className="min-w-12 text-center text-sm text-tertiary tabular-nums">
                    {conversationSearchResults.length > 0 ? `${conversationSearchIndex + 1}/${conversationSearchResults.length}` : '0/0'}
                  </div>
                  <button
                    type="button"
                    title={t('上一个搜索结果')}
                    aria-label={t('上一个搜索结果')}
                    onClick={() => handleCycleConversationSearchResult(-1)}
                    disabled={conversationSearchResults.length === 0}
                    className={cn(
                      'w-[34px] h-[34px] inline-flex items-center justify-center rounded-lg border border-line bg-canvas',
                      conversationSearchResults.length > 0 ? 'text-primary cursor-pointer' : 'text-muted cursor-not-allowed',
                    )}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    title={t('下一个搜索结果')}
                    aria-label={t('下一个搜索结果')}
                    onClick={() => handleCycleConversationSearchResult(1)}
                    disabled={conversationSearchResults.length === 0}
                    className={cn(
                      'w-[34px] h-[34px] inline-flex items-center justify-center rounded-lg border border-line bg-canvas',
                      conversationSearchResults.length > 0 ? 'text-primary cursor-pointer' : 'text-muted cursor-not-allowed',
                    )}
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    title={t('关闭搜索')}
                    aria-label={t('关闭搜索')}
                    onClick={resetConversationSearchState}
                    className="w-[34px] h-[34px] inline-flex items-center justify-center rounded-lg border border-line bg-canvas text-tertiary cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <AIChatConversation
                messages={isConversationLoading ? [] : panelState.messages}
                sessionId={sessionId}
                terminalId={terminalId}
                conversationId={isConversationLoading ? normalizedInitialConversationId || workspaceTabId : activeConversation?.id || workspaceTabId}
                tabId={workspaceTabId}
                onSendUserMessage={handleConversationUserMessage}
                onRetryUserMessage={handleRetryUserMessage}
                onRetryAssistantMessage={handleRetryAssistantMessage}
                onEditUserMessage={handleEditUserMessage}
                onDeleteMessage={handleDeleteMessage}
                onPreviewRestore={handlePreviewRestore}
                onPreviewDiffFetch={handlePreviewDiff}
                onApplyRestore={handleApplyRestore}
                followupInteractionLocked={collaborationFollowupInteractionLocked}
                messageActionBarAtBottom={messageActionBarAtBottom}
                messageNavEnabled={messageNavEnabled}
                side={side}
                scrollToBottomSignal={conversationScrollSignal}
                sendPerfMetricsRef={sendPerfMetricsRef}
                editingTargetMessageId={composerEditState.mode === 'edit' ? composerEditState.targetMessageId : ''}
              />
            </>
          ) : renderedConversationList}
          {showAssistantCollaborationActiveImage ? (
            <video
              src={assistantThinkingActiveImg}
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
              className="absolute right-[18px] bottom-0 w-[min(32%,180px)] min-w-[120px] max-w-[42vw] max-h-[280px] object-contain pointer-events-none select-none opacity-96 drop-shadow-[0_10px_24px_rgba(0,0,0,0.22)]"
              style={{ zIndex: Z.STACK }}
            />
          ) : null}
        </div>  )
}
