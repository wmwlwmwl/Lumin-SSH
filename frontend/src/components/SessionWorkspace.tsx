import { useCallback } from 'react';
import { Monitor } from 'lucide-react';
import { Z } from '../constants/zIndex.ts';
import WorkspaceDashboardSection from './workspace/WorkspaceDashboardSection.tsx';
import WorkspaceSubTabBar from './workspace/WorkspaceSubTabBar.tsx';
import WorkspaceSessionContent from './workspace/WorkspaceSessionContent.tsx';
import WorkspaceSidePanes from './workspace/WorkspaceSidePanes.tsx';
import WorkspaceDiffModals from './workspace/WorkspaceDiffModals.tsx';
import type {
  SessionWorkspaceProps,
  WorkspaceTerminalTab,
} from './workspace/workspaceTypes.ts';

export type { SessionWorkspaceProps };

export default function SessionWorkspace({
  dashboard = {},
  session = {},
  fileManager = {},
  terminalTabs = {},
  ai = {},
  quickCommands = {},
  shared = {},
}: SessionWorkspaceProps) {
  const {
    activeSession,
    activeSessionId = null,
    activeSessionRootTerminals = [],
    activeTerminalId = null,
    connectingServers = [],
    contentTab = 'terminal',
    getEffectiveTerminals = () => [],
    getSessionPanes = () => [],
    getSessionRootPaneCells = () => [],
    getSessionWorkspaceTabs = () => [],
    handleCancelConnection = () => {},
    isActiveSessionConnected = false,
    isCreatingTerminal = false,
    isSessionWorkspaceVisible = () => true,
    markWorkspaceRestoreNavigationOverride = () => {},
    mountedSessions = new Set<string>(),
    openNewTerminal = async () => {},
    persistWorkspaceSnapshotRef = { current: null },
    rememberSessionActiveTerminal = () => {},
    resolveHostKeyChoice = async () => {},
    resolvePasswordPrompt = async () => {},
    restoringWorkspaceSessionIds = new Set<string>(),
    sessionAuthPrompts = {},
    sessions = [],
    setActiveTerminalId = () => {},
    setContentTab = () => {},
    setTabContextMenu = () => {},
    setTerminalTabContextMenu = () => {},
    terminalPaneLayouts = {},
  } = session;

  const {
    bottomSplitHeight = 240,
    collapseDragIntent,
    fileManagerCollapsed = false,
    fileManagerDockConfirmTarget,
    fileManagerDockDropzones = [],
    fileManagerDockPreview,
    fileManagerDockTabAnchorRef = { current: null },
    fileManagerPosition = 'left',
    leftSplitWidth = 260,
    probePanelCollapsed = false,
    probePanelNode = null,
    probePanelPosition = 'left',
    probePanelWidth = 240,
    renderSessionFileManagers = () => null,
    setFileManagerCollapsedPersistent = () => {},
    setProbePanelCollapsedPersistent = () => {},
    shouldIgnoreResizerClick = () => false,
    startDrag = () => {},
  } = fileManager;

  const {
    closeTerminal = () => {},
    closeTerminalGroup = () => {},
    closeTerminalPane = () => {},
    handleTerminalSubTabClickCapture = () => {},
    handleTerminalSubTabDockMouseDown = () => {},
    handleTerminalSubTabMouseDown = () => {},
    handleTerminalSubTabScroll = () => {},
    handleTerminalSubTabWheel = () => {},
    shouldIgnoreTerminalDockClick = () => false,
    terminalDockDragPreview = null,
    terminalSubTabActionsRef = { current: null },
    terminalSubTabOverflow = false,
    terminalSubTabScrollRef = { current: null },
    terminalSubTabScrollStyle = {},
    terminalToolbarIconOnly = false,
  } = terminalTabs;

  const {
    aiPanelNode = null,
    setAIPanelVisibility = () => {},
    showAIPanel = false,
  } = ai;

  const {
    handleQuickCommandsOpenChange = () => {},
    quickCmdsRef = { current: null },
    setShowQuickCommands = () => {},
    showQuickCommands = false,
  } = quickCommands;

  const {
    addToast = () => 0,
    t = (k: string) => k,
  } = shared;

  const selectTerminalTab = useCallback((term: WorkspaceTerminalTab) => {
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
  }, [activeSession, markWorkspaceRestoreNavigationOverride, persistWorkspaceSnapshotRef, rememberSessionActiveTerminal, setActiveTerminalId, setContentTab, setTerminalTabContextMenu]);

  return (
    <main className="main-area">
      <WorkspaceDashboardSection
        activeSessionId={activeSessionId}
        dashboard={dashboard}
        shared={shared}
      />

      <div data-ai-workspace-root="true" className="flex-row flex-1 h-full overflow-hidden relative" style={{ display: activeSessionId !== null ? 'flex' : 'none' }}>
        <WorkspaceSidePanes
          position="left"
          aiPanelNode={aiPanelNode}
          probePanelNode={probePanelNode}
          probePanelPosition={probePanelPosition}
          probePanelCollapsed={probePanelCollapsed}
          probePanelWidth={probePanelWidth}
          showAIPanel={showAIPanel}
          isActiveSessionConnected={isActiveSessionConnected}
          collapseDragIntent={collapseDragIntent}
          setAIPanelVisibility={setAIPanelVisibility}
          setProbePanelCollapsedPersistent={setProbePanelCollapsedPersistent}
          startDrag={startDrag}
          shouldIgnoreResizerClick={shouldIgnoreResizerClick}
          t={t}
        />

        {/* 左侧主区域：标签、终端子标签、会话内容 */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <WorkspaceSubTabBar
            activeSession={activeSession}
            activeSessionId={activeSessionId}
            isActiveSessionConnected={isActiveSessionConnected}
            contentTab={contentTab}
            fileManagerPosition={fileManagerPosition}
            isSessionWorkspaceVisible={isSessionWorkspaceVisible}
            activeSessionRootTerminals={activeSessionRootTerminals}
            activeTerminalId={activeTerminalId}
            terminalSubTabScrollRef={terminalSubTabScrollRef}
            terminalSubTabScrollStyle={terminalSubTabScrollStyle}
            handleTerminalSubTabWheel={handleTerminalSubTabWheel}
            handleTerminalSubTabMouseDown={handleTerminalSubTabMouseDown}
            handleTerminalSubTabScroll={handleTerminalSubTabScroll}
            handleTerminalSubTabClickCapture={handleTerminalSubTabClickCapture}
            handleTerminalSubTabDockMouseDown={handleTerminalSubTabDockMouseDown}
            setTabContextMenu={setTabContextMenu}
            setTerminalTabContextMenu={setTerminalTabContextMenu}
            shouldIgnoreTerminalDockClick={shouldIgnoreTerminalDockClick}
            onSelectTerminalTab={selectTerminalTab}
            closeTerminal={closeTerminal}
            closeTerminalGroup={closeTerminalGroup}
            openNewTerminal={openNewTerminal}
            terminalSubTabActionsRef={terminalSubTabActionsRef}
            terminalSubTabOverflow={terminalSubTabOverflow}
            fileManagerDockPreview={fileManagerDockPreview}
            fileManagerDockTabAnchorRef={fileManagerDockTabAnchorRef}
            fileManagerDockConfirmTarget={fileManagerDockConfirmTarget}
            terminalToolbarIconOnly={terminalToolbarIconOnly}
            startDrag={startDrag}
            shouldIgnoreResizerClick={shouldIgnoreResizerClick}
            setContentTab={setContentTab}
            isCreatingTerminal={isCreatingTerminal}
            t={t}
          />

          {/* Session Content */}
          <div className="flex-1 flex overflow-hidden relative">
            <div id="session-editor-container" className="flex-1 flex flex-row h-full relative overflow-hidden">
              <div id="editor-main-content" className="flex-1 relative overflow-hidden order-1">
                {sessions.map((s) => (
                  <WorkspaceSessionContent
                    key={s.id}
                    session={s}
                    activeSessionId={activeSessionId}
                    mountedSessions={mountedSessions}
                    contentTab={contentTab}
                    fileManagerPosition={fileManagerPosition}
                    fileManagerCollapsed={fileManagerCollapsed}
                    setFileManagerCollapsedPersistent={setFileManagerCollapsedPersistent}
                    collapseDragIntent={collapseDragIntent}
                    leftSplitWidth={leftSplitWidth}
                    bottomSplitHeight={bottomSplitHeight}
                    renderSessionFileManagers={renderSessionFileManagers}
                    showQuickCommands={showQuickCommands}
                    setShowQuickCommands={setShowQuickCommands}
                    quickCmdsRef={quickCmdsRef}
                    startDrag={startDrag}
                    shouldIgnoreResizerClick={shouldIgnoreResizerClick}
                    connectingServers={connectingServers}
                    sessionAuthPrompts={sessionAuthPrompts}
                    handleCancelConnection={handleCancelConnection}
                    resolvePasswordPrompt={resolvePasswordPrompt}
                    resolveHostKeyChoice={resolveHostKeyChoice}
                    addToast={addToast}
                    t={t}
                    activeTerminalId={activeTerminalId}
                    isSessionWorkspaceVisible={isSessionWorkspaceVisible}
                    getSessionWorkspaceTabs={getSessionWorkspaceTabs}
                    terminalPaneLayouts={terminalPaneLayouts}
                    getSessionRootPaneCells={getSessionRootPaneCells}
                    getSessionPanes={getSessionPanes}
                    getEffectiveTerminals={getEffectiveTerminals}
                    closeTerminalPane={closeTerminalPane}
                    connectedSessions={dashboard.connectedSessions || []}
                    handleQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                    restoringWorkspaceSessionIds={restoringWorkspaceSessionIds}
                  />
                ))}
                {terminalDockDragPreview && terminalDockDragPreview.zones && terminalDockDragPreview.zones.length > 0 && (
                  <>
                    <div
                      className="terminal-pane-dock-preview-layer"
                      aria-hidden="true"
                      style={{ position: 'fixed', zIndex: Z.PANEL_BUTTON + 7 }}
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
              <div id="editor-split-host" className="flex flex-col overflow-hidden order-2 w-0 [transition:width_0.2s_ease,height_0.2s_ease]" />
              <WorkspaceDiffModals ai={ai} sessions={sessions} />
            </div>
          </div>
        </div>

        <WorkspaceSidePanes
          position="right"
          aiPanelNode={aiPanelNode}
          probePanelNode={probePanelNode}
          probePanelPosition={probePanelPosition}
          probePanelCollapsed={probePanelCollapsed}
          probePanelWidth={probePanelWidth}
          showAIPanel={showAIPanel}
          isActiveSessionConnected={isActiveSessionConnected}
          collapseDragIntent={collapseDragIntent}
          setAIPanelVisibility={setAIPanelVisibility}
          setProbePanelCollapsedPersistent={setProbePanelCollapsedPersistent}
          startDrag={startDrag}
          shouldIgnoreResizerClick={shouldIgnoreResizerClick}
          t={t}
        />
      </div>
    </main>
  );
}
