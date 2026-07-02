package mcpserver

import "fmt"

func searchReplaceToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "search_replace",
		Description: "Replace exactly one matching text block in a remote file for the provided session_id. Use this for a single precise replacement. The old_string must match exactly one location. If it matches zero or multiple locations, the tool fails. Required arguments: session_id, path, remaining_file_edits, old_string, new_string. Example: old_string='hello', new_string='world'.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type": "string",
					"description": "Connected SSH terminal session identifier returned by list_connected_sessions.",
				},
				"path": map[string]any{
					"type": "string",
					"description": "Remote file path to modify.",
				},
				"remaining_file_edits": map[string]any{
					"type": "integer",
					"description": "Estimated remaining file edits including the current file.",
					"minimum": 1,
				},
				"old_string": map[string]any{
					"type": "string",
					"description": "Exact text block to search for. It must uniquely match one location in the target file.",
				},
				"new_string": map[string]any{
					"type": "string",
					"description": "Replacement text block for the unique old_string match.",
				},
			},
			"required": []string{"session_id", "path", "remaining_file_edits", "old_string", "new_string"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callSearchReplace(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "path", "remaining_file_edits", "old_string", "new_string"); err != nil {
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
	remainingFileEdits, hasRemaining, err := optionalIntArgument(arguments, "remaining_file_edits")
	if err != nil {
		return nil, err
	}
	if !hasRemaining || remainingFileEdits < 1 {
		return nil, fmt.Errorf("argument remaining_file_edits must be an integer greater than or equal to 1")
	}
	oldString, err := requireStringArgumentAllowEmpty(arguments, "old_string")
	if err != nil {
		return nil, err
	}
	newString, err := requireStringArgumentAllowEmpty(arguments, "new_string")
	if err != nil {
		return nil, err
	}
	capabilities := getRemoteEditCapabilities(c.remoteEditExecutor, session.SessionID)
	if oldString == "" {
		return SearchReplaceResult{
			SessionID: session.SessionID,
			Path: remotePath,
			Handler: EditHandlerFileProviderFallback,
			Capabilities: capabilities,
			Failure: &EditMatchFailure{Reason: "old_string must not be empty"},
		}, nil
	}
	if c.remoteEditExecutor != nil && capabilities.Python3 {
		remoteResult, remoteErr := c.remoteEditExecutor.ApplyPatchAtomic(session.SessionID, []ApplyPatchFileOperation{
			{
				Action: "update",
				Path: remotePath,
				Hunks: []ApplyPatchHunk{
					{Search: oldString, Replace: newString},
				},
			},
		})
		if remoteErr != nil {
			return nil, remoteErr
		}
		result := SearchReplaceResult{
			SessionID: session.SessionID,
			Path: remotePath,
			Handler: remoteResult.Handler,
			Capabilities: remoteResult.Capabilities,
			Applied: remoteResult.Applied,
		}
		if remoteResult.Applied {
			result.Occurrences = 1
		} else {
			failure := firstPatchFailure(remoteResult)
			result.Failure = failure
			result.Occurrences = failure.Occurrences
		}
		return result, nil
	}
	content, err := c.fileProvider.ReadTextFile(session.SessionID, remotePath)
	if err != nil {
		return nil, err
	}
	occurrences := countOccurrences(content, oldString)
	if occurrences != 1 {
		failure := &EditMatchFailure{
			Occurrences: occurrences,
		}
		if occurrences == 0 {
			failure.Reason = "old_string not found exactly"
			failure.BestMatch = extractBestMatchSnippet(content, oldString)
		} else {
			failure.Reason = "old_string matched multiple locations"
		}
		return SearchReplaceResult{
			SessionID: session.SessionID,
			Path: remotePath,
			Handler: EditHandlerFileProviderFallback,
			Capabilities: capabilities,
			Occurrences: occurrences,
			Applied: false,
			Failure: failure,
		}, nil
	}
	nextContent, _ := replaceExactlyOnce(content, oldString, newString)
	if err := c.fileProvider.WriteTextFile(session.SessionID, remotePath, nextContent); err != nil {
		return nil, err
	}
	return SearchReplaceResult{
		SessionID: session.SessionID,
		Path: remotePath,
		Handler: EditHandlerFileProviderFallback,
		Capabilities: capabilities,
		Occurrences: 1,
		BytesWritten: len([]byte(nextContent)),
		Applied: true,
	}, nil
}