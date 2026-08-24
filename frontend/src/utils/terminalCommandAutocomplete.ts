import { parseCommandInputContext } from './terminalCommandAutocompleteParser.ts'
import { getBuiltinCommandNames, resolveAutocompletePlan } from './terminalCommandAutocompleteRegistry.ts'
import {
  buildAsyncProviderContext,
  buildChildCommandItems,
  buildSlashQuickCommandItems,
  buildSyncProviderItems,
  buildTopLevelCommandItems,
  loadAsyncProviderItems,
  type AsyncPathContext,
  type AutocompleteItem,
  type AutocompleteSources,
} from './terminalCommandAutocompleteProviders.ts'

export { normalizeRemoteAbsolutePath } from './terminalCommandAutocompleteParser.ts'
export type { AutocompleteItem, AsyncPathContext, AutocompleteSources } from './terminalCommandAutocompleteProviders.ts'

/** 扁平化后的快捷命令项 */
export interface FlattenedQuickCommand {
  name: string;
  command: string;
  groupPath: string;
  addCR: boolean;
}

function flattenQuickCommandItems(items: unknown, groups: string[] = [], acc: FlattenedQuickCommand[] = []): FlattenedQuickCommand[] {
  if (!Array.isArray(items)) {
    return acc
  }

  items.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }
    const rawItem = item as { type?: unknown; name?: unknown; children?: unknown; command?: unknown; addCR?: unknown }

    if (rawItem.type === 'group') {
      const nextGroups = String(rawItem.name || '').trim()
        ? [...groups, String(rawItem.name || '').trim()]
        : groups
      flattenQuickCommandItems(rawItem.children, nextGroups, acc)
      return
    }

    const command = String(rawItem.command || '').trim()
    if (!command) {
      return
    }

    acc.push({
      name: String(rawItem.name || '').trim() || command,
      command,
      groupPath: groups.join(' / '),
      // 快捷命令条发送时需要，缺省视为需要回车
      addCR: rawItem.addCR !== false,
    })
  })

  return acc
}

function isSlashQuickCommandContext(context: { currentTokenIndex: number; hasTrailingSpace: boolean; command: string }): boolean {
  return Boolean(
    context
    && context.currentTokenIndex === 0
    && !context.hasTrailingSpace
    && String(context.command || '').startsWith('/')
  )
}

/** 自动补全 UI 状态 */
export interface CommandAutocompleteState {
  open: boolean;
  loading: boolean;
  items: AutocompleteItem[];
  selectedIndex: number;
}

export function createCommandAutocompleteState(patch: Partial<CommandAutocompleteState> = {}): CommandAutocompleteState {
  return {
    open: false,
    loading: false,
    items: [],
    selectedIndex: -1,
    ...patch,
  }
}

export function normalizeHistoryCommands(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item) => (typeof (item as { command?: unknown } | null)?.command === 'string' ? (item as { command: string }).command.trim() : ''))
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

export function normalizeQuickCommandItems(raw: string): FlattenedQuickCommand[] {
  try {
    const parsed = JSON.parse(raw)
    return flattenQuickCommandItems(parsed)
  } catch (_) {
    return []
  }
}

export function buildStaticAutocompleteItems(
  inputValue: string,
  sources: AutocompleteSources,
  options: { cursorPosition?: number; currentCwd?: string } = {},
): AutocompleteItem[] {
  const context = parseCommandInputContext(inputValue, {
    cursorPosition: options.cursorPosition,
    currentCwd: options.currentCwd,
  })

  if (isSlashQuickCommandContext(context)) {
    return buildSlashQuickCommandItems({
      context,
      sources,
    })
  }

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

export function buildPathAutocompleteContext(
  inputValue: string,
  currentCwd: string,
  options: { cursorPosition?: number } = {},
): AsyncPathContext | null {
  const context = parseCommandInputContext(inputValue, {
    cursorPosition: options.cursorPosition,
    currentCwd,
  })

  if (isSlashQuickCommandContext(context)) {
    return null
  }

  const plan = resolveAutocompletePlan(context)

  return buildAsyncProviderContext({
    context,
    plan,
  })
}

export async function loadPathAutocompleteItems(options: {
  sessionId: string;
  inputValue: string;
  currentCwd: string;
  cursorPosition?: number;
  listDir: (sessionId: string, path: string) => Promise<unknown>;
}): Promise<AutocompleteItem[]> {
  const { sessionId, inputValue, currentCwd, cursorPosition, listDir } = options
  const asyncContext = buildPathAutocompleteContext(inputValue, currentCwd, {
    cursorPosition,
  })

  return loadAsyncProviderItems({
    sessionId,
    asyncContext,
    listDir,
  })
}
