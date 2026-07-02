package main

import (
	"fmt"
	"time"

	"luminssh-go/internal/mcpserver"
)

type mcpCommandProvider struct {
	app *App
}

func (p mcpCommandProvider) ExecuteCommand(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (mcpserver.CommandExecutionResult, error) {
	if p.app == nil || p.app.sshManager == nil {
		return mcpserver.CommandExecutionResult{}, fmt.Errorf("ssh manager unavailable")
	}
	return p.app.sshManager.ExecuteCommandInTerminal(sessionID, command, purpose, isMutating, cwd, shellType, timeout)
}