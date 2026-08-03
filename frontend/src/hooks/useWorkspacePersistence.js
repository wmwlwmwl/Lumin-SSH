import { useCallback, useEffect } from 'react';
import { getAllSessionFileManagerWorkspaces } from '../utils/fileWorkbench.js';
import { normalizeWorkspaceContentTab } from '../utils/sessionWorkspace.js';
import { sortTerminalPaneCells } from '../utils/terminalPaneLayout.js';

export function useWorkspaceSessionPersistence({
  activeSessionIdRef,
  activeTerminalIdRef,
  contentTabRef,
  lastContentTabRef,
  lastTerminalRef,
  rememberWorkspace,
  resolveSessionRootTerminalId,
  t,
  terminalPaneLayoutsRef,
  workspacePersistenceLevel,
}) {
  const buildSessionWorkspaceSnapshot = useCallback((session, overrides = {}) => {
    const nextSession = overrides.session || session;
    if (!nextSession?.id || !nextSession?.serverId) {
      return null;
    }
    const nextLayouts = overrides.terminalPaneLayouts || terminalPaneLayoutsRef.current;
    const nextTerminals = Array.isArray(nextSession.terminals) && nextSession.terminals.length > 0
      ? nextSession.terminals.map((term, index) => ({
        id: typeof term?.id === 'string' && term.id.trim() ? term.id.trim() : `${nextSession.id}-terminal-${index + 1}`,
        label: typeof term?.label === 'string' && term.label.trim() ? term.label.trim() : `${t('终端')}${index + 1}`,
      }))
      : [{ id: nextSession.id, label: `${t('终端')}1` }];
    const sessionLayouts = Object.fromEntries(
      Object.entries(nextLayouts || {})
        .filter(([, layout]) => layout?.sessionId === nextSession.id)
        .map(([layoutId, layout]) => [
          layoutId,
          {
            ...layout,
            sessionId: layout.sessionId,
            rootTerminalId: layout.rootTerminalId || layoutId,
            panes: (layout.panes || []).map((pane) => ({
              ...pane,
              cells: sortTerminalPaneCells(pane.cells),
            })),
          },
        ]),
    );
    const terminalIds = new Set(nextTerminals.map((term) => term.id));
    const fileManagerWorkspaces = Object.fromEntries(
      Object.entries(getAllSessionFileManagerWorkspaces()).filter(([terminalId]) => terminalIds.has(terminalId)),
    );
    const preferredTerminalId = overrides.activeTerminalId
      || (activeSessionIdRef.current === nextSession.id ? activeTerminalIdRef.current : lastTerminalRef.current[nextSession.id]);
    const resolvedActiveTerminalId = resolveSessionRootTerminalId(nextSession, preferredTerminalId, nextLayouts) || nextTerminals[0]?.id || nextSession.id;
    return {
      version: 1,
      sessionId: nextSession.id,
      serverId: nextSession.serverId,
      serverName: nextSession.serverName || '',
      host: nextSession.host || '',
      activeTerminalId: resolvedActiveTerminalId,
      contentTab: normalizeWorkspaceContentTab(
        overrides.contentTab
        ?? (activeSessionIdRef.current === nextSession.id ? contentTabRef.current : lastContentTabRef.current[nextSession.id])
        ?? 'terminal',
      ),
      terminals: nextTerminals.map((term) => ({ id: term.id, label: term.label })),
      terminalPaneLayouts: sessionLayouts,
      fileManagerWorkspaces,
      savedAt: Date.now(),
    };
  }, [activeSessionIdRef, activeTerminalIdRef, contentTabRef, lastContentTabRef, lastTerminalRef, resolveSessionRootTerminalId, t, terminalPaneLayoutsRef]);

  const persistServerWorkspaceSessionSnapshot = useCallback((session, overrides = {}) => {
    if (!rememberWorkspace || workspacePersistenceLevel !== 'session' || !session?.serverId) {
      return;
    }
    const snapshot = buildSessionWorkspaceSnapshot(session, overrides);
    if (snapshot) {
      window?.go?.main?.App?.SaveWorkspaceSessionState?.(session.serverId, JSON.stringify(snapshot)).catch(() => { });
    }
  }, [buildSessionWorkspaceSnapshot, rememberWorkspace, workspacePersistenceLevel]);

  const loadServerWorkspaceSessionSnapshot = useCallback(async (serverId) => {
    const raw = await window?.go?.main?.App?.GetWorkspaceSessionState?.(serverId);
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const terminals = Array.isArray(parsed.terminals)
        ? parsed.terminals.map((term, index) => ({
          id: typeof term?.id === 'string' && term.id.trim() ? term.id.trim() : `snapshot-terminal-${index + 1}`,
          label: typeof term?.label === 'string' && term.label.trim() ? term.label.trim() : `${t('终端')}${index + 1}`,
        })).filter((term) => term.id)
        : [];
      return {
        version: Number(parsed.version) || 1,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : '',
        serverId,
        serverName: typeof parsed.serverName === 'string' ? parsed.serverName : '',
        host: typeof parsed.host === 'string' ? parsed.host : '',
        activeTerminalId: typeof parsed.activeTerminalId === 'string' ? parsed.activeTerminalId.trim() : '',
        contentTab: normalizeWorkspaceContentTab(typeof parsed.contentTab === 'string' ? parsed.contentTab.trim() : 'terminal'),
        terminals: terminals.length > 0 ? terminals : [{ id: 'snapshot-root', label: `${t('终端')}1` }],
        terminalPaneLayouts: parsed.terminalPaneLayouts && typeof parsed.terminalPaneLayouts === 'object' ? parsed.terminalPaneLayouts : {},
        fileManagerWorkspaces: parsed.fileManagerWorkspaces && typeof parsed.fileManagerWorkspaces === 'object' ? parsed.fileManagerWorkspaces : {},
      };
    } catch {
      return null;
    }
  }, [t]);

  return { buildSessionWorkspaceSnapshot, loadServerWorkspaceSessionSnapshot, persistServerWorkspaceSessionSnapshot };
}

