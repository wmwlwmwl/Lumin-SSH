import { MessageSquare, User } from 'lucide-react'
import { useTranslation } from '../../../i18n.js'
import AIChatMessageActions from './AIChatMessageActions.jsx'

const assistantTitleKey = 'ai.assistant.title'

function UserMessageActionBar({ t, title, time, actions }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, fontSize: 11, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
      <AIChatMessageActions actions={actions} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        <span>{time}</span>
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{t(title)}</span>
        <User size={13} />
      </div>
    </div>
  )
}

function AssistantMessageActionBar({ t, title, time, actions, status }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, fontSize: 11, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
      <MessageSquare size={13} />
      <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{t(title)}</span>
      <span>{time}</span>
      <AIChatMessageActions actions={actions} />
      {status}
    </div>
  )
}

export default function AIChatMessageActionBar({ variant = 'assistant', title = assistantTitleKey, time = '', actions = [], status = null }) {
  const { t } = useTranslation()
  if (variant === 'user') {
    return <UserMessageActionBar t={t} title={title} time={time} actions={actions} />
  }
  return <AssistantMessageActionBar t={t} title={title} time={time} actions={actions} status={status} />
}