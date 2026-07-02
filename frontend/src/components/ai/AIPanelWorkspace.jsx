import { Settings } from 'lucide-react';
import { useTranslation } from '../../i18n.js';

export default function AIPanelWorkspace({ onOpenSettings }) {
  const { t } = useTranslation();

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 320, display: 'grid', gap: 12, padding: 18, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-overlay)', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t('AI 集成')}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-tertiary)' }}>{t('MCP集成')}</div>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          style={{ height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)', fontSize: 13, fontWeight: 600, transition: 'var(--transition)' }}
        >
          <Settings size={15} />
          {t('设置')}
        </button>
      </div>
    </div>
  );
}