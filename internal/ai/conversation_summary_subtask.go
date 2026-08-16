package ai

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const aiConversationRelationTypePhase = "phase"
const aiConversationRelationTypeAgent = "agent"
const aiConversationRelationSourceSummaryCondense = "summary_condense"

type aiConversationCompressedSeed struct {
	APIMessages       []AIConversationAPIMessage
	PrevContextTokens int
	NewContextTokens  int
}

type aiConversationSummarySubtaskOutput struct {
	Title   string
	Summary string
}

type AIConversationSummarySubtaskResult struct {
	Snapshot     AIConversationSnapshot `json:"snapshot"`
	ContinueText string                 `json:"continueText,omitempty"`
}

func normalizeAIConversationRelationType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case aiConversationRelationTypePhase:
		return aiConversationRelationTypePhase
	case aiConversationRelationTypeAgent:
		return aiConversationRelationTypeAgent
	default:
		return ""
	}
}

func normalizeAIConversationRelationSource(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func buildAIConversationSummarySubtaskPrompt() string {
	templateText := readAIEmbeddedTemplate("context_condense")
	if strings.TrimSpace(templateText) == "" {
		return ""
	}
	return strings.TrimSpace(renderPromptBuilderTemplate(templateText, map[string]string{
		"DETAILED_ANALYSIS_INSTRUCTION_BASE": "Do not include the <analysis> block. Output plain text only, without any XML tags or markdown headings. The first line must be a concise task title suitable for naming a new conversation. Everything after the first line must be the detailed summary body.",
	}))
}

func stripAIConversationSummarySubtaskResidualTags(value string) string {
	result := value
	for _, tag := range []string{"subtask_title", "subtask_summary"} {
		for _, form := range []string{"<" + tag + ">", "</" + tag + ">"} {
			for {
				lowerResult := strings.ToLower(result)
				idx := strings.Index(lowerResult, strings.ToLower(form))
				if idx < 0 {
					break
				}
				result = result[:idx] + result[idx+len(form):]
			}
		}
	}
	return strings.TrimSpace(result)
}

func extractAIConversationSummarySubtaskTitleFromLine(line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	openTag := "<subtask_title>"
	closeTag := "</subtask_title>"
	startIndex := strings.Index(lower, openTag)
	if startIndex < 0 {
		return stripAIConversationSummarySubtaskResidualTags(trimmed)
	}
	contentStart := startIndex + len(openTag)
	relEnd := strings.Index(lower[contentStart:], closeTag)
	if relEnd < 0 {
		return stripAIConversationSummarySubtaskResidualTags(strings.TrimSpace(trimmed[contentStart:]))
	}
	return stripAIConversationSummarySubtaskResidualTags(strings.TrimSpace(trimmed[contentStart : contentStart+relEnd]))
}

func extractAIConversationSummarySubtaskSummaryFromBody(body string) string {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	openTag := "<subtask_summary>"
	closeTag := "</subtask_summary>"
	startIndex := strings.Index(lower, openTag)
	endIndex := strings.LastIndex(lower, closeTag)
	if startIndex < 0 && endIndex < 0 {
		return stripAIConversationSummarySubtaskResidualTags(trimmed)
	}
	contentStart := 0
	if startIndex >= 0 {
		contentStart = startIndex + len(openTag)
	}
	contentEnd := len(trimmed)
	if endIndex >= contentStart {
		contentEnd = endIndex
	}
	if contentStart > contentEnd {
		return stripAIConversationSummarySubtaskResidualTags(trimmed)
	}
	return stripAIConversationSummarySubtaskResidualTags(strings.TrimSpace(trimmed[contentStart:contentEnd]))
}

func extractAIConversationSummarySubtaskOutput(value string) aiConversationSummarySubtaskOutput {
	trimmedValue := strings.TrimSpace(value)
	if trimmedValue == "" {
		return aiConversationSummarySubtaskOutput{}
	}
	lines := strings.SplitN(trimmedValue, "\n", 2)
	title := extractAIConversationSummarySubtaskTitleFromLine(lines[0])
	body := ""
	if len(lines) == 2 {
		body = lines[1]
	}
	summary := extractAIConversationSummarySubtaskSummaryFromBody(body)
	if summary == "" {
		summary = stripAIConversationSummarySubtaskResidualTags(trimmedValue)
	}
	return aiConversationSummarySubtaskOutput{
		Title:   title,
		Summary: summary,
	}
}

func buildAIConversationSummarySubtaskTitle(title string) string {
	normalizedTitle := strings.Join(strings.Fields(strings.TrimSpace(title)), " ")
	if normalizedTitle == "" {
		return "新对话"
	}
	titleRunes := []rune(normalizedTitle)
	if len(titleRunes) > 24 {
		return string(titleRunes[:24]) + "..."
	}
	return normalizedTitle
}

func buildAIConversationSummarySeedSystemContent(summary string) string {
	trimmedSummary := strings.TrimSpace(summary)
	if trimmedSummary == "" {
		return ""
	}
	return "<user_message>\n" + trimmedSummary + "\n</user_message>"
}

func buildAIConversationSummarySubtaskUIMessage(parentSnapshot AIConversationSnapshot, summary string, prevContextTokens int, newContextTokens int) AIConversationMessage {
	now := time.Now()
	messageID := fmt.Sprintf("summary-subtask-%d", now.UnixNano())
	return AIConversationMessage{
		ID:     messageID,
		TurnID: messageID,
		Kind:   "condense_context",
		Text:   strings.TrimSpace(summary),
		Time:   now.Format("15:04"),
		Extra: map[string]interface{}{
			"derivedSubtask":       true,
			"parentConversationId": strings.TrimSpace(parentSnapshot.ID),
			"parentTitleSnapshot":  strings.TrimSpace(parentSnapshot.Title),
			"prevContextTokens":    prevContextTokens,
			"newContextTokens":     newContextTokens,
		},
	}
}

func buildAIConversationSummarySubtaskFinalInstructionMessage() AIChatRequestMessage {
	return AIChatRequestMessage{
		Role: "user",
		Content: `<user_message>
Please prepare a professional context-compression handoff for this conversation so the work can continue in a derived subtask.
Follow the existing system and summarization instructions already provided in the context.
This instruction message is an out-of-band control instruction. It is NOT part of the conversation being summarized. Do NOT summarize, quote, paraphrase, or mention this compression request itself (including this message, and any wording about "preparing a handoff", "context compression", "continuing in a subtask", "being ready", or confirmations). Summarize ONLY the actual prior task conversation that occurred before this instruction.
Do not continue executing the current task in this response.
Do not answer the user's request, ask follow-up questions, provide confirmations, or add any extra commentary.
Do not use any tools or perform web search.
Output plain text only, without any XML tags. The first line is a concise task title, and everything after the first line is the detailed summary body.
</user_message>`,
	}
}

func (a *App) buildAIConversationCompressedSeed(snapshot AIConversationSnapshot, sessionID string) (aiConversationCompressedSeed, error) {
	apiMessages := normalizeAIConversationAPIMessages(snapshot.APIMessages)
	if len(apiMessages) <= 2 {
		return aiConversationCompressedSeed{}, fmt.Errorf("当前消息不足，无法压缩上下文")
	}
	profile := AIProviderProfile{}
	if resolvedProfile, err := a.getAIProviderProfileForConversation(snapshot.ID); err == nil {
		profile = resolvedProfile
	}
	prevContextTokens, err := calculateAIConversationContextTokensWithProfile(snapshot.ID, strings.TrimSpace(sessionID), apiMessages, profile)
	if err != nil {
		return aiConversationCompressedSeed{}, err
	}
	preservedIndices := buildAIPreservedTailMessageIndexSet(apiMessages)
	newMessages := make([]AIConversationAPIMessage, 0, len(apiMessages))
	for index, message := range apiMessages {
		nextMessage := message
		if _, shouldPreserve := preservedIndices[index]; shouldPreserve {
			newMessages = append(newMessages, nextMessage)
			continue
		}
		if isAIConversationToolResultMessage(nextMessage) {
			compressedText, compressedBody := compressAIConversationToolResultText(nextMessage.Content, true, true)
			nextMessage.Content = compressedText
			if len(normalizeAIStringList(nextMessage.Images)) > 0 {
				nextMessage.Images = nil
			}
			if compressedBody.ShouldRemove && len(normalizeAIStringList(nextMessage.Images)) == 0 {
				continue
			}
			newMessages = append(newMessages, nextMessage)
			continue
		}
		compressedText := compressAIConversationUserFacingText(nextMessage.Content, true, true)
		nextMessage.Content = compressedText.Text
		if compressedText.ShouldRemove {
			nextMessage.Content = ""
		}
		images := normalizeAIStringList(nextMessage.Images)
		if len(images) > 0 {
			nextMessage.Images = nil
			if strings.TrimSpace(nextMessage.Content) == "" {
				nextMessage.Content = aiConversationImageRemovedPlaceholder
			} else if !strings.Contains(nextMessage.Content, aiConversationImageRemovedPlaceholder) {
				nextMessage.Content = strings.TrimSpace(nextMessage.Content + "\n" + aiConversationImageRemovedPlaceholder)
			}
		}
		if strings.TrimSpace(nextMessage.Content) == "" && len(normalizeAIStringList(nextMessage.Images)) == 0 {
			if strings.EqualFold(strings.TrimSpace(nextMessage.Role), "assistant") {
				continue
			}
		}
		if strings.TrimSpace(nextMessage.Content) == "" && len(normalizeAIStringList(nextMessage.Images)) == 0 {
			continue
		}
		newMessages = append(newMessages, nextMessage)
	}
	newContextTokens, err := calculateAIConversationContextTokensWithProfile(snapshot.ID, strings.TrimSpace(sessionID), newMessages, profile)
	if err != nil {
		return aiConversationCompressedSeed{}, err
	}
	if newContextTokens >= prevContextTokens {
		return aiConversationCompressedSeed{}, fmt.Errorf("压缩后上下文未减少")
	}
	return aiConversationCompressedSeed{
		APIMessages:       newMessages,
		PrevContextTokens: prevContextTokens,
		NewContextTokens:  newContextTokens,
	}, nil
}

func resolveAIConversationSummarySubtaskLineage(parentSnapshot AIConversationSnapshot) (string, string, string) {
	parentConversationID := strings.TrimSpace(parentSnapshot.ParentConversationID)
	if parentConversationID == "" {
		return strings.TrimSpace(parentSnapshot.ID), strings.TrimSpace(parentSnapshot.ID), strings.TrimSpace(parentSnapshot.Title)
	}
	rootConversationID := strings.TrimSpace(parentSnapshot.RootConversationID)
	if rootConversationID == "" {
		rootConversationID = parentConversationID
	}
	parentTitleSnapshot := strings.TrimSpace(parentSnapshot.ParentTitleSnapshot)
	if parentTitleSnapshot == "" {
		parentTitleSnapshot = strings.TrimSpace(parentSnapshot.Title)
	}
	return parentConversationID, rootConversationID, parentTitleSnapshot
}

func (a *App) generateAIConversationSummarySubtaskOutput(parentSnapshot AIConversationSnapshot, requestMessages []AIChatRequestMessage, sessionID string, requestID string) (aiConversationSummarySubtaskOutput, error) {
	if a == nil || a.configManager == nil {
		return aiConversationSummarySubtaskOutput{}, fmt.Errorf("配置管理器不可用")
	}
	if len(requestMessages) == 0 {
		return aiConversationSummarySubtaskOutput{}, fmt.Errorf("压缩后的上下文为空")
	}
	trimmedRequestID := strings.TrimSpace(requestID)
	profile, err := a.getAIProviderProfileForConversation(parentSnapshot.ID)
	if err != nil {
		return aiConversationSummarySubtaskOutput{}, err
	}
	summaryPrompt := buildAIConversationSummarySubtaskPrompt()
	if strings.TrimSpace(summaryPrompt) == "" {
		return aiConversationSummarySubtaskOutput{}, fmt.Errorf("摘要模板不可用")
	}
	summaryRequestMessages := append([]AIChatRequestMessage{}, requestMessages...)
	summaryRequestMessages = append(summaryRequestMessages, buildAIConversationSummarySubtaskFinalInstructionMessage())
	ctx, cancel := context.WithCancel(context.Background())
	if trimmedRequestID != "" {
		a.setAIChatRequestCancel(trimmedRequestID, cancel)
	}
	defer func() {
		cancel()
		if trimmedRequestID != "" {
			a.popAIChatRequestCancel(trimmedRequestID)
		}
	}()
	summaryProfile := withAIDisabledWebSearch(profile)
	roundResult, err := a.requestAIProviderChatRound(ctx, trimmedRequestID, AIChatRequestPayload{
		ConversationID:       parentSnapshot.ID,
		SessionID:            strings.TrimSpace(sessionID),
		SystemPromptOverride: summaryPrompt,
		StreamEventPrefix:    aiCollaborationStreamEventPrefix,
		Messages:             summaryRequestMessages,
	}, summaryProfile, summaryRequestMessages)
	if err != nil {
		return aiConversationSummarySubtaskOutput{}, err
	}
	summaryOutput := extractAIConversationSummarySubtaskOutput(roundResult.Text)
	if strings.TrimSpace(summaryOutput.Summary) == "" {
		return aiConversationSummarySubtaskOutput{}, fmt.Errorf("摘要内容为空")
	}
	return summaryOutput, nil
}

func (a *App) createAIConversationSummarySubtaskFromRequestMessages(parentSnapshot AIConversationSnapshot, requestMessages []AIChatRequestMessage, prevContextTokens int, newContextTokens int, sessionID string, requestID string) (AIConversationSummarySubtaskResult, error) {
	if a == nil || a.configManager == nil {
		return AIConversationSummarySubtaskResult{}, fmt.Errorf("配置管理器不可用")
	}
	summaryOutput, err := a.generateAIConversationSummarySubtaskOutput(parentSnapshot, requestMessages, sessionID, requestID)
	if err != nil {
		return AIConversationSummarySubtaskResult{}, err
	}
	summaryTitle := buildAIConversationSummarySubtaskTitle(summaryOutput.Title)
	summaryText := strings.TrimSpace(summaryOutput.Summary)
	if summaryText == "" {
		return AIConversationSummarySubtaskResult{}, fmt.Errorf("摘要内容为空")
	}
	globalSettings := a.configManager.GetAIGlobalSettings()
	childSettings := normalizeAIConversationTaskSettings(parentSnapshot.Settings)
	if strings.TrimSpace(childSettings.CurrentProviderID) == "" {
		childSettings.CurrentProviderID = strings.TrimSpace(globalSettings.CurrentProviderID)
	}
	now := time.Now()
	parentConversationID, rootConversationID, parentTitleSnapshot := resolveAIConversationSummarySubtaskLineage(parentSnapshot)
	childSnapshot := normalizeAIConversationSnapshot(AIConversationSnapshot{
		ID:                        aiConversationID(),
		Title:                     summaryTitle,
		CreatedAt:                 now.UnixMilli(),
		UpdatedAt:                 now.UnixMilli(),
		Status:                    "idle",
		ToolProtocol:              "xml",
		PromptCacheBypassTimestamp: formatAIPromptCacheBypassTimestamp(now),
		ParentConversationID:      parentConversationID,
		RootConversationID:        rootConversationID,
		RelationType:              aiConversationRelationTypePhase,
		RelationSource:            aiConversationRelationSourceSummaryCondense,
		ParentTitleSnapshot:       parentTitleSnapshot,
		Archived:                  false,
		Messages:                  []AIConversationMessage{},
		APIMessages:               []AIConversationAPIMessage{},
		Settings:                  childSettings,
	}, defaultAIConversationTaskSettings(globalSettings))
	savedSnapshot, saveErr := a.configManager.SaveAIConversation(childSnapshot)
	if saveErr != nil {
		return AIConversationSummarySubtaskResult{}, saveErr
	}
	return AIConversationSummarySubtaskResult{
		Snapshot:     savedSnapshot,
		ContinueText: summaryText,
	}, nil
}

func (a *App) CreateAIConversationSummarySubtask(conversationID string, sessionID string, requestID string) (AIConversationSummarySubtaskResult, error) {
	if a == nil || a.configManager == nil {
		return AIConversationSummarySubtaskResult{}, fmt.Errorf("配置管理器不可用")
	}
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedConversationID == "" {
		return AIConversationSummarySubtaskResult{}, fmt.Errorf("缺少对话 ID")
	}
	parentSnapshot, err := a.configManager.GetAIConversation(trimmedConversationID)
	if err != nil {
		return AIConversationSummarySubtaskResult{}, err
	}
	compressedSeed, err := a.buildAIConversationCompressedSeed(parentSnapshot, sessionID)
	if err != nil {
		return AIConversationSummarySubtaskResult{}, err
	}
	requestMessages := buildAIChatRequestMessagesFromConversationAPI(compressedSeed.APIMessages)
	return a.createAIConversationSummarySubtaskFromRequestMessages(parentSnapshot, requestMessages, compressedSeed.PrevContextTokens, compressedSeed.NewContextTokens, sessionID, requestID)
}