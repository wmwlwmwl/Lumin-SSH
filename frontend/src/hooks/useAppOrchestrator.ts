import { useState, useEffect, useCallback, useRef, useMemo, type MutableRefObject } from 'react';
import type { config } from '../../wailsjs/go/models.ts';
import type { ProbeSnapshot } from '../components/ProbePanel.tsx';
import type { TopbarSession } from '../components/AppTopbar.tsx';
import { clearAIWorkspaceTabGroup } from '../utils/aiWorkspaceTabs.ts';
import type { QuickCommandsHandle } from '../components/QuickCommands.tsx';
import type { AppOverlaysProps } from '../components/AppOverlays.tsx';
import {
  buildAIWorkspaceTabPanelKey,
  buildAIWorkspaceTerminalPanelKey,
} from '../utils/sessionWorkspace.ts';

import { useTranslation } from '../i18n.ts';
import useServerPing, { type PingServerLike } from './useServerPing.ts';
import useToasts from './useToasts.ts';
import useDashboardPreferences from './useDashboardPreferences.ts';
import useImportExport from './useImportExport.ts';
import usePanelLayout from './usePanelLayout.ts';
import usePortForwardDialog from './usePortForwardDialog.ts';
import useAIReview from './useAIReview.ts';
import useAppAnimations from './useAppAnimations.ts';
import useAppServerOperations from './useAppServerOperations.ts';
import useAppGlobalEvents from './useAppGlobalEvents.ts';
import useAppSessionHub from './useAppSessionHub.ts';
import useAppUpdateNotice from './useAppUpdateNotice.ts';
import useAppTopbarState from './useAppTopbarState.ts';

import logoImg from '../assets/logo.webp';
import logoLightImg from '../assets/logo_q.webp';
import logoDarkImg from '../assets/logo_s.webp';

export type useAppOrchestratorResult = ReturnType<typeof useAppOrchestrator>;

