import { useCallback, useEffect } from 'react';
import { getAllSessionFileManagerWorkspaces } from '../utils/fileWorkbench.ts';
import { getPersistableAIWorkspaceTabGroups, subscribeAIWorkspaceTabGroups } from '../utils/aiWorkspaceTabs.ts';
import { normalizeWorkspaceContentTab, type SessionLike, type WorkspaceContentTab } from '../utils/sessionWorkspace.ts';
import { sortTerminalPaneCells, type TerminalPaneLayout } from '../utils/terminalPaneLayout.ts';

/** 工作区会话快照（持久化到后端的结构） */
export interface WorkspaceSessionSnapshot {
  version: number;
  sessionId: string;
  serverId: string;
  serverName: string;
  host: string;
  activeTerminalId: string | null;
  contentTab: WorkspaceContentTab;
  terminals: Array<{ id: string; label: string }>;
  terminalPaneLayouts: Record<string, TerminalPaneLayout>;
  fileManagerWorkspaces: Record<string, unknown>;
  aiTabWorkspaces: Record<string, unknown>;
  savedAt?: number;
}

/** 快照构建覆盖项 */
export interface SnapshotOverrides {
  session?: SessionLike;
  terminalPaneLayouts?: Record<string, TerminalPaneLayout>;
  activeTerminalId?: string | null;
  contentTab?: WorkspaceContentTab;
}

export interface UseWorkspaceSessionPersistenceOptions {
  activeSessionIdRef: React.MutableRefObject<string | null>;
  activeTerminalIdRef: React.MutableRefObject<string | null>;
  contentTabRef: React.MutableRefObject<WorkspaceContentTab>;
  lastContentTabRef: React.MutableRefObject<Record<string, WorkspaceContentTab>>;
  lastTerminalRef: React.MutableRefObject<Record<string, string>>;
  rememberWorkspace: boolean;
  resolveSessionRootTerminalId: (
    session: SessionLike,
    fallbackTerminalId: string | null | undefined,
    layouts?: Record<string, TerminalPaneLayout>,
    label?: string,
  ) => string | null;
  t: (key: string, vars?: Record<string, unknown>) => string;
  terminalPaneLayoutsRef: React.MutableRefObject<Record<string, TerminalPaneLayout>>;
  workspacePersistenceLevel: 'program' | 'session';
}

