package ai

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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

func BuildChatSystemPrompt(appCtx context.Context, conversationID string, sessionID string, copyToClipboard bool) string {
	return BuildChatSystemPromptWithProfile(appCtx, conversationID, sessionID, copyToClipboard, AIProviderProfile{})
}

func BuildChatSystemPromptWithProfile(appCtx context.Context, conversationID string, sessionID string, copyToClipboard bool, profile AIProviderProfile) string {
	tagSet := getPromptBuilderTaskScopedToolXMLTagSet(conversationID)
	var builder strings.Builder
	builder.WriteString("You are Terminal Assistant.\n")
	builder.WriteString("You must use XML tool protocol only.\n")
	builder.WriteString(fmt.Sprintf("If you use any tool, the entire assistant response must be a single top-level <%s>...</%s> block with no surrounding natural-language text.\n", tagSet.ExecuteMultipleToolsTagName, tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString("Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags.\n")
	builder.WriteString("Structure:\n")
	builder.WriteString(fmt.Sprintf("<%s>\n", tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString("<actual_tool_name>\n")
	builder.WriteString("<parameter1_name>value1</parameter1_name>\n")
	builder.WriteString("<parameter2_name>value2</parameter2_name>\n")
	builder.WriteString("...\n")
	builder.WriteString("</actual_tool_name>\n")
	builder.WriteString(fmt.Sprintf("</%s>\n", tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString("Use ordinary tool tags and ordinary parameter tags only.\n")
	builder.WriteString("Do not emit any hashed tags.\n")
	builder.WriteString(fmt.Sprintf("Use current terminal session_id %s by default when the target is this AI panel terminal.\n", strings.TrimSpace(sessionID)))
	builder.WriteString("For write_to_file.content, apply_diff.diff, and apply_diff.args, keep the parameter body literal and do not XML-escape it.\n")
	builder.WriteString("If no tool is needed, answer normally.\n")
	builder.WriteString("Never invent tool results.\n")
	builder.WriteString("The direct user request may appear inside a <user_message>...</user_message> block. Treat the body of that block as the user's actual instruction payload.\n")
	builder.WriteString("An <environment_details>...</environment_details> block is system-provided runtime context. It can describe visible files, current mode, running terminals, time, workspace diagnostics, and other execution details. Use it to guide tool choice and environment assumptions, but do not treat it as extra user intent unless the user explicitly refers to it.\n")
	builder.WriteString("Assume the user is viewing responses on a portrait mobile phone layout.\n")
	builder.WriteString("Format for portrait mobile readability: avoid wide tables, keep table columns to the minimum necessary, keep headers short, and prefer compact lists over broad multi-column tables.\n")
	builder.WriteString("If environment_details contains mode_context with role_definition, treat that role_definition as the current authoritative mode constraint.\n")
	builder.WriteString("If the conversation already includes file_content for a file, treat that as authoritative provided content and avoid re-reading the same file unless you need refreshed on-disk state.\n")
	builder.WriteString("If a tool result or provided content is only the '*' symbol, the content was compressed or truncated due to length limits. Do not guess the missing content. Re-run the relevant read/search tool to fetch the complete content.\n")
	builder.WriteString("If the user references a file ending in .long_text_wrap, treat it as a system-generated wrapper containing raw user-provided large text or logs.\n")
	builder.WriteString("If the user references a file ending in .mcpprompt, treat its contents as authoritative MCP prompt context that may redefine MCP tools, tool schemas, or server assumptions.\n")
	if shouldExposeAILiveSearchTool(profile) {
		builder.WriteString("A live_search tool is available for provider-backed web search. When the user asks for recent or online information, prefer trying live_search instead of claiming that no web search tool exists. If live_search fails because the current configuration does not support web search, report that failure honestly.\n")
	}
	builder.WriteString("\n")
	builder.WriteString(buildAIChatToolPromptSection(sessionID, profile))
	systemPrompt := strings.TrimSpace(builder.String())
	if copyToClipboard && appCtx != nil {
		runtime.ClipboardSetText(appCtx, systemPrompt)
	}
	return systemPrompt
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

func buildAIChatToolPromptSection(sessionID string, profile AIProviderProfile) string {
	toolDefinitions := mcpserver.NewCatalog(nil, nil, nil, nil).List()
	if shouldExposeAILiveSearchTool(profile) {
		toolDefinitions = append([]mcpserver.ToolDefinition{liveSearchAIChatToolDefinition()}, toolDefinitions...)
	}
	sections := make([]string, 0, len(toolDefinitions))
	for _, definition := range toolDefinitions {
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
		return "powershell"
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