import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime.js'
import { Activity } from 'lucide-react'
import { useTranslation, type I18nKey } from '../i18n.js'

export interface MCPActivityEvent {
  requestId: string
  source: string
  clientName: string
  tool: string
  sessionId: string
  serverName: string
  command?: string
  purpose?: string
  isMutating: boolean
  cwd?: string
  status: string
  output?: string
  exitCode?: number | null
  timestamp: number
}

interface ActivityCard {
  events: MCPActivityEvent[]
  resolved: boolean
}

type ActivityMap = Map<string, ActivityCard>

const statusColors: Record<string, string> = {
  started: '#5b9cf6',
  queued: '#f0a040',
  running: '#5b9cf6',
  output: '#888',
  done: '#4caf72',
  error: '#ef5350',
  approval_required: '#f0a040',
  approved: '#4caf72',
  rejected: '#ef5350',
  timed_out: '#ef5350',
}

const statusLabels: Record<string, string> = {
  started: '开始',
  queued: '排队中',
  running: '执行中',
  output: '等待处理',
  done: '已完成',
  error: '错误',
  approval_required: '等待审批',
  approved: '已批准',
  rejected: '已拒绝',
  timed_out: '审批超时',
}

const clientColors: Record<string, string> = {
  'claude-code': '#d97757',
  'codex': '#10a37f',
  'cursor': '#5b9cf6',
  'cline': '#a78bfa',
  'windsurf': '#5b9cf6',
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function resolveApproval(requestId: string, approved: boolean) {
  try {
    const w = window as unknown as {
      go?: { wailsapp?: { App?: { ResolveMCPApproval?: (id: string, a: boolean) => Promise<void> } } }
    }
    return w.go?.wailsapp?.App?.ResolveMCPApproval?.(requestId, approved)
  } catch {
    // ignore
  }
}

export interface MCPActivityPanelProps {
  height?: string
  onClose?: () => void
  /** 审批请求到来时回调（弹窗被关闭时用于自动弹出） */
  onApprovalRequired?: () => void
  /** 标题栏按下（用于拖动整个弹窗） */
  onHeaderPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void
  /** 标题栏双击（用于复位弹窗位置） */
  onHeaderDoubleClick?: () => void
}

export interface MCPActivityFloatingToggleProps {
  visible: boolean
  offset: { x: number; y: number }
  onClick: () => void
  onPointerDown: (e: { button?: number; clientX: number; clientY: number }) => void
  onDoubleClick: () => void
}

export function MCPActivityFloatingToggle({ visible, offset, onClick, onPointerDown, onDoubleClick }: MCPActivityFloatingToggleProps) {
  const { t } = useTranslation()
  if (!visible) return null
  return (
    <button
      onClick={onClick}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title={t('拖动按钮移动，双击复位')}
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'var(--lumin-bg-tertiary, #1a2335)',
        color: 'var(--lumin-text-secondary, #8892b0)',
        cursor: 'grab',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <Activity size={17} strokeWidth={2} />
    </button>
  )
}

export default function MCPActivityPanel({ height = '100%', onClose, onApprovalRequired, onHeaderPointerDown, onHeaderDoubleClick }: MCPActivityPanelProps) {
  const { t } = useTranslation()
  const [activities, setActivities] = useState<ActivityMap>(new Map())
  const activitiesRef = useRef<ActivityMap>(new Map())
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardOrderRef = useRef<string[]>([])
  const onApprovalRequiredRef = useRef(onApprovalRequired)
  useEffect(() => { onApprovalRequiredRef.current = onApprovalRequired }, [onApprovalRequired])

  const flushState = useCallback(() => {
    setActivities(new Map(activitiesRef.current))
  }, [])

  useEffect(() => {
    const unbind = EventsOn('mcp-activity', (payload: MCPActivityEvent) => {
      if (!payload?.requestId) return
      const map = activitiesRef.current
      const existing = map.get(payload.requestId)
      if (existing) {
        existing.events.push(payload)
        if (payload.status === 'approved' || payload.status === 'rejected' || payload.status === 'timed_out') {
          existing.resolved = true
        }
      } else {
        const resolved = payload.status === 'approved' || payload.status === 'rejected' || payload.status === 'timed_out'
        map.set(payload.requestId, { events: [payload], resolved })
        cardOrderRef.current.unshift(payload.requestId)
        if (cardOrderRef.current.length > 50) {
          const removed = cardOrderRef.current.pop()
          if (removed) map.delete(removed)
        }
      }
      if (payload.status === 'approval_required') {
        onApprovalRequiredRef.current?.()
      }
      flushState()
    })
    return () => { unbind() }
  }, [flushState])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [activities, autoScroll])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    setAutoScroll(scrollRef.current.scrollTop < 50)
  }, [])

  const cards = cardOrderRef.current
    .filter((id) => activities.has(id))
    .map((id) => activities.get(id)!)
    .filter((card) => card.events.length > 0)

  return (
    <div style={{
      height,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--lumin-bg-secondary, #0e1420)',
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid var(--lumin-border, rgba(255,255,255,0.08))',
    }}>
      {/* Header（可拖动弹窗的把手） */}
      <div
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={onHeaderDoubleClick}
        title={onHeaderPointerDown ? t('拖动标题栏移动，双击复位') : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderBottom: '1px solid var(--lumin-border, rgba(255,255,255,0.08))',
          flexShrink: 0,
          cursor: onHeaderPointerDown ? 'grab' : 'default',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <Activity size={14} strokeWidth={2.2} style={{ color: '#5b9cf6', flexShrink: 0 }} />
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--lumin-text-primary, #e0e6f0)' }}>
          {t('MCP 活动')}
        </span>
        <span style={{
          fontSize: '11px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: 'rgba(91,156,246,0.15)',
          color: '#5b9cf6',
        }}>
          {cards.length}
        </span>
        <div style={{ flex: 1 }} />
        {onClose && (
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--lumin-text-secondary, #8892b0)',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
            title={t('关闭')}
          >
            ✕
          </button>
        )}
      </div>

      {/* Activity list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
        }}
      >
        {cards.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--lumin-text-tertiary, #5a6580)',
            fontSize: '13px',
          }}>
            {t('外部 MCP（如 Claude Code）的操作会显示在这里')}
          </div>
        ) : (
          cards.map((card) => {
            const latest = card.events[card.events.length - 1]
            const first = card.events[0]
            const color = statusColors[latest.status] || '#888'
            const clientColor = clientColors[first.clientName] || '#888'
            const needsApproval = latest.status === 'approval_required' && !card.resolved

            return (
              <div key={first.requestId} style={{
                marginBottom: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'var(--lumin-bg-tertiary, #131a2a)',
                border: needsApproval
                  ? `1px solid ${color}`
                  : '1px solid var(--lumin-border, rgba(255,255,255,0.06))',
              }}>
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: `${clientColor}22`,
                    color: clientColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {first.clientName || 'unknown'}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--lumin-text-secondary, #8892b0)',
                  }}>
                    {first.serverName || '—'}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--lumin-text-tertiary, #5a6580)',
                  }}>
                    {first.tool}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: '10px', color: 'var(--lumin-text-tertiary, #5a6580)' }}>
                    {formatTime(latest.timestamp)}
                  </span>
                </div>

                {/* Command display */}
                {first.command && (
                  <div style={{
                    fontSize: '11px',
                    fontFamily: 'var(--lumin-font-mono, "Cascadia Code", "Fira Code", monospace)',
                    color: 'var(--lumin-text-secondary, #aab2d1)',
                    background: 'rgba(0,0,0,0.25)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {first.cwd ? `$ cd ${first.cwd}\n` : ''}$ {first.command}
                  </div>
                )}

                {/* Purpose */}
                {first.purpose && (
                  <div style={{ fontSize: '11px', color: 'var(--lumin-text-tertiary, #6a7590)', marginBottom: '4px' }}>
                    {first.purpose}
                  </div>
                )}

                {/* Status badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                    animation: (latest.status === 'running' || latest.status === 'queued') ? 'pulse 1.5s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: '11px', color, fontWeight: 500 }}>
                    {t((statusLabels[latest.status] || latest.status) as I18nKey)}
                    {latest.exitCode != null ? ` (exit ${latest.exitCode})` : ''}
                  </span>
                </div>

                {/* Output preview */}
                {latest.output && latest.output.trim() && (
                  <details style={{ marginTop: '6px' }}>
                    <summary style={{
                      fontSize: '10px',
                      color: 'var(--lumin-text-tertiary, #6a7590)',
                      cursor: 'pointer',
                    }}>
                      {t('输出预览')}
                    </summary>
                    <pre style={{
                      fontSize: '10px',
                      fontFamily: 'var(--lumin-font-mono, monospace)',
                      color: 'var(--lumin-text-secondary, #aab2d1)',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      marginTop: '4px',
                      maxHeight: '200px',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}>
                      {latest.output}
                    </pre>
                  </details>
                )}

                {/* Approval buttons */}
                {needsApproval && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      onClick={() => {
                        resolveApproval(first.requestId, true)
                        card.resolved = true
                        flushState()
                      }}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: '6px',
                        background: '#4caf72',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {t('批准')}
                    </button>
                    <button
                      onClick={() => {
                        resolveApproval(first.requestId, false)
                        card.resolved = true
                        flushState()
                      }}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: '6px',
                        background: '#ef5350',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {t('拒绝')}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
