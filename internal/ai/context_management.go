package ai

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type AIConversationContextMetrics struct {
	ContextTokens int `json:"contextTokens"`
}

type AIConversationContextCondenseResult struct {
	Snapshot          AIConversationSnapshot `json:"snapshot"`
	Summary           string                 `json:"summary"`
	PrevContextTokens int                    `json:"prevContextTokens"`
	NewContextTokens  int                    `json:"newContextTokens"`
}

const aiConversationContextKeepMessages = 3
const aiConversationFileContentCompressedPlaceholder = "{因节省资源,请重新调用工具获取}"
const aiConversationImageRemovedPlaceholder = "{图片因节省资源已被移除}"

var aiConversationToolResultPattern = regexp.MustCompile(`(?i)^\[[^\]]+\]\s*Result:`)
var aiConversationEnvironmentDetailsPattern = regexp.MustCompile(`(?s)<environment_details>.*?</environment_details>`)
var aiConversationTerminalOutputPattern = regexp.MustCompile(`(?s)<terminal_output>.*?</terminal_output>`)
var aiConversationFileContentPattern = regexp.MustCompile(`(?s)(<file_content path=["'][^"']*["']>).*?(</file_content>)`)

func buildAIConversationContextTokenBlocks(conversationID string, sessionID string, messages []AIConversationAPIMessage) []TokenCountBlock {
	return buildAIConversationContextTokenBlocksWithProfile(conversationID, sessionID, messages, AIProviderProfile{})
}

func buildAIConversationContextTokenBlocksWithProfile(conversationID string, sessionID string, messages []AIConversationAPIMessage, profile AIProviderProfile) []TokenCountBlock {
	blocks := []TokenCountBlock{
		{
			Type: "text",
			Text: BuildChatSystemPromptWithProfile(nil, conversationID, sessionID, false, profile),
		},
	}
	for _, message := range normalizeAIConversationAPIMessages(messages) {
		if strings.EqualFold(strings.TrimSpace(profile.Provider), "Responses") &&
			strings.EqualFold(strings.TrimSpace(message.Role), "assistant") &&
			message.CacheObjects != nil &&
			message.CacheObjects.OpenAIResponses != nil &&
			len(message.CacheObjects.OpenAIResponses.Output) > 0 {
			responseBlocks := buildAIResponsesOutputTokenCountBlocks(message.CacheObjects.OpenAIResponses.Output)
			if len(responseBlocks) > 0 {
				blocks = append(blocks, responseBlocks...)
				continue
			}
		}
		if message.Content != "" {
			blocks = append(blocks, TokenCountBlock{
				Type: "text",
				Text: message.Content,
			})
		}
		for _, image := range normalizeAIStringList(message.Images) {
			blocks = append(blocks, TokenCountBlock{
				Type: "image",
				Data: image,
			})
		}
	}
	return blocks
}

func calculateAIConversationContextTokens(conversationID string, sessionID string, messages []AIConversationAPIMessage) (int, error) {
	return calculateAIConversationContextTokensWithProfile(conversationID, sessionID, messages, AIProviderProfile{})
}

func calculateAIConversationContextTokensWithProfile(conversationID string, sessionID string, messages []AIConversationAPIMessage, profile AIProviderProfile) (int, error) {
	return CountTokenBlocks(buildAIConversationContextTokenBlocksWithProfile(conversationID, sessionID, messages, profile))
}

func buildAIConversationCondenseUIMessage(summary string, prevContextTokens int, newContextTokens int) AIConversationMessage {
	now := time.Now()
	messageID := fmt.Sprintf("condense-%d", now.UnixNano())
	return AIConversationMessage{
		ID:     messageID,
		TurnID: messageID,
		Kind:   "condense_context",
		Text:   strings.TrimSpace(summary),
		Time:   now.Format("15:04"),
		Extra: map[string]interface{}{
			"contextCondense":   true,
			"prevContextTokens": prevContextTokens,
			"newContextTokens":  newContextTokens,
		},
	}
}

