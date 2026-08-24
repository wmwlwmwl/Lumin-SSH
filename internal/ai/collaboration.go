package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

type aiCollaborationMode string

const (
	aiCollaborationModeNone       aiCollaborationMode = ""
	aiCollaborationModeForced     aiCollaborationMode = "forced"
	aiCollaborationModeFollowup   aiCollaborationMode = "followup"
	aiCollaborationModeCompletion aiCollaborationMode = "completion"
)

type aiCollaborationDecision string

const (
	aiCollaborationDecisionNone               aiCollaborationDecision = ""
	aiCollaborationDecisionDone               aiCollaborationDecision = "done"
	aiCollaborationDecisionContinue           aiCollaborationDecision = "continue"
	aiCollaborationDecisionCompression        aiCollaborationDecision = "compression"
	aiCollaborationDecisionRetry              aiCollaborationDecision = "retry"
	aiCollaborationDecisionFallbackFollowup   aiCollaborationDecision = "fallback_followup"
	aiCollaborationDecisionFallbackCompletion aiCollaborationDecision = "fallback_completion"
)

const aiCollaborationStreamEventPrefix = "collaboration"

type aiCollaborationState struct {
	RequestID           string
	Batch               *aiPendingToolBatch
	Mode                aiCollaborationMode
	CompressionAttempts int
	RetryCount          int
	Cancel              context.CancelFunc
	mu                  sync.Mutex
	finished            bool
}

func (s *aiCollaborationState) markFinished() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.finished {
		return false
	}
	s.finished = true
	return true
}

func (s *aiCollaborationState) nextCompressionAttempt() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.CompressionAttempts++
	return s.CompressionAttempts
}

func (s *aiCollaborationState) start(cancel context.CancelFunc) bool {
	if s == nil || cancel == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.finished || s.Cancel != nil {
		return false
	}
	s.Cancel = cancel
	return true
}

func (a *App) setAIChatCollaborationState(requestID string, state *aiCollaborationState) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || state == nil {
		return
	}
	a.aiCollabMu.Lock()
	a.aiCollaborations[trimmedRequestID] = state
	a.aiCollabMu.Unlock()
}

func (a *App) getAIChatCollaborationState(requestID string) *aiCollaborationState {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return nil
	}
	a.aiCollabMu.Lock()
	defer a.aiCollabMu.Unlock()
	return a.aiCollaborations[trimmedRequestID]
}

func (a *App) popAIChatCollaborationState(requestID string) *aiCollaborationState {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return nil
	}
	a.aiCollabMu.Lock()
	defer a.aiCollabMu.Unlock()
	state := a.aiCollaborations[trimmedRequestID]
	delete(a.aiCollaborations, trimmedRequestID)
	return state
}

func getAICollaborationModeForTool(tool aiParsedToolUse) aiCollaborationMode {
	switch strings.TrimSpace(tool.Name) {
	case "ask_followup_question":
		return aiCollaborationModeFollowup
	case "attempt_completion":
		return aiCollaborationModeCompletion
	default:
		return aiCollaborationModeNone
	}
}

func (a *App) isAIChatCollaborationEnabledForBatch(batch *aiPendingToolBatch) bool {
	if a == nil || batch == nil {
		return false
	}
	return a.getAIAutoApprovalSettingsForConversation(batch.Payload.ConversationID).AlwaysAllowFollowupQuestions
}

func (a *App) resolveAICollaborationExtraPrompt(batch *aiPendingToolBatch, mode aiCollaborationMode) string {
	if a == nil || batch == nil {
		return ""
	}
	if mode != aiCollaborationModeFollowup && mode != aiCollaborationModeCompletion {
		return ""
	}
	return strings.TrimSpace(a.getAIAutoApprovalSettingsForConversation(batch.Payload.ConversationID).CollaborationExtraPrompt)
}

func (a *App) shouldUseAIChatCollaboration(batch *aiPendingToolBatch) bool {
	if a == nil || batch == nil || batch.NextToolIndex >= len(batch.ParsedTools) {
		return false
	}
	if !a.isAIChatCollaborationEnabledForBatch(batch) {
		return false
	}
	return getAICollaborationModeForTool(batch.ParsedTools[batch.NextToolIndex]) != aiCollaborationModeNone
}

