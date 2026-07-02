package mcpserver

import "fmt"

func applyDiffToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "apply_diff",
		Description: "Apply one or more exact SEARCH/REPLACE diff blocks to a remote file for the provided session_id. Use this for structured multi-block edits in a single file. Required arguments: session_id, path, remaining_file_edits, diff. The diff field must contain one or more blocks in this exact format: <<<<<<< SEARCH, :start_line:N, -------, exact search text, =======, replacement text, >>>>>>> REPLACE. Multiple blocks are allowed by concatenating them one after another.",
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
				"diff": map[string]any{
					"type": "string",
					"description": "SEARCH/REPLACE diff payload. Example block: <<<<<<< SEARCH\\n:start_line:7\\n-------\\nold text\\n=======\\nnew text\\n>>>>>>> REPLACE",
				},
			},
			"required": []string{"session_id", "path", "remaining_file_edits", "diff"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callApplyDiff(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "path", "remaining_file_edits", "diff"); err != nil {
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
	diffPayload, err := requireStringArgument(arguments, "diff")
	if err != nil {
		return nil, err
	}
	capabilities := getRemoteEditCapabilitiesWithContext(c.remoteEditExecutor, c.callCtx, session.SessionID)
	result := ApplyDiffResult{
		SessionID:    session.SessionID,
		Path:         remotePath,
		Handler:      EditHandlerFileProviderFallback,
		Capabilities: capabilities,
		Applied:      false,
		BlockResults: []ApplyDiffBlockResult{},
	}

	originalContent, err := readTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, remotePath)
	if err != nil {
		return nil, err
	}
	preview, err := BuildApplyDiffPreview(remotePath, originalContent, diffPayload)
	if err != nil {
		return nil, err
	}
	for _, block := range preview.Blocks {
		result.BlockResults = append(result.BlockResults, ApplyDiffBlockResult{
			Index:       block.Index,
			StartLine:   block.StartLine,
			Occurrences: 1,
			Applied:     true,
		})
	}
	if preview.Failure != nil {
		result.Failure = preview.Failure
		result.BlockResults = append(result.BlockResults, ApplyDiffBlockResult{
			Index:       preview.FailureBlockIndex,
			StartLine:   preview.FailureBlockStartLine,
			Occurrences: preview.Failure.Occurrences,
			Applied:     false,
			Failure:     preview.Failure,
		})
		result.BlocksApplied = len(preview.Blocks)
		return result, nil
	}

	if c.remoteEditExecutor != nil && capabilities.Python3 {
		hunks := make([]ApplyPatchHunk, 0, len(preview.Blocks))
		for _, block := range preview.Blocks {
			hunks = append(hunks, ApplyPatchHunk{
				Search:  block.MatchedSearch,
				Replace: block.Replace,
			})
		}
		remoteResult, remoteErr := applyPatchAtomicWithContext(c.remoteEditExecutor, c.callCtx, session.SessionID, []ApplyPatchFileOperation{
			{
				Action: "update",
				Path:   remotePath,
				Hunks:  hunks,
			},
		})
		if remoteErr != nil {
			return nil, remoteErr
		}
		result.Handler = remoteResult.Handler
		result.Capabilities = remoteResult.Capabilities
		result.Applied = remoteResult.Applied
		result.BlocksApplied = len(preview.Blocks)
		if remoteResult.Applied {
			result.BytesWritten = len([]byte(preview.PreviewContent))
			return result, nil
		}
		result.Failure = firstPatchFailure(remoteResult)
		return result, nil
	}

	if err := writeTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, remotePath, preview.PreviewContent); err != nil {
		return nil, err
	}
	result.BlocksApplied = len(preview.Blocks)
	result.BytesWritten = len([]byte(preview.PreviewContent))
	result.Applied = true
	return result, nil
}