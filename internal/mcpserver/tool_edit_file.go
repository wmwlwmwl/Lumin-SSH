package mcpserver

import (
	"fmt"
	"strings"
)

func editFileToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "edit_file",
		Description: "Edit a remote file for the provided session_id using an exact old_string/new_string replacement with optional expected_replacements validation. Use this when you want strict replacement-count checking. Required arguments: session_id, path, remaining_file_edits, old_string, new_string. Optional argument: expected_replacements. If expected_replacements is omitted, the default is 1.",
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
					"description": "Exact text block to search for.",
				},
				"new_string": map[string]any{
					"type": "string",
					"description": "Replacement text block.",
				},
				"expected_replacements": map[string]any{
					"type": "integer",
					"description": "Expected number of matches that must be replaced. Defaults to 1. Example: set to 2 only when the old_string must appear exactly twice.",
					"minimum": 1,
				},
			},
			"required": []string{"session_id", "path", "remaining_file_edits", "old_string", "new_string"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callEditFile(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "path", "remaining_file_edits", "old_string", "new_string", "expected_replacements"); err != nil {
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
	expectedReplacements := 1
	if value, ok, parseErr := optionalIntArgument(arguments, "expected_replacements"); parseErr != nil {
		return nil, parseErr
	} else if ok {
		expectedReplacements = value
	}
	if expectedReplacements < 1 {
		return nil, fmt.Errorf("argument expected_replacements must be greater than or equal to 1")
	}
	capabilities := getRemoteEditCapabilitiesWithContext(c.remoteEditExecutor, c.callCtx, session.SessionID)
	if oldString == "" {
		return EditFileResult{
			SessionID: session.SessionID,
			Path: remotePath,
			Handler: EditHandlerFileProviderFallback,
			Capabilities: capabilities,
			ExpectedReplacements: expectedReplacements,
			Failure: &EditMatchFailure{Reason: "old_string must not be empty"},
		}, nil
	}
	if expectedReplacements == 1 && c.remoteEditExecutor != nil && capabilities.Python3 {
		remoteResult, remoteErr := applyPatchAtomicWithContext(c.remoteEditExecutor, c.callCtx, session.SessionID, []ApplyPatchFileOperation{
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
		result := EditFileResult{
			SessionID: session.SessionID,
			Path: remotePath,
			Handler: remoteResult.Handler,
			Capabilities: remoteResult.Capabilities,
			ExpectedReplacements: expectedReplacements,
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
	content, err := readTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, remotePath)
	if err != nil {
		return nil, err
	}
	occurrences := countOccurrences(content, oldString)
	if occurrences != expectedReplacements {
		failure := &EditMatchFailure{
			Reason: "occurrence count did not match expected_replacements",
			Occurrences: occurrences,
		}
		if occurrences == 0 {
			failure.BestMatch = extractBestMatchSnippet(content, oldString)
		}
		return EditFileResult{
			SessionID: session.SessionID,
			Path: remotePath,
			Handler: EditHandlerFileProviderFallback,
			Capabilities: capabilities,
			ExpectedReplacements: expectedReplacements,
			Occurrences: occurrences,
			Applied: false,
			Failure: failure,
		}, nil
	}
	var nextContent string
	if expectedReplacements == 1 {
		nextContent, _ = replaceExactlyOnce(content, oldString, newString)
	} else {
		nextContent = strings.ReplaceAll(content, oldString, newString)
	}
	if err := writeTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, remotePath, nextContent); err != nil {
		return nil, err
	}
	return EditFileResult{
		SessionID: session.SessionID,
		Path: remotePath,
		Handler: EditHandlerFileProviderFallback,
		Capabilities: capabilities,
		ExpectedReplacements: expectedReplacements,
		Occurrences: occurrences,
		BytesWritten: len([]byte(nextContent)),
		Applied: true,
	}, nil
}