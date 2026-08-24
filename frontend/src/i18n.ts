import { useState, useEffect } from 'react';
import type { I18nDict, I18nKey, LanguageCode } from './i18n/types.ts';

export type { I18nKey, LanguageCode } from './i18n/types.ts';

const DEFAULT_LANG: LanguageCode = 'zh-CN';

/** 语言模块加载器：{ lang: () => Promise<{ default: 翻译表 }> } */
const languageModuleLoaders = import.meta.glob<{ default?: I18nDict }>('./i18n/*/basic.ts');
/** 语言标签（LANGUAGE_LABEL 具名导出，eager 加载）：{ lang: string } */
const languageLabelModules = import.meta.glob('./i18n/*/basic.ts', { import: 'LANGUAGE_LABEL', eager: true });

function buildLanguageMap<T>(modules: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(modules)
      .map(([filePath, value]): [string, T] | null => {
        const match = filePath.match(/^\.\/i18n\/([^/]+)\/basic\.ts$/);
        return match ? [match[1], value] : null;
      })
      .filter((entry): entry is [string, T] => entry !== null)
  );
}

const languageLoaders = buildLanguageMap(languageModuleLoaders);
const languageLabels = buildLanguageMap(languageLabelModules);

const loadedDict: Record<string, I18nDict> = Object.create(null);
const loadingPromises: Record<string, Promise<I18nDict>> = Object.create(null);

function isLanguageCode(lang: string): lang is LanguageCode {
  return Object.prototype.hasOwnProperty.call(languageLoaders, lang);
}

function normalizeLanguage(lang: string): LanguageCode {
  return isLanguageCode(lang) ? lang : DEFAULT_LANG;
}

let currentLang = normalizeLanguage(localStorage.getItem('appLanguage') || DEFAULT_LANG);
let activeLang: LanguageCode = DEFAULT_LANG;
const listeners = new Set<(lang: LanguageCode) => void>();

async function loadLanguage(lang: LanguageCode): Promise<I18nDict> {
  const normalizedLang = normalizeLanguage(lang);
  if (loadedDict[normalizedLang]) {
    return loadedDict[normalizedLang];
  }
  if (!loadingPromises[normalizedLang]) {
    loadingPromises[normalizedLang] = languageLoaders[normalizedLang]()
      .then((module) => {
        // 模块结构兜底：default 非对象时用空表（t() 内部对未知 key 有原样兜底）
        const table = (module?.default && typeof module.default === 'object' ? module.default : {}) as I18nDict;
        loadedDict[normalizedLang] = table;
        return table;
      })
      .finally(() => {
        delete loadingPromises[normalizedLang];
      });
  }
  return loadingPromises[normalizedLang];
}

function notifyLanguageChanged() {
  listeners.forEach((fn) => fn(activeLang));
}

function getActiveTable(): I18nDict {
  return loadedDict[activeLang] || loadedDict[DEFAULT_LANG] || ({} as I18nDict);
}

export async function initializeI18n(): Promise<LanguageCode> {
  await loadLanguage(DEFAULT_LANG);
  const nextLang = normalizeLanguage(currentLang);
  currentLang = nextLang;
  localStorage.setItem('appLanguage', nextLang);
  if (nextLang !== DEFAULT_LANG) {
    try {
      await loadLanguage(nextLang);
      activeLang = nextLang;
      return activeLang;
    } catch (error) {
      console.error('[i18n] failed to load language:', nextLang, error);
    }
  }
  activeLang = DEFAULT_LANG;
  return activeLang;
}

export async function setLanguage(lang: LanguageCode): Promise<LanguageCode> {
  const nextLang = normalizeLanguage(lang);
  currentLang = nextLang;
  localStorage.setItem('appLanguage', nextLang);
  try {
    await loadLanguage(nextLang);
    activeLang = nextLang;
  } catch (error) {
    console.error('[i18n] failed to switch language:', nextLang, error);
    activeLang = DEFAULT_LANG;
  }
  notifyLanguageChanged();
  return activeLang;
}

export function getLanguage(): LanguageCode {
  return currentLang;
}

export function getAvailableLanguages(): { code: LanguageCode; label: string }[] {
  return Object.keys(languageLoaders)
    .sort((left, right) => {
      if (left === DEFAULT_LANG) return -1;
      if (right === DEFAULT_LANG) return 1;
      return left.localeCompare(right);
    })
    .map((code) => {
      // code 来自 languageLoaders 的键，即已声明的 LanguageCode 集合
      const label = languageLabels[code];
      return {
        code: code as LanguageCode,
        label: typeof label === 'string' && label.trim() ? label.trim() : code,
      };
    });
}

function interpolateText(text: string, params?: Record<string, unknown>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

function translateDynamicText(text: string, table: Record<string, string>): string {
  if (typeof text !== 'string' || !text) {
    return text;
  }
  let next = text;
  next = next.replace(/\nai\.change_review\.start_line:(\d+)/g, (_, count: string) => `\n${interpolateText(table["起始行: {count}"] ?? "起始行: {count}", { count })}`);
  next = next.replace(/\nai\.change_review\.match_count:(\d+)/g, (_, count: string) => `\n${interpolateText(table["匹配次数: {count}"] ?? "匹配次数: {count}", { count })}`);
  next = next.replace(/\nai\.change_review\.similarity:([\d.]+):([\d.]+)/g, (_, similarity: string, required: string) => `\n${interpolateText(table["相似度: {similarity}% / 需要 {required}%"] ?? "相似度: {similarity}% / 需要 {required}%", { similarity, required })}`);
  next = next.replace(/\n\nai\.change_review\.best_match:\n/g, `\n\n${table["最佳匹配片段:"] ?? "最佳匹配片段:"}\n`);
  return next;
}

export function t(key: I18nKey, params?: Record<string, unknown>): string {
  const table = getActiveTable();
  const rawText = table[key] !== undefined ? table[key] : key;
  const translatedText = table[key] !== undefined ? rawText : translateDynamicText(rawText, table);
  return interpolateText(translatedText, params);
}

export function useTranslation(): { t: typeof t; lang: LanguageCode } {
  const [lang, setLang] = useState<LanguageCode>(activeLang);
  useEffect(() => {
    const handler = (nextLang: LanguageCode) => setLang(nextLang);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);
  return { t, lang };
}
