package mcpserver

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	applyDiffBufferLines   = 40
	applyDiffFuzzyThreshold = 1.0
)

var (
	applyDiffSearchPattern = regexp.MustCompile(`^<<<<<<< SEARCH>?$`)
	applyDiffBlockPattern  = regexp.MustCompile(`(?ms)(?:^|\n)<<<<<<< SEARCH>?\s*\n((?:\:start_line:\s*(\d+)\s*\n)?)((?:\:end_line:\s*(\d+)\s*\n)?)((?:-------\s*\n)?)(.*?)(?:\n)?^=======\s*\n(.*?)(?:\n)?^>>>>>>> REPLACE(?:\n|$)`)
)

type ApplyDiffBlock struct {
	Index     int    `json:"index"`
	StartLine int    `json:"start_line,omitempty"`
	EndLine   int    `json:"end_line,omitempty"`
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
	Path                  string                 `json:"path,omitempty"`
	CanApply              bool                   `json:"can_apply"`
	Blocks                []ApplyDiffResolvedBlock `json:"blocks"`
	BlockResults          []ApplyDiffBlockResult `json:"block_results"`
	Failure               *EditMatchFailure      `json:"failure,omitempty"`
	FailureBlockIndex     int                    `json:"failure_block_index,omitempty"`
	FailureBlockStartLine int                    `json:"failure_block_start_line,omitempty"`
	OriginalContent       string                 `json:"-"`
	PreviewContent        string                 `json:"-"`
	LineEnding            string                 `json:"-"`
}

type ApplyDiffResult struct {
	SessionID     string                 `json:"session_id"`
	Path          string                 `json:"path"`
	Handler       string                 `json:"handler"`
	Capabilities  RemoteEditCapabilities `json:"capabilities"`
	BlocksApplied int                    `json:"blocks_applied"`
	BytesWritten  int                    `json:"bytes_written,omitempty"`
	Applied       bool                   `json:"applied"`
	BlockResults  []ApplyDiffBlockResult `json:"block_results"`
	Failure       *EditMatchFailure      `json:"failure,omitempty"`
}

func isApplyDiffSearchMarker(line string) bool {
	return applyDiffSearchPattern.MatchString(strings.TrimSpace(line))
}

func unescapeApplyDiffBlockLine(line string) string {
	switch {
	case strings.HasPrefix(line, `\<<<<<<< SEARCH`):
		return line[1:]
	case strings.HasPrefix(line, `\=======`):
		return line[1:]
	case strings.HasPrefix(line, `\>>>>>>> REPLACE`):
		return line[1:]
	case strings.HasPrefix(line, `\-------`):
		return line[1:]
	case strings.HasPrefix(line, `\:end_line:`):
		return line[1:]
	case strings.HasPrefix(line, `\:start_line:`):
		return line[1:]
	default:
		return line
	}
}

func unescapeApplyDiffMarkers(content string) string {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	for index, line := range lines {
		lines[index] = unescapeApplyDiffBlockLine(line)
	}
	return strings.Join(lines, "\n")
}