export default function useAppOrchestrator() {
  const { t, lang } = useTranslation();
  const [servers, setServers] = useState<config.Connection[]>([]);
  const [credentials, setCredentials] = useState<config.Credential[]>([]);
  const serversRef = useRef<config.Connection[]>([]);
  useEffect(() => { serversRef.current = servers; }, [servers]);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [serverEditor, setServerEditor] = useState<config.Connection | Record<string, unknown> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('general');
  const [showCredentials, setShowCredentials] = useState(false);
  const [showSerialModal, setShowSerialModal] = useState(false);

  const { toasts, addToast, removeToast, handleToastAction } = useToasts();
  const looseAddToast = addToast as (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  const looseT = t as (key: string, vars?: Record<string, unknown>) => string;
  const [probeSnapshots, setProbeSnapshots] = useState<Record<string, ProbeSnapshot>>({});
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  const quickCmdsRef = useRef<QuickCommandsHandle>(null);
  const showQuickCommandsRef = useRef(false);
  useEffect(() => { showQuickCommandsRef.current = showQuickCommands; }, [showQuickCommands]);

  const {
    showPortForwardDialog,
    portForwardDialogSessionId,
    portForwardInitialMapping,
    portForwardInitialTab,
    openPortForwardDialog,
    closePortForwardDialog,
  } = usePortForwardDialog();

  const {
    leftSplitWidth,
    bottomSplitHeight,
    probePanelWidth,
    probePanelPosition,
    probePanelCollapsed,
    aiPanelWidth,
    showAIPanel,
    leftSplitWidthRef,
    bottomSplitHeightRef,
    probePanelWidthRef,
    aiPanelWidthRef,
    updateLeftSplitWidth,
    updateBottomSplitHeight,
    updateProbePanelWidth,
    updateAiPanelWidth,
    setProbePanelCollapsedPersistent,
    setProbePanelPosition,
    setAIPanelVisibility,
  } = usePanelLayout();

  const {
    searchQuery,
    setSearchQuery,
    serverListViewMode,
    setServerListViewMode,
    hideSensitive,
    setHideSensitive,
    dashboardHostPageMode,
    setDashboardHostPageMode,
    recentConnectionIds,
    recordRecentConnection,
    clearRecentConnections,
    removeRecentConnection,
    removeRecentConnections,
  } = useDashboardPreferences();

  const {
    changeReviewQueues,
    restorePreviewReviews,
    conversationDiffPanels,
    setRestorePreviewReviews,
    setConversationDiffPanels,
    removeChangeReviewsByRequestId,
    removeChangeReviewsBySessionId,
    handleReapplyConversationDiffItem,
    handleApplyConversationDiffRestore,
    handleSelectConversationDiffItem,
  } = useAIReview({ sessionsRef: useRef([]), addToast: looseAddToast, t: looseT });

  const sessionState = useAppSessionHub({
    servers,
    serversRef,
    credentials,
    setCredentials,
    serversLoaded,
    setServersLoaded,
    setServers,
    removeChangeReviewsByRequestId: (id: string) => removeChangeReviewsByRequestId(id),
    clearAIWorkspaceTabGroupAndReviews: (tId: string) => {
      clearAIWorkspaceTabGroup(tId);
      removeChangeReviewsBySessionId(tId);
    },
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
    addToast: looseAddToast,
    t: looseT,
  });

  const { sessionsRef, sessions } = sessionState;

  const { pings, pingEnabled, isRefreshingPing, pingCounts, handleRefreshPing } = useServerPing({
    serversRef: serversRef as unknown as MutableRefObject<PingServerLike[] | null>,
    activeSessionId: sessionState.activeSessionId,
    dashboardHostPageMode,
  });

  const [aiPanelDevilModes, setAIPanelDevilModes] = useState<Record<string, boolean>>({});
  const [activeAIWorkspaceTabs, setActiveAIWorkspaceTabs] = useState<Record<string, string>>({});
  const activeAIPanelKey = useMemo(() => buildAIWorkspaceTerminalPanelKey(sessionState.activeSessionId || '', sessionState.activeTerminalId || ''), [sessionState.activeSessionId, sessionState.activeTerminalId]);
  const activeAIWorkspaceTabId = activeAIPanelKey ? activeAIWorkspaceTabs[activeAIPanelKey] || '' : '';
  const activeAIWorkspaceTabKey = useMemo(
    () => buildAIWorkspaceTabPanelKey(sessionState.activeSessionId || '', sessionState.activeTerminalId || '', activeAIWorkspaceTabId),
    [activeAIWorkspaceTabId, sessionState.activeSessionId, sessionState.activeTerminalId],
  );
  const activeAIDevilMode = activeAIWorkspaceTabKey ? aiPanelDevilModes[activeAIWorkspaceTabKey] === true : false;

  const handleQuickCommandsOpenChange = useCallback((open: boolean) => {
    if (open) {
      setShowQuickCommands(true);
      return;
    }
    if (quickCmdsRef.current?.isDirty?.()) {
      quickCmdsRef.current.showCloseConfirm?.();
      return;
    }
    setShowQuickCommands(false);
  }, []);

  const globalEvents = useAppGlobalEvents({
    activeAIDevilMode,
    activeSessionIdRef: sessionState.activeSessionIdRef,
    activeTerminalIdRef: sessionState.activeTerminalIdRef,
    lastTerminalRef: sessionState.lastTerminalRef,
    sessionsRef,
    terminalPaneLayoutsRef: sessionState.terminalPaneLayoutsRef,
    markWorkspaceRestoreNavigationOverride: sessionState.markWorkspaceRestoreNavigationOverride,
    resolveSessionRootTerminalId: sessionState.resolveSessionRootTerminalId,
    setAIPanelVisibility,
    setActiveSessionId: sessionState.setActiveSessionId,
    setActiveTerminalId: sessionState.setActiveTerminalId,
    setContentTab: sessionState.setContentTab,
    addToast: looseAddToast,
    t: looseT,
  });

  const topbarLogoTransitionImg = globalEvents.resolvedQuickThemeMode === 'light' ? logoLightImg : logoDarkImg;

  const {
    startupUpdateInfo,
    isUpdateModalVisible,
    setIsUpdateModalVisible,
    showUpdateBubble,
    setShowUpdateBubble,
    downloadProgress,
    handleApplyStartupUpdate,
  } = useAppUpdateNotice({ addToast: looseAddToast, t: looseT });

  const animations = useAppAnimations({ setServerEditor, t: looseT });

  const serverOps = useAppServerOperations({
    servers,
    serversRef,
    searchQuery,
    loadServers: sessionState.loadServers,
    addToast: looseAddToast,
    removeRecentConnection,
    removeRecentConnections,
    setServers,
    setServerEditor,
    startSaveFlowAnimation: animations.startSaveFlowAnimation,
    connectServer: sessionState.connectServer,
    t: looseT,
    markWorkspaceRestoreNavigationOverride: sessionState.markWorkspaceRestoreNavigationOverride,
    sessionsRef,
    setSessions: sessionState.setSessions,
    setActiveSessionId: sessionState.setActiveSessionId,
    setActiveTerminalId: sessionState.setActiveTerminalId,
    setContentTab: sessionState.setContentTab,
    setConnectingServers: sessionState.setConnectingServers,
    postConnectSetup: sessionState.postConnectSetup,
    handleConnectError: sessionState.handleConnectError,
  });

  const {
    showImportExportDialog,
    setShowImportExportDialog,
    showExportSelectedDialog,
    setShowExportSelectedDialog,
    exportSelectedIds,
    setExportSelectedIds,
    ieBusy,
    hasRecoveryPassword,
    handleOpenImportExport,
    handleExport,
    handleBatchExport,
    handleExportSelected,
    handleImport,
    handleDownloadTemplate,
  } = useImportExport({ addToast: looseAddToast, loadServers: sessionState.loadServers, t: looseT, lang });

  const topbarState = useAppTopbarState({ sessions });

  const activeChangeReviewQueue = useMemo(() => (
    activeAIWorkspaceTabKey && Array.isArray(changeReviewQueues[activeAIWorkspaceTabKey])
      ? changeReviewQueues[activeAIWorkspaceTabKey]
      : []
  ), [activeAIWorkspaceTabKey, changeReviewQueues]);
  const activeChangeReview = activeChangeReviewQueue.length > 0 ? activeChangeReviewQueue[0] : null;
  const activeRestorePreviewReview = activeAIWorkspaceTabKey ? restorePreviewReviews[activeAIWorkspaceTabKey] || null : null;
  const activeConversationDiffPanel = activeAIWorkspaceTabKey ? conversationDiffPanels[activeAIWorkspaceTabKey] || null : null;

  const topbarProps = {
    t: looseT,
    handleTopbarDoubleClick: topbarState.handleTopbarDoubleClick,
    markWorkspaceRestoreNavigationOverride: sessionState.markWorkspaceRestoreNavigationOverride,
    setActiveSessionId: sessionState.setActiveSessionId,
    setActiveTerminalId: sessionState.setActiveTerminalId,
    setShowSettings,
    logoImg,
    showTopbarRefreshedLogo: globalEvents.showTopbarRefreshedLogo,
    topbarLogoTransitionImg,
    sessions: sessions as TopbarSession[],
    tabScrollRef: topbarState.tabScrollRef,
    tabListRef: topbarState.tabListRef,
    activeSessionId: sessionState.activeSessionId,
    handleTabClick: sessionState.handleTabClick,
    closeSession: sessionState.closeSession,
    setTabContextMenu: sessionState.setTabContextMenu,
    sessionAuthPrompts: sessionState.sessionAuthPrompts,
    sshChannelUsage: sessionState.sshChannelUsage,
    tabsOverflow: topbarState.tabsOverflow,
    tabActionsRef: topbarState.tabActionsRef,
    sessionListBtnRef: topbarState.sessionListBtnRef,
    toggleSessionList: topbarState.toggleSessionList,
    closeAllSessions: sessionState.closeAllSessions,
    showThemeQuickEntry: globalEvents.showThemeQuickEntry,
    activeAIDevilMode,
    resolvedQuickThemeMode: globalEvents.resolvedQuickThemeMode,
    handleQuickThemeToggle: globalEvents.handleQuickThemeToggle,
    isActiveSessionConnected: sessionState.isActiveSessionConnected,
    showAIPanel,
    setAIPanelVisibility,
    startupUpdateInfo,
    showUpdateBubble,
    isUpdateModalVisible,
    setShowUpdateBubble,
    setIsUpdateModalVisible,
    setSettingsInitialTab,
    handleToggleMaximise: topbarState.handleToggleMaximise,
    handleCloseWindow: sessionState.handleCloseWindow,
    reconnectSession: sessionState.reconnectSession,
  };

  const sharedProps = { addToast: looseAddToast, t: looseT };

  const dialogsProps = {
    activeAIDevilMode, closePortForwardDialog, connectSerial: sessionState.connectSerial, loadServers: sessionState.loadServers, portForwardDialogSessionId, portForwardInitialMapping, portForwardInitialTab, probePanelPosition, setProbePanelPosition, setSettingsInitialTab, setShowCredentials, setShowSerialModal, setShowSettings, settingsInitialTab, showCredentials, showPortForwardDialog, showSerialModal, showSettings,
  };

  const importExportProps = {
    exportSelectedIds, handleDownloadTemplate, handleExport, handleExportSelected, handleImport, hasRecoveryPassword, ieBusy, setExportSelectedIds, setShowExportSelectedDialog, setShowImportExportDialog, showExportSelectedDialog, showImportExportDialog,
  };

  const notificationsProps = {
    downloadProgress, handleApplyStartupUpdate, handleToastAction, isUpdateModalVisible, removeToast, setIsUpdateModalVisible, setSyncFailed: sessionState.setSyncFailed, startupUpdateInfo, syncFailed: sessionState.syncFailed, toasts,
  };

  const menusProps = {
    activeSessionId: sessionState.activeSessionId, canCopySessionPassword: sessionState.canCopySessionPassword, canMoveTerminalToDockTarget: sessionState.canMoveTerminalToDockTarget, closeAllSessions: sessionState.closeAllSessions, closeSession: sessionState.closeSession, closeTerminal: sessionState.closeTerminal, closeTerminalGroup: sessionState.closeTerminalGroup, forceCloseSession: sessionState.forceCloseSession, handleCopySessionPassword: sessionState.handleCopySessionPassword, handleRenameTerminalTab: sessionState.handleRenameTerminalTab, handleTabClick: sessionState.handleTabClick, isTerminalDockTargetOccupied: sessionState.isTerminalDockTargetOccupied, moveTerminalToDockTarget: sessionState.moveTerminalToDockTarget, sessionAuthPrompts: sessionState.sessionAuthPrompts, sessionListPos: topbarState.sessionListPos, sessionListQuery: topbarState.sessionListQuery, sessionListRef: topbarState.sessionListRef, sessions: sessions as TopbarSession[], setSessionListQuery: topbarState.setSessionListQuery, setShowSessionList: topbarState.setShowSessionList, setTabContextMenu: sessionState.setTabContextMenu, setTerminalTabContextMenu: sessionState.setTerminalTabContextMenu, showSessionList: topbarState.showSessionList, tabContextMenu: sessionState.tabContextMenu, terminalTabContextMenu: sessionState.terminalTabContextMenu,
  };

  const animationProps = {
    editFlyAnimation: animations.editFlyAnimation as unknown as AppOverlaysProps['animation']['editFlyAnimation'], editorModeBanner: animations.editorModeBanner,
  };

  const mcpProps = {
    mcpActivityEnabled: globalEvents.mcpActivityEnabled,
    sessions,
    showMCPActivity: globalEvents.showMCPActivity,
    mcpToggleOffset: globalEvents.mcpToggleOffset,
    mcpActivityOffset: globalEvents.mcpActivityOffset,
    handleMCPToggleClick: globalEvents.handleMCPToggleClick,
    handleMCPToggleDragStart: globalEvents.handleMCPToggleDragStart,
    setMcpToggleOffset: globalEvents.setMcpToggleOffset,
    setShowMCPActivity: globalEvents.setShowMCPActivity,
    openMCPActivity: globalEvents.openMCPActivity,
    handleMCPActivityDragStart: globalEvents.handleMCPActivityDragStart,
    setMcpActivityOffset: globalEvents.setMcpActivityOffset,
  };

  return {
    servers,
    credentials,
    serverEditor,
    setServerEditor,
    setShowCredentials,
    setShowSerialModal,
    handleOpenImportExport,
    handleRefreshPing,
    isRefreshingPing,
    pingCounts,
    pingEnabled,
    pings,
    handleBatchExport,
    openPortForwardDialog,
    serversRef,
    sessionsRef,
    sessionState,
    panelLayout: {
      leftSplitWidth,
      bottomSplitHeight,
      probePanelWidth,
      probePanelPosition,
      probePanelCollapsed,
      aiPanelWidth,
      showAIPanel,
      monitoringEnabled: sessionState.monitoringEnabled,
      probeSnapshots,
      setProbeSnapshots,
      setMonitoringEnabled: sessionState.setMonitoringEnabled,
      setAIPanelVisibility,
      setProbePanelCollapsedPersistent,
    },
    preferences: {
      searchQuery,
      setSearchQuery,
      serverListViewMode,
      setServerListViewMode,
      hideSensitive,
      setHideSensitive,
      dashboardHostPageMode,
      setDashboardHostPageMode,
      recentConnectionIds,
      clearRecentConnections,
      removeRecentConnection,
    },
    aiReview: {
      activeChangeReview,
      activeChangeReviewQueue,
      activeConversationDiffPanel,
      activeRestorePreviewReview,
      activeAIWorkspaceTabKey,
      activeAIWorkspaceTabId,
      handleApplyConversationDiffRestore,
      handleReapplyConversationDiffItem,
      handleSelectConversationDiffItem,
      setConversationDiffPanels,
      setRestorePreviewReviews,
      setAIPanelDevilModes,
      setActiveAIWorkspaceTabs,
    },
    animations,
    serverOps,
    quickCommands: {
      handleQuickCommandsOpenChange,
      quickCmdsRef,
      setShowQuickCommands,
      showQuickCommands,
    },
    globalEvents,
    shared: sharedProps,
    topbarProps,
    overlaysProps: {
      dialogs: dialogsProps,
      importExport: importExportProps,
      notifications: notificationsProps,
      menus: menusProps,
      animation: animationProps,
      shared: sharedProps,
    },
    mcpProps,
  };
}
