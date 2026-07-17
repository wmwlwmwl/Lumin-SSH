import { ChevronDown, FileCode2, FileText, RotateCcw, SquarePen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Tiptop from '../../Tiptop.jsx'
import { useTranslation } from '../../../i18n.js'
import AIChatMarkdown from './AIChatMarkdown.jsx'

function normalizeAIMessageStatus(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export default function AIChatToolCard({ restoreArtifactPath = '', copyContent = '', actionLabel, title, summary, code, result = '', status, remainingFileEdits = 0, isLast = false, hasSubsequentAssistantMessage = false, onPreviewRestore, onApplyRestore }) {
  const { t } = useTranslation()
  const [isAutoExpanded, setIsAutoExpanded] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [restored, setRestored] = useState(false)

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

  useEffect(() => {
    if (!restored) {
      return undefined
    }
    const timer = window.setTimeout(() => setRestored(false), 1200)
    return () => window.clearTimeout(timer)
  }, [restored])

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
        }
      case '执行中':
        return {
          border: '1px solid rgba(var(--accent-rgb), 0.35)',
          background: 'rgba(var(--accent-rgb), 0.08)',
          color: 'var(--accent)',
        }
      case '错误':
      case '已终止':
      case '已拒绝':
        return {
          border: '1px solid rgba(var(--danger-rgb), 0.35)',
          background: 'rgba(var(--danger-rgb), 0.08)',
          color: 'var(--danger)',
        }
      default:
        return {
          border: '1px solid rgba(var(--success-rgb), 0.35)',
          background: 'rgba(var(--success-rgb), 0.08)',
          color: 'var(--success)',
        }
    }
  }, [normalizedStatus])

  const normalizedRemainingFileEdits = Number.isFinite(Number(remainingFileEdits)) ? Math.max(0, Math.trunc(Number(remainingFileEdits))) : 0
  const showRemainingFileEdits = normalizedRemainingFileEdits > 0
  const normalizedCopyContent = typeof copyContent === 'string' ? copyContent.trim() : ''
  const copyCharacterCount = normalizedCopyContent ? normalizedCopyContent.length : 0
  const showCopyCharacterCount = copyCharacterCount > 0
  const showRevertTitleButton = ['apply_diff', 'write_to_file', 'search_replace', 'edit_file', 'apply_patch'].includes(String(actionLabel || '').trim())

  const handleToggleExpand = () => {
    setIsAutoExpanded(false)
    setIsExpanded((previous) => !previous)
  }

  const handlePreviewRestore = () => {
    if (!restoreArtifactPath) {
      return
    }
    void onPreviewRestore?.(restoreArtifactPath)
  }

  const handleApplyRestore = async () => {
    if (!restoreArtifactPath) {
      return
    }
    const applied = await onApplyRestore?.(restoreArtifactPath)
    if (applied === true) {
      setRestored(true)
    }
  }

  const handleCopyFullContent = async (event) => {
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
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t(title)}</span>
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
                onClick={(event) => {
                  event.stopPropagation()
                  handlePreviewRestore()
                }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onContextMenu={(event) => {
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
                  cursor: 'pointer',
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
            <div style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', ...statusPalette }}>
              {t(normalizedStatus)}
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
            borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none',
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
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-all' }}>
            <AIChatMarkdown text={summary} enableQuoteContextMenu={true} />
          </div>
        </div>
        {expanded ? (
          <div style={{ display: 'grid', gap: 10, padding: '12px' }}>
            <pre style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto', overflowX: 'auto' }}>{code}</pre>
            {result ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('result')}</div>
                <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-base)', color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.65, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflowY: 'auto', overflowX: 'auto' }}>{t(result)}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}