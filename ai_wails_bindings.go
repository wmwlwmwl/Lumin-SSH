package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	ai "luminssh-go/internal/ai"
	"luminssh-go/internal/mcp"
	"luminssh-go/internal/mcpserver"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type AIBindings struct {
	app        *App
	runtimeApp *ai.App
}

func NewAIBindings(app *App) *AIBindings {
	return &AIBindings{app: app}
}

func (b *AIBindings) runtime() *ai.App {
	if b == nil {
		return nil
	}
	if b.runtimeApp == nil {
		configDir := ""
		if b.app != nil && b.app.configManager != nil {
			configDir = b.app.configManager.configDir
		}
		var sessionProvider ai.SessionProviderDelegate
		var sshDelegate ai.SSHDelegate
		if b.app != nil {
			sessionProvider = mcpSessionProvider{app: b.app}
			sshDelegate = aiSSHDelegate{manager: b.app.sshManager}
		}
		b.runtimeApp = ai.NewRuntimeApp(context.Background(), configDir, sessionProvider, sshDelegate)
	}
	if b.app != nil {
		b.runtimeApp.SetContext(b.app.ctx)
	}
	return b.runtimeApp
}

func (b *AIBindings) StartAIChat(requestID string, messagesJSON string) error {
	return b.runtime().StartAIChat(requestID, messagesJSON)
}

func (b *AIBindings) CancelAIChat(requestID string) {
	b.runtime().CancelAIChat(requestID)
}

func (b *AIBindings) ApproveAIChatTools(requestID string) error {
	return b.runtime().ApproveAIChatTools(requestID)
}

func (b *AIBindings) RejectAIChatTools(requestID string) error {
	return b.runtime().RejectAIChatTools(requestID)
}

func (b *AIBindings) RejectAIChatToolsForQueuedSubmission(requestID string) error {
	return b.runtime().RejectAIChatToolsForQueuedSubmission(requestID)
}

func (b *AIBindings) ResolveAIChatFollowup(requestID string, answer string, imagesJSON string) error {
	return b.runtime().ResolveAIChatFollowup(requestID, answer, imagesJSON)
}

func (b *AIBindings) SetAIChatSkipNextAutomaticRequest(requestID string, enabled bool) {
	b.runtime().SetAIChatSkipNextAutomaticRequest(requestID, enabled)
}

func (b *AIBindings) ContinueAIChatTool(requestID string) error {
	return b.runtime().ContinueAIChatTool(requestID)
}

func (b *AIBindings) TerminateAIChatTool(requestID string) error {
	return b.runtime().TerminateAIChatTool(requestID)
}

func (b *AIBindings) PreviewAIChatToolRestore(reviewID string, sessionID string) (map[string]interface{}, error) {
	return b.runtime().PreviewAIChatToolRestore(reviewID, sessionID)
}

func (b *AIBindings) PreviewAIChatToolDiff(reviewID string, sessionID string) (map[string]interface{}, error) {
	return b.runtime().PreviewAIChatToolDiff(reviewID, sessionID)
}

func (b *AIBindings) ReapplyAIChatTool(reviewID string, sessionID string) error {
	return b.runtime().ReapplyAIChatTool(reviewID, sessionID)
}

func (b *AIBindings) RestoreAIChatTool(reviewID string, sessionID string) error {
	return b.runtime().RestoreAIChatTool(reviewID, sessionID)
}

func (b *AIBindings) ListAIChatCommandTerminalCandidates(requestID string) ([]ai.AIChatCommandTerminalCandidate, error) {
	return b.runtime().ListAIChatCommandTerminalCandidates(requestID)
}

func (b *AIBindings) AssignAIChatToolTerminal(requestID string, targetSessionID string) error {
	return b.runtime().AssignAIChatToolTerminal(requestID, targetSessionID)
}

func (b *AIBindings) ListAIConversations() []ai.AIConversationSummary {
	return b.runtime().ListAIConversations()
}

func (b *AIBindings) CreateAIConversation(title string) (ai.AIConversationSnapshot, error) {
	return b.runtime().CreateAIConversation(title)
}

func (b *AIBindings) GetAIConversation(conversationID string) (ai.AIConversationSnapshot, error) {
	return b.runtime().GetAIConversation(conversationID)
}

func (b *AIBindings) SaveAIConversation(jsonStr string) (ai.AIConversationSnapshot, error) {
	return b.runtime().SaveAIConversation(jsonStr)
}

func (b *AIBindings) DeleteAIConversation(conversationID string) error {
	return b.runtime().DeleteAIConversation(conversationID)
}

func (b *AIBindings) OpenAIConversationFolder(conversationID string) error {
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedConversationID == "" {
		return fmt.Errorf("conversation id is required")
	}
	if b == nil || b.app == nil || b.app.configManager == nil {
		return fmt.Errorf("config manager unavailable")
	}
	return openLocalPathInExplorer(filepath.Join(b.app.configManager.configDir, "tasks", trimmedConversationID), true)
}

func (b *AIBindings) PreprocessAIConversationLongText(conversationID string, text string) (string, error) {
	return b.runtime().PreprocessAIConversationLongText(conversationID, text)
}

func (b *AIBindings) ReadAIConversationWrappedFile(conversationID string, localPath string) (string, error) {
	return b.runtime().ReadAIConversationWrappedFile(conversationID, localPath)
}

