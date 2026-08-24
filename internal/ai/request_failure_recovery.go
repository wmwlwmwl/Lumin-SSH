package ai

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const aiRequestFailureLivenessProbeText = "Have you received my message? If so, reply OK"
const aiConversationCondenseEscalationThreshold = 0.1
const aiRequestFailureProbeStreamEventPrefix = "hidden_probe"

type aiRequestFailureKind string

const (
	aiRequestFailureKindUnknown         aiRequestFailureKind = "unknown"
	aiRequestFailureKindContextOverflow aiRequestFailureKind = "likely_context_overflow"
	aiRequestFailureKindProviderOutage  aiRequestFailureKind = "likely_provider_outage"
	aiRequestFailureKindRetryable       aiRequestFailureKind = "unknown_retryable"
)

type aiRequestFailureAssessment struct {
	Kind           aiRequestFailureKind
	OverflowScore  int
	OutageScore    int
	ContextTokens  int
	BudgetHint     int
	ProbeSucceeded bool
	ReasonCodes    []string
}

var aiRequestFailureContextOverflowPattern = regexp.MustCompile(`(?i)(context(?:\s+length|\s+window)?|maximum context|too many tokens|prompt too long|input exceeds|reduce the length|token limit)`)
var aiRequestFailureGatewayPattern = regexp.MustCompile(`(?i)(502|503|504|bad gateway|gateway|timeout|upstream|overload|rate limit|temporar(?:y|ily)|service unavailable)`)

func withAIDisabledWebSearch(profile AIProviderProfile) AIProviderProfile {
	nextProfile := profile
	nextProfile.WebSearchEnabled = false
	nextProfile.DedicatedWebSearchEnabled = false
	nextProfile.DedicatedWebSearchProviderID = ""
	return nextProfile
}

func finalizeAIChatRoundResult(result *aiChatRoundResult, startedAt time.Time, firstTokenAt time.Time, contentBuilder *strings.Builder) {
	if result == nil {
		return
	}
	if contentBuilder != nil && strings.TrimSpace(result.Text) == "" {
		result.Text = strings.TrimSpace(contentBuilder.String())
	}
	if !firstTokenAt.IsZero() && result.FirstTokenMs <= 0 {
		result.FirstTokenMs = firstTokenAt.Sub(startedAt).Milliseconds()
	}
	if result.ElapsedMs <= 0 {
		result.ElapsedMs = time.Since(startedAt).Milliseconds()
	}
	if result.OutputTokens > 0 && result.ElapsedMs > 0 && result.TokensPerSecond <= 0 {
		result.TokensPerSecond = float64(result.OutputTokens) / (float64(result.ElapsedMs) / 1000)
	}
}

func hasAIChatRoundProducedOutput(result aiChatRoundResult) bool {
	return result.FirstTokenMs > 0 || strings.TrimSpace(result.Text) != ""
}

func calculateAIConversationCondenseRate(prevContextTokens int, newContextTokens int) float64 {
	if prevContextTokens <= 0 || newContextTokens < 0 || newContextTokens >= prevContextTokens {
		return 0
	}
	return float64(prevContextTokens-newContextTokens) / float64(prevContextTokens)
}

func buildAIAutoRecoveryRequestID(sourceRequestID string) string {
	trimmedSourceRequestID := strings.TrimSpace(sourceRequestID)
	if trimmedSourceRequestID == "" {
		return ""
	}
	return fmt.Sprintf("%s-auto-recovery-%d", trimmedSourceRequestID, time.Now().UnixNano())
}

func (a *App) emitAIAutoRecoveryStarted(sourceRequestID string, recoveryRequestID string, text string) {
	trimmedSourceRequestID := strings.TrimSpace(sourceRequestID)
	trimmedRecoveryRequestID := strings.TrimSpace(recoveryRequestID)
	if a == nil || trimmedSourceRequestID == "" || trimmedRecoveryRequestID == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":              "auto_recovery_started",
		"requestId":         trimmedSourceRequestID,
		"recoveryRequestId": trimmedRecoveryRequestID,
		"text":              strings.TrimSpace(text),
	})
}

