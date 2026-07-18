import { BarChart3, Monitor, Search, LayoutGrid, List, Eye, EyeOff, RefreshCw, Database, CheckSquare, Folder, FolderOpen, Copy, Download, Trash2, X, Plus } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from '../i18n.js';
import AddServerModal from './AddServerModal.jsx';
import ServerList from './ServerList.jsx';
import Tiptop from './Tiptop.jsx';

export default function Dashboard({
  editorServer, editorShiningFields, saveFlowHighlights, isEditFlying = false, onSaveServer, onSaveAndConnectServer, onCancelEditor, allGroups,
  credentials, onOpenCredentials,
  searchQuery, onSearchChange,
  hideSensitive, onHideSensitiveToggle,
  serverListViewMode, onViewModeChange,
  servers, pingEnabled, pingCounts, isRefreshingPing, onRefreshPing,
  filteredServers, pings, sessions, activeSessionId,
  onConnect, onStartAdd, onEdit, onClone, onDelete, onMoveGroup, addToast,
  onOpenImportExport,
  selectionMode = false,
  selectedIds = [],
  onSelectChange,
  onBatchDelete,
  onBatchConnect,
  onBatchMoveGroup,
  onGroupDelete,
  onSelectionModeToggle,
  onBatchExport,
  onExitSelectionMode,
}) {
  const { t } = useTranslation();

  const [showMoveGroupDropdown, setShowMoveGroupDropdown] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const moveGroupMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (moveGroupMenuRef.current && !moveGroupMenuRef.current.contains(event.target)) {
        setShowMoveGroupDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const existingGroups = useMemo(() => {
    const groups = new Set();
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
    const groups = new Set();
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
                <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
                <input
                  className="input-compact"
                  placeholder={t('搜索服务器...')}
                  value={searchQuery}
                  onChange={onSearchChange}
                  style={{ width: '100%', paddingLeft: 28, height: 30, fontSize: 12, borderRadius: 8, background: 'var(--surface-overlay)', border: '1px solid var(--border)' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
              {/* 选择模式开关 */}
              <Tiptop text={selectionMode ? t('退出选择') : t('选择模式')} placement="bottom">
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={onSelectionModeToggle}
                  aria-label={selectionMode ? t('退出选择') : t('选择模式')}
                  style={selectionMode ? { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)' } : {}}
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
                    <LayoutGrid size={14} />
                  </button>
                </Tiptop>
                <div className="segment-control-divider" />
                <Tiptop text={t('列表视图')} placement="bottom">
                  <button
                    onClick={() => onViewModeChange('table')}
                    aria-label={t('列表视图')}
                    className={serverListViewMode === 'table' ? 'active' : ''}
                  >
                    <List size={14} />
                  </button>
                </Tiptop>
              </div>
              {/* 隐藏敏感信息 */}
              <Tiptop text={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')} placement="bottom">
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={onHideSensitiveToggle}
                  aria-label={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                  style={hideSensitive ? { background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning)' } : {}}
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
                  style={{ height: 30, padding: '0 10px', fontSize: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {allCollapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
                  <span>{allCollapsed ? t('打开分组') : t('收起分组')}</span>
                </button>
              )}
              {/* 数据管理（导入/导出） */}
              <Tiptop text={t('数据管理')} placement="bottom">
                <button
                  className="btn btn-ghost"
                  onClick={onOpenImportExport}
                  aria-label={t('数据管理')}
                  style={{ height: 30, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)' }}
                >
                  <Database size={14} />
                  <span style={{ fontSize: 12 }}>{t('数据管理')}</span>
                </button>
              </Tiptop>
            </div>
          </div>

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
              onBatchExport={onBatchExport}
              onExitSelectionMode={onExitSelectionMode}
              collapsedGroups={collapsedGroups}
              onCollapsedGroupsChange={setCollapsedGroups}
            />
          </div>

          {/* Batch Operation Bar */}
          {selectionMode && onBatchDelete && (
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
