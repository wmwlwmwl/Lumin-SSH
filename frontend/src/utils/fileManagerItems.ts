import { formatPermissionDisplay } from './fileManagerChmodIdentity.ts';

// 远程/本地文件条目：ListDir 输出 + 本地传输占位的统一形状
export interface FileManagerFileItem {
  name: string
  isDirectory: boolean
  size?: number
  permission?: string
  mode?: string
  modifyTime?: number
  uid?: string
  gid?: string
  isSymlink?: boolean
  __rowKey?: string
  __luminDeletedPlaceholder?: boolean
  [key: string]: unknown
}

export interface FileManagerVirtualRange {
  startIndex?: unknown
  endIndex?: unknown
  [key: string]: unknown
}

export interface FileManagerVirtualRow {
  rowKey: string
  rowType: string
  logicalPath: string
  sourcePath: string
  isDirectory: boolean
  name: string
  item: FileManagerFileItem | null
}

export interface RowEffectState {
  logicalKey: string
  rowKey: string
  effect: string
  paneKey: string
  startedAt?: number
  durationMs?: number
}

export interface FileListViewAnchor {
  key: string
  offset: number
  scrollTop: number
}

export interface FileManagerPaneEffectState {
  pendingVisualEffects: Map<string, RowEffectState>
}

export interface FileManagerPaneViewState {
  pendingRestore: FileListViewAnchor | null
  lastVisibleAnchor: FileListViewAnchor | null
}

export function createFileManagerPaneEffectState(): FileManagerPaneEffectState {
  return {
    pendingVisualEffects: new Map(),
  };
}

export function createFileManagerPaneViewState(): FileManagerPaneViewState {
  return {
    pendingRestore: null,
    lastVisibleAnchor: null,
  };
}

export function createLocalItemShell(name: unknown, isDirectory: boolean, sourceItem: Record<string, unknown> = {}): FileManagerFileItem {
  const normalizedName = String(name || '').trim();
  return {
    name: normalizedName,
    isDirectory: Boolean(isDirectory),
    size: isDirectory ? 0 : Number(sourceItem?.size || 0),
    permission: String(sourceItem?.permission || '').trim(),
    mode: String(sourceItem?.mode || '').trim(),
    modifyTime: typeof sourceItem?.modifyTime === 'number' ? sourceItem.modifyTime : Date.now(),
    uid: String(sourceItem?.uid || '-').trim() || '-',
    gid: String(sourceItem?.gid || '-').trim() || '-',
  };
}

export function upsertLocalItem(items: FileManagerFileItem[], nextItem: FileManagerFileItem): FileManagerFileItem[] {
  const currentItems = Array.isArray(items) ? items : [];
  const normalizedName = String(nextItem?.name || '').trim();
  if (!normalizedName) {
    return currentItems;
  }
  const filteredItems = currentItems.filter((item) => String(item?.name || '').trim() !== normalizedName);
  return [...filteredItems, { ...nextItem, name: normalizedName }];
}

export function cloneFileManagerItemsForCache(items: unknown): FileManagerFileItem[] {
  return Array.isArray(items)
    ? items
      .filter((item) => item && typeof item === 'object' && !item.__luminDeletedPlaceholder)
      .map((item) => ({ ...item }))
    : [];
}

export function getParentPath(path: unknown) {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  const parts = normalizedPath.split('/').filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `/${parts.join('/')}` : '/';
}

export function buildDirectoryItemFromPath(path: unknown): FileManagerFileItem {
  const normalizedPath = String(path || '').trim();
  const safePath = !normalizedPath ? '/' : normalizedPath;
  if (safePath === '/') {
    return {
      name: '',
      isDirectory: true,
      permission: '',
      mode: '',
      modifyTime: 0,
      size: 0,
    };
  }
  const parts = safePath.split('/').filter(Boolean);
  return {
    name: parts[parts.length - 1] || '',
    isDirectory: true,
    permission: '',
    mode: '',
    modifyTime: 0,
    size: 0,
  };
}

