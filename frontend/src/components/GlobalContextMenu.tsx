import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../i18n.ts';
import { formatShortcut } from '../utils/platform.ts';
import { clampMenuPosition } from '../utils/menuPosition.ts';
import { GLOBAL_CONTEXT_MENU_OPEN_EVENT, type GlobalContextMenuDetail } from '../utils/contextMenu.ts';
import * as runtime from '../../wailsjs/runtime/runtime.js';

/** 菜单项输入（来自 .tsx 调用方，字段宽松） */
interface ContextMenuItemInput {
  type?: string;
  key?: string;
  label?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  children?: unknown;
  onSelect?: unknown;
}

type NormalizedMenuItem =
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

function normalizeMenuItems(items: unknown): NormalizedMenuItem[] {
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

interface ContextMenuPositionDetail {
  x?: unknown;
  y?: unknown;
  estimatedWidth?: unknown;
  estimatedHeight?: unknown;
}

function resolveMenuPosition(detail: ContextMenuPositionDetail, itemCount: number) {
  const x = Number(detail?.x);
  const y = Number(detail?.y);
  const estimatedWidth = Number(detail?.estimatedWidth);
  const estimatedHeight = Number(detail?.estimatedHeight);
  const width = Number.isFinite(estimatedWidth) && estimatedWidth > 0 ? estimatedWidth : 168;
  const height = Number.isFinite(estimatedHeight) && estimatedHeight > 0 ? estimatedHeight : Math.max(40, itemCount * 36 + 8);
  return clampMenuPosition(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, width, height);
}

function resolveEditableTarget(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (target instanceof window.HTMLInputElement || target instanceof window.HTMLTextAreaElement) {
    return target;
  }
  return null;
}

type EditableAction = 'copy' | 'cut' | 'paste' | 'selectAll';

interface MenuState {
  x: number;
  y: number;
  items: NormalizedMenuItem[];
}

export default function GlobalContextMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [openSubmenuKey, setOpenSubmenuKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setOpenSubmenuKey(null);
  }, []);

  const handleInputAction = useCallback(async (targetInput: HTMLInputElement | HTMLTextAreaElement, action: EditableAction) => {
    if (!targetInput) {
      return;
    }
    targetInput.focus();
    try {
      if (action === 'copy') {
        const text = targetInput.value.substring(Number(targetInput.selectionStart), Number(targetInput.selectionEnd));
        if (text) {
          await runtime.ClipboardSetText(text);
        }
        return;
      }
      if (action === 'cut') {
        const text = targetInput.value.substring(Number(targetInput.selectionStart), Number(targetInput.selectionEnd));
        if (!text) {
          return;
        }
        await runtime.ClipboardSetText(text);
        const start = Number(targetInput.selectionStart);
        const end = Number(targetInput.selectionEnd);
        const proto = targetInput.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        // 输入元素原型上的 value setter 必然存在（老 WebView 无剪贴板 API 时才走此路径）
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')!.set as (this: HTMLInputElement | HTMLTextAreaElement, value: string) => void;
        const nextValue = targetInput.value.substring(0, start) + targetInput.value.substring(end);
        nativeSetter.call(targetInput, nextValue);
        targetInput.setSelectionRange(start, start);
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (action === 'paste') {
        let text = '';
        try {
          text = await runtime.ClipboardGetText();
        } catch {}
        if (!text) {
          try {
            text = await navigator.clipboard.readText();
          } catch {}
        }
        if (!text) {
          return;
        }
        const start = Number(targetInput.selectionStart);
        const end = Number(targetInput.selectionEnd);
        const proto = targetInput.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')!.set as (this: HTMLInputElement | HTMLTextAreaElement, value: string) => void;
        nativeSetter.call(
          targetInput,
          targetInput.value.substring(0, start) + text + targetInput.value.substring(end)
        );
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (action === 'selectAll') {
        targetInput.select();
      }
    } catch (error) {
      console.error('Context menu action failed:', error);
    }
  }, []);

  const buildInputMenuItems = useCallback((targetInput: HTMLInputElement | HTMLTextAreaElement): ContextMenuItemInput[] => {
    const start = Number(targetInput?.selectionStart);
    const end = Number(targetInput?.selectionEnd);
    const hasSelection = Number.isFinite(start) && Number.isFinite(end) && end > start;
    return [
      {
        key: 'cut',
        label: t('剪切'),
        shortcut: formatShortcut('Ctrl+X'),
        disabled: !hasSelection,
        onSelect: () => handleInputAction(targetInput, 'cut'),
      },
      {
        key: 'copy',
        label: t('复制'),
        shortcut: formatShortcut('Ctrl+C'),
        disabled: !hasSelection,
        onSelect: () => handleInputAction(targetInput, 'copy'),
      },
      {
        key: 'paste',
        label: t('粘贴'),
        shortcut: formatShortcut('Ctrl+V'),
        onSelect: () => handleInputAction(targetInput, 'paste'),
      },
      { type: 'divider', key: 'input-divider' },
      {
        key: 'select-all',
        label: t('全选'),
        shortcut: formatShortcut('Ctrl+A'),
        onSelect: () => handleInputAction(targetInput, 'selectAll'),
      },
    ];
  }, [handleInputAction, t]);

  const openMenu = useCallback((detail: ContextMenuPositionDetail & { items?: unknown }) => {
    const items = normalizeMenuItems(detail?.items);
    if (items.length === 0) {
      closeMenu();
      return;
    }
    const position = resolveMenuPosition(detail, items.length);
    setMenu({
      x: position.x,
      y: position.y,
      items,
    });
  }, [closeMenu]);

  const handleMenuItemClick = useCallback((item: NormalizedMenuItem) => {
    if (!item || item.type !== 'item' || item.disabled || typeof item.onSelect !== 'function') {
      return;
    }
    const onSelect = item.onSelect;
    closeMenu();
    Promise.resolve()
      .then(() => onSelect(item))
      .catch((error) => {
        console.error('Context menu action failed:', error);
      });
  }, [closeMenu]);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const targetInput = resolveEditableTarget(event.target);
      if (!targetInput) {
        return;
      }
      event.preventDefault();
      openMenu({
        x: event.clientX,
        y: event.clientY,
        estimatedWidth: 160,
        estimatedHeight: 150,
        items: buildInputMenuItems(targetInput),
      });
    };

    const handleCustomOpen = (event: CustomEvent<GlobalContextMenuDetail>) => {
      openMenu(event?.detail);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    // 自定义事件监听器签名与 EventListener 不完全一致，此处按需断言
    window.addEventListener(GLOBAL_CONTEXT_MENU_OPEN_EVENT, handleCustomOpen as EventListener);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', closeMenu);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener(GLOBAL_CONTEXT_MENU_OPEN_EVENT, handleCustomOpen as EventListener);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', closeMenu);
    };
  }, [buildInputMenuItems, closeMenu, openMenu]);

  if (!menu || typeof document === 'undefined') {
    return null;
  }

  const hasSubmenu = menu.items.some((item) => item.type === 'item' && item.children.length > 0);
  return createPortal(
    <div
      ref={menuRef}
      className={hasSubmenu ? 'context-menu has-submenu' : 'context-menu'}
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {menu.items.map((item) => {
        if (item.type === 'divider') {
          return <div key={item.key} className="context-menu-divider" />;
        }
        const hasChildren = item.children.length > 0;
        const submenuToLeft = typeof window !== 'undefined' && menu.x > window.innerWidth * 0.5;
        const className = [
          'context-menu-item',
          item.danger ? 'danger' : '',
          item.disabled ? 'disabled' : '',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={item.key}
            className={className}
            style={hasChildren ? { position: 'relative' } : undefined}
            onMouseEnter={() => setOpenSubmenuKey(hasChildren && !item.disabled ? item.key : null)}
            onClick={item.disabled || hasChildren ? undefined : () => handleMenuItemClick(item)}
          >
            <span className="item-label">{item.label}</span>
            {hasChildren
              ? <span className="item-shortcut" aria-hidden="true">›</span>
              : item.shortcut ? <span className="item-shortcut">{item.shortcut}</span> : null}
            {hasChildren && openSubmenuKey === item.key ? (
              <div
                className="context-menu"
                style={submenuToLeft
                  ? { position: 'absolute', right: '100%', top: -5, marginRight: 2 }
                  : { position: 'absolute', left: '100%', top: -5, marginLeft: 2 }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {item.children.map((child) => {
                  if (child.type === 'divider') {
                    return <div key={child.key} className="context-menu-divider" />;
                  }
                  const childClassName = [
                    'context-menu-item',
                    child.danger ? 'danger' : '',
                    child.disabled ? 'disabled' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div
                      key={child.key}
                      className={childClassName}
                      onClick={child.disabled ? undefined : () => handleMenuItemClick(child)}
                    >
                      <span className="item-label">{child.label}</span>
                      {child.shortcut ? <span className="item-shortcut">{child.shortcut}</span> : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>,
    document.body
  );
}
