import { CircleX, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../../i18n.js';

export default function AIChatApprovalCard({ title, summary, approveLabel = '批准', rejectLabel = '拒绝' }) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <ShieldCheck size={14} color="var(--warning)" />
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{ width: '100%', border: '1px solid rgba(var(--warning-rgb), 0.26)', borderRadius: 12, background: 'var(--surface-overlay)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(var(--warning-rgb), 0.05)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word' }}>
          {summary}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
          <button
            type="button"
            style={{
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid rgba(var(--success-rgb), 0.35)',
              background: 'rgba(var(--success-rgb), 0.10)',
              color: 'var(--success)',
              fontSize: 12,
              fontWeight: 700,
              transition: 'var(--transition)',
            }}
          >
            {t(approveLabel)}
          </button>
          <button
            type="button"
            style={{
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid rgba(var(--danger-rgb), 0.28)',
              background: 'rgba(var(--danger-rgb), 0.08)',
              color: 'var(--danger)',
              fontSize: 12,
              fontWeight: 700,
              transition: 'var(--transition)',
            }}
          >
            <CircleX size={13} />
            {t(rejectLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}