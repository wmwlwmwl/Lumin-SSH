import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../utils/cn.ts'
import Tiptop from '../Tiptop.tsx'
import { openGlobalContextMenu } from '../../utils/contextMenu.ts'
import { t as translate, type I18nKey } from '../../i18n.ts'
import type { AIWorkspaceTab, AIWorkspaceTabGroup } from '../../utils/aiWorkspaceTabs.ts'
import type * as React from 'react'

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

// 工作区标签栏渲染段：溢出滚动箭头、标签项（执行中圆点/序号/标题/临时会话徽标/
// 双击关闭防误触）、右键菜单（关闭/分叉到新标签页/分叉到当前标签页/删除任务）与
// 新建按钮。从 AIPanel 外壳的 taskTabBar 原样搬移，闭包依赖经 deps 同名注入。
export interface AIWorkspaceTabBarDeps {
  t: LooseT
  sessionId: string
  terminalId: string
  tabGroup: AIWorkspaceTabGroup
  tabGroupRef: React.RefObject<AIWorkspaceTabGroup>
  tabRequestIds: Record<string, string>
  activeTabId: string
  aiWorkspaceTabOverflow: boolean
  aiWorkspaceTabCanScrollLeft: boolean
  aiWorkspaceTabCanScrollRight: boolean
  aiWorkspaceTabScrollRef: React.RefObject<HTMLDivElement | null>
  aiWorkspaceTabCloseLockRef: React.RefObject<{ tabId: string; confirmed: boolean; lastInteractionAt: number } | undefined>
  suppressAIWorkspaceTabCloseInteraction: (event: React.SyntheticEvent) => void
  scrollAIWorkspaceTabs: (direction: number) => void
  handleAIWorkspaceTabScroll: () => void
  handleAIWorkspaceTabWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  clearAIWorkspaceTabCloseUnlockTimer: () => void
  activateWorkspaceTab: (tabId: string) => void
  closeWorkspaceTab: (tabId: string) => void
  forkWorkspaceTabConversation: (sourceConversationId: string, sourceTabId: string, openInNewTab: boolean) => Promise<void>
  createWorkspaceTab: () => string
}

