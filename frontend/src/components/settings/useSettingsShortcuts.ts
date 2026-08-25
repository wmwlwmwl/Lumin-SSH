import { useState, useEffect } from 'react';
import { t as $t } from '../../i18n.ts';
import { getModKey, buildCombo } from '../../utils/platform.ts';
import type { ToastFn } from './useSettingsGeneralState';

const defaultShortcuts = {
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  pasteSelection: 'Ctrl+Shift+V',
  clear: 'Ctrl+L',
  newTab: 'Ctrl+T',
  find: 'Ctrl+F',
  sigint: 'Ctrl+C',
  eof: 'Ctrl+D',
  suspend: 'Ctrl+Z',
  clearLine: 'Ctrl+U',
};

export function useSettingsShortcuts({ handleClose, addToast }: { handleClose: () => void; addToast: ToastFn }) {
  const [shortcuts, setShortcuts] = useState(() => {
    try {
      const saved = localStorage.getItem('appShortcuts');
      return saved ? { ...defaultShortcuts, ...JSON.parse(saved) } : defaultShortcuts;
    } catch {
      return defaultShortcuts;
    }
  });
  const [listeningKey, setListeningKey] = useState<string | null>(null); // 'copy' | 'paste' | 'clear' | 'newTab' | null

  const handleResetShortcuts = () => {
    const defaults = { ...defaultShortcuts };
    setListeningKey(null);
    setShortcuts(defaults);
    localStorage.removeItem('appShortcuts');
    window.dispatchEvent(new CustomEvent('app-shortcuts-changed', { detail: defaults }));
    addToast($t('恢复成功'), 'success');
  };

  // Esc 关闭模态框（仅在未监听快捷键时生效）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !listeningKey) {
        if (document.querySelector('[data-global-dialog-active="true"]')) return;
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [listeningKey, handleClose]);

  // 监听并捕捉组合快捷键
  useEffect(() => {
    if (!listeningKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setListeningKey(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      // macOS 上主快捷键为 ⌘（getModKey），同时允许物理 ⌃ 录制（两者存为同一 "Ctrl+…"，
      // 运行时信号类快捷键会同时匹配两种组合键）；否则按 ⌃C 会录成无修饰的 "C"，
      // 导致普通字母键也被当作快捷键触发
      const combined = buildCombo(e, e.ctrlKey || getModKey(e));

      const updated = { ...shortcuts, [listeningKey]: combined };
      setShortcuts(updated);
      localStorage.setItem('appShortcuts', JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('app-shortcuts-changed', { detail: updated }));

      addToast($t('终端快捷键已修改为') + ` ${combined}`, 'success');
      setListeningKey(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningKey, addToast]);

  return {
    shortcuts,
    listeningKey,
    setListeningKey,
    handleResetShortcuts,
  };
}
