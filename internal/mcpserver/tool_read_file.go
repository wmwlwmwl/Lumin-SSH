package mcpserver

import (
	"fmt"
	"strings"
)

type ReadFileResult struct {
	SessionID string `json:"session_id"`
	Path string `json:"path"`
	StartLine int `json:"start_line,omitempty"`
	EndLine int `json:"end_line,omitempty"`
	TotalLines int `json:"total_lines"`
	Content string `json:"content"`
	NumberedContent string `json:"numbered_content"`
}

type ReadFileBatchResult struct {
	SessionID string `json:"session_id"`
	Files []ReadFileResult `json:"files"`
}

func readFileToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "read_file",
		Description: `Read one or more remote files from a connected SSH session. Supports task-scoped args XML, files array, and optional 1-based line ranges.
Prefer reading related files together in a single request when you need to understand an area. For an initial read of relevant files, prefer whole-file reads instead of using line ranges.
Use start_line and end_line only when you already know the target area and want a narrower follow-up read. If you use line ranges, provide both start_line and end_line together for each file.

Preferred example:
<read_file>
<session_id>session_id from list_connected_sessions</session_id>
<args>
<file>
<path>/remote/path/to/file_a</path>
</file>
<file>
<path>/remote/path/to/file_b</path>
</file>
</args>
</read_file>

Less preferred example: use only for a focused follow-up read after you already know the relevant areas.
<read_file>
<session_id>session_id from list_connected_sessions</session_id>
<args>
<file>
<path>/remote/path/to/file_a</path>
<start_line>120</start_line>
<end_line>180</end_line>
</file>
<file>
<path>/remote/path/to/file_b</path>
<start_line>20</start_line>
<end_line>60</end_line>
</file>
</args>
</read_file>`,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type": "string",
					"description": "Connected SSH terminal session identifier returned by list_connected_sessions.",
				},
				"args": map[string]any{
					"type": "string",
					"description": "Optional task-scoped XML file list payload.",
				},
				"files": map[string]any{
					"type": "array",
					"description": "Optional JSON file list. Each item may include path, start_line, and end_line.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"path": map[string]any{
								"type": "string",
								"description": "Remote file path to read.",
							},
							"start_line": map[string]any{
								"type": "integer",
								"description": "Optional 1-based inclusive start line.",
								"minimum": 1,
							},
							"end_line": map[string]any{
								"type": "integer",
								"description": "Optional 1-based inclusive end line.",
								"minimum": 1,
							},
						},
						"required": []string{"path"},
						"additionalProperties": false,
					},
				},
				"path": map[string]any{
					"type": "string",
					"description": "Remote file path to read.",
				},
				"start_line": map[string]any{
					"type": "integer",
					"description": "Optional 1-based inclusive start line for single-file mode.",
					"minimum": 1,
				},
				"end_line": map[string]any{
					"type": "integer",
					"description": "Optional 1-based inclusive end line for single-file mode.",
					"minimum": 1,
				},
			},
			"required": []string{"session_id"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callReadFile(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if c.fileProvider == nil {
		return nil, fmt.Errorf("file provider unavailable")
	}
	if err := validateAllowedArguments(arguments, "session_id", "args", "files", "path", "start_line", "end_line"); err != nil {
		return nil, err
	}
	session, err := requireSessionArgument(c.service, arguments)
	if err != nil {
		return nil, err
	}
	if !session.SFTPAvailable {
		return nil, fmt.Errorf("session does not have sftp available")
	}
	requests, err := parseReadFileRequests(arguments)
	if err != nil {
		return nil, err
	}
	results := make([]ReadFileResult, 0, len(requests))
	for _, request := range requests {
		result, err := c.buildReadFileResult(session.SessionID, request)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if len(results) == 1 {
		return results[0], nil
	}
	return ReadFileBatchResult{
		SessionID: session.SessionID,
		Files: results,
	}, nil
}

func (c *Catalog) buildReadFileResult(sessionID string, request ReadFileRequest) (ReadFileResult, error) {
	content, err := readTextFileWithContext(c.fileProvider, c.callCtx, sessionID, request.Path)
	if err != nil {
		return ReadFileResult{}, err
	}
	lines := splitFileLines(content)
	totalLines := len(lines)
	selectedLines := lines
	startLine := 1
	endLine := totalLines
	if request.HasLineRange {
		startLine = request.StartLine
		endLine = request.EndLine
		if startLine > totalLines && totalLines > 0 {
			return ReadFileResult{}, fmt.Errorf("start_line exceeds file length")
		}
		if totalLines == 0 {
			selectedLines = []string{}
		} else {
			if endLine > totalLines {
				endLine = totalLines
			}
			selectedLines = lines[startLine-1 : endLine]
		}
	}
	numberedLines := make([]string, 0, len(selectedLines))
	lineOffset := 1
	if request.HasLineRange {
		lineOffset = startLine
	}
	for index, line := range selectedLines {
		numberedLines = append(numberedLines, fmt.Sprintf("%d | %s", lineOffset+index, line))
	}
	result := ReadFileResult{
		SessionID: sessionID,
		Path: request.Path,
		TotalLines: totalLines,
		Content: strings.Join(selectedLines, "\n"),
		NumberedContent: strings.Join(numberedLines, "\n"),
	}
	if request.HasLineRange {
		result.StartLine = startLine
		result.EndLine = endLine
	}
	return result, nil
}

func splitFileLines(content string) []string {
	if content == "" {
		return []string{}
	}
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}