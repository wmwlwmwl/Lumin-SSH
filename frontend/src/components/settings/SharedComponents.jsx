import React from 'react';
import { t as $t } from '../../i18n.js';

export const SETTINGS_TAB_GAP = 14;

export const SETTINGS_SECTION_TITLE_STYLE = {
  fontSize: 13,
  color: 'var(--text-primary)',
  marginBottom: 6,
  fontWeight: 600,
};

export const SETTINGS_PANEL_STYLE = {
  background: 'var(--surface-overlay)',
  padding: 10,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
};

export function SettingsTabRoot({ children, gap = SETTINGS_TAB_GAP, style = {} }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>{children}</div>;
}

export function SettingsSectionTitle({ children, style = {} }) {
  return <h3 style={{ ...SETTINGS_SECTION_TITLE_STYLE, ...style }}>{children}</h3>;
}

export function SettingsPanel({ children, style = {} }) {
  return <div className="form-group" style={{ ...SETTINGS_PANEL_STYLE, ...style }}>{children}</div>;
}

export function SettingRow({ title, description, action, alignItems = 'center', gap = 16 }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems, gap }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{title}</div>
        {description ? <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function SettingsDivider({ margin = '5px 0' }) {
  return <div className="divider" style={{ margin, borderTop: '1px solid var(--border)' }} />;
}

export function ToggleSwitch({ checked, onChange }) {
  return (
    <div
      onClick={onChange}
      style={{
        width: 38,
        height: 22,
        background: checked ? 'var(--success)' : 'var(--surface-hover)',
        borderRadius: 11,
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s ease',
        border: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: checked ? 18 : 2,
          top: 1,
          width: 18,
          height: 18,
          background: '#fff',
          borderRadius: '50%',
          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: 'var(--shadow-xs)',
        }}
      ></div>
    </div>
  );
}

export function RadioOption({ selected, label, description, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '6px 10px',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        background: selected ? 'var(--accent-dim)' : 'var(--surface-overlay)',
        border: `1px solid ${selected ? 'var(--accent-border)' : 'var(--border)'}`,
        boxShadow: selected ? '0 0 0 1px var(--accent-border) inset' : 'none',
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 1,
          border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
          background: selected ? 'var(--accent)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} /> : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
        {description ? <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflowWrap: 'break-word' }}>{description}</div> : null}
      </div>
    </div>
  );
}

export function AboutLink({ icon, title, url }) {
  return (
    <div
      onClick={() => window.runtime?.BrowserOpenURL(url)}
      className="about-list-item"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 12px', minHeight: 96, borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, color: 'var(--text-secondary)' }}>
        {icon}
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{title}</span>
    </div>
  );
}