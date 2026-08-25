import { Columns2, FileText, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Tiptop from '../Tiptop.tsx'
import { useTranslation, type I18nKey } from '../../i18n.ts'

/** 对话文件变更条目（宽松结构） */
export interface ConversationDiffItem {
  id: string
  messageId: string
  artifactPath: string
  toolName: string
  title: string
  summary: string
  status: string
  copyContent: string
  order: number
  /** 该条目已被还原（按钮持久显示「已还原」并禁用） */
  restored?: boolean
}

function normalizeItems(items: unknown): ConversationDiffItem[] {
  return Array.isArray(items)
    ? (items as Array<Record<string, unknown>>)
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `conversation-diff-item-${index}`,
        messageId: typeof item.messageId === 'string' ? item.messageId.trim() : '',
        artifactPath: typeof item.artifactPath === 'string' ? item.artifactPath.trim() : '',
        toolName: typeof item.toolName === 'string' ? item.toolName.trim() : '',
        title: typeof item.title === 'string' ? item.title.trim() : '',
        summary: typeof item.summary === 'string' ? item.summary.trim() : '',
        status: typeof item.status === 'string' ? item.status.trim() : '',
        copyContent: typeof item.copyContent === 'string' ? item.copyContent : '',
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
        restored: item.restored === true,
      }))
      .filter((item) => item.artifactPath)
    : []
}

function normalizeCompactDiffText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : ''
}

type CompactDiffRow =
  | { type: 'line'; text: string; key: string }
  | { type: 'hidden'; count: number; key: string }

function buildCompactDiffRows(rawDiff: string, maxVisibleLines = 24): CompactDiffRow[] {
  const lines = normalizeCompactDiffText(rawDiff).split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  if (lines.length <= maxVisibleLines) {
    return lines.map((text, index): CompactDiffRow => ({ type: 'line', text, key: `line-${index}` }))
  }
  const headCount = Math.min(16, Math.max(10, maxVisibleLines - 6))
  const tailCount = Math.max(5, maxVisibleLines - headCount)
  const hiddenCount = Math.max(lines.length - headCount - tailCount, 0)
  const rows: CompactDiffRow[] = [
    ...lines.slice(0, headCount).map((text, index): CompactDiffRow => ({ type: 'line', text, key: `head-${index}` })),
    ...(hiddenCount > 0 ? [{ type: 'hidden', count: hiddenCount, key: 'hidden' } as CompactDiffRow] : []),
    ...lines.slice(lines.length - tailCount).map((text, index): CompactDiffRow => ({ type: 'line', text, key: `tail-${index}` })),
  ]
  return rows
}

function resolveCompactDiffRowPalette(text: string) {
  if (typeof text !== 'string') {
    return { color: 'var(--text-secondary)', background: 'transparent' }
  }
  if (text.startsWith('@@')) {
    return { color: 'var(--accent)', background: 'rgba(var(--accent-rgb), 0.08)' }
  }
  if (text.startsWith('+') && !text.startsWith('+++')) {
    return { color: 'var(--success)', background: 'rgba(var(--success-rgb), 0.10)' }
  }
  if (text.startsWith('-') && !text.startsWith('---')) {
    return { color: 'var(--danger)', background: 'rgba(var(--danger-rgb), 0.10)' }
  }
  if (text.startsWith('diff --git') || text.startsWith('index ') || text.startsWith('---') || text.startsWith('+++')) {
    return { color: 'var(--text-secondary)', background: 'rgba(var(--accent-rgb), 0.05)' }
  }
  return { color: 'var(--text-primary)', background: 'transparent' }
}

interface CompactDiffPreviewProps {
  rawDiff?: string
  loading?: boolean
  t: (key: I18nKey, vars?: Record<string, unknown>) => string
  maxHeight?: number
}

