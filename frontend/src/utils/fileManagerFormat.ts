import { getLanguage } from '../i18n.ts';

// 文件列表列宽 / 格式化辅助（无 React 状态依赖）
export const FILE_LIST_ACTIONS_COLUMN_WIDTH = 110;
export const FILE_LIST_NAME_MIN_WIDTH = 120;
export const FILE_LIST_SIZE_MIN_WIDTH = 60;
export const FILE_LIST_PERMISSION_MIN_WIDTH = 120;
export const FILE_LIST_MODIFIED_MIN_WIDTH = 110;
export const FILE_LIST_SIZE_MAX_WIDTH = 160;
export const FILE_LIST_PERMISSION_MAX_WIDTH = 420;
export const FILE_LIST_MODIFIED_MAX_WIDTH = 210;

export const fileListMeasureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

export function measureFileListTextWidth(text: unknown, font: unknown) {
  if (!fileListMeasureCanvas) {
    return String(text || '').length * 8;
  }
  const ctx = fileListMeasureCanvas.getContext('2d');
  if (!ctx) {
    return String(text || '').length * 8;
  }
  ctx.font = String(font || '');
  return ctx.measureText(String(text || '')).width;
}

export function clampFileListColumnWidth(width: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.ceil(width)));
}

export function fmtSize(bytes: unknown) {
  const normalizedBytes = Number(bytes) || 0;
  if (!normalizedBytes) return '-';
  if (normalizedBytes < 1024) return `${normalizedBytes} B`;
  if (normalizedBytes < 1024 ** 2) return `${(normalizedBytes / 1024).toFixed(1)} KB`;
  if (normalizedBytes < 1024 ** 3) return `${(normalizedBytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(normalizedBytes / 1024 ** 3).toFixed(1)} GB`;
}

// 格式化日期
export function fmtDate(ts: unknown) {
  if (!ts) return '-';
  const lang = getLanguage();
  const locale = typeof lang === 'string' && lang.trim() ? lang : 'zh-CN';
  const date = new Date(typeof ts === 'string' || typeof ts === 'number' ? ts : Number(ts) || 0);
  return date.toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function isMissingUnzipError(error: unknown) {
  const message = String(error || '').toLowerCase();
  return /(?:bash|sh):\s*unzip:\s*command not found/.test(message)
    || (message.includes('unzip') && message.includes('command not found'))
    || (message.includes('unzip') && message.includes('status 127'));
}

// 判断是否可以编辑（文本文件）
export function isEditable(name: string) {
  // ponytail: 以 . 开头的文件（如 .htaccess, .bashrc, .env）视为配置文件，默认可编辑
  if (name.startsWith('.')) return true;
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.ca-bundle')) return true;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const editable = [
    'txt', 'md', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'env', 'conf', 'config',
    'cer', 'crt', 'cert', 'pem', 'key', 'csr', 'pub', 'header', 'ca-bundle',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyw', 'pyi', 'rb', 'lua', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'hh', 'hxx', 'cs',
    'php', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg', 'sql', 'sh', 'bash', 'zsh', 'ksh', 'ps1', 'psm1', 'psd1',
    'pl', 'pm', 'vue', 'svelte', 'diff', 'patch', 'cmake',
    'list', 'sources', 'repo', 'nginx', 'gitignore', 'dockerfile', 'makefile',
  ];
  if (editable.includes(ext)) return true;
  // special filenames
  if (lowerName === 'dockerfile' || lowerName.startsWith('dockerfile.') || lowerName === 'cmakelists.txt' || lowerName === 'makefile' || lowerName === 'nginx.conf') {
    return true;
  }
  // No extension (like Dockerfile, Makefile)
  if (!name.includes('.')) return true;
  return false;
}
