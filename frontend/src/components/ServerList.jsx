import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from '../i18n.js';
import { Monitor, Pencil, Link, Trash2 } from 'lucide-react';

const MENU_VIEWPORT_GAP = 12;
const MENU_ESTIMATED_WIDTH = 196;
const MENU_ESTIMATED_HEIGHT = 132;

const clampMenuPosition = (x, y, width = MENU_ESTIMATED_WIDTH, height = MENU_ESTIMATED_HEIGHT) => ({
  x: Math.max(MENU_VIEWPORT_GAP, Math.min(x, window.innerWidth - width - MENU_VIEWPORT_GAP)),
  y: Math.max(MENU_VIEWPORT_GAP, Math.min(y, window.innerHeight - height - MENU_VIEWPORT_GAP)),
});

const LATENCY_CLASS = (ms) => {
  if (ms === null || ms === undefined) return 'offline';
  if (ms < 0) return 'good';     // -1 = <1ms (proxy/local)
  if (ms <= 300) return 'good';  // 0-300ms 绿色
  if (ms <= 400) return 'warn';  // 301-400ms 黄色
  return 'bad';                  // >400ms 红色
};

const UbuntuIcon = () => <svg viewBox="0 0 512 512" fill="currentColor" width="22" height="22"><path d="M112 256a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zm-8.4-56a96.2 96.2 0 0 1 20.3-25A192.1 192.1 0 0 1 319.4 47.9c12.3-21 34.3-32.9 57.5-31.9 22.1 1 42.6 12 55.4 31a48 48 0 1 0 -13 65.2A144.1 144.1 0 0 0 255.9 208a144 144 0 0 0 -152.3-8zm0 112A144 144 0 0 0 256 304a144 144 0 0 0 163.5 191.7 48 48 0 1 0 13-65.2A192.1 192.1 0 0 1 123.9 337a96 96 0 0 1 -20.3-25z" /></svg>;
const DebianIcon = () => <svg viewBox="0 0 512 512" fill="currentColor" width="22" height="22"><path d="M381.7 392.2c25.4-23 37.3-51.2 36.3-80.4-1.2-32.9-18.6-64.8-49-89.8-31-25.5-68-38.3-108.3-38.2-38 .1-72 13-102.2 38.3-31 26-47 57-46 92.1 1 34 16 64 45.4 86 28 20.8 62 33 93 30.6 30.8-2 57-14.7 75-35.3 14-16.1 22.7-34.6 24.3-55.5 1.5-19.8-4.7-36.5-16.5-50.5-11-13-25-21-42-23.7-16.3-2.6-32.5-.5-45.7 8-12.8 8.1-22 19.3-26.6 33.5-4 13-3 26 5 38 7 11 17 19 32 23 15 4 30 2 45-6 4-2 7.7-4.6 11-7.8 2.6-2.5 6.3-3 9.4-1 3.2 2 4 6 1.8 9.3-4 4.3-9 8-14 11.2-18 10-38 12.3-58 8-19.4-4.3-34-14.5-43.2-30.2-9-15.4-10-33.6-5.2-50.7 5.6-19.8 18-36 36-47.5 18-11.4 39.8-14.3 61.8-10.7 22 3.6 40 14 55 31.8 14 17.6 21 38 19 61.3-2.3 25-13.2 47.7-30.8 68-17.7 20.2-40 33-66.2 37.5-27 4.5-54 1.7-80-10-25-11-46-28-60-50-13-21.5-20-46-20-72 0-27 8-52.6 22.3-75.3 14-22 33-39 56-51 22-11.4 46-17 71-16.3 24 .5 47 7.7 68 20 20 12 37 27 49 46 11 18.5 17 39 17 60 0 21-5 41-14 59.4-8 17-20 32-34 44L381.7 392.2z" /></svg>;
const CentosIcon = () => <svg viewBox="0 0 512 512" fill="currentColor" width="22" height="22"><path d="M512 256C512 114.6 397.4 0 256 0S0 114.6 0 256s114.6 256 256 256 256-114.6 256-256zM226.7 137.9c13.7-18.7 34.2-29.6 56.4-29.6s42.7 10.9 56.4 29.6l24.4 33.3-37.4 27.5-24.4-33.3c-4.4-6-11-9.5-19-9.5s-14.6 3.5-19 9.5l-24.4 33.3-37.4-27.5 24.4-33.3zm-88.8 88.8c-18.7-13.7-29.6-34.2-29.6-56.4s10.9-42.7 29.6-56.4l33.3-24.4 27.5 37.4-33.3 24.4c-6 4.4-9.5 11-9.5 19s3.5 14.6 9.5 19l33.3 24.4-27.5 37.4-33.3-24.4zm236.2 147.4c-13.7 18.7-34.2 29.6-56.4 29.6s-42.7-10.9-56.4-29.6l-24.4-33.3 37.4-27.5 24.4 33.3c4.4 6 11 9.5 19 9.5s14.6-3.5 19-9.5l24.4-33.3 37.4 27.5-24.4 33.3zm88.8-88.8c18.7 13.7 29.6 34.2 29.6 56.4s-10.9 42.7-29.6 56.4l-33.3 24.4-27.5-37.4 33.3-24.4c6-4.4 9.5-11 9.5-19s-3.5-14.6-9.5-19l-33.3-24.4 27.5-37.4 33.3 24.4zM256 182.9c40.4 0 73.1 32.8 73.1 73.1s-32.8 73.1-73.1 73.1-73.1-32.8-73.1-73.1 32.8-73.1 73.1-73.1z"/></svg>;
const WinIcon = () => <svg viewBox="0 0 512 512" fill="currentColor" width="22" height="22"><path d="M0 256L0 86.6 200 58l0 198L0 256zM240 52.2L512 12.5l0 243.5-272 0L240 52.2zM512 288l0 243.5L240 491.8l0-203.8 272 0zM200 486L0 457.4l0-169.4 200 0L200 486z"/></svg>;
const AppleIcon = () => <svg viewBox="0 0 384 512" fill="currentColor" width="18" height="22"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 24 184.8 8.8 245.8c-29.3 118 16.4 233.1 82.5 233.1 21.6 0 39.8-14.1 63.3-14.1 23.5 0 40.8 14.1 64.3 14.1 67.1 0 106.1-105.8 82.5-188.7-22-12-32.8-31.5-32.8-57.8V268.7zM240.5 86.8c18.8-24 33.3-51.2 30-79.3-25.8 2.3-54 16.4-71.8 37.1-17.4 20.2-31.5 48.4-27.7 75.6 27.2 2.3 52.6-11.3 69.5-33.4z"/></svg>;
const LinuxIcon = () => <svg viewBox="0 0 448 512" fill="currentColor" width="22" height="22"><path d="M220.8 123.3c1 .5 1.8 1.7 3 1.7 1.1 0 2.8-.4 2.9-1.5.2-1.4-1.9-2.3-3.2-2.9-1.7-.7-3.9-1-5.5-.1-.4.2-.8.7-.6 1.1.3 1.3 2.3 1.1 3.4 1.7zm-27.4 32.2c-.4.6.3 1.3.8 1.3 1.7 0 2.9-2.5 1.7-3.8-.4-.3-1.6-.2-1.9.4-.3.6-.5 1.6-.6 2.1zm84.4-14.6c1.1.2 2.1 1.7 2.1 2.8 0 1.2-1 2.1-2.2 2.1-1.3 0-2.3-1-2.3-2.3 0-1.2.9-2.4 2.4-2.6zm60.1-22c1.7-1 4.5 1 4 2.8-.2.9-1.2 1.5-2 1.9-1.3.6-2.9.8-4.2.1-.5-.3-1-1-.8-1.5.3-1.2 1.4-2.3 3-3.3zm-39.7 18.2c-.3-.2-1-.2-1.3.1-.3.3-.4 1-.1 1.3.2.3 1 .2 1.3-.1.3-.3.4-1 .1-1.3zm36.9-39.1c.4-.2 1.1 0 1.3.4.2.4 0 1.1-.4 1.3-.4.2-1.1 0-1.3-.4-.2-.4 0-1.1.4-1.3zm-4.7 11.2c.4-.2 1.1 0 1.3.4.2.4 0 1.1-.4 1.3-.4.2-1.1 0-1.3-.4-.2-.4 0-1.1.4-1.3zm5.7-22c.4-.2 1.1 0 1.3.4.2.4 0 1.1-.4 1.3-.4.2-1.1 0-1.3-.4-.2-.4 0-1.1.4-1.3zm1.1 41.5c.3-.3 1-.2 1.3.1.3.3.2 1-.1 1.3-.3.3-1 .2-1.3-.1-.3-.2-.2-.9.1-1.3zm-5.6-11.8c.4-.2 1.1 0 1.3.4.2.4 0 1.1-.4 1.3-.4.2-1.1 0-1.3-.4-.2-.4 0-1.1.4-1.3zm19.3-5.2c.4-.2 1.1 0 1.3.4.2.4 0 1.1-.4 1.3-.4.2-1.1 0-1.3-.4-.2-.4 0-1.1.4-1.3zM448 358.4c0 84.8-100.3 153.6-224 153.6S0 443.2 0 358.4c0-78.6 85.8-143.6 195.9-152.1 4.5-23 15.6-43.1 31.7-57.9 11.1-10.2 24.3-17.6 38.6-21.7-8.1-10.6-16.7-21.6-18.1-23.7-5.9-8.7-2.6-20.9 7.1-25.5 12.3-5.9 27-6.2 39.4-1 12.6 5.3 22 15.6 26.6 28.5 2.1 5.9 1 12.6-3.1 17.5-6.1 7.2-18 20.3-25.2 28.8 33 13.5 56.4 39.6 62.7 71.4 50 16 87.4 51.6 87.4 93.6zM224 464c88.4 0 160-35.8 160-80s-71.6-80-160-80-160 35.8-160 80 71.6 80 160 80z"/></svg>;

