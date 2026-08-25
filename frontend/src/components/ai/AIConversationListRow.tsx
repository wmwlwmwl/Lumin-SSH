import { ArchiveRestore, Bot, FolderOpen, Pencil, Scissors } from 'lucide-react'
import { cn } from '../../utils/cn.ts'
import Tiptop from '../Tiptop.tsx'
import { getLanguage } from '../../i18n.ts'
import { buildAIHistoryDisplayTimeParts, getAIHistoryRelativeTimeToneStyle } from './aiTimeFormat.ts'
import { type PanelState, type DisplayConversationItem } from './aiChatLogic.ts'
import type { I18nKey } from '../../i18n.ts'

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

const AI_ROW_ACTION_BASE =
  'w-[26px] h-[26px] inline-flex items-center justify-center rounded-md shadow-none shrink-0 cursor-pointer transition-colors duration-[120ms]';
const AI_ROW_ACTION_HOVER_ACCENT =
  'hover:text-accent hover:bg-[rgba(var(--accent-rgb),0.10)] focus-visible:text-accent focus-visible:bg-[rgba(var(--accent-rgb),0.10)]';
const AI_ROW_ACTION_HOVER_DANGER =
  'hover:text-danger hover:bg-danger-dim focus-visible:text-danger focus-visible:bg-danger-dim';

// AI 首页会话列表行渲染段：子代理/摘要子任务徽标、临时会话标签、时间与消息数、
// 多选勾选与行内操作（转正/打开目录/重命名/删除）。
// 从 renderedConversationList useMemo 原样搬移，闭包依赖经 deps 同名注入，代码零改动。
export interface AIConversationListRowDeps {
  t: LooseT
  panelState: PanelState
  selectedConversationIds: Set<string>
  conversationSelectionMode: boolean
  toggleConversationSelection: (conversationId: string) => void
  handleOpenConversation: (conversationId: string, delegateToWorkspace?: boolean) => Promise<void>
  handleMakeConversationPermanent: (conversationId: string) => Promise<void>
  handleOpenConversationFolder: (conversationId: string) => Promise<void>
  handleRenameConversationTitle: (targetConversationId?: string) => Promise<void>
  handleDeleteConversation: (conversationId: string) => Promise<void>
}

