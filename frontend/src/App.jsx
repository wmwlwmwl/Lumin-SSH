import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EventsOn, WindowMinimise, WindowShow } from '../wailsjs/runtime/runtime.js';
import * as AppGo from '../wailsjs/go/main/App.js';
import ProbePanel from './components/ProbePanel.jsx';
import FileManager from './components/FileManager.jsx';
import AIPanel from './components/AIPanel.jsx';
import { isRecoveryPasswordError, syncWithRecoveryPassword } from './utils/recoveryPasswordSync.js';
import {
  getAllSessionFileManagerWorkspaces,
  getSessionFileManagerWorkspace,
  remapSessionFileManagerWorkspaces,
  replaceAllSessionFileManagerWorkspaces,
  setSessionFileManagerWorkspace,
} from './utils/fileWorkbench.js';
import AppTopbar from './components/AppTopbar.jsx';
import SessionWorkspace from './components/SessionWorkspace.jsx';
import AppOverlays from './components/AppOverlays.jsx';
import {
  sortTerminalPaneCells,
  getTerminalPaneRect,
  getTerminalPaneRemainingCells,
  getTerminalDockTargetCellId,
  splitTerminalPaneCells,
  remapTerminalPaneLayouts,
  isTerminalPaneRectangular,
  normalizeTwoTerminalPaneLayout,
} from './utils/terminalPaneLayout.js';
import {
  buildAIWorkspaceTerminalPanelKey,
  formatAIQuotedSelection,
  resolveAIWorkspaceTerminalBindingByTerminalId,
  remapSessionFileManagerWorkspaceMap,
  cloneSessionFileManagerWorkspaceState,
  buildTerminalCloneCwdCommand,
  normalizeWorkspaceContentTab,
  isUnsupportedMonitorSession,
  remapSessionWorkspaceLayouts,
} from './utils/sessionWorkspace.js';

import { useTranslation } from './i18n.js';
import { getTerminalTheme } from './utils/theme.js';
import { formatUpdateError, useUpdateChecker } from './hooks/useUpdateChecker.js';
import useServerPing from './hooks/useServerPing.js';
import useToasts from './hooks/useToasts.js';
import useDashboardPreferences from './hooks/useDashboardPreferences.js';
import useWindowState from './hooks/useWindowState.js';
import useImportExport from './hooks/useImportExport.js';
import useServerCatalog from './hooks/useServerCatalog.js';
import useWorkspacePersistence, { useWorkspaceSessionPersistence } from './hooks/useWorkspacePersistence.js';
import usePanelLayout from './hooks/usePanelLayout.js';
import useWorkspaceSettings from './hooks/useWorkspaceSettings.js';
import useSessionWorkspaceModel from './hooks/useSessionWorkspaceModel.js';
import useWorkspacePanelDocking from './hooks/useWorkspacePanelDocking.js';
import usePortForwardDialog from './hooks/usePortForwardDialog.js';
import useAIReview from './hooks/useAIReview.js';
import useSessionConnections from './hooks/useSessionConnections.js';
import useTerminalDocking from './hooks/useTerminalDocking.js';
import useTerminalSubTabs from './hooks/useTerminalSubTabs.js';
import { restoreAIChatTool } from './components/ai/aiChatBridge.js';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import logoImg from './assets/logo.webp';
import logoLightImg from './assets/logo_q.webp';
import logoDarkImg from './assets/logo_s.webp';

