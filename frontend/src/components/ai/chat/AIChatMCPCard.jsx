import { ChevronDown, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n.js'

export default function AIChatMCPCard({ serverName, toolName, args, response, isLast = false, hasSubsequentAssistantMessage = false }) {
  const { t } = useTranslation()
  const [isRequestExpanded, setIsRequestExpanded] = useState(isLast)
  const [isResponseExpanded, setIsResponseExpanded] = useState(false)

  useEffect(() => {
    if (isLast) {
      setIsRequestExpanded(true)
    }
  }, [isLast])

  useEffect(() => {
    if (response) {
      setIsResponseExpanded(true)
    }
  }, [response])

  useEffect(() => {
    if (!hasSubsequentAssistantMessage) {
      return
    }
    setIsRequestExpanded(false)
    if (response) {
      setIsResponseExpanded(false)
    }
  }, [hasSubsequentAssistantMessage, response])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ width: '100%', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Server size={14} color="var(--text-secondary)" />
            <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{serverName}</span>
            {toolName ? <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{toolName}</span> : null}
          </span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {response ? (
              <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(var(--success-rgb), 0.35)', background: 'rgba(var(--success-rgb), 0.08)', color: 'var(--success)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {t('completed')}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setIsRequestExpanded((previous) => !previous)}
              style={{
                width: 24,
                height: 24,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}>
              <ChevronDown
                size={14}
                color="var(--text-tertiary)"
                style={{
                  transform: isRequestExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 300ms ease',
                }}
              />
            </button>
          </div>
        </div>
        {isRequestExpanded ? (
          <div style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-overlay)', overflow: 'hidden' }}>
            <div style={{ padding: '12px', display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('arguments')}</div>
                <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto', overflowX: 'auto' }}>{args}</pre>
              </div>
            </div>
          </div>
        ) : null}
        {response ? (
          <div style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-overlay)', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setIsResponseExpanded((previous) => !previous)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 12px',
                border: 'none',
                background: 'var(--surface-raised)',
                cursor: 'pointer',
                textAlign: 'left',
              }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('response')}</span>
              </span>
              <ChevronDown
                size={14}
                color="var(--text-tertiary)"
                style={{
                  transform: isResponseExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 300ms ease',
                }}
              />
            </button>
            {isResponseExpanded ? (
              <div style={{ padding: '12px', display: 'grid', gap: 10 }}>
                <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-base)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflowY: 'auto', overflowX: 'auto' }}>{response}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}