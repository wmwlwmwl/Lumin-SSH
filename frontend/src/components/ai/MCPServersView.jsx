import { RotateCcw, Save, Trash2, Eye, EyeOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../i18n.js'
import Tiptop from '../Tiptop.jsx'

const defaultConfigText = '{\n  "mcpServers": {}\n}'

function ToggleSwitch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: disabled ? 'var(--surface-hover)' : checked ? 'var(--success)' : 'var(--surface-hover)',
        padding: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        transition: 'var(--transition)',
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
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

function normalizeErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return ''
}

export default function MCPServersView({
  servers = [],
  globalConfigPath = '',
  globalConfigText = defaultConfigText,
  onSaveServer,
  onReloadServers,
  onDeleteServer,
  onRestartServer,
  onToggleServer,
  onToggleServerDisabledForPrompts,
  onUpdateServerTimeout,
}) {
  const { t } = useTranslation()
  const [configText, setConfigText] = useState(globalConfigText || defaultConfigText)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    setConfigText(globalConfigText || defaultConfigText)
    setErrorText('')
  }, [globalConfigText])

  const sortedServers = useMemo(() => Array.isArray(servers) ? servers : [], [servers])

  const handleSave = async () => {
    setSaving(true)
    setErrorText('')
    try {
      await onSaveServer?.('', configText)
    } catch (error) {
      setErrorText(normalizeErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleReload = async () => {
    setReloading(true)
    setErrorText('')
    try {
      await onReloadServers?.()
    } catch (error) {
      setErrorText(normalizeErrorMessage(error))
    } finally {
      setReloading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('MCP服务器')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{t('这里直接配置完整的 MCP Json 文件；内置服务器只读，外置服务器可通过下方完整配置统一维护。')}</div>
        {globalConfigPath ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, wordBreak: 'break-all' }}>
            {t('外置配置文件')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{globalConfigPath}</span>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gap: 8, padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)' }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('完整MCP Json配置')}</div>
        <textarea
          value={configText}
          onChange={(event) => {
            setConfigText(event.target.value)
            if (errorText) {
              setErrorText('')
            }
          }}
          rows={14}
          spellCheck={false}
          style={{
            width: '100%',
            resize: 'vertical',
            minHeight: 260,
            padding: '12px',
            borderRadius: 10,
            border: `1px solid ${errorText ? 'rgba(var(--danger-rgb), 0.38)' : 'var(--border)'}`,
            background: 'var(--surface-overlay)',
            color: 'var(--text-primary)',
            fontSize: 12,
            lineHeight: 1.65,
            fontFamily: 'var(--font-mono)',
            outline: 'none',
            whiteSpace: 'pre',
          }}
        />
        {errorText ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(var(--danger-rgb), 0.28)',
              background: 'rgba(var(--danger-rgb), 0.08)',
              color: 'var(--danger)',
              fontSize: 12,
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <span style={{ fontWeight: 700 }}>{t('错误')}：</span>
            <span>{errorText}</span>
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void handleReload()}
            disabled={saving || reloading}
            style={{
              height: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 700,
              cursor: saving || reloading ? 'not-allowed' : 'pointer',
              opacity: saving || reloading ? 0.7 : 1,
            }}
          >
            <RotateCcw size={14} />
            <span>{reloading ? t('刷新中...') : t('刷新')}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || reloading}
            style={{
              height: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--accent-border)',
              background: 'rgba(var(--accent-rgb), 0.12)',
              color: 'var(--accent)',
              fontSize: 13,
              fontWeight: 700,
              cursor: saving || reloading ? 'not-allowed' : 'pointer',
              opacity: saving || reloading ? 0.7 : 1,
            }}
          >
            <Save size={14} />
            <span>{saving ? t('保存中...') : t('保存MCP Json配置')}</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {sortedServers.length === 0 ? (
          <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-base)', color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1.7 }}>
            {t('当前还没有可用的 MCP 服务器。')}
          </div>
        ) : sortedServers.map((server) => {
          const isEmbedded = server.source === 'embedded'
          const canManage = server.source === 'global'
          const timeoutValue = Number.isFinite(Number(server.timeout)) ? Number(server.timeout) : 0
          return (
            <div key={`${server.source}-${server.name}`} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-base)', display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, display: 'grid', gap: 6, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }}>{server.name}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)', background: isEmbedded ? 'rgba(var(--success-rgb), 0.08)' : 'rgba(var(--accent-rgb), 0.08)', color: isEmbedded ? 'var(--success)' : 'var(--accent)', fontSize: 11, fontWeight: 700 }}>
                      {isEmbedded ? t('内置') : t('外置')}
                    </span>
                    <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)', background: server.status === 'connected' ? 'rgba(var(--success-rgb), 0.08)' : server.status === 'connecting' ? 'rgba(var(--warning-rgb), 0.08)' : 'rgba(var(--danger-rgb), 0.08)', color: server.status === 'connected' ? 'var(--success)' : server.status === 'connecting' ? 'var(--warning)' : 'var(--danger)', fontSize: 11, fontWeight: 700 }}>
                      {t(server.status === 'connected' ? '已连接' : server.status === 'connecting' ? '连接中...' : '已断开')}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, maxHeight: 160, overflowY: 'auto', overflowX: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 4 }}>
                    {server.error ? server.error : server.instructions || t('暂无说明')}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Tiptop text={t('重启MCP服务器')}>
                    <button
                      type="button"
                      onClick={() => void onRestartServer?.(server.name, server.source)}
                      style={{
                        width: 32,
                        height: 32,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </Tiptop>
                  {canManage ? (
                    <>
                      <Tiptop text={server.disabledForPrompts ? t('已从提示词上下文隐藏') : t('允许进入提示词上下文')}>
                        <button
                          type="button"
                          onClick={() => void onToggleServerDisabledForPrompts?.(server.name, server.source, !server.disabledForPrompts)}
                          style={{
                            width: 32,
                            height: 32,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'transparent',
                            color: server.disabledForPrompts ? 'var(--accent)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {server.disabledForPrompts ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </Tiptop>
                      <ToggleSwitch checked={!server.disabled} onChange={() => void onToggleServer?.(server.name, server.source, !server.disabled)} />
                      <button
                        type="button"
                        onClick={() => void onDeleteServer?.(server.name)}
                        style={{
                          width: 32,
                          height: 32,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 8,
                          border: '1px solid rgba(var(--danger-rgb), 0.28)',
                          background: 'rgba(var(--danger-rgb), 0.08)',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('超时时间(秒)')}</span>
                  {canManage ? (
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={String(timeoutValue)}
                      onChange={(event) => void onUpdateServerTimeout?.(server.name, server.source, parseInt(event.target.value || '0', 10) || 0)}
                      style={{
                        width: 92,
                        height: 32,
                        padding: '0 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-overlay)',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        outline: 'none',
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{String(timeoutValue)}</span>
                  )}
                </div>

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('工具列表')}</div>
                  {server.tools.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('暂无工具信息')}</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {server.tools.map((tool) => (
                        <div key={`${server.name}-${tool.name}`} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-overlay)', display: 'grid', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{tool.name}</span>
                            {tool.alwaysAllow ? (
                              <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(var(--success-rgb), 0.28)', background: 'rgba(var(--success-rgb), 0.08)', color: 'var(--success)', fontSize: 11, fontWeight: 700 }}>
                                {t('始终允许')}
                              </span>
                            ) : null}
                            {!tool.enabledForPrompt ? (
                              <span style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(var(--warning-rgb), 0.28)', background: 'rgba(var(--warning-rgb), 0.08)', color: 'var(--warning)', fontSize: 11, fontWeight: 700 }}>
                                {t('不进提示词')}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65, maxHeight: 120, overflowY: 'auto', overflowX: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 4 }}>
                            {tool.description || t('暂无说明')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {server.errorHistory && server.errorHistory.length > 0 ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('日志')}</div>
                    <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-overlay)', display: 'grid', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                      {[...server.errorHistory].slice().reverse().map((entry, index) => (
                        <div key={`${server.name}-${entry.timestamp}-${index}`} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}