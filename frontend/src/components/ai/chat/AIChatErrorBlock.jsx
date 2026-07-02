import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../../i18n.js'

export default function AIChatErrorBlock({ text = '' }) {
  const { t } = useTranslation()
  const content = typeof text === 'string' ? text.trim() : ''

  if (!content) {
    return null
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        width: 'calc(100% + 24px)',
        margin: '-10px -12px 0',
        padding: '10px 12px',
        borderRadius: '12px 12px 0 0',
        border: '1px solid rgba(var(--danger-rgb), 0.26)',
        background: 'linear-gradient(180deg, rgba(var(--danger-rgb), 0.14), rgba(var(--danger-rgb), 0.08))',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
        <AlertTriangle size={14} />
        <span>{t('错误')}</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {content}
      </div>
    </div>
  )
}