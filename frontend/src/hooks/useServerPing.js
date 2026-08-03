import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';

const DEFAULT_PING_INTERVAL = 2;
const OFFLINE_FAIL_THRESHOLD = 2;

function readPingInterval() {
  const value = Number.parseInt(localStorage.getItem('pingInterval') || String(DEFAULT_PING_INTERVAL), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PING_INTERVAL;
}

export default function useServerPing({ serversRef, activeSessionId, dashboardHostPageMode }) {
  const [pings, setPings] = useState({});
  const [isRefreshingPing, setIsRefreshingPing] = useState(false);
  const [pingInterval, setPingInterval] = useState(readPingInterval);
  const [pingEnabled, setPingEnabled] = useState(() => localStorage.getItem('pingEnabled') !== 'false');
  const [pingMode, setPingMode] = useState(() => localStorage.getItem('pingMode') || 'auto');
  const pingTimerRef = useRef(null);
  const pingInFlightRef = useRef(false);
  const pingModeRef = useRef(pingMode);
  const pingFailCountRef = useRef({});
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    pingModeRef.current = pingMode;
  }, [pingMode]);

  useEffect(() => {
    const handler = () => setPingInterval(readPingInterval());
    window.addEventListener('pingIntervalChanged', handler);
    return () => window.removeEventListener('pingIntervalChanged', handler);
  }, []);

  useEffect(() => {
    const handler = () => setPingEnabled(localStorage.getItem('pingEnabled') !== 'false');
    window.addEventListener('pingEnabledChanged', handler);
    return () => window.removeEventListener('pingEnabledChanged', handler);
  }, []);

  useEffect(() => {
    const handler = () => setPingMode(localStorage.getItem('pingMode') || 'auto');
    window.addEventListener('pingModeChanged', handler);
    return () => window.removeEventListener('pingModeChanged', handler);
  }, []);

  const pingAll = useCallback(async () => {
    if (pingInFlightRef.current) return;
    const list = Array.isArray(serversRef.current) ? serversRef.current : [];
    if (list.length === 0) return;
    pingInFlightRef.current = true;
    try {
      const results = await Promise.all(
        list.map(async (server) => {
          try {
            const result = await AppGo.PingServer(server.id, pingModeRef.current);
            return { id: server.id, ...result };
          } catch {
            return { id: server.id, online: false, latency: null };
          }
        }),
      );
      const failCounts = pingFailCountRef.current;
      setPings((prev) => {
        const next = {};
        results.forEach((result) => {
          if (result.online) {
            delete failCounts[result.id];
            next[result.id] = { online: true, latency: result.latency };
            return;
          }
          failCounts[result.id] = (failCounts[result.id] || 0) + 1;
          next[result.id] = failCounts[result.id] >= OFFLINE_FAIL_THRESHOLD
            ? { online: false, latency: prev[result.id]?.latency ?? null }
            : (prev[result.id] ? { ...prev[result.id] } : { online: false, latency: null });
        });
        return next;
      });
    } finally {
      pingInFlightRef.current = false;
    }
  }, [serversRef]);

  useEffect(() => {
    if (activeSessionId !== null || dashboardHostPageMode !== 'hosts') return undefined;
    if (!pingEnabled) {
      setPings({});
      pingFailCountRef.current = {};
      return undefined;
    }
    void pingAll();
    pingTimerRef.current = window.setInterval(pingAll, pingInterval * 1000);
    return () => {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    };
  }, [activeSessionId, dashboardHostPageMode, pingAll, pingEnabled, pingInterval]);

  const handleRefreshPing = useCallback(async () => {
    if (!pingEnabled || isRefreshingPing) return;
    setIsRefreshingPing(true);
    await pingAll();
    refreshTimerRef.current = window.setTimeout(() => setIsRefreshingPing(false), 800);
  }, [isRefreshingPing, pingAll, pingEnabled]);

  useEffect(() => () => {
    window.clearInterval(pingTimerRef.current);
    window.clearTimeout(refreshTimerRef.current);
  }, []);

  const pingCounts = useMemo(() => {
    const values = Object.values(pings);
    return {
      online: values.filter((value) => value.online).length,
      offline: values.filter((value) => !value.online).length,
      total: values.length,
    };
  }, [pings]);

  return {
    pings,
    pingEnabled,
    pingInterval,
    pingMode,
    isRefreshingPing,
    pingCounts,
    pingAll,
    handleRefreshPing,
  };
}
