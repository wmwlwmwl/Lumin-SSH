import { Eye, SquarePen, Terminal, type LucideIcon } from 'lucide-react';
import type { I18nKey } from '../../../i18n.ts';

export type ExecuteApprovalMode = 'basic' | 'read_only' | 'all';

export interface AutoApprovalSettings {
  autoApprovalEnabled: boolean;
  alwaysAllowReadOnly: boolean;
  alwaysAllowWrite: boolean;
  alwaysAllowExecute: boolean;
  executeApprovalMode: ExecuteApprovalMode;
  allowedCommands: string[];
  deniedCommands: string[];
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowWrite: false,
  alwaysAllowExecute: false,
  executeApprovalMode: 'basic',
  allowedCommands: [],
  deniedCommands: [],
};

export const VISIBLE_OPTIONS: Array<{ key: 'alwaysAllowReadOnly' | 'alwaysAllowWrite' | 'alwaysAllowExecute'; labelKey: I18nKey; icon: LucideIcon }> = [
  { key: 'alwaysAllowReadOnly', labelKey: '读取', icon: Eye },
  { key: 'alwaysAllowWrite', labelKey: '写入', icon: SquarePen },
  { key: 'alwaysAllowExecute', labelKey: '执行', icon: Terminal },
];

export const EXECUTE_APPROVAL_MODE_OPTIONS: Array<{ value: ExecuteApprovalMode; labelKey: I18nKey }> = [
  { value: 'basic', labelKey: '基本规则' },
  { value: 'read_only', labelKey: '只读批准' },
  { value: 'all', labelKey: '全部批准' },
];

export function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const nextValue = value.trim();
    if (!nextValue || seen.has(nextValue)) {
      return;
    }
    seen.add(nextValue);
    normalized.push(nextValue);
  });
  return normalized;
}

export function normalizeExecuteApprovalMode(value: unknown): ExecuteApprovalMode {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized === 'read_only') {
    return 'read_only';
  }
  if (normalized === 'all') {
    return 'all';
  }
  return 'basic';
}

export function isAutoApprovalEffectivelyEnabled(settings: AutoApprovalSettings) {
  return Boolean(
    settings?.alwaysAllowReadOnly
      || settings?.alwaysAllowWrite
      || settings?.alwaysAllowExecute,
  );
}

export function normalizeAutoApprovalSettings(settings: unknown): AutoApprovalSettings {
  const raw = settings as Partial<AutoApprovalSettings> | null | undefined;
  const allowedCommands = normalizeStringList(raw?.allowedCommands);
  const deniedCommands = normalizeStringList(raw?.deniedCommands);
  const normalized: AutoApprovalSettings = {
    ...DEFAULT_AUTO_APPROVAL_SETTINGS,
    ...raw,
    alwaysAllowReadOnly: Boolean(raw?.alwaysAllowReadOnly),
    alwaysAllowWrite: Boolean(raw?.alwaysAllowWrite),
    alwaysAllowExecute: Boolean(raw?.alwaysAllowExecute),
    executeApprovalMode: normalizeExecuteApprovalMode(raw?.executeApprovalMode),
    allowedCommands,
    deniedCommands,
  };
  normalized.autoApprovalEnabled = isAutoApprovalEffectivelyEnabled(normalized);
  return normalized;
}

export function buildTriggerLabel(t: (key: I18nKey, vars?: Record<string, unknown>) => string, settings: AutoApprovalSettings, enabledCount: number) {
  if (!settings.autoApprovalEnabled) {
    return t('自动批准');
  }
  if (enabledCount === 0) {
    return `${t('自动批准')} 0`;
  }
  const approvalCount = enabledCount + (settings.alwaysAllowExecute && settings.executeApprovalMode === 'all' ? 1 : 0);
  return `${t('自动批准')} ${approvalCount}`;
}

export const PANEL_SHELL_CLASS = 'border border-line rounded-lg bg-overlay shadow-xl overflow-hidden overflow-x-hidden box-border';
export const SECTION_HINT_CLASS = 'text-xs text-tertiary leading-[1.5]';
export const COMMAND_INPUT_CLASS = 'flex-1 min-w-0 h-[34px] rounded-lg border border-line bg-sunken text-primary px-2.5 box-border outline-none text-sm';
export const ADD_BUTTON_CLASS = 'h-[34px] px-3 rounded-lg border border-line bg-canvas text-primary text-sm font-semibold transition-colors duration-100 cursor-pointer';
