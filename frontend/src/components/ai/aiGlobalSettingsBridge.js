import { normalizeAISlashCommands } from './aiSlashCommands.js'

const DEFAULT_AI_GLOBAL_SETTINGS = {
  currentProviderId: '',
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowReadOnlyOutsideWorkspace: false,
  alwaysAllowWrite: false,
  alwaysAllowWriteOutsideWorkspace: false,
  alwaysAllowWriteProtected: false,
  alwaysAllowExecute: false,
  alwaysAllowExecuteAllCommands: false,
  allowedCommands: [],
  deniedCommands: [],
  slashCommands: [],
  alwaysAllowMcp: false,
  alwaysAllowModeSwitch: false,
  alwaysAllowSubtasks: false,
  alwaysAllowFollowupQuestions: false,
  terminalIsolation: true,
  approvalButtonOrder: 'reject-approve',
  commandActionButtonOrder: 'terminate-continue',
}

const VALID_APPROVAL_BUTTON_ORDERS = new Set(['reject-approve', 'approve-reject'])
const VALID_COMMAND_ACTION_BUTTON_ORDERS = new Set(['terminate-continue', 'continue-terminate'])

function getAppBridge() {
  return window?.go?.main?.AIBindings || window?.go?.main?.App
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set()
  const normalized = []
  values.forEach((value) => {
    if (typeof value !== 'string') {
      return
    }
    const nextValue = value.trim()
    if (!nextValue || seen.has(nextValue)) {
      return
    }
    seen.add(nextValue)
    normalized.push(nextValue)
  })
  return normalized
}

function normalizeApprovalButtonOrder(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return VALID_APPROVAL_BUTTON_ORDERS.has(nextValue) ? nextValue : 'reject-approve'
}

function normalizeCommandActionButtonOrder(value) {
  const nextValue = typeof value === 'string' ? value.trim() : ''
  return VALID_COMMAND_ACTION_BUTTON_ORDERS.has(nextValue) ? nextValue : 'terminate-continue'
}

export function normalizeAIGlobalSettings(settings) {
  const alwaysAllowReadOnly = Boolean(settings?.alwaysAllowReadOnly)
  const alwaysAllowWrite = Boolean(settings?.alwaysAllowWrite)
  const alwaysAllowExecute = Boolean(settings?.alwaysAllowExecute)
  const allowedCommands = normalizeStringList(settings?.allowedCommands)
  const deniedCommands = normalizeStringList(settings?.deniedCommands)
  const slashCommands = normalizeAISlashCommands(settings?.slashCommands)

  return {
    ...DEFAULT_AI_GLOBAL_SETTINGS,
    ...settings,
    currentProviderId: typeof settings?.currentProviderId === 'string' ? settings.currentProviderId.trim() : '',
    autoApprovalEnabled: alwaysAllowReadOnly || alwaysAllowWrite || alwaysAllowExecute,
    alwaysAllowReadOnly,
    alwaysAllowReadOnlyOutsideWorkspace: Boolean(settings?.alwaysAllowReadOnlyOutsideWorkspace),
    alwaysAllowWrite,
    alwaysAllowWriteOutsideWorkspace: Boolean(settings?.alwaysAllowWriteOutsideWorkspace),
    alwaysAllowWriteProtected: Boolean(settings?.alwaysAllowWriteProtected),
    alwaysAllowExecute,
    alwaysAllowExecuteAllCommands: allowedCommands.includes('*'),
    allowedCommands,
    deniedCommands,
    slashCommands,
    alwaysAllowMcp: Boolean(settings?.alwaysAllowMcp),
    alwaysAllowModeSwitch: Boolean(settings?.alwaysAllowModeSwitch),
    alwaysAllowSubtasks: Boolean(settings?.alwaysAllowSubtasks),
    alwaysAllowFollowupQuestions: Boolean(settings?.alwaysAllowFollowupQuestions),
    terminalIsolation: settings?.terminalIsolation !== false,
    approvalButtonOrder: normalizeApprovalButtonOrder(settings?.approvalButtonOrder),
    commandActionButtonOrder: normalizeCommandActionButtonOrder(settings?.commandActionButtonOrder),
  }
}

export async function getAIGlobalSettings() {
  const bridge = getAppBridge()
  if (!bridge?.GetAIGlobalSettings) {
    return DEFAULT_AI_GLOBAL_SETTINGS
  }
  try {
    const settings = await bridge.GetAIGlobalSettings()
    return normalizeAIGlobalSettings(settings)
  } catch {
    return DEFAULT_AI_GLOBAL_SETTINGS
  }
}

export async function saveAIGlobalSettings(settings) {
  const normalizedSettings = normalizeAIGlobalSettings(settings)
  const bridge = getAppBridge()
  if (!bridge?.SaveAIGlobalSettings) {
    return normalizedSettings
  }
  await bridge.SaveAIGlobalSettings(JSON.stringify(normalizedSettings))
  return normalizedSettings
}