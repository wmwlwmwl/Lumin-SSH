package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

type PromptServerTool struct {
	ServerName        string
	ServerSource      ServerSource
	ToolName          string
	Description       string
	InputSchema       map[string]any
	AlwaysAllow       bool
	EnabledForPrompt  bool
}

type CallToolResult struct {
	ServerName string
	ToolName   string
	Args       string
	Response   string
	IsError    bool
}

type ReadResourceResult struct {
	ServerName string
	URI        string
	Response   string
}

type serverConnection struct {
	key       string
	name      string
	source    ServerSource
	config    ServerConfig
	runtime   ServerRuntime
	transport rpcTransport
}

type ClientHub struct {
	configDir    string
	globalStore  *ConfigStore
	mu           sync.RWMutex
	connections  map[string]*serverConnection
	embedded     StoredServerSettings
	global       StoredServerSettings
}

var defaultHub struct {
	mu  sync.Mutex
	hub *ClientHub
}

func InitializeClientHub(configDir string) *ClientHub {
	defaultHub.mu.Lock()
	defer defaultHub.mu.Unlock()
	if defaultHub.hub == nil {
		defaultHub.hub = newClientHub(configDir)
	} else if strings.TrimSpace(configDir) != "" && defaultHub.hub.configDir != configDir {
		defaultHub.hub = newClientHub(configDir)
	}
	return defaultHub.hub
}

func ClientHubInstance() *ClientHub {
	defaultHub.mu.Lock()
	defer defaultHub.mu.Unlock()
	return defaultHub.hub
}

func newClientHub(configDir string) *ClientHub {
	hub := &ClientHub{
		configDir:   configDir,
		globalStore: NewConfigStore(configDir),
		connections: map[string]*serverConnection{},
	}
	_ = hub.Reload()
	return hub
}

func serverConnectionKey(source ServerSource, name string) string {
	return string(source) + "::" + strings.TrimSpace(name)
}

func (h *ClientHub) Reload() error {
	if h == nil {
		return nil
	}
	embedded := LoadEmbeddedServerSettings()
	global, err := h.globalStore.Load()
	if err != nil {
		return err
	}
	h.embedded = embedded
	h.global = global
	desired := map[string]struct{}{}
	for name, config := range embedded.McpServers {
		key := serverConnectionKey(ServerSourceEmbedded, name)
		desired[key] = struct{}{}
		h.ensureConnection(name, config, ServerSourceEmbedded, false)
	}
	for name, config := range global.McpServers {
		key := serverConnectionKey(ServerSourceGlobal, name)
		desired[key] = struct{}{}
		h.ensureConnection(name, config, ServerSourceGlobal, false)
	}
	h.mu.Lock()
	for key, connection := range h.connections {
		if _, exists := desired[key]; exists {
			continue
		}
		_ = connection.transport.Close()
		delete(h.connections, key)
	}
	h.mu.Unlock()
	return nil
}

func (h *ClientHub) ReloadGlobalOnly() error {
	if h == nil {
		return nil
	}
	if len(h.embedded.McpServers) == 0 {
		h.embedded = LoadEmbeddedServerSettings()
	}
	global, err := h.globalStore.Load()
	if err != nil {
		return err
	}
	h.global = global
	desiredGlobal := map[string]struct{}{}
	for name, config := range global.McpServers {
		key := serverConnectionKey(ServerSourceGlobal, name)
		desiredGlobal[key] = struct{}{}
		h.ensureConnection(name, config, ServerSourceGlobal, true)
	}
	h.mu.Lock()
	for key, connection := range h.connections {
		if connection == nil || connection.source != ServerSourceGlobal {
			continue
		}
		if _, exists := desiredGlobal[key]; exists {
			continue
		}
		if connection.transport != nil {
			_ = connection.transport.Close()
		}
		delete(h.connections, key)
	}
	h.mu.Unlock()
	return nil
}

