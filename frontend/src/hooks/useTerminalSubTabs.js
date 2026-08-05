import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function withAlpha(color, alpha, fallback) {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) { const hex = trimmed.slice(1); const rgb = [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).join(', '); return `rgba(${rgb}, ${alpha})`; }
  return trimmed || fallback;
}

export default function useTerminalSubTabs(deps) {
  const { TERMINAL_DOCK_LONG_PRESS_MS, activeSessionId, activeSessionRootTerminals, activeTerminalId, canMoveTerminalToDockTarget, clearTerminalDockLongPressTimer, contentTab, fileManagerDockPreview, getFileManagerDockConfirmRect, getSessionRootTerminals, getTerminalDockPreviewTarget, getTerminalDockPreviewZones, getTerminalDockTargetStates, handleTerminalPaneDrop, setTerminalDockDragPreview, setTerminalSubTabOverflow, terminalDockClickSuppressUntilRef, terminalDockLongPressTimerRef, terminalDockPointerCleanupRef, terminalSubTabDragSuppressUntilRef, terminalSubTabDraggingRef, terminalSubTabScrollBySessionRef, terminalSubTabScrollFrameRef, terminalSubTabScrollRef, terminalSubTabScrollTargetRef, terminalSubTabTheme } = deps;
  const terminalSubTabScrollStyle = useMemo(() => ({
    '--terminal-list-scrollbar-thumb': withAlpha(terminalSubTabTheme?.xterm?.cursor, 0.32, 'rgba(var(--accent-rgb), 0.32)'),
    '--terminal-list-scrollbar-thumb-hover': withAlpha(terminalSubTabTheme?.xterm?.blue || terminalSubTabTheme?.xterm?.cursor, 0.58, 'rgba(var(--accent-rgb), 0.58)'),
  }), [terminalSubTabTheme]);
  const rememberTerminalSubTabScroll = useCallback((sessionId, left) => {
    if (!sessionId) return;
    const next = Number.isFinite(left) ? Math.max(0, left) : 0;
    terminalSubTabScrollBySessionRef.current[sessionId] = next;
  }, []);
  const restoreTerminalSubTabScroll = useCallback((sessionId, immediate = true) => {
    const el = terminalSubTabScrollRef.current;
    if (!el || !sessionId) return;
    const saved = terminalSubTabScrollBySessionRef.current[sessionId];
    if (typeof saved !== 'number') return; // 无记忆：留给 scrollActive 定位当前标签
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const nextLeft = Math.max(0, Math.min(maxLeft, saved));
    terminalSubTabScrollTargetRef.current = nextLeft;
    if (immediate) {
      el.scrollLeft = nextLeft;
    }
  }, []);
  // 把指定终端子标签滚进可视区（工作区恢复选中了 7 但滚动还在 1 时用）
  const scrollTerminalSubTabIntoView = useCallback((terminalId, sessionId) => {
    const el = terminalSubTabScrollRef.current;
    if (!el || !terminalId) return;
    const tabEl = el.querySelector(`[data-terminal-id="${CSS.escape(String(terminalId))}"]`);
    if (!tabEl) return;
    const elRect = el.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();
    const pad = 6;
    let delta = 0;
    if (tabRect.left < elRect.left + pad) {
      delta = tabRect.left - elRect.left - pad;
    } else if (tabRect.right > elRect.right - pad) {
      delta = tabRect.right - elRect.right + pad;
    } else {
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const nextLeft = Math.max(0, Math.min(maxLeft, el.scrollLeft + delta));
    terminalSubTabScrollTargetRef.current = nextLeft;
    el.scrollLeft = nextLeft;
    if (sessionId) {
      rememberTerminalSubTabScroll(sessionId, nextLeft);
    }
  }, [rememberTerminalSubTabScroll]);
  const syncTerminalSubTabOverflowState = useCallback(() => {
    const el = terminalSubTabScrollRef.current;
    if (!el) {
      setTerminalSubTabOverflow(false);
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const currentLeft = el.scrollLeft;
    const hasOverflow = maxLeft > 1;
    setTerminalSubTabOverflow(hasOverflow);
    if (activeSessionId) {
      rememberTerminalSubTabScroll(activeSessionId, hasOverflow ? currentLeft : 0);
    }
    if (!hasOverflow) {
      terminalSubTabScrollTargetRef.current = 0;
    }
  }, [activeSessionId, rememberTerminalSubTabScroll]);
  const stopTerminalSubTabScrollAnimation = useCallback(() => {
    if (!terminalSubTabScrollFrameRef.current) {
      return;
    }
    cancelAnimationFrame(terminalSubTabScrollFrameRef.current);
    terminalSubTabScrollFrameRef.current = 0;
  }, []);
  const stepTerminalSubTabScroll = useCallback(() => {
    const el = terminalSubTabScrollRef.current;
    if (!el) {
      terminalSubTabScrollFrameRef.current = 0;
      return;
    }
    const currentLeft = el.scrollLeft;
    const targetLeft = terminalSubTabScrollTargetRef.current;
    const deltaLeft = targetLeft - currentLeft;
    if (Math.abs(deltaLeft) < 0.5) {
      el.scrollLeft = targetLeft;
      terminalSubTabScrollFrameRef.current = 0;
      syncTerminalSubTabOverflowState();
      return;
    }
    const easing = terminalSubTabDraggingRef.current ? 0.3 : 0.16;
    const nextStep = Math.abs(deltaLeft) < 12
      ? Math.sign(deltaLeft) * Math.max(0.8, Math.abs(deltaLeft) * 0.45)
      : deltaLeft * easing;
    el.scrollLeft = currentLeft + nextStep;
    terminalSubTabScrollFrameRef.current = requestAnimationFrame(stepTerminalSubTabScroll);
  }, [syncTerminalSubTabOverflowState]);
  const setTerminalSubTabScrollTarget = useCallback((nextLeft, immediate = false) => {
    const el = terminalSubTabScrollRef.current;
    if (!el) {
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const clampedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    terminalSubTabScrollTargetRef.current = clampedLeft;
    if (activeSessionId) {
      rememberTerminalSubTabScroll(activeSessionId, clampedLeft);
    }
    if (immediate) {
      stopTerminalSubTabScrollAnimation();
      el.scrollLeft = clampedLeft;
      syncTerminalSubTabOverflowState();
      return;
    }
    if (!terminalSubTabScrollFrameRef.current) {
      terminalSubTabScrollFrameRef.current = requestAnimationFrame(stepTerminalSubTabScroll);
    }
  }, [activeSessionId, rememberTerminalSubTabScroll, stepTerminalSubTabScroll, stopTerminalSubTabScrollAnimation, syncTerminalSubTabOverflowState]);
  useEffect(() => () => stopTerminalSubTabScrollAnimation(), [stopTerminalSubTabScrollAnimation]);
  // 切换会话 / 恢复工作区 / 选中标签变化：先恢复记忆位置，再保证当前选中标签可见
  useEffect(() => {
    if (!activeSessionId) return undefined;
    stopTerminalSubTabScrollAnimation();
    const frame = requestAnimationFrame(() => {
      restoreTerminalSubTabScroll(activeSessionId, true);
      if (activeTerminalId) {
        scrollTerminalSubTabIntoView(activeTerminalId, activeSessionId);
      }
      syncTerminalSubTabOverflowState();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSessionId, activeTerminalId, activeSessionRootTerminals, contentTab, restoreTerminalSubTabScroll, scrollTerminalSubTabIntoView, stopTerminalSubTabScrollAnimation, syncTerminalSubTabOverflowState]);
  useEffect(() => {
    const el = terminalSubTabScrollRef.current;
    if (!el) return undefined;
    const handleResize = () => {
      if (activeSessionId) {
        restoreTerminalSubTabScroll(activeSessionId, true);
      }
      if (activeSessionId && activeTerminalId) {
        scrollTerminalSubTabIntoView(activeTerminalId, activeSessionId);
      }
      syncTerminalSubTabOverflowState();
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(handleResize) : null;
    observer?.observe(el);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [activeSessionId, activeTerminalId, activeSessionRootTerminals, contentTab, restoreTerminalSubTabScroll, scrollTerminalSubTabIntoView, syncTerminalSubTabOverflowState]);
  const handleTerminalSubTabScroll = useCallback((e) => {
    const left = e.currentTarget.scrollLeft;
    if (!terminalSubTabScrollFrameRef.current) {
      terminalSubTabScrollTargetRef.current = left;
    }
    if (activeSessionId) {
      rememberTerminalSubTabScroll(activeSessionId, left);
    }
    syncTerminalSubTabOverflowState();
  }, [activeSessionId, rememberTerminalSubTabScroll, syncTerminalSubTabOverflowState]);
  const handleTerminalSubTabWheel = useCallback((e) => {
    const el = terminalSubTabScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) {
      return;
    }
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) {
      return;
    }
    const baseLeft = terminalSubTabScrollFrameRef.current ? terminalSubTabScrollTargetRef.current : el.scrollLeft;
    setTerminalSubTabScrollTarget(baseLeft + delta);
    e.preventDefault();
  }, [setTerminalSubTabScrollTarget]);
  const handleTerminalSubTabMouseDown = useCallback((e) => {
    if (e.button !== 0) {
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.terminal-sub-tab-close')) {
      return;
    }
    const el = terminalSubTabScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) {
      return;
    }
    stopTerminalSubTabScrollAnimation();
    terminalSubTabScrollTargetRef.current = el.scrollLeft;
    terminalSubTabDraggingRef.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const startScrollLeft = el.scrollLeft;
    let dragging = false;
    const cleanup = () => {
      terminalSubTabDraggingRef.current = false;
      el.classList.remove('is-dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!dragging && Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) {
        return;
      }
      if (!dragging) {
        dragging = true;
        terminalSubTabDraggingRef.current = true;
        el.classList.add('is-dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      setTerminalSubTabScrollTarget(startScrollLeft - deltaX);
    };
    const handleMouseUp = () => {
      if (dragging) {
        terminalSubTabDragSuppressUntilRef.current = Date.now() + 160;
      }
      cleanup();
    };
    e.preventDefault();
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [setTerminalSubTabScrollTarget, stopTerminalSubTabScrollAnimation]);
  const handleTerminalSubTabClickCapture = useCallback((e) => {
    if (Date.now() < terminalSubTabDragSuppressUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);
  const handleTerminalSubTabDockMouseDown = useCallback((e, session, term) => {
    if (e.button !== 0) {
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.terminal-sub-tab-close')) {
      return;
    }
    const rootTerminals = getSessionRootTerminals(session);
    const hasMovableTarget = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
      .some((dockTarget) => canMoveTerminalToDockTarget(session, term.id, dockTarget));
    if (rootTerminals.length === 0 || !hasMovableTarget) {
      return;
    }

    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    let previewActive = false;
    const createZoneStates = (zones) => getTerminalDockTargetStates(session, term.id, zones);
    const resolveDockTarget = (clientX, clientY, zones = getTerminalDockPreviewZones()) => {
      const hoveredTarget = getTerminalDockPreviewTarget(clientX, clientY, zones);
      return hoveredTarget && canMoveTerminalToDockTarget(session, term.id, hoveredTarget) ? hoveredTarget : null;
    };

    const cleanup = () => {
      clearTerminalDockLongPressTimer();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      terminalDockPointerCleanupRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const closePreview = () => {
      const hadPreview = previewActive;
      previewActive = false;
      cleanup();
      setTerminalDockDragPreview(null);
      if (hadPreview) {
        terminalDockClickSuppressUntilRef.current = Date.now() + 180;
      }
    };

    const handleMouseMove = (moveEvent) => {
      if (!previewActive) {
        if (Math.abs(moveEvent.clientX - startX) > 6 || Math.abs(moveEvent.clientY - startY) > 6) {
          clearTerminalDockLongPressTimer();
        }
        return;
      }
      setTerminalDockDragPreview((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          pointer: { x: moveEvent.clientX, y: moveEvent.clientY },
          activeTarget: resolveDockTarget(moveEvent.clientX, moveEvent.clientY, prev.zones),
        };
      });
    };

    const handleMouseUp = (upEvent) => {
      const finalTarget = previewActive
        ? resolveDockTarget(upEvent.clientX, upEvent.clientY)
        : null;
      if (finalTarget) {
        handleTerminalPaneDrop(session, term.id, finalTarget);
      }
      closePreview();
    };

    const handleWindowBlur = () => {
      closePreview();
    };

    terminalDockPointerCleanupRef.current?.();
    terminalDockPointerCleanupRef.current = cleanup;
    clearTerminalDockLongPressTimer();
    terminalDockLongPressTimerRef.current = setTimeout(() => {
      const zones = getTerminalDockPreviewZones();
      if (zones.length === 0) {
        closePreview();
        return;
      }
      previewActive = true;
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      setTerminalDockDragPreview({
        sessionId: session.id,
        terminalId: term.id,
        label: term.label,
        pointer: { x: startX, y: startY },
        activeTarget: resolveDockTarget(startX, startY, zones),
        zoneStates: createZoneStates(zones),
        zones,
      });
    }, TERMINAL_DOCK_LONG_PRESS_MS);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleWindowBlur);
  }, [canMoveTerminalToDockTarget, clearTerminalDockLongPressTimer, getSessionRootTerminals, getTerminalDockPreviewTarget, getTerminalDockPreviewZones, getTerminalDockTargetStates, handleTerminalPaneDrop]);
  useEffect(() => () => {
    clearTerminalDockLongPressTimer();
    terminalDockPointerCleanupRef.current?.();
  }, [clearTerminalDockLongPressTimer]);
  const fileManagerDockDropzones = useMemo(() => {
    const dockTargets = fileManagerDockPreview === 'tab'
      ? ['left', 'right', 'bottom']
      : fileManagerDockPreview === 'left'
        ? ['right', 'bottom', 'tab']
        : fileManagerDockPreview === 'right'
          ? ['left', 'bottom', 'tab']
          : fileManagerDockPreview === 'bottom'
            ? ['left', 'right', 'tab']
            : [];
    return dockTargets.map((target) => {
      const rect = getFileManagerDockConfirmRect(target);
      if (!rect) {
        return null;
      }
      return {
        target,
        style: {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.right - rect.left}px`,
          height: `${rect.bottom - rect.top}px`,
        },
      };
    }).filter(Boolean);
  }, [fileManagerDockPreview, getFileManagerDockConfirmRect]);

  return { terminalSubTabScrollStyle, handleTerminalSubTabScroll, handleTerminalSubTabWheel, handleTerminalSubTabMouseDown, handleTerminalSubTabClickCapture, handleTerminalSubTabDockMouseDown, fileManagerDockDropzones };
}
