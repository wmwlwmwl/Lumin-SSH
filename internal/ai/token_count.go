package ai

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"

	aiprovider "luminssh-go/internal/ai/provider"

	tiktoken "github.com/pkoukk/tiktoken-go"
)

type TokenCountBlock struct {
	Type string
	Text string
	Data string
}

var (
	aiTokenEncodingOnce sync.Once
	aiTokenEncoding     *tiktoken.Tiktoken
	aiTokenEncodingErr  error
)

const (
	aiTokenCountEncodingName = "o200k_base"
	aiTokenCountFudgeFactor  = 1.5
	aiUnknownImageTokenCost  = 300
)

func getAITokenEncoding() (*tiktoken.Tiktoken, error) {
	aiTokenEncodingOnce.Do(func() {
		aiTokenEncoding, aiTokenEncodingErr = tiktoken.GetEncoding(aiTokenCountEncodingName)
	})
	if aiTokenEncodingErr != nil {
		return nil, aiTokenEncodingErr
	}
	if aiTokenEncoding == nil {
		return nil, fmt.Errorf("token encoding unavailable")
	}
	return aiTokenEncoding, nil
}

func estimateAITokenCountForImage(data string) int {
	_, base64Data, ok := aiprovider.ParseBase64DataURL(data)
	if !ok {
		return aiUnknownImageTokenCost
	}
	if base64Data == "" {
		return 0
	}
	return int(math.Ceil(math.Sqrt(float64(len(base64Data)))))
}

func stringifyAITokenCountValue(value any) string {
	switch typedValue := value.(type) {
	case string:
		return strings.TrimSpace(typedValue)
	case []byte:
		return strings.TrimSpace(string(typedValue))
	default:
		data, err := json.Marshal(typedValue)
		if err == nil {
			return strings.TrimSpace(string(data))
		}
		return strings.TrimSpace(fmt.Sprintf("%v", typedValue))
	}
}

func serializeAIOpenAIResponsesOutputItem(item map[string]any) string {
	if len(item) == 0 {
		return ""
	}
	itemType, _ := item["type"].(string)
	switch strings.ToLower(strings.TrimSpace(itemType)) {
	case "output_text":
		if text, _ := item["text"].(string); strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	case "function_call":
		parts := make([]string, 0, 2)
		if name, _ := item["name"].(string); strings.TrimSpace(name) != "" {
			parts = append(parts, "Tool: "+strings.TrimSpace(name))
		}
		if arguments, ok := item["arguments"]; ok {
			serializedArguments := stringifyAITokenCountValue(arguments)
			if serializedArguments != "" {
				parts = append(parts, "Arguments: "+serializedArguments)
			}
		}
		return strings.Join(parts, "\n")
	case "function_call_output":
		parts := make([]string, 0, 2)
		if callID, _ := item["call_id"].(string); strings.TrimSpace(callID) != "" {
			parts = append(parts, "Tool Result ("+strings.TrimSpace(callID)+")")
		} else {
			parts = append(parts, "Tool Result")
		}
		if output, ok := item["output"]; ok {
			serializedOutput := stringifyAITokenCountValue(output)
			if serializedOutput != "" {
				parts = append(parts, serializedOutput)
			}
		}
		return strings.Join(parts, "\n")
	}
	return stringifyAITokenCountValue(item)
}

func buildAIResponsesOutputTokenCountBlocks(items []map[string]any) []TokenCountBlock {
	blocks := make([]TokenCountBlock, 0, len(items))
	for _, item := range items {
		serialized := serializeAIOpenAIResponsesOutputItem(item)
		if serialized == "" {
			continue
		}
		blocks = append(blocks, TokenCountBlock{
			Type: "text",
			Text: serialized,
		})
	}
	return blocks
}

func CountTokenBlocks(blocks []TokenCountBlock) (int, error) {
	if len(blocks) == 0 {
		return 0, nil
	}
	encoding, err := getAITokenEncoding()
	if err != nil {
		return 0, err
	}
	totalTokens := 0
	for _, block := range blocks {
		switch block.Type {
		case "text":
			if block.Text == "" {
				continue
			}
			totalTokens += len(encoding.Encode(block.Text, nil, nil))
		case "image":
			if strings.TrimSpace(block.Data) == "" {
				continue
			}
			totalTokens += estimateAITokenCountForImage(block.Data)
		}
	}
	return int(math.Ceil(float64(totalTokens) * aiTokenCountFudgeFactor)), nil
}