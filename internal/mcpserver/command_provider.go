package mcpserver

import (
	"context"
	"time"
)

type CommandExecutionResult struct {
	SessionID string `json:"session_id"`
	Command string `json:"command"`
	Purpose string `json:"purpose"`
	IsMutating bool `json:"is_mutating"`
	CWD string `json:"cwd,omitempty"`
	ShellType string `json:"shellType"`
	ExitCode *int `json:"exit_code,omitempty"`
	TimedOut bool `json:"timed_out"`
	Output string `json:"output"`
}

type CommandProvider interface {
	ExecuteCommand(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (CommandExecutionResult, error)
}

type CancelableCommandProvider interface {
	ExecuteCommandContext(ctx context.Context, sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (CommandExecutionResult, error)
}

func executeCommandWithContext(provider CommandProvider, ctx context.Context, sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (CommandExecutionResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if cancelableProvider, ok := provider.(CancelableCommandProvider); ok {
		return cancelableProvider.ExecuteCommandContext(ctx, sessionID, command, purpose, isMutating, cwd, shellType, timeout)
	}
	select {
	case <-ctx.Done():
		return CommandExecutionResult{}, ctx.Err()
	default:
		return provider.ExecuteCommand(sessionID, command, purpose, isMutating, cwd, shellType, timeout)
	}
}