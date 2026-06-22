import { Monitor, Radio, Loader2 } from 'lucide-react';
import { Z } from '../constants/zIndex';
import { getTerminalTheme } from '../utils/theme.js';

export default function ConnectingCard({ connectingServer, t, onCancel }) {
  if (!connectingServer) return null;
  const C = getTerminalTheme().container;
  const server = connectingServer.server;
  const host = server.host;
  const port = server.port || 22;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: Z.FULLSCREEN_OVERLAY,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        width: 380, borderRadius: 16, overflow: 'hidden',
        background: C.popupBg,
        border: '1px solid ' + C.btnBorder,
        boxShadow: C.contextShadow,
        padding: '20px 24px 22px',
      }}>
        {/* 标题行：图标 + 名称 + 按钮 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg,#ef4444,#dc2626)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Monitor size={22} style={{ color: '#fff' }} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.inputColor, marginBottom: 3 }}>
              {server.name || server.host}
            </div>
            <div style={{ fontSize: 12, color: 'var(--success)', fontFamily: 'monospace' }}>
              {t('SSH')} {host}:{port || 22}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              style={{
                padding: '5px 14px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                background: 'rgba(128,128,128,0.08)', border: '1px solid ' + C.btnBorder,
                color: C.statusBarColor,
              }}
              onClick={onCancel}
            >
              {t('取消')}
            </button>
          </div>
        </div>

        {/* 双进度条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)', flexShrink: 0, boxShadow: '0 0 8px var(--success)' }} />
          <div style={{ flex: 1, height: 4, borderRadius: 4, background: C.separator, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, var(--success), var(--success))',
              animation: 'ssh-progress-indeterminate 1.4s ease-in-out infinite',
            }} />
          </div>
          <div style={{ flexShrink: 0, fontSize: 14, color: 'var(--success)' }}><Radio size={14} /></div>
          <div style={{ flex: 1, height: 4, borderRadius: 4, background: C.separator, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, var(--success), var(--success))',
              animation: 'ssh-progress-indeterminate 1.4s ease-in-out 0.4s infinite',
            }} />
          </div>
          <div style={{ flex: 0, fontSize: 14, color: C.mutedColor }}><Loader2 size={14} style={{ animation: 'spin 1.2s linear infinite' }} /></div>
        </div>

        {/* 提示文字 */}
        <div style={{ fontSize: 12, color: C.statusBarColor, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ animation: 'spin 1.5s linear infinite', display: 'inline-flex', alignItems: 'center' }}><Loader2 size={14} /></span>
          {t('正在建立 SSH 连接，请稍候...')}
        </div>
      </div>
    </div>
  );
}
