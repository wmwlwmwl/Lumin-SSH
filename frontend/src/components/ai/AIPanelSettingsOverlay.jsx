import { ArrowRightLeft, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n.js'
import MCPAccessView from './MCPAccessView.jsx'
import AISlashCommandsSettings from './AISlashCommandsSettings.jsx'

function PreviewPill({ label, primary = false }) {
  return (
    <div
      style={{
        minHeight: 34,
        width: '100%',
        padding: '0 12px',
        borderRadius: 8,
        border: `1px solid ${primary ? 'var(--accent-border)' : 'var(--border)'}`,
        background: primary ? 'rgba(var(--accent-rgb), 0.14)' : 'transparent',
        color: primary ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      }}
    >
      {label}
    </div>
  )
}

function PositionSelectorCard({ title, description, items, onToggle, toggleLabel }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)', display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{description}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
        <div style={{ minHeight: 58, padding: 12, borderRadius: 12, background: 'var(--surface-overlay)', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 10, alignItems: 'center' }}>
          {items.map((item) => (
            <PreviewPill key={item.key} label={item.label} primary={item.primary} />
          ))}
        </div>
        <button
          type="button"
          onClick={onToggle}
          title={toggleLabel}
          aria-label={toggleLabel}
          style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'var(--transition)',
            flexShrink: 0,
          }}
        >
          <ArrowRightLeft size={16} />
        </button>
      </div>
    </div>
  )
}

