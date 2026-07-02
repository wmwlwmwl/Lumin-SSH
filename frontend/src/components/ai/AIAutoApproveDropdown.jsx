import { CheckCheck, Eye, SquarePen, Terminal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n.js'

const DEFAULT_AUTO_APPROVAL_SETTINGS = {
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowWrite: false,
  alwaysAllowExecute: false,
  alwaysAllowExecuteAllCommands: false,
  allowedCommands: [],
  deniedCommands: [],
}

const VISIBLE_OPTIONS = [
  { key: 'alwaysAllowReadOnly', labelKey: '读取', icon: Eye },
  { key: 'alwaysAllowWrite', labelKey: '写入', icon: SquarePen },
  { key: 'alwaysAllowExecute', labelKey: '执行', icon: Terminal },
]

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set()
  const normalized = []
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

function isAutoApprovalEffectivelyEnabled(settings) {
  return Boolean(
    settings?.alwaysAllowReadOnly
      || settings?.alwaysAllowWrite
      || settings?.alwaysAllowExecute,
  )
}

function normalizeAutoApprovalSettings(settings) {
  const allowedCommands = normalizeStringList(settings?.allowedCommands)
  const deniedCommands = normalizeStringList(settings?.deniedCommands)
  const normalized = {
    ...DEFAULT_AUTO_APPROVAL_SETTINGS,
    ...settings,
    alwaysAllowReadOnly: Boolean(settings?.alwaysAllowReadOnly),
    alwaysAllowWrite: Boolean(settings?.alwaysAllowWrite),
    alwaysAllowExecute: Boolean(settings?.alwaysAllowExecute),
    alwaysAllowExecuteAllCommands: allowedCommands.includes('*'),
    allowedCommands,
    deniedCommands,
  }
  normalized.autoApprovalEnabled = isAutoApprovalEffectivelyEnabled(normalized)
  return normalized
}

function buildTriggerLabel(t, settings, enabledCount) {
  if (!settings.autoApprovalEnabled) {
    return t('自动批准')
  }
  if (enabledCount === 0) {
    return `${t('自动批准')} 0`
  }
  if (enabledCount === VISIBLE_OPTIONS.length) {
    return `${t('自动批准')} ${t('全部')}`
  }
  return `${t('自动批准')} ${enabledCount}`
}

function OptionButton({ active, icon: Icon, label, onClick }) {
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

function CommandChip({ text, onRemove }) {
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

export default function AIAutoApproveDropdown({ settings, onPatchSettings, disabled = false }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [deniedCommandInput, setDeniedCommandInput] = useState('')
  const normalizedSettings = useMemo(() => normalizeAutoApprovalSettings(settings), [settings])
  const enabledCount = useMemo(
    () => VISIBLE_OPTIONS.filter((option) => normalizedSettings[option.key]).length,
    [normalizedSettings],
  )

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const patchSettings = async (patch) => {
    if (typeof onPatchSettings !== 'function') {
      return
    }
    const nextSettings = normalizeAutoApprovalSettings({
      ...normalizedSettings,
      ...patch,
    })
    await onPatchSettings({
      ...patch,
      autoApprovalEnabled: nextSettings.autoApprovalEnabled,
    })
  }

  const handleOptionToggle = async (key) => {
    await patchSettings({
      [key]: !normalizedSettings[key],
    })
  }

  const handleAddAllowedCommand = async () => {
    const nextValue = commandInput.trim()
    if (!nextValue || normalizedSettings.allowedCommands.includes(nextValue)) {
      return
    }
    await patchSettings({
      allowedCommands: [...normalizedSettings.allowedCommands, nextValue],
    })
    setCommandInput('')
  }

  const handleAddDeniedCommand = async () => {
    const nextValue = deniedCommandInput.trim()
    if (!nextValue || normalizedSettings.deniedCommands.includes(nextValue)) {
      return
    }
    await patchSettings({
      deniedCommands: [...normalizedSettings.deniedCommands, nextValue],
    })
    setDeniedCommandInput('')
  }

  const handleRemoveAllowedCommand = async (command) => {
    await patchSettings({
      allowedCommands: normalizedSettings.allowedCommands.filter((item) => item !== command),
    })
  }

  const handleRemoveDeniedCommand = async (command) => {
    await patchSettings({
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
      {open ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 8px)',
            width: 320,
            maxWidth: 'min(320px, calc(100vw - 32px))',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--surface-overlay)',
            boxShadow: 'var(--shadow-xl)',
            overflow: 'hidden',
            zIndex: 100,
          }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('自动批准')}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {t('当前阶段仅展示并生效读取,写入,执行.')}
            </div>
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 8 }}>
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
            <div style={{ padding: '0 12px 12px', display: 'grid', gap: 12 }}>
              <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-base)', display: 'grid', gap: 12 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>{t('执行')}</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>{t('命令白名单')}</div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
                    {t('当前启用时可以自动执行的命令前缀,添加 * 以允许所有命令.')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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