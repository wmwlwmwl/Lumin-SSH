import React from 'react';
import { t as $t, type I18nKey } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';

const SETTINGS_TAB_GAP = 14;

const SETTINGS_SECTION_TITLE_CLASS = 'text-base text-primary mb-1.5 font-semibold';

const SETTINGS_PANEL_CLASS = 'flex flex-col gap-1 bg-overlay p-2.5 rounded-md border border-line';

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
  return <div className="flex flex-col" style={{ gap, ...style }}>{children}</div>;
}

export interface SettingsSectionProps {
  definition?: SettingsDefinitionNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}


interface SettingsSectionTitleProps {
  children?: React.ReactNode;
  definition?: SettingsDefinitionNode;
  style?: React.CSSProperties;
}

export function SettingsSectionTitle({ children, definition, style = {} }: SettingsSectionTitleProps) {
  return <h3 data-settings-section-id={definition?.id} className={SETTINGS_SECTION_TITLE_CLASS} style={style}>{definition?.titleKey ? $t(definition.titleKey) : children}</h3>;
}

interface SettingsPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function SettingsPanel({ children, style = {}, className, ...rest }: SettingsPanelProps) {
  return <div {...rest} className={cn(SETTINGS_PANEL_CLASS, className)} style={style}>{children}</div>;
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
    <div
      data-settings-field-id={definition?.id}
      className={cn('flex', children ? 'flex-col gap-2' : 'justify-between flex-wrap')}
      style={children ? style : { alignItems, gap, ...style }}
    >
      <div className={cn('min-w-0', !children && '[flex:1_1_180px]')}>
        {resolvedTitle ? <div className="text-primary text-base">{resolvedTitle}</div> : null}
        {resolvedDescription ? <div className="text-tertiary text-xs">{resolvedDescription}</div> : null}
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
  return <div className="border-t border-line" style={{ margin }} />;
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
}

export function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <div
      onClick={onChange}
      className={cn(
        'relative w-[38px] h-[22px] rounded-full cursor-pointer transition-colors duration-200 border border-line shrink-0',
        checked ? 'bg-success' : 'bg-hover',
      )}
    >
      <div
        className="absolute top-px w-[18px] h-[18px] bg-white rounded-full shadow-xs transition-[left] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ left: checked ? 18 : 2 }}
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
      className={cn(
        'px-2.5 py-2 rounded-md cursor-pointer transition-all duration-150 border',
        selected
          ? 'bg-accent-dim border-accent-border shadow-[inset_0_0_0_1px_var(--accent-border)]'
          : 'bg-overlay border-line',
      )}
    >
      <div className="min-w-0">
        <div className={cn('text-base font-semibold mb-0.5', selected ? 'text-primary' : 'text-secondary')}>{label}</div>
        {description ? <div className="text-xs text-tertiary [overflow-wrap:break-word]">{description}</div> : null}
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
      className="flex flex-col items-center justify-center gap-2.5 px-3 py-4 min-h-24 rounded-md cursor-pointer transition-all duration-200 text-center border border-line hover:border-accent-border hover:bg-sunken"
    >
      <div className="flex items-center justify-center w-10 h-10 text-secondary">
        {icon}
      </div>
      <span className="text-sm font-semibold text-secondary leading-[1.4]">{title}</span>
    </div>
  );
}
