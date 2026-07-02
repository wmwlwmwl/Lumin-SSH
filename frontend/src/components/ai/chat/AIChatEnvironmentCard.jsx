import { ChevronRight, Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from '../../../i18n.js'

export default function AIChatEnvironmentCard({ message }) {
  const { t } = useTranslation()
  const text = typeof message?.text === 'string' ? message.text.trim() : ''
  const [collapsed, setCollapsed] = useState(true)

  if (!text) {
    return null
  }

  return (
    <div
      style={{
        width: '100%',
        display: 'grid',
        gap: 0,
        padding: 0,
        borderRadius: 12,
        border: '1px solid rgba(var(--accent-rgb), 0.18)',
        background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.10), rgba(var(--accent-rgb), 0.04))',
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          width: '100%',
          minHeight: 0,
          padding: '0 14px',
          border: 'none',
          background: 'transparent',
          textAlign: 'left',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
          <Info size={14} color="var(--accent)" />
          <span>{t('环境上下文')}</span>
        </div>
        <ChevronRight
          size={14}
          color="var(--text-tertiary)"
          style={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'var(--transition)',
            flexShrink: 0,
          }}
        />
      </button>
      {!collapsed ? (
        <div style={{ marginTop: 0, padding: '0 14px', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text}
        </div>
      ) : null}
    </div>
  )
}