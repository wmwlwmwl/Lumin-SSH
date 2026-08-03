import { getAllSessionFileManagerWorkspaces } from './fileWorkbench.js';
import { sortTerminalPaneCells } from './terminalPaneLayout.js';

export function buildAIWorkspaceTerminalPanelKey(sessionId, terminalId) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const normalizedTerminalId = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!normalizedSessionId || !normalizedTerminalId) {
    return '';
  }
  return `${normalizedSessionId}::${normalizedTerminalId}`;
}

export function formatAIQuotedSelection(text) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) {
    return '';
  }
  return `[引用]>\`${normalizedText}\`\n----\n`;
}

export function resolveAIWorkspaceTerminalBindingByTerminalId(sessions, terminalId) {
  const normalizedTerminalId = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!normalizedTerminalId) {
    return null;
  }
  const list = Array.isArray(sessions) ? sessions : [];
  const exactSession = list.find((session) => session?.id === normalizedTerminalId);
  if (exactSession) {
    return { sessionId: exactSession.id, terminalId: normalizedTerminalId };
  }
  const parentSession = list.find((session) => Array.isArray(session?.terminals)
    && session.terminals.some((terminal) => terminal?.id === normalizedTerminalId));
  if (parentSession) {
    return { sessionId: parentSession.id, terminalId: normalizedTerminalId };
  }
  return null;
}

export function mergeRestoredWorkspaceSessions(currentSessions, nextRestoredSessions, restoringSessionIds) {
  const currentList = Array.isArray(currentSessions) ? currentSessions : [];
  const restoredMap = new Map((Array.isArray(nextRestoredSessions) ? nextRestoredSessions : [])
    .map((session) => [session.id, session]));
  return currentList.map((session) => {
    if (!restoringSessionIds.has(session?.id) || !restoredMap.has(session.id)) {
      return session;
    }
    return restoredMap.get(session.id);
  });
}

export function mergeRestoredWorkspaceLayouts(currentLayouts, nextRestoredLayouts, restoringSessionIds, activeSessionIds) {
  const merged = {};
  Object.entries(currentLayouts || {}).forEach(([layoutId, layout]) => {
    const sessionId = layout?.sessionId;
    if (!sessionId || !restoringSessionIds.has(sessionId)) {
      merged[layoutId] = layout;
    }
  });
  Object.entries(nextRestoredLayouts || {}).forEach(([layoutId, layout]) => {
    const sessionId = layout?.sessionId;
    if (!sessionId || !restoringSessionIds.has(sessionId) || !activeSessionIds.has(sessionId)) {
      return;
    }
    merged[layoutId] = layout;
  });
  return merged;
}

export function remapSessionFileManagerWorkspaceMap(workspaces, idMap) {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {};
  const next = {};
  Object.entries(workspaces || {}).forEach(([terminalId, workspace]) => {
    next[sourceMap[terminalId] || terminalId] = workspace;
  });
  return next;
}

export function cloneSessionFileManagerWorkspaceState(workspace) {
  if (!workspace || typeof workspace !== 'object') {
    return null;
  }
  const clonePane = (pane) => ({
    tabId: typeof pane?.tabId === 'string' ? pane.tabId : '',
    path: typeof pane?.path === 'string' ? pane.path : '',
    sortField: typeof pane?.sortField === 'string' ? pane.sortField : 'name',
    sortDir: pane?.sortDir === 'desc' ? 'desc' : 'asc',
    selectedPaths: Array.isArray(pane?.selectedPaths) ? [...pane.selectedPaths] : [],
    scrollTop: Number.isFinite(Number(pane?.scrollTop)) ? Number(pane.scrollTop) : 0,
  });
  return {
    activeTabId: typeof workspace.activeTabId === 'string' ? workspace.activeTabId : '',
    activePane: workspace.activePane === 'right' ? 'right' : 'left',
    panes: {
      left: clonePane(workspace.panes?.left),
      right: clonePane(workspace.panes?.right),
    },
    tabs: Array.isArray(workspace.tabs)
      ? workspace.tabs
        .filter((tab) => tab && typeof tab === 'object')
        .map((tab) => ({
          ...tab,
          selectedPaths: Array.isArray(tab.selectedPaths) ? [...tab.selectedPaths] : [],
        }))
      : [],
  };
}

export function escapeTerminalClonePosixPath(value) {
  return String(value || '').replace(/'/g, "'\\''");
}

export function escapeTerminalCloneWindowsPath(value) {
  return String(value || '').replace(/"/g, '""');
}

export function buildTerminalCloneCwdCommand(cwd) {
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

export function getTerminalTabDoubleClickAction() {
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

export function pickSessionFileManagerWorkspaces(session) {
  const terminalIds = new Set(
    (session?.terminals || [])
      .map((terminal) => (typeof terminal?.id === 'string' ? terminal.id.trim() : ''))
      .filter(Boolean),
  );
  if (typeof session?.id === 'string' && session.id.trim()) {
    terminalIds.add(session.id.trim());
  }
  if (terminalIds.size === 0) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(getAllSessionFileManagerWorkspaces())
      .filter(([terminalId]) => terminalIds.has(String(terminalId || '').trim())),
  );
}

export function normalizeWorkspaceContentTab(value) {
  return value === 'files' || value === 'process' || value === 'network' || value === 'history'
    ? value
    : 'terminal';
}

// Windows-native local shells cannot run the POSIX probe backend.
export function isUnsupportedMonitorSession(session) {
  if (!session?.isLocal) return false;
  const shell = (session.shellPath || '').toLowerCase();
  return shell.includes('powershell') || shell.includes('pwsh') || shell.includes('cmd');
}

export function remapSessionWorkspaceLayouts(layouts, idMap, targetSessionId) {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {};
  const next = {};
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

export function runSessionWorkspaceSelfCheck() {
  const assert = (condition, message) => {
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
  clonedWorkspace.panes.left.selectedPaths.push('/changed');
  clonedWorkspace.tabs[0].selectedPaths.push('/changed');
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
