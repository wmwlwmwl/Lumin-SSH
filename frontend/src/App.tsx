import { useEffect } from 'react';
import { initializeGlobalAppearance } from './utils/globalAppearance.ts';
import AppTopbar from './components/AppTopbar.tsx';
import AppOverlays from './components/AppOverlays.tsx';
import AppMCPFloatingOverlay from './components/app/AppMCPFloatingOverlay.tsx';
import AppWorkspaceView from './components/app/AppWorkspaceView.tsx';
import useAppOrchestrator from './hooks/useAppOrchestrator.ts';

export default function App() {
  useEffect(() => initializeGlobalAppearance(), []);
  const orchestrator = useAppOrchestrator();

  return (
    <div className="app-layout">
      <AppTopbar {...orchestrator.topbarProps} />
      <AppWorkspaceView orchestrator={orchestrator} />
      <AppOverlays {...orchestrator.overlaysProps} />
      <AppMCPFloatingOverlay {...orchestrator.mcpProps} />
    </div>
  );
}
