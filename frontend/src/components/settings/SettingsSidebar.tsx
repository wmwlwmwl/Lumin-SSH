import { X, type LucideIcon } from 'lucide-react';
import { t as $t, type I18nKey } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import { SlidersHorizontal, Globe, Folder, Database, Palette, Keyboard, Cloud, Info } from 'lucide-react';
import type { SettingsSearchResultItem } from './useSettingsSearch';

const TAB_ICON: Record<string, LucideIcon> = { general: SlidersHorizontal, network: Globe, fileManager: Folder, runtimeEnvironment: Database, appearance: Palette, shortcuts: Keyboard, sync: Cloud, app: Info };

const TAB_LABELS: Record<string, I18nKey> = { general: '通用', network: '网络', fileManager: '文件管理器', runtimeEnvironment: '运行环境', appearance: '外观', shortcuts: '快捷键', sync: '同步与云', app: '关于' };

const TABS = [
  { id: 'general' },
  { id: 'network' },
  { id: 'fileManager' },
  { id: 'runtimeEnvironment' },
  { id: 'appearance' },
  { id: 'shortcuts' },
  { id: 'sync' },
  { id: 'app' },
];

export interface SettingsSidebarProps {
  settingsSearchQuery: string;
  setSettingsSearchQuery: (query: string) => void;
  settingsSearchResults: SettingsSearchResultItem[];
  activeTab: string;
  setActiveTab: (tab: string) => void;
  handleSelectSettingsSearchResult: (result: SettingsSearchResultItem) => void;
}

export default function SettingsSidebar({
  settingsSearchQuery,
  setSettingsSearchQuery,
  settingsSearchResults,
  activeTab,
  setActiveTab,
  handleSelectSettingsSearchResult,
}: SettingsSidebarProps) {
  return (
    <div className="settings-sidebar">
      <div className="px-1 pb-2">
        <div className="relative">
          <input
            id="settings-modal-search"
            name="settings-modal-search"
            autoComplete="off"
            className="input w-full h-[30px] text-sm"
            value={settingsSearchQuery}
            onChange={(event) => setSettingsSearchQuery(event.target.value)}
            placeholder={$t('搜索...')}
            style={{ paddingRight: settingsSearchQuery ? 34 : 12 }}
          />
          {settingsSearchQuery ? (
            <button
              type="button"
              onClick={() => setSettingsSearchQuery('')}
              className="absolute top-1/2 -translate-y-1/2 right-[7px] w-4 h-4 p-0 m-0 border-none bg-transparent text-tertiary inline-flex items-center justify-center cursor-pointer shadow-none"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>
      {settingsSearchQuery.trim() ? (
        <div className="flex flex-col gap-1.5 overflow-y-auto px-1 pb-1">
          <div className="px-1.5 text-xs text-tertiary">{$t('搜索结果')} · {settingsSearchResults.length}</div>
          {settingsSearchResults.length > 0 ? settingsSearchResults.map((result) => (
            <button
              type="button"
              key={`${result.id}:${result.targetId}`}
              onClick={() => handleSelectSettingsSearchResult(result)}
              className={cn(
                'flex flex-col gap-1 w-full py-[9px] px-2.5 rounded-sm border border-line text-secondary cursor-pointer text-left',
                result.tab === activeTab ? 'bg-overlay' : 'bg-raised',
              )}
            >
              <div className="text-sm font-semibold text-primary leading-[1.4]">{result.title}</div>
              {result.description ? <div className="text-xs text-tertiary leading-[1.5]">{result.description}</div> : null}
              <div className="text-[10px] text-tertiary leading-[1.5]">{result.breadcrumbLabels.length > 0 ? result.breadcrumbLabels.join(' / ') : result.tabLabel}</div>
            </button>
          )) : (
            <div className="py-2.5 px-3 rounded-sm border border-dashed border-line bg-raised">
              <div className="text-sm font-semibold text-primary">{$t('未找到结果')}</div>
              <div className="mt-1 text-xs text-tertiary">{$t('尝试其他关键词')}</div>
            </div>
          )}
        </div>
      ) : TABS.map(tab => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            'flex items-center gap-2 py-[7px] px-2.5 rounded-sm cursor-pointer text-base transition-colors duration-[120ms]',
            activeTab === tab.id ? 'bg-overlay text-primary font-semibold' : 'text-secondary',
          )}
        >
          <span className="inline-flex items-center">{(() => { const IC = TAB_ICON[tab.id]; return IC ? <IC size={15} /> : null; })()}</span> {$t(TAB_LABELS[tab.id])}
        </div>
      ))}
    </div>
  );
}
