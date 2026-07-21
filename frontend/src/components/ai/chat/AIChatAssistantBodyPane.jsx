import { useEffect, useRef } from 'react'
import AIChatMarkdown from './AIChatMarkdown.jsx'

const streamingAnimatedTailLength = 1

const streamingCursorKeyframes = `
@keyframes ai-chat-stream-cursor-frame {
  0%, 100% {
    opacity: 0.38;
    transform: scaleY(0.94);
  }
  50% {
    opacity: 0.8;
    transform: scaleY(1);
  }
}

@keyframes ai-chat-stream-cursor-beam {
  0%, 100% {
    opacity: 0.52;
    transform: scaleY(0.78) translateY(1px);
  }
  50% {
    opacity: 1;
    transform: scaleY(1) translateY(0);
  }
}

@keyframes ai-chat-stream-char-enter {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.94);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
`

const assistantBodyMaxHeight = 420
const assistantBodyAutoFollowThreshold = 24

function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 12,
        height: '1.5em',
        marginLeft: 4,
        verticalAlign: 'text-bottom',
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: '4% 18%',
          borderRadius: 999,
          border: '1px solid rgba(var(--accent-rgb), 0.32)',
          animation: 'ai-chat-stream-cursor-frame 1.1s ease-in-out infinite',
        }}
      />
      <span
        style={{
          position: 'absolute',
          inset: '10% 42%',
          borderRadius: 999,
          background: 'rgba(var(--accent-rgb), 0.9)',
          animation: 'ai-chat-stream-cursor-beam 0.9s ease-in-out infinite',
        }}
      />
    </span>
  )
}

function renderStreamingCharacter(char, index, isLatest) {
  if (char === '\r') {
    return null
  }
  if (char === '\n') {
    return <br key={`br-${index}`} />
  }
  const displayChar = char === ' ' ? '\u00A0' : char === '\t' ? '\u00A0\u00A0\u00A0\u00A0' : char
  return (
    <span
      key={`${index}-${char}`}
      style={
        isLatest
          ? {
              display: 'inline-block',
              verticalAlign: 'baseline',
              animation: 'ai-chat-stream-char-enter 160ms cubic-bezier(0.22, 1, 0.36, 1)',
              transformOrigin: '50% 100%',
            }
          : undefined
      }
    >
      {displayChar}
    </span>
  )
}

export default function AIChatAssistantBodyPane({ text }) {
  const content = typeof text === 'string' ? text.trim() : ''
  const isStreaming = content.endsWith('▍')
  const displayContent = isStreaming ? content.slice(0, -1) : content
  const scrollContainerRef = useRef(null)
  const contentRef = useRef(null)
  const shouldAutoFollowRef = useRef(true)
  const scrollFrameRef = useRef(0)

  const cancelScheduledScrollBodyToBottom = () => {
    if (scrollFrameRef.current) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = 0
    }
  }

  const scrollBodyToBottom = () => {
    const container = scrollContainerRef.current
    if (!container || !shouldAutoFollowRef.current) {
      return
    }
    container.scrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
  }

  const scheduleScrollBodyToBottom = () => {
    if (!shouldAutoFollowRef.current || scrollFrameRef.current) {
      return
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollBodyToBottom()
      scrollFrameRef.current = 0
    })
  }

  useEffect(() => {
    if (!displayContent && !isStreaming) {
      return undefined
    }
    scheduleScrollBodyToBottom()
    return undefined
  }, [displayContent, isStreaming])

  useEffect(() => {
    if (isStreaming) {
      return undefined
    }
    const container = scrollContainerRef.current
    const contentElement = contentRef.current
    if (!container || !contentElement || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(() => {
      scheduleScrollBodyToBottom()
    })
    observer.observe(contentElement)
    return () => observer.disconnect()
  }, [isStreaming])

  useEffect(() => {
    return () => {
      cancelScheduledScrollBodyToBottom()
    }
  }, [])

  if (!displayContent && !isStreaming) {
    return null
  }

  const handleBodyScroll = () => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    shouldAutoFollowRef.current = distanceToBottom <= assistantBodyAutoFollowThreshold
  }

  if (isStreaming) {
    const streamingCharacters = Array.from(displayContent)
    const animatedTailStart = Math.max(streamingCharacters.length - streamingAnimatedTailLength, 0)
    const stablePrefix = streamingCharacters.slice(0, animatedTailStart).join('')
    const animatedTail = streamingCharacters.slice(animatedTailStart)

    return (
      <div style={{ minWidth: 0, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.7 }}>
        <div
          ref={scrollContainerRef}
          onScroll={handleBodyScroll}
          style={{
            minWidth: 0,
            maxHeight: assistantBodyMaxHeight,
            overflowY: 'auto',
            overflowAnchor: 'none',
            paddingRight: 4,
            scrollbarGutter: 'stable both-edges',
          }}
        >
          <style>{streamingCursorKeyframes}</style>
          <div
            ref={contentRef}
            style={{
              minWidth: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              minHeight: '1.6em',
            }}
          >
            {stablePrefix}
            {animatedTail.map((char, index) => renderStreamingCharacter(char, animatedTailStart + index, animatedTailStart + index === streamingCharacters.length - 1))}
            <StreamingCursor />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minWidth: 0, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.7 }}>
      <div
        ref={scrollContainerRef}
        onScroll={handleBodyScroll}
        style={{
          minWidth: 0,
          maxHeight: assistantBodyMaxHeight,
          overflowY: 'auto',
          overflowAnchor: 'none',
          paddingRight: 4,
          scrollbarGutter: 'stable both-edges',
        }}
      >
        <div ref={contentRef}>
          <AIChatMarkdown text={displayContent} enableQuoteContextMenu={true} />
        </div>
      </div>
    </div>
  )
}