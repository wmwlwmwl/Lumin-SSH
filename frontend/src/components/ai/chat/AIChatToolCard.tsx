import { Check, ChevronDown, Copy, FileCode2, FileText, RotateCcw, SquarePen, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Tiptop from '../../Tiptop.tsx'
import { useTranslation, type I18nKey } from '../../../i18n.ts'
import AIChatMarkdown from './AIChatMarkdown.tsx'

function normalizeAIMessageStatus(value: unknown) {
	return typeof value === 'string' ? value.trim() : ''
}

interface ReadFileTokenEstimate {
	path: string
	displayPath: string
	tokenCount: number
	tokenDisplay: string
}

function normalizeReadFileTokenEstimates(value: unknown): ReadFileTokenEstimate[] {
	if (!Array.isArray(value)) {
		return []
	}
	return value.flatMap((item) => {
		if (!item || typeof item !== 'object') {
			return []
		}
		const rawItem = item as Record<string, unknown>
		const path = typeof rawItem.path === 'string' ? rawItem.path.trim() : ''
		if (!path) {
			return []
		}
		const displayPath = typeof rawItem.displayPath === 'string' && rawItem.displayPath.trim()
			? rawItem.displayPath.trim()
			: path
		const parsedTokenCount = Number(rawItem.tokenCount)
		const tokenCount = Number.isFinite(parsedTokenCount) ? Math.max(0, Math.trunc(parsedTokenCount)) : 0
		const tokenDisplay = typeof rawItem.tokenDisplay === 'string' && rawItem.tokenDisplay.trim()
			? rawItem.tokenDisplay.trim()
			: `${(tokenCount / 1000000).toFixed(6)}M`
		return [{ path, displayPath, tokenCount, tokenDisplay }]
	})
}

function ReadFileTokenList({ items, t }: { items: ReadFileTokenEstimate[]; t: (key: I18nKey, vars?: Record<string, unknown>) => string }) {
	const [copiedPathIndex, setCopiedPathIndex] = useState<number | null>(null)
	useEffect(() => {
		if (copiedPathIndex === null) {
			return undefined
		}
		const timeoutId = window.setTimeout(() => {
			setCopiedPathIndex(null)
		}, 1200)
		return () => {
			window.clearTimeout(timeoutId)
		}
	}, [copiedPathIndex])
	if (items.length === 0) {
		return null
	}
	return (
		<div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
			<style>{`
				@keyframes ai-chat-read-file-path-marquee {
					0% { transform: translateX(0); }
					100% { transform: translateX(-50%); }
				}
			`}</style>
			{items.map((item, index) => {
				const copied = copiedPathIndex === index
				return (
					<div
						key={`${item.path}-${index}`}
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: 10,
							minWidth: 0,
							padding: '7px 10px',
							border: '1px solid rgba(var(--accent-rgb), 0.75)',
							borderRadius: 6,
							background: 'var(--surface-base)',
							color: 'var(--text-secondary)',
							fontFamily: 'var(--font-mono)',
							fontSize: 12,
							lineHeight: 1.35,
						}}>
						<div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
							<Tiptop text={item.displayPath} style={{ display: 'flex', minWidth: 0, flex: 1 }}>
								<div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
									<div style={{ display: 'flex', width: 'max-content', minWidth: '100%', alignItems: 'center', animation: 'ai-chat-read-file-path-marquee 4s linear infinite', willChange: 'transform' }}>
										<span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingRight: 32 }}>{item.displayPath}</span>
										<span aria-hidden="true" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingRight: 32 }}>{item.displayPath}</span>
									</div>
								</div>
							</Tiptop>
							<Tiptop text={copied ? t('已复制' as I18nKey) : t('复制绝对路径' as I18nKey)} style={{ display: 'inline-flex', flexShrink: 0 }}>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										void navigator.clipboard.writeText(item.path).then(() => {
											setCopiedPathIndex(index)
										}).catch(() => {})
									}}
									style={{
										width: 22,
										height: 22,
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										borderRadius: 6,
										border: copied ? '1px solid color-mix(in srgb, var(--success) 30%, var(--border))' : '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
										background: copied ? 'color-mix(in srgb, var(--success) 8%, var(--surface-base))' : 'color-mix(in srgb, var(--accent) 6%, var(--surface-base))',
										color: copied ? 'var(--success)' : 'var(--text-secondary)',
										cursor: 'pointer',
										flexShrink: 0,
									}}>
									{copied ? <Check size={11} color="currentColor" strokeWidth={2.5} /> : <Copy size={11} color="currentColor" strokeWidth={2.5} />}
								</button>
							</Tiptop>
						</div>
						<span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{item.tokenDisplay}</span>
					</div>
				)
			})}
		</div>
	)
}

