import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import type React from 'react';
import CommandHistory from '../CommandHistory.tsx';
import ConnectingCard from '../ConnectingCard.tsx';
import NetworkPage from '../NetworkPage.tsx';
import ProcessPage from '../ProcessPage.tsx';
import QuickCommands, { type QuickCommandsHandle } from '../QuickCommands.tsx';
import SessionAuthCard from '../SessionAuthCard.tsx';
import WorkspaceTerminalGrid from './WorkspaceTerminalGrid.tsx';
import { Z } from '../../constants/zIndex.ts';
import { isUnsupportedMonitorSession, type SessionLike } from '../../utils/sessionWorkspace.ts';
import type { ConnectingServer, SessionAuthPrompt } from '../../hooks/useSessionConnections.ts';
import type { PanelResizeDirection } from '../../hooks/useWorkspacePanelDocking.ts';
import type { TerminalPaneLayout, TerminalPaneCellId } from '../../utils/terminalPaneLayout.ts';

const FILE_MANAGER_LEFT_MIN = 180;
const FILE_MANAGER_BOTTOM_MIN = 100;

export interface WorkspaceSessionContentProps {
  session: SessionLike;
  activeSessionId: string | null;
  mountedSessions: Set<string>;
  contentTab: string;
  fileManagerPosition: string;
  fileManagerCollapsed: boolean;
  setFileManagerCollapsedPersistent: (next: boolean) => void;
  collapseDragIntent: unknown;
  leftSplitWidth: number;
  bottomSplitHeight: number;
  renderSessionFileManagers: (session: SessionLike) => React.ReactNode;
  showQuickCommands: boolean;
  setShowQuickCommands: (v: boolean) => void;
  quickCmdsRef: React.RefObject<QuickCommandsHandle | null>;
  startDrag: (event: React.MouseEvent<HTMLElement> | MouseEvent, direction: PanelResizeDirection) => void;
  shouldIgnoreResizerClick: () => boolean;
  connectingServers: ConnectingServer[];
  sessionAuthPrompts: Record<string, SessionAuthPrompt>;
  handleCancelConnection: (sessionId: string) => void;
  resolvePasswordPrompt: (sessionId: string, connId: string, result: { value: string; persist: boolean } | null) => Promise<void>;
  resolveHostKeyChoice: (sessionId: string, chosen: number) => Promise<void>;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  t: (key: string, vars?: Record<string, unknown>) => string;
  // Terminal Grid props
  activeTerminalId: string | null;
  isSessionWorkspaceVisible: (session: SessionLike | null | undefined) => boolean;
  getSessionWorkspaceTabs: (session: SessionLike, layouts?: Record<string, TerminalPaneLayout>) => Array<{ id: string; type?: string; label?: string; terminalIds?: string[] }>;
  terminalPaneLayouts: Record<string, TerminalPaneLayout>;
  getSessionRootPaneCells: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneCellId[];
  getSessionPanes: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneLayout['panes'];
  getEffectiveTerminals: (session: SessionLike) => Array<{ id: string; label?: string }>;
  closeTerminalPane: (layoutId: string, paneId: string, e?: React.MouseEvent) => void;
  connectedSessions: SessionLike[];
  handleQuickCommandsOpenChange: (open: boolean) => void;
  restoringWorkspaceSessionIds: Set<string>;
}

