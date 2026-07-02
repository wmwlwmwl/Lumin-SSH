package mcpserver

import "strings"

func countOccurrences(content string, search string) int {
	if search == "" {
		return 0
	}
	count := 0
	offset := 0
	for {
		index := strings.Index(content[offset:], search)
		if index < 0 {
			return count
		}
		count++
		offset += index + len(search)
	}
}

func replaceExactlyOnce(content string, search string, replace string) (string, int) {
	index := strings.Index(content, search)
	if index < 0 {
		return content, 0
	}
	return content[:index] + replace + content[index+len(search):], 1
}

func extractBestMatchSnippet(content string, search string) string {
	if search == "" || content == "" {
		return ""
	}
	lines := splitFileLines(content)
	searchLines := splitFileLines(search)
	targetLength := 1
	if len(searchLines) > targetLength {
		targetLength = len(searchLines)
	}
	bestSnippet := ""
	bestScore := -1
	for start := 0; start < len(lines); start++ {
		end := start + targetLength
		if end > len(lines) {
			end = len(lines)
		}
		snippet := strings.Join(lines[start:end], "\n")
		score := overlapScore(snippet, search)
		if score > bestScore {
			bestScore = score
			bestSnippet = snippet
		}
	}
	return bestSnippet
}

func overlapScore(left string, right string) int {
	leftTokens := tokenizeForOverlap(left)
	rightTokens := tokenizeForOverlap(right)
	if len(leftTokens) == 0 || len(rightTokens) == 0 {
		return 0
	}
	rightSet := make(map[string]struct{}, len(rightTokens))
	for _, token := range rightTokens {
		rightSet[token] = struct{}{}
	}
	score := 0
	for _, token := range leftTokens {
		if _, ok := rightSet[token]; ok {
			score++
		}
	}
	return score
}

func tokenizeForOverlap(value string) []string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.NewReplacer("\t", " ", ",", " ", "(", " ", ")", " ", "{", " ", "}", " ", "[", " ", "]", " ").Replace(value)
	fields := strings.Fields(value)
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		if field == "" {
			continue
		}
		result = append(result, field)
	}
	return result
}