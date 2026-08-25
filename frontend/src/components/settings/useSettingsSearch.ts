import { useState, useEffect, useCallback, useMemo } from 'react';
import { t as $t, type I18nKey } from '../../i18n.ts';
import { PROVIDER_LIST } from './sync/syncProviders.ts';
import { SETTINGS_SEARCH_DEFINITIONS, SETTINGS_SECTIONS } from './settingDefinitions';

const TAB_LABELS: Record<string, I18nKey> = { general: '通用', network: '网络', fileManager: '文件管理器', runtimeEnvironment: '运行环境', appearance: '外观', shortcuts: '快捷键', sync: '同步与云', app: '关于' };

export interface SettingsSearchOptions {
  language: string;
  supportsWebviewGpuDisable: boolean;
  activeTab: string;
  syncProvider: string;
  setActiveTab: (tab: string) => void;
  setSyncProvider: (provider: string) => void;
}

export function useSettingsSearch({
  language,
  supportsWebviewGpuDisable,
  activeTab,
  syncProvider,
  setActiveTab,
  setSyncProvider,
}: SettingsSearchOptions) {
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');
  const [pendingSettingsScrollTargetId, setPendingSettingsScrollTargetId] = useState('');

  // settingDefinitions.ts 已类型化，直接使用导出定义
  const settingsSectionTitleMap = useMemo(() => Object.fromEntries(
    SETTINGS_SECTIONS.map((item): [string, string] => [item.id || '', item.titleKey ? $t(item.titleKey) : '']),
  ), [language]);
  const availableSettingsSearchDefinitions = useMemo(() => SETTINGS_SEARCH_DEFINITIONS.filter((item) => {
    if (supportsWebviewGpuDisable) {
      return true;
    }
    return item.id !== 'general.section.rendering' && item.id !== 'general.webview-gpu';
  }), [supportsWebviewGpuDisable]);
  const settingsSearchResults = useMemo(() => {
    const normalizedQuery = String(settingsSearchQuery || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }
    const typePriority: Record<string, number> = { action: 0, option: 1, field: 2, 'field-group': 3, section: 4 };
    const deduped = new Map();
    availableSettingsSearchDefinitions.forEach((item) => {
      const title = item.titleKey ? $t(item.titleKey) : '';
      const description = item.descriptionKey ? $t(item.descriptionKey) : '';
      const tabLabel = TAB_LABELS[item.tab] ? $t(TAB_LABELS[item.tab]) : '';
      const sectionLabel = item.section && item.section !== item.id ? (settingsSectionTitleMap[item.section] || '') : '';
      const breadcrumbLabels = Array.isArray(item.breadcrumbTitleKeys)
        ? item.breadcrumbTitleKeys.map((key) => $t(key)).filter(Boolean)
        : [];
      const resolvedBreadcrumbLabels = breadcrumbLabels.length > 0 ? breadcrumbLabels : [tabLabel, sectionLabel].filter(Boolean);
      const searchText = [...resolvedBreadcrumbLabels, title, description].filter(Boolean).join(' ').toLowerCase();
      if (!searchText.includes(normalizedQuery)) {
        return;
      }
      const rank = title.toLowerCase().includes(normalizedQuery) ? 0 : (description.toLowerCase().includes(normalizedQuery) ? 1 : 2);
      const typeRank = Object.prototype.hasOwnProperty.call(typePriority, item.type) ? typePriority[item.type] : 9;
      const dedupeKey = `${title}::${resolvedBreadcrumbLabels.join(' / ')}`;
      const nextResult = {
        ...item,
        title,
        description,
        tabLabel,
        sectionLabel,
        breadcrumbLabels: resolvedBreadcrumbLabels,
        rank,
        typeRank,
      };
      const previous = deduped.get(dedupeKey);
      if (!previous || nextResult.rank < previous.rank || (nextResult.rank === previous.rank && nextResult.typeRank < previous.typeRank)) {
        deduped.set(dedupeKey, nextResult);
      }
    });
    return Array.from(deduped.values()).sort((left, right) => left.rank - right.rank || left.typeRank - right.typeRank || left.breadcrumbLabels.join(' / ').localeCompare(right.breadcrumbLabels.join(' / ')) || left.title.localeCompare(right.title));
  }, [availableSettingsSearchDefinitions, language, settingsSearchQuery, settingsSectionTitleMap]);
  type SettingsSearchResultItem = (typeof settingsSearchResults)[number];
  const handleSelectSettingsSearchResult = useCallback((result: SettingsSearchResultItem) => {
    if (!result) {
      return;
    }
    if (result.tab === 'sync') {
      const nextSyncProvider = result.providerId || '';
      if (PROVIDER_LIST.some((item) => item.id === nextSyncProvider)) {
        setSyncProvider(nextSyncProvider);
      }
    }
    setActiveTab(result.tab);
    setPendingSettingsScrollTargetId(result.targetId ?? '');
  }, []);
  useEffect(() => {
    if (!pendingSettingsScrollTargetId) {
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      document.querySelectorAll('[data-settings-highlight="true"]').forEach((node) => node.removeAttribute('data-settings-highlight'));
      const target = document.querySelector(`[data-settings-field-id="${pendingSettingsScrollTargetId}"],[data-settings-section-id="${pendingSettingsScrollTargetId}"]`);
      setPendingSettingsScrollTargetId('');
      if (!target) {
        return;
      }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.setAttribute('data-settings-highlight', 'true');
      window.setTimeout(() => {
        if (target.getAttribute('data-settings-highlight') === 'true') {
          target.removeAttribute('data-settings-highlight');
        }
      }, 1800);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab, pendingSettingsScrollTargetId, syncProvider]);

  return {
    settingsSearchQuery,
    setSettingsSearchQuery,
    settingsSearchResults,
    handleSelectSettingsSearchResult,
  };
}

export type SettingsSearchResultItem = ReturnType<typeof useSettingsSearch>['settingsSearchResults'][number];
