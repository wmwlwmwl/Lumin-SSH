import { ChevronUp, Lightbulb } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { useTranslation } from '../../../i18n.ts'
import AIChatMarkdown from './AIChatMarkdown.tsx'

function parseDurationSeconds(duration: string) {
  const match = duration.trim().match(/(\d+(?:\.\d+)?)s$/)
  return match ? Number(match[1]) : 0
}

const reasoningBodyMaxHeight = 360

interface AIChatReasoningBlockProps {
  text?: string
  duration?: string
  isStreaming?: boolean
  isLast?: boolean
}

export default function AIChatReasoningBlock({ text, duration = '', isStreaming = false, isLast = false }: AIChatReasoningBlockProps) {
  const { t } = useTranslation()
  const content = typeof text === 'string' ? text.trim() : ''
  const durationLabel = typeof duration === 'string' && duration.trim() ? duration.trim() : ''
  const startTimeRef = useRef(Date.now())
  const { scrollRef, contentRef, scrollToBottom, stopScroll } = useStickToBottom({
    initial: 'instant',
    resize: 'smooth',
  })
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isCollapsed, setIsCollapsed] = useState(!isLast)
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
  }, [isStreaming])

  useEffect(() => {
    if (isCollapsed) {
      stopScroll()
      return
    }
    void scrollToBottom('instant')
  }, [isCollapsed, scrollToBottom, stopScroll])

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
    <div className="grid w-full gap-0">
      <button
        type="button"
        onClick={handleToggle}
        className="mb-0 flex cursor-pointer items-center justify-between gap-2.5 border-none bg-transparent p-0 text-left">
        <span className="inline-flex items-center gap-2">
          <Lightbulb size={14} color="var(--text-secondary)" />
          <span className="text-sm font-bold text-primary">{t('思考链')}</span>
          {displayDurationLabel ? <span className="text-xs text-tertiary">{displayDurationLabel}</span> : null}
        </span>
        <ChevronUp
          size={14}
          color="var(--text-tertiary)"
          className="opacity-[0.88]"
          style={{
            transform: isCollapsed ? 'rotate(180deg) scale(0.9)' : 'rotate(0deg) scale(1)',
            transition: 'transform 2666ms cubic-bezier(0.12,0,0.08,1), opacity 240ms ease',
          }}
        />
      </button>
      {(content?.trim()?.length ?? 0) > 0 ? (
        <div
          style={{
            opacity: isCollapsed ? 0 : 1,
            transform: isCollapsed ? 'translateY(-24px) scale(0.955)' : 'translateY(0) scale(1)',
            maxHeight: isCollapsed ? 0 : reasoningBodyMaxHeight + 8,
            clipPath: isCollapsed ? 'inset(0 0 100% 0)' : 'inset(0 0 0% 0)',
          }}
          className="overflow-hidden ease-[cubic-bezier(0.12,0,0.08,1)] duration-[2666ms] [transition-property:max-height,opacity,transform,clip-path] [will-change:max-height,opacity,transform,clip-path]">
          <div
            ref={scrollRef}
            className="max-h-[360px] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable_both-edges]">
            <div
              ref={contentRef}
              style={{
                transform: isCollapsed ? 'translateX(-12px)' : 'translateX(0)',
              }}
              className="border-l border-line-subtle py-0.5 pl-3.5 text-sm leading-[1.7] text-secondary [transition:transform_2666ms_cubic-bezier(0.12,0,0.08,1)] [word-break:break-word]">
              <AIChatMarkdown text={content} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
