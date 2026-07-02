package mcp

import (
	"context"
	"fmt"
	"time"

	"luminssh-go/internal/mcpserver"
)

type CommandProvider struct {
	host Host
}

func NewCommandProvider(host Host) CommandProvider {
	return CommandProvider{host: host}
}

func (p CommandProvider) ExecuteCommand(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (mcpserver.CommandExecutionResult, error) {
	return p.ExecuteCommandContext(context.Background(), sessionID, command, purpose, isMutating, cwd, shellType, timeout)
}

func (p CommandProvider) ExecuteCommandContext(ctx context.Context, sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (mcpserver.CommandExecutionResult, error) {
	if p.host == nil {
		return mcpserver.CommandExecutionResult{}, fmt.Errorf("ssh manager unavailable")
	}
	return p.host.ExecuteCommandInTerminalControlled(sessionID, command, purpose, isMutating, cwd, shellType, timeout)
}