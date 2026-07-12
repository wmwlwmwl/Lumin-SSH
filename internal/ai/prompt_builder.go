package ai

import (
	"context"
	"embed"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"luminssh-go/internal/mcpserver"
)

type taskScopedToolXMLTagSet struct {
	ExecuteMultipleToolsTagName string
	ApplyDiffTagName            string
	WriteToFileTagName          string
}

func getPromptBuilderTaskScopedToolXMLTagSet(conversationID string) taskScopedToolXMLTagSet {
	return taskScopedToolXMLTagSet{
		ExecuteMultipleToolsTagName: "runTools",
		ApplyDiffTagName:            "apply_diff",
		WriteToFileTagName:          "write_to_file",
	}
}

func shouldExposeAILiveSearchTool(profile AIProviderProfile) bool {
	return profile.WebSearchEnabled || profile.DedicatedWebSearchEnabled
}

var promptBuilderTemplateVariablePattern = regexp.MustCompile(`\$\{([a-zA-Z0-9_]+)\}`)

const aiTemplateLanguageCode = "en"

//go:embed template/*.template
var aiTemplateFS embed.FS

func buildPromptBuilderLanguagePreferenceInstruction() string {
	if languagePreference := getAISystemLanguagePreference(); languagePreference.Locale != "" {
		return fmt.Sprintf("The user's operating-system preferred language appears to be %s (%s). Treat this as the default user-facing communication language and prefer replying in %s unless the user clearly requests another language.", languagePreference.DisplayName, languagePreference.Locale, languagePreference.DisplayName)
	}
	return ""
}

func buildPromptBuilderLiveSearchInstruction(profile AIProviderProfile) string {
	if shouldExposeAILiveSearchTool(profile) {
		return "A live_search tool is available for provider-backed web search. When the user asks for recent or online information, prefer trying live_search instead of claiming that no web search tool exists. If live_search fails because the current configuration does not support web search, report that failure honestly."
	}
	return ""
}

func renderPromptBuilderTemplate(templateText string, variables map[string]string) string {
	return promptBuilderTemplateVariablePattern.ReplaceAllStringFunc(templateText, func(match string) string {
		submatches := promptBuilderTemplateVariablePattern.FindStringSubmatch(match)
		if len(submatches) != 2 {
			return ""
		}
		return variables[submatches[1]]
	})
}

func readAIEmbeddedTemplate(templateName string) string {
	normalizedTemplateName := strings.TrimSpace(templateName)
	normalizedLanguageCode := strings.ToLower(strings.TrimSpace(aiTemplateLanguageCode))
	if normalizedTemplateName == "" || normalizedLanguageCode == "" {
		return ""
	}
	templatePath := fmt.Sprintf("template/%s.%s.template", normalizedTemplateName, normalizedLanguageCode)
	data, err := aiTemplateFS.ReadFile(templatePath)
	if err != nil {
		return ""
	}
	return string(data)
}

func buildAIBaseTemplateVariables(languageCode string) map[string]string {
	return map[string]string{
		"template_language": languageCode,
	}
}

func buildPromptBuilderTemplateVariables(conversationID string, sessionID string, profile AIProviderProfile) map[string]string {
	tagSet := getPromptBuilderTaskScopedToolXMLTagSet(conversationID)
	mcpClientPromptContext := strings.TrimSpace(getAIMCPClientPromptContext())
	if mcpClientPromptContext != "" {
		mcpClientPromptContext += "\n\n"
	}
	variables := buildAIBaseTemplateVariables(aiTemplateLanguageCode)
	variables["execute_multiple_tools_tag_name"] = tagSet.ExecuteMultipleToolsTagName
	variables["apply_diff_tag_name"] = tagSet.ApplyDiffTagName
	variables["write_to_file_tag_name"] = tagSet.WriteToFileTagName
	variables["session_id"] = strings.TrimSpace(sessionID)
	variables["language_preference_instruction"] = buildPromptBuilderLanguagePreferenceInstruction()
	variables["live_search_instruction"] = buildPromptBuilderLiveSearchInstruction(profile)
	variables["mcp_client_prompt_context"] = mcpClientPromptContext
	variables["tool_prompt_section"] = strings.TrimSpace(buildAIChatToolPromptSection(sessionID, profile))
	return variables
}

