import { useCallback, useEffect, useRef } from 'react';
import {
  TERMINAL_PANE_CELL_IDS, getTerminalDockTargetCellId, getTerminalPaneRect,
  isTerminalPaneRectangular, normalizeTwoTerminalPaneLayout, sortTerminalPaneCells, splitTerminalPaneCells,
  type TerminalPaneCellId, type TerminalPaneInfo, type TerminalPaneLayout,
} from '../utils/terminalPaneLayout.ts';
import type { SessionLike } from '../utils/sessionWorkspace.ts';
import { normalizeWorkspaceContentTab } from '../utils/sessionWorkspace.ts';
import type { SnapshotOverrides } from './useWorkspacePersistence.ts';

export interface TerminalDockingDeps {
  activeSessionIdRef: React.MutableRefObject<string | null>;
  activeTerminalIdRef: React.MutableRefObject<string | null>;
  contentTabRef: React.MutableRefObject<string>;
  disconnectSessionTerminals: (ids: string[]) => Promise<unknown>;
  getEffectiveTerminals: (session: SessionLike) => Array<{ id: string }>;
  getSessionGroupedTerminalIds: (sessionId: string, layouts?: Record<string, TerminalPaneLayout>) => Set<string>;
  getSessionPaneLayouts: (sessionId: string, layouts?: Record<string, TerminalPaneLayout>) => Array<{ id?: string }>;
  getSessionPanes: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneInfo[];
  getSessionRootPaneCells: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneCellId[];
  getSessionRootTerminals: (session: SessionLike, layouts?: Record<string, TerminalPaneLayout>) => Array<{ id: string }>;
  lastContentTabRef: React.MutableRefObject<Record<string, string>>;
  lastTerminalRef: React.MutableRefObject<Record<string, string>>;
  persistServerWorkspaceSessionSnapshot: (session: SessionLike, overrides?: SnapshotOverrides) => void;
  registerServerDisconnect: (serverId: string, promise: Promise<unknown>) => void;
  resolveSessionRootTerminalId: (session: SessionLike, terminalId: string | null, layouts?: Record<string, TerminalPaneLayout>) => string | null;
  sessionsRef: React.MutableRefObject<SessionLike[]>;
  setActiveTerminalId: (id: string | null) => void;
  setContentTab: (tab: string) => void;
  setMountedSessions: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSessions: React.Dispatch<React.SetStateAction<SessionLike[]>>;
  setTabContextMenu: (menu: unknown) => void;
  setTerminalTabContextMenu: (menu: unknown) => void;
  setTerminalPaneLayouts: React.Dispatch<React.SetStateAction<Record<string, TerminalPaneLayout>>>;
  switchToNextSession: (sessionId: string) => void;
  terminalPaneIdRef: React.MutableRefObject<number>;
  terminalPaneLayouts: Record<string, TerminalPaneLayout>;
  terminalPaneLayoutsRef: React.MutableRefObject<Record<string, TerminalPaneLayout>>;
}

export interface TerminalDockingResult {
  isTerminalDockTargetOccupied: (session: SessionLike, terminalId: string, target: string, layoutSource?: Record<string, TerminalPaneLayout>) => boolean;
  getTerminalDockTargetStates: (session: SessionLike, terminalId: string, zones: unknown[], layoutSource?: Record<string, TerminalPaneLayout>) => Record<string, { occupied: boolean; enabled: boolean }>;
  canMoveTerminalToDockTarget: (session: SessionLike, terminalId: string, target: string, layoutSource?: Record<string, TerminalPaneLayout>) => boolean;
  handleTerminalPaneDrop: (session: SessionLike, terminalId: string, target: string) => void;
  moveTerminalToDockTarget: (session: SessionLike, terminalId: string, target: string) => void;
  closeTerminalGroup: (sessionId: string, layoutId: string, terminalIds: string[], e?: React.MouseEvent) => void;
  closeTerminalPane: (layoutId: string, paneId: string, e?: React.MouseEvent) => void;
}

