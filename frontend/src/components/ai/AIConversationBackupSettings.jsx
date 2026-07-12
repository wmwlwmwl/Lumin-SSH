import { ChevronLeft, History, MessagesSquare, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../i18n.js'
import { deleteAIConversationBackup, getAIConversationBackupHistory, listAIConversationBackups, restoreAIConversationBackup } from './aiConversationBackupBridge.js'
import AIChatMarkdown from './chat/AIChatMarkdown.jsx'

function formatRelativeTime(timestamp, language) {
  const diffMs = timestamp - Date.now()
  const absDiffMs = Math.abs(diffMs)
  const divisions = [
    { unit: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
    { unit: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
    { unit: 'week', ms: 1000 * 60 * 60 * 24 * 7 },
    { unit: 'day', ms: 1000 * 60 * 60 * 24 },
    { unit: 'hour', ms: 1000 * 60 * 60 },
    { unit: 'minute', ms: 1000 * 60 },
    { unit: 'second', ms: 1000 },
  ]
  for (const division of divisions) {
    if (absDiffMs >= division.ms || division.unit === 'second') {
      const value = Math.round(diffMs / division.ms)
      return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(value, division.unit)
    }
  }
  return ''
}

function formatDateTime(value, language) {
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) {
    return String(value || '')
  }
  return date.toLocaleString(language).replace(/\//g, '-')
}

function formatBackupIdTime(backupId, language) {
  const normalized = String(backupId || '').replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-\d+)?Z$/, '$1-$2-$3T$4:$5:$6Z')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    return String(backupId || '')
  }
  return formatDateTime(date.getTime(), language)
}

function getHistoryText(content) {
  if (typeof content === 'string' && content.trim()) {
    return content
  }
  if (Array.isArray(content)) {
    const parts = content
      .filter((block) => block?.type === 'text' && typeof block?.text === 'string')
      .map((block) => block.text.trim())
      .filter(Boolean)
    if (parts.length > 0) {
      return parts.join('\n\n')
    }
  }
  return ''
}

function ActionButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        minWidth: 0,
        height: 34,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '0 12px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: disabled ? 'var(--surface-hover)' : 'var(--surface-raised)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Icon size={14} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}

