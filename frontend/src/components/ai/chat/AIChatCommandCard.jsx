import { ChevronDown, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../../i18n.js'

const buildShellCommandPattern = (commandPattern) => new RegExp(`(^|[\\s|;&()])(${commandPattern})(?=\\s)`, 'gi')
const DANGEROUS_COMMAND_RULES = [
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`Remove-Item`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`rm`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`(?:del|erase)`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`(?:rd|rmdir)`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`format`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`diskpart`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`mkfs(?:\.[\w-]+)?`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`(?:fdisk|cfdisk|sfdisk|parted|sgdisk|gdisk)`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`dd`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`(?:wipefs|blkdiscard|shred)`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`(?:pvremove|vgremove|lvremove|mdadm)`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`zpool\s+destroy`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`diskutil`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`(?:newfs|gpt|asr|hdiutil)`) },
  { severity: 'danger', pattern: buildShellCommandPattern(String.raw`(?:Clear-Disk|Initialize-Disk|Remove-Partition|Update-Disk|clean|clean\s+all)`) },
]
const WARNING_COMMAND_RULES = [
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`chmod`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`chown`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`mountvol`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`(?:mount|umount|diskmount|diskunmount)`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`(?:fsck|e2fsck|chkdsk|partprobe|resize2fs|tune2fs|xfs_repair)`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`(?:New-Partition|Resize-Partition|Set-Disk|Set-Partition|diskutil\s+(?:partitionDisk|apfs|unmountDisk|eraseVolume))`) },
]
const SENSITIVE_COMMAND_RULES = [...DANGEROUS_COMMAND_RULES, ...WARNING_COMMAND_RULES]
const COMMAND_RISK_PRIORITY = { danger: 2, warning: 1 }

function assessSensitiveCommandRisk(command) {
  if (!command.trim()) {
    return { severity: null, matches: [] }
  }
  const allMatches = SENSITIVE_COMMAND_RULES.flatMap((rule) =>
    Array.from(command.matchAll(rule.pattern)).map((match) => {
      const prefixLength = match[1]?.length ?? 0
      const matchedValue = match[2] ?? match[0]
      const start = (match.index ?? 0) + prefixLength
      return { start, end: start + matchedValue.length, severity: rule.severity }
    }),
  ).sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start
    }
    if (left.end !== right.end) {
      return right.end - left.end
    }
    return COMMAND_RISK_PRIORITY[right.severity] - COMMAND_RISK_PRIORITY[left.severity]
  })
  const matches = allMatches.reduce((result, match) => {
    const lastMatch = result[result.length - 1]
    if (!lastMatch || match.start >= lastMatch.end) {
      result.push(match)
    }
    return result
  }, [])
  const severity = matches.some((match) => match.severity === 'danger')
    ? 'danger'
    : matches.some((match) => match.severity === 'warning')
      ? 'warning'
      : null
  return { severity, matches }
}

function getRiskBadgePalette(severity) {
  if (severity === 'danger') {
    return {
      border: '1px solid var(--ai-chat-risk-danger-border)',
      background: 'var(--ai-chat-risk-danger-bg)',
      color: 'var(--ai-chat-risk-danger-fg)',
    }
  }
  if (severity === 'warning') {
    return {
      border: '1px solid var(--ai-chat-risk-warning-border)',
      background: 'var(--ai-chat-risk-warning-bg)',
      color: 'var(--ai-chat-risk-warning-fg)',
    }
  }
  return null
}

function getRiskHighlightStyle(severity) {
  if (severity === 'danger') {
    return {
      color: 'var(--ai-chat-risk-danger-fg)',
      borderRadius: 6,
      padding: '0 2px',
      backgroundImage: 'repeating-linear-gradient(90deg, var(--ai-chat-risk-danger-stripe-strong) 0px, var(--ai-chat-risk-danger-stripe-strong) 10px, var(--ai-chat-risk-danger-stripe-soft) 10px, var(--ai-chat-risk-danger-stripe-soft) 20px)',
    }
  }
  return {
    color: 'var(--ai-chat-risk-warning-fg)',
    borderRadius: 6,
    padding: '0 2px',
    backgroundImage: 'repeating-linear-gradient(90deg, var(--ai-chat-risk-warning-stripe-strong) 0px, var(--ai-chat-risk-warning-stripe-strong) 10px, var(--ai-chat-risk-warning-stripe-soft) 10px, var(--ai-chat-risk-warning-stripe-soft) 20px)',
  }
}

function renderCommandWithRiskHighlights(command, matches) {
  if (!matches.length) {
    return command
  }
  const segments = []
  let cursor = 0
  matches.forEach((match, index) => {
    if (cursor < match.start) {
      segments.push(command.slice(cursor, match.start))
    }
    segments.push(
      <span key={`${match.start}-${match.end}-${index}`} style={getRiskHighlightStyle(match.severity)}>
        {command.slice(match.start, match.end)}
      </span>,
    )
    cursor = match.end
  })
  if (cursor < command.length) {
    segments.push(command.slice(cursor))
  }
  return segments
}

