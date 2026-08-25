import { useMemo, type Dispatch, type SetStateAction } from 'react';
import ProbePanel, { type ProbeSnapshot } from '../ProbePanel.tsx';
import { isUnsupportedMonitorSession, type SessionLike, type WorkspaceContentTab } from '../../utils/sessionWorkspace.ts';

export interface AppProbePanelHostProps {
  sessions: SessionLike[];
  activeSessionId: string | null;
  monitoringEnabled: Record<string, boolean>;
  probeSnapshots: Record<string, ProbeSnapshot>;
  probePanelCollapsed: boolean;
  setProbeSnapshots: Dispatch<SetStateAction<Record<string, ProbeSnapshot>>>;
  setMonitoringEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
  setContentTab: Dispatch<SetStateAction<WorkspaceContentTab>>;
  openPortForwardDialog: (sessionId: string, initialMapping?: unknown, initialTab?: string) => void;
  addToast: (message: string | Error, type?: string, duration?: number) => number;
}

export default function AppProbePanelHost({
  sessions,
  activeSessionId,
  monitoringEnabled,
  probeSnapshots,
  probePanelCollapsed,
  setProbeSnapshots,
  setMonitoringEnabled,
  setContentTab,
  openPortForwardDialog,
  addToast,
}: AppProbePanelHostProps) {
  const probeSessions = useMemo(() => sessions.filter((s) => !s.isSerial && !isUnsupportedMonitorSession(s) && (
    s.status === 'connected' || (s.status === 'closed' && monitoringEnabled[s.id || ''])
  )), [monitoringEnabled, sessions]);

  const shouldShowProbePanel = probeSessions.some((s) => s.id === activeSessionId);
  if (!shouldShowProbePanel) return null;

  return (
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
              sessionId={s.id || ''}
              host={String(s.host || '')}
              addToast={addToast}
              enabled={!!monitoringEnabled[s.id || '']}
              active={isPanelActive && s.status === 'connected'}
              snapshot={probeSnapshots[s.id || '']}
              onSnapshot={(snapshot: ProbeSnapshot) => setProbeSnapshots(prev => ({ ...prev, [s.id || '']: snapshot }))}
              onEnable={() => setMonitoringEnabled(prev => ({ ...prev, [s.id || '']: true }))}
              onShowAllProcesses={() => setContentTab('process')}
              onShowNetworkDetails={() => setContentTab('network')}
              onOpenPortForward={() => openPortForwardDialog(s.id || '', null, 'new')}
            />
          </div>
        );
      })}
    </div>
  );
}
