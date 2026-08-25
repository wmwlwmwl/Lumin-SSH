import { useCallback, useEffect, useState } from 'react';
import * as AppGo from '../../../../wailsjs/go/wailsapp/App.js';
import { EventsOn } from '../../../../wailsjs/runtime/runtime.js';
import { t as $t } from '../../../i18n.ts';
import { settingsChoice } from '../settingsDialogs.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

/** 同步元信息：上次同步时间、删除墓碑统计、同步模式与自动同步开关 */
export function useSyncMeta({ addToast }: { addToast: AddToast }) {
  const [lastSyncTime, setLastSyncTime] = useState(0);
  const [syncTombstoneStats, setSyncTombstoneStats] = useState({ connections: 0, credentials: 0 });
  const [pruningTombstones, setPruningTombstones] = useState(false);

  // Auto sync mode
  const [syncMode, setSyncMode] = useState('webdav');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  const refreshLastSyncTime = useCallback(async () => {
    try {
      const value = Number(await AppGo.GetLastSyncTime());
      if (Number.isSafeInteger(value) && value > 0) setLastSyncTime(value);
    } catch (_) {}
  }, []);

  const refreshSyncTombstoneStats = useCallback(async () => {
    try {
      const stats = await AppGo.GetSyncTombstoneStats();
      const connections = Number(stats?.connections || 0);
      const credentials = Number(stats?.credentials || 0);
      setSyncTombstoneStats({
        connections: Number.isSafeInteger(connections) && connections > 0 ? connections : 0,
        credentials: Number.isSafeInteger(credentials) && credentials > 0 ? credentials : 0,
      });
    } catch (_) {}
  }, []);

  const refreshSyncMeta = useCallback(async () => {
    await Promise.all([refreshLastSyncTime(), refreshSyncTombstoneStats()]);
  }, [refreshLastSyncTime, refreshSyncTombstoneStats]);

  useEffect(() => {
    let cancelled = false;
    void refreshSyncMeta();

    // Load sync mode
    AppGo.GetSyncMode()
      .then((mode) => {
        if (!cancelled && mode) setSyncMode(mode);
      })
      .catch(() => {});
    Promise.resolve(window?.go?.wailsapp?.App?.GetAutoSyncEnabled?.())
      .then((enabled) => {
        if (!cancelled && typeof enabled === 'boolean') setAutoSyncEnabled(enabled);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [refreshSyncMeta]);

  useEffect(() => {
    const unbind = EventsOn('sync-completed', () => { void refreshSyncMeta(); });
    return () => { if (unbind) unbind(); };
  }, [refreshSyncMeta]);

  const handleSyncModeChange = async (mode: string) => { setSyncMode(mode); try { await AppGo.SetSyncMode(mode); } catch (_) {} };
  const handleAutoSyncEnabledChange = async (enabled: boolean) => { setAutoSyncEnabled(enabled); try { await AppGo.SetAutoSyncEnabled(enabled); } catch (_) {} };
  const handlePruneSyncTombstones = async (days: number) => {
    const total = (syncTombstoneStats?.connections || 0) + (syncTombstoneStats?.credentials || 0);
    if (total <= 0) return;
    const dayNum = Number(days);
    const label = dayNum > 0 ? `${$t('清理超过')} ${dayNum} ${$t('天的删除记录')}` : $t('清理全部删除记录');
    const action = await settingsChoice(
      $t('将清理本地并上传到当前同步模式对应的云端，避免下次同步再次合并回来。确定？'),
      label,
      [
        { label: $t('清理删除记录'), value: 'clear', primary: true },
        { label: $t('取消'), value: 'cancel', secondary: true },
      ]
    );
    if (action !== 'clear') return;
    setPruningTombstones(true);
    try {
      const res = await AppGo.PruneSyncTombstones(Number.isFinite(dayNum) ? dayNum : 0);
      await refreshSyncMeta();
      const removed = Number(res?.removedConnections || 0) + Number(res?.removedCredentials || 0);
      if (removed <= 0) {
        addToast($t('没有可清理的删除记录'), 'info');
      } else {
        addToast(`${$t('已清理删除记录')} ${removed}${$t('条')}`, 'success');
      }
    } catch (e) {
      addToast($t('清理删除记录失败') + ': ' + e, 'error');
    } finally {
      setPruningTombstones(false);
    }
  };

  return {
    lastSyncTime,
    syncTombstoneStats,
    pruningTombstones,
    syncMode,
    autoSyncEnabled,
    refreshSyncMeta,
    handleSyncModeChange,
    handleAutoSyncEnabledChange,
    handlePruneSyncTombstones,
  };
}
