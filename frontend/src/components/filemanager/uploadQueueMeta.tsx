import { Upload, Download, CheckCircle2, AlertCircle, Clock3 } from 'lucide-react';
import { type I18nKey } from '../../i18n.ts';
import { type TransferChunk, type TransferQueueItem } from '../../utils/fileWorkbench.ts';

// 传输队列面板的纯辅助：状态元数据、阶段文案、分块推导与折叠队列构建

export const MAX_RENDER_UPLOAD_CARDS = 1000;

export const ACTION_BTN_BASE = 'rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer whitespace-nowrap';
export const ACTION_BTN_NORMAL = `${ACTION_BTN_BASE} border border-line bg-canvas text-secondary`;
export const ACTION_BTN_DANGER = `${ACTION_BTN_BASE} border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] bg-[color-mix(in_srgb,var(--danger-dim)_72%,var(--surface-base))] text-danger`;

export const PROGRESS_FILL_COLOR: Record<string, string> = {
  failed: 'bg-danger',
  completed: 'bg-success',
};

/** helper 的 t 参数使用严格 I18nKey 签名（与 useTranslation 返回值一致） */
export type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string;

export function fmtSize(bytes: number | undefined) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function getStatusMeta(status: string, direction: string, t: LooseT) {
  if (status === 'uploading') {
    return { label: direction === 'download' ? t('下载中') : t('上传中'), color: 'var(--accent)', bg: 'var(--accent-dim)', Icon: direction === 'download' ? Download : Upload };
  }
  if (status === 'completed') {
    return { label: t('已完成'), color: 'var(--success)', bg: 'var(--success-dim)', Icon: CheckCircle2 };
  }
  if (status === 'failed') {
    return { label: t('失败'), color: 'var(--danger)', bg: 'var(--danger-dim)', Icon: AlertCircle };
  }
  return { label: t('排队中'), color: 'var(--text-tertiary)', bg: 'var(--surface-sunken)', Icon: Clock3 };
}

export function getChunkColor(status: string) {
  if (status === 'completed') return 'var(--success)';
  if (status === 'failed') return 'var(--danger)';
  if (status === 'retrying') return 'var(--warning)';
  if (status === 'uploading') return 'var(--accent)';
  if (status === 'reading') return 'color-mix(in srgb, var(--accent) 58%, var(--warning))';
  return 'var(--border)';
}

export function getChunkLabel(chunk: TransferChunk, t: LooseT) {
  if (chunk.status === 'completed') return t('已完成');
  if (chunk.status === 'failed') return t('失败');
  if (chunk.status === 'retrying') return t('重试中');
  if (chunk.status === 'uploading') return t('上传中');
  if (chunk.status === 'reading') return t('读取中');
  return t('排队中');
}

export function getUploadPhaseLabel(phase: string | undefined, direction: string, t: LooseT) {
  if (phase === 'preparing') return t('准备中');
  if (phase === 'scanning') return t('扫描中');
  if (phase === 'compressing') return direction === 'download' ? t('远端压缩中') : t('压缩中');
  if (phase === 'uploading') return direction === 'download' ? t('下载压缩包') : t('上传压缩包');
  if (phase === 'uploading-file') return t('上传文件');
  if (phase === 'uploading-file-completed') return t('已完成');
  if (phase === 'downloading') return t('下载中');
  if (phase === 'verifying') return t('修复中');
  if (phase === 'extracting') return direction === 'download' ? t('本地解压中') : t('远端解压中');
  if (phase === 'cleanup-local' || phase === 'cleanup-remote') return t('清理中');
  if (phase === 'completed') return t('已完成');
  if (phase === 'failed') return t('失败');
  return t('排队中');
}

export function formatCompressedPhaseBytes(item: TransferQueueItem, t: LooseT) {
  const bytesDone = Number(item.bytesUploaded) || 0;
  const bytesTotal = Number(item.bytesTotal) || 0;
  if (bytesTotal <= 0) {
    return t('当前阶段无字节指标');
  }
  return `${fmtSize(bytesDone)} / ${fmtSize(bytesTotal)}`;
}

export function getCompressedPhaseDetail(item: TransferQueueItem, t: LooseT) {
  const direction = item.direction || 'upload';
  if (item.phase === 'scanning') return item.phaseDetail || t('正在扫描待压缩项目');
  if (item.phase === 'compressing') return item.phaseDetail || (direction === 'download' ? t('正在远端打包压缩包') : t('正在构建本机 tar.gz 压缩包'));
  if (item.phase === 'uploading') return item.phaseDetail || (direction === 'download' ? t('正在下载压缩包到本地') : t('正在上传压缩包到远端'));
  if (item.phase === 'uploading-file') return item.phaseDetail || '';
  if (item.phase === 'uploading-file-completed') return item.phaseDetail || t('已完成');
  if (item.phase === 'downloading') return item.phaseDetail || t('下载中');
  if (item.phase === 'verifying') return item.phaseDetail || t('正在自动修复远端目录和已有文件权限');
  if (item.phase === 'cleanup-local') return t('正在删除本机临时压缩包');
  if (item.phase === 'extracting') return direction === 'download' ? t('正在解压到本地目录') : t('正在远端解压压缩包');
  if (item.phase === 'cleanup-remote') return t('正在清理远端压缩包');
  if (item.phase === 'completed') return direction === 'download' ? t('下载传输已完成') : t('压缩传输已完成');
  if (item.phase === 'failed') return item.error || (direction === 'download' ? t('下载传输失败') : t('压缩传输失败'));
  return item.phaseDetail || '';
}

