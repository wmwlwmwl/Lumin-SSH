package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"luminssh-go/internal/mcpserver"
)

const mcpListenAddr = "127.0.0.1:5779"

var mcpServerRegistry sync.Map
var mcpLogState = struct {
	mu sync.Mutex
	lines []string
}{}

type mcpServerInfo struct {
	URL string `json:"url"`
	Transport string `json:"transport"`
	Endpoint string `json:"endpoint"`
	Instructions string `json:"instructions"`
	Logs string `json:"logs"`
	Tools []map[string]interface{} `json:"tools"`
}

func startMCPServer(app *App) {
	if app == nil {
		return
	}
	if _, loaded := mcpServerRegistry.Load(app); loaded {
		return
	}
	appendMCPLog("starting MCP server")
	service := mcpserver.NewService(mcpSessionProvider{app: app})
	catalog := mcpserver.NewCatalog(service, mcpFileProvider{app: app}, mcpCommandProvider{app: app}, mcpRemoteEditExecutor{app: app})
	server := mcpserver.NewServer(
		mcpserver.ServerConfig{
			Addr: mcpListenAddr,
			Endpoint: "/mcp",
			ServerInfo: mcpserver.Implementation{
				Name: "lumin-ssh",
				Title: "Lumin SSH MCP Server",
				Version: "0.1.0",
				Description: "MCP server for connected Lumin SSH terminal sessions",
			},
			Instructions: "Call list_connected_sessions first and use the returned session_id for subsequent SSH-scoped tools.",
			Logger: appendMCPLog,
		},
		catalog,
	)
	if err := server.Start(); err != nil {
		appendMCPLog(fmt.Sprintf("MCP server start failed: %v", err))
		log.Printf("mcp server start failed: %v", err)
		return
	}
	mcpServerRegistry.Store(app, server)
	appendMCPLog(fmt.Sprintf("MCP server listening on %s", server.URL()))
	log.Printf("mcp server listening on %s", server.URL())
}

func stopMCPServer(app *App) {
	if app == nil {
		return
	}
	value, ok := mcpServerRegistry.LoadAndDelete(app)
	if !ok {
		return
	}
	server, ok := value.(*mcpserver.Server)
	if !ok || server == nil {
		return
	}
	appendMCPLog("stopping MCP server")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := server.Close(ctx); err != nil {
		appendMCPLog(fmt.Sprintf("MCP server stop failed: %v", err))
		log.Printf("mcp server stop failed: %v", err)
		return
	}
	appendMCPLog("MCP server stopped")
}

func getMCPServerForApp(app *App) *mcpserver.Server {
	if app == nil {
		return nil
	}
	value, ok := mcpServerRegistry.Load(app)
	if !ok {
		return nil
	}
	server, ok := value.(*mcpserver.Server)
	if !ok {
		return nil
	}
	return server
}

func (a *App) GetMCPServerInfo() map[string]interface{} {
	server := getMCPServerForApp(a)
	tools := buildMCPToolDefinitions(a)
	if server == nil {
		return map[string]interface{}{
			"url": "",
			"transport": "streamable-http",
			"endpoint": "/mcp",
			"instructions": "",
			"logs": getMCPLogText(),
			"tools": tools,
		}
	}
	info := mcpServerInfo{
		URL: server.URL(),
		Transport: "streamable-http",
		Endpoint: "/mcp",
		Instructions: "Call list_connected_sessions first, then use the returned session_id for subsequent tools.",
		Logs: getMCPLogText(),
		Tools: tools,
	}
	return map[string]interface{}{
		"url": info.URL,
		"transport": info.Transport,
		"endpoint": info.Endpoint,
		"instructions": info.Instructions,
		"logs": info.Logs,
		"tools": info.Tools,
	}
}

func buildMCPToolDefinitions(app *App) []map[string]interface{} {
	if app == nil {
		return []map[string]interface{}{}
	}
	service := mcpserver.NewService(mcpSessionProvider{app: app})
	catalog := mcpserver.NewCatalog(service, mcpFileProvider{app: app}, mcpCommandProvider{app: app}, mcpRemoteEditExecutor{app: app})
	definitions := catalog.List()
	result := make([]map[string]interface{}, 0, len(definitions))
	for _, definition := range definitions {
		result = append(result, map[string]interface{}{
			"name": definition.Name,
			"description": definition.Description,
		})
	}
	return result
}

func appendMCPLog(message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	mcpLogState.mu.Lock()
	defer mcpLogState.mu.Unlock()
	line := time.Now().Format("2006-01-02 15:04:05") + " " + message
	mcpLogState.lines = append(mcpLogState.lines, line)
	if len(mcpLogState.lines) > 200 {
		mcpLogState.lines = append([]string(nil), mcpLogState.lines[len(mcpLogState.lines)-200:]...)
	}
}

func getMCPLogText() string {
	mcpLogState.mu.Lock()
	defer mcpLogState.mu.Unlock()
	return strings.Join(mcpLogState.lines, "\n")
}