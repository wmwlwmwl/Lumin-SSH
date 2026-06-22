import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EventsOn, WindowMinimise, WindowToggleMaximise, WindowHide, WindowShow } from '../wailsjs/runtime/runtime.js';
import * as AppGo from '../wailsjs/go/main/App.js';
import ServerList from './components/ServerList.jsx';
import AddServerModal from './components/AddServerModal.jsx';
import Terminal from './components/Terminal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProbePanel from './components/ProbePanel.jsx';
import FileManager from './components/FileManager.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import Toast from './components/Toast.jsx';
import CommandHistory from './components/CommandHistory.jsx';
import GlobalDialog from './components/GlobalDialog.jsx';
import GlobalContextMenu from './components/GlobalContextMenu.jsx';
import { clampPanelWidth } from './components/probeFormatting.js';
import { useTranslation } from './i18n.js';
import { useUpdateChecker } from './hooks/useUpdateChecker.js';
import ConnectingCard from './components/ConnectingCard.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import { Settings, House, Minus, Square, X, Eye, EyeOff, LayoutGrid, List, Search, Plus, Zap, BarChart3, Monitor, RefreshCw, FolderOpen, Terminal as TerminalIcon, Folder, ScrollText } from 'lucide-react';
import { Z } from './constants/zIndex';

import logoImg from './assets/logo.png';

