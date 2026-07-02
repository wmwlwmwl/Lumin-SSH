import { House, Settings } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from '../../i18n.js'
import IconActionButton from './IconActionButton.jsx'

function formatAIContextTokens(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '0'
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

export default function AIPanelHeader({
  showSettingsPanel,
  onToggleSettings,
  onGoHome,
  showContextTokens = false,
  contextTokens = 0,
  isCondensingContext = false,
  canCondenseContext = false,
  onCondenseContext,
}) {
  const { t } = useTranslation()
  const contextTokenLabel = useMemo(() => formatAIContextTokens(contextTokens), [contextTokens])

  return (
    <div style={{ height: 54, padding: '0 14px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)', flexShrink: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 0.2 }}>{t('AI 助手')}</div>
      {showContextTokens ? (
        <button
          type="button"
          title={isCondensingContext ? t('正在智能压缩上下文') : t('当前对话上下文 Token,点击智能压缩')}
          aria-label={isCondensingContext ? t('正在智能压缩上下文') : t('当前对话上下文 Token,点击智能压缩')}
          disabled={!canCondenseContext}
          onClick={onCondenseContext}
          style={{
            justifySelf: 'center',
            height: 30,
            minWidth: 92,
            padding: '0 12px',
            borderRadius: 999,
            border: `1px solid ${isCondensingContext ? 'var(--accent-border)' : 'var(--border)'}`,
            background: isCondensingContext ? 'var(--accent-dim)' : 'transparent',
            color: isCondensingContext ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 700,
            opacity: canCondenseContext || isCondensingContext ? 1 : 0.6,
            transition: 'var(--transition)',
            whiteSpace: 'nowrap',
          }}
        >
          {contextTokenLabel}
        </button>
      ) : (
        <div />
      )}
      <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconActionButton title={t('返回主页')} onClick={onGoHome}>
          <House size={16} />
        </IconActionButton>
        <IconActionButton title={showSettingsPanel ? t('关闭设置面板') : t('打开设置面板')} active={showSettingsPanel} onClick={onToggleSettings}>
          <Settings size={16} />
        </IconActionButton>
      </div>
    </div>
  )
}