export default function useWorkspacePersistence({
  activeSessionId,
  activeTerminalId,
  activeSessionIdRef,
  activeTerminalIdRef,
  contentTab,
  getSessionWorkspaceTabs,
  lastTerminalRef,
  lastContentTabRef,
  persistServerWorkspaceSessionSnapshot,
  rememberWorkspace,
  rememberWorkspaceLoaded,
  resolveSessionRootTerminalId,
  sessions,
  sessionsRef,
  terminalPaneLayouts,
  terminalPaneLayoutsRef,
  workspacePersistenceLevel,
  workspaceRestoreReady,
  restoringWorkspaceRef,
  persistWorkspaceSnapshotRef,
}) {
  const persistWorkspaceSnapshot = useCallback((overrides = {}) => {
    if (!rememberWorkspaceLoaded || !workspaceRestoreReady || restoringWorkspaceRef.current) return;
    const clearSnapshot = () => window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => { });
    const setLiveSnapshot = (payload) => window?.go?.main?.App?.SetLiveWorkspaceState?.(payload).catch(() => { });
    const nextSessions = overrides.sessions || sessionsRef.current;
    const nextActiveSessionId = overrides.activeSessionId ?? activeSessionIdRef.current;
    const nextActiveTerminalId = overrides.activeTerminalId ?? activeTerminalIdRef.current;
    const nextLayouts = overrides.terminalPaneLayouts || terminalPaneLayoutsRef.current;
    const openSessions = nextSessions.filter((session) => session.status !== 'closed' && session.status !== 'error');
    if (openSessions.length === 0) {
      setLiveSnapshot('');
      clearSnapshot();
      return;
    }
    const sessionIds = new Set(openSessions.map((session) => session.id));
    const openTerminalIds = new Set(openSessions.flatMap((session) => (session.terminals || []).map((terminal) => terminal.id)));
    const savedLayouts = Object.fromEntries(
      Object.entries(nextLayouts).filter(([, layout]) => sessionIds.has(layout?.sessionId)).map(([layoutId, layout]) => [
        layoutId,
        {
          ...layout,
          sessionId: layout.sessionId,
          rootTerminalId: layout.rootTerminalId || layoutId,
          panes: (layout.panes || []).map((pane) => ({ ...pane, cells: sortTerminalPaneCells(pane.cells) })),
        },
      ]),
    );
    const savedFileManagerWorkspaces = Object.fromEntries(
      Object.entries(getAllSessionFileManagerWorkspaces()).filter(([terminalId]) => openTerminalIds.has(terminalId)),
    );
    const savedActiveSessionId = openSessions.some((session) => session.id === nextActiveSessionId)
      ? nextActiveSessionId : (openSessions[openSessions.length - 1]?.id || null);
    const savedActiveSession = openSessions.find((session) => session.id === savedActiveSessionId) || openSessions[0] || null;
    const savedActiveTerminalId = savedActiveSession
      ? resolveSessionRootTerminalId(
        savedActiveSession,
        savedActiveSession.id === nextActiveSessionId ? nextActiveTerminalId : lastTerminalRef.current[savedActiveSession.id],
        savedLayouts,
      ) : null;
    const workspaceStatePayload = JSON.stringify({
      version: 2,
      activeSessionId: savedActiveSessionId,
      activeTerminalId: savedActiveTerminalId,
      sessions: openSessions.map((session) => {
        const workspaceTabs = getSessionWorkspaceTabs(session, savedLayouts).map((tab) => ({
          id: tab.id,
          type: tab.type,
          label: tab.label,
          terminalIds: tab.terminalIds || [tab.id],
        }));
        const terminalOrder = Array.from(new Set([
          ...workspaceTabs.flatMap((tab) => tab.terminalIds || []),
          ...(session.terminals || []).map((term) => term.id),
        ]));
        const terminalById = new Map((session.terminals || []).map((term) => [term.id, term]));
        const preferredId = session.id === savedActiveSessionId
          ? savedActiveTerminalId : (session.activeTerminalId || lastTerminalRef.current[session.id]);
        const sessionActiveTerminalId = resolveSessionRootTerminalId(session, preferredId, savedLayouts, session.activeTerminalLabel || '');
        const sessionActiveTerminalLabel = terminalById.get(sessionActiveTerminalId)?.label || session.activeTerminalLabel || '';
        return {
          id: session.id,
          serverId: session.serverId,
          serverName: session.serverName,
          host: session.host,
          activeTerminalId: sessionActiveTerminalId || null,
          activeTerminalLabel: sessionActiveTerminalLabel || null,
          workspaceTabs,
          terminals: terminalOrder.map((terminalId) => terminalById.get(terminalId)).filter(Boolean)
            .map((term) => ({ id: term.id, label: term.label })),
        };
      }),
      terminalPaneLayouts: savedLayouts,
      fileManagerWorkspaces: savedFileManagerWorkspaces,
    });
    setLiveSnapshot(workspaceStatePayload);
    if (!rememberWorkspace) {
      clearSnapshot();
      return;
    }
    window?.go?.main?.App?.SaveWorkspaceState?.(workspaceStatePayload).catch(() => { });
    if (workspacePersistenceLevel === 'session') {
      openSessions.forEach((session) => persistServerWorkspaceSessionSnapshot(session, {
        session,
        terminalPaneLayouts: savedLayouts,
        activeTerminalId: session.id === savedActiveSessionId ? savedActiveTerminalId : lastTerminalRef.current[session.id],
        contentTab: session.id === savedActiveSessionId ? contentTab : (lastContentTabRef.current[session.id] || 'terminal'),
      }));
    }
  }, [activeSessionId, activeSessionIdRef, activeTerminalId, activeTerminalIdRef, contentTab, getSessionWorkspaceTabs, lastContentTabRef, lastTerminalRef, persistServerWorkspaceSessionSnapshot, rememberWorkspace, rememberWorkspaceLoaded, resolveSessionRootTerminalId, restoringWorkspaceRef, sessions, sessionsRef, terminalPaneLayouts, terminalPaneLayoutsRef, workspacePersistenceLevel, workspaceRestoreReady]);

  useEffect(() => {
    persistWorkspaceSnapshotRef.current = persistWorkspaceSnapshot;
  }, [persistWorkspaceSnapshot, persistWorkspaceSnapshotRef]);

  useEffect(() => {
    persistWorkspaceSnapshot();
  }, [persistWorkspaceSnapshot]);

  useEffect(() => {
    let timerId = 0;
    const handleWorkspaceChange = () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        timerId = 0;
        persistWorkspaceSnapshot();
      }, 120);
    };
    window.addEventListener('lumin-file-manager-workspace-changed', handleWorkspaceChange);
    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener('lumin-file-manager-workspace-changed', handleWorkspaceChange);
    };
  }, [persistWorkspaceSnapshot]);
}
