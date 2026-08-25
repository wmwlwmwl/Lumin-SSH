import { useState } from 'react';
import { t as $t } from '../../../i18n.ts';
import { WindowSetSize, WindowUnmaximise } from '../../../../wailsjs/runtime/runtime.js';
import { getTerminalTheme } from '../../../utils/theme.ts';
import AppearanceTab from '../AppearanceTab';
import { useThemePackages } from './useThemePackages.ts';
import { useBackgroundSettings } from './useBackgroundSettings.ts';
import { useProgramFonts } from './useProgramFonts.ts';
import { useTerminalPreferences } from './useTerminalPreferences.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

interface AppearanceTabPaneProps {
  activeTab: string;
  addToast: AddToast;
  forceDarkTheme: boolean;
  handleClose: () => void;
  probePanelPosition: 'left' | 'right';
  onProbePanelPositionChange: (pos: 'left' | 'right') => void;
}

/** 外观域容器：常驻挂载持有主题/背景/字体/终端偏好状态，仅在外观页签激活时渲染 AppearanceTab */
export default function AppearanceTabPane({
  activeTab,
  addToast,
  forceDarkTheme,
  handleClose,
  probePanelPosition,
  onProbePanelPositionChange,
}: AppearanceTabPaneProps) {
  const {
    themePackages, themePackageSettings, themeMode,
    handleThemeChange, handleSelectThemePackage, handleReloadThemePackages,
    handleOpenThemePackagesDirectory, handleImportThemePackages, handleStartAIThemeTuning,
    handleDeleteThemePackage, handleCopyThemePackageToMode, themePackageBusy,
  } = useThemePackages({ addToast, forceDarkTheme, handleClose });

  const {
    termBgImage, globalBgImage, bgTargetMode,
    handleBgTargetModeChange, handleBgUpload, handleBgReset,
    termBgOpacity, globalBgOpacity, handleBgOpacityChange,
    globalIconOpacity, handleGlobalIconOpacityChange,
  } = useBackgroundSettings({ addToast });

  const {
    programFonts, programFontSearchQuery, setProgramFontSearchQuery,
    handleAddProgramFonts, programFontImporting, handleDeleteProgramFont,
    programFontAssignments,
    handleProgramFontDragStart, handleProgramFontDragEnd, handleProgramFontDragEnter,
    handleProgramFontDragLeave, handleProgramFontDrop, handleProgramFontReset,
    activeProgramFontDropTarget, programFontDeleting,
  } = useProgramFonts({ addToast });

  const {
    terminalFontSize, handleTerminalFontChange,
    terminalLocalEcho, handleTerminalLocalEchoChange,
    terminalTimestamps, handleTerminalTimestampsChange,
    terminalCommandBlocks, handleTerminalCommandBlocksChange,
    terminalDefaultMouseCursor, handleTerminalDefaultMouseCursorChange,
    terminalKeywordHighlight, handleTerminalKeywordHighlightChange,
    keywordRules, handleKeywordRulesChange, handleKeywordRulesReset,
    showThemeQuickEntry, handleToggleThemeQuickEntry,
    terminalToolbarIconOnly, handleToggleTerminalToolbarIconOnly,
  } = useTerminalPreferences();

  const [rememberWindowSize, setRememberWindowSize] = useState(localStorage.getItem('rememberWindowSize') !== 'false');

  const handleToggleRememberWindowSize = () => {
    const next = !rememberWindowSize;
    setRememberWindowSize(next);
    localStorage.setItem('rememberWindowSize', String(next));
    if (!next) localStorage.removeItem('windowSize');
  };

  const handleResetWindowSize = () => {
    localStorage.removeItem('windowSize');
    WindowUnmaximise();
    const w = Math.min(1440, Math.floor(screen.width * 0.9));
    const h = Math.min(900, Math.floor(screen.height * 0.9));
    WindowSetSize(w, h);
    addToast($t('窗口大小已恢复默认'), 'success');
  };

  if (activeTab !== 'appearance') return null;
  return (
    <AppearanceTab
          programFonts={programFonts}
          programFontSearchQuery={programFontSearchQuery}
          onProgramFontSearchQueryChange={setProgramFontSearchQuery}
          onAddProgramFonts={handleAddProgramFonts}
          programFontImporting={programFontImporting}
          onDeleteProgramFont={(fileName) => { void handleDeleteProgramFont(fileName); }}
          programFontAssignments={programFontAssignments}
          onProgramFontDragStart={handleProgramFontDragStart}
          onProgramFontDragEnd={handleProgramFontDragEnd}
          onProgramFontDragEnter={handleProgramFontDragEnter}
          onProgramFontDragLeave={handleProgramFontDragLeave}
          onProgramFontDrop={(target, fileName) => { void handleProgramFontDrop(target, fileName); }}
          onProgramFontReset={(target) => { void handleProgramFontReset(target); }}
          activeProgramFontDropTarget={activeProgramFontDropTarget || null}
          // AppearanceTab 的 programFontDeleting 为 string | null，仅作 truthiness 使用
          programFontDeleting={programFontDeleting ? 'busy' : null}
          terminalFontSize={terminalFontSize}
          onTerminalFontSizeChange={handleTerminalFontChange}
          terminalLocalEcho={terminalLocalEcho}
          onTerminalLocalEchoChange={handleTerminalLocalEchoChange}
          terminalTimestamps={terminalTimestamps}
          onTerminalTimestampsChange={handleTerminalTimestampsChange}
          terminalCommandBlocks={terminalCommandBlocks}
          onTerminalCommandBlocksChange={handleTerminalCommandBlocksChange}
          terminalDefaultMouseCursor={terminalDefaultMouseCursor}
          onTerminalDefaultMouseCursorChange={handleTerminalDefaultMouseCursorChange}
          terminalKeywordHighlight={terminalKeywordHighlight}
          onTerminalKeywordHighlightChange={handleTerminalKeywordHighlightChange}
          keywordRules={keywordRules}
          onKeywordRulesChange={handleKeywordRulesChange}
          onKeywordRulesReset={handleKeywordRulesReset}
          terminalBgColor={(() => { try { return getTerminalTheme()?.container?.containerBg || ''; } catch (_) { return ''; } })()}
          themePackages={themePackages}
          // AppearanceTab 本地 ThemePackageSettings 带索引签名（宽松形状），theme.ts 接口无索引签名，桥接
          themePackageSettings={themePackageSettings as unknown as { lightThemePackageId?: string; darkThemePackageId?: string; [key: string]: unknown }}
          themeMode={forceDarkTheme ? 'dark' : themeMode}
          onThemeChange={forceDarkTheme ? () => {} : handleThemeChange}
          onSelectLightThemePackage={(packageId) => { void handleSelectThemePackage('light', packageId); }}
          onSelectDarkThemePackage={(packageId) => { void handleSelectThemePackage('dark', packageId); }}
          onReloadThemePackages={() => { void handleReloadThemePackages(); }}
          onOpenThemePackagesDirectory={() => { void handleOpenThemePackagesDirectory(); }}
          onImportThemePackages={() => { void handleImportThemePackages(); }}
          onTuneActiveThemeWithAI={() => { handleStartAIThemeTuning(); }}
          onDeleteThemePackage={(themePackage) => { void handleDeleteThemePackage(themePackage); }}
          onCopyThemePackageToMode={(themePackage, targetMode) => { void handleCopyThemePackageToMode(themePackage, targetMode); }}
          themePackageBusy={themePackageBusy}
          showThemeQuickEntry={showThemeQuickEntry}
          onToggleThemeQuickEntry={handleToggleThemeQuickEntry}
          probePanelPosition={probePanelPosition}
          onProbePanelPositionChange={onProbePanelPositionChange}
          terminalToolbarIconOnly={terminalToolbarIconOnly}
          onToggleTerminalToolbarIconOnly={handleToggleTerminalToolbarIconOnly}
          termBgImage={termBgImage}
          globalBgImage={globalBgImage}
          bgTargetMode={bgTargetMode}
          onBgTargetModeChange={handleBgTargetModeChange}
          onBgUpload={handleBgUpload}
          onBgReset={handleBgReset}
          termBgOpacity={termBgOpacity}
          globalBgOpacity={globalBgOpacity}
          onBgOpacityChange={handleBgOpacityChange}
          globalIconOpacity={globalIconOpacity}
          onGlobalIconOpacityChange={handleGlobalIconOpacityChange}
          rememberWindowSize={rememberWindowSize}
          onToggleRememberWindowSize={handleToggleRememberWindowSize}
          onResetWindowSize={handleResetWindowSize}
      />
  );
}