interface CompressedPhaseChunks {
  chunks: TransferChunk[];
  chunkSizeBytes: number;
  chunksDone: number;
  chunksFailed: number;
  chunksActive: number;
}

export function buildCompressedPhaseChunks(item: TransferQueueItem): CompressedPhaseChunks {
  const bytesTotal = Math.max(0, Number(item.bytesTotal) || 0);
  if (bytesTotal <= 0) {
    return { chunks: [], chunkSizeBytes: 0, chunksDone: 0, chunksFailed: 0, chunksActive: 0 };
  }

  const chunkSizeBytes = Math.max(1, Number(item.chunkSizeBytes) || 256 * 1024);
  const bytesUploaded = Math.max(0, Number(item.bytesUploaded) || 0);
  const totalChunks = Math.max(1, Math.ceil(bytesTotal / chunkSizeBytes));
  const completedChunks = bytesUploaded >= bytesTotal
    ? totalChunks
    : Math.min(totalChunks, Math.floor(bytesUploaded / chunkSizeBytes));
  const hasPartialChunk = bytesUploaded > completedChunks * chunkSizeBytes && completedChunks < totalChunks;
  const failedChunkIndex = item.status === 'failed'
    ? Math.min(totalChunks - 1, completedChunks)
    : -1;
  const activeChunkIndex = item.status === 'uploading' && hasPartialChunk ? completedChunks : -1;

  const chunks: TransferChunk[] = Array.from({ length: totalChunks }, (_, index) => {
    if (index < completedChunks) {
      return { index, status: 'completed', attempt: 0, error: '' };
    }
    if (index === failedChunkIndex && item.status === 'failed') {
      return { index, status: 'failed', attempt: 0, error: item.error || '' };
    }
    if (index === activeChunkIndex) {
      return { index, status: 'uploading', attempt: 0, error: '' };
    }
    return { index, status: 'queued', attempt: 0, error: '' };
  });

  return {
    chunks,
    chunkSizeBytes,
    chunksDone: chunks.filter((chunk) => chunk.status === 'completed').length,
    chunksFailed: chunks.filter((chunk) => chunk.status === 'failed').length,
    chunksActive: chunks.filter((chunk) => chunk.status === 'uploading').length,
  };
}

export function getTransferErrorSummary(message: string, t: LooseT) {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return t('查看详情');
  }
  const firstLine = normalized.split(/\r?\n/)[0] || '';
  return firstLine.trim() || t('查看详情');
}

function isPriorityVisibleItem(item: TransferQueueItem, isAbortable?: (item: TransferQueueItem) => boolean) {
  return Boolean(isAbortable?.(item));
}

interface VisibleQueue {
  visibleItems: TransferQueueItem[];
  hiddenItems: TransferQueueItem[];
}

export function buildVisibleQueue(items: TransferQueueItem[], isAbortable?: (item: TransferQueueItem) => boolean): VisibleQueue {
  if (items.length <= MAX_RENDER_UPLOAD_CARDS) {
    return { visibleItems: items, hiddenItems: [] };
  }

  const visibleLimit = MAX_RENDER_UPLOAD_CARDS - 1;
  const activeItems = items.filter((item) => isPriorityVisibleItem(item, isAbortable));
  const visibleIds = new Set<string>();
  let visibleItems: TransferQueueItem[] = [];

  if (activeItems.length >= visibleLimit) {
    visibleItems = activeItems.slice(-visibleLimit);
    visibleItems.forEach((item) => visibleIds.add(item.id));
  } else {
    visibleItems = [...activeItems];
    activeItems.forEach((item) => visibleIds.add(item.id));
    for (let index = items.length - 1; index >= 0 && visibleItems.length < visibleLimit; index -= 1) {
      const item = items[index];
      if (visibleIds.has(item.id)) continue;
      visibleItems.push(item);
      visibleIds.add(item.id);
    }
    visibleItems.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  return {
    visibleItems,
    hiddenItems: items.filter((item) => !visibleIds.has(item.id)),
  };
}

export function renderActionButton(label: string, danger: boolean, onClick: () => void) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={danger ? ACTION_BTN_DANGER : ACTION_BTN_NORMAL}
    >
      {label}
    </button>
  );
}
