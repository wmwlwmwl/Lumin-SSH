import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cpu, Folder, Globe, Monitor, Plus, RefreshCw, ScrollText, Search, X } from 'lucide-react';
import { useCallback, useEffect, lazy, Suspense, useMemo, useRef, useState } from 'react';
import * as AppGo from '../../wailsjs/go/wailsapp/App.js';
import AIConversationDiffOverlay from './ai/AIConversationDiffOverlay.tsx';
import CommandHistory from './CommandHistory.tsx';
import ConnectingCard from './ConnectingCard.tsx';
import Dashboard from './Dashboard.tsx';
import ErrorBoundary from './ErrorBoundary.tsx';
import NetworkPage from './NetworkPage.tsx';
import ProcessPage from './ProcessPage.tsx';
import QuickCommands, { type QuickCommandsHandle } from './QuickCommands.tsx';
import SessionAuthCard from './SessionAuthCard.tsx';
import Terminal from './Terminal.tsx';
import Tiptop from './Tiptop.tsx';
import { TERMINAL_PANE_CELL_IDS, getTerminalPaneAbsolutePlacement, type TerminalPaneLayout, type TerminalPaneCellId } from '../utils/terminalPaneLayout.ts';
import { getTerminalTabDoubleClickAction, isUnsupportedMonitorSession, type SessionLike } from '../utils/sessionWorkspace.ts';
import { Z } from '../constants/zIndex.ts';
import { clampMenuPosition } from '../utils/menuPosition.ts';
import type { config } from '../../wailsjs/go/models.ts';
import type { ConnectingServer, SessionAuthPrompt } from '../hooks/useSessionConnections.ts';
import type { TerminalDockDragPreview, SubTabSessionLike, SubTabTerminalLike } from '../hooks/useTerminalSubTabs.ts';
import type { ServerListViewMode, DashboardHostPageMode } from '../hooks/useDashboardPreferences.ts';
import type { TerminalTabContextMenuState } from './AppOverlays.tsx';
import type { ServerFormData } from '../hooks/useServerCatalog.ts';
import type { PanelResizeDirection } from '../hooks/useWorkspacePanelDocking.ts';
import type { ConversationDiffItem } from '../hooks/useAIReview.ts';

// 懒加载：AIChangeReviewWorkbench 依赖 Monaco（瘦身后核心仍在 ~2MB），
// 只在打开变更审阅/恢复预览时按需加载，避免进入应用启动路径
const AIChangeReviewWorkbench = lazy(() => import('./ai/AIChangeReviewWorkbench.tsx'));

const FILE_MANAGER_LEFT_MIN = 180;
const FILE_MANAGER_BOTTOM_MIN = 100;

/** 工作区终端标签（getSessionWorkspaceTabs 返回） */
interface WorkspaceTerminalTab {
  id: string;
  type: 'terminal' | 'group';
  label?: string;
  terminalIds?: string[];
}

// ── 分组 props（与 App.tsx 传入形状对齐；内部向已转子组件传递时按需收窄） ──
interface SessionWorkspaceDashboardProps {
  allGroups: string[];
  batchSelectionMode: boolean;
  clearRecentConnections: () => void;
  connectLocal: (name: string, shellPath: string) => void;
  connectSerial: (config: { port: string; baudRate: number; dataBits: number; stopBits: number; parity: string }) => void;
  connectServer: (server: config.Connection) => Promise<void>;
  connectedSessions: SessionLike[];
  credentials: config.Credential[];
  dashboardHostPageMode: DashboardHostPageMode;
  editFlyAnimation: unknown;
  editFlyShiningFields: Record<string, boolean>;
  filteredServers: config.Connection[];
  handleBatchConnect: (ids: string[]) => Promise<void>;
  handleBatchDelete: (ids: string[]) => Promise<void>;
  handleBatchExport: (ids: string[]) => Promise<void>;
  handleBatchMoveGroup: (ids: string[], group: string) => Promise<void>;
  handleDeleteServer: (id: string) => Promise<void>;
  handleGroupDelete: (groupName: string, ids: string[]) => Promise<void>;
  handleMoveGroup: (serverId: string, group: string) => Promise<void>;
  handleOpenImportExport: () => void;
  handleRefreshPing: () => void;
  handleRenameGroup: (groupName: string) => Promise<string | boolean>;
  handleSaveAndConnectServer: (data: ServerFormData, shouldClearAfterAdd?: boolean) => Promise<config.Connection | null>;
  handleSaveServer: (data: ServerFormData, shouldClearAfterAdd?: boolean) => Promise<config.Connection | null>;
  hideSensitive: boolean;
  isRefreshingPing: boolean;
  pingCounts: unknown;
  pingEnabled: boolean;
  pings: Record<string, unknown>;
  recentConnectionIds: string[];
  removeRecentConnection: (serverId: string) => void;
  saveFlowHighlights: { serverId: string | null; rowPulse: unknown; fields: Record<string, unknown> };
  searchQuery: string;
  selectedServerIds: string[];
  serverEditor: unknown;
  serverListViewMode: ServerListViewMode;
  servers: config.Connection[];
  setBatchSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  setDashboardHostPageMode: (mode: unknown) => void;
  setHideSensitive: (value: boolean) => void;
  setSearchQuery: (q: string) => void;
  setServerEditor: unknown;
  setServerListViewMode: (mode: unknown) => void;
  setShowCredentials: (v: boolean) => void;
  setShowSerialModal: (v: boolean) => void;
  startAddGuideAnimation: (button: HTMLElement | null) => void;
  startEditFlyAnimation: (server: config.Connection | null, payload?: { sourceRects?: Record<string, DOMRect>; labels?: Record<string, string> }) => void;
  toggleBatchSelection: (idOrArray: string | Array<string | { id: string; selected: boolean }>) => void;
}

interface SessionWorkspaceSessionProps {
  activeSession: SessionLike | undefined;
  activeSessionId: string | null;
  activeSessionRootTerminals: unknown[];
  activeTerminalId: string | null;
  connectingServers: ConnectingServer[];
  contentTab: string;
  getEffectiveTerminals: (session: SessionLike) => Array<{ id: string; label?: string }>;
  getSessionPanes: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneLayout['panes'];
  getSessionRootPaneCells: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneCellId[];
  getSessionWorkspaceTabs: (session: SessionLike, layouts?: Record<string, TerminalPaneLayout>) => Array<{ id: string; type?: string; label?: string; terminalIds?: string[] }>;
  handleCancelConnection: (sessionId: string) => void;
  isActiveSessionConnected: boolean;
  isCreatingTerminal: boolean;
  isSessionWorkspaceVisible: (session: SessionLike | null | undefined) => boolean;
  markWorkspaceRestoreNavigationOverride: () => void;
  mountedSessions: Set<string>;
  openNewTerminal: (sessionId: string, options?: {
    sourceTerminalId?: string;
    cloneFileManagerWorkspace?: boolean;
    cloneCwd?: boolean;
  }) => Promise<void>;
  persistWorkspaceSnapshotRef: React.MutableRefObject<((overrides?: Record<string, unknown>) => void) | null>;
  rememberSessionActiveTerminal: (sessionId: string, terminalId: string, label: string) => void;
  resolveHostKeyChoice: (sessionId: string, chosen: number) => Promise<void>;
  resolvePasswordPrompt: (sessionId: string, connId: string, result: { value: string; persist: boolean } | null) => Promise<void>;
  restoringWorkspaceSessionIds: Set<string>;
  sessionAuthPrompts: Record<string, SessionAuthPrompt>;
  sessions: SessionLike[];
  setActiveTerminalId: (id: string | null) => void;
  setContentTab: (tab: string) => void;
  setTabContextMenu: (menu: TerminalTabContextMenuState | null) => void;
  setTerminalTabContextMenu: (menu: TerminalTabContextMenuState | null) => void;
  terminalPaneLayouts: Record<string, TerminalPaneLayout>;
}

