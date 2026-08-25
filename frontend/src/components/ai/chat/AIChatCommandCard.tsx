import { Check, ChevronDown, TerminalSquare, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { useTranslation, type I18nKey } from '../../../i18n.ts'

const buildShellCommandPattern = (commandPattern: string) => new RegExp(`(^|[\\s|;&()])(${commandPattern})(?=\\s)`, 'gi')

interface CommandRiskRule {
  severity: 'danger' | 'warning'
  pattern: RegExp
}

const DANGEROUS_COMMAND_RULES: CommandRiskRule[] = [
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
const WARNING_COMMAND_RULES: CommandRiskRule[] = [
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`chmod`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`chown`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`mountvol`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`(?:mount|umount|diskmount|diskunmount)`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`(?:fsck|e2fsck|chkdsk|partprobe|resize2fs|tune2fs|xfs_repair)`) },
  { severity: 'warning', pattern: buildShellCommandPattern(String.raw`(?:New-Partition|Resize-Partition|Set-Disk|Set-Partition|diskutil\s+(?:partitionDisk|apfs|unmountDisk|eraseVolume))`) },
]
const SENSITIVE_COMMAND_RULES = [...DANGEROUS_COMMAND_RULES, ...WARNING_COMMAND_RULES]
const COMMAND_RISK_PRIORITY: Record<'danger' | 'warning', number> = { danger: 2, warning: 1 }

interface CommandRiskMatch {
  start: number
  end: number
  severity: 'danger' | 'warning'
}

function assessSensitiveCommandRisk(command: string): { severity: 'danger' | 'warning' | null; matches: CommandRiskMatch[] } {
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
  const matches = allMatches.reduce<CommandRiskMatch[]>((result, match) => {
    const lastMatch = result[result.length - 1]
    if (!lastMatch || match.start >= lastMatch.end) {
      result.push(match)
    }
    return result
  }, [])
  const severity = matches.some((match) => match.severity === 'danger')
    ? 'danger'
    : (matches.some((match) => match.severity === 'warning')
      ? 'warning'
      : null)
  return { severity, matches }
}