type aiConversationCompressedTextResult struct {
	Text                           string
	RemovedEnvironmentDetailsCount int
	CompressedFileContentCount     int
	CompressedTerminalOutputCount  int
	CompressedSystemNoticeCount    int
	ShouldRemove                   bool
}

func isAIConversationToolResultMessage(message AIConversationAPIMessage) bool {
	if !strings.EqualFold(strings.TrimSpace(message.Role), "user") {
		return false
	}
	return aiConversationToolResultPattern.MatchString(strings.TrimSpace(message.Content))
}

func isAIConversationSystemNoticeText(text string) bool {
	trimmed := strings.TrimLeft(text, "\r\n\t ")
	return strings.HasPrefix(trimmed, "[ERROR] ") || strings.HasPrefix(trimmed, "[TASK RESUMPTION] ")
}

func compressAIConversationTerminalOutputText(text string) (string, int) {
	count := 0
	compressed := aiConversationTerminalOutputPattern.ReplaceAllStringFunc(text, func(match string) string {
		content := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(match, "<terminal_output>"), "</terminal_output>"))
		if content == "*" {
			return match
		}
		count++
		return "<terminal_output>*</terminal_output>"
	})
	return compressed, count
}

func compressAIConversationFileContentText(text string) (string, int) {
	matches := aiConversationFileContentPattern.FindAllStringSubmatchIndex(text, -1)
	if len(matches) == 0 {
		return text, 0
	}
	return aiConversationFileContentPattern.ReplaceAllString(text, fmt.Sprintf("${1}%s${2}", aiConversationFileContentCompressedPlaceholder)), len(matches)
}

func compressAIConversationUserFacingText(text string, removeEnvironmentDetails bool, removeSystemNotice bool) aiConversationCompressedTextResult {
	nextText := text
	removedEnvironmentDetailsCount := 0
	compressedFileContentCount := 0
	compressedTerminalOutputCount := 0
	compressedSystemNoticeCount := 0
	if removeSystemNotice && isAIConversationSystemNoticeText(nextText) {
		compressedSystemNoticeCount++
		nextText = ""
	}
	if removeEnvironmentDetails {
		textWithoutEnvironmentDetails := aiConversationEnvironmentDetailsPattern.ReplaceAllString(nextText, "")
		if textWithoutEnvironmentDetails != nextText {
			removedEnvironmentDetailsCount++
			nextText = textWithoutEnvironmentDetails
		}
	}
	terminalCompressedText, terminalCompressedCount := compressAIConversationTerminalOutputText(nextText)
	if terminalCompressedCount > 0 {
		compressedTerminalOutputCount += terminalCompressedCount
		nextText = terminalCompressedText
	}
	fileCompressedText, fileCompressedCount := compressAIConversationFileContentText(nextText)
	if fileCompressedCount > 0 {
		compressedFileContentCount += fileCompressedCount
		nextText = fileCompressedText
	}
	return aiConversationCompressedTextResult{
		Text:                           nextText,
		RemovedEnvironmentDetailsCount: removedEnvironmentDetailsCount,
		CompressedFileContentCount:     compressedFileContentCount,
		CompressedTerminalOutputCount:  compressedTerminalOutputCount,
		CompressedSystemNoticeCount:    compressedSystemNoticeCount,
		ShouldRemove:                   strings.TrimSpace(nextText) == "",
	}
}

func compressAIConversationToolResultText(text string, removeEnvironmentDetails bool, removeSystemNotice bool) (string, aiConversationCompressedTextResult) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "*", aiConversationCompressedTextResult{}
	}
	header := trimmed
	body := ""
	if newlineIndex := strings.Index(trimmed, "\n"); newlineIndex >= 0 {
		header = strings.TrimSpace(trimmed[:newlineIndex])
		body = strings.TrimSpace(trimmed[newlineIndex+1:])
	}
	compressedBody := compressAIConversationUserFacingText(body, removeEnvironmentDetails, removeSystemNotice)
	if header == "" {
		return "*", compressedBody
	}
	return fmt.Sprintf("%s *", header), compressedBody
}