func resolveAICollaborationTemplateLanguage() string {
	if languagePreference := getAISystemLanguagePreference(); languagePreference.Locale != "" {
		return resolveAIAssistantReplyTemplateLanguage(languagePreference.Locale)
	}
	return aiTemplateLanguageCode
}

func buildAICollaborationPrompt() string {
	templateLanguage := resolveAICollaborationTemplateLanguage()
	templateText := strings.TrimSpace(readAIEmbeddedTemplateForLanguage("collaboration", templateLanguage))
	if templateText == "" {
		templateText = strings.TrimSpace(readAIEmbeddedTemplate("collaboration"))
	}
	if templateText != "" {
		return templateText
	}
	return strings.TrimSpace(`
You are the collaboration confirmation assistant.
You may only output one of the following four forms:
[Done]
[Continue] followed immediately by content
[Compression]
[Retry]

[Done] is forbidden in followup mode.
[Retry] may be used in any collaboration mode to discard the last primary-assistant message and regenerate the same assistant turn.
If key information is still missing, prefer [Continue].
If the context is too noisy or too long, output [Compression].
`)
}

func resolveAISystemPromptForPayload(appCtx context.Context, payload AIChatRequestPayload, profile AIProviderProfile) string {
	if payload.SkipSystemPrompt {
		return ""
	}
	override := strings.TrimSpace(payload.SystemPromptOverride)
	if override != "" {
		return override
	}
	return BuildChatSystemPromptWithProfile(appCtx, payload.ConversationID, payload.SessionID, true, profile)
}

func aiChatPayloadEventKind(payload AIChatRequestPayload, baseKind string) string {
	prefix := strings.TrimSpace(payload.StreamEventPrefix)
	if prefix == "" {
		return strings.TrimSpace(baseKind)
	}
	return prefix + "_" + strings.TrimSpace(baseKind)
}

func (a *App) emitAIChatPayloadReasoningDelta(payload AIChatRequestPayload, requestID string, delta string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || delta == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      aiChatPayloadEventKind(payload, "reasoning_delta"),
		"requestId": trimmedRequestID,
		"delta":     delta,
	})
}

func (a *App) emitAIChatPayloadContentDelta(payload AIChatRequestPayload, requestID string, delta string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || delta == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      aiChatPayloadEventKind(payload, "delta"),
		"requestId": trimmedRequestID,
		"delta":     delta,
	})
}

func resolveAICollaborationCompletionResult(tool aiParsedToolUse) string {
	resultText := sanitizeAIToolResultText(strings.TrimSpace(tool.Params["result"]))
	if resultText == "" {
		return "任务已完成"
	}
	return resultText
}

func (a *App) emitAICollaborationCompletionCard(requestID string, batch *aiPendingToolBatch, status string, sound string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || batch == nil || batch.NextToolIndex >= len(batch.ParsedTools) {
		return
	}
	tool := batch.ParsedTools[batch.NextToolIndex]
	payload := map[string]interface{}{
		"kind":      "upsert_message",
		"requestId": trimmedRequestID,
		"message": map[string]interface{}{
			"id":      buildToolMessageID(batch.AssistantMessageID, batch.NextToolIndex),
			"turnId":  batch.AssistantMessageID,
			"kind":    "completion",
			"title":   titleForParsedToolUse(tool),
			"summary": "",
			"result":  resolveAICollaborationCompletionResult(tool),
			"status":  strings.TrimSpace(status),
		},
	}
	if strings.TrimSpace(sound) != "" {
		payload["sound"] = strings.TrimSpace(sound)
	}
	a.emitAIChatEvent(payload)
}