func validateApplyDiffMarkerSequencing(diffContent string) error {
	const (
		stateStart = iota
		stateAfterSearch
		stateAfterSeparator
	)
	state := struct {
		current int
		line    int
	}{
		current: stateStart,
		line:    0,
	}
	searchPatternSource := applyDiffSearchPattern.String()
	searchDisplay := strings.ReplaceAll(strings.ReplaceAll(searchPatternSource, "^", ""), "$", "")
	separator := "======="
	replaceMarker := ">>>>>>> REPLACE"
	searchPrefix := "<<<<<<<"
	replacePrefix := ">>>>>>>"
	lines := strings.Split(diffContent, "\n")
	searchCount := 0
	separatorCount := 0
	replaceCount := 0
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if isApplyDiffSearchMarker(trimmed) {
			searchCount++
		}
		if trimmed == separator {
			separatorCount++
		}
		if trimmed == replaceMarker {
			replaceCount++
		}
	}
	likelyBadStructure := searchCount != replaceCount || separatorCount < searchCount
	reportMergeConflictError := func(found string) error {
		return fmt.Errorf(
			"ERROR: Special marker '%s' found in your diff content at line %d:\n\nWhen removing merge conflict markers like '%s' from files, you MUST escape them\nin your SEARCH section by prepending a backslash (\\) at the beginning of the line:\n\nCORRECT FORMAT:\n\n<<<<<<< SEARCH\ncontent before\n\\%s    <-- Note the backslash here in this example\ncontent after\n=======\nreplacement content\n>>>>>>> REPLACE\n\nWithout escaping, the system confuses your content with diff syntax markers.\nYou may use multiple diff blocks in a single diff request, but ANY of ONLY the following separators that occur within SEARCH or REPLACE content must be escaped, as follows:\n\\%s\n\\%s\n\\%s\n",
			found,
			state.line,
			found,
			found,
			searchDisplay,
			separator,
			replaceMarker,
		)
	}
	reportInvalidDiffError := func(found string, expected string) error {
		return fmt.Errorf(
			"ERROR: Diff block is malformed: marker '%s' found in your diff content at line %d. Expected: %s\n\nCORRECT FORMAT:\n\n<<<<<<< SEARCH\n:start_line: (required) The line number of original content where the search block starts.\n-------\n[exact content to find including whitespace]\n=======\n[new content to replace with]\n>>>>>>> REPLACE\n",
			found,
			state.line,
			expected,
		)
	}
	reportLineMarkerInReplaceError := func(marker string) error {
		return fmt.Errorf(
			"ERROR: Invalid line marker '%s' found in REPLACE section at line %d\n\nLine markers (:start_line: and :end_line:) are only allowed in SEARCH sections.\n\nCORRECT FORMAT:\n<<<<<<< SEARCH\n:start_line:5\ncontent to find\n=======\nreplacement content\n>>>>>>> REPLACE\n\nINCORRECT FORMAT:\n<<<<<<< SEARCH\ncontent to find\n=======\n:start_line:5    <-- Invalid location\nreplacement content\n>>>>>>> REPLACE\n",
			marker,
			state.line,
		)
	}
	for _, line := range lines {
		state.line++
		marker := strings.TrimSpace(line)
		if state.current == stateAfterSeparator {
			if strings.HasPrefix(marker, ":start_line:") && !strings.HasPrefix(strings.TrimSpace(line), `\:start_line:`) {
				return reportLineMarkerInReplaceError(":start_line:")
			}
			if strings.HasPrefix(marker, ":end_line:") && !strings.HasPrefix(strings.TrimSpace(line), `\:end_line:`) {
				return reportLineMarkerInReplaceError(":end_line:")
			}
		}
		switch state.current {
		case stateStart:
			if marker == separator {
				if likelyBadStructure {
					return reportInvalidDiffError(separator, searchDisplay)
				}
				return reportMergeConflictError(separator)
			}
			if marker == replaceMarker {
				return reportInvalidDiffError(replaceMarker, searchDisplay)
			}
			if strings.HasPrefix(marker, replacePrefix) {
				return reportMergeConflictError(marker)
			}
			if isApplyDiffSearchMarker(marker) {
				state.current = stateAfterSearch
			} else if strings.HasPrefix(marker, searchPrefix) {
				return reportMergeConflictError(marker)
			}
		case stateAfterSearch:
			if isApplyDiffSearchMarker(marker) {
				return reportInvalidDiffError(searchPatternSource, separator)
			}
			if strings.HasPrefix(marker, searchPrefix) {
				return reportMergeConflictError(marker)
			}
			if marker == replaceMarker {
				return reportInvalidDiffError(replaceMarker, separator)
			}
			if strings.HasPrefix(marker, replacePrefix) {
				return reportMergeConflictError(marker)
			}
			if marker == separator {
				state.current = stateAfterSeparator
			}
		case stateAfterSeparator:
			if isApplyDiffSearchMarker(marker) {
				return reportInvalidDiffError(searchPatternSource, replaceMarker)
			}
			if strings.HasPrefix(marker, searchPrefix) {
				return reportMergeConflictError(marker)
			}
			if marker == separator {
				if likelyBadStructure {
					return reportInvalidDiffError(separator, replaceMarker)
				}
				return reportMergeConflictError(separator)
			}
			if marker == replaceMarker {
				state.current = stateStart
			} else if strings.HasPrefix(marker, replacePrefix) {
				return reportMergeConflictError(marker)
			}
		}
	}
	if state.current == stateStart {
		return nil
	}
	if state.current == stateAfterSearch {
		return fmt.Errorf("ERROR: Unexpected end of sequence: Expected '=======' was not found.")
	}
	return fmt.Errorf("ERROR: Unexpected end of sequence: Expected '>>>>>>> REPLACE' was not found.")
}

