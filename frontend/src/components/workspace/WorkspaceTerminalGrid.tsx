import { Monitor, RefreshCw, X } from 'lucide-react';
import type React from 'react';
import ErrorBoundary from '../ErrorBoundary.tsx';
import Terminal from '../Terminal.tsx';
import { Button } from '../ui';
import { TERMINAL_PANE_CELL_IDS, getTerminalPaneAbsolutePlacement, type TerminalPaneLayout, type TerminalPaneCellId } from '../../utils/terminalPaneLayout.ts';
import { Z } from '../../constants/zIndex.ts';
import type { SessionLike } from '../../utils/sessionWorkspace.ts';
import type { QuickCommandsHandle } from '../QuickCommands.tsx';

export interface WorkspaceTerminalGridProps {
  session: SessionLike;
  activeSessionId: string | null;
  contentTab: string;
  activeTerminalId: string | null;
  fileManagerPosition: string;
  showQuickCommands: boolean;
  isSessionWorkspaceVisible: (session: SessionLike | null | undefined) => boolean;
  getSessionWorkspaceTabs: (session: SessionLike, layouts?: Record<string, TerminalPaneLayout>) => Array<{ id: string; type?: string; label?: string; terminalIds?: string[] }>;
  terminalPaneLayouts: Record<string, TerminalPaneLayout>;
  getSessionRootPaneCells: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneCellId[];
  getSessionPanes: (layoutId: string, layouts?: Record<string, TerminalPaneLayout>) => TerminalPaneLayout['panes'];
  getEffectiveTerminals: (session: SessionLike) => Array<{ id: string; label?: string }>;
  closeTerminalPane: (layoutId: string, paneId: string, e?: React.MouseEvent) => void;
  connectedSessions: SessionLike[];
  handleQuickCommandsOpenChange: (open: boolean) => void;
  quickCmdsRef: React.RefObject<QuickCommandsHandle | null>;
  restoringWorkspaceSessionIds: Set<string>;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function WorkspaceTerminalGrid({
  session: s,
  activeSessionId,
  contentTab,
  activeTerminalId,
  fileManagerPosition,
  showQuickCommands,
  isSessionWorkspaceVisible,
  getSessionWorkspaceTabs,
  terminalPaneLayouts,
  getSessionRootPaneCells,
  getSessionPanes,
  getEffectiveTerminals,
  closeTerminalPane,
  connectedSessions,
  handleQuickCommandsOpenChange,
  quickCmdsRef,
  restoringWorkspaceSessionIds,
  t,
}: WorkspaceTerminalGridProps) {
  return (
    <div className="relative flex-col flex-1 min-h-0 h-full" style={{ display: (contentTab === 'terminal' || s.status !== 'connected') ? 'flex' : 'none' }}>
      {isSessionWorkspaceVisible(s) ? (() => {
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
              className="absolute flex flex-col min-w-0 min-h-0 overflow-hidden rounded-none bg-canvas"
              style={{
                ...getTerminalPaneAbsolutePlacement(placement?.cells || TERMINAL_PANE_CELL_IDS),
                visibility: isTermVisible ? 'visible' : 'hidden',
                pointerEvents: isTermVisible ? 'auto' : 'none',
                contain: isTermVisible ? 'none' : 'strict',
                border: isGrouped ? '1px solid var(--border)' : 'none',
              }}
            >
              {placement?.showHeader && (
                <div className="flex items-center gap-2 min-h-8 px-2.5 border-b border-line-subtle bg-raised text-secondary text-sm font-semibold shrink-0">
                  <Monitor size={12} />
                  <span className="flex-1 min-w-0 truncate">
                    {term.label}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="no-drag px-1.5 py-0"
                    onClick={(e) => closeTerminalPane(placement.layoutId || '', placement.paneId || '', e)}
                    aria-label={t('关闭分屏')}
                  >
                    <X size={12} />
                  </Button>
                </div>
              )}
              <div style={{ flex: 1, minHeight: 0 }}>
                <ErrorBoundary label={t('终端 {id} 渲染出错', { id: term.id })}>
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
      })() : (getEffectiveTerminals(s).map((term) => {
        const isTermActive = (contentTab === 'terminal' || s.status !== 'connected') && activeTerminalId === term.id;
        return (
          <div key={term.id} className="absolute inset-0 flex flex-col" style={{
            visibility: isTermActive ? 'visible' : 'hidden',
            pointerEvents: isTermActive ? 'auto' : 'none',
            contain: isTermActive ? 'none' : 'strict',
          }}>
            <ErrorBoundary label={t('终端 {id} 渲染出错', { id: term.id })}>
              <Terminal
                sessionId={term.id || ''}
                serverId={String(s.id ?? '')}
                historyServerId={String(s.serverId ?? '')}
                status={String(s.status ?? '')}
                isActive={activeSessionId === s.id && activeTerminalId === term.id && (contentTab === 'terminal' || fileManagerPosition !== 'tab')}
                serverName={String(s.serverName ?? '')}
                connectedSessions={connectedSessions}
                showCommands={showQuickCommands && activeSessionId === s.id && activeTerminalId === term.id}
                onQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                quickCmdsRef={quickCmdsRef}
                wsRebuildKey={(s.wsRebuildKey as number) || 0}
              />
            </ErrorBoundary>
          </div>
        );
      }))}
      {restoringWorkspaceSessionIds.has(s.id || '') && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2.5 bg-canvas text-secondary text-base pointer-events-none"
          style={{ zIndex: Z.COMPONENT_OVERLAY }}
        >
          <RefreshCw size={16} className="spin" />
          <span>{t('正在恢复终端工作区…')}</span>
        </div>
      )}
    </div>
  );
}