func buildAICollaborationFollowupAnswerJSON(tool aiParsedToolUse, rawText string) string {
	trimmedText := strings.TrimSpace(rawText)
	if trimmedText == "" {
		return ""
	}
	questionText := strings.TrimSpace(tool.Params["question"])
	questions, _, err := parseAIFollowupPayload(tool.Params["follow_up"], questionText)
	if err != nil || len(questions) == 0 {
		return trimmedText
	}
	selectedByQuestion := make(map[string][]AIConversationFollowUpOption, len(questions))
	lines := strings.Split(strings.ReplaceAll(trimmedText, "\r\n", "\n"), "\n")
	for _, question := range questions {
		candidateText := trimmedText
		if len(questions) > 1 {
			candidateText = ""
			for _, line := range lines {
				normalizedLine := strings.TrimSpace(line)
				if normalizedLine == "" {
					continue
				}
				if strings.HasPrefix(normalizedLine, question.Text+":") || strings.HasPrefix(normalizedLine, question.Text+"：") {
					candidateText = normalizedLine
					break
				}
			}
			if candidateText == "" {
				return trimmedText
			}
		}
		answerText := strings.TrimSpace(candidateText)
		if strings.HasPrefix(answerText, question.Text+":") {
			answerText = strings.TrimSpace(strings.TrimPrefix(answerText, question.Text+":"))
		} else if strings.HasPrefix(answerText, question.Text+"：") {
			answerText = strings.TrimSpace(strings.TrimPrefix(answerText, question.Text+"："))
		}
		if answerText == "" {
			return trimmedText
		}
		valueParts := strings.FieldsFunc(answerText, func(r rune) bool {
			return r == ',' || r == '，' || r == '\n'
		})
		if len(valueParts) == 0 {
			return trimmedText
		}
		selectedOptions := make([]AIConversationFollowUpOption, 0, len(valueParts))
		for _, part := range valueParts {
			normalizedValue := strings.TrimSpace(part)
			if normalizedValue == "" {
				continue
			}
			matched := false
			for _, option := range question.Options {
				if strings.TrimSpace(option.Answer) != normalizedValue {
					continue
				}
				selectedOptions = append(selectedOptions, option)
				matched = true
				break
			}
			if !matched {
				return trimmedText
			}
		}
		if len(selectedOptions) == 0 {
			return trimmedText
		}
		selectedByQuestion[question.ID] = selectedOptions
	}
	answerEntries := make([]map[string]interface{}, 0, len(questions))
	readableLines := make([]string, 0, len(questions))
	mode := ""
	for _, question := range questions {
		selectedOptions := selectedByQuestion[question.ID]
		if len(selectedOptions) == 0 {
			return trimmedText
		}
		selectedOptionIDs := make([]string, 0, len(selectedOptions))
		selectedAnswers := make([]string, 0, len(selectedOptions))
		for _, option := range selectedOptions {
			selectedOptionIDs = append(selectedOptionIDs, option.ID)
			selectedAnswers = append(selectedAnswers, option.Answer)
			if mode == "" && question.Type == "single" && strings.TrimSpace(option.Mode) != "" {
				mode = strings.TrimSpace(option.Mode)
			}
		}
		readableLines = append(readableLines, fmt.Sprintf("%s: %s", question.Text, strings.Join(selectedAnswers, ", ")))
		answerEntries = append(answerEntries, map[string]interface{}{
			"questionId":        question.ID,
			"question":          question.Text,
			"type":              question.Type,
			"selectedOptionIds": selectedOptionIDs,
			"selectedAnswers":   selectedAnswers,
		})
	}
	payload := map[string]interface{}{
		"readableText": strings.Join(readableLines, "\n"),
		"answers":      answerEntries,
	}
	if mode != "" {
		payload["mode"] = mode
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return trimmedText
	}
	return string(encoded)
}

func trimAILatestAssistantRequestMessage(messages []AIChatRequestMessage) ([]AIChatRequestMessage, bool) {
	if len(messages) == 0 {
		return []AIChatRequestMessage{}, false
	}
	for index := len(messages) - 1; index >= 0; index-- {
		if strings.ToLower(strings.TrimSpace(messages[index].Role)) != "assistant" {
			continue
		}
		return append([]AIChatRequestMessage{}, messages[:index]...), true
	}
	return append([]AIChatRequestMessage{}, messages...), false
}

func buildAIForcedCollaborationTakeoverText() string {
	switch resolveAICollaborationTemplateLanguage() {
	case "zh", "zh-CN", "zh-Hans":
		return "您的回复出现重复,请重新策划您正确的步骤以继续,若已有充足的信息请继续推进任务或继续调用正确且合适的工具."
	default:
		return "Your reply has entered a repeated-output state. Please re-plan the correct next steps to proceed. If sufficient information is already available, continue advancing the task or invoke the correct and appropriate tool."
	}
}

