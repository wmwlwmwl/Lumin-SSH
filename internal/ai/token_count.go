package ai

import (
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