function normalizeCompactDiffText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : ''
}

function splitCompactDiffLines(value: unknown) {
  const normalized = normalizeCompactDiffText(value)
  if (normalized === '') {
    return []
  }
  return normalized.split('\n')
}

/** 对齐后的左右行对 */
interface CompactAlignedPair {
  left: string | null
  right: string | null
  equal: boolean
}

/** 紧凑差异预览行 */
type CompactDiffRow =
  | { type: 'file'; text: string; key: string }
  | { type: 'meta'; text: string; key: string; oldLineNumber: null; newLineNumber: null }
  | { type: 'add' | 'remove' | 'context'; text: string; key: string; oldLineNumber: number | null; newLineNumber: number | null }
  | { type: 'hidden'; count: number; key: string }

function buildCompactAlignedLinePairs(leftLines: string[], rightLines: string[]): CompactAlignedPair[] {
  const maxProduct = 32000
  if (leftLines.length * rightLines.length > maxProduct) {
    const prefixPairs = []
    let prefix = 0
    while (prefix < leftLines.length && prefix < rightLines.length && leftLines[prefix] === rightLines[prefix]) {
      prefixPairs.push({ left: leftLines[prefix], right: rightLines[prefix], equal: true })
      prefix += 1
    }
    let leftSuffix = leftLines.length - 1
    let rightSuffix = rightLines.length - 1
    const suffixPairs = []
    while (leftSuffix >= prefix && rightSuffix >= prefix && leftLines[leftSuffix] === rightLines[rightSuffix]) {
      suffixPairs.unshift({ left: leftLines[leftSuffix], right: rightLines[rightSuffix], equal: true })
      leftSuffix -= 1
      rightSuffix -= 1
    }
    const middleLeft = leftLines.slice(prefix, leftSuffix + 1)
    const middleRight = rightLines.slice(prefix, rightSuffix + 1)
    const middlePairs = []
    const maxLength = Math.max(middleLeft.length, middleRight.length)
    for (let index = 0; index < maxLength; index += 1) {
      middlePairs.push({
        left: index < middleLeft.length ? middleLeft[index] : null,
        right: index < middleRight.length ? middleRight[index] : null,
        equal: false,
      })
    }
    return [...prefixPairs, ...middlePairs, ...suffixPairs]
  }
  const dp = Array.from({ length: leftLines.length + 1 }, () => new Array(rightLines.length + 1).fill(0))
  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (leftLines[leftIndex] === rightLines[rightIndex]) {
        dp[leftIndex][rightIndex] = dp[leftIndex + 1][rightIndex + 1] + 1
      } else {
        dp[leftIndex][rightIndex] = Math.max(dp[leftIndex + 1][rightIndex], dp[leftIndex][rightIndex + 1])
      }
    }
  }
  const rawPairs = []
  let leftCursor = 0
  let rightCursor = 0
  while (leftCursor < leftLines.length && rightCursor < rightLines.length) {
    if (leftLines[leftCursor] === rightLines[rightCursor]) {
      rawPairs.push({ left: leftLines[leftCursor], right: rightLines[rightCursor], equal: true })
      leftCursor += 1
      rightCursor += 1
      continue
    }
    if (dp[leftCursor + 1][rightCursor] >= dp[leftCursor][rightCursor + 1]) {
      rawPairs.push({ left: leftLines[leftCursor], right: null, equal: false })
      leftCursor += 1
    } else {
      rawPairs.push({ left: null, right: rightLines[rightCursor], equal: false })
      rightCursor += 1
    }
  }
  while (leftCursor < leftLines.length) {
    rawPairs.push({ left: leftLines[leftCursor], right: null, equal: false })
    leftCursor += 1
  }
  while (rightCursor < rightLines.length) {
    rawPairs.push({ left: null, right: rightLines[rightCursor], equal: false })
    rightCursor += 1
  }
  const alignedPairs = []
  let pairCursor = 0
  while (pairCursor < rawPairs.length) {
    if (rawPairs[pairCursor].equal) {
      alignedPairs.push(rawPairs[pairCursor])
      pairCursor += 1
      continue
    }
    const removed = []
    const added = []
    while (pairCursor < rawPairs.length && !rawPairs[pairCursor].equal) {
      if (rawPairs[pairCursor].left !== null) {
        removed.push(rawPairs[pairCursor].left)
      }
      if (rawPairs[pairCursor].right !== null) {
        added.push(rawPairs[pairCursor].right)
      }
      pairCursor += 1
    }
    const maxLength = Math.max(removed.length, added.length)
    for (let index = 0; index < maxLength; index += 1) {
      alignedPairs.push({
        left: index < removed.length ? removed[index] : null,
        right: index < added.length ? added[index] : null,
        equal: false,
      })
    }
  }
  return alignedPairs
}

