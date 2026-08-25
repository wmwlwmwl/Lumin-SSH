import { Columns2, House, MessagesSquare, Search, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n.ts'
import Tiptop from '../Tiptop.tsx'
import IconActionButton from './IconActionButton.tsx'

function formatAIContextTokens(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '0'
  }
  const rounded = Math.round(parsed)
  if (rounded >= 1e9) {
    return `${(rounded / 1e9).toFixed(2)}b`
  }
  if (rounded >= 1e6) {
    return `${(rounded / 1e6).toFixed(2)}m`
  }
  if (rounded >= 1e3) {
    return `${(rounded / 1e3).toFixed(2)}k`
  }
  return String(rounded)
}

interface AIPanelHeaderProps {
  showSettingsPanel: boolean
  onToggleSettings: () => void
  onGoHome: () => void
  showModeToggle?: boolean
  isDevilMode?: boolean
  onToggleMode?: () => void
  onOpenConversationSearch?: () => void
  onOpenConversationDiff?: () => void
  showConversationSearchButton?: boolean
  showConversationDiffButton?: boolean
  showContextTokens?: boolean
  contextTokens?: number
  apiMessageCount?: number
  isCondensingContext?: boolean
  canCondenseContext?: boolean
  canQuickCondenseContext?: boolean
  canSummaryCondenseContext?: boolean
  conversationSearchActive?: boolean
  onCondenseContext?: () => void
  onCondenseContextFullSummary?: () => void
  fullSummaryCondenseAvailable?: boolean
}

