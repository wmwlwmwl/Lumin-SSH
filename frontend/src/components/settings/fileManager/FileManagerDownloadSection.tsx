import { t as $t } from '../../../i18n.ts';
import { RadioOption, ToggleSwitch, SettingRow, SettingsDivider, SettingsPanel, SettingsSectionTitle } from '../SharedComponents';
import { settings } from '../settingDefinitions';
import type { FileManagerTabProps } from './fileManagerTabTypes';

export default function FileManagerDownloadSection({
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
}: FileManagerTabProps) {
  // settingDefinitions.ts 已类型化，直接使用 settings 注册表
  const fmSettings = settings.fileManager;
  return (
    <div>
      <SettingsSectionTitle definition={fmSettings.sections.download} />
      <SettingsPanel>
        <SettingRow
          definition={fmSettings.fields.askDownloadEveryTime}
          description={$t('开启后，每次下载文件或文件夹前都先询问保存位置；关闭后直接保存到默认位置')}
          action={<ToggleSwitch checked={fileManagerAskDownloadEveryTime} onChange={onToggleFileManagerAskDownloadEveryTime} />}
        />
        <SettingsDivider />
        <div data-settings-field-id={fmSettings.fields.downloadConflict.id} className="flex flex-col gap-2">
          <div className="text-base text-primary">{$t('下载遇到同名时')}</div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
            <RadioOption
              definition={fmSettings.fields.diffOverwrite}
              selected={fileManagerDownloadConflictStrategy === 'diff_overwrite'}
              label={$t('差异覆盖')}
              description={$t('目录下载时逐文件比较，大小或修改时间任一不同即覆盖，相同则跳过')}
              onClick={() => onFileManagerDownloadConflictStrategyChange('diff_overwrite')}
            />
            <RadioOption
              definition={fmSettings.fields.forceOverwrite}
              selected={fileManagerDownloadConflictStrategy === 'force_overwrite'}
              label={$t('强制覆盖')}
              description={$t('文件直接覆盖；文件夹保留多余本地文件，仅覆盖远端存在的同名内容')}
              onClick={() => onFileManagerDownloadConflictStrategyChange('force_overwrite')}
            />
            <RadioOption
              definition={fmSettings.fields.promptConflict}
              selected={fileManagerDownloadConflictStrategy === 'prompt'}
              label={$t('每次都询问我')}
              description={$t('首次遇到冲突时询问，并可应用到本次剩余冲突')}
              onClick={() => onFileManagerDownloadConflictStrategyChange('prompt')}
            />
            <RadioOption
              definition={fmSettings.fields.autoRenameConflict}
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
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              <SettingRow
                definition={fmSettings.fields.compareSize}
                description={$t('大小不同即判定为差异')}
                action={<ToggleSwitch checked={fileManagerDownloadConflictDiffBySize} onChange={onToggleFileManagerDownloadConflictDiffBySize} />}
              />
              <SettingRow
                definition={fmSettings.fields.compareMtime}
                description={$t('修改时间不同即判定为差异')}
                action={<ToggleSwitch checked={fileManagerDownloadConflictDiffByMtime} onChange={onToggleFileManagerDownloadConflictDiffByMtime} />}
              />
            </div>
          </>
        ) : null}
        {fileManagerDownloadConflictStrategy === 'auto_rename' ? (
          <>
            <SettingsDivider />
            <div data-settings-field-id={fmSettings.fields.renameSuffix.id} className="flex flex-col gap-2">
              <div className="text-base text-primary">{$t('自动重命名后缀')}</div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
                <RadioOption
                  definition={fmSettings.fields.timestampSuffix}
                  selected={fileManagerDownloadRenameSuffixMode === 'timestamp'}
                  label={$t('高精度时间戳')}
                  description={$t('格式：name_yyyymmdd_hhmmss_nnnnnnnnn.ext')}
                  onClick={() => onFileManagerDownloadRenameSuffixModeChange('timestamp')}
                />
                <RadioOption
                  definition={fmSettings.fields.randomSuffix}
                  selected={fileManagerDownloadRenameSuffixMode === 'random'}
                  label={$t('随机数')}
                  description={$t('格式：name_ab12cd34.ext')}
                  onClick={() => onFileManagerDownloadRenameSuffixModeChange('random')}
                />
                <RadioOption
                  definition={fmSettings.fields.sequenceSuffix}
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
          definition={fmSettings.fields.downloadDefaultDir}
          description={(
            <>
              <div>{$t('支持变量：{value}（程序所在目录）', { value: '${APP_DIR}' })}</div>
              <div>{$t('预保存：{path}', { path: fileManagerDownloadDefaultDirPreview || $t('加载中...') })}</div>
            </>
          )}
          action={<input id="fm-download-default-dir" name="fm-download-default-dir" className="input w-[260px]" type="text" autoComplete="off" value={fileManagerDownloadDefaultDir} onChange={onFileManagerDownloadDefaultDirChange} />}
        />
      </SettingsPanel>
    </div>
  );
}