export default function AIPanelSettingsOverlay({ show, onClose, activeTab, onChangeTab, mcpInfo, configText, configRows, globalAISettings, onSaveGlobalAISettings }) {
  const { t } = useTranslation()
  const overlayRef = useRef(null)
  const [overlayBounds, setOverlayBounds] = useState(null)

  useEffect(() => {
    if (!show) {
      return undefined
    }

    const updateOverlayBounds = () => {
      const root = overlayRef.current?.closest('[data-ai-panel-root="true"]')
      const chatStage = root?.querySelector('[data-ai-chat-stage="true"]')
      const composerInputZone = root?.querySelector('[data-ai-composer-input-zone="true"]')

      if (!root || (!chatStage && !composerInputZone)) {
        setOverlayBounds(null)
        return
      }

      const rootRect = root.getBoundingClientRect()
      const chatRect = chatStage?.getBoundingClientRect()
      const composerRect = composerInputZone?.getBoundingClientRect()

      const top = Math.min(chatRect?.top ?? rootRect.top, composerRect?.top ?? rootRect.top)
      const left = Math.min(chatRect?.left ?? rootRect.left, composerRect?.left ?? rootRect.left)
      const right = Math.max(chatRect?.right ?? rootRect.right, composerRect?.right ?? rootRect.right)
      const bottom = Math.max(chatRect?.bottom ?? rootRect.bottom, composerRect?.bottom ?? rootRect.bottom)

      setOverlayBounds({
        top: top - rootRect.top,
        left: left - rootRect.left,
        width: right - left,
        height: bottom - top,
      })
    }

    updateOverlayBounds()
    window.addEventListener('resize', updateOverlayBounds)
    window.addEventListener('scroll', updateOverlayBounds, true)

    return () => {
      window.removeEventListener('resize', updateOverlayBounds)
      window.removeEventListener('scroll', updateOverlayBounds, true)
    }
  }, [show])

  if (!show) {
    return null
  }

  const approvalButtonOrder = globalAISettings?.approvalButtonOrder || 'reject-approve'
  const commandActionButtonOrder = globalAISettings?.commandActionButtonOrder || 'terminate-continue'

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        top: overlayBounds?.top ?? 0,
        left: overlayBounds?.left ?? 0,
        width: overlayBounds?.width ?? '100%',
        height: overlayBounds?.height ?? '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        background: 'rgba(5, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        overflow: 'hidden',
        zIndex: 120,
      }}>
      <div style={{ width: '100%', height: '100%', background: 'var(--surface-overlay)', border: '1px solid var(--border)', borderRadius: 0, boxShadow: 'var(--shadow-xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ height: 50, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('设置')}</div>
          <button
            type="button"
            onClick={onClose}
            title={t('关闭设置面板')}
            aria-label={t('关闭设置面板')}
            style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid transparent', transition: 'var(--transition)' }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 'fit-content', borderRight: '1px solid var(--border)', background: 'var(--surface-base)', padding: 0, display: 'flex', flexDirection: 'column', gap: 0, flex: '0 0 auto' }}>
            <button
              type="button"
              onClick={() => onChangeTab('mcp')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minHeight: 52,
                padding: '0 10px',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: activeTab === 'mcp' ? 600 : 500,
                color: activeTab === 'mcp' ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeTab === 'mcp' ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                border: 'none',
                borderLeft: `2px solid ${activeTab === 'mcp' ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 0,
                transition: 'var(--transition)',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              <span>{t('MCP集成')}</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('slash-commands')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minHeight: 52,
                padding: '0 10px',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: activeTab === 'slash-commands' ? 600 : 500,
                color: activeTab === 'slash-commands' ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeTab === 'slash-commands' ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                border: 'none',
                borderLeft: `2px solid ${activeTab === 'slash-commands' ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 0,
                transition: 'var(--transition)',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              <span>{t('斜杠命令')}</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('appearance')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minHeight: 52,
                padding: '0 10px',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: activeTab === 'appearance' ? 600 : 500,
                color: activeTab === 'appearance' ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeTab === 'appearance' ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                border: 'none',
                borderLeft: `2px solid ${activeTab === 'appearance' ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 0,
                transition: 'var(--transition)',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              <span>{t('外观')}</span>
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activeTab === 'mcp' && <MCPAccessView mcpInfo={mcpInfo} configText={configText} configRows={configRows} title={t('接入方式')} titleSize={18} showTools={true} />}
            {activeTab === 'slash-commands' ? (
              <AISlashCommandsSettings
                slashCommands={globalAISettings?.slashCommands}
                onSaveGlobalAISettings={onSaveGlobalAISettings}
              />
            ) : null}
            {activeTab === 'appearance' ? (
              <>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('外观')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t('控制底部审批与命令处理按钮的左右位置。')}</div>
                </div>
                <PositionSelectorCard
                  title={t('工具审批按钮位置')}
                  description={t('左侧为预览区,右侧点击交换"拒绝 / 批准"的左右顺序.')}
                  items={approvalButtonOrder === 'approve-reject'
                    ? [
                        { key: 'approve', label: t('批准'), primary: true },
                        { key: 'reject', label: t('拒绝'), primary: false },
                      ]
                    : [
                        { key: 'reject', label: t('拒绝'), primary: false },
                        { key: 'approve', label: t('批准'), primary: true },
                      ]}
                  onToggle={() => onSaveGlobalAISettings?.({
                    approvalButtonOrder: approvalButtonOrder === 'approve-reject' ? 'reject-approve' : 'approve-reject',
                  })}
                  toggleLabel={t('交换位置')}
                />
                <PositionSelectorCard
                  title={t('命令处理按钮位置')}
                  description={t('左侧为预览区,右侧点击交换"强制继续 / 终止工具"的左右顺序.')}
                  items={commandActionButtonOrder === 'continue-terminate'
                    ? [
                        { key: 'continue', label: t('强制继续'), primary: true },
                        { key: 'terminate', label: t('终止工具'), primary: false },
                      ]
                    : [
                        { key: 'terminate', label: t('终止工具'), primary: false },
                        { key: 'continue', label: t('强制继续'), primary: true },
                      ]}
                  onToggle={() => onSaveGlobalAISettings?.({
                    commandActionButtonOrder: commandActionButtonOrder === 'continue-terminate' ? 'terminate-continue' : 'continue-terminate',
                  })}
                  toggleLabel={t('交换位置')}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}