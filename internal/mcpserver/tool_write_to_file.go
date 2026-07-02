package mcpserver

import "fmt"

type WriteFileResult struct {
	SessionID string `json:"session_id"`
	Path string `json:"path"`
	BytesWritten int `json:"bytes_written"`
}

func writeToFileToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "write_to_file",
		Description: "Write a complete remote file for the provided session_id. Use this when you already know the full final file content. Always send the entire file body in content. Required arguments: session_id, path, remaining_file_edits, content. Do not send partial fragments such as 'rest unchanged'. Prefer search_replace, search_and_replace, edit_file, apply_diff, or apply_patch when only part of a file needs to change.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type": "string",
					"description": "Connected SSH terminal session identifier returned by list_connected_sessions.",
				},
				"path": map[string]any{
					"type": "string",
					"description": "Remote file path to write.",
				},
				"remaining_file_edits": map[string]any{
					"type": "integer",
					"description": "Estimated remaining file edits including the current file.",
					"minimum": 1,
				},
				"content": map[string]any{
					"type": "string",
					"description": "Complete final file content. Send the whole file body, not only the changed fragment.",
				},
			},
			"required": []string{"session_id", "path", "remaining_file_edits", "content"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callWriteToFile(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "path", "remaining_file_edits", "content"); err != nil {
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
	content, err := requireStringArgumentAllowEmpty(arguments, "content")
	if err != nil {
		return nil, err
	}
	if err := writeTextFileWithContext(c.fileProvider, c.callCtx, session.SessionID, remotePath, content); err != nil {
		return nil, err
	}
	return WriteFileResult{
		SessionID: session.SessionID,
		Path: remotePath,
		BytesWritten: len([]byte(content)),
	}, nil
}