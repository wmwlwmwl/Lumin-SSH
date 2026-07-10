import * as AppGo from '../../../wailsjs/go/main/App.js'

function normalizeServerTool(tool) {
  return {
    name: typeof tool?.name === 'string' ? tool.name.trim() : '',
    description: typeof tool?.description === 'string' ? tool.description : '',
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {},
    alwaysAllow: Boolean(tool?.alwaysAllow),
    enabledForPrompt: tool?.enabledForPrompt !== false,
  }
}

function normalizeServerRuntime(server) {
  return {
    name: typeof server?.name === 'string' ? server.name.trim() : '',
    config: typeof server?.config === 'string' ? server.config : '{}',
    status: typeof server?.status === 'string' ? server.status.trim() : 'disconnected',
    error: typeof server?.error === 'string' ? server.error : '',
    errorHistory: Array.isArray(server?.errorHistory) ? server.errorHistory : [],
    tools: Array.isArray(server?.tools) ? server.tools.map(normalizeServerTool).filter((tool) => tool.name) : [],
    resources: Array.isArray(server?.resources) ? server.resources : [],
    resourceTemplates: Array.isArray(server?.resourceTemplates) ? server.resourceTemplates : [],
    disabled: Boolean(server?.disabled),
    disabledForPrompts: Boolean(server?.disabledForPrompts),
    timeout: Number.isFinite(Number(server?.timeout)) ? Number(server.timeout) : 0,
    source: typeof server?.source === 'string' ? server.source.trim() : 'global',
    instructions: typeof server?.instructions === 'string' ? server.instructions : '',
  }
}

function normalizeServiceInfo(service) {
  return {
    url: typeof service?.url === 'string' ? service.url : '',
    transport: typeof service?.transport === 'string' ? service.transport : 'streamable-http',
    endpoint: typeof service?.endpoint === 'string' ? service.endpoint : '/mcp',
    instructions: typeof service?.instructions === 'string' ? service.instructions : '',
    logs: typeof service?.logs === 'string' ? service.logs : '',
    tools: Array.isArray(service?.tools) ? service.tools : [],
  }
}

export async function getMCPSettingsState() {
  const state = await AppGo.GetMCPSettingsState()
  const service = normalizeServiceInfo(state?.service)
  const client = {
    servers: Array.isArray(state?.client?.servers) ? state.client.servers.map(normalizeServerRuntime).filter((server) => server.name) : [],
    globalConfigPath: typeof state?.client?.globalConfigPath === 'string' ? state.client.globalConfigPath : '',
    globalConfigText: typeof state?.client?.globalConfigText === 'string' ? state.client.globalConfigText : '{\n  "mcpServers": {}\n}',
    embeddedServers: Array.isArray(state?.client?.embeddedServers) ? state.client.embeddedServers : [],
    globalServerOrder: Array.isArray(state?.client?.globalServerOrder) ? state.client.globalServerOrder : [],
  }
  return { service, client }
}

export async function saveMCPGlobalServer(name, configText) {
  await AppGo.SaveMCPGlobalServer(name, configText)
}

export async function reloadMCPGlobalServers() {
  await AppGo.ReloadMCPGlobalServers()
}

export async function deleteMCPGlobalServer(name) {
  await AppGo.DeleteMCPGlobalServer(name)
}

export async function restartMCPClientServer(name, source) {
  await AppGo.RestartMCPClientServer(name, source)
}

export async function toggleMCPClientServer(name, source, disabled) {
  await AppGo.ToggleMCPClientServer(name, source, disabled)
}

export async function toggleMCPClientServerDisabledForPrompts(name, source, disabledForPrompts) {
  await AppGo.ToggleMCPClientServerDisabledForPrompts(name, source, disabledForPrompts)
}

export async function updateMCPClientServerTimeout(name, source, timeout) {
  await AppGo.UpdateMCPClientServerTimeout(name, source, timeout)
}