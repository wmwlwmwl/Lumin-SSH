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

func fetchMessagesProviderModels(client *http.Client, baseURL string, apiKey string) ([]string, error) {
	trimmedBaseURL := aiprovider.NormalizeMessagesBaseURL(baseURL)
	if trimmedBaseURL == "" {
		return nil, fmt.Errorf("请先填写 Anthropic 基础 URL")
	}

	endpoint := trimmedBaseURL + "/v1/models"
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	request.Header.Set("Accept", "application/json")
	request.Header.Set("anthropic-version", "2023-06-01")
	if key := strings.TrimSpace(apiKey); key != "" {
		request.Header.Set("x-api-key", key)
	}

	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}

	response, fetchErr := client.Do(request)

	is404Or405 := false
	if fetchErr == nil && response != nil {
		if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusMethodNotAllowed {
			is404Or405 = true
			response.Body.Close()
		}
	}

	if (fetchErr != nil || is404Or405) && strings.Contains(trimmedBaseURL, "/anthropic") {
		// Fallback for DeepSeek or similar providers that expose Anthropic-compatible /v1/messages
		// but require OpenAI-compatible /v1/models on their main domain.
		derivedBaseURL := strings.TrimSuffix(strings.TrimRight(trimmedBaseURL, "/"), "/anthropic")
		var fallbackErr error
		fallbackSucceeded := false
		for _, path := range []string{"/v1/models", "/models"} {
			fallbackEndpoint := derivedBaseURL + path
			fallbackReq, err := http.NewRequest(http.MethodGet, fallbackEndpoint, nil)
			if err != nil {
				continue
			}
			fallbackReq.Header.Set("Accept", "application/json")
			if key := strings.TrimSpace(apiKey); key != "" {
				fallbackReq.Header.Set("Authorization", "Bearer "+key)
			}
			fallbackResp, err := client.Do(fallbackReq)
			if err != nil {
				fallbackErr = err
				continue
			}
			if fallbackResp.StatusCode >= 200 && fallbackResp.StatusCode < 300 {
				response = fallbackResp
				fetchErr = nil
				fallbackSucceeded = true
				break
			}
			bodyBytes, _ := io.ReadAll(io.LimitReader(fallbackResp.Body, 1024))
			fallbackResp.Body.Close()
			fallbackErr = fmt.Errorf("fallback to %s failed (status %d): %s", path, fallbackResp.StatusCode, strings.TrimSpace(string(bodyBytes)))
		}
		if !fallbackSucceeded {
			if fallbackErr != nil {
				return nil, fmt.Errorf("获取 Anthropic 模型列表失败，且尝试备用 OpenAI 兼容接口失败: %v", fallbackErr)
			}
			if fetchErr != nil {
				return nil, fetchErr
			}
			return nil, fmt.Errorf("获取 Anthropic 模型列表失败 (404/405)")
		}
	} else if fetchErr != nil {
		return nil, fetchErr
	} else if is404Or405 {
		return nil, fmt.Errorf("获取 Anthropic 模型列表失败 (404/405)")
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
	if profile.Provider == "Messages" {
		return fetchMessagesProviderModels(client, profile.BaseURL, profile.APIKey)
	}
	return fetchCompatibleProviderModels(client, profile.BaseURL, profile.APIKey)
}

func (a *App) requestCompatibleAIChatRound(ctx context.Context, requestID string, payload AIChatRequestPayload, profile AIProviderProfile, requestMessages []AIChatRequestMessage) (aiChatRoundResult, error) {
	result := aiChatRoundResult{}
	startedAt := time.Now()
	firstTokenAt := time.Time{}
	var contentBuilder strings.Builder
	var contentParser aiReasoningTagStreamParser

	emitReasoningDelta := func(delta string) {
		if delta == "" {
			return
		}
		a.emitAIChatPayloadReasoningDelta(payload, requestID, delta)
	}

	emitContentDelta := func(delta string) {
		if delta == "" {
			return
		}
		if firstTokenAt.IsZero() && strings.TrimSpace(delta) != "" {
			firstTokenAt = time.Now()
		}
		contentBuilder.WriteString(delta)
		a.emitAIChatPayloadContentDelta(payload, requestID, delta)
	}

	systemPrompt := resolveAISystemPromptForPayload(a.ctx, payload, profile)
	modelCapability := aiprovider.ResolveModelCapability(profile.Provider, profile.Model)
	runtimeProfile := toAIProviderRuntimeProfile(profile)
	requestBody := map[string]any{
		"model":       profile.Model,
		"stream":      true,
		"temperature": 0,
		"messages":    aiprovider.BuildOpenAIChatMessages(systemPrompt, toAIProviderRuntimeMessages(requestMessages), aiprovider.ResolvePromptCacheStrategy(runtimeProfile, modelCapability)),
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
			emitReasoningDelta(reasoningDelta)

			bodyDelta, taggedReasoningDelta := contentParser.Feed(choice.Delta.Content)
			emitReasoningDelta(taggedReasoningDelta)
			emitContentDelta(bodyDelta)
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

	return result, nil
}