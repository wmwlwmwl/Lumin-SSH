import type React from 'react';
import type { config } from '../../../wailsjs/go/models.ts';
import type { ServerListViewMode } from '../../hooks/useDashboardPreferences.ts';
import type { ServerPingResult } from '../../hooks/useServerPing.ts';

export const MENU_ESTIMATED_WIDTH = 196;
export const MENU_ESTIMATED_HEIGHT = 160;

export interface ServerListProps {
  servers: config.Connection[];
  pingEnabled: boolean;
  pings: Record<string, ServerPingResult>;
  sessions: Array<{ id?: string; serverId?: string; status?: string; osInfo?: unknown; [key: string]: unknown }>;
  activeSessionId: string | null;
  viewMode?: ServerListViewMode;
  hideSensitive?: boolean;
  onConnect: (server: config.Connection) => void;
  onEdit: (server: config.Connection, payload: unknown) => void;
  onClone: (server: config.Connection, payload: unknown) => void;
  onDelete: (id: string) => void;
  onMoveGroup?: (id: string, group: string) => void;
  addToast: (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;
  saveFlowHighlights?: { serverId: string | null; rowPulse: unknown; fields: Record<string, unknown> };
  selectionMode?: boolean;
  selectedIds?: string[];
  onSelectChange: (payload: string | string[] | Array<{ id: string; selected: boolean }>) => void;
  onBatchDelete?: (ids: string[]) => void;
  onBatchConnect?: (ids: string[]) => void;
  onBatchMoveGroup?: (ids: string[], group: string) => void;
  onGroupDelete?: (groupName: string, ids: string[]) => void;
  onRenameGroup?: (oldName: string) => string | null | Promise<string | null>;
  onBatchExport?: (ids: string[]) => void;
  onExitSelectionMode?: () => void;
  collapsedGroups: Set<string>;
  onCollapsedGroupsChange: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/** 扁平列表条目（分组 header 或服务器卡片） */
export type FlatItem =
  | { type: 'header'; groupName: string; count: number; collapsed: boolean }
  | { type: 'server'; server: config.Connection };
