import { Check, ChevronDown, FileCode2, FileText, RotateCcw, SquarePen, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import Tiptop from '../../Tiptop.tsx';
import { useTranslation, type I18nKey } from '../../../i18n.ts';
import { cn } from '../../../utils/cn.ts';
import AIChatMarkdown from './AIChatMarkdown.tsx';
import { normalizeReadFileTokenEstimates, ReadFileTokenList } from './toolCard/ReadFileTokenList.tsx';
import CompactDiffPreview from './toolCard/CompactDiffPreview.tsx';

function normalizeAIMessageStatus(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export interface AIChatToolCardProps {
  restoreArtifactPath?: string;
  copyContent?: string;
  actionLabel?: string;
  title?: string;
  summary?: string;
  code?: string;
  result?: string;
  status?: string;
  remainingFileEdits?: number;
  extra?: Record<string, unknown>;
  isLast?: boolean;
  hasSubsequentAssistantMessage?: boolean;
  onPreviewRestore?: (path: string, targetTerminalId?: string) => void;
  onPreviewDiffFetch?: (path: string, targetTerminalId?: string) => Promise<unknown>;
  onApplyRestore?: (path: string, targetTerminalId?: string) => boolean | Promise<boolean | null | undefined>;
}

export default function AIChatToolCard({
  restoreArtifactPath = '',
  copyContent = '',
  actionLabel,
  title,
  summary,
  code,
  result = '',
  status,
  remainingFileEdits = 0,
  extra = {},
  isLast = false,
  hasSubsequentAssistantMessage = false,
  onPreviewRestore,
  onPreviewDiffFetch,
  onApplyRestore,
}: AIChatToolCardProps) {
  const { t, lang } = useTranslation();
  const [isAutoExpanded, setIsAutoExpanded] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restored, setRestored] = useState(false);
  const [inlineDiffReview, setInlineDiffReview] = useState<Record<string, unknown> | null>(null);
  const [inlineDiffLoading, setInlineDiffLoading] = useState(false);

  useEffect(() => {
    if (isLast) {
      setIsAutoExpanded(true);
    }
  }, [isLast]);

  useEffect(() => {
    if (hasSubsequentAssistantMessage) {
      setIsAutoExpanded(false);
    }
  }, [hasSubsequentAssistantMessage]);

  const normalizedRestoreArtifactPath = typeof restoreArtifactPath === 'string' ? restoreArtifactPath.trim() : '';
  const showRevertTitleButton = ['apply_diff', 'write_to_file', 'search_replace', 'edit_file', 'apply_patch'].includes(String(actionLabel || '').trim());
  const showInlineDiffPreview = showRevertTitleButton && extra?.conversationDiffHasPreview === true && Boolean(normalizedRestoreArtifactPath) && typeof onPreviewDiffFetch === 'function';

  useEffect(() => {
    let cancelled = false;
    if (!showInlineDiffPreview) {
      setInlineDiffReview(null);
      setInlineDiffLoading(false);
      return undefined;
    }
    setInlineDiffLoading(true);
    onPreviewDiffFetch(normalizedRestoreArtifactPath)
      .then((review) => {
        if (cancelled) {
          return;
        }
        setInlineDiffReview(review && typeof review === 'object' ? review as Record<string, unknown> : null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setInlineDiffReview(null);
      })
      .finally(() => {
        if (!cancelled) {
          setInlineDiffLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [normalizedRestoreArtifactPath, onPreviewDiffFetch, showInlineDiffPreview]);

  const normalizedStatus = useMemo(() => normalizeAIMessageStatus(status), [status]);
  const expanded = isExpanded || ((isAutoExpanded && !hasSubsequentAssistantMessage) || ((normalizedStatus === '错误' || normalizedStatus === '已终止') && Boolean(result)));

  const statusPalette = useMemo(() => {
    switch (normalizedStatus) {
      case '待审阅':
      case '待批准':
        return {
          border: '1px solid rgba(var(--warning-rgb), 0.35)',
          background: 'rgba(var(--warning-rgb), 0.08)',
          color: 'var(--warning)',
          tone: 'warning',
        };
      case '执行中':
        return {
          border: '1px solid rgba(var(--accent-rgb), 0.35)',
          background: 'rgba(var(--accent-rgb), 0.08)',
          color: 'var(--accent)',
          tone: 'accent',
        };
      case '错误':
      case '已终止':
      case '已拒绝':
        return {
          border: '1px solid rgba(var(--danger-rgb), 0.35)',
          background: 'rgba(var(--danger-rgb), 0.08)',
          color: 'var(--danger)',
          tone: 'danger',
        };
      default:
        return {
          border: '1px solid rgba(var(--success-rgb), 0.35)',
          background: 'rgba(var(--success-rgb), 0.08)',
          color: 'var(--success)',
          tone: 'success',
        };
    }
  }, [normalizedStatus]);

  const normalizedRemainingFileEdits = Number.isFinite(Number(remainingFileEdits)) ? Math.max(0, Math.trunc(Number(remainingFileEdits))) : 0;
  const showRemainingFileEdits = normalizedRemainingFileEdits > 0;
  const normalizedCopyContent = typeof copyContent === 'string' ? copyContent.trim() : '';
  const copyCharacterCount = normalizedCopyContent ? normalizedCopyContent.length : 0;
  const showCopyCharacterCount = copyCharacterCount > 0;
  const resultTokenEstimateDisplay = typeof extra?.resultTokenEstimateDisplay === 'string' ? extra.resultTokenEstimateDisplay.trim() : '';
  const readFileTokenEstimates = String(actionLabel || '').trim() === 'read_file' ? normalizeReadFileTokenEstimates(extra?.readFileTokenEstimates) : [];
  const inlineDiffRaw = typeof inlineDiffReview?.rawDiff === 'string' ? inlineDiffReview.rawDiff : '';
  const inlineDiffBlocks = Array.isArray(inlineDiffReview?.blocks) ? inlineDiffReview.blocks : [];

  const handleToggleExpand = () => {
    setIsAutoExpanded(false);
    setIsExpanded((previous) => !previous);
  };

  const handlePreviewRestore = () => {
    if (restored || !normalizedRestoreArtifactPath) {
      return;
    }
    void onPreviewRestore?.(normalizedRestoreArtifactPath);
  };

  const handleApplyRestore = async () => {
    if (restored || !normalizedRestoreArtifactPath) {
      return;
    }
    const applied = await onApplyRestore?.(normalizedRestoreArtifactPath);
    if (applied === true) {
      setRestored(true);
    }
  };

  const handleCopyFullContent = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!normalizedCopyContent) {
      return;
    }
    try {
      await navigator.clipboard.writeText(normalizedCopyContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="inline-flex min-w-0 flex-wrap items-center gap-2">
          <FileCode2 size={14} color="var(--text-secondary)" />
          <span className="font-bold text-primary">{t(title as I18nKey)}</span>
          {showCopyCharacterCount ? (
            <Tiptop text={copied ? t('已复制') : t('复制完整 diff/内容')} className="inline-flex">
              <button
                type="button"
                onClick={handleCopyFullContent}
                className={cn(
                  'inline-flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-xs font-bold',
                  copied
                    ? 'border border-[color-mix(in_srgb,var(--success)_32%,var(--border))] bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-overlay))] text-success'
                    : 'border border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-overlay))] text-secondary',
                )}>
                <FileText size={11} color={copied ? 'currentColor' : 'var(--accent)'} />
                <span>{copied ? t('已复制') : String(copyCharacterCount)}</span>
              </button>
            </Tiptop>
          ) : null}
          {showRevertTitleButton ? (
            <Tiptop text={restored ? t('已还原') : t('左键预览/右键还原')} className="inline-flex">
              <button
                type="button"
                onClick={restored ? undefined : (event) => {
                  event.stopPropagation();
                  handlePreviewRestore();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onContextMenu={restored ? undefined : (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleApplyRestore();
                }}
                className={cn(
                  'inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-full px-2 text-xs font-bold',
                  restored
                    ? 'cursor-default border border-[color-mix(in_srgb,var(--success)_32%,var(--border))] bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-overlay))] text-success'
                    : 'cursor-pointer border border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-overlay))] text-secondary',
                )}>
                <RotateCcw size={11} color={restored ? 'currentColor' : 'var(--accent)'} />
                <span>{restored ? t('已还原') : t('还原')}</span>
              </button>
            </Tiptop>
          ) : null}
        </div>
        <div className="inline-flex shrink-0 items-center gap-2">
          {status ? (
            <div style={{ border: statusPalette.border, background: statusPalette.background, color: statusPalette.color }} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold">
              {statusPalette.tone === 'success' ? <Check size={11} color="currentColor" strokeWidth={2.5} /> : null}
              {statusPalette.tone === 'danger' ? <X size={11} color="currentColor" strokeWidth={2.5} /> : null}
              <span>{t(normalizedStatus as I18nKey)}</span>
            </div>
          ) : null}
          {resultTokenEstimateDisplay ? (
            <div className="whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-overlay))] px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-secondary">
              {resultTokenEstimateDisplay}
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleToggleExpand}
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
        </div>
      </div>
      <div className="w-full overflow-hidden rounded-xl border border-line bg-overlay">
        <div
          className={cn(
            'grid gap-1 bg-overlay px-3 py-2.5',
            expanded || showInlineDiffPreview ? 'border-b border-b-line-subtle' : '',
          )}>
          {showRemainingFileEdits ? (
            <div
              className="inline-flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface-overlay))] px-2 py-1 text-xs font-bold text-primary">
              <SquarePen size={12} color="var(--accent)" />
              <span>{t('预计剩余 {count} 个编辑文件').replace('{count}', String(normalizedRemainingFileEdits))}</span>
            </div>
          ) : (
            <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-tertiary">{actionLabel}</div>
          )}
          {readFileTokenEstimates.length > 0 ? (
            <ReadFileTokenList items={readFileTokenEstimates} t={t} />
          ) : (
            <div className="break-all text-base font-semibold text-primary">
              <AIChatMarkdown text={summary} enableQuoteContextMenu={true} />
            </div>
          )}
        </div>
        {showInlineDiffPreview ? (
          <div className="p-3">
            <CompactDiffPreview reviewBlocks={inlineDiffBlocks} rawDiff={inlineDiffRaw} loading={inlineDiffLoading} t={t} lang={lang} />
          </div>
        ) : null}
        {expanded ? (
          <div className={cn('grid gap-2.5 p-3', showInlineDiffPreview ? 'border-t border-t-line-subtle' : '')}>
            <pre className="m-0 max-h-[260px] overflow-x-auto overflow-y-auto overscroll-contain whitespace-pre-wrap font-mono text-sm leading-[1.65] text-secondary [word-break:break-word]">{code}</pre>
            {result ? (
              <div className="grid gap-1.5">
                <div className="text-xs uppercase tracking-[0.4px] text-tertiary">{t('result')}</div>
                <pre className="m-0 max-h-[320px] overflow-x-auto overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-lg border border-line-subtle bg-canvas px-3 py-2.5 font-mono text-sm leading-[1.65] text-primary [word-break:break-word]">{t(result as I18nKey)}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
