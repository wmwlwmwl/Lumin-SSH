import { MessageCircleQuestionMark } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { useTranslation } from '../../../i18n.js'
import AIChatMarkdown from './AIChatMarkdown.jsx'

const suggestionMarkdownComponents = {
  p: ({ children }) => <span>{children}</span>,
  ul: ({ children }) => <span style={{ display: 'grid', gap: 4, paddingLeft: 18 }}>{children}</span>,
  ol: ({ children }) => <span style={{ display: 'grid', gap: 4, paddingLeft: 18 }}>{children}</span>,
  li: ({ children }) => <span style={{ display: 'list-item', lineHeight: 1.6 }}>{children}</span>,
  a: ({ children }) => <span style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{children}</span>,
  code: ({ children }) => (
    <code
      style={{
        padding: '2px 6px',
        borderRadius: 6,
        background: 'color-mix(in srgb, var(--accent) 10%, var(--surface-overlay))',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <span
      style={{
        display: 'block',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </span>
  ),
  blockquote: ({ children }) => (
    <span
      style={{
        display: 'block',
        paddingLeft: 12,
        borderLeft: '3px solid color-mix(in srgb, var(--accent) 40%, var(--border))',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </span>
  ),
  h1: ({ children }) => <span style={{ display: 'block', fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>{children}</span>,
  h2: ({ children }) => <span style={{ display: 'block', fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>{children}</span>,
  h3: ({ children }) => <span style={{ display: 'block', fontSize: 14, fontWeight: 700, lineHeight: 1.5 }}>{children}</span>,
}

function FollowUpSuggestionMarkdown({ text }) {
  return (
    <span style={{ display: 'block', width: '100%', lineHeight: 1.6, wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={suggestionMarkdownComponents}>
        {text || ''}
      </ReactMarkdown>
    </span>
  )
}

export default function AIChatFollowUpCard({ question, suggestions, onSelectSuggestion }) {
  const { t } = useTranslation()
  const [submittingValue, setSubmittingValue] = useState('')
  const suggestionList = Array.isArray(suggestions) ? suggestions : []

  const handleSelectSuggestion = async (value) => {
    const nextValue = typeof value === 'string' ? value.trim() : ''
    if (!nextValue || submittingValue || typeof onSelectSuggestion !== 'function') {
      return
    }
    setSubmittingValue(nextValue)
    try {
      const accepted = await onSelectSuggestion(nextValue)
      if (accepted === false) {
        setSubmittingValue('')
      }
    } catch {
      setSubmittingValue('')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <MessageCircleQuestionMark size={14} color="var(--text-secondary)" />
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t('追问建议')}</span>
      </div>
      <div style={{ width: '100%', display: 'grid', gap: 10 }}>
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--surface-overlay)', border: '1px solid var(--border)' }}>
          <AIChatMarkdown text={question || ''} />
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {suggestionList.map((item) => (
            <button
              key={item}
              type="button"
              disabled={typeof onSelectSuggestion !== 'function' || Boolean(submittingValue)}
              onClick={() => void handleSelectSuggestion(item)}
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
                cursor: typeof onSelectSuggestion !== 'function' || submittingValue ? 'not-allowed' : 'pointer',
                opacity: typeof onSelectSuggestion !== 'function' || submittingValue ? 0.6 : 1,
              }}
            >
              <FollowUpSuggestionMarkdown text={item} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}