func buildAIConversationCompressionSummary(
	compressedCount int,
	removedAssistantCount int,
	compressedImageCount int,
	removedEnvironmentDetailsCount int,
	compressedFileContentCount int,
	compressedTerminalOutputCount int,
	compressedSystemNoticeCount int,
) string {
	return fmt.Sprintf(
		"已压缩 %d 个 工具调用结果,移除 %d 个空白 assistant 消息,替换 %d 个图片,移除 %d 个 environment_details,压缩 %d 个 file_content,压缩 %d 个 terminal_output,压缩 %d 个系统提示消息",
		compressedCount,
		removedAssistantCount,
		compressedImageCount,
		removedEnvironmentDetailsCount,
		compressedFileContentCount,
		compressedTerminalOutputCount,
		compressedSystemNoticeCount,
	)
}

func (a *App) CountAIConversationContextTokens(sessionID string, snapshotJSON string) (AIConversationContextMetrics, error) {
	if a == nil || a.configManager == nil {
		return AIConversationContextMetrics{}, fmt.Errorf("config manager unavailable")
	}
	var snapshot AIConversationSnapshot
	if err := json.Unmarshal([]byte(snapshotJSON), &snapshot); err != nil {
		return AIConversationContextMetrics{}, err
	}
	snapshot = normalizeAIConversationSnapshot(snapshot, defaultAIConversationTaskSettings(a.configManager.GetAIGlobalSettings()))
	profile := AIProviderProfile{}
	if resolvedProfile, err := a.getAIProviderProfileForConversation(snapshot.ID); err == nil {
		profile = resolvedProfile
	}
	contextTokens, err := calculateAIConversationContextTokensWithProfile(snapshot.ID, strings.TrimSpace(sessionID), snapshot.APIMessages, profile)
	if err != nil {
		return AIConversationContextMetrics{}, err
	}
	return AIConversationContextMetrics{
		ContextTokens: contextTokens,
	}, nil
}

