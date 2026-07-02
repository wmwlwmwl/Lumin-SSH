import { MessageSquare } from 'lucide-react';
import { useTranslation } from '../../../i18n.js';
import AIChatMarkdown from './AIChatMarkdown.jsx';
import AIChatMessageActions from './AIChatMessageActions.jsx';

export default function AIChatAssistantMessage({ title = 'Ai助手', time, text, children, metrics = [] }) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'grid', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, fontSize: 11, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
        <MessageSquare size={13} />
        <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{t(title)}</span>
        <span>{time}</span>
        <AIChatMessageActions actions={['delete']} />
        {metrics.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>
            {metrics.map((metric) => (
              <span key={metric}>{metric}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ width: '100%', padding: '10px 12px', borderRadius: 12, background: 'var(--surface-overlay)', border: '1px solid var(--border)', boxShadow: 'inset 0 1px 0 var(--border-light)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word' }}>
        {text ? <AIChatMarkdown text={text} /> : null}
        {children}
      </div>
    </div>
  );
}