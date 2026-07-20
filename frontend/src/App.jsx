import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EventsOn, WindowMinimise, WindowToggleMaximise, WindowHide, WindowShow, WindowSetSize, WindowGetSize, WindowIsMaximised, WindowMaximise } from '../wailsjs/runtime/runtime.js';
import * as AppGo from '../wailsjs/go/main/App.js';
import Terminal from './components/Terminal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProbePanel from './components/ProbePanel.jsx';
import FileManager from './components/FileManager.jsx';
import AIPanel from './components/AIPanel.jsx';
import AIChangeReviewWorkbench from './components/ai/AIChangeReviewWorkbench.jsx';
import AIConversationDiffOverlay from './components/ai/AIConversationDiffOverlay.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { isRecoveryPasswordError, syncWithRecoveryPassword } from './utils/recoveryPasswordSync.js';
import {
  getAllSessionFileManagerWorkspaces,
  remapSessionFileManagerWorkspaces,
  replaceAllSessionFileManagerWorkspaces,
} from './utils/fileWorkbench.js';
import CredentialsModal from './components/CredentialsModal.jsx';
import Toast from './components/Toast.jsx';
import CommandHistory from './components/CommandHistory.jsx';
import QuickCommands from './components/QuickCommands.jsx';
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
import ImportExportDialog from './components/ImportExportDialog.jsx';
import ExportSelectedDialog from './components/ExportSelectedDialog.jsx';
import Tiptop from './components/Tiptop.jsx';
import { restoreAIChatTool } from './components/ai/aiChatBridge.js';
import { Bot, Settings, House, Minus, Square, X, Plus, Monitor, RefreshCw, Folder, ScrollText, Cpu, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Search, Globe, Rocket, Copy, Sun, Moon } from 'lucide-react';
import { Z } from './constants/zIndex';

import logoImg from './assets/logo.png';
import logoLightImg from './assets/logo_q.png';
import logoDarkImg from './assets/logo_s.png';

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

const FILE_MANAGER_LEFT_MIN = 180;
const FILE_MANAGER_BOTTOM_MIN = 100;
const PROBE_PANEL_MIN = 280;
const AI_PANEL_MIN = 450;
const COLLAPSE_ARMED_SIZE = 52;
const FILE_MANAGER_DOCK_HOTZONE = 88;
const TERMINAL_DOCK_LONG_PRESS_MS = 280;
const TERMINAL_PANE_CELL_IDS = ['tl', 'tr', 'bl', 'br'];
const TERMINAL_PANE_CELL_META = {
  tl: { row: 0, col: 0 },
  tr: { row: 0, col: 1 },
  bl: { row: 1, col: 0 },
  br: { row: 1, col: 1 },
};

function sortTerminalPaneCells(cells) {
  return TERMINAL_PANE_CELL_IDS.filter((cellId) => Array.isArray(cells) && cells.includes(cellId));
}

function getTerminalPaneRect(cells) {
  const normalized = sortTerminalPaneCells(cells);
  if (normalized.length === 0) {
    return null;
  }
  const rows = normalized.map((cellId) => TERMINAL_PANE_CELL_META[cellId].row);
  const cols = normalized.map((cellId) => TERMINAL_PANE_CELL_META[cellId].col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  return {
    minRow,
    maxRow,
    minCol,
    maxCol,
    width: maxCol - minCol + 1,
    height: maxRow - minRow + 1,
  };
}

function getTerminalPaneCellsFromRect(rect) {
  if (!rect) {
    return [];
  }
  return TERMINAL_PANE_CELL_IDS.filter((cellId) => {
    const meta = TERMINAL_PANE_CELL_META[cellId];
    return meta.row >= rect.minRow
      && meta.row <= rect.maxRow
      && meta.col >= rect.minCol
      && meta.col <= rect.maxCol;
  });
}

function getTerminalPaneRemainingCells(panes) {
  const occupied = new Set((panes || []).flatMap((pane) => sortTerminalPaneCells(pane.cells)));
  return TERMINAL_PANE_CELL_IDS.filter((cellId) => !occupied.has(cellId));
}

function getTerminalDockTargetPreferences(target) {
  switch (target) {
    case 'top-left':
      return { primary: 'up', secondary: 'left' };
    case 'top-right':
      return { primary: 'right', secondary: 'up' };
    case 'bottom-left':
      return { primary: 'left', secondary: 'down' };
    case 'bottom-right':
      return { primary: 'down', secondary: 'right' };
    default:
      return { primary: null, secondary: null };
  }
}

function getTerminalDockTargetCellId(target) {
  switch (target) {
    case 'top-left':
      return 'tl';
    case 'top-right':
      return 'tr';
    case 'bottom-left':
      return 'bl';
    case 'bottom-right':
      return 'br';
    default:
      return null;
  }
}

function getTerminalPaneSplitDirection(rect, target) {
  if (!rect) {
    return null;
  }
  const { primary, secondary } = getTerminalDockTargetPreferences(target);
  const canSplit = (direction) => {
    if (direction === 'left' || direction === 'right') {
      return rect.width >= 2;
    }
    if (direction === 'up' || direction === 'down') {
      return rect.height >= 2;
    }
    return false;
  };
  if (primary && canSplit(primary)) {
    return primary;
  }
  if (secondary && canSplit(secondary)) {
    return secondary;
  }
  return null;
}

function splitTerminalPaneCells(cells, target) {
  const rect = getTerminalPaneRect(cells);
  const direction = getTerminalPaneSplitDirection(rect, target);
  if (!rect || !direction) {
    return null;
  }

  if (direction === 'left' || direction === 'right') {
    const leftRect = { ...rect, maxCol: rect.minCol };
    const rightRect = { ...rect, minCol: rect.maxCol };
    const newRect = direction === 'left' ? leftRect : rightRect;
    const remainingRect = direction === 'left' ? rightRect : leftRect;
    return {
      direction,
      newCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(newRect)),
      remainingCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(remainingRect)),
    };
  }

  const topRect = { ...rect, maxRow: rect.minRow };
  const bottomRect = { ...rect, minRow: rect.maxRow };
  const newRect = direction === 'up' ? topRect : bottomRect;
  const remainingRect = direction === 'up' ? bottomRect : topRect;
  return {
    direction,
    newCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(newRect)),
    remainingCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(remainingRect)),
  };
}

function getTerminalPaneGridPlacement(cells) {
  const rect = getTerminalPaneRect(cells);
  if (!rect) {
    return {};
  }
  return {
    gridColumn: `${rect.minCol + 1} / span ${rect.width}`,
    gridRow: `${rect.minRow + 1} / span ${rect.height}`,
  };
}

function getTerminalPaneAbsolutePlacement(cells) {
  const rect = getTerminalPaneRect(cells);
  if (!rect) {
    return {};
  }
  return {
    left: `${rect.minCol * 50}%`,
    top: `${rect.minRow * 50}%`,
    width: `${rect.width * 50}%`,
    height: `${rect.height * 50}%`,
  };
}

function remapTerminalPaneLayouts(layouts, idMap, sessionId) {
  const next = {};
  Object.entries(layouts || {}).forEach(([layoutId, layout]) => {
    if (layout?.sessionId !== sessionId) {
      next[layoutId] = layout;
      return;
    }
    const mappedLayoutId = idMap[layoutId] || layoutId;
    const mappedRootTerminalId = idMap[layout.rootTerminalId || layoutId] || layout.rootTerminalId || layoutId;
    next[mappedLayoutId] = {
      ...layout,
      sessionId,
      rootTerminalId: mappedRootTerminalId,
      panes: (layout.panes || []).map((pane) => ({
        ...pane,
        terminalId: idMap[pane.terminalId] || pane.terminalId,
        cells: sortTerminalPaneCells(pane.cells),
      })),
    };
  });
  return next;
}

function isTerminalPaneRectangular(cells) {
  const normalized = sortTerminalPaneCells(cells);
  const rect = getTerminalPaneRect(normalized);
  if (!rect) {
    return false;
  }
  return sortTerminalPaneCells(getTerminalPaneCellsFromRect(rect)).join(',') === normalized.join(',');
}

function getTerminalPaneCellsForOrientation(anchorCellId, orientation) {
  const meta = TERMINAL_PANE_CELL_META[anchorCellId];
  if (!meta) {
    return null;
  }
  if (orientation === 'rows') {
    return sortTerminalPaneCells(TERMINAL_PANE_CELL_IDS.filter((cellId) => TERMINAL_PANE_CELL_META[cellId].row === meta.row));
  }
  if (orientation === 'cols') {
    return sortTerminalPaneCells(TERMINAL_PANE_CELL_IDS.filter((cellId) => TERMINAL_PANE_CELL_META[cellId].col === meta.col));
  }
  return null;
}

function getTerminalPaneDiffCount(sourceCells, targetCells) {
  const source = new Set(sortTerminalPaneCells(sourceCells));
  const target = new Set(sortTerminalPaneCells(targetCells));
  return TERMINAL_PANE_CELL_IDS.reduce((count, cellId) => (
    count + (source.has(cellId) === target.has(cellId) ? 0 : 1)
  ), 0);
}

function normalizeTwoTerminalPaneLayout(rootCells, pane, preferredOrientation = null) {
  const anchorCellId = sortTerminalPaneCells(pane?.cells)[0];
  if (!anchorCellId) {
    return null;
  }

  const orientations = preferredOrientation === 'rows' || preferredOrientation === 'cols'
    ? [preferredOrientation, preferredOrientation === 'rows' ? 'cols' : 'rows']
    : ['rows', 'cols'];

  const candidates = orientations.map((orientation, index) => {
    const paneCells = getTerminalPaneCellsForOrientation(anchorCellId, orientation);
    if (!paneCells) {
      return null;
    }
    const nextRootCells = getTerminalPaneRemainingCells([{ cells: paneCells }]);
    return {
      orientation,
      paneCells,
      rootCells: nextRootCells,
      preferredRank: index,
      diff: getTerminalPaneDiffCount(rootCells, nextRootCells) + getTerminalPaneDiffCount(pane.cells, paneCells),
    };
  }).filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.diff !== right.diff) {
      return left.diff - right.diff;
    }
    if (left.preferredRank !== right.preferredRank) {
      return left.preferredRank - right.preferredRank;
    }
    return left.orientation === 'rows' ? -1 : 1;
  });

  return candidates[0];
}

function buildAIWorkspaceTerminalPanelKey(sessionId, terminalId) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const normalizedTerminalId = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!normalizedSessionId || !normalizedTerminalId) {
    return '';
  }
  return `${normalizedSessionId}::${normalizedTerminalId}`;
}

function formatAIQuotedSelection(text) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) {
    return '';
  }
  return `[引用]>\`${normalizedText}\`\n----\n`;
}

function resolveAIWorkspaceTerminalBindingByTerminalId(sessions, terminalId) {
  const normalizedTerminalId = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!normalizedTerminalId) {
    return null;
  }
  const list = Array.isArray(sessions) ? sessions : [];
  const exactSession = list.find((session) => session?.id === normalizedTerminalId);
  if (exactSession) {
    return {
      sessionId: exactSession.id,
      terminalId: normalizedTerminalId,
    };
  }
  const parentSession = list.find((session) => Array.isArray(session?.terminals) && session.terminals.some((terminal) => terminal?.id === normalizedTerminalId));
  if (parentSession) {
    return {
      sessionId: parentSession.id,
      terminalId: normalizedTerminalId,
    };
  }
  return null;
}

function mergeRestoredWorkspaceSessions(currentSessions, nextRestoredSessions, restoringSessionIds) {
  const currentList = Array.isArray(currentSessions) ? currentSessions : [];
  const restoredMap = new Map((Array.isArray(nextRestoredSessions) ? nextRestoredSessions : []).map((session) => [session.id, session]));
  return currentList.map((session) => {
    if (!restoringSessionIds.has(session?.id) || !restoredMap.has(session.id)) {
      return session;
    }
    return restoredMap.get(session.id);
  });
}

function mergeRestoredWorkspaceLayouts(currentLayouts, nextRestoredLayouts, restoringSessionIds, activeSessionIds) {
  const merged = {};
  Object.entries(currentLayouts || {}).forEach(([layoutId, layout]) => {
    const sessionId = layout?.sessionId;
    if (!sessionId || !restoringSessionIds.has(sessionId)) {
      merged[layoutId] = layout;
    }
  });
  Object.entries(nextRestoredLayouts || {}).forEach(([layoutId, layout]) => {
    const sessionId = layout?.sessionId;
    if (!sessionId || !restoringSessionIds.has(sessionId) || !activeSessionIds.has(sessionId)) {
      return;
    }
    merged[layoutId] = layout;
  });
  return merged;
}

function remapSessionFileManagerWorkspaceMap(workspaces, idMap) {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {};
  const next = {};
  Object.entries(workspaces || {}).forEach(([terminalId, workspace]) => {
    next[sourceMap[terminalId] || terminalId] = workspace;
  });
  return next;
}

function normalizeWorkspaceContentTab(value) {
  return value === 'files' || value === 'process' || value === 'network' || value === 'history'
    ? value
    : 'terminal';
}

function remapSessionWorkspaceLayouts(layouts, idMap, targetSessionId) {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {};
  const next = {};
  Object.entries(layouts || {}).forEach(([layoutId, layout]) => {
    const mappedLayoutId = sourceMap[layoutId] || layoutId;
    const mappedRootTerminalId = sourceMap[layout?.rootTerminalId || layoutId] || layout?.rootTerminalId || layoutId;
    next[mappedLayoutId] = {
      ...layout,
      sessionId: targetSessionId,
      rootTerminalId: mappedRootTerminalId,
      panes: (layout?.panes || []).map((pane) => ({
        ...pane,
        terminalId: sourceMap[pane.terminalId] || pane.terminalId,
        cells: sortTerminalPaneCells(pane.cells),
      })),
    };
  });
  return next;
}

