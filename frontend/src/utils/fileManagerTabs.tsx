import { House } from 'lucide-react';
import { type I18nKey } from '../i18n.ts';

/** 与 fileWorkbench.FileManagerTabLike 兼容的宽松标签页形状 */
type FileManagerTabLike = import('./fileWorkbench').FileManagerTabLike
type FileManagerTab = import('./fileWorkbench').FileManagerTab

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string

interface FileManagerWorkspaceTab {
  pinned?: unknown
  systemPinned?: unknown
  id?: unknown
  path?: unknown
  customTitle?: unknown
}

interface FileManagerWorkspace {
  tabs?: unknown
}

export const FILE_MANAGER_INTERNAL_DRAG_MIME = 'application/x-lumin-file-manager-items';
export const FILE_MANAGER_NEW_TAB_PATH_MODE_INHERIT_CURRENT = 'inherit_current';
export const FILE_MANAGER_NEW_TAB_PATH_MODE_ROOT = 'root';
export const FILE_MANAGER_NEW_TAB_PATH_MODE_SESSION_INITIAL_PATH = 'session_initial_path';
export const FILE_MANAGER_NEW_TAB_PATH_MODE_TERMINAL_CWD = 'terminal_cwd';
export const FILE_MANAGER_SYSTEM_TAB_KIND_HOME = 'home';
export const FILE_MANAGER_SYSTEM_TAB_KIND_CWD = 'cwd';
export const FILE_MANAGER_LAYOUT_MODE_CLASSIC = 'classic';
export const FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL = 'sidebar_dual';

export function getFileManagerSystemTabType(tab: FileManagerTabLike | null | undefined) {
  if (String(tab?.systemPinnedType || '').trim() === FILE_MANAGER_SYSTEM_TAB_KIND_CWD) {
    return '';
  }
  if (tab?.systemPinned === true) {
    return FILE_MANAGER_SYSTEM_TAB_KIND_HOME;
  }
  return '';
}

export function areFileManagerTabStatesEqual(left: FileManagerTabLike | null | undefined, right: FileManagerTabLike | null | undefined) {
  if (!left || !right) {
    return false;
  }
  const leftSelectedPaths = Array.isArray(left.selectedPaths) ? left.selectedPaths : [];
  const rightSelectedPaths = Array.isArray(right.selectedPaths) ? right.selectedPaths : [];
  return String(left.id || '').trim() === String(right.id || '').trim()
    && String(left.path || '').trim() === String(right.path || '').trim()
    && String(left.customTitle || '').trim() === String(right.customTitle || '').trim()
    && String(left.sortField || '').trim() === String(right.sortField || '').trim()
    && String(left.sortDir || '').trim() === String(right.sortDir || '').trim()
    && leftSelectedPaths.length === rightSelectedPaths.length
    && leftSelectedPaths.every((path, index) => path === rightSelectedPaths[index])
    && Number.isFinite(Number(left.scrollTop)) === Number.isFinite(Number(right.scrollTop))
    && Number(left.scrollTop || 0) === Number(right.scrollTop || 0)
    && (left.pinned === true) === (right.pinned === true)
    && (left.systemPinned === true) === (right.systemPinned === true)
    && getFileManagerSystemTabType(left) === getFileManagerSystemTabType(right);
}

let fileManagerTabSequence = 0;

export function getFileManagerNewTabPathMode() {
  return localStorage.getItem('fileManagerNewTabPathMode') || FILE_MANAGER_NEW_TAB_PATH_MODE_INHERIT_CURRENT;
}

export function getFileManagerInitialPathMode() {
  return localStorage.getItem('fileManagerInitialPathMode') || FILE_MANAGER_NEW_TAB_PATH_MODE_SESSION_INITIAL_PATH;
}

export function shouldShowFileManagerTabIcons() {
  return localStorage.getItem('fileManagerShowTabIcons') !== 'false';
}

export function shouldHideFileManagerTabCloseButton() {
  return localStorage.getItem('fileManagerHideTabCloseButton') === 'true';
}

export function getFileManagerLayoutMode() {
  return localStorage.getItem('fileManagerLayoutMode') === FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL
    ? FILE_MANAGER_LAYOUT_MODE_SIDEBAR_DUAL
    : FILE_MANAGER_LAYOUT_MODE_CLASSIC;
}

export function isFileManagerSharedPinnedTabsEnabled() {
  return localStorage.getItem('fileManagerSharedPinnedTabs') === 'true';
}

export function isFileManagerDualPaneDragTransferEnabled() {
  return localStorage.getItem('fileManagerDualPaneDragTransferEnabled') !== 'false';
}

export function shouldPromptFileManagerDualPaneDragDirectory() {
  return localStorage.getItem('fileManagerDualPaneDragPromptOnDirectory') !== 'false';
}

export function shouldInvertFileManagerDualPaneDragModifier() {
  return localStorage.getItem('fileManagerDualPaneDragInvertModifier') === 'true';
}

