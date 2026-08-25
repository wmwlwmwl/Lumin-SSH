import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as AppGo from '../../wailsjs/go/wailsapp/App.js';
import type { config } from '../../wailsjs/go/models.ts';
import useServerCatalog, { type ServerFormData } from './useServerCatalog.ts';
import type { ConnectingServer } from './useSessionConnections.ts';
import type { SessionLike, WorkspaceContentTab } from '../utils/sessionWorkspace.ts';

export interface UseAppServerOperationsOptions {
  servers: config.Connection[];
  serversRef: MutableRefObject<config.Connection[]>;
  searchQuery: string;
  loadServers: () => Promise<void>;
  addToast: (message: string | Error, type?: string, duration?: number) => number;
  removeRecentConnection: (serverId: string) => void;
  removeRecentConnections: (serverIds: string[]) => void;
  setServers: Dispatch<SetStateAction<config.Connection[]>>;
  setServerEditor: Dispatch<SetStateAction<config.Connection | Record<string, unknown> | null>>;
  startSaveFlowAnimation: (server: config.Connection | null | undefined, data: ServerFormData) => void;
  connectServer: (server: config.Connection) => Promise<void>;
  t: (key: string, vars?: Record<string, unknown>) => string;
  markWorkspaceRestoreNavigationOverride: () => void;
  sessionsRef: MutableRefObject<SessionLike[]>;
  setSessions: Dispatch<SetStateAction<SessionLike[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setActiveTerminalId: Dispatch<SetStateAction<string | null>>;
  setContentTab: Dispatch<SetStateAction<WorkspaceContentTab>>;
  setConnectingServers: Dispatch<SetStateAction<ConnectingServer[]>>;
  postConnectSetup: (sessionId: string, serverId: string) => Promise<void>;
  handleConnectError: (sessionId: string, err: unknown) => void;
}

export default function useAppServerOperations({
  servers,
  serversRef,
  searchQuery,
  loadServers,
  addToast,
  removeRecentConnection,
  removeRecentConnections,
  setServers,
  setServerEditor,
  startSaveFlowAnimation,
  connectServer,
  t,
  markWorkspaceRestoreNavigationOverride,
  sessionsRef,
  setSessions,
  setActiveSessionId,
  setActiveTerminalId,
  setContentTab,
  setConnectingServers,
  postConnectSetup,
  handleConnectError,
}: UseAppServerOperationsOptions) {
  const [batchSelectionMode, setBatchSelectionMode] = useState(false);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);

  const {
    saveServerConfig,
    handleSaveServer,
    handleDeleteServer,
    handleBatchDelete,
    handleGroupDelete,
    handleRenameGroup,
    handleBatchConnect,
    handleBatchMoveGroup,
    toggleBatchSelection,
    filteredServers,
    allGroups,
    handleMoveGroup,
  } = useServerCatalog({
    servers,
    serversRef,
    searchQuery,
    selectedServerIds,
    loadServers,
    addToast,
    removeRecentConnection,
    removeRecentConnections: removeRecentConnections as unknown as (serverIds: unknown) => void,
    setServers,
    setServerEditor: setServerEditor as React.Dispatch<React.SetStateAction<{ id?: string } | null>>,
    setSelectedServerIds,
    setBatchSelectionMode,
    startSaveFlowAnimation,
    connectServer,
    t,
  });

  const handleSaveAndConnectServer = useCallback(async (data: ServerFormData, shouldClearAfterAdd = true) => {
    markWorkspaceRestoreNavigationOverride();
    try {
      const savedServer = await saveServerConfig(data);
      if (!savedServer) return null;

      addToast(t('服务器添加成功'), 'success');
      if (shouldClearAfterAdd) setServerEditor(null);

      const sessionId = `session_${Date.now()}`;
      const newSession: SessionLike = {
        id: sessionId,
        serverId: savedServer.id,
        serverName: savedServer.name || savedServer.host,
        host: savedServer.host,
        status: 'connecting',
        terminals: [{ id: sessionId, label: `${t('终端')}1` }],
        wsRebuildKey: 0,
      };

      const nextSessions = [...sessionsRef.current, newSession];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setActiveSessionId(sessionId);
      setActiveTerminalId(sessionId);
      setContentTab('terminal');
      setConnectingServers((prev) => [...prev, { server: savedServer, sessionId, startTime: Date.now() }]);

      (async () => {
        try {
          await AppGo.ConnectSSH(sessionId, savedServer.id);
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
          );
          setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
          await postConnectSetup(sessionId, savedServer.id);
        } catch (err) {
          handleConnectError(sessionId, err);
        }
      })();
      return savedServer;
    } catch (err) {
      addToast(err instanceof Error ? err : String(err), 'error');
      return null;
    }
  }, [saveServerConfig, addToast, handleConnectError, markWorkspaceRestoreNavigationOverride, postConnectSetup, sessionsRef, setActiveSessionId, setActiveTerminalId, setConnectingServers, setContentTab, setServerEditor, setSessions, t]);

  return {
    batchSelectionMode,
    setBatchSelectionMode,
    selectedServerIds,
    setSelectedServerIds,
    filteredServers,
    allGroups,
    handleSaveServer,
    handleSaveAndConnectServer,
    handleDeleteServer,
    handleGroupDelete,
    handleRenameGroup,
    handleBatchDelete,
    handleBatchConnect,
    handleBatchMoveGroup,
    handleMoveGroup,
    toggleBatchSelection,
  };
}