export default function App() {
  const { t, lang } = useTranslation();
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
  // 批量选择
  const [batchSelectionMode, setBatchSelectionMode] = useState(false);
  const [selectedServerIds, setSelectedServerIds] = useState([]);
  const activeSessionIdRef = useRef(null);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const activeTerminalIdRef = useRef(null);
  useEffect(() => { activeTerminalIdRef.current = activeTerminalId; }, [activeTerminalId]);
  const [rememberWorkspace, setRememberWorkspace] = useState(false);
  const [workspacePersistenceLevel, setWorkspacePersistenceLevel] = useState('program');
  const [rememberWorkspaceLoaded, setRememberWorkspaceLoaded] = useState(false);
  const [workspaceRestoreReady, setWorkspaceRestoreReady] = useState(false);
  const [terminalPaneLayouts, setTerminalPaneLayouts] = useState({});
  const terminalPaneLayoutsRef = useRef({});
  useEffect(() => { terminalPaneLayoutsRef.current = terminalPaneLayouts; }, [terminalPaneLayouts]);
  const persistWorkspaceSnapshotRef = useRef(() => {});
  const terminalPaneIdRef = useRef(0);
  const [serversLoaded, setServersLoaded] = useState(false);
  const workspaceRestoreStartedRef = useRef(false);
  const restoringWorkspaceRef = useRef(false);
  const workspaceRestoreNavigationOverrideRef = useRef(false);
  const [restoringWorkspaceSessionIds, setRestoringWorkspaceSessionIds] = useState(new Set());
  const lastTerminalRef = useRef({}); // 记录每个 session 最后选中的终端
  const lastContentTabRef = useRef({}); // 记录每个 session 最后打开的内容页（终端/进程/网络等）
  const [mountedSessions, setMountedSessions] = useState(new Set());
  const [contentTab, setContentTab] = useState('terminal'); // 'terminal' | 'files' | 'process' | 'network' | 'history'
  const contentTabRef = useRef(contentTab);
  useEffect(() => { contentTabRef.current = contentTab; }, [contentTab]);
  const [serverEditor, setServerEditor] = useState(null);
  const [editFlyAnimation, setEditFlyAnimation] = useState(null);
  const [editFlyShiningFields, setEditFlyShiningFields] = useState({});
  const [saveFlowHighlights, setSaveFlowHighlights] = useState({ serverId: null, rowPulse: null, fields: {} });
  const editFlyTimerRef = useRef(null);
  const editFlyFieldTimerRefs = useRef([]);
  const editFlyShineTimerRefs = useRef([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('general');
  const [showCredentials, setShowCredentials] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState(null);
  const [terminalTabContextMenu, setTerminalTabContextMenu] = useState(null);
  useEffect(() => {
    if (!tabContextMenu && !terminalTabContextMenu) return;
    const close = () => {
      setTabContextMenu(null);
      setTerminalTabContextMenu(null);
    };
    // 延迟注册避免右键事件立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('click', close);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [tabContextMenu, terminalTabContextMenu]);
  const [connectingServers, setConnectingServers] = useState([]); // [{ server, sessionId, startTime }]
  const connectingServersRef = useRef([]);
  useEffect(() => { connectingServersRef.current = connectingServers; }, [connectingServers]);
  const [toasts, setToasts] = useState([]);
  const [changeReviewQueues, setChangeReviewQueues] = useState({});
  const [restorePreviewReviews, setRestorePreviewReviews] = useState({});
  const [conversationDiffPanels, setConversationDiffPanels] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState({}); // { [sessionId]: boolean }
  const [probeSnapshots, setProbeSnapshots] = useState({}); // { [sessionId]: { info, hist } }
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
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  const quickCmdsRef = useRef(null);
  const showQuickCommandsRef = useRef(false);
  useEffect(() => { showQuickCommandsRef.current = showQuickCommands; }, [showQuickCommands]);
  const [creatingTerminalSessionId, setCreatingTerminalSessionId] = useState(null);
  const creatingTerminalRef = useRef(null);
  
  // ponytail: 9 处 setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s)) 提取为帮助函数
  const updateSessionStatus = useCallback((id, status) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  }, []);

  // ponytail: 3 处 s.terminals?.length > 0 ? s.terminals : [{ id: s.id }] 提取为帮助函数
  const getEffectiveTerminals = useCallback((s) => s.terminals?.length > 0 ? s.terminals : [{ id: s.id }], []);
  const getSessionPanes = useCallback((layoutId, layoutSource = terminalPaneLayouts) => layoutSource[layoutId]?.panes || [], [terminalPaneLayouts]);
  const getSessionRootPaneCells = useCallback((layoutId, layoutSource = terminalPaneLayouts) => (
    getTerminalPaneRemainingCells(getSessionPanes(layoutId, layoutSource))
  ), [getSessionPanes, terminalPaneLayouts]);
  const getSessionPaneLayouts = useCallback((sessionId, layoutSource = terminalPaneLayouts) => (
    Object.entries(layoutSource)
      .filter(([, layout]) => layout?.sessionId === sessionId)
      .map(([layoutId, layout]) => ({
        ...layout,
        id: layoutId,
        rootTerminalId: layout.rootTerminalId || layoutId,
        panes: layout.panes || [],
      }))
  ), [terminalPaneLayouts]);
  const getSessionGroupedTerminalIds = useCallback((sessionId, layoutSource = terminalPaneLayouts) => {
    const ids = new Set();
    getSessionPaneLayouts(sessionId, layoutSource).forEach((layout) => {
      ids.add(layout.rootTerminalId);
      (layout.panes || []).forEach((pane) => ids.add(pane.terminalId));
    });
    return ids;
  }, [getSessionPaneLayouts, terminalPaneLayouts]);
  const getSessionRootTerminals = useCallback((session, layoutSource = terminalPaneLayouts) => {
    const groupedTerminalIds = getSessionGroupedTerminalIds(session.id, layoutSource);
    return getEffectiveTerminals(session).filter((term) => !groupedTerminalIds.has(term.id));
  }, [getEffectiveTerminals, getSessionGroupedTerminalIds, terminalPaneLayouts]);
  const getSessionWorkspaceTabs = useCallback((session, layoutSource = terminalPaneLayouts) => {
    const terminals = getEffectiveTerminals(session);
    const terminalById = new Map(terminals.map((term) => [term.id, term]));
    const layoutsByRoot = new Map(getSessionPaneLayouts(session.id, layoutSource).map((layout) => [layout.rootTerminalId, layout]));
    const groupedTerminalIds = getSessionGroupedTerminalIds(session.id, layoutSource);
    return terminals.flatMap((term) => {
      const layout = layoutsByRoot.get(term.id);
      if (layout) {
        const names = [layout.rootTerminalId, ...(layout.panes || []).map((pane) => pane.terminalId)]
          .map((terminalId) => terminalById.get(terminalId)?.label)
          .filter(Boolean);
        return [{
          id: layout.id,
          type: 'group',
          label: names.length > 0 ? names.join(' / ') : t('分屏组'),
          terminalIds: [layout.rootTerminalId, ...(layout.panes || []).map((pane) => pane.terminalId)],
        }];
      }
      if (groupedTerminalIds.has(term.id)) {
        return [];
      }
      return [{ ...term, type: 'terminal', terminalIds: [term.id] }];
    });
  }, [getEffectiveTerminals, getSessionGroupedTerminalIds, getSessionPaneLayouts, terminalPaneLayouts, t]);
  const resolveSessionRootTerminalId = useCallback((session, preferredId, layoutSource = terminalPaneLayouts) => {
    const tabs = getSessionWorkspaceTabs(session, layoutSource);
    if (tabs.some((tab) => tab.id === preferredId)) {
      return preferredId;
    }
    return tabs[0]?.id || null;
  }, [getSessionWorkspaceTabs, terminalPaneLayouts]);
  const canSplitSessionRootPane = useCallback((layoutId, layoutSource = terminalPaneLayouts) => {
    const rect = getTerminalPaneRect(getSessionRootPaneCells(layoutId, layoutSource));
    return !!rect && (rect.width > 1 || rect.height > 1);
  }, [getSessionRootPaneCells, terminalPaneLayouts]);
  const markWorkspaceRestoreNavigationOverride = useCallback(() => {
    if (restoringWorkspaceRef.current) {
      workspaceRestoreNavigationOverrideRef.current = true;
    }
  }, []);

  const buildSessionWorkspaceSnapshot = useCallback((session, overrides = {}) => {
    const nextSession = overrides.session || session;
    if (!nextSession?.id || !nextSession?.serverId) {
      return null;
    }
    const nextLayouts = overrides.terminalPaneLayouts || terminalPaneLayoutsRef.current;
    const nextTerminals = Array.isArray(nextSession.terminals) && nextSession.terminals.length > 0
      ? nextSession.terminals.map((term, index) => ({
          id: typeof term?.id === 'string' && term.id.trim() ? term.id.trim() : `${nextSession.id}-terminal-${index + 1}`,
          label: typeof term?.label === 'string' && term.label.trim() ? term.label.trim() : `${t('终端')}${index + 1}`,
        }))
      : [{ id: nextSession.id, label: `${t('终端')}1` }];
    const sessionLayouts = Object.fromEntries(
      Object.entries(nextLayouts || {})
        .filter(([, layout]) => layout?.sessionId === nextSession.id)
        .map(([layoutId, layout]) => [
          layoutId,
          {
            ...layout,
            sessionId: layout.sessionId,
            rootTerminalId: layout.rootTerminalId || layoutId,
            panes: (layout.panes || []).map((pane) => ({
              ...pane,
              cells: sortTerminalPaneCells(pane.cells),
            })),
          },
        ]),
    );
    const terminalIds = new Set(nextTerminals.map((term) => term.id));
    const fileManagerWorkspaces = Object.fromEntries(
      Object.entries(getAllSessionFileManagerWorkspaces()).filter(([terminalId]) => terminalIds.has(terminalId)),
    );
    const preferredTerminalId = overrides.activeTerminalId
      || (activeSessionIdRef.current === nextSession.id ? activeTerminalIdRef.current : lastTerminalRef.current[nextSession.id]);
    const resolvedActiveTerminalId = resolveSessionRootTerminalId(nextSession, preferredTerminalId, nextLayouts) || nextTerminals[0]?.id || nextSession.id;
    return {
      version: 1,
      sessionId: nextSession.id,
      serverId: nextSession.serverId,
      serverName: nextSession.serverName || '',
      host: nextSession.host || '',
      activeTerminalId: resolvedActiveTerminalId,
      contentTab: normalizeWorkspaceContentTab(
        overrides.contentTab
          ?? (activeSessionIdRef.current === nextSession.id ? contentTabRef.current : lastContentTabRef.current[nextSession.id])
          ?? 'terminal',
      ),
      terminals: nextTerminals.map((term) => ({ id: term.id, label: term.label })),
      terminalPaneLayouts: sessionLayouts,
      fileManagerWorkspaces,
      savedAt: Date.now(),
    };
  }, [resolveSessionRootTerminalId, t]);

  const persistServerWorkspaceSessionSnapshot = useCallback((session, overrides = {}) => {
    if (!rememberWorkspace || workspacePersistenceLevel !== 'session' || !session?.serverId) {
      return;
    }
    const snapshot = buildSessionWorkspaceSnapshot(session, overrides);
    if (!snapshot) {
      return;
    }
    window?.go?.main?.App?.SaveWorkspaceSessionState?.(session.serverId, JSON.stringify(snapshot)).catch(() => {});
  }, [buildSessionWorkspaceSnapshot, rememberWorkspace, workspacePersistenceLevel]);

  const loadServerWorkspaceSessionSnapshot = useCallback(async (serverId) => {
    const raw = await window?.go?.main?.App?.GetWorkspaceSessionState?.(serverId);
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const terminals = Array.isArray(parsed.terminals)
        ? parsed.terminals
          .map((term, index) => ({
            id: typeof term?.id === 'string' && term.id.trim() ? term.id.trim() : `snapshot-terminal-${index + 1}`,
            label: typeof term?.label === 'string' && term.label.trim() ? term.label.trim() : `${t('终端')}${index + 1}`,
          }))
          .filter((term) => term.id)
        : [];
      return {
        version: Number(parsed.version) || 1,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : '',
        serverId,
        serverName: typeof parsed.serverName === 'string' ? parsed.serverName : '',
        host: typeof parsed.host === 'string' ? parsed.host : '',
        activeTerminalId: typeof parsed.activeTerminalId === 'string' ? parsed.activeTerminalId.trim() : '',
        contentTab: normalizeWorkspaceContentTab(typeof parsed.contentTab === 'string' ? parsed.contentTab.trim() : 'terminal'),
        terminals: terminals.length > 0 ? terminals : [{ id: 'snapshot-root', label: `${t('终端')}1` }],
        terminalPaneLayouts: parsed.terminalPaneLayouts && typeof parsed.terminalPaneLayouts === 'object' ? parsed.terminalPaneLayouts : {},
        fileManagerWorkspaces: parsed.fileManagerWorkspaces && typeof parsed.fileManagerWorkspaces === 'object' ? parsed.fileManagerWorkspaces : {},
      };
    } catch {
      return null;
    }
  }, [t]);

  const renderSessionFileManagers = (s) => getEffectiveTerminals(s).map(t => {
    const isActive = activeSessionId === s.id && activeTerminalId === t.id;
    const serverConfig = serversRef.current.find((server) => server.id === s.serverId);
    return (
      <div key={t.id} style={isActive ? { display: 'contents' } : { display: 'none' }}>
        <FileManager
          sessionId={t.id}
          sessionGroupId={s.id}
          addToast={addToast}
          isActive={isActive}
          initialPath={serverConfig?.fileManagerInitPath || ''}
        />
      </div>
    );
  });

  useEffect(() => {
    if (restoringWorkspaceRef.current) {
      return;
    }
    setTerminalPaneLayouts((prev) => {
      let changed = false;
      const sessionMap = new Map(sessions.map((session) => [session.id, session]));
      const next = {};
      Object.entries(prev).forEach(([layoutId, layout]) => {
        const sessionId = layout?.sessionId;
        const session = sessionMap.get(sessionId);
        if (!session) {
          changed = true;
          return;
        }
        const validTerminalIds = new Set(getEffectiveTerminals(session).map((term) => term.id));
        if (!validTerminalIds.has(layout.rootTerminalId || layoutId)) {
          changed = true;
          return;
        }
        const nextPanes = (layout?.panes || [])
          .filter((pane) => validTerminalIds.has(pane.terminalId))
          .map((pane) => ({ ...pane, cells: sortTerminalPaneCells(pane.cells) }));
        if (nextPanes.length !== (layout?.panes || []).length) {
          changed = true;
        }
        next[layoutId] = {
          ...layout,
          sessionId,
          rootTerminalId: layout.rootTerminalId || layoutId,
          panes: nextPanes,
        };
      });
      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [getEffectiveTerminals, sessions]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const session = sessionsRef.current.find((item) => item.id === activeSessionId);
    if (!session) {
      return;
    }
    const nextTerminalId = resolveSessionRootTerminalId(session, activeTerminalIdRef.current);
    if (nextTerminalId !== activeTerminalIdRef.current) {
      setActiveTerminalId(nextTerminalId);
    }
  }, [activeSessionId, resolveSessionRootTerminalId, sessions, terminalPaneLayouts]);
  
  // ── 新增自动检测更新状态 ──────────────────────────────
  const [startupUpdateInfo, setStartupUpdateInfo] = useState(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [showUpdateBubble, setShowUpdateBubble] = useState(false);
  const updateBubbleTimeoutRef = useRef(null);
  const updateBubbleRemainingRef = useRef(4000);
  const updateBubbleStartedAtRef = useRef(0);
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
  const [terminalSubTabOverflow, setTerminalSubTabOverflow] = useState(false);
  const [terminalSubTabCanScrollLeft, setTerminalSubTabCanScrollLeft] = useState(false);
  const [terminalSubTabCanScrollRight, setTerminalSubTabCanScrollRight] = useState(false);
  const terminalSubTabDragSuppressUntilRef = useRef(0);
  const terminalSubTabScrollTargetRef = useRef(0);
  const terminalSubTabScrollFrameRef = useRef(0);
  const terminalSubTabDraggingRef = useRef(false);
  const terminalDockLongPressTimerRef = useRef(null);
  const terminalDockPointerCleanupRef = useRef(null);
  const terminalDockClickSuppressUntilRef = useRef(0);
  const [terminalDockDragPreview, setTerminalDockDragPreview] = useState(null);
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
  const clearTerminalDockLongPressTimer = useCallback(() => {
    if (!terminalDockLongPressTimerRef.current) {
      return;
    }
    clearTimeout(terminalDockLongPressTimerRef.current);
    terminalDockLongPressTimerRef.current = null;
  }, []);
  const shouldIgnoreTerminalDockClick = useCallback(() => Date.now() < terminalDockClickSuppressUntilRef.current, []);
  const getTerminalDockPreviewZones = useCallback(() => {
    const container = document.getElementById('terminal-dock-preview-host');
    if (!container) {
      return [];
    }
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return [];
    }

    const inset = 18;
    const gap = 14;
    const innerWidth = rect.width - inset * 2;
    const innerHeight = rect.height - inset * 2;
    if (innerWidth <= gap || innerHeight <= gap) {
      return [];
    }

    const cellWidth = (innerWidth - gap) / 2;
    const cellHeight = (innerHeight - gap) / 2;
    const entries = [
      { target: 'top-left', label: t('左上'), column: 0, row: 0 },
      { target: 'top-right', label: t('右上'), column: 1, row: 0 },
      { target: 'bottom-left', label: t('左下'), column: 0, row: 1 },
      { target: 'bottom-right', label: t('右下'), column: 1, row: 1 },
    ];

    return entries.map(({ target, label, column, row }) => {
      const left = inset + column * (cellWidth + gap);
      const top = inset + row * (cellHeight + gap);
      return {
        target,
        label,
        bounds: {
          left: rect.left + left,
          top: rect.top + top,
          right: rect.left + left + cellWidth,
          bottom: rect.top + top + cellHeight,
        },
        style: {
          left: `${rect.left + left}px`,
          top: `${rect.top + top}px`,
          width: `${cellWidth}px`,
          height: `${cellHeight}px`,
        },
      };
    });
  }, [t]);
  const getTerminalDockPreviewTarget = useCallback((clientX, clientY, zones) => {
    return zones.find((zone) =>
      clientX >= zone.bounds.left
      && clientX <= zone.bounds.right
      && clientY >= zone.bounds.top
      && clientY <= zone.bounds.bottom
    )?.target || null;
  }, []);
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
    if (!scroll || !list) return;
    const check = () => {
      setTabsOverflow(list.scrollWidth > scroll.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(scroll);
    ro.observe(list);
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
  const terminalSubTabTheme = useMemo(() => getTerminalTheme(), [terminalThemeToggle]);
  const [aiPanelWidth, setAiPanelWidth] = useState(() => {
    return clampPanelWidth(localStorage.getItem('aiPanelWidth') || '450', AI_PANEL_MIN);
  });
  const [showAIPanel, setShowAIPanel] = useState(localStorage.getItem('showAIPanel') !== 'false');
  const [quickThemeMode, setQuickThemeMode] = useState(localStorage.getItem('themeMode') || 'dark');
  const [showThemeQuickEntry, setShowThemeQuickEntry] = useState(localStorage.getItem('showThemeQuickEntry') !== 'false');
  const [showTopbarRefreshedLogo, setShowTopbarRefreshedLogo] = useState(false);
  const [aiPanelDevilModes, setAIPanelDevilModes] = useState({});
  const activeAIPanelKey = useMemo(() => buildAIWorkspaceTerminalPanelKey(activeSessionId, activeTerminalId), [activeSessionId, activeTerminalId]);
  const activeAIDevilMode = activeAIPanelKey ? aiPanelDevilModes[activeAIPanelKey] === true : false;

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
  const handleQuickCommandsOpenChange = useCallback((open) => {
    if (open) {
      setShowQuickCommands(true);
      return;
    }
    if (quickCmdsRef.current?.isDirty?.()) {
      quickCmdsRef.current.showCloseConfirm();
      return;
    }
    setShowQuickCommands(false);
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
  const resolveQuickThemeMode = useCallback((mode) => {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return mode === 'light' ? 'light' : 'dark';
  }, []);
  const resolvedQuickThemeMode = activeAIDevilMode ? 'dark' : resolveQuickThemeMode(quickThemeMode);
  const topbarLogoTransitionImg = resolvedQuickThemeMode === 'light' ? logoLightImg : logoDarkImg;
  const handleQuickThemeToggle = useCallback(() => {
    if (activeAIDevilMode) {
      return;
    }
    const nextMode = resolvedQuickThemeMode === 'light' ? 'dark' : 'light';
    localStorage.setItem('themeMode', nextMode);
    setQuickThemeMode(nextMode);
    if (nextMode === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    window.dispatchEvent(new CustomEvent('theme-mode-changed'));
  }, [activeAIDevilMode, resolvedQuickThemeMode]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowTopbarRefreshedLogo(true);
    }, 260);
    return () => {
      window.clearTimeout(timer);
    };
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
  // 启动时恢复上次窗口状态（先设正常尺寸，再按需最大化，避免把全屏尺寸当正常尺寸）
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

  // 定时轮询 + resize 时保存窗口大小与最大化状态
  // 最大化时绝不能用 GetSize 的全屏尺寸覆盖 w/h，否则取消最大化/重开就丢了原先大小
  useEffect(() => {
    if (localStorage.getItem('rememberWindowSize') === 'false') return;
    let lastW = 0, lastH = 0, lastMaximized = null;
    let debounceTimer = 0;
    try {
      const saved = JSON.parse(localStorage.getItem('windowSize') || 'null');
      if (saved?.w > 100 && saved?.h > 100) {
        lastW = saved.w;
        lastH = saved.h;
      }
    } catch {}
    const persist = async () => {
      try {
        const [size, maximized] = await Promise.all([WindowGetSize(), WindowIsMaximised()]);
        if (maximized) {
          if (lastMaximized !== true) {
            lastMaximized = true;
            const w = lastW > 100 ? lastW : size?.w;
            const h = lastH > 100 ? lastH : size?.h;
            if (w > 100 && h > 100) {
              localStorage.setItem('windowSize', JSON.stringify({ w, h, maximized: true }));
            }
          }
        } else if (size?.w > 100 && size?.h > 100) {
          if (size.w !== lastW || size.h !== lastH || lastMaximized !== false) {
            lastW = size.w;
            lastH = size.h;
            lastMaximized = false;
            localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h, maximized: false }));
          }
        }
      } catch {}
    };
    const onResize = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(persist, 150);
    };
    window.addEventListener('resize', onResize);
    const interval = setInterval(persist, 2000);
    return () => {
      window.clearTimeout(debounceTimer);
      window.removeEventListener('resize', onResize);
      clearInterval(interval);
    };
  }, []);

  // 最大化前先记下当前正常尺寸，避免轮询时已是全屏而丢尺寸
  const handleToggleMaximise = useCallback(async () => {
    try {
      if (localStorage.getItem('rememberWindowSize') !== 'false') {
        const [size, maximized] = await Promise.all([WindowGetSize(), WindowIsMaximised()]);
        if (!maximized && size?.w > 100 && size?.h > 100) {
          localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h, maximized: true }));
        }
      }
    } catch {}
    WindowToggleMaximise();
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
            // 快捷命令：拖到极限只回弹高度，不自动关闭（关闭用面板 X）
            if (!showQuickCommandsRef.current) {
              setFileManagerCollapsedPersistent(true);
            }
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

  useEffect(() => {
    const handleSendTerminalSelectionToAI = (event) => {
      const selectedText = typeof event?.detail?.text === 'string' ? event.detail.text.trim() : '';
      const targetSessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const sourceTerminalId = typeof event?.detail?.terminalId === 'string' ? event.detail.terminalId.trim() : '';
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

    const handleQuoteSelectionToAI = (event) => {
      const selectedText = typeof event?.detail?.text === 'string' ? event.detail.text : '';
      const quotedText = formatAIQuotedSelection(selectedText);
      const currentSessionId = activeSessionIdRef.current;
      if (!currentSessionId || !quotedText) {
        return;
      }
      const session = sessionsRef.current.find((item) => item.id === currentSessionId);
      if (!session) {
        return;
      }
      const preferredTerminalId = activeTerminalIdRef.current || lastTerminalRef.current[currentSessionId] || '';
      const activeLayout = preferredTerminalId ? terminalPaneLayoutsRef.current[preferredTerminalId] : null;
      const resolvedTerminalId = activeLayout?.sessionId === currentSessionId
        ? (activeLayout.rootTerminalId || preferredTerminalId)
        : resolveSessionRootTerminalId(session, preferredTerminalId, terminalPaneLayoutsRef.current);
      if (!resolvedTerminalId) {
        return;
      }
      window.dispatchEvent(new CustomEvent('ai-composer-append', {
        detail: {
          sessionId: currentSessionId,
          terminalId: resolvedTerminalId,
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
  }, [markWorkspaceRestoreNavigationOverride, resolveSessionRootTerminalId, setAIPanelVisibility]);

  const pingTimerRef = useRef(null);
  const pingInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  // 在 mount 时显式重置为 true：React StrictMode（仅 dev）会先 mount→unmount→再 mount，
  // 但 useRef 初始化只执行一次，第二次 mount 时不会重新赋值，导致 mountedRef 残留为 false，
  // 进而让依赖它的异步回调（如新建终端的 loading 清除）在 dev 下失效。
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── 新增主页仪表盘状态 ──────────────────────────────────
  const [isRefreshingPing, setIsRefreshingPing] = useState(false);
  const [pingInterval, setPingInterval] = useState(parseInt(localStorage.getItem('pingInterval') || '2', 10));
  const [pingEnabled, setPingEnabled] = useState(localStorage.getItem('pingEnabled') !== 'false');
  const [pingMode, setPingMode] = useState(localStorage.getItem('pingMode') || 'auto');
  // pingModeRef：让 pingAll（依赖数组为空的 useCallback）始终读到最新 pingMode，而不必把 pingMode 加进依赖、重建定时器。
  const pingModeRef = useRef(pingMode);
  useEffect(() => { pingModeRef.current = pingMode; }, [pingMode]);
  // pingFailCountRef：记录每台服务器「连续被判离线」的轮数。网络瞬时抖动会让在线服务器偶发判离线，
  // 为避免 UI 闪烁，连续 2 轮都报告离线才确认离线；只要中间一轮在线就清零。
  const pingFailCountRef = useRef({});

  useEffect(() => {
    const handler = () => {
      setPingInterval(parseInt(localStorage.getItem('pingInterval') || '2', 10));
    };
    window.addEventListener('pingIntervalChanged', handler);
    return () => window.removeEventListener('pingIntervalChanged', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setPingEnabled(localStorage.getItem('pingEnabled') !== 'false');
    };
    window.addEventListener('pingEnabledChanged', handler);
    return () => window.removeEventListener('pingEnabledChanged', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setPingMode(localStorage.getItem('pingMode') || 'auto');
    };
    window.addEventListener('pingModeChanged', handler);
    return () => window.removeEventListener('pingModeChanged', handler);
  }, []);

  // ── 初始化全局主题 ──────────────────────────────────────
  useEffect(() => {
    const applyTheme = () => {
      if (activeAIDevilMode) {
        window.__luminForceDarkTheme = true;
        document.body.classList.remove('theme-light');
        window.dispatchEvent(new CustomEvent('theme-mode-changed'));
        return;
      }
      window.__luminForceDarkTheme = false;
      const savedTheme = localStorage.getItem('themeMode') || 'dark';
      const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const applyLight = savedTheme === 'light' || (savedTheme === 'system' && isSystemLight);
      if (applyLight) document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
      window.dispatchEvent(new CustomEvent('theme-mode-changed'));
    };
    applyTheme();

    const useCustomAccent = localStorage.getItem('useCustomAccent') === 'true';
    const themeAccent = localStorage.getItem('themeAccent');
    if (useCustomAccent && themeAccent) {
      document.body.style.setProperty('--accent', themeAccent);
      document.body.style.setProperty('--accent-rgb', hexToRgb(themeAccent));
    }

    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [activeAIDevilMode]);

  // ── 自动检测更新机制 ────────────────────────────────────
  const { checkUpdate, applyUpdate, downloadProgress } = useUpdateChecker({
    onResult: (result) => {
      if (result.hasUpdate) {
        setStartupUpdateInfo({
          version: 'v' + result.latestVersion,
          url: result.url,
          filename: result.filename,
        });
      }
    }
  });

  useEffect(() => {
    // 延迟 2.5 秒触发检测，避免阻塞应用首次极速渲染
    const timer = setTimeout(checkUpdate, 2500);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  useEffect(() => {
    const clearBubbleTimer = () => {
      if (updateBubbleTimeoutRef.current) {
        clearTimeout(updateBubbleTimeoutRef.current);
        updateBubbleTimeoutRef.current = null;
      }
    };

    const pauseBubbleTimer = () => {
      if (!updateBubbleTimeoutRef.current || !updateBubbleStartedAtRef.current) {
        return;
      }
      const elapsed = Date.now() - updateBubbleStartedAtRef.current;
      updateBubbleRemainingRef.current = Math.max(0, updateBubbleRemainingRef.current - elapsed);
      updateBubbleStartedAtRef.current = 0;
      clearBubbleTimer();
    };

    const startBubbleTimer = () => {
      if (updateBubbleTimeoutRef.current) {
        return;
      }
      if (!startupUpdateInfo || updateBubbleRemainingRef.current <= 0) {
        setShowUpdateBubble(false);
        return;
      }
      if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) {
        return;
      }
      updateBubbleStartedAtRef.current = Date.now();
      updateBubbleTimeoutRef.current = window.setTimeout(() => {
        updateBubbleTimeoutRef.current = null;
        updateBubbleStartedAtRef.current = 0;
        updateBubbleRemainingRef.current = 0;
        setShowUpdateBubble(false);
      }, updateBubbleRemainingRef.current);
    };

    if (!startupUpdateInfo) {
      clearBubbleTimer();
      updateBubbleRemainingRef.current = 4000;
      updateBubbleStartedAtRef.current = 0;
      setShowUpdateBubble(false);
      return undefined;
    }

    clearBubbleTimer();
    updateBubbleRemainingRef.current = 4000;
    updateBubbleStartedAtRef.current = 0;
    setShowUpdateBubble(true);
    startBubbleTimer();

    const handleFocus = () => startBubbleTimer();
    const handleBlur = () => pauseBubbleTimer();
    const handleVisibilityChange = () => {
      if (document.hidden) {
        pauseBubbleTimer();
        return;
      }
      startBubbleTimer();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearBubbleTimer();
      updateBubbleStartedAtRef.current = 0;
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startupUpdateInfo]);

  const handleApplyStartupUpdate = async () => {
    try {
      await applyUpdate(startupUpdateInfo);
    } catch (err) {
      addToast(`${t('自动更新失败')}: ${err}`, 'error', 5000);
    }
  };

  // ── 刷新延迟 ────────────────────────────────────────────
  const handleRefreshPing = async () => {
    if (!pingEnabled || isRefreshingPing) return; // 防止重复点击导致并发竞态
    setIsRefreshingPing(true);
    await pingAll();
    setTimeout(() => { if (mountedRef.current) setIsRefreshingPing(false); }, 800);
  };

  const TOAST_EXIT_DURATION = 1080;
  const toastIdRef = useRef(0);
  const toastAutoDismissTimersRef = useRef(new Map());
  const toastExitTimersRef = useRef(new Map());
  const clearToastTimer = useCallback((timersRef, id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);
  const removeToastImmediately = useCallback((id) => {
    clearToastTimer(toastAutoDismissTimersRef, id);
    clearToastTimer(toastExitTimersRef, id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, [clearToastTimer]);
  const removeToast = useCallback((id) => {
    clearToastTimer(toastAutoDismissTimersRef, id);
    clearToastTimer(toastExitTimersRef, id);
    let shouldAnimate = false;
    setToasts((prev) => prev.map((t) => {
      if (t.id !== id) {
        return t;
      }
      if (t.closing) {
        return t;
      }
      shouldAnimate = true;
      return { ...t, closing: true };
    }));
    if (!shouldAnimate) {
      return;
    }
    const exitTimer = setTimeout(() => {
      if (mountedRef.current) {
        removeToastImmediately(id);
      }
    }, TOAST_EXIT_DURATION);
    toastExitTimersRef.current.set(id, exitTimer);
  }, [clearToastTimer, removeToastImmediately]);
  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++toastIdRef.current;
    const text = message instanceof Error ? message.message : String(message ?? '');
    setToasts((prev) => [...prev, { id, message: text, type, closing: false }]);
    if (duration > 0) {
      const autoTimer = setTimeout(() => {
        if (mountedRef.current) {
          removeToast(id);
        }
      }, duration);
      toastAutoDismissTimersRef.current.set(id, autoTimer);
    }
  }, [removeToast]);
  useEffect(() => () => {
    toastAutoDismissTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastAutoDismissTimersRef.current.clear();
    toastExitTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastExitTimersRef.current.clear();
  }, []);

  const activeWorkspaceTerminalKey = useMemo(() => buildAIWorkspaceTerminalPanelKey(activeSessionId, activeTerminalId), [activeSessionId, activeTerminalId]);
  const activeChangeReviewQueue = useMemo(() => (
    activeWorkspaceTerminalKey && Array.isArray(changeReviewQueues[activeWorkspaceTerminalKey])
      ? changeReviewQueues[activeWorkspaceTerminalKey]
      : []
  ), [activeWorkspaceTerminalKey, changeReviewQueues]);
  const activeChangeReview = activeChangeReviewQueue.length > 0 ? activeChangeReviewQueue[0] : null;
  const activeRestorePreviewReview = activeWorkspaceTerminalKey
    ? restorePreviewReviews[activeWorkspaceTerminalKey] || null
    : null;
  const activeConversationDiffPanel = activeWorkspaceTerminalKey
    ? conversationDiffPanels[activeWorkspaceTerminalKey] || null
    : null;

  const enqueueChangeReview = useCallback((review) => {
    if (!review || typeof review !== 'object' || !review.reviewId || !review.requestId) {
      return;
    }
    const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, review.sessionId);
    if (!binding) {
      return;
    }
    const panelKey = buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId);
    if (!panelKey) {
      return;
    }
    setChangeReviewQueues((prev) => {
      const currentQueue = Array.isArray(prev[panelKey]) ? prev[panelKey] : [];
      if (currentQueue.some((item) => item.reviewId === review.reviewId)) {
        return prev;
      }
      return {
        ...prev,
        [panelKey]: [...currentQueue, review],
      };
    });
  }, []);

  const removeChangeReviewById = useCallback((reviewId) => {
    const normalizedId = typeof reviewId === 'string' ? reviewId.trim() : '';
    if (!normalizedId) {
      return;
    }
    setChangeReviewQueues((prev) => {
      let changed = false;
      const next = {};
      Object.entries(prev).forEach(([panelKey, queue]) => {
        const currentQueue = Array.isArray(queue) ? queue : [];
        const filteredQueue = currentQueue.filter((item) => item.reviewId !== normalizedId);
        if (filteredQueue.length !== currentQueue.length) {
          changed = true;
        }
        if (filteredQueue.length > 0) {
          next[panelKey] = filteredQueue;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const removeChangeReviewsByRequestId = useCallback((requestId) => {
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalizedRequestId) {
      return;
    }
    setChangeReviewQueues((prev) => {
      let changed = false;
      const next = {};
      Object.entries(prev).forEach(([panelKey, queue]) => {
        const currentQueue = Array.isArray(queue) ? queue : [];
        const filteredQueue = currentQueue.filter((item) => item.requestId !== normalizedRequestId);
        if (filteredQueue.length !== currentQueue.length) {
          changed = true;
        }
        if (filteredQueue.length > 0) {
          next[panelKey] = filteredQueue;
        }
      });
      return changed ? next : prev;
    });
    setRestorePreviewReviews((prev) => {
      let changed = false;
      const next = {};
      Object.entries(prev).forEach(([panelKey, reviewState]) => {
        if (reviewState?.review?.requestId === normalizedRequestId) {
          changed = true;
          return;
        }
        next[panelKey] = reviewState;
      });
      return changed ? next : prev;
    });
  }, []);

  const removeChangeReviewsBySessionId = useCallback((terminalId) => {
    const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, terminalId);
    if (!binding) {
      return;
    }
    const panelKey = buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId);
    if (!panelKey) {
      return;
    }
    setChangeReviewQueues((prev) => {
      if (!prev[panelKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[panelKey];
      return next;
    });
    setRestorePreviewReviews((prev) => {
      if (!prev[panelKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[panelKey];
      return next;
    });
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

  useEffect(() => {
    const handlePreviewChangeReview = (event) => {
      const review = event?.detail?.review;
      const terminalId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      if (!review || typeof review !== 'object') {
        return;
      }
      const binding = resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, terminalId);
      if (!binding) {
        return;
      }
      const panelKey = buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId);
      if (!panelKey) {
        return;
      }
      setRestorePreviewReviews((prev) => ({
        ...prev,
        [panelKey]: {
          sessionId: binding.sessionId,
          terminalId: binding.terminalId,
          review,
        },
      }));
    };

    const handleClearPreviewChangeReview = (event) => {
      const reviewId = typeof event?.detail?.reviewId === 'string' ? event.detail.reviewId.trim() : '';
      const terminalId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const binding = terminalId ? resolveAIWorkspaceTerminalBindingByTerminalId(sessionsRef.current, terminalId) : null;
      const panelKey = binding ? buildAIWorkspaceTerminalPanelKey(binding.sessionId, binding.terminalId) : '';
      setRestorePreviewReviews((prev) => {
        let changed = false;
        const next = {};
        Object.entries(prev).forEach(([currentKey, reviewState]) => {
          if (panelKey && currentKey !== panelKey) {
            next[currentKey] = reviewState;
            return;
          }
          if (reviewId && reviewState?.review?.reviewId && reviewState.review.reviewId !== reviewId) {
            next[currentKey] = reviewState;
            return;
          }
          changed = true;
        });
        return changed ? next : prev;
      });
    };

    window.addEventListener('ai-change-review-preview', handlePreviewChangeReview);
    window.addEventListener('ai-change-review-preview-clear', handleClearPreviewChangeReview);
    return () => {
      window.removeEventListener('ai-change-review-preview', handlePreviewChangeReview);
      window.removeEventListener('ai-change-review-preview-clear', handleClearPreviewChangeReview);
    };
  }, []);

  const previewConversationDiffArtifact = useCallback(async (artifactPath, targetTerminalId) => {
    const bridge = window?.go?.main?.AIBindings || window?.go?.main?.App;
    if (!bridge?.PreviewAIChatToolDiff) {
      throw new Error(t('差异预览能力未就绪'));
    }
    const review = await bridge.PreviewAIChatToolDiff(artifactPath, targetTerminalId);
    return review && typeof review === 'object' ? review : null;
  }, []);

  const handleReapplyConversationDiffItem = useCallback(async (artifactPath, targetSessionId, targetTerminalId) => {
    const bridge = window?.go?.main?.AIBindings || window?.go?.main?.App;
    const effectiveTerminalId = typeof targetTerminalId === 'string' && targetTerminalId.trim()
      ? targetTerminalId.trim()
      : typeof targetSessionId === 'string'
        ? targetSessionId.trim()
        : '';
    if (!bridge?.ReapplyAIChatTool) {
      addToast(t('重新应用能力未就绪'), 'error', 3200);
      return false;
    }
    try {
      await bridge.ReapplyAIChatTool(artifactPath, effectiveTerminalId);
      return true;
    } catch (error) {
      addToast(error instanceof Error ? t(error.message) : t('当前状态不支持重新应用'), 'error', 3200);
      return false;
    }
  }, [addToast, t]);

  const handleApplyConversationDiffRestore = useCallback(async (artifactPath, targetSessionId, targetTerminalId) => {
    try {
      await restoreAIChatTool(artifactPath, targetTerminalId);
      return true;
    } catch (error) {
      addToast(error instanceof Error ? t(error.message) : t('当前状态不支持还原'), 'error', 3200);
      return false;
    }
  }, [addToast]);

  const handleSelectConversationDiffItem = useCallback(async (item, options = {}) => {
    const artifactPath = typeof item?.artifactPath === 'string' ? item.artifactPath.trim() : '';
    const messageId = typeof item?.messageId === 'string' ? item.messageId.trim() : '';
    const sessionId = typeof options?.sessionId === 'string' ? options.sessionId.trim() : '';
    const terminalId = typeof options?.terminalId === 'string' ? options.terminalId.trim() : '';
    const providedItems = Array.isArray(options?.items) ? options.items : [];
    const shouldLocate = options?.locate === true;
    const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
    if (!artifactPath || !panelKey) {
      return;
    }
    setConversationDiffPanels((prev) => {
      const currentPanel = prev[panelKey] || {
        sessionId,
        terminalId,
        openedAt: Date.now(),
        items: providedItems,
      };
      return {
        ...prev,
        [panelKey]: {
          ...currentPanel,
          items: Array.isArray(currentPanel.items) && currentPanel.items.length > 0 ? currentPanel.items : providedItems,
          selectedMessageId: messageId,
          selectedArtifactPath: artifactPath,
          review: null,
          loading: true,
        },
      };
    });
    try {
      const review = await previewConversationDiffArtifact(artifactPath, terminalId || sessionId);
      setConversationDiffPanels((prev) => {
        const currentPanel = prev[panelKey] || {
          sessionId,
          terminalId,
          openedAt: Date.now(),
          items: providedItems,
        };
        return {
          ...prev,
          [panelKey]: {
            ...currentPanel,
            items: Array.isArray(currentPanel.items) && currentPanel.items.length > 0 ? currentPanel.items : providedItems,
            selectedMessageId: messageId,
            selectedArtifactPath: artifactPath,
            review,
            loading: false,
          },
        };
      });
      if (shouldLocate && messageId) {
        window.dispatchEvent(new CustomEvent('ai-conversation-diff-locate', {
          detail: {
            sessionId,
            terminalId,
            messageId,
            token: Date.now(),
          },
        }));
      }
    } catch (error) {
      setConversationDiffPanels((prev) => {
        const currentPanel = prev[panelKey] || {
          sessionId,
          terminalId,
          openedAt: Date.now(),
          items: providedItems,
        };
        return {
          ...prev,
          [panelKey]: {
            ...currentPanel,
            items: Array.isArray(currentPanel.items) && currentPanel.items.length > 0 ? currentPanel.items : providedItems,
            selectedMessageId: messageId,
            selectedArtifactPath: artifactPath,
            loading: false,
          },
        };
      });
      addToast(error instanceof Error ? t(error.message) : t('差异预览失败'), 'error', 3200);
    }
  }, [addToast, previewConversationDiffArtifact]);

  useEffect(() => {
    const handleOpenConversationDiffPanel = (event) => {
      const sessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const terminalId = typeof event?.detail?.terminalId === 'string' ? event.detail.terminalId.trim() : '';
      const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
      const rawItems = Array.isArray(event?.detail?.items) ? event.detail.items : [];
      const items = rawItems
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `conversation-diff-item-${index}`,
          messageId: typeof item.messageId === 'string' ? item.messageId.trim() : '',
          artifactPath: typeof item.artifactPath === 'string' ? item.artifactPath.trim() : '',
          toolName: typeof item.toolName === 'string' ? item.toolName.trim() : '',
          title: typeof item.title === 'string' ? item.title.trim() : '',
          summary: typeof item.summary === 'string' ? item.summary.trim() : '',
          status: typeof item.status === 'string' ? item.status.trim() : '',
          copyContent: typeof item.copyContent === 'string' ? item.copyContent : '',
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
        }))
        .filter((item) => item.artifactPath);
      if (!panelKey || items.length === 0) {
        return;
      }
      let firstItem = null;
      let shouldOpen = false;
      setConversationDiffPanels((prev) => {
        if (prev[panelKey]) {
          const next = { ...prev };
          delete next[panelKey];
          return next;
        }
        firstItem = items[0];
        shouldOpen = true;
        return {
          ...prev,
          [panelKey]: {
            sessionId,
            terminalId,
            openedAt: Date.now(),
            items,
            selectedMessageId: firstItem?.messageId || '',
            selectedArtifactPath: firstItem?.artifactPath || '',
            review: null,
            loading: true,
          },
        };
      });
      if (shouldOpen && firstItem) {
        void handleSelectConversationDiffItem(firstItem, { sessionId, terminalId, locate: false, items });
      }
    };

    const handleCloseConversationDiffPanel = (event) => {
      const sessionId = typeof event?.detail?.sessionId === 'string' ? event.detail.sessionId.trim() : '';
      const terminalId = typeof event?.detail?.terminalId === 'string' ? event.detail.terminalId.trim() : '';
      const panelKey = buildAIWorkspaceTerminalPanelKey(sessionId, terminalId);
      setConversationDiffPanels((prev) => {
        if (!panelKey) {
          return {};
        }
        if (!prev[panelKey]) {
          return prev;
        }
        const next = { ...prev };
        delete next[panelKey];
        return next;
      });
    };

    window.addEventListener('ai-conversation-diff-open', handleOpenConversationDiffPanel);
    window.addEventListener('ai-conversation-diff-close', handleCloseConversationDiffPanel);
    return () => {
      window.removeEventListener('ai-conversation-diff-open', handleOpenConversationDiffPanel);
      window.removeEventListener('ai-conversation-diff-close', handleCloseConversationDiffPanel);
    };
  }, [handleSelectConversationDiffItem]);

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
    setServersLoaded(true);
  }, [addToast]);

  useEffect(() => { loadServers(); }, [loadServers]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(window?.go?.main?.App?.GetRememberWorkspace?.())
      .then((enabled) => {
        if (cancelled) return;
        setRememberWorkspace(!!enabled);
        setRememberWorkspaceLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setRememberWorkspace(false);
        setRememberWorkspaceLoaded(true);
      });
    Promise.resolve(window?.go?.main?.App?.GetWorkspacePersistenceLevel?.())
      .then((level) => {
        if (cancelled) return;
        setWorkspacePersistenceLevel(level === 'session' ? 'session' : 'program');
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspacePersistenceLevel('program');
      });
    const rememberWorkspaceHandler = (event) => {
      if (typeof event?.detail !== 'boolean') {
        return;
      }
      setRememberWorkspace(event.detail);
      setRememberWorkspaceLoaded(true);
    };
    const workspacePersistenceLevelHandler = (event) => {
      setWorkspacePersistenceLevel(event?.detail === 'session' ? 'session' : 'program');
    };
    window.addEventListener('workspace-remember-changed', rememberWorkspaceHandler);
    window.addEventListener('workspace-persistence-level-changed', workspacePersistenceLevelHandler);
    return () => {
      cancelled = true;
      window.removeEventListener('workspace-remember-changed', rememberWorkspaceHandler);
      window.removeEventListener('workspace-persistence-level-changed', workspacePersistenceLevelHandler);
    };
  }, []);

  // ── Ping all servers ───────────────────────────────────────
  const pingAll = useCallback(async () => {
    if (pingInFlightRef.current) return;
    const list = serversRef.current;
    if (list.length === 0) return;
    pingInFlightRef.current = true;
    try {
      const results = await Promise.all(
        list.map(async (s) => {
          try {
            const res = await AppGo.PingServer(s.id, pingModeRef.current);
            return { id: s.id, ...res };
          } catch {
            return { id: s.id, online: false, latency: null };
          }
        })
      );
      // 合并新旧状态：网络瞬时抖动会让在线服务器偶发判离线，因此「连续 2 轮」都报告离线才确认离线，
      // 未确认期间保留上一轮的在线状态与延迟数值，避免 UI 闪烁。
      const FAIL_THRESHOLD = 2;
      const failCounts = pingFailCountRef.current;
      setPings((prev) => {
        const map = {};
        results.forEach((r) => {
          if (r.online) {
            // 在线：清零失败计数，采用本轮最新延迟。
            delete failCounts[r.id];
            map[r.id] = { online: true, latency: r.latency };
          } else {
            // 本轮报告离线：累加失败计数，仅当连续达标才确认离线；否则沿用上轮在线状态。
            failCounts[r.id] = (failCounts[r.id] || 0) + 1;
            if (failCounts[r.id] >= FAIL_THRESHOLD) {
              map[r.id] = { online: false, latency: prev[r.id]?.latency ?? null };
            } else {
              // 保留上轮状态（可能在线/可能尚无记录）；若无记录则记一次离线占位。
              map[r.id] = prev[r.id] ? { ...prev[r.id] } : { online: false, latency: null };
            }
          }
        });
        return map;
      });
    } finally {
      pingInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (activeSessionId !== null) return; // ponytail: 不在主页时不 ping
    if (!pingEnabled) {
      setPings({});
      pingFailCountRef.current = {};
      return;
    }
    pingAll();
    // 修改为动态刷新延迟，降低后台消耗或提高实时性
    pingTimerRef.current = setInterval(pingAll, pingInterval * 1000);
    return () => clearInterval(pingTimerRef.current);
  }, [pingAll, pingInterval, activeSessionId, pingEnabled]);

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
  const resolveSessionContentTab = useCallback((sessionId) => {
    const tab = normalizeWorkspaceContentTab(lastContentTabRef.current[sessionId] || 'terminal');
    // 文件管理器已停靠时，files 页签不可用，回落终端
    if (tab === 'files' && fileManagerPosition !== 'tab') return 'terminal';
    return tab;
  }, [fileManagerPosition]);

  const switchToNextSession = useCallback((currentSessionId) => {
    const remaining = sessionsRef.current.filter(s => s.id !== currentSessionId);
    if (remaining.length > 0) {
      const nextSession = remaining[remaining.length - 1];
      setActiveSessionId(nextSession.id);
      setActiveTerminalId(resolveSessionRootTerminalId(nextSession, lastTerminalRef.current[nextSession.id]));
      setContentTab(resolveSessionContentTab(nextSession.id));
    } else {
      setActiveSessionId(null);
      setActiveTerminalId(null);
    }
  }, [resolveSessionContentTab, resolveSessionRootTerminalId]);

  // ponytail: 提取 tab 点击处理，避免每次渲染创建 N 个闭包
  const handleTabClick = useCallback((sessionId) => {
    markWorkspaceRestoreNavigationOverride();
    setTabContextMenu(null);
    setTerminalTabContextMenu(null);
    setActiveSessionId(sessionId);
    const sess = sessionsRef.current.find(x => x.id === sessionId);
    const nextTerminalId = sess ? resolveSessionRootTerminalId(sess, lastTerminalRef.current[sessionId]) : null;
    setActiveTerminalId(nextTerminalId);
    setContentTab(resolveSessionContentTab(sessionId));
    persistWorkspaceSnapshotRef.current({
      activeSessionId: sessionId,
      activeTerminalId: nextTerminalId,
    });
  }, [markWorkspaceRestoreNavigationOverride, resolveSessionContentTab, resolveSessionRootTerminalId]);

  const canCopySessionPassword = useCallback((sessionId) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session?.serverId) {
      return false;
    }
    const server = serversRef.current.find((item) => item.id === session.serverId);
    if (!server) {
      return false;
    }
    if (server.credentialId) {
      const credential = credentials.find((item) => item.id === server.credentialId);
      return credential?.authMethod === 'password';
    }
    return server.authMethod === 'password';
  }, [credentials]);

  const handleCopySessionPassword = useCallback(async (sessionId) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session?.serverId) {
      addToast(t('复制失败'), 'error', 3000);
      return;
    }
    try {
      const password = await AppGo.GetConnectionPassword(session.serverId);
      if (!password) {
        throw new Error('empty password');
      }
      await navigator.clipboard.writeText(password);
      addToast(t('已复制'), 'success', 2000);
    } catch {
      addToast(t('复制失败'), 'error', 3000);
    }
  }, [addToast, t]);

  // ── 重连会话核心逻辑 ────────────────────────────────────────
  const reconnectSession = useCallback(async (session, requestingTerminalId, options = {}) => {
    const deferState = options?.deferState === true;
    updateSessionStatus(session.id, 'connecting');
    const serverObj = serversRef.current.find((sv) => sv.id === session.serverId);
    if (serverObj) {
      setConnectingServers((prev) => [...prev, { server: serverObj, sessionId: session.id, startTime: Date.now() }]);
    }

    try {
      await AppGo.ConnectSSH(session.id, session.serverId);

      const savedTerminals = session.terminals?.length > 0 ? session.terminals : [{ id: session.id, label: `${t('终端')}1` }];
      const rootTerminal = savedTerminals.find(term => term.id === session.id) || savedTerminals[0] || { id: session.id, label: `${t('终端')}1` };
      const subTerminals = savedTerminals.filter(term => term.id !== session.id);
      const oldToNew = { [rootTerminal.id]: session.id, [session.id]: session.id };
      for (const sub of subTerminals) {
        try {
          const newTermId = await AppGo.OpenTerminal(session.id);
          oldToNew[sub.id] = newTermId;
        } catch {}
      }
      const newTerminals = savedTerminals
        .map(term => ({
          id: oldToNew[term.id],
          label: term.label || `${t('终端')}1`,
        }))
        .filter(term => !!term.id);

      if (!deferState) {
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? { ...s, status: 'connected', terminals: newTerminals } : s))
        );
      }
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));

      if (requestingTerminalId && oldToNew[requestingTerminalId]) {
        setActiveTerminalId(oldToNew[requestingTerminalId]);
      }

      await postConnectSetup(session.id, session.serverId);
      return { oldToNew, newTerminals };
    } catch (err) {
      const errMsg = String(err);
      const isHostKeyChange = errMsg.includes('主机密钥已变更');
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, status: isHostKeyChange ? 'connecting' : 'error' } : s))
      );
      if (!isHostKeyChange) {
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));
        if (!deferState) {
          addToast(`${t('重新连接失败')}: ${err}`, 'error', 5000);
        }
      }
      return null;
    }
  }, [addToast, t, postConnectSetup]);

  useEffect(() => {
    if (!serversLoaded || !rememberWorkspaceLoaded || workspaceRestoreStartedRef.current) {
      return;
    }
    workspaceRestoreStartedRef.current = true;
    workspaceRestoreNavigationOverrideRef.current = false;
    if (!rememberWorkspace) {
      setWorkspaceRestoreReady(true);
      return;
    }
    (async () => {
      const raw = await window?.go?.main?.App?.GetWorkspaceState?.();
      if (typeof raw !== 'string' || !raw.trim()) {
        return;
      }
      let snapshot;
      try {
        snapshot = JSON.parse(raw);
      } catch {
        return;
      }
      const savedSessions = (snapshot.sessions || [])
        .filter((session) => session?.id && session?.serverId && serversRef.current.some((server) => server.id === session.serverId))
        .map((session) => {
          const terminalById = new Map((session.terminals || []).map((term) => [term.id, term]));
          const workspaceTerminalIds = (session.workspaceTabs || []).flatMap((tab) => tab.terminalIds || []);
          const baseTerminalIds = [...workspaceTerminalIds, ...terminalById.keys()];
          const orderedTerminalIds = Array.from(new Set(baseTerminalIds.length > 0 ? baseTerminalIds : [session.id]));
          return {
            id: session.id,
            serverId: session.serverId,
            serverName: session.serverName || session.host,
            host: session.host || '',
            status: 'connecting',
            terminals: orderedTerminalIds.map((terminalId, index) => {
              const terminal = terminalById.get(terminalId);
              return {
                id: terminalId,
                label: terminal?.label || `${t('终端')}${index + 1}`,
              };
            }),
          };
        });
      if (savedSessions.length === 0) {
        return;
      }
      const savedLayouts = Object.fromEntries(
        Object.entries(snapshot.terminalPaneLayouts || {})
          .filter(([, layout]) => savedSessions.some((session) => session.id === layout?.sessionId))
          .map(([layoutId, layout]) => [
            layoutId,
            {
              ...layout,
              sessionId: layout.sessionId,
              rootTerminalId: layout.rootTerminalId || layoutId,
              panes: (layout.panes || []).map((pane) => ({
                ...pane,
                cells: sortTerminalPaneCells(pane.cells),
              })),
            },
          ])
      );
      const savedTerminalIds = new Set(savedSessions.flatMap((session) => (session.terminals || []).map((terminal) => terminal.id)));
      const savedFileManagerWorkspaces = Object.fromEntries(
        Object.entries(snapshot.fileManagerWorkspaces || {})
          .filter(([terminalId]) => savedTerminalIds.has(terminalId))
      );
      const initialActiveSessionId = savedSessions.some((session) => session.id === snapshot.activeSessionId)
        ? snapshot.activeSessionId
        : savedSessions[0].id;
      replaceAllSessionFileManagerWorkspaces(savedFileManagerWorkspaces);
      restoringWorkspaceRef.current = true;
      setRestoringWorkspaceSessionIds(new Set(savedSessions.map((session) => session.id)));
      setSessions(savedSessions);
      sessionsRef.current = savedSessions;
      setTerminalPaneLayouts(savedLayouts);
      terminalPaneLayoutsRef.current = savedLayouts;
      setMountedSessions(new Set(initialActiveSessionId ? [initialActiveSessionId] : []));
      setActiveSessionId(initialActiveSessionId);
      setActiveTerminalId(snapshot.activeTerminalId || initialActiveSessionId);
      setContentTab('terminal');

      const idMap = {};
      let restoredLayouts = savedLayouts;
      for (const savedSession of savedSessions) {
        const result = await reconnectSession(
          { ...savedSession, status: 'closed', terminals: savedSession.terminals },
          undefined,
          { deferState: true },
        );
        setRestoringWorkspaceSessionIds((prev) => {
          if (!prev.has(savedSession.id)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(savedSession.id);
          return next;
        });
        if (result?.oldToNew) {
          Object.assign(idMap, result.oldToNew);
          remapSessionFileManagerWorkspaces(result.oldToNew);
          restoredLayouts = remapTerminalPaneLayouts(restoredLayouts, result.oldToNew, savedSession.id);
          const restoredSession = { ...savedSession, status: 'connected', terminals: result.newTerminals };
          const restoredSessionLayouts = Object.fromEntries(
            Object.entries(restoredLayouts).filter(([, layout]) => layout?.sessionId === savedSession.id)
          );
          // ponytail: 用函数式更新而非整体覆盖，避免恢复期间用户新建/关闭的 session 被丢失或复活
          sessionsRef.current = sessionsRef.current.map((session) => (
            session.id === savedSession.id ? restoredSession : session
          ));
          setSessions((prev) => prev.map((session) => (
            session.id === savedSession.id ? restoredSession : session
          )));
          terminalPaneLayoutsRef.current = { ...terminalPaneLayoutsRef.current, ...restoredSessionLayouts };
          setTerminalPaneLayouts((prev) => ({ ...prev, ...restoredSessionLayouts }));
        }
      }

      if (workspaceRestoreNavigationOverrideRef.current) {
        return;
      }
      // ponytail: 收尾时从当前 sessions 找，避免用户已关闭的 session 被复活为 active 导致空白
      const finalSession = sessionsRef.current.find((session) => session.id === initialActiveSessionId) || sessionsRef.current[0];
      if (!finalSession) {
        setActiveSessionId(null);
        setActiveTerminalId(null);
        return;
      }
      const preferredTerminalId = idMap[snapshot.activeTerminalId] || snapshot.activeTerminalId;
      const resolvedTerminalId = resolveSessionRootTerminalId(finalSession, preferredTerminalId, terminalPaneLayoutsRef.current);
      lastTerminalRef.current[finalSession.id] = resolvedTerminalId;
      setActiveSessionId(finalSession.id);
      setActiveTerminalId(resolvedTerminalId);
      setContentTab('terminal');
    })().finally(() => {
      restoringWorkspaceRef.current = false;
      setRestoringWorkspaceSessionIds(new Set());
      setWorkspaceRestoreReady(true);
    });
  }, [rememberWorkspace, rememberWorkspaceLoaded, reconnectSession, resolveSessionRootTerminalId, serversLoaded, t]);

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

  useEffect(() => {
    const handleOpenRuntimeEnvironmentSettings = (event) => {
      const nextTab = typeof event?.detail?.tab === 'string' && event.detail.tab.trim()
        ? event.detail.tab.trim()
        : 'runtimeEnvironment';
      setSettingsInitialTab(nextTab);
      setShowSettings(true);
      const toastMessage = typeof event?.detail?.toast === 'string' ? event.detail.toast.trim() : '';
      if (toastMessage) {
        const toastDuration = Number.isFinite(Number(event?.detail?.duration)) ? Number(event.detail.duration) : 6000;
        const toastType = typeof event?.detail?.type === 'string' && event.detail.type.trim() ? event.detail.type.trim() : 'warning';
        addToast(toastMessage, toastType, toastDuration);
      }
    };

    window.addEventListener('open-runtime-environment-settings', handleOpenRuntimeEnvironmentSettings);
    return () => window.removeEventListener('open-runtime-environment-settings', handleOpenRuntimeEnvironmentSettings);
  }, [addToast]);

  // ── 监听云端同步失败事件 ──────────────────────────────────
  useEffect(() => {
    let active = true;
    const unbind = EventsOn('sync-failed', async (data) => {
      if (!isRecoveryPasswordError(data)) {
        if (active) setSyncFailed(data);
        return;
      }
      if (active) setSyncFailed(null);
      try {
        const { cancelled } = await syncWithRecoveryPassword({
          initialError: data,
          retry: (password) => AppGo.SyncWithRecoveryPassword(password),
          prompt: (...args) => window.luminDialog.prompt(...args),
          t,
        });
        if (active && !cancelled) addToast(t('同步成功'), 'success', 3000);
      } catch (err) {
        if (!active) return;
        if (isRecoveryPasswordError(err)) {
          addToast(t('恢复密码连续三次错误，同步已取消'), 'error', 4000);
        } else {
          setSyncFailed({ ...data, category: 'sync', error: String(err?.message ?? err) });
        }
      }
    });
    return () => {
      active = false;
      if (unbind) unbind();
    };
  }, [addToast, t]);

  // ── 监听 SSH 连接状态事件 ─────────────────────────────────
  useEffect(() => {
    const unbind = EventsOn('ssh-status', (data) => {
      const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : '';
      if (!sessionId) return;
      const status = typeof data?.status === 'string' ? data.status : '';
      if (status === 'post-auth-slow') {
        const message = t('SSH 已认证，但打开终端通道响应较慢，服务器可能正在恢复或负载较高。');
        setConnectingServers((prev) => prev.map((item) => (
          item.sessionId === sessionId ? { ...item, status, message } : item
        )));
      }
    });
    return () => { if (unbind) unbind(); };
  }, [t]);

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
      } else if (data.action === 'skip' && data.reason === 'tombstone_conflict_needs_manual_sync') {
        addToast(t('已跳过自动同步：删除记录将影响目标云，请手动合并同步并确认。'), 'warning', 8000);
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
    markWorkspaceRestoreNavigationOverride();
    const existing = sessionsRef.current.find((s) => s.serverId === server.id && s.status !== 'closed' && s.status !== 'error');
    if (existing) {
      setActiveSessionId(existing.id);
      setActiveTerminalId(resolveSessionRootTerminalId(existing, lastTerminalRef.current[existing.id]));
      setContentTab(resolveSessionContentTab(existing.id));
      return;
    }

    const closedSession = sessionsRef.current.find((s) => s.serverId === server.id && (s.status === 'closed' || s.status === 'error'));
    if (closedSession) {
      setActiveSessionId(closedSession.id);
      setActiveTerminalId(resolveSessionRootTerminalId(closedSession, lastTerminalRef.current[closedSession.id]));
      setContentTab(resolveSessionContentTab(closedSession.id));
      await reconnectSession(closedSession);
      return;
    }

    const sessionSnapshot = rememberWorkspace && workspacePersistenceLevel === 'session'
      ? await loadServerWorkspaceSessionSnapshot(server.id)
      : null;

    const sessionId = `session_${Date.now()}`;
    const newSession = {
      id: sessionId,
      serverId: server.id,
      serverName: server.name || server.host,
      host: server.host,
      status: 'connecting',
      terminals: Array.isArray(sessionSnapshot?.terminals) && sessionSnapshot.terminals.length > 0
        ? sessionSnapshot.terminals
        : [{ id: sessionId, label: `${t('终端')}1` }],
    };

    const nextSessions = [...sessionsRef.current, newSession];
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    setActiveSessionId(sessionId);
    setActiveTerminalId(sessionId);
    setContentTab('terminal');
    setConnectingServers((prev) => [...prev, { server, sessionId, startTime: Date.now() }]);

    try {
      if (sessionSnapshot) {
        const result = await reconnectSession(newSession, undefined, { deferState: true });
        if (!result) {
          return;
        }
        const restoredSession = { ...newSession, status: 'connected', terminals: result.newTerminals };
        const restoredLayouts = remapSessionWorkspaceLayouts(sessionSnapshot.terminalPaneLayouts || {}, result.oldToNew, sessionId);
        const mergedLayouts = { ...terminalPaneLayoutsRef.current, ...restoredLayouts };
        const currentWorkspaces = { ...getAllSessionFileManagerWorkspaces() };
        Object.keys(sessionSnapshot.fileManagerWorkspaces || {}).forEach((terminalId) => {
          delete currentWorkspaces[terminalId];
        });
        replaceAllSessionFileManagerWorkspaces({
          ...currentWorkspaces,
          ...remapSessionFileManagerWorkspaceMap(sessionSnapshot.fileManagerWorkspaces || {}, result.oldToNew),
        });
        sessionsRef.current = sessionsRef.current.map((item) => (
          item.id === sessionId ? restoredSession : item
        ));
        setSessions((prev) => prev.map((item) => (
          item.id === sessionId ? restoredSession : item
        )));
        terminalPaneLayoutsRef.current = mergedLayouts;
        setTerminalPaneLayouts((prev) => ({ ...prev, ...restoredLayouts }));
        const preferredTerminalId = result.oldToNew[sessionSnapshot.activeTerminalId] || result.newTerminals[0]?.id || sessionId;
        const nextActiveTerminalId = resolveSessionRootTerminalId(restoredSession, preferredTerminalId, mergedLayouts) || result.newTerminals[0]?.id || sessionId;
        const nextContentTab = fileManagerPosition === 'tab'
          ? normalizeWorkspaceContentTab(sessionSnapshot.contentTab)
          : (normalizeWorkspaceContentTab(sessionSnapshot.contentTab) === 'files' ? 'terminal' : normalizeWorkspaceContentTab(sessionSnapshot.contentTab));
        lastTerminalRef.current[sessionId] = nextActiveTerminalId;
        setActiveTerminalId(nextActiveTerminalId);
        setContentTab(nextContentTab);
        lastContentTabRef.current[sessionId] = nextContentTab;
        persistWorkspaceSnapshotRef.current({
          sessions: sessionsRef.current,
          activeSessionId: sessionId,
          activeTerminalId: nextActiveTerminalId,
          terminalPaneLayouts: mergedLayouts,
        });
        return;
      }

      await AppGo.ConnectSSH(sessionId, server.id);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
      );
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
      await postConnectSetup(sessionId, server.id);
    } catch (err) {
      handleConnectError(sessionId, err);
    }
  }, [fileManagerPosition, handleConnectError, loadServerWorkspaceSessionSnapshot, markWorkspaceRestoreNavigationOverride, postConnectSetup, reconnectSession, rememberWorkspace, resolveSessionContentTab, resolveSessionRootTerminalId, t, workspacePersistenceLevel]);

  // ── Close session ──────────────────────────────────────────
  // ponytail: 内部关闭逻辑，不带确认弹窗，供 closeSession 和右键菜单共用
  const forceCloseSession = useCallback((sessionId) => {
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (session) {
      persistServerWorkspaceSessionSnapshot(session, {
        session,
        terminalPaneLayouts: terminalPaneLayoutsRef.current,
        activeTerminalId: activeSessionIdRef.current === sessionId ? activeTerminalIdRef.current : lastTerminalRef.current[sessionId],
        contentTab: activeSessionIdRef.current === sessionId ? contentTabRef.current : (lastContentTabRef.current[sessionId] || 'terminal'),
      });
    }
    const termIds = session?.terminals ? session.terminals.map(t => t.id) : [sessionId];
    termIds.forEach(id => {
      cancelledConnectionsRef.current.add(id);
      setTimeout(() => { cancelledConnectionsRef.current.delete(id); }, 30000);
    });
    for (const id of termIds) {
      AppGo.DisconnectSSH(id).catch(() => {});
    }
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (next.length === 0) {
        window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => {});
      }
      return next;
    });
    setTerminalPaneLayouts((prev) => {
      const next = { ...prev };
      Object.entries(next).forEach(([layoutId, layout]) => {
        if (layout?.sessionId === sessionId) {
          delete next[layoutId];
        }
      });
      return next;
    });
    if (activeSessionIdRef.current === sessionId) {
      switchToNextSession(sessionId);
    }
    if (connectingServersRef.current.some((s) => s.sessionId === sessionId)) {
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
    }
  }, [persistServerWorkspaceSessionSnapshot]);

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
    all.forEach((session) => {
      persistServerWorkspaceSessionSnapshot(session, {
        session,
        terminalPaneLayouts: terminalPaneLayoutsRef.current,
        activeTerminalId: activeSessionIdRef.current === session.id ? activeTerminalIdRef.current : lastTerminalRef.current[session.id],
        contentTab: activeSessionIdRef.current === session.id ? contentTabRef.current : (lastContentTabRef.current[session.id] || 'terminal'),
      });
    });
    const allTermIds = all.flatMap(s => s.terminals?.length > 0 ? s.terminals.map(t => t.id) : [s.id]);
    allTermIds.forEach(id => {
      cancelledConnectionsRef.current.add(id);
      setTimeout(() => { cancelledConnectionsRef.current.delete(id); }, 30000);
    });
    for (const id of allTermIds) {
      AppGo.DisconnectSSH(id).catch(() => {});
    }
    window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => {});
    setSessions([]);
    setTerminalPaneLayouts({});
    setActiveSessionId(null);
    setActiveTerminalId(null);
    setConnectingServers([]);
  }, [persistServerWorkspaceSessionSnapshot, t]);

  // ── 在当前服务器上新建终端标签 ──────────────────────────────
  const openNewTerminal = useCallback(async (sessionId) => {
    markWorkspaceRestoreNavigationOverride();
    if (creatingTerminalRef.current) return;

    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session || session.status !== 'connected') return;

    creatingTerminalRef.current = sessionId;
    setCreatingTerminalSessionId(sessionId);

    const baseTermId = session.terminals?.[0]?.id || sessionId;

    let maxNum = 0;
    (session.terminals || []).forEach(term => {
      const match = term.label?.match(/(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    });
    const termLabel = `${t('终端')}${maxNum + 1}`;

    try {
      const newTermId = await AppGo.OpenTerminal(baseTermId);
      const nextSessions = sessionsRef.current.map((s) => (
        s.id === sessionId
          ? { ...s, terminals: [...(s.terminals || []), { id: newTermId, label: termLabel }] }
          : s
      ));
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setActiveTerminalId(newTermId);
      setContentTab('terminal');
      persistWorkspaceSnapshotRef.current({
        sessions: nextSessions,
        activeSessionId: sessionId,
        activeTerminalId: newTermId,
      });
    } catch (err) {
      addToast(`${t('新建终端失败')}: ${err}`, 'error', 5000);
    } finally {
      creatingTerminalRef.current = null;
      if (mountedRef.current) setCreatingTerminalSessionId(null);
    }
  }, [addToast, markWorkspaceRestoreNavigationOverride, t]);

  // ── 关闭单个终端标签 ──────────────────────────────────────
  const closeTerminal = useCallback((sessionId, terminalId, e) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session?.terminals) return;

    const remaining = (session.terminals || []).filter(t => t.id !== terminalId);
    if (remaining.length === 0) {
      persistServerWorkspaceSessionSnapshot(session, {
        session,
        terminalPaneLayouts: terminalPaneLayoutsRef.current,
        activeTerminalId: activeSessionIdRef.current === sessionId ? activeTerminalIdRef.current : lastTerminalRef.current[sessionId],
        contentTab: activeSessionIdRef.current === sessionId ? contentTabRef.current : (lastContentTabRef.current[sessionId] || 'terminal'),
      });
    }
    AppGo.DisconnectSSH(terminalId).catch(() => {});

    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        if (remaining.length === 0) return null;
        return { ...s, terminals: remaining };
      }).filter(Boolean);
      if (next.length === 0) {
        window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => {});
      }
      return next;
    });

    if (remaining.length === 0) {
      setMountedSessions(prev => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      if (activeSessionIdRef.current === sessionId) {
        switchToNextSession(sessionId);
      }
      return;
    }

    if (activeSessionIdRef.current === sessionId && activeTerminalIdRef.current === terminalId) {
      setActiveTerminalId(resolveSessionRootTerminalId({ ...session, terminals: remaining }, lastTerminalRef.current[sessionId]));
    }
  }, [persistServerWorkspaceSessionSnapshot, resolveSessionRootTerminalId, switchToNextSession]);

  const dispatchTerminalPaneResize = useCallback(() => {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }, []);

  const getTerminalDockLayoutId = useCallback((session, terminalId, layoutSource = terminalPaneLayouts) => {
    if (!session?.id || !terminalId) {
      return null;
    }
    const activeId = activeSessionIdRef.current === session.id ? activeTerminalIdRef.current : null;
    if (activeId && layoutSource[activeId]?.sessionId === session.id) {
      return activeId;
    }
    if (activeId && activeId !== terminalId && getEffectiveTerminals(session).some((term) => term.id === activeId)) {
      const groupedIds = getSessionGroupedTerminalIds(session.id, layoutSource);
      if (!groupedIds.has(activeId)) {
        return activeId;
      }
    }
    const firstGroup = getSessionPaneLayouts(session.id, layoutSource)[0];
    return firstGroup?.id || null;
  }, [getEffectiveTerminals, getSessionGroupedTerminalIds, getSessionPaneLayouts, terminalPaneLayouts]);

  const isTerminalDockTargetOccupied = useCallback((session, terminalId, target, layoutSource = terminalPaneLayouts) => {
    const layoutId = getTerminalDockLayoutId(session, terminalId, layoutSource);
    const targetCellId = getTerminalDockTargetCellId(target);
    if (!layoutId || !targetCellId) {
      return false;
    }
    return getSessionPanes(layoutId, layoutSource).some((pane) => sortTerminalPaneCells(pane.cells).includes(targetCellId));
  }, [getSessionPanes, getTerminalDockLayoutId, terminalPaneLayouts]);

  const getTerminalDockTargetStates = useCallback((session, terminalId, zones, layoutSource = terminalPaneLayouts) => {
    return (zones || []).reduce((acc, zone) => {
      acc[zone.target] = {
        occupied: isTerminalDockTargetOccupied(session, terminalId, zone.target, layoutSource),
        enabled: !!session && canMoveTerminalToDockTargetRef.current?.(session, terminalId, zone.target, layoutSource),
      };
      return acc;
    }, {});
  }, [isTerminalDockTargetOccupied, terminalPaneLayouts]);

  const canMoveTerminalToDockTarget = useCallback((session, terminalId, target, layoutSource = terminalPaneLayouts) => {
    if (!session?.id || !terminalId || !target) {
      return false;
    }

    const rootTerminals = getSessionRootTerminals(session, layoutSource);
    if (!rootTerminals.some((term) => term.id === terminalId)) {
      return false;
    }

    const layoutId = getTerminalDockLayoutId(session, terminalId, layoutSource);
    if (!layoutId) {
      return rootTerminals.some((term) => term.id !== terminalId) && !!splitTerminalPaneCells(TERMINAL_PANE_CELL_IDS, target);
    }

    const targetCellId = getTerminalDockTargetCellId(target);
    if (!targetCellId) {
      return false;
    }

    const panes = getSessionPanes(layoutId, layoutSource);
    const occupiedPane = panes.find((pane) => sortTerminalPaneCells(pane.cells).includes(targetCellId));
    if (occupiedPane) {
      const occupiedCells = sortTerminalPaneCells(occupiedPane.cells);
      return occupiedCells.length === 1 || !!splitTerminalPaneCells(occupiedCells, target);
    }

    return !!splitTerminalPaneCells(getSessionRootPaneCells(layoutId, layoutSource), target);
  }, [getSessionPanes, getSessionRootPaneCells, getSessionRootTerminals, getTerminalDockLayoutId, terminalPaneLayouts]);
  const canMoveTerminalToDockTargetRef = useRef(null);
  useEffect(() => {
    canMoveTerminalToDockTargetRef.current = canMoveTerminalToDockTarget;
  }, [canMoveTerminalToDockTarget]);

  const handleTerminalPaneDrop = useCallback((session, terminalId, target) => {
    if (!session?.id || !terminalId || !target) {
      return;
    }

    let didCreate = false;
    let nextActiveTabId = null;

    setTerminalPaneLayouts((prev) => {
      if (!canMoveTerminalToDockTarget(session, terminalId, target, prev)) {
        return prev;
      }

      const rootTerminals = getSessionRootTerminals(session, prev);
      const layoutId = getTerminalDockLayoutId(session, terminalId, prev)
        || rootTerminals.find((term) => term.id !== terminalId)?.id;
      if (!layoutId || layoutId === terminalId) {
        return prev;
      }

      const existingLayout = prev[layoutId] || { sessionId: session.id, rootTerminalId: layoutId, panes: [] };
      const panes = existingLayout.panes || [];
      const targetCellId = getTerminalDockTargetCellId(target);
      const occupiedPane = targetCellId
        ? panes.find((pane) => sortTerminalPaneCells(pane.cells).includes(targetCellId))
        : null;

      if (occupiedPane) {
        const occupiedCells = sortTerminalPaneCells(occupiedPane.cells);
        const occupiedSplit = occupiedCells.length > 1 ? splitTerminalPaneCells(occupiedCells, target) : null;
        const splitNormalizeOrientation = occupiedSplit?.direction === 'up' || occupiedSplit?.direction === 'down'
          ? 'rows'
          : occupiedSplit?.direction === 'left' || occupiedSplit?.direction === 'right'
            ? 'cols'
            : occupiedPane.normalizeOrientation;

        const nextLayouts = {
          ...prev,
          [layoutId]: {
            ...existingLayout,
            sessionId: session.id,
            rootTerminalId: existingLayout.rootTerminalId || layoutId,
            panes: occupiedSplit
              ? [
                ...panes.map((pane) => (
                  pane.id === occupiedPane.id
                    ? { ...pane, cells: occupiedSplit.remainingCells, normalizeOrientation: splitNormalizeOrientation }
                    : pane
                )),
                {
                  id: `pane_${++terminalPaneIdRef.current}`,
                  terminalId,
                  cells: occupiedSplit.newCells,
                  normalizeOrientation: splitNormalizeOrientation,
                },
              ]
              : panes.map((pane) => (
                pane.id === occupiedPane.id
                  ? { ...pane, terminalId }
                  : pane
              )),
          },
        };

        nextActiveTabId = layoutId;
        didCreate = true;
        return nextLayouts;
      }

      const rootPaneCells = getSessionRootPaneCells(layoutId, prev);
      const rootRect = getTerminalPaneRect(rootPaneCells);
      const splitResult = splitTerminalPaneCells(rootPaneCells, target);
      if (!splitResult || splitResult.newCells.length === 0 || splitResult.remainingCells.length === 0) {
        return prev;
      }

      const normalizeOrientation = rootRect?.width === 1 && rootRect?.height === 2
        ? 'rows'
        : rootRect?.width === 2 && rootRect?.height === 1
          ? 'cols'
          : null;

      const nextLayouts = {
        ...prev,
        [layoutId]: {
          ...existingLayout,
          sessionId: session.id,
          rootTerminalId: existingLayout.rootTerminalId || layoutId,
          panes: [
            ...panes,
            {
              id: `pane_${++terminalPaneIdRef.current}`,
              terminalId,
              cells: splitResult.newCells,
              normalizeOrientation,
            },
          ],
        },
      };

      nextActiveTabId = layoutId;
      didCreate = true;
      return nextLayouts;
    });

    if (!didCreate) {
      return;
    }

    if (activeSessionIdRef.current === session.id) {
      setActiveTerminalId(nextActiveTabId);
    }
    if (nextActiveTabId) {
      lastTerminalRef.current[session.id] = nextActiveTabId;
    }
    setContentTab('terminal');
    setTabContextMenu(null);
    setTerminalTabContextMenu(null);
    dispatchTerminalPaneResize();
  }, [canMoveTerminalToDockTarget, dispatchTerminalPaneResize, getSessionRootPaneCells, getSessionRootTerminals, getTerminalDockLayoutId]);

  const moveTerminalToDockTarget = useCallback((session, terminalId, target) => {
    handleTerminalPaneDrop(session, terminalId, target);
  }, [handleTerminalPaneDrop]);

  const closeTerminalGroup = useCallback((sessionId, layoutId, terminalIds, e) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    const ids = Array.isArray(terminalIds) && terminalIds.length > 0 ? terminalIds : [layoutId];
    const remainingTerminals = (session.terminals || []).filter((item) => !ids.includes(item.id));
    let nextActiveTabId = null;

    setTerminalPaneLayouts((prev) => {
      const next = { ...prev };
      delete next[layoutId];
      if (remainingTerminals.length > 0) {
        const preferredTabId = activeSessionIdRef.current === sessionId ? activeTerminalIdRef.current : lastTerminalRef.current[sessionId];
        nextActiveTabId = resolveSessionRootTerminalId(
          { ...session, terminals: remainingTerminals },
          preferredTabId === layoutId ? null : preferredTabId,
          next,
        );
      }
      return next;
    });

    ids.forEach((id) => AppGo.DisconnectSSH(id).catch(() => {}));

    if (remainingTerminals.length === 0) {
      persistServerWorkspaceSessionSnapshot(session, {
        session,
        terminalPaneLayouts: terminalPaneLayoutsRef.current,
        activeTerminalId: activeSessionIdRef.current === sessionId ? activeTerminalIdRef.current : lastTerminalRef.current[sessionId],
        contentTab: activeSessionIdRef.current === sessionId ? contentTabRef.current : (lastContentTabRef.current[sessionId] || 'terminal'),
      });
      window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => {});
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      setMountedSessions((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      if (activeSessionIdRef.current === sessionId) {
        switchToNextSession(sessionId);
      }
      return;
    }

    setSessions((prev) => prev.map((item) => (
      item.id === sessionId ? { ...item, terminals: remainingTerminals } : item
    )));
    if (nextActiveTabId) {
      lastTerminalRef.current[sessionId] = nextActiveTabId;
    }
    if (activeSessionIdRef.current === sessionId) {
      setContentTab('terminal');
      setActiveTerminalId(nextActiveTabId || null);
    }
    dispatchTerminalPaneResize();
  }, [dispatchTerminalPaneResize, persistServerWorkspaceSessionSnapshot, resolveSessionRootTerminalId, switchToNextSession]);

  const closeTerminalPane = useCallback((layoutId, paneId, e) => {
    e?.stopPropagation();

    let sessionId = null;
    let nextActiveTabId = null;
    let changed = false;

    setTerminalPaneLayouts((prev) => {
      const layout = prev[layoutId];
      const panes = getSessionPanes(layoutId, prev);
      const pane = panes.find((item) => item.id === paneId);
      if (!layout || !pane) {
        return prev;
      }

      sessionId = layout.sessionId;
      const remainingPanes = panes.filter((item) => item.id !== paneId);
      const nextLayouts = { ...prev };
      if (remainingPanes.length > 0) {
        nextLayouts[layoutId] = { ...layout, panes: remainingPanes };
      } else {
        delete nextLayouts[layoutId];
      }

      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (session) {
        const rootCells = getSessionRootPaneCells(layoutId, nextLayouts);
        if (remainingPanes.length === 1 && !isTerminalPaneRectangular(rootCells)) {
          const normalized = normalizeTwoTerminalPaneLayout(
            rootCells,
            remainingPanes[0],
            remainingPanes[0].normalizeOrientation || null,
          );
          if (normalized) {
            nextLayouts[layoutId] = {
              ...layout,
              panes: [
                {
                  ...remainingPanes[0],
                  cells: normalized.paneCells,
                  normalizeOrientation: normalized.orientation,
                },
              ],
            };
          }
        }
        nextActiveTabId = resolveSessionRootTerminalId(session, layoutId, nextLayouts);
      }
      changed = true;
      return nextLayouts;
    });

    if (!changed || !sessionId) {
      return;
    }

    if (nextActiveTabId) {
      lastTerminalRef.current[sessionId] = nextActiveTabId;
    }
    if (activeSessionIdRef.current === sessionId) {
      setContentTab('terminal');
      setActiveTerminalId(nextActiveTabId || null);
    }
    dispatchTerminalPaneResize();
  }, [dispatchTerminalPaneResize, getSessionPanes, getSessionRootPaneCells, resolveSessionRootTerminalId]);

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeSessionId), [sessions, activeSessionId]);
  const isActiveSessionConnected = activeSession?.status === 'connected';
  const isSessionWorkspaceVisible = useCallback((session) => !!session, []);
  const activeSessionRootTerminals = useMemo(() => (
    activeSession ? getSessionWorkspaceTabs(activeSession) : []
  ), [activeSession, getSessionWorkspaceTabs]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
  }, [activeSession, activeSessionId, activeSessionRootTerminals, activeTerminalId, contentTab, mountedSessions, terminalPaneLayouts]);

  const persistWorkspaceSnapshot = useCallback((overrides = {}) => {
    if (!rememberWorkspaceLoaded || !workspaceRestoreReady) {
      return;
    }
    if (restoringWorkspaceRef.current) {
      return;
    }
    const clearSnapshot = () => {
      window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => {});
    };
    const setLiveSnapshot = (payload) => {
      window?.go?.main?.App?.SetLiveWorkspaceState?.(payload).catch(() => {});
    };
    const nextSessions = overrides.sessions || sessionsRef.current;
    const nextActiveSessionId = overrides.activeSessionId ?? activeSessionIdRef.current;
    const nextActiveTerminalId = overrides.activeTerminalId ?? activeTerminalIdRef.current;
    const nextLayouts = overrides.terminalPaneLayouts || terminalPaneLayoutsRef.current;
    const openSessions = nextSessions.filter((session) => session.status !== 'closed' && session.status !== 'error');
    if (openSessions.length === 0) {
      setLiveSnapshot('');
      clearSnapshot();
      return;
    }
    const sessionIds = new Set(openSessions.map((session) => session.id));
    const openTerminalIds = new Set(openSessions.flatMap((session) => (session.terminals || []).map((terminal) => terminal.id)));
    const savedLayouts = Object.fromEntries(
      Object.entries(nextLayouts)
        .filter(([, layout]) => sessionIds.has(layout?.sessionId))
        .map(([layoutId, layout]) => [
          layoutId,
          {
            ...layout,
            sessionId: layout.sessionId,
            rootTerminalId: layout.rootTerminalId || layoutId,
            panes: (layout.panes || []).map((pane) => ({
              ...pane,
              cells: sortTerminalPaneCells(pane.cells),
            })),
          },
        ])
    );
    const savedFileManagerWorkspaces = Object.fromEntries(
      Object.entries(getAllSessionFileManagerWorkspaces())
        .filter(([terminalId]) => openTerminalIds.has(terminalId))
    );
    const savedActiveSessionId = openSessions.some((session) => session.id === nextActiveSessionId)
      ? nextActiveSessionId
      : (openSessions[openSessions.length - 1]?.id || null);
    const savedActiveSession = openSessions.find((session) => session.id === savedActiveSessionId) || openSessions[0] || null;
    const savedActiveTerminalId = savedActiveSession
      ? resolveSessionRootTerminalId(
          savedActiveSession,
          savedActiveSession.id === nextActiveSessionId ? nextActiveTerminalId : lastTerminalRef.current[savedActiveSession.id],
          savedLayouts,
        )
      : null;
    const workspaceStatePayload = JSON.stringify({
      version: 2,
      activeSessionId: savedActiveSessionId,
      activeTerminalId: savedActiveTerminalId,
      sessions: openSessions.map((session) => {
        const workspaceTabs = getSessionWorkspaceTabs(session, savedLayouts).map((tab) => ({
          id: tab.id,
          type: tab.type,
          label: tab.label,
          terminalIds: tab.terminalIds || [tab.id],
        }));
        const terminalOrder = Array.from(new Set([
          ...workspaceTabs.flatMap((tab) => tab.terminalIds || []),
          ...(session.terminals || []).map((term) => term.id),
        ]));
        const terminalById = new Map((session.terminals || []).map((term) => [term.id, term]));
        return {
          id: session.id,
          serverId: session.serverId,
          serverName: session.serverName,
          host: session.host,
          workspaceTabs,
          terminals: terminalOrder
            .map((terminalId) => terminalById.get(terminalId))
            .filter(Boolean)
            .map((term) => ({ id: term.id, label: term.label })),
        };
      }),
      terminalPaneLayouts: savedLayouts,
      fileManagerWorkspaces: savedFileManagerWorkspaces,
    });
    setLiveSnapshot(workspaceStatePayload);
    if (!rememberWorkspace) {
      clearSnapshot();
      return;
    }
    window?.go?.main?.App?.SaveWorkspaceState?.(workspaceStatePayload).catch(() => {});
    if (workspacePersistenceLevel === 'session') {
      openSessions.forEach((session) => {
        persistServerWorkspaceSessionSnapshot(session, {
          session,
          terminalPaneLayouts: savedLayouts,
          activeTerminalId: session.id === savedActiveSessionId ? savedActiveTerminalId : lastTerminalRef.current[session.id],
          contentTab: session.id === savedActiveSessionId ? contentTab : (lastContentTabRef.current[session.id] || 'terminal'),
        });
      });
    }
  }, [activeSessionId, activeTerminalId, contentTab, getSessionWorkspaceTabs, persistServerWorkspaceSessionSnapshot, rememberWorkspace, rememberWorkspaceLoaded, resolveSessionRootTerminalId, sessions, terminalPaneLayouts, workspacePersistenceLevel, workspaceRestoreReady]);

  useEffect(() => {
    persistWorkspaceSnapshotRef.current = persistWorkspaceSnapshot;
  }, [persistWorkspaceSnapshot]);

  useEffect(() => {
    persistWorkspaceSnapshot();
  }, [persistWorkspaceSnapshot]);

  useEffect(() => {
    let timerId = 0;
    const handleWorkspaceChange = () => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        timerId = 0;
        persistWorkspaceSnapshot();
      }, 120);
    };
    window.addEventListener('lumin-file-manager-workspace-changed', handleWorkspaceChange);
    return () => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
      window.removeEventListener('lumin-file-manager-workspace-changed', handleWorkspaceChange);
    };
  }, [persistWorkspaceSnapshot]);

  const terminalSubTabScrollStyle = useMemo(() => ({
    '--terminal-list-scrollbar-thumb': withAlpha(terminalSubTabTheme?.xterm?.cursor, 0.32, 'rgba(var(--accent-rgb), 0.32)'),
    '--terminal-list-scrollbar-thumb-hover': withAlpha(terminalSubTabTheme?.xterm?.blue || terminalSubTabTheme?.xterm?.cursor, 0.58, 'rgba(var(--accent-rgb), 0.58)'),
  }), [terminalSubTabTheme]);
  const syncTerminalSubTabOverflowState = useCallback(() => {
    const el = terminalSubTabScrollRef.current;
    if (!el) {
      setTerminalSubTabOverflow(false);
      setTerminalSubTabCanScrollLeft(false);
      setTerminalSubTabCanScrollRight(false);
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const currentLeft = el.scrollLeft;
    const hasOverflow = maxLeft > 1;
    setTerminalSubTabOverflow(hasOverflow);
    setTerminalSubTabCanScrollLeft(hasOverflow && currentLeft > 1);
    setTerminalSubTabCanScrollRight(hasOverflow && currentLeft < maxLeft - 1);
    if (!hasOverflow) {
      terminalSubTabScrollTargetRef.current = 0;
    }
  }, []);
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
    if (immediate) {
      stopTerminalSubTabScrollAnimation();
      el.scrollLeft = clampedLeft;
      syncTerminalSubTabOverflowState();
      return;
    }
    if (!terminalSubTabScrollFrameRef.current) {
      terminalSubTabScrollFrameRef.current = requestAnimationFrame(stepTerminalSubTabScroll);
    }
  }, [stepTerminalSubTabScroll, stopTerminalSubTabScrollAnimation, syncTerminalSubTabOverflowState]);
  useEffect(() => () => stopTerminalSubTabScrollAnimation(), [stopTerminalSubTabScrollAnimation]);
  useEffect(() => {
    const el = terminalSubTabScrollRef.current;
    if (!el) return undefined;
    const handleResize = () => syncTerminalSubTabOverflowState();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(handleResize) : null;
    observer?.observe(el);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [activeSessionId, activeSessionRootTerminals, contentTab, syncTerminalSubTabOverflowState]);
  useEffect(() => {
    const frame = requestAnimationFrame(syncTerminalSubTabOverflowState);
    return () => cancelAnimationFrame(frame);
  }, [activeSessionId, activeSessionRootTerminals, contentTab, syncTerminalSubTabOverflowState]);
  const handleTerminalSubTabScroll = useCallback((e) => {
    if (!terminalSubTabScrollFrameRef.current) {
      terminalSubTabScrollTargetRef.current = e.currentTarget.scrollLeft;
    }
    syncTerminalSubTabOverflowState();
  }, [syncTerminalSubTabOverflowState]);
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
  const scrollTerminalSubTabs = useCallback((direction) => {
    const el = terminalSubTabScrollRef.current;
    if (!el) {
      return;
    }
    const step = Math.max(96, Math.round(el.clientWidth * 0.45));
    const baseLeft = terminalSubTabScrollFrameRef.current ? terminalSubTabScrollTargetRef.current : el.scrollLeft;
    setTerminalSubTabScrollTarget(baseLeft + step * direction);
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
  const probeSessions = useMemo(() => sessions.filter((s) => (
    s.status === 'connected' || (s.status === 'closed' && monitoringEnabled[s.id])
  )), [monitoringEnabled, sessions]);
  const shouldShowProbePanel = probeSessions.some((s) => s.id === activeSessionId);

  const probePanelNode = shouldShowProbePanel ? (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {probeSessions.map((s) => {
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
              active={isPanelActive && s.status === 'connected'}
              snapshot={probeSnapshots[s.id]}
              onSnapshot={(snapshot) => setProbeSnapshots(prev => ({ ...prev, [s.id]: snapshot }))}
              onEnable={() => setMonitoringEnabled(prev => ({ ...prev, [s.id]: true }))}
              onShowAllProcesses={() => setContentTab('process')}
              onShowNetworkDetails={() => setContentTab('network')}
            />
          </div>
        );
      })}
    </div>
  ) : null;
  const aiPanelNode = isActiveSessionConnected && sessions.length > 0 ? (
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
                sessionTerminals={getEffectiveTerminals(s)}
                addToast={addToast}
                onDevilModeChange={(enabled) => {
                  const panelKey = buildAIWorkspaceTerminalPanelKey(s.id, t.id);
                  if (!panelKey) {
                    return;
                  }
                  setAIPanelDevilModes((prev) => (
                    prev[panelKey] === enabled
                      ? prev
                      : { ...prev, [panelKey]: enabled }
                  ));
                }}
              />
            </div>
          );
        })
      ))}
    </div>
  ) : null;

  // 同步 activeTerminalId / contentTab 到每个 session 的记忆
  useEffect(() => {
    if (activeSessionId && activeTerminalId) {
      lastTerminalRef.current[activeSessionId] = activeTerminalId;
    }
  }, [activeSessionId, activeTerminalId]);

  useEffect(() => {
    if (activeSessionId) {
      lastContentTabRef.current[activeSessionId] = normalizeWorkspaceContentTab(contentTab);
    }
  }, [activeSessionId, contentTab]);

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

  const handleSaveServer = useCallback(async (data, shouldClearAfterAdd = true) => {
    try {
      const savedServer = await saveServerConfig(data);
      if (!savedServer) return null;
      if (data.id) {
        startSaveFlowAnimation(savedServer, data);
      } else {
        addToast(t('服务器添加成功'), 'success');
        if (shouldClearAfterAdd) setServerEditor(null);
      }
      return savedServer;
    } catch (err) {
      addToast(err, 'error');
      return null;
    }
  }, [saveServerConfig, addToast, t, startSaveFlowAnimation]);

  const handleSaveAndConnectServer = useCallback(async (data, shouldClearAfterAdd = true) => {
    markWorkspaceRestoreNavigationOverride();
    try {
      const savedServer = await saveServerConfig(data);
      if (!savedServer) return null;

      addToast(t('服务器添加成功'), 'success');
      if (shouldClearAfterAdd) setServerEditor(null);

      const sessionId = `session_${Date.now()}`;
      const newSession = {
        id: sessionId,
        serverId: savedServer.id,
        serverName: savedServer.name || savedServer.host,
        host: savedServer.host,
        status: 'connecting',
        terminals: [{ id: sessionId, label: `${t('终端')}1` }],
      };

      const nextSessions = [...sessionsRef.current, newSession];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setActiveSessionId(sessionId);
      setActiveTerminalId(sessionId);
      setContentTab('terminal');
      setConnectingServers((prev) => [...prev, { server: savedServer, sessionId, startTime: Date.now() }]);

      // ponytail: 连接放后台，保存成功立即返回让表单可继续添加。升级：暴露连接状态回调。
      (async () => {
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
      })();
      return savedServer;
    } catch (err) {
      addToast(err, 'error');
      return null;
    }
  }, [saveServerConfig, addToast, handleConnectError, markWorkspaceRestoreNavigationOverride, postConnectSetup, t]);

  const handleDeleteServer = useCallback(async (id) => {
    try {
      await AppGo.DeleteConnection(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
      addToast(t('服务器已删除'), 'success');
    } catch {
      addToast(t('删除失败'), 'error');
    }
  }, [addToast]);

  const handleBatchDelete = useCallback(async (ids) => {
    try {
      await AppGo.BatchDeleteConnections(ids);
      setServers((prev) => prev.filter((s) => !ids.includes(s.id)));
      setSelectedServerIds([]);
      addToast(t('服务器已删除'), 'success');
    } catch {
      addToast(t('删除失败'), 'error');
    }
  }, [addToast]);

  const handleGroupDelete = useCallback(async (groupName, ids) => {
    if (await window.luminDialog?.confirm(`${t('确定删除')}「${groupName}」分组的 ${ids.length} ${t('个服务器')}？`)) {
      await handleBatchDelete(ids);
    }
  }, [handleBatchDelete, t]);

  const handleBatchConnect = useCallback(async (ids) => {
    const targets = servers.filter((s) => ids.includes(s.id));
    for (const server of targets) {
      connectServer(server);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    setSelectedServerIds([]);
    setBatchSelectionMode(false);
  }, [servers, connectServer]);

  const handleBatchMoveGroup = useCallback(async (ids, group) => {
    try {
      await AppGo.BatchSetConnectionGroup(ids, group);
      addToast(t('已移动到分组') + (group ? `「${group}」` : ''), 'success');
    } catch (err) {
      addToast(err?.message || err || t('移动分组'), 'error');
    } finally {
      try {
        await loadServers();
      } catch (err) {
        console.error('Failed to load servers:', err);
      }
      setSelectedServerIds([]);
    }
  }, [loadServers, addToast, t]);



  const toggleBatchSelection = useCallback((idOrArray) => {
    if (Array.isArray(idOrArray)) {
      // 传入数组：切换/设置多个
      if (idOrArray.length === 0) {
        setSelectedServerIds([]);
        return;
      }
      // 如果传入的是带 selected 属性的对象数组
      if (idOrArray[0] && typeof idOrArray[0] === 'object' && 'selected' in idOrArray[0]) {
        const newSet = new Set(selectedServerIds);
        idOrArray.forEach(({ id, selected }) => {
          if (selected) newSet.add(id); else newSet.delete(id);
        });
        setSelectedServerIds([...newSet]);
        return;
      }
      setSelectedServerIds(idOrArray);
      return;
    }
    // 传入单个 id：切换选中状态
    setSelectedServerIds((prev) => {
      if (prev.includes(idOrArray)) {
        return prev.filter((id) => id !== idOrArray);
      }
      return [...prev, idOrArray];
    });
  }, [selectedServerIds]);

  // ── 节点导入/导出（数据管理） ───────────────────────────────
  const [showImportExportDialog, setShowImportExportDialog] = useState(false);
  const [showExportSelectedDialog, setShowExportSelectedDialog] = useState(false);
  const [exportSelectedIds, setExportSelectedIds] = useState([]);
  const [ieBusy, setIeBusy] = useState(false);
  const [hasRecoveryPassword, setHasRecoveryPassword] = useState(false);

  const handleOpenImportExport = useCallback(async () => {
    try {
      const configured = await AppGo.HasRecoveryPassword();
      setHasRecoveryPassword(!!configured);
    } catch { setHasRecoveryPassword(false); }
    setShowImportExportDialog(true);
  }, []);

  const handleExport = useCallback(async (opts) => {
    setIeBusy(true);
    try {
      let path = '';
      if (opts.serverIds && opts.serverIds.length > 0) {
        path = await AppGo.ExportConnectionsByIDs(opts.serverIds, !!opts.useEncryption, opts.password || '');
      } else {
        path = await AppGo.ExportConnections(!!opts.useEncryption, opts.password || '');
      }
      if (!path) { return; } // 用户取消保存对话框
      addToast(t('已导出到 {path}', { path }), 'success');
    } catch (err) {
      addToast(`${t('导出失败')}: ${err}`, 'error');
    } finally {
      setIeBusy(false);
    }
  }, [addToast, t]);

  const handleBatchExport = useCallback(async (ids) => {
    try {
      const configured = await AppGo.HasRecoveryPassword();
      setHasRecoveryPassword(!!configured);
    } catch { setHasRecoveryPassword(false); }
    setExportSelectedIds(ids);
    setShowExportSelectedDialog(true);
  }, []);

  const handleExportSelected = useCallback(async (opts) => {
    setIeBusy(true);
    try {
      const path = await AppGo.ExportConnectionsByIDs(exportSelectedIds, !!opts.useEncryption, opts.password || '');
      if (!path) { return; } // 用户取消保存对话框
      addToast(t('已成功导出选择的 {count} 个节点到 {path}', { count: exportSelectedIds.length, path }), 'success');
      setShowExportSelectedDialog(false);
      setExportSelectedIds([]);
    } catch (err) {
      addToast(`${t('导出失败')}: ${err}`, 'error');
    } finally {
      setIeBusy(false);
    }
  }, [exportSelectedIds, addToast, t]);

  // 导入流程：选文件 → 尝试导入 → 若需要密码则弹 luminDialog.prompt 取密码 → 重试
  // 注意：用单一 try-finally 包裹全流程，保证任意路径退出（含用户取消文件选择/
  // 取消密码框）都重置 ieBusy，否则按钮会永久禁用。
  const handleImport = useCallback(async () => {
    setIeBusy(true);
    try {
      // 1. 选文件
      let filePath = '';
      try {
        filePath = await AppGo.SelectImportFile();
      } catch (err) {
        addToast(`${t('导入失败')}: ${err}`, 'error');
        return;
      }
      if (!filePath) { return; } // 用户取消文件选择，静默

      // 尝试导入：先不传自定义密码，让后端自动尝试明文、恢复密码、旧版云同步密钥；失败才弹窗输入自定义密码
      const doImport = async (pwd) => {
        const result = await AppGo.ImportConnections(filePath, pwd);
        // 后端取消时返回空 ImportResult（全 0），静默
        if (result && result.total === 0 && result.imported === 0 && result.skipped === 0) {
          return { silent: true };
        }
        return { result, silent: false };
      };

      const finishImportSuccess = (result) => {
        if (result.imported > 0 || result.skipped > 0) {
          addToast(t('已导入 {imported} 个，跳过 {skipped} 个重复', { imported: result.imported, skipped: result.skipped }), 'success');
        }
        void loadServers();
      };

      // 2. 首次自动尝试（不传自定义密码）
      try {
        const outcome = await doImport('');
        if (outcome.silent) { return; }
        finishImportSuccess(outcome.result);
      } catch (err) {
        // 检测 needPassword：后端返回的 error 字符串含 "need password"
        if (String(err).includes('need password')) {
          // 弹密码框让用户输入
          const pwd = await window.luminDialog?.prompt?.(
            t('密文需要密码请输入'),
            '',
            t('导入密码'),
            t(' ')
          );
          if (pwd === null) { return; } // 用户取消密码框
          const pwdStr = typeof pwd === 'object' ? pwd.value : pwd;
          try {
            const outcome = await doImport(pwdStr);
            if (outcome.silent) { return; }
            finishImportSuccess(outcome.result);
          } catch (err2) {
            addToast(`${t('导入失败')}: ${t('密码错误或文件不兼容')}`, 'error');
          }
        } else {
          addToast(`${t('导入失败')}: ${err}`, 'error');
        }
      }
    } finally {
      setIeBusy(false);
    }
  }, [addToast, loadServers, t]);

  const handleDownloadTemplate = useCallback(async () => {
    setIeBusy(true);
    try {
      const path = await AppGo.DownloadImportTemplate(lang);
      if (!path) { return; } // 用户取消
      addToast(t('已下载模板到 {path}', { path }), 'success');
    } catch (err) {
      addToast(`${t('模板下载失败')}: ${err}`, 'error');
    } finally {
      setIeBusy(false);
    }
  }, [addToast, t, lang]);

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
          <div className="topbar-logo" onClick={() => { markWorkspaceRestoreNavigationOverride(); setActiveSessionId(null); setActiveTerminalId(null); setShowSettings(false); }}>
            <div
              style={{
                width: 20,
                height: 20,
                position: 'relative',
                borderRadius: 'var(--radius-xs)',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <img
                src={logoImg}
                alt="Lumin SSH"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: showTopbarRefreshedLogo ? 0 : 1,
                  transform: showTopbarRefreshedLogo ? 'scale(0.9) rotate(-8deg)' : 'scale(1) rotate(0deg)',
                  filter: showTopbarRefreshedLogo ? 'blur(8px)' : 'blur(0px)',
                  transition: 'opacity 0.6s ease, transform 0.7s cubic-bezier(0.22, 1, 0.36, 1), filter 0.6s ease',
                }}
              />
              <img
                src={topbarLogoTransitionImg}
                alt="Lumin Theme Logo"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: showTopbarRefreshedLogo ? 1 : 0,
                  transform: showTopbarRefreshedLogo ? 'scale(1) rotate(0deg)' : 'scale(1.12) rotate(8deg)',
                  filter: showTopbarRefreshedLogo ? 'blur(0px)' : 'blur(10px)',
                  transition: 'opacity 0.6s ease, transform 0.7s cubic-bezier(0.22, 1, 0.36, 1), filter 0.6s ease',
                }}
              />
            </div>
            <div className="topbar-title">Lumin</div>
          </div>
          
          {sessions.length > 0 && (
            <div className="tab-bar">
              <Tiptop text={t('返回主页')} placement="bottom">
                <button
                  className="btn btn-ghost btn-sm no-drag"
                  onClick={() => { markWorkspaceRestoreNavigationOverride(); setActiveSessionId(null); setActiveTerminalId(null); }}
                  aria-label={t('返回主页')}
                  style={{ flexShrink: 0 }}
                >
                  <House size={14} />
                </button>
              </Tiptop>
              <div className="tab-scroll" ref={tabScrollRef}>
                <div ref={tabListRef} className="tab-list">
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
                        <Tiptop text={t('重新连接')} placement="bottom">
                          <span
                            className="tab-reconnect no-drag"
                            onClick={(e) => {
                              e.stopPropagation();
                              reconnectSession(s);
                            }}
                            aria-label={t('重新连接')}
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <RefreshCw size={12} />
                          </span>
                        </Tiptop>
                      )}
                      <span className="tab-close no-drag" onClick={(e) => closeSession(s.id, e)}><X size={12} /></span>
                    </div>
                  ))}
                </div>
              </div>
              <div ref={tabActionsRef} className="tab-actions">
                {tabsOverflow && (
                  <Tiptop text={t('服务器列表')} placement="bottom">
                    <button
                      ref={sessionListBtnRef}
                      className="btn btn-icon no-drag"
                      onClick={toggleSessionList}
                      aria-label={t('服务器列表')}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </Tiptop>
                )}
                {sessions.length >= 2 && (
                  <Tiptop text={t('关闭全部')} placement="bottom">
                    <button
                      className="btn btn-danger btn-sm no-drag"
                      onClick={closeAllSessions}
                      aria-label={t('关闭全部')}
                    >
                      <X size={12} /> {t('关闭全部')}
                    </button>
                  </Tiptop>
                )}
              </div>
            </div>
          )}
          {sessions.length === 0 && <div style={{ flex: 1 }}></div>}

          <div className="window-controls">
            {showThemeQuickEntry && !activeAIDevilMode && (
              <Tiptop text={resolvedQuickThemeMode === 'light' ? t('深色') : t('浅色')} placement="bottom">
                <button
                  type="button"
                  className="btn btn-ghost no-drag"
                  onClick={handleQuickThemeToggle}
                  aria-label={resolvedQuickThemeMode === 'light' ? t('深色') : t('浅色')}
                  style={{
                    position: 'relative',
                    width: 52,
                    height: 28,
                    padding: 3,
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: resolvedQuickThemeMode === 'light' ? 'rgba(250, 204, 21, 0.12)' : 'rgba(99, 102, 241, 0.16)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 0,
                    overflow: 'hidden',
                    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: resolvedQuickThemeMode === 'light' ? 3 : 27,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'var(--surface-overlay)',
                      boxShadow: 'var(--shadow-sm)',
                      transition: 'left 0.2s ease',
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      width: 16,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: resolvedQuickThemeMode === 'light' ? '#f59e0b' : 'var(--text-tertiary)',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    <Sun size={13} />
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      width: 16,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: resolvedQuickThemeMode === 'dark' ? '#a78bfa' : 'var(--text-tertiary)',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    <Moon size={13} />
                  </span>
                </button>
              </Tiptop>
            )}
            {activeSessionId !== null && isActiveSessionConnected && sessions.length > 0 && (
              <Tiptop text={showAIPanel ? t('收起 AI 助手面板') : t('打开 AI 助手面板')} placement="bottom">
                <button
                  className="btn btn-ghost btn-icon no-drag"
                  onClick={() => setAIPanelVisibility(!showAIPanel)}
                  aria-label={showAIPanel ? t('收起 AI 助手面板') : t('打开 AI 助手面板')}
                  style={{ color: showAIPanel ? 'var(--accent)' : undefined }}
                >
                  <Bot size={16} />
                </button>
              </Tiptop>
            )}
            {startupUpdateInfo && (
              <Tiptop text={`${t('发现新版本')} ${startupUpdateInfo.version}`} placement="bottom">
                <div className="update-entry no-drag" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <div
                    className={`update-bubble${showUpdateBubble ? ' visible' : ''}`}
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 10px)',
                      right: -4,
                      opacity: showUpdateBubble ? 1 : 0,
                      transform: `translateY(${showUpdateBubble ? '0' : '-8px'}) scale(${showUpdateBubble ? '1' : '0.94'})`,
                      pointerEvents: 'none',
                      zIndex: Z.POPOVER,
                    }}
                  >
                    <span className="update-bubble-pulse" />
                    <span className="update-bubble-dot" />
                    <div className="update-bubble-content">
                      <span className="update-bubble-pill">{t('发现新版本')}</span>
                      <span className="update-bubble-text">{startupUpdateInfo.version}</span>
                    </div>
                  </div>
                  <button
                    className={`btn btn-ghost btn-icon no-drag update-entry-button${isUpdateModalVisible ? ' active' : ''}`}
                    onClick={() => {
                      setShowUpdateBubble(false);
                      setIsUpdateModalVisible(true);
                    }}
                    aria-label={`${t('发现新版本')} ${startupUpdateInfo.version}`}
                    style={{
                      color: isUpdateModalVisible ? 'var(--accent)' : 'var(--text-secondary)',
                      position: 'relative',
                      overflow: 'visible',
                    }}
                  >
                    <Rocket size={16} />
                    <span
                      className="update-entry-badge"
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--danger)',
                        boxShadow: '0 0 0 2px var(--surface-base)',
                      }}
                    />
                  </button>
                </div>
              </Tiptop>
            )}
            <Tiptop text={t('设置')} placement="bottom">
              <button
                className="btn btn-ghost btn-icon no-drag"
                onClick={() => {
                  setSettingsInitialTab('general');
                  setShowSettings(true);
                }}
                aria-label={t('设置')}
              ><Settings size={16} /></button>
            </Tiptop>
            <div className="window-divider" />
            <Tiptop text={t('最小化')} placement="bottom">
              <button className="btn btn-ghost btn-icon no-drag" onClick={WindowMinimise} aria-label={t('最小化')}><Minus size={14} /></button>
            </Tiptop>
            <Tiptop text={t('最大化')} placement="bottom">
              <button className="btn btn-ghost btn-icon no-drag" onClick={handleToggleMaximise} aria-label={t('最大化')}><Square size={14} /></button>
            </Tiptop>
            <Tiptop text={t('关闭')} placement="bottom">
              <button className="btn btn-ghost btn-icon no-drag" aria-label={t('关闭')} onClick={handleCloseWindow}><X size={14} /></button>
            </Tiptop>
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
            pingEnabled={pingEnabled}
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
            onOpenImportExport={handleOpenImportExport}
            selectionMode={batchSelectionMode}
            selectedIds={selectedServerIds}
            onSelectChange={toggleBatchSelection}
            onBatchDelete={handleBatchDelete}
            onBatchConnect={handleBatchConnect}
            onBatchMoveGroup={handleBatchMoveGroup}
            onGroupDelete={handleGroupDelete}
            onBatchExport={handleBatchExport}
            onExitSelectionMode={() => setBatchSelectionMode(false)}
            onSelectionModeToggle={() => setBatchSelectionMode(prev => {
              if (!prev) return true;
              return false;
            })}
          />
        </div>

        <div data-ai-workspace-root="true" style={{ display: activeSessionId !== null ? 'flex' : 'none', flexDirection: 'row', height: '100%', flex: 1, overflow: 'hidden', position: 'relative' }}>
          {aiPanelNode && probePanelPosition === 'right' && (
            <>
              {aiPanelNode}
              {showAIPanel ? (
                <Tiptop text={t('收起 AI 助手面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v${collapseDragIntent === 'ai' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'ai')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setAIPanelVisibility(false);
                    }}
                    aria-label={t('收起 AI 助手面板')}
                  />
                </Tiptop>
              ) : (
                <Tiptop text={t('打开 AI 助手面板')} placement="bottom">
                  <button
                    type="button"
                    className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                    onClick={() => setAIPanelVisibility(true)}
                    aria-label={t('打开 AI 助手面板')}
                  >
                    <ChevronRight size={14} />
                  </button>
                </Tiptop>
              )}
            </>
          )}
          {/* 系统监控探针面板（独立分栏，左侧） */}
          {probePanelNode && probePanelPosition === 'left' && (
            probePanelCollapsed ? (
              <Tiptop text={t('展开监控面板')} placement="bottom">
                <button
                  type="button"
                  className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                  onClick={() => setProbePanelCollapsedPersistent(false)}
                  aria-label={t('展开监控面板')}
                >
                  <ChevronRight size={14} />
                </button>
              </Tiptop>
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
                <Tiptop text={t('收起监控面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v probe-resizer${collapseDragIntent === 'probe' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'probe')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setProbePanelCollapsedPersistent(true);
                    }}
                    aria-label={t('收起监控面板')}
                  />
                </Tiptop>
              </>
            )
          )}
          {/* 左侧主区域：标签、终端子标签、会话内容 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', overflow: 'hidden' }}>
            {/* ── 终端子标签栏（多终端支持） ──────────────────── */}
            {activeSession && isActiveSessionConnected && (contentTab === 'terminal' || contentTab === 'process' || contentTab === 'network' || contentTab === 'history' || (fileManagerPosition === 'tab' && contentTab === 'files')) && isSessionWorkspaceVisible(activeSession) && activeSession.terminals && activeSession.terminals.length >= 1 && (
              <div className="terminal-sub-tab-bar">
                {terminalSubTabOverflow && (
                  <button
                    type="button"
                    className={`terminal-sub-tab-nav terminal-sub-tab-nav-left${terminalSubTabCanScrollLeft ? '' : ' disabled'}`}
                    onClick={() => scrollTerminalSubTabs(-1)}
                    aria-label={t('向左滚动标签')}
                    title={t('向左滚动标签')}
                    disabled={!terminalSubTabCanScrollLeft}
                  >
                    <ChevronLeft size={14} />
                  </button>
                )}
                <div
                  ref={terminalSubTabScrollRef}
                  className="terminal-sub-tab-scroll"
                  style={terminalSubTabScrollStyle}
                  onWheel={handleTerminalSubTabWheel}
                  onMouseDown={handleTerminalSubTabMouseDown}
                  onScroll={handleTerminalSubTabScroll}
                  onClickCapture={handleTerminalSubTabClickCapture}
                >
                  {activeSessionRootTerminals.map((term) => {
                    const canPreviewDock = term.type === 'terminal' && activeSessionRootTerminals.length > 1;
                    return (
                      <Tiptop key={term.id} text={term.label} placement="bottom">
                        <div
                          className={`terminal-sub-tab ${activeTerminalId === term.id ? 'active' : ''}`}
                          onMouseDown={canPreviewDock ? (e) => handleTerminalSubTabDockMouseDown(e, activeSession, term) : undefined}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setTabContextMenu(null);
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTerminalTabContextMenu({
                              sessionId: activeSession.id,
                              terminalId: term.id,
                              type: term.type,
                              terminalIds: term.terminalIds,
                              label: term.label,
                              x: rect.left,
                              y: rect.bottom + 4,
                            });
                          }}
                          onClick={() => {
                            if (shouldIgnoreTerminalDockClick()) return;
                            markWorkspaceRestoreNavigationOverride();
                            setTerminalTabContextMenu(null);
                            setActiveTerminalId(term.id);
                            setContentTab('terminal');
                            lastTerminalRef.current[activeSession.id] = term.id;
                            persistWorkspaceSnapshotRef.current({
                              activeSessionId: activeSession.id,
                              activeTerminalId: term.id,
                            });
                          }}
                        >
                          <Monitor size={11} />
                          <span>{term.label}</span>
                          {activeSessionRootTerminals.length > 1 && (
                            <span
                              className="terminal-sub-tab-close"
                              onClick={(e) => {
                                if (term.type === 'group') {
                                  closeTerminalGroup(activeSession.id, term.id, term.terminalIds, e);
                                  return;
                                }
                                closeTerminal(activeSession.id, term.id, e);
                              }}
                            ><X size={10} /></span>
                          )}
                        </div>
                      </Tiptop>
                    );
                  })}
                </div>
                {terminalSubTabOverflow && (
                  <button
                    type="button"
                    className={`terminal-sub-tab-nav terminal-sub-tab-nav-right${terminalSubTabCanScrollRight ? '' : ' disabled'}`}
                    onClick={() => scrollTerminalSubTabs(1)}
                    aria-label={t('向右滚动标签')}
                    title={t('向右滚动标签')}
                    disabled={!terminalSubTabCanScrollRight}
                  >
                    <ChevronRight size={14} />
                  </button>
                )}
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
              <div id="session-editor-container" style={{ flex: 1, display: 'flex', flexDirection: 'row', height: '100%', position: 'relative', overflow: 'hidden' }}>
                {/* 主体视口 */}
                <div id="editor-main-content" style={{ flex: 1, position: 'relative', overflow: 'hidden', order: 1 }}>
                  {sessions.map((s) => {
                    const shouldMountFileManager = s.status === 'connected'
                      && mountedSessions.has(s.id);
                    const showSplitFileManager = shouldMountFileManager
                      && contentTab !== 'process'
                      && contentTab !== 'network'
                      && fileManagerPosition !== 'tab';
                    const showTabFileManager = shouldMountFileManager
                      && fileManagerPosition === 'tab'
                      && contentTab === 'files';
                    const sessionConnectingServer = connectingServers.find((item) => item.sessionId === s.id) || null;
                    const showLeftFileManager = showSplitFileManager && fileManagerPosition === 'left' && !fileManagerCollapsed;
                    const showBottomFileManager = showSplitFileManager && fileManagerPosition === 'bottom' && !fileManagerCollapsed;
                    const showBottomQuickCommands = showQuickCommands
                      && s.status === 'connected'
                      && activeSessionId === s.id
                      && contentTab === 'terminal';
                    const showBottomDockPanel = showBottomFileManager || showBottomQuickCommands;
                    const showLeftCollapseStrip = showSplitFileManager && fileManagerPosition === 'left' && fileManagerCollapsed;
                    const showBottomCollapseStrip = showSplitFileManager && fileManagerPosition === 'bottom' && fileManagerCollapsed && !showBottomQuickCommands;
                    const showFileManagerPanel = showTabFileManager || showLeftFileManager || showBottomFileManager;
                    return (
                      <div
                        key={s.id}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: activeSessionId === s.id ? 'flex' : 'none',
                          flexDirection: 'column',
                        }}
                      >
                        {showLeftCollapseStrip && (
                          <button
                            type="button"
                            className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-left no-drag"
                            onClick={() => setFileManagerCollapsedPersistent(false)}
                            aria-label={t('展开文件管理面板')}
                            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: Z.PANEL_BUTTON + 1 }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        )}
                        {showBottomCollapseStrip && (
                          <button
                            type="button"
                            className="panel-collapse-strip panel-collapse-strip-horizontal panel-collapse-strip-bottom no-drag"
                            onClick={() => setFileManagerCollapsedPersistent(false)}
                            aria-label={t('展开文件管理面板')}
                            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: Z.PANEL_BUTTON + 1 }}
                          >
                            <ChevronUp size={14} />
                          </button>
                        )}
                        {shouldMountFileManager && (
                          <div
                            style={{
                              position: 'absolute',
                              display: showFileManagerPanel ? 'flex' : 'none',
                              flexDirection: 'column',
                              overflow: 'hidden',
                              background: 'var(--surface-base)',
                              zIndex: 1,
                              ...(showLeftFileManager ? {
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${leftSplitWidth}px`,
                                minWidth: `${FILE_MANAGER_LEFT_MIN}px`,
                                borderRight: '1px solid var(--border)',
                              } : {}),
                              ...(showBottomFileManager ? {
                                left: 0,
                                right: 0,
                                bottom: 0,
                                height: `${bottomSplitHeight}px`,
                                minHeight: `${FILE_MANAGER_BOTTOM_MIN}px`,
                                borderTop: '1px solid var(--border)',
                              } : {}),
                              ...(showTabFileManager ? {
                                inset: 0,
                              } : {}),
                            }}
                          >
                            {showLeftFileManager && collapseDragIntent === 'left' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-vertical panel-collapse-armed-zone-right">
                                <ChevronLeft size={14} />
                              </div>
                            )}
                            {showBottomFileManager && !showBottomQuickCommands && collapseDragIntent === 'bottom' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-horizontal panel-collapse-armed-zone-top">
                                <ChevronDown size={14} />
                              </div>
                            )}
                            {renderSessionFileManagers(s)}
                          </div>
                        )}
                        {showBottomQuickCommands && (
                          <div
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              // 左侧文件管理器打开时，命令面板只占右侧，不盖住文件管理器
                              left: showLeftFileManager ? `${leftSplitWidth + 4}px` : 0,
                              right: 0,
                              bottom: 0,
                              height: `${bottomSplitHeight}px`,
                              minHeight: `${FILE_MANAGER_BOTTOM_MIN}px`,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'visible',
                              background: 'var(--surface-base)',
                              borderTop: '1px solid var(--border)',
                              // 高于终端区，避免输入栏按钮被拖条拦截
                              zIndex: Z.PANEL_BUTTON + 4,
                            }}
                          >
                            {/* 拖条放在面板顶部内部，不再与终端「历史/命令」按钮重叠 */}
                            <div
                              className={`split-resizer-h${collapseDragIntent === 'bottom' ? ' armed' : ''}`}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                startDrag(e, 'bottom');
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                              aria-label={t('调整快捷命令高度')}
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                top: -2,
                                height: 6,
                                zIndex: 5,
                                margin: 0,
                              }}
                            />
                            {collapseDragIntent === 'bottom' && (
                              <div className="panel-collapse-armed-zone panel-collapse-armed-zone-horizontal panel-collapse-armed-zone-top">
                                <ChevronDown size={14} />
                              </div>
                            )}
                            <QuickCommands
                              ref={quickCmdsRef}
                              sessionId={activeTerminalId || s.id}
                              addToast={addToast}
                              connectedSessions={connectedSessions}
                              onClose={() => setShowQuickCommands(false)}
                            />
                          </div>
                        )}
                        {showLeftFileManager && (
                          <div
                            className={`split-resizer-v${collapseDragIntent === 'left' ? ' armed' : ''}`}
                            onMouseDown={(e) => startDrag(e, 'left')}
                            onClick={() => {
                              if (shouldIgnoreResizerClick()) return;
                              setFileManagerCollapsedPersistent(true);
                            }}
                            aria-label={t('收起文件管理面板')}
                            style={{
                              position: 'absolute',
                              left: `${leftSplitWidth - 2}px`,
                              top: 0,
                              // 底部有命令面板时，竖拖条不要被底部面板盖住
                              bottom: showBottomQuickCommands ? `${bottomSplitHeight}px` : 0,
                              zIndex: Z.PANEL_BUTTON + 5,
                              marginLeft: 0,
                              marginRight: 0,
                            }}
                          />
                        )}
                        {/* 仅文件管理器底部模式用外部分隔条；快捷命令用面板内拖条 */}
                        {showBottomFileManager && !showBottomQuickCommands && (
                          <div
                            className={`split-resizer-h${collapseDragIntent === 'bottom' ? ' armed' : ''}`}
                            onMouseDown={(e) => startDrag(e, 'bottom')}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (shouldIgnoreResizerClick()) return;
                              setFileManagerCollapsedPersistent(true);
                            }}
                            aria-label={t('收起文件管理面板')}
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: `${bottomSplitHeight - 2}px`,
                              zIndex: Z.PANEL_BUTTON,
                              marginTop: 0,
                              marginBottom: 0,
                            }}
                          />
                        )}
                        <div
                          id="terminal-dock-preview-host"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            flex: 1,
                            minWidth: 0,
                            minHeight: 0,
                            overflow: 'hidden',
                            marginLeft: showLeftFileManager ? `${leftSplitWidth + 4}px` : 0,
                            marginBottom: showBottomDockPanel ? `${bottomSplitHeight + 4}px` : 0,
                          }}
                        >
                          <div style={{ display: (contentTab === 'terminal' || s.status !== 'connected') ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', position: 'relative' }}>
                            {mountedSessions.has(s.id) && (
                              isSessionWorkspaceVisible(s) ? (() => {
                                const isTerminalViewActive = activeSessionId === s.id && (contentTab === 'terminal' || s.status !== 'connected');
                                const workspaceTabs = getSessionWorkspaceTabs(s);
                                const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === activeTerminalId);
                                const activeLayout = activeWorkspaceTab?.type === 'group' ? terminalPaneLayouts[activeWorkspaceTab.id] : null;
                                const activeLayoutId = activeLayout?.sessionId === s.id ? activeWorkspaceTab.id : null;
                                const terminalPlacements = new Map();
                                if (activeLayoutId) {
                                  terminalPlacements.set(activeLayout.rootTerminalId || activeLayoutId, {
                                    cells: getSessionRootPaneCells(activeLayoutId),
                                    layoutId: activeLayoutId,
                                    paneId: null,
                                    showHeader: false,
                                  });
                                  getSessionPanes(activeLayoutId).forEach((pane) => {
                                    terminalPlacements.set(pane.terminalId, {
                                      cells: pane.cells,
                                      layoutId: activeLayoutId,
                                      paneId: pane.id,
                                      showHeader: true,
                                    });
                                  });
                                } else if (activeWorkspaceTab?.type === 'terminal') {
                                  terminalPlacements.set(activeWorkspaceTab.id, {
                                    cells: TERMINAL_PANE_CELL_IDS,
                                    layoutId: null,
                                    paneId: null,
                                    showHeader: false,
                                  });
                                }
                                return getEffectiveTerminals(s).map((term) => {
                                  const placement = terminalPlacements.get(term.id);
                                  const isTermVisible = !!placement && isTerminalViewActive;
                                  const isGrouped = !!placement?.layoutId;
                                  return (
                                    <div
                                      key={term.id}
                                      style={{
                                        position: 'absolute',
                                        ...getTerminalPaneAbsolutePlacement(placement?.cells || TERMINAL_PANE_CELL_IDS),
                                        display: 'flex',
                                        flexDirection: 'column',
                                        visibility: isTermVisible ? 'visible' : 'hidden',
                                        pointerEvents: isTermVisible ? 'auto' : 'none',
                                        contain: isTermVisible ? 'none' : 'strict',
                                        minWidth: 0,
                                        minHeight: 0,
                                        overflow: 'hidden',
                                        border: isGrouped ? '1px solid var(--border)' : 'none',
                                        borderRadius: 0,
                                        background: 'var(--surface-base)',
                                      }}
                                    >
                                      {placement?.showHeader && (
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            minHeight: 32,
                                            padding: '0 10px',
                                            borderBottom: '1px solid var(--border-subtle)',
                                            background: 'var(--surface-raised)',
                                            color: 'var(--text-secondary)',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            flexShrink: 0,
                                          }}
                                        >
                                          <Monitor size={12} />
                                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {term.label}
                                          </span>
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm no-drag"
                                            onClick={(e) => closeTerminalPane(placement.layoutId, placement.paneId, e)}
                                            aria-label={t('关闭分屏')}
                                            style={{ minHeight: 24, padding: '0 6px' }}
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      )}
                                      <div style={{ flex: 1, minHeight: 0 }}>
                                        <ErrorBoundary label={`终端 ${term.id} 渲染出错`}>
                                          <Terminal
                                            sessionId={term.id}
                                            serverId={s.id}
                                            historyServerId={s.serverId}
                                            status={s.status}
                                            isActive={isTermVisible}
                                            serverName={s.serverName}
                                            connectedSessions={connectedSessions}
                                            showCommands={showQuickCommands && isTermVisible}
                                            onQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                                            quickCmdsRef={quickCmdsRef}
                                          />
                                        </ErrorBoundary>
                                      </div>
                                    </div>
                                  );
                                });
                              })() : (getEffectiveTerminals(s).map((t) => {
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
                                        showCommands={showQuickCommands && activeSessionId === s.id && activeTerminalId === t.id}
                                        onQuickCommandsOpenChange={handleQuickCommandsOpenChange}
                                        quickCmdsRef={quickCmdsRef}
                                      />
                                    </ErrorBoundary>
                                  </div>
                                );
                              }))
                            )}
                            {restoringWorkspaceSessionIds.has(s.id) && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  zIndex: Z.COMPONENT_OVERLAY,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 10,
                                  background: 'var(--surface-base)',
                                  color: 'var(--text-secondary)',
                                  fontSize: 13,
                                  pointerEvents: 'none',
                                }}
                              >
                                <RefreshCw size={16} className="spin" />
                                <span>{t('正在恢复终端工作区…')}</span>
                              </div>
                            )}
                          </div>
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
                          {sessionConnectingServer && s.status === 'connecting' && (
                            <ConnectingCard
                              connectingServer={sessionConnectingServer}
                              t={t}
                              onCancel={() => handleCancelConnection(s.id)}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                {terminalDockDragPreview && terminalDockDragPreview.zones.length > 0 && (
                  <>
                    <div
                      className="terminal-pane-dock-preview-layer"
                      aria-hidden="true"
                      style={{ position: 'fixed', inset: 0, zIndex: Z.PANEL_BUTTON + 7 }}
                    >
                      {terminalDockDragPreview.zones.map((zone) => (
                        <div
                          key={zone.target}
                          className={`terminal-pane-dock-preview-slot${terminalDockDragPreview.activeTarget === zone.target ? ' active' : ''}${terminalDockDragPreview.zoneStates?.[zone.target]?.occupied ? ' occupied' : ''}${terminalDockDragPreview.zoneStates?.[zone.target]?.enabled === false ? ' disabled' : ''}`}
                          style={zone.style}
                        >
                          <span className="terminal-pane-dock-preview-label">{zone.label}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      className="terminal-pane-dock-drag-ghost"
                      aria-hidden="true"
                      style={{
                        left: `${terminalDockDragPreview.pointer.x}px`,
                        top: `${terminalDockDragPreview.pointer.y}px`,
                        zIndex: Z.MODAL - 1,
                      }}
                    >
                      <Monitor size={12} />
                      <span>{terminalDockDragPreview.label}</span>
                    </div>
                  </>
                )}
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
                  queueLength={activeChangeReviewQueue.length}
                />
              ) : null}
              {activeRestorePreviewReview?.review ? (
                <AIChangeReviewWorkbench
                  review={activeRestorePreviewReview.review}
                  queueLength={1}
                  previewOnly={true}
                  onClose={() => {
                    if (!activeWorkspaceTerminalKey) {
                      return;
                    }
                    setRestorePreviewReviews((prev) => {
                      if (!prev[activeWorkspaceTerminalKey]) {
                        return prev;
                      }
                      const next = { ...prev };
                      delete next[activeWorkspaceTerminalKey];
                      return next;
                    });
                  }}
                />
              ) : null}
              {activeConversationDiffPanel ? (
                <AIConversationDiffOverlay
                  sessionLabel={
                    sessions.find((item) => item.id === activeConversationDiffPanel.sessionId)?.serverName
                    || sessions.find((item) => item.id === activeConversationDiffPanel.sessionId)?.host
                    || activeConversationDiffPanel.sessionId
                  }
                  items={activeConversationDiffPanel.items || []}
                  review={activeConversationDiffPanel.review || null}
                  loading={activeConversationDiffPanel.loading === true}
                  selectedMessageId={activeConversationDiffPanel.selectedMessageId || ''}
                  onSelectItem={(item) => void handleSelectConversationDiffItem(item, {
                    sessionId: activeConversationDiffPanel.sessionId,
                    terminalId: activeConversationDiffPanel.terminalId,
                    locate: true,
                  })}
                  onPreviewRestore={(artifactPath) => handleReapplyConversationDiffItem(artifactPath, activeConversationDiffPanel.sessionId, activeConversationDiffPanel.terminalId)}
                  onApplyRestore={(artifactPath) => handleApplyConversationDiffRestore(artifactPath, activeConversationDiffPanel.sessionId, activeConversationDiffPanel.terminalId)}
                  onClose={() => {
                    if (!activeWorkspaceTerminalKey) {
                      return;
                    }
                    setConversationDiffPanels((prev) => {
                      if (!prev[activeWorkspaceTerminalKey]) {
                        return prev;
                      }
                      const next = { ...prev };
                      delete next[activeWorkspaceTerminalKey];
                      return next;
                    });
                  }}
                />
              ) : null}
            </div>
            </div>
          </div>

          {/* 系统监控探针面板（独立分栏，右侧） */}
          {probePanelNode && probePanelPosition === 'right' && (
            probePanelCollapsed ? (
              <Tiptop text={t('展开监控面板')} placement="bottom">
                <button
                  type="button"
                  className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag"
                  onClick={() => setProbePanelCollapsedPersistent(false)}
                  aria-label={t('展开监控面板')}
                >
                  <ChevronLeft size={14} />
                </button>
              </Tiptop>
            ) : (
              <>
                <Tiptop text={t('收起监控面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v probe-resizer${collapseDragIntent === 'probe' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'probe')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setProbePanelCollapsedPersistent(true);
                    }}
                    aria-label={t('收起监控面板')}
                  />
                </Tiptop>
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
            <>
              {showAIPanel ? (
                <Tiptop text={t('收起 AI 助手面板')} placement="bottom" style={{ display: 'flex' }}>
                  <div
                    className={`split-resizer-v${collapseDragIntent === 'ai' ? ' armed' : ''}`}
                    onMouseDown={(e) => startDrag(e, 'ai')}
                    onClick={() => {
                      if (shouldIgnoreResizerClick()) return;
                      setAIPanelVisibility(false);
                    }}
                    aria-label={t('收起 AI 助手面板')}
                  />
                </Tiptop>
              ) : (
                <Tiptop text={t('打开 AI 助手面板')} placement="bottom">
                  <button
                    type="button"
                    className="panel-collapse-strip panel-collapse-strip-vertical panel-collapse-strip-right no-drag"
                    onClick={() => setAIPanelVisibility(true)}
                    aria-label={t('打开 AI 助手面板')}
                  >
                    <ChevronLeft size={14} />
                  </button>
                </Tiptop>
              )}
              {aiPanelNode}
            </>
          )}
        </div>
      </main>

      {/* ── Modals ────────────────────────────────────────── */}
      {showImportExportDialog && (
        <ImportExportDialog
          onClose={() => setShowImportExportDialog(false)}
          onExport={handleExport}
          onImport={handleImport}
          onDownloadTemplate={handleDownloadTemplate}
          hasRecoveryPassword={hasRecoveryPassword}
          busy={ieBusy}
        />
      )}

      {showExportSelectedDialog && (
        <ExportSelectedDialog
          onClose={() => {
            setShowExportSelectedDialog(false);
            setExportSelectedIds([]);
          }}
          onExport={handleExportSelected}
          hasRecoveryPassword={hasRecoveryPassword}
          busy={ieBusy}
          selectedCount={exportSelectedIds.length}
        />
      )}

      {showSettings && (
        <SettingsModal
          initialTab={settingsInitialTab}
          onClose={() => { setShowSettings(false); loadServers(); }}
          addToast={addToast}
          onRestored={loadServers}
          probePanelPosition={probePanelPosition}
          onProbePanelPositionChange={(val) => {
            setProbePanelPosition(val);
            localStorage.setItem('probePanelPosition', val);
          }}
          forceDarkTheme={activeAIDevilMode}
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
      <Toast toasts={toasts} onClose={removeToast} closeLabel={t('关闭')} />
      <GlobalDialog />


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
                {syncFailed.category === 'trust'
                  ? t('服务器身份信息已变化，请前往“设置 → 同步与云”核对后恢复同步。')
                  : t('数据未能上传到云端，本地数据不受影响。')}
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
                    if (syncFailed.category === 'trust') {
                      setSyncFailed(null);
                      setSettingsInitialTab('sync');
                      setShowSettings(true);
                      return;
                    }
                    const failedSync = syncFailed;
                    setSyncFailed(null);
                    const err = await AppGo.RetrySync();
                    if (err) {
                      setSyncFailed({ ...failedSync, error: err });
                    } else {
                      addToast(t('同步成功'), 'success', 3000);
                    }
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {syncFailed.category === 'trust' ? t('前往同步与云') : t('重试')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <GlobalContextMenu />

      {/* ── 终端子标签右键菜单 ── */}
      {terminalTabContextMenu && (() => {
        const session = sessions.find((item) => item.id === terminalTabContextMenu.sessionId);
        const moveTargets = [
          { target: 'top-left', label: t('移至左上面板') },
          { target: 'top-right', label: t('移至右上面板') },
          { target: 'bottom-left', label: t('移至左下面板') },
          { target: 'bottom-right', label: t('移至右下面板') },
        ];
        return (
          <div className="tab-context-menu" style={{ left: terminalTabContextMenu.x, top: terminalTabContextMenu.y }}>
            {terminalTabContextMenu.type === 'terminal' && moveTargets.map((item) => {
              const occupied = !!session && isTerminalDockTargetOccupied(session, terminalTabContextMenu.terminalId, item.target);
              const enabled = !!session && canMoveTerminalToDockTarget(session, terminalTabContextMenu.terminalId, item.target);
              return (
                <div
                  key={item.target}
                  className={`tab-context-menu-item${occupied ? ' occupied' : ''}`}
                  onClick={() => {
                    if (!session || !enabled) return;
                    moveTerminalToDockTarget(session, terminalTabContextMenu.terminalId, item.target);
                  }}
                  style={enabled ? undefined : { opacity: 0.42, pointerEvents: 'none' }}
                >
                  <span className="tab-context-menu-state">{occupied ? '☒' : '☑'}</span> {item.label}
                </div>
              );
            })}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <div
              className="tab-context-menu-item"
              onClick={(e) => {
                const { sessionId, terminalId, type, terminalIds } = terminalTabContextMenu;
                setTerminalTabContextMenu(null);
                if (type === 'group') {
                  closeTerminalGroup(sessionId, terminalId, terminalIds, e);
                  return;
                }
                closeTerminal(sessionId, terminalId, e);
              }}
            >
              <X size={14} /> {terminalTabContextMenu.type === 'group' ? t('关闭分屏组') : t('关闭终端')}
            </div>
          </div>
        );
      })()}

      {/* ── 标签右键菜单 ── */}
      {tabContextMenu && (() => {
        const showCopySessionPassword = canCopySessionPassword(tabContextMenu.sessionId);
        return (
          <div className="tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }}>
              {showCopySessionPassword && (
                <>
                  <div
                    className="tab-context-menu-item"
                    onClick={() => {
                      const sessionId = tabContextMenu.sessionId;
                      setTabContextMenu(null);
                      void handleCopySessionPassword(sessionId);
                    }}
                  >
                    <Copy size={14} /> {t('复制服务器密码')}
                  </div>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                </>
              )}
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
        );
      })()}
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
                  <Tiptop text={t('关闭')} placement="bottom">
                    <span
                      onClick={(e) => { e.stopPropagation(); closeSession(s.id, e); }}
                      aria-label={t('关闭')}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.5, flexShrink: 0 }}
                    >
                      <X size={13} />
                    </span>
                  </Tiptop>
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
