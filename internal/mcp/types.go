package mcp

import (
	"encoding/json"
	"fmt"
	"strings"
)

type ServerSource string

const (
	ServerSourceEmbedded ServerSource = "embedded"
	ServerSourceGlobal   ServerSource = "global"
)

type ServerTransportType string

const (
	ServerTransportStdio          ServerTransportType = "stdio"
	ServerTransportSSE            ServerTransportType = "sse"
	ServerTransportStreamableHTTP ServerTransportType = "streamable-http"
)

type ServerConfig struct {
	Type               ServerTransportType `json:"type"`
	Command            string              `json:"command,omitempty"`
	Args               []string            `json:"args,omitempty"`
	Cwd                string              `json:"cwd,omitempty"`
	Env                map[string]string   `json:"env,omitempty"`
	URL                string              `json:"url,omitempty"`
	Headers            map[string]string   `json:"headers,omitempty"`
	Disabled           bool                `json:"disabled,omitempty"`
	DisabledForPrompts bool                `json:"disabledForPrompts,omitempty"`
	Timeout            int                 `json:"timeout,omitempty"`
	AlwaysAllow        []string            `json:"alwaysAllow,omitempty"`
	DisabledTools      []string            `json:"disabledTools,omitempty"`
}

type ServerErrorEntry struct {
	Message   string `json:"message"`
	Timestamp int64  `json:"timestamp"`
	Level     string `json:"level"`
}

type ServerTool struct {
	Name             string         `json:"name"`
	Description      string         `json:"description,omitempty"`
	InputSchema      map[string]any `json:"inputSchema,omitempty"`
	AlwaysAllow      bool           `json:"alwaysAllow,omitempty"`
	EnabledForPrompt bool           `json:"enabledForPrompt,omitempty"`
}

type ServerResource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	MimeType    string `json:"mimeType,omitempty"`
	Description string `json:"description,omitempty"`
}

