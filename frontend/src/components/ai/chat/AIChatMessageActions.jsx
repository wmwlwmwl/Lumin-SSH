import { RefreshCw, SquarePen, Trash2 } from 'lucide-react'
import { t } from '../../../i18n.js'

const actionMap = {
  retry: { icon: RefreshCw, title: '重试' },
  edit: { icon: SquarePen, title: '编辑' },
  delete: { icon: Trash2, title: '删除' },
}

export default function AIChatMessageActions({ actions = [], style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...style }}>
      {actions.map((action) => {
        const normalizedAction = typeof action === 'string'
          ? { key: action, ...actionMap[action] }
          : { ...actionMap[action?.key], ...action }

        if (!normalizedAction?.icon || !normalizedAction?.key) {
          return null
        }

        const Icon = normalizedAction.icon

        return (
          <button
            key={normalizedAction.key}
            type="button"
            title={t(normalizedAction.title)}
            aria-label={t(normalizedAction.title)}
            onClick={(event) => {
              event.stopPropagation()
              normalizedAction.onClick?.()
            }}
            style={{
              width: 26,
              height: 26,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 7,
              color: 'var(--text-muted)',
              background: 'transparent',
              border: '1px solid transparent',
              transition: 'var(--transition)',
              cursor: 'pointer',
            }}
          >
            <Icon size={14} />
          </button>
        )
      })}
    </div>
  )
}