func resolveAIForcedCollaborationHint(reason string) string {
	switch strings.TrimSpace(reason) {
	case "assistant_same_output_twice":
		return "强制协同原因: 主助手正文连续两次完全一致, 该比较不包含思考链。"
	case "attempt_completion_empty_result":
		return "强制协同原因: 主助手给出了 attempt_completion, 但 result 为空。"
	default:
		return ""
	}
}

func (a *App) emitAIChatForcedCollaborationTakeover(requestID string, text string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	trimmedText := strings.TrimSpace(text)
	if a == nil || trimmedRequestID == "" || trimmedText == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "collaboration_force_user_takeover",
		"requestId": trimmedRequestID,
		"text":      trimmedText,
	})
}

func (a *App) startAIForcedCollaboration(requestID string, batch *aiPendingToolBatch) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || batch == nil {
		return
	}
	state := &aiCollaborationState{
		RequestID:  trimmedRequestID,
		Batch:      batch,
		Mode:       aiCollaborationModeForced,
		RetryCount: batch.CollaborationRetryCount,
	}
	a.setAIChatCollaborationState(trimmedRequestID, state)
	a.emitAIChatCollaborationPending(trimmedRequestID, aiCollaborationModeForced)
	ctx, cancel := context.WithCancel(context.Background())
	if !state.start(cancel) {
		cancel()
		return
	}
	a.setAIChatRequestCancel(trimmedRequestID, cancel)
	go a.runAIChatCollaboration(ctx, trimmedRequestID, state)
}

func buildAIChatRequestMessagesFromConversationAPI(apiMessages []AIConversationAPIMessage) []AIChatRequestMessage {
	normalizedMessages := normalizeAIConversationAPIMessages(apiMessages)
	requestMessages := make([]AIChatRequestMessage, 0, len(normalizedMessages))
	for _, message := range normalizedMessages {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		if role != "system" && role != "user" && role != "assistant" {
			continue
		}
		requestMessages = append(requestMessages, AIChatRequestMessage{
			Role:         role,
			Content:      strings.TrimSpace(message.Content),
			Images:       normalizeAIStringList(message.Images),
			CacheObjects: cloneAIConversationProviderCacheObjects(message.CacheObjects),
		})
	}
	return normalizeAIChatRequestMessages(requestMessages)
}

