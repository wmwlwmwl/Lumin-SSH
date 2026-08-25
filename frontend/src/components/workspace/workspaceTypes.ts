import type React from 'react';
import type { config } from '../../../wailsjs/go/models.ts';
import type { ConnectingServer, SessionAuthPrompt } from '../../hooks/useSessionConnections.ts';
import type { TerminalDockDragPreview, SubTabSessionLike, SubTabTerminalLike } from '../../hooks/useTerminalSubTabs.ts';
import type { ServerListViewMode, DashboardHostPageMode } from '../../hooks/useDashboardPreferences.ts';
import type { TerminalTabContextMenuState } from '../AppOverlays.tsx';
import type { ServerFormData } from '../../hooks/useServerCatalog.ts';
import type { PanelResizeDirection } from '../../hooks/useWorkspacePanelDocking.ts';
import type { ConversationDiffItem } from '../../hooks/useAIReview.ts';
import type { TerminalPaneLayout, TerminalPaneCellId } from '../../utils/terminalPaneLayout.ts';
import type { SessionLike } from '../../utils/sessionWorkspace.ts';
import type { QuickCommandsHandle } from '../QuickCommands.tsx';

/** 工作区终端标签（getSessionWorkspaceTabs 返回） */
export interface WorkspaceTerminalTab {
  id: string;
  type: 'terminal' | 'group';
  label?: string;
  terminalIds?: string[];
}

export interface SessionWorkspaceDashboardProps {
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

export interface SessionWorkspaceSessionProps {
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

export interface SessionWorkspaceFileManagerProps {
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

export interface SessionWorkspaceTerminalTabsProps {
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

export interface SessionWorkspaceAIProps {
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

export interface SessionWorkspaceQuickCommandsProps {
  handleQuickCommandsOpenChange: (open: boolean) => void;
  quickCmdsRef: React.RefObject<QuickCommandsHandle | null>;
  setShowQuickCommands: (v: boolean) => void;
  showQuickCommands: boolean;
}

export interface SessionWorkspaceSharedProps {
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
