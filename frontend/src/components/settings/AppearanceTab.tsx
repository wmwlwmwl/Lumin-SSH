import React from 'react';
import { t as $t } from '../../i18n.ts';
import { Sun, Monitor, Moon } from 'lucide-react';
import { cn } from '../../utils/cn.ts';
import { Button } from '../ui';
import { SettingRow, SettingsDivider, SettingsPanel, SettingsSectionTitle, SettingsTabRoot, ToggleSwitch } from './SharedComponents';
import { settings } from './settingDefinitions';
import KeywordRulesPanel from './KeywordRulesPanel.tsx';
import { type KeywordRule } from '../../utils/terminalKeywordHighlight.ts';
import type { ThemePackage } from '../../utils/theme.ts';
import FontManagerPanel, { type ProgramFont } from './appearance/FontManagerPanel';
import BackgroundPanel from './appearance/BackgroundPanel';
import ThemePackagePalette from './appearance/ThemePackagePalette';

/** 主题包设置（SettingsModal 传入的宽松形状） */
interface ThemePackageSettings {
  lightThemePackageId?: string;
  darkThemePackageId?: string;
  [key: string]: unknown;
}

export interface AppearanceTabProps {
  programFonts: ProgramFont[];
  programFontSearchQuery: string;
  onProgramFontSearchQueryChange: (query: string) => void;
  onAddProgramFonts: () => void;
  programFontImporting: boolean;
  programFontDeleting: string | null;
  onDeleteProgramFont?: (fileName: string) => void;
  programFontAssignments: { uiFileName?: string; terminalFileName?: string; aiFileName?: string };
  onProgramFontDragStart: (event: React.DragEvent, fileName: string) => void;
  onProgramFontDragEnd: () => void;
  onProgramFontDragEnter: (key: string) => void;
  onProgramFontDragLeave: (key: string) => void;
  onProgramFontDrop: (key: string, fileName: string) => void;
  onProgramFontReset: (key: string) => void;
  activeProgramFontDropTarget: string | null;
  terminalFontSize: number;
  onTerminalFontSizeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  terminalLocalEcho: boolean;
  onTerminalLocalEchoChange: (v: boolean) => void;
  terminalTimestamps: boolean;
  onTerminalTimestampsChange: (v: boolean) => void;
  terminalCommandBlocks: boolean;
  onTerminalCommandBlocksChange: (v: boolean) => void;
  terminalDefaultMouseCursor: boolean;
  onTerminalDefaultMouseCursorChange: (v: boolean) => void;
  terminalKeywordHighlight: boolean;
  onTerminalKeywordHighlightChange: (v: boolean) => void;
  keywordRules: KeywordRule[];
  onKeywordRulesChange: (rules: KeywordRule[]) => void;
  onKeywordRulesReset: () => void;
  terminalBgColor: string;
  themePackages: ThemePackage[];
  themePackageSettings: ThemePackageSettings;
  themeMode: string;
  onThemeChange: (mode: string) => void;
  onSelectLightThemePackage: (id: string) => void;
  onSelectDarkThemePackage: (id: string) => void;
  onReloadThemePackages: () => void;
  onOpenThemePackagesDirectory: () => void;
  onImportThemePackages: () => void;
  onTuneActiveThemeWithAI: () => void;
  onDeleteThemePackage?: (themePackage: ThemePackage) => void;
  onCopyThemePackageToMode?: (themePackage: ThemePackage, targetMode: string) => void;
  themePackageBusy: boolean;
  showThemeQuickEntry: boolean;
  onToggleThemeQuickEntry: () => void;
  probePanelPosition: 'left' | 'right';
  onProbePanelPositionChange: (position: 'left' | 'right') => void;
  terminalToolbarIconOnly: boolean;
  onToggleTerminalToolbarIconOnly: () => void;
  termBgImage: string;
  globalBgImage: string;
  bgTargetMode: 'global' | 'terminal';
  onBgTargetModeChange: (mode: 'global' | 'terminal') => void;
  onBgUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBgReset: () => void;
  termBgOpacity: number;
  globalBgOpacity: number;
  onBgOpacityChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  globalIconOpacity: number;
  onGlobalIconOpacityChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  rememberWindowSize: boolean;
  onToggleRememberWindowSize: () => void;
  onResetWindowSize: () => void;
}

