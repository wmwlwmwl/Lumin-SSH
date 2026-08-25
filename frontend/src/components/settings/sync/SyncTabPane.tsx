import SyncTab from '../SyncTab';
import { PROVIDERS, PROVIDER_LIST } from './syncProviders.ts';
import { useSyncMeta } from './useSyncMeta.ts';
import { useSyncProviders } from './useSyncProviders.ts';
import { useSyncRestore } from './useSyncRestore.ts';
import { useRecoveryPassword } from './useRecoveryPassword.ts';
import RestoreDialogs from './RestoreDialogs.tsx';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

interface SyncTabPaneProps {
  activeTab: string;
  addToast: AddToast;
  onRestored?: () => void;
  syncProvider: string;
  setSyncProvider: React.Dispatch<React.SetStateAction<string>>;
  recoveryPasswordEditing: boolean;
  setRecoveryPasswordEditing: React.Dispatch<React.SetStateAction<boolean>>;
  recoveryPasswordInput: string;
  setRecoveryPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  restoreWithPassword: boolean;
  setRestoreWithPassword: React.Dispatch<React.SetStateAction<boolean>>;
  restorePasswordInput: string;
  setRestorePasswordInput: React.Dispatch<React.SetStateAction<string>>;
}

/** 同步域容器：常驻挂载持有云同步状态，仅在 sync 页签激活时渲染 SyncTab，恢复弹窗随时可弹出 */
export default function SyncTabPane({
  activeTab,
  addToast,
  onRestored,
  syncProvider,
  setSyncProvider,
  recoveryPasswordEditing,
  setRecoveryPasswordEditing,
  recoveryPasswordInput,
  setRecoveryPasswordInput,
  restoreWithPassword,
  setRestoreWithPassword,
  restorePasswordInput,
  setRestorePasswordInput,
}: SyncTabPaneProps) {
  const {
    lastSyncTime, syncTombstoneStats, pruningTombstones,
    syncMode, autoSyncEnabled, refreshSyncMeta,
    handleSyncModeChange, handleAutoSyncEnabledChange, handlePruneSyncTombstones,
  } = useSyncMeta({ addToast });

  const {
    webdavForm, isConfigured, isEditing, setIsEditing, loading, testing, testResult, setWebdav, handleTest, handleSave,
    r2Form, r2Configured, r2Editing, setR2Editing, r2Loading, r2Testing, r2TestResult, setR2, handleR2Test, handleR2Save,
    ftpForm, ftpConfigured, ftpEditing, setFtpEditing, ftpLoading, ftpTesting, ftpTestResult, setFTP, handleTestFTP, handleSaveFTP,
    sftpForm, sftpConfigured, sftpEditing, setSftpEditing, sftpLoading, sftpTesting, sftpTestResult, setSFTP, handleTestSFTP, handleSaveSFTP, setSftpForm,
    providerState, configuredProviderIds, confirmSecureProviders,
  } = useSyncProviders({ addToast, onRestored, refreshSyncMeta, setSyncProvider });

  const {
    syncing, loadingBackups, restoring,
    confirmRestore, setConfirmRestore, confirmRestoreProvider, setConfirmRestoreProvider,
    backupsList, selectedBackup, setSelectedBackup, failedRestoreProviders,
    loadRestoreBackups, handleRestore, doRestore, doRestoreWithPassword, handleSync,
  } = useSyncRestore({
    addToast, onRestored, refreshSyncMeta, syncMode,
    providerState, configuredProviderIds, confirmSecureProviders,
    restoreWithPassword, setRestoreWithPassword, restorePasswordInput, setRestorePasswordInput,
  });

  const { hasRecoveryPassword, recoveryPasswordChanging, handleSaveRecoveryPassword, handleClearRecoveryPassword } = useRecoveryPassword({
    addToast, refreshSyncMeta, recoveryPasswordInput, setRecoveryPasswordEditing, setRecoveryPasswordInput,
  });

  return (
    <>
      {activeTab === 'sync' && (
        <SyncTab
          syncProvider={syncProvider}
          onSyncProviderChange={setSyncProvider}
          syncMode={syncMode}
          onSyncModeChange={handleSyncModeChange}
          autoSyncEnabled={autoSyncEnabled}
          onAutoSyncEnabledChange={handleAutoSyncEnabledChange}
          providers={PROVIDERS}
          providerList={PROVIDER_LIST}
          webdavForm={webdavForm}
          setWebdavField={setWebdav}
          webdavConfigured={isConfigured}
          webdavEditing={isEditing}
          setWebdavEditing={setIsEditing}
          webdavLoading={loading}
          webdavTesting={testing}
          webdavTestResult={testResult}
          onWebdavTest={handleTest}
          onWebdavSave={handleSave}
          r2Form={r2Form}
          setR2Field={setR2}
          r2Configured={r2Configured}
          r2Editing={r2Editing}
          setR2Editing={setR2Editing}
          r2Loading={r2Loading}
          r2Testing={r2Testing}
          r2TestResult={r2TestResult}
          onR2Test={handleR2Test}
          onR2Save={handleR2Save}
          ftpForm={ftpForm}
          setFTPField={setFTP}
          ftpConfigured={ftpConfigured}
          ftpEditing={ftpEditing}
          setFtpEditing={setFtpEditing}
          ftpLoading={ftpLoading}
          ftpTesting={ftpTesting}
          ftpTestResult={ftpTestResult}
          onTestFTP={handleTestFTP}
          onSaveFTP={handleSaveFTP}
          sftpForm={sftpForm}
          setSFTPField={setSFTP}
          sftpConfigured={sftpConfigured}
          sftpEditing={sftpEditing}
          setSftpEditing={setSftpEditing}
          sftpLoading={sftpLoading}
          sftpTesting={sftpTesting}
          sftpTestResult={sftpTestResult}
          onTestSFTP={handleTestSFTP}
          onSaveSFTP={handleSaveSFTP}
          // SyncTab 期待宽松 ProviderForm（Record<string, string|number>），Dispatch 逆变不兼容需桥接
          setSftpForm={setSftpForm as React.Dispatch<React.SetStateAction<Record<string, string | number>>>}
          lastSyncTime={lastSyncTime}
          syncTombstoneStats={syncTombstoneStats}
          onPruneSyncTombstones={handlePruneSyncTombstones}
          pruningTombstones={pruningTombstones}
          syncing={syncing}
          onSync={handleSync}
          loadingBackups={loadingBackups}
          restoring={restoring}
          onRestore={handleRestore}
          isAnyConfigured={isConfigured || r2Configured || ftpConfigured || sftpConfigured}
          addToast={addToast}
          hasRecoveryPassword={hasRecoveryPassword}
          recoveryPasswordEditing={recoveryPasswordEditing}
          setRecoveryPasswordEditing={setRecoveryPasswordEditing}
          recoveryPasswordInput={recoveryPasswordInput}
          setRecoveryPasswordInput={setRecoveryPasswordInput}
          recoveryPasswordChanging={recoveryPasswordChanging}
          onSaveRecoveryPassword={handleSaveRecoveryPassword}
          onClearRecoveryPassword={handleClearRecoveryPassword}
        />
      )}

      <RestoreDialogs
        confirmRestoreProvider={confirmRestoreProvider}
        configuredProviderIds={configuredProviderIds}
        failedRestoreProviders={failedRestoreProviders}
        loadingBackups={loadingBackups}
        loadRestoreBackups={loadRestoreBackups}
        setConfirmRestoreProvider={setConfirmRestoreProvider}
        confirmRestore={confirmRestore}
        backupsList={backupsList}
        selectedBackup={selectedBackup}
        setSelectedBackup={setSelectedBackup}
        setConfirmRestore={setConfirmRestore}
        doRestore={doRestore}
        restoring={restoring}
        restoreWithPassword={restoreWithPassword}
        setRestoreWithPassword={setRestoreWithPassword}
        restorePasswordInput={restorePasswordInput}
        setRestorePasswordInput={setRestorePasswordInput}
        doRestoreWithPassword={doRestoreWithPassword}
      />
    </>
  );
}