export function createFileManagerTab(path = '', options: Record<string, unknown> = {}): FileManagerTab {
  fileManagerTabSequence += 1;
  return {
    id: `file-manager-tab-${Date.now()}-${fileManagerTabSequence}`,
    path: String(path || '').trim(),
    customTitle: String(options.customTitle || '').trim(),
    sortField: 'name',
    sortDir: 'asc',
    selectedPaths: [],
    scrollTop: 0,
    pinned: options.pinned === true || options.systemPinned === true,
    systemPinned: options.systemPinned === true,
    systemPinnedType: options.systemPinned === true ? FILE_MANAGER_SYSTEM_TAB_KIND_HOME : '',
  };
}

export function extractManualPinnedTabsFromWorkspace(workspace: FileManagerWorkspace) {
  const rawTabs = workspace?.tabs
  const tabs = Array.isArray(rawTabs) ? rawTabs : [];
  return tabs
    .filter((tab) => tab && tab.pinned === true && tab.systemPinned !== true)
    .map((tab) => ({
      id: String(tab.id || '').trim(),
      path: String(tab.path || '').trim(),
      customTitle: typeof tab.customTitle === 'string' ? tab.customTitle.trim() : '',
    }))
    .filter((tab) => tab.id);
}

export function mergeSharedPinnedTabsIntoWorkspaceTabs(localTabs: FileManagerWorkspaceTab[], sharedPinnedTabs: FileManagerWorkspaceTab[]): FileManagerTab[] {
  const tabs = Array.isArray(localTabs) ? localTabs : [];
  const shared = Array.isArray(sharedPinnedTabs) ? sharedPinnedTabs : [];
  const homeTabs = tabs.filter((tab) => tab && tab.systemPinned === true);
  const localPinnedById = new Map();
  const localPinnedByPath = new Map();
  tabs.forEach((tab) => {
    if (tab && tab.systemPinned !== true && tab.pinned === true) {
      const id = String(tab.id || '').trim();
      const path = String(tab.path || '').trim();
      if (id) localPinnedById.set(id, tab);
      if (path && !localPinnedByPath.has(path)) localPinnedByPath.set(path, tab);
    }
  });
  const sharedIds = new Set(shared.map((tab) => String(tab.id || '').trim()).filter(Boolean));
  const sharedPaths = new Set(shared.map((tab) => String(tab.path || '').trim()).filter(Boolean));
  const mappedPinnedTabs = shared.map((sharedTab) => {
    const sharedId = String(sharedTab.id || '').trim();
    const sharedPath = String(sharedTab.path || '').trim();
    const existing = localPinnedById.get(sharedId) || localPinnedByPath.get(sharedPath) || null;
    return {
      id: existing ? (String(existing.id || '').trim() || sharedId) : sharedId,
      path: sharedPath,
      customTitle: String(sharedTab.customTitle || '').trim(),
      sortField: typeof existing?.sortField === 'string' ? existing.sortField : 'name',
      sortDir: existing?.sortDir === 'desc' ? 'desc' : 'asc',
      selectedPaths: Array.isArray(existing?.selectedPaths) ? existing.selectedPaths : [],
      scrollTop: Number.isFinite(Number(existing?.scrollTop)) ? Number(existing.scrollTop) : 0,
      pinned: true,
      systemPinned: false,
      systemPinnedType: '',
    };
  });
  const remainderTabs = tabs
    .filter((tab) => {
      if (!tab || tab.systemPinned === true) return false;
      if (tab.pinned === true) {
        const id = String(tab.id || '').trim();
        const path = String(tab.path || '').trim();
        return !(sharedIds.has(id) || sharedPaths.has(path));
      }
      return true;
    })
    .map((tab) => (tab.pinned === true ? { ...tab, pinned: false } : tab));
  // homeTabs/remainderTabs 为持久化 tab（字段已归一化），断言为完整 FileManagerTab
  return [...homeTabs, ...mappedPinnedTabs, ...remainderTabs] as FileManagerTab[];
}

export function getFileManagerTabLabel(path: unknown, t: LooseT, customTitle: unknown = '') {
  const normalizedCustomTitle = String(customTitle || '').trim();
  if (normalizedCustomTitle) {
    return normalizedCustomTitle;
  }
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath || normalizedPath === '/') {
    return t('目录根');
  }
  const parts = normalizedPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || t('目录根');
}

export function renderFileManagerTabTitle(tab: FileManagerTabLike, t: LooseT) {
  const systemTabType = getFileManagerSystemTabType(tab);
  if (systemTabType === FILE_MANAGER_SYSTEM_TAB_KIND_HOME) {
    return <House size={12} />;
  }
  return <span>{getFileManagerTabLabel(tab?.path, t, tab?.customTitle)}</span>;
}

export function normalizeFileManagerPaneKey(paneKey: unknown): 'left' | 'right' {
  return paneKey === 'right' ? 'right' : 'left';
}
