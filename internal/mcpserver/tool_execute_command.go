package mcpserver

import (
	"fmt"
	"time"
)

const defaultExecuteCommandTimeout = 5 * time.Minute

func executeCommandToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "execute_command",
		Description: "Execute a command inside the real connected SSH terminal identified by session_id. This keeps the command visible and interactive for the user while still capturing output and exit code.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type": "string",
					"description": "Connected SSH terminal session identifier returned by list_connected_sessions.",
				},
				"command": map[string]any{
					"type": "string",
					"description": "Command text to execute inside the target terminal session.",
				},
				"purpose": map[string]any{
					"type": "string",
					"description": "Short purpose statement for the command.",
				},
				"is_mutating": map[string]any{
					"type": "integer",
					"description": "Whether the command mutates remote state. Must be 0 or 1.",
					"enum": []int{0, 1},
				},
				"cwd": map[string]any{
					"type": "string",
					"description": "Optional working directory to switch to before execution.",
				},
				"shellType": map[string]any{
					"type": "string",
					"description": "Shell wrapper type. Must be one of powershell, cmd, zsh.",
					"enum": []string{"powershell", "cmd", "zsh"},
				},
			},
			"required": []string{"session_id", "command", "purpose", "is_mutating", "shellType"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callExecuteCommand(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.commandProvider == nil {
		return nil, fmt.Errorf("command provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "command", "purpose", "is_mutating", "cwd", "shellType"); err != nil {
		return nil, err
	}
	session, err := requireSessionArgument(c.service, arguments)
	if err != nil {
		return nil, err
	}
	command, err := requireStringArgument(arguments, "command")
	if err != nil {
		return nil, err
	}
	purpose, err := requireStringArgument(arguments, "purpose")
	if err != nil {
		return nil, err
	}
	shellType, err := requireStringArgument(arguments, "shellType")
	if err != nil {
		return nil, err
	}
	rawIsMutating, ok := arguments["is_mutating"]
	if !ok {
		return nil, fmt.Errorf("missing required argument: is_mutating")
	}
	isMutatingValue, ok := parseZeroOrOneValue(rawIsMutating)
	if !ok {
		return nil, fmt.Errorf("argument is_mutating must be 0 or 1")
	}
	cwd, _, err := optionalStringArgument(arguments, "cwd")
	if err != nil {
		return nil, err
	}
	return executeCommandWithContext(c.commandProvider, c.callCtx, session.SessionID, command, purpose, isMutatingValue == 1, cwd, shellType, defaultExecuteCommandTimeout)
}

func parseZeroOrOneValue(rawValue any) (int, bool) {
switch value := rawValue.(type) {
case int:
	if value == 0 || value == 1 {
		return value, true
	}
case int32:
	if value == 0 || value == 1 {
		return int(value), true
	}
case int64:
	if value == 0 || value == 1 {
		return int(value), true
	}
case float64:
	if value == 0 || value == 1 {
		return int(value), true
	}
}
return 0, false
}