func (a *App) emitAIAutoRecoveryStatus(requestID string, text string, reasoningText string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":          "auto_recovery_status",
		"requestId":     trimmedRequestID,
		"text":          strings.TrimSpace(text),
		"reasoningText": strings.TrimSpace(reasoningText),
	})
}

func (a *App) emitAIAutoRecoveryRunFullSummary(requestID string, text string) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "auto_recovery_run_full_summary",
		"requestId": trimmedRequestID,
		"text":      strings.TrimSpace(text),
	})
}

func (a *App) probeAIProviderLiveness(ctx context.Context, requestID string, sessionID string, profile AIProviderProfile) (bool, error) {
	if a == nil {
		return false, fmt.Errorf("AI 运行时不可用")
	}
	probeMessages := []AIChatRequestMessage{
		{
			Role:    "user",
			Content: aiRequestFailureLivenessProbeText,
		},
	}
	probeProfile := withAIDisabledWebSearch(profile)
	roundResult, err := a.requestAIProviderChatRound(ctx, strings.TrimSpace(requestID), AIChatRequestPayload{
		SessionID:         strings.TrimSpace(sessionID),
		SkipSystemPrompt:  true,
		StreamEventPrefix: aiRequestFailureProbeStreamEventPrefix,
		Messages:          probeMessages,
	}, probeProfile, probeMessages)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(roundResult.Text) != "", nil
}

func (a *App) ProbeAIProviderLiveness(conversationID string, sessionID string, requestID string) (bool, error) {
	if a == nil || a.configManager == nil {
		return false, fmt.Errorf("配置管理器不可用")
	}
	profile, err := a.getAIProviderProfileForConversation(strings.TrimSpace(conversationID))
	if err != nil {
		return false, err
	}
	trimmedRequestID := strings.TrimSpace(requestID)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	if trimmedRequestID != "" {
		a.setAIChatRequestCancel(trimmedRequestID, cancel)
	}
	defer func() {
		cancel()
		if trimmedRequestID != "" {
			a.popAIChatRequestCancel(trimmedRequestID)
		}
	}()
	return a.probeAIProviderLiveness(ctx, trimmedRequestID, sessionID, profile)
}

func (a *App) PreviewAIConversationContextCondense(conversationID string, sessionID string) (AIConversationContextCondenseResult, error) {
	if a == nil || a.configManager == nil {
		return AIConversationContextCondenseResult{}, fmt.Errorf("配置管理器不可用")
	}
	snapshot, err := a.configManager.GetAIConversation(strings.TrimSpace(conversationID))
	if err != nil {
		return AIConversationContextCondenseResult{}, err
	}
	return a.previewAIConversationContextCondenseFromSnapshot(snapshot, sessionID)
}

