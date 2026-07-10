import { Columns2, FileText, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Tiptop from '../Tiptop.jsx'
import { useTranslation } from '../../i18n.js'
import { DiffEditorPair } from './AIDiffViewerPair.jsx'

function normalizeItems(items) {
  return Array.isArray(items)
    ? items
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
      }))
      .filter((item) => item.artifactPath)
    : []
}

function normalizeBlocks(review, t) {
  return Array.isArray(review?.blocks)
    ? review.blocks
      .filter((block) => block && typeof block === 'object')
      .map((block, index) => ({
        index,
        label: typeof block.label === 'string' && block.label.trim() ? block.label.trim() : t('文件 #{count}', { count: index + 1 }),
        before: typeof block.before === 'string' ? block.before : '',
        after: typeof block.after === 'string' ? block.after : '',
        startLine: Number.isFinite(Number(block.startLine)) ? Number(block.startLine) : undefined,
        matchedStartLine: Number.isFinite(Number(block.matchedStartLine)) ? Number(block.matchedStartLine) : undefined,
      }))
    : []
}

export default function AIConversationDiffOverlay({
  sessionLabel = '',
  items = [],
  review = null,
  loading = false,
  selectedMessageId = '',
  onSelectItem,
  onPreviewRestore,
  onApplyRestore,
  onClose,
}) {
  const { t } = useTranslation()
  const [copiedItemId, setCopiedItemId] = useState('')
  const [actionSucceeded, setActionSucceeded] = useState({ itemId: '', kind: '' })
  const normalizedItems = useMemo(() => normalizeItems(items), [items])
  const blocks = useMemo(() => normalizeBlocks(review, t), [review, t])
  const activeItem = useMemo(() => (
    normalizedItems.find((item) => item.messageId === selectedMessageId)
    || normalizedItems[0]
    || null
  ), [normalizedItems, selectedMessageId])
  const showBlockBadge = blocks.length > 1

  useEffect(() => {
    if (!copiedItemId) {
      return undefined
    }
    const timer = window.setTimeout(() => setCopiedItemId(''), 1200)
    return () => window.clearTimeout(timer)
  }, [copiedItemId])

  useEffect(() => {
    if (!actionSucceeded.itemId) {
      return undefined
    }
    const timer = window.setTimeout(() => setActionSucceeded({ itemId: '', kind: '' }), 1200)
    return () => window.clearTimeout(timer)
  }, [actionSucceeded])

  const handleCopyItemContent = async (item) => {
    const itemId = typeof item?.id === 'string' ? item.id : ''
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

  const handlePreviewItemRestore = async (item) => {
    const artifactPath = typeof item?.artifactPath === 'string' ? item.artifactPath.trim() : ''
    const itemId = typeof item?.id === 'string' ? item.id : ''
    if (!artifactPath) {
      return
    }
    const applied = await onPreviewRestore?.(artifactPath)
    if (applied === true && itemId) {
      setActionSucceeded({ itemId, kind: 'apply' })
    }
  }

  const handleApplyItemRestore = async (event, item) => {
    const artifactPath = typeof item?.artifactPath === 'string' ? item.artifactPath.trim() : ''
    const itemId = typeof item?.id === 'string' ? item.id : ''
    if (!artifactPath) {
      return
    }
    event.preventDefault()
    const applied = await onApplyRestore?.(artifactPath)
    if (applied === true && itemId) {
      setActionSucceeded({ itemId, kind: 'restore' })
    }
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
            display: 'grid',
            gridTemplateColumns: '320px minmax(0, 1fr)',
            gap: 0,
          }}>
          <div
            style={{
              minHeight: 0,
              overflow: 'auto',
              borderRight: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.02)',
              padding: 14,
              display: 'grid',
              gap: 10,
              alignContent: 'start',
            }}>
            {normalizedItems.map((item) => {
              const isActive = activeItem?.id === item.id
              const isCopied = copiedItemId === item.id
              const isActionSucceeded = actionSucceeded.itemId === item.id
              const itemActionKind = isActionSucceeded ? actionSucceeded.kind : ''
              const itemTitle = item.title || item.toolName || item.id
              const itemSummary = item.summary && item.summary !== itemTitle ? item.summary : ''
              const itemCopyCharacterCount = typeof item.copyContent === 'string' && item.copyContent.trim()
                ? item.copyContent.trim().length
                : typeof review?.rawDiff === 'string' && review.rawDiff.trim()
                  ? review.rawDiff.trim().length
                  : 0
              return (
                <div
                  key={item.id}
                  style={{
                    width: '100%',
                    padding: 14,
                    borderRadius: 14,
                    border: isActive ? '1px solid var(--accent-border)' : '1px solid var(--border)',
                    background: isActive ? 'rgba(var(--accent-rgb), 0.10)' : 'var(--surface-base)',
                    color: 'inherit',
                    display: 'grid',
                    gap: 10,
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
                      {item.toolName || (item.status ? t(item.status) : t('已完成'))}
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
                        <Tiptop text={isActionSucceeded ? (itemActionKind === 'restore' ? t('已还原') : t('已应用')) : t('左键应用/右键还原')} style={{ display: 'inline-flex' }}>
                          <button
                            type="button"
                            onClick={() => {
                              void handlePreviewItemRestore(item)
                            }}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                            onContextMenu={(event) => {
                              void handleApplyItemRestore(event, item)
                            }}
                            style={{
                              height: 24,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '0 8px',
                              borderRadius: 999,
                              border: isActionSucceeded ? '1px solid rgba(var(--success-rgb), 0.28)' : '1px solid rgba(var(--accent-rgb), 0.24)',
                              background: isActionSucceeded ? 'rgba(var(--success-rgb), 0.10)' : 'rgba(var(--accent-rgb), 0.08)',
                              color: isActionSucceeded ? 'var(--success)' : 'var(--text-secondary)',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}>
                            <RotateCcw size={11} color={isActionSucceeded ? 'currentColor' : 'var(--accent)'} />
                            <span>{isActionSucceeded ? (itemActionKind === 'restore' ? t('已还原') : t('已应用')) : t('应用')}</span>
                          </button>
                        </Tiptop>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div
            style={{
              minHeight: 0,
              overflow: 'auto',
              padding: 16,
              display: 'grid',
              gridTemplateRows: 'minmax(0, 1fr)',
              gap: 0,
            }}>
            {loading ? (
              <div
                style={{
                  minHeight: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 14,
                  border: '1px dashed var(--border)',
                  background: 'rgba(255,255,255,0.02)',
                  color: 'var(--text-secondary)',
                  gap: 10,
                  fontSize: 13,
                }}>
                <LoaderCircle size={16} className="spin" />
                <span>{t('加载中...')}</span>
              </div>
            ) : blocks.length > 0 ? (
              <div
                style={{
                  minHeight: 0,
                  display: 'grid',
                  gap: 14,
                  alignContent: 'start',
                  gridTemplateRows: blocks.length <= 1 ? '1fr' : `repeat(${blocks.length}, minmax(260px, 1fr))`,
                }}>
                {blocks.map((block, index) => (
                  <DiffEditorPair
                    key={`conversation-diff-block-${index}`}
                    block={block}
                    index={index}
                    showBlockBadge={showBlockBadge}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  minHeight: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 14,
                  border: '1px dashed var(--border)',
                  background: 'rgba(255,255,255,0.02)',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  padding: 20,
                  textAlign: 'center',
                }}>
                {t('暂无可预览差异')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}