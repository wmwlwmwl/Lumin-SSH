package mcpserver

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	applyDiffBufferLines   = 40
	applyDiffFuzzyThreshold = 1.0
)

type ApplyDiffBlock struct {
	Index     int    `json:"index"`
	StartLine int    `json:"start_line,omitempty"`
	Search    string `json:"search"`
	Replace   string `json:"replace"`
}

type ApplyDiffBlockResult struct {
	Index       int               `json:"index"`
	StartLine   int               `json:"start_line,omitempty"`
	Occurrences int               `json:"occurrences"`
	Applied     bool              `json:"applied"`
	Failure     *EditMatchFailure `json:"failure,omitempty"`
}

type ApplyDiffResolvedBlock struct {
	Index            int    `json:"index"`
	StartLine        int    `json:"start_line,omitempty"`
	MatchedStartLine int    `json:"matched_start_line,omitempty"`
	Search           string `json:"search"`
	Replace          string `json:"replace"`
	MatchedSearch    string `json:"matched_search,omitempty"`
}

type ApplyDiffPreview struct {
	Path                  string                  `json:"path,omitempty"`
	CanApply              bool                    `json:"can_apply"`
	Blocks                []ApplyDiffResolvedBlock `json:"blocks"`
	Failure               *EditMatchFailure       `json:"failure,omitempty"`
	FailureBlockIndex     int                     `json:"failure_block_index,omitempty"`
	FailureBlockStartLine int                     `json:"failure_block_start_line,omitempty"`
	OriginalContent       string                  `json:"-"`
	PreviewContent        string                  `json:"-"`
	LineEnding            string                  `json:"-"`
}

type ApplyDiffResult struct {
	SessionID     string                  `json:"session_id"`
	Path          string                  `json:"path"`
	Handler       string                  `json:"handler"`
	Capabilities  RemoteEditCapabilities  `json:"capabilities"`
	BlocksApplied int                     `json:"blocks_applied"`
	BytesWritten  int                     `json:"bytes_written,omitempty"`
	Applied       bool                    `json:"applied"`
	BlockResults  []ApplyDiffBlockResult  `json:"block_results"`
	Failure       *EditMatchFailure       `json:"failure,omitempty"`
}

func isApplyDiffSearchMarker(line string) bool {
	trimmed := strings.TrimSpace(line)
	return trimmed == "<<<<<<< SEARCH" || trimmed == "<<<<<<< SEARCH>"
}

func unescapeApplyDiffLine(line string) string {
	switch {
	case strings.HasPrefix(line, `\<<<<<<< SEARCH`):
		return line[1:]
	case strings.HasPrefix(line, `\=======`):
		return line[1:]
	case strings.HasPrefix(line, `\>>>>>>> REPLACE`):
		return line[1:]
	case strings.HasPrefix(line, `\-------`):
		return line[1:]
	case strings.HasPrefix(line, `\:start_line:`):
		return line[1:]
	default:
		return line
	}
}