func (a *App) previewAIConversationContextCondenseFromSnapshot(snapshot AIConversationSnapshot, sessionID string) (AIConversationContextCondenseResult, error) {
	if a == nil || a.configManager == nil {
		return AIConversationContextCondenseResult{}, fmt.Errorf("配置管理器不可用")
	}
	profile := AIProviderProfile{}
	if resolvedProfile, profileErr := a.getAIProviderProfileForConversation(snapshot.ID); profileErr == nil {
		profile = resolvedProfile
	}
	compressedSeed, err := a.buildAIConversationCompressedSeed(snapshot, sessionID)
	if err != nil {
		if !strings.Contains(strings.TrimSpace(err.Error()), "压缩后上下文未减少") {
			return AIConversationContextCondenseResult{}, err
		}
		currentContextTokens, tokenErr := calculateAIConversationContextTokensWithProfile(snapshot.ID, strings.TrimSpace(sessionID), snapshot.APIMessages, profile)
		if tokenErr != nil {
			return AIConversationContextCondenseResult{}, tokenErr
		}
		nextSnapshot := normalizeAIConversationSnapshot(snapshot, defaultAIConversationTaskSettings(a.configManager.GetAIGlobalSettings()))
		return AIConversationContextCondenseResult{
			Snapshot:          nextSnapshot,
			PrevContextTokens: currentContextTokens,
			NewContextTokens:  currentContextTokens,
		}, nil
	}
	previewMessages := appendAIConversationCondenseFollowupAPIMessage(compressedSeed.APIMessages)
	newContextTokens, tokenErr := calculateAIConversationContextTokensWithProfile(snapshot.ID, strings.TrimSpace(sessionID), previewMessages, profile)
	if tokenErr != nil {
		return AIConversationContextCondenseResult{}, tokenErr
	}
	if newContextTokens >= compressedSeed.PrevContextTokens {
		nextSnapshot := normalizeAIConversationSnapshot(snapshot, defaultAIConversationTaskSettings(a.configManager.GetAIGlobalSettings()))
		return AIConversationContextCondenseResult{
			Snapshot:          nextSnapshot,
			PrevContextTokens: compressedSeed.PrevContextTokens,
			NewContextTokens:  compressedSeed.PrevContextTokens,
		}, nil
	}
	nextSnapshot := snapshot
	nextSnapshot.APIMessages = append([]AIConversationAPIMessage{}, previewMessages...)
	nextSnapshot.Status = "idle"
	nextSnapshot = normalizeAIConversationSnapshot(nextSnapshot, defaultAIConversationTaskSettings(a.configManager.GetAIGlobalSettings()))
	return AIConversationContextCondenseResult{
		Snapshot:          nextSnapshot,
		PrevContextTokens: compressedSeed.PrevContextTokens,
		NewContextTokens:  newContextTokens,
	}, nil
}

func (a *App) failAIAutoRecovery(requestID string, err error, fallbackText string) bool {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return false
	}
	errorText := strings.TrimSpace(fallbackText)
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		errorText = strings.TrimSpace(err.Error())
	}
	if errorText == "" {
		errorText = "请求失败"
	}
	a.emitAIChatRuntimePhase(trimmedRequestID, "ready")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "error",
		"requestId": trimmedRequestID,
		"error":     errorText,
	})
	a.finishAIChatRequest(trimmedRequestID)
	return true
}

