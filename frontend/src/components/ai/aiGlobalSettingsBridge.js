import { normalizeAISlashCommands } from './aiSlashCommands.js'
import { getProxyNodes } from '../settings/proxyNodesBridge.js'

const DEFAULT_AI_GLOBAL_SETTINGS = {
  currentProviderId: '',
  autoApprovalEnabled: false,
  alwaysAllowReadOnly: false,
  alwaysAllowReadOnlyOutsideWorkspace: false,
  alwaysAllowWrite: false,
  alwaysAllowWriteOutsideWorkspace: false,
  alwaysAllowWriteProtected: false,
  alwaysAllowExecute: false,
  alwaysAllowExecuteReadOnly: false,
  alwaysAllowExecuteAllCommands: false,
  allowedCommands: [],
  deniedCommands: [],
  slashCommands: [],
  alwaysAllowMcp: false,
  alwaysAllowModeSwitch: false,
  alwaysAllowSubtasks: false,
  alwaysAllowFollowupQuestions: false,
  soundEnabled: true,
  soundVolume: 0.06,
  mcpEnabled: true,
  mcpAllowBrowserCalls: false,
  terminalIsolation: true,
  confirmDelete: true,
  continueAfterToolRejection: true,
  conversationAutoBackupEnabled: true,
  messageActionBarAtBottom: true,
  approvalButtonOrder: 'reject-approve',
  commandActionButtonOrder: 'terminate-continue',
  aiRequestProxyId: '',
  updatedAt: 0,
  proxyNodes: [],
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

function normalizeSoundVolume(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0.06
  }
  if (parsed < 0) {
    return 0
  }
  if (parsed > 1) {
    return 1
  }
  return parsed
}

function normalizeProxyType(value) {
  return String(value || '').trim().toLowerCase() === 'http' ? 'http' : 'socks5'
}

function normalizeProxyNode(node, index = 0) {
  const host = typeof node?.host === 'string' ? node.host.trim() : ''
  if (!host) {
    return null
  }
  const parsedPort = parseInt(String(node?.port ?? '').trim(), 10)
  const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 1080
  const type = normalizeProxyType(node?.type)
  const generatedId = `proxy-${type}-${host.toLowerCase()}-${port}-${index + 1}`
  const id = typeof node?.id === 'string' && node.id.trim() ? node.id.trim() : generatedId
  return {
    id,
    name: typeof node?.name === 'string' ? node.name.trim() : '',
    type,
    host,
    port,
    username: typeof node?.username === 'string' ? node.username.trim() : '',
    password: typeof node?.password === 'string' ? node.password : '',
    updatedAt: Number.isFinite(Number(node?.updatedAt)) && Number(node?.updatedAt) > 0 ? Number(node.updatedAt) : Date.now(),
  }
}

function normalizeProxyNodes(values) {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set()
  const normalized = []
  values.forEach((value, index) => {
    const nextNode = normalizeProxyNode(value, index)
    if (!nextNode || seen.has(nextNode.id)) {
      return
    }
    seen.add(nextNode.id)
    normalized.push(nextNode)
  })
  return normalized
}

