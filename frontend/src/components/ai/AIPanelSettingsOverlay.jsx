import { ArrowRightLeft, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n.js'
import MCPAccessView from './MCPAccessView.jsx'
import MCPServersView from './MCPServersView.jsx'
import AISlashCommandsSettings from './AISlashCommandsSettings.jsx'
import AIConversationBackupSettings from './AIConversationBackupSettings.jsx'
import Tiptop from '../Tiptop.jsx'
import { handleInputDragSelectAll } from './inputDragSelect.js'

function formatTokenCountInMillions(value) {
  return `${(value / 1000000).toFixed(6)}M`
}

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
          <Tiptop text={toggleLabel}>
            <button
              type="button"
              onClick={onToggle}
              aria-label={toggleLabel}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
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
              <ArrowRightLeft size={14} />
            </button>
          </Tiptop>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{description}</div>
      </div>
      <div style={{ minHeight: 58, padding: 12, borderRadius: 12, background: 'var(--surface-overlay)', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 10, alignItems: 'center' }}>
        {items.map((item) => (
          <PreviewPill key={item.key} label={item.label} primary={item.primary} />
        ))}
      </div>
    </div>
  )
}

function ToggleSwitchControl({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: checked ? 'var(--success)' : 'var(--surface-hover)',
        padding: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        transition: 'var(--transition)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
        }}
      />
    </button>
  )
}

