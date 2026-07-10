import { useEffect, useLayoutEffect, useRef } from 'react'
import AIChatMarkdown from './AIChatMarkdown.jsx'

const streamingAnimatedTailLength = 12

const streamingCursorKeyframes = `
@keyframes ai-chat-stream-cursor-beam {
  0% {
    transform: scaleY(0.72) translateY(2px);
    opacity: 0.42;
    filter: brightness(0.82) saturate(0.8);
  }
  16% {
    transform: scaleY(1.22) translateY(-1px);
    opacity: 0.88;
    filter: brightness(1.02) saturate(0.92);
  }
  33% {
    transform: scaleY(0.92) translateY(0);
    opacity: 0.58;
    filter: brightness(0.92);
  }
  54% {
    transform: scaleY(1.68) translateY(-2px);
    opacity: 0.96;
    filter: brightness(1.12) saturate(1);
  }
  74% {
    transform: scaleY(1.08) translateY(0);
    opacity: 0.72;
    filter: brightness(0.96);
  }
  100% {
    transform: scaleY(0.72) translateY(2px);
    opacity: 0.42;
    filter: brightness(0.82) saturate(0.8);
  }
}

@keyframes ai-chat-stream-cursor-frame {
  0% {
    opacity: 0.28;
    transform: scaleY(0.9);
    box-shadow: inset 0 0 0 color-mix(in srgb, var(--accent) 8%, transparent), 0 0 0 color-mix(in srgb, var(--accent) 8%, transparent);
  }
  50% {
    opacity: 0.72;
    transform: scaleY(1.04);
    box-shadow: inset 0 0 18px color-mix(in srgb, var(--accent) 16%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  100% {
    opacity: 0.28;
    transform: scaleY(0.9);
    box-shadow: inset 0 0 0 color-mix(in srgb, var(--accent) 8%, transparent), 0 0 0 color-mix(in srgb, var(--accent) 8%, transparent);
  }
}

@keyframes ai-chat-stream-cursor-scanline {
  0% {
    transform: translateY(138%);
    opacity: 0;
  }
  12% {
    opacity: 0.95;
  }
  48% {
    opacity: 0.72;
  }
  100% {
    transform: translateY(-138%);
    opacity: 0;
  }
}

@keyframes ai-chat-stream-cursor-spark-left {
  0% {
    transform: translateY(9px) scale(0.78);
    opacity: 0.1;
  }
  24% {
    transform: translateY(-3px) scale(1);
    opacity: 0.78;
  }
  62% {
    transform: translateY(-11px) scale(0.88);
    opacity: 0.16;
  }
  100% {
    transform: translateY(9px) scale(0.78);
    opacity: 0.1;
  }
}

@keyframes ai-chat-stream-cursor-spark-right {
  0% {
    transform: translateY(-10px) scale(0.72);
    opacity: 0.12;
  }
  36% {
    transform: translateY(2px) scale(1);
    opacity: 0.74;
  }
  68% {
    transform: translateY(11px) scale(0.84);
    opacity: 0.14;
  }
  100% {
    transform: translateY(-10px) scale(0.72);
    opacity: 0.12;
  }
}

@keyframes ai-chat-stream-char-enter {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.88);
  }
  58% {
    opacity: 1;
    transform: translateY(-2px) scale(1.04);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes ai-chat-stream-char-sheen {
  0% {
    opacity: 0;
    background-position: 120% 0;
  }
  18% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    background-position: -20% 0;
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
        width: 16,
        height: '1.62em',
        marginLeft: 6,
        verticalAlign: 'text-bottom',
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: '0 6%',
          borderRadius: 4,
          borderTop: '0.5px solid rgba(var(--accent-rgb), 0.45)',
          borderBottom: '0.5px solid rgba(var(--accent-rgb), 0.45)',
          borderLeft: '0.5px solid rgba(var(--accent-rgb), 0.18)',
          borderRight: '0.5px solid rgba(var(--accent-rgb), 0.18)',
          boxShadow: 'inset 0 0 12px rgba(var(--accent-rgb), 0.16), 0 0 16px rgba(var(--accent-rgb), 0.18)',
          animation: 'ai-chat-stream-cursor-frame 1.8s ease-in-out infinite',
        }}
      />
      <span
        style={{
          position: 'absolute',
          inset: '5% 40%',
          borderRadius: 999,
          background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.32) 0%, rgba(var(--accent-rgb), 0.72) 20%, var(--accent) 58%, rgba(var(--accent-rgb), 0.38) 100%)',
          boxShadow: '0 0 10px rgba(var(--accent-rgb), 0.32), 0 0 20px rgba(var(--accent-rgb), 0.28)',
          animation: 'ai-chat-stream-cursor-beam 1.28s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: '-55%',
            right: '-55%',
            top: 0,
            height: 2,
            borderRadius: 999,
            background: 'linear-gradient(90deg, rgba(var(--accent-rgb), 0) 0%, rgba(var(--accent-rgb), 0.42) 50%, rgba(var(--accent-rgb), 0) 100%)',
            boxShadow: '0 0 8px rgba(var(--accent-rgb), 0.28)',
            animation: 'ai-chat-stream-cursor-scanline 1.1s linear infinite',
          }}
        />
      </span>
      <span
        style={{
          position: 'absolute',
          left: 1,
          width: 2,
          height: 2,
          borderRadius: 1,
          background: 'rgba(var(--accent-rgb), 0.46)',
          boxShadow: '0 0 7px rgba(var(--accent-rgb), 0.32)',
          animation: 'ai-chat-stream-cursor-spark-left 1.35s ease-in-out infinite',
        }}
      />
      <span
        style={{
          position: 'absolute',
          right: 1,
          width: 2,
          height: 2,
          borderRadius: 1,
          background: 'rgba(var(--accent-rgb), 0.42)',
          boxShadow: '0 0 7px rgba(var(--accent-rgb), 0.28)',
          animation: 'ai-chat-stream-cursor-spark-right 1.55s ease-in-out infinite',
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
  const showSweep = isLatest && char !== ' ' && char !== '\t'
  return (
    <span
      key={`${index}-${char}`}
      style={{
        position: 'relative',
        display: 'inline-block',
        verticalAlign: 'baseline',
        animation: 'ai-chat-stream-char-enter 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        transformOrigin: '50% 100%',
        willChange: 'transform, opacity',
      }}
    >
      <span style={{ position: 'relative', zIndex: 1 }}>{displayChar}</span>
      {showSweep ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            pointerEvents: 'none',
            backgroundImage: 'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent) 18%, transparent) 36%, color-mix(in srgb, var(--text-primary) 92%, transparent) 50%, color-mix(in srgb, var(--accent) 22%, transparent) 64%, transparent 100%)',
            backgroundSize: '180% 100%',
            backgroundPosition: '120% 0',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            animation: 'ai-chat-stream-char-sheen 360ms ease-out both',
          }}
        >
          {char}
        </span>
      ) : null}
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
  const scrollFollowupFrameRef = useRef(0)

  const cancelScheduledScrollBodyToBottom = () => {
    if (scrollFrameRef.current) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = 0
    }
    if (scrollFollowupFrameRef.current) {
      window.cancelAnimationFrame(scrollFollowupFrameRef.current)
      scrollFollowupFrameRef.current = 0
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
    if (!shouldAutoFollowRef.current) {
      return
    }
    cancelScheduledScrollBodyToBottom()
    scrollBodyToBottom()
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollBodyToBottom()
      scrollFrameRef.current = 0
      scrollFollowupFrameRef.current = window.requestAnimationFrame(() => {
        scrollBodyToBottom()
        scrollFollowupFrameRef.current = 0
      })
    })
  }

  useLayoutEffect(() => {
    if (!displayContent && !isStreaming) {
      return undefined
    }
    scheduleScrollBodyToBottom()
    return undefined
  }, [displayContent, isStreaming])

  useEffect(() => {
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
  }, [displayContent, isStreaming])

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
          <AIChatMarkdown text={displayContent} />
        </div>
      </div>
    </div>
  )
}