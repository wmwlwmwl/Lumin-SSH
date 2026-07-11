import { parseCommandInputContext } from './terminalCommandAutocompleteParser.js'
import { getBuiltinCommandNames, resolveAutocompletePlan } from './terminalCommandAutocompleteRegistry.js'
import {
  buildAsyncProviderContext,
  buildChildCommandItems,
  buildSyncProviderItems,
  buildTopLevelCommandItems,
  loadAsyncProviderItems,
} from './terminalCommandAutocompleteProviders.js'

export { normalizeRemoteAbsolutePath } from './terminalCommandAutocompleteParser.js'

function flattenQuickCommandItems(items, groups = [], acc = []) {
  if (!Array.isArray(items)) {
    return acc
  }

  items.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }

    if (item.type === 'group') {
      const nextGroups = String(item.name || '').trim()
        ? [...groups, String(item.name || '').trim()]
        : groups
      flattenQuickCommandItems(item.children, nextGroups, acc)
      return
    }

    const command = String(item.command || '').trim()
    if (!command) {
      return
    }

    acc.push({
      name: String(item.name || '').trim() || command,
      command,
      groupPath: groups.join(' / '),
    })
  })

  return acc
}

export function createCommandAutocompleteState(patch = {}) {
  return {
    open: false,
    loading: false,
    items: [],
    selectedIndex: -1,
    ...patch,
  }
}

export function normalizeHistoryCommands(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item) => (typeof item?.command === 'string' ? item.command.trim() : ''))
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

export function normalizeQuickCommandItems(raw) {
  try {
    const parsed = JSON.parse(raw)
    return flattenQuickCommandItems(parsed)
  } catch (_) {
    return []
  }
}

export function buildStaticAutocompleteItems(inputValue, sources, { cursorPosition, currentCwd } = {}) {
  const context = parseCommandInputContext(inputValue, {
    cursorPosition,
    currentCwd,
  })
  const plan = resolveAutocompletePlan(context)

  switch (plan.kind) {
    case 'root-command':
      return buildTopLevelCommandItems({
        context,
        sources,
        builtinCommandNames: getBuiltinCommandNames(),
      })
    case 'child-command':
      return buildChildCommandItems({
        context,
        plan,
      })
    case 'arg-provider':
      return buildSyncProviderItems({
        context,
        plan,
      })
    default:
      return []
  }
}

export function buildPathAutocompleteContext(inputValue, currentCwd, { cursorPosition } = {}) {
  const context = parseCommandInputContext(inputValue, {
    cursorPosition,
    currentCwd,
  })
  const plan = resolveAutocompletePlan(context)

  return buildAsyncProviderContext({
    context,
    plan,
  })
}

export async function loadPathAutocompleteItems({
  sessionId,
  inputValue,
  currentCwd,
  cursorPosition,
  listDir,
}) {
  const asyncContext = buildPathAutocompleteContext(inputValue, currentCwd, {
    cursorPosition,
  })

  return loadAsyncProviderItems({
    sessionId,
    asyncContext,
    listDir,
  })
}