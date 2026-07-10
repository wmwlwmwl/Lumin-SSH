package ai

import "strings"

var aiReasoningStartTags = []string{
	"<think>",
	"<thinking>",
	"<reasoning>",
}

var aiReasoningEndTags = []string{
	"</think>",
	"</thinking>",
	"</reasoning>",
}

type aiReasoningTagStreamParser struct {
	insideReasoning bool
	pending         string
}

func findAIEarliestReasoningTag(lowerValue string, tags []string) (int, string) {
	bestIndex := -1
	bestTag := ""
	for _, tag := range tags {
		index := strings.Index(lowerValue, tag)
		if index == -1 {
			continue
		}
		if bestIndex == -1 || index < bestIndex || (index == bestIndex && len(tag) > len(bestTag)) {
			bestIndex = index
			bestTag = tag
		}
	}
	return bestIndex, bestTag
}

func findAIReasoningTagSplitSuffixLength(lowerValue string, tags []string) int {
	maxLen := 0
	for _, tag := range tags {
		limit := len(tag) - 1
		if limit > len(lowerValue) {
			limit = len(lowerValue)
		}
		for length := limit; length > 0; length-- {
			if strings.HasSuffix(lowerValue, tag[:length]) {
				if length > maxLen {
					maxLen = length
				}
				break
			}
		}
	}
	return maxLen
}

func (p *aiReasoningTagStreamParser) Feed(value string) (string, string) {
	input := p.pending + value
	p.pending = ""
	if input == "" {
		return "", ""
	}

	var bodyBuilder strings.Builder
	var reasoningBuilder strings.Builder

	for len(input) > 0 {
		lowerInput := strings.ToLower(input)
		if p.insideReasoning {
			if index, tag := findAIEarliestReasoningTag(lowerInput, aiReasoningEndTags); index != -1 {
				reasoningBuilder.WriteString(input[:index])
				input = input[index+len(tag):]
				p.insideReasoning = false
				continue
			}
			suffixLength := findAIReasoningTagSplitSuffixLength(lowerInput, aiReasoningEndTags)
			emitLength := len(input) - suffixLength
			if emitLength > 0 {
				reasoningBuilder.WriteString(input[:emitLength])
			}
			p.pending = input[emitLength:]
			break
		}

		if index, tag := findAIEarliestReasoningTag(lowerInput, aiReasoningStartTags); index != -1 {
			bodyBuilder.WriteString(input[:index])
			input = input[index+len(tag):]
			p.insideReasoning = true
			continue
		}

		suffixLength := findAIReasoningTagSplitSuffixLength(lowerInput, aiReasoningStartTags)
		emitLength := len(input) - suffixLength
		if emitLength > 0 {
			bodyBuilder.WriteString(input[:emitLength])
		}
		p.pending = input[emitLength:]
		break
	}

	return bodyBuilder.String(), reasoningBuilder.String()
}

func (p *aiReasoningTagStreamParser) Flush() (string, string) {
	pending := p.pending
	p.pending = ""
	if pending == "" {
		return "", ""
	}
	if p.insideReasoning {
		return "", pending
	}
	return pending, ""
}