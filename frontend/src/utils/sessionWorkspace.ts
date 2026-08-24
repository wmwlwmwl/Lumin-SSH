import { getAllSessionFileManagerWorkspaces } from './fileWorkbench.ts';
import { sortTerminalPaneCells, type TerminalPaneLayout } from './terminalPaneLayout.ts';

/** 会话对象（宽松形状，来自连接状态） */
export interface SessionLike {
  id?: string;
  isLocal?: boolean;
  shellPath?: string;
  terminals?: Array<{ id?: string; label?: string }>;
  [key: string]: unknown;
}

export function buildAIWorkspaceTerminalPanelKey(sessionId: string, terminalId: string): string {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const normalizedTerminalId = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!normalizedSessionId || !normalizedTerminalId) {
    return '';
  }
  return `${normalizedSessionId}::${normalizedTerminalId}`;
}

export function buildAIWorkspaceTabPanelKey(sessionId: string, terminalId: string, tabId: string): string {
  const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
  const normalizedTabId = typeof tabId === 'string' ? tabId.trim() : '';
  return panelKey && normalizedTabId ? `${panelKey}::${normalizedTabId}` : '';
}

export function formatAIQuotedSelection(text: string): string {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) {
    return '';
  }
  return `[引用]>\`${normalizedText}\`\n----\n`;
}

export function resolveAIWorkspaceTerminalBindingByTerminalId(
  sessions: unknown,
  terminalId: string,
): { sessionId: string; terminalId: string } | null {
  const normalizedTerminalId = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!normalizedTerminalId) {
    return null;
  }
  const list = Array.isArray(sessions) ? sessions as SessionLike[] : [];
  const exactSession = list.find((session) => session?.id === normalizedTerminalId);
  if (exactSession) {
    return { sessionId: exactSession.id!, terminalId: normalizedTerminalId };
  }
  const parentSession = list.find((session) => Array.isArray(session?.terminals)
    && session.terminals!.some((terminal) => terminal?.id === normalizedTerminalId));
  if (parentSession) {
    return { sessionId: parentSession.id!, terminalId: normalizedTerminalId };
  }
  return null;
}



export function remapSessionFileManagerWorkspaceMap(
  workspaces: Record<string, unknown> | null | undefined,
  idMap: Record<string, string> | null | undefined,
): Record<string, unknown> {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {};
  const next: Record<string, unknown> = {};
  Object.entries(workspaces || {}).forEach(([terminalId, workspace]) => {
    next[sourceMap[terminalId] || terminalId] = workspace;
  });
  return next;
}

/** 文件管理器面板状态（宽松形状） */
interface FileManagerPaneState {
  tabId: string;
  path: string;
  sortField: string;
  sortDir: 'asc' | 'desc';
  selectedPaths: string[];
  scrollTop: number;
}

/** 文件管理器工作区状态（宽松形状） */
export interface FileManagerWorkspaceState {
  activeTabId: string;
  activePane: 'left' | 'right';
  panes: {
    left: FileManagerPaneState;
    right: FileManagerPaneState;
  };
  tabs: Array<{ selectedPaths?: string[]; [key: string]: unknown }>;
}

export function cloneSessionFileManagerWorkspaceState(workspace: unknown): FileManagerWorkspaceState | null {
  if (!workspace || typeof workspace !== 'object') {
    return null;
  }
  const source = workspace as Record<string, unknown>;
  const clonePane = (pane: unknown): FileManagerPaneState => {
    const paneSource = (pane && typeof pane === 'object' ? pane : {}) as Record<string, unknown>;
    return {
      tabId: typeof paneSource.tabId === 'string' ? paneSource.tabId : '',
      path: typeof paneSource.path === 'string' ? paneSource.path : '',
      sortField: typeof paneSource.sortField === 'string' ? paneSource.sortField : 'name',
      sortDir: paneSource.sortDir === 'desc' ? 'desc' : 'asc',
      selectedPaths: Array.isArray(paneSource.selectedPaths) ? [...paneSource.selectedPaths as string[]] : [],
      scrollTop: Number.isFinite(Number(paneSource.scrollTop)) ? Number(paneSource.scrollTop) : 0,
    };
  };
  const panesSource = (source.panes && typeof source.panes === 'object' ? source.panes : {}) as Record<string, unknown>;
  return {
    activeTabId: typeof source.activeTabId === 'string' ? source.activeTabId : '',
    activePane: source.activePane === 'right' ? 'right' : 'left',
    panes: {
      left: clonePane(panesSource.left),
      right: clonePane(panesSource.right),
    },
    tabs: Array.isArray(source.tabs)
      ? source.tabs
        .filter((tab) => tab && typeof tab === 'object')
        .map((tab) => ({
          ...(tab as Record<string, unknown>),
          selectedPaths: Array.isArray((tab as { selectedPaths?: unknown }).selectedPaths) ? [...(tab as { selectedPaths: string[] }).selectedPaths] : [],
        }))
      : [],
  };
}