function buildCompactVisibleRanges(rows: Array<{ equal: boolean }>, contextLines = 4): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  rows.forEach((row, index) => {
    if (row.equal) {
      return
    }
    const start = Math.max(0, index - contextLines)
    const end = Math.min(rows.length - 1, index + contextLines)
    const previousRange = ranges[ranges.length - 1]
    if (previousRange && start <= previousRange.end + 1) {
      previousRange.end = Math.max(previousRange.end, end)
      return
    }
    ranges.push({ start, end })
  })
  return ranges
}

function buildCompactDiffRowsFromBlocks(blocks: unknown, t: (key: I18nKey, vars?: Record<string, unknown>) => string): CompactDiffRow[] {
  const rows: CompactDiffRow[] = []
  const normalizedBlocks = Array.isArray(blocks) ? blocks.filter((block) => block && typeof block === 'object') : []
  normalizedBlocks.forEach((block, blockIndex) => {
    const rawBlock = block as Record<string, unknown>
    const beforeLines = splitCompactDiffLines(rawBlock.before)
    const afterLines = splitCompactDiffLines(rawBlock.after)
    const alignedPairs = buildCompactAlignedLinePairs(beforeLines, afterLines)
    let oldLineNumber = 1
    let newLineNumber = 1
    const pairRows = alignedPairs.map((pair) => {
      const nextRow = {
        equal: pair.equal,
        leftText: pair.left,
        rightText: pair.right,
        oldLineNumber: pair.left !== null ? oldLineNumber : null,
        newLineNumber: pair.right !== null ? newLineNumber : null,
      }
      if (pair.left !== null) {
        oldLineNumber += 1
      }
      if (pair.right !== null) {
        newLineNumber += 1
      }
      return nextRow
    })
    const visibleRanges = buildCompactVisibleRanges(pairRows)
    if (visibleRanges.length === 0) {
      return
    }
    const labelKey = typeof rawBlock.label === 'string' && rawBlock.label.trim() ? rawBlock.label.trim() : '文件 #{count}'
    const labelParams = rawBlock?.labelParams && typeof rawBlock.labelParams === 'object'
      ? rawBlock.labelParams as Record<string, unknown>
      : { count: blockIndex + 1 }
    rows.push({
      type: 'file',
      // labelKey 为 AI 返回动态键（可能不在翻译表），t() 内部有兜底
      text: t(labelKey as I18nKey, labelParams),
      key: `file-${blockIndex}`,
    })
    let previousEnd = -1
    visibleRanges.forEach((range, rangeIndex) => {
      if (range.start > previousEnd + 1) {
        rows.push({
          type: 'hidden',
          count: range.start - previousEnd - 1,
          key: `hidden-${blockIndex}-${rangeIndex}`,
        })
      }
      for (let pairIndex = range.start; pairIndex <= range.end; pairIndex += 1) {
        const pairRow = pairRows[pairIndex]
        if (pairRow.equal) {
          rows.push({
            type: 'context',
            oldLineNumber: pairRow.oldLineNumber,
            newLineNumber: pairRow.newLineNumber,
            text: pairRow.leftText ?? pairRow.rightText ?? '',
            key: `context-${blockIndex}-${pairIndex}`,
          })
          continue
        }
        if (pairRow.leftText !== null) {
          rows.push({
            type: 'remove',
            oldLineNumber: pairRow.oldLineNumber,
            newLineNumber: null,
            text: pairRow.leftText,
            key: `remove-${blockIndex}-${pairIndex}`,
          })
        }
        if (pairRow.rightText !== null) {
          rows.push({
            type: 'add',
            oldLineNumber: null,
            newLineNumber: pairRow.newLineNumber,
            text: pairRow.rightText,
            key: `add-${blockIndex}-${pairIndex}`,
          })
        }
      }
      previousEnd = range.end
    })
    if (previousEnd < pairRows.length - 1) {
      rows.push({
        type: 'hidden',
        count: pairRows.length - previousEnd - 1,
        key: `hidden-tail-${blockIndex}`,
      })
    }
  })
  return rows
}

