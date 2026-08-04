import { useRef } from 'react';
import { House, Minus, Square, X, Bot, Settings, RefreshCw, Rocket, Sun, Moon, ChevronDown } from 'lucide-react';
import Tiptop from './Tiptop.jsx';
import { WindowMinimise } from '../../wailsjs/runtime/runtime.js';
import { Z } from '../constants/zIndex.js';

export default function AppTopbar({
  t, handleTopbarDoubleClick, markWorkspaceRestoreNavigationOverride,
  setActiveSessionId, setActiveTerminalId, setShowSettings,
  logoImg, showTopbarRefreshedLogo, topbarLogoTransitionImg,
  sessions, tabScrollRef, tabListRef, activeSessionId, handleTabClick,
  closeSession, setTabContextMenu, sessionAuthPrompts, sshChannelUsage,
  tabsOverflow, tabActionsRef, sessionListBtnRef, toggleSessionList,
  closeAllSessions, showThemeQuickEntry, activeAIDevilMode,
  resolvedQuickThemeMode, handleQuickThemeToggle, isActiveSessionConnected,
  showAIPanel, setAIPanelVisibility, startupUpdateInfo, showUpdateBubble,
  isUpdateModalVisible, setShowUpdateBubble,
  setIsUpdateModalVisible, setSettingsInitialTab, handleToggleMaximise,
  handleCloseWindow, reconnectSession,
}) {
  const topbarRef = useRef(null);

  return (
    <>
      {/* ── Topbar ───────────────────────────────────────── */}
      <div
        className="topbar"
        ref={topbarRef}
        onMouseDown={(e) => {
          // detail>1 为双击的第二次按下；阻止浏览器默认划词（否则 WebView2 会弹 AI 搜索条）
          if (e.detail > 1) e.preventDefault();
        }}
        onDoubleClick={handleTopbarDoubleClick}
      >
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
                      onDoubleClick={(e) => { void closeSession(s.id, e); }}
                      onMouseDown={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        e.stopPropagation();
                        void closeSession(s.id, e);
                      }}
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
                      <span
                        className={`status-dot ${sessionAuthPrompts[s.id] ? 'attention' : s.status === 'connecting' ? 'connecting' : s.status === 'connected' ? 'online' : 'offline'}`}
                        role={sessionAuthPrompts[s.id] ? 'img' : undefined}
                        aria-label={sessionAuthPrompts[s.id] ? sessionAuthPrompts[s.id].title : undefined}
                        title={sessionAuthPrompts[s.id] ? sessionAuthPrompts[s.id].title : undefined}
                      />
                      {(() => {
                        const usage = sshChannelUsage[s.id];
                        if (!usage || usage.total <= 0 || s.status !== 'connected') return null;
                        const maxSessions = usage.maxSessions > 0 ? usage.maxSessions : 10;
                        const nearLimit = usage.total >= Math.max(1, maxSessions - 2);
                        return (
                          <Tiptop
                            placement="bottom"
                            minTop={() => (topbarRef.current?.getBoundingClientRect().bottom ?? 40) + 6}
                            text={(
                              <>
                                <div>{t('服务器连接通道占用')}</div>
                                <div style={{ marginTop: 2, opacity: 0.82, fontSize: 11 }}>{t('终端 {count} 个', { count: usage.terminals })}</div>
                                <div style={{ opacity: 0.82, fontSize: 11 }}>{t('共享文件通道 {count} 个', { count: usage.sharedSftp })}</div>
                                <div style={{ opacity: 0.82, fontSize: 11 }}>{t('上传通道 {count} 个', { count: usage.uploadPool })}</div>
                                <div style={{ marginTop: 2, fontSize: 11 }}>{t('合计 {total} / 上限 {max}', { total: usage.total, max: maxSessions })}</div>
                                <div style={{ marginTop: 2, opacity: 0.7, fontSize: 11 }}>{t('接近服务器通道上限后将无法建立新的终端或传输')}</div>
                              </>
                            )}
                          >
                            <span
                              className="no-drag"
                              style={{
                                minWidth: 15,
                                height: 15,
                                padding: '0 4px',
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                                lineHeight: '15px',
                                textAlign: 'center',
                                flexShrink: 0,
                                cursor: 'default',
                                background: nearLimit ? 'var(--warning-dim)' : 'var(--surface-sunken)',
                                color: nearLimit ? 'var(--warning)' : 'var(--text-tertiary)',
                                border: `1px solid ${nearLimit ? 'var(--warning)' : 'var(--border)'}`,
                              }}
                            >
                              {usage.total}
                            </span>
                          </Tiptop>
                        );
                      })()}
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
                            onDoubleClick={(e) => e.stopPropagation()}
                            aria-label={t('重新连接')}
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <RefreshCw size={12} />
                          </span>
                        </Tiptop>
                      )}
                      <span
                        className="tab-close no-drag"
                        onClick={(e) => closeSession(s.id, e)}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <X size={12} />
                      </span>
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
    </>
  );
}
