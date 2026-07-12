import { Check, Pin, SquarePen } from 'lucide-react';
import { useTranslation } from '../../i18n.js';
import Tiptop from '../Tiptop.jsx';

function IconButton({ title, active = false, onClick, children }) {
  return (
    <Tiptop text={title}>
      <button
        type="button"
        aria-label={title}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 0,
          border: '1px solid transparent',
          background: active ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
          color: active ? 'var(--accent)' : 'var(--text-muted)',
          transition: 'var(--transition)',
          flexShrink: 0,
        }}
      >
        {children}
      </button>
    </Tiptop>
  );
}

export default function AIProviderListRow({ item, active = false, builtin = false, onSelect, onEdit, onTogglePin }) {
  const { t } = useTranslation()
  const secondaryLabel = item.model || item.description || 'Compatible'

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: '100%',
        minHeight: 46,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 10px',
        border: 'none',
        borderBottom: '1px solid var(--border-subtle)',
        background: active ? 'rgba(var(--accent-rgb), 0.10)' : 'transparent',
        color: 'var(--text-primary)',
        textAlign: 'left',
        transition: 'var(--transition)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
        <span style={{ flexShrink: 0, fontSize: 13, fontWeight: active ? 800 : 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {item.name}
        </span>
        {secondaryLabel ? (
          <span style={{ minWidth: 0, flex: 1, fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {secondaryLabel}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {active ? <Check size={13} color="var(--accent)" /> : <div style={{ width: 13 }} />}
        {!builtin ? (
          <IconButton title={item.pinned ? t('取消置顶') : t('置顶')} active={item.pinned} onClick={onTogglePin}>
            <Pin size={13} />
          </IconButton>
        ) : null}
        <IconButton title={t('编辑供应商')} onClick={onEdit}>
          <SquarePen size={13} />
        </IconButton>
      </div>
    </button>
  );
}