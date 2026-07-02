import { Trash2 } from 'lucide-react';

export default function ConversationListItem({ item, active = false }) {
  return (
    <button
      type="button"
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        background: active ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'var(--transition)',
        textAlign: 'left',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: active ? 700 : 600, color: 'var(--text-primary)', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{item.time}</div>
          {item.badge ? (
            <div style={{ maxWidth: '100%', padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(var(--success-rgb), 0.35)', background: 'rgba(var(--success-rgb), 0.08)', color: 'var(--success)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.badge}
            </div>
          ) : null}
        </div>
      </div>
      <div
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          color: 'var(--text-muted)',
          background: 'transparent',
          border: '1px solid transparent',
          flexShrink: 0,
        }}
      >
        <Trash2 size={14} />
      </div>
    </button>
  );
}