export default function useTerminalDocking(deps: TerminalDockingDeps): TerminalDockingResult {
  const {
    activeSessionIdRef, activeTerminalIdRef, contentTabRef, disconnectSessionTerminals,
    getEffectiveTerminals, getSessionGroupedTerminalIds, getSessionPaneLayouts, getSessionPanes,
    getSessionRootPaneCells, getSessionRootTerminals, lastContentTabRef, lastTerminalRef,
    persistServerWorkspaceSessionSnapshot, registerServerDisconnect, resolveSessionRootTerminalId,
    sessionsRef, setActiveTerminalId, setContentTab, setMountedSessions, setSessions,
    setTabContextMenu, setTerminalPaneLayouts, setTerminalTabContextMenu, switchToNextSession,
    terminalPaneIdRef, terminalPaneLayouts, terminalPaneLayoutsRef,
  } = deps;
  const dispatchTerminalPaneResize = useCallback(() => {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }, []);

  const getTerminalDockLayoutId = useCallback((session: SessionLike, terminalId: string, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => {
    if (!session?.id || !terminalId) {
      return null;
    }
    const activeId = activeSessionIdRef.current === session.id ? activeTerminalIdRef.current : null;
    if (activeId && layoutSource[activeId]?.sessionId === session.id) {
      return activeId;
    }
    if (activeId && activeId !== terminalId && getEffectiveTerminals(session).some((term) => term.id === activeId)) {
      const groupedIds = getSessionGroupedTerminalIds(session.id, layoutSource);
      if (!groupedIds.has(activeId)) {
        return activeId;
      }
    }
    const firstGroup = getSessionPaneLayouts(session.id, layoutSource)[0];
    return firstGroup?.id || null;
  }, [getEffectiveTerminals, getSessionGroupedTerminalIds, getSessionPaneLayouts, terminalPaneLayouts]);

  const isTerminalDockTargetOccupied = useCallback((session: SessionLike, terminalId: string, target: string, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => {
    const layoutId = getTerminalDockLayoutId(session, terminalId, layoutSource);
    const targetCellId = getTerminalDockTargetCellId(target);
    if (!layoutId || !targetCellId) {
      return false;
    }
    return getSessionPanes(layoutId, layoutSource).some((pane) => sortTerminalPaneCells(pane.cells).includes(targetCellId));
  }, [getSessionPanes, getTerminalDockLayoutId, terminalPaneLayouts]);

  const getTerminalDockTargetStates = useCallback((session: SessionLike, terminalId: string, zones: unknown[], layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => {
    return (zones || []).reduce((acc: Record<string, { occupied: boolean; enabled: boolean }>, zone) => {
      const zoneInfo = zone as { target: string };
      acc[zoneInfo.target] = {
        occupied: isTerminalDockTargetOccupied(session, terminalId, zoneInfo.target, layoutSource),
        enabled: !!session && !!canMoveTerminalToDockTargetRef.current?.(session, terminalId, zoneInfo.target, layoutSource),
      };
      return acc;
    }, {});
  }, [isTerminalDockTargetOccupied, terminalPaneLayouts]);

  const canMoveTerminalToDockTarget = useCallback((session: SessionLike, terminalId: string, target: string, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => {
    if (!session?.id || !terminalId || !target) {
      return false;
    }

    const rootTerminals = getSessionRootTerminals(session, layoutSource);
    if (!rootTerminals.some((term) => term.id === terminalId)) {
      return false;
    }

    const layoutId = getTerminalDockLayoutId(session, terminalId, layoutSource);
    if (!layoutId) {
      return rootTerminals.some((term) => term.id !== terminalId) && !!splitTerminalPaneCells(TERMINAL_PANE_CELL_IDS, target);
    }

    const targetCellId = getTerminalDockTargetCellId(target);
    if (!targetCellId) {
      return false;
    }

    const panes = getSessionPanes(layoutId, layoutSource);
    const occupiedPane = panes.find((pane) => sortTerminalPaneCells(pane.cells).includes(targetCellId));
    if (occupiedPane) {
      const occupiedCells = sortTerminalPaneCells(occupiedPane.cells);
      return occupiedCells.length === 1 || !!splitTerminalPaneCells(occupiedCells, target);
    }

    return !!splitTerminalPaneCells(getSessionRootPaneCells(layoutId, layoutSource), target);
  }, [getSessionPanes, getSessionRootPaneCells, getSessionRootTerminals, getTerminalDockLayoutId, terminalPaneLayouts]);
  const canMoveTerminalToDockTargetRef = useRef<typeof canMoveTerminalToDockTarget | null>(null);
  useEffect(() => {
    canMoveTerminalToDockTargetRef.current = canMoveTerminalToDockTarget;
  }, [canMoveTerminalToDockTarget]);

  const handleTerminalPaneDrop = useCallback((session: SessionLike, terminalId: string, target: string) => {
    if (!session?.id || !terminalId || !target) {
      return;
    }

    let didCreate = false;
    let nextActiveTabId: string | null = null;

    setTerminalPaneLayouts((prev) => {
      if (!canMoveTerminalToDockTarget(session, terminalId, target, prev)) {
        return prev;
      }

      const rootTerminals = getSessionRootTerminals(session, prev);
      const layoutId = getTerminalDockLayoutId(session, terminalId, prev)
        || rootTerminals.find((term) => term.id !== terminalId)?.id;
      if (!layoutId || layoutId === terminalId) {
        return prev;
      }

      const existingLayout = prev[layoutId] || { sessionId: session.id, rootTerminalId: layoutId, panes: [] as TerminalPaneInfo[] };
      const panes = existingLayout.panes || [];
      const targetCellId = getTerminalDockTargetCellId(target);
      const occupiedPane = targetCellId
        ? panes.find((pane) => sortTerminalPaneCells(pane.cells).includes(targetCellId))
        : null;

      if (occupiedPane) {
        const occupiedCells = sortTerminalPaneCells(occupiedPane.cells);
        const occupiedSplit = occupiedCells.length > 1 ? splitTerminalPaneCells(occupiedCells, target) : null;
        const splitNormalizeOrientation = occupiedSplit?.direction === 'up' || occupiedSplit?.direction === 'down'
          ? 'rows'
          : (occupiedSplit?.direction === 'left' || occupiedSplit?.direction === 'right'
            ? 'cols'
            : occupiedPane.normalizeOrientation);

        const nextLayouts: Record<string, TerminalPaneLayout> = {
          ...prev,
          [layoutId]: {
            ...existingLayout,
            sessionId: session.id,
            rootTerminalId: existingLayout.rootTerminalId || layoutId,
            panes: occupiedSplit
              ? [
                ...panes.map((pane) => (
                  pane.id === occupiedPane.id
                    ? { ...pane, cells: occupiedSplit.remainingCells, normalizeOrientation: splitNormalizeOrientation }
                    : pane
                )),
                {
                  id: `pane_${++terminalPaneIdRef.current}`,
                  terminalId,
                  cells: occupiedSplit.newCells,
                  normalizeOrientation: splitNormalizeOrientation,
                },
              ]
              : panes.map((pane) => (
                pane.id === occupiedPane.id
                  ? { ...pane, terminalId }
                  : pane
              )),
          },
        };

        nextActiveTabId = layoutId;
        didCreate = true;
        return nextLayouts;
      }

      const rootPaneCells = getSessionRootPaneCells(layoutId, prev);
      const rootRect = getTerminalPaneRect(rootPaneCells);
      const splitResult = splitTerminalPaneCells(rootPaneCells, target);
      if (!splitResult || splitResult.newCells.length === 0 || splitResult.remainingCells.length === 0) {
        return prev;
      }

      const normalizeOrientation = rootRect?.width === 1 && rootRect?.height === 2
        ? 'rows'
        : (rootRect?.width === 2 && rootRect?.height === 1
          ? 'cols'
          : null);

      const nextLayouts: Record<string, TerminalPaneLayout> = {
        ...prev,
        [layoutId]: {
          ...existingLayout,
          sessionId: session.id,
          rootTerminalId: existingLayout.rootTerminalId || layoutId,
          panes: [
            ...panes,
            {
              id: `pane_${++terminalPaneIdRef.current}`,
              terminalId,
              cells: splitResult.newCells,
              normalizeOrientation,
            },
          ],
        },
      };

      nextActiveTabId = layoutId;
      didCreate = true;
      return nextLayouts;
    });

    if (!didCreate) {
      return;
    }

    if (activeSessionIdRef.current === session.id) {
      setActiveTerminalId(nextActiveTabId);
    }
    if (nextActiveTabId) {
      lastTerminalRef.current[session.id] = nextActiveTabId;
    }
    setContentTab('terminal');
    setTabContextMenu(null);
    setTerminalTabContextMenu(null);
    dispatchTerminalPaneResize();
  }, [canMoveTerminalToDockTarget, dispatchTerminalPaneResize, getSessionRootPaneCells, getSessionRootTerminals, getTerminalDockLayoutId]);

  const moveTerminalToDockTarget = useCallback((session: SessionLike, terminalId: string, target: string) => {
    handleTerminalPaneDrop(session, terminalId, target);
  }, [handleTerminalPaneDrop]);

  const closeTerminalGroup = useCallback((sessionId: string, layoutId: string, terminalIds: string[], e?: React.MouseEvent) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    const ids = Array.isArray(terminalIds) && terminalIds.length > 0 ? terminalIds : [layoutId];
    const remainingTerminals = (session.terminals || []).filter((item) => !ids.includes(item.id!));
    let nextActiveTabId: string | null = null;

    setTerminalPaneLayouts((prev) => {
      const next = { ...prev };
      delete next[layoutId];
      if (remainingTerminals.length > 0) {
        const preferredTabId = activeSessionIdRef.current === sessionId ? activeTerminalIdRef.current : lastTerminalRef.current[sessionId];
        nextActiveTabId = resolveSessionRootTerminalId(
          { ...session, terminals: remainingTerminals },
          preferredTabId === layoutId ? null : preferredTabId,
          next,
        );
      }
      return next;
    });

    const disconnectPromise = disconnectSessionTerminals(ids);
    if (remainingTerminals.length === 0 && session?.serverId) {
      registerServerDisconnect(String(session.serverId), disconnectPromise);
    }

    if (remainingTerminals.length === 0) {
      persistServerWorkspaceSessionSnapshot(session, {
        session,
        terminalPaneLayouts: terminalPaneLayoutsRef.current,
        activeTerminalId: activeSessionIdRef.current === sessionId ? activeTerminalIdRef.current : lastTerminalRef.current[sessionId],
        contentTab: normalizeWorkspaceContentTab(activeSessionIdRef.current === sessionId ? contentTabRef.current : (lastContentTabRef.current[sessionId] || 'terminal')),
      });
      window?.go?.wailsapp?.App?.ClearWorkspaceState?.().catch(() => { });
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      setMountedSessions((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      if (activeSessionIdRef.current === sessionId) {
        switchToNextSession(sessionId);
      }
      return;
    }

    setSessions((prev) => prev.map((item) => (
      item.id === sessionId ? { ...item, terminals: remainingTerminals } : item
    )));
    if (nextActiveTabId) {
      lastTerminalRef.current[sessionId] = nextActiveTabId;
    }
    if (activeSessionIdRef.current === sessionId) {
      setContentTab('terminal');
      setActiveTerminalId(nextActiveTabId || null);
    }
    dispatchTerminalPaneResize();
  }, [disconnectSessionTerminals, dispatchTerminalPaneResize, persistServerWorkspaceSessionSnapshot, registerServerDisconnect, resolveSessionRootTerminalId, switchToNextSession]);

  const closeTerminalPane = useCallback((layoutId: string, paneId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    let sessionId: string | null = null;
    let nextActiveTabId: string | null = null;
    let changed = false;

    setTerminalPaneLayouts((prev) => {
      const layout = prev[layoutId];
      const panes = getSessionPanes(layoutId, prev);
      const pane = panes.find((item) => item.id === paneId);
      if (!layout || !pane) {
        return prev;
      }

      sessionId = layout.sessionId as string;
      const remainingPanes = panes.filter((item) => item.id !== paneId);
      const nextLayouts = { ...prev };
      if (remainingPanes.length > 0) {
        nextLayouts[layoutId] = { ...layout, panes: remainingPanes };
      } else {
        delete nextLayouts[layoutId];
      }

      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (session) {
        const rootCells = getSessionRootPaneCells(layoutId, nextLayouts);
        if (remainingPanes.length === 1 && !isTerminalPaneRectangular(rootCells)) {
          const normalized = normalizeTwoTerminalPaneLayout(
            rootCells,
            remainingPanes[0],
            (remainingPanes[0].normalizeOrientation as 'rows' | 'cols' | null | undefined) || null,
          );
          if (normalized) {
            nextLayouts[layoutId] = {
              ...layout,
              panes: [
                {
                  ...remainingPanes[0],
                  cells: normalized.paneCells,
                  normalizeOrientation: normalized.orientation,
                },
              ],
            };
          }
        }
        nextActiveTabId = resolveSessionRootTerminalId(session, layoutId, nextLayouts);
      }
      changed = true;
      return nextLayouts;
    });

    if (!changed || !sessionId) {
      return;
    }

    if (nextActiveTabId) {
      lastTerminalRef.current[sessionId] = nextActiveTabId;
    }
    if (activeSessionIdRef.current === sessionId) {
      setContentTab('terminal');
      setActiveTerminalId(nextActiveTabId || null);
    }
    dispatchTerminalPaneResize();
  }, [dispatchTerminalPaneResize, getSessionPanes, getSessionRootPaneCells, resolveSessionRootTerminalId]);

  return { isTerminalDockTargetOccupied, getTerminalDockTargetStates, canMoveTerminalToDockTarget, handleTerminalPaneDrop, moveTerminalToDockTarget, closeTerminalGroup, closeTerminalPane };
}