function getCommandMutationPalette(isMutating) {
  if (isMutating) {
    return {
      cardBorder: '1px solid var(--ai-chat-command-write-card-border)',
      cardBackground: 'var(--ai-chat-command-write-card-bg)',
      cardBoxShadow: 'var(--ai-chat-command-write-card-shadow)',
      headerBackground: 'var(--ai-chat-command-write-header-bg)',
      metaBadgeBorder: '1px solid var(--ai-chat-command-write-badge-border)',
      metaBadgeBackground: 'var(--ai-chat-command-write-badge-bg)',
      metaBadgeColor: 'var(--ai-chat-command-write-badge-fg)',
      commandBorder: '1px solid var(--ai-chat-command-write-panel-border)',
      commandBackground: 'var(--ai-chat-command-write-panel-bg)',
    }
  }
  return {
    cardBorder: '1px solid var(--ai-chat-command-read-card-border)',
    cardBackground: 'var(--ai-chat-command-read-card-bg)',
    cardBoxShadow: 'var(--ai-chat-command-read-card-shadow)',
    headerBackground: 'var(--ai-chat-command-read-header-bg)',
    metaBadgeBorder: '1px solid var(--ai-chat-command-read-badge-border)',
    metaBadgeBackground: 'var(--ai-chat-command-read-badge-bg)',
    metaBadgeColor: 'var(--ai-chat-command-read-badge-fg)',
    commandBorder: '1px solid var(--ai-chat-command-read-panel-border)',
    commandBackground: 'var(--ai-chat-command-read-panel-bg)',
  }
}

function normalizeAICommandStatus(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function processCommandOutputCarriageReturns(input) {
  const source = typeof input === 'string' ? input : ''
  if (!source.includes('\r')) {
    return source
  }
  return source.split('\n').map((line) => {
    const segments = line.split('\r')
    if (segments.length === 1) {
      return line
    }
    let current = Array.from(segments[0] || '')
    for (const segment of segments.slice(1)) {
      if (!segment) {
        continue
      }
      const segmentRunes = Array.from(segment)
      if (segmentRunes.length >= current.length) {
        current = segmentRunes
        continue
      }
      const next = [...current]
      for (let index = 0; index < segmentRunes.length; index += 1) {
        next[index] = segmentRunes[index]
      }
      current = next
    }
    return current.join('')
  }).join('\n')
}

function processCommandOutputBackspaces(input) {
  const source = typeof input === 'string' ? input : ''
  if (!source.includes('\b')) {
    return source
  }
  const output = []
  for (const ch of Array.from(source)) {
    if (ch === '\b') {
      if (output.length > 0) {
        output.pop()
      }
      continue
    }
    output.push(ch)
  }
  return output.join('')
}

const ansiEscapePattern = /\u001B(?:\][\s\S]*?(?:\u0007|\u001B\\)|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const invisibleCommandOutputControlCharacterPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F-\u009F]/g

function normalizeCommandOutputForDisplay(value) {
  let output = typeof value === 'string' ? value : ''
  if (!output) {
    return ''
  }
  output = output.replace(/\r\n/g, '\n')
  output = processCommandOutputCarriageReturns(output)
  output = processCommandOutputBackspaces(output)
  output = output.replace(ansiEscapePattern, '')
  output = output.replace(invisibleCommandOutputControlCharacterPattern, '')
  return output.trim()
}

const runningStatusKey = '执行中'