func buildAICollaborationRequestMessages(batch *aiPendingToolBatch, mode aiCollaborationMode, compressionAttempts int, retryCount int, extraPrompt string) []AIChatRequestMessage {
	if batch == nil {
		return nil
	}
	if mode != aiCollaborationModeForced && batch.NextToolIndex >= len(batch.ParsedTools) {
		return nil
	}
	toolIndex := batch.NextToolIndex
	if toolIndex >= len(batch.ParsedTools) {
		toolIndex = len(batch.ParsedTools) - 1
	}
	tool := aiParsedToolUse{}
	if toolIndex >= 0 {
		tool = batch.ParsedTools[toolIndex]
	}
	requestMessages := append([]AIChatRequestMessage{}, batch.RequestMessages...)
	remainingRetryAttempts := aiCollaborationRetryMaxAttempts - retryCount
	if remainingRetryAttempts < 0 {
		remainingRetryAttempts = 0
	}
	lines := []string{
		"<collaboration_request>",
		fmt.Sprintf("<mode>%s</mode>", mode),
		fmt.Sprintf("<compression_attempts>%d</compression_attempts>", compressionAttempts),
		fmt.Sprintf("<retry_attempts>%d</retry_attempts>", retryCount),
		fmt.Sprintf("<pending_tool_name>%s</pending_tool_name>", strings.TrimSpace(tool.Name)),
		"<pending_tool_xml>",
		strings.TrimSpace(tool.RawXML),
		"</pending_tool_xml>",
	}
	if mode == aiCollaborationModeForced {
		lines = append(lines,
			"<output_contract>",
			"当前是 forced 模式, 这是一次自动的轨道纠偏介入。",
			"系统已经强制拒绝了主助手本轮的工具调用, 现在需要你替用户写一条纠偏用户消息, 引导主助手换一个方向或方法, 不要再重复刚才那次调用。",
			"你只能输出 [Continue] 后接一段要发给主助手的普通用户消息正文, 或者在上下文太脏时输出 [Compression]。",
			"禁止输出 [Done] 和 [Retry]。",
			"[Continue] 后面的正文会被当作新的普通用户消息自动发送给主助手继续任务。",
			"</output_contract>",
		)
		if hint := resolveAIForcedCollaborationHint(batch.ForceCollaborationReason); hint != "" {
			lines = append(lines, "<forced_rule>", hint, "</forced_rule>")
		}
	} else {
		lines = append(lines,
			"<output_contract>",
			"你只能输出以下 4 种形式之一:",
			"[Done]",
			"[Continue] 后面紧跟一段要发给主助理的普通用户消息正文",
			"[Compression]",
			"[Retry]",
			"</output_contract>",
			"<retry_rule>",
			"如果输出 [Retry], 系统会丢弃上一条主助手消息,并原地重试同一个 assistant 回合。",
			fmt.Sprintf("当前 [Retry] 独立预算还剩 %d 次。", remainingRetryAttempts),
			"</retry_rule>",
		)
	}
	if mode == aiCollaborationModeFollowup {
		lines = append(lines,
			"<extra_rule>",
			"当前是 followup 模式, 禁止输出 [Done]。",
			"如果你决定继续, [Continue] 后面的正文必须写成问卷提交后的回复格式, 例如 `请选择一个方向: 工作/学习`。",
			"如果当前有现成选项,优先直接替用户选择现有选项,系统会把这段正文当作追问答案提交,等价于用户点击了问卷。",
			"如果当前这条追问本身方向不对,可以输出 [Retry] 来直接重试上一条主助手消息。",
			"</extra_rule>",
		)
	}
	if mode == aiCollaborationModeCompletion {
		lines = append(lines,
			"<extra_rule>",
			"当前是 completion 模式。",
			"如果输出 [Done], 系统将直接放行主助手原始的 attempt_completion。",
			"如果输出 [Continue], 你写出的正文会被当作新的普通用户消息自动发送给主助理继续任务。",
			"如果当前这条完成回合本身不合适,例如明显过早结束,结果为空,结果占位,或整体方向判断错误,可以输出 [Retry] 来直接重试上一条主助手消息。",
			"</extra_rule>",
		)
	}
	if compressionAttempts > 0 {
		lines = append(lines,
			"<retry_rule>",
			"当前已经执行过 1 次上下文压缩。",
			"如果你仍然输出 [Compression], 系统将不再继续递归压缩, 而是回退到原始主流程。",
			"</retry_rule>",
		)
	}
	lines = append(lines, "</collaboration_request>")
	if trimmedExtraPrompt := strings.TrimSpace(extraPrompt); trimmedExtraPrompt != "" {
		requestMessages = append(requestMessages, AIChatRequestMessage{
			Role: "user",
			Content: strings.Join([]string{
				"<collaboration_user_guidance>",
				trimmedExtraPrompt,
				"</collaboration_user_guidance>",
			}, "\n"),
		})
	}
	requestMessages = append(requestMessages, AIChatRequestMessage{
		Role:    "user",
		Content: strings.Join(lines, "\n"),
	})
	return requestMessages
}

func parseAICollaborationDecision(text string) (aiCollaborationDecision, string) {
	trimmed := strings.TrimSpace(text)
	switch {
	case strings.HasPrefix(trimmed, "[Done]"):
		return aiCollaborationDecisionDone, strings.TrimSpace(strings.TrimPrefix(trimmed, "[Done]"))
	case strings.HasPrefix(trimmed, "[Continue]"):
		return aiCollaborationDecisionContinue, strings.TrimSpace(strings.TrimPrefix(trimmed, "[Continue]"))
	case strings.HasPrefix(trimmed, "[Compression]"):
		return aiCollaborationDecisionCompression, strings.TrimSpace(strings.TrimPrefix(trimmed, "[Compression]"))
	case strings.HasPrefix(trimmed, "[Retry]"):
		return aiCollaborationDecisionRetry, strings.TrimSpace(strings.TrimPrefix(trimmed, "[Retry]"))
	default:
		return aiCollaborationDecisionNone, ""
	}
}

func (a *App) emitAIChatCollaborationPending(requestID string, mode aiCollaborationMode) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || mode == aiCollaborationModeNone {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "collaboration_pending",
		"requestId": trimmedRequestID,
		"mode":      string(mode),
	})
}

