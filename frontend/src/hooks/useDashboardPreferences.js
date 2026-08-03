import { useCallback, useState } from 'react';

const RECENT_CONNECTIONS_KEY = 'recentConnectionIds';
const RECENT_CONNECTIONS_MAX = 30;

function readRecentConnectionIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_CONNECTIONS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

export default function useDashboardPreferences() {
  const [searchQuery, setSearchQuery] = useState('');
  const [serverListViewMode, setServerListViewModeState] = useState(() => localStorage.getItem('serverListViewMode') || 'grid');
  const [hideSensitive, setHideSensitiveState] = useState(() => localStorage.getItem('hideSensitive') === 'true');
  const [dashboardHostPageMode, setDashboardHostPageModeState] = useState(
    () => (localStorage.getItem('dashboardHostPageMode') === 'recent' ? 'recent' : 'hosts'),
  );
  const [recentConnectionIds, setRecentConnectionIds] = useState(readRecentConnectionIds);

  const setServerListViewMode = useCallback((mode) => {
    const next = mode === 'table' ? 'table' : 'grid';
    setServerListViewModeState(next);
    localStorage.setItem('serverListViewMode', next);
  }, []);

  const setHideSensitive = useCallback((value) => {
    setHideSensitiveState(value);
    localStorage.setItem('hideSensitive', value ? 'true' : 'false');
  }, []);

  const setDashboardHostPageMode = useCallback((mode) => {
    const next = mode === 'recent' ? 'recent' : 'hosts';
    setDashboardHostPageModeState(next);
    localStorage.setItem('dashboardHostPageMode', next);
  }, []);

  const recordRecentConnection = useCallback((serverId) => {
    if (!serverId) return;
    setRecentConnectionIds((prev) => {
      const next = [serverId, ...prev.filter((id) => id !== serverId)].slice(0, RECENT_CONNECTIONS_MAX);
      localStorage.setItem(RECENT_CONNECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearRecentConnections = useCallback(() => {
    setRecentConnectionIds([]);
    localStorage.removeItem(RECENT_CONNECTIONS_KEY);
  }, []);

  const removeRecentConnection = useCallback((serverId) => {
    if (!serverId) return;
    setRecentConnectionIds((prev) => {
      const next = prev.filter((id) => id !== serverId);
      localStorage.setItem(RECENT_CONNECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeRecentConnections = useCallback((serverIds) => {
    const idSet = new Set(Array.isArray(serverIds) ? serverIds : []);
    if (idSet.size === 0) return;
    setRecentConnectionIds((prev) => {
      const next = prev.filter((id) => !idSet.has(id));
      localStorage.setItem(RECENT_CONNECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    serverListViewMode,
    setServerListViewMode,
    hideSensitive,
    setHideSensitive,
    dashboardHostPageMode,
    setDashboardHostPageMode,
    recentConnectionIds,
    recordRecentConnection,
    clearRecentConnections,
    removeRecentConnection,
    removeRecentConnections,
  };
}
