import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from '../../../i18n.js'
import AIChatMarkdown from './AIChatMarkdown.jsx'

const completionTitleKey = '任务完成'
const completionStatusKey = '已完成'

function normalizeAICompletionStatus(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  switch (normalized) {
    case 'completed':
      return '已完成'
    default:
      return normalized
  }
}

export default function AIChatCompletionCard({ title = completionTitleKey, summary = '', result = '', status = completionStatusKey }) {
  const { t } = useTranslation()
  const normalizedSummary = typeof summary === 'string' ? summary.trim() : ''
  const normalizedResult = typeof result === 'string' ? result.trim() : ''
  const normalizedStatus = normalizeAICompletionStatus(status)
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
        <div style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={14} color="var(--success)" />
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t(title)}</span>
        </div>
        {normalizedStatus ? (
          <div
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              border: '1px solid rgba(var(--success-rgb), 0.35)',
              background: 'rgba(var(--success-rgb), 0.08)',
              color: 'var(--success)',
            }}>
            {t(normalizedStatus)}
          </div>
        ) : null}
      </div>
      <div style={{ width: '100%', border: '1px solid var(--ai-chat-completion-card-border)', borderRadius: 12, background: 'var(--ai-chat-completion-card-bg)', overflow: 'hidden' }}>
        <div style={{ padding: '12px', background: 'var(--ai-chat-completion-card-header-bg)', display: 'grid', gap: normalizedSummary ? 8 : 0 }}>
          {normalizedSummary ? (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, wordBreak: 'break-word' }}>
              <AIChatMarkdown text={normalizedSummary} />
            </div>
          ) : null}
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.75, wordBreak: 'break-word' }}>
            <AIChatMarkdown text={normalizedResult || t('任务已完成')} />
          </div>
        </div>
      </div>
    </div>
  )
}