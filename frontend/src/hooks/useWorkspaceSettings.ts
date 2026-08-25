import { useEffect, useState } from 'react';

type WorkspacePersistenceLevel = 'program' | 'session';

export interface UseWorkspaceSettingsResult {
  rememberWorkspace: boolean;
  setRememberWorkspace: React.Dispatch<React.SetStateAction<boolean>>;
  workspacePersistenceLevel: WorkspacePersistenceLevel;
  setWorkspacePersistenceLevel: React.Dispatch<React.SetStateAction<WorkspacePersistenceLevel>>;
  rememberWorkspaceLoaded: boolean;
  setRememberWorkspaceLoaded: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function useWorkspaceSettings(): UseWorkspaceSettingsResult {
  const [rememberWorkspace, setRememberWorkspace] = useState(false);
  const [workspacePersistenceLevel, setWorkspacePersistenceLevel] = useState<WorkspacePersistenceLevel>('program');
  const [rememberWorkspaceLoaded, setRememberWorkspaceLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(window?.go?.wailsapp?.App?.GetRememberWorkspace?.())
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
    Promise.resolve(window?.go?.wailsapp?.App?.GetWorkspacePersistenceLevel?.())
      .then((level) => {
        if (!cancelled) setWorkspacePersistenceLevel(level === 'session' ? 'session' : 'program');
      })
      .catch(() => {
        if (!cancelled) setWorkspacePersistenceLevel('program');
      });
    const rememberHandler = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === 'boolean') {
        setRememberWorkspace(detail);
        setRememberWorkspaceLoaded(true);
      }
    };
    const levelHandler = (event: Event) => {
      setWorkspacePersistenceLevel((event as CustomEvent<string>).detail === 'session' ? 'session' : 'program');
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