func (a *App) emitAIChatCollaborationStarted(requestID string, mode aiCollaborationMode, compressionAttempts int) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || mode == aiCollaborationModeNone {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":                "collaboration_started",
		"requestId":           trimmedRequestID,
		"mode":                string(mode),
		"compressionAttempts": compressionAttempts,
	})
}

func (a *App) emitAIChatCollaborationFinished(requestID string, mode aiCollaborationMode, decision aiCollaborationDecision, text string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || mode == aiCollaborationModeNone || decision == aiCollaborationDecisionNone {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "collaboration_finished",
		"requestId": trimmedRequestID,
		"mode":      string(mode),
		"decision":  string(decision),
		"text":      strings.TrimSpace(text),
	})
}

func (a *App) emitAIChatCollaborationContextCondensed(requestID string, result AIConversationContextCondenseResult) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || strings.TrimSpace(result.Snapshot.ID) == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":              "collaboration_context_condensed",
		"requestId":         trimmedRequestID,
		"snapshot":          result.Snapshot,
		"summary":           result.Summary,
		"prevContextTokens": result.PrevContextTokens,
		"newContextTokens":  result.NewContextTokens,
	})
}

func (a *App) finishAIChatCollaborationWithFallback(requestID string, state *aiCollaborationState) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || state == nil || state.Batch == nil || !state.markFinished() {
		return
	}
	a.popAIChatCollaborationState(trimmedRequestID)
	a.popAIChatRequestCancel(trimmedRequestID)
	if state.Cancel != nil {
		state.Cancel()
	}
	switch state.Mode {
	case aiCollaborationModeForced:
		state.Batch.ForceCollaboration = false
		state.Batch.ForceCollaborationReason = ""
		a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionRetry, "")
		a.emitAIChatRuntimePhase(trimmedRequestID, "ready")
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "automatic_request_skipped",
			"requestId": trimmedRequestID,
		})
		a.emitAIChatForcedCollaborationTakeover(trimmedRequestID, buildAIForcedCollaborationTakeoverText())
		a.finishAIChatRequest(trimmedRequestID)
	case aiCollaborationModeFollowup:
		a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionFallbackFollowup, "")
	case aiCollaborationModeCompletion:
		a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionFallbackCompletion, "")
		a.emitAICollaborationCompletionCard(trimmedRequestID, state.Batch, "已完成", "completion")
		a.emitAIChatToolExecutionPersistRequested(trimmedRequestID)
		a.emitAIChatRuntimePhase(trimmedRequestID, "ready")
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "automatic_request_skipped",
			"requestId": trimmedRequestID,
		})
		a.finishAIChatRequest(trimmedRequestID)
	}
}

func (a *App) finalizeAIChatCollaborationContinue(requestID string, state *aiCollaborationState, messageText string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || state == nil || !state.markFinished() {
		return
	}
	a.popAIChatCollaborationState(trimmedRequestID)
	a.popAIChatRequestCancel(trimmedRequestID)
	if state.Cancel != nil {
		state.Cancel()
	}
	if state.Mode == aiCollaborationModeForced && state.Batch != nil {
		now := time.Now()
		forcedText := strings.TrimSpace(messageText)
		forcedUserMessageID := fmt.Sprintf("%s-forced-user-%d", state.Batch.AssistantMessageID, now.UnixNano())
		forcedUserContent := fmt.Sprintf("<user_message>\n%s\n</user_message>", forcedText)
		state.Batch.RequestMessages = append(state.Batch.RequestMessages, AIChatRequestMessage{
			Role:    "user",
			Content: forcedUserContent,
		})
		state.Batch.ForceCollaboration = false
		state.Batch.ForceCollaborationReason = ""
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "append_message",
			"requestId": trimmedRequestID,
			"message": map[string]interface{}{
				"id":     forcedUserMessageID,
				"kind":   "user",
				"text":   forcedText,
				"time":   now.Format("15:04"),
				"turnId": "",
			},
		})
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "api_message_append",
			"requestId": trimmedRequestID,
			"message": map[string]interface{}{
				"messageId":    fmt.Sprintf("api-forced-user-%d", now.UnixNano()),
				"role":         "user",
				"content":      forcedUserContent,
				"uiMessageIds": []string{forcedUserMessageID},
				"ts":           now.UnixMilli(),
			},
		})
		a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionContinue, "")
		a.emitAIChatToolExecutionPersistRequested(trimmedRequestID)
		a.resumeAIChatAfterToolBatch(trimmedRequestID, state.Batch)
		return
	}
	if state.Batch != nil && state.Batch.NextToolIndex < len(state.Batch.ParsedTools) {
		switch state.Mode {
		case aiCollaborationModeFollowup:
			answerPayload := buildAICollaborationFollowupAnswerJSON(state.Batch.ParsedTools[state.Batch.NextToolIndex], messageText)
			if err := a.ResolveAIChatFollowup(trimmedRequestID, answerPayload, "[]"); err != nil {
				a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionFallbackFollowup, "")
				return
			}
			a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionContinue, "")
			return
		case aiCollaborationModeCompletion:
			a.emitAICollaborationCompletionCard(trimmedRequestID, state.Batch, "后台继续", "")
		}
	}
	a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionContinue, messageText)
	a.emitAIChatToolExecutionPersistRequested(trimmedRequestID)
	a.emitAIChatRuntimePhase(trimmedRequestID, "ready")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "automatic_request_skipped",
		"requestId": trimmedRequestID,
	})
	a.finishAIChatRequest(trimmedRequestID)
}

