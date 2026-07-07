import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EventsOn, WindowMinimise, WindowToggleMaximise, WindowHide, WindowShow, WindowSetSize, WindowGetSize, WindowIsMaximised, WindowMaximise } from '../wailsjs/runtime/runtime.js';
import * as AppGo from '../wailsjs/go/main/App.js';
import Terminal from './components/Terminal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProbePanel from './components/ProbePanel.jsx';
import FileManager from './components/FileManager.jsx';
import AIPanel from './components/AIPanel.jsx';
import AIChangeReviewWorkbench from './components/ai/AIChangeReviewWorkbench.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import CredentialsModal from './components/CredentialsModal.jsx';
import Toast from './components/Toast.jsx';
import CommandHistory from './components/CommandHistory.jsx';
import ProcessPage from './components/ProcessPage.jsx';
import NetworkPage from './components/NetworkPage.jsx';
import GlobalDialog from './components/GlobalDialog.jsx';
import GlobalContextMenu from './components/GlobalContextMenu.jsx';
import { clampPanelWidth } from './components/probeFormatting.js';
import { useTranslation } from './i18n.js';
import { getTerminalTheme, hexToRgb } from './utils/theme.js';
import { useUpdateChecker } from './hooks/useUpdateChecker.js';
import ConnectingCard from './components/ConnectingCard.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import Dashboard from './components/Dashboard.jsx';
import { Bot, Settings, House, Minus, Square, X, Plus, Monitor, RefreshCw, Folder, ScrollText, Cpu, ChevronLeft, ChevronRight, ChevronDown, Search, Globe } from 'lucide-react';
import { Z } from './constants/zIndex';

import logoImg from './assets/logo.png';

function withAlpha(color, alpha, fallback) {
  if (typeof color !== 'string') {
    return fallback;
  }
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `rgba(${hexToRgb(trimmed)}, ${alpha})`;
  }
  return trimmed || fallback;
}

function Tiptop({ text, children }) {
  return (
    <div className="tiptop">
      <div className="tiptop-trigger">
        {children}
      </div>
      <div className="tiptop-bubble">{text}</div>
    </div>
  );
}

const FILE_MANAGER_LEFT_MIN = 180;
const FILE_MANAGER_BOTTOM_MIN = 100;
const PROBE_PANEL_MIN = 280;
const AI_PANEL_MIN = 450;
const COLLAPSE_ARMED_SIZE = 32;
const FILE_MANAGER_DOCK_HOTZONE = 88;

