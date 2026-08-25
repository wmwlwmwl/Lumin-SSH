// 探针/网络监控面板数据格式化工具函数
const STORAGE_UNITS = ['M', 'G', 'T', 'P'];
const RATE_UNITS = ['KB/s', 'MB/s', 'GB/s', 'TB/s'];

const finiteNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const clampPanelWidth = (width: unknown, min = 280, max = 560): number => {
  return Math.max(min, Math.min(max, Math.round(finiteNumber(width))));
};

export const formatCapacity = (mb: unknown, decimals = 1): string => {
  let value = finiteNumber(mb);
  if (value <= 0) return '0M';

  let unitIndex = 0;
  while (value >= 1024 && unitIndex < STORAGE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${value.toFixed(0)}${STORAGE_UNITS[unitIndex]}`;
  return `${value.toFixed(decimals)}${STORAGE_UNITS[unitIndex]}`;
};

export const formatTransferTotal = (mb: unknown): string => {
  const value = finiteNumber(mb);
  if (value <= 0) return '0 B';
  if (value < 1) return `${(value * 1024).toFixed(0)} KB`;
  return `${formatCapacity(value, value < 1024 ? 1 : 2)}B`;
};

export const formatRate = (kb: unknown): string => {
  let value = finiteNumber(kb);
  if (value <= 0) return '0 B/s';
  if (value < 1) return `${(value * 1024).toFixed(0)} B/s`;
  if (value < 1024) return `${value.toFixed(1)} KB/s`;

  value /= 1024;
  let unitIndex = 1;
  while (value >= 1024 && unitIndex < RATE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)} ${RATE_UNITS[unitIndex]}`;
};

export const formatPartitionCapacity = (raw: unknown): string => {
  if (typeof raw === 'number') return formatCapacity(raw, 1);
  if (raw == null) return '0M';

  const compact = String(raw).trim();
  const match = compact.match(/^(-?\d+(?:\.\d+)?)\s*([KMGTPE]?)(?:i?B?)?$/i);
  if (!match) return compact;

  const value = finiteNumber(match[1]);
  const unit = match[2].toUpperCase();
  const mb =
    unit === 'K' ? value / 1024 :
    unit === 'M' || unit === '' ? value :
    unit === 'G' ? value * 1024 :
    unit === 'T' ? value * 1024 * 1024 :
    unit === 'P' ? value * 1024 * 1024 * 1024 :
    value;

  return formatCapacity(mb, 1);
};
