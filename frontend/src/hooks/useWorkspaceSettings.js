import { useCallback, useEffect, useState } from 'react';

export default function useWorkspaceSettings() {
  const [rememberWorkspace, setRememberWorkspace] = useState(false);
  const [workspacePersistenceLevel, setWorkspacePersistenceLevel] = useState('program');
  const [rememberWorkspaceLoaded, setRememberWorkspaceLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(window?.go?.main?.App?.GetRememberWorkspace?.())
      .then((enabled) => {
        if (!cancelled) {
          setRememberWorkspace(!!enabled);
          setRememberWorkspaceLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRememberWorkspace(false);
          setRememberWorkspaceLoaded(true);
        }
      });
    Promise.resolve(window?.go?.main?.App?.GetWorkspacePersistenceLevel?.())
      .then((level) => {
        if (!cancelled) setWorkspacePersistenceLevel(level === 'session' ? 'session' : 'program');
      })
      .catch(() => {
        if (!cancelled) setWorkspacePersistenceLevel('program');
      });
    const rememberHandler = (event) => {
      if (typeof event?.detail === 'boolean') {
        setRememberWorkspace(event.detail);
        setRememberWorkspaceLoaded(true);
      }
    };
    const levelHandler = (event) => {
      setWorkspacePersistenceLevel(event?.detail === 'session' ? 'session' : 'program');
    };
    window.addEventListener('workspace-remember-changed', rememberHandler);
    window.addEventListener('workspace-persistence-level-changed', levelHandler);
    return () => {
      cancelled = true;
      window.removeEventListener('workspace-remember-changed', rememberHandler);
      window.removeEventListener('workspace-persistence-level-changed', levelHandler);
    };
  }, []);

  return {
    rememberWorkspace,
    setRememberWorkspace,
    workspacePersistenceLevel,
    setWorkspacePersistenceLevel,
    rememberWorkspaceLoaded,
    setRememberWorkspaceLoaded,
  };
}
