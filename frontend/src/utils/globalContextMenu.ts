import { clampMenuPosition } from './menuPosition.ts';

/** 菜单项输入（来自 .tsx 调用方，字段宽松） */
export interface ContextMenuItemInput {
  type?: string;
  key?: string;
  label?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  children?: unknown;
  onSelect?: unknown;
}

export type NormalizedMenuItem =
  | { key: string; type: 'divider' }
  | {
      key: string;
      type: 'item';
      label: string;
      shortcut: string;
      danger: boolean;
      disabled: boolean;
      children: NormalizedMenuItem[];
      onSelect: ((item: NormalizedMenuItem) => void) | null;
    };

export function normalizeMenuItems(items: unknown): NormalizedMenuItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item: ContextMenuItemInput, index: number): NormalizedMenuItem | null => {
      if (item?.type === 'divider') {
        return {
          key: typeof item?.key === 'string' && item.key.trim() ? item.key.trim() : `divider-${index}`,
          type: 'divider',
        };
      }
      const label = typeof item?.label === 'string' ? item.label.trim() : '';
      if (!label) {
        return null;
      }
      const onSelect = item?.onSelect;
      const rawChildren = item?.children;
      return {
        key: typeof item?.key === 'string' && item.key.trim() ? item.key.trim() : `item-${index}`,
        type: 'item',
        label,
        shortcut: typeof item?.shortcut === 'string' ? item.shortcut.trim() : '',
        danger: item?.danger === true,
        disabled: item?.disabled === true,
        children: Array.isArray(rawChildren) ? normalizeMenuItems(rawChildren) : [],
        onSelect: typeof onSelect === 'function' ? (onSelect as (item: NormalizedMenuItem) => void) : null,
      };
    })
    .filter((item): item is NormalizedMenuItem => item !== null);
}

export interface ContextMenuPositionDetail {
  x?: unknown;
  y?: unknown;
  estimatedWidth?: unknown;
  estimatedHeight?: unknown;
}

export function resolveMenuPosition(detail: ContextMenuPositionDetail, itemCount: number) {
  const x = Number(detail?.x);
  const y = Number(detail?.y);
  const estimatedWidth = Number(detail?.estimatedWidth);
  const estimatedHeight = Number(detail?.estimatedHeight);
  const width = Number.isFinite(estimatedWidth) && estimatedWidth > 0 ? estimatedWidth : 168;
  const height = Number.isFinite(estimatedHeight) && estimatedHeight > 0 ? estimatedHeight : Math.max(40, itemCount * 36 + 8);
  return clampMenuPosition(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, width, height);
}

export function resolveEditableTarget(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (target instanceof window.HTMLInputElement || target instanceof window.HTMLTextAreaElement) {
    return target;
  }
  return null;
}

export type EditableAction = 'copy' | 'cut' | 'paste' | 'selectAll';
