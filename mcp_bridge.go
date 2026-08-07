package main

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	ai "luminssh-go/internal/ai"
	mcp "luminssh-go/internal/mcp"
	"luminssh-go/internal/mcpserver"

	"golang.org/x/crypto/ssh"
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

func currentTerminalOutputLineLimit() int {
	return mcp.CurrentTerminalOutputLineLimit()
}

func currentTerminalOutputCharacterLimit() int {
	return mcp.CurrentTerminalOutputCharacterLimit()
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

func (h mcpHost) GetWorkspaceState() string {
	if h.app == nil || h.app.configManager == nil {
		return ""
	}
	return h.app.GetWorkspaceState()
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
	if client, _, err := h.app.sshManager.getClientEntry(sessionID); err == nil && client != nil {
		return h.shellListDirectory(ctx, client, remotePath)
	}
	return h.app.sshManager.ListDirContext(ctx, sessionID, remotePath)
}

func (h mcpHost) ReadTextFileContext(ctx context.Context, sessionID string, remotePath string) (string, error) {
	if h.app == nil || h.app.sshManager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	if client, _, err := h.app.sshManager.getClientEntry(sessionID); err == nil && client != nil {
		return h.runShellCommandLong(ctx, client, "cat -- "+shellQuotePath(remotePath))
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

func (h mcpHost) CopyItemContext(ctx context.Context, sessionID string, srcPath string, dstPath string) error {
	if h.app == nil || h.app.sshManager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.CopyItemContext(ctx, sessionID, srcPath, dstPath)
}

func (h mcpHost) MoveItemContext(ctx context.Context, sessionID string, srcPath string, dstPath string) error {
	if h.app == nil || h.app.sshManager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.MoveItemContext(ctx, sessionID, srcPath, dstPath)
}

func (h mcpHost) MkdirContext(ctx context.Context, sessionID string, remotePath string) error {
	if h.app == nil || h.app.sshManager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.MkdirContext(ctx, sessionID, remotePath)
}

func (h mcpHost) TransferFileContext(ctx context.Context, sessionID string, request mcpserver.TransferFileRequest) (mcpserver.TransferTaskSnapshot, error) {
	if h.app == nil || h.app.sshManager == nil {
		return mcpserver.TransferTaskSnapshot{}, fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.TransferFileContext(ctx, sessionID, request)
}

func (h mcpHost) ListTransfersContext(ctx context.Context, sessionID string) ([]mcpserver.TransferTaskSnapshot, error) {
	if h.app == nil || h.app.sshManager == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	return h.app.sshManager.ListTransfersContext(ctx, sessionID)
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

func (h mcpHost) runShellCommandLong(ctx context.Context, client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	return runCommandWithSessionContext(ctx, session, command, remoteCmdLongTimeout)
}

func (h mcpHost) shellListDirectory(ctx context.Context, client *ssh.Client, remotePath string) ([]map[string]interface{}, error) {
	command := "cd " + shellQuotePath(remotePath) + " && stat -c '%f\t%s\t%u\t%g\t%Y\t%n' -- .* * 2>/dev/null"
	output, err := h.runShellCommandLong(ctx, client, command)
	if err != nil {
		return nil, err
	}
	results := parseShellDirEntries(output)
	sort.Slice(results, func(i, j int) bool {
		iDir := results[i]["isDirectory"].(bool)
		jDir := results[j]["isDirectory"].(bool)
		if iDir != jDir {
			return iDir
		}
		return results[i]["name"].(string) < results[j]["name"].(string)
	})
	return results, nil
}

func parseShellDirEntries(output string) []map[string]interface{} {
	results := make([]map[string]interface{}, 0)
	for _, line := range strings.Split(output, "\n") {
		if line == "" {
			continue
		}
		fields := strings.SplitN(line, "\t", 6)
		if len(fields) < 6 {
			continue
		}
		name := fields[5]
		if name == "." || name == ".." || name == "" {
			continue
		}
		rawMode, parseErr := strconv.ParseUint(strings.TrimSpace(fields[0]), 16, 32)
		if parseErr != nil {
			continue
		}
		fileMode := unixRawModeToFileMode(uint32(rawMode))
		size, _ := strconv.ParseInt(strings.TrimSpace(fields[1]), 10, 64)
		modifyTime := ""
		if epoch, timeErr := strconv.ParseInt(strings.TrimSpace(fields[4]), 10, 64); timeErr == nil {
			modifyTime = time.Unix(epoch, 0).Format(time.RFC3339)
		}
		results = append(results, map[string]interface{}{
			"name":        name,
			"isDirectory": fileMode.IsDir(),
			"size":        size,
			"modifyTime":  modifyTime,
			"permission":  fileMode.String(),
			"mode":        fmt.Sprintf("%o", fileMode.Perm()),
			"uid":         strings.TrimSpace(fields[2]),
			"gid":         strings.TrimSpace(fields[3]),
		})
	}
	return results
}

func unixRawModeToFileMode(raw uint32) os.FileMode {
	const (
		cIFMT   = 0xf000
		cIFSOCK = 0xc000
		cIFLNK  = 0xa000
		cIFREG  = 0x8000
		cIFBLK  = 0x6000
		cIFDIR  = 0x4000
		cIFCHR  = 0x2000
		cIFIFO  = 0x1000
		cISUID  = 0x800
		cISGID  = 0x400
		cISVTX  = 0x200
	)
	mode := os.FileMode(raw & 0777)
	switch raw & cIFMT {
	case cIFBLK:
		mode |= os.ModeDevice
	case cIFCHR:
		mode |= os.ModeDevice | os.ModeCharDevice
	case cIFDIR:
		mode |= os.ModeDir
	case cIFIFO:
		mode |= os.ModeNamedPipe
	case cIFLNK:
		mode |= os.ModeSymlink
	case cIFSOCK:
		mode |= os.ModeSocket
	}
	if raw&cISUID != 0 {
		mode |= os.ModeSetuid
	}
	if raw&cISGID != 0 {
		mode |= os.ModeSetgid
	}
	if raw&cISVTX != 0 {
		mode |= os.ModeSticky
	}
	return mode
}