function CompactDiffPreview({ rawDiff = '', loading = false, t, maxHeight = 340 }: CompactDiffPreviewProps) {
  const normalizedRawDiff = typeof rawDiff === 'string' ? rawDiff.trim() : ''
  const rows = useMemo(() => buildCompactDiffRows(normalizedRawDiff), [normalizedRawDiff])
  if (loading) {
    return (
      <div className="border border-line-subtle rounded-lg bg-canvas text-secondary text-sm flex items-center justify-center gap-2" style={{ minHeight: maxHeight, padding: 12 }}>
        <LoaderCircle size={14} className="spin" />
        <span>{t('加载中...')}</span>
      </div>
    )
  }
  if (!normalizedRawDiff) {
    return (
      <div className="border border-line-subtle rounded-lg bg-canvas text-secondary text-sm flex items-center justify-center text-center" style={{ minHeight: maxHeight, padding: 12 }}>
        {t('暂无可预览差异')}
      </div>
    )
  }
  return (
    <div className="border border-line-subtle rounded-lg bg-canvas overflow-hidden" style={{ minHeight: maxHeight }}>
      <div className="overflow-auto font-mono text-xs leading-[18px]" style={{ maxHeight }}>
        {rows.map((row, index) => {
          if (row.type === 'hidden') {
            return (
              <div
                key={row.key}
                className="py-1.5 px-3 border-y border-line-subtle text-tertiary bg-[rgba(var(--accent-rgb),0.04)] text-center tabular-nums">
                {`··· ${row.count} ···`}
              </div>
            )
          }
          const palette = resolveCompactDiffRowPalette(row.text)
          return (
            <div
              key={row.key}
              className={`grid grid-cols-[40px_minmax(0,1fr)] min-w-0 ${index === 0 ? '' : 'border-t [border-top-color:rgba(255,255,255,0.02)]'}`}
              style={{ background: palette.background }}>
              <div className="pl-2.5 pr-2 text-tertiary text-right border-r border-line-subtle select-none tabular-nums">
                {index + 1}
              </div>
              <div
                className="px-2.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0"
                style={{ color: palette.color }}>
                {row.text || ' '}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export interface AIConversationDiffOverlayProps {
  sessionLabel?: string
  items?: unknown
  reviewByArtifactPath?: Record<string, unknown>
  loadingByArtifactPath?: Record<string, unknown>
  selectedMessageId?: string
  onSelectItem?: (item: ConversationDiffItem) => void
  onPreviewRestore?: (artifactPath: string) => boolean | Promise<boolean | null | undefined>
  onApplyRestore?: (artifactPath: string) => boolean | Promise<boolean | null | undefined>
  onClose: () => void
}

export default function AIConversationDiffOverlay({
  sessionLabel = '',
  items = [],
  reviewByArtifactPath = {},
  loadingByArtifactPath = {},
  selectedMessageId = '',
  onSelectItem,
  onPreviewRestore,
  onApplyRestore,
  onClose,
}: AIConversationDiffOverlayProps) {
  const { t } = useTranslation()
  const [copiedItemId, setCopiedItemId] = useState('')
  // 仅用于左键「重新应用」成功后的短暂「已应用」反馈（可重复触发，故保留 1.2s 重置）；
  // 还原态则由全局 item.restored 持久驱动，不再用本地临时态
  const [appliedItemId, setAppliedItemId] = useState('')
  const normalizedItems = useMemo(() => normalizeItems(items), [items])
  const activeItem = useMemo(() => (
    normalizedItems.find((item) => item.messageId === selectedMessageId)
    || normalizedItems[0]
    || null
  ), [normalizedItems, selectedMessageId])

  useEffect(() => {
    if (!copiedItemId) {
      return undefined
    }
    const timer = window.setTimeout(() => setCopiedItemId(''), 1200)
    return () => window.clearTimeout(timer)
  }, [copiedItemId])

  useEffect(() => {
    if (!appliedItemId) {
      return undefined
    }
    const timer = window.setTimeout(() => setAppliedItemId(''), 1200)
    return () => window.clearTimeout(timer)
  }, [appliedItemId])

  const handleCopyItemContent = async (item: ConversationDiffItem) => {
    const itemId = typeof item?.id === 'string' ? item.id : ''
    const review = item?.artifactPath && reviewByArtifactPath && typeof reviewByArtifactPath === 'object'
      ? (reviewByArtifactPath[item.artifactPath] as Record<string, unknown> | null | undefined) || null
      : null
    const copyContent = typeof item?.copyContent === 'string' && item.copyContent.trim()
      ? item.copyContent.trim()
      : (typeof review?.rawDiff === 'string' && review.rawDiff.trim()
        ? review.rawDiff.trim()
        : '')
    if (!itemId || !copyContent) {
      return
    }
    try {
      await navigator.clipboard.writeText(copyContent)
      setCopiedItemId(itemId)
    } catch {}
  }

  const handlePreviewItemRestore = async (item: ConversationDiffItem) => {
    const artifactPath = typeof item?.artifactPath === 'string' ? item.artifactPath.trim() : ''
    const itemId = typeof item?.id === 'string' ? item.id : ''
    if (!artifactPath || item?.restored) {
      return
    }
    const applied = await onPreviewRestore?.(artifactPath)
    if (applied === true && itemId) {
      setAppliedItemId(itemId)
    }
  }

  const handleApplyItemRestore = async (event: React.MouseEvent, item: ConversationDiffItem) => {
    const artifactPath = typeof item?.artifactPath === 'string' ? item.artifactPath.trim() : ''
    if (!artifactPath || item?.restored) {
      return
    }
    event.preventDefault()
    // 还原成功后由 useAIReview 标记 item.restored=true（全局单一数据源），按钮持久显示「已还原」并禁用
    await onApplyRestore?.(artifactPath)
  }

  return (
    <div className="absolute inset-0 z-40 flex items-stretch justify-center p-1.5 bg-black/[0.18] backdrop-blur-[4px]">
      <div className="w-full h-full grid grid-rows-[64px_minmax(0,1fr)] rounded-[16px] border border-line bg-overlay shadow-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-[18px] border-b border-line bg-raised">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-[34px] h-[34px] inline-flex items-center justify-center rounded-lg bg-[rgba(var(--accent-rgb),0.14)] text-accent shrink-0">
              <Columns2 size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[16px] font-extrabold text-primary">{t('当前对话文件变更')}</div>
              <div className="text-sm text-tertiary whitespace-nowrap overflow-hidden text-ellipsis">
                {sessionLabel ? t('会话 · {label}', { label: sessionLabel }) : t('当前对话文件变更')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('关闭')}
            className="w-[34px] h-[34px] inline-flex items-center justify-center rounded-lg border border-line bg-transparent text-secondary cursor-pointer transition-colors duration-100">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-auto p-3.5 grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-3.5 content-start">
          {normalizedItems.map((item) => {
            const isActive = activeItem?.id === item.id
            const isCopied = copiedItemId === item.id
            const isRestored = item.restored === true
            const isApplied = appliedItemId === item.id
            const itemTitle = item.title || item.toolName || item.id
            const itemSummary = item.summary && item.summary !== itemTitle ? item.summary : ''
            const review = item.artifactPath && reviewByArtifactPath && typeof reviewByArtifactPath === 'object'
              ? (reviewByArtifactPath[item.artifactPath] as Record<string, unknown> | null | undefined) || null
              : null
            const currentRawDiff = typeof review?.rawDiff === 'string' ? review.rawDiff : ''
            const currentLoading = item.artifactPath && loadingByArtifactPath && typeof loadingByArtifactPath === 'object'
              ? loadingByArtifactPath[item.artifactPath] === true
              : false
            const itemCopyCharacterCount = typeof item.copyContent === 'string' && item.copyContent.trim()
              ? item.copyContent.trim().length
              : (currentRawDiff.trim()
                ? currentRawDiff.trim().length
                : 0)
            return (
              <div
                key={item.id}
                className={`w-full min-h-[520px] p-3.5 rounded-[14px] text-inherit grid grid-rows-[auto_auto_1fr] gap-3 min-w-0 ${
                  isActive
                    ? 'border border-accent-border bg-[rgba(var(--accent-rgb),0.10)]'
                    : 'border border-line bg-canvas'
                }`}>
                <button
                  type="button"
                  onClick={() => onSelectItem?.(item)}
                  className="w-full border-none bg-transparent text-inherit text-left cursor-pointer grid gap-2 p-0 min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-[rgba(var(--accent-rgb),0.18)] text-accent'
                          : 'bg-[rgba(255,255,255,0.06)] text-secondary'
                      }`}>
                      <FileText size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-primary whitespace-normal overflow-visible [text-overflow:clip] break-all [overflow-wrap:anywhere] leading-[1.45]">
                        {item.order}. {itemTitle}
                      </div>
                    </div>
                  </div>
                  {itemSummary ? (
                    <div className="text-sm text-secondary leading-[1.55]">
                      {itemSummary}
                    </div>
                  ) : null}
                </button>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="py-1 px-2 rounded-full border border-[rgba(var(--accent-rgb),0.20)] bg-[rgba(var(--accent-rgb),0.06)] text-tertiary text-xs font-bold">
                    {/* status 为 AI 返回动态文案（可能不在翻译表），t() 内部有兜底 */}
                    {item.toolName || (item.status ? t(item.status as I18nKey) : t('已完成'))}
                  </div>
                  <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                    {itemCopyCharacterCount > 0 ? (
                      <Tiptop text={isCopied ? t('已复制') : t('复制完整 diff/内容')} style={{ display: 'inline-flex' }}>
                        <button
                          type="button"
                          onClick={() => handleCopyItemContent(item)}
                          className={`h-6 inline-flex items-center gap-[5px] px-2 rounded-full text-xs font-bold cursor-pointer ${
                            isCopied
                              ? 'border border-[rgba(var(--success-rgb),0.28)] bg-[rgba(var(--success-rgb),0.10)] text-success'
                              : 'border border-[rgba(var(--accent-rgb),0.24)] bg-[rgba(var(--accent-rgb),0.08)] text-secondary'
                          }`}>
                          <FileText size={11} color={isCopied ? 'currentColor' : 'var(--accent)'} />
                          <span>{isCopied ? t('已复制') : String(itemCopyCharacterCount)}</span>
                        </button>
                      </Tiptop>
                    ) : null}
                    {item.artifactPath ? (
                      <Tiptop text={isRestored ? t('已还原') : (isApplied ? t('已应用') : t('左键应用/右键还原'))} style={{ display: 'inline-flex' }}>
                        <button
                          type="button"
                          onClick={isRestored ? undefined : () => {
                            void handlePreviewItemRestore(item)
                          }}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                          }}
                          onContextMenu={isRestored ? undefined : (event) => {
                            void handleApplyItemRestore(event, item)
                          }}
                          className={`h-6 inline-flex items-center gap-[5px] px-2 rounded-full text-xs font-bold ${
                            isRestored || isApplied
                              ? 'border border-[rgba(var(--success-rgb),0.28)] bg-[rgba(var(--success-rgb),0.10)] text-success'
                              : 'border border-[rgba(var(--accent-rgb),0.24)] bg-[rgba(var(--accent-rgb),0.08)] text-secondary'
                          } ${isRestored ? 'cursor-default' : 'cursor-pointer'}`}>
                          <RotateCcw size={11} color={isRestored || isApplied ? 'currentColor' : 'var(--accent)'} />
                          <span>{isRestored ? t('已还原') : (isApplied ? t('已应用') : t('应用'))}</span>
                        </button>
                      </Tiptop>
                    ) : null}
                  </div>
                </div>
                <CompactDiffPreview rawDiff={currentRawDiff} loading={currentLoading} t={t} maxHeight={360} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}