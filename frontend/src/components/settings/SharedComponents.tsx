import React from 'react';
import { t as $t, type I18nKey } from '../../i18n.ts';

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

/** 设置定义节点（来自 settingDefinitions.ts 的数据结构，字段按需取用） */
export interface SettingsDefinitionNode {
  id?: string;
  /** 翻译键（可能为空串表示无标题，消费方先判空再 t()） */
  titleKey?: I18nKey | '';
  descriptionKey?: I18nKey | '';
  type?: string;
  alias?: string;
  control?: string;
  stateKey?: string;
  when?: { field?: string; equals?: unknown };
  children?: SettingsDefinitionNode[];
  [key: string]: unknown;
}

interface SettingsTabRootProps {
  children?: React.ReactNode;
  gap?: number;
  style?: React.CSSProperties;
}

export function SettingsTabRoot({ children, gap = SETTINGS_TAB_GAP, style = {} }: SettingsTabRootProps) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>{children}</div>;
}

interface SettingsSectionProps {
  definition?: SettingsDefinitionNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function SettingsSection({ definition, children, style = {} }: SettingsSectionProps) {
  return <div data-settings-section-id={definition?.id} style={style}>{children}</div>;
}

interface SettingsSectionTitleProps {
  children?: React.ReactNode;
  definition?: SettingsDefinitionNode;
  style?: React.CSSProperties;
}

export function SettingsSectionTitle({ children, definition, style = {} }: SettingsSectionTitleProps) {
  return <h3 data-settings-section-id={definition?.id} style={{ ...SETTINGS_SECTION_TITLE_STYLE, ...style }}>{definition?.titleKey ? $t(definition.titleKey) : children}</h3>;
}

interface SettingsPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function SettingsPanel({ children, style = {}, ...rest }: SettingsPanelProps) {
  return <div {...rest} className="form-group" style={{ ...SETTINGS_PANEL_STYLE, ...style }}>{children}</div>;
}

export interface SettingsFieldProps {
  definition?: SettingsDefinitionNode;
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  alignItems?: string;
  gap?: number;
  style?: React.CSSProperties;
}

export function SettingsField({ definition, title, description, action, children, alignItems = 'center', gap = 16, style = {} }: SettingsFieldProps) {
  const resolvedTitle = title ?? (definition?.titleKey ? $t(definition.titleKey) : title);
  const resolvedDescription = description ?? (definition?.descriptionKey ? $t(definition.descriptionKey) : description);
  return (
    <div data-settings-field-id={definition?.id} style={{ ...style, ...(children ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'flex', justifyContent: 'space-between', alignItems, gap, flexWrap: 'wrap' }) }}>
      <div style={{ minWidth: 0, ...(children ? {} : { flex: '1 1 180px' }) }}>
        {resolvedTitle ? <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{resolvedTitle}</div> : null}
        {resolvedDescription ? <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{resolvedDescription}</div> : null}
      </div>
      {children ? <div>{children}</div> : action}
    </div>
  );
}

export function SettingRow(props: SettingsFieldProps) {
  return <SettingsField {...props} />;
}

interface SettingsDividerProps {
  margin?: string;
}

export function SettingsDivider({ margin = '5px 0' }: SettingsDividerProps) {
  return <div className="divider" style={{ margin, borderTop: '1px solid var(--border)' }} />;
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
}

export function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
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

interface RadioOptionProps {
  selected: boolean;
  label: React.ReactNode;
  description?: React.ReactNode;
  onClick: () => void;
  definition?: SettingsDefinitionNode;
}

export function RadioOption({ selected, label, description, onClick, definition }: RadioOptionProps) {
  return (
    <div
      data-settings-field-id={definition?.id}
      onClick={onClick}
      style={{
        padding: '8px 10px',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        background: selected ? 'var(--accent-dim)' : 'var(--surface-overlay)',
        border: `1px solid ${selected ? 'var(--accent-border)' : 'var(--border)'}`,
        boxShadow: selected ? '0 0 0 1px var(--accent-border) inset' : 'none',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
        {description ? <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflowWrap: 'break-word' }}>{description}</div> : null}
      </div>
    </div>
  );
}

interface AboutLinkProps {
  icon: React.ReactNode;
  title: string;
  url: string;
  definition?: SettingsDefinitionNode;
}

export function AboutLink({ icon, title, url, definition }: AboutLinkProps) {
  return (
    <div
      data-settings-field-id={definition?.id}
      onClick={() => window.runtime?.BrowserOpenURL?.(url)}
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
