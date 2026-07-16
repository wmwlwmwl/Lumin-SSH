package mcpserver

import (
	"encoding/xml"
	"fmt"
	"strings"
)

type askFollowupQuestionPayload struct {
	Questions   []askFollowupQuestionQuestion   `xml:"question"`
	Suggestions []askFollowupQuestionSuggestion `xml:"suggest"`
}

type askFollowupQuestionQuestion struct {
	ID       string                      `xml:"id,attr"`
	Type     string                      `xml:"type,attr"`
	TypeNode string                      `xml:"type"`
	Label    string                      `xml:"label"`
	Title    string                      `xml:"title"`
	Options  []askFollowupQuestionOption `xml:"option"`
}

type askFollowupQuestionOption struct {
	ID          string `xml:"id,attr"`
	Mode        string `xml:"mode,attr"`
	Disabled    string `xml:"disabled,attr"`
	Recommended string `xml:"recommended,attr"`
	Text        string `xml:",chardata"`
}

type askFollowupQuestionSuggestion struct {
	Text string `xml:",chardata"`
}

func askFollowupQuestionToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name:        "ask_followup_question",
		Description: "Present a multi-question questionnaire to the user and wait for their structured answer before continuing the task. Required arguments: question, follow_up. The follow_up field must contain one or more <question> blocks with <option> entries. Each option may use id, mode, disabled, and recommended attributes. Legacy 2 to 12 <suggest>...</suggest> payloads are also supported.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"question": map[string]any{
					"type":        "string",
					"description": "An optional survey title or the legacy single follow-up question.",
				},
				"follow_up": map[string]any{
					"type":        "string",
					"description": "XML questionnaire payload containing question blocks and options, or the legacy suggest list payload.",
				},
			},
			"required":             []string{"question", "follow_up"},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callAskFollowupQuestion(arguments map[string]any) (any, error) {
	if err := validateAllowedArguments(arguments, "question", "follow_up"); err != nil {
		return nil, err
	}
	question, err := requireStringArgument(arguments, "question")
	if err != nil {
		return nil, err
	}
	followUp, err := requireStringArgument(arguments, "follow_up")
	if err != nil {
		return nil, err
	}
	questions, suggestions, err := parseAskFollowupPayload(followUp, question)
	if err != nil {
		return nil, err
	}
	result := map[string]any{
		"status":   "pending",
		"question": question,
	}
	if len(questions) > 0 {
		result["questions"] = questions
	}
	if len(suggestions) > 0 {
		result["suggestions"] = suggestions
	}
	return result, nil
}

func parseAskFollowupPayload(raw string, fallbackQuestion string) ([]map[string]any, []string, error) {
	payload := strings.TrimSpace(raw)
	if payload == "" {
		return nil, nil, fmt.Errorf("argument follow_up must not be empty")
	}
	if !strings.HasPrefix(payload, "<follow_up") {
		payload = "<follow_up>" + payload + "</follow_up>"
	}
	var parsed askFollowupQuestionPayload
	if err := xml.Unmarshal([]byte(payload), &parsed); err != nil {
		return nil, nil, fmt.Errorf("argument follow_up must be valid XML: %w", err)
	}
	if len(parsed.Questions) > 0 {
		questions := make([]map[string]any, 0, len(parsed.Questions))
		for questionIndex, item := range parsed.Questions {
			questionID := strings.TrimSpace(item.ID)
			if questionID == "" {
				questionID = fmt.Sprintf("question-%d", questionIndex+1)
			}
			rawQuestionType := strings.TrimSpace(item.Type)
			if rawQuestionType == "" {
				rawQuestionType = strings.TrimSpace(item.TypeNode)
			}
			questionText := strings.TrimSpace(item.Label)
			if questionText == "" {
				questionText = strings.TrimSpace(item.Title)
			}
			if questionText == "" {
				if questionIndex == 0 && strings.TrimSpace(fallbackQuestion) != "" {
					questionText = strings.TrimSpace(fallbackQuestion)
				} else {
					questionText = fmt.Sprintf("Question %d", questionIndex+1)
				}
			}
			questionType := "single"
			if strings.EqualFold(rawQuestionType, "multiple") {
				questionType = "multiple"
			}
			options := make([]map[string]any, 0, len(item.Options))
			for optionIndex, option := range item.Options {
				answer := strings.TrimSpace(option.Text)
				if answer == "" {
					continue
				}
				optionID := strings.TrimSpace(option.ID)
				if optionID == "" {
					optionID = fmt.Sprintf("%s-option-%d", questionID, optionIndex+1)
				}
				optionPayload := map[string]any{
					"id":     optionID,
					"answer": answer,
				}
				if mode := strings.TrimSpace(option.Mode); mode != "" {
					optionPayload["mode"] = mode
				}
				switch strings.ToLower(strings.TrimSpace(option.Disabled)) {
				case "1", "true", "yes":
					optionPayload["disabled"] = true
				}
				switch strings.ToLower(strings.TrimSpace(option.Recommended)) {
				case "1", "true", "yes":
					optionPayload["recommended"] = true
				}
				options = append(options, optionPayload)
			}
			if len(options) == 0 {
				continue
			}
			questions = append(questions, map[string]any{
				"id":      questionID,
				"text":    questionText,
				"type":    questionType,
				"options": options,
			})
		}
		if len(questions) == 0 {
			return nil, nil, fmt.Errorf("argument follow_up must contain at least one question with options")
		}
		return questions, nil, nil
	}
	suggestions := make([]string, 0, len(parsed.Suggestions))
	for _, item := range parsed.Suggestions {
		text := strings.TrimSpace(item.Text)
		if text == "" {
			continue
		}
		suggestions = append(suggestions, text)
	}
	if len(suggestions) < 2 || len(suggestions) > 4 {
		return nil, nil, fmt.Errorf("argument follow_up must contain 2 to 4 suggest entries")
	}
	return nil, suggestions, nil
}