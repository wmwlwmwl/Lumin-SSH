package mcpserver

import (
	"regexp"
	"strings"
	"unicode/utf16"
)

var normalizeEditSearchWhitespacePattern = regexp.MustCompile(`\s+`)

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

func normalizeEditSearchString(value string) string {
	replacer := strings.NewReplacer(
		"\u201C", "\"",
		"\u201D", "\"",
		"\u2018", "'",
		"\u2019", "'",
		"\u2026", "...",
		"\u2014", "-",
		"\u2013", "-",
		"\u00A0", " ",
	)
	normalized := replacer.Replace(value)
	normalized = normalizeEditSearchWhitespacePattern.ReplaceAllString(normalized, " ")
	normalized = strings.TrimSpace(normalized)
	return normalized
}

func levenshteinDistance(left string, right string) int {
	if left == right {
		return 0
	}
	leftUnits := utf16.Encode([]rune(left))
	rightUnits := utf16.Encode([]rune(right))
	if len(leftUnits) == 0 {
		return len(rightUnits)
	}
	if len(rightUnits) == 0 {
		return len(leftUnits)
	}
	previous := make([]int, len(rightUnits)+1)
	current := make([]int, len(rightUnits)+1)
	for j := 0; j <= len(rightUnits); j++ {
		previous[j] = j
	}
	for i := 1; i <= len(leftUnits); i++ {
		current[0] = i
		for j := 1; j <= len(rightUnits); j++ {
			cost := 0
			if leftUnits[i-1] != rightUnits[j-1] {
				cost = 1
			}
			deletion := previous[j] + 1
			insertion := current[j-1] + 1
			substitution := previous[j-1] + cost
			current[j] = deletion
			if insertion < current[j] {
				current[j] = insertion
			}
			if substitution < current[j] {
				current[j] = substitution
			}
		}
		copy(previous, current)
	}
	return previous[len(rightUnits)]
}

func calculateSimilarity(left string, right string) float64 {
	if right == "" {
		return 0
	}
	normalizedLeft := normalizeEditSearchString(left)
	normalizedRight := normalizeEditSearchString(right)
	if normalizedLeft == normalizedRight {
		return 1
	}
	maxLength := len(utf16.Encode([]rune(normalizedLeft)))
	if rightLength := len(utf16.Encode([]rune(normalizedRight))); rightLength > maxLength {
		maxLength = rightLength
	}
	if maxLength == 0 {
		return 1
	}
	dist := levenshteinDistance(normalizedLeft, normalizedRight)
	return 1 - float64(dist)/float64(maxLength)
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