func validateApplyDiffMarkerSequencing(diff string) error {
	const (
		stateStart = iota
		stateAfterSearch
		stateAfterSeparator
	)
	lines := strings.Split(strings.ReplaceAll(diff, "\r\n", "\n"), "\n")
	state := stateStart
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		switch state {
		case stateStart:
			if trimmed == "=======" {
				return fmt.Errorf("invalid diff format: unexpected ======= at line %d", index+1)
			}
			if trimmed == ">>>>>>> REPLACE" {
				return fmt.Errorf("invalid diff format: unexpected >>>>>>> REPLACE at line %d", index+1)
			}
			if isApplyDiffSearchMarker(trimmed) {
				state = stateAfterSearch
				continue
			}
			if strings.HasPrefix(trimmed, "<<<<<<<") && !strings.HasPrefix(trimmed, `\<<<<<<<`) {
				return fmt.Errorf("invalid diff format: unexpected marker %s at line %d", trimmed, index+1)
			}
		case stateAfterSearch:
			if isApplyDiffSearchMarker(trimmed) {
				return fmt.Errorf("invalid diff format: nested SEARCH marker at line %d", index+1)
			}
			if trimmed == ">>>>>>> REPLACE" {
				return fmt.Errorf("invalid diff format: missing ======= before REPLACE at line %d", index+1)
			}
			if trimmed == "=======" {
				state = stateAfterSeparator
				continue
			}
			if strings.HasPrefix(trimmed, ">>>>>>>") && !strings.HasPrefix(trimmed, `\>>>>>>>`) {
				return fmt.Errorf("invalid diff format: unexpected marker %s at line %d", trimmed, index+1)
			}
		case stateAfterSeparator:
			if isApplyDiffSearchMarker(trimmed) {
				return fmt.Errorf("invalid diff format: missing >>>>>>> REPLACE before next SEARCH at line %d", index+1)
			}
			if trimmed == "=======" {
				return fmt.Errorf("invalid diff format: duplicate ======= at line %d", index+1)
			}
			if strings.HasPrefix(trimmed, ":start_line:") && !strings.HasPrefix(trimmed, `\:start_line:`) {
				return fmt.Errorf("invalid diff format: :start_line: is only allowed before ------- (line %d)", index+1)
			}
			if trimmed == ">>>>>>> REPLACE" {
				state = stateStart
				continue
			}
		}
	}
	if state == stateAfterSearch {
		return fmt.Errorf("invalid diff format: missing ======= separator")
	}
	if state == stateAfterSeparator {
		return fmt.Errorf("invalid diff format: missing >>>>>>> REPLACE terminator")
	}
	return nil
}

func splitApplyDiffContentLines(value string) []string {
	if value == "" {
		return []string{}
	}
	return strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
}

func joinApplyDiffLines(lines []string) string {
	return strings.Join(lines, "\n")
}

func matchApplyDiffChunkAt(lines []string, start int, searchLines []string) bool {
	if start < 0 || len(searchLines) == 0 || start+len(searchLines) > len(lines) {
		return false
	}
	for index := range searchLines {
		if lines[start+index] != searchLines[index] {
			return false
		}
	}
	return true
}

func findApplyDiffChunkInRange(lines []string, searchLines []string, start int, end int) int {
	if len(searchLines) == 0 || len(lines) == 0 {
		return -1
	}
	if start < 0 {
		start = 0
	}
	maxStart := len(lines) - len(searchLines)
	if maxStart < 0 {
		return -1
	}
	if end > maxStart+1 {
		end = maxStart + 1
	}
	for index := start; index < end; index++ {
		if matchApplyDiffChunkAt(lines, index, searchLines) {
			return index
		}
	}
	return -1
}

func fuzzySearchApplyDiffChunk(lines []string, searchLines []string, start int, end int) (int, float64, string) {
	if len(searchLines) == 0 || len(lines) == 0 {
		return -1, 0, ""
	}
	if start < 0 {
		start = 0
	}
	maxStart := len(lines) - len(searchLines)
	if maxStart < 0 {
		return -1, 0, ""
	}
	if end > maxStart+1 {
		end = maxStart + 1
	}
	midpoint := (start + end) / 2
	leftIndex := midpoint
	rightIndex := midpoint + 1
	searchChunk := joinApplyDiffLines(searchLines)
	bestIndex := -1
	bestScore := 0.0
	bestContent := ""
	for leftIndex >= start || rightIndex < end {
		if leftIndex >= start {
			content := joinApplyDiffLines(lines[leftIndex : leftIndex+len(searchLines)])
			score := calculateSimilarity(content, searchChunk)
			if score > bestScore {
				bestScore = score
				bestIndex = leftIndex
				bestContent = content
			}
			leftIndex--
		}
		if rightIndex < end {
			content := joinApplyDiffLines(lines[rightIndex : rightIndex+len(searchLines)])
			score := calculateSimilarity(content, searchChunk)
			if score > bestScore {
				bestScore = score
				bestIndex = rightIndex
				bestContent = content
			}
			rightIndex++
		}
	}
	return bestIndex, bestScore, bestContent
}