export function normalizeAIGlobalSettings(settings) {
  const alwaysAllowReadOnly = Boolean(settings?.alwaysAllowReadOnly)
  const alwaysAllowWrite = Boolean(settings?.alwaysAllowWrite)
  const alwaysAllowExecute = Boolean(settings?.alwaysAllowExecute)
  const alwaysAllowExecuteReadOnly = Boolean(settings?.alwaysAllowExecuteReadOnly)
  const allowedCommands = normalizeStringList(settings?.allowedCommands)
  const deniedCommands = normalizeStringList(settings?.deniedCommands)
  const slashCommands = normalizeAISlashCommands(settings?.slashCommands)
  const proxyNodes = normalizeProxyNodes(settings?.proxyNodes)
  const rawAIRequestProxyId = typeof settings?.aiRequestProxyId === 'string' ? settings.aiRequestProxyId.trim() : ''
  const aiRequestProxyId = proxyNodes.some((node) => node.id === rawAIRequestProxyId) ? rawAIRequestProxyId : ''
  const updatedAt = Number.isFinite(Number(settings?.updatedAt)) && Number(settings?.updatedAt) > 0 ? Number(settings.updatedAt) : Date.now()
  const soundEnabled = settings?.soundEnabled !== false
  const soundVolume = normalizeSoundVolume(settings?.soundVolume)

  return {
    ...DEFAULT_AI_GLOBAL_SETTINGS,
    ...settings,
    currentProviderId: typeof settings?.currentProviderId === 'string' ? settings.currentProviderId.trim() : '',
    autoApprovalEnabled: alwaysAllowReadOnly || alwaysAllowWrite || alwaysAllowExecute || alwaysAllowExecuteReadOnly,
    alwaysAllowReadOnly,
    alwaysAllowReadOnlyOutsideWorkspace: Boolean(settings?.alwaysAllowReadOnlyOutsideWorkspace),
    alwaysAllowWrite,
    alwaysAllowWriteOutsideWorkspace: Boolean(settings?.alwaysAllowWriteOutsideWorkspace),
    alwaysAllowWriteProtected: Boolean(settings?.alwaysAllowWriteProtected),
    alwaysAllowExecute,
    alwaysAllowExecuteReadOnly,
    alwaysAllowExecuteAllCommands: allowedCommands.includes('*'),
    allowedCommands,
    deniedCommands,
    slashCommands,
    alwaysAllowMcp: Boolean(settings?.alwaysAllowMcp),
    alwaysAllowModeSwitch: Boolean(settings?.alwaysAllowModeSwitch),
    alwaysAllowSubtasks: Boolean(settings?.alwaysAllowSubtasks),
    alwaysAllowFollowupQuestions: Boolean(settings?.alwaysAllowFollowupQuestions),
    soundEnabled,
    soundVolume,
    mcpEnabled: settings?.mcpEnabled !== false,
    mcpAllowBrowserCalls: Boolean(settings?.mcpAllowBrowserCalls),
    terminalIsolation: settings?.terminalIsolation !== false,
    confirmDelete: settings?.confirmDelete !== false,
    continueAfterToolRejection: settings?.continueAfterToolRejection !== false,
    conversationAutoBackupEnabled: settings?.conversationAutoBackupEnabled !== false,
    messageActionBarAtBottom: Boolean(settings?.messageActionBarAtBottom),
    approvalButtonOrder: normalizeApprovalButtonOrder(settings?.approvalButtonOrder),
    commandActionButtonOrder: normalizeCommandActionButtonOrder(settings?.commandActionButtonOrder),
    aiRequestProxyId,
    updatedAt,
    proxyNodes,
  }
}

export async function getAIGlobalSettings() {
  const bridge = getAppBridge()
  if (!bridge?.GetAIGlobalSettings) {
    return DEFAULT_AI_GLOBAL_SETTINGS
  }
  try {
    const [settings, proxyNodes] = await Promise.all([bridge.GetAIGlobalSettings(), getProxyNodes()])
    return normalizeAIGlobalSettings({ ...settings, proxyNodes })
  } catch {
    return DEFAULT_AI_GLOBAL_SETTINGS
  }
}

export async function saveAIGlobalSettings(settings) {
  const normalizedSettings = {
    ...normalizeAIGlobalSettings(settings),
    updatedAt: Date.now(),
  }
  const settingsToSave = { ...normalizedSettings }
  delete settingsToSave.proxyNodes
  const bridge = getAppBridge()
  if (!bridge?.SaveAIGlobalSettings) {
    return normalizedSettings
  }
  await bridge.SaveAIGlobalSettings(JSON.stringify(settingsToSave))
  return normalizedSettings
}