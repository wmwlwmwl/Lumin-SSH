import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EventsOn, WindowMinimise, WindowToggleMaximise, WindowHide } from '../wailsjs/runtime/runtime.js';
import * as AppGo from '../wailsjs/go/main/App.js';
import ServerList from './components/ServerList.jsx';
import AddServerModal from './components/AddServerModal.jsx';
import Terminal from './components/Terminal.jsx';
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
import { Settings, House, Minus, Square, X, Monitor, Eye, EyeOff } from 'lucide-react';

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
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const lastTerminalRef = useRef({}); // 记录每个 session 最后选中的终端
  const [mountedSessions, setMountedSessions] = useState(new Set());
  const [contentTab, setContentTab] = useState('terminal'); // 'terminal' | 'files'
  const [showAddServer, setShowAddServer] = useState(false);
  const [editServer, setEditServer] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTrayPanel, setShowTrayPanel] = useState(false);
  const [showProbe, setShowProbe] = useState(false); // 探针面板 toggle
  const [connectingServer, setConnectingServer] = useState(null); // { server, sessionId, startTime }
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

  const startDrag = (e, direction) => {
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
  };
  // ────────────────────────────────────────────────────────

  const pingTimerRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── 新增主页仪表盘状态 ──────────────────────────────────
  const [recentServers, setRecentServers] = useState(() => {
    try {
      const saved = localStorage.getItem('recent_servers');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  // 持久化最近连接列表到 localStorage（仅含非敏感字段）
  useEffect(() => {
    localStorage.setItem('recent_servers', JSON.stringify(recentServers));
  }, [recentServers]);
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
    if (savedTheme === 'light') {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }

    const useCustomAccent = localStorage.getItem('useCustomAccent') === 'true';
    const themeAccent = localStorage.getItem('themeAccent');
    if (useCustomAccent && themeAccent) {
      document.documentElement.style.setProperty('--green', themeAccent);
    }
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
      port: parseInt(quickPort, 10) || 22,
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

      // 加入最近连接（仅保留非敏感字段）
      setRecentServers((prev) => {
        const filtered = prev.filter((s) => s.id !== savedServer.id);
        const safeServer = { id: savedServer.id, name: savedServer.name, host: savedServer.host, port: savedServer.port, username: savedServer.username };
        return [safeServer, ...filtered].slice(0, 4);
      });

      // 清空表单
      setQuickName('');
      setQuickHost('');
      setQuickPass('');
      setQuickKey('');
      setQuickPassphrase('');
    } catch (err) {
      const errMsg = String(err);
      // 主机密钥变更由专用弹窗处理，不显示 toast
      const isHostKeyChange = errMsg.includes('主机密钥已变更');
      // 认证失败由专用弹窗处理，不显示 toast
      const isAuthFailed = errMsg.includes('认证失败');
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: (isHostKeyChange || isAuthFailed) ? 'connecting' : 'error' } : s))
      );
      if (!isHostKeyChange && !isAuthFailed) {
        setConnectingServer(null);
        addToast(`${t('连接失败')}: ${err}`, 'error', 5000);
      }
    }
  };

  // ── Toast helpers ──────────────────────────────────────────
  const toastIdRef = useRef(0);
  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => { if (mountedRef.current) setToasts((prev) => prev.filter((t) => t.id !== id)); }, duration);
  }, []);

  // ── 连接成功后通用设置：查询 OS 信息、启用监控、持久化 OS ──
  const postConnectSetup = useCallback(async (sessionId, serverId, extraServerFields = {}) => {
    try {
      const info = await AppGo.SystemInfo(sessionId);
      if (info) {
        setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, osInfo: info } : s));
        setMonitoringEnabled((prev) => ({ ...prev, [sessionId]: true }));
        if (serverId) {
          const detectedOs = info.os || info.platform || '';
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
    } catch (_) {}
  }, []);

  // ── Load servers ───────────────────────────────────────────
  const loadServers = useCallback(async () => {
    try {
      const data = await AppGo.GetConnections();
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

  // ── 重连会话核心逻辑 ────────────────────────────────────────
  const reconnectSession = useCallback(async (session, requestingTerminalId) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, status: 'connecting' } : s))
    );

    // 如果是当前激活的会话，展示连接等待卡片
    const serverObj = servers.find((sv) => sv.id === session.serverId);
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
  }, [servers, addToast]);

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
        isNew ? t('🔑 主机密钥确认') : t('⚠️ 主机密钥已变更'),
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

          try {
            const info = await AppGo.SystemInfo(sessionId);
            if (info) {
              setSessions((prev) =>
                prev.map((s) => (s.id === sessionId ? { ...s, osInfo: info } : s))
              );
              setMonitoringEnabled((prev) => ({ ...prev, [sessionId]: true }));
            }
          } catch (_) {}
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

        // 连接成功后自动查询 OS 信息
        try {
          const info = await AppGo.SystemInfo(sessionId);
          if (info) {
            setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, osInfo: info } : s));
            setMonitoringEnabled((prev) => ({ ...prev, [sessionId]: true }));
            const detectedOs = info.os || info.platform || '';
            if (detectedOs) {
              setServers(prevServers => {
                const currentServer = prevServers.find(s => s.id === connId);
                if (currentServer && currentServer.os !== detectedOs) {
                  const updatedServer = { ...currentServer, os: detectedOs, password: newPassword };
                  AppGo.SaveConnection(updatedServer).catch(console.error);
                  return prevServers.map(s => s.id === updatedServer.id ? updatedServer : s);
                }
                return prevServers;
              });
            }
          }
        } catch (_) {}

        // 加入最近连接
        setRecentServers((prev) => {
          const filtered = prev.filter((s) => s.id !== connId);
          const server = { id: connId, host, port, username };
          return [server, ...filtered].slice(0, 4);
        });
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

  // ── 监听关闭窗口请求，弹出选择对话框 ──────────────────────────
  useEffect(() => {
    const unbind = EventsOn('close-request', async () => {
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
      // 'cancel' 或 null（点遮罩关闭）→ 不做任何操作
    });
    return () => { if (unbind) unbind(); };
  }, []);

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
      const safeServer = { id: server.id, name: server.name, host: server.host, port: server.port, username: server.username };
      setRecentServers((prev) => {
        const filtered = prev.filter((s) => s.id !== server.id);
        return [safeServer, ...filtered].slice(0, 4);
      });
    } catch (err) {
      const errMsg = String(err);
      // 主机密钥变更由专用弹窗处理，不显示 toast
      const isHostKeyChange = errMsg.includes('主机密钥已变更');
      // 认证失败由专用弹窗处理，不显示 toast
      const isAuthFailed = errMsg.includes('认证失败');
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: (isHostKeyChange || isAuthFailed) ? 'connecting' : 'error' } : s))
      );
      if (!isHostKeyChange && !isAuthFailed) {
        setConnectingServer(null);
        addToast(`${t('连接失败')}: ${err}`, 'error', 5000);
      }
      // 主机密钥变更或认证失败时，保持 connectingServer 和 connecting 状态，等待弹窗确认
    }
  }, [addToast]);

  // ── Close session ──────────────────────────────────────────
  const closeSession = useCallback((sessionId, e) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find(s => s.id === sessionId);
    // 后端断开（不等待，即使服务器无响应也不阻塞 UI）
    if (session?.terminals) {
      for (const t of session.terminals) {
        AppGo.DisconnectSSH(t.id).catch(() => {});
      }
    } else {
      AppGo.DisconnectSSH(sessionId).catch(() => {});
    }
    // 立即从 UI 移除会话
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);
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
    }
  }, [activeSessionId]);

  // ── 在当前服务器上新建终端标签 ──────────────────────────────
  const openNewTerminal = useCallback(async (sessionId) => {
    const session = sessions.find(s => s.id === sessionId);
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
  }, [sessions, addToast]);

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
        const remainingSessions = sessionsRef.current.filter(s => s.id !== sessionId);
        if (remainingSessions.length > 0) {
          const nextSession = remainingSessions[remainingSessions.length - 1];
          setActiveSessionId(nextSession.id);
          const lastTid = lastTerminalRef.current[nextSession.id];
          const validTerminal = nextSession.terminals?.find(t => t.id === lastTid);
          setActiveTerminalId(validTerminal ? validTerminal.id : (nextSession.terminals?.[0]?.id || nextSession.id));
        } else {
          setActiveSessionId(null);
          setActiveTerminalId(null);
        }
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


  return (
    <div className="app-layout">
      {/* ── Topbar ───────────────────────────────────────── */}
      <div className="topbar">
        <div className="topbar-content">
          <div className="topbar-logo" style={{ marginLeft: 8, cursor: 'pointer' }} onClick={() => { setActiveSessionId(null); setActiveTerminalId(null); setShowSettings(false); }}>
            <img src={logoImg} alt="logo" />
            <div className="topbar-title" style={{ userSelect: 'none' }}>Lumin</div>
          </div>
          
          {sessions.length > 0 && (
            <div className="tab-bar" style={{ flex: 1, padding: '0 16px', background: 'transparent', borderBottom: 'none', height: '100%', alignItems: 'center' }}>
              <button 
                className="btn btn-ghost btn-sm no-drag" 
                onClick={() => { setActiveSessionId(null); setActiveTerminalId(null); }} 
                style={{ marginRight: 8, height: '26px', display: 'flex', alignItems: 'center', gap: 4 }}
                title={t('返回主页')}
              >
                <House size={14} />
              </button>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`tab-item no-drag ${activeSessionId === s.id ? 'active' : ''}`}
                  onClick={() => { setActiveSessionId(s.id); const sess = sessions.find(x => x.id === s.id); const lastTid = lastTerminalRef.current[s.id]; const validTerminal = sess?.terminals?.find(t => t.id === lastTid); setActiveTerminalId(validTerminal ? validTerminal.id : (sess?.terminals?.[0]?.id || s.id)); }}
                  style={{ height: '28px', minHeight: '28px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span style={{ fontSize: '10px', display: 'inline-block', lineHeight: 1 }}>
                    {s.status === 'connecting' ? '🟡' :
                     s.status === 'connected'  ? '🟢' :
                     s.status === 'error'      ? '🔴' :
                     s.status === 'closed'     ? '🔴' : '⚫'}
                  </span>
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
                      style={{
                        cursor: 'pointer',
                        opacity: 0.6,
                        marginLeft: '2px',
                        marginRight: '2px',
                        fontSize: '12px',
                        transition: 'opacity 0.2s',
                        userSelect: 'none'
                      }}
                      onMouseEnter={(e) => e.target.style.opacity = 1}
                      onMouseLeave={(e) => e.target.style.opacity = 0.6}
                    >
                      ⟳
                    </span>
                  )}
                  <span className="tab-close no-drag" onClick={(e) => closeSession(s.id, e)}>✕</span>
                </div>
              ))}
            </div>
          )}
          {sessions.length === 0 && <div style={{ flex: 1 }}></div>}

          <div className="window-controls">
            <button className="btn btn-ghost btn-icon no-drag" onClick={() => setShowSettings(true)} title={t('设置')} style={{ display: 'flex', alignItems: 'center' }}><Settings size={16} /></button>
            
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 8px' }}></div>
            
            <button className="btn btn-ghost btn-icon no-drag" onClick={WindowMinimise} title={t('最小化')} style={{ display: 'flex', alignItems: 'center' }}><Minus size={14} /></button>
            <button className="btn btn-ghost btn-icon no-drag" onClick={WindowToggleMaximise} title={t('最大化')} style={{ display: 'flex', alignItems: 'center' }}><Square size={14} /></button>
            <button
              className="btn btn-ghost btn-icon no-drag"
              title={t('关闭')}
              onClick={async () => {
                const choice = await window.luminDialog?.choice?.(
                  t('请选择操作'),
                  t('关闭窗口'),
                  [
                    { label: t('退出'), value: 'quit', primary: true },
                    { label: t('系统托盘'), value: 'tray', secondary: true },
                    { label: t('取消'), value: 'cancel', secondary: true },
                  ]
                );
                if (choice === 'quit') AppGo.DoQuit();
                else if (choice === 'tray') { WindowHide(); setShowTrayPanel(false); }
              }}
            ><X size={14} /></button>
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
                  <span className="card-header-icon">⚡</span>
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
                      <button type="button" onClick={() => setShowQuickPass(!showQuickPass)} style={{ position: 'absolute', right: 6, bottom: 4, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                        {showQuickPass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="form-group-compact">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ marginBottom: 0 }}>{t('私钥内容')}</label>
                          <button type="button" className="btn-text-action" onClick={handleQuickPrivateKeyFile}>📁 {t('浏览')}</button>
                        </div>
                        <textarea className="textarea-compact" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={quickKey} onChange={e => setQuickKey(e.target.value)} />
                      </div>
                      <div className="form-group-compact" style={{ position: 'relative' }}>
                        <label>{t('私钥密码短语 (可选)')}</label>
                        <input className="input-compact" type={showQuickPassphrase ? "text" : "password"} placeholder="Passphrase" value={quickPassphrase} onChange={e => setQuickPassphrase(e.target.value)} style={{ paddingRight: 32 }} />
                        <button type="button" onClick={() => setShowQuickPassphrase(!showQuickPassphrase)} style={{ position: 'absolute', right: 6, bottom: 4, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
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
                  <span className="card-header-icon">📊</span>
                  <span className="card-header-title">{t('系统状态')}</span>
                  <button className={`btn-icon-spin ${isRefreshingPing ? 'spinning' : ''}`} onClick={handleRefreshPing} title="Refresh" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>🔄</button>
                </div>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-val">{servers.length}</div>
                    <div className="stat-lbl">{t('服务器总数')}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-val" style={{ color: 'var(--green)' }}>{Object.values(pings).filter(p => p.online).length}</div>
                    <div className="stat-lbl">{t('在线节点')}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-val" style={{ color: 'var(--red)' }}>{Object.values(pings).filter(p => !p.online).length}</div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="section-title-icon">🖥</span>
                    <span className="section-title">{t('主机')}</span>
                    <div className="view-mode-toggles" style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 6, padding: 2 }}>
                      <button
                        className={`btn-icon ${serverListViewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => { setServerListViewMode('grid'); localStorage.setItem('serverListViewMode', 'grid'); }}
                        title={t('卡片视图')}
                        style={{ padding: '2px 6px', fontSize: 12, background: serverListViewMode === 'grid' ? 'var(--bg-3)' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      >
                        🔲
                      </button>
                      <button
                        className={`btn-icon ${serverListViewMode === 'table' ? 'active' : ''}`}
                        onClick={() => { setServerListViewMode('table'); localStorage.setItem('serverListViewMode', 'table'); }}
                        title={t('列表视图')}
                        style={{ padding: '2px 6px', fontSize: 12, background: serverListViewMode === 'table' ? 'var(--bg-3)' : 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      >
                        📄
                      </button>
                    </div>
                    <button
                      className={`btn-icon ${hideSensitive ? 'active' : ''}`}
                      onClick={() => { const v = !hideSensitive; setHideSensitive(v); localStorage.setItem('hideSensitive', v); }}
                      title={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                      style={{ padding: '2px 8px', fontSize: 12, background: hideSensitive ? 'var(--bg-3)' : 'transparent', border: hideSensitive ? '1px solid var(--orange)' : '1px solid rgba(255,255,255,0.1)', borderRadius: 4, cursor: 'pointer', color: hideSensitive ? 'var(--orange)' : 'var(--text-3)' }}
                    >
                      {hideSensitive ? '🙈' : '🙉'}
                    </button>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px' }}
                    onClick={() => { setEditServer(null); setShowAddServer(true); }}
                  >
                    {t('添加')}
                  </button>
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
              <div className="content-tab-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 16 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    className={`content-tab ${contentTab === 'terminal' ? 'active' : ''}`}
                    onClick={() => setContentTab('terminal')}
                  >
                    🖥 {t('终端')}
                  </button>
                  {fileManagerPosition === 'tab' && (
                    <button
                      className={`content-tab ${contentTab === 'files' ? 'active' : ''}`}
                      onClick={() => setContentTab('files')}
                      disabled={activeSession.status !== 'connected'}
                    >
                      📁 {t('文件管理')}
                    </button>
                  )}
                  <button
                    className={`content-tab ${contentTab === 'history' ? 'active' : ''}`}
                    onClick={() => setContentTab('history')}
                    disabled={activeSession.status !== 'connected'}
                  >
                    📜 {t('历史指令')}
                  </button>
                </div>
                
                {activeSession.status === 'connected' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{t('文件管理器布局')}:</span>
                    <select
                      className="select-compact"
                      style={{ padding: '2px 8px', fontSize: 12, height: 24 }}
                      value={fileManagerPosition}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFileManagerPosition(val);
                        localStorage.setItem('fileManagerPosition', val);
                        if (val !== 'tab' && contentTab === 'files') {
                          setContentTab('terminal'); // 如果切走，自动返回终端
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
              <div className="terminal-sub-tab-bar" style={{
                display: 'flex', alignItems: 'center', gap: 2,
                padding: '2px 12px 1px',
                background: 'var(--bg-1)',
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}>
                {activeSession.terminals.map((t, idx) => (
                  <div
                    key={t.id}
                    className={`terminal-sub-tab ${activeTerminalId === t.id ? 'active' : ''}`}
                    onClick={() => { setActiveTerminalId(t.id); setContentTab('terminal'); lastTerminalRef.current[activeSession.id] = t.id; }}
                    title={t.label}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 10px',
                      fontSize: 11,
                      borderRadius: '4px 4px 0 0',
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: activeTerminalId === t.id ? 'var(--bg-3)' : 'transparent',
                      color: activeTerminalId === t.id ? 'var(--text-1)' : 'var(--text-3)',
                      border: activeTerminalId === t.id ? '1px solid var(--border)' : '1px solid transparent',
                      borderBottom: activeTerminalId === t.id ? '1px solid var(--bg-3)' : '1px solid transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 11 }}>🖥</span>
                    <span>{t.label}</span>
                    {activeSession.terminals.length > 1 && (
                      <span
                        className="terminal-sub-tab-close"
                        onClick={(e) => closeTerminal(activeSession.id, t.id, e)}
                        style={{
                          marginLeft: 4, fontSize: 10, opacity: 0.5,
                          cursor: 'pointer', lineHeight: 1,
                        }}
                        onMouseEnter={e2 => e2.currentTarget.style.opacity = 1}
                        onMouseLeave={e2 => e2.currentTarget.style.opacity = 0.5}
                      >✕</span>
                    )}
                  </div>
                ))}
                {/* ── 新建终端按钮 ── */}
                <button
                  className="btn-ghost"
                  onClick={() => openNewTerminal(activeSession.id)}
                  title={t('新建终端')}
                  style={{
                    marginLeft: 2, padding: '1px 6px',
                    fontSize: 12, lineHeight: 1,
                    cursor: 'pointer', border: 'none',
                    background: 'transparent', color: 'var(--text-3)',
                    borderRadius: 4,
                  }}
                >➕ {t('新终端')}</button>
              </div>
            )}

            {/* Session Content */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
              {/* 左侧/上侧主体容器 */}
              <div id="session-editor-container" style={{ flex: 1, display: 'flex', flexDirection: fileManagerPosition === 'bottom' ? 'column' : 'row', height: '100%', position: 'relative', overflow: 'hidden' }}>
                {/* 主体视口 */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', order: 1 }}>
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
                          style={{
                            width: '4px',
                            cursor: 'col-resize',
                            background: 'rgba(255, 255, 255, 0.02)',
                            zIndex: 10,
                            position: 'relative',
                            marginLeft: '-2px',
                            marginRight: '-2px',
                            transition: 'background 0.2s',
                          }}
                        />
                      </>
                    )}

                    {/* 主要视口 (终端/标签页模式下的文件) */}
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
                      <div style={{ display: (contentTab === 'terminal' || s.status !== 'connected') ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', position: 'relative' }}>
                        {(s.terminals && s.terminals.length > 0 ? s.terminals : [{ id: s.id, label: t('终端') }]).map((t) => (
                          <div key={t.id} style={{
                            position: 'absolute', inset: 0,
                            display: ((contentTab === 'terminal' || s.status !== 'connected') && activeTerminalId === t.id) ? 'flex' : 'none',
                            flexDirection: 'column',
                          }}>
                            <Terminal
                              sessionId={t.id}
                              serverId={s.id}
                              historyServerId={s.serverId}
                              status={s.status}
                              isActive={activeSessionId === s.id && activeTerminalId === t.id && (contentTab === 'terminal' || fileManagerPosition !== 'tab')}
                              serverName={s.serverName}
                              connectedSessions={connectedSessions}
                            />
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
                          style={{
                            height: '4px',
                            cursor: 'row-resize',
                            background: 'rgba(255, 255, 255, 0.02)',
                            zIndex: 10,
                            position: 'relative',
                            marginTop: '-2px',
                            marginBottom: '-2px',
                            transition: 'background 0.2s',
                          }}
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

      {/* ── 连接进度卡片 Overlay（参考图一）──────────────── */}
      {connectingServer && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            width: 380, borderRadius: 16, overflow: 'hidden',
            background: 'rgba(22,27,34,0.97)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
            padding: '20px 24px 22px',
          }}>
            {/* 标题行：图标 + 名称 + 按钮 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg,#ef4444,#dc2626)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Monitor size={22} style={{ color: '#fff' }} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f0f6fc', marginBottom: 3 }}>
                  {connectingServer.server.name || connectingServer.server.host}
                </div>
                <div style={{ fontSize: 12, color: '#3fb950', fontFamily: 'monospace' }}>
                  SSH {connectingServer.server.host}:{connectingServer.server.port || 22}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  style={{
                    padding: '5px 14px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                    color: '#8b949e',
                  }}
                  onClick={() => setConnectingServer(null)}
                >
                  {t('取消')}
                </button>
              </div>
            </div>

            {/* 双进度条（参考图一）*/}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              {/* 左进度点 */}
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 8px #22c55e' }} />
              {/* 进度条 */}
              <div style={{ flex: 1, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4,
                  background: 'linear-gradient(90deg, #22c55e, #86efac)',
                  animation: 'ssh-progress-indeterminate 1.4s ease-in-out infinite',
                }} />
              </div>
              {/* WiFi 图标 */}
              <div style={{ flexShrink: 0, fontSize: 14, color: '#22c55e' }}>📡</div>
              {/* 第二段进度条 */}
              <div style={{ flex: 1, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4,
                  background: 'linear-gradient(90deg, #22c55e, #86efac)',
                  animation: 'ssh-progress-indeterminate 1.4s ease-in-out 0.4s infinite',
                }} />
              </div>
              {/* 右旋转图标 */}
              <div style={{ flexShrink: 0, animation: 'spin 1.2s linear infinite', fontSize: 14, color: '#6e7681' }}>⟳</div>
            </div>

            {/* 提示文字 */}
            <div style={{ fontSize: 12, color: '#6e7681', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>⟳</span>
              {t('正在建立 SSH 连接，请稍候...')}
            </div>
          </div>
        </div>
      )}

      {/* ── 托盘弹窗面板（参考图二/图三）─────────────────── */}
      {showTrayPanel && (
        <div
          style={{
            position: 'fixed', bottom: 48, right: 16, zIndex: 8000,
            width: 280,
            borderRadius: 14,
            background: 'rgba(13,17,23,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 标题栏 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={logoImg} alt="logo" style={{ width: 24, height: 24, borderRadius: 6 }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc' }}>Lumin</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', fontSize: 14, padding: '2px 6px' }}
                title={t('展开窗口')}
                onClick={() => { import('../wailsjs/runtime/runtime.js').then(r => r.WindowShow()); setShowTrayPanel(false); }}
              >⤢</button>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', fontSize: 14, padding: '2px 6px' }}
                onClick={() => setShowTrayPanel(false)}
              >✕</button>
            </div>
          </div>

          {/* 内容区 */}
          <div style={{ flex: 1, padding: '12px 0', minHeight: 120 }}>
            {sessions.filter(s => s.status === 'connected').length > 0 ? (
              <>
                <div style={{ fontSize: 11, color: '#6e7681', padding: '0 16px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1 }}>{t('会话')}</div>
                {sessions.filter(s => s.status === 'connected').map(s => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 16px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      import('../wailsjs/runtime/runtime.js').then(r => r.WindowShow());
                      setActiveSessionId(s.id);
                      setShowTrayPanel(false);
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                      <span style={{ fontSize: 14, color: '#f0f6fc', fontWeight: 500 }}>{s.serverName}</span>
                    </div>
                    <span style={{ fontSize: 12, color: '#6e7681' }}>{t('已连接')}</span>
                  </div>
                ))}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '28px 16px', gap: 10 }}>
                <div style={{ fontSize: 40 }}>😤</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f6fc' }}>{t('一切都很安静')}</div>
                <div style={{ fontSize: 12, color: '#6e7681', textAlign: 'center', lineHeight: 1.6 }}>
                  {t('去连接个服务器吧，已经想念你了 🌿')}
                </div>
              </div>
            )}
          </div>

          {/* 底部退出按钮 */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '10px 16px' }}>
            <button
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', background: 'none', border: 'none',
                cursor: 'pointer', color: '#6e7681', fontSize: 13,
                padding: '6px 0', transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#f0f6fc'}
              onMouseLeave={e => e.currentTarget.style.color = '#6e7681'}
              onClick={() => AppGo.DoQuit()}
            >
              <span>⏻</span> {t('退出 Lumin')}
            </button>
          </div>
        </div>
      )}


      {/* 🚀 右下角小巧自动更新弹窗 */}
      {isUpdateModalVisible && startupUpdateInfo && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          width: 340, background: 'rgba(22, 27, 34, 0.95)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
          borderRadius: 16, padding: '16px 20px',
          animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ fontSize: 28, lineHeight: 1, filter: 'drop-shadow(0 4px 8px rgba(16,185,129,0.3))' }}>🚀</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f6fc', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                {t('发现新版本')} <span style={{ color: '#34d399', fontSize: 13, background: 'rgba(52, 211, 153, 0.1)', padding: '2px 6px', borderRadius: 6 }}>{startupUpdateInfo.version}</span>
              </div>
              <div style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.5, marginBottom: 16 }}>
                {t('为了给您提供更极致的体验，建议您立即升级。')}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button 
                  style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#8b949e', cursor: 'pointer', transition: 'all 0.2s' }}
                  onClick={() => setIsUpdateModalVisible(false)}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f0f6fc'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.background = 'transparent'; }}
                  disabled={downloadProgress >= 0}
                >
                  {t('稍等')}
                </button>
                <button 
                  style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: '#10b981', border: 'none', color: '#fff', cursor: 'pointer', position: 'relative', overflow: 'hidden', transition: 'all 0.2s' }}
                  onClick={handleApplyStartupUpdate}
                  onMouseEnter={e => e.currentTarget.style.background = '#059669'}
                  onMouseLeave={e => e.currentTarget.style.background = '#10b981'}
                  disabled={downloadProgress >= 0}
                >
                  {downloadProgress >= 0 && (
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${downloadProgress}%`, background: 'rgba(0,0,0,0.2)', transition: 'width 0.2s ease-out' }} />
                  )}
                  <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {downloadProgress >= 0 ? (
                      <>
                        <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                        {downloadProgress}%
                      </>
                    ) : (
                      t('立即更新')
                    )}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <GlobalContextMenu />
    </div>
  );
}
