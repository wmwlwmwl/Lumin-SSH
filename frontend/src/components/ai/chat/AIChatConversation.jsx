import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import AIChatAssistantTurn from './AIChatAssistantTurn.jsx'
import AIChatContextCondenseCard from './AIChatContextCondenseCard.jsx'
import AIChatReasoningBlock from './AIChatReasoningBlock.jsx'
import AIChatToolSessionPane from './AIChatToolSessionPane.jsx'
import AIChatUserMessage from './AIChatUserMessage.jsx'

function createAssistantTurn(message) {
  return {
    type: 'assistant-turn',
    id: message.id,
    turnId: typeof message.turnId === 'string' && message.turnId.trim() ? message.turnId.trim() : message.id,
    assistant: message,
    reasoning: [],
    tools: [],
  }
}

function getMessageTurnId(message) {
  if (typeof message?.turnId === 'string' && message.turnId.trim()) {
    return message.turnId.trim()
  }
  if (message?.kind === 'assistant' && typeof message?.id === 'string') {
    return message.id
  }
  if (typeof message?.id === 'string') {
    for (const marker of ['-tool-', '-command-', '-mcp-', '-followup-']) {
      const index = message.id.indexOf(marker)
      if (index > 0) {
        return message.id.slice(0, index)
      }
    }
    if (message.id.endsWith('-reasoning')) {
      return message.id.slice(0, -'-reasoning'.length)
    }
  }
  return ''
}

function attachMessageToTurn(turnEntry, message) {
  if (!turnEntry || !message) {
    return
  }
  if (message.kind === 'reasoning') {
    turnEntry.reasoning.push(message)
    return
  }
  turnEntry.tools.push(message)
}

function groupMessages(messages) {
  const grouped = []
  const turnMap = new Map()
  const pendingChildren = new Map()

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue
    }

    if (message.kind === 'user') {
      grouped.push({ type: 'user', id: message.id, message })
      continue
    }

    if (message.kind === 'condense_context') {
      grouped.push({ type: 'context-condense', id: message.id, message })
      continue
    }

    if (message.kind === 'assistant') {
      const turnEntry = createAssistantTurn(message)
      turnMap.set(turnEntry.turnId, turnEntry)
      const queuedChildren = pendingChildren.get(turnEntry.turnId)
      if (Array.isArray(queuedChildren) && queuedChildren.length > 0) {
        queuedChildren.forEach((child) => attachMessageToTurn(turnEntry, child))
        pendingChildren.delete(turnEntry.turnId)
      }
      grouped.push(turnEntry)
      continue
    }

    if (message.kind === 'reasoning' || message.kind === 'tool' || message.kind === 'command' || message.kind === 'mcp' || message.kind === 'followup') {
      const turnId = getMessageTurnId(message)
      if (turnId && turnMap.has(turnId)) {
        attachMessageToTurn(turnMap.get(turnId), message)
        continue
      }
      if (turnId) {
        const currentPending = pendingChildren.get(turnId) || []
        pendingChildren.set(turnId, [...currentPending, message])
        continue
      }
      if (message.kind === 'reasoning') {
        grouped.push({ type: 'reasoning', id: message.id, message })
      } else {
        grouped.push({ type: 'tool-session', id: message.id, tools: [message] })
      }
    }
  }

  for (const [turnId, queuedChildren] of pendingChildren.entries()) {
    const fallbackReasoning = queuedChildren.filter((item) => item.kind === 'reasoning')
    const fallbackTools = queuedChildren.filter((item) => item.kind !== 'reasoning')
    if (fallbackReasoning.length > 0) {
      fallbackReasoning.forEach((item) => grouped.push({ type: 'reasoning', id: item.id, message: item }))
    }
    if (fallbackTools.length > 0) {
      grouped.push({ type: 'tool-session', id: `orphan-${turnId}`, tools: fallbackTools })
    }
  }

  return grouped
}

function renderGroupedEntry(entry, handlers, entryMeta = {}) {
  switch (entry.type) {
    case 'user':
      return (
        <AIChatUserMessage
          message={entry.message}
          onRetry={handlers.onRetryUserMessage}
          onEdit={handlers.onEditUserMessage}
          onDelete={handlers.onDeleteMessage}
        />
      )
    case 'assistant-turn':
      return (
        <AIChatAssistantTurn
          assistant={entry.assistant}
          reasoning={entry.reasoning}
          tools={entry.tools}
          isLastAssistantTurn={Boolean(entryMeta.isLastAssistantTurn)}
          hasSubsequentAssistantMessage={Boolean(entryMeta.hasSubsequentAssistantMessage)}
          onDelete={handlers.onDeleteMessage}
          onRetry={handlers.onRetryAssistantMessage}
        />
      )
    case 'reasoning':
      return <AIChatReasoningBlock text={entry.message.text} duration={entry.message.duration} />
    case 'context-condense':
      return <AIChatContextCondenseCard message={entry.message} />
    case 'tool-session':
      return <AIChatToolSessionPane items={entry.tools} />
    default:
      return null
  }
}

