package mcp

import "encoding/json"

type rpcRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type clientInitializeResult struct {
	ProtocolVersion string `json:"protocolVersion"`
	Capabilities    struct {
		Tools struct {
			ListChanged bool `json:"listChanged,omitempty"`
		} `json:"tools,omitempty"`
		Resources struct {
			ListChanged bool `json:"listChanged,omitempty"`
		} `json:"resources,omitempty"`
		Prompts struct {
			ListChanged bool `json:"listChanged,omitempty"`
		} `json:"prompts,omitempty"`
	} `json:"capabilities,omitempty"`
	ServerInfo struct {
		Name        string `json:"name"`
		Title       string `json:"title,omitempty"`
		Version     string `json:"version"`
		Description string `json:"description,omitempty"`
	} `json:"serverInfo,omitempty"`
	Instructions string `json:"instructions,omitempty"`
}

type clientListToolsResult struct {
	Tools []struct {
		Name        string         `json:"name"`
		Description string         `json:"description,omitempty"`
		InputSchema map[string]any `json:"inputSchema,omitempty"`
	} `json:"tools"`
}

type clientListResourcesResult struct {
	Resources []struct {
		URI         string `json:"uri"`
		Name        string `json:"name"`
		MimeType    string `json:"mimeType,omitempty"`
		Description string `json:"description,omitempty"`
	} `json:"resources"`
}

type clientListResourceTemplatesResult struct {
	ResourceTemplates []struct {
		URITemplate string `json:"uriTemplate"`
		Name        string `json:"name"`
		Description string `json:"description,omitempty"`
		MimeType    string `json:"mimeType,omitempty"`
	} `json:"resourceTemplates"`
}

type clientToolCallResult struct {
	Content []struct {
		Type     string         `json:"type"`
		Text     string         `json:"text,omitempty"`
		Data     string         `json:"data,omitempty"`
		MimeType string         `json:"mimeType,omitempty"`
		Resource map[string]any `json:"resource,omitempty"`
		URI      string         `json:"uri,omitempty"`
		Name     string         `json:"name,omitempty"`
	} `json:"content"`
	StructuredContent map[string]any `json:"structuredContent,omitempty"`
	IsError           bool           `json:"isError,omitempty"`
}

type clientReadResourceResult struct {
	Contents []map[string]any `json:"contents"`
}

type clientPromptListResult struct {
	Prompts []map[string]any `json:"prompts"`
}