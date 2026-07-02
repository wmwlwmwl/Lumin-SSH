import { ChevronUp, Lightbulb } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../../../i18n.js'
import AIChatMarkdown from './AIChatMarkdown.jsx'

function parseDurationSeconds(duration) {
  if (typeof duration !== 'string') {
    return 0
  }
  const match = duration.trim().match(/(\d+(?:\.\d+)?)s$/)
  return match ? Number(match[1]) : 0
}

export default function AIChatReasoningBlock({ text, duration = '', isStreaming = false, isLast = false }) {
  const { t } = useTranslation()
  const content = typeof text === 'string' ? text.trim() : ''
  const durationLabel = typeof duration === 'string' && duration.trim() ? duration.trim() : ''
  const startTimeRef = useRef(Date.now())
  const contentRef = useRef(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isCollapsed, setIsCollapsed] = useState(!isLast)
  const [contentHeight, setContentHeight] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    if (isLast) {
      setIsCollapsed(false)
      return
    }
    setIsCollapsed(true)
  }, [isLast])

  useEffect(() => {
    if (!isLast) {
      setIsAnimating(true)
      setIsCollapsed(true)
    }
  }, [isLast])

  useEffect(() => {
    if (!isStreaming) {
      setElapsedMs(0)
      return undefined
    }
    startTimeRef.current = Date.now()
    setElapsedMs(0)
    const updateElapsed = () => {
      setElapsedMs(Date.now() - startTimeRef.current)
    }
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [isStreaming, content])

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) {
      return
    }
    const updateHeight = () => setContentHeight(element.scrollHeight)
    updateHeight()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(element)
    return () => observer.disconnect()
  }, [content])

  useEffect(() => {
    if (!isAnimating) {
      return undefined
    }
    const timer = window.setTimeout(() => setIsAnimating(false), 2666)
    return () => window.clearTimeout(timer)
  }, [isAnimating, isCollapsed])

  if (!content) {
    return null
  }

  const liveDurationLabel = isStreaming ? `${Math.max(0, Math.floor(elapsedMs / 1000))}s` : ''
  const finalDurationLabel = !isStreaming && durationLabel ? `${parseDurationSeconds(durationLabel).toFixed(1)}s` : ''
  const displayDurationLabel = liveDurationLabel || finalDurationLabel

  const handleToggle = () => {
    setIsAnimating(true)
    setIsCollapsed((previous) => !previous)
  }

  return (
    <div style={{ display: 'grid', gap: 0, width: '100%' }}>
      <button
        type="button"
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 0,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={14} color="var(--text-secondary)" />
          <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 12 }}>{t('思考中')}</span>
          {displayDurationLabel ? <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{displayDurationLabel}</span> : null}
        </span>
        <ChevronUp
          size={14}
          color="var(--text-tertiary)"
          style={{
            opacity: 0.88,
            transform: isCollapsed ? 'rotate(180deg) scale(0.9)' : 'rotate(0deg) scale(1)',
            transition: 'transform 2666ms cubic-bezier(0.12,0,0.08,1), opacity 240ms ease',
          }}
        />
      </button>
      {(content?.trim()?.length ?? 0) > 0 ? (
        <div
          style={{
            overflow: 'hidden',
            willChange: 'max-height, opacity, transform, clip-path',
            opacity: isCollapsed ? 0 : 1,
            transform: isCollapsed ? 'translateY(-24px) scale(0.955)' : 'translateY(0) scale(1)',
            maxHeight: isCollapsed ? 0 : contentHeight + 32,
            clipPath: isCollapsed ? 'inset(0 0 100% 0)' : 'inset(0 0 0% 0)',
            transitionProperty: 'max-height, opacity, transform, clip-path',
            transitionDuration: '2666ms',
            transitionTimingFunction: 'cubic-bezier(0.12, 0, 0.08, 1)',
          }}>
          <div
            ref={contentRef}
            style={{
              padding: '2px 0 2px 14px',
              borderLeft: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              lineHeight: 1.7,
              wordBreak: 'break-word',
              transform: isCollapsed ? 'translateX(-12px)' : 'translateX(0)',
              transition: 'transform 2666ms cubic-bezier(0.12, 0, 0.08, 1)',
            }}>
            <AIChatMarkdown text={content} />
          </div>
        </div>
      ) : null}
    </div>
  )
}