export default function AIPanelSettingsOverlay({
  show,
  onClose,
  activeTab,
  onChangeTab,
  mcpInfo,
  configText,
  configRows,
  globalAISettings,
  onSaveGlobalAISettings,
  aiTerminalIsolation,
  onToggleAiTerminalIsolation,
  confirmDelete,
  onToggleConfirmDelete,
  activeConversationId,
  conversationUpdatedAt,
  backupRequestInFlight,
  onRestoreConversationBackup,
  autoBackupEnabled,
  onToggleAutoBackup,
  soundEnabled,
  soundVolume,
  terminalOutputLineLimit,
  onTerminalOutputLineLimitChange,
  terminalOutputCharacterLimit,
  onTerminalOutputCharacterLimitChange,
  mcpClientServers = [],
  mcpClientGlobalConfigPath = '',
  mcpClientGlobalConfigText = '',
  onSaveMCPGlobalServer,
  onReloadMCPGlobalServers,
  onDeleteMCPGlobalServer,
  onRestartMCPClientServer,
  onToggleMCPClientServer,
  onToggleMCPClientServerDisabledForPrompts,
  onUpdateMCPClientServerTimeout,
}) {
  const { t } = useTranslation()
  const overlayRef = useRef(null)
  const tabListRef = useRef(null)
  const [overlayBounds, setOverlayBounds] = useState(null)

  useLayoutEffect(() => {
    if (!show) {
      return undefined
    }

    if (activeTab) {
      return undefined
    }

    const firstTabKey = tabListRef.current?.querySelector('[data-ai-settings-tab-key]')?.dataset?.aiSettingsTabKey || ''
    if (firstTabKey) {
      onChangeTab(firstTabKey)
    }
    return undefined
  }, [activeTab, onChangeTab, show])

  useEffect(() => {
    if (!show) {
      return undefined
    }

    const updateOverlayBounds = () => {
      const root = overlayRef.current?.closest('[data-ai-panel-root="true"]')
      const chatStage = root?.querySelector('[data-ai-chat-stage="true"]')
      const composer = root?.querySelector('[data-ai-composer-root="true"]')

      if (!root || (!chatStage && !composer)) {
        setOverlayBounds(null)
        return
      }

      const rootRect = root.getBoundingClientRect()
      const chatRect = chatStage?.getBoundingClientRect()
      const composerRect = composer?.getBoundingClientRect()

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

    const rootEl = overlayRef.current?.closest('[data-ai-panel-root="true"]')
    const resizeObserver = rootEl ? new ResizeObserver(updateOverlayBounds) : null
    if (resizeObserver) {
      resizeObserver.observe(rootEl)
    }

    window.addEventListener('resize', updateOverlayBounds)
    window.addEventListener('scroll', updateOverlayBounds, true)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateOverlayBounds)
      window.removeEventListener('scroll', updateOverlayBounds, true)
    }
  }, [show])

  if (!show) {
    return null
  }

  const approvalButtonOrder = globalAISettings?.approvalButtonOrder || 'reject-approve'
  const commandActionButtonOrder = globalAISettings?.commandActionButtonOrder || 'terminate-continue'
  const messageActionBarAtBottom = Boolean(globalAISettings?.messageActionBarAtBottom)
  const mcpEnabled = globalAISettings?.mcpEnabled !== false
  const mcpAllowBrowserCalls = Boolean(globalAISettings?.mcpAllowBrowserCalls)
  const continueAfterToolRejection = globalAISettings?.continueAfterToolRejection !== false
  const proxyNodes = Array.isArray(globalAISettings?.proxyNodes) ? globalAISettings.proxyNodes : []
  const aiRequestProxyId = typeof globalAISettings?.aiRequestProxyId === 'string' ? globalAISettings.aiRequestProxyId : ''
  const toolResultTokenThreshold = Number.isFinite(Number(globalAISettings?.toolResultTokenThreshold))
    ? Math.max(1, Math.trunc(Number(globalAISettings.toolResultTokenThreshold)))
    : 350000
  const toolResultTokenThresholdDisplay = formatTokenCountInMillions(toolResultTokenThreshold)

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
          <Tiptop text={t('关闭设置面板')}>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('关闭设置面板')}
              style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid transparent', transition: 'var(--transition)' }}
            >
              <X size={16} />
            </button>
          </Tiptop>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div ref={tabListRef} style={{ width: 'fit-content', borderRight: '1px solid var(--border)', background: 'var(--surface-base)', padding: 0, display: 'flex', flexDirection: 'column', gap: 0, flex: '0 0 auto' }}>
            <button
              type="button"
              data-ai-settings-tab-key="ai"
              onClick={() => onChangeTab('ai')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minHeight: 52,
                padding: '0 10px',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: activeTab === 'ai' ? 600 : 500,
                color: activeTab === 'ai' ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeTab === 'ai' ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                border: 'none',
                borderLeft: `2px solid ${activeTab === 'ai' ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 0,
                transition: 'var(--transition)',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              <span>{t('基本')}</span>
            </button>
            <button
              type="button"
              data-ai-settings-tab-key="mcp"
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
              data-ai-settings-tab-key="mcp-servers"
              onClick={() => onChangeTab('mcp-servers')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minHeight: 52,
                padding: '0 10px',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: activeTab === 'mcp-servers' ? 600 : 500,
                color: activeTab === 'mcp-servers' ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: activeTab === 'mcp-servers' ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                border: 'none',
                borderLeft: `2px solid ${activeTab === 'mcp-servers' ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 0,
                transition: 'var(--transition)',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              <span>{t('MCP服务器')}</span>
            </button>
            <button
              type="button"
              data-ai-settings-tab-key="slash-commands"
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
              data-ai-settings-tab-key="appearance"
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
            {activeConversationId ? (
              <button
                type="button"
                onClick={() => onChangeTab('backup')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  minHeight: 52,
                  padding: '0 10px',
                  textAlign: 'left',
                  fontSize: 13,
                  fontWeight: activeTab === 'backup' ? 600 : 500,
                  color: activeTab === 'backup' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: activeTab === 'backup' ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
                  border: 'none',
                  borderLeft: `2px solid ${activeTab === 'backup' ? 'var(--accent)' : 'transparent'}`,
                  borderRadius: 0,
                  transition: 'var(--transition)',
                  whiteSpace: 'nowrap',
                  width: '100%',
                }}
              >
                <span>{t('自动备份')}</span>
              </button>
            ) : null}
          </div>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {activeTab === 'mcp' && (
              <MCPAccessView
                mcpInfo={mcpInfo}
                configText={configText}
                configRows={configRows}
                title={t('接入方式')}
                titleSize={18}
                showTools={true}
                mcpEnabled={mcpEnabled}
                mcpAllowBrowserCalls={mcpAllowBrowserCalls}
                onToggleMcpEnabled={() => onSaveGlobalAISettings?.({ mcpEnabled: !mcpEnabled })}
                onToggleMcpAllowBrowserCalls={() => onSaveGlobalAISettings?.({ mcpAllowBrowserCalls: !mcpAllowBrowserCalls })}
              />
            )}
            {activeTab === 'mcp-servers' ? (
              <MCPServersView
                servers={mcpClientServers}
                globalConfigPath={mcpClientGlobalConfigPath}
                globalConfigText={mcpClientGlobalConfigText}
                onSaveServer={onSaveMCPGlobalServer}
                onReloadServers={onReloadMCPGlobalServers}
                onDeleteServer={onDeleteMCPGlobalServer}
                onRestartServer={onRestartMCPClientServer}
                onToggleServer={onToggleMCPClientServer}
                onToggleServerDisabledForPrompts={onToggleMCPClientServerDisabledForPrompts}
                onUpdateServerTimeout={onUpdateMCPClientServerTimeout}
              />
            ) : null}
            {activeTab === 'ai' ? (
              <>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('基本')}</div>
                </div>
                <div style={{ background: 'var(--surface-base)', padding: 16, borderRadius: 12, border: '1px solid var(--border)', display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('终端隔离')}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('为每个终端创建独立的 AI 面板与运行期会话。修改后将在下次启动应用时生效。')}</div>
                    </div>
                    <ToggleSwitchControl checked={aiTerminalIsolation} onChange={onToggleAiTerminalIsolation} />
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('删除前需要二次确认')}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('删除 AI 对话或消息前先弹出确认提示')}</div>
                    </div>
                    <ToggleSwitchControl checked={confirmDelete} onChange={onToggleConfirmDelete} />
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('拒绝工具后自动继续')}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('关闭后，点击“拒绝”会停止本次请求并等待下一条消息。')}</div>
                    </div>
                    <ToggleSwitchControl
                      checked={continueAfterToolRejection}
                      onChange={() => onSaveGlobalAISettings?.({ continueAfterToolRejection: !continueAfterToolRejection })}
                    />
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('任务提示音')}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('在追问需要处理和任务完成时播放提示音。')}</div>
                    </div>
                    <ToggleSwitchControl
                      checked={soundEnabled !== false}
                      onChange={() => onSaveGlobalAISettings?.({ soundEnabled: soundEnabled === false })}
                    />
                  </div>
                  {soundEnabled !== false ? (
                    <>
                      <div style={{ borderTop: '1px solid var(--border)' }} />
                      <div style={{ display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('提示音音量')}</div>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('默认 20%，可按需调节。')}</div>
                          </div>
                          <span style={{ fontSize: 13, minWidth: 56, textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{`${Math.round((Number.isFinite(Number(soundVolume)) ? Number(soundVolume) : 0.2) * 100)}%`}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round((Number.isFinite(Number(soundVolume)) ? Number(soundVolume) : 0.2) * 100)}
                          onChange={(event) => onSaveGlobalAISettings?.({ soundVolume: Math.max(0, Math.min(1, (parseInt(event.target.value, 10) || 0) / 100)) })}
                          style={{ width: '100%', cursor: 'pointer' }}
                        />
                      </div>
                    </>
                  ) : null}
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('终端输出行数上限')}</div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('控制 MCP 终端输出保留的最大行数')}</div>
                      </div>
                      <span style={{ fontSize: 13, minWidth: 56, textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{terminalOutputLineLimit}</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="5000"
                      step="10"
                      value={terminalOutputLineLimit}
                      onChange={onTerminalOutputLineLimitChange}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
                        <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('工具阈值')}</div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(var(--accent-rgb), 0.24)', background: 'rgba(var(--accent-rgb), 0.08)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{toolResultTokenThresholdDisplay}</span>
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('当工具返回结果的预估 Token 数超过此阈值时,原始内容将被省略,并显示“结果过大”的提示.调高可保留更多原始输出,但也会增加上下文膨胀风险.')}</div>
                    </div>
                    <input
                      type="number"
                      min="1"
                      step="1000"
                      value={toolResultTokenThreshold}
                      onChange={(event) => {
                        const nextValue = parseInt(event.target.value, 10)
                        if (Number.isFinite(nextValue)) {
                          void onSaveGlobalAISettings?.({ toolResultTokenThreshold: nextValue })
                        }
                      }}
                      onMouseLeave={handleInputDragSelectAll}
                      style={{
                        width: '100%',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-base)',
                        color: 'var(--text-primary)',
                        padding: '8px 10px',
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('AI 请求代理')}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('选择 AI 请求使用的代理节点，首项为不使用。')}</div>
                    </div>
                    <select
                      className="select"
                      value={aiRequestProxyId}
                      onChange={(event) => onSaveGlobalAISettings?.({ aiRequestProxyId: event.target.value })}
                      style={{ width: '100%' }}
                    >
                      <option value="">{t('不使用')}</option>
                      {proxyNodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {[
                            node.name || t('未命名节点'),
                            node.type === 'http' ? t('HTTP 代理') : t('SOCKS5 代理'),
                            `${node.host}:${node.port}`,
                          ].join(' · ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : null}
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
                <div style={{ background: 'var(--surface-base)', padding: 14, borderRadius: 12, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('消息操作条置底')}</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('启用后,用户消息与Ai消息的操作条显示在每轮消息主体底部;关闭后显示在顶部.')}</div>
                  </div>
                  <ToggleSwitchControl
                    checked={messageActionBarAtBottom}
                    onChange={() => onSaveGlobalAISettings?.({
                      messageActionBarAtBottom: !messageActionBarAtBottom,
                    })}
                  />
                </div>
              </>
            ) : null}
            {activeTab === 'backup' && activeConversationId ? (
              <AIConversationBackupSettings
                active={activeTab === 'backup'}
                conversationId={activeConversationId}
                conversationUpdatedAt={conversationUpdatedAt}
                requestInFlight={backupRequestInFlight}
                onRestoreSnapshot={onRestoreConversationBackup}
                autoBackupEnabled={autoBackupEnabled}
                onToggleAutoBackup={onToggleAutoBackup}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}