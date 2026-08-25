import { CheckCircle2 } from 'lucide-react'
import { useTranslation, type I18nKey } from '../../../i18n.ts'
import { cn } from '../../../utils/cn.ts'
import AIChatMarkdown from './AIChatMarkdown.tsx'

const completionTitleKey = '任务完成'
const completionStatusKey = '已完成'

interface AIChatCompletionCardProps {
  title?: string
  summary?: string
  result?: string
  status?: string
}

function normalizeAICompletionStatus(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default function AIChatCompletionCard({ title = completionTitleKey, summary = '', result = '', status = completionStatusKey }: AIChatCompletionCardProps) {
  const { t } = useTranslation()
  const normalizedSummary = typeof summary === 'string' ? summary.trim() : ''
  const normalizedResult = typeof result === 'string' ? result.trim() : ''
  const normalizedStatus = normalizeAICompletionStatus(status)
  const statusPalette = normalizedStatus === completionStatusKey
    ? {
        border: '1px solid rgba(var(--success-rgb), 0.35)',
        background: 'rgba(var(--success-rgb), 0.08)',
        color: 'var(--success)',
      }
    : (normalizedStatus === '等待处理'
      ? {
          border: '1px solid rgba(var(--warning-rgb), 0.35)',
          background: 'rgba(var(--warning-rgb), 0.08)',
          color: 'var(--warning)',
        }
      : {
          border: '1px solid rgba(var(--accent-rgb), 0.35)',
          background: 'rgba(var(--accent-rgb), 0.08)',
          color: 'var(--accent)',
        })
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <CheckCircle2 size={14} color={normalizedStatus === completionStatusKey ? 'var(--success)' : 'var(--accent)'} />
          {/* title 为 AI 返回动态文案（可能不在翻译表），t() 内部有兜底 */}
          <span className="font-bold text-primary">{t(title as I18nKey)}</span>
        </div>
        {normalizedStatus ? (
          <div
            style={statusPalette}
            className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold">
            {/* 同 title：动态状态文案兜底 */}
            {t(normalizedStatus as I18nKey)}
          </div>
        ) : null}
      </div>
      <div className="w-full overflow-hidden rounded-lg border border-[var(--ai-chat-completion-card-border)] bg-[var(--ai-chat-completion-card-bg)]">
        <div className={cn('grid p-2.5 bg-[var(--ai-chat-completion-card-header-bg)]', normalizedSummary ? 'gap-1.5' : 'gap-0')}>
          {normalizedSummary ? (
            <div className="text-sm leading-[1.7] [word-break:break-word] text-secondary">
              <AIChatMarkdown text={normalizedSummary} enableQuoteContextMenu={true} />
            </div>
          ) : null}
          <div className="text-base leading-[1.75] [word-break:break-word] text-primary">
            {/* result 为动态内容（可能不在翻译表），t() 内部有兜底 */}
            <AIChatMarkdown text={normalizedResult ? t(normalizedResult as I18nKey) : t('任务已完成')} enableQuoteContextMenu={true} />
          </div>
        </div>
      </div>
    </div>
  )
}
