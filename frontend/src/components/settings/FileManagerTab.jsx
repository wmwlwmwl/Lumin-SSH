import React from 'react';
import { t as $t } from '../../i18n.js';
import { RadioOption, ToggleSwitch, SettingRow, SettingsDivider, SettingsPanel, SettingsSectionTitle, SettingsTabRoot } from './SharedComponents';
import { settings } from './settingDefinitions';

export default function FileManagerTab({
  fileManagerCompressedTransfer,
  onToggleFileManagerCompressedTransfer,
  fileManagerAutoOpenTransferQueue,
  onToggleFileManagerAutoOpenTransferQueue,
  fileManagerShowTabIcons,
  onToggleFileManagerShowTabIcons,
  fileManagerHideTabCloseButton,
  onToggleFileManagerHideTabCloseButton,
  fileManagerSharedPinnedTabs,
  onToggleFileManagerSharedPinnedTabs,
  fileManagerLayoutMode = 'classic',
  onFileManagerLayoutModeChange,
  fileManagerDualPaneDragTransferEnabled,
  onToggleFileManagerDualPaneDragTransferEnabled,
  fileManagerDualPaneDragPromptOnDirectory,
  onToggleFileManagerDualPaneDragPromptOnDirectory,
  fileManagerDualPaneDragInvertModifier,
  onToggleFileManagerDualPaneDragInvertModifier,
  fileManagerChmodAutoApplyLastSettings,
  onToggleFileManagerChmodAutoApplyLastSettings,
  fileManagerDoubleClickUncompressArchive,
  onToggleFileManagerDoubleClickUncompressArchive,
  fileManagerSmartUncompressConflictStrategy,
  onFileManagerSmartUncompressConflictStrategyChange,
  fileManagerAutoRefreshDisabled = false,
  onToggleFileManagerAutoRefreshDisabled,
  fileManagerMaxEditSizeMB = 5,
  onFileManagerMaxEditSizeChange,
  fileManagerDefaultOpenMode = 'builtin',
  onFileManagerDefaultOpenModeChange,
  fileManagerPreferredExternalApp = '',
  onPickFileManagerPreferredExternalApp,
  onClearFileManagerPreferredExternalApp,
  fileManagerInitialPathMode,
  onFileManagerInitialPathModeChange,
  fileManagerNewTabPathMode,
  onFileManagerNewTabPathModeChange,
  fileManagerAskDownloadEveryTime,
  onToggleFileManagerAskDownloadEveryTime,
  fileManagerDownloadConflictStrategy,
  onFileManagerDownloadConflictStrategyChange,
  fileManagerDownloadConflictDiffBySize,
  onToggleFileManagerDownloadConflictDiffBySize,
  fileManagerDownloadConflictDiffByMtime,
  onToggleFileManagerDownloadConflictDiffByMtime,
  fileManagerDownloadRenameSuffixMode,
  onFileManagerDownloadRenameSuffixModeChange,
  fileManagerDownloadDefaultDir,
  onFileManagerDownloadDefaultDirChange,
  fileManagerDownloadDefaultDirPreview,
  fileManagerUploadChunkSizeKiB,
  onFileManagerUploadChunkSizeKiBChange,
  fileManagerUploadMaxFiles,
  onFileManagerUploadMaxFilesChange,
  fileManagerUploadMaxChunksPerFile,
  onFileManagerUploadMaxChunksPerFileChange,
  fileManagerUploadGlobalInflightLimit,
  onFileManagerUploadGlobalInflightLimitChange,
  transferMaxPacketKiB,
  onTransferMaxPacketKiBChange,
  transferMaxRequestsPerFile,
  onTransferMaxRequestsPerFileChange,
  transferConcurrentWrites,
  onToggleTransferConcurrentWrites,
  transferApplyToSharedClient,
  onToggleTransferApplyToSharedClient,
}) {
  const withDefaultValue = (text, value) => `${text} ${$t('默认值：{value}，仅影响下一次上传任务', { value })}`;
  const withTransferDefaultValue = (text, value) => `${text} ${$t('默认值：{value}，仅影响下一次传输任务', { value })}`;
  const renderChannelImpactHint = (text) => (
    <span style={{ display: 'block', marginTop: 2, color: 'var(--warning)' }}>{text}</span>
  );
  const renderWarningDescription = (baseText, warningText) => (
    <>
      <span>{baseText}</span>
      {renderChannelImpactHint(warningText)}
    </>
  );
  return (
    <SettingsTabRoot>
      <div>
        <SettingsSectionTitle definition={settings.fileManager.sections.preferences} />
        <SettingsPanel>
          <SettingRow
            definition={settings.fileManager.fields.compressedTransfer}
            description={$t('多文件或文件夹上传时先在本机打包为 tar.gz，上传后远端自动解压')}
            action={<ToggleSwitch checked={fileManagerCompressedTransfer} onChange={onToggleFileManagerCompressedTransfer} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.autoOpenTransferQueue}
            description={$t('上传或下载新建传输任务后自动展开传输队列面板')}
            action={<ToggleSwitch checked={fileManagerAutoOpenTransferQueue} onChange={onToggleFileManagerAutoOpenTransferQueue} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.showTabIcons}
            description={$t('关闭后只隐藏目录图标,仍显示固定图标')}
            action={<ToggleSwitch checked={fileManagerShowTabIcons} onChange={onToggleFileManagerShowTabIcons} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.hideTabCloseButton}
            description={$t('开启后,文件资源管理器标签页不显示关闭图标按钮,仅可双击关闭')}
            action={<ToggleSwitch checked={fileManagerHideTabCloseButton} onChange={onToggleFileManagerHideTabCloseButton} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.sharedPinnedTabs}
            description={$t('开启后,同一服务器下所有终端共用一组文件资源管理器固定标签')}
            action={<ToggleSwitch checked={fileManagerSharedPinnedTabs} onChange={onToggleFileManagerSharedPinnedTabs} />}
          />
          <SettingsDivider />
          <div data-settings-field-id={settings.fileManager.fields.layoutMode.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('文件资源管理器视图')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('选择顶部标签单栏,或左侧标签双面板视图')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <RadioOption
                definition={settings.fileManager.fields.classicLayout}
                selected={fileManagerLayoutMode === 'classic'}
                label={$t('经典顶部标签')}
                description={$t('保留当前顶部横向标签栏与单内容区')}
                onClick={() => onFileManagerLayoutModeChange?.('classic')}
              />
              <RadioOption
                definition={settings.fileManager.fields.dualLayout}
                selected={fileManagerLayoutMode === 'sidebar_dual'}
                label={$t('左侧标签双面板')}
                description={$t('左侧显示历史标签,主内容区同时显示左右两个文件列表')}
                onClick={() => onFileManagerLayoutModeChange?.('sidebar_dual')}
              />
            </div>
            {fileManagerLayoutMode === 'sidebar_dual' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{$t('仅在左侧标签双面板视图中生效')}</div>
                <SettingRow
                  definition={settings.fileManager.fields.dualDragTransfer}
                  description={$t('开启后,可在双栏之间直接拖拽文件;默认复制,按住 Ctrl 为移动')}
                  action={<ToggleSwitch checked={fileManagerDualPaneDragTransferEnabled} onChange={onToggleFileManagerDualPaneDragTransferEnabled} />}
                />
                <SettingsDivider margin="2px 0" />
                <SettingRow
                  definition={settings.fileManager.fields.dualDragPrompt}
                  description={$t('开启后,拖拽内容包含文件夹时先确认是否继续')}
                  action={<ToggleSwitch checked={fileManagerDualPaneDragPromptOnDirectory} onChange={onToggleFileManagerDualPaneDragPromptOnDirectory} />}
                />
                <SettingsDivider margin="2px 0" />
                <SettingRow
                  definition={settings.fileManager.fields.dualDragInvert}
                  description={$t('开启后,默认移动,按住 Ctrl 为复制')}
                  action={<ToggleSwitch checked={fileManagerDualPaneDragInvertModifier} onChange={onToggleFileManagerDualPaneDragInvertModifier} />}
                />
              </div>
            ) : null}
          </div>
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.chmodAutoApply}
            description={$t('开启后,修改权限弹窗会默认套用上次保存的权限模式和包含子目录选项')}
            action={<ToggleSwitch checked={fileManagerChmodAutoApplyLastSettings} onChange={onToggleFileManagerChmodAutoApplyLastSettings} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.doubleClickUncompress}
            description={$t('开启后,双击压缩包会直接解压;右键“解压”也会使用同样的智能解压规则')}
            action={<ToggleSwitch checked={fileManagerDoubleClickUncompressArchive} onChange={onToggleFileManagerDoubleClickUncompressArchive} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.autoRefresh}
            description={$t('在终端执行命令后、或切回文件管理器时自动刷新当前目录。关闭可减少对远程服务器的请求')}
            action={<ToggleSwitch checked={!fileManagerAutoRefreshDisabled} onChange={onToggleFileManagerAutoRefreshDisabled} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.maxEditSize}
            description={$t('双击或用编辑器打开文件时的最大文件大小，超过将拒绝打开以避免卡顿或内存溢出。范围 1-50，默认 5')}
            action={<input id="fm-max-edit-size" name="fm-max-edit-size" className="input" type="number" min={1} max={50} autoComplete="off" value={fileManagerMaxEditSizeMB} onChange={onFileManagerMaxEditSizeChange} style={{ width: 160, textAlign: 'right' }} />}
          />
          <SettingsDivider />
          <div data-settings-field-id={settings.fileManager.fields.uncompressConflict.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('智能解压遇到同名文件夹时')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('如果准备解压到“压缩包同名文件夹”,但这个文件夹已经存在,就按这里处理')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <RadioOption
                definition={settings.fileManager.fields.uncompressOverwrite}
                selected={fileManagerSmartUncompressConflictStrategy === 'overwrite'}
                label={$t('覆盖')}
                description={$t('继续解压到现有同名文件夹,里面同名文件会被替换')}
                onClick={() => onFileManagerSmartUncompressConflictStrategyChange?.('overwrite')}
              />
              <RadioOption
                definition={settings.fileManager.fields.uncompressRename}
                selected={fileManagerSmartUncompressConflictStrategy === 'auto_rename'}
                label={$t('自动重命名')}
                description={$t('保留已有文件夹,自动新建“压缩包名 (2)”这类文件夹')}
                onClick={() => onFileManagerSmartUncompressConflictStrategyChange?.('auto_rename')}
              />
              <RadioOption
                definition={settings.fileManager.fields.uncompressPrompt}
                selected={fileManagerSmartUncompressConflictStrategy === 'prompt'}
                label={$t('每次都询问我')}
                description={$t('每次遇到同名文件夹时都弹窗让我选')}
                onClick={() => onFileManagerSmartUncompressConflictStrategyChange?.('prompt')}
              />
            </div>
          </div>
          <SettingsDivider />
          <div data-settings-field-id={settings.fileManager.fields.defaultOpenMode.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('打开文件默认方式')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('双击或点“编辑”时的默认打开方式；编辑器内仍可随时切换到系统/指定编辑器')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <RadioOption
                definition={settings.fileManager.fields.builtinEditor}
                selected={fileManagerDefaultOpenMode === 'builtin'}
                label={$t('内置编辑器')}
                description={$t('使用 Lumin 内置编辑器打开，支持高亮与保存回远端')}
                onClick={() => onFileManagerDefaultOpenModeChange?.('builtin')}
              />
              <RadioOption
                definition={settings.fileManager.fields.systemEditor}
                selected={fileManagerDefaultOpenMode === 'system'}
                label={$t('系统编辑器')}
                description={$t('用系统默认程序打开临时文件，保存后自动同步回远端')}
                onClick={() => onFileManagerDefaultOpenModeChange?.('system')}
              />
              <RadioOption
                definition={settings.fileManager.fields.externalEditor}
                selected={fileManagerDefaultOpenMode === 'external'}
                label={$t('指定外部编辑器')}
                description={$t('始终使用你选择的编辑器程序打开，例如 VS Code / Notepad++')}
                onClick={() => onFileManagerDefaultOpenModeChange?.('external')}
              />
            </div>
            {fileManagerDefaultOpenMode === 'external' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  {$t('当前外部编辑器')}：{fileManagerPreferredExternalApp ? fileManagerPreferredExternalApp : $t('未选择（首次打开时会提示选择）')}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => onPickFileManagerPreferredExternalApp?.()}>
                    {fileManagerPreferredExternalApp ? $t('更换外部编辑器') : $t('选择外部编辑器')}
                  </button>
                  {fileManagerPreferredExternalApp ? (
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => onClearFileManagerPreferredExternalApp?.()}>
                      {$t('清除')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <SettingsDivider />
          <div data-settings-field-id={settings.fileManager.fields.initialPath.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('进入服务器默认路径')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('首次打开文件管理器时的初始目录来源；优先使用配置中的文件管理器初始目录，未填写时使用当前终端启动目录，最后回退到 /root 和根目录')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <RadioOption
                definition={settings.fileManager.fields.sessionInitialPath}
                selected={fileManagerInitialPathMode === 'session_initial_path'}
                label={$t('服务器初始目录')}
                description={$t('优先使用当前服务器配置中的文件管理器初始目录，未填写时使用当前终端启动目录')}
                onClick={() => onFileManagerInitialPathModeChange('session_initial_path')}
              />
              <RadioOption
                definition={settings.fileManager.fields.rootInitialPath}
                selected={fileManagerInitialPathMode === 'root'}
                label={$t('根目录')}
                description={$t('首次进入时从根目录开始')}
                onClick={() => onFileManagerInitialPathModeChange('root')}
              />
              <RadioOption
                definition={settings.fileManager.fields.terminalInitialPath}
                selected={fileManagerInitialPathMode === 'terminal_cwd'}
                label={$t('当前终端目录')}
                description={$t('使用当前终端最近一次上报的工作目录')}
                onClick={() => onFileManagerInitialPathModeChange('terminal_cwd')}
              />
            </div>
          </div>
          <SettingsDivider />
          <div data-settings-field-id={settings.fileManager.fields.newTabPath.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('新建标签默认路径')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('手动新建文件管理器标签时的初始目录来源；如果首选路径不可用，会依次回退到当前标签目录和根目录')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <RadioOption
                definition={settings.fileManager.fields.inheritCurrentPath}
                selected={fileManagerNewTabPathMode === 'inherit_current'}
                label={$t('继承当前标签所在目录')}
                description={$t('新标签默认打开当前标签所在目录')}
                onClick={() => onFileManagerNewTabPathModeChange('inherit_current')}
              />
              <RadioOption
                definition={settings.fileManager.fields.newTabRootPath}
                selected={fileManagerNewTabPathMode === 'root'}
                label={$t('根目录')}
                description={$t('新标签始终从根目录开始')}
                onClick={() => onFileManagerNewTabPathModeChange('root')}
              />
              <RadioOption
                definition={settings.fileManager.fields.newTabSessionPath}
                selected={fileManagerNewTabPathMode === 'session_initial_path'}
                label={$t('服务器初始目录')}
                description={$t('优先使用当前服务器配置中的文件管理器初始目录，未填写时使用当前终端启动目录')}
                onClick={() => onFileManagerNewTabPathModeChange('session_initial_path')}
              />
              <RadioOption
                definition={settings.fileManager.fields.newTabTerminalPath}
                selected={fileManagerNewTabPathMode === 'terminal_cwd'}
                label={$t('当前终端目录')}
                description={$t('使用当前终端最近一次上报的工作目录')}
                onClick={() => onFileManagerNewTabPathModeChange('terminal_cwd')}
              />
            </div>
          </div>
        </SettingsPanel>
      </div>
      <div>
        <SettingsSectionTitle definition={settings.fileManager.sections.concurrency} />
        <SettingsPanel>
          <SettingRow
            definition={settings.fileManager.fields.chunkSize}
            description={withDefaultValue($t('控制单个文件上传时的默认分块大小'), '256 KiB')}
            action={<input id="fm-chunk-size" name="fm-chunk-size" className="input" type="number" autoComplete="off" value={fileManagerUploadChunkSizeKiB} onChange={onFileManagerUploadChunkSizeKiBChange} style={{ width: 160, textAlign: 'right' }} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.maxTransferTasks}
            description={renderWarningDescription(withTransferDefaultValue($t('控制当前会话内同时进行的上传和下载任务数量,每个文件或文件夹都算一个任务'), '6'), $t('增大后可能提高同一会话内的 SFTP/SSH 通道占用'))}
            action={<input id="fm-max-transfer-tasks" name="fm-max-transfer-tasks" className="input" type="number" autoComplete="off" value={fileManagerUploadMaxFiles} onChange={onFileManagerUploadMaxFilesChange} style={{ width: 160, textAlign: 'right' }} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.maxChunksPerFile}
            description={renderWarningDescription(withDefaultValue($t('控制单个文件在同一时间允许并发传输的分块数量'), '8'), $t('在压缩传输或原生单文件传输场景下,增大后可能提高同一会话内的 SFTP/SSH 通道占用'))}
            action={<input id="fm-max-chunks-per-file" name="fm-max-chunks-per-file" className="input" type="number" autoComplete="off" value={fileManagerUploadMaxChunksPerFile} onChange={onFileManagerUploadMaxChunksPerFileChange} style={{ width: 160, textAlign: 'right' }} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.globalInflightLimit}
            description={renderWarningDescription(withDefaultValue($t('控制所有上传任务共享的在途分块总数'), '24'), $t('在前端分块上传场景下,增大后可能提高同一会话内的 SFTP/SSH 通道占用'))}
            action={<input id="fm-global-inflight-limit" name="fm-global-inflight-limit" className="input" type="number" autoComplete="off" value={fileManagerUploadGlobalInflightLimit} onChange={onFileManagerUploadGlobalInflightLimitChange} style={{ width: 160, textAlign: 'right' }} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.maxPacketSize}
            description={withTransferDefaultValue($t('单个 SFTP 数据包的载荷上限,高延迟链路上调大可显著提速;如果服务器不接受会自动回退'), '128 KiB')}
            action={<input id="fm-max-packet-size" name="fm-max-packet-size" className="input" type="number" autoComplete="off" value={transferMaxPacketKiB} onChange={onTransferMaxPacketKiBChange} style={{ width: 160, textAlign: 'right' }} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.requestPipelineDepth}
            description={withTransferDefaultValue($t('单个文件同时保持在链路上的 SFTP 请求数量;实际生效值会按 SSH 通道窗口自动收窄,填写超出窗口的数值不会提速,只会额外占用资源'), '16')}
            action={<input id="fm-request-pipeline-depth" name="fm-request-pipeline-depth" className="input" type="number" autoComplete="off" value={transferMaxRequestsPerFile} onChange={onTransferMaxRequestsPerFileChange} style={{ width: 160, textAlign: 'right' }} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.concurrentWrites}
            description={$t('开启后单次写入内部并行发包,不再逐包等待服务器确认;关闭则退回逐包串行,速度会明显变慢')}
            action={<ToggleSwitch checked={transferConcurrentWrites} onChange={onToggleTransferConcurrentWrites} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.applySharedClient}
            description={$t('开启后下载,文件列表,读写文件都使用同一套调优参数;如果服务器兼容性较差可关闭,仅上传使用调优')}
            action={<ToggleSwitch checked={transferApplyToSharedClient} onChange={onToggleTransferApplyToSharedClient} />}
          />
        </SettingsPanel>
      </div>
      <div>
        <SettingsSectionTitle definition={settings.fileManager.sections.download} />
        <SettingsPanel>
          <SettingRow
            definition={settings.fileManager.fields.askDownloadEveryTime}
            description={$t('开启后，每次下载文件或文件夹前都先询问保存位置；关闭后直接保存到默认位置')}
            action={<ToggleSwitch checked={fileManagerAskDownloadEveryTime} onChange={onToggleFileManagerAskDownloadEveryTime} />}
          />
          <SettingsDivider />
          <div data-settings-field-id={settings.fileManager.fields.downloadConflict.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('下载遇到同名时')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <RadioOption
                definition={settings.fileManager.fields.diffOverwrite}
                selected={fileManagerDownloadConflictStrategy === 'diff_overwrite'}
                label={$t('差异覆盖')}
                description={$t('目录下载时逐文件比较，大小或修改时间任一不同即覆盖，相同则跳过')}
                onClick={() => onFileManagerDownloadConflictStrategyChange('diff_overwrite')}
              />
              <RadioOption
                definition={settings.fileManager.fields.forceOverwrite}
                selected={fileManagerDownloadConflictStrategy === 'force_overwrite'}
                label={$t('强制覆盖')}
                description={$t('文件直接覆盖；文件夹保留多余本地文件，仅覆盖远端存在的同名内容')}
                onClick={() => onFileManagerDownloadConflictStrategyChange('force_overwrite')}
              />
              <RadioOption
                definition={settings.fileManager.fields.promptConflict}
                selected={fileManagerDownloadConflictStrategy === 'prompt'}
                label={$t('每次都询问我')}
                description={$t('首次遇到冲突时询问，并可应用到本次剩余冲突')}
                onClick={() => onFileManagerDownloadConflictStrategyChange('prompt')}
              />
              <RadioOption
                definition={settings.fileManager.fields.autoRenameConflict}
                selected={fileManagerDownloadConflictStrategy === 'auto_rename'}
                label={$t('自动重命名')}
                description={$t('保留已有文件，下载结果自动追加后缀')}
                onClick={() => onFileManagerDownloadConflictStrategyChange('auto_rename')}
              />
            </div>
          </div>
          {fileManagerDownloadConflictStrategy === 'diff_overwrite' ? (
            <>
              <SettingsDivider />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <SettingRow
                  definition={settings.fileManager.fields.compareSize}
                  description={$t('大小不同即判定为差异')}
                  action={<ToggleSwitch checked={fileManagerDownloadConflictDiffBySize} onChange={onToggleFileManagerDownloadConflictDiffBySize} />}
                />
                <SettingRow
                  definition={settings.fileManager.fields.compareMtime}
                  description={$t('修改时间不同即判定为差异')}
                  action={<ToggleSwitch checked={fileManagerDownloadConflictDiffByMtime} onChange={onToggleFileManagerDownloadConflictDiffByMtime} />}
                />
              </div>
            </>
          ) : null}
          {fileManagerDownloadConflictStrategy === 'auto_rename' ? (
            <>
              <SettingsDivider />
              <div data-settings-field-id={settings.fileManager.fields.renameSuffix.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('自动重命名后缀')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                  <RadioOption
                    definition={settings.fileManager.fields.timestampSuffix}
                    selected={fileManagerDownloadRenameSuffixMode === 'timestamp'}
                    label={$t('高精度时间戳')}
                    description={$t('格式：name_yyyymmdd_hhmmss_nnnnnnnnn.ext')}
                    onClick={() => onFileManagerDownloadRenameSuffixModeChange('timestamp')}
                  />
                  <RadioOption
                    definition={settings.fileManager.fields.randomSuffix}
                    selected={fileManagerDownloadRenameSuffixMode === 'random'}
                    label={$t('随机数')}
                    description={$t('格式：name_ab12cd34.ext')}
                    onClick={() => onFileManagerDownloadRenameSuffixModeChange('random')}
                  />
                  <RadioOption
                    definition={settings.fileManager.fields.sequenceSuffix}
                    selected={fileManagerDownloadRenameSuffixMode === 'sequence'}
                    label={$t('顺序号 +1')}
                    description={$t('格式：name_1.ext、name_2.ext，自动在已有最大序号上加 1')}
                    onClick={() => onFileManagerDownloadRenameSuffixModeChange('sequence')}
                  />
                </div>
              </div>
            </>
          ) : null}
          <SettingsDivider />
          <SettingRow
            definition={settings.fileManager.fields.downloadDefaultDir}
            description={(
              <>
                <div>{$t('支持变量：{value}（程序所在目录）', { value: '${APP_DIR}' })}</div>
                <div>{$t('预保存：{path}', { path: fileManagerDownloadDefaultDirPreview || $t('加载中...') })}</div>
              </>
            )}
            action={<input id="fm-download-default-dir" name="fm-download-default-dir" className="input" type="text" autoComplete="off" value={fileManagerDownloadDefaultDir} onChange={onFileManagerDownloadDefaultDirChange} style={{ width: 260 }} />}
          />
        </SettingsPanel>
      </div>
    </SettingsTabRoot>
  );
}