export default function App() {
  const { t } = useTranslation();
  const [servers, setServers] = useState([]);
  const serversRef = useRef([]);
  useEffect(() => { serversRef.current = servers; }, [servers]);
  const [pings, setPings] = useState({});
  const [sessions, setSessions] = useState([]);      // { id, serverId, serverName, host, status, osInfo }
  const sessionsRef = useRef([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const cancelledConnectionsRef = useRef(new Set());
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const lastTerminalRef = useRef({}); // 记录每个 session 最后选中的终端
  const [mountedSessions, setMountedSessions] = useState(new Set());
  const [contentTab, setContentTab] = useState('terminal'); // 'terminal' | 'files'
  const [showAddServer, setShowAddServer] = useState(false);
  const [editServer, setEditServer] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
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
  
  // ── 新增自动检测更新状态 ──────────────────────────────
  const [startupUpdateInfo, setStartupUpdateInfo] = useState(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  
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

  const leftSplitWidthRef = useRef(leftSplitWidth);
  const bottomSplitHeightRef = useRef(bottomSplitHeight);
  const probePanelWidthRef = useRef(probePanelWidth);

  const updateLeftSplitWidth = (w) => {
    setLeftSplitWidth(w);
    leftSplitWidthRef.current = w;
  };
  const updateBottomSplitHeight = (h) => {
    setBottomSplitHeight(h);
    bottomSplitHeightRef.current = h;
  };
  const updateProbePanelWidth = (w) => {
    const next = clampPanelWidth(w);
    setProbePanelWidth(next);
    probePanelWidthRef.current = next;
  };

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

  const startDrag = useCallback((e, direction) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = leftSplitWidthRef.current;
    const startHeight = bottomSplitHeightRef.current;
    const startProbeWidth = probePanelWidthRef.current;

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
        const deltaX = startX - moveEvent.clientX;
        updateProbePanelWidth(startProbeWidth + deltaX);
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
  }, []);
  // ────────────────────────────────────────────────────────

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
  const [quickName, setQuickName] = useState('');
  const [quickHost, setQuickHost] = useState('');
  const [quickPort, setQuickPort] = useState('22');
  const [quickUser, setQuickUser] = useState('root');
  const [quickAuth, setQuickAuth] = useState('password');
  const [quickPass, setQuickPass] = useState('');
  const [quickKey, setQuickKey] = useState('');
  const [quickPassphrase, setQuickPassphrase] = useState('');
  const [showQuickPass, setShowQuickPass] = useState(false);
  const [showQuickPassphrase, setShowQuickPassphrase] = useState(false);

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
      document.documentElement.style.setProperty('--success', themeAccent);
      document.documentElement.style.setProperty('--green', themeAccent); // 兼容旧组件
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
        setQuickKey(content);
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
    if (!quickHost.trim()) return window.luminDialog?.alert(t('请填写主机地址'));

    const tempId = `temp_${Date.now()}`;
    const tempServer = {
      id: '',
      name: quickName.trim() || quickHost.trim(),
      host: quickHost.trim(),
      port: Math.max(1, Math.min(65535, parseInt(quickPort, 10) || 22)),
      username: quickUser.trim(),
      authMethod: quickAuth === 'key' ? 'privateKey' : 'password',
      password: quickPass,
      privateKey: quickKey,
      passphrase: quickPassphrase,
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
      const savedServer = await AppGo.SaveConnection(tempServer);
      await loadServers();
      triggerAutoBackup();

      await AppGo.ConnectSSH(sessionId, savedServer.id);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, serverId: savedServer.id, status: 'connected' } : s))
      );
      setConnectingServer(null);

      // 连接成功后自动查询 OS信息并更新 sessions
      await postConnectSetup(sessionId, savedServer.id);

      // 清空表单
      setQuickName('');
      setQuickHost('');
      setQuickPass('');
      setQuickKey('');
      setQuickPassphrase('');
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
        if (serverId) {
          const detectedOs = staticInfo.os || '';
          if (detectedOs) {
            setServers(prevServers => {
              const currentServer = prevServers.find(s => s.id === serverId);
              if (currentServer && currentServer.os !== detectedOs) {
                const updatedServer = { ...currentServer, os: detectedOs, ...extraServerFields };
                AppGo.SaveConnection(updatedServer).catch(console.error);
                return prevServers.map(s => s.id === updatedServer.id ? updatedServer : s);
              }
              return prevServers;
            });
          }
        }
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
    pingAll();
    // 修改为动态刷新延迟，降低后台消耗或提高实时性
    pingTimerRef.current = setInterval(pingAll, pingInterval * 1000);
    return () => clearInterval(pingTimerRef.current);
  }, [pingAll, pingInterval]);

  // ── 自动云端备份 ──────────────────────────────────────────
  const triggerAutoBackup = useCallback(async () => {
    try {
      const cfg = await AppGo.GetWebdavConfig();
      if (cfg && cfg.username) {
        await AppGo.BackupToWebdav();
      }
    } catch (e) {
      // 忽略失败，防止打扰用户
    }
  }, []);

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

  // ── 重连会话核心逻辑 ────────────────────────────────────────
  const reconnectSession = useCallback(async (session, requestingTerminalId) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, status: 'connecting' } : s))
    );

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
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId ? { ...s, status: 'error' } : s
            )
          );
          setConnectingServer(null);
        }
      } catch (err) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, status: 'error' } : s
          )
        );
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
        t('记住密码')
      );

      if (password === null) {
        // 用户取消
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'error' } : s))
        );
        setConnectingServer(null);
        addToast(t('用户取消连接'), 'warning', 3000);
        return;
      }

      const newPassword = typeof password === 'object' ? password.value : password;
      const persist = typeof password === 'object' ? password.checked : false;

      if (!newPassword) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'error' } : s))
        );
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
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'error' } : s))
        );
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
      WindowHide();
    }
  }, [t]);

  // ── 监听关闭窗口请求，弹出选择对话框 ──────────────────────────
  useEffect(() => {
    const unbind = EventsOn('close-request', handleCloseWindow);
    return () => { if (unbind) unbind(); };
  }, [handleCloseWindow]);

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
    const existing = sessionsRef.current.find((s) => s.serverId === server.id && s.status !== 'closed');
    if (existing) {
      setActiveSessionId(existing.id);
      const lastTid = lastTerminalRef.current[existing.id];
      const validTerminal = existing.terminals?.find(t => t.id === lastTid);
      setActiveTerminalId(validTerminal ? validTerminal.id : (existing.terminals?.[0]?.id || existing.id));
      setContentTab('terminal');
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
  }, [handleConnectError]);

  // ── Close session ──────────────────────────────────────────
  const closeSession = useCallback(async (sessionId, e) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find(s => s.id === sessionId);
    const name = session?.serverName || session?.name || session?.host || sessionId;
    if (!(await window.luminDialog?.confirm(`${t('确定关闭连接')}「${name}」？`))) return;
    // 标记已取消，防止 connectServer/重连的 catch 仍弹错误提示
    const termIds = session?.terminals ? session.terminals.map(t => t.id) : [sessionId];
    termIds.forEach(id => {
      cancelledConnectionsRef.current.add(id);
      // 30 秒后自动清理，避免 Set 无限增长
      setTimeout(() => { cancelledConnectionsRef.current.delete(id); }, 30000);
    });
    // 后端断开（不等待，即使服务器无响应也不阻塞 UI）
    for (const id of termIds) {
      AppGo.DisconnectSSH(id).catch(() => {});
    }
    // 立即从 UI 移除会话
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      switchToNextSession(sessionId);
    }
    // 如果正在连接中，也取消连接卡片
    if (connectingServerRef.current?.sessionId === sessionId) {
      setConnectingServer(null);
    }
  }, [activeSessionId]);

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

  const activeSession = sessions.find((s) => s.id === activeSessionId);

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
    setEditServer({
      name: host,
      host,
      port,
      username: user,
      authMode: 'password'
    });
    setShowAddServer(true);
    setSearchQuery('');

  }, [searchQuery, servers, connectServer]);

  // ── Server CRUD ────────────────────────────────────────────
  const handleSaveServer = useCallback(async (data) => {
    try {
      await AppGo.SaveConnection(data);
      await loadServers();
      addToast(data.id ? t('服务器配置已更新') : t('服务器添加成功'), 'success');
      triggerAutoBackup();
    } catch (err) {
      addToast(err, 'error');
    }
    setShowAddServer(false);
    setEditServer(null);
  }, [loadServers, addToast, triggerAutoBackup]);

  const handleDeleteServer = useCallback(async (id) => {
    try {
      await AppGo.DeleteConnection(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
      addToast(t('服务器已删除'), 'success');
      triggerAutoBackup();
    } catch {
      addToast(t('删除失败'), 'error');
    }
  }, [addToast, triggerAutoBackup]);

  const filteredServers = useMemo(() => {
    if (!searchQuery) return servers;
    const q = searchQuery.toLowerCase();
    return servers.filter((s) =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.host || '').toLowerCase().includes(q) ||
      (s.username || '').toLowerCase().includes(q)
    );
  }, [servers, searchQuery]);

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
                  onClick={() => { setTabContextMenu(null); setActiveSessionId(s.id); const sess = sessions.find(x => x.id === s.id); const lastTid = lastTerminalRef.current[s.id]; const validTerminal = sess?.terminals?.find(t => t.id === lastTid); setActiveTerminalId(validTerminal ? validTerminal.id : (sess?.terminals?.[0]?.id || s.id)); }}
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
                  <span className={`status-dot ${s.status === 'connecting' ? 'connecting' : s.status === 'connected' ? 'online' : (s.status === 'error' || s.status === 'closed') ? 'offline' : 'offline'}`} />
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
                      style={{ cursor: 'pointer', opacity: 0.6, display: 'flex', alignItems: 'center', transition: 'opacity 0.2s' }}
                      onMouseEnter={(e) => e.target.style.opacity = 1}
                      onMouseLeave={(e) => e.target.style.opacity = 0.6}
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
          <div className="dashboard-container">
            {/* 左半栏：快捷控制台 */}
            <div className="dashboard-left">
              {/* ⚡ 闪电直连卡片 */}
              <div className="glass-card quick-connect-box">
                <div className="card-header-icon-title">
                  <span className="card-header-icon"><Zap size={18} /></span>
                  <span className="card-header-title">{t('闪电直连')}</span>
                </div>
                <form onSubmit={handleQuickConnectDirect} className="quick-connect-form">
                  <div className="form-group-compact">
                    <label>{t('服务器别名（选填）')}</label>
                    <input className="input-compact" placeholder={t('例如：我的测试服')} value={quickName} onChange={e => setQuickName(e.target.value)} />
                  </div>
                  <div className="form-group-compact">
                    <label>{t('主机地址 *')}</label>
                    <div className="form-row-compact">
                      <input className="input-compact" style={{ flex: 3 }} placeholder="192.168.1.1" value={quickHost} onChange={e => setQuickHost(e.target.value)} required />
                      <input className="input-compact" style={{ flex: 1.2 }} placeholder="22" value={quickPort} onChange={e => setQuickPort(e.target.value)} />
                    </div>
                  </div>
                  <div className="form-group-compact">
                    <label>{t('用户名')}</label>
                    <input className="input-compact" placeholder="root" value={quickUser} onChange={e => setQuickUser(e.target.value)} />
                  </div>
                  <div className="form-group-compact">
                    <label>{t('认证方式')}</label>
                    <select className="select-compact" value={quickAuth} onChange={e => setQuickAuth(e.target.value)}>
                      <option value="password">{t('密码认证')}</option>
                      <option value="key">{t('私钥认证')}</option>
                    </select>
                  </div>
                  {quickAuth === 'password' ? (
                    <div className="form-group-compact" style={{ position: 'relative' }}>
                      <label>{t('密码')}</label>
                      <input className="input-compact" type={showQuickPass ? "text" : "password"} placeholder={t('请输入密码')} value={quickPass} onChange={e => setQuickPass(e.target.value)} style={{ paddingRight: 32 }} />
                      <button type="button" aria-label={showQuickPass ? t('隐藏密码') : t('显示密码')} onClick={() => setShowQuickPass(!showQuickPass)} style={{ position: 'absolute', right: 6, bottom: 4, background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                        {showQuickPass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="form-group-compact">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ marginBottom: 0 }}>{t('私钥内容')}</label>
                          <button type="button" className="btn-text-action" onClick={handleQuickPrivateKeyFile}><FolderOpen size={14} /> {t('浏览')}</button>
                        </div>
                        <textarea className="textarea-compact" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={quickKey} onChange={e => setQuickKey(e.target.value)} />
                      </div>
                      <div className="form-group-compact" style={{ position: 'relative' }}>
                        <label>{t('私钥密码短语 (可选)')}</label>
                        <input className="input-compact" type={showQuickPassphrase ? "text" : "password"} placeholder={t('私钥密码短语')} value={quickPassphrase} onChange={e => setQuickPassphrase(e.target.value)} style={{ paddingRight: 32 }} />
                        <button type="button" aria-label={showQuickPassphrase ? t('隐藏密码短语') : t('显示密码短语')} onClick={() => setShowQuickPassphrase(!showQuickPassphrase)} style={{ position: 'absolute', right: 6, bottom: 4, background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                          {showQuickPassphrase ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </>
                  )}
                  <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 12 }}>{t('立即闪连')}</button>
                 </form>
               </div>

              {/* 📊 状态概览 */}
              <div className="glass-card status-overview-box">
                <div className="card-header-icon-title">
                  <span className="card-header-icon"><BarChart3 size={18} /></span>
                  <span className="card-header-title">{t('系统状态')}</span>
                  <button className={`btn-icon-spin ${isRefreshingPing ? 'spinning' : ''}`} onClick={handleRefreshPing} title={t('刷新延迟')} aria-label={t('刷新延迟')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, display: "flex", alignItems: "center" }}><RefreshCw size={14} /></button>
                </div>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-val">{servers.length}</div>
                    <div className="stat-lbl">{t('服务器总数')}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-val" style={{ color: 'var(--success)' }}>{pingCounts.online}</div>
                    <div className="stat-lbl">{t('在线节点')}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-val" style={{ color: 'var(--danger)' }}>{pingCounts.offline}</div>
                    <div className="stat-lbl">{t('离线节点')}</div>
                  </div>
                </div>
              </div>

            </div>

            {/* 右半栏：历史会话与主机目录 */}
            <div className="dashboard-right">
              {/* 🖥 全部主机目录 */}
              <div className="hosts-section-container">
                <div className="section-title-container">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                    <span className="section-title-icon"><Monitor size={16} /></span>
                    <span className="section-title">{t('主机')}</span>
                    {/* 搜索框 */}
                    <div style={{ position: 'relative', flex: 1, maxWidth: 280, minWidth: 120 }}>
                      <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input
                        className="input-compact"
                        placeholder={t('搜索服务器...')}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{ width: '100%', paddingLeft: 28, height: 30, fontSize: 12, borderRadius: 8, background: 'var(--surface-overlay)', border: '1px solid var(--border)' }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
                    {/* 视图切换 - 分段控件 */}
                    <div className="segment-control">
                      <button
                        onClick={() => { setServerListViewMode('grid'); localStorage.setItem('serverListViewMode', 'grid'); }}
                        title={t('卡片视图')}
                        className={serverListViewMode === 'grid' ? 'active' : ''}
                      >
                        <LayoutGrid size={14} />
                      </button>
                      <div className="segment-control-divider" />
                      <button
                        onClick={() => { setServerListViewMode('table'); localStorage.setItem('serverListViewMode', 'table'); }}
                        title={t('列表视图')}
                        className={serverListViewMode === 'table' ? 'active' : ''}
                      >
                        <List size={14} />
                      </button>
                    </div>
                    {/* 隐藏敏感信息 */}
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => { const v = !hideSensitive; setHideSensitive(v); localStorage.setItem('hideSensitive', v); }}
                      title={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                      style={hideSensitive ? { background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning)' } : {}}
                    >
                      {hideSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    {/* 添加按钮 */}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => { setEditServer(null); setShowAddServer(true); }}
                    >
                      <Plus size={14} /> {t('添加')}
                    </button>
                  </div>
                </div>

                <div className="hosts-scroll-area">
                  <ServerList
                    servers={filteredServers}
                    pings={pings}
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    viewMode={serverListViewMode}
                    hideSensitive={hideSensitive}
                    onConnect={connectServer}
                    onEdit={(s) => { setEditServer(s); setShowAddServer(true); }}
                    onDelete={handleDeleteServer}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: activeSessionId !== null ? 'flex' : 'none', flexDirection: 'column', height: '100%', flex: 1 }}>
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
                </div>
                
                {activeSession.status === 'connected' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{t('文件管理器布局')}:</span>
                    <select
                      className="select-compact"
                      style={{ padding: '2px 8px', fontSize: 12, height: 24 }}
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
                    {s.status === 'connected' && fileManagerPosition === 'left' && (
                      <>
                        <div style={{
                          width: leftSplitWidth + 'px',
                          borderRight: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 180,
                          flexShrink: 0,
                        }}>
                          {(s.terminals?.length > 0 ? s.terminals : [{ id: s.id }]).map(t => (
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
                        {mountedSessions.has(s.id) && (s.terminals && s.terminals.length > 0 ? s.terminals : [{ id: s.id, label: t('终端') }]).map((t) => (
                          <div key={t.id} style={{
                            position: 'absolute', inset: 0,
                            display: ((contentTab === 'terminal' || s.status !== 'connected') && activeTerminalId === t.id) ? 'flex' : 'none',
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
                        ))}
                      </div>
                      {s.status === 'connected' && fileManagerPosition === 'tab' && (
                        <div style={{ display: contentTab === 'files' ? 'flex' : 'none', height: '100%', flex: 1, flexDirection: 'column' }}>
                          {(s.terminals?.length > 0 ? s.terminals : [{ id: s.id }]).map(t => (
                            <div key={t.id} style={activeSessionId === s.id && activeTerminalId === t.id ? { display: 'contents' } : { display: 'none' }}>
                              <FileManager sessionId={t.id} addToast={addToast} isActive={activeSessionId === s.id && activeTerminalId === t.id} />
                            </div>
                          ))}
                        </div>
                      )}
                      {s.status === 'connected' && (
                        <div style={{ display: contentTab === 'history' ? 'block' : 'none', height: '100%', flex: 1 }}>
                          <CommandHistory
                            sessionId={s.id}
                            historyServerId={s.serverId}
                            addToast={addToast}
                          />
                        </div>
                      )}
                    </div>

                    {/* 辅助视口 (分屏模式下的文件管理器，如果是底部则排在后面) */}
                    {s.status === 'connected' && fileManagerPosition === 'bottom' && (
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
                          {(s.terminals?.length > 0 ? s.terminals : [{ id: s.id }]).map(t => (
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

            {/* 右侧：系统监控探针面板（强制常显）*/}
              {activeSession && activeSession.status === 'connected' && (
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
                    <ProbePanel
                    sessionId={activeSession.id}
                    host={activeSession.host}
                    addToast={addToast}
                    enabled={!!monitoringEnabled[activeSession.id]}
                    onEnable={() => setMonitoringEnabled(prev => ({ ...prev, [activeSession.id]: true }))}
                  />
                  </div>
                </>
              )}
            </div>
          </div>
      </main>

      {/* ── Modals ────────────────────────────────────────── */}
      {showAddServer && (
        <AddServerModal
          server={editServer}
          onSave={handleSaveServer}
          onClose={() => { setShowAddServer(false); setEditServer(null); }}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          addToast={addToast}
          onRestored={loadServers}
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
      <GlobalContextMenu />

      {/* ── 标签右键菜单 ── */}
      {tabContextMenu && (
        <div className="tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }}>
            <div
              className="tab-context-menu-item"
              onClick={() => {
                const sessionId = tabContextMenu.sessionId;
                setTabContextMenu(null);
                const session = sessionsRef.current.find(s => s.id === sessionId);
                const termIds = session?.terminals ? session.terminals.map(t => t.id) : [sessionId];
                termIds.forEach(id => {
                  cancelledConnectionsRef.current.add(id);
                  setTimeout(() => { cancelledConnectionsRef.current.delete(id); }, 30000);
                });
                for (const id of termIds) {
                  AppGo.DisconnectSSH(id).catch(() => {});
                }
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (activeSessionId === sessionId) {
                  switchToNextSession(sessionId);
                }
                if (connectingServerRef.current?.sessionId === sessionId) {
                  setConnectingServer(null);
                }
              }}
            >
              <X size={14} /> {t('关闭连接')}
            </div>
          </div>
      )}
    </div>
  );
}
