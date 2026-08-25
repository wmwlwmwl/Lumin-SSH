/** 进程条目（GetFullProcessList 返回的宽松结构） */
export interface ProcessInfo {
  pid: string;
  cpu?: number;
  mem?: number;
  user?: string;
  name?: string;
  cmd?: string;
  loc?: string;
  stat?: string;
  nlwp?: number;
  etime?: string;
}

/** 右键菜单状态 */
export interface ProcessContextMenu {
  x: number;
  y: number;
  process: ProcessInfo;
  hasEnv: boolean | null;
}

/** 详情面板 reducer 动作 */
export type DetailAction =
  | { type: 'toggle'; process: ProcessInfo }
  | { type: 'close'; pid: string }
  | { type: 'closeAll' };

// ponytail: input is MB from Go backend (ps RSS KB → /1024 → MB)
export const fmem = (mb: number | undefined) => {
  const v = Number(mb);
  if (v < 1) return (v * 1024).toFixed(0) + 'K';
  if (v < 1024) return v.toFixed(1) + 'M';
  return (v / 1024).toFixed(1) + 'G';
};

export const sortFns: Record<string, (a: ProcessInfo, b: ProcessInfo) => number> = {
  pid: (a, b) => Number(a.pid) - Number(b.pid),
  cpu: (a, b) => (a.cpu || 0) - (b.cpu || 0),
  mem: (a, b) => (a.mem || 0) - (b.mem || 0),
  user: (a, b) => (a.user || '').localeCompare(b.user || ''),
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
};

export const ROW_H = 33;
export const OVERSCAN = 5;
export const TABLE_MIN_WIDTH = 760;