func (a *App) finalizeAIChatCollaborationRetry(requestID string, state *aiCollaborationState) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || state == nil || state.Batch == nil {
		return
	}
	nextRetryCount := state.RetryCount + 1
	if nextRetryCount > aiCollaborationRetryMaxAttempts {
		a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
		return
	}
	retryRequestMessages, ok := trimAILatestAssistantRequestMessage(state.Batch.RequestMessages)
	if !ok {
		a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
		return
	}
	if !state.markFinished() {
		return
	}
	a.popAIChatCollaborationState(trimmedRequestID)
	a.popAIChatPendingFollowupBatch(trimmedRequestID)
	a.popAIChatRequestCancel(trimmedRequestID)
	if state.Cancel != nil {
		state.Cancel()
	}
	state.Batch.RequestMessages = retryRequestMessages
	state.Batch.CollaborationRetryCount = nextRetryCount
	a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionRetry, "")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":        "assistant_retry_reset",
		"requestId":   trimmedRequestID,
		"messageId":   state.Batch.AssistantMessageID,
		"attempt":     nextRetryCount,
		"maxAttempts": aiCollaborationRetryMaxAttempts,
	})
	a.emitAIChatRuntimePhase(trimmedRequestID, "api_request")
	ctx, cancel := context.WithCancel(context.Background())
	a.setAIChatRequestCancel(trimmedRequestID, cancel)
	go a.runCompatibleAIChatLoop(
		ctx,
		trimmedRequestID,
		state.Batch.Payload,
		state.Batch.Profile,
		append([]AIChatRequestMessage{}, retryRequestMessages...),
		state.Batch.AutoApprovalSettings,
		state.Batch.AssistantMessageID,
		state.Batch.AssistantRetryCount,
		nextRetryCount,
	)
}

func (a *App) finalizeAIChatCollaborationDone(requestID string, state *aiCollaborationState) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || state == nil || state.Batch == nil || !state.markFinished() {
		return
	}
	a.popAIChatCollaborationState(trimmedRequestID)
	a.popAIChatRequestCancel(trimmedRequestID)
	if state.Cancel != nil {
		state.Cancel()
	}
	a.emitAIChatCollaborationFinished(trimmedRequestID, state.Mode, aiCollaborationDecisionDone, "")
	a.emitAICollaborationCompletionCard(trimmedRequestID, state.Batch, "已完成", "completion")
	a.emitAIChatToolExecutionPersistRequested(trimmedRequestID)
	a.emitAIChatRuntimePhase(trimmedRequestID, "ready")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "automatic_request_skipped",
		"requestId": trimmedRequestID,
	})
	a.finishAIChatRequest(trimmedRequestID)
}

