import FileManagerTab from '../FileManagerTab';
import { resolveFileManagerDownloadDirPreview, useFileManagerSettings } from './useFileManagerSettings.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

interface FileManagerTabPaneProps {
  activeTab: string;
  addToast: AddToast;
}

/** 文件管理器域容器：常驻挂载持有文件管理器/传输调优状态，仅在该页签激活时渲染 FileManagerTab */
export default function FileManagerTabPane({ activeTab, addToast }: FileManagerTabPaneProps) {
  const {
    programDirectory,
    fileManagerCompressedTransfer, handleToggleFileManagerCompressedTransfer,
    fileManagerAutoOpenTransferQueue, handleToggleFileManagerAutoOpenTransferQueue,
    fileManagerShowTabIcons, handleToggleFileManagerShowTabIcons,
    fileManagerHideTabCloseButton, handleToggleFileManagerHideTabCloseButton,
    fileManagerSharedPinnedTabs, handleToggleFileManagerSharedPinnedTabs,
    fileManagerLayoutMode, handleFileManagerLayoutModeChange,
    fileManagerDualPaneDragTransferEnabled, handleToggleFileManagerDualPaneDragTransferEnabled,
    fileManagerDualPaneDragPromptOnDirectory, handleToggleFileManagerDualPaneDragPromptOnDirectory,
    fileManagerDualPaneDragInvertModifier, handleToggleFileManagerDualPaneDragInvertModifier,
    fileManagerChmodAutoApplyLastSettings, handleToggleFileManagerChmodAutoApplyLastSettings,
    fileManagerDoubleClickUncompressArchive, handleToggleFileManagerDoubleClickUncompressArchive,
    fileManagerSmartUncompressConflictStrategy, handleFileManagerSmartUncompressConflictStrategyChange,
    fileManagerAutoRefreshDisabled, handleToggleFileManagerAutoRefreshDisabled,
    fileManagerMaxEditSizeMB, handleFileManagerMaxEditSizeChange,
    fileManagerDefaultOpenMode, handleFileManagerDefaultOpenModeChange,
    fileManagerPreferredExternalApp, handlePickFileManagerPreferredExternalApp, handleClearFileManagerPreferredExternalApp,
    fileManagerInitialPathMode, handleFileManagerInitialPathModeChange,
    fileManagerNewTabPathMode, handleFileManagerNewTabPathModeChange,
    fileManagerAskDownloadEveryTime, handleToggleFileManagerAskDownloadEveryTime,
    fileManagerDownloadConflictStrategy, handleFileManagerDownloadConflictStrategyChange,
    fileManagerDownloadConflictDiffBySize, handleToggleFileManagerDownloadConflictDiffBySize,
    fileManagerDownloadConflictDiffByMtime, handleToggleFileManagerDownloadConflictDiffByMtime,
    fileManagerDownloadRenameSuffixMode, handleFileManagerDownloadRenameSuffixModeChange,
    fileManagerDownloadDefaultDir, setFileManagerDownloadDefaultDir,
    fileManagerUploadChunkSizeKiB, setFileManagerUploadChunkSizeKiB,
    fileManagerUploadMaxFiles, setFileManagerUploadMaxFiles,
    fileManagerUploadMaxChunksPerFile, setFileManagerUploadMaxChunksPerFile,
    fileManagerUploadGlobalInflightLimit, setFileManagerUploadGlobalInflightLimit,
    handleFileManagerUploadSettingChange,
    transferMaxPacketKiB, handleTransferNumberChange, setTransferMaxPacketKiB,
    transferMaxRequestsPerFile, setTransferMaxRequestsPerFile,
    transferConcurrentWrites, handleToggleTransferConcurrentWrites,
    transferApplyToSharedClient, handleToggleTransferApplyToSharedClient,
  } = useFileManagerSettings({ addToast });

  if (activeTab !== 'fileManager') return null;
  return (
    <FileManagerTab
          fileManagerCompressedTransfer={fileManagerCompressedTransfer}
          onToggleFileManagerCompressedTransfer={handleToggleFileManagerCompressedTransfer}
          fileManagerAutoOpenTransferQueue={fileManagerAutoOpenTransferQueue}
          onToggleFileManagerAutoOpenTransferQueue={handleToggleFileManagerAutoOpenTransferQueue}
          fileManagerShowTabIcons={fileManagerShowTabIcons}
          onToggleFileManagerShowTabIcons={handleToggleFileManagerShowTabIcons}
          fileManagerHideTabCloseButton={fileManagerHideTabCloseButton}
          onToggleFileManagerHideTabCloseButton={handleToggleFileManagerHideTabCloseButton}
          fileManagerSharedPinnedTabs={fileManagerSharedPinnedTabs}
          onToggleFileManagerSharedPinnedTabs={handleToggleFileManagerSharedPinnedTabs}
          fileManagerLayoutMode={fileManagerLayoutMode}
          onFileManagerLayoutModeChange={handleFileManagerLayoutModeChange}
          fileManagerDualPaneDragTransferEnabled={fileManagerDualPaneDragTransferEnabled}
          onToggleFileManagerDualPaneDragTransferEnabled={handleToggleFileManagerDualPaneDragTransferEnabled}
          fileManagerDualPaneDragPromptOnDirectory={fileManagerDualPaneDragPromptOnDirectory}
          onToggleFileManagerDualPaneDragPromptOnDirectory={handleToggleFileManagerDualPaneDragPromptOnDirectory}
          fileManagerDualPaneDragInvertModifier={fileManagerDualPaneDragInvertModifier}
          onToggleFileManagerDualPaneDragInvertModifier={handleToggleFileManagerDualPaneDragInvertModifier}
          fileManagerChmodAutoApplyLastSettings={fileManagerChmodAutoApplyLastSettings}
          onToggleFileManagerChmodAutoApplyLastSettings={handleToggleFileManagerChmodAutoApplyLastSettings}
          fileManagerDoubleClickUncompressArchive={fileManagerDoubleClickUncompressArchive}
          onToggleFileManagerDoubleClickUncompressArchive={handleToggleFileManagerDoubleClickUncompressArchive}
          fileManagerSmartUncompressConflictStrategy={fileManagerSmartUncompressConflictStrategy}
          onFileManagerSmartUncompressConflictStrategyChange={handleFileManagerSmartUncompressConflictStrategyChange}
          fileManagerAutoRefreshDisabled={fileManagerAutoRefreshDisabled}
          onToggleFileManagerAutoRefreshDisabled={handleToggleFileManagerAutoRefreshDisabled}
          fileManagerMaxEditSizeMB={Number(fileManagerMaxEditSizeMB)}
          onFileManagerMaxEditSizeChange={handleFileManagerMaxEditSizeChange}
          fileManagerDefaultOpenMode={fileManagerDefaultOpenMode}
          onFileManagerDefaultOpenModeChange={handleFileManagerDefaultOpenModeChange}
          fileManagerPreferredExternalApp={fileManagerPreferredExternalApp}
          onPickFileManagerPreferredExternalApp={() => { void handlePickFileManagerPreferredExternalApp(); }}
          onClearFileManagerPreferredExternalApp={handleClearFileManagerPreferredExternalApp}
          fileManagerInitialPathMode={fileManagerInitialPathMode}
          onFileManagerInitialPathModeChange={handleFileManagerInitialPathModeChange}
          fileManagerNewTabPathMode={fileManagerNewTabPathMode}
          onFileManagerNewTabPathModeChange={handleFileManagerNewTabPathModeChange}
          fileManagerAskDownloadEveryTime={fileManagerAskDownloadEveryTime}
          onToggleFileManagerAskDownloadEveryTime={handleToggleFileManagerAskDownloadEveryTime}
          fileManagerDownloadConflictStrategy={fileManagerDownloadConflictStrategy}
          onFileManagerDownloadConflictStrategyChange={handleFileManagerDownloadConflictStrategyChange}
          fileManagerDownloadConflictDiffBySize={fileManagerDownloadConflictDiffBySize}
          onToggleFileManagerDownloadConflictDiffBySize={handleToggleFileManagerDownloadConflictDiffBySize}
          fileManagerDownloadConflictDiffByMtime={fileManagerDownloadConflictDiffByMtime}
          onToggleFileManagerDownloadConflictDiffByMtime={handleToggleFileManagerDownloadConflictDiffByMtime}
          fileManagerDownloadRenameSuffixMode={fileManagerDownloadRenameSuffixMode}
          onFileManagerDownloadRenameSuffixModeChange={handleFileManagerDownloadRenameSuffixModeChange}
          fileManagerDownloadDefaultDir={fileManagerDownloadDefaultDir}
          onFileManagerDownloadDefaultDirChange={handleFileManagerUploadSettingChange('fileManagerDownloadDefaultDir', setFileManagerDownloadDefaultDir)}
          fileManagerDownloadDefaultDirPreview={resolveFileManagerDownloadDirPreview(fileManagerDownloadDefaultDir, programDirectory)}
          fileManagerUploadChunkSizeKiB={Number(fileManagerUploadChunkSizeKiB)}
          onFileManagerUploadChunkSizeKiBChange={handleFileManagerUploadSettingChange('fileManagerUploadChunkSizeKiB', setFileManagerUploadChunkSizeKiB)}
          fileManagerUploadMaxFiles={Number(fileManagerUploadMaxFiles)}
          onFileManagerUploadMaxFilesChange={handleFileManagerUploadSettingChange('fileManagerUploadMaxFiles', setFileManagerUploadMaxFiles)}
          fileManagerUploadMaxChunksPerFile={Number(fileManagerUploadMaxChunksPerFile)}
          onFileManagerUploadMaxChunksPerFileChange={handleFileManagerUploadSettingChange('fileManagerUploadMaxChunksPerFile', setFileManagerUploadMaxChunksPerFile)}
          fileManagerUploadGlobalInflightLimit={Number(fileManagerUploadGlobalInflightLimit)}
          onFileManagerUploadGlobalInflightLimitChange={handleFileManagerUploadSettingChange('fileManagerUploadGlobalInflightLimit', setFileManagerUploadGlobalInflightLimit)}
          transferMaxPacketKiB={Number(transferMaxPacketKiB)}
          onTransferMaxPacketKiBChange={handleTransferNumberChange(setTransferMaxPacketKiB, 'maxPacketKiB')}
          transferMaxRequestsPerFile={Number(transferMaxRequestsPerFile)}
          onTransferMaxRequestsPerFileChange={handleTransferNumberChange(setTransferMaxRequestsPerFile, 'maxRequestsPerFile')}
          transferConcurrentWrites={transferConcurrentWrites}
          onToggleTransferConcurrentWrites={handleToggleTransferConcurrentWrites}
          transferApplyToSharedClient={transferApplyToSharedClient}
          onToggleTransferApplyToSharedClient={handleToggleTransferApplyToSharedClient}
        />
  );
}
