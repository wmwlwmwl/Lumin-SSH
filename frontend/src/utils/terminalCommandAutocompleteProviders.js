import { t } from '../i18n.js'
import {
  buildCommandReplacementValue,
  buildTokenReplacementValue,
  normalizeRemoteAbsolutePath,
} from './terminalCommandAutocompleteParser.js'

const COMMAND_AUTOCOMPLETE_LIMIT = 10

function getAutocompleteBadge(source, fallbackBadge = '') {
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

function scorePrefixMatch(candidate, query) {
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

function scoreLooseMatch(candidate, query) {
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

function dedupeAutocompleteItems(items) {
  const bestByValue = new Map()

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

function normalizeRemoteDirEntries(entries) {
  return Array.isArray(entries)
    ? entries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          name: typeof entry.name === 'string' ? entry.name.trim() : '',
          isDirectory: Boolean(entry.isDirectory),
        }))
        .filter((entry) => entry.name)
    : []
}

function joinRemoteAutocompletePath(basePath, name) {
  const normalizedBasePath = normalizeRemoteAbsolutePath(basePath) || '/'
  const trimmedBasePath = normalizedBasePath === '/' ? '/' : normalizedBasePath.replace(/\/+$/g, '')
  return trimmedBasePath === '/' ? `/${name}` : `${trimmedBasePath}/${name}`
}

export function buildTopLevelCommandItems({ context, sources, builtinCommandNames }) {
  const query = String(context?.tokenLower || '').trim()
  const items = []

  const addCandidate = (value, source, scoreBase, { description = '', appendSpace = false } = {}) => {
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
      value: buildCommandReplacementValue(context, normalizedValue, appendSpace),
      description,
      badge: getAutocompleteBadge(source),
      score: scoreBase + matchScore,
    })
  }

  ;(sources?.serverHistory || []).forEach((command, index) => {
    addCandidate(command, 'server-history', 420 - index)
  })

  ;(sources?.quickCommands || []).forEach((item, index) => {
    addCandidate(item.command, 'quick', 340 - index, {
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

export function buildSlashQuickCommandItems({ context, sources }) {
  const rawQuery = String(context?.command || '')
  if (!rawQuery.startsWith('/')) {
    return []
  }

  const query = rawQuery.slice(1).trim().toLowerCase()
  const items = (sources?.quickCommands || [])
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
        source: 'quick',
        label: `/${name}`,
        value: buildCommandReplacementValue(context, command),
        description: groupPath ? `${command} · ${groupPath}` : command,
        badge: getAutocompleteBadge('quick'),
        dedupeKey: `quick-slash:${name}\u0000${command}\u0000${groupPath}`,
        score: 520 + matchScore - index,
      }
    })
    .filter(Boolean)

  return dedupeAutocompleteItems(items)
}

export function buildChildCommandItems({ context, plan }) {
  const query = String(context?.tokenLower || '').trim()
  const items = (plan?.node?.children || [])
    .map((child, index) => {
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
        source: 'subcommand',
        label,
        value: buildTokenReplacementValue(context, childName, true),
        description: child.description ? t(child.description) : `${(plan.chainPath || []).join(' ')} ${t('子命令')}`,
        badge: getAutocompleteBadge('subcommand'),
        score: 380 + matchScore - index,
      }
    })
    .filter(Boolean)

  return dedupeAutocompleteItems(items)
}

export function buildSyncProviderItems({ context, plan }) {
  if (plan?.kind !== 'arg-provider') {
    return []
  }

  const query = String(context?.tokenLower || '').trim()
  const argRule = plan.argRule

  if (argRule.provider !== 'literal' || !Array.isArray(argRule.items)) {
    return []
  }

  const prefixLabel = (plan.chainPath || []).join(' ')
  const items = argRule.items
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
        source: 'literal',
        label: prefixLabel ? `${prefixLabel} ${value}` : value,
        value: buildTokenReplacementValue(context, value, true),
        description: item?.description ? t(String(item.description)) : '',
        badge: getAutocompleteBadge('literal', argRule.badge),
        score: 360 + matchScore - index,
      }
    })
    .filter(Boolean)

  return dedupeAutocompleteItems(items)
}

export function buildAsyncProviderContext({ context, plan }) {
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

export async function loadAsyncProviderItems({ sessionId, asyncContext, listDir }) {
  if (!sessionId || !asyncContext || typeof listDir !== 'function') {
    return []
  }

  let entries = []
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
        source: 'path',
        label: prefixLabel ? `${prefixLabel} ${relativePath}` : relativePath,
        value: buildTokenReplacementValue(asyncContext, relativePath),
        description: `${absolutePath}${entry.isDirectory ? '/' : ''}`,
        badge: getAutocompleteBadge('path'),
        score: 500 + (needle && entry.name.toLowerCase().startsWith(needle) ? 40 : 20) - index,
      }
    })

  return dedupeAutocompleteItems(items)
}