func splitApplyDiffFileLines(content string) []string {
	return strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
}

func splitApplyDiffContentLines(value string) []string {
	if value == "" {
		return []string{}
	}
	return strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
}

func addLineNumbers(content string, startLine int) string {
	if content == "" {
		if startLine == 1 {
			return ""
		}
		return fmt.Sprintf("%d | \n", startLine)
	}
	lines := strings.Split(content, "\n")
	lastLineEmpty := lines[len(lines)-1] == ""
	if lastLineEmpty {
		lines = lines[:len(lines)-1]
	}
	maxLineNumberWidth := len(strconv.Itoa(startLine + len(lines) - 1))
	numberedContent := make([]string, 0, len(lines))
	for index, line := range lines {
		lineNumber := strconv.Itoa(startLine + index)
		if len(lineNumber) < maxLineNumberWidth {
			lineNumber = strings.Repeat(" ", maxLineNumberWidth-len(lineNumber)) + lineNumber
		}
		numberedContent = append(numberedContent, fmt.Sprintf("%s | %s", lineNumber, line))
	}
	return strings.Join(numberedContent, "\n") + "\n"
}

func everyLineHasLineNumbers(content string) bool {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	return len(lines) > 0 && everyApplyDiffLineHasLineNumbers(lines)
}

func everyApplyDiffLineHasLineNumbers(lines []string) bool {
	for _, line := range lines {
		index := 0
		for index < len(line) && (line[index] == ' ' || line[index] == '\t') {
			index++
		}
		digitStart := index
		for index < len(line) && line[index] >= '0' && line[index] <= '9' {
			index++
		}
		if index == digitStart {
			return false
		}
		spaceStart := index
		for index < len(line) && (line[index] == ' ' || line[index] == '\t') {
			index++
		}
		if index == spaceStart {
			return false
		}
		if index >= len(line) || line[index] != '|' {
			return false
		}
		if index+1 < len(line) && line[index+1] == '|' {
			return false
		}
	}
	return true
}

func stripLineNumbers(content string, aggressive bool) string {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	processedLines := make([]string, 0, len(lines))
	for _, line := range lines {
		if aggressive {
			if stripped, ok := stripAggressiveApplyDiffLineNumber(line); ok {
				processedLines = append(processedLines, stripped)
				continue
			}
		} else {
			if stripped, ok := stripStandardApplyDiffLineNumber(line); ok {
				processedLines = append(processedLines, stripped)
				continue
			}
		}
		processedLines = append(processedLines, line)
	}
	lineEnding := "\n"
	if strings.Contains(content, "\r\n") {
		lineEnding = "\r\n"
	}
	result := strings.Join(processedLines, lineEnding)
	if strings.HasSuffix(content, lineEnding) && !strings.HasSuffix(result, lineEnding) {
		result += lineEnding
	}
	return result
}

