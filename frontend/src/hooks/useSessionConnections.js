import { useCallback, useEffect } from 'react';
import { EventsOn, WindowHide } from '../../wailsjs/runtime/runtime.js';
import * as AppGo from '../../wailsjs/go/main/App.js';

export default function useSessionConnections(deps) {
  const { activeSessionIdRef, activeTerminalIdRef, addToast, authPromptTokenRef, awaitDisconnectTerminals, buildTerminalCloneCwdCommand, cancelledConnectionsRef, clearSessionAuthPrompt, cloneSessionFileManagerWorkspaceState, connectingServersRef, contentTabRef, creatingTerminalRef, credentials, disconnectSessionTerminals, enqueueChangeReview, fileManagerPosition, getAllSessionFileManagerWorkspaces, getSessionFileManagerWorkspace, isRecoveryPasswordError, isUnsupportedMonitorSession, lastContentTabRef, lastTerminalRef, loadServerWorkspaceSessionSnapshot, markWorkspaceRestoreNavigationOverride, mountedRef, normalizeWorkspaceContentTab, persistServerWorkspaceSessionSnapshot, persistWorkspaceSnapshotRef, recordRecentConnection, registerServerDisconnect, remapSessionFileManagerWorkspaceMap, remapSessionFileManagerWorkspaces, remapSessionWorkspaceLayouts, remapTerminalPaneLayouts, rememberSessionActiveTerminal, rememberWorkspace, rememberWorkspaceLoaded, removeChangeReviewsByRequestId, replaceAllSessionFileManagerWorkspaces, resolveSessionRootTerminalId, restoringWorkspaceRef, serversLoaded, serversRef, sessionsRef, setActiveSessionId, setActiveTerminalId, setConnectingServers, setContentTab, setCreatingTerminalSessionId, setCredentials, setMonitoringEnabled, setMountedSessions, setRestoringWorkspaceSessionIds, setServers, setServersLoaded, setSessionAuthPrompts, setSessionFileManagerWorkspace, setSessions, setSettingsInitialTab, setShowSettings, setSshChannelUsage, setSyncFailed, setTabContextMenu, setTerminalPaneLayouts, setTerminalSubTabOverflow, setTerminalTabContextMenu, setWorkspaceRestoreReady, sortTerminalPaneCells, syncFailed, syncWithRecoveryPassword, t, terminalPaneLayoutsRef, terminalSubTabScrollBySessionRef, terminalSubTabScrollRef, terminalSubTabScrollTargetRef, updateSessionStatus, waitForServerDisconnect, workspacePersistenceLevel, workspaceRestoreNavigationOverrideRef, workspaceRestoreStartedRef } = deps;
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
  const postConnectSetup = useCallback(async (sessionId, serverId) => {
    try {
      // 获取静态信息（OS/主机名/时区）
      const staticInfo = await AppGo.GetServerStaticInfo(sessionId);
      if (staticInfo) {
        setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, osInfo: staticInfo } : s));
      }
      if (serverId) {
        recordRecentConnection(serverId);
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
      // 启用监控（PowerShell/CMD 无 probe 后端，跳过以避免无效轮询与误导标记）
      const sess = sessionsRef.current.find((s) => s.id === sessionId);
      if (!isUnsupportedMonitorSession(sess)) {
        setMonitoringEnabled((prev) => ({ ...prev, [sessionId]: true }));
      }
    } catch (_) { }
  }, [recordRecentConnection]);

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
    } catch (_) { }
    setServersLoaded(true);
  }, [addToast]);

  useEffect(() => { loadServers(); }, [loadServers]);

  // ── 取消连接 ──────────────────────────────────────────────
  const handleCancelConnection = useCallback((sessionId) => {
    if (!sessionId) return;
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    const termIds = session?.terminals?.length ? session.terminals.map((term) => term.id) : [sessionId];
    const disconnectPromise = disconnectSessionTerminals(termIds);
    if (session?.serverId) {
      registerServerDisconnect(session.serverId, disconnectPromise);
    }
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setActiveSessionId(null);
    setActiveTerminalId(null);
    setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
    clearSessionAuthPrompt(sessionId);
  }, [clearSessionAuthPrompt, disconnectSessionTerminals, registerServerDisconnect]);

  // ── 切换到下一个可用 session ──────────────────────────────
  const resolveSessionContentTab = useCallback((sessionId) => {
    const tab = normalizeWorkspaceContentTab(lastContentTabRef.current[sessionId] || 'terminal');
    // 文件管理器已停靠时，files 页签不可用，回落终端
    if (tab === 'files' && fileManagerPosition !== 'tab') return 'terminal';
    // 串口会话不支持文件管理/进程/网络（无 SFTP/probe），回落终端
    const sess = sessionsRef.current.find((s) => s.id === sessionId);
    if (sess?.isSerial && (tab === 'files' || tab === 'process' || tab === 'network')) return 'terminal';
    // PowerShell/CMD 无 probe 后端，进程/网络监控不可用（文件管理仍可用），回落终端
    if (isUnsupportedMonitorSession(sess) && (tab === 'process' || tab === 'network')) return 'terminal';
    return tab;
  }, [fileManagerPosition]);

  const switchToNextSession = useCallback((currentSessionId) => {
    const remaining = sessionsRef.current.filter(s => s.id !== currentSessionId);
    if (remaining.length > 0) {
      const nextSession = remaining[remaining.length - 1];
      setActiveSessionId(nextSession.id);
      const nextTermId = resolveSessionRootTerminalId(
        nextSession,
        lastTerminalRef.current[nextSession.id] || nextSession.activeTerminalId,
        terminalPaneLayoutsRef.current,
        nextSession.activeTerminalLabel || '',
      );
      setActiveTerminalId(nextTermId);
      if (nextTermId) {
        rememberSessionActiveTerminal(nextSession.id, nextTermId, nextSession.activeTerminalLabel || '');
      }
      setContentTab(resolveSessionContentTab(nextSession.id));
    } else {
      setActiveSessionId(null);
      setActiveTerminalId(null);
    }
  }, [rememberSessionActiveTerminal, resolveSessionContentTab, resolveSessionRootTerminalId]);

  // ponytail: 提取 tab 点击处理，避免每次渲染创建 N 个闭包
  const handleTabClick = useCallback((sessionId) => {
    markWorkspaceRestoreNavigationOverride();
    setTabContextMenu(null);
    setTerminalTabContextMenu(null);
    setActiveSessionId(sessionId);
    const sess = sessionsRef.current.find(x => x.id === sessionId);
    const preferredId = lastTerminalRef.current[sessionId] || sess?.activeTerminalId || null;
    const preferredLabel = sess?.activeTerminalLabel || '';
    const nextTerminalId = sess ? resolveSessionRootTerminalId(sess, preferredId, terminalPaneLayoutsRef.current, preferredLabel) : null;
    setActiveTerminalId(nextTerminalId);
    if (nextTerminalId) {
      rememberSessionActiveTerminal(sessionId, nextTerminalId, preferredLabel);
    }
    setContentTab(resolveSessionContentTab(sessionId));
    persistWorkspaceSnapshotRef.current({
      activeSessionId: sessionId,
      activeTerminalId: nextTerminalId,
    });
  }, [markWorkspaceRestoreNavigationOverride, rememberSessionActiveTerminal, resolveSessionContentTab, resolveSessionRootTerminalId]);

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

    if (session.isLocal) {
      const serverObj = { id: session.serverId, name: session.serverName, host: 'localhost' };
      setConnectingServers((prev) => [...prev, { server: serverObj, sessionId: session.id, startTime: Date.now() }]);
      try {
        await window.go.main.App.ConnectLocal(session.id, session.serverName, session.shellPath, '');
        // 本地/串口复用同一 sessionId 重连：自增 wsRebuildKey 让 Terminal 重建 WebSocket
        if (!deferState) {
          setSessions((prev) =>
            prev.map((s) => (s.id === session.id ? { ...s, status: 'connected', wsRebuildKey: (s.wsRebuildKey || 0) + 1 } : s))
          );
        }
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));
        return { oldToNew: { [session.id]: session.id }, newTerminals: session.terminals };
      } catch (err) {
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? { ...s, status: 'error' } : s))
        );
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));
        if (!deferState) {
          addToast(`${t('重新连接失败')}: ${err}`, 'error', 5000);
        }
        return null;
      }
    }

    if (session.isSerial) {
      const serverObj = { id: session.serverId, name: session.serverName, host: session.serialConfig?.port || '' };
      setConnectingServers((prev) => [...prev, { server: serverObj, sessionId: session.id, startTime: Date.now() }]);
      try {
        const config = session.serialConfig;
        await window.go.main.App.ConnectSerial(
          session.id,
          session.serverName,
          config.port,
          config.baudRate,
          config.dataBits,
          config.stopBits,
          config.parity
        );
        // 本地/串口复用同一 sessionId 重连：自增 wsRebuildKey 让 Terminal 重建 WebSocket
        if (!deferState) {
          setSessions((prev) =>
            prev.map((s) => (s.id === session.id ? { ...s, status: 'connected', wsRebuildKey: (s.wsRebuildKey || 0) + 1 } : s))
          );
        }
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));
        return { oldToNew: { [session.id]: session.id }, newTerminals: session.terminals };
      } catch (err) {
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? { ...s, status: 'error' } : s))
        );
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== session.id));
        if (!deferState) {
          addToast(`${t('重新连接失败')}: ${err}`, 'error', 5000);
        }
        return null;
      }
    }

    const serverObj = serversRef.current.find((sv) => sv.id === session.serverId);
    if (serverObj) {
      setConnectingServers((prev) => [...prev, { server: serverObj, sessionId: session.id, startTime: Date.now() }]);
    }
    try {
      // 先拆旧 SSH（保留前端 terminals 列表用于恢复），避免脏 connTerminals / 重复登记
      const priorTerminals = session.terminals?.length
        ? session.terminals
        : [{ id: session.id }];
      const disconnectIds = new Set([session.id, ...priorTerminals.map((term) => term.id).filter(Boolean)]);
      await awaitDisconnectTerminals([...disconnectIds]);

      await AppGo.ConnectSSH(session.id, session.serverId);

      const savedTerminals = session.terminals?.length > 0 ? session.terminals : [{ id: session.id, label: `${t('终端')}1` }];
      const rootTerminal = savedTerminals.find(term => term.id === session.id) || savedTerminals[0] || { id: session.id, label: `${t('终端')}1` };
      const subTerminals = savedTerminals.filter(term => term.id !== session.id);
      const oldToNew = { [rootTerminal.id]: session.id, [session.id]: session.id };
      for (const sub of subTerminals) {
        try {
          const newTermId = await AppGo.OpenTerminal(session.id);
          oldToNew[sub.id] = newTermId;
        } catch { }
      }
      const newTerminals = savedTerminals
        .map(term => ({
          id: oldToNew[term.id],
          label: term.label || `${t('终端')}1`,
        }))
        .filter(term => !!term.id);

      if (!deferState && Object.keys(oldToNew).length > 0) {
        remapSessionFileManagerWorkspaces(oldToNew);
        const remappedLayouts = remapTerminalPaneLayouts(terminalPaneLayoutsRef.current, oldToNew, session.id);
        terminalPaneLayoutsRef.current = remappedLayouts;
        setTerminalPaneLayouts(remappedLayouts);
        if (lastTerminalRef.current[session.id] && oldToNew[lastTerminalRef.current[session.id]]) {
          lastTerminalRef.current[session.id] = oldToNew[lastTerminalRef.current[session.id]];
        }
      }

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
  }, [addToast, awaitDisconnectTerminals, t, postConnectSetup]);

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
          const terminals = orderedTerminalIds.map((terminalId, index) => {
            const terminal = terminalById.get(terminalId);
            return {
              id: terminalId,
              label: terminal?.label || `${t('终端')}${index + 1}`,
            };
          });
          const savedActiveTermId = typeof session.activeTerminalId === 'string' ? session.activeTerminalId.trim() : '';
          const savedActiveTermLabel = typeof session.activeTerminalLabel === 'string' ? session.activeTerminalLabel.trim() : '';
          // 当前激活会话若未带 per-session 字段，回退全局 activeTerminalId
          const fallbackActiveTermId = session.id === snapshot.activeSessionId
            ? (typeof snapshot.activeTerminalId === 'string' ? snapshot.activeTerminalId.trim() : '')
            : '';
          return {
            id: session.id,
            serverId: session.serverId,
            serverName: session.serverName || session.host,
            host: session.host || '',
            status: 'connecting',
            activeTerminalId: savedActiveTermId || fallbackActiveTermId || null,
            activeTerminalLabel: savedActiveTermLabel || null,
            terminals,
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
          // 每个会话各自恢复上次选中的终端（不仅当前激活会话）
          // 优先按旧 id 映射；失败再用标签名（终端3）兜底
          const rawPreferredId = savedSession.activeTerminalId
            || (savedSession.id === initialActiveSessionId ? snapshot.activeTerminalId : null);
          const preferredTermId = (rawPreferredId && idMap[rawPreferredId]) || rawPreferredId || null;
          const preferredLabel = savedSession.activeTerminalLabel || '';
          const resolvedTermId = resolveSessionRootTerminalId(
            restoredSession,
            preferredTermId,
            { ...terminalPaneLayoutsRef.current, ...restoredSessionLayouts },
            preferredLabel,
          );
          const resolvedLabel = restoredSession.terminals?.find((term) => term.id === resolvedTermId)?.label
            || preferredLabel
            || '';
          const sessionWithActive = resolvedTermId
            ? { ...restoredSession, activeTerminalId: resolvedTermId, activeTerminalLabel: resolvedLabel }
            : restoredSession;
          if (resolvedTermId) {
            lastTerminalRef.current[sessionWithActive.id] = resolvedTermId;
          }
          // ponytail: 用函数式更新而非整体覆盖，避免恢复期间用户新建/关闭的 session 被丢失或复活
          sessionsRef.current = sessionsRef.current.map((session) => (
            session.id === savedSession.id ? sessionWithActive : session
          ));
          setSessions((prev) => prev.map((session) => (
            session.id === savedSession.id ? sessionWithActive : session
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
      const preferredTerminalId = finalSession.activeTerminalId
        || lastTerminalRef.current[finalSession.id]
        || idMap[snapshot.activeTerminalId]
        || snapshot.activeTerminalId;
      const resolvedTerminalId = resolveSessionRootTerminalId(
        finalSession,
        preferredTerminalId,
        terminalPaneLayoutsRef.current,
        finalSession.activeTerminalLabel || '',
      );
      if (resolvedTerminalId) {
        lastTerminalRef.current[finalSession.id] = resolvedTerminalId;
        const resolvedLabel = finalSession.terminals?.find((term) => term.id === resolvedTerminalId)?.label || '';
        sessionsRef.current = sessionsRef.current.map((session) => (
          session.id === finalSession.id
            ? { ...session, activeTerminalId: resolvedTerminalId, activeTerminalLabel: resolvedLabel }
            : session
        ));
        setSessions((prev) => prev.map((session) => (
          session.id === finalSession.id
            ? { ...session, activeTerminalId: resolvedTerminalId, activeTerminalLabel: resolvedLabel }
            : session
        )));
      }
      setActiveSessionId(finalSession.id);
      setActiveTerminalId(resolvedTerminalId);
      setContentTab('terminal');
    })().finally(() => {
      restoringWorkspaceRef.current = false;
      setRestoringWorkspaceSessionIds(new Set());
      setWorkspaceRestoreReady(true);
    });
  }, [rememberWorkspace, rememberWorkspaceLoaded, reconnectSession, resolveSessionRootTerminalId, serversLoaded, t]);

  // ── 监听 SSH 断开事件（整机意外断 vs 单终端结束）────────────────
  useEffect(() => {
    const unbind = EventsOn('ssh-disconnected', (payload) => {
      // 兼容旧版纯 string sessionId
      const data = (payload && typeof payload === 'object')
        ? payload
        : { sessionId: payload, parentSessionId: payload, connectionClosed: true, reason: 'transport' };
      const sessionId = data.sessionId;
      const parentSessionId = data.parentSessionId || sessionId;
      const connectionClosed = data.connectionClosed !== false && data.connectionClosed !== 'false';
      const reason = data.reason || '';
      const endedTerminalIds = Array.isArray(data.terminalIds) && data.terminalIds.length
        ? data.terminalIds
        : (sessionId ? [sessionId] : []);

      const sessionList = sessionsRef.current;
      const matchedSession = sessionList.find((item) => item.id === parentSessionId || item.id === sessionId)
        || sessionList.find((item) => item.terminals?.some((terminal) => terminal.id === sessionId || terminal.id === parentSessionId || endedTerminalIds.includes(terminal.id)))
        || null;
      if (!matchedSession) {
        return;
      }
      const parentId = matchedSession.id;

      const transportDead = reason === 'transport' || reason === 'keepalive';
      if (connectionClosed || transportDead) {
        setSessions((prev) => prev.map((s) => (s.id === parentId ? { ...s, status: 'closed' } : s)));
        // 仅传输/保活导致的整机断开视为「意外」；最后一终端正常 exit 只标 closed，不误报
        if (transportDead) {
          addToast(t('SSH 连接已意外断开'), 'error', 4000);
        }
        return;
      }

      // 单终端 channel 结束：只移除该终端；若已无终端再标 closed
      setSessions((prev) => prev.map((s) => {
        if (s.id !== parentId) return s;
        const nextTerminals = (s.terminals || []).filter((term) => !endedTerminalIds.includes(term.id));
        if (nextTerminals.length === 0) {
          return { ...s, status: 'closed', terminals: [{ id: s.id, label: `${t('终端')}1` }] };
        }
        // 根终端 id 常等于 session.id；若根 shell 结束但子终端还在，保留子终端
        const stillHasRoot = nextTerminals.some((term) => term.id === s.id);
        const terminals = stillHasRoot
          ? nextTerminals
          : [{ id: s.id, label: nextTerminals[0]?.label || `${t('终端')}1` }, ...nextTerminals.filter((term) => term.id !== s.id)];
        return { ...s, status: 'connected', terminals };
      }));
    });
    return () => {
      if (unbind) unbind();
    };
  }, [addToast, t]);

  // ── 主机密钥确认：用户在会话卡片上做出选择后 ──────────────────
  // chosen: 0=取消, 1=仅本次接受, 2=接受并保存
  const resolveHostKeyChoice = useCallback(async (sessionId, chosen) => {
    clearSessionAuthPrompt(sessionId);
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

        const matched = sessionsRef.current.find((s) => s.id === sessionId);
        await postConnectSetup(sessionId, matched?.serverId);
      } else {
        updateSessionStatus(sessionId, 'error');
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        addToast(t('用户取消连接'), 'warning', 3000);
      }
    } catch (err) {
      // 取消分支后端固定返回「用户取消了主机密钥验证」，属预期结果，不作失败提示
      if (chosen >= 1) {
        addToast(`${t('连接失败')}: ${err}`, 'error', 5000);
      } else {
        addToast(t('用户取消连接'), 'warning', 3000);
      }
      updateSessionStatus(sessionId, 'error');
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
    }
  }, [addToast, clearSessionAuthPrompt, postConnectSetup, t, updateSessionStatus]);

  // ── 监听主机密钥变更事件 ────────────────────────────────────
  // 只写入该会话的待确认状态，由会话面板内的 SessionAuthCard 呈现，
  // 批量连接时 N 台主机就有 N 张卡片，各自独立。
  useEffect(() => {
    const unbind = EventsOn('ssh-host-key-changed', (data) => {
      const {
        sessionId, host, port, newFingerprint, oldFingerprints, isNew
      } = data;

      const oldFpList = (oldFingerprints || []).join('\n');
      const message = isNew
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

      setSessionAuthPrompts((prev) => ({
        ...prev,
        [sessionId]: {
          kind: 'hostkey',
          token: ++authPromptTokenRef.current,
          title: isNew ? t('主机密钥确认') : t('主机密钥已变更'),
          message,
          danger: !isNew, // 密钥变更（疑似中间人）默认焦点落在「取消」
        },
      }));
    });
    return () => {
      if (unbind) unbind();
    };
  }, [t]);

  // ── 认证失败：用户在会话卡片上重输密码后 ──────────────────
  // result: null=取消 | { value, persist }
  const resolvePasswordPrompt = useCallback(async (sessionId, connId, result) => {
    clearSessionAuthPrompt(sessionId);
    if (result === null) {
      // 用户取消
      updateSessionStatus(sessionId, 'error');
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
      addToast(t('用户取消连接'), 'warning', 3000);
      return;
    }

    const { value: newPassword, persist } = result;
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

      await postConnectSetup(sessionId, connId);
    } catch (retryErr) {
      updateSessionStatus(sessionId, 'error');
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
      addToast(`${t('重新连接失败')}: ${String(retryErr)}`, 'error', 5000);
    }
  }, [addToast, clearSessionAuthPrompt, postConnectSetup, t, updateSessionStatus]);

  // ── 监听认证失败事件（密码错误等） ──────────────────────────
  // 只写入该会话的待确认状态，由会话面板内的 SessionAuthCard 呈现
  useEffect(() => {
    const unbind = EventsOn('ssh-auth-failed', (data) => {
      const { sessionId, connId, host, port, username, error } = data;
      const usesCredential = serversRef.current.some(s => s.id === connId && s.credentialId);

      const message = [
        t('认证失败，请输入正确的密码重试：'),
        ``,
        `${t('主机:')} ${host}:${port}`,
        `${t('用户')}: ${username}`,
        ``,
        `${t('错误')}: ${error}`,
      ].join('\n');

      setSessionAuthPrompts((prev) => ({
        ...prev,
        [sessionId]: {
          kind: 'password',
          token: ++authPromptTokenRef.current,
          title: t('认证失败'),
          message,
          connId,
          checkboxLabel: usesCredential ? t('更新凭据密码') : t('记住密码'),
        },
      }));
    });
    return () => {
      if (unbind) unbind();
    };
  }, [t]);

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
        ],
        '',
        { priority: 'system' },
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
      t('记住选择'),
      { priority: 'system' },
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

  // ── 监听 SSH 通道占用事件 ─────────────────────────────────
  useEffect(() => {
    const unbind = EventsOn('ssh-channel-usage', (payload) => {
      const data = payload && typeof payload === 'object' ? payload : null;
      if (!data) return;
      const sessionIds = Array.isArray(data.sessionIds) ? data.sessionIds.filter(Boolean) : [];
      if (sessionIds.length === 0) return;
      const usage = {
        terminals: Number(data.terminals) || 0,
        sharedSftp: Number(data.sharedSftp) || 0,
        uploadPool: Number(data.uploadPool) || 0,
        total: Number(data.total) || 0,
        maxSessions: Number(data.maxSessions) || 10,
      };
      setSshChannelUsage((prev) => {
        const next = { ...prev };
        sessionIds.forEach((id) => { next[id] = usage; });
        return next;
      });
    });
    return () => { if (unbind) unbind(); };
  }, []);

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
    // 用户主动点连即记入最近，已连接仅切换焦点时也置顶
    recordRecentConnection(server?.id);
    await waitForServerDisconnect(server?.id);
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
        const remappedSnapshotWorkspaces = remapSessionFileManagerWorkspaceMap(sessionSnapshot.fileManagerWorkspaces || {}, result.oldToNew);
        Object.keys(sessionSnapshot.fileManagerWorkspaces || {}).forEach((terminalId) => {
          delete currentWorkspaces[terminalId];
        });
        replaceAllSessionFileManagerWorkspaces({
          ...currentWorkspaces,
          ...remappedSnapshotWorkspaces,
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
  }, [fileManagerPosition, handleConnectError, loadServerWorkspaceSessionSnapshot, markWorkspaceRestoreNavigationOverride, postConnectSetup, reconnectSession, recordRecentConnection, rememberWorkspace, resolveSessionContentTab, resolveSessionRootTerminalId, t, waitForServerDisconnect, workspacePersistenceLevel]);

  const connectLocal = useCallback((name, shellPath) => {
    markWorkspaceRestoreNavigationOverride();
    const sessionId = `session_${Date.now()}`;
    const newSession = {
      id: sessionId,
      serverId: `local_${shellPath}`,
      serverName: name,
      host: 'localhost',
      status: 'connecting',
      terminals: [{ id: sessionId, label: name }],
      isLocal: true,
      shellPath: shellPath,
      wsRebuildKey: 0,
    };
    const nextSessions = [...sessionsRef.current, newSession];
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    setActiveSessionId(sessionId);
    setActiveTerminalId(sessionId);
    setContentTab('terminal');
    setConnectingServers((prev) => [...prev, { server: { id: newSession.serverId, name: name, host: 'localhost' }, sessionId, startTime: Date.now() }]);

    window.go.main.App.ConnectLocal(sessionId, name, shellPath, '')
      .then(() => {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
        );
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
        // 与 SSH 连接保持一致：连接成功后查询静态信息并自动启用系统监控。
        // postConnectSetup 内部对 serverId 相关调用有兜底，本地 serverId 无副作用。
        void postConnectSetup(sessionId, newSession.serverId);
      })
      .catch((err) => {
        handleConnectError(sessionId, err);
      });
  }, [handleConnectError, markWorkspaceRestoreNavigationOverride, postConnectSetup]);

  const connectSerial = useCallback((config) => {
    markWorkspaceRestoreNavigationOverride();
    const sessionId = `session_${Date.now()}`;
    const displayName = `${config.port}@${config.baudRate}`;
    const newSession = {
      id: sessionId,
      serverId: `serial_${config.port}`,
      serverName: displayName,
      host: config.port,
      status: 'connecting',
      terminals: [{ id: sessionId, label: displayName }],
      isSerial: true,
      serialConfig: config,
      wsRebuildKey: 0,
    };
    const nextSessions = [...sessionsRef.current, newSession];
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    setActiveSessionId(sessionId);
    setActiveTerminalId(sessionId);
    setContentTab('terminal');
    setConnectingServers((prev) => [...prev, { server: { id: newSession.serverId, name: displayName, host: config.port }, sessionId, startTime: Date.now() }]);

    window.go.main.App.ConnectSerial(
      sessionId,
      displayName,
      config.port,
      config.baudRate,
      config.dataBits,
      config.stopBits,
      config.parity
    )
      .then(() => {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'connected' } : s))
        );
        setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
      })
      .catch((err) => {
        handleConnectError(sessionId, err);
      });
  }, [handleConnectError, markWorkspaceRestoreNavigationOverride]);


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
    const disconnectPromise = disconnectSessionTerminals(termIds);
    if (session?.serverId) {
      registerServerDisconnect(session.serverId, disconnectPromise);
    }
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (next.length === 0) {
        window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => { });
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
    delete terminalSubTabScrollBySessionRef.current[sessionId];
    if (activeSessionIdRef.current === sessionId) {
      switchToNextSession(sessionId);
    }
    if (connectingServersRef.current.some((s) => s.sessionId === sessionId)) {
      setConnectingServers((prev) => prev.filter((s) => s.sessionId !== sessionId));
    }
    clearSessionAuthPrompt(sessionId);
  }, [clearSessionAuthPrompt, disconnectSessionTerminals, persistServerWorkspaceSessionSnapshot, registerServerDisconnect, switchToNextSession]);

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
    const disconnectPromise = disconnectSessionTerminals(allTermIds);
    all
      .map((session) => session?.serverId)
      .filter(Boolean)
      .forEach((serverId) => registerServerDisconnect(serverId, disconnectPromise));
    window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => { });
    setSessions([]);
    setTerminalPaneLayouts({});
    terminalSubTabScrollBySessionRef.current = {};
    setActiveSessionId(null);
    setActiveTerminalId(null);
    setConnectingServers([]);
    setSessionAuthPrompts({});
  }, [disconnectSessionTerminals, persistServerWorkspaceSessionSnapshot, registerServerDisconnect, t]);

  // ── 在当前服务器上新建终端标签 ──────────────────────────────
  const openNewTerminal = useCallback(async (sessionId, options = {}) => {
    markWorkspaceRestoreNavigationOverride();
    if (creatingTerminalRef.current) return;

    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session || session.status !== 'connected') return;

    creatingTerminalRef.current = sessionId;
    setCreatingTerminalSessionId(sessionId);

    const baseTermId = session.terminals?.[0]?.id || sessionId;
    const sourceTerminalId = typeof options?.sourceTerminalId === 'string' && options.sourceTerminalId.trim()
      ? options.sourceTerminalId.trim()
      : baseTermId;
    const cloneFileManagerWorkspace = options?.cloneFileManagerWorkspace === true;
    const cloneCwd = options?.cloneCwd === true;
    const sourceWorkspace = cloneFileManagerWorkspace
      ? cloneSessionFileManagerWorkspaceState(getSessionFileManagerWorkspace(sourceTerminalId))
      : null;
    const sourceCwdPromise = cloneCwd
      ? Promise.resolve(AppGo.GetTerminalCwd(sourceTerminalId))
        .then((value) => String(value || '').trim())
        .catch(() => '')
      : Promise.resolve('');

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
          ? {
            ...s,
            terminals: [...(s.terminals || []), { id: newTermId, label: termLabel }],
            activeTerminalId: newTermId,
            activeTerminalLabel: termLabel,
          }
          : s
      ));
      sessionsRef.current = nextSessions;
      terminalSubTabScrollBySessionRef.current[sessionId] = Number.MAX_SAFE_INTEGER;
      setSessions(nextSessions);
      setActiveTerminalId(newTermId);
      setContentTab('terminal');
      lastTerminalRef.current[sessionId] = newTermId;
      if (sourceWorkspace) {
        setSessionFileManagerWorkspace(newTermId, sourceWorkspace);
      }
      void sourceCwdPromise.then((sourceCwd) => {
        const command = buildTerminalCloneCwdCommand(sourceCwd);
        if (!command) {
          return;
        }
        window.setTimeout(() => {
          try {
            AppGo.WriteTerminal(newTermId, command);
          } catch { }
        }, 80);
      });
      persistWorkspaceSnapshotRef.current({
        sessions: nextSessions,
        activeSessionId: sessionId,
        activeTerminalId: newTermId,
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = terminalSubTabScrollRef.current;
          if (!el) return;
          const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
          const nextLeft = maxLeft;
          terminalSubTabScrollBySessionRef.current[sessionId] = nextLeft;
          terminalSubTabScrollTargetRef.current = nextLeft;
          el.scrollLeft = nextLeft;
          setTerminalSubTabOverflow(maxLeft > 1);
        });
      });
    } catch (err) {
      addToast(`${t('新建终端失败')}: ${err}`, 'error', 5000);
    } finally {
      creatingTerminalRef.current = null;
      if (mountedRef.current) setCreatingTerminalSessionId(null);
    }
  }, [addToast, markWorkspaceRestoreNavigationOverride, t]);

  const handleRenameTerminalTab = useCallback(async (sessionId, terminalId) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    const currentTerminals = Array.isArray(session?.terminals) && session.terminals.length > 0
      ? session.terminals
      : (session ? [{ id: session.id, label: `${t('终端')}1` }] : []);
    const targetTerminal = currentTerminals.find((item) => item.id === terminalId);
    if (!session || !targetTerminal) {
      return;
    }
    const currentLabel = String(targetTerminal.label || '').trim() || t('终端');
    const nextLabel = await window.luminDialog?.prompt(`${t('标签标题')}: ${currentLabel}`);
    if (nextLabel === null || nextLabel === undefined) {
      return;
    }
    const trimmedLabel = String(nextLabel).trim();
    if (!trimmedLabel || trimmedLabel === currentLabel) {
      return;
    }
    const nextSessions = sessionsRef.current.map((item) => (
      item.id === sessionId
        ? {
          ...item,
          terminals: (Array.isArray(item.terminals) && item.terminals.length > 0 ? item.terminals : currentTerminals).map((term) => (
            term.id === terminalId
              ? { ...term, label: trimmedLabel }
              : term
          )),
        }
        : item
    ));
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    persistWorkspaceSnapshotRef.current({
      sessions: nextSessions,
      activeSessionId: activeSessionIdRef.current,
      activeTerminalId: activeTerminalIdRef.current,
      terminalPaneLayouts: terminalPaneLayoutsRef.current,
    });
  }, [t]);

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
    const disconnectPromise = disconnectSessionTerminals([terminalId]);
    if (remaining.length === 0 && session?.serverId) {
      registerServerDisconnect(session.serverId, disconnectPromise);
    }

    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        if (remaining.length === 0) return null;
        return { ...s, terminals: remaining };
      }).filter(Boolean);
      if (next.length === 0) {
        window?.go?.main?.App?.ClearWorkspaceState?.().catch(() => { });
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
  }, [disconnectSessionTerminals, persistServerWorkspaceSessionSnapshot, registerServerDisconnect, resolveSessionRootTerminalId, switchToNextSession]);


  return { handleConnectError, postConnectSetup, loadServers, handleCancelConnection, resolveSessionContentTab, switchToNextSession, handleTabClick, canCopySessionPassword, handleCopySessionPassword, reconnectSession, resolveHostKeyChoice, resolvePasswordPrompt, handleCloseWindow, connectServer, connectLocal, connectSerial, forceCloseSession, closeSession, closeAllSessions, openNewTerminal, handleRenameTerminalTab, closeTerminal };
}