export function sortFileManagerItems(items: FileManagerFileItem[], sortField = 'name', sortDir = 'asc'): FileManagerFileItem[] {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let cmp = 0;
    switch (sortField) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'size': cmp = (a.size || 0) - (b.size || 0); break;
      case 'permissions': cmp = formatPermissionDisplay(a.permission || '-').localeCompare(formatPermissionDisplay(b.permission || '-')); break;
      case 'modified': cmp = new Date(a.modifyTime || 0).getTime() - new Date(b.modifyTime || 0).getTime(); break;
      default: cmp = 0;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

export const FILE_MANAGER_VIRTUAL_ROW_PARENT = 'parent';
export const FILE_MANAGER_VIRTUAL_ROW_ITEM = 'item';

export function buildFileManagerVirtualRows(items: FileManagerFileItem[], directoryPath: unknown): FileManagerVirtualRow[] {
  const normalizedItems = Array.isArray(items) ? items : [];
  const normalizedPath = String(directoryPath || '').trim() || '/';
  const rows = [];
  if (normalizedPath !== '/') {
    rows.push({
      rowKey: `__parent__:${normalizedPath}`,
      rowType: FILE_MANAGER_VIRTUAL_ROW_PARENT,
      logicalPath: getParentPath(normalizedPath),
      sourcePath: normalizedPath,
      isDirectory: true,
      name: '..',
      item: null,
    });
  }
  normalizedItems.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const logicalPath = normalizedPath === '/' ? `/${item.name}` : `${normalizedPath}/${item.name}`;
    rows.push({
      rowKey: item.__rowKey || logicalPath,
      rowType: FILE_MANAGER_VIRTUAL_ROW_ITEM,
      logicalPath,
      sourcePath: normalizedPath,
      isDirectory: item.isDirectory === true,
      name: item.name,
      item,
    });
  });
  return rows;
}

export function findFileManagerVirtualRowIndex(rows: FileManagerVirtualRow[], rowKey: unknown) {
  if (!rowKey) return -1;
  return Array.isArray(rows) ? rows.findIndex((row) => row?.rowKey === rowKey) : -1;
}

export function isFileManagerVirtualRangeVisible(range: FileManagerVirtualRange, index: number) {
  if (!range || index < 0) return false;
  return index >= Number(range.startIndex ?? 0) && index <= Number(range.endIndex ?? -1);
}

// Check if a file name is a hidden/system file that should be skipped
export function isHiddenFile(name: string) {
  return name.startsWith('.') || /^Thumbs\.db$/i.test(name) || /^desktop\.ini$/i.test(name);
}

// Recursively traverse a FileSystemEntry to collect all File objects
export function traverseEntry(entry: FileSystemEntry) {
  return new Promise<File[]>((resolve) => {
    if (entry.isFile) {
      if (isHiddenFile(entry.name)) {
        resolve([]);
        return;
      }
      (entry as FileSystemFileEntry).file((file) => {
        (file as File & { _fullPath?: string })._fullPath = entry.fullPath;
        resolve([file]);
      }, () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const allEntries: FileSystemEntry[] = [];
      let emptyCount = 0;
      function readBatch() {
        reader.readEntries((entries) => {
          if (entries.length === 0) {
            emptyCount++;
            // 连续两次返回空数组才确认读取完成（规避 Chrome readEntries 提前返回的 bug）
            if (emptyCount >= 2) {
              Promise.all(allEntries.map((e) => traverseEntry(e))).then((results) => {
                resolve(results.flat());
              });
            } else {
              readBatch();
            }
          } else {
            allEntries.push(...entries);
            emptyCount = 0;
            readBatch();
          }
        }, () => resolve([]));
      }
      readBatch();
    } else {
      resolve([]);
    }
  });
}