function getEntryKey(entry, index) {
  if (entry?.id) {
    return entry.id
  }
  if (entry?.type === 'assistant-turn') {
    return entry.turnId || entry.assistant?.id || `assistant-${index}`
  }
  if (entry?.type === 'user') {
    return entry.message?.id || `user-${index}`
  }
  if (entry?.type === 'reasoning') {
    return entry.message?.id || `reasoning-${index}`
  }
  return `entry-${index}`
}

function getLastAssistantTurnIndex(entries) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === 'assistant-turn') {
      return index
    }
  }
  return -1
}

function hasSubsequentAssistantTurn(entries, currentIndex) {
  for (let index = currentIndex + 1; index < entries.length; index += 1) {
    if (entries[index]?.type === 'assistant-turn') {
      return true
    }
  }
  return false
}

export default function AIChatConversation({ messages = [], onRetryUserMessage, onRetryAssistantMessage, onEditUserMessage, onDeleteMessage }) {
  const virtuosoRef = useRef(null)
  const followIntentRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const groupedMessages = useMemo(() => groupMessages(Array.isArray(messages) ? messages : []), [messages])
  const lastAssistantTurnIndex = useMemo(() => getLastAssistantTurnIndex(groupedMessages), [groupedMessages])

  useEffect(() => {
    if (groupedMessages.length === 0) {
      followIntentRef.current = true
      setShowScrollToBottom(false)
    }
  }, [groupedMessages.length])

  const scrollToBottomAuto = useCallback(() => {
    virtuosoRef.current?.scrollTo({
      top: Number.MAX_SAFE_INTEGER,
      behavior: 'auto',
    })
  }, [])

  const handleScrollToBottom = useCallback(() => {
    followIntentRef.current = true
    setShowScrollToBottom(false)
    scrollToBottomAuto()
  }, [scrollToBottomAuto])

  if (groupedMessages.length === 0) {
    return (
      <div style={{ flex: 1, minHeight: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', padding: 20 }}>
        <div style={{ maxWidth: 260, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.8 }}>
          选择供应商并发送消息后，Ai助手会在这里按真实流式顺序输出内容。
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, height: '100%', background: 'transparent', position: 'relative' }}>
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%' }}
        data={groupedMessages}
        increaseViewportBy={{ top: 1200, bottom: 800 }}
        initialTopMostItemIndex={Math.max(groupedMessages.length - 1, 0)}
        atBottomThreshold={24}
        followOutput={(isAtBottom) => isAtBottom || followIntentRef.current}
        atBottomStateChange={(isAtBottom) => {
          followIntentRef.current = isAtBottom
          setShowScrollToBottom(!isAtBottom)
        }}
        computeItemKey={(index, entry) => getEntryKey(entry, index)}
        itemContent={(index, entry) => (
          <div style={{ padding: `0 14px ${index === groupedMessages.length - 1 ? 18 : 14}px` }}>
            {renderGroupedEntry(entry, {
              onRetryUserMessage,
              onRetryAssistantMessage,
              onEditUserMessage,
              onDeleteMessage,
            }, {
              isLastAssistantTurn: index === lastAssistantTurnIndex,
              hasSubsequentAssistantMessage: hasSubsequentAssistantTurn(groupedMessages, index),
            })}
          </div>
        )}
      />
      {showScrollToBottom ? (
        <div
          style={{
            position: 'absolute',
            right: 14,
            bottom: 10,
            zIndex: 10,
            pointerEvents: 'none',
          }}>
          <button
            type="button"
            onClick={handleScrollToBottom}
            style={{
              height: 32,
              minWidth: 40,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '0 10px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface-overlay)',
              color: 'var(--text-primary)',
              boxShadow: 'var(--shadow-lg)',
              cursor: 'pointer',
              pointerEvents: 'auto',
              transition: 'var(--transition)',
            }}>
            <ChevronDown size={14} />
          </button>
        </div>
      ) : null}
    </div>
  )
}