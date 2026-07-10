package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func sanitizeAIRestoreArtifactName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fmt.Sprintf("restore-%d", time.Now().UnixMilli())
	}
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	sanitized := strings.TrimSpace(replacer.Replace(trimmed))
	if sanitized == "" {
		return fmt.Sprintf("restore-%d", time.Now().UnixMilli())
	}
	return sanitized
}

func normalizeAIRestoreArtifactPath(value string) string {
	return filepath.Clean(strings.TrimSpace(value))
}

func isAIRestoreArtifactPathWithinBase(basePath string, targetPath string) bool {
	cleanedBase := filepath.Clean(strings.TrimSpace(basePath))
	cleanedTarget := filepath.Clean(strings.TrimSpace(targetPath))
	if cleanedBase == "" || cleanedTarget == "" {
		return false
	}
	if cleanedBase == cleanedTarget {
		return true
	}
	baseWithSeparator := cleanedBase + string(os.PathSeparator)
	return strings.HasPrefix(cleanedTarget, baseWithSeparator)
}

func splitAIRestoreArtifactLines(value string) []string {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	if normalized == "" {
		return []string{}
	}
	return strings.Split(normalized, "\n")
}

func buildAIRestoreUnifiedPatch(files []aiToolRestoreFileSnapshot) string {
	if len(files) == 0 {
		return ""
	}
	var builder strings.Builder
	for index, file := range files {
		normalizedPath := strings.ReplaceAll(strings.TrimSpace(file.Path), "\\", "/")
		if normalizedPath == "" {
			normalizedPath = fmt.Sprintf("file-%d", index+1)
		}
		oldPath := "/dev/null"
		if file.ExistedBefore {
			oldPath = "a/" + normalizedPath
		}
		newPath := "/dev/null"
		if file.ExistsAfter {
			newPath = "b/" + normalizedPath
		}
		oldLines := splitAIRestoreArtifactLines(file.BeforeContent)
		newLines := splitAIRestoreArtifactLines(file.AppliedContent)
		oldStart := 0
		if len(oldLines) > 0 {
			oldStart = 1
		}
		newStart := 0
		if len(newLines) > 0 {
			newStart = 1
		}
		builder.WriteString(fmt.Sprintf("diff --git a/%s b/%s\n", normalizedPath, normalizedPath))
		builder.WriteString(fmt.Sprintf("--- %s\n", oldPath))
		builder.WriteString(fmt.Sprintf("+++ %s\n", newPath))
		builder.WriteString(fmt.Sprintf("@@ -%d,%d +%d,%d @@\n", oldStart, len(oldLines), newStart, len(newLines)))
		for _, line := range oldLines {
			builder.WriteString("-")
			builder.WriteString(line)
			builder.WriteString("\n")
		}
		for _, line := range newLines {
			builder.WriteString("+")
			builder.WriteString(line)
			builder.WriteString("\n")
		}
		if index < len(files)-1 {
			builder.WriteString("\n")
		}
	}
	return builder.String()
}

func formatAICopiedFileToolEntry(filePath string, body string) string {
	trimmedBody := strings.TrimSpace(body)
	if trimmedBody == "" {
		return ""
	}
	trimmedPath := strings.TrimSpace(filePath)
	if trimmedPath == "" {
		return trimmedBody
	}
	return fmt.Sprintf("File:%s\n%s", trimmedPath, trimmedBody)
}

func buildAIRestoreCopyPathLabel(files []aiToolRestoreFileSnapshot) string {
	if len(files) == 0 {
		return ""
	}
	labels := make([]string, 0, len(files))
	for _, file := range files {
		trimmedPath := strings.TrimSpace(file.Path)
		if trimmedPath == "" {
			continue
		}
		labels = append(labels, trimmedPath)
	}
	return strings.Join(labels, ", ")
}

func buildAIEditFileCopyContent(tool aiParsedToolUse) string {
	var builder strings.Builder
	builder.WriteString("old_string:\n")
	builder.WriteString(tool.Params["old_string"])
	builder.WriteString("\n\nnew_string:\n")
	builder.WriteString(tool.Params["new_string"])
	if expectedReplacements := strings.TrimSpace(tool.Params["expected_replacements"]); expectedReplacements != "" {
		builder.WriteString("\n\nexpected_replacements:\n")
		builder.WriteString(expectedReplacements)
	}
	return strings.TrimSpace(builder.String())
}

func buildAICopyContentForTool(tool aiParsedToolUse, state *aiToolRestoreState) string {
	if state == nil || len(state.Files) == 0 {
		return ""
	}
	toolName := strings.TrimSpace(tool.Name)
	switch toolName {
	case "apply_diff":
		return formatAICopiedFileToolEntry(state.Files[0].Path, tool.Params["diff"])
	case "write_to_file":
		return formatAICopiedFileToolEntry(state.Files[0].Path, tool.Params["content"])
	case "search_replace":
		return formatAICopiedFileToolEntry(state.Files[0].Path, tool.Params["operations"])
	case "edit_file":
		return formatAICopiedFileToolEntry(state.Files[0].Path, buildAIEditFileCopyContent(tool))
	case "apply_patch":
		return formatAICopiedFileToolEntry(buildAIRestoreCopyPathLabel(state.Files), tool.Params["patch"])
	default:
		return ""
	}
}