func (a *App) runAIChatCollaboration(ctx context.Context, requestID string, state *aiCollaborationState) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || state == nil || state.Batch == nil {
		return
	}
	if ctx != nil && ctx.Err() != nil {
		return
	}
	batch := state.Batch
	if len(batch.ParsedTools) == 0 {
		a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
		return
	}
	if state.Mode != aiCollaborationModeForced && batch.NextToolIndex >= len(batch.ParsedTools) {
		a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
		return
	}
	a.emitAIChatCollaborationStarted(trimmedRequestID, state.Mode, state.CompressionAttempts)
	payload := batch.Payload
	payload.SystemPromptOverride = buildAICollaborationPrompt()
	payload.StreamEventPrefix = aiCollaborationStreamEventPrefix
	requestMessages := buildAICollaborationRequestMessages(batch, state.Mode, state.CompressionAttempts, state.RetryCount, a.resolveAICollaborationExtraPrompt(batch, state.Mode))
	collaborationProfile := withAIDisabledWebSearch(batch.Profile)
	roundResult, err := a.requestAIProviderChatRound(ctx, trimmedRequestID, payload, collaborationProfile, requestMessages)
	if ctx != nil && ctx.Err() != nil {
		return
	}
	if err != nil {
		a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
		return
	}
	decision, bodyText := parseAICollaborationDecision(roundResult.Text)
	switch decision {
	case aiCollaborationDecisionCompression:
		if state.CompressionAttempts > 0 {
			a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
			return
		}
		result, condenseErr := a.CondenseAIConversationContext(batch.Payload.ConversationID, batch.Payload.SessionID)
		if condenseErr != nil {
			a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
			return
		}
		if rebuiltRequestMessages := buildAIChatRequestMessagesFromConversationAPI(result.Snapshot.APIMessages); len(rebuiltRequestMessages) > 0 {
			batch.RequestMessages = rebuiltRequestMessages
		}
		a.emitAIChatCollaborationContextCondensed(trimmedRequestID, result)
		state.nextCompressionAttempt()
		a.runAIChatCollaboration(ctx, trimmedRequestID, state)
		return
	case aiCollaborationDecisionContinue:
		if strings.TrimSpace(bodyText) == "" {
			a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
			return
		}
		a.finalizeAIChatCollaborationContinue(trimmedRequestID, state, bodyText)
		return
	case aiCollaborationDecisionDone:
		if state.Mode != aiCollaborationModeCompletion {
			a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
			return
		}
		a.finalizeAIChatCollaborationDone(trimmedRequestID, state)
		return
	case aiCollaborationDecisionRetry:
		if state.Mode == aiCollaborationModeForced {
			a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
			return
		}
		a.finalizeAIChatCollaborationRetry(trimmedRequestID, state)
		return
	default:
		a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
		return
	}
}

func (a *App) queueAIChatCollaboration(requestID string, batch *aiPendingToolBatch) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" || batch == nil || batch.NextToolIndex >= len(batch.ParsedTools) {
		return
	}
	tool := batch.ParsedTools[batch.NextToolIndex]
	mode := getAICollaborationModeForTool(tool)
	if mode == aiCollaborationModeNone {
		return
	}
	a.setAIChatCollaborationState(trimmedRequestID, &aiCollaborationState{
		RequestID:  trimmedRequestID,
		Batch:      batch,
		Mode:       mode,
		RetryCount: batch.CollaborationRetryCount,
	})
	a.emitAIChatCollaborationPending(trimmedRequestID, mode)
}

func (a *App) StartAIChatCollaboration(requestID string) error {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return nil
	}
	state := a.getAIChatCollaborationState(trimmedRequestID)
	if state == nil || state.Batch == nil || state.Mode == aiCollaborationModeNone {
		return nil
	}
	if state.Mode != aiCollaborationModeForced && !a.shouldUseAIChatCollaboration(state.Batch) {
		a.popAIChatCollaborationState(trimmedRequestID)
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	if !state.start(cancel) {
		cancel()
		return nil
	}
	a.setAIChatRequestCancel(trimmedRequestID, cancel)
	go a.runAIChatCollaboration(ctx, trimmedRequestID, state)
	return nil
}

func (a *App) DisableAIChatCollaboration(requestID string) error {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return nil
	}
	state := a.getAIChatCollaborationState(trimmedRequestID)
	if state == nil {
		return nil
	}
	a.finishAIChatCollaborationWithFallback(trimmedRequestID, state)
	return nil
}
