import { type I18nKey } from '../i18n.ts';

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

export interface DownloadConflictSettings {
  strategy: string
  diffBySize: boolean
  diffByMtime: boolean
  renameSuffixMode: string
}

export interface FileManagerDownloadConflictSettings {
  strategy?: unknown
  diffBySize?: unknown
  diffByMtime?: unknown
  renameSuffixMode?: unknown
  pathStrategies?: unknown
}

// 文件编辑大小上限默认值（MB）；实际值由用户配置，组件内 maxEditSizeMB state 持有
export const DEFAULT_MAX_EDIT_SIZE_MB = 5;
export const MAX_CHUNK_UPLOAD_RETRIES = 5;
export const UPLOAD_ABORT_SENTINEL = '__LUMIN_UPLOAD_ABORTED__';
export const DEFAULT_FILE_MANAGER_DOWNLOAD_DIR = '${APP_DIR}\\download';
export const DOWNLOAD_CONFLICT_STRATEGY_DIFF_OVERWRITE = 'diff_overwrite';
export const DOWNLOAD_CONFLICT_STRATEGY_FORCE_OVERWRITE = 'force_overwrite';
export const DOWNLOAD_CONFLICT_STRATEGY_PROMPT = 'prompt';
export const DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME = 'auto_rename';
export const DOWNLOAD_RENAME_SUFFIX_TIMESTAMP = 'timestamp';
export const DOWNLOAD_RENAME_SUFFIX_RANDOM = 'random';
export const DOWNLOAD_RENAME_SUFFIX_SEQUENCE = 'sequence';
export const UPLOAD_PANEL_CLOSE_ANIMATION_MS = 100;

export function isCompressedTransferEnabled() {
  return localStorage.getItem('fileManagerCompressedTransfer') !== 'false';
}

export function shouldAutoOpenTransferQueue() {
  return localStorage.getItem('fileManagerAutoOpenTransferQueue') !== 'false';
}

export function getDownloadConflictSettingsFromStorage(): DownloadConflictSettings {
  return {
    strategy: localStorage.getItem('fileManagerDownloadConflictStrategy') || DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME,
    diffBySize: localStorage.getItem('fileManagerDownloadConflictDiffBySize') !== 'false',
    diffByMtime: localStorage.getItem('fileManagerDownloadConflictDiffByMtime') !== 'false',
    renameSuffixMode: localStorage.getItem('fileManagerDownloadRenameSuffixMode') || DOWNLOAD_RENAME_SUFFIX_SEQUENCE,
  };
}

export function buildDownloadConflictOptionsPayload(settings: FileManagerDownloadConflictSettings, overrides: FileManagerDownloadConflictSettings = {}) {
  const next = { ...settings, ...overrides };
  return JSON.stringify({
    strategy: next.strategy || DOWNLOAD_CONFLICT_STRATEGY_AUTO_RENAME,
    diffBySize: next.diffBySize !== false,
    diffByMtime: next.diffByMtime !== false,
    renameSuffixMode: next.renameSuffixMode || DOWNLOAD_RENAME_SUFFIX_SEQUENCE,
    pathStrategies: next.pathStrategies || {},
  });
}

export function downloadConflictKindLabel(kind: unknown, t: LooseT) {
  if (kind === 'directory') return t('文件夹');
  if (kind === 'file') return t('文件');
  return '-';
}

export function parsePositiveInt(value: unknown, fallback: number) {
  const parsed = parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function computeCompressedOverallProgress(phase: unknown, phaseProgress: unknown, currentProgress = 0) {
  const safePhaseProgress = Math.max(0, Math.min(100, Number(phaseProgress) || 0));
  const baseline = Math.max(0, Math.min(100, Number(currentProgress) || 0));
  switch (phase) {
    case 'compressing':
      return Math.max(baseline, safePhaseProgress * 0.5);
    case 'uploading':
      return Math.max(baseline, 50 + safePhaseProgress * 0.49);
    case 'uploading-file':
      return Math.max(baseline, safePhaseProgress);
    case 'completed':
      return 100;
    case 'preparing':
    case 'scanning':
    case 'extracting':
    case 'cleanup-local':
    case 'cleanup-remote':
    case 'failed':
    default:
      return baseline;
  }
}

// 读取 Blob 为 base64 字符串（去掉 data URL 前缀）
export function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawResult = reader.result;
      const dataUrl = typeof rawResult === 'string' ? rawResult : '';
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function createLimiter(limit: number): (fn: () => unknown) => Promise<unknown> {
  const max = Math.max(1, limit);
  let active = 0;
  const queue: Array<{ fn: () => unknown; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];
  const next = () => {
    if (active >= max || queue.length === 0) {
      return;
    }
    const entry = queue.shift();
    if (!entry) {
      return;
    }
    const { fn, resolve, reject } = entry;
    active++;
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

export function runWithLimit(items: unknown[], limit: number, handler: (item: unknown, index: number) => unknown) {
  const limiter = createLimiter(limit);
  return Promise.all(items.map((item, index) => limiter(() => handler(item, index))));
}

export function runWithLimitSettled<T>(items: T[], limit: number, handler: (item: T, index: number) => unknown): Promise<PromiseSettledResult<unknown>[]> {
  const limiter = createLimiter(limit);
  return Promise.all(items.map((item, index) => limiter(() => handler(item, index))
    .then((value) => ({ status: 'fulfilled', value }) as PromiseSettledResult<unknown>)
    .catch((reason) => ({ status: 'rejected', reason }) as PromiseSettledResult<unknown>)));
}

export async function uploadChunkWithRetry(label: string, uploadFn: () => Promise<unknown>, onAttempt?: (attempt: number, error: unknown) => void, shouldAbort?: () => boolean) {
  let firstError = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_CHUNK_UPLOAD_RETRIES; attempt++) {
    if (shouldAbort?.()) {
      throw new Error(UPLOAD_ABORT_SENTINEL);
    }
    try {
      onAttempt?.(attempt, null);
      return await uploadFn();
    } catch (error) {
      if (!firstError) firstError = error;
      lastError = error;
      onAttempt?.(attempt, error);
    }
  }
  const firstMessage = firstError instanceof Error ? firstError.message : String(firstError || '');
  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError || '');
  if (firstMessage && lastMessage && firstMessage !== lastMessage) {
    throw new Error(`${label} 重试 ${MAX_CHUNK_UPLOAD_RETRIES} 次后仍失败。首次错误: ${firstMessage}；最终错误: ${lastMessage}`);
  }
  throw new Error(`${label} 重试 ${MAX_CHUNK_UPLOAD_RETRIES} 次后仍失败: ${lastMessage || '未知错误'}`);
}