func (h *ClientHub) ensureConnection(name string, config ServerConfig, source ServerSource, forceReconnect bool) {
	key := serverConnectionKey(source, name)
	h.mu.RLock()
	existing := h.connections[key]
	h.mu.RUnlock()
	sameConfig := existing != nil && MarshalServerConfig(existing.config) == MarshalServerConfig(config)
	if sameConfig && !forceReconnect {
		existing.runtime.Disabled = config.Disabled
		existing.runtime.DisabledForPrompts = config.DisabledForPrompts
		existing.runtime.Timeout = config.Timeout
		existing.config = config
		if config.Disabled || existing.runtime.Status == "connected" {
			return
		}
	}
	if existing != nil {
		_ = existing.transport.Close()
	}
	connection := &serverConnection{
		key:    key,
		name:   strings.TrimSpace(name),
		source: source,
		config: config,
		runtime: ServerRuntime{
			Name:               strings.TrimSpace(name),
			Config:             MarshalServerConfig(config),
			Status:             "disconnected",
			Disabled:           config.Disabled,
			DisabledForPrompts: config.DisabledForPrompts,
			Timeout:            config.Timeout,
			Source:             source,
			ErrorHistory:       []ServerErrorEntry{},
		},
	}
	h.mu.Lock()
	h.connections[key] = connection
	h.mu.Unlock()
	if config.Disabled {
		return
	}
	transport, err := newRPCTransport(config, func(message string) {
		h.appendServerLog(connection, message, "info")
	})
	if err != nil {
		h.markConnectionError(connection, err)
		return
	}
	connection.transport = transport
	connection.runtime.Status = "connecting"
	initializeCtx, initializeCancel := context.WithTimeout(context.Background(), connectionInitializeTimeout(config))
	initializeResult, err := initializeRPCTransport(initializeCtx, transport)
	initializeCancel()
	if err != nil {
		h.markConnectionError(connection, err)
		return
	}
	toolsCtx, toolsCancel := context.WithTimeout(context.Background(), connectionInitializeTimeout(config))
	tools, err := listServerTools(toolsCtx, transport, config)
	toolsCancel()
	if err != nil {
		h.markConnectionError(connection, err)
		return
	}
	resources := []ServerResource{}
	resourcesCtx, resourcesCancel := context.WithTimeout(context.Background(), connectionCapabilityProbeTimeout(config))
	listedResources, err := listServerResources(resourcesCtx, transport)
	resourcesCancel()
	if err != nil {
		h.appendServerLog(connection, "resources/list failed: "+err.Error(), "warn")
	} else {
		resources = listedResources
	}
	resourceTemplates := []ServerResourceTemplate{}
	resourceTemplatesCtx, resourceTemplatesCancel := context.WithTimeout(context.Background(), connectionCapabilityProbeTimeout(config))
	listedResourceTemplates, err := listServerResourceTemplates(resourceTemplatesCtx, transport)
	resourceTemplatesCancel()
	if err != nil {
		h.appendServerLog(connection, "resources/templates/list failed: "+err.Error(), "warn")
	} else {
		resourceTemplates = listedResourceTemplates
	}
	connection.runtime.Status = "connected"
	connection.runtime.Error = ""
	connection.runtime.Tools = tools
	connection.runtime.Resources = resources
	connection.runtime.ResourceTemplates = resourceTemplates
	connection.runtime.Instructions = strings.TrimSpace(initializeResult.Instructions)
	connection.runtime.Config = MarshalServerConfig(config)
	connection.runtime.Disabled = config.Disabled
	connection.runtime.DisabledForPrompts = config.DisabledForPrompts
	connection.runtime.Timeout = config.Timeout
}

