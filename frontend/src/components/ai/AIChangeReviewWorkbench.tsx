import { ArrowDown, ArrowUp } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation, type I18nKey } from '../../i18n.ts'
import { DiffEditorPair, type DiffNavigateTarget } from './AIDiffViewerPair.tsx'

interface AIChangeReviewWorkbenchProps {
  review: {
    reviewId: string;
    path?: string;
    toolName?: string;
    pathParams?: unknown;
    blocks?: unknown[];
  } | null;
  queueLength?: number;
  previewOnly?: boolean;
  onClose?: (() => void) | null;
}

const NAV_BUTTON_CLASS = 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-line bg-canvas text-secondary cursor-pointer'

export default function AIChangeReviewWorkbench({ review, queueLength = 1, previewOnly = false, onClose = null }: AIChangeReviewWorkbenchProps) {
  const { t } = useTranslation()
  const diffNavigationRef = useRef<((target: DiffNavigateTarget) => void) | null>(null)

  if (!review) {
    return null
  }

  const blocks = Array.isArray(review.blocks) ? review.blocks : []
  const path = typeof review.path === 'string' ? review.path : ''
  const pathParams = review?.pathParams && typeof review.pathParams === 'object' ? review.pathParams as Record<string, unknown> : undefined
  const toolName = typeof review.toolName === 'string' ? review.toolName : ''
  const reviewId = typeof review.reviewId === 'string' && review.reviewId.trim() ? review.reviewId.trim() : 'change-review'
  const showBlockBadge = blocks.length > 1
  const handlePrimaryDiffNavigateReady = (navigate: ((target: DiffNavigateTarget) => void) | null) => {
    diffNavigationRef.current = typeof navigate === 'function' ? navigate : null
  }

  return (
    <div className="absolute inset-0 z-40 flex items-stretch justify-center p-1.5 bg-black/[0.18] backdrop-blur-[4px]">
      <div className="w-full h-full grid grid-rows-[44px_minmax(0,1fr)] rounded-xl border border-line bg-overlay shadow-xl overflow-hidden">
        <div className="min-w-0 flex items-center justify-between gap-3 px-3 border-b border-line bg-raised">
          <div className="min-w-0 flex items-center gap-2">
            {toolName ? (
              <div className="h-[22px] inline-flex items-center px-2 rounded-md bg-canvas text-secondary text-xs font-semibold shrink-0">
                {toolName}
              </div>
            ) : null}
            <div className="min-w-0 text-secondary text-sm font-mono truncate">
              {/* path 为动态 key（可能不在翻译表），t() 内部有兜底 */}
              {path ? t(path as I18nKey, pathParams) : t('修改')}
            </div>
            {!previewOnly && queueLength > 1 ? (
              <div className="h-[22px] inline-flex items-center px-2 rounded-md bg-[rgba(var(--warning-rgb),0.12)] text-warning text-xs font-bold shrink-0">
                {`${t('队列')} ${queueLength}`}
              </div>
            ) : null}
          </div>
          <div className="inline-flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => diffNavigationRef.current?.('previous')}
              title={t('上一个')}
              aria-label={t('上一个')}
              className={NAV_BUTTON_CLASS}>
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => diffNavigationRef.current?.('next')}
              title={t('下一个')}
              aria-label={t('下一个')}
              className={NAV_BUTTON_CLASS}>
              <ArrowDown size={14} />
            </button>
            {previewOnly && typeof onClose === 'function' ? (
              <button
                type="button"
                onClick={onClose}
                aria-label={t('关闭')}
                className={NAV_BUTTON_CLASS}>
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div
          className="min-h-0 p-2 overflow-auto grid gap-2 bg-canvas"
          style={{ gridTemplateRows: blocks.length <= 1 ? '1fr' : `repeat(${blocks.length}, minmax(320px, 1fr))` }}>
          {blocks.length > 0 ? blocks.map((block, index) => (
            <DiffEditorPair
              onNavigateReady={index === 0 ? handlePrimaryDiffNavigateReady : null}
              key={`review-block-${reviewId}-${index}`}
              block={block}
              index={index}
              path={path}
              reviewId={reviewId}
              showBlockBadge={showBlockBadge}
              t={t}
            />
          )) : (
            <div className="min-h-0 flex items-center justify-center border border-line rounded-lg bg-canvas text-secondary text-sm">
              {t('暂无可预览差异')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
