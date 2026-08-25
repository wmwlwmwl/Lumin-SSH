import { useCallback, useMemo, useRef, useState } from 'react';
import type { config } from '../../../wailsjs/go/models.ts';
import { useTranslation } from '../../i18n.ts';
import { clampMenuPosition } from '../../utils/menuPosition.ts';
import {
  MENU_ESTIMATED_HEIGHT,
  MENU_ESTIMATED_WIDTH,
  type FlatItem,
  type ServerListProps,
} from './serverListTypes.ts';

const DRAG_SELECT_THRESHOLD_PX = 5;

export function useServerList(props: ServerListProps) {
  const {
    servers,
    sessions,
    activeSessionId,
    hideSensitive = false,
    onConnect,
    onEdit,
    addToast,
    saveFlowHighlights = { serverId: null, rowPulse: null, fields: {} },
    selectionMode = false,
    selectedIds = [],
    onSelectChange,
    onRenameGroup,
    collapsedGroups: controlledCollapsedGroups,
    onCollapsedGroupsChange,
  } = props;

  const { t } = useTranslation();
  const [menuServer, setMenuServer] = useState<config.Connection | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [groupHeaderMenu, setGroupHeaderMenu] = useState<{ groupName: string; x: number; y: number } | null>(null);
  const [groupMenu, setGroupMenu] = useState(false);
  const [localCollapsedGroups, setLocalCollapsedGroups] = useState<Set<string>>(new Set());
  const collapsedGroups = controlledCollapsedGroups ?? localCollapsedGroups;
  const setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>> = onCollapsedGroupsChange ?? setLocalCollapsedGroups;
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('serverGroupOrder') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const menuSourceRef = useRef<HTMLElement | null>(null);
  const submenuToggleRef = useRef(false);
  const lastClickedIndex = useRef(-1);

  const closeServerMenu = () => {
    setMenuServer(null);
    setGroupMenu(false);
  };

  const pointerGestureRef = useRef({ x: 0, y: 0, moved: false, active: false });

  const clearTextSelection = () => {
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch {}
  };

  const hasMeaningfulTextSelection = () => {
    try {
      const sel = window.getSelection?.();
      return !!(sel && String(sel.toString() || '').trim());
    } catch {
      return false;
    }
  };

  const markPointerDown = (e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    pointerGestureRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      active: true,
    };
  };

  const markPointerMove = (e: React.PointerEvent) => {
    const g = pointerGestureRef.current;
    if (!g.active || g.moved) return;
    const dx = Math.abs(e.clientX - g.x);
    const dy = Math.abs(e.clientY - g.y);
    if (dx > DRAG_SELECT_THRESHOLD_PX || dy > DRAG_SELECT_THRESHOLD_PX) {
      g.moved = true;
    }
  };

  const markPointerUp = () => {
    pointerGestureRef.current.active = false;
  };

  const wasDragSelect = () => pointerGestureRef.current.moved;

  const tryConnect = (server: config.Connection) => {
    if (!server || typeof onConnect !== 'function') return;
    if (wasDragSelect()) return;
    if (hasMeaningfulTextSelection()) return;
    clearTextSelection();
    onConnect(server);
  };

  const pointerSelectHandlers = {
    onPointerDown: markPointerDown,
    onPointerMove: markPointerMove,
    onPointerUp: markPointerUp,
    onPointerCancel: markPointerUp,
  };

  const connectedSessionMap = useMemo(() => {
    const m = new Map<string, (typeof sessions)[number]>();
    sessions.forEach((s) => {
      if (s.status === 'connected') m.set(s.serverId || '', s);
    });
    return m;
  }, [sessions]);

  const mask = (text: string) => (hideSensitive ? String(text || '').replace(/[^@.:/\s-]/g, '*') : text);

  const getEditAnimationPayload = (server: config.Connection, sourceRoot: HTMLElement | null) => {
    const root = sourceRoot || null;
    const sourceRect = root?.getBoundingClientRect?.();
    const getRect = (field: string) => {
      const el = root?.querySelector?.(`[data-edit-source-field="${field}"]`);
      const rect = el?.getBoundingClientRect?.() || sourceRect;
      if (!rect) return null;
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const port = String(server.port || 22);
    return {
      sourceRects: {
        name: getRect('name'),
        host: getRect('host') || getRect('hostPort'),
        port: getRect('port') || getRect('hostPort'),
        username: getRect('username') || getRect('hostPort'),
        terminalInitPath: sourceRect ? {
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
        } : null,
        fileManagerInitPath: sourceRect ? {
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
        } : null,
      },
      labels: {
        name: server.name || server.host || '',
        host: hideSensitive ? mask(server.host) : server.host,
        port: hideSensitive ? mask(port) : port,
        username: hideSensitive ? mask(server.username) : server.username,
        terminalInitPath: server.terminalInitPath || '',
        fileManagerInitPath: server.fileManagerInitPath || '',
      },
    };
  };

  const triggerEdit = (server: config.Connection, sourceRoot: HTMLElement | null) => {
    onEdit(server, getEditAnimationPayload(server, sourceRoot));
  };

  const handleContextMenu = (e: React.MouseEvent, server: config.Connection) => {
    e.preventDefault();
    e.stopPropagation();
    menuSourceRef.current = e.currentTarget as HTMLElement;
    setMenuServer(server);
    setMenuPos(clampMenuPosition(e.clientX, e.clientY, MENU_ESTIMATED_WIDTH, MENU_ESTIMATED_HEIGHT));
  };

  const isActive = (server: config.Connection) => {
    const session = sessions.find((s) => s.serverId === server.id && s.status !== 'closed');
    return session && session.id === activeSessionId;
  };

  const hasSession = (server: config.Connection) => sessions.some((s) => s.serverId === server.id && s.status !== 'closed');

  const getSaveFlowTokens = (server: config.Connection) => {
    if (saveFlowHighlights?.serverId !== server.id) {
      return { rowToken: null, nameToken: null, hostToken: null, usernameToken: null };
    }
    const fields = saveFlowHighlights.fields || {};
    return {
      rowToken: saveFlowHighlights.rowPulse || null,
      nameToken: fields.name || null,
      hostToken: fields.host || fields.port || fields.username || null,
      usernameToken: fields.username || null,
    };
  };

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allGroupServerIds = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const s of servers) {
      const g = s.group || '';
      (m[g] = m[g] || []).push(s.id);
    }
    return m;
  }, [servers]);

  const flatItemsRef = useRef<FlatItem[] | null>(null);

  const handleServerClick = useCallback((server: config.Connection, flatIdx: number) => {
    if (!selectionMode) return;
    onSelectChange(server.id);
    lastClickedIndex.current = flatIdx;
  }, [selectionMode, onSelectChange]);

  const handleShiftClick = useCallback((server: config.Connection, flatIdx: number) => {
    if (!selectionMode || lastClickedIndex.current < 0 || !flatItemsRef.current) return;
    const flatItems = flatItemsRef.current;
    const start = Math.min(lastClickedIndex.current, flatIdx);
    const end = Math.max(lastClickedIndex.current, flatIdx);
    const serverIds: string[] = [];
    for (let i = start; i <= end; i++) {
      const item = flatItems[i];
      if (item && item.type === 'server') serverIds.push(item.server.id);
    }
    onSelectChange(serverIds);
    lastClickedIndex.current = flatIdx;
  }, [selectionMode, onSelectChange]);

  const handleGroupToggleSelect = useCallback((groupName: string) => {
    if (!selectionMode) return;
    const ids = allGroupServerIds[groupName] || [];
    if (ids.length === 0) return;
    const alreadyAllSelected = ids.every((id) => selectedSet.has(id));
    onSelectChange(ids.map((id) => ({ id, selected: !alreadyAllSelected })));
  }, [selectionMode, allGroupServerIds, selectedSet, onSelectChange]);

  const isGroupSelected = useCallback((groupName: string) => {
    const ids = allGroupServerIds[groupName] || [];
    return ids.length > 0 && ids.every((id) => selectedSet.has(id));
  }, [allGroupServerIds, selectedSet]);

  const isGroupPartiallySelected = useCallback((groupName: string) => {
    const ids = allGroupServerIds[groupName] || [];
    if (ids.length === 0) return false;
    const selectedCount = ids.filter((id) => selectedSet.has(id)).length;
    return selectedCount > 0 && selectedCount < ids.length;
  }, [allGroupServerIds, selectedSet]);

  const groupedServers = useMemo(() => {
    const groups: Record<string, config.Connection[]> = {};
    for (const s of servers) {
      const g = s.group || '';
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    }
    const names = Object.keys(groups);
    const ordered = groupOrder.filter((g) => g !== '' && groups[g]);
    const unordered = names.filter((g) => g !== '' && !groupOrder.includes(g)).sort((a, b) => a.localeCompare(b));
    const result: Array<[string, config.Connection[]]> = [];
    for (const g of [...ordered, ...unordered]) result.push([g, groups[g]]);
    if (groups['']) result.push(['', groups['']]);
    return result;
  }, [servers, groupOrder]);

  const existingGroups = useMemo(() => {
    const s = new Set<string>();
    for (const srv of servers) {
      if (srv.group) s.add(srv.group);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [servers]);

  const toggleGroup = (g: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const openGroupHeaderMenu = (e: React.MouseEvent, groupName: string) => {
    if (!groupName || !onRenameGroup) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuServer(null);
    setGroupMenu(false);
    setGroupHeaderMenu({ groupName, x: e.clientX, y: e.clientY });
  };

  const handleRenameGroupFromMenu = async () => {
    if (!groupHeaderMenu?.groupName || !onRenameGroup) return;
    const oldName = groupHeaderMenu.groupName;
    setGroupHeaderMenu(null);
    const newName = await onRenameGroup(oldName);
    if (!newName || newName === oldName) return;
    setCollapsedGroups((prev) => {
      if (!prev.has(oldName)) return prev;
      const next = new Set(prev);
      next.delete(oldName);
      next.add(newName);
      return next;
    });
    setGroupOrder((prev) => {
      if (!prev.includes(oldName)) return prev;
      const next = prev.map((g) => (g === oldName ? newName : g));
      localStorage.setItem('serverGroupOrder', JSON.stringify(next));
      return next;
    });
  };

  const moveGroup = (g: string, dir: number) => {
    const names = groupedServers.filter(([n]) => n !== '').map(([n]) => n);
    const idx = names.indexOf(g);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= names.length) return;
    [names[idx], names[newIdx]] = [names[newIdx], names[idx]];
    setGroupOrder(names);
    localStorage.setItem('serverGroupOrder', JSON.stringify(names));
    if (addToast) addToast(t('已移动'), 'success', 1500);
  };

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];
    for (const [groupName, groupServers] of groupedServers) {
      const collapsed = collapsedGroups.has(groupName);
      const showHeader = groupedServers.length > 1 || groupName !== '';
      if (showHeader) items.push({ type: 'header', groupName, count: groupServers.length, collapsed });
      if (!collapsed) {
        for (const server of groupServers) items.push({ type: 'server', server });
      }
    }
    return items;
  }, [groupedServers, collapsedGroups]);

  flatItemsRef.current = flatItems;

  return {
    menuServer,
    menuPos,
    groupHeaderMenu,
    setGroupHeaderMenu,
    groupMenu,
    setGroupMenu,
    menuSourceRef,
    submenuToggleRef,
    closeServerMenu,
    tryConnect,
    pointerSelectHandlers,
    connectedSessionMap,
    mask,
    getEditAnimationPayload,
    triggerEdit,
    handleContextMenu,
    isActive,
    hasSession,
    getSaveFlowTokens,
    selectedSet,
    allGroupServerIds,
    handleServerClick,
    handleShiftClick,
    handleGroupToggleSelect,
    isGroupSelected,
    isGroupPartiallySelected,
    existingGroups,
    toggleGroup,
    openGroupHeaderMenu,
    handleRenameGroupFromMenu,
    moveGroup,
    flatItems,
  };
}