function ToggleSwitchControl({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.()}
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

export default function AIConversationBackupSettings({
  active,
  conversationId,
  conversationUpdatedAt = 0,
  requestInFlight = false,
  onRestoreSnapshot,
  autoBackupEnabled = true,
  onToggleAutoBackup,
}) {
  const { t, lang } = useTranslation()
  const [backups, setBackups] = useState([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState(null)
  const [historyEntries, setHistoryEntries] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const loadBackups = useCallback(async (options = {}) => {
    const background = options?.background === true
    if (!conversationId) {
      setBackups([])
      setIsLoaded(true)
      setIsRefreshing(false)
      return
    }
    if (!background) {
      setIsLoaded(false)
    } else {
      setIsRefreshing(true)
    }
    try {
      const items = await listAIConversationBackups(conversationId)
      setBackups(items)
    } finally {
      setIsLoaded(true)
      setIsRefreshing(false)
    }
  }, [conversationId])

  useEffect(() => {
    if (!active || !conversationId) {
      return
    }
    const timer = window.setTimeout(() => {
      void loadBackups({ background: isLoaded }).catch(() => {})
    }, 0)
    return () => window.clearTimeout(timer)
  }, [active, conversationId, conversationUpdatedAt, isLoaded, loadBackups])

  useEffect(() => {
    if (!active || !selectedBackup) {
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [active, selectedBackup])

  useEffect(() => {
    if (!conversationId) {
      setSelectedBackup(null)
      setHistoryEntries([])
      setHistoryLoading(false)
    }
  }, [conversationId])

  const relativeTimeMap = useMemo(
    () => new Map(backups.map((backup) => {
      void now
      return [backup.id, backup.ts > 0 ? formatRelativeTime(backup.ts, lang) : '']
    })),
    [backups, lang, now],
  )

  const handleOpenHistory = useCallback(async (backup) => {
    if (!conversationId || !backup?.id) {
      return
    }
    setSelectedBackup(backup)
    setHistoryLoading(true)
    const entries = await getAIConversationBackupHistory(conversationId, backup.id)
    setHistoryEntries(entries)
    setHistoryLoading(false)
  }, [conversationId])

  const handleRestore = useCallback(async (backupId) => {
    if (!conversationId || !backupId || requestInFlight) {
      return
    }
    const snapshot = await restoreAIConversationBackup(conversationId, backupId)
    if (snapshot) {
      await onRestoreSnapshot?.(snapshot)
      await loadBackups()
    }
  }, [conversationId, loadBackups, onRestoreSnapshot, requestInFlight])

  const handleDelete = useCallback(async (backupId) => {
    if (!conversationId || !backupId || requestInFlight) {
      return
    }
    await deleteAIConversationBackup(conversationId, backupId)
    if (selectedBackup?.id === backupId) {
      setSelectedBackup(null)
      setHistoryEntries([])
      setHistoryLoading(false)
    }
    await loadBackups()
  }, [conversationId, loadBackups, requestInFlight, selectedBackup?.id])

  if (!conversationId) {
    return null
  }

  const autoBackupControl = (
    <div style={{ background: 'var(--surface-base)', padding: 14, borderRadius: 12, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('自动备份对话')}</div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('关闭后不再创建新备份，已有备份仍可查看和恢复。')}</div>
      </div>
      <ToggleSwitchControl checked={autoBackupEnabled} onChange={onToggleAutoBackup} />
    </div>
  )

  if (selectedBackup) {
    const title = `${t('自动备份')} / ${formatBackupIdTime(selectedBackup.id, lang)}`
    return (
      <div style={{ display: 'grid', gap: 12, minHeight: 0 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('自动备份')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t('查看和恢复当前对话的自动备份记录。')}</div>
        </div>
        {autoBackupControl}
        <div style={{ display: 'grid', gap: 12, minHeight: 0 }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <button
              type="button"
              onClick={() => setSelectedBackup(null)}
              style={{
                width: 'fit-content',
                height: 30,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface-base)',
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <ChevronLeft size={14} />
              <span>{t('返回')}</span>
            </button>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{historyEntries.length} {t('消息')}</div>
          </div>
          <div style={{ display: 'grid', gap: 12, minHeight: 0 }}>
            {historyLoading ? (
              <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-base)', color: 'var(--text-tertiary)', fontSize: 13 }}>
                {t('加载中...')}
              </div>
            ) : historyEntries.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-base)', color: 'var(--text-tertiary)', fontSize: 13 }}>
                {t('暂无消息')}
              </div>
            ) : (
              historyEntries.map((entry, index) => {
                const role = entry.role === 'user' ? 'user' : 'assistant'
                const markdown = getHistoryText(entry.content)
                return (
                  <div
                    key={`${entry.messageId || index}-${index}`}
                    style={{
                      width: '100%',
                      minWidth: 0,
                      display: 'grid',
                      gap: 10,
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: `1px solid ${role === 'user' ? 'rgba(var(--accent-rgb), 0.35)' : 'var(--border)'}`,
                      background: role === 'user' ? 'rgba(var(--accent-rgb), 0.10)' : 'var(--surface-base)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          minHeight: 22,
                          padding: '0 8px',
                          borderRadius: 999,
                          background: 'var(--surface-raised)',
                          color: 'var(--text-primary)',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {role === 'user' ? t('用户') : t('助手')}
                      </span>
                      {entry.ts > 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                          {formatDateTime(entry.ts, lang)}
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        maxHeight: '20vh',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'rgba(255, 255, 255, 0.03)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        lineHeight: 1.6,
                      }}
                    >
                      <AIChatMarkdown text={markdown || t('暂无消息')} />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12, minHeight: 0 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('自动备份')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t('查看和恢复当前对话的自动备份记录。')}</div>
      </div>
      {autoBackupControl}
      <div style={{ display: 'grid', gap: 12, minHeight: 0 }}>
        {!isLoaded && backups.length === 0 ? (
          <div
            style={{
              minHeight: 160,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface-base)',
              color: 'var(--text-tertiary)',
              fontSize: 13,
            }}
          >
            <History size={18} />
            <span>{isRefreshing ? t('刷新中...') : t('加载备份列表中...')}</span>
          </div>
        ) : backups.length === 0 ? (
          <div
            style={{
              minHeight: 160,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface-base)',
              color: 'var(--text-tertiary)',
              fontSize: 13,
            }}
          >
            <History size={22} style={{ opacity: 0.35 }} />
            <span>{t('暂无自动备份')}</span>
          </div>
        ) : (
          backups.map((backup) => (
            <div
              key={backup.id}
              style={{
                padding: 14,
                borderRadius: 12,
                background: 'var(--surface-base)',
                border: '1px solid var(--border)',
                display: 'grid',
                gap: 12,
              }}
            >
              <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      minHeight: 22,
                      padding: '0 8px',
                      borderRadius: 999,
                      background: 'var(--surface-raised)',
                      color: 'var(--text-primary)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {backup.messageRole === 'user' ? t('用户') : t('助手')}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                    {backup.ts > 0 ? formatDateTime(backup.ts, lang) : formatBackupIdTime(backup.id, lang)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {relativeTimeMap.get(backup.id)}
                  </span>
                </div>
                <div
                  style={{
                    maxHeight: 176,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--surface-overlay)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  <AIChatMarkdown text={backup.message || t('暂无消息')} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionButton icon={RotateCcw} label={t('恢复')} onClick={() => void handleRestore(backup.id)} disabled={requestInFlight} />
                <ActionButton icon={Trash2} label={t('删除')} onClick={() => void handleDelete(backup.id)} disabled={requestInFlight} />
                <ActionButton icon={MessagesSquare} label={t('对话历史')} onClick={() => void handleOpenHistory(backup)} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}