func buildAIUserCompensationTemplateVariables() map[string]string {
	return buildAIBaseTemplateVariables(aiTemplateLanguageCode)
}

func BuildChatSystemPromptWithProfile(appCtx context.Context, conversationID string, sessionID string, copyToClipboard bool, profile AIProviderProfile) string {
	templateVariables := buildPromptBuilderTemplateVariables(conversationID, sessionID, profile)
	templateText := readAIEmbeddedTemplate("prompt_builder")
	return strings.TrimSpace(renderPromptBuilderTemplate(templateText, templateVariables))
}

func BuildAIUserCompensation() string {
	templateText := readAIEmbeddedTemplate("user_compensation")
	return strings.TrimSpace(renderPromptBuilderTemplate(templateText, buildAIUserCompensationTemplateVariables()))
}

func liveSearchAIChatToolDefinition() mcpserver.ToolDefinition {
	return mcpserver.ToolDefinition{
		Name: "live_search",
		Description: "Search the web using the current AI provider web search configuration or the configured dedicated web search provider. Use this when the user needs recent, online, or real-time information. Required argument: query.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type": "string",
					"description": "Natural-language web search query.",
				},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
	}
}

func isAIChatHiddenToolName(name string) bool {
	switch strings.TrimSpace(name) {
	case "apply_patch", "edit_file":
		return true
	default:
		return false
	}
}

func buildAIChatToolPromptSection(sessionID string, profile AIProviderProfile) string {
	toolDefinitions := mcpserver.NewCatalog(nil, nil, nil, nil).List()
	if shouldExposeAILiveSearchTool(profile) {
		toolDefinitions = append([]mcpserver.ToolDefinition{liveSearchAIChatToolDefinition()}, toolDefinitions...)
	}
	toolDefinitions = buildAIMCPPromptSections(toolDefinitions)
	sections := make([]string, 0, len(toolDefinitions))
	for _, definition := range toolDefinitions {
		if isAIChatHiddenToolName(definition.Name) {
			continue
		}
		sections = append(sections, formatAIChatToolDefinition(definition, sessionID))
	}
	return "# Tools\n\n" + strings.Join(sections, "\n\n")
}

func formatAIChatToolDefinition(definition mcpserver.ToolDefinition, sessionID string) string {
	properties := extractAIChatToolProperties(definition.InputSchema)
	required := extractAIChatToolRequiredSet(definition.InputSchema)
	paramNames := make([]string, 0, len(properties))
	for name := range properties {
		paramNames = append(paramNames, name)
	}
	sort.Slice(paramNames, func(i, j int) bool {
		leftRequired := required[paramNames[i]]
		rightRequired := required[paramNames[j]]
		if leftRequired != rightRequired {
			return leftRequired
		}
		return paramNames[i] < paramNames[j]
	})
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("## %s\n", definition.Name))
	builder.WriteString(fmt.Sprintf("Description: %s\n", strings.TrimSpace(definition.Description)))
	if len(paramNames) == 0 {
		builder.WriteString("Parameters: None\n")
	} else {
		builder.WriteString("Parameters:\n")
		for _, name := range paramNames {
			builder.WriteString(fmt.Sprintf("- %s\n", formatAIChatToolParameter(name, properties[name], required[name])))
		}
	}
	builder.WriteString("Usage:\n")
	builder.WriteString(fmt.Sprintf("<%s>\n", definition.Name))
	for _, name := range paramNames {
		builder.WriteString(fmt.Sprintf("<%s>%s</%s>\n", name, buildAIChatToolParameterPlaceholder(name, properties[name], sessionID), name))
	}
	builder.WriteString(fmt.Sprintf("</%s>", definition.Name))
	return builder.String()
}

func extractAIChatToolProperties(schema map[string]any) map[string]map[string]any {
	rawProperties, ok := schema["properties"].(map[string]any)
	if !ok {
		return map[string]map[string]any{}
	}
	properties := make(map[string]map[string]any, len(rawProperties))
	for name, rawValue := range rawProperties {
		if propertySchema, ok := rawValue.(map[string]any); ok {
			properties[name] = propertySchema
		}
	}
	return properties
}

