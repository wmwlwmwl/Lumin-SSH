// 桥接模块（自 .js 收编后类型化）：MCP 客户端服务器状态与操作转发
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js'

/** MCP 服务器工具（normalizeServerTool 输出） */
interface MCPServerTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  alwaysAllow: boolean
  enabledForPrompt: boolean
}

/** MCP 服务器运行时状态（normalizeServerRuntime 输出） */
export interface MCPServerRuntime {
  name: string
  config: string
  status: string
  error: string
  errorHistory: unknown[]
  tools: MCPServerTool[]
  resources: unknown[]
  resourceTemplates: unknown[]
  disabled: boolean
  disabledForPrompts: boolean
  timeout: number
  source: string
  instructions: string
}

/** MCP 服务信息（normalizeServiceInfo 输出） */
export interface MCPServiceInfo {
  url: string
  transport: string
  endpoint: string
  instructions: string
  logs: string
  tools: unknown[]
}

/** MCP 客户端状态（getMCPSettingsState 输出） */
export interface MCPClientState {
  servers: MCPServerRuntime[]
  globalConfigPath: string
  globalConfigText: string
  embeddedServers: unknown[]
  globalServerOrder: unknown[]
}

function normalizeServerTool(tool: unknown): MCPServerTool {
  const t = (tool ?? {}) as Record<string, unknown>
  return {
    name: typeof t.name === 'string' ? t.name.trim() : '',
    description: typeof t.description === 'string' ? t.description : '',
    inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema as Record<string, unknown> : {},
    alwaysAllow: Boolean(t.alwaysAllow),
    enabledForPrompt: t.enabledForPrompt !== false,
  }
}

function normalizeServerRuntime(server: unknown): MCPServerRuntime {
  const s = (server ?? {}) as Record<string, unknown>
  return {
    name: typeof s.name === 'string' ? s.name.trim() : '',
    config: typeof s.config === 'string' ? s.config : '{}',
    status: typeof s.status === 'string' ? s.status.trim() : 'disconnected',
    error: typeof s.error === 'string' ? s.error : '',
    errorHistory: Array.isArray(s.errorHistory) ? s.errorHistory : [],
    tools: Array.isArray(s.tools) ? s.tools.map(normalizeServerTool).filter((tool) => tool.name) : [],
    resources: Array.isArray(s.resources) ? s.resources : [],
    resourceTemplates: Array.isArray(s.resourceTemplates) ? s.resourceTemplates : [],
    disabled: Boolean(s.disabled),
    disabledForPrompts: Boolean(s.disabledForPrompts),
    timeout: Number.isFinite(Number(s.timeout)) ? Number(s.timeout) : 0,
    source: typeof s.source === 'string' ? s.source.trim() : 'global',
    instructions: typeof s.instructions === 'string' ? s.instructions : '',
  }
}

function normalizeServiceInfo(service: unknown): MCPServiceInfo {
  const s = (service ?? {}) as Record<string, unknown>
  return {
    url: typeof s.url === 'string' ? s.url : '',
    transport: typeof s.transport === 'string' ? s.transport : 'streamable-http',
    endpoint: typeof s.endpoint === 'string' ? s.endpoint : '/mcp',
    instructions: typeof s.instructions === 'string' ? s.instructions : '',
    logs: typeof s.logs === 'string' ? s.logs : '',
    tools: Array.isArray(s.tools) ? s.tools : [],
  }
}

export async function getMCPSettingsState(): Promise<{ service: MCPServiceInfo; client: MCPClientState }> {
  const state = await AppGo.GetMCPSettingsState()
  const stateRecord = state as unknown as Record<string, unknown>
  const clientRecord = (stateRecord.client ?? {}) as Record<string, unknown>
  const service = normalizeServiceInfo(stateRecord.service)
  const client: MCPClientState = {
    servers: Array.isArray(clientRecord.servers) ? clientRecord.servers.map(normalizeServerRuntime).filter((server) => server.name) : [],
    globalConfigPath: typeof clientRecord.globalConfigPath === 'string' ? clientRecord.globalConfigPath : '',
    globalConfigText: typeof clientRecord.globalConfigText === 'string' ? clientRecord.globalConfigText : '{\n  "mcpServers": {}\n}',
    embeddedServers: Array.isArray(clientRecord.embeddedServers) ? clientRecord.embeddedServers : [],
    globalServerOrder: Array.isArray(clientRecord.globalServerOrder) ? clientRecord.globalServerOrder : [],
  }
  return { service, client }
}

export async function saveMCPGlobalServer(name: string, configText: string): Promise<void> {
  await AppGo.SaveMCPGlobalServer(name, configText)
}

export async function reloadMCPGlobalServers(): Promise<void> {
  await AppGo.ReloadMCPGlobalServers()
}

export async function deleteMCPGlobalServer(name: string): Promise<void> {
  await AppGo.DeleteMCPGlobalServer(name)
}

export async function restartMCPClientServer(name: string, source: string): Promise<void> {
  await AppGo.RestartMCPClientServer(name, source)
}

export async function toggleMCPClientServer(name: string, source: string, disabled: boolean): Promise<MCPServerRuntime> {
  const runtime = await AppGo.ToggleMCPClientServer(name, source, disabled)
  return normalizeServerRuntime(runtime)
}

export async function toggleMCPClientServerDisabledForPrompts(name: string, source: string, disabledForPrompts: boolean): Promise<MCPServerRuntime> {
  const runtime = await AppGo.ToggleMCPClientServerDisabledForPrompts(name, source, disabledForPrompts)
  return normalizeServerRuntime(runtime)
}

export async function toggleMCPClientServerToolDisabledForPrompts(name: string, source: string, toolName: string, disabledForPrompts: boolean): Promise<MCPServerRuntime> {
  const runtime = await AppGo.ToggleMCPClientServerToolDisabledForPrompts(name, source, toolName, disabledForPrompts)
  return normalizeServerRuntime(runtime)
}

export async function updateMCPClientServerTimeout(name: string, source: string, timeout: number): Promise<MCPServerRuntime> {
  const runtime = await AppGo.UpdateMCPClientServerTimeout(name, source, timeout)
  return normalizeServerRuntime(runtime)
}
