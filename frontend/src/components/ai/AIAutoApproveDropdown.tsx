import { CheckCheck, Eye, SquarePen, Terminal, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation, type I18nKey } from '../../i18n.ts'

type ExecuteApprovalMode = 'basic' | 'read_only' | 'all'

export interface AutoApprovalSettings {
  autoApprovalEnabled: boolean
  alwaysAllowReadOnly: boolean
  alwaysAllowWrite: boolean
  alwaysAllowExecute: boolean
  executeApprovalMode: ExecuteApprovalMode
  allowedCommands: string[]
  deniedCommands: string[]
}

const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowWrite: false,
  alwaysAllowExecute: false,
  executeApprovalMode: 'basic',
  allowedCommands: [],
  deniedCommands: [],
}

const VISIBLE_OPTIONS: Array<{ key: 'alwaysAllowReadOnly' | 'alwaysAllowWrite' | 'alwaysAllowExecute'; labelKey: I18nKey; icon: LucideIcon }> = [
  { key: 'alwaysAllowReadOnly', labelKey: '读取', icon: Eye },
  { key: 'alwaysAllowWrite', labelKey: '写入', icon: SquarePen },
  { key: 'alwaysAllowExecute', labelKey: '执行', icon: Terminal },
]

const EXECUTE_APPROVAL_MODE_OPTIONS: Array<{ value: ExecuteApprovalMode; labelKey: I18nKey }> = [
  { value: 'basic', labelKey: '基本规则' },
  { value: 'read_only', labelKey: '只读批准' },
  { value: 'all', labelKey: '全部批准' },
]

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set<string>()
  const normalized: string[] = []
  values.forEach((value) => {
    if (typeof value !== 'string') {
      return
    }
    const nextValue = value.trim()
    if (!nextValue || seen.has(nextValue)) {
      return
    }
    seen.add(nextValue)
    normalized.push(nextValue)
  })
  return normalized
}

function normalizeExecuteApprovalMode(value: unknown): ExecuteApprovalMode {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized === 'read_only') {
    return 'read_only'
  }
  if (normalized === 'all') {
    return 'all'
  }
  return 'basic'
}

function isAutoApprovalEffectivelyEnabled(settings: AutoApprovalSettings) {
  return Boolean(
    settings?.alwaysAllowReadOnly
      || settings?.alwaysAllowWrite
      || settings?.alwaysAllowExecute,
  )
}

function normalizeAutoApprovalSettings(settings: unknown): AutoApprovalSettings {
  const raw = settings as Partial<AutoApprovalSettings> | null | undefined
  const allowedCommands = normalizeStringList(raw?.allowedCommands)
  const deniedCommands = normalizeStringList(raw?.deniedCommands)
  const normalized: AutoApprovalSettings = {
    ...DEFAULT_AUTO_APPROVAL_SETTINGS,
    ...raw,
    alwaysAllowReadOnly: Boolean(raw?.alwaysAllowReadOnly),
    alwaysAllowWrite: Boolean(raw?.alwaysAllowWrite),
    alwaysAllowExecute: Boolean(raw?.alwaysAllowExecute),
    executeApprovalMode: normalizeExecuteApprovalMode(raw?.executeApprovalMode),
    allowedCommands,
    deniedCommands,
  }
  normalized.autoApprovalEnabled = isAutoApprovalEffectivelyEnabled(normalized)
  return normalized
}

function buildTriggerLabel(t: (key: I18nKey, vars?: Record<string, unknown>) => string, settings: AutoApprovalSettings, enabledCount: number) {
  if (!settings.autoApprovalEnabled) {
    return t('自动批准')
  }
  if (enabledCount === 0) {
    return `${t('自动批准')} 0`
  }
  const approvalCount = enabledCount + (settings.alwaysAllowExecute && settings.executeApprovalMode === 'all' ? 1 : 0)
  return `${t('自动批准')} ${approvalCount}`
}
interface OptionButtonProps {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}

function OptionButton({ active, icon: Icon, label, onClick }: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '0 10px',
        borderRadius: 8,
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
        background: active ? 'rgba(var(--accent-rgb), 0.14)' : 'var(--surface-base)',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        transition: 'var(--transition)',
      }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Icon size={13} />
        <span>{label}</span>
      </span>
      {active ? <CheckCheck size={13} color="var(--accent)" /> : null}
    </button>
  )
}

interface CommandChipProps {
  text: string
  onRemove: () => void
}

function CommandChip({ text, onRemove }: CommandChipProps) {
  return (
    <button
      type="button"
      onClick={onRemove}
      style={{
        minHeight: 30,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--surface-base)',
        color: 'var(--text-primary)',
        fontSize: 12,
        transition: 'var(--transition)',
      }}>
      <span>{text}</span>
      <X size={12} />
    </button>
  )
}


export interface AIAutoApproveDropdownProps {
  settings?: unknown
  onPatchSettings?: (settings: Partial<AutoApprovalSettings>) => Promise<unknown> | void
  disabled?: boolean
  dismissSignal?: number
}

