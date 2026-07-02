package mcpserver

import (
	"fmt"
	"strings"
)

type ApplyPatchHunk struct {
	Search string
	Replace string
}

type ApplyPatchFileOperation struct {
	Action string
	Path string
	Content string
	Hunks []ApplyPatchHunk
}

type ApplyPatchFileChange struct {
	Action string `json:"action"`
	Path string `json:"path"`
	Hunks int `json:"hunks,omitempty"`
	Applied bool `json:"applied"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}

type ApplyPatchResult struct {
	SessionID string `json:"session_id"`
	Handler string `json:"handler"`
	Capabilities RemoteEditCapabilities `json:"capabilities"`
	FilesChanged int `json:"files_changed"`
	Applied bool `json:"applied"`
	Changes []ApplyPatchFileChange `json:"changes"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}

func parseApplyPatchDocument(patch string) ([]ApplyPatchFileOperation, error) {
	normalized := strings.ReplaceAll(patch, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	index := 0
	for index < len(lines) && strings.TrimSpace(lines[index]) == "" {
		index++
	}
	if index >= len(lines) || lines[index] != "*** Begin Patch" {
		return nil, fmt.Errorf("invalid patch format: missing *** Begin Patch")
	}
	index++
	operations := make([]ApplyPatchFileOperation, 0)
	for index < len(lines) {
		line := lines[index]
		if strings.TrimSpace(line) == "" {
			index++
			continue
		}
		if line == "*** End Patch" {
			if len(operations) == 0 {
				return nil, fmt.Errorf("patch must contain at least one file operation")
			}
			return operations, nil
		}
		switch {
		case strings.HasPrefix(line, "*** Add File: "):
			path := strings.TrimSpace(strings.TrimPrefix(line, "*** Add File: "))
			index++
			contentLines := make([]string, 0)
			for index < len(lines) {
				currentLine := lines[index]
				if strings.HasPrefix(currentLine, "*** ") {
					break
				}
				if !strings.HasPrefix(currentLine, "+") {
					return nil, fmt.Errorf("invalid add file block for %s", path)
				}
				contentLines = append(contentLines, currentLine[1:])
				index++
			}
			operations = append(operations, ApplyPatchFileOperation{
				Action: "add",
				Path: path,
				Content: strings.Join(contentLines, "\n"),
			})
		case strings.HasPrefix(line, "*** Delete File: "):
			path := strings.TrimSpace(strings.TrimPrefix(line, "*** Delete File: "))
			operations = append(operations, ApplyPatchFileOperation{
				Action: "delete",
				Path: path,
			})
			index++
		case strings.HasPrefix(line, "*** Update File: "):
			path := strings.TrimSpace(strings.TrimPrefix(line, "*** Update File: "))
			index++
			hunks := make([]ApplyPatchHunk, 0)
			for index < len(lines) {
				currentLine := lines[index]
				if currentLine == "*** End Patch" || strings.HasPrefix(currentLine, "*** Add File: ") || strings.HasPrefix(currentLine, "*** Delete File: ") || strings.HasPrefix(currentLine, "*** Update File: ") {
					break
				}
				if strings.TrimSpace(currentLine) == "" {
					index++
					continue
				}
				if !strings.HasPrefix(currentLine, "@@") {
					return nil, fmt.Errorf("invalid update file block for %s", path)
				}
				index++
				searchLines := make([]string, 0)
				replaceLines := make([]string, 0)
				for index < len(lines) {
					patchLine := lines[index]
					if strings.HasPrefix(patchLine, "@@") || patchLine == "*** End Patch" || strings.HasPrefix(patchLine, "*** Add File: ") || strings.HasPrefix(patchLine, "*** Delete File: ") || strings.HasPrefix(patchLine, "*** Update File: ") {
						break
					}
					if patchLine == "" {
						return nil, fmt.Errorf("invalid update hunk for %s", path)
					}
					prefix := patchLine[0]
					text := patchLine[1:]
					switch prefix {
					case ' ':
						searchLines = append(searchLines, text)
						replaceLines = append(replaceLines, text)
					case '-':
						searchLines = append(searchLines, text)
					case '+':
						replaceLines = append(replaceLines, text)
					default:
						return nil, fmt.Errorf("invalid update hunk line for %s", path)
					}
					index++
				}
				hunks = append(hunks, ApplyPatchHunk{
					Search: strings.Join(searchLines, "\n"),
					Replace: strings.Join(replaceLines, "\n"),
				})
			}
			if len(hunks) == 0 {
				return nil, fmt.Errorf("update file block for %s does not contain hunks", path)
			}
			operations = append(operations, ApplyPatchFileOperation{
				Action: "update",
				Path: path,
				Hunks: hunks,
			})
		default:
			return nil, fmt.Errorf("invalid patch format near line: %s", line)
		}
	}
	return nil, fmt.Errorf("invalid patch format: missing *** End Patch")
}