function getRiskBadgePalette(severity: 'danger' | 'warning' | null) {
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

// 风险高亮片段为动态着色（依赖匹配结果），保留内联样式
function getRiskHighlightStyle(severity: 'danger' | 'warning'): React.CSSProperties {
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

function renderCommandWithRiskHighlights(command: string, matches: CommandRiskMatch[]): ReactNode {
  if (!matches.length) {
    return command
  }
  const segments: ReactNode[] = []
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

// 读写命令卡片配色随 isMutating 动态切换，保留内联样式注入
function getCommandMutationPalette(isMutating: boolean) {
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

function normalizeAICommandStatus(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function processCommandOutputCarriageReturns(input: unknown) {
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

function processCommandOutputBackspaces(input: unknown) {
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

function normalizeCommandOutputForDisplay(value: unknown) {
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

interface AIChatCommandCardProps {
  purpose?: string
  command?: string
  output?: string
  status?: string
  extra?: Record<string, unknown>
}

export default function AIChatCommandCard({ purpose, command, output, status = runningStatusKey, extra = {} }: AIChatCommandCardProps) {
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
  // 状态徽标配色随后端状态动态切换，保留内联注入
  const statusPalette = useMemo(() => {
    switch (normalizedStatus) {
      case '待审阅':
      case '待批准':
      case '等待处理':
        return {
          border: '1px solid rgba(var(--warning-rgb), 0.35)',
          background: 'rgba(var(--warning-rgb), 0.08)',
          color: 'var(--warning)',
          tone: 'warning',
        }
      case '执行中':
      case '后台继续':
        return {
          border: '1px solid rgba(var(--accent-rgb), 0.35)',
          background: 'rgba(var(--accent-rgb), 0.08)',
          color: 'var(--accent)',
          tone: 'accent',
        }
      case '错误':
      case '已终止':
      case '已拒绝':
        return {
          border: '1px solid rgba(var(--danger-rgb), 0.35)',
          background: 'rgba(var(--danger-rgb), 0.08)',
          color: 'var(--danger)',
          tone: 'danger',
        }
      default:
        return {
          border: '1px solid rgba(var(--success-rgb), 0.35)',
          background: 'rgba(var(--success-rgb), 0.08)',
          color: 'var(--success)',
          tone: 'success',
        }
    }
  }, [normalizedStatus])
  const commandModeLabel = isMutating ? t('修改') : t('只读')
  const targetLabel = typeof extra?.targetLabel === 'string' ? extra.targetLabel.trim() : ''
  const targetCwd = typeof extra?.targetCwd === 'string' ? extra.targetCwd.trim() : ''
  const resultTokenEstimateDisplay = typeof extra?.resultTokenEstimateDisplay === 'string' ? extra.resultTokenEstimateDisplay.trim() : ''
  const hasDisplayOutput = Boolean(displayOutput)
  const {
    scrollRef: outputContainerRef,
    contentRef: outputContentRef,
    scrollToBottom: scrollOutputToBottom,
    stopScroll: stopOutputScroll,
  } = useStickToBottom({
    initial: 'instant',
    resize: 'smooth',
  })

  useEffect(() => {
    if (!expanded || !hasDisplayOutput) {
      stopOutputScroll()
      return
    }
    void scrollOutputToBottom('instant')
  }, [expanded, hasDisplayOutput, scrollOutputToBottom, stopOutputScroll])

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <TerminalSquare size={14} color="var(--text-secondary)" />
          <span className="font-bold text-primary">{t('执行命令')}</span>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2">
          {riskBadgePalette ? (
            <div style={riskBadgePalette} className="rounded-full px-2 py-0.5 text-xs font-bold uppercase whitespace-nowrap">
              {/* severity 在 riskBadgePalette 非空时必为 danger/warning，此处断言 */}
              {t((riskState.severity || '') as I18nKey)}
            </div>
          ) : null}
          <div style={{ border: statusPalette.border, background: statusPalette.background, color: statusPalette.color }} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold">
            {statusPalette.tone === 'success' ? <Check size={11} color="currentColor" strokeWidth={2.5} /> : null}
            {statusPalette.tone === 'danger' ? <X size={11} color="currentColor" strokeWidth={2.5} /> : null}
            {/* status 为后端返回的动态文案（可能不在翻译表），t() 内部有兜底 */}
            <span>{t(normalizedStatus as I18nKey)}</span>
          </div>
          {resultTokenEstimateDisplay ? (
            <div className="whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-overlay))] px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-secondary">
              {resultTokenEstimateDisplay}
            </div>
          ) : null}
          {output ? (
            <button
              type="button"
              onClick={() => setIsExpanded((previous) => !previous)}
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center border-none bg-transparent">
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
      <div style={{ border: mutationPalette.cardBorder, background: mutationPalette.cardBackground, boxShadow: mutationPalette.cardBoxShadow }} className="w-full overflow-hidden rounded-lg">
        <div style={{ background: mutationPalette.headerBackground }} className="border-b border-b-line-subtle px-2.5 py-2">
          <div className="grid min-w-0 gap-[5px]">
            <div className="min-w-0 text-sm font-semibold leading-[1.5] text-primary [word-break:break-word]">
              <span style={{ border: mutationPalette.metaBadgeBorder, background: mutationPalette.metaBadgeBackground, color: mutationPalette.metaBadgeColor }} className="mr-1.5 inline-block whitespace-nowrap rounded-sm border px-1.5 py-px align-baseline text-xs font-semibold">
                {commandModeLabel}
              </span>
              {targetLabel ? (
                <span className="mr-1.5 inline-block whitespace-nowrap rounded-sm border border-line-subtle bg-[rgba(var(--accent-rgb),0.08)] px-1.5 py-px align-baseline text-xs font-medium text-secondary">
                  {targetLabel}
                </span>
              ) : null}
              {purpose}
            </div>
            {targetCwd ? (
              <div className="min-w-0 border-l-[3px] border-l-accent border-t border-t-[rgba(var(--accent-rgb),0.08)] pl-2.5">
                <div className="break-all font-mono text-base font-bold leading-[1.6] text-accent">
                  {targetCwd}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid gap-2.5 px-3 pb-2.5 pt-3">
          <pre style={{ border: riskState.severity === 'danger' ? '1px solid rgba(var(--danger-rgb), 0.24)' : (riskState.severity === 'warning' ? '1px solid rgba(var(--warning-rgb), 0.24)' : mutationPalette.commandBorder), background: riskState.severity ? 'var(--surface-base)' : mutationPalette.commandBackground }} className="m-0 max-h-[260px] overflow-x-auto overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-lg px-3 py-2.5 font-mono text-sm leading-[1.65] text-primary [word-break:break-word]">{highlightedCommand}</pre>
          {expanded && displayOutput ? (
            <pre ref={outputContainerRef} className="m-0 max-h-[320px] overflow-x-auto overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-lg border border-line-subtle bg-canvas px-3 py-2.5 font-mono text-sm leading-[1.65] text-secondary [word-break:break-word]"><span ref={outputContentRef} style={{ display: 'block' }}>{t(displayOutput as I18nKey)}</span></pre>
          ) : null}
        </div>
      </div>
    </div>
  )
}
