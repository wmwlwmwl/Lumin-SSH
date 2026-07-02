import { Scissors } from 'lucide-react'
import { useTranslation } from '../../../i18n.js'

function formatTokenValue(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return ''
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

export default function AIChatContextCondenseCard({ message }) {
  const { t } = useTranslation()
  const summary = typeof message?.text === 'string' ? message.text.trim() : ''
  const prevTokens = Number(message?.extra?.prevContextTokens)
  const newTokens = Number(message?.extra?.newContextTokens)
  const hasTokenMetrics = Number.isFinite(prevTokens) && prevTokens >= 0 && Number.isFinite(newTokens) && newTokens >= 0
  const savedTokens = hasTokenMetrics ? Math.max(0, Math.round(prevTokens - newTokens)) : 0

  return (
    <div
      style={{
        width: '100%',
        display: 'grid',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid rgba(var(--accent-rgb), 0.18)',
        background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.10), rgba(var(--accent-rgb), 0.04))',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Scissors size={14} color="var(--accent)" />
          <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('上下文已智能压缩')}</span>
        </div>
        {hasTokenMetrics ? (
          <span style={{ flexShrink: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
            {formatTokenValue(prevTokens)} → {formatTokenValue(newTokens)}
          </span>
        ) : null}
      </div>
      {summary ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {summary}
        </div>
      ) : null}
    </div>
  )
}