func (h *ClientHub) appendServerLog(connection *serverConnection, message string, level string) {
	if h == nil || connection == nil {
		return
	}
	trimmedMessage := strings.TrimSpace(message)
	if trimmedMessage == "" {
		return
	}
	entry := ServerErrorEntry{
		Message:   trimmedMessage,
		Timestamp: time.Now().UnixMilli(),
		Level:     strings.TrimSpace(level),
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	current := h.connections[connection.key]
	if current == nil {
		return
	}
	current.runtime.ErrorHistory = append(current.runtime.ErrorHistory, entry)
	if len(current.runtime.ErrorHistory) > 100 {
		current.runtime.ErrorHistory = append([]ServerErrorEntry(nil), current.runtime.ErrorHistory[len(current.runtime.ErrorHistory)-100:]...)
	}
}

func (h *ClientHub) markConnectionError(connection *serverConnection, err error) {
	if h == nil || connection == nil || err == nil {
		return
	}
	h.appendServerLog(connection, err.Error(), "error")
	h.mu.Lock()
	defer h.mu.Unlock()
	current := h.connections[connection.key]
	if current == nil {
		return
	}
	current.runtime.Status = "disconnected"
	current.runtime.Error = err.Error()
}

func (h *ClientHub) GetServers() []ServerRuntime {
	if h == nil {
		return nil
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	embeddedOrder := h.embedded.ServerOrder
	globalOrder := h.global.ServerOrder
	embeddedIndex := map[string]int{}
	for index, name := range embeddedOrder {
		embeddedIndex[name] = index
	}
	globalIndex := map[string]int{}
	for index, name := range globalOrder {
		globalIndex[name] = index
	}
	result := make([]ServerRuntime, 0, len(h.connections))
	for _, connection := range h.connections {
		result = append(result, connection.runtime)
	}
	sortServerRuntimes(result, embeddedIndex, globalIndex)
	return result
}

func sortServerRuntimes(servers []ServerRuntime, embeddedIndex map[string]int, globalIndex map[string]int) {
	for i := 0; i < len(servers); i++ {
		for j := i + 1; j < len(servers); j++ {
			if compareServerRuntimeOrder(servers[i], servers[j], embeddedIndex, globalIndex) > 0 {
				servers[i], servers[j] = servers[j], servers[i]
			}
		}
	}
}

func compareServerRuntimeOrder(left ServerRuntime, right ServerRuntime, embeddedIndex map[string]int, globalIndex map[string]int) int {
	leftPriority := sourceOrderPriority(left.Source)
	rightPriority := sourceOrderPriority(right.Source)
	if leftPriority != rightPriority {
		return leftPriority - rightPriority
	}
	switch left.Source {
	case ServerSourceEmbedded:
		return compareSourceOrder(left.Name, right.Name, embeddedIndex)
	case ServerSourceGlobal:
		return compareSourceOrder(left.Name, right.Name, globalIndex)
	default:
		return strings.Compare(left.Name, right.Name)
	}
}

func sourceOrderPriority(source ServerSource) int {
	switch source {
	case ServerSourceEmbedded:
		return 0
	case ServerSourceGlobal:
		return 1
	default:
		return 2
	}
}

func compareSourceOrder(leftName string, rightName string, order map[string]int) int {
	leftIndex, leftOk := order[leftName]
	rightIndex, rightOk := order[rightName]
	if leftOk && rightOk {
		return leftIndex - rightIndex
	}
	if leftOk {
		return -1
	}
	if rightOk {
		return 1
	}
	return strings.Compare(leftName, rightName)
}

func (h *ClientHub) findConnection(name string, source ServerSource) *serverConnection {
	if h == nil {
		return nil
	}
	key := serverConnectionKey(source, name)
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.connections[key]
}

func (h *ClientHub) SaveGlobalServer(name string, config ServerConfig) error {
	if h == nil {
		return nil
	}
	normalizedName := strings.TrimSpace(name)
	if normalizedName == "" {
		return fmt.Errorf("server name is required")
	}
	normalizedConfig, err := NormalizeServerConfig(config)
	if err != nil {
		return err
	}
	if err := h.globalStore.Upsert(normalizedName, normalizedConfig); err != nil {
		return err
	}
	return h.Reload()
}

func (h *ClientHub) DeleteServer(name string, source ServerSource) error {
	if h == nil {
		return nil
	}
	if source != ServerSourceGlobal {
		return nil
	}
	if err := h.globalStore.Delete(strings.TrimSpace(name)); err != nil {
		return err
	}
	return h.Reload()
}

func (h *ClientHub) UpdateServerDisabled(name string, source ServerSource, disabled bool) error {
	connection := h.findConnection(name, source)
	if connection == nil {
		return fmt.Errorf("server not found")
	}
	if source != ServerSourceGlobal {
		return nil
	}
	nextConfig := connection.config
	nextConfig.Disabled = disabled
	return h.SaveGlobalServer(name, nextConfig)
}

func (h *ClientHub) UpdateServerDisabledForPrompts(name string, source ServerSource, disabledForPrompts bool) error {
	connection := h.findConnection(name, source)
	if connection == nil {
		return fmt.Errorf("server not found")
	}
	if source != ServerSourceGlobal {
		return nil
	}
	nextConfig := connection.config
	nextConfig.DisabledForPrompts = disabledForPrompts
	return h.SaveGlobalServer(name, nextConfig)
}

func (h *ClientHub) UpdateServerTimeout(name string, source ServerSource, timeout int) error {
	connection := h.findConnection(name, source)
	if connection == nil {
		return fmt.Errorf("server not found")
	}
	if source != ServerSourceGlobal {
		return nil
	}
	nextConfig := connection.config
	nextConfig.Timeout = timeout
	return h.SaveGlobalServer(name, nextConfig)
}

func (h *ClientHub) RestartServer(name string, source ServerSource) error {
	connection := h.findConnection(name, source)
	if connection == nil {
		return fmt.Errorf("server not found")
	}
	if connection.transport != nil {
		_ = connection.transport.Close()
	}
	return h.Reload()
}

func (h *ClientHub) CallTool(name string, source ServerSource, toolName string, arguments map[string]any) (CallToolResult, error) {
	connection := h.findConnection(name, source)
	if connection == nil {
		return CallToolResult{}, fmt.Errorf("server not found")
	}
	if connection.transport == nil {
		return CallToolResult{}, fmt.Errorf("server is not connected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeoutForConnection(connection))
	defer cancel()
	result, err := callServerTool(ctx, connection.transport, connection.name, strings.TrimSpace(toolName), arguments)
	if err != nil {
		h.markConnectionError(connection, err)
		return CallToolResult{}, err
	}
	responseText := formatToolCallResponse(result)
	h.appendServerLog(connection, "tools/call "+strings.TrimSpace(toolName), "info")
	return CallToolResult{
		ServerName: connection.name,
		ToolName:   strings.TrimSpace(toolName),
		Args:       marshalCallArguments(arguments),
		Response:   responseText,
		IsError:    result.IsError,
	}, nil
}

func (h *ClientHub) ReadResource(name string, source ServerSource, uri string) (ReadResourceResult, error) {
	connection := h.findConnection(name, source)
	if connection == nil {
		return ReadResourceResult{}, fmt.Errorf("server not found")
	}
	if connection.transport == nil {
		return ReadResourceResult{}, fmt.Errorf("server is not connected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeoutForConnection(connection))
	defer cancel()
	result, err := readServerResource(ctx, connection.transport, strings.TrimSpace(uri))
	if err != nil {
		h.markConnectionError(connection, err)
		return ReadResourceResult{}, err
	}
	responseText := formatResourceReadResponse(result)
	h.appendServerLog(connection, "resources/read "+strings.TrimSpace(uri), "info")
	return ReadResourceResult{
		ServerName: connection.name,
		URI:        strings.TrimSpace(uri),
		Response:   responseText,
	}, nil
}

func (h *ClientHub) ListPromptTools() []PromptServerTool {
	servers := h.GetServers()
	result := make([]PromptServerTool, 0)
	for _, server := range servers {
		if server.Disabled || server.DisabledForPrompts || server.Status != "connected" {
			continue
		}
		for _, tool := range server.Tools {
			if !tool.EnabledForPrompt {
				continue
			}
			result = append(result, PromptServerTool{
				ServerName:       server.Name,
				ServerSource:     server.Source,
				ToolName:         tool.Name,
				Description:      tool.Description,
				InputSchema:      tool.InputSchema,
				AlwaysAllow:      tool.AlwaysAllow,
				EnabledForPrompt: tool.EnabledForPrompt,
			})
		}
	}
	return result
}

func requestTimeoutForConnection(connection *serverConnection) time.Duration {
	if connection == nil {
		return 20 * time.Second
	}
	if connection.config.Timeout <= 0 {
		return 5 * time.Minute
	}
	return time.Duration(connection.config.Timeout) * time.Second
}

func connectionInitializeTimeout(config ServerConfig) time.Duration {
	if config.Timeout > 0 {
		return time.Duration(config.Timeout) * time.Second
	}
	return 45 * time.Second
}

func connectionCapabilityProbeTimeout(config ServerConfig) time.Duration {
	if config.Timeout > 0 {
		return time.Duration(config.Timeout) * time.Second
	}
	return 8 * time.Second
}

func (h *ClientHub) BuildState() map[string]any {
	servers := h.GetServers()
	globalConfigText, _ := h.globalStore.LoadRawText()
	return map[string]any{
		"servers":           servers,
		"globalConfigPath":  h.globalStore.Path(),
		"globalConfigText":  globalConfigText,
		"embeddedServers":   h.embedded.ServerOrder,
		"globalServerOrder": h.global.ServerOrder,
	}
}

func (h *ClientHub) GlobalStore() *ConfigStore {
	if h == nil {
		return nil
	}
	return h.globalStore
}

func (h *ClientHub) ExportServerConfig(name string, source ServerSource) string {
	connection := h.findConnection(name, source)
	if connection == nil {
		return "{}"
	}
	data, err := json.MarshalIndent(connection.config, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(data)
}