export const GLOBAL_CONTEXT_MENU_OPEN_EVENT = 'lumin-open-context-menu';

/** 全局右键菜单项 */
export interface GlobalContextMenuItem {
  key: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  children?: GlobalContextMenuItem[];
  onSelect?: () => void | Promise<void>;
}

/** 全局右键菜单详情（由 openGlobalContextMenu 派发，GlobalContextMenu 组件消费） */
export interface GlobalContextMenuDetail {
  x: number;
  y: number;
  estimatedWidth?: number;
  estimatedHeight?: number;
  items: GlobalContextMenuItem[];
}

export function openGlobalContextMenu(detail: GlobalContextMenuDetail): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<GlobalContextMenuDetail>(GLOBAL_CONTEXT_MENU_OPEN_EVENT, { detail }));
}