type ServerResourceTemplate struct {
	URITemplate string `json:"uriTemplate"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

type ServerRuntime struct {
	Name              string                   `json:"name"`
	Config            string                   `json:"config"`
	Status            string                   `json:"status"`
	Error             string                   `json:"error,omitempty"`
	ErrorHistory      []ServerErrorEntry       `json:"errorHistory,omitempty"`
	Tools             []ServerTool             `json:"tools,omitempty"`
	Resources         []ServerResource         `json:"resources,omitempty"`
	ResourceTemplates []ServerResourceTemplate `json:"resourceTemplates,omitempty"`
	Disabled          bool                     `json:"disabled,omitempty"`
	DisabledForPrompts bool                    `json:"disabledForPrompts,omitempty"`
	Timeout           int                      `json:"timeout,omitempty"`
	Source            ServerSource             `json:"source,omitempty"`
	Instructions      string                   `json:"instructions,omitempty"`
}

func NormalizeServerConfig(config ServerConfig) (ServerConfig, error) {
	next := config
	next.Type = ServerTransportType(strings.TrimSpace(string(next.Type)))
	if next.Timeout < 0 {
		next.Timeout = 0
	}
	next.AlwaysAllow = normalizeUniqueStrings(next.AlwaysAllow)
	next.DisabledTools = normalizeUniqueStrings(next.DisabledTools)
	next.Args = normalizeTrimmedStrings(next.Args)
	next.Env = normalizeStringMap(next.Env)
	next.Headers = normalizeStringMap(next.Headers)
	switch next.Type {
	case "":
		if strings.TrimSpace(next.Command) != "" {
			next.Type = ServerTransportStdio
		} else if strings.TrimSpace(next.URL) != "" {
			return ServerConfig{}, fmt.Errorf("server config with url must declare type")
		}
	case ServerTransportStdio:
	case ServerTransportSSE:
	case ServerTransportStreamableHTTP:
	default:
		return ServerConfig{}, fmt.Errorf("unsupported server transport type: %s", next.Type)
	}
	hasCommand := strings.TrimSpace(next.Command) != ""
	hasURL := strings.TrimSpace(next.URL) != ""
	if hasCommand && hasURL {
		return ServerConfig{}, fmt.Errorf("server config cannot set both command and url")
	}
	switch next.Type {
	case ServerTransportStdio:
		if !hasCommand {
			return ServerConfig{}, fmt.Errorf("stdio server config requires command")
		}
		next.Command = strings.TrimSpace(next.Command)
		next.Cwd = strings.TrimSpace(next.Cwd)
		next.URL = ""
		next.Headers = nil
	case ServerTransportSSE, ServerTransportStreamableHTTP:
		if !hasURL {
			return ServerConfig{}, fmt.Errorf("%s server config requires url", next.Type)
		}
		next.URL = strings.TrimSpace(next.URL)
		next.Command = ""
		next.Args = nil
		next.Cwd = ""
		next.Env = nil
	default:
		return ServerConfig{}, fmt.Errorf("server config requires type")
	}
	return next, nil
}

func MarshalServerConfig(config ServerConfig) string {
	data, err := json.Marshal(config)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func ValidateServerConfigMap(raw map[string]any, serverName string) (ServerConfig, error) {
	if raw == nil {
		return ServerConfig{}, formatServerConfigError(serverName, "Server configuration must be an object.")
	}

	_, hasCommand := raw["command"]
	_, hasURL := raw["url"]

	typeValue := ""
	if rawType, exists := raw["type"]; exists {
		typeText, ok := rawType.(string)
		if !ok {
			return ServerConfig{}, formatServerConfigError(serverName, "Field 'type' must be a string.")
		}
		typeValue = strings.TrimSpace(typeText)
	}

	if hasCommand && hasURL {
		return ServerConfig{}, formatServerConfigError(serverName, "Configuration cannot contain both 'command' and 'url'.")
	}

	if typeValue == "" && hasCommand {
		raw["type"] = string(ServerTransportStdio)
		typeValue = string(ServerTransportStdio)
	}

	if hasURL && typeValue == "" {
		return ServerConfig{}, formatServerConfigError(serverName, "Configuration with 'url' must explicitly specify 'type' as 'sse' or 'streamable-http'.")
	}

	if typeValue != "" && typeValue != string(ServerTransportStdio) && typeValue != string(ServerTransportSSE) && typeValue != string(ServerTransportStreamableHTTP) {
		return ServerConfig{}, formatServerConfigError(serverName, "Unsupported transport type. Use 'stdio', 'sse', or 'streamable-http'.")
	}

	if typeValue == string(ServerTransportStdio) && !hasCommand {
		return ServerConfig{}, formatServerConfigError(serverName, "Stdio server configuration must include a 'command'.")
	}
	if typeValue == string(ServerTransportSSE) && !hasURL {
		return ServerConfig{}, formatServerConfigError(serverName, "SSE server configuration must include a 'url'.")
	}
	if typeValue == string(ServerTransportStreamableHTTP) && !hasURL {
		return ServerConfig{}, formatServerConfigError(serverName, "Streamable HTTP server configuration must include a 'url'.")
	}
	if !hasCommand && !hasURL {
		return ServerConfig{}, formatServerConfigError(serverName, "Server configuration must include either 'command' (for stdio) or 'url' (for sse/streamable-http).")
	}

	data, err := json.Marshal(raw)
	if err != nil {
		return ServerConfig{}, formatServerConfigError(serverName, err.Error())
	}

	config := ServerConfig{}
	if err := json.Unmarshal(data, &config); err != nil {
		return ServerConfig{}, formatServerConfigError(serverName, err.Error())
	}

	normalized, err := NormalizeServerConfig(config)
	if err != nil {
		return ServerConfig{}, formatServerConfigError(serverName, err.Error())
	}
	return normalized, nil
}

func formatServerConfigError(serverName string, message string) error {
	trimmedMessage := strings.TrimSpace(message)
	if trimmedMessage == "" {
		trimmedMessage = "Invalid server configuration."
	}
	trimmedName := strings.TrimSpace(serverName)
	if trimmedName == "" {
		return fmt.Errorf("%s", trimmedMessage)
	}
	return fmt.Errorf("Invalid configuration for server %q: %s", trimmedName, trimmedMessage)
}

func normalizeTrimmedStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeUniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		result[trimmedKey] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
}