import { useTranslation } from '../../i18n.js'
import { DiffEditorPair } from './AIDiffViewerPair.jsx'

export default function AIChangeReviewWorkbench({ review, queueLength = 1, previewOnly = false, onClose = null }) {
  const { t } = useTranslation()

  if (!review) {
    return null
  }

  const blocks = Array.isArray(review.blocks) ? review.blocks : []
  const path = typeof review.path === 'string' ? review.path : ''
  const pathParams = review?.pathParams && typeof review.pathParams === 'object' ? review.pathParams : undefined
  const toolName = typeof review.toolName === 'string' ? review.toolName : ''
  const showBlockBadge = blocks.length > 1

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
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 16,
          border: '1px solid var(--border)',
          background: 'var(--surface-overlay)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}>
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 12,
            right: 12,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            pointerEvents: 'none',
          }}>
          {toolName ? (
            <div style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}>
              {toolName}
            </div>
          ) : null}
          {path ? (
            <div style={{ maxWidth: '100%', padding: '3px 8px', borderRadius: 999, background: 'var(--surface-base)', color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t(path, pathParams)}
            </div>
          ) : null}
          {!previewOnly && queueLength > 1 ? (
            <div style={{ padding: '3px 8px', borderRadius: 999, background: 'rgba(var(--warning-rgb), 0.10)', color: 'var(--warning)', fontSize: 11, fontWeight: 700 }}>
              {`${t('队列')} ${queueLength}`}
            </div>
          ) : null}
        </div>
        {previewOnly && typeof onClose === 'function' ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('关闭')}
            style={{
              position: 'absolute',
              top: 10,
              right: 12,
              zIndex: 3,
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface-base)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}>
            ×
          </button>
        ) : null}
        <div
          style={{
            height: '100%',
            padding: '42px 8px 10px',
            overflow: 'auto',
            display: 'grid',
            gap: 8,
            gridTemplateRows: blocks.length <= 1 ? '1fr' : `repeat(${blocks.length}, minmax(260px, 1fr))`,
          }}>
          {blocks.map((block, index) => (
            <DiffEditorPair
              key={`review-block-${review.reviewId}-${index}`}
              block={block}
              index={index}
              showBlockBadge={showBlockBadge}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  )
}