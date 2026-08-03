import { useCallback, useState } from 'react';

export default function usePortForwardDialog() {
  const [showPortForwardDialog, setShowPortForwardDialog] = useState(false);
  const [portForwardDialogSessionId, setPortForwardDialogSessionId] = useState(null);
  const [portForwardInitialMapping, setPortForwardInitialMapping] = useState(null);
  const [portForwardInitialTab, setPortForwardInitialTab] = useState(null);
  const [portListeningEnabled, setPortListeningEnabled] = useState(
    () => localStorage.getItem('portForwardRealtimeListening') === 'true',
  );

  const handlePortListeningEnabledChange = useCallback((enabled) => {
    setPortListeningEnabled(enabled);
    localStorage.setItem('portForwardRealtimeListening', enabled ? 'true' : 'false');
  }, []);

  const openPortForwardDialog = useCallback((sessionId, port = null, initialTab = null) => {
    setPortForwardDialogSessionId(sessionId);
    setPortForwardInitialMapping(port == null ? null : {
      kind: 'local',
      localHost: '127.0.0.1',
      localPort: String(port),
      remoteHost: '127.0.0.1',
      remotePort: String(port),
    });
    setPortForwardInitialTab(initialTab);
    setShowPortForwardDialog(true);
  }, []);

  const closePortForwardDialog = useCallback(() => setShowPortForwardDialog(false), []);

  return {
    showPortForwardDialog,
    portForwardDialogSessionId,
    portForwardInitialMapping,
    portForwardInitialTab,
    portListeningEnabled,
    handlePortListeningEnabledChange,
    openPortForwardDialog,
    closePortForwardDialog,
  };
}
