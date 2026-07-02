package mcpserver

import "encoding/json"

const ProtocolVersion = "2025-11-25"

const (
	MethodInitialize = "initialize"
	MethodInitializedNotification = "notifications/initialized"
	MethodPing = "ping"
	MethodToolsList = "tools/list"
	MethodToolsCall = "tools/call"
	MethodResourcesList = "resources/list"
	MethodResourcesTemplatesList = "resources/templates/list"
	MethodPromptsList = "prompts/list"
)

type JSONRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID any `json:"id,omitempty"`
	Method string `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

type JSONRPCError struct {
	Code int `json:"code"`
	Message string `json:"message"`
	Data any `json:"data,omitempty"`
}

type JSONRPCErrorResponse struct {
	JSONRPC string `json:"jsonrpc"`
	ID any `json:"id,omitempty"`
	Error JSONRPCError `json:"error"`
}

type JSONRPCResultResponse struct {
	JSONRPC string `json:"jsonrpc"`
	ID any `json:"id"`
	Result any `json:"result"`
}

type InitializeRequestParams struct {
	ProtocolVersion string `json:"protocolVersion"`
	Capabilities map[string]any `json:"capabilities"`
	ClientInfo map[string]any `json:"clientInfo"`
}

type InitializeResult struct {
	ProtocolVersion string `json:"protocolVersion"`
	Capabilities ServerCapabilities `json:"capabilities"`
	ServerInfo Implementation `json:"serverInfo"`
	Instructions string `json:"instructions,omitempty"`
}

type Implementation struct {
	Name string `json:"name"`
	Title string `json:"title,omitempty"`
	Version string `json:"version"`
	Description string `json:"description,omitempty"`
}

type ServerCapabilities struct {
	Tools ServerToolsCapability `json:"tools,omitempty"`
	Resources ServerResourcesCapability `json:"resources,omitempty"`
	Prompts ServerPromptsCapability `json:"prompts,omitempty"`
}

type ServerToolsCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

type ServerResourcesCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

type ServerPromptsCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

type ToolsListResult struct {
	Tools []ToolDefinition `json:"tools"`
}

type ResourcesListResult struct {
	Resources []any `json:"resources"`
}

type ResourceTemplatesListResult struct {
	ResourceTemplates []any `json:"resourceTemplates"`
}

type PromptsListResult struct {
	Prompts []any `json:"prompts"`
}

type ToolCallRequestParams struct {
	Name string `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

type TextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type ToolCallResult struct {
	Content []TextContent `json:"content"`
	StructuredContent map[string]any `json:"structuredContent,omitempty"`
	IsError bool `json:"isError,omitempty"`
}