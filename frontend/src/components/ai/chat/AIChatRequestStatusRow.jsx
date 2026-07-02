import { useEffect, useMemo, useRef, useState } from 'react'
import { t as translate } from '../../../i18n.js'

function stripStreamingCursor(text) {
  const content = typeof text === 'string' ? text.trim() : ''
  return content.endsWith('▍') ? content.slice(0, -1) : content
}

function estimateLiveTokenCount(text) {
  const normalized = stripStreamingCursor(text).replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 0
  }
  return Math.max(1, Math.round(normalized.length / 4))
}

function formatDurationLabel(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return ''
  }
  return `${(milliseconds / 1000).toFixed(1)}s`
}

function getFirstTokenMetricColor(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return 'var(--text-secondary)'
  }
  if (seconds <= 20) {
    return 'var(--success)'
  }
  if (seconds <= 60) {
    return 'var(--warning)'
  }
  return 'var(--danger)'
}

function getElapsedMetricColor(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return 'var(--text-secondary)'
  }
  if (seconds <= 40) {
    return 'var(--success)'
  }
  if (seconds <= 90) {
    return 'var(--warning)'
  }
  return 'var(--danger)'
}

function getTokensPerSecondMetricColor(tokensPerSecond) {
  if (typeof tokensPerSecond !== 'number' || !Number.isFinite(tokensPerSecond)) {
    return 'var(--text-secondary)'
  }
  if (tokensPerSecond >= 40) {
    return 'var(--success)'
  }
  if (tokensPerSecond >= 20) {
    return 'var(--accent)'
  }
  if (tokensPerSecond >= 5) {
    return 'var(--warning)'
  }
  return 'var(--danger)'
}

function parseDurationSeconds(metric) {
  if (typeof metric !== 'string') {
    return undefined
  }
  const match = metric.match(/(\d+(?:\.\d+)?)s$/)
  return match ? Number(match[1]) : undefined
}

function parseTokensPerSecond(metric) {
  if (typeof metric !== 'string') {
    return undefined
  }
  const match = metric.match(/(\d+(?:\.\d+)?)\s*tok\/s$/i)
  return match ? Number(match[1]) : undefined
}

function buildMetricItem(metric, index) {
  if (typeof metric !== 'string' || !metric.trim()) {
    return null
  }
  if (metric.startsWith(`${translate('首字')} `)) {
    return {
      key: `metric-${index}-${metric}`,
      label: metric,
      color: getFirstTokenMetricColor(parseDurationSeconds(metric)),
    }
  }
  if (/tok\/s$/i.test(metric)) {
    return {
      key: `metric-${index}-${metric}`,
      label: metric,
      color: getTokensPerSecondMetricColor(parseTokensPerSecond(metric)),
    }
  }
  return {
    key: `metric-${index}-${metric}`,
    label: metric,
    color: getElapsedMetricColor(parseDurationSeconds(metric)),
  }
}

export default function AIChatRequestStatusRow({ assistant, reasoning = [] }) {
  const assistantId = typeof assistant?.id === 'string' ? assistant.id : ''
  const [nowMs, setNowMs] = useState(Date.now())
  const samplesRef = useRef([])
  const explicitMetrics = useMemo(
    () => (Array.isArray(assistant?.metrics) ? assistant.metrics.filter((item) => typeof item === 'string' && item.trim()) : []),
    [assistant?.metrics],
  )
  const isLive = Boolean(assistant?.extra?.requestStatusLive) || Boolean(assistant?.streaming)
  const startedAtMs = Number(assistant?.extra?.statusStartedAtMs)
  const firstTokenAtMs = Number(assistant?.extra?.firstTokenAtMs)
  const combinedOutputText = useMemo(() => {
    const reasoningText = Array.isArray(reasoning)
      ? reasoning
          .map((item) => (typeof item?.text === 'string' ? item.text : ''))
          .filter(Boolean)
          .join('\n')
      : ''
    const assistantText = typeof assistant?.text === 'string' ? assistant.text : ''
    return `${reasoningText}${reasoningText && assistantText ? '\n' : ''}${assistantText}`
  }, [assistant?.text, reasoning])

  useEffect(() => {
    samplesRef.current = []
  }, [assistantId])

  useEffect(() => {
    if (!isLive) {
      return undefined
    }
    setNowMs(Date.now())
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 100)
    return () => window.clearInterval(timer)
  }, [isLive])

  useEffect(() => {
    if (!isLive || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
      return
    }
    const nextSample = {
      ts: nowMs,
      tokens: estimateLiveTokenCount(combinedOutputText),
    }
    samplesRef.current = [...samplesRef.current.filter((sample) => nextSample.ts - sample.ts <= 4000), nextSample]
  }, [combinedOutputText, isLive, nowMs, startedAtMs])

  const liveMetrics = useMemo(() => {
    if (!isLive || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
      return []
    }
    const parts = []
    const normalizedFirstTokenAtMs = Number.isFinite(firstTokenAtMs) && firstTokenAtMs > startedAtMs ? firstTokenAtMs : 0
    if (normalizedFirstTokenAtMs > 0) {
      parts.push(`${translate('首字')} ${formatDurationLabel(normalizedFirstTokenAtMs - startedAtMs)}`)
    }
    const elapsedLabel = formatDurationLabel(Math.max(0, nowMs - startedAtMs))
    if (elapsedLabel) {
      parts.push(elapsedLabel)
    }
    if (normalizedFirstTokenAtMs > 0 && samplesRef.current.length >= 2) {
      const latestSample = samplesRef.current[samplesRef.current.length - 1]
      const windowStart = latestSample.ts - 3000
      let baseSample = samplesRef.current[0]
      for (const sample of samplesRef.current) {
        if (sample.ts <= windowStart) {
          baseSample = sample
          continue
        }
        break
      }
      const deltaTokens = Math.max(0, latestSample.tokens - baseSample.tokens)
      const deltaMs = Math.max(1, latestSample.ts - baseSample.ts)
      const tokensPerSecond = deltaTokens / (deltaMs / 1000)
      if (Number.isFinite(tokensPerSecond) && tokensPerSecond > 0) {
        parts.push(`${tokensPerSecond.toFixed(1)} tok/s`)
      }
    }
    return parts
  }, [firstTokenAtMs, isLive, nowMs, startedAtMs])

  const metrics = isLive ? liveMetrics : (explicitMetrics.length > 0 ? explicitMetrics : liveMetrics)
  const metricItems = useMemo(
    () => metrics.map((metric, index) => buildMetricItem(metric, index)).filter(Boolean),
    [metrics],
  )

  if (metricItems.length === 0) {
    return null
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 8px',
        borderRadius: 999,
        border: isLive ? '1px solid rgba(var(--accent-rgb), 0.24)' : '1px solid var(--border-subtle)',
        background: isLive ? 'rgba(var(--accent-rgb), 0.12)' : 'rgba(var(--accent-rgb), 0.08)',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        boxShadow: isLive ? '0 0 14px rgba(var(--accent-rgb), 0.12)' : 'none',
        transition: 'var(--transition)',
      }}>
      {metricItems.map((item) => (
        <span key={item.key} style={{ color: item.color, transition: 'color 180ms ease' }}>{item.label}</span>
      ))}
    </span>
  )
}