const TERMINAL_DOCK_LONG_PRESS_MS = 280;
export default function App() {
  const { t, lang } = useTranslation();
  const [servers, setServers] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const serversRef = useRef([]);
  useEffect(() => { serversRef.current = servers; }, [servers]);
  const [sessions, setSessions] = useState([]);      // { id, serverId, serverName, host, status, osInfo }
  const sessionsRef = useRef([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const cancelledConnectionsRef = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const disconnectingServerIdsRef = useRef(new Map());
  const [activeSessionId, setActiveSessionId] = useState(null);
  // 批量选择
  const [batchSelectionMode, setBatchSelectionMode] = useState(false);
  const [selectedServerIds, setSelectedServerIds] = useState([]);
  const activeSessionIdRef = useRef(null);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const activeTerminalIdRef = useRef(null);
  useEffect(() => { activeTerminalIdRef.current = activeTerminalId; }, [activeTerminalId]);
  const {
    rememberWorkspace,
    workspacePersistenceLevel,
    rememberWorkspaceLoaded,
  } = useWorkspaceSettings();
  const [workspaceRestoreReady, setWorkspaceRestoreReady] = useState(false);
  const [terminalPaneLayouts, setTerminalPaneLayouts] = useState({});
  const terminalPaneLayoutsRef = useRef({});
  useEffect(() => { terminalPaneLayoutsRef.current = terminalPaneLayouts; }, [terminalPaneLayouts]);
  const persistWorkspaceSnapshotRef = useRef(() => { });
  const terminalPaneIdRef = useRef(0);
  const [serversLoaded, setServersLoaded] = useState(false);
  const workspaceRestoreStartedRef = useRef(false);
  const restoringWorkspaceRef = useRef(false);
  const workspaceRestoreNavigationOverrideRef = useRef(false);
  const [restoringWorkspaceSessionIds, setRestoringWorkspaceSessionIds] = useState(new Set());
  const lastTerminalRef = useRef({}); // 记录每个 session 最后选中的终端
  const lastContentTabRef = useRef({}); // 记录每个 session 最后打开的内容页（终端/进程/网络等）
  const [mountedSessions, setMountedSessions] = useState(new Set());
  const [contentTab, setContentTab] = useState('terminal'); // 'terminal' | 'files' | 'process' | 'network' | 'history'
  const contentTabRef = useRef(contentTab);
  const {
    showPortForwardDialog,
    portForwardDialogSessionId,
    portForwardInitialMapping,
    portForwardInitialTab,
    portListeningEnabled,
    handlePortListeningEnabledChange,
    openPortForwardDialog,
    closePortForwardDialog,
  } = usePortForwardDialog();
  useEffect(() => { contentTabRef.current = contentTab; }, [contentTab]);
  const [serverEditor, setServerEditor] = useState(null);
  const [editFlyAnimation, setEditFlyAnimation] = useState(null);
  const [editFlyShiningFields, setEditFlyShiningFields] = useState({});
  const [saveFlowHighlights, setSaveFlowHighlights] = useState({ serverId: null, rowPulse: null, fields: {} });
  const [editorModeBanner, setEditorModeBanner] = useState(null);
  const editFlyTimerRef = useRef(null);
  const editFlyFieldTimerRefs = useRef([]);
  const editFlyShineTimerRefs = useRef([]);
  const editorModeBannerTimerRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('general');
  const [showCredentials, setShowCredentials] = useState(false);
  const [showSerialModal, setShowSerialModal] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState(null);
  const [terminalTabContextMenu, setTerminalTabContextMenu] = useState(null);
  useEffect(() => {
    if (!tabContextMenu && !terminalTabContextMenu) return;
    const close = () => {
      setTabContextMenu(null);
      setTerminalTabContextMenu(null);
    };
    // 延迟注册避免右键事件立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('click', close);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [tabContextMenu, terminalTabContextMenu]);
  const [connectingServers, setConnectingServers] = useState([]); // [{ server, sessionId, startTime }]
  const [sshChannelUsage, setSshChannelUsage] = useState({}); // sessionId -> { terminals, sharedSftp, uploadPool, total, maxSessions }
  const connectingServersRef = useRef([]);
  useEffect(() => { connectingServersRef.current = connectingServers; }, [connectingServers]);
  // 会话内待处理的交互：主机密钥确认 / 认证失败重输密码。
  // 按 sessionId 分键，批量连接时每个会话各自渲染一张卡片，不再走全局单例弹窗。
  const [sessionAuthPrompts, setSessionAuthPrompts] = useState({}); // sessionId -> { kind, title, message, ... }
  // 同一会话可能连续多次要求输入（密码输错重试），token 递增作为 React key，
  // 强制重建卡片，避免复用旧实例导致输入框残留旧值 / 提交守卫失效。
  const authPromptTokenRef = useRef(0);
  const clearSessionAuthPrompt = useCallback((sessionId) => {
    setSessionAuthPrompts((prev) => {
      if (!prev[sessionId]) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);
  const {
    toasts,
    addToast,
    removeToast,
    handleToastAction,
  } = useToasts();
  const handleDetectedRemotePort = useCallback((sessionId, port) => {
    addToast(
      `${t('检测到远端新监听端口')} ${port}`,
      'info',
      12000,
      [
        { label: t('忽略') },
        { label: t('设置'), onClick: () => openPortForwardDialog(sessionId, port) },
      ]
    );
  }, [addToast, openPortForwardDialog, t]);
  const {
    changeReviewQueues,
    restorePreviewReviews,
    conversationDiffPanels,
    setRestorePreviewReviews,
    setConversationDiffPanels,
    enqueueChangeReview,
    removeChangeReviewsByRequestId,
    removeChangeReviewsBySessionId,
    handleReapplyConversationDiffItem,
    handleApplyConversationDiffRestore,
    handleSelectConversationDiffItem,
  } = useAIReview({ sessionsRef, addToast, t });
  const [monitoringEnabled, setMonitoringEnabled] = useState({});
  const [probeSnapshots, setProbeSnapshots] = useState({});
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
    pings,
    pingEnabled,
    isRefreshingPing,
    pingCounts,
    handleRefreshPing,
  } = useServerPing({ serversRef, activeSessionId, dashboardHostPageMode });
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  const quickCmdsRef = useRef(null);
  const showQuickCommandsRef = useRef(false);
  useEffect(() => { showQuickCommandsRef.current = showQuickCommands; }, [showQuickCommands]);

  const [creatingTerminalSessionId, setCreatingTerminalSessionId] = useState(null);
  const creatingTerminalRef = useRef(null);

  // ponytail: 9 处 setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s)) 提取为帮助函数
  const updateSessionStatus = useCallback((id, status) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  }, []);
  const markConnectionCancelled = useCallback((terminalIds) => {
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
  const awaitDisconnectTerminals = useCallback((terminalIds) => {
    const ids = Array.from(new Set(
      (Array.isArray(terminalIds) ? terminalIds : [terminalIds])
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
    ));
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return Promise.allSettled(ids.map((id) => AppGo.DisconnectSSH(id)));
  }, []);
  const disconnectSessionTerminals = useCallback((terminalIds) => {
    const ids = markConnectionCancelled(terminalIds);
    return awaitDisconnectTerminals(ids);
  }, [awaitDisconnectTerminals, markConnectionCancelled]);
  const registerServerDisconnect = useCallback((serverId, disconnectPromise) => {
    const normalizedServerId = typeof serverId === 'string' ? serverId.trim() : '';
    if (!normalizedServerId || !disconnectPromise) {
      return;
    }
    let trackedPromise = null;
    trackedPromise = Promise.resolve(disconnectPromise).catch(() => { }).finally(() => {
      if (disconnectingServerIdsRef.current.get(normalizedServerId) === trackedPromise) {
        disconnectingServerIdsRef.current.delete(normalizedServerId);
      }
    });
    disconnectingServerIdsRef.current.set(normalizedServerId, trackedPromise);
  }, []);
  const waitForServerDisconnect = useCallback(async (serverId) => {
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

  // ponytail: 3 处 s.terminals?.length > 0 ? s.terminals : [{ id: s.id }] 提取为帮助函数
  const getEffectiveTerminals = useCallback((s) => s.terminals?.length > 0 ? s.terminals : [{ id: s.id }], []);
  const getSessionPanes = useCallback((layoutId, layoutSource = terminalPaneLayouts) => layoutSource[layoutId]?.panes || [], [terminalPaneLayouts]);
  const getSessionRootPaneCells = useCallback((layoutId, layoutSource = terminalPaneLayouts) => (
    getTerminalPaneRemainingCells(getSessionPanes(layoutId, layoutSource))
  ), [getSessionPanes, terminalPaneLayouts]);
  const getSessionPaneLayouts = useCallback((sessionId, layoutSource = terminalPaneLayouts) => (
    Object.entries(layoutSource)
      .filter(([, layout]) => layout?.sessionId === sessionId)
      .map(([layoutId, layout]) => ({
        ...layout,
        id: layoutId,
        rootTerminalId: layout.rootTerminalId || layoutId,
        panes: layout.panes || [],
      }))
  ), [terminalPaneLayouts]);
  const getSessionGroupedTerminalIds = useCallback((sessionId, layoutSource = terminalPaneLayouts) => {
    const ids = new Set();
    getSessionPaneLayouts(sessionId, layoutSource).forEach((layout) => {
      ids.add(layout.rootTerminalId);
      (layout.panes || []).forEach((pane) => ids.add(pane.terminalId));
    });
    return ids;
  }, [getSessionPaneLayouts, terminalPaneLayouts]);
  const getSessionRootTerminals = useCallback((session, layoutSource = terminalPaneLayouts) => {
    const groupedTerminalIds = getSessionGroupedTerminalIds(session.id, layoutSource);
    return getEffectiveTerminals(session).filter((term) => !groupedTerminalIds.has(term.id));
  }, [getEffectiveTerminals, getSessionGroupedTerminalIds, terminalPaneLayouts]);
  const getSessionWorkspaceTabs = useCallback((session, layoutSource = terminalPaneLayouts) => {
    const terminals = getEffectiveTerminals(session);
    const terminalById = new Map(terminals.map((term) => [term.id, term]));
    const layoutsByRoot = new Map(getSessionPaneLayouts(session.id, layoutSource).map((layout) => [layout.rootTerminalId, layout]));
    const groupedTerminalIds = getSessionGroupedTerminalIds(session.id, layoutSource);
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
  const resolveSessionRootTerminalId = useCallback((session, preferredId, layoutSource = terminalPaneLayouts, preferredLabel = '') => {
    const tabs = getSessionWorkspaceTabs(session, layoutSource);
    if (!tabs.length) {
      return null;
    }
    if (preferredId && tabs.some((tab) => tab.id === preferredId)) {
      return preferredId;
    }
    // 重连后 id 会变，用标签名兜底（如「终端3」）
    const label = typeof preferredLabel === 'string' ? preferredLabel.trim() : '';
    if (label) {
      const byLabel = tabs.find((tab) => String(tab.label || '').trim() === label);
      if (byLabel) {
        return byLabel.id;
      }
    }
    // session 上缓存的上次选中（含 label）
    const cachedId = session?.activeTerminalId;
    if (cachedId && tabs.some((tab) => tab.id === cachedId)) {
      return cachedId;
    }
    const cachedLabel = typeof session?.activeTerminalLabel === 'string' ? session.activeTerminalLabel.trim() : '';
    if (cachedLabel) {
      const byCachedLabel = tabs.find((tab) => String(tab.label || '').trim() === cachedLabel);
      if (byCachedLabel) {
        return byCachedLabel.id;
      }
    }
    return tabs[0]?.id || null;
  }, [getSessionWorkspaceTabs, terminalPaneLayouts]);
  // 写入每个会话「上次选中终端」——同时更新 ref 与 session 字段，保证持久化不丢
  const rememberSessionActiveTerminal = useCallback((sessionId, terminalId, terminalLabel = '') => {
    if (!sessionId || !terminalId) {
      return;
    }
    lastTerminalRef.current[sessionId] = terminalId;
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        const label = terminalLabel
          || session.terminals?.find((term) => term.id === terminalId)?.label
          || session.activeTerminalLabel
          || '';
        if (session.activeTerminalId === terminalId && session.activeTerminalLabel === label) {
          return session;
        }
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

  const renderSessionFileManagers = (s) => getEffectiveTerminals(s).map(t => {
    const isActive = activeSessionId === s.id && activeTerminalId === t.id;
    const serverConfig = serversRef.current.find((server) => server.id === s.serverId);
    return (
      <div key={t.id} style={isActive ? { display: 'contents' } : { display: 'none' }}>
        <FileManager
          sessionId={t.id}
          sessionGroupId={s.id}
          addToast={addToast}
          isActive={isActive}
          initialPath={serverConfig?.fileManagerInitPath || ''}
        />
      </div>
    );
  });

  // ── 新增自动检测更新状态 ──────────────────────────────
  const [startupUpdateInfo, setStartupUpdateInfo] = useState(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [showUpdateBubble, setShowUpdateBubble] = useState(false);
  const updateBubbleTimeoutRef = useRef(null);
  const updateBubbleRemainingRef = useRef(4000);
  const updateBubbleStartedAtRef = useRef(0);
  const [syncFailed, setSyncFailed] = useState(null); // { provider, error }

  // ── 新增分屏拖拽大小控制状态与逻辑 ──────────────────────
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
    leftSplitWidth,
    leftSplitWidthRef,
    aiPanelWidthRef,
    probePanelPosition,
    probePanelWidthRef,
    setAIPanelVisibility,
    setContentTab,
    setProbePanelCollapsedPersistent,
    showQuickCommandsRef,
    updateAiPanelWidth,
    updateBottomSplitHeight,
    updateLeftSplitWidth,
    updateProbePanelWidth,
  });
  const [showSessionList, setShowSessionList] = useState(false);
  const [terminalThemeToggle, setTerminalThemeToggle] = useState(0);
  const [sessionListPos, setSessionListPos] = useState({ x: 0, y: 0 });
  const [sessionListQuery, setSessionListQuery] = useState('');
  const sessionListBtnRef = useRef(null);
  const sessionListRef = useRef(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabScrollRef = useRef(null);
  const tabListRef = useRef(null);
  const tabActionsRef = useRef(null);
  const terminalSubTabScrollRef = useRef(null);
  const terminalSubTabActionsRef = useRef(null);
  const [terminalSubTabOverflow, setTerminalSubTabOverflow] = useState(false);
  const [terminalSubTabCanScrollLeft, setTerminalSubTabCanScrollLeft] = useState(false);
  const [terminalSubTabCanScrollRight, setTerminalSubTabCanScrollRight] = useState(false);
  const terminalSubTabDragSuppressUntilRef = useRef(0);
  const terminalSubTabScrollTargetRef = useRef(0);
  const terminalSubTabScrollFrameRef = useRef(0);
  const terminalSubTabDraggingRef = useRef(false);
  // 按会话记忆终端子标签横向滚动位置（回首页再进 / 切会话不丢）
  const terminalSubTabScrollBySessionRef = useRef({});
  const terminalDockLongPressTimerRef = useRef(null);
  const terminalDockPointerCleanupRef = useRef(null);
  const terminalDockClickSuppressUntilRef = useRef(0);
  const [terminalDockDragPreview, setTerminalDockDragPreview] = useState(null);
  const clearTerminalDockLongPressTimer = useCallback(() => {
    if (!terminalDockLongPressTimerRef.current) {
      return;
    }
    clearTimeout(terminalDockLongPressTimerRef.current);
    terminalDockLongPressTimerRef.current = null;
  }, []);
  const shouldIgnoreTerminalDockClick = useCallback(() => Date.now() < terminalDockClickSuppressUntilRef.current, []);
  const getTerminalDockPreviewZones = useCallback(() => {
    const container = document.getElementById('terminal-dock-preview-host');
    if (!container) {
      return [];
    }
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return [];
    }

    const inset = 18;
    const gap = 14;
    const innerWidth = rect.width - inset * 2;
    const innerHeight = rect.height - inset * 2;
    if (innerWidth <= gap || innerHeight <= gap) {
      return [];
    }

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
  const getTerminalDockPreviewTarget = useCallback((clientX, clientY, zones) => {
    return zones.find((zone) =>
      clientX >= zone.bounds.left
      && clientX <= zone.bounds.right
      && clientY >= zone.bounds.top
      && clientY <= zone.bounds.bottom
    )?.target || null;
  }, []);

  const handleToggleMaximise = useWindowState();
  const handleTopbarDoubleClick = useCallback((event) => {
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch { }
    if (
      event.target.closest('button')
      || event.target.closest('input')
      || event.target.closest('.no-drag')
      || event.target.closest('.topbar-logo')
      || event.target.closest('.tab-item')
    ) {
      return;
    }
    event.preventDefault();
    handleToggleMaximise();
  }, [handleToggleMaximise]);

  useEffect(() => {
    if (!showSessionList) return;
    const handler = (e) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target) &&
        sessionListBtnRef.current && !sessionListBtnRef.current.contains(e.target)) {
        setShowSessionList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSessionList]);
  const toggleSessionList = useCallback(() => {
    if (showSessionList) { setShowSessionList(false); return; }
    const rect = sessionListBtnRef.current.getBoundingClientRect();
    setSessionListPos({ x: rect.right, y: rect.bottom + 4 });
    setSessionListQuery('');
    setShowSessionList(true);
  }, [showSessionList]);
  useEffect(() => {
    const scroll = tabScrollRef.current;
    const list = tabListRef.current;
    if (!scroll || !list) return;
    const check = () => {
      setTabsOverflow(list.scrollWidth > scroll.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(scroll);
    ro.observe(list);
    return () => ro.disconnect();
  }, [sessions]);
  useEffect(() => {
    const refreshTerminalTheme = () => setTerminalThemeToggle((prev) => prev + 1);
    window.addEventListener('terminal-theme-changed', refreshTerminalTheme);
    window.addEventListener('theme-mode-changed', refreshTerminalTheme);
    return () => {
      window.removeEventListener('terminal-theme-changed', refreshTerminalTheme);
      window.removeEventListener('theme-mode-changed', refreshTerminalTheme);
    };
  }, []);
  useEffect(() => {
    const refreshThemeQuickEntry = () => {
      setQuickThemeMode(localStorage.getItem('themeMode') || 'dark');
      setShowThemeQuickEntry(localStorage.getItem('showThemeQuickEntry') !== 'false');
    };
    window.addEventListener('theme-mode-changed', refreshThemeQuickEntry);
    window.addEventListener('theme-quick-entry-changed', refreshThemeQuickEntry);
    return () => {
      window.removeEventListener('theme-mode-changed', refreshThemeQuickEntry);
      window.removeEventListener('theme-quick-entry-changed', refreshThemeQuickEntry);
    };
  }, []);
  useEffect(() => {
    const handler = () => {
      setTerminalToolbarIconOnly(localStorage.getItem('terminalToolbarIconOnly') === 'true');
    };
    window.addEventListener('terminal-toolbar-icon-only-changed', handler);
    return () => window.removeEventListener('terminal-toolbar-icon-only-changed', handler);
  }, []);
  const terminalSubTabTheme = useMemo(() => getTerminalTheme(), [terminalThemeToggle]);
  const [quickThemeMode, setQuickThemeMode] = useState(localStorage.getItem('themeMode') || 'dark');
  const [showThemeQuickEntry, setShowThemeQuickEntry] = useState(localStorage.getItem('showThemeQuickEntry') !== 'false');
  const [terminalToolbarIconOnly, setTerminalToolbarIconOnly] = useState(localStorage.getItem('terminalToolbarIconOnly') === 'true');
  const [showTopbarRefreshedLogo, setShowTopbarRefreshedLogo] = useState(false);
  const [aiPanelDevilModes, setAIPanelDevilModes] = useState({});
  const activeAIPanelKey = useMemo(() => buildAIWorkspaceTerminalPanelKey(activeSessionId, activeTerminalId), [activeSessionId, activeTerminalId]);
  const activeAIDevilMode = activeAIPanelKey ? aiPanelDevilModes[activeAIPanelKey] === true : false;

  const handleQuickCommandsOpenChange = useCallback((open) => {
    if (open) {
      setShowQuickCommands(true);
      return;
    }
    if (quickCmdsRef.current?.isDirty?.()) {
      quickCmdsRef.current.showCloseConfirm();
      return;
    }
    setShowQuickCommands(false);
  }, []);
  const resolveQuickThemeMode = useCallback((mode) => {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return mode === 'light' ? 'light' : 'dark';
  }, []);
  const resolvedQuickThemeMode = activeAIDevilMode ? 'dark' : resolveQuickThemeMode(quickThemeMode);
  const topbarLogoTransitionImg = resolvedQuickThemeMode === 'light' ? logoLightImg : logoDarkImg;
  const handleQuickThemeToggle = useCallback(() => {
    if (activeAIDevilMode) {
      return;
    }
    const nextMode = resolvedQuickThemeMode === 'light' ? 'dark' : 'light';
    localStorage.setItem('themeMode', nextMode);
    setQuickThemeMode(nextMode);
    if (nextMode === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    window.dispatchEvent(new CustomEvent('theme-mode-changed'));
  }, [activeAIDevilMode, resolvedQuickThemeMode]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowTopbarRefreshedLogo(true);
    }, 260);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  // ────────────────────────────────────────────────────────

  useEffect(() => {
    const handleSendTerminalSelectionToAI = (event) => {
      const selectedText = typeof event?.detail?.text === 'string' ? event.detail.text.trim() : '';
      const targetSessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const sourceTerminalId = typeof event?.detail?.terminalId === 'string' ? event.detail.terminalId.trim() : '';
      if (!selectedText || !targetSessionId) {
        return;
      }
      const session = sessionsRef.current.find((item) => item.id === targetSessionId);
      if (!session) {
        return;
      }
      const nextTerminalId = activeSessionIdRef.current === targetSessionId && activeTerminalIdRef.current
        ? activeTerminalIdRef.current
        : resolveSessionRootTerminalId(session, sourceTerminalId || lastTerminalRef.current[targetSessionId]);
      if (!nextTerminalId) {
        return;
      }
      markWorkspaceRestoreNavigationOverride();
      setAIPanelVisibility(true);
      setActiveSessionId(targetSessionId);
      setActiveTerminalId(nextTerminalId);
      setContentTab('terminal');
      window.dispatchEvent(new CustomEvent('ai-composer-append', {
        detail: {
          sessionId: targetSessionId,
          terminalId: nextTerminalId,
          text: selectedText,
        },
      }));
    };

    const handleQuoteSelectionToAI = (event) => {
      const selectedText = typeof event?.detail?.text === 'string' ? event.detail.text : '';
      const quotedText = formatAIQuotedSelection(selectedText);
      const currentSessionId = activeSessionIdRef.current;
      if (!currentSessionId || !quotedText) {
        return;
      }
      const session = sessionsRef.current.find((item) => item.id === currentSessionId);
      if (!session) {
        return;
      }
      const preferredTerminalId = activeTerminalIdRef.current || lastTerminalRef.current[currentSessionId] || '';
      const activeLayout = preferredTerminalId ? terminalPaneLayoutsRef.current[preferredTerminalId] : null;
      const resolvedTerminalId = activeLayout?.sessionId === currentSessionId
        ? (activeLayout.rootTerminalId || preferredTerminalId)
        : resolveSessionRootTerminalId(session, preferredTerminalId, terminalPaneLayoutsRef.current);
      if (!resolvedTerminalId) {
        return;
      }
      window.dispatchEvent(new CustomEvent('ai-composer-append', {
        detail: {
          sessionId: currentSessionId,
          terminalId: resolvedTerminalId,
          text: quotedText,
          preserveWhitespace: true,
        },
      }));
    };

    window.addEventListener('ai-terminal-send-to-assistant', handleSendTerminalSelectionToAI);
    window.addEventListener('ai-quote-selection', handleQuoteSelectionToAI);
    return () => {
      window.removeEventListener('ai-terminal-send-to-assistant', handleSendTerminalSelectionToAI);
      window.removeEventListener('ai-quote-selection', handleQuoteSelectionToAI);
    };
  }, [markWorkspaceRestoreNavigationOverride, resolveSessionRootTerminalId, setAIPanelVisibility]);

  useEffect(() => {
    const handleAIThemeTuningRequest = (event) => {
      const slot = typeof event?.detail?.slot === 'string' ? event.detail.slot.trim() : '';
      if (slot !== 'light' && slot !== 'dark') {
        return;
      }
      const connectedSessionList = sessionsRef.current.filter((session) => session.status === 'connected');
      const preferredSession = activeSessionIdRef.current
        ? connectedSessionList.find((session) => session.id === activeSessionIdRef.current)
        : null;
      const targetSession = preferredSession || connectedSessionList[0] || null;
      if (!targetSession) {
        addToast(t('需要先连接一个终端会话后再使用 AI 调色'), 'warning', 3200);
        return;
      }
      const targetTerminalId = resolveSessionRootTerminalId(
        targetSession,
        targetSession.id === activeSessionIdRef.current ? activeTerminalIdRef.current : (lastTerminalRef.current[targetSession.id] || targetSession.activeTerminalId),
        terminalPaneLayoutsRef.current,
        targetSession.activeTerminalLabel || '',
      ) || targetSession.id;
      markWorkspaceRestoreNavigationOverride();
      setAIPanelVisibility(true);
      setActiveSessionId(targetSession.id);
      setActiveTerminalId(targetTerminalId);
      setContentTab('terminal');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ai-theme-tuning-start', {
          detail: {
            sessionId: targetSession.id,
            terminalId: targetTerminalId,
            slot,
          },
        }));
      }, 40);
    };
    window.addEventListener('ai-theme-tuning-request', handleAIThemeTuningRequest);
    return () => window.removeEventListener('ai-theme-tuning-request', handleAIThemeTuningRequest);
  }, [addToast, markWorkspaceRestoreNavigationOverride, resolveSessionRootTerminalId, setAIPanelVisibility, t]);


  // ── 初始化全局主题 ──────────────────────────────────────
  useEffect(() => {
    const applyTheme = () => {
      if (activeAIDevilMode) {
        window.__luminForceDarkTheme = true;
        document.body.classList.remove('theme-light');
        window.dispatchEvent(new CustomEvent('theme-mode-changed'));
        return;
      }
      window.__luminForceDarkTheme = false;
      const savedTheme = localStorage.getItem('themeMode') || 'dark';
      const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const applyLight = savedTheme === 'light' || (savedTheme === 'system' && isSystemLight);
      if (applyLight) document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
      window.dispatchEvent(new CustomEvent('theme-mode-changed'));
    };
    applyTheme();

    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [activeAIDevilMode]);

  // ── 自动检测更新机制 ────────────────────────────────────
  const { checkUpdate, applyUpdate, downloadProgress } = useUpdateChecker({
    onResult: (result) => {
      if (result.hasUpdate) {
        setStartupUpdateInfo({
          version: 'v' + result.latestVersion,
          url: result.url,
          filename: result.filename,
        });
      }
    }
  });

  useEffect(() => {
    // 延迟 2.5 秒触发检测，避免阻塞应用首次极速渲染
    const timer = setTimeout(checkUpdate, 2500);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  useEffect(() => {
    const clearBubbleTimer = () => {
      if (updateBubbleTimeoutRef.current) {
        clearTimeout(updateBubbleTimeoutRef.current);
        updateBubbleTimeoutRef.current = null;
      }
    };

    const pauseBubbleTimer = () => {
      if (!updateBubbleTimeoutRef.current || !updateBubbleStartedAtRef.current) {
        return;
      }
      const elapsed = Date.now() - updateBubbleStartedAtRef.current;
      updateBubbleRemainingRef.current = Math.max(0, updateBubbleRemainingRef.current - elapsed);
      updateBubbleStartedAtRef.current = 0;
      clearBubbleTimer();
    };

    const startBubbleTimer = () => {
      if (updateBubbleTimeoutRef.current) {
        return;
      }
      if (!startupUpdateInfo || updateBubbleRemainingRef.current <= 0) {
        setShowUpdateBubble(false);
        return;
      }
      if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) {
        return;
      }
      updateBubbleStartedAtRef.current = Date.now();
      updateBubbleTimeoutRef.current = window.setTimeout(() => {
        updateBubbleTimeoutRef.current = null;
        updateBubbleStartedAtRef.current = 0;
        updateBubbleRemainingRef.current = 0;
        setShowUpdateBubble(false);
      }, updateBubbleRemainingRef.current);
    };

    if (!startupUpdateInfo) {
      clearBubbleTimer();
      updateBubbleRemainingRef.current = 4000;
      updateBubbleStartedAtRef.current = 0;
      setShowUpdateBubble(false);
      return undefined;
    }

    clearBubbleTimer();
    updateBubbleRemainingRef.current = 4000;
    updateBubbleStartedAtRef.current = 0;
    setShowUpdateBubble(true);
    startBubbleTimer();

    const handleFocus = () => startBubbleTimer();
    const handleBlur = () => pauseBubbleTimer();
    const handleVisibilityChange = () => {
      if (document.hidden) {
        pauseBubbleTimer();
        return;
      }
      startBubbleTimer();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearBubbleTimer();
      updateBubbleStartedAtRef.current = 0;
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startupUpdateInfo]);

  const handleApplyStartupUpdate = async () => {
    try {
      await applyUpdate(startupUpdateInfo);
    } catch (err) {
      addToast(`${t('自动更新失败')}: ${formatUpdateError(err)}`, 'error', 5000);
    }
  };

  const activeWorkspaceTerminalKey = useMemo(() => buildAIWorkspaceTerminalPanelKey(activeSessionId, activeTerminalId), [activeSessionId, activeTerminalId]);
  const activeChangeReviewQueue = useMemo(() => (
    activeWorkspaceTerminalKey && Array.isArray(changeReviewQueues[activeWorkspaceTerminalKey])
      ? changeReviewQueues[activeWorkspaceTerminalKey]
      : []
  ), [activeWorkspaceTerminalKey, changeReviewQueues]);
  const activeChangeReview = activeChangeReviewQueue.length > 0 ? activeChangeReviewQueue[0] : null;
  const activeRestorePreviewReview = activeWorkspaceTerminalKey
    ? restorePreviewReviews[activeWorkspaceTerminalKey] || null
    : null;
  const activeConversationDiffPanel = activeWorkspaceTerminalKey
    ? conversationDiffPanels[activeWorkspaceTerminalKey] || null
    : null;

  // ── 连接错误通用处理 ──────────────────────────────────────
  const { buildSessionWorkspaceSnapshot, loadServerWorkspaceSessionSnapshot, persistServerWorkspaceSessionSnapshot } = useWorkspaceSessionPersistence({
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

  const { handleConnectError, postConnectSetup, loadServers, handleCancelConnection, resolveSessionContentTab, switchToNextSession, handleTabClick, canCopySessionPassword, handleCopySessionPassword, reconnectSession, resolveHostKeyChoice, resolvePasswordPrompt, handleCloseWindow, connectServer, connectLocal, connectSerial, forceCloseSession, closeSession, closeAllSessions, openNewTerminal, handleRenameTerminalTab, closeTerminal } = useSessionConnections({ activeSessionIdRef, activeTerminalIdRef, addToast, authPromptTokenRef, awaitDisconnectTerminals, buildTerminalCloneCwdCommand, cancelledConnectionsRef, clearSessionAuthPrompt, cloneSessionFileManagerWorkspaceState, connectingServersRef, contentTabRef, creatingTerminalRef, credentials, disconnectSessionTerminals, enqueueChangeReview, fileManagerPosition, getAllSessionFileManagerWorkspaces, getSessionFileManagerWorkspace, isRecoveryPasswordError, isUnsupportedMonitorSession, lastContentTabRef, lastTerminalRef, loadServerWorkspaceSessionSnapshot, markWorkspaceRestoreNavigationOverride, mountedRef, normalizeWorkspaceContentTab, persistServerWorkspaceSessionSnapshot, persistWorkspaceSnapshotRef, recordRecentConnection, registerServerDisconnect, remapSessionFileManagerWorkspaceMap, remapSessionFileManagerWorkspaces, remapSessionWorkspaceLayouts, remapTerminalPaneLayouts, rememberSessionActiveTerminal, rememberWorkspace, rememberWorkspaceLoaded, removeChangeReviewsByRequestId, replaceAllSessionFileManagerWorkspaces, resolveSessionRootTerminalId, restoringWorkspaceRef, serversLoaded, serversRef, sessionsRef, setActiveSessionId, setActiveTerminalId, setConnectingServers, setContentTab, setCreatingTerminalSessionId, setCredentials, setMonitoringEnabled, setMountedSessions, setRestoringWorkspaceSessionIds, setServers, setServersLoaded, setSessionAuthPrompts, setSessionFileManagerWorkspace, setSessions, setSettingsInitialTab, setShowSettings, setSshChannelUsage, setSyncFailed, setTabContextMenu, setTerminalPaneLayouts, setTerminalSubTabCanScrollLeft, setTerminalSubTabCanScrollRight, setTerminalSubTabOverflow, setTerminalTabContextMenu, setWorkspaceRestoreReady, sortTerminalPaneCells, syncFailed, syncWithRecoveryPassword, t, terminalPaneLayoutsRef, terminalSubTabScrollBySessionRef, terminalSubTabScrollRef, terminalSubTabScrollTargetRef, updateSessionStatus, waitForServerDisconnect, workspacePersistenceLevel, workspaceRestoreNavigationOverrideRef, workspaceRestoreStartedRef });

  const { isTerminalDockTargetOccupied, getTerminalDockTargetStates, canMoveTerminalToDockTarget, handleTerminalPaneDrop, moveTerminalToDockTarget, closeTerminalGroup, closeTerminalPane } = useTerminalDocking({ activeSessionIdRef, activeTerminalIdRef, contentTabRef, disconnectSessionTerminals, getEffectiveTerminals, getSessionGroupedTerminalIds, getSessionPaneLayouts, getSessionPanes, getSessionRootPaneCells, getSessionRootTerminals, lastContentTabRef, lastTerminalRef, persistServerWorkspaceSessionSnapshot, registerServerDisconnect, resolveSessionRootTerminalId, sessionsRef, setActiveTerminalId, setContentTab, setMountedSessions, setSessions, setTabContextMenu, setTerminalPaneLayouts, setTerminalTabContextMenu, switchToNextSession, terminalPaneIdRef, terminalPaneLayouts, terminalPaneLayoutsRef });

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
  });

  const { terminalSubTabScrollStyle, handleTerminalSubTabScroll, handleTerminalSubTabWheel, scrollTerminalSubTabs, handleTerminalSubTabMouseDown, handleTerminalSubTabClickCapture, handleTerminalSubTabDockMouseDown, fileManagerDockDropzones } = useTerminalSubTabs({ TERMINAL_DOCK_LONG_PRESS_MS, activeSessionId, activeSessionRootTerminals, activeTerminalId, canMoveTerminalToDockTarget, clearTerminalDockLongPressTimer, contentTab, fileManagerDockPreview, getFileManagerDockConfirmRect, getSessionRootTerminals, getTerminalDockPreviewTarget, getTerminalDockPreviewZones, getTerminalDockTargetStates, handleTerminalPaneDrop, setTerminalDockDragPreview, setTerminalSubTabCanScrollLeft, setTerminalSubTabCanScrollRight, setTerminalSubTabOverflow, terminalDockClickSuppressUntilRef, terminalDockLongPressTimerRef, terminalDockPointerCleanupRef, terminalSubTabDragSuppressUntilRef, terminalSubTabDraggingRef, terminalSubTabScrollBySessionRef, terminalSubTabScrollFrameRef, terminalSubTabScrollRef, terminalSubTabScrollTargetRef, terminalSubTabTheme });

  const isCreatingTerminal = creatingTerminalSessionId !== null;
  const probeSessions = useMemo(() => sessions.filter((s) => !s.isSerial && !isUnsupportedMonitorSession(s) && (
    s.status === 'connected' || (s.status === 'closed' && monitoringEnabled[s.id])
  )), [monitoringEnabled, sessions]);
  const shouldShowProbePanel = probeSessions.some((s) => s.id === activeSessionId);

  const probePanelNode = shouldShowProbePanel ? (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {probeSessions.map((s) => {
        const isPanelActive = !probePanelCollapsed && activeSessionId === s.id;
        return (
          <div
            key={`probe-panel-${s.id}`}
            style={{
              position: 'absolute',
              inset: 0,
              display: isPanelActive ? 'block' : 'none',
            }}
          >
            <ProbePanel
              sessionId={s.id}
              host={s.host}
              addToast={addToast}
              enabled={!!monitoringEnabled[s.id]}
              active={isPanelActive && s.status === 'connected'}
              snapshot={probeSnapshots[s.id]}
              onSnapshot={(snapshot) => setProbeSnapshots(prev => ({ ...prev, [s.id]: snapshot }))}
              onEnable={() => setMonitoringEnabled(prev => ({ ...prev, [s.id]: true }))}
              onShowAllProcesses={() => setContentTab('process')}
              onShowNetworkDetails={() => setContentTab('network')}
              onOpenPortForward={() => openPortForwardDialog(s.id, null, 'new')}
            />
          </div>
        );
      })}
    </div>
  ) : null;
  // ponytail: AI 面板按会话保活，不依赖当前 active 是否 connected。
  // 否则首页连新服务器 / 重连 / 某台掉线时，AI 树卸载会 cancel 后台请求。
  // closed/error 也保活：掉线只应停那台 SSH，不该拆其它服务器还在跑的 AI。
  // 真正关闭标签（forceClose 移出 sessions）时才卸载。
  const aiKeepAliveSessions = sessions.filter((s) => (
    s.status === 'connected'
    || s.status === 'connecting'
    || s.status === 'closed'
    || s.status === 'error'
  ));
  const aiPanelNode = aiKeepAliveSessions.length > 0 ? (
    <div
      style={{
        width: aiPanelWidth,
        minWidth: aiPanelWidth,
        height: '100%',
        display: showAIPanel && isActiveSessionConnected ? 'flex' : 'none',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {collapseDragIntent === 'ai' && isActiveSessionConnected && (
        <div
          className={`panel-collapse-armed-zone panel-collapse-armed-zone-vertical ${probePanelPosition === 'left' ? 'panel-collapse-armed-zone-left' : 'panel-collapse-armed-zone-right'}`}
        >
          {probePanelPosition === 'left' ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </div>
      )}
      {aiKeepAliveSessions.flatMap((s) => (
        getEffectiveTerminals(s).map((t) => {
          const isPanelActive =
            showAIPanel
            && isActiveSessionConnected
            && activeSessionId === s.id
            && activeTerminalId === t.id;

          return (
            <div
              key={`ai-panel-${s.id}-${t.id}`}
              style={{
                position: 'absolute',
                inset: 0,
                display: isPanelActive ? 'flex' : 'none',
              }}
            >
              <AIPanel
                width="100%"
                side={probePanelPosition}
                sessionId={s.id}
                terminalId={t.id}
                sessionTerminals={getEffectiveTerminals(s)}
                addToast={addToast}
                onDevilModeChange={(enabled) => {
                  const panelKey = buildAIWorkspaceTerminalPanelKey(s.id, t.id);
                  if (!panelKey) {
                    return;
                  }
                  setAIPanelDevilModes((prev) => (
                    prev[panelKey] === enabled
                      ? prev
                      : { ...prev, [panelKey]: enabled }
                  ));
                }}
              />
            </div>
          );
        })
      ))}
    </div>
  ) : null;

  // 同步 activeTerminalId / contentTab 到每个 session 的记忆（含可持久化字段）
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

  // 追踪已访问的 session，仅渲染访问过的 session 组件（避免未激活的 session 创建 xterm/WebSocket）
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

  // ── Server CRUD ────────────────────────────────────────────
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
    removeRecentConnections,
    setServers,
    setServerEditor,
    setSelectedServerIds,
    setBatchSelectionMode,
    startSaveFlowAnimation,
    connectServer,
    t,
  });

  const handleSaveAndConnectServer = useCallback(async (data, shouldClearAfterAdd = true) => {
    markWorkspaceRestoreNavigationOverride();
    try {
      const savedServer = await saveServerConfig(data);
      if (!savedServer) return null;

      addToast(t('服务器添加成功'), 'success');
      if (shouldClearAfterAdd) setServerEditor(null);

      const sessionId = `session_${Date.now()}`;
      const newSession = {
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

      // ponytail: 连接放后台，保存成功立即返回让表单可继续添加。升级：暴露连接状态回调。
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
      addToast(err, 'error');
      return null;
    }
  }, [saveServerConfig, addToast, handleConnectError, markWorkspaceRestoreNavigationOverride, postConnectSetup, t]);

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
  } = useImportExport({ addToast, loadServers, t, lang });

  const connectedSessions = useMemo(() => {
    const seen = new Set();
    return sessions
      .filter(s => s.status === 'connected')
      .filter((s) => {
        if (seen.has(s.serverId)) return false;
        seen.add(s.serverId);
        return true;
      });
  }, [sessions]);


  const getAnimationViewport = useCallback(() => {
    const rootRect = document.querySelector('.app-layout')?.getBoundingClientRect();
    return {
      left: rootRect?.left || 0,
      top: rootRect?.top || 0,
      width: rootRect?.width || window.innerWidth,
      height: rootRect?.height || window.innerHeight,
    };
  }, []);

  const clampLayerPoint = useCallback((point, viewport, padding = 34) => ({
    x: Math.max(padding, Math.min(viewport.width - padding, point.x)),
    y: Math.max(padding, Math.min(viewport.height - padding, point.y)),
  }), []);

  const rectToLayerPoint = useCallback((rect, viewport) => clampLayerPoint({
    x: rect.left - viewport.left + rect.width / 2,
    y: rect.top - viewport.top + rect.height / 2,
  }, viewport), [clampLayerPoint]);

  const buildFlightMidPoint = useCallback((from, to, viewport, index) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const sway = Math.min(132, Math.max(38, distance * 0.18)) * (index % 2 === 0 ? -1 : 1);
    const lift = Math.min(148, Math.max(60, distance * 0.22)) + index * 8;
    return clampLayerPoint({
      x: (from.x + to.x) / 2 + sway,
      y: Math.min(from.y, to.y) - lift,
    }, viewport, 42);
  }, [clampLayerPoint]);

  const startEditFlyAnimation = useCallback((server, payload) => {
    // 屏幕中央大号短提示（比右上角 Toast 更醒目）
    if (editorModeBannerTimerRef.current) {
      clearTimeout(editorModeBannerTimerRef.current);
      editorModeBannerTimerRef.current = null;
    }
    setEditorModeBanner({
      id: Date.now(),
      text: server?.id ? t('已进入编辑 · 请在左侧修改') : t('已进入克隆 · 请在左侧填写'),
    });
    editorModeBannerTimerRef.current = setTimeout(() => {
      setEditorModeBanner(null);
      editorModeBannerTimerRef.current = null;
    }, 1600);

    if (!payload?.sourceRects) {
      setServerEditor(server);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});

    setServerEditor({
      ...server,
      name: '',
      host: '',
      port: '',
      username: '',
      terminalInitPath: '',
      fileManagerInitPath: '',
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const fields = ['name', 'host', 'port', 'username', 'terminalInitPath', 'fileManagerInitPath'];
        const fieldLabels = {
          name: t('服务器别名（选填）'),
          host: t('主机地址 *'),
          port: t('端口'),
          username: t('用户名'),
          terminalInitPath: t('终端默认 cd 目录'),
          fileManagerInitPath: t('文件管理器初始目录'),
        };

        const items = fields.flatMap((field, index) => {
          const sourceRect = payload.sourceRects[field];
          const targetEl = document.querySelector(`[data-editor-field="${field}"]`);
          const targetRect = targetEl?.getBoundingClientRect?.();
          if (!sourceRect || !targetRect) {
            return [];
          }
          const from = rectToLayerPoint(sourceRect, viewport);
          const to = rectToLayerPoint(targetRect, viewport);
          return [{
            id: `${field}-${Date.now()}-${index}`,
            field,
            label: fieldLabels[field],
            value: payload.labels?.[field] || '',
            from,
            to,
            mid: buildFlightMidPoint(from, to, viewport, index),
            delay: index * 52,
          }];
        });

        if (items.length === 0) {
          return;
        }

        setEditFlyAnimation({ id: Date.now(), items });
        items.forEach((item) => {
          const timer = setTimeout(() => {
            setServerEditor((current) => {
              if (!current || current.id !== server.id) {
                return current;
              }
              const nextValue = item.field === 'port'
                ? (server.port || 22)
                : (server[item.field] || '');
              return { ...current, [item.field]: nextValue };
            });
            setEditFlyShiningFields((prev) => ({ ...prev, [item.field]: true }));
            const shineTimer = setTimeout(() => {
              setEditFlyShiningFields((prev) => {
                const next = { ...prev };
                delete next[item.field];
                return next;
              });
            }, 1150);
            editFlyShineTimerRefs.current.push(shineTimer);
          }, item.delay + 560);
          editFlyFieldTimerRefs.current.push(timer);
        });
        editFlyTimerRef.current = setTimeout(() => {
          setEditFlyAnimation(null);
          editFlyTimerRef.current = null;
        }, 980);
      });
    });
  }, [buildFlightMidPoint, getAnimationViewport, rectToLayerPoint, t]);

  const startAddGuideAnimation = useCallback((sourceButton) => {
    if (!sourceButton?.getBoundingClientRect) {
      setServerEditor(null);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});
    setServerEditor(null);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const sourceRect = sourceButton.getBoundingClientRect();
        const titleTargetEl = document.querySelector('[data-editor-add-target="true"]');
        const titleTargetRect = titleTargetEl?.getBoundingClientRect?.();
        const fields = ['host', 'port', 'username'];

        if (!titleTargetRect) {
          return;
        }

        const titleCenter = rectToLayerPoint(titleTargetRect, viewport);
        const addSource = rectToLayerPoint(sourceRect, viewport);
        const now = Date.now();
        const randomBetween = (min, max) => min + Math.random() * (max - min);
        const makeControlPoint = (from, to, index, padding = 28) => {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const normalX = -dy / distance;
          const normalY = dx / distance;
          const preferDown = normalY >= 0 ? 1 : -1;
          const bow = Math.min(120, Math.max(34, distance * randomBetween(0.08, 0.18))) * preferDown;
          const progress = randomBetween(0.36, 0.68);
          return clampLayerPoint({
            x: from.x + dx * progress + normalX * bow + randomBetween(-14, 14),
            y: from.y + dy * progress + normalY * bow + randomBetween(8, 34),
          }, viewport, padding);
        };
        const makePath = (from, control, to) =>
          `path("M ${from.x.toFixed(1)},${from.y.toFixed(1)} Q ${control.x.toFixed(1)},${control.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}")`;

        const coreMid = makeControlPoint(addSource, titleCenter, 0, 56);
        const particles = Array.from({ length: 14 }, (_, index) => {
          const angle = Math.random() * Math.PI * 2;
          const startRadius = randomBetween(7, 22);
          const endRadius = randomBetween(16, 42);
          const from = clampLayerPoint({
            x: addSource.x + Math.cos(angle) * startRadius,
            y: addSource.y + Math.sin(angle) * startRadius,
          }, viewport, 12);
          const to = clampLayerPoint({
            x: titleCenter.x + Math.cos(angle + randomBetween(0.45, 1.45)) * endRadius,
            y: titleCenter.y + Math.sin(angle + randomBetween(0.45, 1.45)) * endRadius,
          }, viewport, 12);
          const mid = makeControlPoint(from, to, index, 38);
          return {
            id: `add-particle-${now}-${index}`,
            type: 'add-particle',
            from,
            to,
            mid,
            path: makePath(from, mid, to),
            size: randomBetween(2.5, 5.5),
            delay: randomBetween(0, 150),
          };
        });

        setEditFlyAnimation({
          id: now,
          items: [
            {
              id: `add-core-${now}`,
              type: 'add-core',
              from: addSource,
              to: titleCenter,
              mid: coreMid,
              path: makePath(addSource, coreMid, titleCenter),
              delay: 0,
            },
            ...particles,
            {
              id: `add-ring-${now}`,
              type: 'add-ring',
              at: titleCenter,
              delay: 820,
            },
          ],
        });

        fields.forEach((field, index) => {
          const timer = setTimeout(() => {
            setEditFlyShiningFields((prev) => ({ ...prev, [field]: true }));
            const shineTimer = setTimeout(() => {
              setEditFlyShiningFields((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
              });
            }, 980);
            editFlyShineTimerRefs.current.push(shineTimer);
          }, 1040 + index * 105);
          editFlyFieldTimerRefs.current.push(timer);
        });

        editFlyTimerRef.current = setTimeout(() => {
          setEditFlyAnimation(null);
          editFlyTimerRef.current = null;
        }, 2050);
      });
    });
  }, [buildFlightMidPoint, getAnimationViewport, rectToLayerPoint, t]);

  function startSaveFlowAnimation(server, data) {
    const serverId = server?.id || data?.id;
    if (!serverId) {
      setServerEditor(null);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});
    setSaveFlowHighlights({ serverId: null, rowPulse: null, fields: {} });

    const getServerTarget = (field) => {
      const nodes = Array.from(document.querySelectorAll(`[data-server-update-id="${serverId}"]`));
      const row = nodes.find((node) => node.offsetParent !== null) || nodes[0];
      if (!row) {
        return null;
      }
      const targetField = field === 'host' || field === 'port' || field === 'username' ? 'hostPort' : field;
      const targetEl = row.querySelector(`[data-edit-source-field="${targetField}"]`) || row;
      return targetEl.getBoundingClientRect?.() || null;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const fields = ['name', 'host', 'port', 'username', 'terminalInitPath', 'fileManagerInitPath'];
        const fieldLabels = {
          name: t('服务器别名（选填）'),
          host: t('主机地址 *'),
          port: t('端口'),
          username: t('用户名'),
          terminalInitPath: t('终端默认 cd 目录'),
          fileManagerInitPath: t('文件管理器初始目录'),
        };

        const items = fields.flatMap((field, index) => {
          const sourceEl = document.querySelector(`[data-editor-field="${field}"]`);
          const sourceRect = sourceEl?.getBoundingClientRect?.();
          const targetRect = getServerTarget(field);
          if (!sourceRect || !targetRect) {
            return [];
          }
          const from = rectToLayerPoint(sourceRect, viewport);
          const to = rectToLayerPoint(targetRect, viewport);
          return [{
            id: `save-flow-${field}-${Date.now()}-${index}`,
            type: 'save-flow-capsule',
            field,
            label: fieldLabels[field],
            value: field === 'port' ? String(data.port || server.port || 22) : String(data[field] || server[field] || ''),
            from,
            to,
            mid: buildFlightMidPoint(from, to, viewport, index + 1),
            delay: index * 90,
          }];
        });

        if (items.length === 0) {
          setServerEditor(null);
          return;
        }

        setEditFlyAnimation({ id: Date.now(), items });
        setEditFlyShiningFields(Object.fromEntries(items.map((item) => [item.field, true])));

        items.forEach((item) => {
          const highlightTimer = setTimeout(() => {
            setSaveFlowHighlights((current) => ({
              serverId,
              rowPulse: item.id,
              fields: { ...current.fields, [item.field]: item.id },
            }));
          }, item.delay + 660);
          const shineTimer = setTimeout(() => {
            setSaveFlowHighlights((current) => {
              if (current.serverId !== serverId) return current;
              const nextFields = { ...current.fields };
              delete nextFields[item.field];
              return {
                serverId,
                rowPulse: current.rowPulse === item.id ? null : current.rowPulse,
                fields: nextFields,
              };
            });
            setEditFlyShiningFields((current) => {
              const next = { ...current };
              delete next[item.field];
              return next;
            });
          }, item.delay + 1420);
          editFlyFieldTimerRefs.current.push(highlightTimer);
          editFlyShineTimerRefs.current.push(shineTimer);
        });

        const closeTimer = setTimeout(() => {
          setServerEditor(null);
        }, Math.max(...items.map((item) => item.delay)) + 980);
        const cleanupTimer = setTimeout(() => {
          setEditFlyAnimation(null);
          setSaveFlowHighlights({ serverId: null, rowPulse: null, fields: {} });
          setEditFlyShiningFields({});
          editFlyTimerRef.current = null;
        }, Math.max(...items.map((item) => item.delay)) + 1660);
        editFlyFieldTimerRefs.current.push(closeTimer);
        editFlyTimerRef.current = cleanupTimer;
      });
    });
  }

  // ── 清理旧 localStorage 残留数据 ──────────────────────
  useEffect(() => {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cmd_history_') || key === 'command_history')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }, []);

  useEffect(() => () => {
    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    if (editorModeBannerTimerRef.current) {
      clearTimeout(editorModeBannerTimerRef.current);
      editorModeBannerTimerRef.current = null;
    }
  }, []);


  return (
    <div className="app-layout">
      <AppTopbar
        t={t}
        handleTopbarDoubleClick={handleTopbarDoubleClick}
        markWorkspaceRestoreNavigationOverride={markWorkspaceRestoreNavigationOverride}
        setActiveSessionId={setActiveSessionId}
        setActiveTerminalId={setActiveTerminalId}
        setShowSettings={setShowSettings}
        logoImg={logoImg}
        showTopbarRefreshedLogo={showTopbarRefreshedLogo}
        topbarLogoTransitionImg={topbarLogoTransitionImg}
        sessions={sessions}
        tabScrollRef={tabScrollRef}
        tabListRef={tabListRef}
        activeSessionId={activeSessionId}
        handleTabClick={handleTabClick}
        closeSession={closeSession}
        setTabContextMenu={setTabContextMenu}
        sessionAuthPrompts={sessionAuthPrompts}
        sshChannelUsage={sshChannelUsage}
        tabsOverflow={tabsOverflow}
        tabActionsRef={tabActionsRef}
        sessionListBtnRef={sessionListBtnRef}
        toggleSessionList={toggleSessionList}
        closeAllSessions={closeAllSessions}
        showThemeQuickEntry={showThemeQuickEntry}
        activeAIDevilMode={activeAIDevilMode}
        resolvedQuickThemeMode={resolvedQuickThemeMode}
        handleQuickThemeToggle={handleQuickThemeToggle}
        isActiveSessionConnected={isActiveSessionConnected}
        showAIPanel={showAIPanel}
        setAIPanelVisibility={setAIPanelVisibility}
        startupUpdateInfo={startupUpdateInfo}
        showUpdateBubble={showUpdateBubble}
        isUpdateModalVisible={isUpdateModalVisible}
        setShowUpdateBubble={setShowUpdateBubble}
        setIsUpdateModalVisible={setIsUpdateModalVisible}
        setSettingsInitialTab={setSettingsInitialTab}
        handleToggleMaximise={handleToggleMaximise}
        handleCloseWindow={handleCloseWindow}
        reconnectSession={reconnectSession}
      />

      {/* ── Main Area ─────────────────────────────────────── */}
      <SessionWorkspace
        dashboard={{ allGroups, batchSelectionMode, clearRecentConnections, connectLocal, connectSerial, connectServer, connectedSessions, credentials, dashboardHostPageMode, editFlyAnimation, editFlyShiningFields, filteredServers, handleBatchConnect, handleBatchDelete, handleBatchExport, handleBatchMoveGroup, handleDeleteServer, handleGroupDelete, handleMoveGroup, handleOpenImportExport, handleRefreshPing, handleRenameGroup, handleSaveAndConnectServer, handleSaveServer, hideSensitive, isRefreshingPing, pingCounts, pingEnabled, pings, recentConnectionIds, removeRecentConnection, saveFlowHighlights, searchQuery, selectedServerIds, serverEditor, serverListViewMode, servers, setBatchSelectionMode, setDashboardHostPageMode, setHideSensitive, setSearchQuery, setServerEditor, setServerListViewMode, setShowCredentials, setShowSerialModal, startAddGuideAnimation, startEditFlyAnimation, toggleBatchSelection }}
        session={{ activeSession, activeSessionId, activeSessionRootTerminals, activeTerminalId, connectingServers, contentTab, getEffectiveTerminals, getSessionPanes, getSessionRootPaneCells, getSessionWorkspaceTabs, handleCancelConnection, isActiveSessionConnected, isCreatingTerminal, isSessionWorkspaceVisible, markWorkspaceRestoreNavigationOverride, mountedSessions, openNewTerminal, persistWorkspaceSnapshotRef, rememberSessionActiveTerminal, resolveHostKeyChoice, resolvePasswordPrompt, restoringWorkspaceSessionIds, sessionAuthPrompts, sessions, setActiveTerminalId, setContentTab, setTabContextMenu, setTerminalTabContextMenu, terminalPaneLayouts }}
        fileManager={{ bottomSplitHeight, collapseDragIntent, fileManagerCollapsed, fileManagerDockConfirmTarget, fileManagerDockDropzones, fileManagerDockPreview, fileManagerDockTabAnchorRef, fileManagerPosition, handleDetectedRemotePort, leftSplitWidth, portListeningEnabled, probePanelCollapsed, probePanelNode, probePanelPosition, probePanelWidth, renderSessionFileManagers, setFileManagerCollapsedPersistent, setProbePanelCollapsedPersistent, shouldIgnoreResizerClick, startDrag }}
        terminalTabs={{ closeTerminal, closeTerminalGroup, closeTerminalPane, handleTerminalSubTabClickCapture, handleTerminalSubTabDockMouseDown, handleTerminalSubTabMouseDown, handleTerminalSubTabScroll, handleTerminalSubTabWheel, scrollTerminalSubTabs, shouldIgnoreTerminalDockClick, terminalDockDragPreview, terminalSubTabActionsRef, terminalSubTabCanScrollLeft, terminalSubTabCanScrollRight, terminalSubTabOverflow, terminalSubTabScrollRef, terminalSubTabScrollStyle, terminalToolbarIconOnly }}
        ai={{ activeChangeReview, activeChangeReviewQueue, activeConversationDiffPanel, activeRestorePreviewReview, activeWorkspaceTerminalKey, aiPanelNode, handleApplyConversationDiffRestore, handleReapplyConversationDiffItem, handleSelectConversationDiffItem, setAIPanelVisibility, setConversationDiffPanels, setRestorePreviewReviews, showAIPanel }}
        quickCommands={{ handleQuickCommandsOpenChange, quickCmdsRef, setShowQuickCommands, showQuickCommands }}
        shared={{ addToast, t }}
      />

      {/* ── Modals ────────────────────────────────────────── */}
      <AppOverlays
        dialogs={{ activeAIDevilMode, closePortForwardDialog, connectSerial, loadServers, portForwardDialogSessionId, portForwardInitialMapping, portForwardInitialTab, portListeningEnabled, probePanelPosition, setProbePanelPosition, setSettingsInitialTab, setShowCredentials, setShowSerialModal, setShowSettings, settingsInitialTab, showCredentials, showPortForwardDialog, showSerialModal, showSettings, handlePortListeningEnabledChange }}
        importExport={{ exportSelectedIds, handleDownloadTemplate, handleExport, handleExportSelected, handleImport, hasRecoveryPassword, ieBusy, setExportSelectedIds, setShowExportSelectedDialog, setShowImportExportDialog, showExportSelectedDialog, showImportExportDialog }}
        notifications={{ downloadProgress, handleApplyStartupUpdate, handleToastAction, isUpdateModalVisible, removeToast, setIsUpdateModalVisible, setSyncFailed, startupUpdateInfo, syncFailed, toasts }}
        menus={{ activeSessionId, canCopySessionPassword, canMoveTerminalToDockTarget, closeAllSessions, closeSession, closeTerminal, closeTerminalGroup, forceCloseSession, handleCopySessionPassword, handleRenameTerminalTab, handleTabClick, isTerminalDockTargetOccupied, moveTerminalToDockTarget, sessionAuthPrompts, sessionListPos, sessionListQuery, sessionListRef, sessions, setSessionListQuery, setShowSessionList, setTabContextMenu, setTerminalTabContextMenu, showSessionList, tabContextMenu, terminalTabContextMenu }}
        animation={{ editFlyAnimation, editorModeBanner }}
        shared={{ addToast, t }}
      />
    </div>
  );
}