export function renderAIWorkspaceTabBar({
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
}: AIWorkspaceTabBarDeps) {
  return (
    <div
      data-ai-workspace-tab-bar="true"
      onClickCapture={suppressAIWorkspaceTabCloseInteraction}
      onDoubleClickCapture={suppressAIWorkspaceTabCloseInteraction}
      className="h-10 flex items-stretch gap-0 pt-1 px-1.5 border-b border-line bg-canvas shrink-0 overflow-hidden">
      {aiWorkspaceTabOverflow ? (
        <button
          type="button"
          className={`terminal-sub-tab-nav terminal-sub-tab-nav-left${aiWorkspaceTabCanScrollLeft ? '' : ' disabled'}`}
          onClick={() => scrollAIWorkspaceTabs(-1)}
          aria-label={t('向左滚动标签')}
          title={t('向左滚动标签')}
          disabled={!aiWorkspaceTabCanScrollLeft}>
          <ChevronLeft size={14} />
        </button>
      ) : null}
      <div
        ref={aiWorkspaceTabScrollRef}
        className="terminal-sub-tab-scroll"
        onWheel={handleAIWorkspaceTabWheel}
        onScroll={handleAIWorkspaceTabScroll}>
        {tabGroup.tabs.map((tab: AIWorkspaceTab, index) => {
          const active = tab.id === activeTabId
          const running = Boolean(tabRequestIds[tab.id])
          const transient = tab.transient === true
          const tabTitle = tab.title || t('新对话')
          const tabLabel = `${index + 1}. ${tabTitle}${transient ? ` · ${t('临时会话')}` : ''}`
          return (
            <div
              key={tab.id}
              data-ai-workspace-tab-id={tab.id}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const canCloseTab = tabGroupRef.current.tabs.length > 1
                const tabConversationId = typeof tab.conversationId === 'string' ? tab.conversationId.trim() : ''
                openGlobalContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  estimatedWidth: 188,
                  estimatedHeight: 120,
                  items: [
                    {
                      key: 'close-workspace-tab',
                      label: translate('关闭此选项卡'),
                      disabled: !canCloseTab,
                      onSelect: () => closeWorkspaceTab(tab.id),
                    },
                    {
                      key: 'fork-workspace-tab-conversation',
                      label: translate('分叉此选项卡任务'),
                      disabled: !tabConversationId,
                      children: [
                        {
                          key: 'fork-workspace-tab-conversation-new-tab',
                          label: translate('分叉到新标签页'),
                          disabled: !tabConversationId,
                          onSelect: () => {
                            void forkWorkspaceTabConversation(tabConversationId, tab.id, true)
                          },
                        },
                        {
                          key: 'fork-workspace-tab-conversation-current-tab',
                          label: translate('分叉到当前标签页'),
                          disabled: !tabConversationId,
                          onSelect: () => {
                            void forkWorkspaceTabConversation(tabConversationId, tab.id, false)
                          },
                        },
                      ],
                    },
                    {
                      key: 'delete-workspace-tab-conversation',
                      label: translate('删除此选项卡中任务'),
                      danger: true,
                      disabled: !tabConversationId,
                      onSelect: () => {
                        if (typeof window === 'undefined') {
                          return
                        }
                        window.dispatchEvent(new CustomEvent('ai-workspace-tab-delete-conversation', {
                          detail: { sessionId, terminalId, tabId: tab.id, conversationId: tabConversationId },
                        }))
                      },
                    },
                  ],
                })
              }}
              className={cn(
                'shrink-0 basis-auto w-44 min-w-[132px] max-w-[220px] flex items-center rounded-t-lg -mb-px border',
                active ? 'border-line border-b-raised bg-raised' : 'border-transparent',
              )}>
              <Tiptop text={tabLabel} placement="bottom" style={{ display: 'flex', height: '100%', minWidth: 0, flex: 1 }}>
                <button
                  type="button"
                  onClick={() => activateWorkspaceTab(tab.id)}
                  onDoubleClick={(event) => {
                    if (tabGroupRef.current.tabs.length <= 1 || aiWorkspaceTabCloseLockRef.current) {
                      return
                    }
                    event.preventDefault()
                    event.stopPropagation()
                    clearAIWorkspaceTabCloseUnlockTimer()
                    aiWorkspaceTabCloseLockRef.current = {
                      tabId: tab.id,
                      confirmed: false,
                      lastInteractionAt: Date.now(),
                    }
                    closeWorkspaceTab(tab.id)
                  }}
                  aria-label={tabLabel}
                  className={cn(
                    'min-w-0 grow basis-auto h-full flex items-center justify-start gap-[7px] pl-2.5 pr-2 border-0 relative bg-transparent cursor-pointer text-sm tabular-nums',
                    active ? 'text-primary font-bold' : 'text-secondary font-medium',
                  )}>
                  {running ? <span aria-label={t('执行中')} className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" /> : null}
                  <span className="text-muted tabular-nums shrink-0">{index + 1}</span>
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{tabTitle}</span>
                  {transient ? (
                    <span title={t('临时会话')} className="shrink-0 px-[5px] py-px rounded-sm bg-[rgba(var(--accent-rgb),0.12)] text-accent text-[10px] font-semibold">
                      {t('临时会话')}
                    </span>
                  ) : null}
                </button>
              </Tiptop>
              {tabGroup.tabs.length > 1 ? (
                <button
                  type="button"
                  aria-label={`${t('关闭')} ${tabTitle}`}
                  title={t('关闭')}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    closeWorkspaceTab(tab.id)
                  }}
                  className="w-6 h-6 mr-1 p-0 border-0 rounded-sm bg-transparent text-muted cursor-pointer shrink-0 text-lg leading-none">
                  ×
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      {aiWorkspaceTabOverflow ? (
        <button
          type="button"
          className={`terminal-sub-tab-nav terminal-sub-tab-nav-right${aiWorkspaceTabCanScrollRight ? '' : ' disabled'}`}
          onClick={() => scrollAIWorkspaceTabs(1)}
          aria-label={t('向右滚动标签')}
          title={t('向右滚动标签')}
          disabled={!aiWorkspaceTabCanScrollRight}>
          <ChevronRight size={14} />
        </button>
      ) : null}
      <button
        type="button"
        title={t('新对话')}
        aria-label={t('新对话')}
        onClick={createWorkspaceTab}
        className="w-[30px] border-0 border-b-2 border-b-transparent bg-transparent text-secondary cursor-pointer text-[18px] shrink-0">
        +
      </button>
    </div>
  )}
