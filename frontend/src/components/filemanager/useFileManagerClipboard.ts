import { useState, useEffect } from 'react';
import type { useFileManagerCore } from './useFileManagerCore.ts';

// 跨实例共享剪贴板（挂在 window.__luminClipboards，按 sessionGroup 隔离）
export function useFileManagerClipboard(deps: ReturnType<typeof useFileManagerCore>) {
  const { sessionGroupId } = deps;
  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: 'copy' | 'cut'; srcDir: string } | null>(null); // { paths, mode, srcDir }

  const updateClipboard = (newClipboard: unknown) => {
    if (!window.__luminClipboards) {
      window.__luminClipboards = {};
    }
    if (newClipboard) {
      window.__luminClipboards[sessionGroupId] = newClipboard;
    } else {
      delete window.__luminClipboards[sessionGroupId];
    }
    setClipboard(newClipboard as { paths: string[]; mode: 'copy' | 'cut'; srcDir: string } | null);
    window.dispatchEvent(new CustomEvent('lumin-clipboard-changed', {
      detail: { sessionGroupId, clipboard: newClipboard }
    }));
  };

  useEffect(() => {
    const cached = (window.__luminClipboards && window.__luminClipboards[sessionGroupId]) || null;
    setClipboard(cached as { paths: string[]; mode: 'copy' | 'cut'; srcDir: string } | null);

    const handleClipboardChange = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      if (detail && detail.sessionGroupId === sessionGroupId) {
        setClipboard(detail.clipboard);
      }
    };

    window.addEventListener('lumin-clipboard-changed', handleClipboardChange);
    return () => {
      window.removeEventListener('lumin-clipboard-changed', handleClipboardChange);
    };
  }, [sessionGroupId]);

  // 卸载或切换 sessionGroup 时清理全局剪贴板缓存，防止内存泄漏与 sessionGroupId 复用时复活幽灵剪贴板
  useEffect(() => {
    return () => {
      if (window.__luminClipboards) {
        delete window.__luminClipboards[sessionGroupId];
      }
    };
  }, [sessionGroupId]);

  return { clipboard, setClipboard, updateClipboard };
}
