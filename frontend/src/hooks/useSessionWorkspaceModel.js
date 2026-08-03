import { useEffect, useMemo } from 'react';
import { sortTerminalPaneCells } from '../utils/terminalPaneLayout.js';

export default function useSessionWorkspaceModel({
  activeSessionId,
  activeTerminalId,
  getEffectiveTerminals,
  getSessionWorkspaceTabs,
  lastTerminalRef,
  rememberSessionActiveTerminal,
  resolveSessionRootTerminalId,
  restoringWorkspaceRef,
  sessions,
  sessionsRef,
  setActiveTerminalId,
  setTerminalPaneLayouts,
  terminalPaneLayouts,
}) {
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  );
  const isActiveSessionConnected = activeSession?.status === 'connected';
  const isSessionWorkspaceVisible = (session) => !!session;
  const activeSessionRootTerminals = useMemo(
    () => (activeSession ? getSessionWorkspaceTabs(activeSession) : []),
    [activeSession, getSessionWorkspaceTabs],
  );

  useEffect(() => {
    if (restoringWorkspaceRef.current) {
      return;
    }
    setTerminalPaneLayouts((prev) => {
      let changed = false;
      const sessionMap = new Map(sessions.map((session) => [session.id, session]));
      const next = {};
      Object.entries(prev).forEach(([layoutId, layout]) => {
        const session = sessionMap.get(layout?.sessionId);
        if (!session) {
          changed = true;
          return;
        }
        const validTerminalIds = new Set(getEffectiveTerminals(session).map((term) => term.id));
        if (!validTerminalIds.has(layout.rootTerminalId || layoutId)) {
          changed = true;
          return;
        }
        const nextPanes = (layout?.panes || [])
          .filter((pane) => validTerminalIds.has(pane.terminalId))
          .map((pane) => ({ ...pane, cells: sortTerminalPaneCells(pane.cells) }));
        if (nextPanes.length !== (layout?.panes || []).length) {
          changed = true;
        }
        next[layoutId] = {
          ...layout,
          sessionId: session.id,
          rootTerminalId: layout.rootTerminalId || layoutId,
          panes: nextPanes,
        };
      });
      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [getEffectiveTerminals, restoringWorkspaceRef, sessions, setTerminalPaneLayouts]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const session = sessionsRef.current.find((item) => item.id === activeSessionId);
    if (!session) {
      return;
    }
    const nextTerminalId = resolveSessionRootTerminalId(
      session,
      activeTerminalId || session.activeTerminalId || lastTerminalRef.current[activeSessionId],
      terminalPaneLayouts,
      session.activeTerminalLabel || '',
    );
    if (nextTerminalId && nextTerminalId !== activeTerminalId) {
      setActiveTerminalId(nextTerminalId);
      rememberSessionActiveTerminal(activeSessionId, nextTerminalId, session.activeTerminalLabel || '');
    }
  }, [activeSessionId, activeTerminalId, lastTerminalRef, rememberSessionActiveTerminal, resolveSessionRootTerminalId, sessions, sessionsRef, setActiveTerminalId, terminalPaneLayouts]);

  return { activeSession, activeSessionRootTerminals, isActiveSessionConnected, isSessionWorkspaceVisible };
}
