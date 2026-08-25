export const HISTORY_SIZE = 60;

/** 文件内复用卡片基底（surface-raised + border + r8），等价于原先重复手写的卡片内联样式 */
export const CARD_SHELL = 'bg-raised border border-line rounded-lg';

/** 网卡统计（AppGo.NetworkInfo 返回的宽松结构） */
export interface NetworkInterfaceInfo {
  name?: string;
  uploadSpeed?: number;
  downloadSpeed?: number;
  uploadTotal?: number;
  downloadTotal?: number;
}

/** 连接对端 */
export interface ConnectionPeer {
  ip?: string;
  port?: string | number;
  location?: string;
  upload?: number;
  download?: number;
}

/** 监听端口连接条目 */
export interface NetworkConnection {
  pid?: string | number;
  name?: string;
  listenIP?: string;
  port?: string | number;
  ipCount?: number;
  connCount?: number;
  upload?: number;
  download?: number;
  peers?: ConnectionPeer[];
}

export interface NetworkState {
  uploadSpeed?: number;
  downloadSpeed?: number;
  uploadTotal?: number;
  downloadTotal?: number;
  interfaces?: NetworkInterfaceInfo[];
  connections?: NetworkConnection[];
}

export const connectionSortFns: Record<string, (a: NetworkConnection, b: NetworkConnection) => number> = {
  pid: (a, b) => Number(a.pid || 0) - Number(b.pid || 0),
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  listenIP: (a, b) => (a.listenIP || '').localeCompare(b.listenIP || ''),
  port: (a, b) => Number(a.port || 0) - Number(b.port || 0),
  ipCount: (a, b) => (a.ipCount || 0) - (b.ipCount || 0),
  connCount: (a, b) => (a.connCount || 0) - (b.connCount || 0),
  upload: (a, b) => (a.upload || 0) - (b.upload || 0),
  download: (a, b) => (a.download || 0) - (b.download || 0),
};

export const defaultConnectionColWidths: Record<string, number> = {
  pid: 70,
  name: 150,
  listenIP: 150,
  port: 80,
  ipCount: 70,
  connCount: 80,
  upload: 90,
  download: 90,
};
