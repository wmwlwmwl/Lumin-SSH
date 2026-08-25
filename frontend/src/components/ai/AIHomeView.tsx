import { Archive, ArchiveRestore, CheckSquare, FolderPlus, Search, Trash2 } from 'lucide-react'
import { Z } from '../../constants/zIndex'
import { Button } from '../ui'
import { cn } from '../../utils/cn.ts'
import { getLanguage } from '../../i18n.ts'
import { buildAIConversationDisplayList, type PanelState } from './aiChatLogic.ts'
import type { AIConversationMessageSearchResult } from './aiConversationBridge.ts'
import type { ConversationSummary } from './aiConversationSummary.ts'
import { buildAIHistoryDisplayTimeParts, getAIHistoryRelativeTimeToneStyle } from './aiTimeFormat.ts'
import type { AIConversationOrganizerState } from '../../utils/aiConversationOrganizer.ts'
import { renderAIConversationListRow } from './AIConversationListRow.tsx'
import type { I18nKey } from '../../i18n.ts'
import type * as React from 'react'

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

// AI 面板首页视图渲染段：全局搜索结果列表 / 分组 tab（拖拽重排/重命名）/ 会话列表 /
// 多选批量操作条。从 renderedConversationList useMemo 原样搬移，
// 闭包依赖经 deps 同名注入，行渲染委托 renderAIConversationListRow。
export interface AIHomeViewDeps {
  t: LooseT
  conversationList: ConversationSummary[]
  conversationOrganizer: AIConversationOrganizerState
  conversationFilter: string
  setConversationFilter: React.Dispatch<React.SetStateAction<string>>
  conversationSelectionMode: boolean
  setConversationSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  selectedConversationIds: Set<string>
  moveToGroupOpen: boolean
  setMoveToGroupOpen: React.Dispatch<React.SetStateAction<boolean>>
  editingConversationGroupId: string
  editingConversationGroupName: string
  setEditingConversationGroupName: React.Dispatch<React.SetStateAction<string>>
  draggingConversationGroupId: string
  dragOverConversationGroupId: string
  setDraggingConversationGroupId: React.Dispatch<React.SetStateAction<string>>
  setDragOverConversationGroupId: React.Dispatch<React.SetStateAction<string>>
  panelState: PanelState
  globalSearchOpen: boolean
  globalSearchQuery: string
  setGlobalSearchQuery: React.Dispatch<React.SetStateAction<string>>
  normalizedGlobalSearchQuery: string
  globalSearchLoading: boolean
  globalSearchResults: AIConversationMessageSearchResult[]
  globalSearchInputRef: React.RefObject<HTMLInputElement | null>
  conversationGroupRenameInputRef: React.RefObject<HTMLInputElement | null>
  resetGlobalSearchState: () => void
  handleOpenGlobalSearch: () => void
  handleSelectGlobalSearchResult: (result: AIConversationMessageSearchResult) => Promise<void>
  toggleConversationSelection: (conversationId: string) => void
  clearConversationSelection: () => void
  handleOpenConversation: (conversationId: string, delegateToWorkspace?: boolean) => Promise<void>
  handleMakeConversationPermanent: (conversationId: string) => Promise<void>
  handleOpenConversationFolder: (conversationId: string) => Promise<void>
  handleRenameConversationTitle: (targetConversationId?: string) => Promise<void>
  handleDeleteConversation: (conversationId: string) => Promise<void>
  handleCreateConversationGroup: () => Promise<void>
  beginRenameConversationGroup: (groupId: string) => void
  cancelRenameConversationGroup: () => void
  commitRenameConversationGroup: () => void
  reorderConversationGroup: (sourceGroupId: string, targetGroupId: string) => void
  showSystemGroupRenameUnsupported: () => void
  handleDeleteConversationGroup: (groupId: string) => Promise<void>
  handleMoveSelectedConversations: (groupId: string) => void
  handleSetSelectedArchived: (archived: boolean) => Promise<void>
  handleDeleteSelectedConversations: () => Promise<void>
}

