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

type aiChatCompatibleUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type aiChatCompatibleChunk struct {
	Choices []struct {
		Delta struct {
			Content          string `json:"content"`
			Reasoning        string `json:"reasoning"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"delta"`
	} `json:"choices"`
	Usage *aiChatCompatibleUsage `json:"usage,omitempty"`
}

type aiChatRoundResult struct {
	Text                string
	FirstTokenMs        int64
	ElapsedMs           int64
	InputTokens         int
	OutputTokens        int
	TokensPerSecond     float64
	NextRequestMessages []AIChatRequestMessage
}

type aiProviderModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

func fetchCompatibleProviderModels(client *http.Client, baseURL string, apiKey string) ([]string, error) {
	trimmedBaseURL := strings.TrimSpace(baseURL)
	if trimmedBaseURL == "" {
		return nil, fmt.Errorf("请先填写 OpenAI 基础 URL")
	}

	endpoint := strings.TrimRight(trimmedBaseURL, "/") + "/models"
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	request.Header.Set("Accept", "application/json")
	if key := strings.TrimSpace(apiKey); key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}

	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		errorText := strings.TrimSpace(string(bodyBytes))
		if errorText == "" {
			errorText = response.Status
		}
		return nil, fmt.Errorf("%s", errorText)
	}

	var payload aiProviderModelsResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}

	modelSet := make(map[string]struct{}, len(payload.Data))
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		modelID := strings.TrimSpace(item.ID)
		if modelID == "" {
			continue
		}
		if _, exists := modelSet[modelID]; exists {
			continue
		}
		modelSet[modelID] = struct{}{}
		models = append(models, modelID)
	}

	sort.Strings(models)

	if len(models) == 0 {
		return nil, fmt.Errorf("未获取到任何模型")
	}

	return models, nil
}

func (a *App) RequestAIProviderModels(baseURL string, apiKey string) ([]string, error) {
	client, err := a.newAIHTTPClient(20 * time.Second)
	if err != nil {
		return nil, err
	}
	return fetchCompatibleProviderModels(client, baseURL, apiKey)
}

func (a *App) RequestAIProviderModelsWithProfile(jsonStr string) ([]string, error) {
	profile := AIProviderProfile{}
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &profile); err != nil {
			return nil, err
		}
	}
	profile.BaseURL = strings.TrimSpace(profile.BaseURL)
	profile.APIKey = strings.TrimSpace(profile.APIKey)
	client, err := a.newAIHTTPClientForProfile(&profile, 20*time.Second)
	if err != nil {
		return nil, err
	}
	return fetchCompatibleProviderModels(client, profile.BaseURL, profile.APIKey)
}

func (a *App) requestCompatibleAIChatRound(ctx context.Context, requestID string, payload AIChatRequestPayload, profile AIProviderProfile, requestMessages []AIChatRequestMessage) (aiChatRoundResult, error) {
	result := aiChatRoundResult{}
	startedAt := time.Now()
	firstTokenAt := time.Time{}
	var contentBuilder strings.Builder

	systemPrompt := BuildChatSystemPromptWithProfile(a.ctx, payload.ConversationID, payload.SessionID, true, profile)
	modelCapability := aiprovider.ResolveModelCapability(profile.Provider, profile.Model)
	runtimeProfile := toAIProviderRuntimeProfile(profile)
	requestBody := map[string]any{
		"model":    profile.Model,
		"stream":   true,
		"messages": aiprovider.BuildOpenAIChatMessages(systemPrompt, toAIProviderRuntimeMessages(requestMessages), aiprovider.ResolvePromptCacheStrategy(runtimeProfile, modelCapability)),
	}

	if reasoningEffort := aiprovider.GetEffectiveReasoningEffort(runtimeProfile, modelCapability); reasoningEffort != "" {
		requestBody["reasoning_effort"] = reasoningEffort
	} else if aiprovider.ShouldUseBinaryReasoning(runtimeProfile, modelCapability) {
		requestBody["thinking"] = map[string]any{
			"type": "enabled",
		}
	}

	body, err := json.Marshal(requestBody)
	if err != nil {
		return result, err
	}

	endpoint := strings.TrimRight(profile.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return result, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if apiKey := strings.TrimSpace(profile.APIKey); apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
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

	for scanner.Scan() {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}

		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}

		chunkPayload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if chunkPayload == "" {
			continue
		}
		if chunkPayload == "[DONE]" {
			break
		}

		var chunk aiChatCompatibleChunk
		if err := json.Unmarshal([]byte(chunkPayload), &chunk); err != nil {
			continue
		}

		if chunk.Usage != nil {
			result.InputTokens = chunk.Usage.PromptTokens
			result.OutputTokens = chunk.Usage.CompletionTokens
		}

		for _, choice := range chunk.Choices {
			reasoningDelta := strings.TrimSpace(choice.Delta.ReasoningContent)
			if reasoningDelta == "" {
				reasoningDelta = strings.TrimSpace(choice.Delta.Reasoning)
			}
			if reasoningDelta != "" {
				a.emitAIChatEvent(map[string]interface{}{
					"kind":      "reasoning_delta",
					"requestId": requestID,
					"delta":     reasoningDelta,
				})
			}

			delta := choice.Delta.Content
			if delta == "" {
				continue
			}
			if firstTokenAt.IsZero() {
				firstTokenAt = time.Now()
			}
			contentBuilder.WriteString(delta)
			a.emitAIChatEvent(map[string]interface{}{
				"kind":      "delta",
				"requestId": requestID,
				"delta":     delta,
			})
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