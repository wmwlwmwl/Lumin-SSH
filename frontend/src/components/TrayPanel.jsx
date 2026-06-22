import { X } from 'lucide-react';
import { Z } from '../constants/zIndex';

export default function TrayPanel({ show, sessions, t, logoImg, onSessionClick, onClose, onQuit, onShowWindow }) {
  if (!show) return null;

  const handleWindowShow = () => {
    onShowWindow();
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', bottom: 48, right: 16, zIndex: Z.TRAY_PANEL,
        width: 280,
        borderRadius: 14,
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 标题栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={logoImg} alt="logo" style={{ width: 24, height: 24, borderRadius: 6 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Lumin</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, padding: '2px 6px' }}
            title={t('展开窗口')}
            onClick={handleWindowShow}
          >⤢</button>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, padding: '2px 6px' }}
            onClick={onClose}
          ><X size={14} /></button>
        </div>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, padding: '12px 0', minHeight: 120 }}>
        {sessions.filter(s => s.status === 'connected').length > 0 ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '0 16px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1 }}>{t('会话')}</div>
            {sessions.filter(s => s.status === 'connected').map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                margin: '0 12px 8px', padding: '10px 12px', cursor: 'pointer',
                background: 'linear-gradient(180deg, var(--surface-hover) 0%, var(--surface-sunken) 100%)',
                border: '1px solid var(--success)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px var(--success), inset 0 1px 0 rgba(255,255,255,0.04)',
                transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-hover) 0%, var(--surface-sunken) 100%)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4), 0 0 0 1px var(--success), inset 0 1px 0 rgba(255,255,255,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(180deg, var(--surface-hover) 0%, var(--surface-sunken) 100%)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px var(--success), inset 0 1px 0 rgba(255,255,255,0.04)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                onClick={() => onSessionClick(s.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }} />
                  <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{s.serverName}</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('已连接')}</span>
              </div>
            ))}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '28px 16px', gap: 10 }}>
            <div style={{ fontSize: 40 }}>😤</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t('一切都很安静')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.6 }}>
              {t('去连接个服务器吧，已经想念你了')}
            </div>
          </div>
        )}
      </div>

      {/* 底部退出按钮 */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
        <button
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 13,
            padding: '6px 0', transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
          onClick={onQuit}
        >
          <span>⏻</span> {t('退出 Lumin')}
        </button>
      </div>
    </div>
  );
}