export function renderAIHomeView({
  t,
  conversationList,
  conversationOrganizer,
  conversationFilter,
  setConversationFilter,
  conversationSelectionMode,
  setConversationSelectionMode,
  selectedConversationIds,
  moveToGroupOpen,
  setMoveToGroupOpen,
  editingConversationGroupId,
  editingConversationGroupName,
  setEditingConversationGroupName,
  draggingConversationGroupId,
  dragOverConversationGroupId,
  setDraggingConversationGroupId,
  setDragOverConversationGroupId,
  panelState,
  globalSearchOpen,
  globalSearchQuery,
  setGlobalSearchQuery,
  normalizedGlobalSearchQuery,
  globalSearchLoading,
  globalSearchResults,
  globalSearchInputRef,
  conversationGroupRenameInputRef,
  resetGlobalSearchState,
  handleOpenGlobalSearch,
  handleSelectGlobalSearchResult,
  toggleConversationSelection,
  clearConversationSelection,
  handleOpenConversation,
  handleMakeConversationPermanent,
  handleOpenConversationFolder,
  handleRenameConversationTitle,
  handleDeleteConversation,
  handleCreateConversationGroup,
  beginRenameConversationGroup,
  cancelRenameConversationGroup,
  commitRenameConversationGroup,
  reorderConversationGroup,
  showSystemGroupRenameUnsupported,
  handleDeleteConversationGroup,
  handleMoveSelectedConversations,
  handleSetSelectedArchived,
  handleDeleteSelectedConversations,
}: AIHomeViewDeps) {
    let content = null
    const getConversationGroupId = (item: ConversationSummary) => {
      const ownerId = item.rootConversationId || item.parentConversationId || item.id
      return conversationOrganizer.assignments[item.id] || conversationOrganizer.assignments[ownerId] || ''
    }
    const visibleConversationList = conversationList.filter((item) => {
      if (conversationFilter === 'archived') return item.archived === true
      if (item.archived === true) return false
      if (conversationFilter === 'all') return true
      const groupId = getConversationGroupId(item)
      return conversationFilter === 'ungrouped' ? !groupId : groupId === conversationFilter
    })
    const displayConversationList = buildAIConversationDisplayList(visibleConversationList)

    if (globalSearchOpen) {
      content = (
        <div className="grid min-h-0">
          <div className="px-3.5 py-2.5 border-b border-line-subtle bg-canvas">
            <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
              <input
                id="ai-panel-main-global-search"
                name="ai-panel-main-global-search"
                autoComplete="off"
                ref={globalSearchInputRef}
                value={globalSearchQuery}
                onChange={(event) => setGlobalSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    resetGlobalSearchState()
                  }
                }}
                placeholder={t('输入关键词搜索全部对话')}
                className="h-[34px] w-full rounded-lg border border-line bg-sunken text-primary px-2.5 box-border outline-none"
              />
              <button
                type="button"
                title={t('关闭搜索')}
                aria-label={t('关闭搜索')}
                onClick={resetGlobalSearchState}
                className="w-[34px] h-[34px] inline-flex items-center justify-center rounded-lg border border-line bg-canvas text-tertiary cursor-pointer"
              >
                ×
              </button>
            </div>
          </div>
          {normalizedGlobalSearchQuery ? (
            globalSearchLoading ? (
              <div className="min-h-[calc(100%-101px)] flex items-center justify-center p-5 text-center text-tertiary text-sm leading-[1.8]">
                {t('加载中...')}
              </div>
            ) : globalSearchResults.length === 0 ? (
              <div className="min-h-[calc(100%-101px)] flex items-center justify-center p-5 text-center text-tertiary text-sm leading-[1.8]">
                {t('没有找到匹配内容')}
              </div>
            ) : (
              <div className="grid">
                {globalSearchResults.map((result) => {
                  const historyTimeParts = buildAIHistoryDisplayTimeParts(result.updatedAt || 0, getLanguage() || 'zh-CN')
                  const historyRelativeToneStyle = getAIHistoryRelativeTimeToneStyle(result.updatedAt || 0)
                  return (
                  <button
                    key={`${result.conversationId}:${result.messageId}`}
                    type="button"
                    onClick={() => {
                      void handleSelectGlobalSearchResult(result)
                    }}
                    className="w-full grid gap-2 py-3 px-3.5 border-0 border-b border-line bg-transparent text-left cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-md font-bold text-primary whitespace-nowrap overflow-hidden text-ellipsis">{result.conversationTitle}</div>
                      <div className="shrink-0 text-xs text-tertiary">{result.role === 'user' ? t('用户') : t('AI')}</div>
                    </div>
                    <div className="text-xs text-muted flex items-center gap-0 flex-wrap">
                      <span>{historyTimeParts.absoluteText}</span>
                      {historyTimeParts.relativeText ? (
                        <span style={historyRelativeToneStyle}>({historyTimeParts.relativeText})</span>
                      ) : null}
                    </div>
                    <div className="text-sm text-secondary leading-[1.6] whitespace-pre-wrap break-words">{result.snippet}</div>
                  </button>
                  )
                })}
              </div>
            )
          ) : (
            <div className="min-h-[calc(100%-101px)] flex items-center justify-center p-5 text-center text-tertiary text-sm leading-[1.8]">
              {t('搜索全部对话中的消息')}
            </div>
          )}
        </div>
      )
    } else if (displayConversationList.length === 0) {
      content = (
        <div className="min-h-[calc(100%-53px)] flex items-center justify-center p-5 text-center text-tertiary text-sm leading-[1.8]">
          <div className="max-w-[80%] grid gap-0.5">
            <div>{conversationFilter === 'archived' ? t('当前没有已归档会话') : t('当前分组没有会话')}</div>
          </div>
        </div>
      )
    } else {      content = displayConversationList.map((item) => renderAIConversationListRow({ t, panelState, selectedConversationIds, conversationSelectionMode, toggleConversationSelection, handleOpenConversation, handleMakeConversationPermanent, handleOpenConversationFolder, handleRenameConversationTitle, handleDeleteConversation }, item))
    }

    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-canvas">
        <div className="px-2.5 py-2 border-b border-line-subtle bg-raised sticky top-0 grid gap-2" style={{ zIndex: Z.STACK }}>
          <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-secondary">{conversationSelectionMode ? t('已选择 {count} 项').replace('{count}', String(selectedConversationIds.size)) : t('对话历史')}</div>
          <div className="flex items-center gap-1.5">
          <button type="button" title={conversationSelectionMode ? t('退出多选') : t('多选')} aria-label={conversationSelectionMode ? t('退出多选') : t('多选')} onClick={() => conversationSelectionMode ? clearConversationSelection() : setConversationSelectionMode(true)} className={cn(
            'w-7 h-7 inline-flex items-center justify-center rounded-md border cursor-pointer',
            conversationSelectionMode
              ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)] text-accent'
              : 'border-line-subtle bg-sunken text-tertiary',
          )}><CheckSquare size={14} /></button>
          <button type="button" title={t('新建分组')} aria-label={t('新建分组')} onClick={() => void handleCreateConversationGroup()} className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-line-subtle bg-sunken text-tertiary cursor-pointer"><FolderPlus size={14} /></button>
          <button
            type="button"
            title={t('全局搜索对话')}
            aria-label={t('全局搜索对话')}
            onClick={handleOpenGlobalSearch}
            className={cn(
              'w-7 h-7 inline-flex items-center justify-center rounded-md border cursor-pointer shrink-0 transition-[color,background-color,border-color,opacity] duration-[80ms]',
              globalSearchOpen
                ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)] text-accent'
                : 'border-line-subtle bg-sunken text-tertiary',
            )}
          >
            <Search size={14} />
          </button>
          </div>
          </div>
          <div role="tablist" aria-label={t('分组')} className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] pb-px">
            <button role="tab" aria-selected={conversationFilter === 'all'} type="button" onClick={() => { setConversationFilter('all'); clearConversationSelection(); cancelRenameConversationGroup() }} onDoubleClick={showSystemGroupRenameUnsupported} className={cn(
              'h-[26px] px-[9px] rounded-md border text-xs whitespace-nowrap cursor-pointer shrink-0',
              conversationFilter === 'all'
                ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)] text-accent'
                : 'border-line-subtle bg-transparent text-secondary',
            )}>{t('全部')}</button>
            {conversationOrganizer.groups.map((group) => {
              const selected = conversationFilter === group.id
              const editing = editingConversationGroupId === group.id
              const dragging = draggingConversationGroupId === group.id
              const dragOver = dragOverConversationGroupId === group.id && !dragging
              return editing ? (
                <input
                  key={group.id}
                  ref={conversationGroupRenameInputRef}
                  aria-label={t('重命名分组')}
                  value={editingConversationGroupName}
                  onChange={(event) => setEditingConversationGroupName(event.target.value)}
                  onBlur={commitRenameConversationGroup}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitRenameConversationGroup() }
                    if (event.key === 'Escape') { event.preventDefault(); cancelRenameConversationGroup() }
                  }}
                  className="h-[26px] px-2 rounded-md border border-accent-border bg-sunken text-primary text-xs outline-2 outline-[rgba(var(--accent-rgb),0.16)] shrink-0"
                  style={{ width: Math.max(72, Math.min(150, editingConversationGroupName.length * 12 + 24)) }}
                />
              ) : (
                <button
                  key={group.id}
                  role="tab"
                  aria-selected={selected}
                  draggable
                  type="button"
                  onClick={() => { setConversationFilter(group.id); clearConversationSelection() }}
                  onDoubleClick={() => beginRenameConversationGroup(group.id)}
                  onContextMenu={(event) => { event.preventDefault(); void handleDeleteConversationGroup(group.id) }}
                  onDragStart={(event) => { setDraggingConversationGroupId(group.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.id) }}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverConversationGroupId(group.id) }}
                  onDrop={(event) => { event.preventDefault(); reorderConversationGroup(draggingConversationGroupId || event.dataTransfer.getData('text/plain'), group.id); setDraggingConversationGroupId(''); setDragOverConversationGroupId('') }}
                  onDragEnd={() => { setDraggingConversationGroupId(''); setDragOverConversationGroupId('') }}
                  className={cn(
                    'h-[26px] px-[9px] rounded-md border text-xs whitespace-nowrap shrink-0 transition-[color,background-color,border-color,opacity] duration-[80ms]',
                    dragOver
                      ? 'border-accent'
                      : (selected
                        ? 'border-accent-border'
                        : 'border-line-subtle'),
                    selected ? 'bg-[rgba(var(--accent-rgb),0.10)] text-accent' : 'bg-transparent text-secondary',
                  )}
                  style={{
                    cursor: dragging ? 'grabbing' : 'grab',
                    opacity: dragging ? 0.5 : 1,
                    transform: dragOver ? 'translateX(2px)' : 'none',
                  }}>
                  {group.name}
                </button>
              )
            })}
            <button role="tab" aria-selected={conversationFilter === 'archived'} type="button" onClick={() => { setConversationFilter('archived'); clearConversationSelection(); cancelRenameConversationGroup() }} onDoubleClick={showSystemGroupRenameUnsupported} className={cn(
              'h-[26px] px-[9px] rounded-md border text-xs whitespace-nowrap cursor-pointer shrink-0',
              conversationFilter === 'archived'
                ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)] text-accent'
                : 'border-line-subtle bg-transparent text-secondary',
            )}>{t('已归档')}</button>
          </div>
        </div>
        {content}
        {conversationSelectionMode && selectedConversationIds.size > 0 ? (
          <div className="sticky bottom-0 grid gap-1.5 p-2 border-t border-line bg-raised" style={{ zIndex: Z.STACK + 1 }}>
            {moveToGroupOpen ? (
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                <Button variant="ghost" size="sm" onClick={() => handleMoveSelectedConversations('')} className="shrink-0">{t('移出分组')}</Button>
                {conversationOrganizer.groups.map((group) => <Button key={group.id} variant="ghost" size="sm" onClick={() => handleMoveSelectedConversations(group.id)} className="shrink-0">{group.name}</Button>)}
              </div>
            ) : null}
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setMoveToGroupOpen((current) => !current)} className="flex-1">{t('移动到分组')}</Button>
              <Button variant="ghost" size="sm" onClick={() => void handleSetSelectedArchived(conversationFilter !== 'archived')} className="flex-1 gap-[5px]">{conversationFilter === 'archived' ? <ArchiveRestore size={13} /> : <Archive size={13} />}{conversationFilter === 'archived' ? t('恢复') : t('归档')}</Button>
              <Button variant="danger" size="sm" onClick={() => void handleDeleteSelectedConversations()} aria-label={t('删除')} className="w-[34px] p-0"><Trash2 size={13} /></Button>
            </div>
          </div>
        ) : null}
      </div>
    )}
