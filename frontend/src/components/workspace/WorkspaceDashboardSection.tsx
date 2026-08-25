import * as AppGo from '../../../wailsjs/go/wailsapp/App.js';
import Dashboard from '../Dashboard.tsx';
import type { config } from '../../../wailsjs/go/models.ts';
import type { ServerListViewMode, DashboardHostPageMode } from '../../hooks/useDashboardPreferences.ts';
import type { SessionWorkspaceDashboardProps, SessionWorkspaceSharedProps } from './workspaceTypes.ts';

export interface WorkspaceDashboardSectionProps {
  activeSessionId: string | null;
  dashboard: Partial<SessionWorkspaceDashboardProps>;
  shared: Partial<SessionWorkspaceSharedProps>;
}

export default function WorkspaceDashboardSection({
  activeSessionId,
  dashboard,
  shared,
}: WorkspaceDashboardSectionProps) {
  const {
    allGroups = [],
    batchSelectionMode = false,
    clearRecentConnections = () => {},
    connectLocal = () => {},
    connectSerial = () => {},
    connectServer = async () => {},
    credentials = [],
    dashboardHostPageMode = 'compact' as DashboardHostPageMode,
    editFlyAnimation,
    editFlyShiningFields = {},
    filteredServers = [],
    handleBatchConnect = async () => {},
    handleBatchDelete = async () => {},
    handleBatchExport = async () => {},
    handleBatchMoveGroup = async () => {},
    handleDeleteServer = async () => {},
    handleGroupDelete = async () => {},
    handleMoveGroup = async () => {},
    handleOpenImportExport = () => {},
    handleRefreshPing = () => {},
    handleRenameGroup = async () => false,
    handleSaveAndConnectServer = async () => null,
    handleSaveServer = async () => null,
    hideSensitive = false,
    isRefreshingPing = false,
    pingCounts,
    pingEnabled = false,
    pings = {},
    recentConnectionIds = [],
    removeRecentConnection = () => {},
    saveFlowHighlights = { serverId: null, rowPulse: null, fields: {} },
    searchQuery = '',
    selectedServerIds = [],
    serverEditor,
    serverListViewMode = 'grid' as ServerListViewMode,
    servers = [],
    setBatchSelectionMode = () => {},
    setDashboardHostPageMode = () => {},
    setHideSensitive = () => {},
    setSearchQuery = () => {},
    setServerEditor,
    setServerListViewMode = () => {},
    setShowCredentials = () => {},
    setShowSerialModal = () => {},
    startAddGuideAnimation = () => {},
    startEditFlyAnimation = () => {},
    toggleBatchSelection = () => {},
  } = dashboard;

  const { addToast = () => 0 } = shared;

  return (
    <div className="flex-1 flex-col h-full" style={{ display: activeSessionId === null ? 'flex' : 'none' }}>
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
        sessions={dashboard.connectedSessions as Parameters<typeof Dashboard>[0]['sessions']}
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
        onSelectionModeToggle={() => setBatchSelectionMode(prev => !prev)}
        onConnectLocal={connectLocal}
        onConnectSerial={connectSerial}
        setShowSerialModal={setShowSerialModal}
      />
    </div>
  );
}
