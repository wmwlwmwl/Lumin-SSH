import { useTranslation } from '../i18n.ts'
import { useAIWorkspaceTabs } from './ai/useAIWorkspaceTabs.ts'
import { renderAIWorkspaceTabBar } from './ai/AIWorkspaceTabBar.tsx'
import { AIConversationTabPanel } from './ai/AIConversationTabPanel.tsx'
import type { AIPanelProps } from './ai/aiChatLogic.ts'

// AIPanel：AI 工作区多标签管理外壳。单个标签页面板见 ./ai/AIConversationTabPanel.tsx。
export default function AIPanel({ width, side, sessionId, terminalId, sessionTerminals = [], isPanelVisible = true, onDevilModeChange, onActiveTabChange, onActivateWorkspaceTab, addToast }: AIPanelProps) {
  const { t } = useTranslation()
  const {
    tabGroup, tabRequestIds, activeTabId, tabGroupRef, aiWorkspaceTabScrollRef,
    aiWorkspaceTabCloseLockRef, aiWorkspaceTabOverflow, aiWorkspaceTabCanScrollLeft, aiWorkspaceTabCanScrollRight,
    clearAIWorkspaceTabCloseUnlockTimer, suppressAIWorkspaceTabCloseInteraction, scrollAIWorkspaceTabs,
    handleAIWorkspaceTabScroll, handleAIWorkspaceTabWheel, createWorkspaceTab, returnWorkspaceTabHome, activateWorkspaceTab,
    closeWorkspaceTab, forkWorkspaceTabConversation, openConversationInWorkspaceTab, handleWorkspaceTabStateChange,
  } = useAIWorkspaceTabs({ t, terminalId, sessionId, onActiveTabChange, onActivateWorkspaceTab })
  const taskTabBar = renderAIWorkspaceTabBar({
    t,
    sessionId,
    terminalId,
    tabGroup,
    tabGroupRef,
    tabRequestIds,
    activeTabId,
    aiWorkspaceTabOverflow,
    aiWorkspaceTabCanScrollLeft,
    aiWorkspaceTabCanScrollRight,
    aiWorkspaceTabScrollRef,
    aiWorkspaceTabCloseLockRef,
    suppressAIWorkspaceTabCloseInteraction,
    scrollAIWorkspaceTabs,
    handleAIWorkspaceTabScroll,
    handleAIWorkspaceTabWheel,
    clearAIWorkspaceTabCloseUnlockTimer,
    activateWorkspaceTab,
    closeWorkspaceTab,
    forkWorkspaceTabConversation,
    createWorkspaceTab,
  })
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden relative" style={{ width, minWidth: width }}>
      {tabGroup.tabs.map((tab) => (
        <div key={tab.id} className="absolute inset-0" style={{ display: activeTabId === tab.id ? 'flex' : 'none' }}>
          <AIConversationTabPanel
            width="100%"
            side={side}
            sessionId={sessionId}
            terminalId={terminalId}
            sessionTerminals={sessionTerminals}
            workspaceTabId={tab.id}
            isHomeView={tab.conversationId === ''}
            isWorkspaceTabActive={isPanelVisible && activeTabId === tab.id}
            initialConversationId={tab.conversationId}
            tabBar={taskTabBar}
            onDevilModeChange={isPanelVisible && activeTabId === tab.id ? (enabled) => onDevilModeChange?.(enabled, tab.id) : undefined}
            onGoHomeRequested={() => returnWorkspaceTabHome(tab.id)}
            onOpenConversationRequested={openConversationInWorkspaceTab}
            onWorkspaceTabStateChange={handleWorkspaceTabStateChange}
            addToast={addToast}
          />
        </div>
      ))}
    </div>
  )}
