package mcpserver

import "fmt"

func searchAndReplaceToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "search_and_replace",
		Description: "Apply multiple exact search/replace operations to a remote file for the provided session_id. Use this when you need several precise replacements in one file. Each operation is applied in order to the latest in-memory content and each search must match exactly one location at execution time. Required arguments: session_id, path, remaining_file_edits, operations. Each operations item must be an object with search and replace fields.",
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
				"operations": map[string]any{
					"type": "array",
					"description": "Ordered search/replace operations. Each operation is applied to the latest in-memory content. Example: [{\"search\":\"old1\",\"replace\":\"new1\"},{\"search\":\"old2\",\"replace\":\"new2\"}].",
					"minItems": 1,
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"search": map[string]any{
								"type": "string",
								"description": "Exact text block to search for. It must uniquely match one location when that step executes.",
							},
							"replace": map[string]any{
								"type": "string",
								"description": "Replacement text block for that step.",
							},
						},
						"required": []string{"search", "replace"},
						"additionalProperties": false,
					},
				},
			},
			"required": []string{"session_id", "path", "remaining_file_edits", "operations"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callSearchAndReplace(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "path", "remaining_file_edits", "operations"); err != nil {
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
	operations, err := requireSearchReplaceOperations(arguments, "operations")
	if err != nil {
		return nil, err
	}
	capabilities := getRemoteEditCapabilities(c.remoteEditExecutor, session.SessionID)
	result := SearchAndReplaceResult{
		SessionID: session.SessionID,
		Path: remotePath,
		Handler: EditHandlerFileProviderFallback,
		Capabilities: capabilities,
		Applied: false,
		OperationResults: make([]SearchReplaceOperationResult, 0, len(operations)),
	}
	for index, operation := range operations {
		if operation.Search == "" {
			operationResult := SearchReplaceOperationResult{
				Index: index,
				Failure: &EditMatchFailure{Reason: "search must not be empty"},
			}
			result.OperationResults = append(result.OperationResults, operationResult)
			result.Failure = operationResult.Failure
			return result, nil
		}
	}
	if c.remoteEditExecutor != nil && capabilities.Python3 {
		hunks := make([]ApplyPatchHunk, 0, len(operations))
		for _, operation := range operations {
			hunks = append(hunks, ApplyPatchHunk{
				Search: operation.Search,
				Replace: operation.Replace,
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
			for index := range operations {
				result.OperationResults = append(result.OperationResults, SearchReplaceOperationResult{
					Index: index,
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
	for index, operation := range operations {
		occurrences := countOccurrences(nextContent, operation.Search)
		operationResult := SearchReplaceOperationResult{
			Index: index,
			Occurrences: occurrences,
		}
		if operation.Search == "" {
			operationResult.Failure = &EditMatchFailure{Reason: "search must not be empty"}
			result.OperationResults = append(result.OperationResults, operationResult)
			result.Failure = operationResult.Failure
			return result, nil
		}
		if occurrences != 1 {
			failure := &EditMatchFailure{
				Occurrences: occurrences,
			}
			if occurrences == 0 {
				failure.Reason = "search not found exactly"
				failure.BestMatch = extractBestMatchSnippet(nextContent, operation.Search)
			} else {
				failure.Reason = "search matched multiple locations"
			}
			operationResult.Failure = failure
			result.OperationResults = append(result.OperationResults, operationResult)
			result.Failure = failure
			return result, nil
		}
		updatedContent, _ := replaceExactlyOnce(nextContent, operation.Search, operation.Replace)
		nextContent = updatedContent
		operationResult.Applied = true
		result.OperationResults = append(result.OperationResults, operationResult)
	}
	if err := c.fileProvider.WriteTextFile(session.SessionID, remotePath, nextContent); err != nil {
		return nil, err
	}
	result.Applied = true
	result.BytesWritten = len([]byte(nextContent))
	return result, nil
}