function escapeTerminalClonePosixPath(value: string): string {
  return String(value || '').replace(/'/g, "'\\''");
}

function escapeTerminalCloneWindowsPath(value: string): string {
  return String(value || '').replace(/"/g, '""');
}

export function buildTerminalCloneCwdCommand(cwd: string): string {
  const normalizedCwd = typeof cwd === 'string' ? cwd.trim() : '';
  if (!normalizedCwd) {
    return '';
  }
  const windowsDriveMatch = normalizedCwd.match(/^([A-Za-z]:)[\\/]/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1];
    return `${drive}\r\ncd "${escapeTerminalCloneWindowsPath(normalizedCwd)}"\r\n`;
  }
  if (normalizedCwd.startsWith('\\\\')) {
    return `pushd "${escapeTerminalCloneWindowsPath(normalizedCwd)}"\r\n`;
  }
  return `cd -- '${escapeTerminalClonePosixPath(normalizedCwd)}'\r`;
}

export function getTerminalTabDoubleClickAction(): string {
  if (typeof localStorage === 'undefined') {
    return '';
  }
  const enabled = localStorage.getItem('terminalTabDoubleClickActionEnabled');
  const legacyDuplicateEnabled = localStorage.getItem('terminalTabDoubleClickDuplicate') === 'true';
  if (enabled === 'false') {
    return '';
  }
  if (enabled !== 'true' && !legacyDuplicateEnabled) {
    return '';
  }
  const action = localStorage.getItem('terminalTabDoubleClickAction');
  return action === 'close' ? 'close' : 'duplicate';
}


export type WorkspaceContentTab = 'terminal' | 'files' | 'process' | 'network' | 'history';

export function normalizeWorkspaceContentTab(value: unknown): WorkspaceContentTab {
  return value === 'files' || value === 'process' || value === 'network' || value === 'history'
    ? value
    : 'terminal';
}

// Windows-native local shells cannot run the POSIX probe backend.
export function isUnsupportedMonitorSession(session: SessionLike | null | undefined): boolean {
  if (!session?.isLocal) return false;
  const shell = (session.shellPath || '').toLowerCase();
  return shell.includes('powershell') || shell.includes('pwsh') || shell.includes('cmd');
}

export function remapSessionWorkspaceLayouts(
  layouts: Record<string, TerminalPaneLayout> | null | undefined,
  idMap: Record<string, string> | null | undefined,
  targetSessionId: string,
): Record<string, TerminalPaneLayout> {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {};
  const next: Record<string, TerminalPaneLayout> = {};
  Object.entries(layouts || {}).forEach(([layoutId, layout]) => {
    const mappedLayoutId = sourceMap[layoutId] || layoutId;
    const mappedRootTerminalId = sourceMap[layout?.rootTerminalId || layoutId]
      || layout?.rootTerminalId || layoutId;
    next[mappedLayoutId] = {
      ...layout,
      sessionId: targetSessionId,
      rootTerminalId: mappedRootTerminalId,
      panes: (layout?.panes || []).map((pane) => ({
        ...pane,
        terminalId: sourceMap[pane.terminalId] || pane.terminalId,
        cells: sortTerminalPaneCells(pane.cells),
      })),
    };
  });
  return next;
}

function runSessionWorkspaceSelfCheck(): void {
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(`会话工具自检失败：${message}`);
  };

  const sessions = [{ id: 'session', terminals: [{ id: 'child' }] }];
  assert(resolveAIWorkspaceTerminalBindingByTerminalId(sessions, 'session')?.sessionId === 'session', '必须识别根终端');
  assert(resolveAIWorkspaceTerminalBindingByTerminalId(sessions, 'child')?.sessionId === 'session', '必须识别子终端');

  const workspace = {
    activeTabId: 'tab',
    activePane: 'left',
    panes: { left: { selectedPaths: ['/a'] }, right: {} },
    tabs: [{ id: 'tab', selectedPaths: ['/b'] }],
  };
  const clonedWorkspace = cloneSessionFileManagerWorkspaceState(workspace);
  clonedWorkspace!.panes.left.selectedPaths.push('/changed');
  clonedWorkspace!.tabs[0].selectedPaths!.push('/changed');
  assert(workspace.panes.left.selectedPaths.length === 1, '面板选择必须深复制');
  assert(workspace.tabs[0].selectedPaths.length === 1, '标签选择必须深复制');

  assert(buildTerminalCloneCwdCommand("/tmp/a'b") === "cd -- '/tmp/a'\\''b'\r", 'POSIX 路径必须安全转义');
  assert(buildTerminalCloneCwdCommand('C:\\work') === 'C:\r\ncd "C:\\work"\r\n', 'Windows 路径必须切换盘符');

  const remapped = remapSessionWorkspaceLayouts({
    root: { rootTerminalId: 'root', panes: [{ terminalId: 'child', cells: ['br', 'tl'] }] },
  }, { root: 'next-root', child: 'next-child' }, 'next-session');
  assert(remapped['next-root']?.sessionId === 'next-session', '布局必须更新会话 ID');
  assert(remapped['next-root']?.panes?.[0]?.terminalId === 'next-child', '布局必须更新子终端 ID');
  assert(remapped['next-root']?.panes?.[0]?.cells?.join(',') === 'tl,br', '布局必须规范化单元格顺序');
}

if (import.meta.env.DEV) runSessionWorkspaceSelfCheck();
