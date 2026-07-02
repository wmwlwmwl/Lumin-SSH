package mcpserver

import (
	"errors"
	"fmt"
)

func applyPatchToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "apply_patch",
		Description: "Apply a multi-file patch document for the provided session_id. Supports add, delete, and update file operations. Use this when you need one request to edit several files or when you want patch-style operations. Required arguments: session_id, patch, remaining_file_edits. The patch field must use this format: *** Begin Patch, then one or more file operations such as *** Add File: path, *** Delete File: path, or *** Update File: path. Update hunks must start with @@ and use space lines for context, - lines for removed text, and + lines for added text. End the document with *** End Patch.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type": "string",
					"description": "Connected SSH terminal session identifier returned by list_connected_sessions.",
				},
				"patch": map[string]any{
					"type": "string",
					"description": "Patch document in begin/end patch format. Example: *** Begin Patch\\n*** Update File: /tmp/a.txt\\n@@\\n-old\\n+new\\n*** End Patch",
				},
				"remaining_file_edits": map[string]any{
					"type": "integer",
					"description": "Estimated remaining file edits including the current edit batch.",
					"minimum": 1,
				},
			},
			"required": []string{"session_id", "patch", "remaining_file_edits"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callApplyPatch(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "patch", "remaining_file_edits"); err != nil {
		return nil, err
	}
	session, err := requireSessionArgument(c.service, arguments)
	if err != nil {
		return nil, err
	}
	if !session.SFTPAvailable {
		return nil, fmt.Errorf("session does not have sftp available")
	}
	remainingFileEdits, hasRemaining, err := optionalIntArgument(arguments, "remaining_file_edits")
	if err != nil {
		return nil, err
	}
	if !hasRemaining || remainingFileEdits < 1 {
		return nil, fmt.Errorf("argument remaining_file_edits must be an integer greater than or equal to 1")
	}
	patch, err := requireStringArgument(arguments, "patch")
	if err != nil {
		return nil, err
	}
	operations, err := parseApplyPatchDocument(patch)
	if err != nil {
		return nil, err
	}
	capabilities := getRemoteEditCapabilitiesWithContext(c.remoteEditExecutor, c.callCtx, session.SessionID)
	if c.remoteEditExecutor != nil && capabilities.Python3 {
		remoteResult, remoteErr := applyPatchAtomicWithContext(c.remoteEditExecutor, c.callCtx, session.SessionID, operations)
		if remoteErr == nil {
			return remoteResult, nil
		}
		if !errors.Is(remoteErr, ErrRemoteEditUnsupported) {
			return nil, remoteErr
		}
	}
	result := ApplyPatchResult{
		SessionID: session.SessionID,
		Handler: EditHandlerFileProviderFallback,
		Capabilities: capabilities,
		Applied: false,
		Changes: make([]ApplyPatchFileChange, 0, len(operations)),
	}
	for _, operation := range operations {
		change := ApplyPatchFileChange{
			Action: operation.Action,
			Path: operation.Path,
			Hunks: len(operation.Hunks),
		}
		switch operation.Action {
		case "add":
			if err := writeTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, operation.Path, operation.Content); err != nil {
				return nil, err
			}
			change.Applied = true
			result.FilesChanged++
		case "delete":
			if err := deleteFileWithContext(c.fileProvider, c.callCtx, session.SessionID, operation.Path); err != nil {
				return nil, err
			}
			change.Applied = true
			result.FilesChanged++
		case "update":
			content, err := readTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, operation.Path)
			if err != nil {
				return nil, err
			}
			nextContent := content
			for _, hunk := range operation.Hunks {
				occurrences := countOccurrences(nextContent, hunk.Search)
				if occurrences != 1 {
					failure := &EditMatchFailure{
						Occurrences: occurrences,
					}
					if occurrences == 0 {
						failure.Reason = "patch hunk not found exactly"
						failure.BestMatch = extractBestMatchSnippet(nextContent, hunk.Search)
					} else {
						failure.Reason = "patch hunk matched multiple locations"
					}
					change.Failure = failure
					result.Changes = append(result.Changes, change)
					result.Failure = failure
					return result, nil
				}
				nextContent, _ = replaceExactlyOnce(nextContent, hunk.Search, hunk.Replace)
			}
			if err := writeTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, operation.Path, nextContent); err != nil {
				return nil, err
			}
			change.Applied = true
			result.FilesChanged++
		default:
			return nil, fmt.Errorf("unsupported patch action: %s", operation.Action)
		}
		result.Changes = append(result.Changes, change)
	}
	result.Applied = true
	return result, nil
}