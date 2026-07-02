import { User } from 'lucide-react'
import { useTranslation } from '../../../i18n.js'
import AIChatMessageActions from './AIChatMessageActions.jsx'

export default function AIChatUserMessage({ message, onRetry, onEdit, onDelete }) {
  const { t } = useTranslation()
  const text = typeof message?.text === 'string' ? message.text : ''
  const time = typeof message?.time === 'string' ? message.time : ''
  const messageId = typeof message?.id === 'string' ? message.id : ''
  const images = Array.isArray(message?.images) ? message.images.filter((item) => typeof item === 'string' && item.trim()) : []

  return (
    <div style={{ display: 'flex', width: '100%' }}>
      <div style={{ width: '100%', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
          <AIChatMessageActions
            actions={[
              { key: 'retry', onClick: () => onRetry?.(messageId, text, images) },
              { key: 'edit', onClick: () => onEdit?.(messageId, text, images) },
              { key: 'delete', onClick: () => onDelete?.(messageId) },
            ]}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            <span>{time}</span>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{t('用户')}</span>
            <User size={13} />
          </div>
        </div>
        {text ? (
          <div style={{ padding: '10px 12px', borderRadius: 12, background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.16), rgba(var(--accent-rgb), 0.08))', border: '1px solid var(--accent-border)', boxShadow: 'inset 0 1px 0 rgba(var(--accent-rgb), 0.12)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
            {text}
          </div>
        ) : null}
        {images.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {images.map((image, index) => (
              <a
                key={`${messageId}-image-${index}`}
                href={image}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--accent-border)',
                  background: 'var(--surface-base)',
                }}>
                <img
                  src={image}
                  alt=""
                  style={{
                    width: '100%',
                    height: 120,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}