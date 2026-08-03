import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cpu, Folder, Globe, Monitor, Plus, RefreshCw, ScrollText, X } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import AIChangeReviewWorkbench from './ai/AIChangeReviewWorkbench.jsx';
import AIConversationDiffOverlay from './ai/AIConversationDiffOverlay.jsx';
import CommandHistory from './CommandHistory.jsx';
import ConnectingCard from './ConnectingCard.jsx';
import Dashboard from './Dashboard.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import NetworkPage from './NetworkPage.jsx';
import ProcessPage from './ProcessPage.jsx';
import QuickCommands from './QuickCommands.jsx';
import SessionAuthCard from './SessionAuthCard.jsx';
import Terminal from './Terminal.jsx';
import Tiptop from './Tiptop.jsx';
import { TERMINAL_PANE_CELL_IDS, getTerminalPaneAbsolutePlacement } from '../utils/terminalPaneLayout.js';
import { getTerminalTabDoubleClickAction, isUnsupportedMonitorSession } from '../utils/sessionWorkspace.js';
import { Z } from '../constants/zIndex.js';

const FILE_MANAGER_LEFT_MIN = 180;
const FILE_MANAGER_BOTTOM_MIN = 100;

export default function SessionWorkspace({ dashboard = {}, session = {}, fileManager = {}, terminalTabs = {}, ai = {}, quickCommands = {}, shared = {} }) {
  const props = { ...dashboard, ...session, ...fileManager, ...terminalTabs, ...ai, ...quickCommands, ...shared };
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
    handleDetectedRemotePort,
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
    portListeningEnabled,
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
    scrollTerminalSubTabs,
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
    terminalSubTabCanScrollLeft,
    terminalSubTabCanScrollRight,
    terminalSubTabOverflow,
    terminalSubTabScrollRef,
    terminalSubTabScrollStyle,
    terminalToolbarIconOnly,
    toggleBatchSelection
  } = props;
  return (
      <main className="main-area">
        <div style={{ display: activeSessionId === null ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%' }}>
          <Dashboard
            editorServer={serverEditor}
            editorShiningFields={editFlyShiningFields}
            saveFlowHighlights={saveFlowHighlights}
            isEditFlying={!!editFlyAnimation}
            onSaveServer={handleSaveServer}
            onSaveAndConnectServer={handleSaveAndConnectServer}
            onCancelEditor={() => setServerEditor(null)}
            allGroups={allGroups}
            credentials={credentials}
            searchQuery={searchQuery}
            onSearchChange={e => setSearchQuery(e.target.value)}
            hideSensitive={hideSensitive}
            onHideSensitiveToggle={() => setHideSensitive(!hideSensitive)}
            serverListViewMode={serverListViewMode}
            onViewModeChange={setServerListViewMode}
            servers={servers}
            pingEnabled={pingEnabled}
            pingCounts={pingCounts}
            isRefreshingPing={isRefreshingPing}
            onRefreshPing={handleRefreshPing}
            filteredServers={filteredServers}
            pings={pings}
            sessions={sessions}
            activeSessionId={activeSessionId}
            recentConnectionIds={recentConnectionIds}
            hostPageMode={dashboardHostPageMode}
            onHostPageModeChange={setDashboardHostPageMode}
            onClearRecentConnections={clearRecentConnections}
            onRemoveRecentConnection={removeRecentConnection}
            onConnect={connectServer}
            onStartAdd={startAddGuideAnimation}
            onEdit={startEditFlyAnimation}
            onClone={async (s, payload) => {
              try {
                const real = await AppGo.GetConnectionByID(s.id);
                startEditFlyAnimation({ ...real, id: null }, payload);
              } catch {
                startEditFlyAnimation({ ...s, id: null, name: s.name || s.host }, payload);
              }
            }}
            onDelete={handleDeleteServer}
            onMoveGroup={handleMoveGroup}
            addToast={addToast}
            onOpenCredentials={() => setShowCredentials(true)}
            onOpenImportExport={handleOpenImportExport}
            selectionMode={batchSelectionMode}
            selectedIds={selectedServerIds}
            onSelectChange={toggleBatchSelection}
            onBatchDelete={handleBatchDelete}
            onBatchConnect={handleBatchConnect}
            onBatchMoveGroup={handleBatchMoveGroup}
            onGroupDelete={handleGroupDelete}
            onRenameGroup={handleRenameGroup}
            onBatchExport={handleBatchExport}
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
              {showAIPanel ? (
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
              )}
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
                {terminalSubTabOverflow && (
                  <button
                    type="button"
                    className={`terminal-sub-tab-nav terminal-sub-tab-nav-left${terminalSubTabCanScrollLeft ? '' : ' disabled'}`}
                    onClick={() => scrollTerminalSubTabs(-1)}
                    aria-label={t('向左滚动标签')}
                    title={t('向左滚动标签')}
                    disabled={!terminalSubTabCanScrollLeft}
                  >
                    <ChevronLeft size={14} />
                  </button>
                )}
                <div
                  ref={terminalSubTabScrollRef}
                  className="terminal-sub-tab-scroll"
                  style={terminalSubTabScrollStyle}
                  onWheel={handleTerminalSubTabWheel}
                  onMouseDown={handleTerminalSubTabMouseDown}
                  onScroll={handleTerminalSubTabScroll}
                  onClickCapture={handleTerminalSubTabClickCapture}
                >
                  {activeSessionRootTerminals.map((term) => {
                    const canPreviewDock = term.type === 'terminal' && activeSessionRootTerminals.length > 1;
                    return (
                      <Tiptop key={term.id} text={term.label} placement="bottom">
                        <div
                          className={`terminal-sub-tab ${activeTerminalId === term.id ? 'active' : ''}`}
                          data-terminal-id={term.id}
                          onMouseDown={canPreviewDock ? (e) => handleTerminalSubTabDockMouseDown(e, activeSession, term) : undefined}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setTabContextMenu(null);
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTerminalTabContextMenu({
                              sessionId: activeSession.id,
                              terminalId: term.id,
                              type: term.type,
                              terminalIds: term.terminalIds,
                              label: term.label,
                              x: rect.left,
                              y: rect.bottom + 4,
                            });
                          }}
                          onClick={() => {
                            if (shouldIgnoreTerminalDockClick()) return;
                            markWorkspaceRestoreNavigationOverride();
                            setTerminalTabContextMenu(null);
                            setActiveTerminalId(term.id);
                            setContentTab('terminal');
                            rememberSessionActiveTerminal(activeSession.id, term.id, term.label);
                            persistWorkspaceSnapshotRef.current({
                              activeSessionId: activeSession.id,
                              activeTerminalId: term.id,
                            });
                          }}
                          onDoubleClick={(e) => {
                            if (term.type !== 'terminal') return;
                            if (shouldIgnoreTerminalDockClick()) return;
                            const doubleClickAction = getTerminalTabDoubleClickAction();
                            if (!doubleClickAction) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (doubleClickAction === 'close') {
                              closeTerminal(activeSession.id, term.id, e);
                              return;
                            }
                            void openNewTerminal(activeSession.id, {
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
                                  closeTerminalGroup(activeSession.id, term.id, term.terminalIds, e);
                                  return;
                                }
                                closeTerminal(activeSession.id, term.id, e);
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
                {terminalSubTabOverflow && (
                  <button
                    type="button"
                    className={`terminal-sub-tab-nav terminal-sub-tab-nav-right${terminalSubTabCanScrollRight ? '' : ' disabled'}`}
                    onClick={() => scrollTerminalSubTabs(1)}
                    aria-label={t('向右滚动标签')}
                    title={t('向右滚动标签')}
                    disabled={!terminalSubTabCanScrollRight}
                  >
                    <ChevronRight size={14} />
                  </button>
                )}
                <div className="terminal-sub-tab-actions" ref={terminalSubTabActionsRef}>
                  {fileManagerPosition !== 'tab' && (fileManagerDockPreview === 'left' || fileManagerDockPreview === 'right' || fileManagerDockPreview === 'bottom') && (
                    <div ref={fileManagerDockTabAnchorRef} className="file-manager-tab-dock-placeholder" aria-hidden="true">
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
                  <Tiptop text={terminalToolbarIconOnly ? t('新建终端') : null} placement="bottom">
                    <button
                      className={`btn btn-ghost btn-sm terminal-create-btn ${isCreatingTerminal ? 'is-creating' : ''}`}
                      onClick={() => openNewTerminal(activeSession.id)}
                      style={{ marginLeft: 2, flexShrink: 0 }}
                      disabled={isCreatingTerminal}
                      aria-busy={isCreatingTerminal}
                    >
                      {isCreatingTerminal ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                      {!terminalToolbarIconOnly && t('新建终端')}
                    </button>
                  </Tiptop>
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
                      && mountedSessions.has(s.id)
                      && !s.isSerial;
                    const showSplitFileManager = shouldMountFileManager
                      && contentTab !== 'process'
                      && contentTab !== 'network'
                      && fileManagerPosition !== 'tab';
                    const showTabFileManager = shouldMountFileManager
                      && fileManagerPosition === 'tab'
                      && contentTab === 'files';
                    const sessionConnectingServer = connectingServers.find((item) => item.sessionId === s.id) || null;
                    const sessionAuthPrompt = sessionAuthPrompts[s.id] || null;
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
                              sessionId={activeTerminalId || s.id}
                              addToast={addToast}
                              connectedSessions={connectedSessions}
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
                            {mountedSessions.has(s.id) && (
                              isSessionWorkspaceVisible(s) ? (() => {
                                const isTerminalViewActive = activeSessionId === s.id && (contentTab === 'terminal' || s.status !== 'connected');
                                const workspaceTabs = getSessionWorkspaceTabs(s);
                                const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeTerminalId);
                                const activeLayout = activeWorkspaceTab?.type === 'group' ? terminalPaneLayouts[activeWorkspaceTab.id] : null;
                                const activeLayoutId = activeLayout?.sessionId === s.id ? activeWorkspaceTab.id : null;
                                const terminalPlacements = new Map();
                                if (activeLayoutId) {
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
                                            onClick={(e) => closeTerminalPane(placement.layoutId, placement.paneId, e)}
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
                                            sessionId={term.id}
                                            serverId={s.id}
                                            historyServerId={s.serverId}
                                            status={s.status}
                                            isActive={isTermVisible}
                                            serverName={s.serverName}
                                            connectedSessions={connectedSessions}
                                            showCommands={showQuickCommands && isTermVisible}
                                            onQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                                            quickCmdsRef={quickCmdsRef}
                                            onDetectedRemotePort={handleDetectedRemotePort}
                                            portListeningEnabled={portListeningEnabled}
                                            wsRebuildKey={s.wsRebuildKey || 0}
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
                                        sessionId={t.id}
                                        serverId={s.id}
                                        historyServerId={s.serverId}
                                        status={s.status}
                                        isActive={activeSessionId === s.id && activeTerminalId === t.id && (contentTab === 'terminal' || fileManagerPosition !== 'tab')}
                                        serverName={s.serverName}
                                        connectedSessions={connectedSessions}
                                        showCommands={showQuickCommands && activeSessionId === s.id && activeTerminalId === t.id}
                                        onQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                                        quickCmdsRef={quickCmdsRef}
                                        onDetectedRemotePort={handleDetectedRemotePort}
                                        portListeningEnabled={portListeningEnabled}
                                        wsRebuildKey={s.wsRebuildKey || 0}
                                      />
                                    </ErrorBoundary>
                                  </div>
                                );
                              }))
                            )}
                            {restoringWorkspaceSessionIds.has(s.id) && (
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
                          {s.status === 'connected' && mountedSessions.has(s.id) && (
                            <div style={{ display: contentTab === 'history' ? 'block' : 'none', height: '100%', flex: 1 }}>
                              <CommandHistory
                                sessionId={s.id}
                                historyServerId={s.serverId}
                                addToast={addToast}
                              />
                            </div>
                          )}
                          {s.status === 'connected' && mountedSessions.has(s.id) && !s.isSerial && !isUnsupportedMonitorSession(s) && (
                            <div style={{ display: contentTab === 'process' ? 'flex' : 'none', height: '100%', flex: 1, minWidth: 0, minHeight: 0 }}>
                              <ProcessPage
                                sessionId={s.id}
                                addToast={addToast}
                                active={contentTab === 'process' && activeSessionId === s.id}
                              />
                            </div>
                          )}
                          {s.status === 'connected' && mountedSessions.has(s.id) && !s.isSerial && !isUnsupportedMonitorSession(s) && (
                            <div style={{ display: contentTab === 'network' ? 'flex' : 'none', height: '100%', flex: 1, minWidth: 0, minHeight: 0 }}>
                              <NetworkPage
                                sessionId={s.id}
                                active={contentTab === 'network' && activeSessionId === s.id}
                              />
                            </div>
                          )}
                          {/* 有待确认交互时让位给 SessionAuthCard，二者 z-index 相同不可重叠 */}
                          {sessionConnectingServer && s.status === 'connecting' && !sessionAuthPrompt && (
                            <ConnectingCard
                              connectingServer={sessionConnectingServer}
                              t={t}
                              onCancel={() => handleCancelConnection(s.id)}
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
                                  void resolvePasswordPrompt(s.id, sessionAuthPrompt.connId, result);
                                } else {
                                  void resolveHostKeyChoice(s.id, result);
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {terminalDockDragPreview && terminalDockDragPreview.zones.length > 0 && (
                    <>
                      <div
                        className="terminal-pane-dock-preview-layer"
                        aria-hidden="true"
                        style={{ position: 'fixed', inset: 0, zIndex: Z.PANEL_BUTTON + 7 }}
                      >
                        {terminalDockDragPreview.zones.map((zone) => (
                          <div
                            key={zone.target}
                            className={`terminal-pane-dock-preview-slot${terminalDockDragPreview.activeTarget === zone.target ? ' active' : ''}${terminalDockDragPreview.zoneStates?.[zone.target]?.occupied ? ' occupied' : ''}${terminalDockDragPreview.zoneStates?.[zone.target]?.enabled === false ? ' disabled' : ''}`}
                            style={zone.style}
                          >
                            <span className="terminal-pane-dock-preview-label">{zone.label}</span>
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
                    const rect = container.getBoundingClientRect();
                    const startX = e.clientX;
                    const startW = host.getBoundingClientRect().width;
                    const splitPos = host.style.order === '0' ? 'left' : 'right';
                    const onMove = (ev) => {
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
                  <AIChangeReviewWorkbench
                    review={activeChangeReview}
                    queueLength={activeChangeReviewQueue.length}
                  />
                ) : null}
                {activeRestorePreviewReview?.review ? (
                  <AIChangeReviewWorkbench
                    review={activeRestorePreviewReview.review}
                    queueLength={1}
                    previewOnly={true}
                    onClose={() => {
                      if (!activeWorkspaceTerminalKey) {
                        return;
                      }
                      setRestorePreviewReviews((prev) => {
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
                {activeConversationDiffPanel ? (
                  <AIConversationDiffOverlay
                    sessionLabel={
                      sessions.find((item) => item.id === activeConversationDiffPanel.sessionId)?.serverName
                      || sessions.find((item) => item.id === activeConversationDiffPanel.sessionId)?.host
                      || activeConversationDiffPanel.sessionId
                    }
                    items={activeConversationDiffPanel.items || []}
                    reviewByArtifactPath={activeConversationDiffPanel.reviewByArtifactPath || {}}
                    loadingByArtifactPath={activeConversationDiffPanel.loadingByArtifactPath || {}}
                    selectedMessageId={activeConversationDiffPanel.selectedMessageId || ''}
                    onSelectItem={(item) => void handleSelectConversationDiffItem(item, {
                      sessionId: activeConversationDiffPanel.sessionId,
                      terminalId: activeConversationDiffPanel.terminalId,
                      locate: true,
                    })}
                    onPreviewRestore={(artifactPath) => handleReapplyConversationDiffItem(artifactPath, activeConversationDiffPanel.sessionId, activeConversationDiffPanel.terminalId)}
                    onApplyRestore={(artifactPath) => handleApplyConversationDiffRestore(artifactPath, activeConversationDiffPanel.sessionId, activeConversationDiffPanel.terminalId)}
                    onClose={() => {
                      if (!activeWorkspaceTerminalKey) {
                        return;
                      }
                      setConversationDiffPanels((prev) => {
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
              {showAIPanel ? (
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
              )}
              {aiPanelNode}
            </>
          )}
        </div>
      </main>
  );
}