export default function AIChatCommandCard({ purpose, command, output, status = runningStatusKey, extra = {} }) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const normalizedStatus = useMemo(() => normalizeAICommandStatus(status), [status])
  const displayOutput = useMemo(() => normalizeCommandOutputForDisplay(output), [output])
  const expanded = isExpanded || ((normalizedStatus === '等待处理' || normalizedStatus === '后台继续' || normalizedStatus === '已终止') && Boolean(displayOutput))
  const normalizedCommand = String(command || '')
  const riskState = useMemo(() => assessSensitiveCommandRisk(normalizedCommand), [normalizedCommand])
  const riskBadgePalette = useMemo(() => getRiskBadgePalette(riskState.severity), [riskState.severity])
  const highlightedCommand = useMemo(() => renderCommandWithRiskHighlights(normalizedCommand, riskState.matches), [normalizedCommand, riskState.matches])
  const isMutating = extra?.isMutating === true
  const mutationPalette = useMemo(() => getCommandMutationPalette(isMutating), [isMutating])
  const commandModeLabel = isMutating ? t('修改') : t('只读')
  const targetLabel = typeof extra?.targetLabel === 'string' ? extra.targetLabel.trim() : ''
  const targetCwd = typeof extra?.targetCwd === 'string' ? extra.targetCwd.trim() : ''
  const resultTokenEstimateDisplay = typeof extra?.resultTokenEstimateDisplay === 'string' ? extra.resultTokenEstimateDisplay.trim() : ''
  const outputContainerRef = useRef(null)
  const shouldAutoFollowOutputRef = useRef(true)
  const outputScrollFrameRef = useRef(0)

  const cancelScheduledOutputScroll = () => {
    if (outputScrollFrameRef.current) {
      window.cancelAnimationFrame(outputScrollFrameRef.current)
      outputScrollFrameRef.current = 0
    }
  }

  const scrollOutputToBottom = () => {
    const container = outputContainerRef.current
    if (!container || !shouldAutoFollowOutputRef.current) {
      return
    }
    container.scrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
  }

  const scheduleOutputScrollToBottom = () => {
    if (!expanded || !displayOutput || !shouldAutoFollowOutputRef.current || outputScrollFrameRef.current) {
      return
    }
    outputScrollFrameRef.current = window.requestAnimationFrame(() => {
      outputScrollFrameRef.current = 0
      scrollOutputToBottom()
      window.requestAnimationFrame(() => {
        scrollOutputToBottom()
      })
    })
  }

  useEffect(() => {
    if (!expanded || !displayOutput) {
      return undefined
    }
    scheduleOutputScrollToBottom()
    return undefined
  }, [displayOutput, expanded, status])

  useEffect(() => {
    return () => {
      cancelScheduledOutputScroll()
    }
  }, [])

  const handleOutputScroll = () => {
    const container = outputContainerRef.current
    if (!container) {
      return
    }
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    shouldAutoFollowOutputRef.current = distanceToBottom <= 12
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
        <div style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <TerminalSquare size={14} color="var(--text-secondary)" />
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t('执行命令')}</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {riskBadgePalette ? (
            <div style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', textTransform: 'uppercase', ...riskBadgePalette }}>
              {t(riskState.severity)}
            </div>
          ) : null}
          <div style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(var(--warning-rgb), 0.35)', background: 'rgba(var(--warning-rgb), 0.08)', color: 'var(--warning)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {t(normalizedStatus)}
          </div>
          {resultTokenEstimateDisplay ? (
            <div style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))', background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-overlay))', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {resultTokenEstimateDisplay}
            </div>
          ) : null}
          {output ? (
            <button
              type="button"
              onClick={() => setIsExpanded((previous) => !previous)}
              style={{
                width: 24,
                height: 24,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}>
              <ChevronDown
                size={14}
                color="var(--text-tertiary)"
                style={{
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 300ms ease',
                }}
              />
            </button>
          ) : null}
        </div>
      </div>
      <div style={{ width: '100%', border: mutationPalette.cardBorder, borderRadius: 8, background: mutationPalette.cardBackground, boxShadow: mutationPalette.cardBoxShadow, overflow: 'hidden' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', background: mutationPalette.headerBackground }}>
          <div style={{ minWidth: 0, display: 'grid', gap: 5 }}>
            <div style={{ minWidth: 0, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.5, wordBreak: 'break-word' }}>
              <span style={{ display: 'inline-block', marginRight: 6, padding: '1px 6px', borderRadius: 4, border: mutationPalette.metaBadgeBorder, background: mutationPalette.metaBadgeBackground, color: mutationPalette.metaBadgeColor, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'baseline' }}>
                {commandModeLabel}
              </span>
              {targetLabel ? (
                <span style={{ display: 'inline-block', marginRight: 6, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'rgba(var(--accent-rgb), 0.08)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', verticalAlign: 'baseline' }}>
                  {targetLabel}
                </span>
              ) : null}
              {purpose}
            </div>
            {targetCwd ? (
              <div style={{ minWidth: 0, padding: '0 0 0 10px', borderLeft: '3px solid var(--accent)', borderTop: '1px solid rgba(var(--accent-rgb), 0.08)' }}>
                <div style={{ color: 'rgba(var(--accent-rgb), 0.92)', fontSize: 13, fontWeight: 700, lineHeight: 1.6, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  {targetCwd}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ padding: '12px 12px 10px', display: 'grid', gap: 10 }}>
          <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: riskState.severity === 'danger' ? '1px solid rgba(var(--danger-rgb), 0.24)' : riskState.severity === 'warning' ? '1px solid rgba(var(--warning-rgb), 0.24)' : mutationPalette.commandBorder, background: riskState.severity ? 'var(--surface-base)' : mutationPalette.commandBackground, color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto', overflowX: 'auto' }}>{highlightedCommand}</pre>
          {expanded && displayOutput ? (
            <pre ref={outputContainerRef} onScroll={handleOutputScroll} style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflowY: 'auto', overflowX: 'auto' }}>{t(displayOutput)}</pre>
          ) : null}
        </div>
      </div>
    </div>
  )
}