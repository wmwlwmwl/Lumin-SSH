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
	blocks, err := parseApplyDiffBlocks(diffPayload)
	if err != nil {
		return nil, err
	}
	capabilities := getRemoteEditCapabilities(c.remoteEditExecutor, session.SessionID)
	result := ApplyDiffResult{
		SessionID: session.SessionID,
		Path: remotePath,
		Handler: EditHandlerFileProviderFallback,
		Capabilities: capabilities,
		Applied: false,
		BlockResults: make([]ApplyDiffBlockResult, 0, len(blocks)),
	}
	for _, block := range blocks {
		if block.Search == "" {
			blockResult := ApplyDiffBlockResult{
				Index: block.Index,
				StartLine: block.StartLine,
				Failure: &EditMatchFailure{Reason: "search block must not be empty"},
			}
			result.BlockResults = append(result.BlockResults, blockResult)
			result.Failure = blockResult.Failure
			return result, nil
		}
	}
	if c.remoteEditExecutor != nil && capabilities.Python3 {
		hunks := make([]ApplyPatchHunk, 0, len(blocks))
		for _, block := range blocks {
			hunks = append(hunks, ApplyPatchHunk{
				Search: block.Search,
				Replace: block.Replace,
			})
		}
		remoteResult, remoteErr := c.remoteEditExecutor.ApplyPatchAtomic(session.SessionID, []ApplyPatchFileOperation{
			{
				Action: "update",
				Path: remotePath,
				Hunks: hunks,
			},
		})
		if remoteErr != nil {
			return nil, remoteErr
		}
		result.Handler = remoteResult.Handler
		result.Capabilities = remoteResult.Capabilities
		result.Applied = remoteResult.Applied
		if remoteResult.Applied {
			result.BlocksApplied = len(blocks)
			for _, block := range blocks {
				result.BlockResults = append(result.BlockResults, ApplyDiffBlockResult{
					Index: block.Index,
					StartLine: block.StartLine,
					Occurrences: 1,
					Applied: true,
				})
			}
			return result, nil
		}
		result.Failure = firstPatchFailure(remoteResult)
		return result, nil
	}
	content, err := c.fileProvider.ReadTextFile(session.SessionID, remotePath)
	if err != nil {
		return nil, err
	}
	nextContent := content
	for _, block := range blocks {
		occurrences := countOccurrences(nextContent, block.Search)
		blockResult := ApplyDiffBlockResult{
			Index: block.Index,
			StartLine: block.StartLine,
			Occurrences: occurrences,
		}
		if block.Search == "" {
			blockResult.Failure = &EditMatchFailure{Reason: "search block must not be empty"}
			result.BlockResults = append(result.BlockResults, blockResult)
			result.Failure = blockResult.Failure
			return result, nil
		}
		if occurrences != 1 {
			failure := &EditMatchFailure{
				Occurrences: occurrences,
			}
			if occurrences == 0 {
				failure.Reason = "search block not found exactly"
				failure.BestMatch = extractBestMatchSnippet(nextContent, block.Search)
			} else {
				failure.Reason = "search block matched multiple locations"
			}
			blockResult.Failure = failure
			result.BlockResults = append(result.BlockResults, blockResult)
			result.Failure = failure
			return result, nil
		}
		updatedContent, _ := replaceExactlyOnce(nextContent, block.Search, block.Replace)
		nextContent = updatedContent
		blockResult.Applied = true
		result.BlockResults = append(result.BlockResults, blockResult)
		result.BlocksApplied++
	}
	if err := c.fileProvider.WriteTextFile(session.SessionID, remotePath, nextContent); err != nil {
		return nil, err
	}
	result.Applied = true
	result.BytesWritten = len([]byte(nextContent))
	return result, nil
}