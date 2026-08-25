import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { config } from '../../wailsjs/go/models.ts';
import { isRecoveryPasswordError, syncWithRecoveryPassword } from '../utils/recoveryPasswordSync.ts';
import {
  getAllSessionFileManagerWorkspaces,
  getSessionFileManagerWorkspace,
  remapSessionFileManagerWorkspaces,
  replaceAllSessionFileManagerWorkspaces,
  setSessionFileManagerWorkspace,
  type FileManagerWorkspaceState,
} from '../utils/fileWorkbench.ts';
import {
  getAllAIWorkspaceTabGroups,
  remapAIWorkspaceTabGroups,
  replaceAllAIWorkspaceTabGroups,
} from '../utils/aiWorkspaceTabs.ts';
import {
  sortTerminalPaneCells,
  getTerminalPaneRemainingCells,
  remapTerminalPaneLayouts,
  type TerminalPaneLayout,
} from '../utils/terminalPaneLayout.ts';
import {
  remapSessionFileManagerWorkspaceMap,
  cloneSessionFileManagerWorkspaceState,
  buildTerminalCloneCwdCommand,
  normalizeWorkspaceContentTab,
  isUnsupportedMonitorSession,
  remapSessionWorkspaceLayouts,
  type SessionLike,
  type WorkspaceContentTab,
} from '../utils/sessionWorkspace.ts';
import useWorkspacePersistence, { useWorkspaceSessionPersistence } from './useWorkspacePersistence.ts';
import useWorkspaceSettings from './useWorkspaceSettings.ts';
import useSessionWorkspaceModel from './useSessionWorkspaceModel.ts';
import useWorkspacePanelDocking from './useWorkspacePanelDocking.ts';
import useSessionConnections, {
  type ConnectingServer,
  type SessionAuthPrompt,
  type SshChannelUsage,
} from './useSessionConnections.ts';
import useTerminalDocking from './useTerminalDocking.ts';
import useTerminalSubTabs, { type SubTabSessionLike, type TerminalDockDragPreview } from './useTerminalSubTabs.ts';
import type { SyncFailureState } from '../components/SyncFailureToast.tsx';
import type { TabContextMenuState, TerminalTabContextMenuState } from '../components/AppOverlays.tsx';
import { getTerminalTheme } from '../utils/theme.ts';

const TERMINAL_DOCK_LONG_PRESS_MS = 280;

interface DockPreviewZone {
  target: string;
  label: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  style: Record<string, string>;
}

