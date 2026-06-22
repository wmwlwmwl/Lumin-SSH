import { Z } from '../constants/zIndex';
import { Rocket } from 'lucide-react';

export default function UpdateModal({ visible, updateInfo, downloadProgress, t, onClose, onUpdate }) {
  if (!visible || !updateInfo) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: Z.MODAL,
      width: 340, background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
      border: '1px solid var(--glass-border)',
      boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
      borderRadius: 16, padding: '16px 20px',
      animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ fontSize: 28, lineHeight: 1, filter: 'drop-shadow(0 4px 8px rgba(16,185,129,0.3))' }}><Rocket size={28} color="var(--success)" /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('发现新版本')} <span style={{ color: 'var(--success)', fontSize: 13, background: 'var(--success-dim)', padding: '2px 6px', borderRadius: 6 }}>{updateInfo.version}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
            {t('为了给您提供更极致的体验，建议您立即升级。')}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s' }}
              onClick={onClose}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
              disabled={downloadProgress >= 0}
            >
              {t('稍等')}
            </button>
            <button
              style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'var(--success)', border: 'none', color: '#fff', cursor: 'pointer', position: 'relative', overflow: 'hidden', transition: 'all 0.2s' }}
              onClick={onUpdate}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--success-hover, #059669)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--success)'}
              disabled={downloadProgress >= 0}
            >
              {downloadProgress >= 0 && (
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${downloadProgress}%`, background: 'rgba(0,0,0,0.2)', transition: 'width 0.2s ease-out' }} />
              )}
              <span style={{ position: 'relative', zIndex: Z.CONTENT, display: 'flex', alignItems: 'center', gap: 6 }}>
                {downloadProgress >= 0 ? (
                  <>
                    <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                    {downloadProgress}%
                  </>
                ) : (
                  t('立即更新')
                )}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
