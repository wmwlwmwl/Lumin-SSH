import AIChatMessageActionBar from './AIChatMessageActionBar.jsx'
import AIChatAssistantBodyPane from './AIChatAssistantBodyPane.jsx'
import AIChatErrorBlock from './AIChatErrorBlock.jsx'
import AIChatReasoningBlock from './AIChatReasoningBlock.jsx'
import AIChatRequestStatusRow from './AIChatRequestStatusRow.jsx'
import AIChatToolSessionPane from './AIChatToolSessionPane.jsx'

const assistantTitleKey = 'Ai助手'

export default function AIChatAssistantTurn({ assistant, reasoning = [], tools = [], isLastAssistantTurn = false, hasSubsequentAssistantMessage = false, onDelete, onRetry, onSendUserMessage, onPreviewRestore, onApplyRestore, messageActionBarAtBottom = false }) {
  const title = assistant?.title || assistantTitleKey
  const time = assistant?.time || ''
  const assistantText = typeof assistant?.text === 'string' ? assistant.text.trim() : ''
  const assistantId = typeof assistant?.id === 'string' ? assistant.id : ''
  const hasReasoning = reasoning.length > 0
  const hasBody = Boolean(assistantText)
  const assistantErrorText = typeof assistant?.extra?.errorText === 'string' ? assistant.extra.errorText.trim() : ''
  const hasError = Boolean(assistantErrorText)
  const hasTools = tools.length > 0
  const completionItem = tools.find((item) => item?.kind === 'completion') || null
  const completionSummary = typeof completionItem?.summary === 'string' ? completionItem.summary.trim() : ''
  const completionResult = typeof completionItem?.result === 'string' ? completionItem.result.trim() : ''
  const completionCopyText = [completionSummary, completionResult].filter(Boolean).join('\n\n')
  const hasSectionBeforeReasoning = hasError
  const hasSectionBeforeBody = hasError || hasReasoning
  const hasSectionBeforeTools = hasError || hasReasoning || hasBody
  const hasSectionBeforeActionBar = hasError || hasReasoning || hasBody || hasTools
  const handleCopyText = () => {
    const nextText = completionCopyText || assistantText
    if (!nextText) {
      return
    }
    navigator.clipboard.writeText(nextText).catch(() => {})
  }
  const messageActions = [
    { key: 'retry', onClick: () => onRetry?.(assistantId) },
    { key: 'copy', onClick: handleCopyText },
    { key: 'delete', onClick: () => onDelete?.(assistantId) },
  ]

  const renderActionBar = (showStatus) => (
    <AIChatMessageActionBar
      variant="assistant"
      title={title}
      time={time}
      actions={messageActions}
      status={showStatus ? <AIChatRequestStatusRow assistant={assistant} reasoning={reasoning} /> : null}
    />
  )

  return (
    <div style={{ display: 'grid', gap: messageActionBarAtBottom ? 0 : 6, width: '100%' }}>
      <div style={{ display: messageActionBarAtBottom ? 'none' : 'block' }}>
        {renderActionBar(true)}
      </div>
      <div style={{ width: '100%', display: 'grid', gap: 0, padding: messageActionBarAtBottom ? '10px 12px 0' : '10px 12px', borderRadius: 12, background: 'var(--surface-overlay)', border: '1px solid var(--border)', boxShadow: 'inset 0 1px 0 var(--border-light)' }}>
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
            <AIChatToolSessionPane items={tools} isLastAssistantTurn={isLastAssistantTurn} hasSubsequentAssistantMessage={hasSubsequentAssistantMessage} onSendUserMessage={onSendUserMessage} onPreviewRestore={onPreviewRestore} onApplyRestore={onApplyRestore} />
          </div>
        ) : null}
        <div style={{ display: messageActionBarAtBottom ? 'block' : 'none', padding: messageActionBarAtBottom ? '0 12px' : 0, margin: messageActionBarAtBottom ? '0 -12px' : 0, borderTop: hasSectionBeforeActionBar ? '1px solid var(--border-subtle)' : 'none' }}>
          {renderActionBar(true)}
        </div>
      </div>
    </div>
  )
}