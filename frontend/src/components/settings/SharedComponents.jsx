import React from 'react';
import { t as $t } from '../../i18n.js';

export function ToggleSwitch({ checked, onChange }) {
  return (
    <div onClick={onChange}
      style={{ width: 40, height: 24, background: checked ? 'var(--success)' : 'var(--surface-hover)',
        borderRadius: 12, position: 'relative', cursor: 'pointer', transition: 'background 0.2s ease',
        border: '1px solid var(--border)', flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: checked ? 18 : 2, top: 1, width: 20, height: 20,
        background: '#fff', borderRadius: '50%', transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}></div>
    </div>
  );
}

export function RadioOption({ selected, label, description, onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.15s', background: selected ? 'var(--accent-dim)' : 'var(--surface-overlay)', border: `1px solid ${selected ? 'var(--accent-border)' : 'var(--border)'}`, boxShadow: selected ? '0 0 0 1px var(--accent-border) inset' : 'none' }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1, border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, background: selected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{description}</div>}
      </div>
    </div>
  );
}

export function AboutLink({ icon, title, desc, url }) {
  return (
    <div onClick={() => window.runtime?.BrowserOpenURL(url)} className="about-list-item"
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s' }}>
      {icon}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{desc}</span>
      </div>
    </div>
  );
}
