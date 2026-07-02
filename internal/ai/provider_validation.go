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

const (
	aiProviderWebSearchValidationURL           = "https://www.ghxi.com/user/2179447699"
	aiProviderWebSearchValidationExpectedTitle = "小影哟"
	aiProviderWebSearchValidationPrompt        = "请访问 https://www.ghxi.com/user/2179447699,然后只回答这个用户的昵称,不要输出任何解释."
)

type AIProviderWebSearchValidationResult struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	ActualTitle   string `json:"actualTitle,omitempty"`
	RawOutput     string `json:"rawOutput,omitempty"`
	ExpectedTitle string `json:"expectedTitle"`
}

func normalizeAIProviderValidationProfile(profile AIProviderProfile) AIProviderProfile {
	profile.Provider = normalizeAIProviderProtocol(profile.Provider)
	profile.BaseURL = strings.TrimSpace(profile.BaseURL)
	profile.APIKey = strings.TrimSpace(profile.APIKey)
	profile.Model = strings.TrimSpace(profile.Model)
	profile.DedicatedWebSearchProviderID = strings.TrimSpace(profile.DedicatedWebSearchProviderID)
	return profile
}

func (a *App) resolveAIProviderWebSearchValidationProfile(profile AIProviderProfile) (AIProviderProfile, bool, error) {
	normalizedProfile := normalizeAIProviderValidationProfile(profile)
	if !normalizedProfile.DedicatedWebSearchEnabled {
		return normalizedProfile, false, nil
	}
	if normalizedProfile.DedicatedWebSearchProviderID == "" {
		return AIProviderProfile{}, false, fmt.Errorf("请先选择联网专用供应商")
	}
	if a == nil || a.configManager == nil {
		return AIProviderProfile{}, false, fmt.Errorf("当前环境无法解析联网专用供应商")
	}
	state := a.configManager.GetAIProviderState()
	for _, candidate := range state.Providers {
		if candidate.ID != normalizedProfile.DedicatedWebSearchProviderID {
			continue
		}
		if !aiprovider.CanBeDedicatedWebSearchCandidate(candidate.Provider) {
			return AIProviderProfile{}, false, fmt.Errorf("联网专用供应商仅允许 Compatible 或 Responses")
		}
		return normalizeAIProviderValidationProfile(candidate), true, nil
	}
	return AIProviderProfile{}, false, fmt.Errorf("所选联网专用供应商不存在或已被删除")
}

func (a *App) ValidateAIProviderWebSearch(jsonStr string) AIProviderWebSearchValidationResult {
	result := AIProviderWebSearchValidationResult{
		Success:       false,
		ExpectedTitle: aiProviderWebSearchValidationExpectedTitle,
	}
	profile := AIProviderProfile{}
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &profile); err != nil {
			result.Message = fmt.Sprintf("验证失败:%s", err.Error())
			return result
		}
	}
	resolvedProfile, _, err := a.resolveAIProviderWebSearchValidationProfile(profile)
	if err != nil {
		result.Message = fmt.Sprintf("验证失败:%s", err.Error())
		return result
	}
	if resolvedProfile.BaseURL == "" || resolvedProfile.APIKey == "" || resolvedProfile.Model == "" {
		result.Message = "验证失败:请先完整填写基础 URL、API 密钥和模型"
		return result
	}

	requestBody := map[string]any{
		"model":  resolvedProfile.Model,
		"input":  aiProviderWebSearchValidationPrompt,
		"tools":  []map[string]string{{"type": "web_search"}},
		"store":  false,
		"stream": true,
	}

	requestBytes, err := json.Marshal(requestBody)
	if err != nil {
		result.Message = fmt.Sprintf("验证失败:%s", err.Error())
		return result
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	endpoint := strings.TrimRight(resolvedProfile.BaseURL, "/") + "/responses"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(requestBytes))
	if err != nil {
		result.Message = fmt.Sprintf("验证失败:%s", err.Error())
		return result
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Authorization", "Bearer "+resolvedProfile.APIKey)

	response, err := (&http.Client{}).Do(request)
	if err != nil {
		result.Message = fmt.Sprintf("验证失败:%s", err.Error())
		return result
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		errorText := strings.TrimSpace(string(bodyBytes))
		if errorText == "" {
			errorText = response.Status
		}
		result.Message = fmt.Sprintf("验证失败:%s", errorText)
		result.RawOutput = errorText
		return result
	}

	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var outputBuilder strings.Builder
	for scanner.Scan() {
		if ctx.Err() != nil {
			result.Message = fmt.Sprintf("验证失败:%s", ctx.Err().Error())
			result.RawOutput = ctx.Err().Error()
			return result
		}

		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}

		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}

		var event struct {
			Type     string `json:"type"`
			Delta    string `json:"delta,omitempty"`
			Response *struct {
				OutputText string `json:"output_text,omitempty"`
			} `json:"response,omitempty"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue
		}

		switch event.Type {
		case "response.output_text.delta", "response.text.delta":
			if event.Delta != "" {
				outputBuilder.WriteString(event.Delta)
			}
		case "response.completed", "response.done":
			if outputBuilder.Len() == 0 && event.Response != nil && strings.TrimSpace(event.Response.OutputText) != "" {
				outputBuilder.WriteString(event.Response.OutputText)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		result.Message = fmt.Sprintf("验证失败:%s", err.Error())
		result.RawOutput = err.Error()
		return result
	}

	actualTitle := strings.TrimSpace(outputBuilder.String())
	actualTitle = strings.TrimSpace(strings.Trim(actualTitle, "\"'`"))

	result.Success = actualTitle == aiProviderWebSearchValidationExpectedTitle
	result.ActualTitle = actualTitle
	if actualTitle != "" {
		result.RawOutput = actualTitle
		result.Message = actualTitle
	} else {
		result.RawOutput = "未返回内容"
		result.Message = "未返回内容"
	}
	return result
}