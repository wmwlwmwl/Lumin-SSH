import { BarChart3, Monitor, Search, LayoutGrid, List, Eye, EyeOff, RefreshCw, ArrowUpDown } from 'lucide-react';
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
}) {
  const { t } = useTranslation();

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
                  {hideSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </Tiptop>
              {/* 数据管理（导入/导出） */}
              <Tiptop text={t('数据管理')} placement="bottom">
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={onOpenImportExport}
                  aria-label={t('数据管理')}
                >
                  <ArrowUpDown size={14} />
                </button>
              </Tiptop>
            </div>
          </div>

          <div className="hosts-scroll-area">
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
            />
          </div>
        </div>
      </div>
    </div>
  );
}
