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

type aiChatResponsesUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type aiChatResponsesEvent struct {
	Type     string                `json:"type"`
	Delta    string                `json:"delta,omitempty"`
	Response *aiChatResponsesState `json:"response,omitempty"`
	Usage    *aiChatResponsesUsage `json:"usage,omitempty"`
}

type aiChatResponsesState struct {
	OutputText string                `json:"output_text,omitempty"`
	Usage      *aiChatResponsesUsage `json:"usage,omitempty"`
}

func (a *App) requestResponsesAIChatRound(ctx context.Context, requestID string, payload AIChatRequestPayload, profile AIProviderProfile, requestMessages []AIChatRequestMessage) (aiChatRoundResult, error) {
	result := aiChatRoundResult{}
	startedAt := time.Now()
	firstTokenAt := time.Time{}
	var contentBuilder strings.Builder

	systemPrompt := BuildChatSystemPromptWithProfile(a.ctx, payload.ConversationID, payload.SessionID, true, profile)
	modelCapability := aiprovider.ResolveModelCapability(profile.Provider, profile.Model)
	runtimeProfile := toAIProviderRuntimeProfile(profile)

	requestBody := map[string]any{
		"model":        profile.Model,
		"input":        aiprovider.BuildResponsesInputMessages(toAIProviderRuntimeMessages(requestMessages)),
		"instructions": systemPrompt,
		"stream":       true,
		"store":        false,
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
		case "response.output_text.delta", "response.text.delta":
			if strings.TrimSpace(event.Delta) == "" {
				continue
			}
			if firstTokenAt.IsZero() {
				firstTokenAt = time.Now()
			}
			contentBuilder.WriteString(event.Delta)
			a.emitAIChatEvent(map[string]interface{}{
				"kind":      "delta",
				"requestId": requestID,
				"delta":     event.Delta,
			})
		case "response.reasoning.delta", "response.reasoning_text.delta", "response.reasoning_summary.delta", "response.reasoning_summary_text.delta":
			if strings.TrimSpace(event.Delta) == "" {
				continue
			}
			a.emitAIChatEvent(map[string]interface{}{
				"kind":      "reasoning_delta",
				"requestId": requestID,
				"delta":     event.Delta,
			})
		case "response.completed", "response.done":
			if event.Response != nil {
				if result.InputTokens == 0 && event.Response.Usage != nil {
					result.InputTokens = event.Response.Usage.InputTokens
					result.OutputTokens = event.Response.Usage.OutputTokens
				}
				if contentBuilder.Len() == 0 && strings.TrimSpace(event.Response.OutputText) != "" {
					if firstTokenAt.IsZero() {
						firstTokenAt = time.Now()
					}
					contentBuilder.WriteString(event.Response.OutputText)
					a.emitAIChatEvent(map[string]interface{}{
						"kind":      "delta",
						"requestId": requestID,
						"delta":     event.Response.OutputText,
					})
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