import { MessageCircleQuestionMark } from 'lucide-react';
import { useTranslation } from '../../../i18n.js';

export default function AIChatFollowUpCard({ question, suggestions }) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <MessageCircleQuestionMark size={14} color="var(--text-secondary)" />
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t('追问建议')}</span>
      </div>
      <div style={{ width: '100%', display: 'grid', gap: 10 }}>
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface-overlay)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word' }}>
          {question}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              style={{
                minHeight: 38,
                padding: '8px 12px',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 13,
                textAlign: 'left',
                transition: 'var(--transition)',
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}