func parseApplyDiffBlocks(diff string) ([]ApplyDiffBlock, error) {
	normalized := strings.ReplaceAll(diff, "\r\n", "\n")
	if err := validateApplyDiffMarkerSequencing(normalized); err != nil {
		return nil, err
	}
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
		if !isApplyDiffSearchMarker(lines[index]) {
			return nil, fmt.Errorf("invalid diff format: expected <<<<<<< SEARCH at line %d", index+1)
		}
		index++
		if index >= len(lines) || !strings.HasPrefix(strings.TrimSpace(lines[index]), ":start_line:") {
			return nil, fmt.Errorf("invalid diff format: expected :start_line: after SEARCH block")
		}
		startLine, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[index]), ":start_line:")))
		if err != nil || startLine < 1 {
			return nil, fmt.Errorf("invalid diff format: invalid start_line value")
		}
		index++
		if index >= len(lines) || strings.TrimSpace(lines[index]) != "-------" {
			return nil, fmt.Errorf("invalid diff format: expected ------- after start_line")
		}
		index++
		searchLines := make([]string, 0)
		for index < len(lines) && strings.TrimSpace(lines[index]) != "=======" {
			searchLines = append(searchLines, unescapeApplyDiffLine(lines[index]))
			index++
		}
		if index >= len(lines) || strings.TrimSpace(lines[index]) != "=======" {
			return nil, fmt.Errorf("invalid diff format: missing ======= separator")
		}
		index++
		replaceLines := make([]string, 0)
		for index < len(lines) && strings.TrimSpace(lines[index]) != ">>>>>>> REPLACE" {
			replaceLines = append(replaceLines, unescapeApplyDiffLine(lines[index]))
			index++
		}
		if index >= len(lines) || strings.TrimSpace(lines[index]) != ">>>>>>> REPLACE" {
			return nil, fmt.Errorf("invalid diff format: missing >>>>>>> REPLACE terminator")
		}
		index++
		blocks = append(blocks, ApplyDiffBlock{
			Index:     len(blocks),
			StartLine: startLine,
			Search:    joinApplyDiffLines(searchLines),
			Replace:   joinApplyDiffLines(replaceLines),
		})
	}
	if len(blocks) == 0 {
		return nil, fmt.Errorf("diff must contain at least one SEARCH/REPLACE block")
	}
	return blocks, nil
}

