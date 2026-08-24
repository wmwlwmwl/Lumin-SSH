import { t, type I18nKey } from '../i18n.ts'
import {
  buildCommandReplacementValue,
  buildTokenReplacementValue,
  normalizeRemoteAbsolutePath,
  type CommandInputContext,
} from './terminalCommandAutocompleteParser.ts'
import type { AutocompletePlan, CommandNode } from './terminalCommandAutocompleteRegistry.ts'

const COMMAND_AUTOCOMPLETE_LIMIT = 10

type AutocompleteItemSource =
  | 'server-history'
  | 'global-history'
  | 'quick'
  | 'path'
  | 'subcommand'
  | 'builtin'
  | 'literal';

/** 自动补全候选项 */
export interface AutocompleteItem {
  source: AutocompleteItemSource;
  label: string;
  value: string;
  description?: string;
  badge: string;
  score: number;
  dedupeKey?: string;
  quickCommand?: {
    name: string;
    command: string;
    groupPath: string;
    addCR: boolean;
  };
}

/** 顶层补全数据源 */
export interface AutocompleteSources {
  serverHistory?: string[];
  globalHistory?: string[];
  quickCommands?: Array<{
    name?: string;
    command?: string;
    groupPath?: string;
    addCR?: boolean;
  }>;
}

/** 路径补全的异步上下文（在 CommandInputContext 上扩展） */
export interface AsyncPathContext extends CommandInputContext {
  provider: 'path';
  listPath: string;
  candidatePrefix: string;
  partialName: string;
  directoryOnly: boolean;
  fileOnly: boolean;
  chainPath: string[];
}

function getAutocompleteBadge(source: string, fallbackBadge = ''): string {
  if (fallbackBadge) {
    return fallbackBadge
  }

  switch (source) {
    case 'server-history':
      return t('历史')
    case 'global-history':
      return t('全局')
    case 'quick':
      return t('快捷')
    case 'path':
      return t('路径')
    case 'subcommand':
      return t('子命令')
    case 'builtin':
      return t('命令')
    default:
      return t('参数')
  }
}

function scorePrefixMatch(candidate: string, query: string): number {
  if (!candidate || !query) {
    return 0
  }
  if (candidate === query) {
    return 120
  }
  if (candidate.startsWith(query)) {
    return 100
  }
  return 0
}

function scoreLooseMatch(candidate: string, query: string): number {
  if (!candidate || !query) {
    return 0
  }
  if (candidate === query) {
    return 120
  }
  if (candidate.startsWith(query)) {
    return 100
  }
  if (candidate.includes(query)) {
    return 60
  }
  return 0
}

function dedupeAutocompleteItems(items: AutocompleteItem[]): AutocompleteItem[] {
  const bestByValue = new Map<string, AutocompleteItem>()

  items.forEach((item) => {
    if (!item || !item.value) {
      return
    }
    const key = String(item.dedupeKey || item.value)
    const existing = bestByValue.get(key)
    if (!existing || (item.score || 0) > (existing.score || 0)) {
      bestByValue.set(key, item)
    }
  })

  return [...bestByValue.values()]
    .sort((left, right) => {
      const scoreDiff = (right.score || 0) - (left.score || 0)
      if (scoreDiff !== 0) {
        return scoreDiff
      }
      return String(left.label || '').localeCompare(String(right.label || ''), 'zh-CN')
    })
    .slice(0, COMMAND_AUTOCOMPLETE_LIMIT)
}

interface RemoteDirEntry {
  name: string;
  isDirectory: boolean;
}

function normalizeRemoteDirEntries(entries: unknown): RemoteDirEntry[] {
  return Array.isArray(entries)
    ? entries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          name: typeof (entry as { name?: unknown }).name === 'string' ? ((entry as { name: string }).name.trim()) : '',
          isDirectory: Boolean((entry as { isDirectory?: unknown }).isDirectory),
        }))
        .filter((entry) => entry.name)
    : []
}

function joinRemoteAutocompletePath(basePath: string, name: string): string {
  const normalizedBasePath = normalizeRemoteAbsolutePath(basePath) || '/'
  const trimmedBasePath = normalizedBasePath === '/' ? '/' : normalizedBasePath.replace(/\/+$/g, '')
  return trimmedBasePath === '/' ? `/${name}` : `${trimmedBasePath}/${name}`
}

