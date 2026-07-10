package mcpserver

import "fmt"

func applyDiffToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "apply_diff",
		Description: `Request to apply PRECISE, TARGETED modifications to an existing file for the provided session_id by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code.
You can perform multiple distinct search and replace operations within a single apply_diff call by providing multiple SEARCH/REPLACE blocks in the diff parameter. This is the preferred way to make several targeted changes efficiently.
The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
Raw content rule: for apply_diff and its diff parameter, do NOT XML-escape the SEARCH/REPLACE body content. Do not pre-convert < to &lt;, > to &gt;, or & to &amp; unless you literally want those entity characters matched or written. Keep the diff payload itself literal.
ALWAYS make as many changes in a single apply_diff request as possible using multiple SEARCH/REPLACE blocks

Parameters:
- session_id: (required) Connected SSH terminal session identifier returned by list_connected_sessions.
- path: (required) The remote file path to modify.
- remaining_file_edits: (required) Estimated remaining file edits including the current file. Must be an integer greater than or equal to 1.
- diff: (required) The search/replace block defining the changes.

Diff format:
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
-------
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE

Example:
Original file:
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total

Search/Replace content:
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE

Search/Replace content with multiple edits:
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
-------
        total += item
    return total
=======
        sum += item
    return sum
>>>>>>> REPLACE

The diff field must contain one or more SEARCH/REPLACE blocks concatenated one after another.
Only use a single line of ======= between search and replacement content, because multiple ======= lines will corrupt the file.`,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type":        "string",
					"description": "Connected SSH terminal session identifier returned by list_connected_sessions.",
				},
				"path": map[string]any{
					"type":        "string",
					"description": "Remote file path to modify.",
				},
				"remaining_file_edits": map[string]any{
					"type":        "integer",
					"description": "Estimated remaining file edits including the current file.",
					"minimum":     1,
				},
				"diff": map[string]any{
					"type":        "string",
					"description": "SEARCH/REPLACE diff payload. You can use multiple SEARCH/REPLACE blocks in one diff string. Example block: <<<<<<< SEARCH\n:start_line:7\n-------\nold text\n=======\nnew text\n>>>>>>> REPLACE",
				},
			},
			"required":             []string{"session_id", "path", "remaining_file_edits", "diff"},
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
	result.BlockResults = append(result.BlockResults, preview.BlockResults...)
	result.BlocksApplied = len(preview.Blocks)
	result.Failure = preview.Failure
	if !preview.CanApply {
		return result, nil
	}
	if c.remoteEditExecutor != nil && capabilities.Python3 {
		remoteResult, remoteErr := applyPatchAtomicWithContext(c.remoteEditExecutor, c.callCtx, session.SessionID, []ApplyPatchFileOperation{
			{
				Action:          "update",
				Path:            remotePath,
				Content:         preview.PreviewContent,
				ExpectedContent: preview.OriginalContent,
			},
		})
		if remoteErr != nil {
			return nil, remoteErr
		}
		result.Handler = remoteResult.Handler
		result.Capabilities = remoteResult.Capabilities
		result.Applied = remoteResult.Applied
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
	result.BytesWritten = len([]byte(preview.PreviewContent))
	result.Applied = true
	return result, nil
}