func stripStandardApplyDiffLineNumber(line string) (string, bool) {
	index := 0
	for index < len(line) && (line[index] == ' ' || line[index] == '\t') {
		index++
	}
	digitStart := index
	for index < len(line) && line[index] >= '0' && line[index] <= '9' {
		index++
	}
	if index == digitStart {
		return "", false
	}
	spaceStart := index
	for index < len(line) && (line[index] == ' ' || line[index] == '\t') {
		index++
	}
	if index == spaceStart {
		return "", false
	}
	if index >= len(line) || line[index] != '|' {
		return "", false
	}
	if index+1 < len(line) && line[index+1] == '|' {
		return "", false
	}
	index++
	if index < len(line) && line[index] == ' ' {
		index++
	}
	return line[index:], true
}

func stripAggressiveApplyDiffLineNumber(line string) (string, bool) {
	index := 0
	for index < len(line) && (line[index] == ' ' || line[index] == '\t') {
		index++
	}
	digitStart := index
	for index < len(line) && line[index] >= '0' && line[index] <= '9' {
		index++
	}
	if index > digitStart {
		if index >= len(line) || line[index] != ' ' {
			index = digitStart
		} else {
			index++
		}
	}
	if index >= len(line) || line[index] != '|' {
		return "", false
	}
	index++
	if index >= len(line) || line[index] != ' ' {
		return "", false
	}
	index++
	return line[index:], true
}

func extractLeadingLineNumber(content string) int {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	if len(lines) == 0 {
		return 0
	}
	parts := strings.Split(lines[0], "|")
	if len(parts) == 0 {
		return 0
	}
	number, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || number < 1 {
		return 0
	}
	return number
}

func leadingWhitespace(value string) string {
	for index, r := range value {
		if r != ' ' && r != '\t' {
			return value[:index]
		}
	}
	return value
}

func safeJoinApplyDiffSlice(lines []string, start int, end int) string {
	if start < 0 {
		start = 0
	}
	if start > len(lines) {
		start = len(lines)
	}
	if end < start {
		end = start
	}
	if end > len(lines) {
		end = len(lines)
	}
	return strings.Join(lines[start:end], "\n")
}

func fuzzySearchApplyDiffChunk(lines []string, searchChunk string, startIndex int, endIndex int) (int, float64, string) {
	bestScore := 0.0
	bestMatchIndex := -1
	bestMatchContent := ""
	searchLen := len(strings.Split(strings.ReplaceAll(searchChunk, "\r\n", "\n"), "\n"))
	midPoint := (startIndex + endIndex) / 2
	leftIndex := midPoint
	rightIndex := midPoint + 1
	for leftIndex >= startIndex || rightIndex <= endIndex-searchLen {
		if leftIndex >= startIndex {
			originalChunk := safeJoinApplyDiffSlice(lines, leftIndex, leftIndex+searchLen)
			similarity := calculateSimilarity(originalChunk, searchChunk)
			if similarity > bestScore {
				bestScore = similarity
				bestMatchIndex = leftIndex
				bestMatchContent = originalChunk
			}
			leftIndex--
		}
		if rightIndex <= endIndex-searchLen {
			originalChunk := safeJoinApplyDiffSlice(lines, rightIndex, rightIndex+searchLen)
			similarity := calculateSimilarity(originalChunk, searchChunk)
			if similarity > bestScore {
				bestScore = similarity
				bestMatchIndex = rightIndex
				bestMatchContent = originalChunk
			}
			rightIndex++
		}
	}
	return bestMatchIndex, bestScore, bestMatchContent
}