interface SessionWorkspaceFileManagerProps {
  bottomSplitHeight: number;
  collapseDragIntent: unknown;
  fileManagerCollapsed: boolean;
  fileManagerDockConfirmTarget: unknown;
  fileManagerDockDropzones: Array<{ target: string; style: { left: string; top: string; width: string; height: string } }>;
  fileManagerDockPreview: unknown;
  fileManagerDockTabAnchorRef: React.MutableRefObject<HTMLElement | null>;
  fileManagerPosition: string;
  leftSplitWidth: number;
  probePanelCollapsed: boolean;
  probePanelNode: React.ReactNode;
  probePanelPosition: 'left' | 'right';
  probePanelWidth: number;
  renderSessionFileManagers: (session: SessionLike) => React.ReactNode;
  setFileManagerCollapsedPersistent: (next: boolean) => void;
  setProbePanelCollapsedPersistent: (next: boolean) => void;
  shouldIgnoreResizerClick: () => boolean;
  startDrag: (event: React.MouseEvent<HTMLElement> | MouseEvent, direction: PanelResizeDirection) => void;
}

interface SessionWorkspaceTerminalTabsProps {
  closeTerminal: (sessionId: string, terminalId: string, e?: React.MouseEvent) => void;
  closeTerminalGroup: (sessionId: string, layoutId: string, terminalIds: string[], e?: React.MouseEvent) => void;
  closeTerminalPane: (layoutId: string, paneId: string, e?: React.MouseEvent) => void;
  handleTerminalSubTabClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
  handleTerminalSubTabDockMouseDown: (e: React.MouseEvent<HTMLElement>, session: SubTabSessionLike, term: SubTabTerminalLike) => void;
  handleTerminalSubTabMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  handleTerminalSubTabScroll: (e: React.UIEvent<HTMLElement>) => void;
  handleTerminalSubTabWheel: (e: React.WheelEvent<HTMLElement>) => void;
  shouldIgnoreTerminalDockClick: () => boolean;
  terminalDockDragPreview: TerminalDockDragPreview | null;
  terminalSubTabActionsRef: React.RefObject<HTMLDivElement | null>;
  terminalSubTabOverflow: boolean;
  terminalSubTabScrollRef: React.RefObject<HTMLDivElement | null>;
  terminalSubTabScrollStyle: React.CSSProperties;
  terminalToolbarIconOnly: boolean;
}

interface SessionWorkspaceAIProps {
  activeChangeReview: unknown;
  activeChangeReviewQueue: unknown[];
  activeConversationDiffPanel: unknown;
  activeRestorePreviewReview: unknown;
  activeWorkspaceTerminalKey: string;
  activeAIWorkspaceTabId: string;
  aiPanelNode: React.ReactNode;
  handleApplyConversationDiffRestore: (artifactPath: string, targetSessionId: string, targetTerminalId: string, tabId?: string) => Promise<boolean>;
  handleReapplyConversationDiffItem: (artifactPath: string, targetSessionId: string, targetTerminalId: string, tabId?: string) => Promise<boolean>;
  handleSelectConversationDiffItem: (item: ConversationDiffItem, options?: {
    sessionId?: string;
    terminalId?: string;
    tabId?: string;
    items?: ConversationDiffItem[];
    locate?: boolean;
    setActive?: boolean;
  }) => Promise<void>;
  setAIPanelVisibility: (v: boolean) => void;
  setConversationDiffPanels: unknown;
  setRestorePreviewReviews: unknown;
  showAIPanel: boolean;
}

interface SessionWorkspaceQuickCommandsProps {
  handleQuickCommandsOpenChange: (open: boolean) => void;
  quickCmdsRef: React.RefObject<QuickCommandsHandle | null>;
  setShowQuickCommands: (v: boolean) => void;
  showQuickCommands: boolean;
}

