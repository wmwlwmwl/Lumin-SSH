import {
  CheckSquare,
  Database,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  History,
  LayoutGrid,
  List,
  Monitor,
  Search,
  Terminal,
  Trash2,
} from 'lucide-react';
import type React from 'react';
import type { ServerListViewMode } from '../../hooks/useDashboardPreferences.ts';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';
import { Button, ContextMenu } from '../ui';
import type { MenuItem } from '../ui';

export interface DashboardHeaderActionsProps {
  hostPageMode: 'hosts' | 'recent';
  switchHostPageMode: (mode: string) => void;
  recentServersCount: number;
  searchQuery: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  localMenuPos: { x: number; y: number } | null;
  setLocalMenuPos: (pos: { x: number; y: number } | null) => void;
  localMenuItems: MenuItem[];
  selectionMode: boolean;
  onSelectionModeToggle: () => void;
  serverListViewMode: ServerListViewMode;
  onViewModeChange: (mode: ServerListViewMode) => void;
  hideSensitive: boolean;
  onHideSensitiveToggle: () => void;
  hasVisibleGroupHeaders: boolean;
  allCollapsed: boolean;
  onToggleCollapseAllGroups: () => void;
  onOpenImportExport: () => void;
  onClearRecent: () => Promise<void>;
  hasRecentServers: boolean;
}

export function DashboardHeaderActions({
  hostPageMode,
  switchHostPageMode,
  recentServersCount,
  searchQuery,
  onSearchChange,
  localMenuPos,
  setLocalMenuPos,
  localMenuItems,
  selectionMode,
  onSelectionModeToggle,
  serverListViewMode,
  onViewModeChange,
  hideSensitive,
  onHideSensitiveToggle,
  hasVisibleGroupHeaders,
  allCollapsed,
  onToggleCollapseAllGroups,
  onOpenImportExport,
  onClearRecent,
  hasRecentServers,
}: DashboardHeaderActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="section-title-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 0 280px', minWidth: 'min(100%, 280px)', maxWidth: '100%' }}>
        <div className="segment-control dashboard-page-switch">
          <Tiptop text={t('主机')} placement="bottom">
            <button
              type="button"
              onClick={() => switchHostPageMode('hosts')}
              aria-label={t('主机')}
              aria-pressed={hostPageMode === 'hosts'}
              className={hostPageMode === 'hosts' ? 'active' : ''}
            >
              <Monitor size={13} />
              <span>{t('主机')}</span>
            </button>
          </Tiptop>
          <div className="segment-control-divider" />
          <Tiptop text={t('最近连接')} placement="bottom">
            <button
              type="button"
              onClick={() => switchHostPageMode('recent')}
              aria-label={t('最近连接')}
              aria-pressed={hostPageMode === 'recent'}
              className={hostPageMode === 'recent' ? 'active' : ''}
            >
              <History size={13} />
              <span>{t('最近连接')}</span>
              {recentServersCount > 0 && (
                <span className="dashboard-page-switch-count">{recentServersCount}</span>
              )}
            </button>
          </Tiptop>
        </div>
        <div style={{ position: 'relative', flex: '1 1 100px', maxWidth: 300, minWidth: 80 }}>
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
          <input
            id="server-search"
            name="serverSearch"
            type="search"
            autoComplete="off"
            aria-label={t('搜索服务器...')}
            className="input-compact w-full h-7 pl-[26px] pr-2 text-xs rounded-sm bg-sunken border border-line-subtle text-primary placeholder:text-muted"
            placeholder={t('搜索服务器...')}
            value={searchQuery}
            onChange={onSearchChange}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: '0 0 auto', marginLeft: 'auto' }}>
        <Tiptop text={t('本地终端 & 串口')} placement="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="bg-sunken border-line-subtle hover:border-line"
            aria-pressed={!!localMenuPos}
            aria-label={t('本地连接')}
            onClick={(e) => {
              if (localMenuPos) {
                setLocalMenuPos(null);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setLocalMenuPos({ x: rect.right - 200, y: rect.bottom + 4 });
            }}
          >
            <Terminal size={14} />
          </Button>
        </Tiptop>
        {localMenuPos && (
          <ContextMenu
            x={localMenuPos.x}
            y={localMenuPos.y}
            minWidth={200}
            items={localMenuItems}
            onClose={() => setLocalMenuPos(null)}
          />
        )}

        {hostPageMode === 'hosts' ? (
          <>
            <Tiptop text={selectionMode ? t('退出选择') : t('选择模式')} placement="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="bg-sunken border-line-subtle hover:border-line"
                onClick={onSelectionModeToggle}
                aria-label={selectionMode ? t('退出选择') : t('选择模式')}
                aria-pressed={selectionMode}
              >
                <CheckSquare size={14} />
              </Button>
            </Tiptop>
            <div className="segment-control">
              <Tiptop text={t('卡片视图')} placement="bottom">
                <button
                  onClick={() => onViewModeChange('grid')}
                  aria-label={t('卡片视图')}
                  className={serverListViewMode === 'grid' ? 'active' : ''}
                >
                  <LayoutGrid size={13} />
                </button>
              </Tiptop>
              <div className="segment-control-divider" />
              <Tiptop text={t('列表视图')} placement="bottom">
                <button
                  onClick={() => onViewModeChange('table')}
                  aria-label={t('列表视图')}
                  className={serverListViewMode === 'table' ? 'active' : ''}
                >
                  <List size={13} />
                </button>
              </Tiptop>
            </div>
            <Tiptop text={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')} placement="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'bg-sunken border-line-subtle hover:border-line',
                  hideSensitive && 'border-[rgba(var(--warning-rgb),0.35)] bg-warning-dim text-warning',
                )}
                onClick={onHideSensitiveToggle}
                aria-label={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                aria-pressed={hideSensitive}
              >
                {hideSensitive ? <Eye size={14} /> : <EyeOff size={14} />}
              </Button>
            </Tiptop>
            {hasVisibleGroupHeaders && (
              <Button
                variant="secondary"
                onClick={onToggleCollapseAllGroups}
                className="shrink-0 gap-[5px]"
              >
                {allCollapsed ? <Folder size={13} /> : <FolderOpen size={13} />}
                <span>{allCollapsed ? t('打开分组') : t('收起分组')}</span>
              </Button>
            )}
            <Tiptop text={t('数据管理')} placement="bottom">
              <Button variant="secondary" onClick={onOpenImportExport} aria-label={t('数据管理')} className="shrink-0 gap-[5px]">
                <Database size={13} />
                <span>{t('数据管理')}</span>
              </Button>
            </Tiptop>
          </>
        ) : (
          <>
            <Tiptop text={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')} placement="bottom">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'bg-sunken border-line-subtle hover:border-line',
                  hideSensitive && 'border-[rgba(var(--warning-rgb),0.35)] bg-warning-dim text-warning',
                )}
                onClick={onHideSensitiveToggle}
                aria-label={hideSensitive ? t('显示敏感信息') : t('隐藏敏感信息')}
                aria-pressed={hideSensitive}
              >
                {hideSensitive ? <Eye size={14} /> : <EyeOff size={14} />}
              </Button>
            </Tiptop>
            <Tiptop text={t('清空')} placement="bottom">
              <Button
                variant="secondary"
                onClick={() => void onClearRecent()}
                disabled={!hasRecentServers}
                aria-label={t('清空最近连接')}
                className="shrink-0 gap-[5px]"
              >
                <Trash2 size={13} />
                <span>{t('清空')}</span>
              </Button>
            </Tiptop>
          </>
        )}
      </div>
    </div>
  );
}
