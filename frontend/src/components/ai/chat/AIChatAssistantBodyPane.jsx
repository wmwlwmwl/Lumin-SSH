import AIChatMarkdown from './AIChatMarkdown.jsx'

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
    box-shadow: inset 0 0 0 rgba(34, 68, 92, 0.08), 0 0 0 rgba(10, 26, 40, 0.08);
  }
  50% {
    opacity: 0.72;
    transform: scaleY(1.04);
    box-shadow: inset 0 0 18px rgba(46, 88, 118, 0.16), 0 0 18px rgba(14, 34, 52, 0.22);
  }
  100% {
    opacity: 0.28;
    transform: scaleY(0.9);
    box-shadow: inset 0 0 0 rgba(34, 68, 92, 0.08), 0 0 0 rgba(10, 26, 40, 0.08);
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

@keyframes ai-chat-stream-text-breathe {
  0% {
    text-shadow: 0 0 0 rgba(28, 62, 92, 0);
    filter: brightness(0.95);
  }
  50% {
    text-shadow: 0 0 8px rgba(30, 58, 84, 0.12), 0 0 18px rgba(10, 22, 38, 0.1);
    filter: brightness(0.99);
  }
  100% {
    text-shadow: 0 0 0 rgba(28, 62, 92, 0);
    filter: brightness(0.95);
  }
}
`

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

export default function AIChatAssistantBodyPane({ text }) {
  const content = typeof text === 'string' ? text.trim() : ''
  const isStreaming = content.endsWith('▍')
  const displayContent = isStreaming ? content.slice(0, -1) : content

  if (!displayContent && !isStreaming) {
    return null
  }

  if (isStreaming) {
    return (
      <div style={{ minWidth: 0, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.7 }}>
        <style>{streamingCursorKeyframes}</style>
        <div
          style={{
            minWidth: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            minHeight: '1.6em',
            animation: 'ai-chat-stream-text-breathe 2.4s ease-in-out infinite',
          }}
        >
          <span>{displayContent}</span>
          <StreamingCursor />
        </div>
      </div>
    )
  }

  return (
    <div style={{ minWidth: 0, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.7 }}>
      <AIChatMarkdown text={displayContent} />
    </div>
  )
}