interface SessionWorkspaceSharedProps {
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export interface SessionWorkspaceProps {
  dashboard?: Partial<SessionWorkspaceDashboardProps>;
  session?: Partial<SessionWorkspaceSessionProps>;
  fileManager?: Partial<SessionWorkspaceFileManagerProps>;
  terminalTabs?: Partial<SessionWorkspaceTerminalTabsProps>;
  ai?: Partial<SessionWorkspaceAIProps>;
  quickCommands?: Partial<SessionWorkspaceQuickCommandsProps>;
  shared?: Partial<SessionWorkspaceSharedProps>;
}

export default function SessionWorkspace({ dashboard = {}, session = {}, fileManager = {}, terminalTabs = {}, ai = {}, quickCommands = {}, shared = {} }: SessionWorkspaceProps) {
  const props = { ...dashboard, ...session, ...fileManager, ...terminalTabs, ...ai, ...quickCommands, ...shared } as SessionWorkspaceDashboardProps & SessionWorkspaceSessionProps & SessionWorkspaceFileManagerProps & SessionWorkspaceTerminalTabsProps & SessionWorkspaceAIProps & SessionWorkspaceQuickCommandsProps & SessionWorkspaceSharedProps;
  const {
    activeChangeReview,
    activeChangeReviewQueue,
    activeConversationDiffPanel,
    activeRestorePreviewReview,
    activeSession,
    activeSessionId,
    activeSessionRootTerminals,
    activeTerminalId,
    activeWorkspaceTerminalKey,
    activeAIWorkspaceTabId,
    addToast,
    aiPanelNode,
    allGroups,
    batchSelectionMode,
    bottomSplitHeight,
    clearRecentConnections,
    closeTerminal,
    closeTerminalGroup,
    closeTerminalPane,
    collapseDragIntent,
    connectLocal,
    connectSerial,
    connectServer,
    connectedSessions,
    connectingServers,
    contentTab,
    credentials,
    dashboardHostPageMode,
    editFlyAnimation,
    editFlyShiningFields,
    fileManagerCollapsed,
    fileManagerDockConfirmTarget,
    fileManagerDockDropzones,
    fileManagerDockPreview,
    fileManagerDockTabAnchorRef,
    fileManagerPosition,
    filteredServers,
    getEffectiveTerminals,
    getSessionPanes,
    getSessionRootPaneCells,
    getSessionWorkspaceTabs,
    handleApplyConversationDiffRestore,
    handleBatchConnect,
    handleBatchDelete,
    handleBatchExport,
    handleBatchMoveGroup,
    handleCancelConnection,
    handleDeleteServer,
    handleGroupDelete,
    handleMoveGroup,
    handleOpenImportExport,
    handleQuickCommandsOpenChange,
    handleReapplyConversationDiffItem,
    handleRefreshPing,
    handleRenameGroup,
    handleSaveAndConnectServer,
    handleSaveServer,
    handleSelectConversationDiffItem,
    handleTerminalSubTabClickCapture,
    handleTerminalSubTabDockMouseDown,
    handleTerminalSubTabMouseDown,
    handleTerminalSubTabScroll,
    handleTerminalSubTabWheel,
    hideSensitive,
    isActiveSessionConnected,
    isCreatingTerminal,
    isRefreshingPing,
    isSessionWorkspaceVisible,
    markWorkspaceRestoreNavigationOverride,
    leftSplitWidth,
    mountedSessions,
    openNewTerminal,
    persistWorkspaceSnapshotRef,
    pingCounts,
    pingEnabled,
    pings,
    probePanelCollapsed,
    probePanelNode,
    probePanelPosition,
    probePanelWidth,
    quickCmdsRef,
    recentConnectionIds,
    rememberSessionActiveTerminal,
    removeRecentConnection,
    renderSessionFileManagers,
    resolveHostKeyChoice,
    resolvePasswordPrompt,
    restoringWorkspaceSessionIds,
    saveFlowHighlights,
    searchQuery,
    selectedServerIds,
    serverEditor,
    serverListViewMode,
    servers,
    sessionAuthPrompts,
    sessions,
    setAIPanelVisibility,
    setActiveTerminalId,
    setBatchSelectionMode,
    setContentTab,
    setConversationDiffPanels,
    setDashboardHostPageMode,
    setFileManagerCollapsedPersistent,
    setHideSensitive,
    setProbePanelCollapsedPersistent,
    setRestorePreviewReviews,
    setSearchQuery,
    setServerEditor,
    setServerListViewMode,
    setShowCredentials,
    setShowQuickCommands,
    setShowSerialModal,
    setTabContextMenu,
    setTerminalTabContextMenu,
    shouldIgnoreResizerClick,
    shouldIgnoreTerminalDockClick,
    showAIPanel,
    showQuickCommands,
    startAddGuideAnimation,
    startDrag,
    startEditFlyAnimation,
    t,
    terminalDockDragPreview,
    terminalPaneLayouts,
    terminalSubTabActionsRef,
    terminalSubTabOverflow,
    terminalSubTabScrollRef,
    terminalSubTabScrollStyle,
    terminalToolbarIconOnly,
    toggleBatchSelection
  } = props;
  const [showTerminalList, setShowTerminalList] = useState(false);
  const [terminalListQuery, setTerminalListQuery] = useState('');
  const [terminalListPosition, setTerminalListPosition] = useState({ x: 0, y: 0, width: 240, maxHeight: 400 });
  const terminalListButtonRef = useRef<HTMLButtonElement>(null);
  const terminalListMenuRef = useRef<HTMLDivElement>(null);
  const terminalListSearchRef = useRef<HTMLInputElement>(null);
  const filteredTerminalTabs = useMemo(() => {
    const query = terminalListQuery.trim().toLowerCase();
    if (!query) return activeSessionRootTerminals;
    return activeSessionRootTerminals.filter((term) => String((term as { label?: unknown })?.label || '').toLowerCase().includes(query));
  }, [activeSessionRootTerminals, terminalListQuery]);
  const closeTerminalList = useCallback((restoreFocus = false) => {
    setShowTerminalList(false);
    setTerminalListQuery('');
    if (restoreFocus) {
      requestAnimationFrame(() => terminalListButtonRef.current?.focus());
    }
  }, []);
  const toggleTerminalList = useCallback(() => {
    if (showTerminalList) {
      closeTerminalList(true);
      return;
    }
    const rect = terminalListButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(1, Math.min(240, window.innerWidth - 16));
    const maxHeight = Math.max(1, Math.min(400, window.innerHeight - 16));
    const position = clampMenuPosition(rect.right - width, rect.bottom + 4, width, maxHeight);
    setTerminalListPosition({ ...position, width, maxHeight });
    setTerminalListQuery('');
    setShowTerminalList(true);
  }, [closeTerminalList, showTerminalList]);
  const selectTerminalTab = useCallback((term: WorkspaceTerminalTab, fromList = false) => {
    if (!activeSession) return;
    markWorkspaceRestoreNavigationOverride();
    setTerminalTabContextMenu(null);
    setActiveTerminalId(term.id);
    setContentTab('terminal');
    rememberSessionActiveTerminal(activeSession.id || '', term.id, term.label || '');
    persistWorkspaceSnapshotRef.current?.({
      activeSessionId: activeSession.id,
      activeTerminalId: term.id,
    });
    if (fromList) {
      closeTerminalList(true);
    }
  }, [activeSession, closeTerminalList, markWorkspaceRestoreNavigationOverride, persistWorkspaceSnapshotRef, rememberSessionActiveTerminal, setActiveTerminalId, setContentTab, setTerminalTabContextMenu]);
  useEffect(() => {
    if (!showTerminalList) return undefined;
    const frame = requestAnimationFrame(() => terminalListSearchRef.current?.focus());
    const handlePointerDown = (event: MouseEvent) => {
      if (!terminalListMenuRef.current?.contains(event.target as Node) && !terminalListButtonRef.current?.contains(event.target as Node)) {
        closeTerminalList();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeTerminalList(true);
    };
    const handleResize = () => closeTerminalList();
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [closeTerminalList, showTerminalList]);
  useEffect(() => {
    closeTerminalList();
  }, [activeSessionId, closeTerminalList]);
  useEffect(() => {
    if (!terminalSubTabOverflow) {
      closeTerminalList();
    }
  }, [closeTerminalList, terminalSubTabOverflow]);
  return (
      <main className="main-area">
        <div style={{ display: activeSessionId === null ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%' }}>
          <Dashboard
            editorServer={serverEditor as (config.Connection & { authType?: string }) | null}
            editorShiningFields={editFlyShiningFields}
            saveFlowHighlights={saveFlowHighlights}
            isEditFlying={!!editFlyAnimation}
            onSaveServer={handleSaveServer as (data: unknown, shouldClearAfterAdd?: boolean) => Promise<config.Connection | null>}
            onSaveAndConnectServer={handleSaveAndConnectServer as (data: unknown, shouldClearAfterAdd?: boolean) => Promise<config.Connection | null>}
            onCancelEditor={() => (setServerEditor as (value: unknown) => void)(null)}
            allGroups={allGroups}
            credentials={credentials}
            searchQuery={searchQuery}
            onSearchChange={e => setSearchQuery(e.target.value)}
            hideSensitive={hideSensitive}
            onHideSensitiveToggle={() => setHideSensitive(!hideSensitive)}
            serverListViewMode={serverListViewMode}
            onViewModeChange={setServerListViewMode as (mode: ServerListViewMode) => void}
            servers={servers}
            pingEnabled={pingEnabled}
            pingCounts={pingCounts as Parameters<typeof Dashboard>[0]['pingCounts']}
            isRefreshingPing={isRefreshingPing}
            onRefreshPing={handleRefreshPing}
            filteredServers={filteredServers}
            pings={pings as Parameters<typeof Dashboard>[0]['pings']}
            sessions={sessions as Parameters<typeof Dashboard>[0]['sessions']}
            activeSessionId={activeSessionId}
            recentConnectionIds={recentConnectionIds}
            hostPageMode={dashboardHostPageMode}
            onHostPageModeChange={setDashboardHostPageMode as (mode: DashboardHostPageMode) => void}
            onClearRecentConnections={clearRecentConnections}
            onRemoveRecentConnection={removeRecentConnection}
            onConnect={connectServer}
            onStartAdd={startAddGuideAnimation as () => void}
            onEdit={startEditFlyAnimation as (server: config.Connection, payload: unknown) => void}
            onClone={async (s, payload) => {
              try {
                const real = await AppGo.GetConnectionByID(s.id);
                startEditFlyAnimation({ ...real, id: null } as unknown as config.Connection, payload as { sourceRects?: Record<string, DOMRect>; labels?: Record<string, string> } | undefined);
              } catch {
                startEditFlyAnimation({ ...s, id: null, name: s.name || s.host } as unknown as config.Connection, payload as { sourceRects?: Record<string, DOMRect>; labels?: Record<string, string> } | undefined);
              }
            }}
            onDelete={handleDeleteServer as (id: string) => void}
            onMoveGroup={handleMoveGroup as (id: string, group: string) => void}
            addToast={addToast}
            onOpenCredentials={() => setShowCredentials(true)}
            onOpenImportExport={handleOpenImportExport}
            selectionMode={batchSelectionMode}
            selectedIds={selectedServerIds}
            onSelectChange={toggleBatchSelection as (payload: string | string[] | Array<{ id: string; selected: boolean }>) => void}
            onBatchDelete={handleBatchDelete as (ids: string[]) => void}
            onBatchConnect={handleBatchConnect as (ids: string[]) => void}
            onBatchMoveGroup={handleBatchMoveGroup as (ids: string[], group: string) => void}
            onGroupDelete={handleGroupDelete as (groupName: string, ids: string[]) => void}
            onRenameGroup={handleRenameGroup as (oldName: string) => string | null | Promise<string | null>}
            onBatchExport={handleBatchExport as (ids: string[]) => void}
            onExitSelectionMode={() => setBatchSelectionMode(false)}
            onSelectionModeToggle={() => setBatchSelectionMode(prev => {
              if (!prev) return true;
              return false;
            })}
            onConnectLocal={connectLocal}
            onConnectSerial={connectSerial}
            setShowSerialModal={setShowSerialModal}
          />
        </div>

        <div data-ai-workspace-root="true" style={{ display: activeSessionId !== null ? 'flex' : 'none', flexDirection: 'row', height: '100%', flex: 1, overflow: 'hidden', position: 'relative' }}>
          {aiPanelNode && probePanelPosition === 'right' && (
            <>
              {aiPanelNode}
              {isActiveSessionConnected && (showAIPanel ? (
                <Tiptop text={t('收起 AI 助手面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v hotzone-left${collapseDragIntent === 'ai' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'ai')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setAIPanelVisibility(false);
                    }}
                    aria-label={t('收起 AI 助手面板')}
                  />
                </Tiptop>
              ) : (
                <Tiptop text={t('打开 AI 助手面板')} placement="bottom">
                  <button
                    type="button"
                    className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                    onClick={() => setAIPanelVisibility(true)}
                    aria-label={t('打开 AI 助手面板')}
                  >
                    <ChevronRight size={14} />
                  </button>
                </Tiptop>
              ))}
            </>
          )}
          {/* 系统监控探针面板（独立分栏，左侧） */}
          {probePanelNode && probePanelPosition === 'left' && (
            probePanelCollapsed ? (
              <Tiptop text={t('展开监控面板')} placement="bottom">
                <button
                  type="button"
                  className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                  onClick={() => setProbePanelCollapsedPersistent(false)}
                  aria-label={t('展开监控面板')}
                >
                  <ChevronRight size={14} />
                </button>
              </Tiptop>
            ) : (
              <>
                <div
                  className="probe-panel-wrapper probe-panel-wrapper-left"
                  style={{
                    width: probePanelWidth,
                    minWidth: probePanelWidth,
                    height: '100%',
                    display: 'flex',
                    flexShrink: 0,
                    borderLeft: 'none',
                    borderRight: '1px solid var(--border)',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'var(--surface-base)',
                  }}
                >
                  {collapseDragIntent === 'probe' && (
                    <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-right">
                      <ChevronLeft size={14} />
                    </div>
                  )}
                  {probePanelNode}
                </div>
                <Tiptop text={t('收起监控面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v hotzone-left probe-resizer${collapseDragIntent === 'probe' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'probe')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setProbePanelCollapsedPersistent(true);
                    }}
                    aria-label={t('收起监控面板')}
                  />
                </Tiptop>
              </>
            )
          )}
          {/* 左侧主区域：标签、终端子标签、会话内容 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', overflow: 'hidden' }}>
            {/* ── 终端子标签栏（多终端支持） ──────────────────── */}
            {activeSession && isActiveSessionConnected && (contentTab === 'terminal' || contentTab === 'process' || contentTab === 'network' || contentTab === 'history' || (fileManagerPosition === 'tab' && contentTab === 'files')) && isSessionWorkspaceVisible(activeSession) && activeSession.terminals && activeSession.terminals.length >= 1 && (
              <div className="terminal-sub-tab-bar">
                <div
                  ref={terminalSubTabScrollRef}
                  className="terminal-sub-tab-scroll"
                  style={terminalSubTabScrollStyle}
                  onWheel={handleTerminalSubTabWheel}
                  onMouseDown={handleTerminalSubTabMouseDown}
                  onScroll={handleTerminalSubTabScroll}
                  onClickCapture={handleTerminalSubTabClickCapture}
                >
                  {activeSessionRootTerminals.map((rawTerm) => {
                    const term = rawTerm as WorkspaceTerminalTab;
                    const canPreviewDock = term.type === 'terminal' && activeSessionRootTerminals.length > 1;
                    return (
                      <Tiptop key={term.id} text={term.label || ''} placement="bottom">
                        <div
                          className={`terminal-sub-tab ${activeTerminalId === term.id ? 'active' : ''}`}
                          data-terminal-id={term.id}
                          onMouseDown={canPreviewDock ? (e) => handleTerminalSubTabDockMouseDown(e, activeSession as SubTabSessionLike, term as unknown as SubTabTerminalLike) : undefined}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setTabContextMenu(null);
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTerminalTabContextMenu({
                              sessionId: activeSession.id || '',
                              terminalId: term.id,
                              type: term.type,
                              terminalIds: term.terminalIds,
                              x: rect.left,
                              y: rect.bottom + 4,
                            });
                          }}
                          onClick={() => {
                            if (shouldIgnoreTerminalDockClick()) return;
                            selectTerminalTab(term);
                          }}
                          onDoubleClick={(e) => {
                            if (term.type !== 'terminal') return;
                            if (shouldIgnoreTerminalDockClick()) return;
                            const doubleClickAction = getTerminalTabDoubleClickAction();
                            if (!doubleClickAction) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (doubleClickAction === 'close') {
                              closeTerminal(activeSession.id || '', term.id, e);
                              return;
                            }
                            void openNewTerminal(activeSession.id || '', {
                              sourceTerminalId: term.id,
                              cloneFileManagerWorkspace: true,
                              cloneCwd: true,
                            });
                          }}
                        >
                          <Monitor size={11} />
                          <span>{term.label}</span>
                          {activeSessionRootTerminals.length > 1 && (
                            <span
                              className="terminal-sub-tab-close"
                              onClick={(e) => {
                                if (term.type === 'group') {
                                  closeTerminalGroup(activeSession.id || '', term.id, term.terminalIds || [], e);
                                  return;
                                }
                                closeTerminal(activeSession.id || '', term.id, e);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                              }}
                            ><X size={10} /></span>
                          )}
                        </div>
                      </Tiptop>
                    );
                  })}
                </div>
                <div className="terminal-sub-tab-actions" ref={terminalSubTabActionsRef}>
                  {terminalSubTabOverflow && (
                    <Tiptop className="terminal-tab-list-trigger" text={t('终端')} placement="bottom">
                      <button
                        ref={terminalListButtonRef}
                        type="button"
                        className={`terminal-tab-list-btn${showTerminalList ? ' active' : ''}`}
                        onClick={toggleTerminalList}
                        aria-label={t('终端')}
                        aria-haspopup="listbox"
                        aria-expanded={showTerminalList}
                        aria-controls="terminal-sub-tab-list"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </Tiptop>
                  )}
                  {fileManagerPosition !== 'tab' && (fileManagerDockPreview === 'left' || fileManagerDockPreview === 'right' || fileManagerDockPreview === 'bottom') && (
                    <div ref={fileManagerDockTabAnchorRef as React.RefObject<HTMLDivElement>} className="file-manager-tab-dock-placeholder" aria-hidden="true">
                      <div className={`file-manager-dock-preview-dropzone file-manager-dock-preview-dropzone-inline${fileManagerDockConfirmTarget === 'tab' ? ' active' : ''}`} />
                    </div>
                  )}
                  {fileManagerPosition === 'tab' && !activeSession?.isSerial && (
                    <Tiptop text={terminalToolbarIconOnly ? t('文件管理') : null} placement="bottom">
                      <button
                        className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'files' ? 'active' : ''}`}
                        onMouseDown={(e) => startDrag(e, 'tab')}
                        onClick={() => {
                          if (shouldIgnoreResizerClick()) return;
                          setContentTab(contentTab === 'files' ? 'terminal' : 'files');
                        }}
                      >
                        <Folder size={14} />
                        {!terminalToolbarIconOnly && t('文件管理')}
                      </button>
                    </Tiptop>
                  )}
                  {activeSession?.isSerial || isUnsupportedMonitorSession(activeSession) ? null : (
                    <Tiptop text={terminalToolbarIconOnly ? t('进程管理') : null} placement="bottom">
                      <button
                        className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'process' ? 'active' : ''}`}
                        onClick={() => setContentTab(contentTab === 'process' ? 'terminal' : 'process')}
                      >
                        <Cpu size={14} />
                        {!terminalToolbarIconOnly && t('进程管理')}
                      </button>
                    </Tiptop>
                  )}
                  {activeSession?.isSerial || isUnsupportedMonitorSession(activeSession) ? null : (
                    <Tiptop text={terminalToolbarIconOnly ? t('网络监控') : null} placement="bottom">
                      <button
                        className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'network' ? 'active' : ''}`}
                        onClick={() => setContentTab(contentTab === 'network' ? 'terminal' : 'network')}
                      >
                        <Globe size={14} />
                        {!terminalToolbarIconOnly && t('网络监控')}
                      </button>
                    </Tiptop>
                  )}
                  <Tiptop text={terminalToolbarIconOnly ? t('历史指令') : null} placement="bottom">
                    <button
                      className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'history' ? 'active' : ''}`}
                      onClick={() => setContentTab(contentTab === 'history' ? 'terminal' : 'history')}
                    >
                      <ScrollText size={14} />
                      {!terminalToolbarIconOnly && t('历史指令')}
                    </button>
                  </Tiptop>
                  {/* ── 新建终端按钮 ── */}
                  {!activeSession?.isSerial && (
                    <Tiptop text={terminalToolbarIconOnly ? t('新建终端') : null} placement="bottom">
                      <button
                        className={`btn btn-ghost btn-sm terminal-create-btn ${isCreatingTerminal ? 'is-creating' : ''}`}
                        onClick={() => openNewTerminal(activeSession.id || '')}
                        style={{ marginLeft: 2, flexShrink: 0 }}
                        disabled={isCreatingTerminal}
                        aria-busy={isCreatingTerminal}
                      >
                        {isCreatingTerminal ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                        {!terminalToolbarIconOnly && t('新建终端')}
                      </button>
                    </Tiptop>
                  )}
                </div>
              </div>
            )}
            {showTerminalList && (
              <div
                ref={terminalListMenuRef}
                id="terminal-sub-tab-menu"
                className="tab-context-menu terminal-tab-list-menu"
                style={{
                  left: terminalListPosition.x,
                  top: terminalListPosition.y,
                  width: terminalListPosition.width,
                  maxHeight: terminalListPosition.maxHeight,
                }}
              >
                <div className="terminal-tab-list-search">
                  <input
                    ref={terminalListSearchRef}
                    id="terminal-sub-tab-search"
                    name="terminal-sub-tab-search"
                    autoComplete="off"
                    type="text"
                    value={terminalListQuery}
                    onChange={(event) => setTerminalListQuery(event.target.value)}
                    placeholder={t('搜索')}
                    aria-label={t('搜索')}
                  />
                  <Search size={13} />
                </div>
                <div id="terminal-sub-tab-list" role="listbox" aria-label={t('终端')} className="terminal-tab-list-items">
                  {filteredTerminalTabs.map((rawTerm) => {
                    const term = rawTerm as WorkspaceTerminalTab;
                    return (
                      <button
                        key={term.id}
                        type="button"
                        role="option"
                        aria-selected={activeTerminalId === term.id}
                        className="tab-context-menu-item terminal-tab-list-item"
                        onClick={() => selectTerminalTab(term, true)}
                      >
                        <Monitor size={13} />
                        <span>{term.label}</span>
                      </button>
                    );
                  })}
                  {filteredTerminalTabs.length === 0 && (
                    <div className="terminal-tab-list-empty">{t('无匹配结果')}</div>
                  )}
                </div>
              </div>
            )}

            {/* Session Content */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
              {/* 左侧/上侧主体容器 */}
              <div id="session-editor-container" style={{ flex: 1, display: 'flex', flexDirection: 'row', height: '100%', position: 'relative', overflow: 'hidden' }}>
                {/* 主体视口 */}
                <div id="editor-main-content" style={{ flex: 1, position: 'relative', overflow: 'hidden', order: 1 }}>
                  {sessions.map((s) => {
                    const shouldMountFileManager = s.status === 'connected'
                      && mountedSessions.has(s.id || '')
                      && !s.isSerial;
                    const showSplitFileManager = shouldMountFileManager
                      && contentTab !== 'process'
                      && contentTab !== 'network'
                      && fileManagerPosition !== 'tab';
                    const showTabFileManager = shouldMountFileManager
                      && fileManagerPosition === 'tab'
                      && contentTab === 'files';
                    const sessionConnectingServer = connectingServers.find((item) => item.sessionId === s.id) || null;
                    const sessionAuthPrompt = sessionAuthPrompts[s.id || ''] || null;
                    const showLeftFileManager = showSplitFileManager && fileManagerPosition === 'left' && !fileManagerCollapsed;
                    const showRightFileManager = showSplitFileManager && fileManagerPosition === 'right' && !fileManagerCollapsed;
                    const showSideFileManager = showLeftFileManager || showRightFileManager;
                    const showBottomFileManager = showSplitFileManager && fileManagerPosition === 'bottom' && !fileManagerCollapsed;
                    const showBottomQuickCommands = showQuickCommands
                      && s.status === 'connected'
                      && activeSessionId === s.id
                      && contentTab === 'terminal';
                    const showBottomDockPanel = showBottomFileManager || showBottomQuickCommands;
                    const showLeftCollapseStrip = showSplitFileManager && fileManagerPosition === 'left' && fileManagerCollapsed;
                    const showRightCollapseStrip = showSplitFileManager && fileManagerPosition === 'right' && fileManagerCollapsed;
                    const showBottomCollapseStrip = showSplitFileManager && fileManagerPosition === 'bottom' && fileManagerCollapsed && !showBottomQuickCommands;
                    const showFileManagerPanel = showTabFileManager || showSideFileManager || showBottomFileManager;
                    return (
                      <div
                        key={s.id}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: activeSessionId === s.id ? 'flex' : 'none',
                          flexDirection: 'column',
                        }}
                      >
                        {showLeftCollapseStrip && (
                          <button
                            type="button"
                            className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                            onClick={() => setFileManagerCollapsedPersistent(false)}
                            aria-label={t('展开文件管理面板')}
                            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: Z.PANEL_BUTTON + 1 }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        )}
                        {showRightCollapseStrip && (
                          <button
                            type="button"
                            className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag"
                            onClick={() => setFileManagerCollapsedPersistent(false)}
                            aria-label={t('展开文件管理面板')}
                            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: Z.PANEL_BUTTON + 1 }}
                          >
                            <ChevronLeft size={14} />
                          </button>
                        )}
                        {showBottomCollapseStrip && (
                          <button
                            type="button"
                            className="panel-collapse-strip panel-collapse-strip-horizontal panel-collapse-strip-bottom no-drag"
                            onClick={() => setFileManagerCollapsedPersistent(false)}
                            aria-label={t('展开文件管理面板')}
                            // 贴在会话区底边细条，zIndex 低于终端输入栏提示，避免挡住「历史/命令」
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: 0,
                              zIndex: 1,
                              height: 12,
                              minHeight: 12,
                            }}
                          >
                            <ChevronUp size={12} />
                          </button>
                        )}
                        {shouldMountFileManager && (
                          <div
                            style={{
                              position: 'absolute',
                              display: showFileManagerPanel ? 'flex' : 'none',
                              flexDirection: 'column',
                              overflow: 'hidden',
                              background: 'var(--surface-base)',
                              zIndex: 1,
                              ...(showLeftFileManager ? {
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${leftSplitWidth}px`,
                                minWidth: `${FILE_MANAGER_LEFT_MIN}px`,
                                borderRight: '1px solid var(--border)',
                              } : {}),
                              ...(showRightFileManager ? {
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: `${leftSplitWidth}px`,
                                minWidth: `${FILE_MANAGER_LEFT_MIN}px`,
                                borderLeft: '1px solid var(--border)',
                              } : {}),
                              ...(showBottomFileManager ? {
                                left: 0,
                                right: 0,
                                bottom: 0,
                                height: `${bottomSplitHeight}px`,
                                minHeight: `${FILE_MANAGER_BOTTOM_MIN}px`,
                                borderTop: '1px solid var(--border)',
                              } : {}),
                              ...(showTabFileManager ? {
                                inset: 0,
                              } : {}),
                            }}
                          >
                            {showLeftFileManager && collapseDragIntent === 'left' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-right">
                                <ChevronLeft size={14} />
                              </div>
                            )}
                            {showRightFileManager && collapseDragIntent === 'right' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-left">
                                <ChevronRight size={14} />
                              </div>
                            )}
                            {showBottomFileManager && !showBottomQuickCommands && collapseDragIntent === 'bottom' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-horizontal panel-collapse-armed-zone-top">
                                <ChevronDown size={14} />
                              </div>
                            )}
                            {renderSessionFileManagers(s)}
                          </div>
                        )}
                        {showBottomQuickCommands && (
                          <div
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              // 侧栏文件管理器打开时，命令面板不盖住文件管理器
                              left: showLeftFileManager ? `${leftSplitWidth}px` : 0,
                              right: showRightFileManager ? `${leftSplitWidth}px` : 0,
                              bottom: 0,
                              height: `${bottomSplitHeight}px`,
                              minHeight: `${FILE_MANAGER_BOTTOM_MIN}px`,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'visible',
                              background: 'var(--surface-base)',
                              borderTop: '1px solid var(--border)',
                              // 高于终端区，避免输入栏按钮被拖条拦截
                              zIndex: Z.PANEL_BUTTON + 4,
                            }}
                          >
                            {/* 拖条放在面板顶部内部，不再与终端「历史/命令」按钮重叠 */}
                            <div
                              className={`split-resizer-h hotzone-bottom${collapseDragIntent === 'bottom' ? ' armed' : ''}`}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                startDrag(e, 'bottom');
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                              aria-label={t('调整快捷命令高度')}
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                top: 0,
                                height: 0,
                                zIndex: 5,
                                margin: 0,
                              }}
                            />
                            {collapseDragIntent === 'bottom' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-horizontal panel-collapse-armed-zone-top">
                                <ChevronDown size={14} />
                              </div>
                            )}
                            <QuickCommands
                              ref={quickCmdsRef}
                              sessionId={(activeTerminalId || s.id) || ''}
                              historySessionId={s.id || ''}
                              addToast={addToast}
                              connectedSessions={connectedSessions as Array<{ id: string }>}
                              onClose={() => setShowQuickCommands(false)}
                            />
                          </div>
                        )}
                        {showLeftFileManager && (
                          <div
                            className={`split-resizer-v hotzone-left${collapseDragIntent === 'left' ? ' armed' : ''}`}
                            onMouseDown={(e) => startDrag(e, 'left')}
                            onClick={() => {
                              if (shouldIgnoreResizerClick()) return;
                              setFileManagerCollapsedPersistent(true);
                            }}
                            aria-label={t('收起文件管理面板')}
                            style={{
                              position: 'absolute',
                              left: `${leftSplitWidth}px`,
                              top: 0,
                              // 底部有命令面板时，竖拖条不要被底部面板盖住
                              bottom: showBottomQuickCommands ? `${bottomSplitHeight}px` : 0,
                              zIndex: Z.PANEL_BUTTON + 5,
                              marginLeft: 0,
                              marginRight: 0,
                            }}
                          />
                        )}
                        {showRightFileManager && (
                          <div
                            className={`split-resizer-v hotzone-right${collapseDragIntent === 'right' ? ' armed' : ''}`}
                            onMouseDown={(e) => startDrag(e, 'right')}
                            onClick={() => {
                              if (shouldIgnoreResizerClick()) return;
                              setFileManagerCollapsedPersistent(true);
                            }}
                            aria-label={t('收起文件管理面板')}
                            style={{
                              position: 'absolute',
                              right: `${leftSplitWidth}px`,
                              top: 0,
                              bottom: showBottomQuickCommands ? `${bottomSplitHeight}px` : 0,
                              zIndex: Z.PANEL_BUTTON + 5,
                              marginLeft: 0,
                              marginRight: 0,
                            }}
                          />
                        )}
                        {/* 仅文件管理器底部模式用外部分隔条；快捷命令用面板内拖条 */}
                        {showBottomFileManager && !showBottomQuickCommands && (
                          <div
                            className={`split-resizer-h hotzone-bottom${collapseDragIntent === 'bottom' ? ' armed' : ''}`}
                            onMouseDown={(e) => startDrag(e, 'bottom')}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (shouldIgnoreResizerClick()) return;
                              setFileManagerCollapsedPersistent(true);
                            }}
                            aria-label={t('收起文件管理面板')}
                            style={{
                              position: 'absolute',
                              left: showLeftFileManager ? `${leftSplitWidth}px` : 0,
                              right: showRightFileManager ? `${leftSplitWidth}px` : 0,
                              bottom: `${bottomSplitHeight}px`,
                              zIndex: Z.PANEL_BUTTON,
                              marginTop: 0,
                              marginBottom: 0,
                            }}
                          />
                        )}
                        <div
                          id="terminal-dock-preview-host"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            flex: 1,
                            minWidth: 0,
                            minHeight: 0,
                            overflow: 'hidden',
                            marginLeft: showLeftFileManager ? `${leftSplitWidth}px` : (showLeftCollapseStrip ? 12 : 0),
                            marginRight: showRightFileManager ? `${leftSplitWidth}px` : (showRightCollapseStrip ? 12 : 0),
                            // 底部收起条 12px，给终端输入栏留空，避免挡「历史」按钮
                            marginBottom: showBottomDockPanel
                              ? `${bottomSplitHeight}px`
                              : (showBottomCollapseStrip ? 12 : 0),
                          }}
                        >
                          <div style={{ display: (contentTab === 'terminal' || s.status !== 'connected') ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', position: 'relative' }}>
                            {mountedSessions.has(s.id || '') && (
                              isSessionWorkspaceVisible(s) ? (() => {
                                const isTerminalViewActive = activeSessionId === s.id && (contentTab === 'terminal' || s.status !== 'connected');
                                const workspaceTabs = getSessionWorkspaceTabs(s);
                                const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeTerminalId);
                                const activeLayout = activeWorkspaceTab?.type === 'group' ? terminalPaneLayouts[activeWorkspaceTab.id] : null;
                                const activeLayoutId = activeLayout?.sessionId === s.id && activeWorkspaceTab ? activeWorkspaceTab.id : null;
                                const terminalPlacements = new Map<string, { cells: TerminalPaneCellId[]; layoutId: string | null; paneId: string | null | undefined; showHeader: boolean }>();
                                if (activeLayoutId && activeLayout) {
                                  terminalPlacements.set(activeLayout.rootTerminalId || activeLayoutId, {
                                    cells: getSessionRootPaneCells(activeLayoutId),
                                    layoutId: activeLayoutId,
                                    paneId: null,
                                    showHeader: false,
                                  });
                                  getSessionPanes(activeLayoutId).forEach((pane) => {
                                    terminalPlacements.set(pane.terminalId, {
                                      cells: pane.cells,
                                      layoutId: activeLayoutId,
                                      paneId: pane.id,
                                      showHeader: true,
                                    });
                                  });
                                } else if (activeWorkspaceTab?.type === 'terminal') {
                                  terminalPlacements.set(activeWorkspaceTab.id, {
                                    cells: TERMINAL_PANE_CELL_IDS,
                                    layoutId: null,
                                    paneId: null,
                                    showHeader: false,
                                  });
                                }
                                return getEffectiveTerminals(s).map((term) => {
                                  const placement = terminalPlacements.get(term.id);
                                  const isTermVisible = !!placement && isTerminalViewActive;
                                  const isGrouped = !!placement?.layoutId;
                                  return (
                                    <div
                                      key={term.id}
                                      style={{
                                        position: 'absolute',
                                        ...getTerminalPaneAbsolutePlacement(placement?.cells || TERMINAL_PANE_CELL_IDS),
                                        display: 'flex',
                                        flexDirection: 'column',
                                        visibility: isTermVisible ? 'visible' : 'hidden',
                                        pointerEvents: isTermVisible ? 'auto' : 'none',
                                        contain: isTermVisible ? 'none' : 'strict',
                                        minWidth: 0,
                                        minHeight: 0,
                                        overflow: 'hidden',
                                        border: isGrouped ? '1px solid var(--border)' : 'none',
                                        borderRadius: 0,
                                        background: 'var(--surface-base)',
                                      }}
                                    >
                                      {placement?.showHeader && (
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            minHeight: 32,
                                            padding: '0 10px',
                                            borderBottom: '1px solid var(--border-subtle)',
                                            background: 'var(--surface-raised)',
                                            color: 'var(--text-secondary)',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            flexShrink: 0,
                                          }}
                                        >
                                          <Monitor size={12} />
                                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {term.label}
                                          </span>
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm no-drag"
                                            onClick={(e) => closeTerminalPane(placement.layoutId || '', placement.paneId || '', e)}
                                            aria-label={t('关闭分屏')}
                                            style={{ minHeight: 24, padding: '0 6px' }}
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      )}
                                      <div style={{ flex: 1, minHeight: 0 }}>
                                        <ErrorBoundary label={`终端 ${term.id} 渲染出错`}>
                                          <Terminal
                                            sessionId={term.id || ''}
                                            serverId={String(s.id ?? '')}
                                            historyServerId={String(s.serverId ?? '')}
                                            status={String(s.status ?? '')}
                                            isActive={isTermVisible}
                                            serverName={String(s.serverName ?? '')}
                                            connectedSessions={connectedSessions}
                                            showCommands={showQuickCommands && isTermVisible}
                                            onQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                                            quickCmdsRef={quickCmdsRef}
                                            wsRebuildKey={(s.wsRebuildKey as number) || 0}
                                          />
                                        </ErrorBoundary>
                                      </div>
                                    </div>
                                  );
                                });
                              })() : (getEffectiveTerminals(s).map((t) => {
                                const isTermActive = (contentTab === 'terminal' || s.status !== 'connected') && activeTerminalId === t.id;
                                return (
                                  <div key={t.id} style={{
                                    position: 'absolute', inset: 0,
                                    display: 'flex',
                                    visibility: isTermActive ? 'visible' : 'hidden',
                                    pointerEvents: isTermActive ? 'auto' : 'none',
                                    contain: isTermActive ? 'none' : 'strict',
                                    flexDirection: 'column',
                                  }}>
                                    <ErrorBoundary label={`终端 ${t.id} 渲染出错`}>
                                      <Terminal
                                        sessionId={t.id || ''}
                                        serverId={String(s.id ?? '')}
                                        historyServerId={String(s.serverId ?? '')}
                                        status={String(s.status ?? '')}
                                        isActive={activeSessionId === s.id && activeTerminalId === t.id && (contentTab === 'terminal' || fileManagerPosition !== 'tab')}
                                        serverName={String(s.serverName ?? '')}
                                        connectedSessions={connectedSessions}
                                        showCommands={showQuickCommands && activeSessionId === s.id && activeTerminalId === t.id}
                                        onQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                                        quickCmdsRef={quickCmdsRef}
                                        wsRebuildKey={(s.wsRebuildKey as number) || 0}
                                      />
                                    </ErrorBoundary>
                                  </div>
                                );
                              }))
                            )}
                            {restoringWorkspaceSessionIds.has(s.id || '') && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  zIndex: Z.COMPONENT_OVERLAY,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 10,
                                  background: 'var(--surface-base)',
                                  color: 'var(--text-secondary)',
                                  fontSize: 13,
                                  pointerEvents: 'none',
                                }}
                              >
                                <RefreshCw size={16} className="spin" />
                                <span>{t('正在恢复终端工作区…')}</span>
                              </div>
                            )}
                          </div>
                          {s.status === 'connected' && mountedSessions.has(s.id || '') && (
                            <div style={{ display: contentTab === 'history' ? 'block' : 'none', height: '100%', flex: 1 }}>
                              <CommandHistory
                                sessionId={s.id || ''}
                                historyServerId={s.serverId ? String(s.serverId) : ''}
                                terminalId={activeTerminalId || s.id || ''}
                                addToast={addToast}
                              />
                            </div>
                          )}
                          {s.status === 'connected' && mountedSessions.has(s.id || '') && !s.isSerial && !isUnsupportedMonitorSession(s) && (
                            <div style={{ display: contentTab === 'process' ? 'flex' : 'none', height: '100%', flex: 1, minWidth: 0, minHeight: 0 }}>
                              <ProcessPage
                                sessionId={s.id || ''}
                                addToast={addToast}
                                active={contentTab === 'process' && activeSessionId === s.id}
                              />
                            </div>
                          )}
                          {s.status === 'connected' && mountedSessions.has(s.id || '') && !s.isSerial && !isUnsupportedMonitorSession(s) && (
                            <div style={{ display: contentTab === 'network' ? 'flex' : 'none', height: '100%', flex: 1, minWidth: 0, minHeight: 0 }}>
                              <NetworkPage
                                sessionId={s.id || ''}
                                active={contentTab === 'network' && activeSessionId === s.id}
                              />
                            </div>
                          )}
                          {/* 有待确认交互时让位给 SessionAuthCard，二者 z-index 相同不可重叠 */}
                          {sessionConnectingServer && s.status === 'connecting' && !sessionAuthPrompt && (
                            <ConnectingCard
                              connectingServer={sessionConnectingServer}
                              t={t}
                              onCancel={() => handleCancelConnection(s.id || '')}
                            />
                          )}
                          {sessionAuthPrompt && (
                            <SessionAuthCard
                              key={sessionAuthPrompt.token}
                              prompt={sessionAuthPrompt}
                              isActive={activeSessionId === s.id}
                              t={t}
                              onResolve={(result) => {
                                if (sessionAuthPrompt.kind === 'password') {
                                  void resolvePasswordPrompt(s.id || '', sessionAuthPrompt.connId || '', result as { value: string; persist: boolean } | null);
                                } else {
                                  void resolveHostKeyChoice(s.id || '', result as number);
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {terminalDockDragPreview && terminalDockDragPreview.zones && terminalDockDragPreview.zones.length > 0 && (
                    <>
                      <div
                        className="terminal-pane-dock-preview-layer"
                        aria-hidden="true"
                        style={{ position: 'fixed', inset: 0, zIndex: Z.PANEL_BUTTON + 7 }}
                      >
                        {(terminalDockDragPreview.zones as Array<{ target: string; style: React.CSSProperties }>).map((zone) => (
                          <div
                            key={zone.target}
                            className={`terminal-pane-dock-preview-slot${terminalDockDragPreview.activeTarget === zone.target ? ' active' : ''}${(terminalDockDragPreview.zoneStates as Record<string, { occupied?: boolean; enabled?: boolean }> | undefined)?.[zone.target]?.occupied ? ' occupied' : ''}${(terminalDockDragPreview.zoneStates as Record<string, { occupied?: boolean; enabled?: boolean }> | undefined)?.[zone.target]?.enabled === false ? ' disabled' : ''}`}
                            style={zone.style}
                          >
                            <span className="terminal-pane-dock-preview-label">{(zone as { label?: string }).label}</span>
                          </div>
                        ))}
                      </div>
                      <div
                        className="terminal-pane-dock-drag-ghost"
                        aria-hidden="true"
                        style={{
                          left: `${terminalDockDragPreview.pointer.x}px`,
                          top: `${terminalDockDragPreview.pointer.y}px`,
                          zIndex: Z.MODAL - 1,
                        }}
                      >
                        <Monitor size={12} />
                        <span>{terminalDockDragPreview.label}</span>
                      </div>
                    </>
                  )}
                </div>
                {fileManagerDockDropzones.filter(({ target }) => target !== 'tab').map(({ target, style }) => (
                  <div
                    key={target}
                    className={`file-manager-dock-preview-dropzone${fileManagerDockConfirmTarget === target ? ' active' : ''}`}
                    style={{ ...style, zIndex: Z.PANEL_BUTTON + 6 }}
                  />
                ))}
                {/* 文件编辑器分栏 host（由 FileEditor 通过 Portal 渲染） */}
                <div
                  className="split-resizer-v hotzone-right"
                  style={{ display: 'none', order: 1 }}
                  id="editor-split-resizer"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const host = document.getElementById('editor-split-host');
                    if (!host) return;
                    const container = document.getElementById('session-editor-container');
                    if (!container) return;
                    const rect = container.getBoundingClientRect();
                    const startX = e.clientX;
                    const startW = host.getBoundingClientRect().width;
                    const splitPos = host.style.order === '0' ? 'left' : 'right';
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX;
                      const newW = splitPos === 'right'
                        ? Math.max(200, Math.min(rect.width - 200, startW - dx))
                        : Math.max(200, Math.min(rect.width - 200, startW + dx));
                      host.style.width = newW + 'px';
                      host.style.transition = 'none';
                      window.dispatchEvent(new Event('resize'));
                    };
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                      document.body.style.cursor = '';
                      document.body.style.userSelect = '';
                      host.style.transition = '';
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                  }}
                />
                <div id="editor-split-host" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', order: 2, width: 0, transition: 'width 0.2s ease, height 0.2s ease' }} />
                {activeChangeReview ? (
                  <Suspense fallback={null}>
                    <AIChangeReviewWorkbench
                      review={activeChangeReview as Parameters<typeof AIChangeReviewWorkbench>[0]['review']}
                      queueLength={(activeChangeReviewQueue as unknown[]).length}
                    />
                  </Suspense>
                ) : null}
                {activeRestorePreviewReview && (activeRestorePreviewReview as { review?: unknown }).review ? (
                  <Suspense fallback={null}>
                    <AIChangeReviewWorkbench
                      review={(activeRestorePreviewReview as { review: unknown }).review as Parameters<typeof AIChangeReviewWorkbench>[0]['review']}
                      queueLength={1}
                      previewOnly={true}
                      onClose={() => {
                        if (!activeWorkspaceTerminalKey) {
                          return;
                        }
                        (setRestorePreviewReviews as (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void)((prev) => {
                          if (!prev[activeWorkspaceTerminalKey]) {
                            return prev;
                          }
                          const next = { ...prev };
                          delete next[activeWorkspaceTerminalKey];
                          return next;
                        });
                      }}
                    />
                  </Suspense>
                ) : null}
                {activeConversationDiffPanel ? (
                  <AIConversationDiffOverlay
                    sessionLabel={
                      String(sessions.find((item) => item.id === (activeConversationDiffPanel as { sessionId?: unknown }).sessionId)?.serverName || '')
                      || String(sessions.find((item) => item.id === (activeConversationDiffPanel as { sessionId?: unknown }).sessionId)?.host || '')
                      || String((activeConversationDiffPanel as { sessionId?: unknown }).sessionId || '')
                    }
                    items={(activeConversationDiffPanel as { items?: unknown }).items || []}
                    reviewByArtifactPath={(activeConversationDiffPanel as { reviewByArtifactPath?: Record<string, unknown> }).reviewByArtifactPath || {}}
                    loadingByArtifactPath={(activeConversationDiffPanel as { loadingByArtifactPath?: Record<string, unknown> }).loadingByArtifactPath || {}}
                    selectedMessageId={String((activeConversationDiffPanel as { selectedMessageId?: unknown }).selectedMessageId || '')}
                    onSelectItem={(item) => void handleSelectConversationDiffItem(item, {
                      sessionId: (activeConversationDiffPanel as { sessionId?: string }).sessionId,
                      terminalId: (activeConversationDiffPanel as { terminalId?: string }).terminalId,
                      tabId: activeAIWorkspaceTabId,
                      locate: true,
                    })}
                    onPreviewRestore={(artifactPath) => handleReapplyConversationDiffItem(artifactPath, String((activeConversationDiffPanel as { sessionId?: unknown }).sessionId || ''), String((activeConversationDiffPanel as { terminalId?: unknown }).terminalId || ''), activeAIWorkspaceTabId)}
                    onApplyRestore={(artifactPath) => handleApplyConversationDiffRestore(artifactPath, String((activeConversationDiffPanel as { sessionId?: unknown }).sessionId || ''), String((activeConversationDiffPanel as { terminalId?: unknown }).terminalId || ''), activeAIWorkspaceTabId)}
                    onClose={() => {
                      if (!activeWorkspaceTerminalKey) {
                        return;
                      }
                      (setConversationDiffPanels as (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void)((prev) => {
                        if (!prev[activeWorkspaceTerminalKey]) {
                          return prev;
                        }
                        const next = { ...prev };
                        delete next[activeWorkspaceTerminalKey];
                        return next;
                      });
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>

          {/* 系统监控探针面板（独立分栏，右侧） */}
          {probePanelNode && probePanelPosition === 'right' && (
            probePanelCollapsed ? (
              <Tiptop text={t('展开监控面板')} placement="bottom">
                <button
                  type="button"
                  className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag"
                  onClick={() => setProbePanelCollapsedPersistent(false)}
                  aria-label={t('展开监控面板')}
                >
                  <ChevronLeft size={14} />
                </button>
              </Tiptop>
            ) : (
              <>
                <Tiptop text={t('收起监控面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v hotzone-right probe-resizer${collapseDragIntent === 'probe' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'probe')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setProbePanelCollapsedPersistent(true);
                    }}
                    aria-label={t('收起监控面板')}
                  />
                </Tiptop>
                <div
                  className="probe-panel-wrapper"
                  style={{
                    width: probePanelWidth,
                    minWidth: probePanelWidth,
                    height: '100%',
                    display: 'flex',
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'hidden',
                    borderLeft: '1px solid var(--border)',
                    background: 'var(--surface-base)',
                  }}
                >
                  {collapseDragIntent === 'probe' && (
                    <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-left">
                      <ChevronRight size={14} />
                    </div>
                  )}
                  {probePanelNode}
                </div>
              </>
            )
          )}
          {aiPanelNode && probePanelPosition === 'left' && (
            <>
              {isActiveSessionConnected && (showAIPanel ? (
                <Tiptop text={t('收起 AI 助手面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v hotzone-right${collapseDragIntent === 'ai' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'ai')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setAIPanelVisibility(false);
                    }}
                    aria-label={t('收起 AI 助手面板')}
                  />
                </Tiptop>
              ) : (
                <Tiptop text={t('打开 AI 助手面板')} placement="bottom">
                  <button
                    type="button"
                    className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag"
                    onClick={() => setAIPanelVisibility(true)}
                    aria-label={t('打开 AI 助手面板')}
                  >
                    <ChevronLeft size={14} />
                  </button>
                </Tiptop>
              ))}
              {aiPanelNode}
            </>
          )}
        </div>
      </main>
  );
}