func parseApplyDiffBlocks(diff string) ([]ApplyDiffBlock, error) {
	normalized := strings.ReplaceAll(diff, "\r\n", "\n")
	if err := validateApplyDiffMarkerSequencing(normalized); err != nil {
		return nil, err
	}
	matches := applyDiffBlockPattern.FindAllStringSubmatch(normalized, -1)
	if len(matches) == 0 {
		return nil, fmt.Errorf("Invalid diff format - missing required sections\n\nDebug Info:\n- Expected Format: <<<<<<< SEARCH\\n:start_line: start line\\n-------\\n[search content]\\n=======\\n[replace content]\\n>>>>>>> REPLACE\n- Tip: Make sure to include start_line/SEARCH/=======/REPLACE sections with correct markers on new lines")
	}
	blocks := make([]ApplyDiffBlock, 0, len(matches))
	for index, match := range matches {
		startLine := 0
		if strings.TrimSpace(match[2]) != "" {
			parsed, err := strconv.Atoi(strings.TrimSpace(match[2]))
			if err == nil {
				startLine = parsed
			}
		}
		endLine := 0
		if strings.TrimSpace(match[4]) != "" {
			parsed, err := strconv.Atoi(strings.TrimSpace(match[4]))
			if err == nil {
				endLine = parsed
			}
		}
		blocks = append(blocks, ApplyDiffBlock{
			Index:     index,
			StartLine: startLine,
			EndLine:   endLine,
			Search:    match[6],
			Replace:   match[7],
		})
	}
	sort.SliceStable(blocks, func(i int, j int) bool {
		return blocks[i].StartLine < blocks[j].StartLine
	})
	return blocks, nil
}

func buildApplyDiffNoMatchFailure(resultLines []string, startLine int, endLine int, bestMatchContent string, matchIndex int, bestMatchScore float64, searchChunk string) *EditMatchFailure {
	originalContentSection := "\n\nOriginal Content:\n" + addLineNumbers(
		safeJoinApplyDiffSlice(
			resultLines,
			maxInt(0, startLine-1-applyDiffBufferLines),
			minInt(len(resultLines), endLine+applyDiffBufferLines),
		),
		maxInt(1, startLine-applyDiffBufferLines),
	)
	bestMatchSection := "\n\nBest Match Found:\n(no match)"
	if bestMatchContent != "" {
		bestMatchSection = "\n\nBest Match Found:\n" + addLineNumbers(bestMatchContent, matchIndex+1)
	}
	lineRange := ""
	if startLine > 0 {
		lineRange = fmt.Sprintf(" at line: %d", startLine)
	}
	return &EditMatchFailure{
		Reason: fmt.Sprintf(
			"No sufficiently similar match found%s (%d%% similar, needs %d%%)\n\nDebug Info:\n- Similarity Score: %d%%\n- Required Threshold: %d%%\n- Search Range: %s\n- Tried both standard and aggressive line number stripping\n- Tip: Use the read_file tool to get the latest content of the file before attempting to use the apply_diff tool again, as the file content may have changed\n\nSearch Content:\n%s%s%s",
			lineRange,
			int(bestMatchScore*100),
			int(applyDiffFuzzyThreshold*100),
			int(bestMatchScore*100),
			int(applyDiffFuzzyThreshold*100),
			func() string {
				if startLine > 0 {
					return fmt.Sprintf("starting at line %d", startLine)
				}
				return "start to end"
			}(),
			searchChunk,
			bestMatchSection,
			originalContentSection,
		),
		Occurrences:        0,
		BestMatch:          bestMatchContent,
		Similarity:         bestMatchScore,
		RequiredSimilarity: applyDiffFuzzyThreshold,
	}
}

