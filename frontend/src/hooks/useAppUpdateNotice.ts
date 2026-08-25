import { useEffect, useRef, useState } from 'react';
import { formatUpdateError, useUpdateChecker, type UpdateCheckResult } from './useUpdateChecker.ts';

export interface UseAppUpdateNoticeOptions {
  addToast: (message: string | Error, type?: string, duration?: number) => number;
  t: (key: string) => string;
}

export default function useAppUpdateNotice({ addToast, t }: UseAppUpdateNoticeOptions) {
  const [startupUpdateInfo, setStartupUpdateInfo] = useState<{ version: string; url: string; filename: string } | null>(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [showUpdateBubble, setShowUpdateBubble] = useState(false);
  const updateBubbleTimeoutRef = useRef<number | null>(null);
  const updateBubbleRemainingRef = useRef(4000);
  const updateBubbleStartedAtRef = useRef(0);

  const { checkUpdate, applyUpdate, downloadProgress } = useUpdateChecker({
    onResult: (result) => {
      if (result.hasUpdate) {
        setStartupUpdateInfo({
          version: 'v' + result.latestVersion,
          url: result.url,
          filename: result.filename,
        });
      }
    }
  });

  useEffect(() => {
    const timer = setTimeout(checkUpdate, 2500);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  useEffect(() => {
    const clearBubbleTimer = () => {
      if (updateBubbleTimeoutRef.current) {
        clearTimeout(updateBubbleTimeoutRef.current);
        updateBubbleTimeoutRef.current = null;
      }
    };
    const pauseBubbleTimer = () => {
      if (!updateBubbleTimeoutRef.current || !updateBubbleStartedAtRef.current) return;
      const elapsed = Date.now() - updateBubbleStartedAtRef.current;
      updateBubbleRemainingRef.current = Math.max(0, updateBubbleRemainingRef.current - elapsed);
      updateBubbleStartedAtRef.current = 0;
      clearBubbleTimer();
    };
    const startBubbleTimer = () => {
      if (updateBubbleTimeoutRef.current) return;
      if (!startupUpdateInfo || updateBubbleRemainingRef.current <= 0) {
        setShowUpdateBubble(false);
        return;
      }
      if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) return;
      updateBubbleStartedAtRef.current = Date.now();
      updateBubbleTimeoutRef.current = window.setTimeout(() => {
        updateBubbleTimeoutRef.current = null;
        updateBubbleStartedAtRef.current = 0;
        updateBubbleRemainingRef.current = 0;
        setShowUpdateBubble(false);
      }, updateBubbleRemainingRef.current);
    };

    if (!startupUpdateInfo) {
      clearBubbleTimer();
      updateBubbleRemainingRef.current = 4000;
      updateBubbleStartedAtRef.current = 0;
      setShowUpdateBubble(false);
      return undefined;
    }

    clearBubbleTimer();
    updateBubbleRemainingRef.current = 4000;
    updateBubbleStartedAtRef.current = 0;
    setShowUpdateBubble(true);
    startBubbleTimer();

    const handleFocus = () => startBubbleTimer();
    const handleBlur = () => pauseBubbleTimer();
    const handleVisibilityChange = () => {
      if (document.hidden) pauseBubbleTimer();
      else startBubbleTimer();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearBubbleTimer();
      updateBubbleStartedAtRef.current = 0;
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startupUpdateInfo]);

  const handleApplyStartupUpdate = async () => {
    try {
      await applyUpdate(startupUpdateInfo as unknown as UpdateCheckResult | null);
    } catch (err) {
      addToast(`${t('自动更新失败')}: ${formatUpdateError(err)}`, 'error', 5000);
    }
  };

  return {
    startupUpdateInfo,
    isUpdateModalVisible,
    setIsUpdateModalVisible,
    showUpdateBubble,
    setShowUpdateBubble,
    downloadProgress,
    handleApplyStartupUpdate,
  };
}
