package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	aiprovider "luminssh-go/internal/ai/provider"
)

type aiChatResponsesUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type aiChatResponsesEvent struct {
	Type        string                `json:"type"`
	Delta       string                `json:"delta,omitempty"`
	Response    *aiChatResponsesState `json:"response,omitempty"`
	Usage       *aiChatResponsesUsage `json:"usage,omitempty"`
	OutputIndex int                   `json:"output_index,omitempty"`
	Item        map[string]any        `json:"item,omitempty"`
}

type aiChatResponsesState struct {
	ID         string                  `json:"id,omitempty"`
	OutputText string                  `json:"output_text,omitempty"`
	Output     []map[string]any        `json:"output,omitempty"`
	Usage      *aiChatResponsesUsage   `json:"usage,omitempty"`
}

func buildAIConversationOpenAIResponsesCacheObject(responseID string, output []map[string]any, includeValues []string, store bool, capturedAt int64) *AIConversationOpenAIResponsesCacheObject {
	trimmedResponseID := strings.TrimSpace(responseID)
	clonedOutput := aiprovider.CloneOpenAIResponsesOutputItems(output)
	normalizedInclude := normalizeAIStringList(includeValues)
	if trimmedResponseID == "" && len(clonedOutput) == 0 && len(normalizedInclude) == 0 && capturedAt == 0 && !store {
		return nil
	}
	return &AIConversationOpenAIResponsesCacheObject{
		ResponseID: trimmedResponseID,
		Output:     clonedOutput,
		Include:    normalizedInclude,
		Store:      store,
		CapturedAt: capturedAt,
	}
}

func cloneAIConversationProviderCacheObjects(cacheObjects *AIConversationProviderCacheObjects) *AIConversationProviderCacheObjects {
	if cacheObjects == nil || cacheObjects.OpenAIResponses == nil {
		return nil
	}
	normalized := buildAIConversationOpenAIResponsesCacheObject(
		cacheObjects.OpenAIResponses.ResponseID,
		cacheObjects.OpenAIResponses.Output,
		cacheObjects.OpenAIResponses.Include,
		cacheObjects.OpenAIResponses.Store,
		cacheObjects.OpenAIResponses.CapturedAt,
	)
	if normalized == nil {
		return nil
	}
	return &AIConversationProviderCacheObjects{
		OpenAIResponses: normalized,
	}
}

func captureAIResponsesOutputItem(items map[int]map[string]any, outputIndex int, item map[string]any) {
	if items == nil || outputIndex < 0 || item == nil {
		return
	}
	clonedItems := aiprovider.CloneOpenAIResponsesOutputItems([]map[string]any{item})
	if len(clonedItems) == 0 {
		return
	}
	items[outputIndex] = clonedItems[0]
}

func collectAIResponsesOutputItems(items map[int]map[string]any) []map[string]any {
	if len(items) == 0 {
		return nil
	}
	indexes := make([]int, 0, len(items))
	for index := range items {
		indexes = append(indexes, index)
	}
	sort.Ints(indexes)
	collected := make([]map[string]any, 0, len(indexes))
	for _, index := range indexes {
		item := items[index]
		if item == nil {
			continue
		}
		clonedItems := aiprovider.CloneOpenAIResponsesOutputItems([]map[string]any{item})
		if len(clonedItems) == 0 {
			continue
		}
		collected = append(collected, clonedItems[0])
	}
	if len(collected) == 0 {
		return nil
	}
	return collected
}

func buildAIResponsesAssistantMessageWithCache(content string, cacheObject *AIConversationOpenAIResponsesCacheObject) AIChatRequestMessage {
	return AIChatRequestMessage{
		Role:    "assistant",
		Content: content,
		CacheObjects: &AIConversationProviderCacheObjects{
			OpenAIResponses: buildAIConversationOpenAIResponsesCacheObject(
				cacheObject.ResponseID,
				cacheObject.Output,
				cacheObject.Include,
				cacheObject.Store,
				cacheObject.CapturedAt,
			),
		},
	}
}

