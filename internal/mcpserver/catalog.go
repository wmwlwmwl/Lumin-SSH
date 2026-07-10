package mcpserver

import (
	"context"
	"fmt"
)

type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type Catalog struct {
	service            *Service
	fileProvider       FileProvider
	commandProvider    CommandProvider
	remoteEditExecutor RemoteEditExecutor
	callCtx            context.Context
}

func NewCatalog(service *Service, fileProvider FileProvider, commandProvider CommandProvider, remoteEditExecutor RemoteEditExecutor) *Catalog {
	return &Catalog{
		service:            service,
		fileProvider:       fileProvider,
		commandProvider:    commandProvider,
		remoteEditExecutor: remoteEditExecutor,
		callCtx:            context.Background(),
	}
}

func (c *Catalog) List() []ToolDefinition {
	return []ToolDefinition{
		listConnectedSessionsToolDefinition(),
		listFilesToolDefinition(),
		readFileToolDefinition(),
		writeToFileToolDefinition(),
		executeCommandToolDefinition(),
		askFollowupQuestionToolDefinition(),
		attemptCompletionToolDefinition(),
		searchReplaceToolDefinition(),
		applyDiffToolDefinition(),
		applyPatchToolDefinition(),
	}
}

func (c *Catalog) Call(name string, arguments map[string]any) (any, error) {
	return c.CallWithContext(context.Background(), name, arguments)
}

func (c *Catalog) CallWithContext(ctx context.Context, name string, arguments map[string]any) (any, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	clone := *c
	clone.callCtx = ctx
	switch name {
	case "list_connected_sessions":
		return clone.callListConnectedSessions(arguments)
	case "list_files":
		return clone.callListFiles(arguments)
	case "read_file":
		return clone.callReadFile(arguments)
	case "write_to_file":
		return clone.callWriteToFile(arguments)
	case "execute_command":
		return clone.callExecuteCommand(arguments)
	case "ask_followup_question":
		return clone.callAskFollowupQuestion(arguments)
	case "attempt_completion":
		return clone.callAttemptCompletion(arguments)
	case "search_replace":
		return clone.callSearchReplace(arguments)
	case "apply_diff":
		return clone.callApplyDiff(arguments)
	case "edit_file":
		return clone.callEditFile(arguments)
	case "apply_patch":
		return clone.callApplyPatch(arguments)
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}
