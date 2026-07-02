import AIChatCommandCard from './AIChatCommandCard.jsx'
import AIChatFollowUpCard from './AIChatFollowUpCard.jsx'
import AIChatMCPCard from './AIChatMCPCard.jsx'
import AIChatToolCard from './AIChatToolCard.jsx'

function renderToolItem(item, options) {
  const { isLastAssistantTurn = false, hasSubsequentAssistantMessage = false } = options || {}
  switch (item.kind) {
    case 'tool':
      return <AIChatToolCard key={item.id} actionLabel={item.actionLabel} title={item.title} summary={item.summary} code={item.code} result={item.result} status={item.status} remainingFileEdits={item.remainingFileEdits} isLast={isLastAssistantTurn} hasSubsequentAssistantMessage={hasSubsequentAssistantMessage} />
    case 'command':
      return <AIChatCommandCard key={item.id} purpose={item.purpose} command={item.command} output={item.output} status={item.status} />
    case 'mcp':
      return <AIChatMCPCard key={item.id} serverName={item.serverName} toolName={item.toolName} args={item.args} response={item.response} isLast={isLastAssistantTurn} hasSubsequentAssistantMessage={hasSubsequentAssistantMessage} />
    case 'followup':
      return <AIChatFollowUpCard key={item.id} question={item.question} suggestions={item.suggestions || []} />
    default:
      return null
  }
}

export default function AIChatToolSessionPane({ items = [], isLastAssistantTurn = false, hasSubsequentAssistantMessage = false }) {
  if (!Array.isArray(items) || items.length === 0) {
    return null
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => renderToolItem(item, { isLastAssistantTurn, hasSubsequentAssistantMessage }))}
    </div>
  )
}