export function buildTopLevelCommandItems(options: {
  context: CommandInputContext;
  sources?: AutocompleteSources;
  builtinCommandNames?: string[];
}): AutocompleteItem[] {
  const { context, sources, builtinCommandNames } = options
  const query = String(context?.tokenLower || '').trim()
  const items: AutocompleteItem[] = []

  const addCandidate = (
    value: string,
    source: AutocompleteItemSource,
    scoreBase: number,
    extras: { description?: string; appendSpace?: boolean } = {},
  ) => {
    const normalizedValue = String(value || '').trim()
    if (!normalizedValue) {
      return
    }

    const matchScore = query ? scorePrefixMatch(normalizedValue.toLowerCase(), query) : 90
    if (query && matchScore <= 0) {
      return
    }

    items.push({
      source,
      label: normalizedValue,
      value: buildCommandReplacementValue(context, normalizedValue, extras.appendSpace),
      description: extras.description,
      badge: getAutocompleteBadge(source),
      score: scoreBase + matchScore,
    })
  }

  ;(sources?.serverHistory || []).forEach((command, index) => {
    addCandidate(command, 'server-history', 420 - index)
  })

  ;(sources?.quickCommands || []).forEach((item, index) => {
    addCandidate(item.command || '', 'quick', 340 - index, {
      description: item.groupPath ? `${item.name} · ${item.groupPath}` : item.name,
    })
  })

  ;(sources?.globalHistory || []).forEach((command, index) => {
    addCandidate(command, 'global-history', 280 - index)
  })

  ;(builtinCommandNames || []).forEach((command, index) => {
    addCandidate(command, 'builtin', 220 - index, {
      appendSpace: true,
    })
  })

  return dedupeAutocompleteItems(items)
}

export function buildSlashQuickCommandItems(options: {
  context: CommandInputContext;
  sources?: AutocompleteSources;
}): AutocompleteItem[] {
  const { context, sources } = options
  const rawQuery = String(context?.command || '')
  if (!rawQuery.startsWith('/')) {
    return []
  }

  const query = rawQuery.slice(1).trim().toLowerCase()
  const items: Array<AutocompleteItem | null> = (sources?.quickCommands || [])
    .map((item, index) => {
      const name = String(item?.name || '').trim()
      const command = String(item?.command || '').trim()
      const groupPath = String(item?.groupPath || '').trim()
      if (!name || !command) {
        return null
      }

      const nameScore = query ? scoreLooseMatch(name.toLowerCase(), query) : 120
      const matchScore = nameScore > 0 ? nameScore + 40 : 0

      if (query && matchScore <= 0) {
        return null
      }

      return {
        source: 'quick' as const,
        label: `/${name}`,
        value: buildCommandReplacementValue(context, command),
        quickCommand: { name, command, groupPath, addCR: item.addCR !== false },
        description: groupPath ? `${command} · ${groupPath}` : command,
        badge: getAutocompleteBadge('quick'),
        dedupeKey: `quick-slash:${name}\u0000${command}\u0000${groupPath}`,
        score: 520 + matchScore - index,
      }
    })
    .filter(Boolean)

  return dedupeAutocompleteItems(items as AutocompleteItem[])
}

export function buildChildCommandItems(options: {
  context: CommandInputContext;
  plan: Extract<AutocompletePlan, { kind: 'child-command' }>;
}): AutocompleteItem[] {
  const { context, plan } = options
  const query = String(context?.tokenLower || '').trim()
  const items: Array<AutocompleteItem | null> = (plan?.node?.children || [])
    .map((child: CommandNode, index) => {
      const childName = String(child?.name || '').trim()
      if (!childName) {
        return null
      }

      const matchScore = query ? scorePrefixMatch(childName.toLowerCase(), query) : 90
      if (query && matchScore <= 0) {
        return null
      }

      const label = [...(plan.chainPath || []), childName].join(' ')
      return {
        source: 'subcommand' as const,
        label,
        value: buildTokenReplacementValue(context, childName, true),
        description: child.description ? t(child.description as I18nKey) : `${(plan.chainPath || []).join(' ')} ${t('子命令')}`,
        badge: getAutocompleteBadge('subcommand'),
        score: 380 + matchScore - index,
      }
    })
    .filter(Boolean)

  return dedupeAutocompleteItems(items as AutocompleteItem[])
}