export interface UseAppSessionHubOptions {
  servers: config.Connection[];
  serversRef: MutableRefObject<config.Connection[]>;
  credentials: config.Credential[];
  setCredentials: Dispatch<SetStateAction<config.Credential[]>>;
  serversLoaded: boolean;
  setServersLoaded: Dispatch<SetStateAction<boolean>>;
  setServers: Dispatch<SetStateAction<config.Connection[]>>;
  removeChangeReviewsByRequestId: (id: string) => void;
  clearAIWorkspaceTabGroupAndReviews: (terminalId: string) => void;
  recordRecentConnection: (id: string) => void;
  setSettingsInitialTab: (t: string) => void;
  setShowSettings: (s: boolean) => void;
  showQuickCommandsRef: MutableRefObject<boolean>;
  bottomSplitHeight: number;
  bottomSplitHeightRef: MutableRefObject<number>;
  leftSplitWidth: number;
  leftSplitWidthRef: MutableRefObject<number>;
  aiPanelWidthRef: MutableRefObject<number>;
  probePanelPosition: 'left' | 'right';
  probePanelWidthRef: MutableRefObject<number>;
  setAIPanelVisibility: (v: boolean) => void;
  setProbePanelCollapsedPersistent: (v: boolean) => void;
  updateAiPanelWidth: (w: number) => void;
  updateBottomSplitHeight: (h: number) => void;
  updateLeftSplitWidth: (w: number) => void;
  updateProbePanelWidth: (w: number) => void;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function useAppSessionHub({
  servers: _servers,
  serversRef,
  credentials,
  setCredentials,
  serversLoaded,
  setServersLoaded,
  setServers,
  removeChangeReviewsByRequestId,
  clearAIWorkspaceTabGroupAndReviews,
  recordRecentConnection,
  setSettingsInitialTab,
  setShowSettings,
  showQuickCommandsRef,
  bottomSplitHeight,
  bottomSplitHeightRef,
  leftSplitWidth,
  leftSplitWidthRef,
  aiPanelWidthRef,
  probePanelPosition,
  probePanelWidthRef,
  setAIPanelVisibility,
  setProbePanelCollapsedPersistent,
  updateAiPanelWidth,
  updateBottomSplitHeight,
  updateLeftSplitWidth,
  updateProbePanelWidth,
  addToast,
  t,
}: UseAppSessionHubOptions) {
  const [sessions, setSessions] = useState<SessionLike[]>([]);
  const sessionsRef = useRef<SessionLike[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const cancelledConnectionsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const disconnectingServerIdsRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const activeTerminalIdRef = useRef<string | null>(null);
  useEffect(() => { activeTerminalIdRef.current = activeTerminalId; }, [activeTerminalId]);

  const {
    rememberWorkspace,
    workspacePersistenceLevel,
    rememberWorkspaceLoaded,
  } = useWorkspaceSettings();
  const [workspaceRestoreReady, setWorkspaceRestoreReady] = useState(false);
  const [terminalPaneLayouts, setTerminalPaneLayouts] = useState<Record<string, TerminalPaneLayout>>({});
  const terminalPaneLayoutsRef = useRef<Record<string, TerminalPaneLayout>>({});
  useEffect(() => { terminalPaneLayoutsRef.current = terminalPaneLayouts; }, [terminalPaneLayouts]);
  const persistWorkspaceSnapshotRef = useRef<((overrides?: Record<string, unknown>) => void) | null>(() => { });
  const terminalPaneIdRef = useRef(0);
  const workspaceRestoreStartedRef = useRef(false);
  const restoringWorkspaceRef = useRef(false);
  const workspaceRestoreNavigationOverrideRef = useRef(false);
  const [restoringWorkspaceSessionIds, setRestoringWorkspaceSessionIds] = useState<Set<string>>(new Set());
  const lastTerminalRef = useRef<Record<string, string>>({});
  const lastContentTabRef = useRef<Record<string, WorkspaceContentTab>>({});
  const [mountedSessions, setMountedSessions] = useState<Set<string>>(new Set());
  const [contentTab, setContentTab] = useState<WorkspaceContentTab>('terminal');
  const setContentTabLoose = setContentTab as (tab: string) => void;
  const contentTabRef = useRef<WorkspaceContentTab>(contentTab);
  useEffect(() => { contentTabRef.current = contentTab; }, [contentTab]);

  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [terminalTabContextMenu, setTerminalTabContextMenu] = useState<TerminalTabContextMenuState | null>(null);

  useEffect(() => {
    if (!tabContextMenu && !terminalTabContextMenu) return;
    const close = () => {
      setTabContextMenu(null);
      setTerminalTabContextMenu(null);
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', close);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [tabContextMenu, terminalTabContextMenu]);

  const [connectingServers, setConnectingServers] = useState<ConnectingServer[]>([]);
  const [sshChannelUsage, setSshChannelUsage] = useState<Record<string, SshChannelUsage>>({});
  const connectingServersRef = useRef<ConnectingServer[]>([]);
  useEffect(() => { connectingServersRef.current = connectingServers; }, [connectingServers]);
  const [sessionAuthPrompts, setSessionAuthPrompts] = useState<Record<string, SessionAuthPrompt>>({});
  const authPromptTokenRef = useRef(0);
  const clearSessionAuthPrompt = useCallback((sessionId: string) => {
    setSessionAuthPrompts((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const [syncFailed, setSyncFailed] = useState<SyncFailureState | null>(null);
  const [creatingTerminalSessionId, setCreatingTerminalSessionId] = useState<string | null>(null);
  const creatingTerminalRef = useRef<string | null>(null);
  const [monitoringEnabled, setMonitoringEnabled] = useState<Record<string, boolean>>({});

  const updateSessionStatus = useCallback((id: string, status: string) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  }, []);
  const markConnectionCancelled = useCallback((terminalIds: string | string[]) => {
    const ids = Array.from(new Set(
      (Array.isArray(terminalIds) ? terminalIds : [terminalIds])
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
    ));
    ids.forEach((id) => {
      cancelledConnectionsRef.current.add(id);
      setTimeout(() => { cancelledConnectionsRef.current.delete(id); }, 30000);
    });
    return ids;
  }, []);
  const awaitDisconnectTerminals = useCallback((terminalIds: string | string[]) => {
    const ids = Array.from(new Set(
      (Array.isArray(terminalIds) ? terminalIds : [terminalIds])
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
    ));
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return Promise.allSettled(ids.map((id) => window.go.wailsapp.App.DisconnectSSH(id)));
  }, []);
  const disconnectSessionTerminals = useCallback((terminalIds: string | string[]) => {
    const ids = markConnectionCancelled(terminalIds);
    return awaitDisconnectTerminals(ids);
  }, [awaitDisconnectTerminals, markConnectionCancelled]);
  const disconnectSessionConnection = useCallback((sessionId: string, terminalIds: string[] = []) => {
    const ids = markConnectionCancelled([sessionId, ...terminalIds]);
    return window.go.wailsapp.App.DisconnectSSHConnection(sessionId, terminalIds).then(() => ids);
  }, [markConnectionCancelled]);
  const registerServerDisconnect = useCallback((serverId: string, disconnectPromise: Promise<unknown>) => {
    const normalizedServerId = typeof serverId === 'string' ? serverId.trim() : '';
    if (!normalizedServerId || !disconnectPromise) {
      return;
    }
    let trackedPromise: Promise<unknown> | null = null;
    trackedPromise = Promise.resolve(disconnectPromise).catch(() => { }).finally(() => {
      if (disconnectingServerIdsRef.current.get(normalizedServerId) === trackedPromise) {
        disconnectingServerIdsRef.current.delete(normalizedServerId);
      }
    });
    disconnectingServerIdsRef.current.set(normalizedServerId, trackedPromise);
  }, []);
  const waitForServerDisconnect = useCallback(async (serverId: string) => {
    const normalizedServerId = typeof serverId === 'string' ? serverId.trim() : '';
    if (!normalizedServerId) {
      return;
    }
    const pendingDisconnect = disconnectingServerIdsRef.current.get(normalizedServerId);
    if (!pendingDisconnect) {
      return;
    }
    await pendingDisconnect;
  }, []);

  const getEffectiveTerminals = useCallback((s: SessionLike): Array<{ id: string; label?: string }> => (
    (s.terminals && s.terminals.length > 0 ? s.terminals : [{ id: s.id || '' }])
      .map((term) => ({ id: term.id || '', label: term.label }))
  ), []);
  const getSessionPanes = useCallback((layoutId: string, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => layoutSource[layoutId]?.panes || [], [terminalPaneLayouts]);
  const getSessionRootPaneCells = useCallback((layoutId: string, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => (
    getTerminalPaneRemainingCells(getSessionPanes(layoutId, layoutSource))
  ), [getSessionPanes, terminalPaneLayouts]);
  const getSessionPaneLayouts = useCallback((sessionId: string, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => (
    Object.entries(layoutSource)
      .filter(([, layout]) => layout?.sessionId === sessionId)
      .map(([layoutId, layout]) => ({
        ...layout,
        id: layoutId,
        rootTerminalId: layout.rootTerminalId || layoutId,
        panes: layout.panes || [],
      }))
  ), [terminalPaneLayouts]);
  const getSessionGroupedTerminalIds = useCallback((sessionId: string, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => {
    const ids = new Set<string>();
    getSessionPaneLayouts(sessionId, layoutSource).forEach((layout) => {
      ids.add(layout.rootTerminalId);
      (layout.panes || []).forEach((pane) => ids.add(pane.terminalId));
    });
    return ids;
  }, [getSessionPaneLayouts, terminalPaneLayouts]);
  const getSessionRootTerminals = useCallback((session: SessionLike, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => {
    const groupedTerminalIds = getSessionGroupedTerminalIds(session.id || '', layoutSource);
    return getEffectiveTerminals(session).filter((term) => !groupedTerminalIds.has(term.id));
  }, [getEffectiveTerminals, getSessionGroupedTerminalIds, terminalPaneLayouts]);
  const getSessionWorkspaceTabs = useCallback((session: SessionLike, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts) => {
    const terminals = getEffectiveTerminals(session);
    const terminalById = new Map(terminals.map((term) => [term.id, term]));
    const layoutsByRoot = new Map(getSessionPaneLayouts(session.id || '', layoutSource).map((layout) => [layout.rootTerminalId, layout]));
    const groupedTerminalIds = getSessionGroupedTerminalIds(session.id || '', layoutSource);
    return terminals.flatMap((term) => {
      const layout = layoutsByRoot.get(term.id);
      if (layout) {
        const names = [layout.rootTerminalId, ...(layout.panes || []).map((pane) => pane.terminalId)]
          .map((terminalId) => terminalById.get(terminalId)?.label)
          .filter(Boolean);
        return [{
          id: layout.id,
          type: 'group',
          label: names.length > 0 ? names.join(' / ') : t('分屏组'),
          terminalIds: [layout.rootTerminalId, ...(layout.panes || []).map((pane) => pane.terminalId)],
        }];
      }
      if (groupedTerminalIds.has(term.id)) {
        return [];
      }
      return [{ ...term, type: 'terminal', terminalIds: [term.id] }];
    });
  }, [getEffectiveTerminals, getSessionGroupedTerminalIds, getSessionPaneLayouts, terminalPaneLayouts, t]);

  const resolveSessionRootTerminalId = useCallback((session: SessionLike, preferredId: string | null | undefined, layoutSource: Record<string, TerminalPaneLayout> = terminalPaneLayouts, preferredLabel = '') => {
    const tabs = getSessionWorkspaceTabs(session, layoutSource);
    if (!tabs.length) return null;
    if (preferredId && tabs.some((tab) => tab.id === preferredId)) return preferredId;
    const label = typeof preferredLabel === 'string' ? preferredLabel.trim() : '';
    if (label) {
      const byLabel = tabs.find((tab) => String(tab.label || '').trim() === label);
      if (byLabel) return byLabel.id;
    }
    const cachedId = session?.activeTerminalId;
    if (cachedId && tabs.some((tab) => tab.id === cachedId)) return cachedId as string;
    const cachedLabel = typeof session?.activeTerminalLabel === 'string' ? session.activeTerminalLabel.trim() : '';
    if (cachedLabel) {
      const byCachedLabel = tabs.find((tab) => String(tab.label || '').trim() === cachedLabel);
      if (byCachedLabel) return byCachedLabel.id;
    }
    return tabs[0]?.id || null;
  }, [getSessionWorkspaceTabs, terminalPaneLayouts]);

  const rememberSessionActiveTerminal = useCallback((sessionId: string, terminalId: string, terminalLabel = '') => {
    if (!sessionId || !terminalId) return;
    lastTerminalRef.current[sessionId] = terminalId;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((session) => {
        if (session.id !== sessionId) return session;
        const label = terminalLabel
          || session.terminals?.find((term) => term.id === terminalId)?.label
          || String(session.activeTerminalLabel || '');
        if (session.activeTerminalId === terminalId && session.activeTerminalLabel === label) return session;
        changed = true;
        return { ...session, activeTerminalId: terminalId, activeTerminalLabel: label };
      });
      if (changed) {
        sessionsRef.current = next;
        return next;
      }
      return prev;
    });
  }, []);

  const markWorkspaceRestoreNavigationOverride = useCallback(() => {
    if (restoringWorkspaceRef.current) {
      workspaceRestoreNavigationOverrideRef.current = true;
    }
  }, []);

  const {
    collapseDragIntent,
    fileManagerCollapsed,
    fileManagerDockConfirmTarget,
    fileManagerDockPreview,
    fileManagerDockTabAnchorRef,
    fileManagerPosition,
    getFileManagerDockConfirmRect,
    setFileManagerCollapsedPersistent,
    shouldIgnoreResizerClick,
    startDrag,
  } = useWorkspacePanelDocking({
    bottomSplitHeight,
    bottomSplitHeightRef,
    contentTab,
    fileManagerPosition: 'tab',
    leftSplitWidth,
    leftSplitWidthRef,
    aiPanelWidthRef,
    probePanelPosition,
    probePanelWidthRef,
    setAIPanelVisibility: setAIPanelVisibility as (value: unknown) => void,
    setContentTab: setContentTabLoose,
    setProbePanelCollapsedPersistent: setProbePanelCollapsedPersistent as (value: unknown) => void,
    showQuickCommandsRef,
    updateAiPanelWidth: updateAiPanelWidth as (value: unknown) => void,
    updateBottomSplitHeight: updateBottomSplitHeight as (value: unknown) => void,
    updateLeftSplitWidth: updateLeftSplitWidth as (value: unknown) => void,
    updateProbePanelWidth: updateProbePanelWidth as (value: unknown) => void,
  });

  const { loadServerWorkspaceSessionSnapshot, persistServerWorkspaceSessionSnapshot } = useWorkspaceSessionPersistence({
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
  });

  const terminalSubTabScrollRef = useRef<HTMLDivElement>(null);
  const terminalSubTabActionsRef = useRef<HTMLDivElement>(null);
  const [terminalSubTabOverflow, setTerminalSubTabOverflow] = useState(false);
  const terminalSubTabDragSuppressUntilRef = useRef(0);
  const terminalSubTabScrollTargetRef = useRef(0);
  const terminalSubTabScrollFrameRef = useRef(0);
  const terminalSubTabDraggingRef = useRef(false);
  const terminalSubTabScrollBySessionRef = useRef<Record<string, number>>({});
  const terminalDockLongPressTimerRef = useRef<number | null>(null);
  const terminalDockPointerCleanupRef = useRef<(() => void) | null>(null);
  const terminalDockClickSuppressUntilRef = useRef(0);
  const [terminalDockDragPreview, setTerminalDockDragPreview] = useState<TerminalDockDragPreview | null>(null);
  const clearTerminalDockLongPressTimer = useCallback(() => {
    if (terminalDockLongPressTimerRef.current) {
      clearTimeout(terminalDockLongPressTimerRef.current);
      terminalDockLongPressTimerRef.current = null;
    }
  }, []);
  const shouldIgnoreTerminalDockClick = useCallback(() => Date.now() < terminalDockClickSuppressUntilRef.current, []);

  const { handleConnectError, postConnectSetup, loadServers, handleCancelConnection, resolveSessionContentTab, switchToNextSession, handleTabClick, canCopySessionPassword, handleCopySessionPassword, reconnectSession, resolveHostKeyChoice, resolvePasswordPrompt, handleCloseWindow, connectServer, connectLocal, connectSerial, forceCloseSession, closeSession, closeAllSessions, openNewTerminal, handleRenameTerminalTab, closeTerminal } = useSessionConnections({
    activeSessionIdRef,
    activeTerminalIdRef,
    addToast,
    authPromptTokenRef,
    awaitDisconnectTerminals,
    buildTerminalCloneCwdCommand,
    cancelledConnectionsRef,
    clearSessionAuthPrompt,
    cloneSessionFileManagerWorkspaceState: cloneSessionFileManagerWorkspaceState as unknown as (workspace: unknown) => FileManagerWorkspaceState | null,
    connectingServersRef,
    contentTabRef,
    creatingTerminalRef,
    credentials,
    disconnectSessionConnection,
    disconnectSessionTerminals,
    fileManagerPosition,
    getAllSessionFileManagerWorkspaces,
    getAllAIWorkspaceTabGroups,
    getSessionFileManagerWorkspace,
    isRecoveryPasswordError,
    isUnsupportedMonitorSession,
    lastContentTabRef,
    lastTerminalRef,
    loadServerWorkspaceSessionSnapshot,
    markWorkspaceRestoreNavigationOverride,
    mountedRef,
    normalizeWorkspaceContentTab,
    persistServerWorkspaceSessionSnapshot,
    persistWorkspaceSnapshotRef,
    recordRecentConnection,
    registerServerDisconnect,
    remapSessionFileManagerWorkspaceMap,
    remapSessionFileManagerWorkspaces,
    remapAIWorkspaceTabGroups,
    remapSessionWorkspaceLayouts,
    remapTerminalPaneLayouts,
    rememberSessionActiveTerminal,
    rememberWorkspace,
    rememberWorkspaceLoaded,
    removeChangeReviewsByRequestId,
    replaceAllSessionFileManagerWorkspaces,
    replaceAllAIWorkspaceTabGroups,
    clearAIWorkspaceTabGroup: clearAIWorkspaceTabGroupAndReviews,
    resolveSessionRootTerminalId,
    restoringWorkspaceRef,
    restoringWorkspaceSessionIds,
    serversLoaded,
    serversRef,
    sessionsRef,
    setActiveSessionId,
    setActiveTerminalId,
    setConnectingServers,
    setContentTab: setContentTabLoose,
    setCreatingTerminalSessionId,
    setCredentials,
    setMonitoringEnabled,
    setMountedSessions,
    setRestoringWorkspaceSessionIds,
    setServers,
    setServersLoaded,
    setSessionAuthPrompts,
    setSessionFileManagerWorkspace,
    setSessions,
    setSettingsInitialTab,
    setShowSettings,
    setSshChannelUsage,
    setSyncFailed: setSyncFailed as React.Dispatch<React.SetStateAction<unknown>>,
    setTabContextMenu: setTabContextMenu as (menu: unknown) => void,
    setTerminalPaneLayouts,
    setTerminalSubTabOverflow,
    setTerminalTabContextMenu: setTerminalTabContextMenu as (menu: unknown) => void,
    setWorkspaceRestoreReady,
    sortTerminalPaneCells,
    syncFailed,
    syncWithRecoveryPassword,
    t,
    terminalPaneLayoutsRef,
    terminalSubTabScrollBySessionRef,
    terminalSubTabScrollRef,
    terminalSubTabScrollTargetRef,
    updateSessionStatus,
    waitForServerDisconnect,
    workspacePersistenceLevel,
    workspaceRestoreNavigationOverrideRef,
    workspaceRestoreStartedRef,
  });

  const { isTerminalDockTargetOccupied, getTerminalDockTargetStates, canMoveTerminalToDockTarget, handleTerminalPaneDrop, moveTerminalToDockTarget, closeTerminalGroup, closeTerminalPane } = useTerminalDocking({
    activeSessionIdRef,
    activeTerminalIdRef,
    contentTabRef,
    disconnectSessionTerminals,
    getEffectiveTerminals,
    getSessionGroupedTerminalIds,
    getSessionPaneLayouts,
    getSessionPanes,
    getSessionRootPaneCells,
    getSessionRootTerminals,
    lastContentTabRef,
    lastTerminalRef,
    persistServerWorkspaceSessionSnapshot,
    registerServerDisconnect,
    resolveSessionRootTerminalId,
    sessionsRef,
    setActiveTerminalId,
    setContentTab: setContentTabLoose,
    setMountedSessions,
    setSessions,
    setTabContextMenu: setTabContextMenu as (menu: unknown) => void,
    setTerminalPaneLayouts,
    setTerminalTabContextMenu: setTerminalTabContextMenu as (menu: unknown) => void,
    switchToNextSession,
    terminalPaneIdRef,
    terminalPaneLayouts,
    terminalPaneLayoutsRef,
  });

  const { activeSession, activeSessionRootTerminals, isActiveSessionConnected, isSessionWorkspaceVisible } = useSessionWorkspaceModel({
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
  });

  useWorkspacePersistence({
    activeSessionId,
    activeTerminalId,
    activeSessionIdRef,
    activeTerminalIdRef,
    contentTab,
    getSessionWorkspaceTabs,
    lastContentTabRef,
    lastTerminalRef,
    persistServerWorkspaceSessionSnapshot,
    persistWorkspaceSnapshotRef,
    rememberWorkspace,
    rememberWorkspaceLoaded,
    resolveSessionRootTerminalId,
    restoringWorkspaceRef,
    sessions,
    sessionsRef,
    terminalPaneLayouts,
    terminalPaneLayoutsRef,
    workspacePersistenceLevel,
    workspaceRestoreReady,
  });

  const getTerminalDockPreviewZones = useCallback((): DockPreviewZone[] => {
    const container = document.getElementById('terminal-dock-preview-host');
    if (!container) return [];
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    const inset = 18;
    const gap = 14;
    const innerWidth = rect.width - inset * 2;
    const innerHeight = rect.height - inset * 2;
    if (innerWidth <= gap || innerHeight <= gap) return [];
    const cellWidth = (innerWidth - gap) / 2;
    const cellHeight = (innerHeight - gap) / 2;
    const entries = [
      { target: 'top-left', label: t('左上'), column: 0, row: 0 },
      { target: 'top-right', label: t('右上'), column: 1, row: 0 },
      { target: 'bottom-left', label: t('左下'), column: 0, row: 1 },
      { target: 'bottom-right', label: t('右下'), column: 1, row: 1 },
    ];
    return entries.map(({ target, label, column, row }) => {
      const left = inset + column * (cellWidth + gap);
      const top = inset + row * (cellHeight + gap);
      return {
        target,
        label,
        bounds: {
          left: rect.left + left,
          top: rect.top + top,
          right: rect.left + left + cellWidth,
          bottom: rect.top + top + cellHeight,
        },
        style: {
          left: `${rect.left + left}px`,
          top: `${rect.top + top}px`,
          width: `${cellWidth}px`,
          height: `${cellHeight}px`,
        },
      };
    });
  }, [t]);

  const getTerminalDockPreviewTarget = useCallback((clientX: number, clientY: number, zones: unknown[]): string | null => {
    const typedZones = zones as DockPreviewZone[];
    return typedZones.find((zone) =>
      clientX >= zone.bounds.left
      && clientX <= zone.bounds.right
      && clientY >= zone.bounds.top
      && clientY <= zone.bounds.bottom
    )?.target || null;
  }, []);

  const terminalSubTabTheme = useMemo(() => getTerminalTheme(), []);

  const {
    handleTerminalSubTabClickCapture,
    handleTerminalSubTabDockMouseDown,
    handleTerminalSubTabMouseDown,
    handleTerminalSubTabScroll,
    handleTerminalSubTabWheel,
    terminalSubTabScrollStyle,
    fileManagerDockDropzones,
  } = useTerminalSubTabs({
    TERMINAL_DOCK_LONG_PRESS_MS,
    activeSessionId,
    activeSessionRootTerminals,
    activeTerminalId,
    canMoveTerminalToDockTarget,
    clearTerminalDockLongPressTimer,
    contentTab,
    fileManagerDockPreview,
    getFileManagerDockConfirmRect,
    getSessionRootTerminals,
    getTerminalDockPreviewTarget,
    getTerminalDockPreviewZones,
    getTerminalDockTargetStates: getTerminalDockTargetStates as unknown as (session: SubTabSessionLike, terminalId: string, zones: unknown[]) => unknown[],
    handleTerminalPaneDrop,
    setTerminalDockDragPreview,
    setTerminalSubTabOverflow,
    terminalDockClickSuppressUntilRef,
    terminalDockLongPressTimerRef,
    terminalDockPointerCleanupRef,
    terminalSubTabDragSuppressUntilRef,
    terminalSubTabDraggingRef,
    terminalSubTabScrollBySessionRef,
    terminalSubTabScrollFrameRef,
    terminalSubTabScrollRef,
    terminalSubTabScrollTargetRef,
    terminalSubTabTheme,
  });

  const connectedSessions = useMemo(() => {
    const seen = new Set<string>();
    return sessions
      .filter(s => s.status === 'connected')
      .filter((s) => {
        const serverId = String(s.serverId || '');
        if (seen.has(serverId)) return false;
        seen.add(serverId);
        return true;
      });
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId && activeTerminalId) {
      rememberSessionActiveTerminal(activeSessionId, activeTerminalId);
    }
  }, [activeSessionId, activeTerminalId, rememberSessionActiveTerminal]);

  useEffect(() => {
    if (activeSessionId) {
      lastContentTabRef.current[activeSessionId] = normalizeWorkspaceContentTab(contentTab);
    }
  }, [activeSessionId, contentTab]);

  useEffect(() => {
    if (activeSessionId) {
      setMountedSessions(prev => {
        if (prev.has(activeSessionId)) return prev;
        const next = new Set(prev);
        next.add(activeSessionId);
        return next;
      });
    }
  }, [activeSessionId]);

  return {
    sessions,
    setSessions,
    sessionsRef,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    activeSessionIdRef,
    activeTerminalId,
    setActiveTerminalId,
    activeTerminalIdRef,
    activeSessionRootTerminals,
    isActiveSessionConnected,
    isSessionWorkspaceVisible,
    connectingServers,
    setConnectingServers,
    sshChannelUsage,
    sessionAuthPrompts,
    tabContextMenu,
    setTabContextMenu,
    terminalTabContextMenu,
    setTerminalTabContextMenu,
    contentTab,
    setContentTab,
    setContentTabLoose,
    mountedSessions,
    terminalPaneLayouts,
    terminalPaneLayoutsRef,
    persistWorkspaceSnapshotRef,
    restoringWorkspaceSessionIds,
    lastTerminalRef,
    getEffectiveTerminals,
    getSessionPanes,
    getSessionRootPaneCells,
    getSessionWorkspaceTabs,
    resolveSessionRootTerminalId,
    rememberSessionActiveTerminal,
    markWorkspaceRestoreNavigationOverride,
    handleConnectError,
    postConnectSetup,
    loadServers,
    handleCancelConnection,
    resolveSessionContentTab,
    switchToNextSession,
    handleTabClick,
    canCopySessionPassword,
    handleCopySessionPassword,
    reconnectSession,
    resolveHostKeyChoice,
    resolvePasswordPrompt,
    handleCloseWindow,
    connectServer,
    connectLocal,
    connectSerial,
    forceCloseSession,
    closeSession,
    closeAllSessions,
    openNewTerminal,
    handleRenameTerminalTab,
    closeTerminal,
    closeTerminalGroup,
    closeTerminalPane,
    isTerminalDockTargetOccupied,
    canMoveTerminalToDockTarget,
    moveTerminalToDockTarget,
    creatingTerminalSessionId,
    syncFailed,
    setSyncFailed,
    collapseDragIntent,
    fileManagerCollapsed,
    fileManagerDockConfirmTarget,
    fileManagerDockDropzones,
    fileManagerDockPreview,
    fileManagerDockTabAnchorRef,
    fileManagerPosition,
    setFileManagerCollapsedPersistent,
    shouldIgnoreResizerClick,
    startDrag,
    terminalSubTabScrollRef,
    terminalSubTabActionsRef,
    terminalSubTabOverflow,
    terminalDockDragPreview,
    shouldIgnoreTerminalDockClick,
    handleTerminalSubTabClickCapture,
    handleTerminalSubTabDockMouseDown,
    handleTerminalSubTabMouseDown,
    handleTerminalSubTabScroll,
    handleTerminalSubTabWheel,
    terminalSubTabScrollStyle,
    connectedSessions,
    monitoringEnabled,
    setMonitoringEnabled,
  };
}