func (c *ConfigManager) aiConversationRestoreArtifactsDir(conversationID string) string {
	return filepath.Join(c.aiConversationDir(strings.TrimSpace(conversationID)), "restore_artifacts")
}

func (c *ConfigManager) aiConversationRestoreArtifactDir(conversationID string, reviewID string) string {
	return filepath.Join(c.aiConversationRestoreArtifactsDir(conversationID), sanitizeAIRestoreArtifactName(reviewID))
}

func (c *ConfigManager) aiConversationRestoreArtifactPath(conversationID string, reviewID string) string {
	return filepath.Join(c.aiConversationRestoreArtifactDir(conversationID, reviewID), "restore.json")
}

func (c *ConfigManager) aiConversationRestorePatchPath(conversationID string, reviewID string) string {
	return filepath.Join(c.aiConversationRestoreArtifactDir(conversationID, reviewID), "forward.patch")
}

func normalizeAIRestoreArtifactState(state aiToolRestoreState) aiToolRestoreState {
	state.Version = 1
	state.ReviewID = strings.TrimSpace(state.ReviewID)
	state.RequestID = strings.TrimSpace(state.RequestID)
	state.ConversationID = strings.TrimSpace(state.ConversationID)
	state.SessionID = strings.TrimSpace(state.SessionID)
	state.ToolName = strings.TrimSpace(state.ToolName)
	state.Summary = strings.TrimSpace(state.Summary)
	state.ArtifactPath = normalizeAIRestoreArtifactPath(state.ArtifactPath)
	state.PatchPath = normalizeAIRestoreArtifactPath(state.PatchPath)
	if state.CreatedAt <= 0 {
		state.CreatedAt = time.Now().UnixMilli()
	}
	normalizedFiles := make([]aiToolRestoreFileSnapshot, 0, len(state.Files))
	for _, file := range state.Files {
		normalizedFiles = append(normalizedFiles, aiToolRestoreFileSnapshot{
			Path:           strings.TrimSpace(file.Path),
			BeforeContent:  file.BeforeContent,
			AppliedContent: file.AppliedContent,
			ExistedBefore:  file.ExistedBefore,
			ExistsAfter:    file.ExistsAfter,
		})
	}
	state.Files = normalizedFiles
	return state
}

func (c *ConfigManager) WriteAIConversationRestoreArtifact(state *aiToolRestoreState) (string, error) {
	if c == nil {
		return "", fmt.Errorf("config manager unavailable")
	}
	if state == nil {
		return "", fmt.Errorf("restore artifact is required")
	}
	normalized := normalizeAIRestoreArtifactState(*state)
	if normalized.ConversationID == "" {
		return "", fmt.Errorf("conversation id is required")
	}
	if normalized.ReviewID == "" {
		return "", fmt.Errorf("review id is required")
	}
	artifactPath := c.aiConversationRestoreArtifactPath(normalized.ConversationID, normalized.ReviewID)
	patchPath := c.aiConversationRestorePatchPath(normalized.ConversationID, normalized.ReviewID)
	normalized.ArtifactPath = artifactPath
	normalized.PatchPath = patchPath
	data, err := marshalAIConversationJSON(normalized)
	if err != nil {
		return "", err
	}
	patchContent := buildAIRestoreUnifiedPatch(normalized.Files)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(artifactPath), 0700); err != nil {
		return "", err
	}
	if err := atomicWriteFile(artifactPath, data, 0600); err != nil {
		return "", err
	}
	if strings.TrimSpace(patchContent) != "" {
		if err := atomicWriteFile(patchPath, []byte(patchContent), 0600); err != nil {
			return "", err
		}
	}
	return artifactPath, nil
}

func (c *ConfigManager) ReadAIConversationRestoreArtifact(artifactPath string) (*aiToolRestoreState, error) {
	if c == nil {
		return nil, fmt.Errorf("config manager unavailable")
	}
	normalizedPath := normalizeAIRestoreArtifactPath(artifactPath)
	if normalizedPath == "" {
		return nil, fmt.Errorf("restore artifact path is required")
	}
	basePath := c.aiConversationsRootDir()
	if !isAIRestoreArtifactPathWithinBase(basePath, normalizedPath) {
		return nil, fmt.Errorf("restore artifact path is invalid")
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	data, err := os.ReadFile(normalizedPath)
	if err != nil {
		return nil, err
	}
	var state aiToolRestoreState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	normalized := normalizeAIRestoreArtifactState(state)
	if normalized.ArtifactPath == "" {
		normalized.ArtifactPath = normalizedPath
	}
	if normalized.PatchPath == "" && normalized.ConversationID != "" && normalized.ReviewID != "" {
		normalized.PatchPath = c.aiConversationRestorePatchPath(normalized.ConversationID, normalized.ReviewID)
	}
	return &normalized, nil
}