export interface UseWorkspaceSessionPersistenceResult {
  buildSessionWorkspaceSnapshot: (session: SessionLike, overrides?: SnapshotOverrides) => WorkspaceSessionSnapshot | null;
  loadServerWorkspaceSessionSnapshot: (serverId: string) => Promise<WorkspaceSessionSnapshot | null>;
  persistServerWorkspaceSessionSnapshot: (session: SessionLike, overrides?: SnapshotOverrides) => void;
}

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
}: UseWorkspaceSessionPersistenceOptions): UseWorkspaceSessionPersistenceResult {
  const buildSessionWorkspaceSnapshot = useCallback((session: SessionLike, overrides: SnapshotOverrides = {}): WorkspaceSessionSnapshot | null => {
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
    ) as Record<string, TerminalPaneLayout>;
    const terminalIds = new Set(nextTerminals.map((term) => term.id));
    const fileManagerWorkspaces = Object.fromEntries(
      Object.entries(getAllSessionFileManagerWorkspaces()).filter(([terminalId]) => terminalIds.has(terminalId)),
    );
    const aiTabWorkspaces = Object.fromEntries(
      Object.entries(getPersistableAIWorkspaceTabGroups()).filter(([terminalId]) => terminalIds.has(terminalId)),
    );
    const preferredTerminalId = overrides.activeTerminalId
      || (activeSessionIdRef.current === nextSession.id ? activeTerminalIdRef.current : lastTerminalRef.current[nextSession.id]);
    const resolvedActiveTerminalId = resolveSessionRootTerminalId(nextSession, preferredTerminalId, nextLayouts) || nextTerminals[0]?.id || nextSession.id || '';
    return {
      version: 1,
      sessionId: nextSession.id,
      serverId: String(nextSession.serverId || ''),
      serverName: String(nextSession.serverName || ''),
      host: String(nextSession.host || ''),
      activeTerminalId: resolvedActiveTerminalId,
      contentTab: normalizeWorkspaceContentTab(
        overrides.contentTab
        ?? (activeSessionIdRef.current === nextSession.id ? contentTabRef.current : lastContentTabRef.current[nextSession.id])
        ?? 'terminal',
      ),
      terminals: nextTerminals.map((term) => ({ id: term.id, label: term.label })),
      terminalPaneLayouts: sessionLayouts,
      fileManagerWorkspaces,
      aiTabWorkspaces,
      savedAt: Date.now(),
    };
  }, [activeSessionIdRef, activeTerminalIdRef, contentTabRef, lastContentTabRef, lastTerminalRef, resolveSessionRootTerminalId, t, terminalPaneLayoutsRef]);

  const persistServerWorkspaceSessionSnapshot = useCallback((session: SessionLike, overrides: SnapshotOverrides = {}) => {
    if (!rememberWorkspace || workspacePersistenceLevel !== 'session' || !session?.serverId) {
      return;
    }
    const snapshot = buildSessionWorkspaceSnapshot(session, overrides);
    if (snapshot) {
      window?.go?.wailsapp?.App?.SaveWorkspaceSessionState?.(String(session.serverId), JSON.stringify(snapshot)).catch(() => { });
    }
  }, [buildSessionWorkspaceSnapshot, rememberWorkspace, workspacePersistenceLevel]);

  const loadServerWorkspaceSessionSnapshot = useCallback(async (serverId: string): Promise<WorkspaceSessionSnapshot | null> => {
    const raw = await window?.go?.wailsapp?.App?.GetWorkspaceSessionState?.(serverId);
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const terminals = Array.isArray(parsed.terminals)
        ? parsed.terminals
            .map((term, index) => ({
              id: typeof (term as { id?: unknown } | null)?.id === 'string' && (term as { id: string }).id.trim()
                ? (term as { id: string }).id.trim()
                : `snapshot-terminal-${index + 1}`,
              label: typeof (term as { label?: unknown } | null)?.label === 'string' && (term as { label: string }).label.trim()
                ? (term as { label: string }).label.trim()
                : `${t('终端')}${index + 1}`,
            }))
            .filter((term) => term.id)
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
        terminalPaneLayouts: parsed.terminalPaneLayouts && typeof parsed.terminalPaneLayouts === 'object'
          ? parsed.terminalPaneLayouts as Record<string, TerminalPaneLayout>
          : {},
        fileManagerWorkspaces: parsed.fileManagerWorkspaces && typeof parsed.fileManagerWorkspaces === 'object'
          ? parsed.fileManagerWorkspaces as Record<string, unknown>
          : {},
        aiTabWorkspaces: parsed.aiTabWorkspaces && typeof parsed.aiTabWorkspaces === 'object'
          ? parsed.aiTabWorkspaces as Record<string, unknown>
          : {},
      };
    } catch {
      return null;
    }
  }, [t]);

  return { buildSessionWorkspaceSnapshot, loadServerWorkspaceSessionSnapshot, persistServerWorkspaceSessionSnapshot };
}

/** 工作区标签（getSessionWorkspaceTabs 返回项） */
export interface WorkspaceTab {
  id: string;
  type?: string;
  label?: string;
  terminalIds?: string[];
}