export default function AppearanceTab({
  programFonts,
  programFontSearchQuery,
  onProgramFontSearchQueryChange,
  onAddProgramFonts,
  programFontImporting,
  programFontDeleting,
  onDeleteProgramFont,
  programFontAssignments,
  onProgramFontDragStart,
  onProgramFontDragEnd,
  onProgramFontDragEnter,
  onProgramFontDragLeave,
  onProgramFontDrop,
  onProgramFontReset,
  activeProgramFontDropTarget,
  terminalFontSize, onTerminalFontSizeChange,
  terminalLocalEcho, onTerminalLocalEchoChange,
  terminalTimestamps, onTerminalTimestampsChange,
  terminalCommandBlocks, onTerminalCommandBlocksChange,
  terminalDefaultMouseCursor, onTerminalDefaultMouseCursorChange,
  terminalKeywordHighlight, onTerminalKeywordHighlightChange,
  keywordRules, onKeywordRulesChange, onKeywordRulesReset, terminalBgColor,
  themePackages,
  themePackageSettings,
  themeMode, onThemeChange,
  onSelectLightThemePackage,
  onSelectDarkThemePackage,
  onReloadThemePackages,
  onOpenThemePackagesDirectory,
  onImportThemePackages,
  onTuneActiveThemeWithAI,
  onDeleteThemePackage,
  onCopyThemePackageToMode,
  themePackageBusy,
  showThemeQuickEntry, onToggleThemeQuickEntry,
  probePanelPosition, onProbePanelPositionChange,
  terminalToolbarIconOnly, onToggleTerminalToolbarIconOnly,
  termBgImage, globalBgImage,
  bgTargetMode, onBgTargetModeChange,
  onBgUpload, onBgReset,
  termBgOpacity, globalBgOpacity, onBgOpacityChange,
  globalIconOpacity, onGlobalIconOpacityChange,
  rememberWindowSize, onToggleRememberWindowSize, onResetWindowSize,
}: AppearanceTabProps) {
  // settingDefinitions.ts 已类型化，直接使用 settings 注册表
  const settingsData = settings;
  const appearanceSettings = settingsData.appearance;
  const normalizedThemePackages = Array.isArray(themePackages) ? themePackages : [];
  const lightThemePackages = normalizedThemePackages.filter((themePackage) => themePackage?.modeHint === 'light');
  const darkThemePackages = normalizedThemePackages.filter((themePackage) => themePackage?.modeHint !== 'light');

  return (
    <SettingsTabRoot>
      <div>
        <SettingsSectionTitle definition={appearanceSettings.sections.terminal} />
        <SettingsPanel className="p-3 border-line-subtle">
          <FontManagerPanel
            programFonts={programFonts}
            programFontSearchQuery={programFontSearchQuery}
            onProgramFontSearchQueryChange={onProgramFontSearchQueryChange}
            onAddProgramFonts={onAddProgramFonts}
            programFontImporting={programFontImporting}
            programFontDeleting={programFontDeleting}
            onDeleteProgramFont={onDeleteProgramFont}
            programFontAssignments={programFontAssignments}
            onProgramFontDragStart={onProgramFontDragStart}
            onProgramFontDragEnd={onProgramFontDragEnd}
            onProgramFontDragEnter={onProgramFontDragEnter}
            onProgramFontDragLeave={onProgramFontDragLeave}
            onProgramFontDrop={onProgramFontDrop}
            onProgramFontReset={onProgramFontReset}
            activeProgramFontDropTarget={activeProgramFontDropTarget}
          />
          <SettingsDivider margin="12px 0 8px" />
          <SettingRow
            definition={appearanceSettings.fields.terminalFontSize}
            description={$t('调节终端的字符显示大小')}
            action={(
              <div className="flex items-center gap-3">
                <input
                  id="appearance-terminal-font-size"
                  name="appearance-terminal-font-size"
                  autoComplete="off"
                  type="range"
                  min="10"
                  max="28"
                  step="1"
                  value={terminalFontSize}
                  onChange={onTerminalFontSizeChange}
                  className="cursor-pointer"
                />
                <span className="text-base w-8 text-right text-primary">{terminalFontSize}px</span>
              </div>
            )}
          />
          <SettingsDivider />
          <SettingRow
            definition={appearanceSettings.fields.terminalLocalEcho}
            description={$t('关闭后输入密码等敏感内容时不会显示字符')}
            action={<ToggleSwitch checked={terminalLocalEcho} onChange={() => onTerminalLocalEchoChange(!terminalLocalEcho)} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={appearanceSettings.fields.terminalTimestamps}
            description={$t('在终端每行输出前添加时间戳')}
            action={<ToggleSwitch checked={terminalTimestamps} onChange={() => onTerminalTimestampsChange(!terminalTimestamps)} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={appearanceSettings.fields.terminalCommandBlocks}
            description={$t('左侧显示可折叠命令块，点击收起输出')}
            action={<ToggleSwitch checked={terminalCommandBlocks} onChange={() => onTerminalCommandBlocksChange(!terminalCommandBlocks)} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={appearanceSettings.fields.terminalDefaultMouseCursor}
            description={$t('开启后, 终端输出区域使用系统默认鼠标指针, 不显示工字型文本光标')}
            action={<ToggleSwitch checked={terminalDefaultMouseCursor} onChange={() => onTerminalDefaultMouseCursorChange(!terminalDefaultMouseCursor)} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={appearanceSettings.fields.terminalKeywordHighlight}
            description={$t('对 error、warning、info、success 等关键字着色显示')}
            action={<ToggleSwitch checked={terminalKeywordHighlight} onChange={() => onTerminalKeywordHighlightChange(!terminalKeywordHighlight)} />}
          />
          {terminalKeywordHighlight && (
            <KeywordRulesPanel
              rules={keywordRules}
              onRulesChange={onKeywordRulesChange}
              onResetDefault={onKeywordRulesReset}
              terminalBg={terminalBgColor}
            />
          )}
        </SettingsPanel>
      </div>

      <div>
        <SettingsSectionTitle definition={appearanceSettings.sections.theme} />
        <SettingsPanel>
          <div data-settings-field-id={appearanceSettings.fields.theme.id} className="flex justify-between items-center gap-3 flex-wrap">
            <div>
              <div className="text-base text-primary">{$t('主题')}</div>
              <div className="text-xs text-tertiary">{$t('浅色、深色和系统模式分别决定当前应用哪一套主题包')}</div>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <button
                type="button"
                onClick={onToggleThemeQuickEntry}
                aria-pressed={showThemeQuickEntry}
                aria-label={$t('快捷入口')}
                className={cn(
                  'inline-flex items-center gap-2.5 min-h-[34px] px-3 rounded-full cursor-pointer select-none whitespace-nowrap transition-colors duration-[80ms] border',
                  showThemeQuickEntry
                    ? 'border-accent-border bg-[rgba(var(--accent-rgb),0.10)] text-primary shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.12)]'
                    : 'border-line bg-raised text-secondary',
                )}
              >
                <span className="text-sm font-semibold">{$t('快捷入口')}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-9 h-5 rounded-full relative transition-colors duration-[80ms] border border-line',
                    showThemeQuickEntry ? 'bg-accent' : 'bg-hover',
                  )}
                >
                  <span
                    className="absolute top-px w-4 h-4 rounded-full bg-white shadow-xs transition-[left] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
                    style={{ left: showThemeQuickEntry ? 17 : 1 }}
                  />
                </span>
              </button>
              <div className="flex bg-raised rounded-xl p-1 border border-line">
                <Button size="sm" variant={themeMode === 'light' ? 'secondary' : 'ghost'} aria-pressed={themeMode === 'light'} onClick={() => onThemeChange('light')} className="rounded-xl gap-1 aria-pressed:bg-sunken aria-pressed:text-secondary aria-pressed:border-line"><Sun size={14} />{$t('浅色')}</Button>
                <Button size="sm" variant={themeMode === 'system' ? 'secondary' : 'ghost'} aria-pressed={themeMode === 'system'} onClick={() => onThemeChange('system')} className="rounded-xl gap-1 aria-pressed:bg-sunken aria-pressed:text-secondary aria-pressed:border-line"><Monitor size={14} />{$t('系统')}</Button>
                <Button size="sm" variant={themeMode === 'dark' ? 'secondary' : 'ghost'} aria-pressed={themeMode === 'dark'} onClick={() => onThemeChange('dark')} className="rounded-xl gap-1 aria-pressed:bg-sunken aria-pressed:text-secondary aria-pressed:border-line"><Moon size={14} />{$t('深色')}</Button>
              </div>
            </div>
          </div>

          <SettingsDivider />
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3.5">
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={onReloadThemePackages} disabled={themePackageBusy}>{$t('重新扫描')}</Button>
              <Button size="sm" onClick={onOpenThemePackagesDirectory} disabled={themePackageBusy}>{$t('打开目录')}</Button>
              <Button size="sm" onClick={onImportThemePackages} disabled={themePackageBusy}>{$t('导入JSON')}</Button>
            </div>
            <Button size="sm" onClick={onTuneActiveThemeWithAI} disabled={themePackageBusy}>{$t('AI调色')}</Button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 items-start">
            <ThemePackagePalette
              definition={appearanceSettings.fields.lightThemePackage}
              title={$t('浅色主题包')}
              description={$t('当主题为浅色或系统切换到浅色时使用')}
              packages={lightThemePackages}
              selectedThemePackageId={themePackageSettings?.lightThemePackageId}
              onSelectThemePackage={onSelectLightThemePackage}
              onDeleteThemePackage={onDeleteThemePackage}
              onCopyThemePackageToMode={onCopyThemePackageToMode}
              copyTargetMode="dark"
              themePackageBusy={themePackageBusy}
            />
            <ThemePackagePalette
              definition={appearanceSettings.fields.darkThemePackage}
              title={$t('深色主题包')}
              description={$t('当主题为深色或系统切换到深色时使用')}
              packages={darkThemePackages}
              selectedThemePackageId={themePackageSettings?.darkThemePackageId}
              onSelectThemePackage={onSelectDarkThemePackage}
              onDeleteThemePackage={onDeleteThemePackage}
              onCopyThemePackageToMode={onCopyThemePackageToMode}
              copyTargetMode="light"
              themePackageBusy={themePackageBusy}
            />
          </div>

          <SettingsDivider />
          <SettingRow
            definition={appearanceSettings.fields.monitorPanel}
            action={(
              <div className="flex bg-raised rounded-xl p-1 border border-line">
                <Button size="sm" variant={probePanelPosition === 'left' ? 'secondary' : 'ghost'} aria-pressed={probePanelPosition === 'left'} onClick={() => onProbePanelPositionChange('left')} className="rounded-xl aria-pressed:bg-sunken aria-pressed:text-secondary aria-pressed:border-line">{$t('左侧')}</Button>
                <Button size="sm" variant={probePanelPosition === 'right' ? 'secondary' : 'ghost'} aria-pressed={probePanelPosition === 'right'} onClick={() => onProbePanelPositionChange('right')} className="rounded-xl aria-pressed:bg-sunken aria-pressed:text-secondary aria-pressed:border-line">{$t('右侧')}</Button>
              </div>
            )}
          />
        </SettingsPanel>
      </div>

      <div>
        <SettingsSectionTitle definition={appearanceSettings.sections.preferences} />
        <SettingsPanel>
          <SettingRow
            definition={appearanceSettings.fields.toolbarIconOnly}
            description={$t('开启后终端工具栏的进程管理、网络监控等按钮只显示图标')}
            action={<ToggleSwitch checked={terminalToolbarIconOnly} onChange={onToggleTerminalToolbarIconOnly} />}
          />
        </SettingsPanel>
      </div>

      <div>
        <SettingsSectionTitle definition={appearanceSettings.sections.background} />
        <SettingsPanel>
          <BackgroundPanel
            termBgImage={termBgImage}
            globalBgImage={globalBgImage}
            bgTargetMode={bgTargetMode}
            onBgTargetModeChange={onBgTargetModeChange}
            onBgUpload={onBgUpload}
            onBgReset={onBgReset}
            termBgOpacity={termBgOpacity}
            globalBgOpacity={globalBgOpacity}
            onBgOpacityChange={onBgOpacityChange}
            globalIconOpacity={globalIconOpacity}
            onGlobalIconOpacityChange={onGlobalIconOpacityChange}
          />
        </SettingsPanel>
      </div>

      <div>
        <SettingsSectionTitle definition={appearanceSettings.sections.window} />
        <SettingsPanel>
          <SettingRow
            definition={appearanceSettings.fields.rememberWindowSize}
            description={$t('下次启动时恢复上次调整的窗口尺寸')}
            action={<ToggleSwitch checked={rememberWindowSize} onChange={onToggleRememberWindowSize} />}
          />
          <SettingsDivider />
          <SettingRow
            definition={appearanceSettings.fields.resetWindowSize}
            description={$t('下次启动时恢复上次调整的窗口尺寸')}
            action={<Button size="sm" className="text-sm" onClick={onResetWindowSize}>{$t('恢复默认大小')}</Button>}
          />
        </SettingsPanel>
      </div>
    </SettingsTabRoot>
  );
}
