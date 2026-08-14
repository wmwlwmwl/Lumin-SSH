package wailsapp

import (
	"fmt"
	"strings"

	mcp "luminssh-go/internal/mcp"
	"luminssh-go/internal/mcpbridge"
	"luminssh-go/internal/mcpserver"
)

func (a *App) GetMCPServerInfo() map[string]interface{} {
	return mcp.GetServerInfo(newMCPHost(a), mcpbridge.LoadServiceSettings(a.configManager.GetConfigDir()))
}
func (a *App) GetMCPSettingsState() map[string]interface{} {
	serviceInfo := mcp.GetServerInfo(newMCPHost(a), mcpbridge.LoadServiceSettings(a.configManager.GetConfigDir()))
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

func (a *App) GetMCPOutputCompressionSettings() map[string]int {
	settings := mcp.OutputCompressionSettings{
		TerminalOutputLineLimit:      mcp.DefaultTerminalOutputLineLimit,
		TerminalOutputCharacterLimit: mcp.DefaultTerminalOutputCharacterLimit,
	}
	if a != nil && a.configManager != nil {
		settings = mcp.LoadOutputCompressionSettings(a.configManager.GetConfigDir())
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
		if err := mcp.SaveOutputCompressionSettings(a.configManager.GetConfigDir(), settings); err != nil {
			return err
		}
	}
	mcp.ApplyOutputCompressionSettings(settings)
	return nil
}

func (a *App) ListConnectedSessions() ([]mcpserver.ConnectedSession, error) {
	return mcpserver.NewService(mcpbridge.SessionProvider{Host: newMCPHost(a)}).ListConnectedSessions()
}

// newMCPHost 构造 mcpbridge.Host，注入 App 的具体依赖。
func newMCPHost(app *App) mcpbridge.Host {
	host := mcpbridge.NewHost(app.sshManager, app.configManager, app.GetWorkspaceState, app)
	if app.mcpReporter != nil {
		host = host.WithReporter(app.mcpReporter)
	}
	return host
}
