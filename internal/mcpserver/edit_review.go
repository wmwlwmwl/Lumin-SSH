package mcpserver

import "strings"

type EditFileReviewPreview struct {
	Path                 string            `json:"path"`
	Search               string            `json:"search"`
	Replace              string            `json:"replace"`
	ExpectedReplacements int               `json:"expected_replacements"`
	Occurrences          int               `json:"occurrences"`
	OriginalContent      string            `json:"-"`
	PreviewContent       string            `json:"-"`
	Failure              *EditMatchFailure `json:"failure,omitempty"`
}

type SearchReplaceResolvedOperation struct {
	Index         int    `json:"index"`
	Search        string `json:"search"`
	Replace       string `json:"replace"`
	MatchedSearch string `json:"matched_search,omitempty"`
}

type SearchReplaceReviewPreview struct {
	Path            string                           `json:"path"`
	Operations      []SearchReplaceResolvedOperation `json:"operations"`
	OriginalContent string                           `json:"-"`
	PreviewContent  string                           `json:"-"`
	Failure         *EditMatchFailure                `json:"failure,omitempty"`
	FailureIndex    int                              `json:"failure_index,omitempty"`
}

func buildNoExactMatchFailure(notFoundReason string, multipleReason string, occurrences int, content string, search string) *EditMatchFailure {
	failure := &EditMatchFailure{
		Occurrences: occurrences,
	}
	if occurrences == 0 {
		bestMatch := extractBestMatchSnippet(content, search)
		failure.Reason = notFoundReason
		failure.BestMatch = bestMatch
		failure.Similarity = calculateSimilarity(bestMatch, search)
		failure.RequiredSimilarity = 1
		return failure
	}
	failure.Reason = multipleReason
	return failure
}

func BuildEditFileReviewPreview(path string, originalContent string, oldString string, newString string, expectedReplacements int) (EditFileReviewPreview, error) {
	if expectedReplacements < 1 {
		expectedReplacements = 1
	}
	preview := EditFileReviewPreview{
		Path:                 strings.TrimSpace(path),
		Search:               oldString,
		Replace:              newString,
		ExpectedReplacements: expectedReplacements,
		OriginalContent:      originalContent,
		PreviewContent:       originalContent,
	}
	if oldString == "" {
		preview.Failure = &EditMatchFailure{Reason: "old_string must not be empty"}
		return preview, nil
	}
	occurrences := countOccurrences(originalContent, oldString)
	preview.Occurrences = occurrences
	if occurrences != expectedReplacements {
		preview.Failure = buildNoExactMatchFailure(
			"occurrence count did not match expected_replacements",
			"occurrence count did not match expected_replacements",
			occurrences,
			originalContent,
			oldString,
		)
		return preview, nil
	}
	if expectedReplacements == 1 {
		nextContent, _ := replaceExactlyOnce(originalContent, oldString, newString)
		preview.PreviewContent = nextContent
		return preview, nil
	}
	preview.PreviewContent = strings.ReplaceAll(originalContent, oldString, newString)
	return preview, nil
}

func BuildSearchReplaceReviewPreview(path string, originalContent string, operations []SearchReplaceOperation) (SearchReplaceReviewPreview, error) {
	preview := SearchReplaceReviewPreview{
		Path:            strings.TrimSpace(path),
		Operations:      make([]SearchReplaceResolvedOperation, 0, len(operations)),
		OriginalContent: originalContent,
		PreviewContent:  originalContent,
	}
	currentContent := originalContent
	for index, operation := range operations {
		if operation.Search == "" {
			preview.Failure = &EditMatchFailure{Reason: "search must not be empty"}
			preview.FailureIndex = index
			return preview, nil
		}
		occurrences := countOccurrences(currentContent, operation.Search)
		if occurrences != 1 {
			preview.Failure = buildNoExactMatchFailure(
				"search not found exactly",
				"search matched multiple locations",
				occurrences,
				currentContent,
				operation.Search,
			)
			preview.FailureIndex = index
			return preview, nil
		}
		preview.Operations = append(preview.Operations, SearchReplaceResolvedOperation{
			Index:         index,
			Search:        operation.Search,
			Replace:       operation.Replace,
			MatchedSearch: operation.Search,
		})
		nextContent, _ := replaceExactlyOnce(currentContent, operation.Search, operation.Replace)
		currentContent = nextContent
	}
	preview.PreviewContent = currentContent
	return preview, nil
}