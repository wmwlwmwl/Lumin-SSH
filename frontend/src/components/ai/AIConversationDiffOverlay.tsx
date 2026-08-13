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
      <div style={{ minHeight: maxHeight, padding: '12px', border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <LoaderCircle size={14} className="spin" />
        <span>{t('加载中...')}</span>
      </div>
    )
  }
  if (!normalizedRawDiff) {
    return (
      <div style={{ minHeight: maxHeight, padding: '12px', border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        {t('暂无可预览差异')}
      </div>
    )
  }
  return (
    <div style={{ minHeight: maxHeight, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-base)', overflow: 'hidden' }}>
      <div style={{ maxHeight, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '18px' }}>
        {rows.map((row, index) => {
          if (row.type === 'hidden') {
            return (
              <div
                key={row.key}
                style={{
                  padding: '6px 12px',
                  borderTop: '1px solid var(--border-subtle)',
                  borderBottom: '1px solid var(--border-subtle)',
                  color: 'var(--text-tertiary)',
                  background: 'rgba(var(--accent-rgb), 0.04)',
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {`··· ${row.count} ···`}
              </div>
            )
          }
          const palette = resolveCompactDiffRowPalette(row.text)
          return (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px minmax(0, 1fr)',
                minWidth: 0,
                background: palette.background,
                borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.02)',
              }}>
              <div
                style={{
                  padding: '0 8px 0 10px',
                  color: 'var(--text-tertiary)',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border-subtle)',
                  userSelect: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {index + 1}
              </div>
              <div
                style={{
                  padding: '0 10px',
                  color: palette.color,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                  minWidth: 0,
                }}>
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
      : typeof review?.rawDiff === 'string' && review.rawDiff.trim()
        ? review.rawDiff.trim()
        : ''
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
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: 6,
        background: 'rgba(0, 0, 0, 0.18)',
        backdropFilter: 'blur(4px)',
      }}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateRows: '64px minmax(0, 1fr)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          background: 'var(--surface-overlay)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '0 18px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-raised)',
          }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 34,
                height: 34,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                background: 'rgba(var(--accent-rgb), 0.14)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}>
              <Columns2 size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{t('当前对话文件变更')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sessionLabel ? t('会话 · {label}', { label: sessionLabel }) : t('当前对话文件变更')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('关闭')}
            style={{
              width: 34,
              height: 34,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'var(--transition)',
            }}>
            <X size={16} />
          </button>
        </div>
        <div
          style={{
            minHeight: 0,
            overflow: 'auto',
            padding: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
            gap: 14,
            alignContent: 'start',
          }}>
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
              : currentRawDiff.trim()
                ? currentRawDiff.trim().length
                : 0
            return (
              <div
                key={item.id}
                style={{
                  width: '100%',
                  minHeight: 520,
                  padding: 14,
                  borderRadius: 14,
                  border: isActive ? '1px solid var(--accent-border)' : '1px solid var(--border)',
                  background: isActive ? 'rgba(var(--accent-rgb), 0.10)' : 'var(--surface-base)',
                  color: 'inherit',
                  display: 'grid',
                  gridTemplateRows: 'auto auto 1fr',
                  gap: 12,
                  minWidth: 0,
                }}>
                <button
                  type="button"
                  onClick={() => onSelectItem?.(item)}
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: 8,
                    padding: 0,
                    minWidth: 0,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isActive ? 'rgba(var(--accent-rgb), 0.18)' : 'rgba(255,255,255,0.06)',
                        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                        flexShrink: 0,
                      }}>
                      <FileText size={15} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', wordBreak: 'break-all', overflowWrap: 'anywhere', lineHeight: 1.45 }}>
                        {item.order}. {itemTitle}
                      </div>
                    </div>
                  </div>
                  {itemSummary ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                      {itemSummary}
                    </div>
                  ) : null}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: '1px solid rgba(var(--accent-rgb), 0.20)',
                      background: 'rgba(var(--accent-rgb), 0.06)',
                      color: 'var(--text-tertiary)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}>
                    {/* status 为 AI 返回动态文案（可能不在翻译表），t() 内部有兜底 */}
                    {item.toolName || (item.status ? t(item.status as I18nKey) : t('已完成'))}
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {itemCopyCharacterCount > 0 ? (
                      <Tiptop text={isCopied ? t('已复制') : t('复制完整 diff/内容')} style={{ display: 'inline-flex' }}>
                        <button
                          type="button"
                          onClick={() => handleCopyItemContent(item)}
                          style={{
                            height: 24,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '0 8px',
                            borderRadius: 999,
                            border: isCopied ? '1px solid rgba(var(--success-rgb), 0.28)' : '1px solid rgba(var(--accent-rgb), 0.24)',
                            background: isCopied ? 'rgba(var(--success-rgb), 0.10)' : 'rgba(var(--accent-rgb), 0.08)',
                            color: isCopied ? 'var(--success)' : 'var(--text-secondary)',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}>
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
                          style={{
                            height: 24,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '0 8px',
                            borderRadius: 999,
                            border: isRestored || isApplied ? '1px solid rgba(var(--success-rgb), 0.28)' : '1px solid rgba(var(--accent-rgb), 0.24)',
                            background: isRestored || isApplied ? 'rgba(var(--success-rgb), 0.10)' : 'rgba(var(--accent-rgb), 0.08)',
                            color: isRestored || isApplied ? 'var(--success)' : 'var(--text-secondary)',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: isRestored ? 'default' : 'pointer',
                          }}>
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