// 检测OS，支持静态名称匹配和动态 osInfo 对象
const getOSInfo = (name = '', os = '', osInfo = null) => {
  // 优先用连接后实际查询到的系统信息
  const dynStr = (osInfo?.os || osInfo?.platform || '').toLowerCase();
  const n = dynStr || (name + ' ' + (os || '')).toLowerCase();
  if (n.includes('ubuntu'))  return { icon: <UbuntuIcon />, bg: '#e95420', label: 'Ubuntu' };
  if (n.includes('debian'))  return { icon: <DebianIcon />, bg: '#d70a53', label: 'Debian' };
  if (n.includes('centos'))  return { icon: <CentosIcon />, bg: '#262577', label: 'CentOS' };
  if (n.includes('fedora'))  return { icon: <LinuxIcon />, bg: '#294172', label: 'Fedora' };
  if (n.includes('arch'))    return { icon: <LinuxIcon />, bg: '#1793d1', label: 'Arch' };
  if (n.includes('alpine'))  return { icon: <LinuxIcon />, bg: '#0d597f', label: 'Alpine' };
  if (n.includes('windows')) return { icon: <WinIcon />, bg: '#0078d4', label: 'Windows' };
  if (n.includes('mac') || n.includes('darwin')) return { icon: <AppleIcon />, bg: '#555', label: 'macOS' };
  if (n.includes('prod') || n.includes('生产'))  return { icon: <LinuxIcon />, bg: '#059669', label: 'Prod' };
  if (n.includes('dev') || n.includes('开发'))   return { icon: <LinuxIcon />, bg: '#7c3aed', label: 'Dev' };
  if (n.includes('test') || n.includes('测试'))  return { icon: <LinuxIcon />, bg: '#dc2626', label: 'Test' };
  if (n.includes('db') || n.includes('数据'))    return { icon: <LinuxIcon />, bg: '#b45309', label: 'DB' };
  if (n.includes('web') || n.includes('nginx'))  return { icon: <LinuxIcon />, bg: '#0891b2', label: 'Web' };
  return { icon: <LinuxIcon />, bg: 'var(--bg-3)', label: 'Linux' };
};

