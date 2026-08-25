import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js';
import { useTranslation } from '../../i18n.ts';
import {
  createEmptyHist,
  HISTORY_SIZE,
  normalizeProbeCardOrder,
  persistProbeCardOrder,
  PROBE_CARD_ORDER_CHANGED_EVENT,
  PROBE_FETCH_TIMEOUT_MS,
  PROBE_HIDE_IP_CHANGED_EVENT,
  readProbeCardOrder,
  readProbeHideIP,
  reorderProbeCard,
  translateProbeError,
  type DragHandleProps,
  type ProbeHist,
  type ProbeInfo,
  type ProbePanelProps,
} from './probeTypes.ts';

export function useProbePanel({
  sessionId,
  enabled,
  active,
  snapshot,
  onSnapshot,
  onEnable,
  onShowAllProcesses,
  onShowNetworkDetails,
}: ProbePanelProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ProbeInfo | null>(() => snapshot?.info || null);
  const [hist, setHist] = useState<ProbeHist>(() => snapshot?.hist || createEmptyHist());
  const histRef = useRef(hist);
  histRef.current = hist;

  const [showConfirm, setShowConfirm] = useState(false);
  const [hideIP, setHideIP] = useState(readProbeHideIP);
  const [cpuExpanded, setCpuExpanded] = useState(false);
  const [diskExpanded, setDiskExpanded] = useState(false);
  const [probeError, setProbeError] = useState(false);
  const [probeErrorDetail, setProbeErrorDetail] = useState('');
  const probeErrorCountRef = useRef(0);
  const staticInfoRef = useRef<{ os?: string; timezone?: string; cpuModel?: string; ip?: string } | null>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const activeSessionIdRef = useRef(sessionId);
  const onSnapshotRef = useRef(onSnapshot);
  const [cardOrder, setCardOrder] = useState<string[]>(readProbeCardOrder);
  const [dragReadyId, setDragReadyId] = useState<string | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: 'before' | 'after' } | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);

  useEffect(() => { activeSessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);

  useEffect(() => {
    const handleOrderChanged = (event: Event) => {
      setCardOrder(normalizeProbeCardOrder((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener(PROBE_CARD_ORDER_CHANGED_EVENT, handleOrderChanged);
    return () => window.removeEventListener(PROBE_CARD_ORDER_CHANGED_EVENT, handleOrderChanged);
  }, []);

  useEffect(() => {
    const handleHideIPChanged = (event: Event) => setHideIP(!!(event as CustomEvent<unknown>).detail);
    window.addEventListener(PROBE_HIDE_IP_CHANGED_EVENT, handleHideIPChanged);
    return () => window.removeEventListener(PROBE_HIDE_IP_CHANGED_EVENT, handleHideIPChanged);
  }, []);

  const clearCardDragGhost = useCallback(() => {
    if (dragGhostRef.current?.parentNode) {
      dragGhostRef.current.parentNode.removeChild(dragGhostRef.current);
    }
    dragGhostRef.current = null;
    document.body.classList.remove('probe-card-dragging-cursor');
  }, []);

  const resetCardDragState = useCallback(() => {
    setDragReadyId(null);
    setDraggingCardId(null);
    setDropIndicator(null);
    clearCardDragGhost();
  }, [clearCardDragGhost]);

  useEffect(() => clearCardDragGhost, [clearCardDragGhost]);

  useEffect(() => {
    if (!dragReadyId || draggingCardId) return;
    const handlePointerRelease = () => setDragReadyId(null);
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    return () => {
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
    };
  }, [dragReadyId, draggingCardId]);

  const handleCardHandlePointerDown = useCallback((cardId: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    setDragReadyId(cardId);
  }, []);

  const handleCardHandlePointerUp = useCallback((cardId: string) => {
    if (draggingCardId === cardId) return;
    if (dragReadyId === cardId) setDragReadyId(null);
  }, [dragReadyId, draggingCardId]);

  const handleCardDragStart = useCallback((cardId: string, event: React.DragEvent<HTMLElement>) => {
    if (dragReadyId !== cardId) {
      event.preventDefault();
      return;
    }
    setDraggingCardId(cardId);
    setDropIndicator(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', cardId);
    clearCardDragGhost();
    const sourceCard = event.currentTarget.closest('.probe-card-sortable');
    if (sourceCard) {
      const ghost = sourceCard.cloneNode(true) as HTMLElement;
      ghost.classList.add('probe-card-drag-ghost');
      ghost.style.width = `${sourceCard.getBoundingClientRect().width}px`;
      document.body.appendChild(ghost);
      dragGhostRef.current = ghost;
      event.dataTransfer.setDragImage(ghost, 28, 18);
    }
    document.body.classList.add('probe-card-dragging-cursor');
  }, [clearCardDragGhost, dragReadyId]);

  const handleCardDragEnd = useCallback(() => {
    resetCardDragState();
  }, [resetCardDragState]);

  const handleCardDragOver = useCallback((targetId: string, event: React.DragEvent<HTMLElement>) => {
    if (!draggingCardId || draggingCardId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropIndicator((prev) => (prev?.targetId === targetId && prev?.position === position ? prev : { targetId, position }));
  }, [draggingCardId]);

  const handleCardDrop = useCallback((targetId: string, event: React.DragEvent<HTMLElement>) => {
    if (!draggingCardId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = dropIndicator?.targetId === targetId
      ? dropIndicator.position
      : (event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    const nextOrder = reorderProbeCard(cardOrder, draggingCardId, targetId, position);
    if (nextOrder.join('|') !== cardOrder.join('|')) {
      setCardOrder(nextOrder);
      persistProbeCardOrder(nextOrder);
    }
    resetCardDragState();
  }, [cardOrder, draggingCardId, dropIndicator, resetCardDragState]);

  const getSectionDragHandleProps = useCallback((cardId: string): DragHandleProps => ({
    draggable: dragReadyId === cardId,
    dragReady: dragReadyId === cardId,
    dragging: draggingCardId === cardId,
    onPointerDown: (event) => handleCardHandlePointerDown(cardId, event),
    onPointerUp: () => handleCardHandlePointerUp(cardId),
    onPointerCancel: () => handleCardHandlePointerUp(cardId),
    onDragStart: (event) => handleCardDragStart(cardId, event),
    onDragEnd: handleCardDragEnd,
  }), [dragReadyId, draggingCardId, handleCardDragEnd, handleCardDragStart, handleCardHandlePointerDown, handleCardHandlePointerUp]);

  useEffect(() => {
    const nextHist = snapshot?.hist || createEmptyHist();
    setInfo(snapshot?.info || null);
    staticInfoRef.current = null;
    histRef.current = nextHist;
    setHist(nextHist);
    setCpuExpanded(false);
    setDiskExpanded(false);
    setProbeError(false);
    setProbeErrorDetail('');
    probeErrorCountRef.current = 0;
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !active || !sessionId) return;
    if (staticInfoRef.current) return;
    let mounted = true;
    (async () => {
      try {
        const data = await AppGo.GetServerStaticInfo(sessionId);
        if (!mounted || !activeRef.current || activeSessionIdRef.current !== sessionId) return;
        staticInfoRef.current = {
          os: data.os || 'Linux',
          timezone: data.timezone || 'UTC',
          cpuModel: data.cpu?.model || '',
          ip: data.ip || '',
        };
      } catch (_) {
        // staticInfo 失败下次面板切回来会重试
      }
    })();
    return () => { mounted = false; };
  }, [enabled, active, sessionId]);

  const handleShowAllProcesses = useCallback(() => {
    if (!sessionId || !onShowAllProcesses) return;
    onShowAllProcesses();
  }, [sessionId, onShowAllProcesses]);

  const handleShowNetworkDetails = useCallback(() => {
    if (!sessionId || !onShowNetworkDetails) return;
    onShowNetworkDetails();
  }, [sessionId, onShowNetworkDetails]);

  const fetchInfo = useCallback(async () => {
    if (!sessionId || !enabled || !activeRef.current) return;
    try {
      const data = await Promise.race([
        AppGo.SystemInfo(sessionId),
        new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error('PROBE_FETCH_TIMEOUT')),
          PROBE_FETCH_TIMEOUT_MS,
        )),
      ]);
      if (!activeRef.current || activeSessionIdRef.current !== sessionId) return;
      const si = staticInfoRef.current || { os: 'Linux', timezone: 'UTC', cpuModel: '' };
      const uptimeData = data.uptime || {};
      let uptimeStr = t('0 小时');
      if (uptimeData.days > 0) {
        uptimeStr = `${uptimeData.days}${t('天')} ${uptimeData.hours}${t('小时')}`;
      } else if (uptimeData.hours > 0) {
        uptimeStr = `${uptimeData.hours}${t('小时')} ${uptimeData.mins}${t('分')}`;
      } else {
        uptimeStr = `${uptimeData.mins || 0}${t('分钟')}`;
      }
      const ni: ProbeInfo = {
        ...si,
        uptime: uptimeStr,
        load1: data.load?.load1 || 0,
        load5: data.load?.load5 || 0,
        load15: data.load?.load15 || 0,
        cpuUsage: data.cpu?.usage || 0,
        cpuCores: data.cpu?.cores || [],
        memUsed: data.memory?.used || 0,
        memTotal: data.memory?.total || 0,
        memCache: data.memory?.cache || 0,
        memFree: data.memory?.free || 0,
        swapTotal: data.memory?.swapTotal || 0,
        swapUsed: data.memory?.swapUsed || 0,
        diskDevice: data.disk?.device || 'disk',
        diskTotal: data.disk?.total || 0,
        diskUsed: data.disk?.used || 0,
        diskPercent: data.disk?.usage || 0,
        diskReadSpeed: data.disk?.readSpeed || 0,
        diskWriteSpeed: data.disk?.writeSpeed || 0,
        diskPartitions: data.disk?.partitions || [],
        netUp: data.network?.uploadSpeed || 0,
        netDown: data.network?.downloadSpeed || 0,
        netUpTotal: data.network?.uploadTotal || 0,
        netDownTotal: data.network?.downloadTotal || 0,
        networkInterfaces: data.network?.interfaces || [],
        processes: data.processes || [],
      };
      const prevHist = histRef.current || createEmptyHist();
      const nextHist: ProbeHist = {
        cpu: [...prevHist.cpu, ni.cpuUsage || 0].slice(-HISTORY_SIZE),
        up: [...prevHist.up, ni.netUp || 0].slice(-HISTORY_SIZE),
        down: [...prevHist.down, ni.netDown || 0].slice(-HISTORY_SIZE),
      };
      histRef.current = nextHist;
      setInfo(ni);
      setHist(nextHist);
      onSnapshotRef.current?.({ info: ni, hist: nextHist });
      probeErrorCountRef.current = 0;
      setProbeError(false);
      setProbeErrorDetail('');
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err || '');
      const errorMessage = translateProbeError(rawMessage);
      probeErrorCountRef.current += 1;
      if (probeErrorCountRef.current >= 3) {
        setProbeError(true);
        setProbeErrorDetail(errorMessage);
      }
    }
  }, [sessionId, enabled, t]);

  const probeTimerRef = useRef<number | null>(null);

  const getProbeInterval = () => {
    const v = parseInt(localStorage.getItem('probeInterval') || '3', 10);
    return v >= 1 ? v : 5;
  };

  useEffect(() => {
    if (!enabled || !active) return;
    let stopped = false;
    const scheduleNext = () => {
      if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
      probeTimerRef.current = setTimeout(async () => {
        await fetchInfo();
        if (!stopped && activeRef.current) scheduleNext();
      }, getProbeInterval() * 1000);
    };
    fetchInfo();
    scheduleNext();
    const onIntervalChange = () => {
      if (!stopped && activeRef.current) scheduleNext();
    };
    window.addEventListener('probeIntervalChanged', onIntervalChange);
    return () => {
      stopped = true;
      if (probeTimerRef.current) {
        clearTimeout(probeTimerRef.current);
        probeTimerRef.current = null;
      }
      window.removeEventListener('probeIntervalChanged', onIntervalChange);
    };
  }, [fetchInfo, enabled, active]);

  const handleConfirm = () => {
    setShowConfirm(false);
    setProbeError(false);
    setProbeErrorDetail('');
    probeErrorCountRef.current = 0;
    onEnable();
  };

  const handlePanelDragOver = (event: React.DragEvent) => {
    if (!draggingCardId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handlePanelDrop = (event: React.DragEvent) => {
    if (!draggingCardId || !dropIndicator) {
      resetCardDragState();
      return;
    }
    event.preventDefault();
    const nextOrder = reorderProbeCard(cardOrder, draggingCardId, dropIndicator.targetId, dropIndicator.position);
    if (nextOrder.join('|') !== cardOrder.join('|')) {
      setCardOrder(nextOrder);
      persistProbeCardOrder(nextOrder);
    }
    resetCardDragState();
  };

  return {
    t,
    info,
    hist,
    showConfirm,
    setShowConfirm,
    hideIP,
    cpuExpanded,
    setCpuExpanded,
    diskExpanded,
    setDiskExpanded,
    probeError,
    setProbeError,
    probeErrorDetail,
    setProbeErrorDetail,
    probeErrorCountRef,
    cardOrder,
    draggingCardId,
    dropIndicator,
    handleConfirm,
    handleShowAllProcesses,
    handleShowNetworkDetails,
    getSectionDragHandleProps,
    handleCardDragOver,
    handleCardDrop,
    handlePanelDragOver,
    handlePanelDrop,
  };
}