func (a *App) recoverAIChatAfterRequestFailure(ctx context.Context, requestID string, payload AIChatRequestPayload, profile AIProviderProfile, requestMessages []AIChatRequestMessage, autoApprovalSettings AIConversationTaskSettings, assistantMessageID string, assistantRetryCount int, collaborationRetryCount int, requestErr error) bool {
	trimmedSourceRequestID := strings.TrimSpace(requestID)
	if a == nil || strings.TrimSpace(payload.ConversationID) == "" || trimmedSourceRequestID == "" || ctx == nil || ctx.Err() != nil {
		return false
	}
	if payload.AutoRecoverySubtaskHops >= 1 {
		return false
	}
	activeRecoveryRequestID := strings.TrimSpace(payload.AutoRecoveryRequestID)
	if activeRecoveryRequestID == "" {
		activeRecoveryRequestID = buildAIAutoRecoveryRequestID(trimmedSourceRequestID)
		if activeRecoveryRequestID == "" {
			return false
		}
		payload.AutoRecoveryRequestID = activeRecoveryRequestID
		if sourceCancel := a.popAIChatRequestCancel(trimmedSourceRequestID); sourceCancel != nil {
			a.setAIChatRequestCancel(activeRecoveryRequestID, sourceCancel)
		}
		a.finishAIChatRequest(trimmedSourceRequestID)
		a.emitAIAutoRecoveryStarted(trimmedSourceRequestID, activeRecoveryRequestID, "协同小助手正在诊断请求失败原因")
	}
	payload.AutoRecoveryActive = true
	a.emitAIAutoRecoveryStatus(activeRecoveryRequestID, "协同小助手正在检测 AI 是否仍然存活", "")
	probeCtx, cancelProbe := context.WithTimeout(ctx, 20*time.Second)
	probeSucceeded, probeErr := a.probeAIProviderLiveness(probeCtx, activeRecoveryRequestID, payload.SessionID, profile)
	cancelProbe()
	if probeErr != nil || !probeSucceeded {
		return a.failAIAutoRecovery(activeRecoveryRequestID, probeErr, func() string {
			if requestErr != nil {
				return requestErr.Error()
			}
			return "AI 测活失败"
		}())
	}
	payload.AutoRecoveryProbeCount++
	if payload.AutoRecoveryCurrentConversationCondensed {
		snapshot, snapshotErr := a.configManager.GetAIConversation(strings.TrimSpace(payload.ConversationID))
		if snapshotErr != nil {
			return a.failAIAutoRecovery(activeRecoveryRequestID, snapshotErr, "")
		}
		requestMessages = buildAIChatRequestMessagesFromConversationAPI(snapshot.APIMessages)
		if len(requestMessages) == 0 {
			return a.failAIAutoRecovery(activeRecoveryRequestID, nil, "压缩后的上下文为空")
		}
		a.emitAIAutoRecoveryStatus(activeRecoveryRequestID, "协同小助手正在切换到统一的全量摘要流程", "")
		a.emitAIAutoRecoveryRunFullSummary(activeRecoveryRequestID, "协同小助手正在创建新的子阶段任务")
		a.finishAIChatRequest(activeRecoveryRequestID)
		return true
	}
	snapshot, snapshotErr := a.configManager.GetAIConversation(strings.TrimSpace(payload.ConversationID))
	if snapshotErr != nil {
		return a.failAIAutoRecovery(activeRecoveryRequestID, snapshotErr, "")
	}
	a.emitAIAutoRecoveryStatus(activeRecoveryRequestID, "协同小助手正在模拟智能压缩收益", "")
	previewResult, previewErr := a.previewAIConversationContextCondenseFromSnapshot(snapshot, payload.SessionID)
	if previewErr != nil {
		return a.failAIAutoRecovery(activeRecoveryRequestID, previewErr, "")
	}
	condenseRate := calculateAIConversationCondenseRate(previewResult.PrevContextTokens, previewResult.NewContextTokens)
	if condenseRate >= aiConversationCondenseEscalationThreshold {
		a.emitAIAutoRecoveryStatus(activeRecoveryRequestID, "协同小助手正在压缩当前任务后重试", "")
		condenseResult, condenseErr := a.CondenseAIConversationContext(payload.ConversationID, payload.SessionID)
		if condenseErr != nil {
			return a.failAIAutoRecovery(activeRecoveryRequestID, condenseErr, "")
		}
		rebuiltRequestMessages := buildAIChatRequestMessagesFromConversationAPI(condenseResult.Snapshot.APIMessages)
		if len(rebuiltRequestMessages) == 0 {
			return a.failAIAutoRecovery(activeRecoveryRequestID, nil, "压缩后的上下文为空")
		}
		payload.AutoRecoveryCurrentConversationCondensed = true
		payload.AutoRecoveryActive = true
		a.emitAIChatCollaborationContextCondensed(activeRecoveryRequestID, condenseResult)
		nextAssistantMessageID := fmt.Sprintf("%s-recovery-%d", activeRecoveryRequestID, time.Now().UnixNano())
		// 智能压缩完成、正式重试开始的这一刻已不属于助理协同态。
		// 由前端在收到 assistant_continue 且当前为 summary_subtask 协同态时退出协同态、回落为普通流式。
		// 因此这里不再补发会重新点亮协同态的 auto_recovery_status。
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "assistant_continue",
			"requestId": activeRecoveryRequestID,
			"messageId": nextAssistantMessageID,
		})
		a.runCompatibleAIChatLoop(ctx, activeRecoveryRequestID, payload, profile, rebuiltRequestMessages, autoApprovalSettings, nextAssistantMessageID, assistantRetryCount, collaborationRetryCount)
		return true
	}
	a.emitAIAutoRecoveryStatus(activeRecoveryRequestID, "协同小助手正在切换到统一的全量摘要流程", "")
	a.emitAIAutoRecoveryRunFullSummary(activeRecoveryRequestID, "协同小助手正在创建新的子阶段任务")
	a.finishAIChatRequest(activeRecoveryRequestID)
	return true
}