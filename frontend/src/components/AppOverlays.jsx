import { Copy, PenLine, Search, X } from 'lucide-react';
import CredentialsModal from './CredentialsModal.jsx';
import ExportSelectedDialog from './ExportSelectedDialog.jsx';
import GlobalContextMenu from './GlobalContextMenu.jsx';
import GlobalDialog from './GlobalDialog.jsx';
import ImportExportDialog from './ImportExportDialog.jsx';
import PortForwardDialog from './PortForwardDialog.jsx';
import SerialConfigModal from './SerialConfigModal.jsx';
import SettingsModal from './SettingsModal.jsx';
import SyncFailureToast from './SyncFailureToast.jsx';
import Tiptop from './Tiptop.jsx';
import Toast from './Toast.jsx';
import UpdateModal from './UpdateModal.jsx';

export default function AppOverlays({ dialogs = {}, importExport = {}, notifications = {}, menus = {}, animation = {}, shared = {} }) {
  const {
    activeAIDevilMode,
    activeSessionId,
    addToast,
    canCopySessionPassword,
    canMoveTerminalToDockTarget,
    closeAllSessions,
    closePortForwardDialog,
    closeSession,
    closeTerminal,
    closeTerminalGroup,
    connectSerial,
    downloadProgress,
    editFlyAnimation,
    editorModeBanner,
    exportSelectedIds,
    forceCloseSession,
    handleApplyStartupUpdate,
    handleCopySessionPassword,
    handleDownloadTemplate,
    handleExport,
    handleExportSelected,
    handleImport,
    handlePortListeningEnabledChange,
    handleRenameTerminalTab,
    handleTabClick,
    handleToastAction,
    hasRecoveryPassword,
    ieBusy,
    isTerminalDockTargetOccupied,
    isUpdateModalVisible,
    loadServers,
    moveTerminalToDockTarget,
    portForwardDialogSessionId,
    portForwardInitialMapping,
    portForwardInitialTab,
    portListeningEnabled,
    probePanelPosition,
    removeToast,
    sessionAuthPrompts,
    sessionListPos,
    sessionListQuery,
    sessionListRef,
    sessions,
    setExportSelectedIds,
    setIsUpdateModalVisible,
    setProbePanelPosition,
    setSessionListQuery,
    setSettingsInitialTab,
    setShowCredentials,
    setShowExportSelectedDialog,
    setShowImportExportDialog,
    setShowSerialModal,
    setShowSessionList,
    setShowSettings,
    setSyncFailed,
    setTabContextMenu,
    setTerminalTabContextMenu,
    settingsInitialTab,
    showCredentials,
    showExportSelectedDialog,
    showImportExportDialog,
    showPortForwardDialog,
    showSerialModal,
    showSessionList,
    showSettings,
    startupUpdateInfo,
    syncFailed,
    t,
    tabContextMenu,
    terminalTabContextMenu,
    toasts,
  } = { ...dialogs, ...importExport, ...notifications, ...menus, ...animation, ...shared };
  return (<>
      {showImportExportDialog && (
        <ImportExportDialog
          onClose={() => setShowImportExportDialog(false)}
          onExport={handleExport}
          onImport={handleImport}
          onDownloadTemplate={handleDownloadTemplate}
          hasRecoveryPassword={hasRecoveryPassword}
          busy={ieBusy}
        />
      )}

      {showExportSelectedDialog && (
        <ExportSelectedDialog
          onClose={() => {
            setShowExportSelectedDialog(false);
            setExportSelectedIds([]);
          }}
          onExport={handleExportSelected}
          hasRecoveryPassword={hasRecoveryPassword}
          busy={ieBusy}
          selectedCount={exportSelectedIds.length}
        />
      )}

      {showSerialModal && (
        <SerialConfigModal
          onClose={() => setShowSerialModal(false)}
          onConnect={(config) => {
            setShowSerialModal(false);
            connectSerial(config);
          }}
        />
      )}

      {showPortForwardDialog && portForwardDialogSessionId && (
        <PortForwardDialog
          sessionId={portForwardDialogSessionId}
          initialMapping={portForwardInitialMapping}
          initialTab={portForwardInitialTab}
          portListeningEnabled={portListeningEnabled}
          onPortListeningEnabledChange={handlePortListeningEnabledChange}
          onClose={closePortForwardDialog}
        />
      )}

      {showSettings && (
        <SettingsModal
          initialTab={settingsInitialTab}
          onClose={() => { setShowSettings(false); loadServers(); }}
          addToast={addToast}
          onRestored={loadServers}
          probePanelPosition={probePanelPosition}
          onProbePanelPositionChange={setProbePanelPosition}
          forceDarkTheme={activeAIDevilMode}
        />
      )}

      {showCredentials && (
        <CredentialsModal
          onClose={() => { setShowCredentials(false); loadServers(); }}
          onChange={loadServers}
          addToast={addToast}
        />
      )}

      {editFlyAnimation && (
        <div className="edit-fly-layer" aria-hidden="true">
          {editFlyAnimation.items.map((item) => (
            item.type === 'beam' ? (
              <div
                key={item.id}
                className={`edit-fly-beam edit-fly-beam-${item.field}`}
                style={{
                  '--beam-from-x': `${item.from.x}px`,
                  '--beam-from-y': `${item.from.y}px`,
                  '--beam-length': item.length,
                  '--beam-angle': item.angle,
                  '--beam-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'add-core' ? (
              <div
                key={item.id}
                className="add-supernova-core"
                style={{
                  '--add-path': item.path,
                  '--add-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'add-particle' ? (
              <div
                key={item.id}
                className="add-supernova-particle"
                style={{
                  '--particle-path': item.path,
                  '--particle-size': `${item.size}px`,
                  '--particle-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'add-ring' ? (
              <div
                key={item.id}
                className="add-supernova-ring"
                style={{
                  '--ring-x': `${item.at.x}px`,
                  '--ring-y': `${item.at.y}px`,
                  '--ring-delay': `${item.delay}ms`,
                }}
              />
            ) : item.type === 'save-flow-capsule' ? (
              <div
                key={item.id}
                className={`save-flow-capsule save-flow-capsule-${item.field}`}
                style={{
                  '--save-flow-from-x': `${item.from.x}px`,
                  '--save-flow-from-y': `${item.from.y}px`,
                  '--save-flow-mid-x': `${item.mid.x}px`,
                  '--save-flow-mid-y': `${item.mid.y}px`,
                  '--save-flow-to-x': `${item.to.x}px`,
                  '--save-flow-to-y': `${item.to.y}px`,
                  '--save-flow-delay': `${item.delay}ms`,
                }}
              >
                <span className="edit-fly-label">{item.label}</span>
                {item.value ? <span className="edit-fly-value">{item.value}</span> : null}
              </div>
            ) : (
              <div
                key={item.id}
                className={`edit-fly-capsule edit-fly-capsule-${item.field}`}
                style={{
                  '--fly-from-x': `${item.from.x}px`,
                  '--fly-from-y': `${item.from.y}px`,
                  '--fly-mid-x': `${item.mid.x}px`,
                  '--fly-mid-y': `${item.mid.y}px`,
                  '--fly-to-x': `${item.to.x}px`,
                  '--fly-to-y': `${item.to.y}px`,
                  '--fly-delay': `${item.delay}ms`,
                }}
              >
                <span className="edit-fly-label">{item.label}</span>
                {item.value ? <span className="edit-fly-value">{item.value}</span> : null}
              </div>
            )
          ))}
        </div>
      )}

      {editorModeBanner && (
        <div className="editor-mode-banner" key={editorModeBanner.id} aria-live="polite">
          {editorModeBanner.text}
        </div>
      )}

      {/* ── Toasts ────────────────────────────────────────── */}
      <Toast toasts={toasts} onClose={removeToast} onAction={handleToastAction} closeLabel={t('关闭')} />
      <GlobalDialog />


      {/* ── 自动更新弹窗 ──────────────────────────────── */}
      <UpdateModal
        visible={isUpdateModalVisible}
        updateInfo={startupUpdateInfo}
        downloadProgress={downloadProgress}
        t={t}
        onClose={() => setIsUpdateModalVisible(false)}
        onUpdate={handleApplyStartupUpdate}
      />

      <SyncFailureToast
        syncFailed={syncFailed}
        setSyncFailed={setSyncFailed}
        setSettingsInitialTab={setSettingsInitialTab}
        setShowSettings={setShowSettings}
        addToast={addToast}
        t={t}
      />

      <GlobalContextMenu />

      {/* ── 终端子标签右键菜单 ── */}
      {terminalTabContextMenu && (() => {
        const session = sessions.find((item) => item.id === terminalTabContextMenu.sessionId);
        const moveTargets = [
          { target: 'top-left', label: t('移至左上面板') },
          { target: 'top-right', label: t('移至右上面板') },
          { target: 'bottom-left', label: t('移至左下面板') },
          { target: 'bottom-right', label: t('移至右下面板') },
        ];
        return (
          <div className="tab-context-menu" style={{ left: terminalTabContextMenu.x, top: terminalTabContextMenu.y }}>
            {terminalTabContextMenu.type === 'terminal' && moveTargets.map((item) => {
              const occupied = !!session && isTerminalDockTargetOccupied(session, terminalTabContextMenu.terminalId, item.target);
              const enabled = !!session && canMoveTerminalToDockTarget(session, terminalTabContextMenu.terminalId, item.target);
              return (
                <div
                  key={item.target}
                  className={`tab-context-menu-item${occupied ? ' occupied' : ''}`}
                  onClick={() => {
                    if (!session || !enabled) return;
                    moveTerminalToDockTarget(session, terminalTabContextMenu.terminalId, item.target);
                  }}
                  style={enabled ? undefined : { opacity: 0.42, pointerEvents: 'none' }}
                >
                  <span className="tab-context-menu-state">{occupied ? '☒' : '☑'}</span> {item.label}
                </div>
              );
            })}
            {terminalTabContextMenu.type === 'terminal' && (
              <div
                className="tab-context-menu-item"
                onClick={() => {
                  const { sessionId, terminalId } = terminalTabContextMenu;
                  setTerminalTabContextMenu(null);
                  void handleRenameTerminalTab(sessionId, terminalId);
                }}
              >
                <PenLine size={14} /> {t('重命名标签标题')}
              </div>
            )}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <div
              className="tab-context-menu-item"
              onClick={(e) => {
                const { sessionId, terminalId, type, terminalIds } = terminalTabContextMenu;
                setTerminalTabContextMenu(null);
                if (type === 'group') {
                  closeTerminalGroup(sessionId, terminalId, terminalIds, e);
                  return;
                }
                closeTerminal(sessionId, terminalId, e);
              }}
            >
              <X size={14} /> {terminalTabContextMenu.type === 'group' ? t('关闭分屏组') : t('关闭终端')}
            </div>
          </div>
        );
      })()}

      {/* ── 标签右键菜单 ── */}
      {tabContextMenu && (() => {
        const showCopySessionPassword = canCopySessionPassword(tabContextMenu.sessionId);
        return (
          <div className="tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }}>
            {showCopySessionPassword && (
              <>
                <div
                  className="tab-context-menu-item"
                  onClick={() => {
                    const sessionId = tabContextMenu.sessionId;
                    setTabContextMenu(null);
                    void handleCopySessionPassword(sessionId);
                  }}
                >
                  <Copy size={14} /> {t('复制服务器密码')}
                </div>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              </>
            )}
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
            {sessions.length >= 2 && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <div
                  className="tab-context-menu-item"
                  onClick={() => {
                    setTabContextMenu(null);
                    closeAllSessions();
                  }}
                >
                  <X size={14} /> {t('关闭全部')}
                </div>
              </>
            )}
          </div>
        );
      })()}
      {/* ── 服务器列表下拉 ── */}
      {showSessionList && (
        <div
          ref={sessionListRef}
          className="tab-context-menu"
          style={{ left: sessionListPos.x - 240, top: sessionListPos.y, minWidth: 240, maxHeight: 400, display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
            <input
              type="text"
              value={sessionListQuery}
              onChange={(e) => setSessionListQuery(e.target.value)}
              placeholder={t('搜索服务器')}
              autoFocus
              style={{ width: '100%', padding: '4px 8px 4px 26px', fontSize: 12, background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', outline: 'none' }}
            />
            <Search size={13} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {sessions
              .filter(s => !sessionListQuery || (s.serverName || '').toLowerCase().includes(sessionListQuery.toLowerCase()) || (s.host || '').toLowerCase().includes(sessionListQuery.toLowerCase()))
              .map(s => (
                <div
                  key={s.id}
                  className="tab-context-menu-item"
                  onClick={() => { handleTabClick(s.id); setShowSessionList(false); }}
                  style={{ fontWeight: activeSessionId === s.id ? 700 : 400, color: activeSessionId === s.id ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  <span className={`status-dot ${sessionAuthPrompts[s.id] ? 'attention' : s.status === 'connecting' ? 'connecting' : s.status === 'connected' ? 'online' : 'offline'}`} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.serverName}</span>
                  <Tiptop text={t('关闭')} placement="bottom">
                    <span
                      onClick={(e) => { e.stopPropagation(); closeSession(s.id, e); }}
                      aria-label={t('关闭')}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.5, flexShrink: 0 }}
                    >
                      <X size={13} />
                    </span>
                  </Tiptop>
                </div>
              ))}
            {sessions.filter(s => !sessionListQuery || (s.serverName || '').toLowerCase().includes(sessionListQuery.toLowerCase()) || (s.host || '').toLowerCase().includes(sessionListQuery.toLowerCase())).length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>{t('无匹配结果')}</div>
            )}
          </div>
        </div>
      )}
  </>);
}
