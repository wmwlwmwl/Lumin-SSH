import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { EventsOn } from '../../wailsjs/runtime/runtime.js';
import { getAIGlobalSettings } from '../components/ai/aiGlobalSettingsBridge.ts';
import { runThemeChangeWithTransition, themeTransitionDirectionFor } from '../utils/themeTransition.ts';
import { formatAIQuotedSelection, type SessionLike, type WorkspaceContentTab } from '../utils/sessionWorkspace.ts';
import type { TerminalPaneLayout } from '../utils/terminalPaneLayout.ts';

export interface UseAppGlobalEventsOptions {
  activeAIDevilMode: boolean;
  activeSessionIdRef: RefObject<string | null>;
  activeTerminalIdRef: RefObject<string | null>;
  lastTerminalRef: RefObject<Record<string, string>>;
  sessionsRef: RefObject<SessionLike[]>;
  terminalPaneLayoutsRef: RefObject<Record<string, TerminalPaneLayout>>;
  markWorkspaceRestoreNavigationOverride: () => void;
  resolveSessionRootTerminalId: (session: SessionLike, preferredId: string | null | undefined, layoutSource?: Record<string, TerminalPaneLayout>, preferredLabel?: string) => string | null;
  setAIPanelVisibility: (visible: boolean) => void;
  setActiveSessionId: (id: string | null) => void;
  setActiveTerminalId: (id: string | null) => void;
  setContentTab: (tab: WorkspaceContentTab) => void;
  addToast: (message: string | Error, type?: string, duration?: number) => number;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function useAppGlobalEvents({
  activeAIDevilMode,
  activeSessionIdRef,
  activeTerminalIdRef,
  lastTerminalRef,
  sessionsRef,
  terminalPaneLayoutsRef,
  markWorkspaceRestoreNavigationOverride,
  resolveSessionRootTerminalId,
  setAIPanelVisibility,
  setActiveSessionId,
  setActiveTerminalId,
  setContentTab,
  addToast,
  t,
}: UseAppGlobalEventsOptions) {
  const [quickThemeMode, setQuickThemeMode] = useState<string>(localStorage.getItem('themeMode') || 'dark');
  const [showThemeQuickEntry, setShowThemeQuickEntry] = useState(localStorage.getItem('showThemeQuickEntry') !== 'false');
  const [terminalToolbarIconOnly, setTerminalToolbarIconOnly] = useState(localStorage.getItem('terminalToolbarIconOnly') === 'true');
  const [showTopbarRefreshedLogo, setShowTopbarRefreshedLogo] = useState(false);

  const [mcpActivityEnabled, setMcpActivityEnabled] = useState(false);
  const [showMCPActivity, setShowMCPActivity] = useState(false);
  const [mcpActivityOffset, setMcpActivityOffset] = useState({ x: 0, y: 0 });
  const [mcpToggleOffset, setMcpToggleOffset] = useState({ x: 0, y: 0 });

  const mcpActivityEnabledRef = useRef(false);
  const mcpActivityOffsetRef = useRef({ x: 0, y: 0 });
  const mcpToggleOffsetRef = useRef({ x: 0, y: 0 });
  const mcpToggleDragConsumedRef = useRef(false);

  useEffect(() => { mcpActivityOffsetRef.current = mcpActivityOffset; }, [mcpActivityOffset]);
  useEffect(() => { mcpToggleOffsetRef.current = mcpToggleOffset; }, [mcpToggleOffset]);
  useEffect(() => { mcpActivityEnabledRef.current = mcpActivityEnabled; }, [mcpActivityEnabled]);

  // MCP event listeners
  useEffect(() => {
    getAIGlobalSettings()
      .then((settings) => { setMcpActivityEnabled(settings.mcpActivityVisible); })
      .catch(() => {});
    const unbind = EventsOn('mcp-activity-visibility-changed', (enabled: unknown) => {
      const visible = Boolean(enabled);
      setMcpActivityEnabled(visible);
      setShowMCPActivity(visible);
      setMcpActivityOffset({ x: 0, y: 0 });
      setMcpToggleOffset({ x: 0, y: 0 });
    });
    return () => { unbind(); };
  }, []);

  const openMCPActivity = useCallback(() => {
    if (mcpActivityEnabledRef.current) setShowMCPActivity(true);
  }, []);

  const handleMCPActivityDragStart = useCallback((e: { button?: number; clientX: number; clientY: number }) => {
    if (e.button != null && e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, ox: mcpActivityOffsetRef.current.x, oy: mcpActivityOffsetRef.current.y };
    const onMove = (ev: PointerEvent) => {
      setMcpActivityOffset({ x: start.ox + (ev.clientX - start.px), y: start.oy + (ev.clientY - start.py) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const handleMCPToggleDragStart = useCallback((e: { button?: number; clientX: number; clientY: number }) => {
    if (e.button != null && e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, ox: mcpToggleOffsetRef.current.x, oy: mcpToggleOffsetRef.current.y };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (!mcpToggleDragConsumedRef.current && Math.hypot(dx, dy) < 4) return;
      mcpToggleDragConsumedRef.current = true;
      setMcpToggleOffset({ x: start.ox + dx, y: start.oy + dy });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const handleMCPToggleClick = useCallback(() => {
    if (mcpToggleDragConsumedRef.current) {
      mcpToggleDragConsumedRef.current = false;
      return;
    }
    setShowMCPActivity(true);
  }, []);

  // Theme quick entry & toolbar
  useEffect(() => {
    const refreshThemeQuickEntry = () => {
      setQuickThemeMode(localStorage.getItem('themeMode') || 'dark');
      setShowThemeQuickEntry(localStorage.getItem('showThemeQuickEntry') !== 'false');
    };
    window.addEventListener('theme-mode-changed', refreshThemeQuickEntry);
    window.addEventListener('theme-quick-entry-changed', refreshThemeQuickEntry);
    return () => {
      window.removeEventListener('theme-mode-changed', refreshThemeQuickEntry);
      window.removeEventListener('theme-quick-entry-changed', refreshThemeQuickEntry);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      setTerminalToolbarIconOnly(localStorage.getItem('terminalToolbarIconOnly') === 'true');
    };
    window.addEventListener('terminal-toolbar-icon-only-changed', handler);
    return () => window.removeEventListener('terminal-toolbar-icon-only-changed', handler);
  }, []);

  const resolveQuickThemeMode = useCallback((mode: string): 'light' | 'dark' => {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return mode === 'light' ? 'light' : 'dark';
  }, []);

  const resolvedQuickThemeMode = activeAIDevilMode ? 'dark' : resolveQuickThemeMode(quickThemeMode);

  const handleQuickThemeToggle = useCallback(() => {
    if (activeAIDevilMode) {
      return;
    }
    const nextMode = resolvedQuickThemeMode === 'light' ? 'dark' : 'light';
    // 包一层 View Transition：切浅色=白圈从点击处扩散，切深色=旧画面收缩进点击点（不支持的内核直接切换）
    runThemeChangeWithTransition(() => {
      flushSync(() => {
        localStorage.setItem('themeMode', nextMode);
        setQuickThemeMode(nextMode);
        if (nextMode === 'light') document.body.classList.add('theme-light');
        else document.body.classList.remove('theme-light');
        window.dispatchEvent(new CustomEvent('theme-mode-changed'));
      });
    }, null, themeTransitionDirectionFor(nextMode));
  }, [activeAIDevilMode, resolvedQuickThemeMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowTopbarRefreshedLogo(true);
    }, 260);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  // AI selection & theme tuning events
  useEffect(() => {
    const handleSendTerminalSelectionToAI = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const selectedText = typeof detail.text === 'string' ? detail.text.trim() : '';
      const targetSessionId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : '';
      const sourceTerminalId = typeof detail.terminalId === 'string' ? detail.terminalId.trim() : '';
      if (!selectedText || !targetSessionId) {
        return;
      }
      const session = sessionsRef.current.find((item) => item.id === targetSessionId);
      if (!session) {
        return;
      }
      const nextTerminalId = activeSessionIdRef.current === targetSessionId && activeTerminalIdRef.current
        ? activeTerminalIdRef.current
        : resolveSessionRootTerminalId(session, sourceTerminalId || lastTerminalRef.current[targetSessionId]);
      if (!nextTerminalId) {
        return;
      }
      markWorkspaceRestoreNavigationOverride();
      setAIPanelVisibility(true);
      setActiveSessionId(targetSessionId);
      setActiveTerminalId(nextTerminalId);
      setContentTab('terminal');
      window.dispatchEvent(new CustomEvent('ai-composer-append', {
        detail: {
          sessionId: targetSessionId,
          terminalId: nextTerminalId,
          text: selectedText,
        },
      }));
    };

    const handleQuoteSelectionToAI = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const selectedText = typeof detail.text === 'string' ? detail.text : '';
      const quotedText = formatAIQuotedSelection(selectedText);
      const scopedSessionId = typeof detail.sessionId === 'string' ? detail.sessionId.trim() : '';
      const scopedTerminalId = typeof detail.terminalId === 'string' ? detail.terminalId.trim() : '';
      const scopedTabId = typeof detail.tabId === 'string' ? detail.tabId.trim() : '';
      if (scopedTabId) {
        return;
      }
      const currentSessionId = scopedSessionId || activeSessionIdRef.current;
      if (!currentSessionId || !quotedText) {
        return;
      }
      const session = sessionsRef.current.find((item) => item.id === currentSessionId);
      if (!session) {
        return;
      }
      const preferredTerminalId = scopedTerminalId || activeTerminalIdRef.current || lastTerminalRef.current[currentSessionId] || '';
      const activeLayout = !scopedTerminalId && preferredTerminalId ? terminalPaneLayoutsRef.current[preferredTerminalId] : null;
      const resolvedTerminalId = scopedTerminalId || (activeLayout?.sessionId === currentSessionId
        ? (activeLayout.rootTerminalId || preferredTerminalId)
        : resolveSessionRootTerminalId(session, preferredTerminalId, terminalPaneLayoutsRef.current));
      if (!resolvedTerminalId) {
        return;
      }
      window.dispatchEvent(new CustomEvent('ai-composer-append', {
        detail: {
          sessionId: currentSessionId,
          terminalId: resolvedTerminalId,
          tabId: scopedTabId,
          text: quotedText,
          preserveWhitespace: true,
        },
      }));
    };

    window.addEventListener('ai-terminal-send-to-assistant', handleSendTerminalSelectionToAI);
    window.addEventListener('ai-quote-selection', handleQuoteSelectionToAI);
    return () => {
      window.removeEventListener('ai-terminal-send-to-assistant', handleSendTerminalSelectionToAI);
      window.removeEventListener('ai-quote-selection', handleQuoteSelectionToAI);
    };
  }, [activeSessionIdRef, activeTerminalIdRef, lastTerminalRef, markWorkspaceRestoreNavigationOverride, resolveSessionRootTerminalId, sessionsRef, setAIPanelVisibility, setActiveSessionId, setActiveTerminalId, setContentTab, terminalPaneLayoutsRef]);

  useEffect(() => {
    const handleAIThemeTuningRequest = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const slot = typeof detail.slot === 'string' ? detail.slot.trim() : '';
      if (slot !== 'light' && slot !== 'dark') {
        return;
      }
      const connectedSessionList = sessionsRef.current.filter((session) => session.status === 'connected');
      const preferredSession = activeSessionIdRef.current
        ? connectedSessionList.find((session) => session.id === activeSessionIdRef.current)
        : null;
      const targetSession = preferredSession || connectedSessionList[0] || null;
      if (!targetSession) {
        addToast(t('需要先连接一个终端会话后再使用 AI 调色'), 'warning', 3200);
        return;
      }
      const targetTerminalId = resolveSessionRootTerminalId(
        targetSession,
        targetSession.id === activeSessionIdRef.current ? activeTerminalIdRef.current : String(lastTerminalRef.current[targetSession.id || ''] || targetSession.activeTerminalId || ''),
        terminalPaneLayoutsRef.current,
        String(targetSession.activeTerminalLabel || ''),
      ) || targetSession.id || '';
      markWorkspaceRestoreNavigationOverride();
      setAIPanelVisibility(true);
      setActiveSessionId(targetSession.id || null);
      setActiveTerminalId(targetTerminalId);
      setContentTab('terminal');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ai-theme-tuning-start', {
          detail: {
            sessionId: targetSession.id,
            terminalId: targetTerminalId,
            slot,
          },
        }));
      }, 40);
    };
    window.addEventListener('ai-theme-tuning-request', handleAIThemeTuningRequest);
    return () => window.removeEventListener('ai-theme-tuning-request', handleAIThemeTuningRequest);
  }, [activeSessionIdRef, activeTerminalIdRef, addToast, lastTerminalRef, markWorkspaceRestoreNavigationOverride, resolveSessionRootTerminalId, sessionsRef, setAIPanelVisibility, setActiveSessionId, setActiveTerminalId, setContentTab, t, terminalPaneLayoutsRef]);

  // Clean old localStorage history
  useEffect(() => {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cmd_history_') || key === 'command_history')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }, []);

  return {
    showThemeQuickEntry,
    terminalToolbarIconOnly,
    showTopbarRefreshedLogo,
    resolvedQuickThemeMode,
    handleQuickThemeToggle,
    mcpActivityEnabled,
    showMCPActivity,
    setShowMCPActivity,
    mcpActivityOffset,
    setMcpActivityOffset,
    mcpToggleOffset,
    setMcpToggleOffset,
    openMCPActivity,
    handleMCPActivityDragStart,
    handleMCPToggleDragStart,
    handleMCPToggleClick,
  };
}
