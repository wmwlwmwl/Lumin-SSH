import { RotateCcw, Save, Trash2, Eye, EyeOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../i18n.ts'
import Tiptop from '../Tiptop.tsx'
import { handleInputDragSelectAll } from './inputDragSelect.ts'

const defaultConfigText = '{\n  "mcpServers": {}\n}'

interface ToggleSwitchProps {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}

function ToggleSwitch({ checked, onChange, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
      className={`w-[42px] h-6 rounded-full border border-line p-0.5 flex items-center transition-colors duration-100 shrink-0 ${checked ? 'justify-end' : 'justify-start'} ${
        disabled ? 'bg-hover opacity-60 cursor-not-allowed' : (checked ? 'bg-success cursor-pointer' : 'bg-hover cursor-pointer')
      }`}
    >
      <span className="w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]" />
    </button>
  )
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return ''
}

/** MCP 服务器条目（来自 .tsx 父级，字段按需取用） */
interface MCPManagedServer {
  source: string
  name: string
  status?: string
  error?: string
  instructions?: string
  disabled?: boolean
  disabledForPrompts?: boolean
  timeout?: unknown
  tools: Array<{ name: string; alwaysAllow?: boolean; enabledForPrompt?: boolean; description?: string }>
  errorHistory?: Array<{ timestamp?: unknown; message: string }>
}

interface MCPServersViewProps {
  servers?: MCPManagedServer[]
  globalConfigPath?: string
  globalConfigText?: string
  onSaveServer?: (name: string, configText: string) => Promise<unknown>
  onReloadServers?: () => Promise<unknown>
  onDeleteServer?: (name: string) => Promise<unknown>
  onRestartServer?: (name: string, source: string) => Promise<unknown>
  onToggleServer?: (name: string, source: string, enabled: boolean) => Promise<unknown>
  onToggleServerDisabledForPrompts?: (name: string, source: string, disabled: boolean) => Promise<unknown>
  onUpdateServerTimeout?: (name: string, source: string, timeout: number) => Promise<unknown>
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
}: MCPServersViewProps) {
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
    <div className="grid gap-3.5">
      <div className="grid gap-1">
        <div className="text-[18px] font-bold text-primary leading-[1.3]">{t('MCP服务器')}</div>
        <div className="text-sm text-tertiary leading-[1.6]">{t('这里直接配置完整的 MCP Json 文件；内置服务器只读，外置服务器可通过下方完整配置统一维护。')}</div>
        {globalConfigPath ? (
          <div className="text-xs text-muted leading-[1.5] break-all">
            {t('外置配置文件')}: <span className="font-mono">{globalConfigPath}</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 p-3.5 rounded-xl bg-canvas border border-line">
        <div className="text-primary text-base font-bold">{t('完整MCP Json配置')}</div>
        <textarea
          id="mcp-servers-config"
          name="mcp-servers-config"
          value={configText}
          onChange={(event) => {
            setConfigText(event.target.value)
            if (errorText) {
              setErrorText('')
            }
          }}
          rows={14}
          spellCheck={false}
          className={`w-full resize-y min-h-[260px] p-3 rounded-lg bg-overlay text-primary text-sm leading-[1.65] font-mono outline-none whitespace-pre ${errorText ? 'border border-[rgba(var(--danger-rgb),0.38)]' : 'border border-line'}`}
        />
        {errorText ? (
          <div className="py-2.5 px-3 rounded-lg border border-[rgba(var(--danger-rgb),0.28)] bg-[rgba(var(--danger-rgb),0.08)] text-danger text-sm leading-[1.65] whitespace-pre-wrap break-words">
            <span className="font-bold">{t('错误')}：</span>
            <span>{errorText}</span>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void handleReload()}
            disabled={saving || reloading}
            className={`h-9 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-lg border border-line bg-transparent text-secondary text-base font-bold transition-colors duration-100 ${
              saving || reloading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
            }`}
          >
            <RotateCcw size={14} />
            <span>{reloading ? t('刷新中...') : t('刷新')}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || reloading}
            className={`h-9 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-lg border border-accent-border bg-[rgba(var(--accent-rgb),0.12)] text-accent text-base font-bold transition-colors duration-100 ${
              saving || reloading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
            }`}
          >
            <Save size={14} />
            <span>{saving ? t('保存中...') : t('保存MCP Json配置')}</span>
          </button>
        </div>
      </div>

      <div className="grid gap-2.5">
        {sortedServers.length === 0 ? (
          <div className="p-4 rounded-xl border border-line bg-canvas text-tertiary text-base leading-[1.7]">
            {t('当前还没有可用的 MCP 服务器。')}
          </div>
        ) : sortedServers.map((server) => {
          const isEmbedded = server.source === 'embedded'
          const canManage = server.source === 'global'
          const timeoutValue = Number.isFinite(Number(server.timeout)) ? Number(server.timeout) : 0
          return (
            <div key={`${server.source}-${server.name}`} className="p-3.5 rounded-xl border border-line bg-canvas grid gap-3">
              <div className="flex justify-between gap-3 items-start flex-wrap">
                <div className="min-w-0 grid gap-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-primary text-md font-bold">{server.name}</span>
                    <span className={`px-2 py-0.5 rounded-full border border-line text-xs font-bold ${isEmbedded ? 'bg-[rgba(var(--success-rgb),0.08)] text-success' : 'bg-[rgba(var(--accent-rgb),0.08)] text-accent'}`}>
                      {isEmbedded ? t('内置') : t('外置')}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full border border-line text-xs font-bold ${
                      server.status === 'connected'
                        ? 'bg-[rgba(var(--success-rgb),0.08)] text-success'
                        : (server.status === 'connecting'
                          ? 'bg-[rgba(var(--warning-rgb),0.08)] text-warning'
                          : 'bg-[rgba(var(--danger-rgb),0.08)] text-danger')
                    }`}>
                      {t(server.status === 'connected' ? '已连接' : (server.status === 'connecting' ? '连接中...' : '已断开'))}
                    </span>
                  </div>
                  <div className="text-sm text-tertiary leading-[1.6] max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words pr-1">
                    {server.error ? server.error : server.instructions || t('暂无说明')}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Tiptop text={t('重启MCP服务器')}>
                    <button
                      type="button"
                      onClick={() => void onRestartServer?.(server.name, server.source)}
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-line bg-transparent text-secondary cursor-pointer"
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
                          className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border border-line bg-transparent cursor-pointer ${server.disabledForPrompts ? 'text-accent' : 'text-secondary'}`}
                        >
                          {server.disabledForPrompts ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </Tiptop>
                      <ToggleSwitch checked={!server.disabled} onChange={() => void onToggleServer?.(server.name, server.source, !server.disabled)} />
                      <button
                        type="button"
                        onClick={() => void onDeleteServer?.(server.name)}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[rgba(var(--danger-rgb),0.28)] bg-[rgba(var(--danger-rgb),0.08)] text-danger cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-sm font-bold text-primary">{t('超时时间(秒)')}</span>
                  {canManage ? (
                    <input
                      id="mcp-servers-timeout"
                      name="mcp-servers-timeout"
                      autoComplete="off"
                      type="number"
                      min={0}
                      max={3600}
                      value={String(timeoutValue)}
                      onChange={(event) => void onUpdateServerTimeout?.(server.name, server.source, parseInt(event.target.value || '0', 10) || 0)}
                      onMouseLeave={handleInputDragSelectAll}
                      className="w-[92px] h-8 px-2.5 rounded-lg border border-line bg-overlay text-primary text-sm outline-none"
                    />
                  ) : (
                    <span className="text-sm text-secondary font-mono">{String(timeoutValue)}</span>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <div className="text-sm font-bold text-primary">{t('工具列表')}</div>
                  {server.tools.length === 0 ? (
                    <div className="text-sm text-tertiary">{t('暂无工具信息')}</div>
                  ) : (
                    <div className="grid gap-1.5">
                      {server.tools.map((tool) => (
                        <div key={`${server.name}-${tool.name}`} className="px-3 py-2.5 rounded-lg border border-line-subtle bg-overlay grid gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-primary font-mono">{tool.name}</span>
                            {tool.alwaysAllow ? (
                              <span className="px-2 py-0.5 rounded-full border border-[rgba(var(--success-rgb),0.28)] bg-[rgba(var(--success-rgb),0.08)] text-success text-xs font-bold">
                                {t('始终允许')}
                              </span>
                            ) : null}
                            {!tool.enabledForPrompt ? (
                              <span className="px-2 py-0.5 rounded-full border border-[rgba(var(--warning-rgb),0.28)] bg-[rgba(var(--warning-rgb),0.08)] text-warning text-xs font-bold">
                                {t('不进提示词')}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-sm text-secondary leading-[1.65] max-h-[120px] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words pr-1">
                            {tool.description || t('暂无说明')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {server.errorHistory && server.errorHistory.length > 0 ? (
                  <div className="grid gap-1.5">
                    <div className="text-sm font-bold text-primary">{t('日志')}</div>
                    <div className="px-3 py-2.5 rounded-lg border border-line-subtle bg-overlay grid gap-1.5 max-h-[180px] overflow-y-auto">
                      {[...server.errorHistory].slice().reverse().map((entry, index) => (
                        <div key={`${server.name}-${entry.timestamp}-${index}`} className="text-sm text-secondary leading-[1.65] whitespace-pre-wrap break-words">
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