export default function AIPanelHeader({
  showSettingsPanel,
  onToggleSettings,
  onGoHome,
  showModeToggle = false,
  isDevilMode = false,
  onToggleMode,
  onOpenConversationSearch,
  onOpenConversationDiff,
  showConversationSearchButton = false,
  showConversationDiffButton = false,
  showContextTokens = false,
  contextTokens = 0,
  apiMessageCount = 0,
  isCondensingContext = false,
  canCondenseContext = false,
  canQuickCondenseContext = false,
  canSummaryCondenseContext = false,
  conversationSearchActive = false,
  onCondenseContext,
  onCondenseContextFullSummary,
  fullSummaryCondenseAvailable: _fullSummaryCondenseAvailable = false,
}: AIPanelHeaderProps) {
  const { t } = useTranslation()
  const [condenseActionsVisible, setCondenseActionsVisible] = useState(false)
  const condenseCloseTimerRef = useRef(0)
  const contextTokenLabel = useMemo(() => formatAIContextTokens(contextTokens), [contextTokens])
  const normalizedApiMessageCount = Number.isFinite(Number(apiMessageCount)) && Number(apiMessageCount) > 0 ? Math.trunc(Number(apiMessageCount)) : 0
  const modeToggleLabel = isDevilMode
    ? t('切换到天使模式:善良的天使会全心全意地保护你和你的设备,它有绝对的原则和信念来帮助你,同时也会感化你的不良行为')
    : t('切换到恶魔模式:可恶的恶魔会不择手段地满足你所有的危险想法,它会诱导你突破边界,并纵容你一步步滑向失控')
  const condenseButtonTooltip = isCondensingContext ? t('正在智能压缩上下文') : t('当前对话上下文 Token,点击压缩')
  const canOpenCondenseActions = Boolean(canCondenseContext || canQuickCondenseContext || canSummaryCondenseContext)
  const clearCondenseCloseTimer = () => {
    if (condenseCloseTimerRef.current) {
      window.clearTimeout(condenseCloseTimerRef.current)
      condenseCloseTimerRef.current = 0
    }
  }
  const showCondenseActions = () => {
    if (!canOpenCondenseActions) {
      return
    }
    clearCondenseCloseTimer()
    setCondenseActionsVisible(true)
  }
  const hideCondenseActionsWithDelay = () => {
    clearCondenseCloseTimer()
    condenseCloseTimerRef.current = window.setTimeout(() => {
      setCondenseActionsVisible(false)
      condenseCloseTimerRef.current = 0
    }, 180)
  }
  useEffect(() => () => {
    clearCondenseCloseTimer()
  }, [])
  const handleTriggerQuickCondense = () => {
    if (!canQuickCondenseContext) {
      return
    }
    setCondenseActionsVisible(false)
    onCondenseContext?.()
  }
  const handleTriggerFullSummaryCondense = () => {
    if (!canSummaryCondenseContext) {
      return
    }
    setCondenseActionsVisible(false)
    onCondenseContextFullSummary?.()
  }
  const handleCondenseButtonClick = () => {
    if (canQuickCondenseContext) {
      handleTriggerQuickCondense()
      return
    }
    if (canSummaryCondenseContext) {
      clearCondenseCloseTimer()
      setCondenseActionsVisible((current) => !current)
    }
  }

  return (
    <div
      className="h-[54px] px-3.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 border-b border-line bg-raised shrink-0"
      style={isDevilMode ? { backgroundImage: 'linear-gradient(180deg, rgba(255, 0, 38, 0.08) 0%, transparent 100%)', boxShadow: 'inset 0 -1px 0 rgba(255, 64, 64, 0.12), inset 0 0 28px rgba(255, 0, 38, 0.08)' } : undefined}>
      <div className="flex items-center gap-1 min-w-0">
        <div className="text-md font-bold text-primary tracking-[0.2px]">{t('AI')}</div>
        {showModeToggle ? (
          <Tiptop
            text={modeToggleLabel}
            placement="top"
          >
            <button
              type="button"
              aria-label={modeToggleLabel}
              onClick={onToggleMode}
              className="p-0 m-0 inline-flex items-center justify-center bg-transparent border-none text-secondary cursor-pointer leading-none"
            >
              <span className="text-lg leading-none">{isDevilMode ? '😈' : '😇'}</span>
            </button>
          </Tiptop>
        ) : null}
      </div>
      {showContextTokens ? (
        <div className="justify-self-center inline-flex items-center gap-1.5 min-w-0 max-w-full">
          <div
            className="relative inline-flex items-center"
            onMouseEnter={showCondenseActions}
            onMouseLeave={hideCondenseActionsWithDelay}
            onFocus={showCondenseActions}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                hideCondenseActionsWithDelay()
              }
            }}
          >
            <Tiptop text={condenseButtonTooltip} placement="top">
              <button
                type="button"
                aria-label={condenseButtonTooltip}
                disabled={!canOpenCondenseActions}
                onClick={handleCondenseButtonClick}
                className={`inline-flex items-center justify-center w-fit min-w-0 max-w-full h-7 px-2.5 rounded-full border text-sm font-bold transition-colors duration-100 whitespace-nowrap leading-none tabular-nums ${
                  isCondensingContext
                    ? 'border-accent-border bg-accent-dim text-accent'
                    : 'border-line bg-transparent text-secondary'
                } ${canOpenCondenseActions || isCondensingContext ? '' : 'opacity-60'}`}
              >
                {contextTokenLabel}
              </button>
            </Tiptop>
            {condenseActionsVisible && canOpenCondenseActions ? (
              <div
                className="absolute top-[calc(100%+2px)] left-1/2 -translate-x-1/2 grid gap-1.5 min-w-[156px] p-2 rounded-xl border border-line bg-raised shadow-[0_12px_28px_rgba(0,0,0,0.18)] z-20"
                onMouseEnter={showCondenseActions}
                onMouseLeave={hideCondenseActionsWithDelay}
              >
                <button
                  type="button"
                  onClick={handleTriggerQuickCondense}
                  disabled={!canQuickCondenseContext}
                  className={`h-[30px] px-2.5 rounded-full border border-accent-border bg-accent-dim text-accent text-sm font-bold whitespace-nowrap transition-colors duration-100 ${
                    canQuickCondenseContext ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'
                  }`}
                >
                  {t('快速智能压缩')}
                </button>
                <button
                  type="button"
                  onClick={handleTriggerFullSummaryCondense}
                  disabled={!canSummaryCondenseContext}
                  className={`h-[30px] px-2.5 rounded-full border border-line bg-transparent text-secondary text-sm font-bold whitespace-nowrap transition-colors duration-100 ${
                    canSummaryCondenseContext ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'
                  }`}
                >
                  {t('全量摘要压缩')}
                </button>
              </div>
            ) : null}
          </div>
          <Tiptop text={t('当前对话节点数')} placement="top">
            <span
              aria-label={t('当前对话节点数')}
              className="inline-flex items-center justify-center gap-1 w-fit min-w-0 h-7 px-2.5 rounded-full border border-line bg-transparent text-secondary text-sm font-bold whitespace-nowrap leading-none tabular-nums cursor-default select-none"
            >
              <MessagesSquare size={12} />
              <span>{normalizedApiMessageCount}</span>
            </span>
          </Tiptop>
        </div>
      ) : (
        <div />
      )}
      <div className="justify-self-end flex items-center gap-1.5">
        <IconActionButton title={t('返回主页')} onClick={onGoHome}>
          <House size={16} />
        </IconActionButton>
        {showConversationSearchButton ? (
          <IconActionButton title={t('当前对话搜索')} active={conversationSearchActive} onClick={onOpenConversationSearch}>
            <Search size={16} />
          </IconActionButton>
        ) : null}
        {showConversationDiffButton ? (
          <IconActionButton title={t('当前对话文件变更')} onClick={onOpenConversationDiff}>
            <Columns2 size={16} />
          </IconActionButton>
        ) : null}
        <IconActionButton title={showSettingsPanel ? t('关闭设置面板') : t('打开设置面板')} active={showSettingsPanel} onClick={onToggleSettings}>
          <Settings size={16} />
        </IconActionButton>
      </div>
    </div>
  )
}
