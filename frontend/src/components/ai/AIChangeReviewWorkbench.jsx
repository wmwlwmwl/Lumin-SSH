import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from '../../i18n.js'

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n')
}

function splitLines(value) {
  const normalized = normalizeText(value)
  if (normalized === '') {
    return ['']
  }
  return normalized.split('\n')
}

function groupSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return []
  }
  const grouped = []
  for (const segment of segments) {
    const text = typeof segment?.text === 'string' ? segment.text : ''
    const kind = segment?.kind || 'equal'
    if (!text) {
      continue
    }
    const previous = grouped[grouped.length - 1]
    if (previous && previous.kind === kind) {
      previous.text += text
    } else {
      grouped.push({ kind, text })
    }
  }
  return grouped
}

function buildPrefixSuffixCharDiff(leftText, rightText) {
  const left = Array.from(leftText)
  const right = Array.from(rightText)
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1
  }
  let leftSuffix = left.length - 1
  let rightSuffix = right.length - 1
  while (leftSuffix >= prefix && rightSuffix >= prefix && left[leftSuffix] === right[rightSuffix]) {
    leftSuffix -= 1
    rightSuffix -= 1
  }

  const leftSegments = []
  const rightSegments = []

  if (prefix > 0) {
    const sharedPrefix = left.slice(0, prefix).join('')
    leftSegments.push({ kind: 'equal', text: sharedPrefix })
    rightSegments.push({ kind: 'equal', text: sharedPrefix })
  }

  const leftChanged = left.slice(prefix, leftSuffix + 1).join('')
  const rightChanged = right.slice(prefix, rightSuffix + 1).join('')

  if (leftChanged) {
    leftSegments.push({ kind: 'remove', text: leftChanged })
  }
  if (rightChanged) {
    rightSegments.push({ kind: 'add', text: rightChanged })
  }

  if (leftSuffix + 1 < left.length && rightSuffix + 1 < right.length) {
    const sharedSuffix = left.slice(leftSuffix + 1).join('')
    leftSegments.push({ kind: 'equal', text: sharedSuffix })
    rightSegments.push({ kind: 'equal', text: sharedSuffix })
  }

  return {
    leftSegments: groupSegments(leftSegments),
    rightSegments: groupSegments(rightSegments),
  }
}

function buildLCSCharDiff(leftText, rightText) {
  const left = Array.from(leftText)
  const right = Array.from(rightText)
  const maxProduct = 24000
  if (left.length * right.length > maxProduct) {
    return buildPrefixSuffixCharDiff(leftText, rightText)
  }

  const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const leftSegments = []
  const rightSegments = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      leftSegments.push({ kind: 'equal', text: left[i] })
      rightSegments.push({ kind: 'equal', text: right[j] })
      i += 1
      j += 1
      continue
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      leftSegments.push({ kind: 'remove', text: left[i] })
      i += 1
    } else {
      rightSegments.push({ kind: 'add', text: right[j] })
      j += 1
    }
  }
  while (i < left.length) {
    leftSegments.push({ kind: 'remove', text: left[i] })
    i += 1
  }
  while (j < right.length) {
    rightSegments.push({ kind: 'add', text: right[j] })
    j += 1
  }

  return {
    leftSegments: groupSegments(leftSegments),
    rightSegments: groupSegments(rightSegments),
  }
}

