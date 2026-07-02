import { ChevronDown, FileCode2, SquarePen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n.js'
import AIChatMarkdown from './AIChatMarkdown.jsx'

export default function AIChatToolCard({ actionLabel, title, summary, code, result = '', status, remainingFileEdits = 0, isLast = false, hasSubsequentAssistantMessage = false }) {
  const { t } = useTranslation()
  const [isAutoExpanded, setIsAutoExpanded] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (isLast) {
      setIsAutoExpanded(true)
    }
  }, [isLast])

  useEffect(() => {
    if (hasSubsequentAssistantMessage) {
      setIsAutoExpanded(false)
    }
  }, [hasSubsequentAssistantMessage])

  const expanded = isExpanded || ((isAutoExpanded && !hasSubsequentAssistantMessage) || ((status === '错误' || status === '已终止') && Boolean(result)))
  const statusPalette = useMemo(() => {
    switch (status) {
      case '待审阅':
      case '待批准':
        return {
          border: '1px solid rgba(var(--warning-rgb), 0.35)',
          background: 'rgba(var(--warning-rgb), 0.08)',
          color: 'var(--warning)',
        }
      case '执行中':
        return {
          border: '1px solid rgba(var(--accent-rgb), 0.35)',
          background: 'rgba(var(--accent-rgb), 0.08)',
          color: 'var(--accent)',
        }
      case '错误':
      case '已终止':
      case '已拒绝':
        return {
          border: '1px solid rgba(var(--danger-rgb), 0.35)',
          background: 'rgba(var(--danger-rgb), 0.08)',
          color: 'var(--danger)',
        }
      default:
        return {
          border: '1px solid rgba(var(--success-rgb), 0.35)',
          background: 'rgba(var(--success-rgb), 0.08)',
          color: 'var(--success)',
        }
    }
  }, [status])

  const normalizedRemainingFileEdits = Number.isFinite(Number(remainingFileEdits)) ? Math.max(0, Math.trunc(Number(remainingFileEdits))) : 0
  const showRemainingFileEdits = normalizedRemainingFileEdits > 0

  const handleToggleExpand = () => {
    setIsAutoExpanded(false)
    setIsExpanded((previous) => !previous)
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
        <div style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <FileCode2 size={14} color="var(--text-secondary)" />
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t(title)}</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {status ? (
            <div style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', ...statusPalette }}>
              {t(status)}
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleToggleExpand}
            style={{
              width: 24,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}>
            <ChevronDown
              size={14}
              color="var(--text-tertiary)"
              style={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 300ms ease',
              }}
            />
          </button>
        </div>
      </div>
      <div style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-overlay)', overflow: 'hidden' }}>
        <div
          style={{
            padding: '10px 12px',
            borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none',
            background: 'rgba(var(--accent-rgb), 0.04)',
            display: 'grid',
            gap: 4,
          }}>
          {showRemainingFileEdits ? (
            <div
              style={{
                display: 'inline-flex',
                width: '100%',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid rgba(var(--accent-rgb), 0.24)',
                background: 'rgba(var(--accent-rgb), 0.08)',
                color: 'var(--text-primary)',
                fontSize: 11,
                fontWeight: 700,
              }}>
              <SquarePen size={12} color="var(--accent)" />
              <span>{t('预计剩余 {count} 个编辑文件').replace('{count}', String(normalizedRemainingFileEdits))}</span>
            </div>
          ) : (
            <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>{actionLabel}</div>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-all' }}>
            <AIChatMarkdown text={summary} />
          </div>
        </div>
        {expanded ? (
          <div style={{ display: 'grid', gap: 10, padding: '12px' }}>
            <pre style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>{code}</pre>
            {result ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('result')}</div>
                <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-base)', color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>{result}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}