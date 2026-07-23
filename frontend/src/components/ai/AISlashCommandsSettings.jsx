import { Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation, t as translate } from '../../i18n.js'
import { normalizeAISlashCommands, normalizeSlashCommandName } from './aiSlashCommands.js'
import { handleInputDragSelectAll } from './inputDragSelect.js'

function buildDraftCommands(commands) {
  return normalizeAISlashCommands(commands).map((command, index) => ({
    id: `slash-${index}-${command.name}`,
    name: command.name,
    prompt: command.prompt,
  }))
}

function createUniqueSlashCommandName(commands) {
  const existingNames = new Set(
    commands
      .map((command) => normalizeSlashCommandName(command?.name).toLowerCase())
      .filter(Boolean),
  )
  let counter = 1
  let candidate = 'command'
  while (existingNames.has(candidate)) {
    candidate = `command-${counter}`
    counter += 1
  }
  return candidate
}

function normalizeDraftCommands(commands) {
  return normalizeAISlashCommands(
    (Array.isArray(commands) ? commands : []).map((command) => ({
      name: command?.name,
      prompt: command?.prompt,
    })),
  )
}

function summarizePrompt(prompt) {
  const normalized = String(prompt || '').trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return translate('未填写提示词内容')
  }
  return normalized.length > 90 ? `${normalized.slice(0, 90)}...` : normalized
}

function SlashCommandListItem({ command, onEdit, onDelete }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        padding: '14px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        minWidth: 0,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{command.name}</div>
        <div style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={onEdit}
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              border: '1px solid transparent',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}>
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              border: '1px solid transparent',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{summarizePrompt(command.prompt)}</div>
    </div>
  )
}

export default function AISlashCommandsSettings({ slashCommands, onSaveGlobalAISettings }) {
  const { t, lang } = useTranslation()
  const normalizedIncomingCommands = useMemo(() => normalizeAISlashCommands(slashCommands), [slashCommands])
  const sentenceEnd = lang === 'zh-CN' ? '。' : '.'
  const [draftCommands, setDraftCommands] = useState(() => buildDraftCommands(normalizedIncomingCommands))
  const [editingCommandId, setEditingCommandId] = useState('')

  useEffect(() => {
    const nextDraftCommands = buildDraftCommands(normalizedIncomingCommands)
    setDraftCommands(nextDraftCommands)
    setEditingCommandId((currentId) => {
      if (!nextDraftCommands.some((command) => command.id === currentId)) {
        return ''
      }
      return currentId
    })
  }, [normalizedIncomingCommands])

  const normalizedDraftCommands = useMemo(() => normalizeDraftCommands(draftCommands), [draftCommands])
  const hasPendingChanges = useMemo(
    () => JSON.stringify(normalizedDraftCommands) !== JSON.stringify(normalizedIncomingCommands),
    [normalizedDraftCommands, normalizedIncomingCommands],
  )
  const editingCommand = draftCommands.find((command) => command.id === editingCommandId) || null

  const handleAddCommand = () => {
    const nextCommand = {
      id: `slash-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: createUniqueSlashCommandName(draftCommands),
      prompt: '',
    }
    setDraftCommands((previous) => [...previous, nextCommand])
    setEditingCommandId(nextCommand.id)
  }

  const handleRemoveCommand = async (commandId) => {
    let nextDraftCommands = []
    setDraftCommands((previous) => {
      nextDraftCommands = previous.filter((command) => command.id !== commandId)
      return nextDraftCommands
    })
    setEditingCommandId((currentId) => (currentId === commandId ? '' : currentId))
    if (typeof onSaveGlobalAISettings !== 'function') {
      return
    }
    await onSaveGlobalAISettings({
      slashCommands: normalizeDraftCommands(nextDraftCommands),
    })
  }

  const handlePatchEditingCommand = (patch) => {
    if (!editingCommandId) {
      return
    }
    setDraftCommands((previous) => previous.map((command) => {
      if (command.id !== editingCommandId) {
        return command
      }
      return {
        ...command,
        ...patch,
      }
    }))
  }

  const handleSaveCommands = async () => {
    if (typeof onSaveGlobalAISettings !== 'function') {
      return
    }
    await onSaveGlobalAISettings({
      slashCommands: normalizeDraftCommands(draftCommands),
    })
    setEditingCommandId('')
  }

  return (
    <div style={{ display: 'grid', gap: 0 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('斜杠命令')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          {t('输入框与用户消息只显示')} <code>{t('斜杠命令占位符')}</code>{t('真正发送给 AI 时,会在后台注入命令完整提示词内容.')}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 0 }}>
        <button
          type="button"
          onClick={handleAddCommand}
          style={{
            width: '100%',
            height: 44,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface-base)',
            color: 'var(--text-primary)',
            fontSize: 15,
            fontWeight: 700,
          }}>
          <Plus size={16} />
          <span>{t('新增命令')}</span>
        </button>
        <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-base)', overflow: 'hidden' }}>
          {draftCommands.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1.7 }}>
              {t('当前还没有斜杠命令.新增后即可在输入框中通过')} <code>{t('斜杠命令占位符')}</code> {t('进行选择.')}
            </div>
          ) : (
            draftCommands.map((command) => (
              <SlashCommandListItem
                key={command.id}
                command={command}
                onEdit={() => setEditingCommandId(command.id)}
                onDelete={() => handleRemoveCommand(command.id)}
              />
            ))
          )}
        </div>
      </div>
      {editingCommand ? (
        <div style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr auto', gap: 12, minHeight: 420, padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-base)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {`${t('编辑')} /${normalizeSlashCommandName(editingCommand.name) || t('未命名命令')}`}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }} htmlFor="slash-command-name">{t('命令名')}</label>
            <input
              id="slash-command-name"
              type="text"
              value={editingCommand.name}
              onChange={(event) => handlePatchEditingCommand({ name: event.target.value })}
              onMouseLeave={handleInputDragSelectAll}
              placeholder={t('例如 summarize')}
              style={{
                width: '100%',
                height: 36,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface-overlay)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
              {t('仅允许字母,数字,点,下划线和中横线.输入时显示为')} <code>{t('斜杠命令占位符')}</code>{sentenceEnd}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6, minHeight: 0 }}>
            <label style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }} htmlFor="slash-command-prompt">{t('提示词内容')}</label>
            <textarea
              id="slash-command-prompt"
              value={editingCommand.prompt}
              onChange={(event) => handlePatchEditingCommand({ prompt: event.target.value })}
              placeholder={t('填写实际注入给 AI 的提示词内容')}
              style={{
                width: '100%',
                minHeight: 0,
                height: '100%',
                resize: 'none',
                padding: '12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface-overlay)',
                color: 'var(--text-primary)',
                fontSize: 13,
                lineHeight: 1.6,
                outline: 'none',
                whiteSpace: 'pre-wrap',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.5 }}>
              {t('保存时会忽略名称非法,名称重复或提示词为空的条目.')}
            </div>
            <button
              type="button"
              onClick={() => void handleSaveCommands()}
              disabled={!hasPendingChanges}
              style={{
                height: 36,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--accent-border)',
                background: hasPendingChanges ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--surface-overlay)',
                color: hasPendingChanges ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 13,
                fontWeight: 700,
                cursor: hasPendingChanges ? 'pointer' : 'not-allowed',
              }}>
              <Save size={14} />
              <span>{t('保存修改')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}