function buildAlignedLinePairs(leftLines, rightLines) {
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
  for (let i = leftLines.length - 1; i >= 0; i -= 1) {
    for (let j = rightLines.length - 1; j >= 0; j -= 1) {
      if (leftLines[i] === rightLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const rawPairs = []
  let i = 0
  let j = 0
  while (i < leftLines.length && j < rightLines.length) {
    if (leftLines[i] === rightLines[j]) {
      rawPairs.push({ left: leftLines[i], right: rightLines[j], equal: true })
      i += 1
      j += 1
      continue
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawPairs.push({ left: leftLines[i], right: null, equal: false })
      i += 1
    } else {
      rawPairs.push({ left: null, right: rightLines[j], equal: false })
      j += 1
    }
  }
  while (i < leftLines.length) {
    rawPairs.push({ left: leftLines[i], right: null, equal: false })
    i += 1
  }
  while (j < rightLines.length) {
    rawPairs.push({ left: null, right: rightLines[j], equal: false })
    j += 1
  }

  const aligned = []
  let cursor = 0
  while (cursor < rawPairs.length) {
    if (rawPairs[cursor].equal) {
      aligned.push(rawPairs[cursor])
      cursor += 1
      continue
    }
    const removed = []
    const added = []
    while (cursor < rawPairs.length && !rawPairs[cursor].equal) {
      if (rawPairs[cursor].left !== null) {
        removed.push(rawPairs[cursor].left)
      }
      if (rawPairs[cursor].right !== null) {
        added.push(rawPairs[cursor].right)
      }
      cursor += 1
    }
    const maxLength = Math.max(removed.length, added.length)
    for (let index = 0; index < maxLength; index += 1) {
      aligned.push({
        left: index < removed.length ? removed[index] : null,
        right: index < added.length ? added[index] : null,
        equal: false,
      })
    }
  }
  return aligned
}

function renderSegments(segments, side) {
  return segments.map((segment, index) => {
    let background = 'transparent'
    let color = 'var(--text-primary)'
    if (segment.kind === 'remove' && side === 'left') {
      background = 'rgba(var(--danger-rgb), 0.18)'
      color = 'var(--danger)'
    } else if (segment.kind === 'add' && side === 'right') {
      background = 'rgba(var(--success-rgb), 0.18)'
      color = 'var(--success)'
    }
    return (
      <span
        key={`${side}-segment-${index}`}
        style={{
          background,
          color,
          borderRadius: background === 'transparent' ? 0 : 4,
        }}>
        {segment.text || ' '}
      </span>
    )
  })
}

function useSyncedScroll() {
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const syncLockRef = useRef(false)

  const createScrollHandler = useCallback((source) => {
    return (event) => {
      if (syncLockRef.current) {
        return
      }
      const target = source === 'left' ? rightRef.current : leftRef.current
      if (!target) {
        return
      }
      syncLockRef.current = true
      target.scrollTop = event.currentTarget.scrollTop
      requestAnimationFrame(() => {
        syncLockRef.current = false
      })
    }
  }, [])

  return {
    leftRef,
    rightRef,
    onLeftScroll: createScrollHandler('left'),
    onRightScroll: createScrollHandler('right'),
  }
}

function DiffEditorPane({ rows, side, scrollRef, onScroll }) {
  return (
    <div
      style={{
        minWidth: 0,
        minHeight: 0,
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--surface-base)',
      }}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          overflow: 'auto',
          minHeight: 0,
          height: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: '20px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}>
        {rows.map((row, index) => (
          <div
            key={`${side}-row-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '56px minmax(0, 1fr)',
              minWidth: '100%',
              background: row.rowKind === 'modify'
                ? 'rgba(var(--accent-rgb), 0.04)'
                : row.rowKind === 'remove'
                  ? 'rgba(var(--danger-rgb), 0.06)'
                  : row.rowKind === 'add'
                    ? 'rgba(var(--success-rgb), 0.06)'
                    : 'transparent',
            }}>
            <div
              style={{
                padding: '0 10px 0 12px',
                color: row.lineNumber !== null ? 'var(--text-tertiary)' : 'transparent',
                textAlign: 'right',
                borderRight: '1px solid var(--border-subtle)',
                userSelect: 'none',
              }}>
              {row.lineNumber !== null ? row.lineNumber : '·'}
            </div>
            <div
              style={{
                padding: '0 12px',
                color: row.text === null ? 'transparent' : 'var(--text-primary)',
                minWidth: 0,
              }}>
              {row.text === null ? ' ' : renderSegments(row.segments, side)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DiffEditorPair({ block, index, showBlockBadge = false, t }) {
  const leftText = typeof block?.before === 'string' ? normalizeText(block.before) : ''
  const rightText = typeof block?.after === 'string' ? normalizeText(block.after) : ''
  const declaredStartLine = Number(block?.startLine)
  const matchedStartLine = Number(block?.matchedStartLine)
  const label = typeof block?.label === 'string' && block.label.trim() ? block.label.trim() : `${t('变更块')} #${index + 1}`

  const alignedRows = useMemo(() => {
    const leftLines = splitLines(leftText)
    const rightLines = splitLines(rightText)
    const pairs = buildAlignedLinePairs(leftLines, rightLines)

    let leftLineNumber = Number.isFinite(matchedStartLine) && matchedStartLine > 0
      ? matchedStartLine
      : Number.isFinite(declaredStartLine) && declaredStartLine > 0
        ? declaredStartLine
        : 1
    let rightLineNumber = Number.isFinite(matchedStartLine) && matchedStartLine > 0
      ? matchedStartLine
      : Number.isFinite(declaredStartLine) && declaredStartLine > 0
        ? declaredStartLine
        : 1

    return pairs.map((pair) => {
      const leftLine = pair.left
      const rightLine = pair.right
      const leftSegments = pair.equal
        ? [{ kind: 'equal', text: leftLine ?? '' }]
        : buildLCSCharDiff(leftLine ?? '', rightLine ?? '').leftSegments
      const rightSegments = pair.equal
        ? [{ kind: 'equal', text: rightLine ?? '' }]
        : buildLCSCharDiff(leftLine ?? '', rightLine ?? '').rightSegments

      const leftRow = {
        lineNumber: leftLine !== null ? leftLineNumber++ : null,
        text: leftLine,
        segments: leftLine !== null ? leftSegments : [],
        rowKind: pair.equal ? 'equal' : leftLine === null ? 'empty' : rightLine === null ? 'remove' : 'modify',
      }
      const rightRow = {
        lineNumber: rightLine !== null ? rightLineNumber++ : null,
        text: rightLine,
        segments: rightLine !== null ? rightSegments : [],
        rowKind: pair.equal ? 'equal' : rightLine === null ? 'empty' : leftLine === null ? 'add' : 'modify',
      }
      return { leftRow, rightRow }
    })
  }, [declaredStartLine, leftText, matchedStartLine, rightText])

  const leftRows = alignedRows.map((row) => row.leftRow)
  const rightRows = alignedRows.map((row) => row.rightRow)
  const { leftRef, rightRef, onLeftScroll, onRightScroll } = useSyncedScroll()

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: showBlockBadge ? 'auto 1fr' : '1fr',
        gap: showBlockBadge ? 8 : 0,
        minHeight: 0,
      }}>
      {showBlockBadge ? (
        <div style={{ display: 'inline-flex', width: 'fit-content', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-base)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}>
          <span>{label}</span>
          {Number.isFinite(matchedStartLine) && matchedStartLine > 0 ? (
            <span style={{ color: 'var(--success)' }}>{`L${matchedStartLine}`}</span>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 8,
          minHeight: 0,
          height: '100%',
        }}>
        <DiffEditorPane
          rows={leftRows}
          side="left"
          scrollRef={leftRef}
          onScroll={onLeftScroll}
        />
        <DiffEditorPane
          rows={rightRows}
          side="right"
          scrollRef={rightRef}
          onScroll={onRightScroll}
        />
      </div>
    </div>
  )
}

export default function AIChangeReviewWorkbench({ review, queueLength = 1 }) {
  const { t } = useTranslation()

  if (!review) {
    return null
  }

  const blocks = Array.isArray(review.blocks) ? review.blocks : []
  const path = typeof review.path === 'string' ? review.path : ''
  const toolName = typeof review.toolName === 'string' ? review.toolName : ''
  const showBlockBadge = blocks.length > 1

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: 6,
        background: 'rgba(var(--accent-rgb), 0.08)',
        backdropFilter: 'blur(4px)',
      }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 16,
          border: '1px solid rgba(var(--accent-rgb), 0.18)',
          background: 'linear-gradient(180deg, var(--surface-overlay), var(--surface-base))',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}>
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 12,
            right: 12,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            pointerEvents: 'none',
          }}>
          {toolName ? (
            <div style={{ padding: '3px 8px', borderRadius: 999, background: 'rgba(var(--accent-rgb), 0.08)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}>
              {toolName}
            </div>
          ) : null}
          {path ? (
            <div style={{ maxWidth: '100%', padding: '3px 8px', borderRadius: 999, background: 'var(--surface-base)', color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {path}
            </div>
          ) : null}
          {queueLength > 1 ? (
            <div style={{ padding: '3px 8px', borderRadius: 999, background: 'rgba(var(--warning-rgb), 0.10)', color: 'var(--warning)', fontSize: 11, fontWeight: 700 }}>
              {`${t('队列')} ${queueLength}`}
            </div>
          ) : null}
        </div>

        <div
          style={{
            height: '100%',
            padding: '42px 8px 10px',
            overflow: 'auto',
            display: 'grid',
            gap: 8,
            gridTemplateRows: blocks.length <= 1 ? '1fr' : `repeat(${blocks.length}, minmax(260px, 1fr))`,
          }}>
          {blocks.map((block, index) => (
            <DiffEditorPair
              key={`review-block-${review.reviewId}-${index}`}
              block={block}
              index={index}
              showBlockBadge={showBlockBadge}
              t={t}
            />
          ))}
        </div>

      </div>
    </div>
  )
}