func (a *App) requestResponsesAIChatRound(ctx context.Context, requestID string, payload AIChatRequestPayload, profile AIProviderProfile, requestMessages []AIChatRequestMessage) (aiChatRoundResult, error) {
	result := aiChatRoundResult{}
	startedAt := time.Now()
	firstTokenAt := time.Time{}
	var contentBuilder strings.Builder
	var contentParser aiReasoningTagStreamParser
	var latestCacheObject *AIConversationOpenAIResponsesCacheObject

	emitReasoningDelta := func(delta string) {
		if delta == "" {
			return
		}
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "reasoning_delta",
			"requestId": requestID,
			"delta":     delta,
		})
	}

	emitContentDelta := func(delta string) {
		if delta == "" {
			return
		}
		if firstTokenAt.IsZero() && strings.TrimSpace(delta) != "" {
			firstTokenAt = time.Now()
		}
		contentBuilder.WriteString(delta)
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "delta",
			"requestId": requestID,
			"delta":     delta,
		})
	}

	systemPrompt := BuildChatSystemPromptWithProfile(a.ctx, payload.ConversationID, payload.SessionID, true, profile)
	modelCapability := aiprovider.ResolveModelCapability(profile.Provider, profile.Model)
	runtimeProfile := toAIProviderRuntimeProfile(profile)
	promptCacheBypassTimestamp := ""
	if a != nil && a.configManager != nil && strings.TrimSpace(payload.ConversationID) != "" {
		if snapshot, err := a.configManager.GetAIConversation(payload.ConversationID); err == nil {
			promptCacheBypassTimestamp = snapshot.PromptCacheBypassTimestamp
		}
	}

	requestBody := map[string]any{
		"model":        profile.Model,
		"input":        aiprovider.BuildResponsesInputMessages(toAIProviderRuntimeMessages(requestMessages)),
		"instructions": systemPrompt,
		"stream":       true,
		"store":        false,
	}
	if promptCacheKey := aiprovider.BuildResponsesPromptCacheKey(payload.ConversationID, promptCacheBypassTimestamp); promptCacheKey != "" {
		requestBody["prompt_cache_key"] = promptCacheKey
	}

	if reasoningEffort := aiprovider.GetEffectiveReasoningEffort(runtimeProfile, modelCapability); reasoningEffort != "" {
		requestBody["reasoning"] = map[string]any{
			"effort":  reasoningEffort,
			"summary": "auto",
		}
		requestBody["include"] = []string{"reasoning.encrypted_content"}
	}
	if profile.WebSearchEnabled {
		requestBody["tools"] = []map[string]string{{"type": "web_search"}}
	}

	body, err := json.Marshal(requestBody)
	if err != nil {
		return result, err
	}

	endpoint := strings.TrimRight(profile.BaseURL, "/") + "/responses"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return result, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if apiKey := strings.TrimSpace(profile.APIKey); apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	if payload.IsDemon {
		req.Header.Set("isdemon", "true")
	}

	client, err := a.newAIHTTPClientForProfile(&profile, 0)
	if err != nil {
		return result, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		errorText := strings.TrimSpace(string(bodyBytes))
		if errorText == "" {
			errorText = resp.Status
		}
		return result, fmt.Errorf("%s", errorText)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	trackedOutputItems := make(map[int]map[string]any)
	includeValues := []string{}
	if requestBodyInclude, ok := requestBody["include"].([]string); ok {
		includeValues = append([]string{}, requestBodyInclude...)
	}

	for scanner.Scan() {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}

		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}

		eventPayload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if eventPayload == "" || eventPayload == "[DONE]" {
			continue
		}

		var event aiChatResponsesEvent
		if err := json.Unmarshal([]byte(eventPayload), &event); err != nil {
			continue
		}

		switch event.Type {
		case "response.output_item.added", "response.output_item.done":
			captureAIResponsesOutputItem(trackedOutputItems, event.OutputIndex, event.Item)
		case "response.output_text.delta", "response.text.delta":
			if event.Delta == "" {
				continue
			}
			bodyDelta, taggedReasoningDelta := contentParser.Feed(event.Delta)
			emitReasoningDelta(taggedReasoningDelta)
			emitContentDelta(bodyDelta)
		case "response.reasoning.delta", "response.reasoning_text.delta", "response.reasoning_summary.delta", "response.reasoning_summary_text.delta":
			if event.Delta == "" {
				continue
			}
			emitReasoningDelta(event.Delta)
		case "response.completed", "response.done":
			if event.Response != nil {
				if result.InputTokens == 0 && event.Response.Usage != nil {
					result.InputTokens = event.Response.Usage.InputTokens
					result.OutputTokens = event.Response.Usage.OutputTokens
				}
				if contentBuilder.Len() == 0 && event.Response.OutputText != "" {
					bodyDelta, taggedReasoningDelta := contentParser.Feed(event.Response.OutputText)
					emitReasoningDelta(taggedReasoningDelta)
					emitContentDelta(bodyDelta)
				}
				cacheObject := buildAIConversationOpenAIResponsesCacheObject(
					event.Response.ID,
					func() []map[string]any {
						trackedOutput := collectAIResponsesOutputItems(trackedOutputItems)
						if len(trackedOutput) > 0 {
							return trackedOutput
						}
						return event.Response.Output
					}(),
					includeValues,
					requestBody["store"] == true,
					time.Now().UnixMilli(),
				)
				if cacheObject != nil {
					latestCacheObject = cacheObject
				}
			}
			if event.Usage != nil {
				result.InputTokens = event.Usage.InputTokens
				result.OutputTokens = event.Usage.OutputTokens
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return result, err
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}

	flushedBody, flushedReasoning := contentParser.Flush()
	emitReasoningDelta(flushedReasoning)
	emitContentDelta(flushedBody)

	result.Text = strings.TrimSpace(contentBuilder.String())
	if result.Text == "" {
		result.Text = "未返回内容"
	}
	if !firstTokenAt.IsZero() {
		result.FirstTokenMs = firstTokenAt.Sub(startedAt).Milliseconds()
	}
	result.ElapsedMs = time.Since(startedAt).Milliseconds()
	if result.OutputTokens > 0 && result.ElapsedMs > 0 {
		result.TokensPerSecond = float64(result.OutputTokens) / (float64(result.ElapsedMs) / 1000)
	}
	if latestCacheObject != nil {
		result.NextRequestMessages = append([]AIChatRequestMessage{}, requestMessages...)
		result.NextRequestMessages = append(result.NextRequestMessages, buildAIResponsesAssistantMessageWithCache(result.Text, latestCacheObject))
	}
	if len(result.NextRequestMessages) == 0 {
		result.NextRequestMessages = append([]AIChatRequestMessage{}, requestMessages...)
	}

	return result, nil
}