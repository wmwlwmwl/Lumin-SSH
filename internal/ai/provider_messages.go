package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	aiprovider "luminssh-go/internal/ai/provider"
)

const anthropicPromptCachingBetaHeader = "prompt-caching-2024-07-31"

type aiChatMessagesUsage struct {
	InputTokens         int `json:"input_tokens"`
	OutputTokens        int `json:"output_tokens"`
	CacheCreationTokens int `json:"cache_creation_input_tokens,omitempty"`
	CacheReadTokens     int `json:"cache_read_input_tokens,omitempty"`
}

type aiChatMessagesEvent struct {
	Type         string               `json:"type"`
	Index        int                  `json:"index,omitempty"`
	Message      *aiChatMessagesState `json:"message,omitempty"`
	Usage        *aiChatMessagesUsage `json:"usage,omitempty"`
	ContentBlock *struct {
		Type     string `json:"type"`
		Text     string `json:"text,omitempty"`
		Thinking string `json:"thinking,omitempty"`
	} `json:"content_block,omitempty"`
	Delta *struct {
		Type     string `json:"type"`
		Text     string `json:"text,omitempty"`
		Thinking string `json:"thinking,omitempty"`
	} `json:"delta,omitempty"`
}

type aiChatMessagesState struct {
	Usage *aiChatMessagesUsage `json:"usage,omitempty"`
}

func (a *App) requestMessagesAIChatRound(ctx context.Context, requestID string, payload AIChatRequestPayload, profile AIProviderProfile, requestMessages []AIChatRequestMessage) (aiChatRoundResult, error) {
	result := aiChatRoundResult{}
	startedAt := time.Now()
	firstTokenAt := time.Time{}
	var contentBuilder strings.Builder

	systemPrompt := BuildChatSystemPromptWithProfile(a.ctx, payload.ConversationID, payload.SessionID, true, profile)
	modelCapability := aiprovider.ResolveModelCapability(profile.Provider, profile.Model)
	runtimeProfile := toAIProviderRuntimeProfile(profile)
	promptCacheStrategy := aiprovider.ResolvePromptCacheStrategy(runtimeProfile, modelCapability)
	maxOutputTokens := aiprovider.ResolveMaxOutputTokens(runtimeProfile, modelCapability)

	systemBlock := map[string]any{
		"type": "text",
		"text": systemPrompt,
	}
	if cacheControl := aiprovider.GetAnthropicPromptCacheControl(promptCacheStrategy); cacheControl != nil {
		systemBlock["cache_control"] = cacheControl
	}

	requestBody := map[string]any{
		"model":      profile.Model,
		"max_tokens": maxOutputTokens,
		"system":     []map[string]any{systemBlock},
		"messages":   aiprovider.BuildAnthropicMessages(toAIProviderRuntimeMessages(requestMessages), promptCacheStrategy),
		"stream":     true,
	}

	if aiprovider.ShouldUseReasoningBudget(runtimeProfile, modelCapability) {
		requestBody["thinking"] = map[string]any{
			"type":          "enabled",
			"budget_tokens": aiprovider.ResolveMaxThinkingTokens(runtimeProfile, modelCapability, maxOutputTokens),
		}
	}

	body, err := json.Marshal(requestBody)
	if err != nil {
		return result, err
	}

	baseURL := aiprovider.NormalizeMessagesBaseURL(profile.BaseURL)
	if baseURL == "" {
		return result, fmt.Errorf("当前供应商缺少 Base URL")
	}
	endpoint := baseURL + "/v1/messages"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return result, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("anthropic-version", "2023-06-01")
	if apiKey := strings.TrimSpace(profile.APIKey); apiKey != "" {
		req.Header.Set("x-api-key", apiKey)
	}
	if promptCacheStrategy != "off" {
		req.Header.Set("anthropic-beta", anthropicPromptCachingBetaHeader)
	}

	resp, err := (&http.Client{}).Do(req)
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
	lastOutputTokens := 0

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

		var event aiChatMessagesEvent
		if err := json.Unmarshal([]byte(eventPayload), &event); err != nil {
			continue
		}

		switch event.Type {
		case "message_start":
			if event.Message != nil && event.Message.Usage != nil {
				result.InputTokens = event.Message.Usage.InputTokens
				lastOutputTokens = event.Message.Usage.OutputTokens
				result.OutputTokens = lastOutputTokens
			}
		case "message_delta":
			if event.Usage != nil {
				currentOutputTokens := event.Usage.OutputTokens
				if currentOutputTokens < lastOutputTokens {
					currentOutputTokens = lastOutputTokens
				}
				result.OutputTokens = currentOutputTokens
				lastOutputTokens = currentOutputTokens
			}
		case "content_block_start":
			if event.ContentBlock == nil {
				continue
			}
			if strings.TrimSpace(event.ContentBlock.Thinking) != "" {
				a.emitAIChatEvent(map[string]interface{}{
					"kind":      "reasoning_delta",
					"requestId": requestID,
					"delta":     event.ContentBlock.Thinking,
				})
			}
			if strings.TrimSpace(event.ContentBlock.Text) != "" {
				if firstTokenAt.IsZero() {
					firstTokenAt = time.Now()
				}
				contentBuilder.WriteString(event.ContentBlock.Text)
				a.emitAIChatEvent(map[string]interface{}{
					"kind":      "delta",
					"requestId": requestID,
					"delta":     event.ContentBlock.Text,
				})
			}
		case "content_block_delta":
			if event.Delta == nil {
				continue
			}
			if strings.TrimSpace(event.Delta.Thinking) != "" {
				a.emitAIChatEvent(map[string]interface{}{
					"kind":      "reasoning_delta",
					"requestId": requestID,
					"delta":     event.Delta.Thinking,
				})
			}
			if strings.TrimSpace(event.Delta.Text) != "" {
				if firstTokenAt.IsZero() {
					firstTokenAt = time.Now()
				}
				contentBuilder.WriteString(event.Delta.Text)
				a.emitAIChatEvent(map[string]interface{}{
					"kind":      "delta",
					"requestId": requestID,
					"delta":     event.Delta.Text,
				})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return result, err
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}

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

	return result, nil
}