func (b *AIBindings) ListAIConversationBackups(conversationID string) []ai.AIConversationBackup {
	return b.runtime().ListAIConversationBackups(conversationID)
}

func (b *AIBindings) GetAIConversationBackupHistory(conversationID string, backupID string) []ai.AIConversationAPIMessage {
	return b.runtime().GetAIConversationBackupHistory(conversationID, backupID)
}

func (b *AIBindings) RestoreAIConversationBackup(conversationID string, backupID string) (ai.AIConversationSnapshot, error) {
	return b.runtime().RestoreAIConversationBackup(conversationID, backupID)
}

func (b *AIBindings) DeleteAIConversationBackup(conversationID string, backupID string) error {
	return b.runtime().DeleteAIConversationBackup(conversationID, backupID)
}

func (b *AIBindings) CountAIConversationContextTokens(sessionID string, snapshotJSON string) (ai.AIConversationContextMetrics, error) {
	return b.runtime().CountAIConversationContextTokens(sessionID, snapshotJSON)
}

func (b *AIBindings) CondenseAIConversationContext(conversationID string, sessionID string) (ai.AIConversationContextCondenseResult, error) {
	return b.runtime().CondenseAIConversationContext(conversationID, sessionID)
}

func (b *AIBindings) GetAIGlobalSettings() ai.AIGlobalSettings {
	return b.runtime().GetAIGlobalSettings()
}

func (b *AIBindings) SaveAIGlobalSettings(jsonStr string) error {
	previous := b.runtime().GetAIGlobalSettings()
	if err := b.runtime().SaveAIGlobalSettings(jsonStr); err != nil {
		return err
	}
	current := b.runtime().GetAIGlobalSettings()
	if previous.MCPEnabled != current.MCPEnabled || previous.MCPAllowBrowserCalls != current.MCPAllowBrowserCalls {
		applyMCPServiceState(b.app)
	}
	if b != nil && b.app != nil && b.app.configManager != nil {
		mcp.InitializeClientHub(b.app.configManager.configDir)
		b.app.configManager.bumpSnapshotTime()
		go b.app.configManager.AutoSync()
	}
	return nil
}

func (b *AIBindings) GetAIProviderState() ai.AIProviderState {
	return b.runtime().GetAIProviderState()
}

func (b *AIBindings) SaveAIProviderState(jsonStr string) error {
	return b.runtime().SaveAIProviderState(jsonStr)
}

func (b *AIBindings) ValidateAIProviderWebSearch(jsonStr string) ai.AIProviderWebSearchValidationResult {
	return b.runtime().ValidateAIProviderWebSearch(jsonStr)
}

func (b *AIBindings) RequestAIProviderModels(baseURL string, apiKey string) ([]string, error) {
	return b.runtime().RequestAIProviderModels(baseURL, apiKey)
}

type aiSSHDelegate struct {
	manager *SSHManager
}

func (d aiSSHDelegate) ExecuteCommandInTerminalControlled(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration, control <-chan ai.ToolExecutionAction, reassign <-chan string, onCommandQueued func(), onCommandStarted func(), onCommandOutput func(string)) (mcpserver.CommandExecutionResult, ai.ToolExecutionAction, error) {
	if d.manager == nil {
		return mcpserver.CommandExecutionResult{}, ai.ToolExecutionActionNone, fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.ExecuteCommandInTerminalControlled(sessionID, command, purpose, isMutating, cwd, shellType, timeout, control, reassign, onCommandQueued, onCommandStarted, onCommandOutput)
}

func (d aiSSHDelegate) ListSiblingTerminalCandidates(sessionID string) ([]ai.AIChatCommandTerminalCandidate, error) {
	if d.manager == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.ListSiblingTerminalCandidates(sessionID)
}

func (d aiSSHDelegate) ListDirContext(ctx context.Context, sessionID string, remotePath string) ([]map[string]interface{}, error) {
	if d.manager == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.ListDirContext(ctx, sessionID, remotePath)
}

func (d aiSSHDelegate) ReadFileContext(ctx context.Context, sessionID string, remotePath string) (string, error) {
	if d.manager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.ReadFileContext(ctx, sessionID, remotePath)
}

func (d aiSSHDelegate) WriteFileContext(ctx context.Context, sessionID string, remotePath string, content string) error {
	if d.manager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.WriteFileContext(ctx, sessionID, remotePath, content)
}

func (d aiSSHDelegate) DeleteItemContext(ctx context.Context, sessionID string, remotePath string, isDir bool) error {
	if d.manager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.DeleteItemContext(ctx, sessionID, remotePath, isDir)
}

func (d aiSSHDelegate) MkdirContext(ctx context.Context, sessionID string, remotePath string) error {
	if d.manager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.MkdirContext(ctx, sessionID, remotePath)
}

func (d aiSSHDelegate) BridgeGetClientEntry(sessionID string) (*ssh.Client, *sftp.Client, error) {
	if d.manager == nil {
		return nil, nil, fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.getClientEntry(sessionID)
}

func (d aiSSHDelegate) BridgeExecuteCmdWithClientContext(ctx context.Context, client *ssh.Client, command string) (string, error) {
	if d.manager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.executeCmdWithClientContext(ctx, client, command)
}

func (d aiSSHDelegate) BridgeGetSFTPClient(sessionID string) (*sftp.Client, error) {
	if d.manager == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	return d.manager.getSFTPClient(sessionID)
}