export default function AIAutoApproveDropdown({ settings, onPatchSettings, disabled = false, dismissSignal = 0 }: AIAutoApproveDropdownProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const patchTimerRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [expandLeft, setExpandLeft] = useState(false)
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)
  const [panelBounds, setPanelBounds] = useState<{ left: number; width: number } | null>(null)
  const [commandInput, setCommandInput] = useState('')
  const [deniedCommandInput, setDeniedCommandInput] = useState('')
  const [localSettings, setLocalSettings] = useState<AutoApprovalSettings>(() => normalizeAutoApprovalSettings(settings))
  const normalizedSettings = useMemo(() => normalizeAutoApprovalSettings(localSettings), [localSettings])
  const enabledCount = useMemo(
    () => VISIBLE_OPTIONS.filter((option) => normalizedSettings[option.key]).length,
    [normalizedSettings],
  )

  useEffect(() => {
    if (!open) {
      setTriggerRect(null)
      setPanelBounds(null)
      return undefined
    }
    const measure = () => {
      const el = containerRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        const root = el.closest('[data-ai-panel-root="true"]')
        const rootRect = root?.getBoundingClientRect()
        setExpandLeft(rect.left + 320 > window.innerWidth - 16)
        setTriggerRect(rect)
        if (rootRect && rootRect.width > 0) {
          setPanelBounds({
            left: rootRect.left,
            width: rootRect.width,
          })
        } else {
          setPanelBounds(null)
        }
      }
    }
    measure()
    const handleResize = () => measure()
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
    }
  }, [open])

  useEffect(() => {
    setOpen(false)
    setExpandLeft(false)
    setTriggerRect(null)
    setPanelBounds(null)
  }, [dismissSignal])

  useEffect(() => {
    setLocalSettings(normalizeAutoApprovalSettings(settings))
  }, [settings])

  useEffect(() => () => {
    if (patchTimerRef.current) {
      window.clearTimeout(patchTimerRef.current)
    }
  }, [])

  const persistSettings = async (nextSettings: AutoApprovalSettings) => {
    if (typeof onPatchSettings !== 'function') {
      return
    }
    await onPatchSettings({
      alwaysAllowReadOnly: nextSettings.alwaysAllowReadOnly,
      alwaysAllowWrite: nextSettings.alwaysAllowWrite,
      alwaysAllowExecute: nextSettings.alwaysAllowExecute,
      executeApprovalMode: nextSettings.executeApprovalMode,
      allowedCommands: nextSettings.allowedCommands,
      deniedCommands: nextSettings.deniedCommands,
      autoApprovalEnabled: nextSettings.autoApprovalEnabled,
    })
  }

  const schedulePersist = (nextSettings: AutoApprovalSettings) => {
    if (patchTimerRef.current) {
      window.clearTimeout(patchTimerRef.current)
    }
    patchTimerRef.current = window.setTimeout(() => {
      patchTimerRef.current = 0
      void persistSettings(nextSettings)
    }, 180)
  }

  const patchSettings = (patch: Partial<AutoApprovalSettings>) => {
    setLocalSettings((previous) => {
      const nextSettings = normalizeAutoApprovalSettings({
        ...previous,
        ...patch,
      })
      schedulePersist(nextSettings)
      return nextSettings
    })
  }

  const handleOptionToggle = (key: keyof AutoApprovalSettings) => {
    if (key === 'alwaysAllowExecute') {
      patchSettings({
        alwaysAllowExecute: !normalizedSettings.alwaysAllowExecute,
      })
      return
    }
    patchSettings({
      [key]: !normalizedSettings[key],
    } as Partial<AutoApprovalSettings>)
  }

  const handleExecuteApprovalModeChange = (executeApprovalMode: ExecuteApprovalMode) => {
    if (normalizedSettings.executeApprovalMode === executeApprovalMode) {
      return
    }
    patchSettings({ executeApprovalMode })
  }

  const handleAddAllowedCommand = () => {
    const nextValue = commandInput.trim()
    if (!nextValue || nextValue === '*' || normalizedSettings.allowedCommands.includes(nextValue)) {
      return
    }
    patchSettings({
      allowedCommands: [...normalizedSettings.allowedCommands, nextValue],
    })
    setCommandInput('')
  }

  const handleAddDeniedCommand = () => {
    const nextValue = deniedCommandInput.trim()
    if (!nextValue || nextValue === '*' || normalizedSettings.deniedCommands.includes(nextValue)) {
      return
    }
    patchSettings({
      deniedCommands: [...normalizedSettings.deniedCommands, nextValue],
    })
    setDeniedCommandInput('')
  }

  const handleRemoveAllowedCommand = (command: string) => {
    patchSettings({
      allowedCommands: normalizedSettings.allowedCommands.filter((item) => item !== command),
    })
  }

  const handleRemoveDeniedCommand = (command: string) => {
    patchSettings({
      deniedCommands: normalizedSettings.deniedCommands.filter((item) => item !== command),
    })
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0, overflow: 'visible', zIndex: open ? 40 : 'auto' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          borderRadius: 8,
          border: `1px solid ${open ? 'var(--accent-border)' : 'var(--border)'}`,
          background: open ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
          color: normalizedSettings.autoApprovalEnabled ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 12,
          fontWeight: 500,
          transition: 'var(--transition)',
          whiteSpace: 'nowrap',
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        {normalizedSettings.autoApprovalEnabled ? <CheckCheck size={12} /> : <X size={12} />}
        <span>{buildTriggerLabel(t, normalizedSettings, enabledCount)}</span>
      </button>
      {open && triggerRect ? (
        <div
          style={{
            position: 'fixed',
            ...(panelBounds
              ? { left: panelBounds.left }
              : expandLeft
                ? { right: window.innerWidth - triggerRect.right }
                : { left: triggerRect.left }),
            bottom: window.innerHeight - triggerRect.top + 8,
            width: panelBounds?.width ?? 320,
            maxWidth: panelBounds?.width ? `${panelBounds.width}px` : 'min(320px, calc(100vw - 32px))',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface-overlay)',
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden',
            overflowX: 'hidden',
            boxSizing: 'border-box',
            zIndex: 10000,
          }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('自动批准')}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {t('当前阶段仅展示并生效读取,写入,执行.')}
            </div>
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 8, overflowX: 'hidden' }}>
            {VISIBLE_OPTIONS.map((option) => (
              <OptionButton
                key={option.key}
                active={normalizedSettings[option.key]}
                icon={option.icon}
                label={t(option.labelKey)}
                onClick={() => void handleOptionToggle(option.key)}
              />
            ))}
          </div>
          {normalizedSettings.alwaysAllowExecute ? (
            <div style={{ padding: '0 12px 12px', display: 'grid', gap: 12, overflowX: 'hidden' }}>
              <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-base)', display: 'grid', gap: 12, overflowX: 'hidden' }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>{t('执行')}</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>{t('执行规则')}</div>
                  <div role="group" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-sunken)' }}>
                    {EXECUTE_APPROVAL_MODE_OPTIONS.map((option, index) => {
                      const active = normalizedSettings.executeApprovalMode === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleExecuteApprovalModeChange(option.value)}
                          style={{
                            minWidth: 0,
                            height: 30,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 6px',
                            border: 'none',
                            borderLeft: index === 0 ? 'none' : '1px solid var(--border)',
                            background: active ? 'var(--accent)' : 'transparent',
                            color: active ? '#fff' : 'var(--text-secondary)',
                            fontSize: 12,
                            fontWeight: active ? 600 : 500,
                            transition: 'var(--transition)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                          {t(option.labelKey)}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
                    {t('基本规则按命令白名单执行,只读批准保留变更命令白名单,全部批准自动放行全部命令.')}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>{t('命令白名单')}</div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
                    {t('当前启用时可以自动执行的命令前缀.')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <input
                      id="ai-auto-approve-allowed"
                      name="ai-auto-approve-allowed"
                      autoComplete="off"
                      value={commandInput}
                      onChange={(event) => setCommandInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleAddAllowedCommand()
                        }
                      }}
                      placeholder={t("输入命令前缀(例如 'git')")}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 34,
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-sunken)',
                        color: 'var(--text-primary)',
                        padding: '0 10px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        fontSize: 12,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddAllowedCommand()}
                      style={{
                        height: 34,
                        padding: '0 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-base)',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        fontWeight: 600,
                        transition: 'var(--transition)',
                      }}>
                      {t('添加')}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                    {normalizedSettings.allowedCommands.map((command) => (
                      <CommandChip key={command} text={command} onRemove={() => void handleRemoveAllowedCommand(command)} />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>{t('拒绝的命令')}</div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
                    {t('将自动拒绝的命令前缀,无需用户批准;与许可命令冲突时,最长前缀匹配优先.')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <input
                      id="ai-auto-approve-denied"
                      name="ai-auto-approve-denied"
                      autoComplete="off"
                      value={deniedCommandInput}
                      onChange={(event) => setDeniedCommandInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void handleAddDeniedCommand()
                        }
                      }}
                      placeholder={t("输入要拒绝的命令前缀(例如 'rm -rf')")}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 34,
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-sunken)',
                        color: 'var(--text-primary)',
                        padding: '0 10px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        fontSize: 12,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddDeniedCommand()}
                      style={{
                        height: 34,
                        padding: '0 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-base)',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        fontWeight: 600,
                        transition: 'var(--transition)',
                      }}>
                      {t('添加')}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                    {normalizedSettings.deniedCommands.map((command) => (
                      <CommandChip key={command} text={command} onRemove={() => void handleRemoveDeniedCommand(command)} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}