function buildCompactDiffRowsFromRawDiff(rawDiff: string): CompactDiffRow[] {
  const lines = normalizeCompactDiffText(rawDiff).split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.map((text, index): CompactDiffRow => {
    if (text.startsWith('diff --git')) {
      return { type: 'file', text, key: `raw-file-${index}` }
    }
    if (text.startsWith('@@') || text.startsWith('index ') || text.startsWith('---') || text.startsWith('+++')) {
      return { type: 'meta', oldLineNumber: null, newLineNumber: null, text, key: `raw-meta-${index}` }
    }
    if (text.startsWith('+') && !text.startsWith('+++')) {
      return { type: 'add', oldLineNumber: null, newLineNumber: null, text: text.slice(1), key: `raw-add-${index}` }
    }
    if (text.startsWith('-') && !text.startsWith('---')) {
      return { type: 'remove', oldLineNumber: null, newLineNumber: null, text: text.slice(1), key: `raw-remove-${index}` }
    }
    return {
      type: 'context',
      oldLineNumber: null,
      newLineNumber: null,
      text: text.startsWith(' ') ? text.slice(1) : text,
      key: `raw-context-${index}`,
    }
  })
}

function buildCompactDiffRows(rawDiff: string, reviewBlocks: unknown, t: (key: I18nKey, vars?: Record<string, unknown>) => string): CompactDiffRow[] {
  const blockRows = buildCompactDiffRowsFromBlocks(reviewBlocks, t)
  if (blockRows.length > 0) {
    return blockRows
  }
  return buildCompactDiffRowsFromRawDiff(rawDiff)
}

function resolveCompactDiffRowPalette(row: CompactDiffRow) {
  switch (row?.type) {
    case 'file':
      return { color: 'var(--text-primary)', background: 'rgba(var(--accent-rgb), 0.08)' }
    case 'meta':
      return { color: 'var(--accent)', background: 'rgba(var(--accent-rgb), 0.08)' }
    case 'add':
      return { color: 'var(--success)', background: 'rgba(var(--success-rgb), 0.10)' }
    case 'remove':
      return { color: 'var(--danger)', background: 'rgba(var(--danger-rgb), 0.10)' }
    default:
      return { color: 'var(--text-primary)', background: 'transparent' }
  }
}

interface CompactDiffPreviewProps {
  reviewBlocks?: unknown
  rawDiff?: string
  loading?: boolean
  t: (key: I18nKey, vars?: Record<string, unknown>) => string
  lang: string
}

