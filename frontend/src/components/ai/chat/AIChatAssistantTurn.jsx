import { MessageSquare } from 'lucide-react'
import { useTranslation } from '../../../i18n.js'
import AIChatMessageActions from './AIChatMessageActions.jsx'
import AIChatAssistantBodyPane from './AIChatAssistantBodyPane.jsx'
import AIChatErrorBlock from './AIChatErrorBlock.jsx'
import AIChatReasoningBlock from './AIChatReasoningBlock.jsx'
import AIChatRequestStatusRow from './AIChatRequestStatusRow.jsx'
import AIChatToolSessionPane from './AIChatToolSessionPane.jsx'

export default function AIChatAssistantTurn({ assistant, reasoning = [], tools = [], isLastAssistantTurn = false, hasSubsequentAssistantMessage = false, onDelete, onRetry }) {
  const { t } = useTranslation()
  const title = assistant?.title || 'Ai助手'
  const time = assistant?.time || ''
  const assistantText = typeof assistant?.text === 'string' ? assistant.text.trim() : ''
  const assistantId = typeof assistant?.id === 'string' ? assistant.id : ''
  const hasReasoning = reasoning.length > 0
  const hasBody = Boolean(assistantText)
  const assistantErrorText = typeof assistant?.extra?.errorText === 'string' ? assistant.extra.errorText.trim() : ''
  const hasError = Boolean(assistantErrorText)
  const hasTools = tools.length > 0
  const hasSectionBeforeReasoning = hasError
  const hasSectionBeforeBody = hasError || hasReasoning
  const hasSectionBeforeTools = hasError || hasReasoning || hasBody

  return (
    <div style={{ display: 'grid', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, fontSize: 11, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
        <MessageSquare size={13} />
        <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{t(title)}</span>
        <span>{time}</span>
        <AIChatMessageActions actions={[
          { key: 'retry', onClick: () => onRetry?.(assistantId) },
          { key: 'delete', onClick: () => onDelete?.(assistantId) },
        ]} />
        <AIChatRequestStatusRow assistant={assistant} reasoning={reasoning} />
      </div>
      <div style={{ width: '100%', display: 'grid', gap: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-overlay)', border: '1px solid var(--border)', boxShadow: 'inset 0 1px 0 var(--border-light)' }}>
        {hasError ? <AIChatErrorBlock text={assistantErrorText} /> : null}
        {hasReasoning ? (
          <div
            style={{
              display: 'grid',
              gap: 8,
              paddingTop: hasSectionBeforeReasoning ? 10 : 0,
              borderTop: hasSectionBeforeReasoning ? '1px solid var(--border-subtle)' : 'none',
              paddingBottom: hasBody || hasTools ? 10 : 0,
              borderBottom: hasBody || hasTools ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            {reasoning.map((item, index) => (
              <AIChatReasoningBlock
                key={item.id}
                text={item.text}
                duration={item.duration}
                isStreaming={Boolean(assistant?.streaming) && index === reasoning.length - 1}
                isLast={isLastAssistantTurn && index === reasoning.length - 1}
              />
            ))}
          </div>
        ) : null}
        {hasBody ? (
          <div style={{ paddingTop: hasSectionBeforeBody && !hasReasoning ? 10 : 0, borderTop: hasSectionBeforeBody && !hasReasoning ? '1px solid var(--border-subtle)' : 'none' }}>
            <AIChatAssistantBodyPane text={assistantText} />
          </div>
        ) : null}
        {hasTools ? (
          <div style={{ paddingTop: hasSectionBeforeTools ? 10 : 0, borderTop: hasSectionBeforeTools ? '1px solid var(--border-subtle)' : 'none' }}>
            <AIChatToolSessionPane items={tools} isLastAssistantTurn={isLastAssistantTurn} hasSubsequentAssistantMessage={hasSubsequentAssistantMessage} />
          </div>
        ) : null}
      </div>
    </div>
  )
}