export interface UseWorkspacePersistenceOptions {
  activeSessionId: string | null;
  activeTerminalId: string | null;
  activeSessionIdRef: React.MutableRefObject<string | null>;
  activeTerminalIdRef: React.MutableRefObject<string | null>;
  contentTab: WorkspaceContentTab;
  getSessionWorkspaceTabs: (session: SessionLike, layouts?: Record<string, TerminalPaneLayout>) => WorkspaceTab[];
  lastTerminalRef: React.MutableRefObject<Record<string, string>>;
  lastContentTabRef: React.MutableRefObject<Record<string, WorkspaceContentTab>>;
  persistServerWorkspaceSessionSnapshot: (session: SessionLike, overrides?: SnapshotOverrides) => void;
  rememberWorkspace: boolean;
  rememberWorkspaceLoaded: boolean;
  resolveSessionRootTerminalId: (
    session: SessionLike,
    fallbackTerminalId: string | null | undefined,
    layouts?: Record<string, TerminalPaneLayout>,
    label?: string,
  ) => string | null;
  sessions: SessionLike[];
  sessionsRef: React.MutableRefObject<SessionLike[]>;
  terminalPaneLayouts: Record<string, TerminalPaneLayout>;
  terminalPaneLayoutsRef: React.MutableRefObject<Record<string, TerminalPaneLayout>>;
  workspacePersistenceLevel: 'program' | 'session';
  workspaceRestoreReady: boolean;
  restoringWorkspaceRef: React.MutableRefObject<boolean>;
  persistWorkspaceSnapshotRef: React.MutableRefObject<((overrides?: Record<string, unknown>) => void) | null>;
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
}: UseWorkspacePersistenceOptions): void {
  const persistWorkspaceSnapshot = useCallback((overrides: Record<string, unknown> = {}) => {
    if (!rememberWorkspaceLoaded || !workspaceRestoreReady || restoringWorkspaceRef.current) return;
    const clearSnapshot = () => window?.go?.wailsapp?.App?.ClearWorkspaceState?.().catch(() => { });
    const setLiveSnapshot = (payload: string) => window?.go?.wailsapp?.App?.SetLiveWorkspaceState?.(payload).catch(() => { });
    const nextSessions = (overrides.sessions as SessionLike[] | undefined) || sessionsRef.current;
    const nextActiveSessionId = (overrides.activeSessionId as string | null | undefined) ?? activeSessionIdRef.current;
    const nextActiveTerminalId = (overrides.activeTerminalId as string | null | undefined) ?? activeTerminalIdRef.current;
    const nextLayouts = (overrides.terminalPaneLayouts as Record<string, TerminalPaneLayout> | undefined) || terminalPaneLayoutsRef.current;
    const openSessions = nextSessions.filter((session) => session.status !== 'closed' && session.status !== 'error');
    if (openSessions.length === 0) {
      setLiveSnapshot('');
      clearSnapshot();
      return;
    }
    const sessionIds = new Set(openSessions.map((session) => session.id));
    const openTerminalIds = new Set(openSessions.flatMap((session) => (session.terminals || []).map((terminal) => terminal.id)));
    const savedLayouts = Object.fromEntries(
      Object.entries(nextLayouts).filter(([, layout]) => sessionIds.has(layout?.sessionId as string)).map(([layoutId, layout]) => [
        layoutId,
        {
          ...layout,
          sessionId: layout.sessionId,
          rootTerminalId: layout.rootTerminalId || layoutId,
          panes: (layout.panes || []).map((pane) => ({ ...pane, cells: sortTerminalPaneCells(pane.cells) })),
        },
      ]),
    ) as Record<string, TerminalPaneLayout>;
    const savedFileManagerWorkspaces = Object.fromEntries(
      Object.entries(getAllSessionFileManagerWorkspaces()).filter(([terminalId]) => openTerminalIds.has(terminalId)),
    );
    const savedAITabWorkspaces = Object.fromEntries(
      Object.entries(getPersistableAIWorkspaceTabGroups()).filter(([terminalId]) => openTerminalIds.has(terminalId)),
    );
    const savedActiveSessionId = openSessions.some((session) => session.id === nextActiveSessionId)
      ? nextActiveSessionId : (openSessions[openSessions.length - 1]?.id || null);
    const savedActiveSession = openSessions.find((session) => session.id === savedActiveSessionId) || openSessions[0] || null;
    const savedActiveSessionIdKey = savedActiveSession?.id as string;
    const savedActiveTerminalId = savedActiveSession
      ? resolveSessionRootTerminalId(
        savedActiveSession,
        savedActiveSession.id === nextActiveSessionId ? nextActiveTerminalId : lastTerminalRef.current[savedActiveSessionIdKey],
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
          ? savedActiveTerminalId : (String(session.activeTerminalId || '') || lastTerminalRef.current[session.id as string]);
        const sessionActiveTerminalId = resolveSessionRootTerminalId(session, preferredId, savedLayouts, String(session.activeTerminalLabel || ''));
        const sessionActiveTerminalLabel = terminalById.get(sessionActiveTerminalId ?? '')?.label || session.activeTerminalLabel || '';
        return {
          id: session.id,
          serverId: session.serverId,
          serverName: session.serverName,
          host: session.host,
          activeTerminalId: sessionActiveTerminalId || null,
          activeTerminalLabel: String(sessionActiveTerminalLabel || null),
          workspaceTabs,
          terminals: terminalOrder.map((terminalId) => terminalById.get(terminalId)).filter((term): term is NonNullable<typeof term> => !!term)
            .map((term) => ({ id: term.id, label: term.label })),
        };
      }),
      terminalPaneLayouts: savedLayouts,
      fileManagerWorkspaces: savedFileManagerWorkspaces,
      aiTabWorkspaces: savedAITabWorkspaces,
    });
    setLiveSnapshot(workspaceStatePayload);
    if (!rememberWorkspace) {
      clearSnapshot();
      return;
    }
    window?.go?.wailsapp?.App?.SaveWorkspaceState?.(workspaceStatePayload).catch(() => { });
    if (workspacePersistenceLevel === 'session') {
      openSessions.forEach((session) => persistServerWorkspaceSessionSnapshot(session, {
        session,
        terminalPaneLayouts: savedLayouts,
        activeTerminalId: session.id === savedActiveSessionId ? savedActiveTerminalId : lastTerminalRef.current[session.id as string],
        contentTab: session.id === savedActiveSessionId ? contentTab : (lastContentTabRef.current[session.id as string] || 'terminal'),
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

  useEffect(() => {
    let timerId = 0;
    return subscribeAIWorkspaceTabGroups(() => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        timerId = 0;
        persistWorkspaceSnapshot();
      }, 120);
    });
  }, [persistWorkspaceSnapshot]);
}
