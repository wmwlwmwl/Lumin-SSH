package mcpserver

import "strings"

type ApplyPatchResolvedFile struct {
	Index         int               `json:"index"`
	Action        string            `json:"action"`
	Path          string            `json:"path"`
	Hunks         int               `json:"hunks,omitempty"`
	Before        string            `json:"before"`
	After         string            `json:"after"`
	ExistedBefore bool              `json:"-"`
	ExistsAfter   bool              `json:"-"`
	Failure       *EditMatchFailure `json:"failure,omitempty"`
}

type ApplyPatchReviewPreview struct {
	Files        []ApplyPatchResolvedFile `json:"files"`
	Failure      *EditMatchFailure        `json:"failure,omitempty"`
	FailureIndex int                      `json:"failure_index,omitempty"`
}

func BuildApplyPatchReviewPreview(patch string, readFile func(path string) (string, error)) (ApplyPatchReviewPreview, error) {
	operations, err := parseApplyPatchDocument(patch)
	if err != nil {
		return ApplyPatchReviewPreview{}, err
	}
	preview := ApplyPatchReviewPreview{
		Files: make([]ApplyPatchResolvedFile, 0, len(operations)),
	}
	for index, operation := range operations {
		resolved := ApplyPatchResolvedFile{
			Index:  index,
			Action: strings.TrimSpace(operation.Action),
			Path:   strings.TrimSpace(operation.Path),
			Hunks:  len(operation.Hunks),
		}
		switch resolved.Action {
		case "add":
			if readFile != nil {
				if originalContent, readErr := readFile(resolved.Path); readErr == nil {
					resolved.Before = originalContent
					resolved.ExistedBefore = true
				}
			}
			resolved.After = operation.Content
			resolved.ExistsAfter = true
		case "delete":
			if readFile == nil {
				resolved.Failure = &EditMatchFailure{Reason: "patch delete target not found"}
				preview.Failure = resolved.Failure
				preview.FailureIndex = index
				preview.Files = append(preview.Files, resolved)
				return preview, nil
			}
			originalContent, readErr := readFile(resolved.Path)
			if readErr != nil {
				resolved.Failure = &EditMatchFailure{Reason: "patch delete target not found"}
				preview.Failure = resolved.Failure
				preview.FailureIndex = index
				preview.Files = append(preview.Files, resolved)
				return preview, nil
			}
			resolved.Before = originalContent
			resolved.ExistedBefore = true
			resolved.After = ""
			resolved.ExistsAfter = false
		case "update":
			if readFile == nil {
				resolved.Failure = &EditMatchFailure{Reason: "patch update target not found"}
				preview.Failure = resolved.Failure
				preview.FailureIndex = index
				preview.Files = append(preview.Files, resolved)
				return preview, nil
			}
			originalContent, readErr := readFile(resolved.Path)
			if readErr != nil {
				resolved.Failure = &EditMatchFailure{Reason: "patch update target not found"}
				preview.Failure = resolved.Failure
				preview.FailureIndex = index
				preview.Files = append(preview.Files, resolved)
				return preview, nil
			}
			currentContent := originalContent
			for _, hunk := range operation.Hunks {
				if hunk.Search == "" {
					resolved.Failure = &EditMatchFailure{Reason: "patch hunk search must not be empty"}
					preview.Failure = resolved.Failure
					preview.FailureIndex = index
					preview.Files = append(preview.Files, resolved)
					return preview, nil
				}
				occurrences := countOccurrences(currentContent, hunk.Search)
				if occurrences != 1 {
					resolved.Failure = buildNoExactMatchFailure(
						"patch hunk not found exactly",
						"patch hunk matched multiple locations",
						occurrences,
						currentContent,
						hunk.Search,
					)
					preview.Failure = resolved.Failure
					preview.FailureIndex = index
					preview.Files = append(preview.Files, resolved)
					return preview, nil
				}
				nextContent, _ := replaceExactlyOnce(currentContent, hunk.Search, hunk.Replace)
				currentContent = nextContent
			}
			resolved.Before = originalContent
			resolved.ExistedBefore = true
			resolved.After = currentContent
			resolved.ExistsAfter = true
		default:
			resolved.Failure = &EditMatchFailure{Reason: "unsupported patch action: " + resolved.Action}
			preview.Failure = resolved.Failure
			preview.FailureIndex = index
			preview.Files = append(preview.Files, resolved)
			return preview, nil
		}
		preview.Files = append(preview.Files, resolved)
	}
	return preview, nil
}