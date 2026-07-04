import { Zap, BarChart3, Monitor, Search, LayoutGrid, List, Eye, EyeOff, Plus, RefreshCw, FolderOpen, KeyRound } from 'lucide-react';
import { useTranslation } from '../i18n.js';
import PasswordField from './PasswordField.jsx';
import ServerList from './ServerList.jsx';

export default function Dashboard({
  quickForm, dispatchQuick, onQuickConnect, onQuickPrivateKeyFile,
  credentials, onOpenCredentials,
  searchQuery, onSearchChange,
  hideSensitive, onHideSensitiveToggle,
  serverListViewMode, onViewModeChange,
  servers, pingCounts, isRefreshingPing, onRefreshPing,
  filteredServers, pings, sessions, activeSessionId,
  onConnect, onEdit, onClone, onDelete, onMoveGroup, addToast,
}) {
  const { t } = useTranslation();

  return (
    <div className="dashboard-container">
      {/* 左半栏：快捷控制台 */}
      <div className="dashboard-left">
        {/* ⚡ 闪电直连卡片 */}
        <div className="glass-card quick-connect-box">
          <div className="card-header-icon-title">
            <span className="card-header-icon"><Zap size={18} /></span>
            <span className="card-header-title">{t('闪电直连')}</span>
          </div>
          <form onSubmit={onQuickConnect} className="quick-connect-form">
            <div className="form-group-compact">
              <label>{t('服务器别名（选填）')}</label>
              <input className="input-compact" placeholder={t('例如：我的测试服')} value={quickForm.name} onChange={e => dispatchQuick({ type: 'name', value: e.target.value })} />
            </div>
            <div className="form-group-compact">
              <label>{t('主机地址 *')}</label>
              <div className="form-row-compact">
                <input className="input-compact" style={{ flex: 3 }} placeholder="192.168.1.1" value={quickForm.host} onChange={e => dispatchQuick({ type: 'host', value: e.target.value })} required />
                <input className="input-compact" style={{ flex: 1.2 }} placeholder="22" value={quickForm.port} onChange={e => dispatchQuick({ type: 'port', value: e.target.value })} />
              </div>
            </div>
            <div className="form-group-compact">
              <label>{t('用户名')}</label>
              <input className="input-compact" placeholder="root" value={quickForm.user} onChange={e => dispatchQuick({ type: 'user', value: e.target.value })} />
            </div>
            <div className="form-group-compact">
              <label>{t('认证方式')}</label>
              <select className="select-compact" value={quickForm.auth} onChange={e => dispatchQuick({ type: 'auth', value: e.target.value })}>
                <option value="password">{t('密码认证')}</option>
                <option value="key">{t('私钥认证')}</option>
                {credentials.length > 0 && <option value="credential">{t('使用凭据')}</option>}
              </select>
            </div>
            {quickForm.auth === 'credential' ? (
              <div className="form-group-compact">
                <label>{t('选择凭据')}</label>
                <select className="select-compact" value={quickForm.credId || ''} onChange={e => dispatchQuick({ type: 'credId', value: e.target.value })}>
                  <option value="">{t('请选择凭据')}</option>
                  {credentials.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.username})</option>
                  ))}
                </select>
              </div>
            ) : quickForm.auth === 'password' ? (
              <div className="form-group-compact">
                <label>{t('密码')}</label>
                <PasswordField value={quickForm.pass} onChange={e => dispatchQuick({ type: 'pass', value: e.target.value })} placeholder={t('请输入密码')} showPassword={quickForm.showPass} onToggleShow={() => dispatchQuick({ type: 'showPass', value: !quickForm.showPass })} />
              </div>
            ) : (
              <>
                <div className="form-group-compact">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ marginBottom: 0 }}>{t('私钥内容')}</label>
                    <button type="button" className="btn-text-action" onClick={onQuickPrivateKeyFile}><FolderOpen size={14} /> {t('浏览')}</button>
                  </div>
                  <textarea className="textarea-compact" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={quickForm.key} onChange={e => dispatchQuick({ type: 'key', value: e.target.value })} />
                </div>
                <div className="form-group-compact">
                  <label>{t('私钥密码短语 (可选)')}</label>
                  <PasswordField value={quickForm.passphrase} onChange={e => dispatchQuick({ type: 'passphrase', value: e.target.value })} placeholder={t('私钥密码短语')} showPassword={quickForm.showPassphrase} onToggleShow={() => dispatchQuick({ type: 'showPassphrase', value: !quickForm.showPassphrase })} />
                </div>
              </>
            )}
            <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 12 }}>{t('立即闪连')}</button>
	            <button type="button" className="btn btn-ghost" onClick={onOpenCredentials} style={{ width: '100%', marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid var(--accent)', color: 'var(--accent)' }}>
	              <KeyRound size={14} /> {t('凭据管理')}
	            </button>
	           </form>
         </div>

        {/* 📊 状态概览 */}
        <div className="glass-card status-overview-box">
          <div className="card-header-icon-title">
            <span className="card-header-icon"><BarChart3 size={18} /></span>
            <span className="card-header-title">{t('系统状态')}</span>
            <button className={`btn-icon-spin ${isRefreshingPing ? 'spinning' : ''}`} onClick={onRefreshPing} title={t('刷新延迟')} aria-label={t('刷新延迟')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, display: "flex", alignItems: "center" }}><RefreshCw size={14} /></button>
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
                <button
                  onClick={() => onViewModeChange('grid')}
                  title={t('卡片视图')}
                  className={serverListViewMode === 'grid' ? 'active' : ''}
                >
                  <LayoutGrid size={14} />
                </button>
                <div className="segment-control-divider" />
                <button
                  onClick={() => onViewModeChange('table')}
                  title={t('列表视图')}
                  className={serverListViewMode === 'table' ? 'active' : ''}
                >
                  <List size={14} />
                </button>
              </div>
              {/* 隐藏敏感信息 */}
              <button
                className="btn btn-ghost btn-icon"
                onClick={onHideSensitiveToggle}
                title={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                style={hideSensitive ? { background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning)' } : {}}
              >
                {hideSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              {/* 添加按钮 */}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onEdit(null)}
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
