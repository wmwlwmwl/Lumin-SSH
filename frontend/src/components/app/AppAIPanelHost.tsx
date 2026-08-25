import { ChevronLeft, ChevronRight } from 'lucide-react';
import type React from 'react';
import AIPanel from '../AIPanel.tsx';
import {
  buildAIWorkspaceTabPanelKey,
  buildAIWorkspaceTerminalPanelKey,
  resolveAIWorkspaceTerminalBindingByTerminalId,
  type SessionLike,
  type WorkspaceContentTab,
} from '../../utils/sessionWorkspace.ts';

export interface AppAIPanelHostProps {
  sessions: SessionLike[];
  activeSessionId: string | null;
  activeTerminalId: string | null;
  aiPanelWidth: number;
  showAIPanel: boolean;
  isActiveSessionConnected: boolean;
  collapseDragIntent: unknown;
  probePanelPosition: 'left' | 'right';
  getEffectiveTerminals: (s: SessionLike) => Array<{ id: string; label?: string }>;
  addToast: (message: string | Error, type?: string, duration?: number) => number;
  setAIPanelDevilModes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setActiveAIWorkspaceTabs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sessionsRef: React.MutableRefObject<SessionLike[]>;
  markWorkspaceRestoreNavigationOverride: () => void;
  setAIPanelVisibility: (visible: boolean) => void;
  setActiveSessionId: (id: string | null) => void;
  setActiveTerminalId: (id: string | null) => void;
  setContentTab: (tab: WorkspaceContentTab) => void;
}

export default function AppAIPanelHost({
  sessions,
  activeSessionId,
  activeTerminalId,
  aiPanelWidth,
  showAIPanel,
  isActiveSessionConnected,
  collapseDragIntent,
  probePanelPosition,
  getEffectiveTerminals,
  addToast,
  setAIPanelDevilModes,
  setActiveAIWorkspaceTabs,
  sessionsRef,
  markWorkspaceRestoreNavigationOverride,
  setAIPanelVisibility,
  setActiveSessionId,
  setActiveTerminalId,
  setContentTab,
}: AppAIPanelHostProps) {
  const aiKeepAliveSessions = sessions.filter((s) => (
    s.status === 'connected'
    || s.status === 'connecting'
    || s.status === 'closed'
    || s.status === 'error'
  ));

  if (aiKeepAliveSessions.length === 0) return null;

  return (
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
                sessionId={String(s.id ?? '')}
                terminalId={t.id}
                isPanelVisible={isPanelActive}
                sessionTerminals={getEffectiveTerminals(s)}
                addToast={addToast}
                onDevilModeChange={(enabled: boolean, tabId = '') => {
                  const panelKey = buildAIWorkspaceTabPanelKey(s.id || '', t.id, tabId);
                  if (!panelKey) return;
                  setAIPanelDevilModes((prev) => (
                    prev[panelKey] === enabled
                      ? prev
                      : { ...prev, [panelKey]: enabled }
                  ));
                }}
                onActiveTabChange={(tabId: string) => {
                  const panelKey = buildAIWorkspaceTerminalPanelKey(s.id || '', t.id);
                  if (!panelKey) return;
                  setActiveAIWorkspaceTabs((prev) => (
                    prev[panelKey] === tabId
                      ? prev
                      : { ...prev, [panelKey]: tabId }
                  ));
                }}
                onActivateWorkspaceTab={(targetTerminalId: string, tabId: string) => {
                  const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, targetTerminalId);
                  if (!binding) return;
                  markWorkspaceRestoreNavigationOverride();
                  setAIPanelVisibility(true);
                  setActiveSessionId(binding.sessionId);
                  setActiveTerminalId(binding.terminalId);
                  setContentTab('terminal');
                  const targetPanelKey = buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId);
                  if (targetPanelKey) {
                    setActiveAIWorkspaceTabs((prev) => (
                      prev[targetPanelKey] === tabId
                        ? prev
                        : { ...prev, [targetPanelKey]: tabId }
                    ));
                  }
                }}
              />
            </div>
          );
        })
      ))}
    </div>
  );
}
