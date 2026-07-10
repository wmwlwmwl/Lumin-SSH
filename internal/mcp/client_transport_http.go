package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

type httpTransport struct {
	config    ServerConfig
	appendLog func(string)
	client    *http.Client
	nextID    atomic.Int64
	sessionID atomic.Value
}

func newHTTPTransport(config ServerConfig, appendLog func(string)) *httpTransport {
	timeout := time.Duration(config.Timeout) * time.Second
	if config.Timeout == 0 {
		timeout = 0
	}
	return &httpTransport{
		config:    config,
		appendLog: appendLog,
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

func (t *httpTransport) Start(ctx context.Context) error {
	return nil
}

func (t *httpTransport) Close() error {
	return nil
}

func (t *httpTransport) Request(ctx context.Context, method string, params map[string]any, result any) error {
	id := t.nextID.Add(1)
	payload := rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
	}
	if strings.HasPrefix(method, "notifications/") {
		payload.ID = nil
	}
	if params != nil {
		payload.Params = params
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSpace(t.config.URL), bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("MCP-Protocol-Version", "2025-11-25")
	if sessionID, ok := t.sessionID.Load().(string); ok && strings.TrimSpace(sessionID) != "" {
		request.Header.Set("MCP-Session-Id", strings.TrimSpace(sessionID))
	}
	for key, value := range t.config.Headers {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		request.Header.Set(trimmedKey, value)
	}
	response, err := t.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if sessionID := strings.TrimSpace(response.Header.Get("MCP-Session-Id")); sessionID != "" {
		t.sessionID.Store(sessionID)
	}
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024))
	if err != nil {
		return err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		text := strings.TrimSpace(string(responseBody))
		if text == "" {
			text = response.Status
		}
		return fmt.Errorf("%s", text)
	}
	if strings.HasPrefix(method, "notifications/") {
		return nil
	}
	if len(bytes.TrimSpace(responseBody)) == 0 {
		return nil
	}
	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	rpcResult := rpcResponse{}
	if strings.Contains(contentType, "text/event-stream") {
		parsedResult, err := parseEventStreamRPCResponse(responseBody)
		if err != nil {
			return err
		}
		rpcResult = parsedResult
	} else {
		if err := json.Unmarshal(responseBody, &rpcResult); err != nil {
			return err
		}
	}
	if rpcResult.Error != nil {
		return fmt.Errorf("%s", rpcResult.Error.Message)
	}
	if result != nil && len(rpcResult.Result) > 0 {
		if err := json.Unmarshal(rpcResult.Result, result); err != nil {
			return err
		}
	}
	return nil
}

func parseEventStreamRPCResponse(body []byte) (rpcResponse, error) {
	text := strings.ReplaceAll(string(body), "\r\n", "\n")
	events := strings.Split(text, "\n\n")
	for _, event := range events {
		eventType := ""
		dataLines := make([]string, 0, 1)
		for _, line := range strings.Split(event, "\n") {
			trimmedLine := strings.TrimRight(line, "\r")
			if strings.HasPrefix(trimmedLine, "event:") {
				eventType = strings.TrimSpace(trimmedLine[len("event:"):])
				continue
			}
			if strings.HasPrefix(trimmedLine, "data:") {
				dataLines = append(dataLines, strings.TrimSpace(trimmedLine[len("data:"):]))
			}
		}
		if len(dataLines) == 0 {
			continue
		}
		if eventType != "" && eventType != "message" {
			continue
		}
		payload := strings.TrimSpace(strings.Join(dataLines, "\n"))
		if payload == "" {
			continue
		}
		result := rpcResponse{}
		if err := json.Unmarshal([]byte(payload), &result); err == nil {
			return result, nil
		}
	}
	return rpcResponse{}, fmt.Errorf("invalid event-stream response")
}