func setApplyDiffPreviewFailure(preview *ApplyDiffPreview, block ApplyDiffBlock, failure *EditMatchFailure) {
	if preview == nil || failure == nil || preview.Failure != nil {
		return
	}
	preview.Failure = failure
	preview.FailureBlockIndex = block.Index
	preview.FailureBlockStartLine = block.StartLine
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
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
	resultLines := splitApplyDiffFileLines(originalContent)
	delta := 0
	preview := ApplyDiffPreview{
		Path:            strings.TrimSpace(path),
		CanApply:        false,
		Blocks:          make([]ApplyDiffResolvedBlock, 0, len(blocks)),
		BlockResults:    make([]ApplyDiffBlockResult, 0, len(blocks)),
		OriginalContent: originalContent,
		PreviewContent:  originalContent,
		LineEnding:      lineEnding,
	}
	appliedCount := 0
	for _, replacement := range blocks {
		searchContent := unescapeApplyDiffMarkers(replacement.Search)
		replaceContent := unescapeApplyDiffMarkers(replacement.Replace)
		startLine := replacement.StartLine
		if replacement.StartLine != 0 {
			startLine += delta
		}
		hasAllLineNumbers := (everyLineHasLineNumbers(searchContent) && everyLineHasLineNumbers(replaceContent)) || (everyLineHasLineNumbers(searchContent) && strings.TrimSpace(replaceContent) == "")
		if hasAllLineNumbers && startLine == 0 {
			startLine = extractLeadingLineNumber(searchContent)
		}
		if hasAllLineNumbers {
			searchContent = stripLineNumbers(searchContent, false)
			replaceContent = stripLineNumbers(replaceContent, false)
		}
		if searchContent == replaceContent {
			failure := &EditMatchFailure{
				Reason: "Search and replace content are identical - no changes would be made\n\nDebug Info:\n- Search and replace must be different to make changes\n- Use read_file to verify the content you want to change",
			}
			preview.BlockResults = append(preview.BlockResults, ApplyDiffBlockResult{
				Index:       replacement.Index,
				StartLine:   replacement.StartLine,
				Occurrences: 0,
				Applied:     false,
				Failure:     failure,
			})
			setApplyDiffPreviewFailure(&preview, replacement, failure)
			continue
		}
		searchLines := splitApplyDiffContentLines(searchContent)
		replaceLines := splitApplyDiffContentLines(replaceContent)
		if len(searchLines) == 0 {
			failure := &EditMatchFailure{
				Reason: "Empty search content is not allowed\n\nDebug Info:\n- Search content cannot be empty\n- For insertions, provide a specific line using :start_line: and include content to search for\n- For example, match a single line to insert before/after it",
			}
			preview.BlockResults = append(preview.BlockResults, ApplyDiffBlockResult{
				Index:       replacement.Index,
				StartLine:   replacement.StartLine,
				Occurrences: 0,
				Applied:     false,
				Failure:     failure,
			})
			setApplyDiffPreviewFailure(&preview, replacement, failure)
			continue
		}
		endLine := replacement.StartLine + len(searchLines) - 1
		matchIndex := -1
		bestMatchScore := 0.0
		bestMatchContent := ""
		searchChunk := strings.Join(searchLines, "\n")
		searchStartIndex := 0
		searchEndIndex := len(resultLines)
		if startLine != 0 {
			exactStartIndex := startLine - 1
			searchLen := len(searchLines)
			exactEndIndex := exactStartIndex + searchLen - 1
			originalChunk := safeJoinApplyDiffSlice(resultLines, exactStartIndex, exactEndIndex+1)
			similarity := calculateSimilarity(originalChunk, searchChunk)
			if similarity >= applyDiffFuzzyThreshold {
				matchIndex = exactStartIndex
				bestMatchScore = similarity
				bestMatchContent = originalChunk
			} else {
				searchStartIndex = maxInt(0, startLine-(applyDiffBufferLines+1))
				searchEndIndex = minInt(len(resultLines), startLine+len(searchLines)+applyDiffBufferLines)
			}
		}
		if matchIndex == -1 {
			bestIndex, score, content := fuzzySearchApplyDiffChunk(resultLines, searchChunk, searchStartIndex, searchEndIndex)
			matchIndex = bestIndex
			bestMatchScore = score
			bestMatchContent = content
		}
		if matchIndex == -1 || bestMatchScore < applyDiffFuzzyThreshold {
			aggressiveSearchContent := stripLineNumbers(searchContent, true)
			aggressiveReplaceContent := stripLineNumbers(replaceContent, true)
			aggressiveSearchLines := splitApplyDiffContentLines(aggressiveSearchContent)
			aggressiveSearchChunk := strings.Join(aggressiveSearchLines, "\n")
			bestIndex, score, content := fuzzySearchApplyDiffChunk(resultLines, aggressiveSearchChunk, searchStartIndex, searchEndIndex)
			if bestIndex != -1 && score >= applyDiffFuzzyThreshold {
				matchIndex = bestIndex
				bestMatchScore = score
				bestMatchContent = content
				searchContent = aggressiveSearchContent
				replaceContent = aggressiveReplaceContent
				searchLines = aggressiveSearchLines
				replaceLines = splitApplyDiffContentLines(replaceContent)
				searchChunk = aggressiveSearchChunk
			} else {
				failure := buildApplyDiffNoMatchFailure(resultLines, startLine, endLine, bestMatchContent, bestIndex, score, searchChunk)
				preview.BlockResults = append(preview.BlockResults, ApplyDiffBlockResult{
					Index:       replacement.Index,
					StartLine:   replacement.StartLine,
					Occurrences: 0,
					Applied:     false,
					Failure:     failure,
				})
				setApplyDiffPreviewFailure(&preview, replacement, failure)
				continue
			}
		}
		matchedLines := resultLines[matchIndex : matchIndex+len(searchLines)]
		originalIndents := make([]string, 0, len(matchedLines))
		for _, line := range matchedLines {
			originalIndents = append(originalIndents, leadingWhitespace(line))
		}
		searchIndents := make([]string, 0, len(searchLines))
		for _, line := range searchLines {
			searchIndents = append(searchIndents, leadingWhitespace(line))
		}
		indentedReplaceLines := make([]string, 0, len(replaceLines))
		for _, line := range replaceLines {
			matchedIndent := ""
			if len(originalIndents) > 0 {
				matchedIndent = originalIndents[0]
			}
			currentIndent := leadingWhitespace(line)
			searchBaseIndent := ""
			if len(searchIndents) > 0 {
				searchBaseIndent = searchIndents[0]
			}
			searchBaseLevel := len(searchBaseIndent)
			currentLevel := len(currentIndent)
			relativeLevel := currentLevel - searchBaseLevel
			finalIndent := ""
			if relativeLevel < 0 {
				finalIndent = matchedIndent[:maxInt(0, len(matchedIndent)+relativeLevel)]
			} else {
				suffix := ""
				if len(currentIndent) >= searchBaseLevel {
					suffix = currentIndent[searchBaseLevel:]
				}
				finalIndent = matchedIndent + suffix
			}
			indentedReplaceLines = append(indentedReplaceLines, finalIndent+strings.TrimSpace(line))
		}
		beforeMatch := resultLines[:matchIndex]
		afterMatch := resultLines[matchIndex+len(searchLines):]
		resultLines = append(beforeMatch, append(indentedReplaceLines, afterMatch...)...)
		delta = delta - len(matchedLines) + len(replaceLines)
		appliedCount++
		preview.Blocks = append(preview.Blocks, ApplyDiffResolvedBlock{
			Index:            replacement.Index,
			StartLine:        replacement.StartLine,
			MatchedStartLine: matchIndex + 1,
			Search:           searchContent,
			Replace:          strings.Join(indentedReplaceLines, "\n"),
			MatchedSearch:    strings.Join(matchedLines, "\n"),
		})
		preview.BlockResults = append(preview.BlockResults, ApplyDiffBlockResult{
			Index:       replacement.Index,
			StartLine:   replacement.StartLine,
			Occurrences: 1,
			Applied:     true,
		})
	}
	if appliedCount == 0 {
		preview.CanApply = false
		preview.PreviewContent = originalContent
		return preview, nil
	}
	preview.CanApply = true
	preview.PreviewContent = strings.Join(resultLines, lineEnding)
	return preview, nil
}