func extractAIChatToolRequiredSet(schema map[string]any) map[string]bool {
	requiredSet := make(map[string]bool)
	rawRequired, ok := schema["required"]
	if !ok {
		return requiredSet
	}
	switch typed := rawRequired.(type) {
	case []string:
		for _, name := range typed {
			requiredSet[name] = true
		}
	case []any:
		for _, value := range typed {
			if name, ok := value.(string); ok {
				requiredSet[name] = true
			}
		}
	}
	return requiredSet
}

func formatAIChatToolParameter(name string, schema map[string]any, required bool) string {
	requiredText := "optional"
	if required {
		requiredText = "required"
	}
	typeText := strings.TrimSpace(fmt.Sprint(schema["type"]))
	descriptionText := strings.TrimSpace(fmt.Sprint(schema["description"]))
	enumText := formatAIChatToolEnum(schema["enum"])
	minimumText := ""
	if minimum, ok := schema["minimum"]; ok {
		minimumText = fmt.Sprintf(" minimum=%v.", minimum)
	}
	detailParts := make([]string, 0, 2)
	if descriptionText != "" && descriptionText != "<nil>" {
		detailParts = append(detailParts, descriptionText)
	}
	if enumText != "" {
		detailParts = append(detailParts, enumText)
	}
	details := strings.Join(detailParts, " ")
	if details != "" {
		details += minimumText
	} else if minimumText != "" {
		details = strings.TrimSpace(minimumText)
	}
	if details == "" {
		details = "No additional description."
	}
	return fmt.Sprintf("%s: (%s) type=%s. %s", name, requiredText, typeText, strings.TrimSpace(details))
}

func formatAIChatToolEnum(rawEnum any) string {
	switch typed := rawEnum.(type) {
	case []string:
		if len(typed) == 0 {
			return ""
		}
		return fmt.Sprintf("Allowed values: %s.", strings.Join(typed, ", "))
	case []any:
		if len(typed) == 0 {
			return ""
		}
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			values = append(values, fmt.Sprint(item))
		}
		return fmt.Sprintf("Allowed values: %s.", strings.Join(values, ", "))
	default:
		return ""
	}
}

func buildAIChatToolParameterPlaceholder(name string, schema map[string]any, sessionID string) string {
	switch name {
	case "session_id":
		if strings.TrimSpace(sessionID) != "" {
			return strings.TrimSpace(sessionID)
		}
		return "session_id from list_connected_sessions"
	case "path", "file_path":
		return "/path/to/file"
	case "content":
		return "complete file content here"
	case "command":
		return "your command here"
	case "purpose":
		return "why this command needs to run; plain text only"
	case "is_mutating":
		return "0"
	case "cwd":
		return "/working/directory"
	case "shellType":
		return "zsh"
	case "diff":
		return "<<<<<<< SEARCH\n:start_line:1\n-------\nold text\n=======\nnew text\n>>>>>>> REPLACE"
	case "old_string":
		return "old text"
	case "new_string":
		return "new text"
	case "expected_replacements":
		return "1"
	case "patch":
		return "*** Begin Patch\n*** Update File: /path/to/file\n@@\n-old\n+new\n*** End Patch"
	case "recursive":
		return "true"
	case "args":
		return "<args>\n  <file>\n    <path>/path/to/file</path>\n  </file>\n</args>"
	case "files":
		return "[{\"path\":\"/path/to/file\",\"start_line\":1,\"end_line\":20}]"
	case "start_line":
		return "1"
	case "end_line":
		return "20"
	case "operations":
		return "[{\"search\":\"old1\",\"replace\":\"new1\"},{\"search\":\"old2\",\"replace\":\"new2\"}]"
	case "query":
		return "search query here"
	}
	typeText := strings.TrimSpace(fmt.Sprint(schema["type"]))
	switch typeText {
	case "integer", "number":
		return "1"
	case "boolean":
		return "true"
	case "array":
		return "[]"
	case "object":
		return "{}"
	default:
		return fmt.Sprintf("%s value", name)
	}
}