function CompactDiffPreview({ reviewBlocks = [], rawDiff = '', loading = false, t, lang }: CompactDiffPreviewProps) {
  const normalizedRawDiff = typeof rawDiff === 'string' ? rawDiff.trim() : ''
  const rows = useMemo(() => buildCompactDiffRows(normalizedRawDiff, reviewBlocks, t), [normalizedRawDiff, reviewBlocks, t, lang])
  if (loading) {
    return (
      <div style={{ padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 12 }}>
        {t('加载中...')}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 12 }}>
        {t('暂无可预览差异')}
      </div>
    )
  }
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--surface-base)', overflow: 'hidden' }}>
      <div style={{ maxHeight: 240, overflow: 'auto', overscrollBehavior: 'contain', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '18px' }}>
        {rows.map((row, index) => {
          if (row.type === 'hidden') {
            return (
              <div
                key={row.key}
                style={{
                  padding: '6px 12px',
                  borderTop: '1px solid var(--border-subtle)',
                  borderBottom: '1px solid var(--border-subtle)',
                  color: 'var(--text-tertiary)',
                  background: 'rgba(var(--accent-rgb), 0.04)',
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {`··· ${row.count} ···`}
              </div>
            )
          }
          const palette = resolveCompactDiffRowPalette(row)
          if (row.type === 'file') {
            return (
              <div
                key={row.key}
                style={{
                  padding: '6px 10px',
                  background: palette.background,
                  color: palette.color,
                  borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.02)',
                  fontWeight: 700,
                  wordBreak: 'break-all',
                }}>
                {row.text}
              </div>
            )
          }
          const linePrefix = row.type === 'add' ? '+ ' : row.type === 'remove' ? '- ' : row.type === 'meta' ? '' : '  '
          return (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '52px 52px minmax(0, 1fr)',
                minWidth: 0,
                background: palette.background,
                borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.02)',
              }}>
              <div
                style={{
                  padding: '0 8px 0 10px',
                  color: 'var(--text-tertiary)',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border-subtle)',
                  userSelect: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {row.oldLineNumber ?? ''}
              </div>
              <div
                style={{
                  padding: '0 8px',
                  color: 'var(--text-tertiary)',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border-subtle)',
                  userSelect: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {row.newLineNumber ?? ''}
              </div>
              <div
                style={{
                  padding: '0 10px',
                  color: palette.color,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                  minWidth: 0,
                }}>
                {row.type === 'meta' ? row.text : `${linePrefix}${row.text || ' '}`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export interface AIChatToolCardProps {
  restoreArtifactPath?: string
  copyContent?: string
  actionLabel?: string
  title?: string
  summary?: string
  code?: string
  result?: string
  status?: string
  remainingFileEdits?: number
  extra?: Record<string, unknown>
  isLast?: boolean
  hasSubsequentAssistantMessage?: boolean
  onPreviewRestore?: (path: string, targetTerminalId?: string) => void
  onPreviewDiffFetch?: (path: string, targetTerminalId?: string) => Promise<unknown>
  onApplyRestore?: (path: string, targetTerminalId?: string) => boolean | Promise<boolean | null | undefined>
}

export default function AIChatToolCard({ restoreArtifactPath = '', copyContent = '', actionLabel, title, summary, code, result = '', status, remainingFileEdits = 0, extra = {}, isLast = false, hasSubsequentAssistantMessage = false, onPreviewRestore, onPreviewDiffFetch, onApplyRestore }: AIChatToolCardProps) {
  const { t, lang } = useTranslation()
  const [isAutoExpanded, setIsAutoExpanded] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [restored, setRestored] = useState(false)
  const [inlineDiffReview, setInlineDiffReview] = useState<Record<string, unknown> | null>(null)
  const [inlineDiffLoading, setInlineDiffLoading] = useState(false)

  useEffect(() => {
    if (isLast) {
      setIsAutoExpanded(true)
    }
  }, [isLast])

  useEffect(() => {
    if (hasSubsequentAssistantMessage) {
      setIsAutoExpanded(false)
    }
  }, [hasSubsequentAssistantMessage])

  const normalizedRestoreArtifactPath = typeof restoreArtifactPath === 'string' ? restoreArtifactPath.trim() : ''
  const showRevertTitleButton = ['apply_diff', 'write_to_file', 'search_replace', 'edit_file', 'apply_patch'].includes(String(actionLabel || '').trim())
  const showInlineDiffPreview = showRevertTitleButton && extra?.conversationDiffHasPreview === true && Boolean(normalizedRestoreArtifactPath) && typeof onPreviewDiffFetch === 'function'

  useEffect(() => {
    let cancelled = false
    if (!showInlineDiffPreview) {
      setInlineDiffReview(null)
      setInlineDiffLoading(false)
      return undefined
    }
    setInlineDiffLoading(true)
    onPreviewDiffFetch(normalizedRestoreArtifactPath)
      .then((review) => {
        if (cancelled) {
          return
        }
        setInlineDiffReview(review && typeof review === 'object' ? review as Record<string, unknown> : null)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setInlineDiffReview(null)
      })
      .finally(() => {
        if (!cancelled) {
          setInlineDiffLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [normalizedRestoreArtifactPath, onPreviewDiffFetch, showInlineDiffPreview])

  const normalizedStatus = useMemo(() => normalizeAIMessageStatus(status), [status])
  const expanded = isExpanded || ((isAutoExpanded && !hasSubsequentAssistantMessage) || ((normalizedStatus === '错误' || normalizedStatus === '已终止') && Boolean(result)))
  const statusPalette = useMemo(() => {
    switch (normalizedStatus) {
      case '待审阅':
      case '待批准':
        return {
          border: '1px solid rgba(var(--warning-rgb), 0.35)',
          background: 'rgba(var(--warning-rgb), 0.08)',
          color: 'var(--warning)',
          tone: 'warning',
        }
      case '执行中':
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

  const normalizedRemainingFileEdits = Number.isFinite(Number(remainingFileEdits)) ? Math.max(0, Math.trunc(Number(remainingFileEdits))) : 0
  const showRemainingFileEdits = normalizedRemainingFileEdits > 0
  const normalizedCopyContent = typeof copyContent === 'string' ? copyContent.trim() : ''
  const copyCharacterCount = normalizedCopyContent ? normalizedCopyContent.length : 0
  const showCopyCharacterCount = copyCharacterCount > 0
  const resultTokenEstimateDisplay = typeof extra?.resultTokenEstimateDisplay === 'string' ? extra.resultTokenEstimateDisplay.trim() : ''
  const readFileTokenEstimates = String(actionLabel || '').trim() === 'read_file' ? normalizeReadFileTokenEstimates(extra?.readFileTokenEstimates) : []
  const inlineDiffRaw = typeof inlineDiffReview?.rawDiff === 'string' ? inlineDiffReview.rawDiff : ''
  const inlineDiffBlocks = Array.isArray(inlineDiffReview?.blocks) ? inlineDiffReview.blocks : []

  const handleToggleExpand = () => {
    setIsAutoExpanded(false)
    setIsExpanded((previous) => !previous)
  }

  const handlePreviewRestore = () => {
    if (restored || !normalizedRestoreArtifactPath) {
      return
    }
    void onPreviewRestore?.(normalizedRestoreArtifactPath)
  }

  const handleApplyRestore = async () => {
    if (restored || !normalizedRestoreArtifactPath) {
      return
    }
    const applied = await onApplyRestore?.(normalizedRestoreArtifactPath)
    if (applied === true) {
      setRestored(true)
    }
  }

  const handleCopyFullContent = async (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!normalizedCopyContent) {
      return
    }
    try {
      await navigator.clipboard.writeText(normalizedCopyContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
        <div style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <FileCode2 size={14} color="var(--text-secondary)" />
          {/* title 为 AI 返回动态文案（可能不在翻译表），t() 内部有兜底 */}
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t(title as I18nKey)}</span>
          {showCopyCharacterCount ? (
            <Tiptop text={copied ? t('已复制') : t('复制完整 diff/内容')} style={{ display: 'inline-flex' }}>
              <button
                type="button"
                onClick={handleCopyFullContent}
                style={{
                  height: 22,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '0 8px',
                  borderRadius: 999,
                  border: copied ? '1px solid color-mix(in srgb, var(--success) 32%, var(--border))' : '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
                  background: copied ? 'color-mix(in srgb, var(--success) 10%, var(--surface-overlay))' : 'color-mix(in srgb, var(--accent) 8%, var(--surface-overlay))',
                  color: copied ? 'var(--success)' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}>
                <FileText size={11} color={copied ? 'currentColor' : 'var(--accent)'} />
                <span>{copied ? t('已复制') : String(copyCharacterCount)}</span>
              </button>
            </Tiptop>
          ) : null}
          {showRevertTitleButton ? (
            <Tiptop text={restored ? t('已还原') : t('左键预览/右键还原')} style={{ display: 'inline-flex' }}>
              <button
                type="button"
                onClick={restored ? undefined : (event) => {
                  event.stopPropagation()
                  handlePreviewRestore()
                }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onContextMenu={restored ? undefined : (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void handleApplyRestore()
                }}
                style={{
                  height: 22,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '0 8px',
                  borderRadius: 999,
                  border: restored ? '1px solid color-mix(in srgb, var(--success) 32%, var(--border))' : '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
                  background: restored ? 'color-mix(in srgb, var(--success) 10%, var(--surface-overlay))' : 'color-mix(in srgb, var(--accent) 8%, var(--surface-overlay))',
                  color: restored ? 'var(--success)' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: restored ? 'default' : 'pointer',
                  flexShrink: 0,
                }}>
                <RotateCcw size={11} color={restored ? 'currentColor' : 'var(--accent)'} />
                <span>{restored ? t('已还原') : t('还原')}</span>
              </button>
            </Tiptop>
          ) : null}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {status ? (
            <div style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4, border: statusPalette.border, background: statusPalette.background, color: statusPalette.color }}>
              {statusPalette.tone === 'success' ? <Check size={11} color="currentColor" strokeWidth={2.5} /> : null}
              {statusPalette.tone === 'danger' ? <X size={11} color="currentColor" strokeWidth={2.5} /> : null}
              {/* 同 title：动态状态文案兜底 */}
              <span>{t(normalizedStatus as I18nKey)}</span>
            </div>
          ) : null}
          {resultTokenEstimateDisplay ? (
            <div style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))', background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-overlay))', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {resultTokenEstimateDisplay}
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleToggleExpand}
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
        </div>
      </div>
      <div style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-overlay)', overflow: 'hidden' }}>
        <div
          style={{
            padding: '10px 12px',
            borderBottom: expanded || showInlineDiffPreview ? '1px solid var(--border-subtle)' : 'none',
            background: 'var(--surface-overlay)',
            display: 'grid',
            gap: 4,
          }}>
          {showRemainingFileEdits ? (
            <div
              style={{
                display: 'inline-flex',
                width: '100%',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
                background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-overlay))',
                color: 'var(--text-primary)',
                fontSize: 11,
                fontWeight: 700,
              }}>
              <SquarePen size={12} color="var(--accent)" />
              <span>{t('预计剩余 {count} 个编辑文件').replace('{count}', String(normalizedRemainingFileEdits))}</span>
            </div>
          ) : (
            <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>{actionLabel}</div>
          )}
          {readFileTokenEstimates.length > 0 ? (
            <ReadFileTokenList items={readFileTokenEstimates} t={t} />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-all' }}>
              <AIChatMarkdown text={summary} enableQuoteContextMenu={true} />
            </div>
          )}
        </div>
        {showInlineDiffPreview ? (
          <div style={{ padding: '12px' }}>
            <CompactDiffPreview reviewBlocks={inlineDiffBlocks} rawDiff={inlineDiffRaw} loading={inlineDiffLoading} t={t} lang={lang} />
          </div>
        ) : null}
        {expanded ? (
          <div style={{ display: 'grid', gap: 10, padding: '12px', borderTop: showInlineDiffPreview ? '1px solid var(--border-subtle)' : 'none' }}>
            <pre style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto', overflowX: 'auto', overscrollBehavior: 'contain' }}>{code}</pre>
            {result ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('result')}</div>
                <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-base)', color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflowY: 'auto', overflowX: 'auto', overscrollBehavior: 'contain' }}>{/* result 为动态内容（可能不在翻译表），t() 内部有兜底 */}{t(result as I18nKey)}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}