export default function WorkspaceSessionContent({
  session: s,
  activeSessionId,
  mountedSessions,
  contentTab,
  fileManagerPosition,
  fileManagerCollapsed,
  setFileManagerCollapsedPersistent,
  collapseDragIntent,
  leftSplitWidth,
  bottomSplitHeight,
  renderSessionFileManagers,
  showQuickCommands,
  setShowQuickCommands,
  quickCmdsRef,
  startDrag,
  shouldIgnoreResizerClick,
  connectingServers,
  sessionAuthPrompts,
  handleCancelConnection,
  resolvePasswordPrompt,
  resolveHostKeyChoice,
  addToast,
  t,
  activeTerminalId,
  isSessionWorkspaceVisible,
  getSessionWorkspaceTabs,
  terminalPaneLayouts,
  getSessionRootPaneCells,
  getSessionPanes,
  getEffectiveTerminals,
  closeTerminalPane,
  connectedSessions,
  handleQuickCommandsOpenChange,
  restoringWorkspaceSessionIds,
}: WorkspaceSessionContentProps) {
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
      className="absolute inset-0 flex-col"
      style={{ display: activeSessionId === s.id ? 'flex' : 'none' }}
    >
      {showLeftCollapseStrip && (
        <button
          type="button"
          className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag absolute left-0 inset-y-0"
          onClick={() => setFileManagerCollapsedPersistent(false)}
          aria-label={t('展开文件管理面板')}
          style={{ zIndex: Z.PANEL_BUTTON + 1 }}
        >
          <ChevronRight size={14} />
        </button>
      )}
      {showRightCollapseStrip && (
        <button
          type="button"
          className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag absolute right-0 inset-y-0"
          onClick={() => setFileManagerCollapsedPersistent(false)}
          aria-label={t('展开文件管理面板')}
          style={{ zIndex: Z.PANEL_BUTTON + 1 }}
        >
          <ChevronLeft size={14} />
        </button>
      )}
      {showBottomCollapseStrip && (
        <button
          type="button"
          className="panel-collapse-strip panel-collapse-strip-horizontal panel-collapse-strip-bottom no-drag absolute inset-x-0 bottom-0"
          onClick={() => setFileManagerCollapsedPersistent(false)}
          aria-label={t('展开文件管理面板')}
          style={{ zIndex: Z.CONTENT }}
        >
          <ChevronUp size={12} />
        </button>
      )}
      {shouldMountFileManager && (
        <div
          className="absolute flex-col overflow-hidden bg-canvas"
          style={{
            display: showFileManagerPanel ? 'flex' : 'none',
            zIndex: Z.CONTENT,
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
          className="absolute bottom-0 flex flex-col overflow-visible bg-canvas border-t border-line min-h-[100px]"
          style={{
            left: showLeftFileManager ? `${leftSplitWidth}px` : 0,
            right: showRightFileManager ? `${leftSplitWidth}px` : 0,
            height: `${bottomSplitHeight}px`,
            zIndex: Z.PANEL_BUTTON + 4,
          }}
        >
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
              zIndex: Z.SCROLLBAR,
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
            bottom: showBottomQuickCommands ? `${bottomSplitHeight}px` : 0,
            zIndex: Z.PANEL_BUTTON + 5,
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
          }}
        />
      )}
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
          }}
        />
      )}
      <div
        id="terminal-dock-preview-host"
        className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
        style={{
          marginLeft: showLeftFileManager ? `${leftSplitWidth}px` : (showLeftCollapseStrip ? 12 : 0),
          marginRight: showRightFileManager ? `${leftSplitWidth}px` : (showRightCollapseStrip ? 12 : 0),
          marginBottom: showBottomDockPanel
            ? `${bottomSplitHeight}px`
            : (showBottomCollapseStrip ? 12 : 0),
        }}
      >
        {mountedSessions.has(s.id || '') && (
          <WorkspaceTerminalGrid
            session={s}
            activeSessionId={activeSessionId}
            contentTab={contentTab}
            activeTerminalId={activeTerminalId}
            fileManagerPosition={fileManagerPosition}
            showQuickCommands={showQuickCommands}
            isSessionWorkspaceVisible={isSessionWorkspaceVisible}
            getSessionWorkspaceTabs={getSessionWorkspaceTabs}
            terminalPaneLayouts={terminalPaneLayouts}
            getSessionRootPaneCells={getSessionRootPaneCells}
            getSessionPanes={getSessionPanes}
            getEffectiveTerminals={getEffectiveTerminals}
            closeTerminalPane={closeTerminalPane}
            connectedSessions={connectedSessions}
            handleQuickCommandsOpenChange={handleQuickCommandsOpenChange}
            quickCmdsRef={quickCmdsRef}
            restoringWorkspaceSessionIds={restoringWorkspaceSessionIds}
            t={t}
          />
        )}
        {s.status === 'connected' && mountedSessions.has(s.id || '') && (
          <div className="h-full flex-1" style={{ display: contentTab === 'history' ? 'block' : 'none' }}>
            <CommandHistory
              sessionId={s.id || ''}
              historyServerId={s.serverId ? String(s.serverId) : ''}
              terminalId={activeTerminalId || s.id || ''}
              addToast={addToast}
            />
          </div>
        )}
        {s.status === 'connected' && mountedSessions.has(s.id || '') && !s.isSerial && !isUnsupportedMonitorSession(s) && (
          <div className="h-full flex-1 min-w-0 min-h-0" style={{ display: contentTab === 'process' ? 'flex' : 'none' }}>
            <ProcessPage
              sessionId={s.id || ''}
              addToast={addToast}
              active={contentTab === 'process' && activeSessionId === s.id}
            />
          </div>
        )}
        {s.status === 'connected' && mountedSessions.has(s.id || '') && !s.isSerial && !isUnsupportedMonitorSession(s) && (
          <div className="h-full flex-1 min-w-0 min-h-0" style={{ display: contentTab === 'network' ? 'flex' : 'none' }}>
            <NetworkPage
              sessionId={s.id || ''}
              active={contentTab === 'network' && activeSessionId === s.id}
            />
          </div>
        )}
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
}