export default function App() {
  const { t } = useTranslation();
  const [servers, setServers] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const serversRef = useRef([]);
  useEffect(() => { serversRef.current = servers; }, [servers]);
  const [pings, setPings] = useState({});
  const [sessions, setSessions] = useState([]);      // { id, serverId, serverName, host, status, osInfo }
  const sessionsRef = useRef([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const cancelledConnectionsRef = useRef(new Set());
  const [activeSessionId, setActiveSessionId] = useState(null);
  const activeSessionIdRef = useRef(null);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const lastTerminalRef = useRef({}); // 记录每个 session 最后选中的终端
  const [mountedSessions, setMountedSessions] = useState(new Set());
  const [contentTab, setContentTab] = useState('terminal'); // 'terminal' | 'files'
  const [serverEditor, setServerEditor] = useState(null);
  const [editFlyAnimation, setEditFlyAnimation] = useState(null);
  const [editFlyShiningFields, setEditFlyShiningFields] = useState({});
  const [saveFlowHighlights, setSaveFlowHighlights] = useState({ serverId: null, rowPulse: null, fields: {} });
  const editFlyTimerRef = useRef(null);
  const editFlyFieldTimerRefs = useRef([]);
  const editFlyShineTimerRefs = useRef([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState(null);
  useEffect(() => {
    if (!tabContextMenu) return;
    const close = () => setTabContextMenu(null);
    // 延迟注册避免右键事件立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('click', close);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [tabContextMenu]);
  const [connectingServers, setConnectingServers] = useState([]); // [{ server, sessionId, startTime }]
  const connectingServersRef = useRef([]);
  useEffect(() => { connectingServersRef.current = connectingServers; }, [connectingServers]);
  const [toasts, setToasts] = useState([]);
  const [changeReviewQueue, setChangeReviewQueue] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState({}); // { [sessionId]: boolean }
  const [serverListViewMode, setServerListViewMode] = useState(localStorage.getItem('serverListViewMode') || 'grid'); // 'grid' | 'table'
  const [hideSensitive, setHideSensitive] = useState(localStorage.getItem('hideSensitive') === 'true');
  const [fileManagerPosition, setFileManagerPosition] = useState(() => {
    const saved = localStorage.getItem('fileManagerPosition') || 'tab';
    return saved === 'tab' || saved === 'left' || saved === 'bottom' ? saved : 'tab';
  }); // 'tab' | 'left' | 'bottom'
  const [fileManagerSplitPosition, setFileManagerSplitPosition] = useState(() => {
    const savedPosition = localStorage.getItem('fileManagerPosition');
    const savedSplitPosition = localStorage.getItem('fileManagerSplitPosition');
    if (savedPosition === 'left' || savedPosition === 'bottom') return savedPosition;
    return savedSplitPosition === 'left' || savedSplitPosition === 'bottom' ? savedSplitPosition : 'bottom';
  });
  const [fileManagerCollapsed, setFileManagerCollapsed] = useState(() => localStorage.getItem('fileManagerCollapsed') === 'true');
  const [creatingTerminalSessionId, setCreatingTerminalSessionId] = useState(null);
  const creatingTerminalRef = useRef(null);
  
  // ponytail: 9 处 setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s)) 提取为帮助函数
  const updateSessionStatus = useCallback((id, status) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  }, []);

  // ponytail: 3 处 s.terminals?.length > 0 ? s.terminals : [{ id: s.id }] 提取为帮助函数
  const getEffectiveTerminals = (s) => s.terminals?.length > 0 ? s.terminals : [{ id: s.id }];

  const renderSessionFileManagers = (s) => getEffectiveTerminals(s).map(t => {
    const isActive = activeSessionId === s.id && activeTerminalId === t.id;
    const serverConfig = serversRef.current.find((server) => server.id === s.serverId);
    return (
      <div key={t.id} style={isActive ? { display: 'contents' } : { display: 'none' }}>
        <FileManager
          sessionId={t.id}
          addToast={addToast}
          isActive={isActive}
          initialPath={serverConfig?.fileManagerInitPath || ''}
        />
      </div>
    );
  });
  
  // ── 新增自动检测更新状态 ──────────────────────────────
  const [startupUpdateInfo, setStartupUpdateInfo] = useState(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [syncFailed, setSyncFailed] = useState(null); // { provider, error }
  
  // ── 新增分屏拖拽大小控制状态与逻辑 ──────────────────────
  const [leftSplitWidth, setLeftSplitWidth] = useState(() => {
    return parseInt(localStorage.getItem('leftSplitWidth') || '320', 10);
  });
  const [bottomSplitHeight, setBottomSplitHeight] = useState(() => {
    return parseInt(localStorage.getItem('bottomSplitHeight') || '250', 10);
  });
  const [probePanelWidth, setProbePanelWidth] = useState(() => {
    return clampPanelWidth(localStorage.getItem('probePanelWidth') || '320', PROBE_PANEL_MIN);
  });
  const [probePanelPosition, setProbePanelPosition] = useState(() => localStorage.getItem('probePanelPosition') || 'left');
  const [probePanelCollapsed, setProbePanelCollapsed] = useState(() => localStorage.getItem('probePanelCollapsed') === 'true');
  const [showSessionList, setShowSessionList] = useState(false);
  const [terminalThemeToggle, setTerminalThemeToggle] = useState(0);
  const [sessionListPos, setSessionListPos] = useState({ x: 0, y: 0 });
  const [sessionListQuery, setSessionListQuery] = useState('');
  const sessionListBtnRef = useRef(null);
  const sessionListRef = useRef(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabScrollRef = useRef(null);
  const tabListRef = useRef(null);
  const tabActionsRef = useRef(null);
  const terminalSubTabScrollRef = useRef(null);
  const terminalSubTabActionsRef = useRef(null);
  const terminalSubTabDragSuppressUntilRef = useRef(0);
  const terminalSubTabScrollTargetRef = useRef(0);
  const terminalSubTabScrollFrameRef = useRef(0);
  const terminalSubTabDraggingRef = useRef(false);
  const fileManagerDockTabAnchorRef = useRef(null);
  const resizerClickSuppressUntilRef = useRef(0);
  const [collapseDragIntent, setCollapseDragIntent] = useState(null);
  const collapseDragIntentRef = useRef(null);
  const updateCollapseDragIntent = useCallback((next) => {
    if (collapseDragIntentRef.current === next) {
      return;
    }
    collapseDragIntentRef.current = next;
    setCollapseDragIntent(next);
  }, []);
  const [fileManagerDockPreview, setFileManagerDockPreview] = useState(null);
  const fileManagerDockPreviewRef = useRef(null);
  const updateFileManagerDockPreview = useCallback((next) => {
    if (fileManagerDockPreviewRef.current === next) {
      return;
    }
    fileManagerDockPreviewRef.current = next;
    setFileManagerDockPreview(next);
  }, []);
  const [fileManagerDockConfirmTarget, setFileManagerDockConfirmTarget] = useState(null);
  const fileManagerDockConfirmTargetRef = useRef(null);
  const updateFileManagerDockConfirmTarget = useCallback((next) => {
    if (fileManagerDockConfirmTargetRef.current === next) {
      return;
    }
    fileManagerDockConfirmTargetRef.current = next;
    setFileManagerDockConfirmTarget(next);
  }, []);
  const shouldIgnoreResizerClick = useCallback(() => Date.now() < resizerClickSuppressUntilRef.current, []);
  const setFileManagerCollapsedPersistent = useCallback((next) => {
    setFileManagerCollapsed(next);
    localStorage.setItem('fileManagerCollapsed', String(next));
  }, []);
  const setProbePanelCollapsedPersistent = useCallback((next) => {
    setProbePanelCollapsed(next);
    localStorage.setItem('probePanelCollapsed', String(next));
  }, []);
  useEffect(() => {
    if (!showSessionList) return;
    const handler = (e) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target) &&
          sessionListBtnRef.current && !sessionListBtnRef.current.contains(e.target)) {
        setShowSessionList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSessionList]);
  const toggleSessionList = useCallback(() => {
    if (showSessionList) { setShowSessionList(false); return; }
    const rect = sessionListBtnRef.current.getBoundingClientRect();
    setSessionListPos({ x: rect.right, y: rect.bottom + 4 });
    setSessionListQuery('');
    setShowSessionList(true);
  }, [showSessionList]);
  useEffect(() => {
    const scroll = tabScrollRef.current;
    const list = tabListRef.current;
    const actions = tabActionsRef.current;
    if (!scroll || !list) return;
    const check = () => {
      const actionsWidth = actions ? actions.offsetWidth : 0;
      setTabsOverflow(list.scrollWidth > scroll.clientWidth - actionsWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(scroll);
    return () => ro.disconnect();
  }, [sessions]);
  useEffect(() => {
    const refreshTerminalTheme = () => setTerminalThemeToggle((prev) => prev + 1);
    window.addEventListener('terminal-theme-changed', refreshTerminalTheme);
    window.addEventListener('theme-mode-changed', refreshTerminalTheme);
    return () => {
      window.removeEventListener('terminal-theme-changed', refreshTerminalTheme);
      window.removeEventListener('theme-mode-changed', refreshTerminalTheme);
    };
  }, []);
  const terminalSubTabTheme = useMemo(() => getTerminalTheme(), [terminalThemeToggle]);
  const [aiPanelWidth, setAiPanelWidth] = useState(() => {
    return clampPanelWidth(localStorage.getItem('aiPanelWidth') || '450', AI_PANEL_MIN);
  });
  const [showAIPanel, setShowAIPanel] = useState(localStorage.getItem('showAIPanel') !== 'false');

  const leftSplitWidthRef = useRef(leftSplitWidth);
  const bottomSplitHeightRef = useRef(bottomSplitHeight);
  const probePanelWidthRef = useRef(probePanelWidth);
  const aiPanelWidthRef = useRef(aiPanelWidth);

  const updateLeftSplitWidth = useCallback((w) => {
    setLeftSplitWidth(w);
    leftSplitWidthRef.current = w;
  }, []);
  const updateBottomSplitHeight = useCallback((h) => {
    setBottomSplitHeight(h);
    bottomSplitHeightRef.current = h;
  }, []);
  const updateProbePanelWidth = useCallback((w) => {
    const next = clampPanelWidth(w, PROBE_PANEL_MIN);
    setProbePanelWidth(next);
    probePanelWidthRef.current = next;
  }, []);
  const updateAiPanelWidth = useCallback((w) => {
    const next = clampPanelWidth(w, AI_PANEL_MIN);
    setAiPanelWidth(next);
    aiPanelWidthRef.current = next;
  }, []);
  const setAIPanelVisibility = useCallback((next) => {
    setShowAIPanel(next);
    localStorage.setItem('showAIPanel', String(next));
  }, []);
  const getFileManagerDockPreviewRect = useCallback((target) => {
    if (target !== 'left' && target !== 'bottom') {
      return null;
    }
    const container = document.getElementById('session-editor-container');
    if (!container) {
      return null;
    }
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const previewInset = 10;
    const resizerThickness = 4;

    if (target === 'left') {
      const bottomInset = fileManagerPosition === 'bottom' && !fileManagerCollapsed
        ? bottomSplitHeightRef.current + resizerThickness + previewInset
        : previewInset;
      const width = Math.max(FILE_MANAGER_LEFT_MIN, Math.min(800, leftSplitWidthRef.current));
      const left = rect.left + previewInset;
      const top = rect.top + previewInset;
      const right = left + width;
      const bottom = rect.bottom - bottomInset;
      if (right <= left || bottom <= top) {
        return null;
      }
      return {
        left,
        top,
        right,
        bottom,
        style: {
          left: previewInset,
          top: previewInset,
          bottom: bottomInset,
          width: `${width}px`,
        },
      };
    }

    const leftInset = fileManagerPosition === 'left' && !fileManagerCollapsed
      ? leftSplitWidthRef.current + resizerThickness + previewInset
      : previewInset;
    const height = Math.max(FILE_MANAGER_BOTTOM_MIN, Math.min(600, bottomSplitHeightRef.current));
    const left = rect.left + leftInset;
    const right = rect.right - previewInset;
    const bottom = rect.bottom - previewInset;
    const top = bottom - height;
    if (right <= left || bottom <= top) {
      return null;
    }
    return {
      left,
      top,
      right,
      bottom,
      style: {
        left: leftInset,
        right: previewInset,
        bottom: previewInset,
        height: `${height}px`,
      },
    };
  }, [fileManagerCollapsed, fileManagerPosition]);
const getFileManagerDockConfirmRect = useCallback((target) => {
  if (target === 'tab') {
    const rect = fileManagerDockTabAnchorRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }

  const previewRect = getFileManagerDockPreviewRect(target);
    if (!previewRect) {
      return null;
    }

    const container = document.getElementById('session-editor-container');
    const containerRect = container?.getBoundingClientRect();
    const edgeInset = 12;
    if (target === 'left') {
      const previewWidth = previewRect.right - previewRect.left;
      const left = previewRect.left + edgeInset;
      const top = previewRect.top + edgeInset;
      const right = Math.min(previewRect.right - edgeInset, left + Math.min(80, Math.max(46, previewWidth * 0.34)));
      const bottom = fileManagerPosition === 'bottom' && !fileManagerCollapsed && containerRect
        ? containerRect.bottom - edgeInset
        : previewRect.bottom - edgeInset;
      if (right <= left || bottom <= top) {
        return null;
      }
      return { left, top, right, bottom };
    }

    const previewHeight = previewRect.bottom - previewRect.top;
    const left = fileManagerPosition === 'left' && !fileManagerCollapsed && containerRect
      ? containerRect.left + edgeInset
      : previewRect.left + edgeInset;
    const right = previewRect.right - edgeInset;
    const bottom = previewRect.bottom - edgeInset;
    const top = Math.max(previewRect.top + edgeInset, bottom - Math.min(80, Math.max(46, previewHeight * 0.38)));
    if (right <= left || bottom <= top) {
      return null;
    }
    return { left, top, right, bottom };
  }, [fileManagerCollapsed, fileManagerPosition, getFileManagerDockPreviewRect]);

  const getFileManagerDockPreviewTarget = useCallback((clientX, clientY, target) => {
    const previewRect = getFileManagerDockPreviewRect(target);
    if (!previewRect) {
      return null;
    }
    return clientX >= previewRect.left
      && clientX <= previewRect.right
      && clientY >= previewRect.top
      && clientY <= previewRect.bottom
      ? target
      : null;
  }, [getFileManagerDockPreviewRect]);

  const getFileManagerDockConfirmTarget = useCallback((clientX, clientY, target) => {
    const confirmRect = getFileManagerDockConfirmRect(target);
    if (!confirmRect) {
      return null;
    }
    return clientX >= confirmRect.left
      && clientX <= confirmRect.right
      && clientY >= confirmRect.top
      && clientY <= confirmRect.bottom
      ? target
      : null;
  }, [getFileManagerDockConfirmRect]);

  useEffect(() => {
    if (fileManagerPosition === 'left' || fileManagerPosition === 'bottom') {
      setFileManagerSplitPosition(prev => prev === fileManagerPosition ? prev : fileManagerPosition);
      localStorage.setItem('fileManagerSplitPosition', fileManagerPosition);
    }
  }, [fileManagerPosition]);

  const handleFileManagerLayoutModeChange = useCallback((mode) => {
    if (mode === 'tab') {
      setFileManagerPosition('tab');
      localStorage.setItem('fileManagerPosition', 'tab');
      return;
    }

    const nextSplitPosition = (fileManagerPosition === 'left' || fileManagerPosition === 'bottom')
      ? fileManagerPosition
      : (fileManagerSplitPosition === 'left' || fileManagerSplitPosition === 'bottom' ? fileManagerSplitPosition : 'bottom');

    setFileManagerSplitPosition(nextSplitPosition);
    setFileManagerPosition(nextSplitPosition);
    localStorage.setItem('fileManagerSplitPosition', nextSplitPosition);
    localStorage.setItem('fileManagerPosition', nextSplitPosition);

    if (contentTab === 'files') {
      setContentTab('terminal');
    }
  }, [contentTab, fileManagerPosition, fileManagerSplitPosition]);

  const handleFileManagerSplitPositionChange = useCallback((position) => {
    if (position !== 'left' && position !== 'bottom') return;
    setFileManagerSplitPosition(position);
    localStorage.setItem('fileManagerSplitPosition', position);
    setFileManagerPosition(position);
    localStorage.setItem('fileManagerPosition', position);
    if (contentTab === 'files') setContentTab('terminal');
  }, [contentTab]);

  const handleFileManagerTabDock = useCallback(() => {
    setFileManagerPosition('tab');
    localStorage.setItem('fileManagerPosition', 'tab');
    setContentTab('files');
  }, []);

  // ── 清理旧 localStorage 残留数据 ──────────────────────
  useEffect(() => {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cmd_history_') || key === 'command_history')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }, []);

  // ── 智能窗口状态管理：记住窗口大小与最大化 ──────────────
  // 启动时恢复上次窗口状态
  useEffect(() => {
    if (localStorage.getItem('rememberWindowSize') === 'false') return;
    try {
      const saved = JSON.parse(localStorage.getItem('windowSize') || 'null');
      if (saved?.w > 100 && saved?.h > 100) {
        requestAnimationFrame(async () => {
          await WindowSetSize(saved.w, saved.h);
          if (saved.maximized) await WindowMaximise();
        });
      }
    } catch {}
  }, []);

  // 定时轮询保存窗口大小与最大化状态
  useEffect(() => {
    if (localStorage.getItem('rememberWindowSize') === 'false') return;
    let lastW = 0, lastH = 0, lastMaximized = false;
    const interval = setInterval(async () => {
      try {
        const [size, maximized] = await Promise.all([WindowGetSize(), WindowIsMaximised()]);
        if (maximized) {
          if (!lastMaximized) {
            lastMaximized = true;
            localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h, maximized: true }));
          }
        } else if (size?.w > 100 && size?.h > 100 && (size.w !== lastW || size.h !== lastH)) {
          lastW = size.w;
          lastH = size.h;
          lastMaximized = false;
          localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h, maximized: false }));
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const startDrag = useCallback((e, direction) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = leftSplitWidthRef.current;
    const startHeight = bottomSplitHeightRef.current;
    const startProbeWidth = probePanelWidthRef.current;
    const startAiWidth = aiPanelWidthRef.current;
    const dockTargets = direction === 'tab'
      ? ['left', 'bottom']
      : direction === 'left'
        ? ['bottom', 'tab']
        : direction === 'bottom'
          ? ['left', 'tab']
          : [];
    const isFileManagerResizer = direction === 'left' || direction === 'bottom';
    const isFileManagerDockDrag = dockTargets.length > 0;
    let moved = false;

    const resizer = e.currentTarget ?? e.target;
    resizer.classList?.add('dragging');
    updateCollapseDragIntent(null);
    updateFileManagerDockPreview(isFileManagerDockDrag ? direction : null);
    updateFileManagerDockConfirmTarget(null);

    document.body.style.cursor = direction === 'bottom' ? 'row-resize' : direction === 'tab' ? 'grabbing' : 'col-resize';
    document.body.style.userSelect = 'none';

    const getSnapshot = (clientX, clientY) => {
      if (direction === 'left') {
        const rawSize = startWidth + (clientX - startX);
        return {
          clampedSize: Math.max(FILE_MANAGER_LEFT_MIN, Math.min(800, rawSize)),
          armed: rawSize <= FILE_MANAGER_LEFT_MIN - COLLAPSE_ARMED_SIZE,
        };
      }
      if (direction === 'probe') {
        const rawSize = startProbeWidth + (probePanelPosition === 'left' ? clientX - startX : startX - clientX);
        return {
          clampedSize: clampPanelWidth(rawSize, PROBE_PANEL_MIN),
          armed: rawSize <= PROBE_PANEL_MIN - COLLAPSE_ARMED_SIZE,
        };
      }
      if (direction === 'ai') {
        const rawSize = startAiWidth + (probePanelPosition === 'left' ? startX - clientX : clientX - startX);
        return {
          clampedSize: clampPanelWidth(rawSize, AI_PANEL_MIN),
          armed: rawSize <= AI_PANEL_MIN - COLLAPSE_ARMED_SIZE,
        };
      }
      if (direction === 'bottom') {
        const rawSize = startHeight + (startY - clientY);
        return {
          clampedSize: Math.max(FILE_MANAGER_BOTTOM_MIN, Math.min(600, rawSize)),
          armed: rawSize <= FILE_MANAGER_BOTTOM_MIN - COLLAPSE_ARMED_SIZE,
        };
      }
      return {
        clampedSize: 0,
        armed: false,
      };
    };

    const getActiveDockTarget = (clientX, clientY) => {
      if (!isFileManagerDockDrag) {
        return null;
      }
      return dockTargets.find((target) => getFileManagerDockConfirmTarget(clientX, clientY, target)) || null;
    };

    const handleMouseMove = (moveEvent) => {
      const activeDockTarget = getActiveDockTarget(moveEvent.clientX, moveEvent.clientY);
      const snapshot = getSnapshot(moveEvent.clientX, moveEvent.clientY);
      if (!moved) {
        moved = Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3;
      }

      if (isFileManagerDockDrag) {
        updateFileManagerDockPreview(direction);
        updateFileManagerDockConfirmTarget(activeDockTarget);
      } else {
        updateFileManagerDockPreview(null);
        updateFileManagerDockConfirmTarget(null);
      }

      if (activeDockTarget) {
        updateCollapseDragIntent(null);
        return;
      }

      if (direction === 'left') {
        updateLeftSplitWidth(snapshot.clampedSize);
      } else if (direction === 'probe') {
        updateProbePanelWidth(snapshot.clampedSize);
      } else if (direction === 'ai') {
        updateAiPanelWidth(snapshot.clampedSize);
      } else if (direction === 'bottom') {
        updateBottomSplitHeight(snapshot.clampedSize);
      }

      if (direction === 'left' || direction === 'bottom' || direction === 'probe' || direction === 'ai') {
        updateCollapseDragIntent(snapshot.armed ? direction : null);
      } else {
        updateCollapseDragIntent(null);
      }
    };

    const handleMouseUp = (upEvent) => {
      try {
        const activeDockTarget = getActiveDockTarget(upEvent.clientX, upEvent.clientY);
        const snapshot = getSnapshot(upEvent.clientX, upEvent.clientY);
        const shouldCollapse = snapshot.armed;
        if (moved) {
          resizerClickSuppressUntilRef.current = Date.now() + 160;
        }
        resizer.classList?.remove('dragging');
        updateCollapseDragIntent(null);
        updateFileManagerDockPreview(null);
        updateFileManagerDockConfirmTarget(null);

        if (activeDockTarget) {
          if (direction === 'left') {
            updateLeftSplitWidth(startWidth);
            localStorage.setItem('leftSplitWidth', startWidth.toString());
          } else if (direction === 'bottom') {
            updateBottomSplitHeight(startHeight);
            localStorage.setItem('bottomSplitHeight', startHeight.toString());
          }
          setFileManagerCollapsedPersistent(false);
          if (activeDockTarget === 'tab') {
            handleFileManagerTabDock();
          } else {
            handleFileManagerSplitPositionChange(activeDockTarget);
          }
        } else if (direction === 'left') {
          if (shouldCollapse) {
            updateLeftSplitWidth(startWidth);
            setFileManagerCollapsedPersistent(true);
          } else {
            localStorage.setItem('leftSplitWidth', leftSplitWidthRef.current.toString());
          }
        } else if (direction === 'probe') {
          if (shouldCollapse) {
            updateProbePanelWidth(startProbeWidth);
            setProbePanelCollapsedPersistent(true);
          } else {
            localStorage.setItem('probePanelWidth', probePanelWidthRef.current.toString());
          }
        } else if (direction === 'ai') {
          if (shouldCollapse) {
            updateAiPanelWidth(startAiWidth);
            setAIPanelVisibility(false);
          } else {
            localStorage.setItem('aiPanelWidth', aiPanelWidthRef.current.toString());
          }
        } else if (direction === 'bottom') {
          if (shouldCollapse) {
            updateBottomSplitHeight(startHeight);
            setFileManagerCollapsedPersistent(true);
          } else {
            localStorage.setItem('bottomSplitHeight', bottomSplitHeightRef.current.toString());
          }
        }

        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 50);
      } finally {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [
    getFileManagerDockConfirmTarget,
    handleFileManagerSplitPositionChange,
    handleFileManagerTabDock,
    probePanelPosition,
    setAIPanelVisibility,
    setFileManagerCollapsedPersistent,
    setProbePanelCollapsedPersistent,
    updateAiPanelWidth,
    updateBottomSplitHeight,
    updateCollapseDragIntent,
    updateFileManagerDockConfirmTarget,
    updateFileManagerDockPreview,
    updateLeftSplitWidth,
    updateProbePanelWidth,
  ]);
  // ────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if (typeof e.detail === 'boolean') {
        setShowAIPanel(e.detail);
        return;
      }
      setShowAIPanel(localStorage.getItem('showAIPanel') !== 'false');
    };
    window.addEventListener('ai-panel-visibility-changed', handler);
    return () => window.removeEventListener('ai-panel-visibility-changed', handler);
  }, []);

  // 持久化 AI 面板可见性
  useEffect(() => {
    localStorage.setItem('showAIPanel', showAIPanel);
  }, [showAIPanel]);

  const pingTimerRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── 新增主页仪表盘状态 ──────────────────────────────────
  const [isRefreshingPing, setIsRefreshingPing] = useState(false);
  const [pingInterval, setPingInterval] = useState(parseInt(localStorage.getItem('pingInterval') || '2', 10));

  useEffect(() => {
    const handler = () => {
      setPingInterval(parseInt(localStorage.getItem('pingInterval') || '2', 10));
    };
    window.addEventListener('pingIntervalChanged', handler);
    return () => window.removeEventListener('pingIntervalChanged', handler);
  }, []);

  // ── 初始化全局主题 ──────────────────────────────────────
  useEffect(() => {
    const applyTheme = () => {
      const savedTheme = localStorage.getItem('themeMode') || 'dark';
      const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const applyLight = savedTheme === 'light' || (savedTheme === 'system' && isSystemLight);
      if (applyLight) document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
      window.dispatchEvent(new CustomEvent('theme-mode-changed'));
    };
    applyTheme();

    // 自定义强调色初始化
    const useCustomAccent = localStorage.getItem('useCustomAccent') === 'true';
    const themeAccent = localStorage.getItem('themeAccent');
    if (useCustomAccent && themeAccent) {
      document.body.style.setProperty('--accent', themeAccent);
      document.body.style.setProperty('--accent-rgb', hexToRgb(themeAccent));
    }

    // 系统主题变化时自动跟随
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, []);

  // ── 自动检测更新机制 ────────────────────────────────────
  const { checkUpdate, applyUpdate, downloadProgress } = useUpdateChecker({
    onResult: (result) => {
      if (result.hasUpdate) {
        setStartupUpdateInfo({
          version: 'v' + result.latestVersion,
          url: result.url,
          filename: result.filename,
        });
        setIsUpdateModalVisible(true);
      }
    }
  });

  useEffect(() => {
    // 延迟 2.5 秒触发检测，避免阻塞应用首次极速渲染
    const timer = setTimeout(checkUpdate, 2500);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  const handleApplyStartupUpdate = async () => {
    try {
      await applyUpdate(startupUpdateInfo);
    } catch (err) {
      addToast(`${t('自动更新失败')}: ${err}`, 'error', 5000);
    }
  };

  // ── 刷新延迟 ────────────────────────────────────────────
  const handleRefreshPing = async () => {
    if (isRefreshingPing) return; // 防止重复点击导致并发竞态
    setIsRefreshingPing(true);
    await pingAll();
    setTimeout(() => { if (mountedRef.current) setIsRefreshingPing(false); }, 800);
  };

  // ── Toast helpers ──────────────────────────────────────────
  const toastIdRef = useRef(0);
  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => { if (mountedRef.current) setToasts((prev) => prev.filter((t) => t.id !== id)); }, duration);
  }, []);

  const activeChangeReview = changeReviewQueue.length > 0 ? changeReviewQueue[0] : null;

  const enqueueChangeReview = useCallback((review) => {
    if (!review || typeof review !== 'object' || !review.reviewId || !review.requestId) {
      return;
    }
    setChangeReviewQueue((prev) => {
      if (prev.some((item) => item.reviewId === review.reviewId)) {
        return prev;
      }
      return [...prev, review];
    });
  }, []);

  const removeChangeReviewById = useCallback((reviewId) => {
    const normalizedId = typeof reviewId === 'string' ? reviewId.trim() : '';
    if (!normalizedId) {
      return;
    }
    setChangeReviewQueue((prev) => prev.filter((item) => item.reviewId !== normalizedId));
  }, []);

  const removeChangeReviewsByRequestId = useCallback((requestId) => {
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalizedRequestId) {
      return;
    }
    setChangeReviewQueue((prev) => prev.filter((item) => item.requestId !== normalizedRequestId));
  }, []);

  const removeChangeReviewsBySessionId = useCallback((sessionId) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      return;
    }
    setChangeReviewQueue((prev) => prev.filter((item) => item.sessionId !== normalizedSessionId));
  }, []);

  useEffect(() => {
    const handleClearChangeReview = (event) => {
      const sessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      if (!sessionId) {
        return;
      }
      removeChangeReviewsBySessionId(sessionId);
    };

    window.addEventListener('ai-change-review-clear', handleClearChangeReview);
    return () => window.removeEventListener('ai-change-review-clear', handleClearChangeReview);
  }, [removeChangeReviewsBySessionId]);

  // ── 连接错误通用处理 ──────────────────────────────────────
  const handleConnectError = useCallback((sessionId, err) => {
    // 如果用户已取消该连接，不再弹错误提示
    if (cancelledConnectionsRef.current.has(sessionId)) {
      cancelledConnectionsRef.current.delete(sessionId);
      return;
    }
    const errMsg = String(err);
    const isHostKeyChange = errMsg.includes('主机密钥已变更');
    const isAuthFailed = errMsg.includes('认证失败');
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, status: (isHostKeyChange || isAuthFailed) ? 'connecting' : 'error' } : s))
    );
    if (!isHostKeyChange && !isAuthFailed) {
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
      addToast(`${t('连接失败')}: ${err}`, 'error', 5000);
    }
  }, [addToast, t]);

  // ── 连接成功后通用设置：查询 OS 信息、启用监控、持久化 OS ──
  const postConnectSetup = useCallback(async (sessionId, serverId, extraServerFields = {}) => {
    try {
      // 获取静态信息（OS/主机名/时区）
      const staticInfo = await AppGo.GetServerStaticInfo(sessionId);
      if (staticInfo) {
        setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, osInfo: staticInfo } : s));
      }
      if (serverId) {
        setServers(prevServers => {
          const currentServer = prevServers.find(s => s.id === serverId);
          if (currentServer) {
            const detectedOs = staticInfo?.os || '';
            // 总是调用：OS 变了会更新 OS，OS 没变也会触发同步（确保 noSync 保存的密码等数据被同步）
            // OS 检测失败时用已有 OS，避免清空
            AppGo.SetConnectionOS(serverId, detectedOs || currentServer.os || '').catch(console.error);
            if (detectedOs && currentServer.os !== detectedOs) {
              setServers(prev => prev.map(s => s.id === serverId ? { ...s, os: detectedOs } : s));
            }
          }
          return prevServers;
        });
      }
      // 启用监控
      setMonitoringEnabled((prev) => ({ ...prev, [sessionId]: true }));
    } catch (_) {}
  }, []);

  // ── Load servers ───────────────────────────────────────────
  const loadServers = useCallback(async () => {
    try {
      const data = await AppGo.GetConnectionsMasked();
      setServers(data || []);
    } catch (e) {
      addToast(t('加载服务器配置失败'), 'error');
    }
    try {
      const creds = await AppGo.GetCredentials();
      setCredentials(creds || []);
    } catch (_) {}
  }, [addToast]);

  useEffect(() => { loadServers(); }, [loadServers]);

  // ── Ping all servers ───────────────────────────────────────
  const pingAll = useCallback(async () => {
    const list = serversRef.current;
    if (list.length === 0) return;
    const results = await Promise.all(
      list.map(async (s) => {
        try {
          const res = await AppGo.PingServer(s.host, s.port || 22);
          return { id: s.id, ...res };
        } catch {
          return { id: s.id, online: false, latency: null };
        }
      })
    );
    const map = {};
    results.forEach((r) => { map[r.id] = { online: r.online, latency: r.latency }; });
    setPings(map);
  }, []);

  useEffect(() => {
    if (activeSessionId !== null) return; // ponytail: 不在主页时不 ping
    pingAll();
    // 修改为动态刷新延迟，降低后台消耗或提高实时性
    pingTimerRef.current = setInterval(pingAll, pingInterval * 1000);
    return () => clearInterval(pingTimerRef.current);
  }, [pingAll, pingInterval, activeSessionId]);

  // ── 取消连接 ──────────────────────────────────────────────
  const handleCancelConnection = useCallback((sessionId) => {
    if (!sessionId) return;
    cancelledConnectionsRef.current.add(sessionId);
    // 30 秒后自动清理，避免 Set 无限增长（错误若未到达则永久残留）
    setTimeout(() => { cancelledConnectionsRef.current.delete(sessionId); }, 30000);
    AppGo.DisconnectSSH(sessionId).catch(() => {});
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setActiveSessionId(null);
    setActiveTerminalId(null);
    setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }, []);

  // ── 切换到下一个可用 session ──────────────────────────────
  const switchToNextSession = useCallback((currentSessionId) => {
    const remaining = sessionsRef.current.filter(s => s.id !== currentSessionId);
    if (remaining.length > 0) {
      const nextSession = remaining[remaining.length - 1];
      setActiveSessionId(nextSession.id);
      const lastTid = lastTerminalRef.current[nextSession.id];
      const validTerminal = nextSession.terminals?.find(t => t.id === lastTid);
      setActiveTerminalId(validTerminal ? validTerminal.id : (nextSession.terminals?.[0]?.id || nextSession.id));
    } else {
      setActiveSessionId(null);
      setActiveTerminalId(null);
    }
  }, []);

  // ponytail: 提取 tab 点击处理，避免每次渲染创建 N 个闭包
  const handleTabClick = useCallback((sessionId) => {
    setTabContextMenu(null);
    setActiveSessionId(sessionId);
    const sess = sessionsRef.current.find(x => x.id === sessionId);
    const lastTid = lastTerminalRef.current[sessionId];
    const validTerminal = sess?.terminals?.find(t => t.id === lastTid);
    setActiveTerminalId(validTerminal ? validTerminal.id : (sess?.terminals?.[0]?.id || sessionId));
  }, []);

  // ── 重连会话核心逻辑 ────────────────────────────────────────
  const reconnectSession = useCallback(async (session, requestingTerminalId) => {
    updateSessionStatus(session.id, 'connecting');

    // 如果是当前激活的会话，展示连接等待卡片
    const serverObj = serversRef.current.find((sv) => sv.id === session.serverId);
    if (serverObj) {
      setConnectingServers((prev) => [...prev, { server: serverObj, sessionId: session.id, startTime: Date.now() }]);
    }

    try {
      await AppGo.ConnectSSH(session.id, session.serverId);

      // 重建子终端 (终端2, 终端3, ...)
      const subTerminals = (session.terminals || []).filter(t => t.id !== session.id);
      const oldToNew = { [session.id]: session.id };
      const newTerminals = [{ id: session.id, label: `${t('终端')}1` }];
      for (const sub of subTerminals) {
        try {
          const newTermId = await AppGo.OpenTerminal(session.id);
          oldToNew[sub.id] = newTermId;
          newTerminals.push({ id: newTermId, label: sub.label });
        } catch (_) {}
      }

      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, status: 'connected', terminals: newTerminals } : s))
      );
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));
      addToast(t('重新连接成功'), 'success');

      // 切回重连前所在的终端
      if (requestingTerminalId && oldToNew[requestingTerminalId]) {
        setActiveTerminalId(oldToNew[requestingTerminalId]);
      }

      // 后台重新部署并激活探针状态
      await postConnectSetup(session.id, session.serverId);
    } catch (err) {
      const errMsg = String(err);
      const isHostKeyChange = errMsg.includes('主机密钥已变更');
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, status: isHostKeyChange ? 'connecting' : 'error' } : s))
      );
      if (!isHostKeyChange) {
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));
        addToast(`${t('重新连接失败')}: ${err}`, 'error', 5000);
      }
    }
  }, [addToast, t, postConnectSetup]);

  // ── 监听 SSH 意外断开事件 ────────────────────────────────────
  useEffect(() => {
    const unbind = EventsOn('ssh-disconnected', (sessionId) => {
      setSessions((prev) => {
        // 检查是否是服务器级别的 session
        const serverSession = prev.find(s => s.id === sessionId);
        if (serverSession) {
          return prev.map((s) => (s.id === sessionId ? { ...s, status: 'closed' } : s));
        }
        // 检查是否是子终端
        const parent = prev.find(s => s.terminals?.some(t => t.id === sessionId));
        if (parent) {
          return prev.map((s) => (s.id === parent.id ? { ...s, status: 'closed' } : s));
        }
        return prev;
      });
      addToast(t('SSH 连接已意外断开'), 'error', 4000);
    });
    return () => {
      if (unbind) unbind();
    };
  }, [addToast]);

  // ── 监听主机密钥变更事件 ────────────────────────────────────
  useEffect(() => {
    const unbind = EventsOn('ssh-host-key-changed', async (data) => {
      const {
        sessionId, hostname, host, port, newFingerprint, oldFingerprints, isNew
      } = data;

      const oldFpList = (oldFingerprints || []).join('\n');
      const msg = isNew
        ? [
            t('首次连接到此主机，请确认密钥指纹：'),
            ``,
            `${t('主机:')} ${host}:${port}`,
            ``,
            t('密钥指纹:'),
            `${newFingerprint}`,
            ``,
            t('如果指纹与服务器管理员提供的匹配，点击"接受并保存"。'),
          ].join('\n')
        : [
            t('远程主机密钥已变更，可能存在中间人攻击！'),
            ``,
            `${t('主机:')} ${host}:${port}`,
            ``,
            t('新密钥指纹:'),
            `${newFingerprint}`,
            ``,
            t('旧密钥指纹:'),
            `${oldFpList}`,
            ``,
            t('如果确认这是预期的变更（如服务器重装），点击"接受并保存"。'),
          ].join('\n');

      const action = await window.luminDialog?.choice?.(
        msg,
        isNew ? t('主机密钥确认') : t('主机密钥已变更'),
        [
          { label: t('只接受本次'), value: 1, secondary: true },
          { label: t('接受并保存'), value: 2, primary: true },
          { label: t('取消'), value: 0, secondary: true },
        ]
      );

      // action: 0/取消或null → 取消连接, 1 → 仅本次, 2 → 保存
      const chosen = action ?? 0;

      try {
        await AppGo.AcceptHostKeyChange(sessionId, chosen);
        if (chosen >= 1) {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId ? { ...s, status: 'connected' } : s
            )
          );
          setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
          addToast(
            chosen === 2 ? t('主机密钥已保存，连接成功') : t('本次已接受，连接成功'),
            'success'
          );

          await postConnectSetup(sessionId);
        } else {
          updateSessionStatus(sessionId, 'error');
          setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        }
      } catch (err) {
        updateSessionStatus(sessionId, 'error');
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        addToast(`${t('连接失败')}: ${err}`, 'error', 5000);
      }
    });
    return () => {
      if (unbind) unbind();
    };
  }, [addToast]);

  // ── 监听认证失败事件（密码错误等） ──────────────────────────
  useEffect(() => {
    const unbind = EventsOn('ssh-auth-failed', async (data) => {
      const { sessionId, connId, host, port, username, error } = data;
      const usesCredential = serversRef.current.some(s => s.id === connId && s.credentialId);

      const password = await window.luminDialog?.prompt?.(
        [
          t('认证失败，请输入正确的密码重试：'),
          ``,
          `${t('主机:')} ${host}:${port}`,
          `${t('用户')}: ${username}`,
          ``,
          `${t('错误')}: ${error}`,
        ].join('\n'),
        '',
        t('认证失败'),
        usesCredential ? t('更新凭据密码') : t('记住密码')
      );

      if (password === null) {
        // 用户取消
        updateSessionStatus(sessionId, 'error');
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        addToast(t('用户取消连接'), 'warning', 3000);
        return;
      }

      const newPassword = typeof password === 'object' ? password.value : password;
      const persist = typeof password === 'object' ? password.checked : false;

      if (!newPassword) {
        updateSessionStatus(sessionId, 'error');
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        return;
      }

      try {
        await AppGo.ReconnectWithPassword(sessionId, connId, newPassword, persist);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
        );
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        addToast(persist ? t('密码已保存，连接成功') : t('连接成功'), 'success', 3000);

        await postConnectSetup(sessionId, connId, { password: newPassword });

        // 加入最近连接
      } catch (retryErr) {
        updateSessionStatus(sessionId, 'error');
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        addToast(`${t('重新连接失败')}: ${String(retryErr)}`, 'error', 5000);
      }
    });
    return () => {
      if (unbind) unbind();
    };
  }, [addToast]);

  // ── 关闭窗口通用处理 ──────────────────────────────────────────
  const handleCloseWindow = useCallback(async () => {
    if (syncFailed) {
      const choice = await window.luminDialog?.choice?.(
        t('云端同步未完成，确定退出吗？'),
        t('同步未完成'),
        [
          { label: t('仍然退出'), value: 'quit', primary: true },
          { label: t('重试同步'), value: 'retry', secondary: true },
          { label: t('取消'), value: 'cancel', secondary: true },
        ]
      );
      if (choice === 'quit') {
        AppGo.DoQuit();
      } else if (choice === 'retry') {
        const err = await AppGo.RetrySync();
        if (!err) {
          setSyncFailed(null);
          addToast(t('同步成功'), 'success', 3000);
        }
      }
      return;
    }
    const savedAction = localStorage.getItem('windowCloseAction');
    if (savedAction === 'quit') { AppGo.DoQuit(); return; }
    if (savedAction === 'tray') { AppGo.AckClose(); WindowHide(); return; }
    const result = await window.luminDialog?.choice?.(
      t('请选择操作'),
      t('关闭窗口'),
      [
        { label: t('退出'), value: 'quit', primary: true },
        { label: t('系统托盘'), value: 'tray', secondary: true },
        { label: t('取消'), value: 'cancel', secondary: true },
      ],
      t('记住选择')
    );
    if (!result) return;
    const { value, checked } = result;
    if (checked && (value === 'quit' || value === 'tray')) {
      localStorage.setItem('windowCloseAction', value);
    }
    if (value === 'quit') {
      AppGo.DoQuit();
    } else if (value === 'tray') {
      AppGo.AckClose();
      WindowHide();
    } else if (value === 'cancel') {
      AppGo.AckClose();
    }
  }, [t, syncFailed, addToast]);

  // ── 监听关闭窗口请求，弹出选择对话框 ──────────────────────────
  useEffect(() => {
    const unbind = EventsOn('close-request', handleCloseWindow);
    return () => { if (unbind) unbind(); };
  }, [handleCloseWindow]);

  // ── 监听云端同步失败事件 ──────────────────────────────────
  useEffect(() => {
    const unbind = EventsOn('sync-failed', (data) => {
      setSyncFailed(data);
    });
    return () => { if (unbind) unbind(); };
  }, []);

  // ── 监听同步状态事件 ──────────────────────────────────────
  useEffect(() => {
    const unbind = EventsOn('sync-status', (data) => {
      if (data.action === 'merge' || data.action === 'download') {
        const msg = data.localChanged
          ? t('同步完成') + `：${t('云端')} ${data.remoteCount} → ${t('合并')} ${data.mergedCount}` + (data.uploaded ? `，${t('已上传')}` : '')
          : t('同步完成') + `：${t('数据一致，无需变更')}`;
        addToast(msg, 'info', 4000);
        // merge/download 意味着本地数据已变更，刷新列表
        if (data.localChanged) loadServers();
      } else if (data.action === 'upload') {
        addToast(t('本地数据已同步到云端'), 'info', 4000);
      }
    });
    return () => { if (unbind) unbind(); };
  }, [addToast, t, loadServers]);

  useEffect(() => {
    const unbind = EventsOn('ai-chat-stream', (payload) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }
      if (payload.kind === 'change_review_required' && payload.review) {
        enqueueChangeReview(payload.review);
        return;
      }
      if (
        payload.kind === 'tool_approval_resolved'
        || payload.kind === 'tool_rejected'
        || payload.kind === 'error'
        || payload.kind === 'cancelled'
      ) {
        removeChangeReviewsByRequestId(payload.requestId);
      }
    });
    return () => {
      if (unbind) unbind();
    };
  }, [enqueueChangeReview, removeChangeReviewsByRequestId]);

  // ── 监听终端触发的重连请求 ──────────────────────────────────
  useEffect(() => {
    const handleReconnectTrigger = (e) => {
      const sessId = e.detail;
      // 通过 sessionsRef 读取最新 sessions，避免每次 sessions 变化都重注册监听器
      const sessions = sessionsRef.current;
      // 先按 sessionId 查找
      let sess = sessions.find((s) => s.id === sessId);
      // 如果是子终端 ID，找到父会话
      if (!sess) {
        const parent = sessions.find(s => s.terminals?.some(t => t.id === sessId));
        if (parent) sess = parent;
      }
      if (sess) {
        reconnectSession(sess, sessId);
      }
    };
    window.addEventListener('ssh-reconnect-trigger', handleReconnectTrigger);
    return () => window.removeEventListener('ssh-reconnect-trigger', handleReconnectTrigger);
  }, [reconnectSession]);

  // ── Connect to server ──────────────────────────────────────
  const connectServer = useCallback(async (server) => {
    const existing = sessionsRef.current.find((s) => s.serverId === server.id && s.status !== 'closed' && s.status !== 'error');
    if (existing) {
      setActiveSessionId(existing.id);
      const lastTid = lastTerminalRef.current[existing.id];
      const validTerminal = existing.terminals?.find(t => t.id === lastTid);
      setActiveTerminalId(validTerminal ? validTerminal.id : (existing.terminals?.[0]?.id || existing.id));
      setContentTab('terminal');
      return;
    }

    // 复用已关闭/失败的同服务器 session，避免 tab 重复
    const closedSession = sessionsRef.current.find((s) => s.serverId === server.id && (s.status === 'closed' || s.status === 'error'));
    if (closedSession) {
      setActiveSessionId(closedSession.id);
      setActiveTerminalId(closedSession.terminals?.[0]?.id || closedSession.id);
      setContentTab('terminal');
      await reconnectSession(closedSession);
      return;
    }

    const sessionId = `session_${Date.now()}`;
    const newSession = {
      id: sessionId,
      serverId: server.id,
      serverName: server.name || server.host,
      host: server.host,
      status: 'connecting',
      terminals: [{ id: sessionId, label: `${t('终端')}1` }],
    };

    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(sessionId);
    setActiveTerminalId(sessionId);
    setContentTab('terminal');
    // 显示连接进度卡片
    setConnectingServers((prev) => [...prev, { server, sessionId, startTime: Date.now() }]);

    try {
      await AppGo.ConnectSSH(sessionId, server.id);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
      );
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));

      // 连接成功后自动查询 OS 信息并更新 sessions
      await postConnectSetup(sessionId, server.id);

      // 连接成功后加入最近连接列表（仅保留非敏感字段）
    } catch (err) {
      handleConnectError(sessionId, err);
    }
  }, [handleConnectError, reconnectSession]);

  // ── Close session ──────────────────────────────────────────
  // ponytail: 内部关闭逻辑，不带确认弹窗，供 closeSession 和右键菜单共用
  const forceCloseSession = useCallback((sessionId) => {
    const session = sessionsRef.current.find(s => s.id === sessionId);
    const termIds = session?.terminals ? session.terminals.map(t => t.id) : [sessionId];
    termIds.forEach(id => {
      cancelledConnectionsRef.current.add(id);
      setTimeout(() => { cancelledConnectionsRef.current.delete(id); }, 30000);
    });
    for (const id of termIds) {
      AppGo.DisconnectSSH(id).catch(() => {});
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionIdRef.current === sessionId) {
      switchToNextSession(sessionId);
    }
    if (connectingServersRef.current.some((s) => s.sessionId === sessionId)) {
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
    }
  }, []);

  const closeSession = useCallback(async (sessionId, e) => {
    e?.stopPropagation();
    if (localStorage.getItem('skipCloseSessionConfirm') === 'true') {
      forceCloseSession(sessionId);
      return;
    }
    const session = sessionsRef.current.find(s => s.id === sessionId);
    const name = session?.serverName || session?.name || session?.host || sessionId;
    const result = await window.luminDialog?.confirm(`${t('确定关闭连接')}「${name}」？`, t('操作确认'), t('不再询问'));
    if (!result?.confirmed) return;
    if (result.checked) localStorage.setItem('skipCloseSessionConfirm', 'true');
    forceCloseSession(sessionId);
  }, [forceCloseSession, t]);

  // ponytail: 批量关闭 — 一次性断开所有终端再清空 state，避免逐个 forceClose 反复触发 switchToNextSession
  const closeAllSessions = useCallback(async () => {
    const all = sessionsRef.current;
    if (all.length === 0) return;
    const skip = localStorage.getItem('skipCloseAllConfirm') === 'true';
    if (!skip) {
      const result = await window.luminDialog?.confirm(`${t('确定关闭全部')} ${all.length} ${t('个连接')}？`, t('操作确认'), t('不再询问'));
      if (!result?.confirmed) return;
      if (result.checked) localStorage.setItem('skipCloseAllConfirm', 'true');
    }
    const allTermIds = all.flatMap(s => s.terminals?.length > 0 ? s.terminals.map(t => t.id) : [s.id]);
    allTermIds.forEach(id => {
      cancelledConnectionsRef.current.add(id);
      setTimeout(() => { cancelledConnectionsRef.current.delete(id); }, 30000);
    });
    for (const id of allTermIds) {
      AppGo.DisconnectSSH(id).catch(() => {});
    }
    setSessions([]);
    setActiveSessionId(null);
    setActiveTerminalId(null);
    setConnectingServers([]);
  }, [t]);

  // ── 在当前服务器上新建终端标签 ──────────────────────────────
  const openNewTerminal = useCallback(async (sessionId) => {
    if (creatingTerminalRef.current) return;

    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session || session.status !== 'connected') return;

    creatingTerminalRef.current = sessionId;
    setCreatingTerminalSessionId(sessionId);

    // 使用当前会话中任意一个现有终端的 ID，确保即使第一个终端已关闭也能找到共享连接
    const baseTermId = session.terminals?.[0]?.id || sessionId;

    // 计算下一个终端编号（找最大编号 + 1）
    let maxNum = 0;
    (session.terminals || []).forEach(term => {
      const match = term.label?.match(/(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    });
    const termLabel = `${t('终端')}${maxNum + 1}`;

    try {
      const newTermId = await AppGo.OpenTerminal(baseTermId);
      setSessions((prev) =>
        prev.map((s) => s.id === sessionId
          ? { ...s, terminals: [...(s.terminals || []), { id: newTermId, label: termLabel }] }
          : s
        )
      );
      setActiveTerminalId(newTermId);
      setContentTab('terminal');
    } catch (err) {
      addToast(`${t('新建终端失败')}: ${err}`, 'error', 5000);
    } finally {
      creatingTerminalRef.current = null;
      if (mountedRef.current) setCreatingTerminalSessionId(null);
    }
  }, [addToast, t]);

  // ── 关闭单个终端标签 ──────────────────────────────────────
  const closeTerminal = useCallback((sessionId, terminalId, e) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session?.terminals) return;
    
    AppGo.DisconnectSSH(terminalId).catch(() => {});
    
    setSessions((prev) => {
      return prev.map((s) => {
        if (s.id !== sessionId) return s;
        const remaining = (s.terminals || []).filter(t => t.id !== terminalId);
        if (remaining.length === 0) return null; // 标记删除
        return { ...s, terminals: remaining };
      }).filter(Boolean); // 移除被标记的
    });
    
    if (activeTerminalId === terminalId) {
      const remaining = (session.terminals || []).filter(t => t.id !== terminalId);
      if (remaining.length > 0) {
        setActiveTerminalId(remaining[remaining.length - 1].id);
      } else {
        // 最后一个终端被关闭，整个 session 也被移除了
        setMountedSessions(prev => {
          if (!prev.has(sessionId)) return prev;
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        switchToNextSession(sessionId);
      }
    }
  }, [activeTerminalId]);

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeSessionId), [sessions, activeSessionId]);
  const terminalSubTabScrollStyle = useMemo(() => ({
    '--terminal-list-scrollbar-thumb': withAlpha(terminalSubTabTheme?.xterm?.cursor, 0.32, 'rgba(var(--accent-rgb), 0.32)'),
    '--terminal-list-scrollbar-thumb-hover': withAlpha(terminalSubTabTheme?.xterm?.blue || terminalSubTabTheme?.xterm?.cursor, 0.58, 'rgba(var(--accent-rgb), 0.58)'),
  }), [terminalSubTabTheme]);
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
      return;
    }
    const easing = terminalSubTabDraggingRef.current ? 0.3 : 0.16;
    const nextStep = Math.abs(deltaLeft) < 12
      ? Math.sign(deltaLeft) * Math.max(0.8, Math.abs(deltaLeft) * 0.45)
      : deltaLeft * easing;
    el.scrollLeft = currentLeft + nextStep;
    terminalSubTabScrollFrameRef.current = requestAnimationFrame(stepTerminalSubTabScroll);
  }, []);
  const setTerminalSubTabScrollTarget = useCallback((nextLeft, immediate = false) => {
    const el = terminalSubTabScrollRef.current;
    if (!el) {
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const clampedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    terminalSubTabScrollTargetRef.current = clampedLeft;
    if (immediate) {
      stopTerminalSubTabScrollAnimation();
      el.scrollLeft = clampedLeft;
      return;
    }
    if (!terminalSubTabScrollFrameRef.current) {
      terminalSubTabScrollFrameRef.current = requestAnimationFrame(stepTerminalSubTabScroll);
    }
  }, [stepTerminalSubTabScroll, stopTerminalSubTabScrollAnimation]);
  useEffect(() => () => stopTerminalSubTabScrollAnimation(), [stopTerminalSubTabScrollAnimation]);
  const handleTerminalSubTabScroll = useCallback((e) => {
    if (!terminalSubTabScrollFrameRef.current) {
      terminalSubTabScrollTargetRef.current = e.currentTarget.scrollLeft;
    }
  }, []);
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
  const fileManagerDockDropzones = useMemo(() => {
    const dockTargets = fileManagerDockPreview === 'tab'
      ? ['left', 'bottom']
      : fileManagerDockPreview === 'left'
        ? ['bottom', 'tab']
        : fileManagerDockPreview === 'bottom'
          ? ['left', 'tab']
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
  const isCreatingTerminal = creatingTerminalSessionId !== null;
  const connectedProbeSessions = useMemo(() => sessions.filter((s) => s.status === 'connected'), [sessions]);

  const probePanelNode = connectedProbeSessions.length > 0 ? (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {connectedProbeSessions.map((s) => {
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
              sessionId={s.id}
              host={s.host}
              addToast={addToast}
              enabled={!!monitoringEnabled[s.id]}
              active={isPanelActive}
              onEnable={() => setMonitoringEnabled(prev => ({ ...prev, [s.id]: true }))}
              onShowAllProcesses={() => setContentTab('process')}
              onShowNetworkDetails={() => setContentTab('network')}
            />
          </div>
        );
      })}
    </div>
  ) : null;
  const aiPanelNode = sessions.length > 0 ? (
    <div
      style={{
        width: aiPanelWidth,
        minWidth: aiPanelWidth,
        height: '100%',
        display: showAIPanel ? 'flex' : 'none',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {collapseDragIntent === 'ai' && (
        <div
          className={`panel-collapse-armed-zone panel-collapse-armed-zone-vertical ${probePanelPosition === 'left' ? 'panel-collapse-armed-zone-left' : 'panel-collapse-armed-zone-right'}`}
        >
          {probePanelPosition === 'left' ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </div>
      )}
      {sessions.map((s) => (
        getEffectiveTerminals(s).map((t) => {
          const isPanelActive =
            showAIPanel
            && activeSessionId === s.id
            && activeTerminalId === t.id
            && s.status === 'connected';

          return (
            <div
              key={`ai-panel-${s.id}-${t.id}`}
              style={{
                position: 'absolute',
                inset: 0,
                display: isPanelActive ? 'flex' : 'none',
              }}
            >
              <AIPanel
                width="100%"
                side={probePanelPosition}
                sessionId={s.id}
                terminalId={t.id}
              />
            </div>
          );
        })
      ))}
    </div>
  ) : null;

  // 同步 activeTerminalId 到 ref，记住每个 session 最后选中的终端
  useEffect(() => {
    if (activeSessionId && activeTerminalId) {
      lastTerminalRef.current[activeSessionId] = activeTerminalId;
    }
  }, [activeSessionId, activeTerminalId]);

  // 追踪已访问的 session，仅渲染访问过的 session 组件（避免未激活的 session 创建 xterm/WebSocket）
  useEffect(() => {
    if (activeSessionId) {
      setMountedSessions(prev => {
        if (prev.has(activeSessionId)) return prev;
        const next = new Set(prev);
        next.add(activeSessionId);
        return next;
      });
    }
  }, [activeSessionId]);

  // ── Quick Connect ──────────────────────────────────────────
  const handleQuickConnect = useCallback(() => {
    if (!searchQuery.trim()) return;

    // Check if it matches an existing server name or host
    const existing = servers.find(s => 
      s.name.toLowerCase() === searchQuery.toLowerCase() || 
      s.host === searchQuery
    );

    if (existing) {
      connectServer(existing);
      setSearchQuery('');
      return;
    }

    // Attempt to parse ssh string: [user@]host[:port]
    let user = 'root';
    let host = searchQuery.trim();
    let port = 22;

    if (host.includes('@')) {
      const parts = host.split('@');
      user = parts[0];
      host = parts[1];
    }
    
    if (host.includes(':')) {
      const parts = host.split(':');
      host = parts[0];
      port = parseInt(parts[1], 10) || 22;
    }

    setServerEditor({
      name: host,
      host,
      port,
      username: user,
      authMode: 'password'
    });
    setSearchQuery('');

  }, [searchQuery, servers, connectServer]);

  // ── Server CRUD ────────────────────────────────────────────
  const saveServerConfig = useCallback(async (data) => {
    const dup = serversRef.current.some(s =>
      s.id !== data.id &&
      s.host === data.host &&
      (s.port || 22) === (parseInt(data.port) || 22) &&
      s.username === data.username
    );
    if (dup) {
      addToast(t('已存在相同主机、端口和用户名的服务器'), 'error');
      return null;
    }

    const savedServer = await AppGo.SaveConnection(data, false);
    await loadServers();
    return savedServer;
  }, [loadServers, addToast, t]);

  const handleSaveServer = useCallback(async (data) => {
    try {
      const savedServer = await saveServerConfig(data);
      if (!savedServer) return;
      if (data.id) {
        startSaveFlowAnimation(savedServer, data);
      } else {
        addToast(t('服务器添加成功'), 'success');
        setServerEditor(null);
      }
    } catch (err) {
      addToast(err, 'error');
    }
  }, [saveServerConfig, addToast, t, startSaveFlowAnimation]);

  const handleSaveAndConnectServer = useCallback(async (data) => {
    try {
      const savedServer = await saveServerConfig(data);
      if (!savedServer) return;

      addToast(t('服务器添加成功'), 'success');
      setServerEditor(null);

      const sessionId = `session_${Date.now()}`;
      const newSession = {
        id: sessionId,
        serverId: savedServer.id,
        serverName: savedServer.name || savedServer.host,
        host: savedServer.host,
        status: 'connecting',
        terminals: [{ id: sessionId, label: `${t('终端')}1` }],
      };

      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(sessionId);
      setActiveTerminalId(sessionId);
      setContentTab('terminal');
      setConnectingServers((prev) => [...prev, { server: savedServer, sessionId, startTime: Date.now() }]);

      try {
        await AppGo.ConnectSSH(sessionId, savedServer.id);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
        );
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        await postConnectSetup(sessionId, savedServer.id);
      } catch (err) {
        handleConnectError(sessionId, err);
      }
    } catch (err) {
      addToast(err, 'error');
    }
  }, [saveServerConfig, addToast, t, postConnectSetup, handleConnectError]);

  const handleDeleteServer = useCallback(async (id) => {
    try {
      await AppGo.DeleteConnection(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
      addToast(t('服务器已删除'), 'success');
    } catch {
      addToast(t('删除失败'), 'error');
    }
  }, [addToast]);

  const filteredServers = useMemo(() => {
    if (!searchQuery) return servers;
    const q = searchQuery.toLowerCase();
    return servers.filter((s) =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.host || '').toLowerCase().includes(q) ||
      (s.username || '').toLowerCase().includes(q) ||
      (s.group || '').toLowerCase().includes(q)
    );
  }, [servers, searchQuery]);

  const allGroups = useMemo(() => {
    const s = new Set();
    for (const srv of servers) { if (srv.group) s.add(srv.group); }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [servers]);

  const handleMoveGroup = useCallback(async (serverId, group) => {
    try {
      await AppGo.SetConnectionGroup(serverId, group);
      await loadServers();
      addToast(t('已移动到分组') + (group ? `「${group}」` : ''), 'success');
    } catch (err) {
      addToast(err, 'error');
    }
  }, [loadServers, addToast]);

  const connectedSessions = useMemo(() => {
    const seen = new Set();
    return sessions
      .filter(s => s.status === 'connected')
      .filter((s) => {
        if (seen.has(s.serverId)) return false;
        seen.add(s.serverId);
        return true;
      });
  }, [sessions]);

  const pingCounts = useMemo(() => {
    const vals = Object.values(pings);
    return { online: vals.filter(p => p.online).length, offline: vals.filter(p => !p.online).length };
  }, [pings]);

  const getAnimationViewport = useCallback(() => {
    const rootRect = document.querySelector('.app-layout')?.getBoundingClientRect();
    return {
      left: rootRect?.left || 0,
      top: rootRect?.top || 0,
      width: rootRect?.width || window.innerWidth,
      height: rootRect?.height || window.innerHeight,
    };
  }, []);

  const clampLayerPoint = useCallback((point, viewport, padding = 34) => ({
    x: Math.max(padding, Math.min(viewport.width - padding, point.x)),
    y: Math.max(padding, Math.min(viewport.height - padding, point.y)),
  }), []);

  const rectToLayerPoint = useCallback((rect, viewport) => clampLayerPoint({
    x: rect.left - viewport.left + rect.width / 2,
    y: rect.top - viewport.top + rect.height / 2,
  }, viewport), [clampLayerPoint]);

  const buildFlightMidPoint = useCallback((from, to, viewport, index) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const sway = Math.min(132, Math.max(38, distance * 0.18)) * (index % 2 === 0 ? -1 : 1);
    const lift = Math.min(148, Math.max(60, distance * 0.22)) + index * 8;
    return clampLayerPoint({
      x: (from.x + to.x) / 2 + sway,
      y: Math.min(from.y, to.y) - lift,
    }, viewport, 42);
  }, [clampLayerPoint]);

  const startEditFlyAnimation = useCallback((server, payload) => {
    if (!payload?.sourceRects) {
      setServerEditor(server);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});

    setServerEditor({
      ...server,
      name: '',
      host: '',
      port: '',
      username: '',
      terminalInitPath: '',
      fileManagerInitPath: '',
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const fields = ['name', 'host', 'port', 'username', 'terminalInitPath', 'fileManagerInitPath'];
        const fieldLabels = {
          name: t('服务器别名（选填）'),
          host: t('主机地址 *'),
          port: t('端口'),
          username: t('用户名'),
          terminalInitPath: t('终端默认 cd 目录'),
          fileManagerInitPath: t('文件管理器初始目录'),
        };

        const items = fields.flatMap((field, index) => {
          const sourceRect = payload.sourceRects[field];
          const targetEl = document.querySelector(`[data-editor-field="${field}"]`);
          const targetRect = targetEl?.getBoundingClientRect?.();
          if (!sourceRect || !targetRect) {
            return [];
          }
          const from = rectToLayerPoint(sourceRect, viewport);
          const to = rectToLayerPoint(targetRect, viewport);
          return [{
            id: `${field}-${Date.now()}-${index}`,
            field,
            label: fieldLabels[field],
            value: payload.labels?.[field] || '',
            from,
            to,
            mid: buildFlightMidPoint(from, to, viewport, index),
            delay: index * 52,
          }];
        });

        if (items.length === 0) {
          return;
        }

        setEditFlyAnimation({ id: Date.now(), items });
        items.forEach((item) => {
          const timer = setTimeout(() => {
            setServerEditor((current) => {
              if (!current || current.id !== server.id) {
                return current;
              }
              const nextValue = item.field === 'port'
                ? (server.port || 22)
                : (server[item.field] || '');
              return { ...current, [item.field]: nextValue };
            });
            setEditFlyShiningFields((prev) => ({ ...prev, [item.field]: true }));
            const shineTimer = setTimeout(() => {
              setEditFlyShiningFields((prev) => {
                const next = { ...prev };
                delete next[item.field];
                return next;
              });
            }, 1150);
            editFlyShineTimerRefs.current.push(shineTimer);
          }, item.delay + 560);
          editFlyFieldTimerRefs.current.push(timer);
        });
        editFlyTimerRef.current = setTimeout(() => {
          setEditFlyAnimation(null);
          editFlyTimerRef.current = null;
        }, 980);
      });
    });
  }, [buildFlightMidPoint, getAnimationViewport, rectToLayerPoint, t]);

  const startAddGuideAnimation = useCallback((sourceButton) => {
    if (!sourceButton?.getBoundingClientRect) {
      setServerEditor(null);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});
    setServerEditor(null);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const sourceRect = sourceButton.getBoundingClientRect();
        const titleTargetEl = document.querySelector('[data-editor-add-target="true"]');
        const titleTargetRect = titleTargetEl?.getBoundingClientRect?.();
        const fields = ['host', 'port', 'username'];

        if (!titleTargetRect) {
          return;
        }

        const titleCenter = rectToLayerPoint(titleTargetRect, viewport);
        const addSource = rectToLayerPoint(sourceRect, viewport);
        const now = Date.now();
        const randomBetween = (min, max) => min + Math.random() * (max - min);
        const makeControlPoint = (from, to, index, padding = 28) => {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const normalX = -dy / distance;
          const normalY = dx / distance;
          const preferDown = normalY >= 0 ? 1 : -1;
          const bow = Math.min(120, Math.max(34, distance * randomBetween(0.08, 0.18))) * preferDown;
          const progress = randomBetween(0.36, 0.68);
          return clampLayerPoint({
            x: from.x + dx * progress + normalX * bow + randomBetween(-14, 14),
            y: from.y + dy * progress + normalY * bow + randomBetween(8, 34),
          }, viewport, padding);
        };
        const makePath = (from, control, to) =>
          `path("M ${from.x.toFixed(1)},${from.y.toFixed(1)} Q ${control.x.toFixed(1)},${control.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}")`;

        const coreMid = makeControlPoint(addSource, titleCenter, 0, 56);
        const particles = Array.from({ length: 14 }, (_, index) => {
          const angle = Math.random() * Math.PI * 2;
          const startRadius = randomBetween(7, 22);
          const endRadius = randomBetween(16, 42);
          const from = clampLayerPoint({
            x: addSource.x + Math.cos(angle) * startRadius,
            y: addSource.y + Math.sin(angle) * startRadius,
          }, viewport, 12);
          const to = clampLayerPoint({
            x: titleCenter.x + Math.cos(angle + randomBetween(0.45, 1.45)) * endRadius,
            y: titleCenter.y + Math.sin(angle + randomBetween(0.45, 1.45)) * endRadius,
          }, viewport, 12);
          const mid = makeControlPoint(from, to, index, 38);
          return {
            id: `add-particle-${now}-${index}`,
            type: 'add-particle',
            from,
            to,
            mid,
            path: makePath(from, mid, to),
            size: randomBetween(2.5, 5.5),
            delay: randomBetween(0, 150),
          };
        });

        setEditFlyAnimation({
          id: now,
          items: [
            {
              id: `add-core-${now}`,
              type: 'add-core',
              from: addSource,
              to: titleCenter,
              mid: coreMid,
              path: makePath(addSource, coreMid, titleCenter),
              delay: 0,
            },
            ...particles,
            {
              id: `add-ring-${now}`,
              type: 'add-ring',
              at: titleCenter,
              delay: 820,
            },
          ],
        });

        fields.forEach((field, index) => {
          const timer = setTimeout(() => {
            setEditFlyShiningFields((prev) => ({ ...prev, [field]: true }));
            const shineTimer = setTimeout(() => {
              setEditFlyShiningFields((prev) => {
                const next = { ...prev };
                delete next[field];
                return next;
              });
            }, 980);
            editFlyShineTimerRefs.current.push(shineTimer);
          }, 1040 + index * 105);
          editFlyFieldTimerRefs.current.push(timer);
        });

        editFlyTimerRef.current = setTimeout(() => {
          setEditFlyAnimation(null);
          editFlyTimerRef.current = null;
        }, 2050);
      });
    });
  }, [buildFlightMidPoint, getAnimationViewport, rectToLayerPoint, t]);

  function startSaveFlowAnimation(server, data) {
    const serverId = server?.id || data?.id;
    if (!serverId) {
      setServerEditor(null);
      return;
    }

    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
      editFlyTimerRef.current = null;
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
    setEditFlyShiningFields({});
    setSaveFlowHighlights({ serverId: null, rowPulse: null, fields: {} });

    const getServerTarget = (field) => {
      const nodes = Array.from(document.querySelectorAll(`[data-server-update-id="${serverId}"]`));
      const row = nodes.find((node) => node.offsetParent !== null) || nodes[0];
      if (!row) {
        return null;
      }
      const targetField = field === 'host' || field === 'port' || field === 'username' ? 'hostPort' : field;
      const targetEl = row.querySelector(`[data-edit-source-field="${targetField}"]`) || row;
      return targetEl.getBoundingClientRect?.() || null;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = getAnimationViewport();
        const fields = ['name', 'host', 'port', 'username', 'terminalInitPath', 'fileManagerInitPath'];
        const fieldLabels = {
          name: t('服务器别名（选填）'),
          host: t('主机地址 *'),
          port: t('端口'),
          username: t('用户名'),
          terminalInitPath: t('终端默认 cd 目录'),
          fileManagerInitPath: t('文件管理器初始目录'),
        };

        const items = fields.flatMap((field, index) => {
          const sourceEl = document.querySelector(`[data-editor-field="${field}"]`);
          const sourceRect = sourceEl?.getBoundingClientRect?.();
          const targetRect = getServerTarget(field);
          if (!sourceRect || !targetRect) {
            return [];
          }
          const from = rectToLayerPoint(sourceRect, viewport);
          const to = rectToLayerPoint(targetRect, viewport);
          return [{
            id: `save-flow-${field}-${Date.now()}-${index}`,
            type: 'save-flow-capsule',
            field,
            label: fieldLabels[field],
            value: field === 'port' ? String(data.port || server.port || 22) : String(data[field] || server[field] || ''),
            from,
            to,
            mid: buildFlightMidPoint(from, to, viewport, index + 1),
            delay: index * 90,
          }];
        });

        if (items.length === 0) {
          setServerEditor(null);
          return;
        }

        setEditFlyAnimation({ id: Date.now(), items });
        setEditFlyShiningFields(Object.fromEntries(items.map((item) => [item.field, true])));

        items.forEach((item) => {
          const highlightTimer = setTimeout(() => {
            setSaveFlowHighlights((current) => ({
              serverId,
              rowPulse: item.id,
              fields: { ...current.fields, [item.field]: item.id },
            }));
          }, item.delay + 660);
          const shineTimer = setTimeout(() => {
            setSaveFlowHighlights((current) => {
              if (current.serverId !== serverId) return current;
              const nextFields = { ...current.fields };
              delete nextFields[item.field];
              return {
                serverId,
                rowPulse: current.rowPulse === item.id ? null : current.rowPulse,
                fields: nextFields,
              };
            });
            setEditFlyShiningFields((current) => {
              const next = { ...current };
              delete next[item.field];
              return next;
            });
          }, item.delay + 1420);
          editFlyFieldTimerRefs.current.push(highlightTimer);
          editFlyShineTimerRefs.current.push(shineTimer);
        });

        const closeTimer = setTimeout(() => {
          setServerEditor(null);
        }, Math.max(...items.map((item) => item.delay)) + 980);
        const cleanupTimer = setTimeout(() => {
          setEditFlyAnimation(null);
          setSaveFlowHighlights({ serverId: null, rowPulse: null, fields: {} });
          setEditFlyShiningFields({});
          editFlyTimerRef.current = null;
        }, Math.max(...items.map((item) => item.delay)) + 1660);
        editFlyFieldTimerRefs.current.push(closeTimer);
        editFlyTimerRef.current = cleanupTimer;
      });
    });
  }

  useEffect(() => () => {
    if (editFlyTimerRef.current) {
      clearTimeout(editFlyTimerRef.current);
    }
    editFlyFieldTimerRefs.current.forEach(clearTimeout);
    editFlyFieldTimerRefs.current = [];
    editFlyShineTimerRefs.current.forEach(clearTimeout);
    editFlyShineTimerRefs.current = [];
  }, []);


  return (
    <div className="app-layout">
      {/* ── Topbar ───────────────────────────────────────── */}
      <div className="topbar">
        <div className="topbar-content">
          <div className="topbar-logo" onClick={() => { setActiveSessionId(null); setActiveTerminalId(null); setShowSettings(false); }}>
            <img src={logoImg} alt="Lumin SSH" />
            <div className="topbar-title">Lumin</div>
          </div>
          
          {sessions.length > 0 && (
            <div className="tab-bar">
              <button
                className="btn btn-ghost btn-sm no-drag"
                onClick={() => { setActiveSessionId(null); setActiveTerminalId(null); }}
                title={t('返回主页')}
                style={{ flexShrink: 0 }}
              >
                <House size={14} />
              </button>
              <div className="tab-scroll" ref={tabScrollRef}>
                <div ref={tabListRef} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', height: '100%' }}>
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`tab-item no-drag ${activeSessionId === s.id ? 'active' : ''}`}
                      onClick={() => handleTabClick(s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTabContextMenu({
                          sessionId: s.id,
                          serverName: s.serverName || s.host,
                          x: rect.left,
                          y: rect.bottom + 4,
                        });
                      }}
                    >
                      <span className={`status-dot ${s.status === 'connecting' ? 'connecting' : s.status === 'connected' ? 'online' : 'offline'}`} />
                      <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.serverName}
                      </span>
                      {(s.status === 'closed' || s.status === 'error') && (
                        <span
                          className="tab-reconnect no-drag"
                          onClick={(e) => {
                            e.stopPropagation();
                            reconnectSession(s);
                          }}
                          title={t('重新连接')}
                          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          <RefreshCw size={12} />
                        </span>
                      )}
                      <span className="tab-close no-drag" onClick={(e) => closeSession(s.id, e)}><X size={12} /></span>
                    </div>
                  ))}
                </div>
                <div ref={tabActionsRef} style={{ position: 'sticky', right: 0, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, background: 'transparent' }}>
                  {tabsOverflow && (
                    <button
                      ref={sessionListBtnRef}
                      className="btn btn-icon no-drag"
                      onClick={toggleSessionList}
                      title={t('服务器列表')}
                    >
                      <ChevronDown size={14} />
                    </button>
                  )}
                  {sessions.length >= 2 && (
                    <button
                      className="btn btn-danger btn-sm no-drag"
                      onClick={closeAllSessions}
                      title={t('关闭全部')}
                    >
                      <X size={12} /> {t('关闭全部')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {sessions.length === 0 && <div style={{ flex: 1 }}></div>}

          <div className="window-controls">
            {activeSessionId !== null && sessions.length > 0 && <button className="btn btn-ghost btn-icon no-drag" onClick={() => setAIPanelVisibility(!showAIPanel)} title={showAIPanel ? t('收起 AI 助手面板') : t('打开 AI 助手面板')} aria-label={showAIPanel ? t('收起 AI 助手面板') : t('打开 AI 助手面板')} style={{ color: showAIPanel ? 'var(--accent)' : undefined }}><Bot size={16} /></button>}
            <button className="btn btn-ghost btn-icon no-drag" onClick={() => setShowSettings(true)} title={t('设置')} aria-label={t('设置')}><Settings size={16} /></button>
            <div className="window-divider" />
            <button className="btn btn-ghost btn-icon no-drag" onClick={WindowMinimise} title={t('最小化')} aria-label={t('最小化')}><Minus size={14} /></button>
            <button className="btn btn-ghost btn-icon no-drag" onClick={WindowToggleMaximise} title={t('最大化')} aria-label={t('最大化')}><Square size={14} /></button>
            <button className="btn btn-ghost btn-icon no-drag" title={t('关闭')} aria-label={t('关闭')} onClick={handleCloseWindow}><X size={14} /></button>
          </div>
        </div>
      </div>

      {/* ── Main Area ─────────────────────────────────────── */}
      <main className="main-area">
        <div style={{ display: activeSessionId === null ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%' }}>
          <Dashboard
            editorServer={serverEditor}
            editorShiningFields={editFlyShiningFields}
            saveFlowHighlights={saveFlowHighlights}
            isEditFlying={!!editFlyAnimation}
            onSaveServer={handleSaveServer}
            onSaveAndConnectServer={handleSaveAndConnectServer}
            onCancelEditor={() => setServerEditor(null)}
            allGroups={allGroups}
            credentials={credentials}
            searchQuery={searchQuery}
            onSearchChange={e => setSearchQuery(e.target.value)}
            hideSensitive={hideSensitive}
            onHideSensitiveToggle={() => { const v = !hideSensitive; setHideSensitive(v); localStorage.setItem('hideSensitive', v); }}
            serverListViewMode={serverListViewMode}
            onViewModeChange={(mode) => { setServerListViewMode(mode); localStorage.setItem('serverListViewMode', mode); }}
            servers={servers}
            pingCounts={pingCounts}
            isRefreshingPing={isRefreshingPing}
            onRefreshPing={handleRefreshPing}
            filteredServers={filteredServers}
            pings={pings}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onConnect={connectServer}
            onStartAdd={startAddGuideAnimation}
            onEdit={startEditFlyAnimation}
            onClone={async (s, payload) => {
              try {
                const real = await AppGo.GetConnectionByID(s.id);
                startEditFlyAnimation({ ...real, id: null }, payload);
              } catch {
                startEditFlyAnimation({ ...s, id: null, name: s.name || s.host }, payload);
              }
            }}
            onDelete={handleDeleteServer}
            onMoveGroup={handleMoveGroup}
            addToast={addToast}
            onOpenCredentials={() => setShowCredentials(true)}
          />
        </div>

        <div style={{ display: activeSessionId !== null ? 'flex' : 'none', flexDirection: 'row', height: '100%', flex: 1, overflow: 'hidden', position: 'relative' }}>
          {aiPanelNode && probePanelPosition === 'right' && (
            showAIPanel ? (
              <>
                {aiPanelNode}
                <div
                  className={`split-resizer-v${collapseDragIntent === 'ai' ? ' armed' : ''}`}
                  onMouseDown={(e) => startDrag(e, 'ai')}
                  onClick={() => {
                    if (shouldIgnoreResizerClick()) return;
                    setAIPanelVisibility(false);
                  }}
                  title={t('收起 AI 助手面板')}
                  aria-label={t('收起 AI 助手面板')}
                />
              </>
            ) : (
              <button
                type="button"
                className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                onClick={() => setAIPanelVisibility(true)}
                title={t('打开 AI 助手面板')}
                aria-label={t('打开 AI 助手面板')}
              >
                <ChevronRight size={14} />
              </button>
            )
          )}
          {/* 系统监控探针面板（独立分栏，左侧） */}
          {probePanelNode && probePanelPosition === 'left' && (
            probePanelCollapsed ? (
              <button
                type="button"
                className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                onClick={() => setProbePanelCollapsedPersistent(false)}
                title={t('展开监控面板')}
                aria-label={t('展开监控面板')}
              >
                <ChevronRight size={14} />
              </button>
            ) : (
              <>
                <div
                  className="probe-panel-wrapper probe-panel-wrapper-left"
                  style={{
                    width: probePanelWidth,
                    minWidth: probePanelWidth,
                    height: '100%',
                    display: 'flex',
                    flexShrink: 0,
                    borderLeft: 'none',
                    borderRight: '1px solid var(--border)',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'var(--surface-base)',
                  }}
                >
                  {collapseDragIntent === 'probe' && (
                    <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-right">
                      <ChevronLeft size={14} />
                    </div>
                  )}
                  {probePanelNode}
                </div>
                <div
                  className={`split-resizer-v probe-resizer${collapseDragIntent === 'probe' ? ' armed' : ''}`}
                  onMouseDown={(e) => startDrag(e, 'probe')}
                  onClick={() => {
                    if (shouldIgnoreResizerClick()) return;
                    setProbePanelCollapsedPersistent(true);
                  }}
                  title={t('收起监控面板')}
                  aria-label={t('收起监控面板')}
                />
              </>
            )
          )}
          {/* 左侧主区域：标签、终端子标签、会话内容 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', overflow: 'hidden' }}>
            {/* ── 终端子标签栏（多终端支持） ──────────────────── */}
            {activeSession && (contentTab === 'terminal' || contentTab === 'process' || contentTab === 'network' || contentTab === 'history' || (fileManagerPosition === 'tab' && contentTab === 'files')) && activeSession.status === 'connected' && activeSession.terminals && activeSession.terminals.length >= 1 && (
              <div className="terminal-sub-tab-bar">
                <div
                  ref={terminalSubTabScrollRef}
                  className="terminal-sub-tab-scroll"
                  style={terminalSubTabScrollStyle}
                  onWheel={handleTerminalSubTabWheel}
                  onMouseDown={handleTerminalSubTabMouseDown}
                  onScroll={handleTerminalSubTabScroll}
                  onClickCapture={handleTerminalSubTabClickCapture}
                >
                  {activeSession.terminals.map((term) => (
                    <div
                      key={term.id}
                      className={`terminal-sub-tab ${activeTerminalId === term.id ? 'active' : ''}`}
                      onClick={() => { setActiveTerminalId(term.id); setContentTab('terminal'); lastTerminalRef.current[activeSession.id] = term.id; }}
                      title={term.label}
                    >
                      <Monitor size={11} />
                      <span>{term.label}</span>
                      {activeSession.terminals.length > 1 && (
                        <span
                          className="terminal-sub-tab-close"
                          onClick={(e) => closeTerminal(activeSession.id, term.id, e)}
                        ><X size={10} /></span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="terminal-sub-tab-actions" ref={terminalSubTabActionsRef}>
                  {fileManagerPosition !== 'tab' && (fileManagerDockPreview === 'left' || fileManagerDockPreview === 'bottom') && (
                    <div ref={fileManagerDockTabAnchorRef} className="file-manager-tab-dock-placeholder" aria-hidden="true">
                      <div className={`file-manager-dock-preview-dropzone file-manager-dock-preview-dropzone-inline${fileManagerDockConfirmTarget === 'tab' ? ' active' : ''}`} />
                    </div>
                  )}
                  {fileManagerPosition === 'tab' && (
                    <button
                      className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'files' ? 'active' : ''}`}
                      onMouseDown={(e) => startDrag(e, 'tab')}
                      onClick={() => {
                        if (shouldIgnoreResizerClick()) return;
                        setContentTab(contentTab === 'files' ? 'terminal' : 'files');
                      }}
                    >
                      <Folder size={14} />
                      {t('文件管理')}
                    </button>
                  )}
                  <button
                    className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'process' ? 'active' : ''}`}
                    onClick={() => setContentTab(contentTab === 'process' ? 'terminal' : 'process')}
                  >
                    <Cpu size={14} />
                    {t('进程管理')}
                  </button>
                  <button
                    className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'network' ? 'active' : ''}`}
                    onClick={() => setContentTab(contentTab === 'network' ? 'terminal' : 'network')}
                  >
                    <Globe size={14} />
                    {t('网络监控')}
                  </button>
                  <button
                    className={`btn btn-ghost btn-sm terminal-create-btn terminal-tool-btn ${contentTab === 'history' ? 'active' : ''}`}
                    onClick={() => setContentTab(contentTab === 'history' ? 'terminal' : 'history')}
                  >
                    <ScrollText size={14} />
                    {t('历史指令')}
                  </button>
                  {/* ── 新建终端按钮 ── */}
                  <button
                    className={`btn btn-ghost btn-sm terminal-create-btn ${isCreatingTerminal ? 'is-creating' : ''}`}
                    onClick={() => openNewTerminal(activeSession.id)}
                    style={{ marginLeft: 2, flexShrink: 0 }}
                    disabled={isCreatingTerminal}
                    aria-busy={isCreatingTerminal}
                  >
                    {isCreatingTerminal ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                    {t('新建终端')}
                  </button>
                </div>
              </div>
            )}

            {/* Session Content */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
              {/* 左侧/上侧主体容器 */}
              <div id="session-editor-container" style={{ flex: 1, display: 'flex', flexDirection: fileManagerPosition === 'bottom' ? 'column' : 'row', height: '100%', position: 'relative', overflow: 'hidden' }}>
                {/* 主体视口 */}
                <div id="editor-main-content" style={{ flex: 1, position: 'relative', overflow: 'hidden', order: 1 }}>
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: activeSessionId === s.id ? 'flex' : 'none',
                        flexDirection: fileManagerPosition === 'bottom' ? 'column' : 'row',
                      }}
                    >
                    {/* 辅助视口 (分屏模式下的文件管理器，如果是左侧则排在前面) */}
                    {s.status === 'connected' && fileManagerPosition === 'left' && contentTab !== 'process' && contentTab !== 'network' && mountedSessions.has(s.id) && (
                      fileManagerCollapsed ? (
                        <button
                          type="button"
                          className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                          onClick={() => setFileManagerCollapsedPersistent(false)}
                          title={t('展开文件管理面板')}
                          aria-label={t('展开文件管理面板')}
                        >
                          <ChevronRight size={14} />
                        </button>
                      ) : (
                        <>
                          <div style={{
                            width: leftSplitWidth + 'px',
                            borderRight: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: FILE_MANAGER_LEFT_MIN,
                            flexShrink: 0,
                            position: 'relative',
                            overflow: 'hidden',
                          }}>
                            {collapseDragIntent === 'left' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-right">
                                <ChevronLeft size={14} />
                              </div>
                            )}
                            {renderSessionFileManagers(s)}
                          </div>
                          <div
                            className={`split-resizer-v${collapseDragIntent === 'left' ? ' armed' : ''}`}
                            onMouseDown={(e) => startDrag(e, 'left')}
                            onClick={() => {
                              if (shouldIgnoreResizerClick()) return;
                              setFileManagerCollapsedPersistent(true);
                            }}
                            title={t('收起文件管理面板')}
                            aria-label={t('收起文件管理面板')}
                            style={{ zIndex: Z.PANEL_BUTTON, marginLeft: '-2px', marginRight: '-2px' }}
                          />
                        </>
                      )
                    )}

                    {/* 主要视口 (终端/标签页模式下的文件) */}
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
                      <div style={{ display: (contentTab === 'terminal' || s.status !== 'connected') ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', position: 'relative' }}>
                        {mountedSessions.has(s.id) && (s.terminals && s.terminals.length > 0 ? s.terminals : [{ id: s.id, label: t('终端') }]).map((t) => {
                          const isTermActive = (contentTab === 'terminal' || s.status !== 'connected') && activeTerminalId === t.id;
                          return (
                          <div key={t.id} style={{
                            position: 'absolute', inset: 0,
                            display: 'flex',
                            visibility: isTermActive ? 'visible' : 'hidden',
                            pointerEvents: isTermActive ? 'auto' : 'none',
                            contain: isTermActive ? 'none' : 'strict',
                            flexDirection: 'column',
                          }}>
                            <ErrorBoundary label={`终端 ${t.id} 渲染出错`}>
                              <Terminal
                                sessionId={t.id}
                                serverId={s.id}
                                historyServerId={s.serverId}
                                status={s.status}
                                isActive={activeSessionId === s.id && activeTerminalId === t.id && (contentTab === 'terminal' || fileManagerPosition !== 'tab')}
                                serverName={s.serverName}
                                connectedSessions={connectedSessions}
                              />
                            </ErrorBoundary>
                          </div>
                        );
                        })}
                      </div>
                      {s.status === 'connected' && fileManagerPosition === 'tab' && mountedSessions.has(s.id) && (
                        <div style={{ display: contentTab === 'files' ? 'flex' : 'none', height: '100%', flex: 1, flexDirection: 'column' }}>
                          {renderSessionFileManagers(s)}
                        </div>
                      )}
                      {s.status === 'connected' && mountedSessions.has(s.id) && (
                        <div style={{ display: contentTab === 'history' ? 'block' : 'none', height: '100%', flex: 1 }}>
                          <CommandHistory
                            sessionId={s.id}
                            historyServerId={s.serverId}
                            addToast={addToast}
                          />
                        </div>
                      )}
                      {s.status === 'connected' && mountedSessions.has(s.id) && (
                        <div style={{ display: contentTab === 'process' ? 'flex' : 'none', height: '100%', flex: 1, minWidth: 0, minHeight: 0 }}>
                          <ProcessPage
                            sessionId={s.id}
                            addToast={addToast}
                            active={contentTab === 'process' && activeSessionId === s.id}
                          />
                        </div>
                      )}
                      {s.status === 'connected' && mountedSessions.has(s.id) && (
                        <div style={{ display: contentTab === 'network' ? 'flex' : 'none', height: '100%', flex: 1, minWidth: 0, minHeight: 0 }}>
                          <NetworkPage
                            sessionId={s.id}
                            active={contentTab === 'network' && activeSessionId === s.id}
                          />
                        </div>
                      )}
                    </div>

                    {/* 辅助视口 (分屏模式下的文件管理器，如果是底部则排在后面) */}
                    {s.status === 'connected' && fileManagerPosition === 'bottom' && contentTab !== 'process' && contentTab !== 'network' && mountedSessions.has(s.id) && (
                      fileManagerCollapsed ? (
                        <button
                          type="button"
                          className="panel-collapse-strip panel-collapse-strip-horizontal panel-collapse-strip-bottom no-drag"
                          onClick={() => setFileManagerCollapsedPersistent(false)}
                          title={t('展开文件管理面板')}
                          aria-label={t('展开文件管理面板')}
                        >
                          <ChevronDown size={14} />
                        </button>
                      ) : (
                        <>
                          <div
                            className={`split-resizer-h${collapseDragIntent === 'bottom' ? ' armed' : ''}`}
                            onMouseDown={(e) => startDrag(e, 'bottom')}
                            onClick={() => {
                              if (shouldIgnoreResizerClick()) return;
                              setFileManagerCollapsedPersistent(true);
                            }}
                            title={t('收起文件管理面板')}
                            aria-label={t('收起文件管理面板')}
                            style={{ zIndex: Z.PANEL_BUTTON, marginTop: '-2px', marginBottom: '-2px' }}
                          />
                          <div style={{
                            height: bottomSplitHeight + 'px',
                            borderTop: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: FILE_MANAGER_BOTTOM_MIN,
                            flexShrink: 0,
                            position: 'relative',
                            overflow: 'hidden',
                          }}>
                            {collapseDragIntent === 'bottom' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-horizontal panel-collapse-armed-zone-top">
                                <ChevronDown size={14} />
                              </div>
                            )}
                            {renderSessionFileManagers(s)}
                          </div>
                        </>
                      )
                    )}
                  </div>
                ))}
              </div>
              {fileManagerDockDropzones.filter(({ target }) => target !== 'tab').map(({ target, style }) => (
                <div
                  key={target}
                  className={`file-manager-dock-preview-dropzone${fileManagerDockConfirmTarget === target ? ' active' : ''}`}
                  style={{ ...style, zIndex: Z.PANEL_BUTTON + 6 }}
                />
              ))}
              {/* 文件编辑器分栏 host（由 FileEditor 通过 Portal 渲染） */}
              <div
                className="split-resizer-v"
                style={{ display: 'none', order: 1 }}
                id="editor-split-resizer"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const host = document.getElementById('editor-split-host');
                  if (!host) return;
                  const container = document.getElementById('session-editor-container');
                  const rect = container.getBoundingClientRect();
                  const startX = e.clientX;
                  const startW = host.getBoundingClientRect().width;
                  const splitPos = host.style.order === '0' ? 'left' : 'right';
                  const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const newW = splitPos === 'right'
                      ? Math.max(200, Math.min(rect.width - 200, startW - dx))
                      : Math.max(200, Math.min(rect.width - 200, startW + dx));
                    host.style.width = newW + 'px';
                    host.style.transition = 'none';
                    window.dispatchEvent(new Event('resize'));
                  };
                  const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    host.style.transition = '';
                  };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                }}
              />
              <div id="editor-split-host" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', order: 2, width: 0, transition: 'width 0.2s ease, height 0.2s ease' }} />
              {activeChangeReview ? (
                <AIChangeReviewWorkbench
                  review={activeChangeReview}
                  queueLength={changeReviewQueue.length}
                />
              ) : null}
            </div>
            </div>
          </div>

          {/* 系统监控探针面板（独立分栏，右侧） */}
          {probePanelNode && probePanelPosition === 'right' && (
            probePanelCollapsed ? (
              <button
                type="button"
                className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag"
                onClick={() => setProbePanelCollapsedPersistent(false)}
                title={t('展开监控面板')}
                aria-label={t('展开监控面板')}
              >
                <ChevronLeft size={14} />
              </button>
            ) : (
              <>
                <div
                  className={`split-resizer-v probe-resizer${collapseDragIntent === 'probe' ? ' armed' : ''}`}
                  onMouseDown={(e) => startDrag(e, 'probe')}
                  onClick={() => {
                    if (shouldIgnoreResizerClick()) return;
                    setProbePanelCollapsedPersistent(true);
                  }}
                  title={t('收起监控面板')}
                  aria-label={t('收起监控面板')}
                />
                <div
                  className="probe-panel-wrapper"
                  style={{
                    width: probePanelWidth,
                    minWidth: probePanelWidth,
                    height: '100%',
                    display: 'flex',
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'hidden',
                    borderLeft: '1px solid var(--border)',
                    background: 'var(--surface-base)',
                  }}
                >
                  {collapseDragIntent === 'probe' && (
                    <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-left">
                      <ChevronRight size={14} />
                    </div>
                  )}
                  {probePanelNode}
                </div>
              </>
            )
          )}
          {aiPanelNode && probePanelPosition === 'left' && (
            showAIPanel ? (
              <>
                <div
                  className={`split-resizer-v${collapseDragIntent === 'ai' ? ' armed' : ''}`}
                  onMouseDown={(e) => startDrag(e, 'ai')}
                  onClick={() => {
                    if (shouldIgnoreResizerClick()) return;
                    setAIPanelVisibility(false);
                  }}
                  title={t('收起 AI 助手面板')}
                  aria-label={t('收起 AI 助手面板')}
                />
                {aiPanelNode}
              </>
            ) : (
              <button
                type="button"
                className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag"
                onClick={() => setAIPanelVisibility(true)}
                title={t('打开 AI 助手面板')}
                aria-label={t('打开 AI 助手面板')}
              >
                <ChevronLeft size={14} />
              </button>
            )
          )}
        </div>
      </main>

      {/* ── Modals ────────────────────────────────────────── */}
      {showSettings && (
        <SettingsModal
          onClose={() => { setShowSettings(false); loadServers(); }}
          addToast={addToast}
          onRestored={loadServers}
          probePanelPosition={probePanelPosition}
          onProbePanelPositionChange={(val) => {
            setProbePanelPosition(val);
            localStorage.setItem('probePanelPosition', val);
          }}
        />
      )}

      {showCredentials && (
        <CredentialsModal
          onClose={() => { setShowCredentials(false); loadServers(); }}
          onChange={loadServers}
          addToast={addToast}
        />
      )}

      {editFlyAnimation && (
        <div className="edit-fly-layer" aria-hidden="true">
          {editFlyAnimation.items.map((item) => (
            item.type === 'beam' ? (
              <div
                key={item.id}
                className={`edit-fly-beam edit-fly-beam-${item.field}`}
                style={{
                  '--beam-from-x': `${item.from.x}px`,
                  '--beam-from-y': `${item.from.y}px`,
                  '--beam-length': item.length,
                  '--beam-angle': item.angle,
                  '--beam-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'add-core' ? (
              <div
                key={item.id}
                className="add-supernova-core"
                style={{
                  '--add-path': item.path,
                  '--add-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'add-particle' ? (
              <div
                key={item.id}
                className="add-supernova-particle"
                style={{
                  '--particle-path': item.path,
                  '--particle-size': `${item.size}px`,
                  '--particle-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'add-ring' ? (
              <div
                key={item.id}
                className="add-supernova-ring"
                style={{
                  '--ring-x': `${item.at.x}px`,
                  '--ring-y': `${item.at.y}px`,
                  '--ring-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'save-flow-capsule' ? (
              <div
                key={item.id}
                className={`save-flow-capsule save-flow-capsule-${item.field}`}
                style={{
                  '--save-flow-from-x': `${item.from.x}px`,
                  '--save-flow-from-y': `${item.from.y}px`,
                  '--save-flow-mid-x': `${item.mid.x}px`,
                  '--save-flow-mid-y': `${item.mid.y}px`,
                  '--save-flow-to-x': `${item.to.x}px`,
                  '--save-flow-to-y': `${item.to.y}px`,
                  '--save-flow-delay': `${item.delay}ms`,
                }}
              >
                <span className="edit-fly-label">{item.label}</span>
                {item.value ? <span className="edit-fly-value">{item.value}</span> : null}
              </div>
            ) : (
              <div
                key={item.id}
                className={`edit-fly-capsule edit-fly-capsule-${item.field}`}
                style={{
                  '--fly-from-x': `${item.from.x}px`,
                  '--fly-from-y': `${item.from.y}px`,
                  '--fly-mid-x': `${item.mid.x}px`,
                  '--fly-mid-y': `${item.mid.y}px`,
                  '--fly-to-x': `${item.to.x}px`,
                  '--fly-to-y': `${item.to.y}px`,
                  '--fly-delay': `${item.delay}ms`,
                }}
              >
                <span className="edit-fly-label">{item.label}</span>
                {item.value ? <span className="edit-fly-value">{item.value}</span> : null}
              </div>
            )
          ))}
        </div>
      )}

      {/* ── Toasts ────────────────────────────────────────── */}
      <Toast toasts={toasts} />
      <GlobalDialog />

      {/* ── 连接进度卡片（只跟随当前激活会话） ── */}
      {connectingServers.map(cs =>
        cs.sessionId === activeSessionId && (
          <ConnectingCard
            key={cs.sessionId}
            connectingServer={cs}
            t={t}
            onCancel={() => handleCancelConnection(cs.sessionId)}
          />
        )
      )}

      {/* ── 自动更新弹窗 ──────────────────────────────── */}
      <UpdateModal
        visible={isUpdateModalVisible}
        updateInfo={startupUpdateInfo}
        downloadProgress={downloadProgress}
        t={t}
        onClose={() => setIsUpdateModalVisible(false)}
        onUpdate={handleApplyStartupUpdate}
      />

      {/* ── 云端同步失败弹窗 ──────────────────────────── */}
      {syncFailed && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1100,
          width: 380, background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-md)',
          borderRadius: 10, padding: '16px 20px',
          animation: 'slideUp 0.18s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>⚠</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {t('云端同步失败')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
                {t('数据未能上传到云端，本地数据不受影响。')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(var(--danger-rgb), 0.08)', padding: '6px 10px', borderRadius: 8, marginBottom: 14, wordBreak: 'break-all', lineHeight: 1.5 }}>
                {syncFailed.error}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s' }}
                  onClick={() => setSyncFailed(null)}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
                >
                  {t('忽略')}
                </button>
                <button
                  style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'var(--primary)', border: 'none', color: '#fff', cursor: 'pointer', transition: 'all 0.2s' }}
                  onClick={async () => {
                    setSyncFailed(null);
                    const err = await AppGo.RetrySync();
                    if (err) {
                      setSyncFailed({ provider: '', error: err });
                    } else {
                      addToast(t('同步成功'), 'success', 3000);
                    }
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {t('重试')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <GlobalContextMenu />

      {/* ── 标签右键菜单 ── */}
      {tabContextMenu && (
        <div className="tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }}>
            <div
              className="tab-context-menu-item"
              onClick={() => {
                const sessionId = tabContextMenu.sessionId;
                setTabContextMenu(null);
                forceCloseSession(sessionId);
              }}
            >
              <X size={14} /> {t('关闭连接')}
            </div>
            {sessions.length >= 2 && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <div
                  className="tab-context-menu-item"
                  onClick={() => {
                    setTabContextMenu(null);
                    closeAllSessions();
                  }}
                >
                  <X size={14} /> {t('关闭全部')}
                </div>
              </>
            )}
          </div>
      )}
      {/* ── 服务器列表下拉 ── */}
      {showSessionList && (
        <div
          ref={sessionListRef}
          className="tab-context-menu"
          style={{ left: sessionListPos.x - 240, top: sessionListPos.y, minWidth: 240, maxHeight: 400, display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
            <input
              type="text"
              value={sessionListQuery}
              onChange={(e) => setSessionListQuery(e.target.value)}
              placeholder={t('搜索服务器')}
              autoFocus
              style={{ width: '100%', padding: '4px 8px 4px 26px', fontSize: 12, background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', outline: 'none' }}
            />
            <Search size={13} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {sessions
              .filter(s => !sessionListQuery || (s.serverName || '').toLowerCase().includes(sessionListQuery.toLowerCase()) || (s.host || '').toLowerCase().includes(sessionListQuery.toLowerCase()))
              .map(s => (
                <div
                  key={s.id}
                  className="tab-context-menu-item"
                  onClick={() => { handleTabClick(s.id); setShowSessionList(false); }}
                  style={{ fontWeight: activeSessionId === s.id ? 700 : 400, color: activeSessionId === s.id ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  <span className={`status-dot ${s.status === 'connecting' ? 'connecting' : s.status === 'connected' ? 'online' : 'offline'}`} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.serverName}</span>
                  <span
                    onClick={(e) => { e.stopPropagation(); closeSession(s.id, e); }}
                    title={t('关闭')}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.5, flexShrink: 0 }}
                  >
                    <X size={13} />
                  </span>
                </div>
              ))}
            {sessions.filter(s => !sessionListQuery || (s.serverName || '').toLowerCase().includes(sessionListQuery.toLowerCase()) || (s.host || '').toLowerCase().includes(sessionListQuery.toLowerCase())).length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>{t('无匹配结果')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
