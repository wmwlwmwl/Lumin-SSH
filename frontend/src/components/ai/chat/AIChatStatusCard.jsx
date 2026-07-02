import { Check, CircleX, TriangleAlert } from 'lucide-react';

export default function AIChatStatusCard({ type = 'warning', title, message }) {
  const palette = {
    warning: {
      icon: <TriangleAlert size={14} color="var(--warning)" />,
      titleColor: 'var(--warning)',
      border: 'rgba(var(--warning-rgb), 0.28)',
      background: 'rgba(var(--warning-rgb), 0.05)',
    },
    error: {
      icon: <CircleX size={14} color="var(--danger)" />,
      titleColor: 'var(--danger)',
      border: 'rgba(var(--danger-rgb), 0.28)',
      background: 'rgba(var(--danger-rgb), 0.05)',
    },
    success: {
      icon: <Check size={14} color="var(--success)" />,
      titleColor: 'var(--success)',
      border: 'rgba(var(--success-rgb), 0.28)',
      background: 'rgba(var(--success-rgb), 0.05)',
    },
  }[type];

  return (
    <div style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: `1px solid ${palette.border}`, background: palette.background, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {palette.icon}
        <span style={{ color: palette.titleColor, fontWeight: 700, fontSize: 13 }}>{title}</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message}</div>
    </div>
  );
}