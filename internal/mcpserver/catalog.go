package mcpserver

import "fmt"

type ToolDefinition struct {
	Name string `json:"name"`
	Description string `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type Catalog struct {
	service *Service
	fileProvider FileProvider
	commandProvider CommandProvider
	remoteEditExecutor RemoteEditExecutor
}

func NewCatalog(service *Service, fileProvider FileProvider, commandProvider CommandProvider, remoteEditExecutor RemoteEditExecutor) *Catalog {
	return &Catalog{service: service, fileProvider: fileProvider, commandProvider: commandProvider, remoteEditExecutor: remoteEditExecutor}
}

func (c *Catalog) List() []ToolDefinition {
	return []ToolDefinition{
		listConnectedSessionsToolDefinition(),
		listFilesToolDefinition(),
		readFileToolDefinition(),
		writeToFileToolDefinition(),
		executeCommandToolDefinition(),
		searchReplaceToolDefinition(),
		searchAndReplaceToolDefinition(),
		applyDiffToolDefinition(),
		editFileToolDefinition(),
		applyPatchToolDefinition(),
	}
}

func (c *Catalog) Call(name string, arguments map[string]any) (any, error) {
	switch name {
	case "list_connected_sessions":
		return c.callListConnectedSessions(arguments)
	case "list_files":
		return c.callListFiles(arguments)
	case "read_file":
		return c.callReadFile(arguments)
	case "write_to_file":
		return c.callWriteToFile(arguments)
	case "execute_command":
		return c.callExecuteCommand(arguments)
	case "search_replace":
		return c.callSearchReplace(arguments)
	case "search_and_replace":
		return c.callSearchAndReplace(arguments)
	case "apply_diff":
		return c.callApplyDiff(arguments)
	case "edit_file":
		return c.callEditFile(arguments)
	case "apply_patch":
		return c.callApplyPatch(arguments)
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}