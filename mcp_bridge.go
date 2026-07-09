package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	ai "luminssh-go/internal/ai"
	mcp "luminssh-go/internal/mcp"
	"luminssh-go/internal/mcpserver"
)

func loadMCPServiceSettings(app *App) mcp.ServiceSettings {
	configDir := ""
	if app != nil && app.configManager != nil {
		configDir = app.configManager.configDir
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

func startMCPServer(app *App) {
	applyMCPServiceState(app)
}

func stopMCPServer(app *App) {
	mcp.StopServer(newMCPHost(app))
}

func (a *App) GetMCPServerInfo() map[string]interface{} {
	return mcp.GetServerInfo(newMCPHost(a), loadMCPServiceSettings(a))
}

func applyMCPOutputCompressionSettings(settings mcp.OutputCompressionSettings) {
	mcp.ApplyOutputCompressionSettings(settings)
}

func currentTerminalOutputLineLimit() int {
	return mcp.CurrentTerminalOutputLineLimit()
}

func currentTerminalOutputCharacterLimit() int {
	return mcp.CurrentTerminalOutputCharacterLimit()
}

func (c *ConfigManager) GetMCPOutputCompressionSettings() mcp.OutputCompressionSettings {
	if c == nil {
		return mcp.OutputCompressionSettings{
			TerminalOutputLineLimit:      mcp.DefaultTerminalOutputLineLimit,
			TerminalOutputCharacterLimit: mcp.DefaultTerminalOutputCharacterLimit,
		}
	}
	return mcp.LoadOutputCompressionSettings(c.configDir)
}

func (c *ConfigManager) SaveMCPOutputCompressionSettings(settings mcp.OutputCompressionSettings) error {
	if c == nil {
		return nil
	}
	return mcp.SaveOutputCompressionSettings(c.configDir, settings)
}

func (a *App) GetMCPOutputCompressionSettings() map[string]int {
	settings := mcp.OutputCompressionSettings{
		TerminalOutputLineLimit:      mcp.DefaultTerminalOutputLineLimit,
		TerminalOutputCharacterLimit: mcp.DefaultTerminalOutputCharacterLimit,
	}
	if a != nil && a.configManager != nil {
		settings = a.configManager.GetMCPOutputCompressionSettings()
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
		if err := a.configManager.SaveMCPOutputCompressionSettings(settings); err != nil {
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

func (a *App) ListConnectedSessions() ([]mcpserver.ConnectedSession, error) {
	return mcpserver.NewService(mcpSessionProvider{app: a}).ListConnectedSessions()
}

type mcpHost struct {
	app *App
}

func newMCPHost(app *App) mcpHost {
	return mcpHost{app: app}
}

func (h mcpHost) RegistryKey() any {
	if h.app == nil {
		return nil
	}
	return h.app
}

func (h mcpHost) ListSessionDescriptors() ([]mcpserver.SessionDescriptor, error) {
	if h.app == nil || h.app.sshManager == nil {
		return []mcpserver.SessionDescriptor{}, nil
	}
	h.app.sshManager.mu.RLock()
	sessionMap := make(map[string]*SessionData, len(h.app.sshManager.sessions))
	for sessionID, sessionData := range h.app.sshManager.sessions {
		sessionMap[sessionID] = sessionData
	}
	clientMap := make(map[string]*sshClientEntry, len(h.app.sshManager.clients))
	for connectionRef, clientEntry := range h.app.sshManager.clients {
		clientMap[connectionRef] = clientEntry
	}
	h.app.sshManager.mu.RUnlock()

	connectionMap := make(map[string]Connection)
	if h.app.configManager != nil {
		for _, connection := range h.app.configManager.GetConnections() {
			if connection.ID != "" {
				connectionMap[connection.ID] = connection
			}
			connectionMap[connection.Username+"@"+dialAddr(connection.Host, connection.Port)] = connection
		}
	}

	result := make([]mcpserver.SessionDescriptor, 0, len(sessionMap))
	for sessionID, sessionData := range sessionMap {
		if sessionData == nil {
			continue
		}
		descriptor := mcpserver.SessionDescriptor{
			SessionID:      sessionID,
			GroupSessionID: sessionData.GroupSessionId,
			ConnectionRef:  sessionData.ConnKey,
			ConnectionID:   sessionData.ConnKey,
		}
		if clientEntry, ok := clientMap[sessionData.ConnKey]; ok && clientEntry != nil && clientEntry.SFTP != nil {
			descriptor.SFTPAvailable = true
		}
		if connection, ok := connectionMap[sessionData.ConnKey]; ok {
			descriptor.ConnectionID = connection.ID
			descriptor.Tags = buildMCPSessionTags(connection)
		}
		result = append(result, descriptor)
	}
	return result, nil
}

func (h mcpHost) ExecuteCommandInTerminalControlled(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (mcpserver.CommandExecutionResult, error) {
	if h.app == nil || h.app.sshManager == nil {
		return mcpserver.CommandExecutionResult{}, fmt.Errorf("ssh manager unavailable")
	}
	result, _, err := h.app.sshManager.ExecuteCommandInTerminalControlled(sessionID, command, purpose, isMutating, cwd, shellType, timeout, nil, nil, nil, nil, nil)
	return result, err
}

func (h mcpHost) ListDirectoryContext(ctx context.Context, sessionID string, remotePath string) ([]map[string]interface{}, error) {
	if h.app == nil || h.app.sshManager == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.ListDirContext(ctx, sessionID, remotePath)
}

func (h mcpHost) ReadTextFileContext(ctx context.Context, sessionID string, remotePath string) (string, error) {
	if h.app == nil || h.app.sshManager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.ReadFileContext(ctx, sessionID, remotePath)
}

func (h mcpHost) WriteTextFileContext(ctx context.Context, sessionID string, remotePath string, content string) error {
	if h.app == nil || h.app.sshManager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.WriteFileContext(ctx, sessionID, remotePath, content)
}

func (h mcpHost) DeleteItemContext(ctx context.Context, sessionID string, remotePath string, isDir bool) error {
	if h.app == nil || h.app.sshManager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.DeleteItemContext(ctx, sessionID, remotePath, isDir)
}

func (h mcpHost) MkdirContext(ctx context.Context, sessionID string, remotePath string) error {
	if h.app == nil || h.app.sshManager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.MkdirContext(ctx, sessionID, remotePath)
}

func (h mcpHost) RunCommandContext(ctx context.Context, sessionID string, command string) (string, error) {
	if h.app == nil || h.app.sshManager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	client, _, err := h.app.sshManager.getClientEntry(sessionID)
	if err != nil {
		return "", err
	}
	return h.app.sshManager.executeCmdWithClientContext(ctx, client, command)
}

func (h mcpHost) UploadTempTextContext(ctx context.Context, sessionID string, suffix string, content string, mode os.FileMode) (string, error) {
	if h.app == nil || h.app.sshManager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	sftpClient, err := h.app.sshManager.getSFTPClient(sessionID)
	if err != nil {
		return "", err
	}
	path := "/tmp/lumin_mcp_" + newCommandExecutionToken() + suffix
	file, err := sftpClient.Create(path)
	if err != nil {
		return "", err
	}
	if err := writeStringChunksWithContext(ctx, file, content); err != nil {
		file.Close()
		_ = sftpClient.Remove(path)
		return "", err
	}
	if err := file.Close(); err != nil {
		_ = sftpClient.Remove(path)
		return "", err
	}
	if err := ensureContextActive(ctx); err != nil {
		_ = sftpClient.Remove(path)
		return "", err
	}
	if err := sftpClient.Chmod(path, mode); err != nil {
		_ = sftpClient.Remove(path)
		return "", err
	}
	return path, nil
}

func (h mcpHost) RemoveFile(sessionID string, remotePath string) {
	if h.app == nil || h.app.sshManager == nil || strings.TrimSpace(remotePath) == "" {
		return
	}
	sftpClient, err := h.app.sshManager.getSFTPClient(sessionID)
	if err != nil {
		return
	}
	_ = sftpClient.Remove(remotePath)
}

func buildMCPSessionTags(connection Connection) []string {
	tags := make([]string, 0, 3)
	if name := strings.TrimSpace(connection.Name); name != "" {
		tags = append(tags, name)
	}
	if group := strings.TrimSpace(connection.Group); group != "" && !containsMCPSessionTag(tags, group) {
		tags = append(tags, group)
	}
	if osName := strings.TrimSpace(connection.Os); osName != "" && !containsMCPSessionTag(tags, osName) {
		tags = append(tags, osName)
	}
	return tags
}

func containsMCPSessionTag(tags []string, value string) bool {
	for _, tag := range tags {
		if tag == value {
			return true
		}
	}
	return false
}