func (a *App) CondenseAIConversationContext(conversationID string, sessionID string) (AIConversationContextCondenseResult, error) {
	if a == nil || a.configManager == nil {
		return AIConversationContextCondenseResult{}, fmt.Errorf("config manager unavailable")
	}
	snapshot, err := a.configManager.GetAIConversation(strings.TrimSpace(conversationID))
	if err != nil {
		return AIConversationContextCondenseResult{}, err
	}
	apiMessages := normalizeAIConversationAPIMessages(snapshot.APIMessages)
	if len(apiMessages) <= 2 {
		return AIConversationContextCondenseResult{}, fmt.Errorf("当前消息不足，无法压缩上下文")
	}
	profile := AIProviderProfile{}
	if resolvedProfile, err := a.getAIProviderProfileForConversation(snapshot.ID); err == nil {
		profile = resolvedProfile
	}
	prevContextTokens, err := calculateAIConversationContextTokensWithProfile(snapshot.ID, strings.TrimSpace(sessionID), apiMessages, profile)
	if err != nil {
		return AIConversationContextCondenseResult{}, err
	}
	toolResultIndices := make([]int, 0, len(apiMessages))
	lastUserMessageIndex := -1
	for index, message := range apiMessages {
		if strings.EqualFold(strings.TrimSpace(message.Role), "user") {
			lastUserMessageIndex = index
		}
		if isAIConversationToolResultMessage(message) {
			toolResultIndices = append(toolResultIndices, index)
		}
	}
	toolIndicesToCompress := make(map[int]struct{}, len(toolResultIndices))
	for _, index := range toolResultIndices[:max(0, len(toolResultIndices)-1)] {
		toolIndicesToCompress[index] = struct{}{}
	}
	newMessages := make([]AIConversationAPIMessage, 0, len(apiMessages))
	compressedCount := 0
	removedAssistantCount := 0
	compressedImageCount := 0
	removedEnvironmentDetailsCount := 0
	compressedFileContentCount := 0
	compressedTerminalOutputCount := 0
	compressedSystemNoticeCount := 0
	for index, message := range apiMessages {
		nextMessage := message
		if _, shouldCompressToolResult := toolIndicesToCompress[index]; shouldCompressToolResult {
			compressedCount++
			compressedText, compressedBody := compressAIConversationToolResultText(nextMessage.Content, index != lastUserMessageIndex, index != lastUserMessageIndex)
			nextMessage.Content = compressedText
			removedEnvironmentDetailsCount += compressedBody.RemovedEnvironmentDetailsCount
			compressedFileContentCount += compressedBody.CompressedFileContentCount
			compressedTerminalOutputCount += compressedBody.CompressedTerminalOutputCount
			compressedSystemNoticeCount += compressedBody.CompressedSystemNoticeCount
			if len(normalizeAIStringList(nextMessage.Images)) > 0 {
				compressedImageCount += len(normalizeAIStringList(nextMessage.Images))
				nextMessage.Images = nil
			}
			newMessages = append(newMessages, nextMessage)
			continue
		}
		if index != lastUserMessageIndex {
			compressedText := compressAIConversationUserFacingText(nextMessage.Content, true, true)
			nextMessage.Content = compressedText.Text
			removedEnvironmentDetailsCount += compressedText.RemovedEnvironmentDetailsCount
			compressedFileContentCount += compressedText.CompressedFileContentCount
			compressedTerminalOutputCount += compressedText.CompressedTerminalOutputCount
			compressedSystemNoticeCount += compressedText.CompressedSystemNoticeCount
			if compressedText.ShouldRemove {
				nextMessage.Content = ""
			}
			images := normalizeAIStringList(nextMessage.Images)
			if len(images) > 0 {
				compressedImageCount += len(images)
				nextMessage.Images = nil
				if strings.TrimSpace(nextMessage.Content) == "" {
					nextMessage.Content = aiConversationImageRemovedPlaceholder
				} else if !strings.Contains(nextMessage.Content, aiConversationImageRemovedPlaceholder) {
					nextMessage.Content = strings.TrimSpace(nextMessage.Content + "\n" + aiConversationImageRemovedPlaceholder)
				}
			}
		}
		if strings.TrimSpace(nextMessage.Content) == "" && len(normalizeAIStringList(nextMessage.Images)) == 0 {
			if strings.EqualFold(strings.TrimSpace(nextMessage.Role), "assistant") {
				removedAssistantCount++
			}
			continue
		}
		newMessages = append(newMessages, nextMessage)
	}
	newContextTokens, err := calculateAIConversationContextTokensWithProfile(snapshot.ID, strings.TrimSpace(sessionID), newMessages, profile)
	if err != nil {
		return AIConversationContextCondenseResult{}, err
	}
	if newContextTokens >= prevContextTokens {
		return AIConversationContextCondenseResult{}, fmt.Errorf("压缩后上下文未减少")
	}
	compressionSummary := buildAIConversationCompressionSummary(
		compressedCount,
		removedAssistantCount,
		compressedImageCount,
		removedEnvironmentDetailsCount,
		compressedFileContentCount,
		compressedTerminalOutputCount,
		compressedSystemNoticeCount,
	)
	nextSnapshot := snapshot
	nextSnapshot.UpdatedAt = time.Now().UnixMilli()
	nextSnapshot.Status = "idle"
	nextSnapshot.APIMessages = newMessages
	nextSnapshot.Messages = append(
		append([]AIConversationMessage{}, snapshot.Messages...),
		buildAIConversationCondenseUIMessage(compressionSummary, prevContextTokens, newContextTokens),
	)
	savedSnapshot, err := a.configManager.SaveAIConversation(nextSnapshot)
	if err != nil {
		return AIConversationContextCondenseResult{}, err
	}
	return AIConversationContextCondenseResult{
		Snapshot:          savedSnapshot,
		Summary:           compressionSummary,
		PrevContextTokens: prevContextTokens,
		NewContextTokens:  newContextTokens,
	}, nil
}