export default function ServerList({
  servers,
  pings,
  sessions,
  activeSessionId,
  viewMode = 'grid',
  hideSensitive = false,
  onConnect,
  onEdit,
  onDelete,
}) {
  const { t } = useTranslation();
  const [menuServer, setMenuServer] = useState(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState(null);
  const menuRef = useRef(null);

  // 预计算已连接会话的 Map，将 O(n×m) 查找优化为 O(1)
  const connectedSessionMap = useMemo(() => {
    const m = new Map();
    sessions.forEach(s => {
      if (s.status === 'connected') m.set(s.serverId, s);
    });
    return m;
  }, [sessions]);

  const mask = (text) => hideSensitive ? String(text || '').replace(/[^@.:\/\s-]/g, '*') : text;

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuServer(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!menuServer || !menuRef.current) return;

    const { offsetWidth, offsetHeight } = menuRef.current;
    setMenuPos((prev) => {
      const next = clampMenuPosition(prev.x, prev.y, offsetWidth, offsetHeight);
      if (next.x === prev.x && next.y === prev.y) return prev;
      return next;
    });
  }, [menuServer]);

  const handleContextMenu = (e, server) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuServer(server);
    setMenuPos(clampMenuPosition(e.clientX, e.clientY));
  };

  const isActive = (server) => {
    const session = sessions.find(
      (s) => s.serverId === server.id && s.status !== 'closed'
    );
    return session && session.id === activeSessionId;
  };

  const hasSession = (server) =>
    sessions.some((s) => s.serverId === server.id && s.status !== 'closed');

  if (servers.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 20 }}>
        <div className="empty-state-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Monitor size={48} strokeWidth={1.5} /></div>
        <div className="empty-state-text">
          {t('暂无服务器')}
          <br />
          {t('点击右上角「添加」开始')}
        </div>
      </div>
    );
  }

  return (
    <>
      {viewMode === 'grid' ? (
      <div className="server-grid">
        {servers.map((server) => {
          const ping = pings[server.id];
          const latClass = ping ? LATENCY_CLASS(ping.latency) : 'offline';
          const active = isActive(server);
          const connected = hasSession(server);
          // 优先用实际查询到的 osInfo
          const sessionForServer = connectedSessionMap.get(server.id);
          const osInfo = getOSInfo(server.name, server.os, sessionForServer?.osInfo || null);
          const isHovered = hoveredId === server.id;

          return (
            <div
              key={server.id}
              className={`server-card ${active ? 'active' : ''}`}
              onClick={() => onConnect(server)}
              onContextMenu={(e) => handleContextMenu(e, server)}
              onMouseEnter={() => setHoveredId(server.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={`${server.username}@${server.host}:${server.port || 22}`}
              style={{
                margin: 0,
                // 亚克力效果
                background: active
                  ? 'rgba(16, 185, 129, 0.12)'
                  : isHovered
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: active
                  ? '1px solid rgba(16,185,129,0.4)'
                  : '1px solid rgba(255,255,255,0.08)',
                transition: 'all 0.18s ease',
                boxShadow: active
                  ? '0 4px 20px rgba(16,185,129,0.15)'
                  : isHovered
                  ? '0 4px 16px rgba(0,0,0,0.25)'
                  : '0 2px 8px rgba(0,0,0,0.15)',
              }}
            >
              {/* OS 系统图标 */}
              <div style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: osInfo.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
                boxShadow: `0 4px 12px ${osInfo.bg}55`,
              }}>
                {osInfo.icon}
              </div>

              <div className="server-info" style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <div className="server-name" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {server.name || server.host}
                  </span>
                  {connected && (
                    <span style={{ fontSize: 8, color: 'var(--green)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                      ● CONN
                    </span>
                  )}
                </div>
                <div className="server-host" style={{ color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hideSensitive ? mask(`${server.username}@${server.host}`) : `${server.username}@${server.host}:${server.port || 22}`}
                </div>
              </div>

              {/* 右侧：延迟 + 编辑按钮 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {ping?.online && ping?.latency !== undefined && ping?.latency !== null ? (
                  <>
                    <span style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: latClass === 'good' ? '#4ade80'
                           : latClass === 'warn' ? '#facc15'
                           : '#f87171',
                    }}>
                      {ping.latency === -1 ? '<1ms' : `${ping.latency}ms`}
                    </span>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: latClass === 'good' ? '#4ade80'
                                : latClass === 'warn' ? '#facc15'
                                : '#f87171',
                      boxShadow: latClass === 'good' ? '0 0 8px #4ade80'
                               : latClass === 'warn' ? '0 0 8px #facc15'
                               : '0 0 8px #f87171',
                    }} />
                  </>
                ) : (
                  ping !== undefined && !ping?.online ? (
                    <span style={{ fontSize: 14, color: '#f87171', fontWeight: 'bold', lineHeight: 1 }} title={t('服务器离线或不可达')}>✕</span>
                  ) : null
                )}

                {/* 编辑按钮 */}
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(server); }}
                  title={t('编辑服务器')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 6,
                    color: isHovered ? 'var(--text-2)' : 'var(--text-4)',
                    fontSize: 14,
                    opacity: isHovered ? 1 : 0,
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      ) : (
      <div className="server-table-container">
        <table className="server-table">
          <thead>
            <tr>
              <th>{t('系统')}</th>
              <th>{t('别名')}</th>
              <th>{t('主机地址')}</th>
              <th>{t('用户名')}</th>
              <th>{t('状态')}</th>
              <th>{t('操作')}</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => {
              const ping = pings[server.id];
              const latClass = ping ? LATENCY_CLASS(ping.latency) : 'offline';
              const active = isActive(server);
              const connected = hasSession(server);
              const sessionForServer = connectedSessionMap.get(server.id);
              const osInfo = getOSInfo(server.name, server.os, sessionForServer?.osInfo || null);
              const isHovered = hoveredId === server.id;

              return (
                <tr
                  key={server.id}
                  className={`server-table-row ${active ? 'active' : ''}`}
                  onClick={() => onConnect(server)}
                  onContextMenu={(e) => handleContextMenu(e, server)}
                  onMouseEnter={() => setHoveredId(server.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 20, height: 20, color: osInfo.bg }}>{osInfo.icon}</div>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{osInfo.label}</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 500, color: 'var(--text-1)' }}>
                    {server.name || server.host}
                    {connected && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--green)', padding: '2px 4px', background: 'rgba(34,197,94,0.1)', borderRadius: 4 }}>CONN</span>}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-2)' }}>
                    {hideSensitive ? mask(server.host) : `${server.host}:${server.port || 22}`}
                  </td>
                  <td style={{ color: 'var(--text-2)' }}>{hideSensitive ? mask(server.username) : server.username}</td>
                  <td>
                    {ping?.online && ping?.latency !== undefined && ping?.latency !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: latClass === 'good' ? '#4ade80' : latClass === 'warn' ? '#facc15' : '#f87171'
                        }} />
                        <span style={{ fontSize: 12, color: latClass === 'good' ? '#4ade80' : latClass === 'warn' ? '#facc15' : '#f87171', fontFamily: 'var(--font-mono)' }}>
                          {ping.latency === -1 ? '<1ms' : `${ping.latency}ms`}
                        </span>
                      </div>
                    ) : (
                      ping !== undefined && !ping?.online ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f87171' }}>
                          <span style={{ fontSize: 14, fontWeight: 'bold' }}>✕</span>
                          <span style={{ fontSize: 12 }}>Offline</span>
                        </div>
                      ) : <span style={{ color: 'var(--text-4)' }}>-</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(server); }}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                    >
                      {t('编辑')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Context Menu */}
      {menuServer && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <div
            className="context-menu-item"
            onClick={() => { onConnect(menuServer); setMenuServer(null); }}
          >
            <Link size={14} style={{ marginRight: 8 }} /> {t('连接')}
          </div>
          <div
            className="context-menu-item"
            onClick={() => { onEdit(menuServer); setMenuServer(null); }}
          >
            <Pencil size={14} style={{ marginRight: 8 }} /> {t('编辑配置')}
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item danger"
            onClick={async () => {
              if (await window.luminDialog?.confirm(`${t('确定删除服务器')}「${menuServer.name || menuServer.host}」？`)) {
                onDelete(menuServer.id);
              }
              setMenuServer(null);
            }}
          >
            <Trash2 size={14} style={{ marginRight: 8 }} /> {t('删除')}
          </div>
        </div>
      )}
    </>
  );
}