export function renderAIConversationListRow({
  t,
  panelState,
  selectedConversationIds,
  conversationSelectionMode,
  toggleConversationSelection,
  handleOpenConversation,
  handleMakeConversationPermanent,
  handleOpenConversationFolder,
  handleRenameConversationTitle,
  handleDeleteConversation,
}: AIConversationListRowDeps, item: DisplayConversationItem) {
        const isAgentSubtask = item.relationType === 'agent'
        const isArchivedAgentSubtask = isAgentSubtask && item.archived === true
        const isSummarySubtask = item.relationType === 'phase' && item.relationSource === 'summary_condense'
        const historyTimeParts = buildAIHistoryDisplayTimeParts(item.updatedAt, getLanguage() || 'zh-CN')
        const historyRelativeToneStyle = getAIHistoryRelativeTimeToneStyle(item.updatedAt)
        const displayTitle = typeof item.title === 'string'
          ? item.title.replace(/\s*·\s*摘要子任务\s*$/u, '').replace(/\s*·\s*子代理任务\s*$/u, '').trim()
          : ''
        const selected = selectedConversationIds.has(item.id)
        return (
          <div
            key={item.id}
            className="w-full flex items-center border-b border-line transition-[color,background-color,border-color,opacity,box-shadow] duration-[120ms]"
            style={{
              background: selected ? 'rgba(var(--accent-rgb), 0.12)' : (panelState.activeConversationId === item.id ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent'),
              borderLeft: panelState.activeConversationId === item.id ? '2px solid var(--accent)' : '2px solid transparent',
              opacity: item.archived === true ? 0.72 : 1,
              contentVisibility: 'auto',
              containIntrinsicSize: '56px',
              contain: 'layout paint style',
            }}
          >
            {conversationSelectionMode ? (
              <button
                type="button"
                aria-label={selected ? t('取消选择') : t('选择')}
                aria-pressed={selected}
                onClick={() => toggleConversationSelection(item.id)}
                className={cn(
                  'w-[34px] self-stretch inline-flex items-center justify-center border-0 bg-transparent cursor-pointer shrink-0',
                  'hover:text-accent hover:bg-[rgba(var(--accent-rgb),0.10)] focus-visible:text-accent focus-visible:bg-[rgba(var(--accent-rgb),0.10)]',
                  selected ? 'text-accent' : 'text-muted',
                )}>
                <span
                  className={cn(
                    'w-4 h-4 rounded-sm border inline-flex items-center justify-center text-xs text-white',
                  )}
                  style={{ borderColor: selected ? 'var(--accent)' : 'var(--border)', background: selected ? 'var(--accent)' : 'transparent' }}
                >{selected ? '✓' : ''}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => conversationSelectionMode ? toggleConversationSelection(item.id) : void handleOpenConversation(item.id)}
              className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 border-0 bg-transparent text-left cursor-pointer"
            >
              <div className="flex-1 min-w-0 grid gap-0.5" style={{ paddingLeft: item.depth > 0 ? `${item.depth * 12}px` : 0 }}>
                <div className="flex items-center gap-1.5 min-w-0">
                  {isAgentSubtask ? (
                    <Tiptop text={t('子代理任务')} placement="top">
                      <span
                        aria-label={t('子代理任务')}
                        className={cn(
                          'w-[18px] h-[18px] inline-flex items-center justify-center rounded-full shrink-0 border',
                          isArchivedAgentSubtask
                            ? 'border-line bg-sunken text-tertiary'
                            : 'border-[rgba(var(--accent-rgb),0.22)] bg-[rgba(var(--accent-rgb),0.10)] text-accent',
                        )}
                      >
                        <Bot size={11} />
                      </span>
                    </Tiptop>
                  ) : null}
                  {isSummarySubtask ? (
                    <Tiptop text={t('摘要子任务')} placement="top">
                      <span
                        aria-label={t('摘要子任务')}
                        className="w-[18px] h-[18px] inline-flex items-center justify-center rounded-full border border-[rgba(var(--accent-rgb),0.22)] bg-[rgba(var(--accent-rgb),0.10)] text-accent shrink-0"
                      >
                        <Scissors size={11} />
                      </span>
                    </Tiptop>
                  ) : null}
                  {item.transient === true ? (
                    <span title={t('临时会话')} className="shrink-0 px-[5px] py-px rounded-sm bg-[rgba(var(--accent-rgb),0.12)] text-accent text-[10px] font-semibold">
                      {t('临时会话')}
                    </span>
                  ) : null}
                  <div className={cn(
                    'min-w-0 text-base leading-tight whitespace-nowrap overflow-hidden text-ellipsis',
                    isArchivedAgentSubtask ? 'text-secondary' : 'text-primary',
                    panelState.activeConversationId === item.id ? 'font-semibold' : 'font-medium',
                  )}>{displayTitle || item.title}</div>
                </div>
                <div className="flex items-center gap-0.5 min-w-0 flex-wrap">
                  <div className="text-xs text-tertiary whitespace-nowrap inline-flex items-center gap-0">
                    <span>{historyTimeParts.absoluteText}</span>
                    {historyTimeParts.relativeText ? (
                      <span style={historyRelativeToneStyle}>({historyTimeParts.relativeText})</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted whitespace-nowrap">·{item.messageCount}</div>
                </div>
              </div>
            </button>
            {!conversationSelectionMode ? <div className="flex items-center gap-1 mr-2.5 shrink-0">
              {item.transient === true ? (
                <button
                  type="button"
                  title={`${t('临时会话')} → ${t('保存')}`}
                  aria-label={`${t('临时会话')} → ${t('保存')}`}
                  onClick={() => void handleMakeConversationPermanent(item.id)}
                  className={cn(AI_ROW_ACTION_BASE, AI_ROW_ACTION_HOVER_ACCENT, 'text-accent')}
                >
                  <ArchiveRestore size={13} />
                </button>
              ) : null}
              {item.transient !== true ? (
              <button
                type="button"
                title={t('打开任务所在文件夹')}
                aria-label={t('打开任务所在文件夹')}
                onClick={() => void handleOpenConversationFolder(item.id)}
                className={cn(AI_ROW_ACTION_BASE, AI_ROW_ACTION_HOVER_ACCENT, 'text-muted')}
              >
                <FolderOpen size={13} />
              </button>
              ) : null}
              {item.transient !== true ? (
              <button
                type="button"
                title={t('编辑任务标题')}
                aria-label={t('编辑任务标题')}
                onClick={() => void handleRenameConversationTitle(item.id)}
                className={cn(AI_ROW_ACTION_BASE, AI_ROW_ACTION_HOVER_ACCENT, 'text-muted')}
              >
                <Pencil size={13} />
              </button>
              ) : null}
              <button
                type="button"
                title={t('删除')}
                aria-label={t('删除')}
                onClick={() => {
                  void handleDeleteConversation(item.id)
                }}
                className={cn(AI_ROW_ACTION_BASE, AI_ROW_ACTION_HOVER_DANGER, 'text-muted')}
              >
                ×
              </button>
            </div> : null}
          </div>
        )}