func BuildApplyDiffPreview(path string, originalContent string, diff string) (ApplyDiffPreview, error) {
	blocks, err := parseApplyDiffBlocks(diff)
	if err != nil {
		return ApplyDiffPreview{}, err
	}
	lineEnding := "\n"
	if strings.Contains(originalContent, "\r\n") {
		lineEnding = "\r\n"
	}
	currentLines := splitFileLines(originalContent)
	currentContent := strings.ReplaceAll(originalContent, "\r\n", "\n")
	preview := ApplyDiffPreview{
		Path:            strings.TrimSpace(path),
		CanApply:        false,
		Blocks:          make([]ApplyDiffResolvedBlock, 0, len(blocks)),
		OriginalContent: originalContent,
		PreviewContent:  originalContent,
		LineEnding:      lineEnding,
	}
	for _, block := range blocks {
		searchLines := splitApplyDiffContentLines(block.Search)
		if len(searchLines) == 0 {
			preview.Failure = &EditMatchFailure{Reason: "search block must not be empty"}
			preview.FailureBlockIndex = block.Index
			preview.FailureBlockStartLine = block.StartLine
			return preview, nil
		}

		matchIndex := -1
		bestScore := 0.0
		bestMatchContent := ""
		searchChunk := joinApplyDiffLines(searchLines)

		if block.StartLine > 0 {
			exactStart := block.StartLine - 1
			if matchApplyDiffChunkAt(currentLines, exactStart, searchLines) {
				matchIndex = exactStart
				bestScore = 1
				bestMatchContent = searchChunk
			} else {
				rangeStart := block.StartLine - (applyDiffBufferLines + 1)
				rangeEnd := block.StartLine + len(searchLines) + applyDiffBufferLines
				matchIndex = findApplyDiffChunkInRange(currentLines, searchLines, rangeStart, rangeEnd)
				if matchIndex >= 0 {
					bestScore = 1
					bestMatchContent = joinApplyDiffLines(currentLines[matchIndex : matchIndex+len(searchLines)])
				} else {
					fuzzyIndex, fuzzyScore, fuzzyContent := fuzzySearchApplyDiffChunk(currentLines, searchLines, rangeStart, rangeEnd)
					if fuzzyIndex >= 0 {
						matchIndex = fuzzyIndex
						bestScore = fuzzyScore
						bestMatchContent = fuzzyContent
					}
				}
			}
		}
		if matchIndex < 0 {
			occurrences := countOccurrences(currentContent, block.Search)
			if occurrences == 1 {
				matchIndex = findApplyDiffChunkInRange(currentLines, searchLines, 0, len(currentLines))
				if matchIndex >= 0 {
					bestScore = 1
					bestMatchContent = joinApplyDiffLines(currentLines[matchIndex : matchIndex+len(searchLines)])
				}
			} else {
				failure := &EditMatchFailure{Occurrences: occurrences}
				if occurrences == 0 {
					bestMatch := extractBestMatchSnippet(currentContent, block.Search)
					failure.Reason = "search block not found exactly"
					failure.BestMatch = bestMatch
					failure.Similarity = calculateSimilarity(bestMatch, block.Search)
					failure.RequiredSimilarity = applyDiffFuzzyThreshold
				} else {
					failure.Reason = "search block matched multiple locations"
				}
				preview.Failure = failure
				preview.FailureBlockIndex = block.Index
				preview.FailureBlockStartLine = block.StartLine
				return preview, nil
			}
		}
		if matchIndex < 0 || bestScore < applyDiffFuzzyThreshold {
			bestMatch := bestMatchContent
			if bestMatch == "" {
				bestMatch = extractBestMatchSnippet(currentContent, block.Search)
			}
			preview.Failure = &EditMatchFailure{
				Reason:             "search block not found exactly",
				BestMatch:          bestMatch,
				Similarity:         calculateSimilarity(bestMatch, block.Search),
				RequiredSimilarity: applyDiffFuzzyThreshold,
			}
			preview.FailureBlockIndex = block.Index
			preview.FailureBlockStartLine = block.StartLine
			return preview, nil
		}

		matchedSearch := joinApplyDiffLines(currentLines[matchIndex : matchIndex+len(searchLines)])
		preview.Blocks = append(preview.Blocks, ApplyDiffResolvedBlock{
			Index:            block.Index,
			StartLine:        block.StartLine,
			MatchedStartLine: matchIndex + 1,
			Search:           block.Search,
			Replace:          block.Replace,
			MatchedSearch:    matchedSearch,
		})

		replaceLines := splitApplyDiffContentLines(block.Replace)
		nextLines := make([]string, 0, len(currentLines)-len(searchLines)+len(replaceLines))
		nextLines = append(nextLines, currentLines[:matchIndex]...)
		nextLines = append(nextLines, replaceLines...)
		nextLines = append(nextLines, currentLines[matchIndex+len(searchLines):]...)
		currentLines = nextLines
		currentContent = joinApplyDiffLines(currentLines)
	}
	preview.CanApply = true
	preview.PreviewContent = strings.Join(currentLines, lineEnding)
	return preview, nil
}