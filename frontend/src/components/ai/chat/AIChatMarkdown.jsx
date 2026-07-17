import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { useTranslation } from '../../../i18n.js'
import { clampMenuPosition } from '../../../utils/menuPosition.js'

function openExternalLink(event, href) {
  const nextHref = typeof href === 'string' ? href.trim() : ''
  if (!nextHref) {
    return
  }
  const openUrl = window?.runtime?.BrowserOpenURL
  if (typeof openUrl === 'function') {
    event.preventDefault()
    openUrl(nextHref)
  }
}

function getSelectedTextWithinContainer(container) {
  if (!container || typeof window === 'undefined') {
    return ''
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return ''
  }
  const selectedText = selection.toString().trim()
  if (!selectedText) {
    return ''
  }
  const range = selection.getRangeAt(0)
  const startNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentNode : range.startContainer
  const endNode = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentNode : range.endContainer
  if (!startNode || !endNode || !container.contains(startNode) || !container.contains(endNode)) {
    return ''
  }
  return selectedText
}

const markdownComponents = {
  p: ({ children }) => <p style={{ margin: 0, lineHeight: 1.7 }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 10px', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0', lineHeight: 1.7 }}>{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => openExternalLink(event, href)}
      style={{ color: 'var(--accent)', textDecoration: 'underline' }}
    >
      {children}
    </a>
  ),
  code: ({ inline, children }) => {
    if (inline) {
      return (
        <code
          style={{
            padding: '2px 6px',
            borderRadius: 6,
            background: 'rgba(var(--accent-rgb), 0.08)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre
      style={{
        margin: '0 0 12px',
        padding: '12px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--surface-base)',
        color: 'var(--text-primary)',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '0 0 12px',
        padding: '4px 0 4px 12px',
        borderLeft: '3px solid rgba(var(--accent-rgb), 0.4)',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <h1 style={{ margin: '0 0 12px', fontSize: 22, lineHeight: 1.35 }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: '0 0 10px', fontSize: 18, lineHeight: 1.4 }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ margin: '0 0 8px', fontSize: 16, lineHeight: 1.45 }}>{children}</h3>,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ border: '1px solid var(--border)', padding: '8px 10px', textAlign: 'left', background: 'var(--surface-base)' }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: '1px solid var(--border)', padding: '8px 10px', verticalAlign: 'top' }}>
      {children}
    </td>
  ),
}

export default function AIChatMarkdown({ text, enableQuoteContextMenu = false }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const menuRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)

  const handleQuoteSelection = useCallback(() => {
    const selectedText = typeof contextMenu?.selectedText === 'string' ? contextMenu.selectedText.trim() : ''
    if (!selectedText || typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new CustomEvent('ai-quote-selection', {
      detail: { text: selectedText },
    }))
    setContextMenu(null)
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) {
      return undefined
    }
    const handlePointerDown = (event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return
      }
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [contextMenu])

  const handleContextMenu = useCallback((event) => {
    if (!enableQuoteContextMenu) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const selectedText = getSelectedTextWithinContainer(containerRef.current)
    const position = clampMenuPosition(event.clientX, event.clientY, 168, 54)
    setContextMenu({
      ...position,
      selectedText,
    })
  }, [enableQuoteContextMenu])

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      style={{ minWidth: 0, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.7, wordBreak: 'break-word', position: 'relative' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
        {text || ''}
      </ReactMarkdown>
      {contextMenu ? (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => {
            event.stopPropagation()
          }}>
          <div
            className={`context-menu-item${contextMenu.selectedText ? '' : ' disabled'}`}
            onClick={contextMenu.selectedText ? handleQuoteSelection : undefined}>
            <span className="item-label">{t('引用')}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}