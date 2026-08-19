import { BarChart3, Monitor, Search, LayoutGrid, List, Eye, EyeOff, RefreshCw, Database, CheckSquare, Folder, FolderOpen, Download, Trash2, X, Plus, History, Clock, Terminal } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from '../i18n.ts';
import AddServerModal from './AddServerModal.tsx';
import ServerList from './ServerList.tsx';
import Tiptop from './Tiptop.tsx';
import type { config } from '../../wailsjs/go/models.ts';
import type { PingCounts, ServerPingResult } from '../hooks/useServerPing.ts';
import type { DashboardHostPageMode, ServerListViewMode } from '../hooks/useDashboardPreferences.ts';
import type { ServerFormData } from '../hooks/useServerCatalog.ts';
import type { SessionLike } from '../utils/sessionWorkspace.ts';

/** 最近连接会话（宽松形状，来自 useSessionConnections） */
interface DashboardSessionLike {
  id?: string;
  serverId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface DashboardProps {
  editorServer: (config.Connection & { authType?: string }) | null;
  editorShiningFields?: Record<string, unknown>;
  saveFlowHighlights: { serverId: string | null; rowPulse: unknown; fields: Record<string, unknown> };
  isEditFlying?: boolean;
  onSaveServer: (data: ServerFormData, shouldClearAfterAdd?: boolean) => Promise<config.Connection | null>;
  onSaveAndConnectServer?: (data: ServerFormData, shouldClearAfterAdd?: boolean) => Promise<config.Connection | null>;
  onCancelEditor: () => void;
  allGroups: string[];
  credentials: config.Credential[];
  onOpenCredentials: () => void;
  searchQuery: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hideSensitive: boolean;
  onHideSensitiveToggle: () => void;
  serverListViewMode: ServerListViewMode;
  onViewModeChange: (mode: ServerListViewMode) => void;
  servers: config.Connection[];
  pingEnabled: boolean;
  pingCounts: PingCounts;
  isRefreshingPing: boolean;
  onRefreshPing: () => void;
  filteredServers: config.Connection[];
  pings: Record<string, ServerPingResult>;
  sessions: DashboardSessionLike[];
  activeSessionId: string | null;
  recentConnectionIds?: string[];
  hostPageMode: DashboardHostPageMode;
  onHostPageModeChange?: (mode: DashboardHostPageMode) => void;
  onClearRecentConnections?: () => void;
  onRemoveRecentConnection?: (id: string) => void;
  onConnect: (server: config.Connection) => void;
  onStartAdd: () => void;
  onEdit: (server: config.Connection, payload: unknown) => void;
  onClone: (server: config.Connection, payload: unknown) => void;
  onDelete: (id: string) => void;
  onMoveGroup: (id: string, group: string) => void;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  onOpenImportExport: () => void;
  selectionMode?: boolean;
  selectedIds?: string[];
  onSelectChange: (payload: string | string[] | Array<{ id: string; selected: boolean }>) => void;
  onBatchDelete?: (ids: string[]) => void;
  onBatchConnect?: (ids: string[]) => void;
  onBatchMoveGroup?: (ids: string[], group: string) => void;
  onGroupDelete: (groupName: string, ids: string[]) => void;
  onRenameGroup: (oldName: string) => string | null | Promise<string | null>;
  onSelectionModeToggle: () => void;
  onBatchExport?: (ids: string[]) => void;
  onExitSelectionMode?: () => void;
  onConnectLocal?: (name: string, shellPath: string) => void;
  onConnectSerial?: (config: { port: string; baudRate: number; dataBits: number; stopBits: number; parity: string }) => void;
  setShowSerialModal?: (v: boolean) => void;
}

export default function Dashboard({
  editorServer, editorShiningFields, saveFlowHighlights, isEditFlying = false, onSaveServer, onSaveAndConnectServer, onCancelEditor, allGroups,
  credentials, onOpenCredentials,
  searchQuery, onSearchChange,
  hideSensitive, onHideSensitiveToggle,
  serverListViewMode, onViewModeChange,
  servers, pingEnabled, pingCounts, isRefreshingPing, onRefreshPing,
  filteredServers, pings, sessions, activeSessionId,
  recentConnectionIds = [],
  hostPageMode: hostPageModeProp,
  onHostPageModeChange,
  onClearRecentConnections,
  onRemoveRecentConnection,
  onConnect, onStartAdd, onEdit, onClone, onDelete, onMoveGroup, addToast,
  onOpenImportExport,
  selectionMode = false,
  selectedIds = [],
  onSelectChange,
  onBatchDelete,
  onBatchConnect,
  onBatchMoveGroup,
  onGroupDelete,
  onRenameGroup,
  onSelectionModeToggle,
  onBatchExport,
  onExitSelectionMode,
  onConnectLocal,
  onConnectSerial,
  setShowSerialModal,
}: DashboardProps) {
  const { t } = useTranslation();

  const [showMoveGroupDropdown, setShowMoveGroupDropdown] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const [localShells, setLocalShells] = useState<string[]>([]);
  // 'hosts' | 'recent' — 由 App 持有，便于主页 ping 仅在 hosts 时运行
  const hostPageMode = hostPageModeProp === 'recent' ? 'recent' : 'hosts';
  const moveGroupMenuRef = useRef<HTMLDivElement | null>(null);
  const localMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.go?.wailsapp?.App?.GetLocalShells?.()
      .then((list) => {
        setLocalShells(list || []);
      })
      .catch((err) => {
        console.error('Failed to load local shells:', err);
      });
  }, []);

  const switchHostPageMode = (mode: string) => {
    onHostPageModeChange?.(mode === 'recent' ? 'recent' : 'hosts');
  };

  const recentServers = useMemo(() => {
    if (!Array.isArray(recentConnectionIds) || recentConnectionIds.length === 0) return [] as config.Connection[];
    const byId = new Map(servers.map((s) => [s.id, s]));
    return recentConnectionIds.map((id) => byId.get(id)).filter((server): server is config.Connection => !!server);
  }, [recentConnectionIds, servers]);

  const filteredRecentServers = useMemo(() => {
    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) return recentServers;
    return recentServers.filter((server) => {
      const haystack = [
        server.name,
        server.host,
        server.username,
        server.group,
        String(server.port || ''),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [recentServers, searchQuery]);

  const mask = (value: string) => {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 2) return '*'.repeat(text.length);
    return `${text.slice(0, 1)}${'*'.repeat(Math.min(text.length - 2, 8))}${text.slice(-1)}`;
  };

  const handleClearRecent = async () => {
    if (!recentServers.length) return;
    const ok = await window.luminDialog?.confirm?.(t('确定清空最近连接列表吗？'), t('操作确认'));
    if (!ok) return;
    onClearRecentConnections?.();
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moveGroupMenuRef.current && !moveGroupMenuRef.current.contains(event.target as Node)) {
        setShowMoveGroupDropdown(false);
      }
      if (localMenuRef.current && !localMenuRef.current.contains(event.target as Node)) {
        setLocalMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const existingGroups = useMemo(() => {
    const groups = new Set<string>();
    servers.forEach(s => {
      if (s.group) groups.add(s.group);
    });
    return Array.from(groups).sort();
  }, [servers]);

  const filteredGroups = useMemo(() => {
    const query = groupSearchQuery.trim().toLowerCase();
    if (!query) return existingGroups;
    return existingGroups.filter(g => g.toLowerCase().includes(query));
  }, [existingGroups, groupSearchQuery]);

  const visibleGroupNames = useMemo(() => {
    const groups = new Set<string>();
    filteredServers.forEach(s => groups.add(s.group || ''));
    return Array.from(groups);
  }, [filteredServers]);
  const hasVisibleGroupHeaders = visibleGroupNames.length > 1 || (visibleGroupNames.length === 1 && visibleGroupNames[0] !== '');

  const allCollapsed = useMemo(() => {
    if (visibleGroupNames.length === 0) return false;
    return visibleGroupNames.every(name => collapsedGroups.has(name));
  }, [visibleGroupNames, collapsedGroups]);

  return (
    <div className="dashboard-container">
      <div className="dashboard-left">
        <AddServerModal
          inline
          server={editorServer}
          shiningFields={editorShiningFields}
          onSave={onSaveServer}
          onSaveAndConnect={onSaveAndConnectServer}
          onClose={onCancelEditor}
          allGroups={allGroups}
          credentials={credentials}
          onOpenCredentials={onOpenCredentials}
        />

        <div className="glass-card status-overview-box">
          <div className="card-header-icon-title">
            <span className="card-header-icon"><BarChart3 size={18} /></span>
            <span className="card-header-title">{t('系统状态')}</span>
            {pingEnabled && (
              <Tiptop text={t('刷新延迟')} placement="bottom">
                <button className={`btn-icon-spin ${isRefreshingPing ? 'spinning' : ''}`} onClick={onRefreshPing} aria-label={t('刷新延迟')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, display: "flex", alignItems: "center" }}><RefreshCw size={14} /></button>
              </Tiptop>
            )}
          </div>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-val">{servers.length}</div>
              <div className="stat-lbl">{t('服务器总数')}</div>
            </div>
            <div className="stat-item">
              <div className="stat-val" style={{ color: 'var(--success)' }}>{pingEnabled ? pingCounts.online : '—'}</div>
              <div className="stat-lbl">{t('在线节点')}</div>
            </div>
            <div className="stat-item">
              <div className="stat-val" style={{ color: 'var(--danger)' }}>{pingEnabled ? pingCounts.offline : '—'}</div>
              <div className="stat-lbl">{t('离线节点')}</div>
            </div>
          </div>
        </div>

      </div>

      {/* 右半栏：主机目录 / 最近连接 */}
      <div className="dashboard-right">
        <div className="hosts-section-container">
          <div className="section-title-container">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 0 280px', minWidth: 'min(100%, 280px)', maxWidth: '100%' }}>
              {/* 主机 / 最近连接 切换 */}
              <div className="segment-control dashboard-page-switch">
                <Tiptop text={t('主机')} placement="bottom">
                  <button
                    type="button"
                    onClick={() => switchHostPageMode('hosts')}
                    aria-label={t('主机')}
                    aria-pressed={hostPageMode === 'hosts'}
                    className={hostPageMode === 'hosts' ? 'active' : ''}
                  >
                    <Monitor size={13} />
                    <span>{t('主机')}</span>
                  </button>
                </Tiptop>
                <div className="segment-control-divider" />
                <Tiptop text={t('最近连接')} placement="bottom">
                  <button
                    type="button"
                    onClick={() => switchHostPageMode('recent')}
                    aria-label={t('最近连接')}
                    aria-pressed={hostPageMode === 'recent'}
                    className={hostPageMode === 'recent' ? 'active' : ''}
                  >
                    <History size={13} />
                    <span>{t('最近连接')}</span>
                    {recentServers.length > 0 && (
                      <span className="dashboard-page-switch-count">{recentServers.length}</span>
                    )}
                  </button>
                </Tiptop>
              </div>
              <div style={{ position: 'relative', flex: '1 1 100px', maxWidth: 300, minWidth: 80 }}>
                <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
                <input
                  id="server-search"
                  name="serverSearch"
                  type="search"
                  autoComplete="off"
                  aria-label={t('搜索服务器...')}
                  className="input-compact"
                  placeholder={t('搜索服务器...')}
                  value={searchQuery}
                  onChange={onSearchChange}
                  style={{ width: '100%', paddingLeft: 26, height: 28, fontSize: 12, borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: '0 0 auto', marginLeft: 'auto' }}>
              {/* 本地连接 / 串口 快速连接下拉菜单 */}
              <div ref={localMenuRef} style={{ position: 'relative' }}>
                <Tiptop text={t('本地终端 & 串口')} placement="bottom">
                  <button
                    className={`btn btn-ghost btn-icon${localMenuOpen ? ' active' : ''}`}
                    onClick={() => setLocalMenuOpen(prev => !prev)}
                    aria-label={t('本地连接')}
                    aria-pressed={localMenuOpen}
                  >
                    <Terminal size={14} />
                  </button>
                </Tiptop>
                {localMenuOpen && (
                  <div
                    className="context-menu"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: 4,
                      zIndex: 1000,
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 200,
                      padding: '6px 8px',
                    }}
                  >
                    <div style={{ padding: '2px 4px 6px 4px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                      {t('选择本地终端或串口')}
                    </div>
                    {localShells.map((sh) => {
                      const displayName = sh.startsWith('wsl://') 
                        ? `WSL - ${sh.slice(6)}` 
                        : sh === 'powershell.exe' 
                        ? 'Windows PowerShell' 
                        : sh === 'pwsh.exe' || sh.endsWith('pwsh.exe')
                        ? 'PowerShell 7' 
                        : sh === 'cmd.exe' 
                        ? 'Command Prompt' 
                        : sh;
                      return (
                        <div
                          key={sh}
                          className="context-menu-item"
                          onClick={() => {
                            setLocalMenuOpen(false);
                            onConnectLocal?.(displayName, sh);
                          }}
                        >
                          {displayName}
                        </div>
                      );
                    })}
                    <div className="context-menu-divider" style={{ margin: '4px 0' }} />
                    <div
                      className="context-menu-item"
                      onClick={() => {
                        setLocalMenuOpen(false);
                        setShowSerialModal?.(true);
                      }}
                    >
                      {t('串口终端...')}
                    </div>
                  </div>
                )}
              </div>

              {hostPageMode === 'hosts' ? (
                <>
                  {/* 选择模式开关 */}
                  <Tiptop text={selectionMode ? t('退出选择') : t('选择模式')} placement="bottom">
                    <button
                      className={`btn btn-ghost btn-icon${selectionMode ? ' active' : ''}`}
                      onClick={onSelectionModeToggle}
                      aria-label={selectionMode ? t('退出选择') : t('选择模式')}
                      aria-pressed={selectionMode}
                    >
                      <CheckSquare size={14} />
                    </button>
                  </Tiptop>
                  {/* 视图切换 - 分段控件 */}
                  <div className="segment-control">
                    <Tiptop text={t('卡片视图')} placement="bottom">
                      <button
                        onClick={() => onViewModeChange('grid')}
                        aria-label={t('卡片视图')}
                        className={serverListViewMode === 'grid' ? 'active' : ''}
                      >
                        <LayoutGrid size={13} />
                      </button>
                    </Tiptop>
                    <div className="segment-control-divider" />
                    <Tiptop text={t('列表视图')} placement="bottom">
                      <button
                        onClick={() => onViewModeChange('table')}
                        aria-label={t('列表视图')}
                        className={serverListViewMode === 'table' ? 'active' : ''}
                      >
                        <List size={13} />
                      </button>
                    </Tiptop>
                  </div>
                  {/* 隐藏敏感信息 */}
                  <Tiptop text={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')} placement="bottom">
                    <button
                      className={`btn btn-ghost btn-icon${hideSensitive ? ' active' : ''}`}
                      onClick={onHideSensitiveToggle}
                      aria-label={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                      aria-pressed={hideSensitive}
                      style={hideSensitive ? { background: 'var(--warning-dim)', color: 'var(--warning)', borderColor: 'rgba(var(--warning-rgb), 0.35)' } : undefined}
                    >
                      {hideSensitive ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  </Tiptop>
                  {hasVisibleGroupHeaders && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        if (allCollapsed) {
                          setCollapsedGroups(new Set());
                        } else {
                          setCollapsedGroups(new Set(visibleGroupNames));
                        }
                      }}
                      style={{
                        height: 28,
                        padding: '0 8px',
                        fontSize: 12,
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-overlay)',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {allCollapsed ? <Folder size={13} /> : <FolderOpen size={13} />}
                      <span>{allCollapsed ? t('打开分组') : t('收起分组')}</span>
                    </button>
                  )}
                  {/* 数据管理（导入/导出） */}
                  <Tiptop text={t('数据管理')} placement="bottom">
                    <button
                      className="btn btn-ghost"
                      onClick={onOpenImportExport}
                      aria-label={t('数据管理')}
                      style={{
                        height: 28,
                        padding: '0 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-overlay)',
                        color: 'var(--text-secondary)',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      <Database size={13} />
                      <span style={{ fontSize: 12 }}>{t('数据管理')}</span>
                    </button>
                  </Tiptop>
                </>
              ) : (
                <>
                  <Tiptop text={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')} placement="bottom">
                    <button
                      className={`btn btn-ghost btn-icon${hideSensitive ? ' active' : ''}`}
                      onClick={onHideSensitiveToggle}
                      aria-label={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                      aria-pressed={hideSensitive}
                      style={hideSensitive ? { background: 'var(--warning-dim)', color: 'var(--warning)', borderColor: 'rgba(var(--warning-rgb), 0.35)' } : undefined}
                    >
                      {hideSensitive ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  </Tiptop>
                  <Tiptop text={t('清空')} placement="bottom">
                    <button
                      className="btn btn-ghost"
                      onClick={handleClearRecent}
                      disabled={recentServers.length === 0}
                      aria-label={t('清空最近连接')}
                      style={{
                        height: 28,
                        padding: '0 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-overlay)',
                        color: recentServers.length === 0 ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                        fontWeight: 500,
                        opacity: recentServers.length === 0 ? 0.55 : 1,
                        cursor: recentServers.length === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <Trash2 size={13} />
                      <span style={{ fontSize: 12 }}>{t('清空')}</span>
                    </button>
                  </Tiptop>
                </>
              )}
            </div>
          </div>

          {hostPageMode === 'hosts' ? (
          <div className={`hosts-scroll-area ${selectionMode ? 'batch-mode-active' : ''}`}>
            <ServerList
              servers={filteredServers}
              pingEnabled={pingEnabled}
              pings={pings}
              sessions={sessions}
              activeSessionId={activeSessionId}
              saveFlowHighlights={saveFlowHighlights}
              viewMode={serverListViewMode}
              hideSensitive={hideSensitive}
              onConnect={onConnect}
              onEdit={onEdit}
              onClone={onClone}
              onDelete={onDelete}
              onMoveGroup={onMoveGroup}
              addToast={addToast}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onSelectChange={onSelectChange}
              onBatchDelete={onBatchDelete}
              onBatchConnect={onBatchConnect}
              onBatchMoveGroup={onBatchMoveGroup}
              onGroupDelete={onGroupDelete}
              onRenameGroup={onRenameGroup}
              onBatchExport={onBatchExport}
              onExitSelectionMode={onExitSelectionMode}
              collapsedGroups={collapsedGroups}
              onCollapsedGroupsChange={setCollapsedGroups}
            />
          </div>
          ) : (
          <div className="hosts-scroll-area">
            {recentServers.length === 0 ? (
              <div className="empty-state" style={{ marginTop: '12vh' }}>
                <div className="empty-state-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Clock size={48} strokeWidth={1.5} />
                </div>
                <div className="empty-state-text">{t('暂无最近连接')}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {t('连接成功后会出现在这里，方便快速再连')}
                </div>
              </div>
            ) : filteredRecentServers.length === 0 ? (
              <div className="empty-state" style={{ marginTop: '12vh' }}>
                <div className="empty-state-text">{t('无匹配结果')}</div>
              </div>
            ) : (
              <div className="server-table-container">
                <table className="server-table">
                  <thead>
                    <tr>
                      <th style={{ width: 48 }}>#</th>
                      <th>{t('别名')}</th>
                      <th>{t('主机地址')}</th>
                      <th>{t('用户名')}</th>
                      <th>{t('分组')}</th>
                      <th style={{ width: 88 }}>{t('操作')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecentServers.map((server, index) => {
                      const connected = sessions?.some((s) => s.serverId === server.id && s.status === 'connected');
                      const active = sessions?.some((s) => s.serverId === server.id && s.id === activeSessionId);
                      const displayName = server.name || server.host;
                      const hostText = hideSensitive
                        ? mask(server.host)
                        : `${server.host}${server.port && server.port !== 22 ? `:${server.port}` : ''}`;
                      const userText = hideSensitive ? mask(server.username) : (server.username || '');
                      const groupText = server.group || t('未分组');
                      return (
                        <tr
                          key={server.id}
                          className={`server-table-row${active ? ' active' : ''}`}
                          onClick={() => onConnect?.(server)}
                        >
                          <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                            {index + 1}
                          </td>
                          <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {displayName}
                            </span>
                            {connected && (
                              <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--success)', padding: '2px 4px', background: 'var(--success-dim)', borderRadius: 4 }}>
                                {t('已连接')}
                              </span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>
                            {hostText}
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>{userText || '-'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                            {groupText}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm recent-remove-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveRecentConnection?.(server.id);
                              }}
                            >
                              <X size={12} />
                              {t('移除')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {/* Batch Operation Bar */}
          {hostPageMode === 'hosts' && selectionMode && onBatchDelete && (
            <div className="batch-operation-bar">
              <div className="selected-info">
                <span className="selected-count-badge">{selectedIds.length}</span>
                <span>{t('已选择服务器')}</span>
              </div>
              <div style={{ flex: 1 }} />
              
              <button
                onClick={() => {
                  const allSelected = servers.length > 0 && selectedIds.length === servers.length;
                  if (allSelected) {
                    onSelectChange([]);
                  } else {
                    onSelectChange(servers.map(s => s.id));
                  }
                }}
                className="btn-batch-action"
                disabled={servers.length === 0}
              >
                <CheckSquare size={14} />
                {servers.length > 0 && selectedIds.length === servers.length ? t('取消全选') : t('全选')}
              </button>

              <button
                onClick={() => {
                  if (selectedIds.length > 0) {
                    onSelectChange([]);
                  } else if (onExitSelectionMode) {
                    onExitSelectionMode();
                  }
                }}
                className="btn-cancel"
              >
                {selectedIds.length > 0 ? t('取消选择') : t('退出选择')}
              </button>

              {onBatchConnect && (
                <button
                  onClick={() => onBatchConnect(selectedIds)}
                  className="btn-batch-primary"
                  disabled={selectedIds.length === 0}
                >
                  <Monitor size={14} />
                  {t('批量链接')}
                </button>
              )}

              {onBatchMoveGroup && (
                <div ref={moveGroupMenuRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => {
                      setShowMoveGroupDropdown(prev => !prev);
                      setGroupSearchQuery('');
                    }}
                    className="btn-batch-action"
                    disabled={selectedIds.length === 0}
                  >
                    <Folder size={14} />
                    {t('移动分组')}
                  </button>
                  {showMoveGroupDropdown && selectedIds.length > 0 && (
                    <div
                      className="context-menu"
                      style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        marginBottom: 8,
                        zIndex: 110,
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 180,
                        padding: '6px 8px',
                      }}
                    >
                      <div style={{ padding: '2px 4px 6px 4px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                        {t('移动到分组')}
                      </div>
                      
                      {/* 搜索/新建输入框 */}
                      <div style={{ marginBottom: 6 }} onClick={(e) => e.stopPropagation()}>
                        <input
                          id="dashboard-group-search"
                          name="dashboard-group-search"
                          autoComplete="off"
                          type="text"
                          className="input-compact"
                          placeholder={t('搜索或输入新分组...')}
                          value={groupSearchQuery}
                          onChange={(e) => setGroupSearchQuery(e.target.value)}
                          autoFocus
                          style={{
                            width: '100%',
                            height: 26,
                            fontSize: 11,
                            padding: '0 6px',
                            borderRadius: 4,
                            border: '1px solid var(--border)',
                            background: 'var(--surface-sunken)',
                            color: 'var(--text-primary)',
                          }}
                        />
                      </div>

                      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {/* 如果输入的搜索词不为空，且不与任何现有分组完全相同，则允许快速创建新分组并移动 */}
                        {groupSearchQuery.trim() !== '' && !filteredGroups.includes(groupSearchQuery.trim()) && (
                          <div
                            className="context-menu-item"
                            style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}
                            onClick={() => {
                              onBatchMoveGroup(selectedIds, groupSearchQuery.trim());
                              setShowMoveGroupDropdown(false);
                              setGroupSearchQuery('');
                            }}
                          >
                            <Plus size={11} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t('新建并移动')}: "{groupSearchQuery.trim()}"
                            </span>
                          </div>
                        )}

                        {filteredGroups.map(g => (
                          <div
                            key={g}
                            className="context-menu-item"
                            onClick={() => {
                              onBatchMoveGroup(selectedIds, g);
                              setShowMoveGroupDropdown(false);
                              setGroupSearchQuery('');
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <Folder size={11} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g}</span>
                          </div>
                        ))}

                        {filteredGroups.length === 0 && groupSearchQuery.trim() === '' && (
                          <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                            {t('暂无分组')}
                          </div>
                        )}
                      </div>

                      <div className="context-menu-divider" style={{ margin: '4px 0' }} />
                      <div
                        className="context-menu-item"
                        onClick={() => {
                          onBatchMoveGroup(selectedIds, '');
                          setShowMoveGroupDropdown(false);
                          setGroupSearchQuery('');
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <X size={11} />
                        <span>{t('移出分组')}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {onBatchExport && (
                <button
                  onClick={() => onBatchExport(selectedIds)}
                  className="btn-batch-action"
                  disabled={selectedIds.length === 0}
                >
                  <Download size={14} />
                  {t('导出选择')}
                </button>
              )}

              <button
                onClick={async () => {
                  if (await window.luminDialog?.confirm(`${t('确定删除')} ${selectedIds.length} ${t('个服务器')}？`)) {
                    onBatchDelete(selectedIds);
                  }
                }}
                className="btn-delete-batch"
                disabled={selectedIds.length === 0}
              >
                <Trash2 size={14} />
                {t('批量删除')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
