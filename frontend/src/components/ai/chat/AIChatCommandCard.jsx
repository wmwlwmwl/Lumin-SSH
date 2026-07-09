import { ChevronDown, TerminalSquare } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n.js'
import AIChatMarkdown from './AIChatMarkdown.jsx'

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
      border: '1px solid rgba(var(--danger-rgb), 0.35)',
      background: 'rgba(var(--danger-rgb), 0.10)',
      color: '#fecdd3',
    }
  }
  if (severity === 'warning') {
    return {
      border: '1px solid rgba(var(--warning-rgb), 0.35)',
      background: 'rgba(var(--warning-rgb), 0.10)',
      color: '#fde68a',
    }
  }
  return null
}

function getRiskHighlightStyle(severity) {
  if (severity === 'danger') {
    return {
      color: '#fecdd3',
      borderRadius: 6,
      padding: '0 2px',
      backgroundImage: 'repeating-linear-gradient(90deg, rgba(244,63,94,0.26) 0px, rgba(244,63,94,0.26) 10px, rgba(244,63,94,0.10) 10px, rgba(244,63,94,0.10) 20px)',
    }
  }
  return {
    color: '#fde68a',
    borderRadius: 6,
    padding: '0 2px',
    backgroundImage: 'repeating-linear-gradient(90deg, rgba(245,158,11,0.24) 0px, rgba(245,158,11,0.24) 10px, rgba(245,158,11,0.10) 10px, rgba(245,158,11,0.10) 20px)',
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

const runningStatusKey = '运行中'

export default function AIChatCommandCard({ purpose, command, output, status = runningStatusKey, extra = {} }) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const expanded = isExpanded || ((status === '等待处理' || status === '后台继续' || status === '已终止') && Boolean(output))
  const normalizedCommand = String(command || '')
  const riskState = useMemo(() => assessSensitiveCommandRisk(normalizedCommand), [normalizedCommand])
  const riskBadgePalette = useMemo(() => getRiskBadgePalette(riskState.severity), [riskState.severity])
  const highlightedCommand = useMemo(() => renderCommandWithRiskHighlights(normalizedCommand, riskState.matches), [normalizedCommand, riskState.matches])
  const cardBorder = riskState.severity === 'danger' ? '1px solid rgba(var(--danger-rgb), 0.26)' : '1px solid rgba(var(--warning-rgb), 0.26)'
  const headerBackground = riskState.severity === 'danger' ? 'rgba(var(--danger-rgb), 0.06)' : 'rgba(var(--warning-rgb), 0.06)'
  const targetLabel = typeof extra?.targetLabel === 'string' ? extra.targetLabel.trim() : ''
  const targetCwd = typeof extra?.targetCwd === 'string' ? extra.targetCwd.trim() : ''

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
            {t(status)}
          </div>
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
      <div style={{ width: '100%', border: cardBorder, borderRadius: 12, background: 'var(--surface-overlay)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', background: headerBackground }}>
          <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-word' }}>
              <AIChatMarkdown text={purpose} />
            </div>
            {(targetLabel || targetCwd) ? (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                {targetLabel ? (
                  <div style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)', background: 'rgba(var(--accent-rgb), 0.08)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {targetLabel}
                  </div>
                ) : null}
                {targetCwd ? (
                  <div style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)', background: 'var(--surface-base)', color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                    {targetCwd}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ padding: '12px 12px 10px', display: 'grid', gap: 10 }}>
          <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: riskState.severity === 'danger' ? '1px solid rgba(var(--danger-rgb), 0.24)' : riskState.severity === 'warning' ? '1px solid rgba(var(--warning-rgb), 0.24)' : '1px solid var(--border)', background: 'var(--surface-base)', color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{highlightedCommand}</pre>
          {expanded && output ? (
            <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{output}</pre>
          ) : null}
        </div>
      </div>
    </div>
  )
}