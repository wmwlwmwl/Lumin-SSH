package mcpserver

import (
	"fmt"
	"strconv"
	"strings"
)

type ApplyDiffBlock struct {
	Index int `json:"index"`
	StartLine int `json:"start_line,omitempty"`
	Search string `json:"search"`
	Replace string `json:"replace"`
}

type ApplyDiffBlockResult struct {
	Index int `json:"index"`
	StartLine int `json:"start_line,omitempty"`
	Occurrences int `json:"occurrences"`
	Applied bool `json:"applied"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}

type ApplyDiffResult struct {
	SessionID string `json:"session_id"`
	Path string `json:"path"`
	Handler string `json:"handler"`
	Capabilities RemoteEditCapabilities `json:"capabilities"`
	BlocksApplied int `json:"blocks_applied"`
	BytesWritten int `json:"bytes_written,omitempty"`
	Applied bool `json:"applied"`
	BlockResults []ApplyDiffBlockResult `json:"block_results"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}

func parseApplyDiffBlocks(diff string) ([]ApplyDiffBlock, error) {
	normalized := strings.ReplaceAll(diff, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	blocks := make([]ApplyDiffBlock, 0)
	index := 0
	for index < len(lines) {
		for index < len(lines) && strings.TrimSpace(lines[index]) == "" {
			index++
		}
		if index >= len(lines) {
			break
		}
		if lines[index] != "<<<<<<< SEARCH" {
			return nil, fmt.Errorf("invalid diff format: expected <<<<<<< SEARCH at line %d", index+1)
		}
		index++
		if index >= len(lines) || !strings.HasPrefix(lines[index], ":start_line:") {
			return nil, fmt.Errorf("invalid diff format: expected :start_line: after SEARCH block")
		}
		startLine, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(lines[index], ":start_line:")))
		if err != nil || startLine < 1 {
			return nil, fmt.Errorf("invalid diff format: invalid start_line value")
		}
		index++
		if index >= len(lines) || lines[index] != "-------" {
			return nil, fmt.Errorf("invalid diff format: expected ------- after start_line")
		}
		index++
		searchLines := make([]string, 0)
		for index < len(lines) && lines[index] != "=======" {
			searchLines = append(searchLines, lines[index])
			index++
		}
		if index >= len(lines) || lines[index] != "=======" {
			return nil, fmt.Errorf("invalid diff format: missing ======= separator")
		}
		index++
		replaceLines := make([]string, 0)
		for index < len(lines) && lines[index] != ">>>>>>> REPLACE" {
			replaceLines = append(replaceLines, lines[index])
			index++
		}
		if index >= len(lines) || lines[index] != ">>>>>>> REPLACE" {
			return nil, fmt.Errorf("invalid diff format: missing >>>>>>> REPLACE terminator")
		}
		index++
		blocks = append(blocks, ApplyDiffBlock{
			Index: len(blocks),
			StartLine: startLine,
			Search: strings.Join(searchLines, "\n"),
			Replace: strings.Join(replaceLines, "\n"),
		})
	}
	if len(blocks) == 0 {
		return nil, fmt.Errorf("diff must contain at least one SEARCH/REPLACE block")
	}
	return blocks, nil
}