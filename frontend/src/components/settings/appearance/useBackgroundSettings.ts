import { useState } from 'react';
import { t as $t } from '../../../i18n.ts';
import { getGlobalAppearanceSettings, notifyGlobalAppearanceChanged } from '../../../utils/globalAppearance.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

/** 背景图设置：全局/终端背景切换、上传/恢复、可见度与图标透明度 */
export function useBackgroundSettings({ addToast }: { addToast: AddToast }) {
  const [termBgImage, setTermBgImage] = useState(localStorage.getItem('termBgImage') || '');
  const [termBgOpacity, setTermBgOpacity] = useState(parseFloat(localStorage.getItem('termBgOpacity') || '0.15'));
  const [globalBgImage, setGlobalBgImage] = useState(() => getGlobalAppearanceSettings().backgroundImage);
  const [globalBgOpacity, setGlobalBgOpacity] = useState(() => getGlobalAppearanceSettings().backgroundOpacity);
  const [globalIconOpacity, setGlobalIconOpacity] = useState(() => getGlobalAppearanceSettings().iconOpacity);
  const [bgTargetMode, setBgTargetMode] = useState<'global' | 'terminal'>(() => {
    const stored = localStorage.getItem('bgTargetMode');
    if (stored === 'terminal' || stored === 'global') return stored;
    // 无记录时推断：仅有终端壁纸则默认终端，否则全局
    return localStorage.getItem('termBgImage') && !localStorage.getItem('globalBgImage') ? 'terminal' : 'global';
  });

  const handleBgTargetModeChange = (mode: 'global' | 'terminal') => {
    if (mode === bgTargetMode) return;
    localStorage.setItem('bgTargetMode', mode);
    // 切换背景类型：将当前背景图迁移到新目标（图像保留，仅切换应用范围）
    // 先删旧键再写新键，避免大图在 localStorage 中瞬时双份导致配额溢出
    try {
      if (mode === 'terminal') {
        // 全局 → 终端：图像迁移到终端
        localStorage.removeItem('globalBgImage');
        if (globalBgImage) {
          localStorage.setItem('termBgImage', globalBgImage);
        } else {
          localStorage.removeItem('termBgImage');
        }
        setTermBgImage(globalBgImage);
        localStorage.setItem('termBgOpacity', String(globalBgOpacity));
        setTermBgOpacity(globalBgOpacity);
        setGlobalBgImage('');
      } else {
        // 终端 → 全局：图像迁移到全局
        localStorage.removeItem('termBgImage');
        if (termBgImage) {
          localStorage.setItem('globalBgImage', termBgImage);
        } else {
          localStorage.removeItem('globalBgImage');
        }
        setGlobalBgImage(termBgImage);
        const opacity = Math.min(0.5, Math.max(0, termBgOpacity));
        localStorage.setItem('globalBgOpacity', String(opacity));
        setGlobalBgOpacity(opacity);
        setTermBgImage('');
      }
    } catch {
      addToast($t('图片过大，无法保存，请使用较小的图片'), 'error');
      return;
    }
    setBgTargetMode(mode);
    notifyGlobalAppearanceChanged();
    window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
    addToast(mode === 'global' ? $t('全局背景已更新') : $t('终端壁纸已更新'), 'success');
  };

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = typeof ev.target?.result === 'string' ? ev.target.result : '';
      try {
        if (bgTargetMode === 'global') {
          localStorage.removeItem('termBgImage');
          localStorage.setItem('globalBgImage', base64);
          setGlobalBgImage(base64);
          setTermBgImage('');
          notifyGlobalAppearanceChanged();
          window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
          addToast($t('全局背景已更新'), 'success');
        } else {
          localStorage.removeItem('globalBgImage');
          localStorage.setItem('termBgImage', base64);
          setTermBgImage(base64);
          setGlobalBgImage('');
          notifyGlobalAppearanceChanged();
          window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
          addToast($t('终端壁纸已更新'), 'success');
        }
      } catch {
        addToast($t('图片过大，无法保存，请使用较小的图片'), 'error');
      }
    };
    reader.onerror = () => addToast($t('读取图片失败'), 'error');
    reader.readAsDataURL(file);
  };

  const handleBgReset = () => {
    if (bgTargetMode === 'global') {
      localStorage.removeItem('globalBgImage');
      setGlobalBgImage('');
      notifyGlobalAppearanceChanged();
      addToast($t('已恢复默认背景'), 'success');
    } else {
      localStorage.removeItem('termBgImage');
      setTermBgImage('');
      window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
      addToast($t('已恢复默认壁纸'), 'success');
    }
  };

  const handleBgOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (bgTargetMode === 'global') {
      const value = Math.min(0.5, Math.max(0, Number.parseFloat(e.target.value) || 0));
      localStorage.setItem('globalBgOpacity', String(value));
      setGlobalBgOpacity(value);
      notifyGlobalAppearanceChanged();
    } else {
      const val = Math.min(1, Math.max(0, Number.parseFloat(e.target.value) || 0));
      localStorage.setItem('termBgOpacity', String(val));
      setTermBgOpacity(val);
      window.dispatchEvent(new CustomEvent('terminal-bg-changed'));
    }
  };

  const handleGlobalIconOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.min(1, Math.max(0.4, Number.parseFloat(e.target.value) || 1));
    localStorage.setItem('globalIconOpacity', String(value));
    setGlobalIconOpacity(value);
    notifyGlobalAppearanceChanged();
  };

  return {
    termBgImage,
    termBgOpacity,
    globalBgImage,
    globalBgOpacity,
    globalIconOpacity,
    bgTargetMode,
    handleBgTargetModeChange,
    handleBgUpload,
    handleBgReset,
    handleBgOpacityChange,
    handleGlobalIconOpacityChange,
  };
}
