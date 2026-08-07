package main

import (
	"fmt"
	"strings"

	ai "luminssh-go/internal/ai"
	mcp "luminssh-go/internal/mcp"
	"luminssh-go/internal/mcpbridge"
	"luminssh-go/internal/mcpserver"
)

func loadMCPServiceSettings(app *App) mcp.ServiceSettings {
	configDir := ""
	if app != nil && app.configManager != nil {
		configDir = app.configManager.GetConfigDir()
	}
	settings := ai.LoadAIGlobalSettings(configDir)
	return mcp.ServiceSettings{
		Enabled:           settings.MCPEnabled,
		AllowBrowserCalls: settings.MCPAllowBrowserCalls,
	}
}

func applyMCPServiceState(app *App) {
	settings := loadMCPServiceSettings(app)
	mcp.StopServer(newMCPHost(app))
	if !settings.Enabled {
		return
	}
	mcp.StartServer(newMCPHost(app), settings)
}
func initializeMCPClientHub(app *App) {
	if app == nil || app.configManager == nil {
		return
	}
	mcp.InitializeClientHub(app.configManager.GetConfigDir())
}

func startMCPServer(app *App) {
	initializeMCPClientHub(app)
	applyMCPServiceState(app)
}

func stopMCPServer(app *App) {
	mcp.StopServer(newMCPHost(app))
}

func (a *App) GetMCPServerInfo() map[string]interface{} {
	return mcp.GetServerInfo(newMCPHost(a), loadMCPServiceSettings(a))
}
func (a *App) GetMCPSettingsState() map[string]interface{} {
	serviceInfo := mcp.GetServerInfo(newMCPHost(a), loadMCPServiceSettings(a))
	clientState := map[string]any{
		"servers":           []mcp.ServerRuntime{},
		"globalConfigPath":  "",
		"globalConfigText":  "{\n  \"mcpServers\": {}\n}",
		"embeddedServers":   []string{},
		"globalServerOrder": []string{},
	}
	if a != nil && a.configManager != nil {
		hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
		if hub != nil {
			clientState = hub.BuildState()
		}
	}
	return map[string]interface{}{
		"service": serviceInfo,
		"client":  clientState,
	}
}
func (a *App) SaveMCPGlobalServer(name string, configText string) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
	if hub == nil {
		return fmt.Errorf("mcp client hub unavailable")
	}
	if err := hub.GlobalStore().SaveRawText(configText); err != nil {
		return err
	}
	return hub.ReloadGlobalOnly()
}
func (a *App) DeleteMCPGlobalServer(name string) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
	if hub == nil {
		return fmt.Errorf("mcp client hub unavailable")
	}
	return hub.DeleteServer(name, mcp.ServerSourceGlobal)
}
func (a *App) RestartMCPClientServer(name string, source string) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
	if hub == nil {
		return fmt.Errorf("mcp client hub unavailable")
	}
	return hub.RestartServer(name, mcp.ServerSource(strings.TrimSpace(source)))
}
func (a *App) ToggleMCPClientServer(name string, source string, disabled bool) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
	if hub == nil {
		return fmt.Errorf("mcp client hub unavailable")
	}
	return hub.UpdateServerDisabled(name, mcp.ServerSource(strings.TrimSpace(source)), disabled)
}
func (a *App) ToggleMCPClientServerDisabledForPrompts(name string, source string, disabledForPrompts bool) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
	if hub == nil {
		return fmt.Errorf("mcp client hub unavailable")
	}
	return hub.UpdateServerDisabledForPrompts(name, mcp.ServerSource(strings.TrimSpace(source)), disabledForPrompts)
}
func (a *App) UpdateMCPClientServerTimeout(name string, source string, timeout int) error {
	if a == nil || a.configManager == nil {
		return nil
	}
	hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
	if hub == nil {
		return fmt.Errorf("mcp client hub unavailable")
	}
	return hub.UpdateServerTimeout(name, mcp.ServerSource(strings.TrimSpace(source)), timeout)
}

func (a *App) ReloadMCPGlobalServers() error {
	if a == nil || a.configManager == nil {
		return nil
	}
	hub := mcp.InitializeClientHub(a.configManager.GetConfigDir())
	if hub == nil {
		return fmt.Errorf("mcp client hub unavailable")
	}
	return hub.ReloadGlobalOnly()
}

func applyMCPOutputCompressionSettings(settings mcp.OutputCompressionSettings) {
	mcp.ApplyOutputCompressionSettings(settings)
}

func getMCPOutputCompressionSettings(cm *ConfigManager) mcp.OutputCompressionSettings {
	if cm == nil {
		return mcp.OutputCompressionSettings{
			TerminalOutputLineLimit:      mcp.DefaultTerminalOutputLineLimit,
			TerminalOutputCharacterLimit: mcp.DefaultTerminalOutputCharacterLimit,
		}
	}
	return mcp.LoadOutputCompressionSettings(cm.GetConfigDir())
}

func saveMCPOutputCompressionSettings(cm *ConfigManager, settings mcp.OutputCompressionSettings) error {
	if cm == nil {
		return nil
	}
	return mcp.SaveOutputCompressionSettings(cm.GetConfigDir(), settings)
}

func (a *App) GetMCPOutputCompressionSettings() map[string]int {
	settings := mcp.OutputCompressionSettings{
		TerminalOutputLineLimit:      mcp.DefaultTerminalOutputLineLimit,
		TerminalOutputCharacterLimit: mcp.DefaultTerminalOutputCharacterLimit,
	}
	if a != nil && a.configManager != nil {
		settings = getMCPOutputCompressionSettings(a.configManager)
	}
	return map[string]int{
		"terminalOutputLineLimit":      settings.TerminalOutputLineLimit,
		"terminalOutputCharacterLimit": settings.TerminalOutputCharacterLimit,
	}
}

func (a *App) SaveMCPOutputCompressionSettings(lineLimit int, characterLimit int) error {
	settings := mcp.NormalizeOutputCompressionSettings(mcp.OutputCompressionSettings{
		TerminalOutputLineLimit:      lineLimit,
		TerminalOutputCharacterLimit: characterLimit,
	})
	if a != nil && a.configManager != nil {
		if err := saveMCPOutputCompressionSettings(a.configManager, settings); err != nil {
			return err
		}
	}
	applyMCPOutputCompressionSettings(settings)
	return nil
}

type mcpSessionProvider struct {
	app *App
}

func (p mcpSessionProvider) ListConnectedSessions() ([]mcpserver.SessionDescriptor, error) {
	return newMCPHost(p.app).ListSessionDescriptors()
}

func (p mcpSessionProvider) GetWorkspaceState() string {
	if p.app == nil || p.app.configManager == nil {
		return ""
	}
	return p.app.GetWorkspaceState()
}

func (a *App) ListConnectedSessions() ([]mcpserver.ConnectedSession, error) {
	return mcpserver.NewService(mcpSessionProvider{app: a}).ListConnectedSessions()
}

// newMCPHost 构造 mcpbridge.Host，注入 App 的具体依赖。
func newMCPHost(app *App) mcpbridge.Host {
	return mcpbridge.NewHost(app.sshManager, app.configManager, app.GetWorkspaceState, app)
}
