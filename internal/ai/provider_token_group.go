package ai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	aiprovider "luminssh-go/internal/ai/provider"
)

type aiProviderTokenGroupResponse struct {
	Data struct {
		Group string `json:"group"`
	} `json:"data"`
}

func normalizeAIProviderTokenGroupBaseURL(profile AIProviderProfile) string {
	switch normalizeAIProviderProtocol(profile.Provider) {
	case "Messages":
		return aiprovider.NormalizeMessagesBaseURL(profile.BaseURL)
	default:
		trimmed := strings.TrimSpace(profile.BaseURL)
		if trimmed == "" {
			return ""
		}
		trimmed = strings.TrimRight(trimmed, "/")
		trimmed = strings.TrimSuffix(trimmed, "/v1")
		return strings.TrimRight(trimmed, "/")
	}
}

func requestAIProviderTokenGroup(client *http.Client, profile AIProviderProfile) (string, error) {
	baseURL := normalizeAIProviderTokenGroupBaseURL(profile)
	if baseURL == "" {
		return "", fmt.Errorf("请先填写 OpenAI 基础 URL")
	}

	endpoint := baseURL + "/api/usage/token/group"
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}

	request.Header.Set("Accept", "application/json")
	if key := strings.TrimSpace(profile.APIKey); key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}

	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		errorText := strings.TrimSpace(string(bodyBytes))
		if errorText == "" {
			errorText = response.Status
		}
		return "", fmt.Errorf("%s", errorText)
	}

	var payload aiProviderTokenGroupResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", err
	}

	group := strings.TrimSpace(payload.Data.Group)
	if group == "" {
		return "", fmt.Errorf("未获取到 Token 分组")
	}
	return group, nil
}

func (a *App) GetAIProviderTokenGroup(jsonStr string) (string, error) {
	profile := AIProviderProfile{}
	if strings.TrimSpace(jsonStr) != "" {
		if err := json.Unmarshal([]byte(jsonStr), &profile); err != nil {
			return "", err
		}
	}
	profile.BaseURL = strings.TrimSpace(profile.BaseURL)
	profile.APIKey = strings.TrimSpace(profile.APIKey)
	client, err := a.newAIHTTPClientForProfile(&profile, 20*time.Second)
	if err != nil {
		return "", err
	}
	return requestAIProviderTokenGroup(client, profile)
}