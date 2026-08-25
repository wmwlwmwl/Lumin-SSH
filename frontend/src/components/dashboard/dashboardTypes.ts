/** 最近连接会话（宽松形状，来自 useSessionConnections） */
export interface DashboardSessionLike {
  id?: string;
  serverId?: string;
  status?: string;
  [key: string]: unknown;
}

export const maskSensitiveText = (value: string) => {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 2) return '*'.repeat(text.length);
  return `${text.slice(0, 1)}${'*'.repeat(Math.min(text.length - 2, 8))}${text.slice(-1)}`;
};
