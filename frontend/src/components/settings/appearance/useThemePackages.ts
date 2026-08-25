import { useCallback, useEffect, useState } from 'react';
import * as AppGo from '../../../../wailsjs/go/wailsapp/App.js';
import { t as $t, type I18nKey } from '../../../i18n.ts';
import {
  getAppThemeMode,
  getThemePackageSettings as getStoredThemePackageSettings,
  listThemePackages,
  loadThemePackages,
  saveThemePackageSettings,
  type ThemePackage,
} from '../../../utils/theme.ts';
import { settingsConfirm } from '../settingsDialogs.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

interface UseThemePackagesOptions {
  addToast: AddToast;
  forceDarkTheme: boolean;
  handleClose: () => void;
}

/** 主题包：浅色/深色槽位选择、导入/删除/复制、运行时变更监听 */
export function useThemePackages({ addToast, forceDarkTheme, handleClose }: UseThemePackagesOptions) {
  const [themePackageSettings, setThemePackageSettings] = useState(() => getStoredThemePackageSettings());
  const [themePackages, setThemePackages] = useState(() => listThemePackages());
  const [themePackageBusy, setThemePackageBusy] = useState(false);
  const [themeMode, setThemeMode] = useState(getStoredThemePackageSettings().themeMode || 'dark');

  const refreshThemePackages = useCallback(async () => {
    await loadThemePackages();
    const nextSettings = getStoredThemePackageSettings();
    setThemePackageSettings(nextSettings);
    setThemePackages(listThemePackages());
    setThemeMode(nextSettings.themeMode || 'dark');
  }, []);

  const handleThemeChange = async (mode: string) => {
    if (forceDarkTheme) {
      return;
    }
    setThemePackageBusy(true);
    try {
      const nextSettings = await saveThemePackageSettings({
        ...themePackageSettings,
        themeMode: mode,
      });
      setThemePackageSettings(nextSettings);
      setThemePackages(listThemePackages());
      setThemeMode(nextSettings.themeMode || 'dark');
    } catch (err) {
      addToast($t('主题包设置保存失败') + `: ${err}`, 'error');
    } finally {
      setThemePackageBusy(false);
    }
  };

  const handleSelectThemePackage = async (slot: 'light' | 'dark', packageId: string) => {
    if (!packageId) {
      return;
    }
    setThemePackageBusy(true);
    try {
      const nextSettings = await saveThemePackageSettings({
        ...themePackageSettings,
        ...(slot === 'light'
          ? { lightThemePackageId: packageId }
          : { darkThemePackageId: packageId }),
      });
      setThemePackageSettings(nextSettings);
      setThemePackages(listThemePackages());
      setThemeMode(nextSettings.themeMode || 'dark');
    } catch (err) {
      addToast($t('主题包设置保存失败') + `: ${err}`, 'error');
    } finally {
      setThemePackageBusy(false);
    }
  };

  const handleReloadThemePackages = async () => {
    setThemePackageBusy(true);
    try {
      await refreshThemePackages();
      addToast($t('主题包已重新扫描'), 'success');
    } catch (err) {
      addToast($t('重新扫描主题包失败') + `: ${err}`, 'error');
    } finally {
      setThemePackageBusy(false);
    }
  };

  const handleOpenThemePackagesDirectory = async () => {
    try {
      const dirPath = await AppGo.GetThemePackagesDirectory();
      if (!dirPath) {
        return;
      }
      await AppGo.OpenLocalPathInExplorer(dirPath, true);
    } catch (err) {
      addToast($t('打开主题包目录失败') + `: ${err}`, 'error');
    }
  };

  const handleImportThemePackages = async () => {
    try {
      const selectedPaths = await AppGo.SelectThemePackageFiles();
      if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
        return;
      }
      setThemePackageBusy(true);
      await AppGo.ImportThemePackageFiles(selectedPaths);
      await refreshThemePackages();
      addToast($t('主题包已导入'), 'success');
    } catch (err) {
      addToast($t('主题包导入失败') + `: ${err}`, 'error');
    } finally {
      setThemePackageBusy(false);
    }
  };

  const handleDeleteThemePackage = async (themePackage: ThemePackage) => {
    if (!themePackage?.id || themePackage.source === 'builtin') {
      return;
    }
    // 主题包 name 是动态显示名，不是 i18n key，t() 内部对未知 key 原样兜底
    const ok = await settingsConfirm(`${$t('确定删除')}${$t(themePackage.name as I18nKey)}${$t('？此操作不可撤销')}`);
    if (!ok) {
      return;
    }
    setThemePackageBusy(true);
    try {
      await AppGo.DeleteThemePackage(themePackage.id);
      await refreshThemePackages();
      addToast($t('主题包已删除'), 'success');
    } catch (err) {
      addToast($t('主题包删除失败') + `: ${err}`, 'error');
    } finally {
      setThemePackageBusy(false);
    }
  };

  const handleCopyThemePackageToMode = async (themePackage: ThemePackage, targetMode: string) => {
    if (!themePackage?.id || (targetMode !== 'light' && targetMode !== 'dark')) {
      return;
    }
    setThemePackageBusy(true);
    try {
      const copied = await AppGo.CopyThemePackageToMode(themePackage.id, targetMode);
      await refreshThemePackages();
      const copiedId = String(copied?.id || '').trim();
      if (copiedId) {
        await handleSelectThemePackage(targetMode, copiedId);
      }
      addToast(targetMode === 'light' ? $t('主题包已复制到浅色') : $t('主题包已复制到深色'), 'success');
    } catch (err) {
      addToast($t('主题包复制失败') + `: ${err}`, 'error');
    } finally {
      setThemePackageBusy(false);
    }
  };

  const handleStartAIThemeTuning = useCallback((slot?: string) => {
    if (typeof window === 'undefined') {
      return;
    }
    const normalizedSlot = slot === 'light' || slot === 'dark'
      ? slot
      : (getAppThemeMode() === 'light' ? 'light' : 'dark');
    window.dispatchEvent(new CustomEvent('ai-theme-tuning-request', {
      detail: {
        slot: normalizedSlot,
      },
    }));
    handleClose();
  }, [handleClose]);

  useEffect(() => {
    refreshThemePackages().catch(() => {});
  }, [refreshThemePackages]);

  useEffect(() => {
    const handleThemeRuntimeChanged = () => {
      const nextSettings = getStoredThemePackageSettings();
      setThemePackageSettings(nextSettings);
      setThemePackages(listThemePackages());
      setThemeMode(nextSettings.themeMode || 'dark');
    };
    window.addEventListener('theme-package-changed', handleThemeRuntimeChanged);
    window.addEventListener('theme-mode-changed', handleThemeRuntimeChanged);
    return () => {
      window.removeEventListener('theme-package-changed', handleThemeRuntimeChanged);
      window.removeEventListener('theme-mode-changed', handleThemeRuntimeChanged);
    };
  }, []);

  return {
    themePackageSettings,
    themePackages,
    themePackageBusy,
    themeMode,
    handleThemeChange,
    handleSelectThemePackage,
    handleReloadThemePackages,
    handleOpenThemePackagesDirectory,
    handleImportThemePackages,
    handleDeleteThemePackage,
    handleCopyThemePackageToMode,
    handleStartAIThemeTuning,
  };
}