export function buildSyncProviderItems(options: {
  context: CommandInputContext;
  plan: AutocompletePlan;
}): AutocompleteItem[] {
  const { context, plan } = options
  if (plan?.kind !== 'arg-provider') {
    return []
  }

  const query = String(context?.tokenLower || '').trim()
  const argRule = plan.argRule

  if (argRule.provider !== 'literal' || !Array.isArray(argRule.items)) {
    return []
  }

  const prefixLabel = (plan.chainPath || []).join(' ')
  const items: Array<AutocompleteItem | null> = argRule.items
    .map((item, index) => {
      const value = String(item?.value || '').trim()
      if (!value) {
        return null
      }

      const matchScore = query ? scorePrefixMatch(value.toLowerCase(), query) : 90
      if (query && matchScore <= 0) {
        return null
      }

      return {
        source: 'literal' as const,
        label: prefixLabel ? `${prefixLabel} ${value}` : value,
        value: buildTokenReplacementValue(context, value, true),
        // 动态描述文案可能不在翻译表，t() 内部有原样兜底
        description: item?.description ? t(String(item.description) as I18nKey) : '',
        badge: getAutocompleteBadge('literal', argRule.badge),
        score: 360 + matchScore - index,
      }
    })
    .filter(Boolean)

  return dedupeAutocompleteItems(items as AutocompleteItem[])
}

export function buildAsyncProviderContext(options: {
  context: CommandInputContext;
  plan: AutocompletePlan;
}): AsyncPathContext | null {
  const { context, plan } = options
  if (plan?.kind !== 'arg-provider' || plan.argRule?.provider !== 'path') {
    return null
  }

  const token = String(context?.token || '')
  if (token.startsWith('-')) {
    return null
  }

  let listPath = context.currentCwd
  let candidatePrefix = ''
  let partialName = ''

  if (token.startsWith('/')) {
    if (token === '/' || token.endsWith('/')) {
      listPath = normalizeRemoteAbsolutePath(token.replace(/\/+$/g, '')) || '/'
      candidatePrefix = token === '/' ? '/' : `${token.replace(/\/+$/g, '')}/`
    } else {
      const lastSlashIndex = token.lastIndexOf('/')
      const parentPath = lastSlashIndex <= 0 ? '/' : token.slice(0, lastSlashIndex)
      listPath = normalizeRemoteAbsolutePath(parentPath) || '/'
      candidatePrefix = token.slice(0, lastSlashIndex + 1)
      partialName = token.slice(lastSlashIndex + 1)
    }
  } else if (token.includes('/')) {
    const lastSlashIndex = token.lastIndexOf('/')
    const relativeBase = token.slice(0, lastSlashIndex)
    listPath = joinRemoteAutocompletePath(context.currentCwd, relativeBase)
    candidatePrefix = relativeBase ? `${relativeBase.replace(/\/+$/g, '')}/` : ''
    partialName = token.slice(lastSlashIndex + 1)
  } else {
    partialName = token
  }

  return {
    ...context,
    provider: 'path',
    listPath,
    candidatePrefix,
    partialName,
    directoryOnly: Boolean(plan.argRule?.directoryOnly),
    fileOnly: Boolean(plan.argRule?.fileOnly),
    chainPath: plan.chainPath || [],
  }
}

export async function loadAsyncProviderItems(options: {
  sessionId?: string;
  asyncContext: AsyncPathContext | null;
  listDir?: (sessionId: string, path: string) => Promise<unknown>;
}): Promise<AutocompleteItem[]> {
  const { sessionId, asyncContext, listDir } = options
  if (!sessionId || !asyncContext || typeof listDir !== 'function') {
    return []
  }

  let entries: RemoteDirEntry[] = []
  try {
    entries = normalizeRemoteDirEntries(await listDir(sessionId, asyncContext.listPath))
  } catch (_) {
    return []
  }

  const prefixLabel = (asyncContext.chainPath || []).join(' ')
  const needle = String(asyncContext.partialName || '').toLowerCase()
  const items = entries
    .filter((entry) => !asyncContext.directoryOnly || entry.isDirectory)
    .filter((entry) => !asyncContext.fileOnly || !entry.isDirectory)
    .filter((entry) => !needle || entry.name.toLowerCase().startsWith(needle))
    .map((entry, index) => {
      const relativePath = `${asyncContext.candidatePrefix}${entry.name}${entry.isDirectory ? '/' : ''}`
      const absolutePath = joinRemoteAutocompletePath(asyncContext.listPath, entry.name)
      return {
        source: 'path' as const,
        label: prefixLabel ? `${prefixLabel} ${relativePath}` : relativePath,
        value: buildTokenReplacementValue(asyncContext, relativePath),
        description: `${absolutePath}${entry.isDirectory ? '/' : ''}`,
        badge: getAutocompleteBadge('path'),
        score: 500 + (needle && entry.name.toLowerCase().startsWith(needle) ? 40 : 20) - index,
      }
    })

  return dedupeAutocompleteItems(items)
}
