package mcpserver

import (
	"fmt"
	pathpkg "path"
	"sort"
	"strings"
)

const maxRecursiveListEntries = 2000

type ListFilesResult struct {
	SessionID string `json:"session_id"`
	Path string `json:"path"`
	Recursive bool `json:"recursive"`
	Entries []ListFilesEntry `json:"entries"`
	Truncated bool `json:"truncated"`
}

type ListFilesEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
	IsDirectory bool `json:"is_directory"`
	Size int64 `json:"size"`
	ModifyTime string `json:"modify_time,omitempty"`
	Permission string `json:"permission,omitempty"`
	Mode string `json:"mode,omitempty"`
	UID string `json:"uid,omitempty"`
	GID string `json:"gid,omitempty"`
}

func listFilesToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "list_files",
		Description: "List files and directories for a connected SSH terminal session. All operations are scoped to the provided session_id.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type": "string",
					"description": "Connected SSH terminal session identifier returned by list_connected_sessions.",
				},
				"path": map[string]any{
					"type": "string",
					"description": "Remote directory path to list.",
				},
				"recursive": map[string]any{
					"type": "boolean",
					"description": "Whether to recursively walk child directories.",
				},
			},
			"required": []string{"session_id", "path"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callListFiles(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "path", "recursive"); err != nil {
		return nil, err
	}
	session, err := requireSessionArgument(c.service, arguments)
	if err != nil {
		return nil, err
	}
	if !session.SFTPAvailable {
		return nil, fmt.Errorf("session does not have sftp available")
	}
	remotePath, err := requireStringArgument(arguments, "path")
	if err != nil {
		return nil, err
	}
	recursive, err := optionalBoolArgument(arguments, "recursive")
	if err != nil {
		return nil, err
	}
	result := ListFilesResult{
		SessionID: session.SessionID,
		Path: remotePath,
		Recursive: recursive,
	}
	if !recursive {
		entries, listErr := listDirectoryWithContext(c.fileProvider, c.callCtx, session.SessionID, remotePath)
		if listErr != nil {
			return nil, listErr
		}
		result.Entries = convertDirectoryEntries(remotePath, entries)
		return result, nil
	}
	entries, truncated, listErr := c.walkDirectory(session.SessionID, remotePath)
	if listErr != nil {
		return nil, listErr
	}
	result.Entries = entries
	result.Truncated = truncated
	return result, nil
}

func (c *Catalog) walkDirectory(sessionID string, rootPath string) ([]ListFilesEntry, bool, error) {
	queue := []string{rootPath}
	var result []ListFilesEntry
	truncated := false
	for len(queue) > 0 {
		if c.callCtx != nil {
			select {
			case <-c.callCtx.Done():
				return nil, false, c.callCtx.Err()
			default:
			}
		}
		currentPath := queue[0]
		queue = queue[1:]
		entries, err := listDirectoryWithContext(c.fileProvider, c.callCtx, sessionID, currentPath)
		if err != nil {
			return nil, false, err
		}
		converted := convertDirectoryEntries(currentPath, entries)
		result = append(result, converted...)
		if len(result) >= maxRecursiveListEntries {
			result = result[:maxRecursiveListEntries]
			truncated = true
			break
		}
		for _, entry := range converted {
			if entry.IsDirectory && !isLikelySymlink(entry.Permission) {
				queue = append(queue, entry.Path)
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Path < result[j].Path
	})
	return result, truncated, nil
}

func convertDirectoryEntries(basePath string, entries []DirectoryEntry) []ListFilesEntry {
	result := make([]ListFilesEntry, 0, len(entries))
	for _, entry := range entries {
		fullPath := pathpkg.Clean(pathpkg.Join(basePath, entry.Name))
		result = append(result, ListFilesEntry{
			Path: fullPath,
			Name: entry.Name,
			IsDirectory: entry.IsDirectory,
			Size: entry.Size,
			ModifyTime: entry.ModifyTime,
			Permission: entry.Permission,
			Mode: entry.Mode,
			UID: entry.UID,
			GID: entry.GID,
		})
	}
	return result
}

func isLikelySymlink(permission string) bool {
	if permission == "" {
		return false
	}
	first := strings.ToLower(permission[:1])
	return first == "l"
}