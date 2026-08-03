import * as AppGo from '../../wailsjs/go/main/App.js';
import { Z } from '../constants/zIndex.js';

export default function SyncFailureToast({ syncFailed, setSyncFailed, setSettingsInitialTab, setShowSettings, addToast, t }) {
  if (!syncFailed) return null;
  const errText = String(syncFailed.error || '');
  const networkOrDnsError = /no such host|lookup |dial tcp|i\/o timeout|timeout|connection refused|network is unreachable|temporary failure|Name or service not known|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|certificate|x509|tls|unauthorized|401|403|forbidden|authentication|invalid credentials/i.test(errText);
  const looksLikeMissingRemoteDir = /\b404\b/.test(errText)
    || /No such file|no such file|not found|目录不存在|does not exist|is not a directory/i.test(errText)
    || (/读取远程目录失败|PROPFIND/i.test(errText) && /\b404\b|No such file|not found|目录不存在|does not exist/i.test(errText));
  const canRecreateRemoteDir = syncFailed.category !== 'trust' && !networkOrDnsError && looksLikeMissingRemoteDir;
  const runRetry = async (recreateDir) => {
    if (syncFailed.category === 'trust') {
      setSyncFailed(null);
      setSettingsInitialTab('sync');
      setShowSettings(true);
      return;
    }
    const failedSync = syncFailed;
    setSyncFailed(null);
    try {
      const error = recreateDir ? await AppGo.EnsureRemoteDirAndRetrySync() : await AppGo.RetrySync();
      if (error) setSyncFailed({ ...failedSync, error });
      else addToast(recreateDir ? t('远程目录已重建并同步成功') : t('同步成功'), 'success', 3000);
    } catch (error) {
      setSyncFailed({ ...failedSync, error: String(error?.message || error) });
    }
  };
  return (
    <div className="sync-failed-toast" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: Z.TOAST, width: 400, maxWidth: 'calc(100vw - 32px)', background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg, var(--shadow-md))', borderRadius: 10, padding: '16px 20px', animation: 'slideUp 0.18s ease' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ fontSize: 28, lineHeight: 1, color: 'var(--warning)', flexShrink: 0 }} aria-hidden>⚠</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{t('云端同步失败')}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>{syncFailed.category === 'trust' ? t('服务器身份信息已变化，请前往“设置 → 同步与云”核对后恢复同步。') : t('数据未能上传到云端，本地数据不受影响。')}</div>
          <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(var(--danger-rgb), 0.10)', border: '1px solid rgba(var(--danger-rgb), 0.22)', padding: '6px 10px', borderRadius: 8, marginBottom: 14, wordBreak: 'break-all', lineHeight: 1.5 }}>{syncFailed.error}</div>
          <div className="sync-failed-toast-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary sync-failed-btn-ignore" onClick={() => setSyncFailed(null)}>{t('忽略')}</button>
            {canRecreateRemoteDir && <button type="button" className="btn btn-secondary sync-failed-btn-ignore" title={t('在云端重建同步目录后再次同步')} onClick={() => runRetry(true)}>{t('重新创建并重试')}</button>}
            <button type="button" className="btn btn-primary sync-failed-btn-retry" onClick={() => runRetry(false)}>{syncFailed.category === 'trust' ? t('前往同步与云') : t('重试')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
