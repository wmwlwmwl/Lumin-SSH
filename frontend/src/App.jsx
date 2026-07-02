import { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'react';
import { EventsOn, WindowMinimise, WindowToggleMaximise, WindowHide, WindowShow, WindowSetSize, WindowGetSize } from '../wailsjs/runtime/runtime.js';
import * as AppGo from '../wailsjs/go/main/App.js';
import AddServerModal from './components/AddServerModal.jsx';
import Terminal from './components/Terminal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProbePanel from './components/ProbePanel.jsx';
import FileManager from './components/FileManager.jsx';
import AIPanel from './components/AIPanel.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import CredentialsModal from './components/CredentialsModal.jsx';
import Toast from './components/Toast.jsx';
import CommandHistory from './components/CommandHistory.jsx';
import ProcessPage from './components/ProcessPage.jsx';
import GlobalDialog from './components/GlobalDialog.jsx';
import GlobalContextMenu from './components/GlobalContextMenu.jsx';
import { clampPanelWidth } from './components/probeFormatting.js';
import { useTranslation } from './i18n.js';
import { hexToRgb } from './utils/theme.js';
import { useUpdateChecker } from './hooks/useUpdateChecker.js';
import ConnectingCard from './components/ConnectingCard.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import Dashboard from './components/Dashboard.jsx';
import { Settings, House, Minus, Square, X, Plus, Monitor, RefreshCw, Terminal as TerminalIcon, Folder, ScrollText, ClipboardList } from 'lucide-react';
import { Z } from './constants/zIndex';

import logoImg from './assets/logo.png';


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
  const [addServerModal, setAddServerModal] = useState({ open: false, server: null });
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
  const [connectingServer, setConnectingServer] = useState(null); // { server, sessionId, startTime }
  const connectingServerRef = useRef(connectingServer);
  useEffect(() => { connectingServerRef.current = connectingServer; }, [connectingServer]);
  const [toasts, setToasts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState({}); // { [sessionId]: boolean }
  const [serverListViewMode, setServerListViewMode] = useState(localStorage.getItem('serverListViewMode') || 'grid'); // 'grid' | 'table'
  const [hideSensitive, setHideSensitive] = useState(localStorage.getItem('hideSensitive') === 'true');
  const [fileManagerPosition, setFileManagerPosition] = useState(localStorage.getItem('fileManagerPosition') || 'tab'); // 'tab' | 'right' | 'bottom'
  
  // ponytail: 9 处 setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s)) 提取为帮助函数
  const updateSessionStatus = useCallback((id, status) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  }, []);

  // ponytail: 3 处 s.terminals?.length > 0 ? s.terminals : [{ id: s.id }] 提取为帮助函数
  const getEffectiveTerminals = (s) => s.terminals?.length > 0 ? s.terminals : [{ id: s.id }];
  
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
    return clampPanelWidth(localStorage.getItem('probePanelWidth') || '320');
  });
  const [probePanelPosition, setProbePanelPosition] = useState(() => localStorage.getItem('probePanelPosition') || 'left');
  const [aiPanelWidth, setAiPanelWidth] = useState(() => {
    return clampPanelWidth(localStorage.getItem('aiPanelWidth') || '320');
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
    const next = clampPanelWidth(w);
    setProbePanelWidth(next);
    probePanelWidthRef.current = next;
  }, []);
  const updateAiPanelWidth = useCallback((w) => {
    const next = clampPanelWidth(w);
    setAiPanelWidth(next);
    aiPanelWidthRef.current = next;
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

  // ── 智能窗口状态管理：记住窗口大小 ──────────────────────
  // 启动时恢复上次窗口大小
  useEffect(() => {
    if (localStorage.getItem('rememberWindowSize') === 'false') return;
    try {
      const saved = JSON.parse(localStorage.getItem('windowSize') || 'null');
      if (saved?.w > 100 && saved?.h > 100) {
        requestAnimationFrame(() => WindowSetSize(saved.w, saved.h));
      }
    } catch {}
  }, []);

  // 定时轮询保存窗口大小（Wails 无边框窗口 resize 事件不可靠）
  useEffect(() => {
    if (localStorage.getItem('rememberWindowSize') === 'false') return;
    let lastW = 0, lastH = 0;
    const interval = setInterval(async () => {
      try {
        const size = await WindowGetSize(); // { w, h }
        if (size?.w > 100 && size?.h > 100 && (size.w !== lastW || size.h !== lastH)) {
          lastW = size.w;
          lastH = size.h;
          localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h }));
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

    const resizer = e.target;
    resizer.classList.add('dragging');

    document.body.style.cursor = direction === 'bottom' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent) => {
      if (direction === 'left') {
        const deltaX = moveEvent.clientX - startX;
        const newWidth = Math.max(180, Math.min(800, startWidth + deltaX));
        updateLeftSplitWidth(newWidth);
      } else if (direction === 'probe') {
        const deltaX = probePanelPosition === 'left'
          ? moveEvent.clientX - startX
          : startX - moveEvent.clientX;
        updateProbePanelWidth(startProbeWidth + deltaX);
      } else if (direction === 'ai') {
        const deltaX = probePanelPosition === 'left'
          ? startX - moveEvent.clientX
          : moveEvent.clientX - startX;
        updateAiPanelWidth(startAiWidth + deltaX);
      } else {
        const deltaY = startY - moveEvent.clientY; // 往上拖高度变大
        const newHeight = Math.max(100, Math.min(600, startHeight + deltaY));
        updateBottomSplitHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      try {
        resizer.classList.remove('dragging');

        if (direction === 'left') {
          localStorage.setItem('leftSplitWidth', leftSplitWidthRef.current.toString());
        } else if (direction === 'probe') {
          localStorage.setItem('probePanelWidth', probePanelWidthRef.current.toString());
        } else if (direction === 'ai') {
          localStorage.setItem('aiPanelWidth', aiPanelWidthRef.current.toString());
        } else {
          localStorage.setItem('bottomSplitHeight', bottomSplitHeightRef.current.toString());
        }

        // 通知所有终端自适应重绘
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
  }, [probePanelPosition]);
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

  // 闪电直连的表单状态
  const quickFormInit = { name: '', host: '', port: '', user: 'root', auth: 'password', pass: '', key: '', passphrase: '', credId: '', showPass: false, showPassphrase: false };
  const [quickForm, dispatchQuick] = useReducer((s, a) => {
    if (a.type === 'reset') return quickFormInit;
    return { ...s, [a.type]: a.value };
  }, quickFormInit);

  // ── 初始化全局主题 ──────────────────────────────────────
  useEffect(() => {
    const savedTheme = localStorage.getItem('themeMode') || 'dark';
    const applyTheme = () => {
      const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const applyLight = savedTheme === 'light' || (savedTheme === 'system' && isSystemLight);
      if (applyLight) document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
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

  // ── 浏览选择快捷连接的私钥 ──────────────────────────────
  const handleQuickPrivateKeyFile = async () => {
    try {
      const content = await AppGo.ReadPrivateKeyFile();
      if (content) {
        dispatchQuick({ type: 'key', value: content });
      }
    } catch (e) {
      if (e) window.luminDialog?.alert(`${t('读取私钥文件失败')}: ${e}`, t('错误'));
    }
  };

  // ── 刷新延迟 ────────────────────────────────────────────
  const handleRefreshPing = async () => {
    if (isRefreshingPing) return; // 防止重复点击导致并发竞态
    setIsRefreshingPing(true);
    await pingAll();
    setTimeout(() => { if (mountedRef.current) setIsRefreshingPing(false); }, 800);
  };

  // ── 闪电直连逻辑 ────────────────────────────────────────
  const handleQuickConnectDirect = async (e) => {
    if (e) e.preventDefault();
    if (!quickForm.host.trim()) return window.luminDialog?.alert(t('请填写主机地址'));
    if (quickForm.auth === 'credential' && !quickForm.credId) return window.luminDialog?.alert(t('请选择凭据'));

    const tempId = `temp_${Date.now()}`;
    const tempServer = {
      id: '',
      name: quickForm.name.trim() || quickForm.host.trim(),
      host: quickForm.host.trim(),
      port: Math.max(1, Math.min(65535, parseInt(quickForm.port, 10) || 22)),
      username: quickForm.auth === 'credential' ? '' : quickForm.user.trim(),
      authMethod: quickForm.auth === 'key' ? 'privateKey' : 'password',
      password: quickForm.auth === 'password' ? quickForm.pass : '',
      privateKey: quickForm.auth === 'key' ? quickForm.key : '',
      passphrase: quickForm.auth === 'key' ? quickForm.passphrase : '',
      credentialId: quickForm.auth === 'credential' ? quickForm.credId : '',
    };

    const sessionId = `session_${Date.now()}`;
    const newSession = {
      id: sessionId,
      serverId: tempId,
      serverName: tempServer.name,
      host: tempServer.host,
      status: 'connecting',
      terminals: [{ id: sessionId, label: `${t('终端')}1` }],
    };

    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(sessionId);
    setActiveTerminalId(sessionId);
    setContentTab('terminal');
    // 显示连接进度卡片
    setConnectingServer({ server: tempServer, sessionId, startTime: Date.now() });

    try {
      const savedServer = await AppGo.SaveConnection(tempServer, true);
      await loadServers();

      await AppGo.ConnectSSH(sessionId, savedServer.id);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, serverId: savedServer.id, status: 'connected' } : s))
      );
      setConnectingServer(null);

      // 连接成功后自动查询 OS信息并更新 sessions
      await postConnectSetup(sessionId, savedServer.id);

      // 清空表单
      dispatchQuick({ type: 'reset' });
    } catch (err) {
      handleConnectError(sessionId, err);
    }
  };

  // ── Toast helpers ──────────────────────────────────────────
  const toastIdRef = useRef(0);
  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => { if (mountedRef.current) setToasts((prev) => prev.filter((t) => t.id !== id)); }, duration);
  }, []);

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
      setConnectingServer(null);
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
  const handleCancelConnection = useCallback(() => {
    const cs = connectingServerRef.current;
    if (!cs) return;
    cancelledConnectionsRef.current.add(cs.sessionId);
    // 30 秒后自动清理，避免 Set 无限增长（错误若未到达则永久残留）
    setTimeout(() => { cancelledConnectionsRef.current.delete(cs.sessionId); }, 30000);
    AppGo.DisconnectSSH(cs.sessionId).catch(() => {});
    setSessions(prev => prev.filter(s => s.id !== cs.sessionId));
    setActiveSessionId(null);
    setActiveTerminalId(null);
    setConnectingServer(null);
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
      setConnectingServer({ server: serverObj, sessionId: session.id, startTime: Date.now() });
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
      setConnectingServer(null);
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
        setConnectingServer(null);
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
          setConnectingServer(null);
          addToast(
            chosen === 2 ? t('主机密钥已保存，连接成功') : t('本次已接受，连接成功'),
            'success'
          );

          await postConnectSetup(sessionId);
        } else {
          updateSessionStatus(sessionId, 'error');
          setConnectingServer(null);
        }
      } catch (err) {
        updateSessionStatus(sessionId, 'error');
        setConnectingServer(null);
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
        setConnectingServer(null);
        addToast(t('用户取消连接'), 'warning', 3000);
        return;
      }

      const newPassword = typeof password === 'object' ? password.value : password;
      const persist = typeof password === 'object' ? password.checked : false;

      if (!newPassword) {
        updateSessionStatus(sessionId, 'error');
        setConnectingServer(null);
        return;
      }

      try {
        await AppGo.ReconnectWithPassword(sessionId, connId, newPassword, persist);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
        );
        setConnectingServer(null);
        addToast(persist ? t('密码已保存，连接成功') : t('连接成功'), 'success', 3000);

        await postConnectSetup(sessionId, connId, { password: newPassword });

        // 加入最近连接
      } catch (retryErr) {
        updateSessionStatus(sessionId, 'error');
        setConnectingServer(null);
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
    const choice = await window.luminDialog?.choice?.(
      t('请选择操作'),
      t('关闭窗口'),
      [
        { label: t('退出'), value: 'quit', primary: true },
        { label: t('系统托盘'), value: 'tray', secondary: true },
        { label: t('取消'), value: 'cancel', secondary: true },
      ]
    );
    if (choice === 'quit') {
      AppGo.DoQuit();
    } else if (choice === 'tray') {
      AppGo.AckClose();
      WindowHide();
    } else if (choice === 'cancel') {
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
      if (data.action === 'merge') {
        const msg = data.localChanged
          ? t('同步完成') + `：${t('云端')} ${data.remoteCount} → ${t('合并')} ${data.mergedCount}` + (data.uploaded ? `，${t('已上传')}` : '')
          : t('同步完成') + `：${t('数据一致，无需变更')}`;
        addToast(msg, 'info', 4000);
      } else if (data.action === 'upload') {
        addToast(t('本地数据已同步到云端'), 'info', 4000);
      }
    });
    return () => { if (unbind) unbind(); };
  }, [addToast, t]);

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
    setConnectingServer({ server, sessionId, startTime: Date.now() });

    try {
      await AppGo.ConnectSSH(sessionId, server.id);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
      );
      setConnectingServer(null); // 连接成功，关闭进度卡片

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
    if (connectingServerRef.current?.sessionId === sessionId) {
      setConnectingServer(null);
    }
  }, []);

  const closeSession = useCallback(async (sessionId, e) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find(s => s.id === sessionId);
    const name = session?.serverName || session?.name || session?.host || sessionId;
    if (!(await window.luminDialog?.confirm(`${t('确定关闭连接')}「${name}」？`))) return;
    forceCloseSession(sessionId);
  }, [forceCloseSession]);

  // ── 在当前服务器上新建终端标签 ──────────────────────────────
  const openNewTerminal = useCallback(async (sessionId) => {
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session || session.status !== 'connected') return;
    
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

  const probePanelNode = activeSession && activeSession.status === 'connected' ? (
    <ProbePanel
      key={activeSession.id}
      sessionId={activeSession.id}
      host={activeSession.host}
      addToast={addToast}
      enabled={!!monitoringEnabled[activeSession.id]}
      onEnable={() => setMonitoringEnabled(prev => ({ ...prev, [activeSession.id]: true }))}
      onShowAllProcesses={() => setContentTab('process')}
    />
  ) : null;
  const aiPanelNode = showAIPanel && activeSession && activeSession.status === 'connected' ? (
    <AIPanel width={aiPanelWidth} side={probePanelPosition} />
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

    // Open Add Server Modal pre-filled
    setAddServerModal({
      open: true,
      server: {
        name: host,
        host,
        port,
        username: user,
        authMode: 'password'
      }
    });
    setSearchQuery('');

  }, [searchQuery, servers, connectServer]);

  // ── Server CRUD ────────────────────────────────────────────
  const handleSaveServer = useCallback(async (data) => {
    try {
      await AppGo.SaveConnection(data, false);
      await loadServers();
      addToast(data.id ? t('服务器配置已更新') : t('服务器添加成功'), 'success');
    } catch (err) {
      addToast(err, 'error');
    }
    setAddServerModal({ open: false, server: null });
  }, [loadServers, addToast]);

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
              >
                <House size={14} />
              </button>
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
          )}
          {sessions.length === 0 && <div style={{ flex: 1 }}></div>}

          <div className="window-controls">
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
            quickForm={quickForm}
            dispatchQuick={dispatchQuick}
            onQuickConnect={handleQuickConnectDirect}
            onQuickPrivateKeyFile={handleQuickPrivateKeyFile}
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
            onEdit={(s) => setAddServerModal({ open: true, server: s })}
            onDelete={handleDeleteServer}
            onMoveGroup={handleMoveGroup}
            addToast={addToast}
            onOpenCredentials={() => setShowCredentials(true)}
          />
        </div>

        <div style={{ display: activeSessionId !== null ? 'flex' : 'none', flexDirection: 'row', height: '100%', flex: 1, overflow: 'hidden' }}>
          {aiPanelNode && probePanelPosition === 'right' && aiPanelNode}
          {aiPanelNode && probePanelPosition === 'right' && (
            <div
              className="split-resizer-v"
              onMouseDown={(e) => startDrag(e, 'ai')}
              title={t('调整大小')}
            />
          )}
          {/* 系统监控探针面板（独立分栏，左侧） */}
          {probePanelNode && probePanelPosition === 'left' && (
            <>
              <div
                className="probe-panel-wrapper probe-panel-wrapper-left"
                style={{
                  width: probePanelWidth,
                  minWidth: probePanelWidth,
                  borderLeft: 'none',
                  borderRight: '1px solid var(--border)',
                }}
              >
                {probePanelNode}
              </div>
              <div
                className="split-resizer-v probe-resizer"
                onMouseDown={(e) => startDrag(e, 'probe')}
                title={t('调整监控边栏宽度')}
              />
            </>
          )}
          {/* 左侧主区域：标签、终端子标签、会话内容 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', overflow: 'hidden' }}>
            {/* Content Type Tabs */}
            {activeSession && (
              <div className="content-tab-bar">
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    className={`content-tab ${contentTab === 'terminal' ? 'active' : ''}`}
                    onClick={() => setContentTab('terminal')}
                  >
                    <TerminalIcon size={14} /> {t('终端')}
                  </button>
                  {fileManagerPosition === 'tab' && (
                    <button
                      className={`content-tab ${contentTab === 'files' ? 'active' : ''}`}
                      onClick={() => setContentTab('files')}
                      disabled={activeSession.status !== 'connected'}
                    >
                      <Folder size={14} /> {t('文件管理')}
                    </button>
                  )}
                  <button
                    className={`content-tab ${contentTab === 'history' ? 'active' : ''}`}
                    onClick={() => setContentTab('history')}
                    disabled={activeSession.status !== 'connected'}
                  >
                    <ScrollText size={14} /> {t('历史指令')}
                  </button>
                  <button
                    className={`content-tab ${contentTab === 'process' ? 'active' : ''}`}
                    onClick={() => setContentTab('process')}
                    disabled={activeSession.status !== 'connected'}
                  >
                    <ClipboardList size={14} /> {t('进程管理')}
                  </button>
                </div>
                
                {activeSession.status === 'connected' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, alignSelf: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{t('文件管理器布局')}:</span>
                      <select
                        className="select-compact"
                        style={{ padding: '2px 8px', fontSize: 12 }}
                        value={fileManagerPosition}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFileManagerPosition(val);
                          localStorage.setItem('fileManagerPosition', val);
                          if (val !== 'tab' && contentTab === 'files') {
                            setContentTab('terminal');
                          }
                        }}
                      >
                        <option value="tab">{t('标签页')}</option>
                        <option value="left">{t('左侧分屏')}</option>
                        <option value="bottom">{t('底部分屏')}</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{t('监控面板位置')}:</span>
                      <select
                        className="select-compact"
                        style={{ padding: '2px 8px', fontSize: 12 }}
                        value={probePanelPosition}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProbePanelPosition(val);
                          localStorage.setItem('probePanelPosition', val);
                        }}
                      >
                        <option value="left">{t('左侧')}</option>
                        <option value="right">{t('右侧')}</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 终端子标签栏（多终端支持） ──────────────────── */}
            {activeSession && contentTab === 'terminal' && activeSession.status === 'connected' && activeSession.terminals && activeSession.terminals.length >= 1 && (
              <div className="terminal-sub-tab-bar">
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
                {/* ── 新建终端按钮 ── */}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => openNewTerminal(activeSession.id)}
                  title={t('新建终端')}
                  style={{ marginLeft: 2 }}
                ><Plus size={14} /> {t('新建终端')}</button>
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
                    {s.status === 'connected' && fileManagerPosition === 'left' && contentTab !== 'process' && mountedSessions.has(s.id) && (
                      <>
                        <div style={{
                          width: leftSplitWidth + 'px',
                          borderRight: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 180,
                          flexShrink: 0,
                        }}>
                          {getEffectiveTerminals(s).map(t => (
                            <div key={t.id} style={activeSessionId === s.id && activeTerminalId === t.id ? { display: 'contents' } : { display: 'none' }}>
                              <FileManager sessionId={t.id} addToast={addToast} isActive={activeSessionId === s.id && activeTerminalId === t.id} />
                            </div>
                          ))}
                        </div>
                        <div
                          className="split-resizer-v"
                          onMouseDown={(e) => startDrag(e, 'left')}
                          style={{ zIndex: Z.PANEL_BUTTON, marginLeft: '-2px', marginRight: '-2px' }}
                        />
                      </>
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
                          {getEffectiveTerminals(s).map(t => (
                            <div key={t.id} style={activeSessionId === s.id && activeTerminalId === t.id ? { display: 'contents' } : { display: 'none' }}>
                              <FileManager sessionId={t.id} addToast={addToast} isActive={activeSessionId === s.id && activeTerminalId === t.id} />
                            </div>
                          ))}
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
                        <div style={{ display: contentTab === 'process' ? 'block' : 'none', height: '100%', flex: 1 }}>
                          <ProcessPage
                            sessionId={s.id}
                            addToast={addToast}
                            active={contentTab === 'process' && activeSessionId === s.id}
                          />
                        </div>
                      )}
                    </div>

                    {/* 辅助视口 (分屏模式下的文件管理器，如果是底部则排在后面) */}
                    {s.status === 'connected' && fileManagerPosition === 'bottom' && contentTab !== 'process' && mountedSessions.has(s.id) && (
                      <>
                        <div
                          className="split-resizer-h"
                          onMouseDown={(e) => startDrag(e, 'bottom')}
                          style={{ zIndex: Z.PANEL_BUTTON, marginTop: '-2px', marginBottom: '-2px' }}
                        />
                        <div style={{
                          height: bottomSplitHeight + 'px',
                          borderTop: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          minHeight: 100,
                          flexShrink: 0,
                        }}>
                          {getEffectiveTerminals(s).map(t => (
                            <div key={t.id} style={activeSessionId === s.id && activeTerminalId === t.id ? { display: 'contents' } : { display: 'none' }}>
                              <FileManager sessionId={t.id} addToast={addToast} isActive={activeSessionId === s.id && activeTerminalId === t.id} />
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
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
            </div>
            </div>
          </div>

          {/* 系统监控探针面板（独立分栏，右侧） */}
          {probePanelNode && probePanelPosition === 'right' && (
            <>
              <div
                className="split-resizer-v probe-resizer"
                onMouseDown={(e) => startDrag(e, 'probe')}
                title={t('调整监控边栏宽度')}
              />
              <div
                className="probe-panel-wrapper"
                style={{
                  width: probePanelWidth,
                  minWidth: probePanelWidth,
                }}
              >
                {probePanelNode}
              </div>
            </>
          )}
          {aiPanelNode && probePanelPosition === 'left' && (
            <>
              <div
                className="split-resizer-v"
                onMouseDown={(e) => startDrag(e, 'ai')}
                title={t('调整大小')}
              />
              {aiPanelNode}
            </>
          )}
        </div>
      </main>

      {/* ── Modals ────────────────────────────────────────── */}
      {addServerModal.open && (
        <AddServerModal
          server={addServerModal.server}
          onSave={handleSaveServer}
          onClose={() => setAddServerModal({ open: false, server: null })}
          allGroups={allGroups}
          credentials={credentials}
          onOpenCredentials={() => setShowCredentials(true)}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => { setShowSettings(false); loadServers(); }}
          addToast={addToast}
          onRestored={loadServers}
        />
      )}

      {showCredentials && (
        <CredentialsModal
          onClose={() => { setShowCredentials(false); loadServers(); }}
          onChange={loadServers}
          addToast={addToast}
        />
      )}

      {/* ── Toasts ────────────────────────────────────────── */}
      <Toast toasts={toasts} />
      <GlobalDialog />

      {/* ── 连接进度卡片（仅当连接中的会话是当前激活会话时才显示） ── */}
      {connectingServer && connectingServer.sessionId === activeSessionId && (
        <ConnectingCard
          connectingServer={connectingServer}
          t={t}
          onCancel={handleCancelConnection}
        />
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
          width: 380, background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
          borderRadius: 16, padding: '16px 20px',
          animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
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
          </div>
      )}
    </div>
  );
}
