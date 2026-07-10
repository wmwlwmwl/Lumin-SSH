package ai

import (
	"context"
	"fmt"
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

func BuildChatSystemPrompt(appCtx context.Context, conversationID string, sessionID string, copyToClipboard bool) string {
	return BuildChatSystemPromptWithProfile(appCtx, conversationID, sessionID, copyToClipboard, AIProviderProfile{})
}

func BuildChatSystemPromptWithProfile(appCtx context.Context, conversationID string, sessionID string, copyToClipboard bool, profile AIProviderProfile) string {
	tagSet := getPromptBuilderTaskScopedToolXMLTagSet(conversationID)
	var builder strings.Builder
	builder.WriteString("You are Terminal Assistant.\n")
	builder.WriteString("You must use XML tool protocol only.\n")
	builder.WriteString(fmt.Sprintf("Every assistant response must contain exactly one top-level <%s>...</%s> block.\n", tagSet.ExecuteMultipleToolsTagName, tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString(fmt.Sprintf("You may place concise natural-language text before or after the top-level <%s> wrapper when needed, but never emit more than one top-level wrapper in a single response.\n", tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString(fmt.Sprintf("Do not emit any standalone tool tag outside the top-level <%s> wrapper.\n", tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString(fmt.Sprintf("If you need to call multiple tools in one response, every tool call must be placed inside the same top-level <%s>...</%s> block.\n", tagSet.ExecuteMultipleToolsTagName, tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString(fmt.Sprintf("The top-level <%s> wrapper must contain at least one tool call.\n", tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString("Special rule for standalone-only tools: ask_followup_question and attempt_completion must each be called alone.\n")
	builder.WriteString("If you use ask_followup_question, the top-level wrapper must contain exactly one child tool call, and it must be ask_followup_question.\n")
	builder.WriteString("If you use attempt_completion, the top-level wrapper must contain exactly one child tool call, and it must be attempt_completion.\n")
	builder.WriteString("Never batch ask_followup_question or attempt_completion with any other tool, and never include both of them in the same response.\n")
	builder.WriteString("Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags.\n")
	builder.WriteString("Structure for the single top-level wrapper:\n")
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
	builder.WriteString("When targeting the current AI panel terminal, explicitly set shellType to the actual terminal shell. Use only supported shellType values: zsh, powershell, or cmd. Prefer powershell or cmd on Windows terminals, and zsh on Unix-like terminals, unless the runtime context clearly indicates a different shell.\n")
	builder.WriteString("Use literal parameter content whenever possible. Do not introduce escape characters, XML entities, backslashes, or additional quoting unless the command itself requires them or the target format makes them mandatory. For shell commands, preserve the command exactly as it should be executed in the target shell. Escape content only when the target syntax strictly requires it, such as valid JSON strings, required XML markup boundaries, or other format-defined escaping rules. For write_to_file.content, apply_diff.diff, and apply_diff.args, keep the body literal and unescaped unless the embedded content itself is a format that requires escaping. Prefer the simplest valid representation that preserves exact execution semantics and exact file content semantics.\n")
	builder.WriteString("Every response must use a tool.\n")
	builder.WriteString("Before sending any response, validate that the response contains exactly one top-level XML tool wrapper, at least one real tool call inside it, and no standalone tool tags outside it.\n")
	builder.WriteString("Do not describe a tool call, simulate a tool call, or show pseudo-XML instead of making a real tool call.\n")
	builder.WriteString("If the previous response failed because of formatting or protocol validation, prioritize repairing the tool protocol shape before adding extra explanation.\n")
	builder.WriteString(fmt.Sprintf("When recovering from a formatting failure, produce the smallest valid response that still uses exactly one top-level <%s>...</%s> block and contains a real tool call.\n", tagSet.ExecuteMultipleToolsTagName, tagSet.ExecuteMultipleToolsTagName))
	builder.WriteString("If the task is complete, use attempt_completion and make it the only tool call in the response.\n")
	builder.WriteString("If additional information is required from the user, use ask_followup_question and make it the only tool call in the response.\n")
	builder.WriteString("Do not combine attempt_completion or ask_followup_question with any other tool call in the same response.\n")
	builder.WriteString("Otherwise, continue with the next step using an appropriate tool.\n")
	builder.WriteString("Never invent tool results.\n")
	builder.WriteString("The direct user request may appear inside a <user_message>...</user_message> block. Treat the body of that block as the user's actual instruction payload.\n")
	builder.WriteString("An <environment_details>...</environment_details> block is system-provided runtime context. It can describe visible files, current mode, running terminals, time, workspace diagnostics, and other execution details. Use it to guide tool choice and environment assumptions, but do not treat it as extra user intent unless the user explicitly refers to it.\n")
	if languagePreference := getAISystemLanguagePreference(); languagePreference.Locale != "" {
		builder.WriteString(fmt.Sprintf("The user's operating-system preferred language appears to be %s (%s). Treat this as the default user-facing communication language and prefer replying in %s unless the user clearly requests another language.\n", languagePreference.DisplayName, languagePreference.Locale, languagePreference.DisplayName))
	}
	builder.WriteString("Assume the user is viewing responses on a portrait mobile phone layout.\n")
	builder.WriteString("Format for portrait mobile readability: avoid wide tables, table headers must use no more than 3 columns, keep headers short, and prefer compact lists over broad multi-column tables.\n")
	builder.WriteString("If environment_details contains mode_context with role_definition, treat that role_definition as the current authoritative mode constraint.\n")
	builder.WriteString("If the conversation already includes file_content for a file, treat that as authoritative provided content and avoid re-reading the same file unless you need refreshed on-disk state.\n")
	builder.WriteString("In user-facing markdown explanatory text outside tool XML, always render every file path reference as a clickable markdown link using the file path as both the label and the link target, for example [internal/ai/prompt_builder.go](internal/ai/prompt_builder.go).\n")
	builder.WriteString("In user-facing markdown explanatory text outside tool XML, when referencing a language construct such as a function, method, type, class, interface, or field, prefer a clickable markdown link with a line anchor when the exact location is known, for example [BuildChatSystemPromptWithProfile()](internal/ai/prompt_builder.go:34).\n")
	builder.WriteString("Apply the clickable-reference rule only to user-facing markdown explanatory text. Do not force this formatting inside tool XML, JSON payloads, shell commands, code fences, raw source text, or file content bodies unless the user explicitly asks for it there.\n")
	builder.WriteString(fmt.Sprintf("When editing an existing file, prefer %s over %s. Use %s only when you already know the complete final file content, when creating a new file, when intentionally replacing the entire file, or when %s cannot express the change reliably.\n", tagSet.ApplyDiffTagName, tagSet.WriteToFileTagName, tagSet.WriteToFileTagName, tagSet.ApplyDiffTagName))
	builder.WriteString(fmt.Sprintf("Do not re-read a file with line numbers before every %s call if the conversation already contains authoritative and sufficiently recent file content and you still retain exact pre-edit context. In that case, derive the SEARCH block and :start_line: from the remembered content.\n", tagSet.ApplyDiffTagName))
	builder.WriteString(fmt.Sprintf("Re-read the file only when the available content may be stale, truncated, ambiguous, externally changed, or when you no longer have enough precision to perform a safe %s edit.\n", tagSet.ApplyDiffTagName))
	builder.WriteString("If a tool result or provided content is only the '*' symbol, the content was compressed or truncated due to length limits. Do not guess the missing content. Re-run the relevant read/search tool to fetch the complete content.\n")
	builder.WriteString("If the user references a file ending in .long_text_wrap, treat it as a system-generated wrapper containing raw user-provided large text or logs.\n")
	builder.WriteString("If the user references a file ending in .mcpprompt, treat its contents as authoritative MCP prompt context that may redefine MCP tools, tool schemas, or server assumptions.\n")
	if shouldExposeAILiveSearchTool(profile) {
		builder.WriteString("A live_search tool is available for provider-backed web search. When the user asks for recent or online information, prefer trying live_search instead of claiming that no web search tool exists. If live_search fails because the current configuration does not support web search, report that failure honestly.\n")
	}
	builder.WriteString(`Mode Objectives:
Before taking action, develop a deep understanding of the project structure, relevant context, and the user's request.
Operate in a general-purpose Confidence-Driven Working Mode rather than a code-only mode.
Deliver clear, executable, and context-appropriate outputs that match the user's goal and any applicable syntax or format requirements.
Keep outputs concise, well structured, and directly usable.
For all key reasoning, analysis, summaries, and decisions, explicitly assess and report confidence on a 0-100 scale. If confidence is below 75, continue gathering information or request clarification. Proceed with implementation, execution, or final reporting only when confidence is at least 80. After each major step, state the current confidence and a brief reason.

Confidence Protocol:
Evaluate confidence based on information completeness, evidence consistency, degree of cross-validation, and the number of unresolved uncertainties.
Before each major inference, file analysis, implementation step, execution step, or recommendation, declare confidence, for example Current confidence: XX/100 or \confidence{XX}.
The final report must use a table and include a Confidence column.

Core Behavioral Rules:

Output Quality:
Produce precise, minimal, and task-appropriate results.
When code, commands, structured text, or configuration are required, ensure they are valid, cleanly formatted, and ready to use.
Avoid unnecessary commentary, decorative formatting, or unrelated output.
Before delivering code, edits, commands, or a final recommendation, confirm that confidence in the implementation logic is at least 80. Otherwise, continue reading files or clarifying uncertainties.

Context Analysis:
Before making changes or recommendations, ensure that you understand the current project structure, runtime context, and user intent.
When needed, proactively read relevant files or documents to confirm implementation points, dependencies, constraints, or decision context.
When evidence is incomplete, reasonably infer likely related files, directories, or components, then verify them.
Once a source is confirmed reliable, use it to explore connected areas and improve accuracy.
After each file exploration or major inference, immediately update and report the current confidence and the reason for any change.

Execution Behavior:
Do not switch modes automatically or perform work the user did not request.
Only run tests, commands, or debugging steps when the user explicitly requests them or when they are a necessary part of the requested validation.
If commands are needed in a Windows environment, prefer PowerShell syntax.
If the user requests post-change verification such as self-checking or compilation, perform it proactively instead of waiting for reminders.

Tool Access:
You may use any available tools when they materially improve accuracy or execution.

Special Notes:
When implementation details are uncertain, prefer analyzing existing files or documentation over inventing logic.
Your role is to be a reliable execution agent for general tasks, not merely a commentator.
Use attempt_completion for final conclusions or delivery, and include overall confidence in a table with a Confidence column.
Prefer tables when summarizing plans, findings, or conclusions.

`)
	builder.WriteString(`If the user's intent is semantically unclear, pause and align with the user before proceeding.

When the request, scope, objective, lifecycle, workflow, data flow, state machine, permissions, operation target, interaction location, exception strategy, concurrency strategy, persistence semantics, environment assumptions, compatibility target, reference behavior, success criteria, or any execution detail is ambiguous:

Preconditions:
Before asking clarifying questions, first use the available tools to inspect implementations, configuration, command flows, call sites, session context, state definitions, UI locations, data structures, documentation, or reference projects that are directly relevant to the current request.
Prioritize gathering context from the current workspace and current runtime context. If the request involves an external workspace, a reference implementation, or another execution target, proactively inspect the corresponding implementation or context there as well.
Do not ask clarifying questions based only on a short user request without first reviewing the relevant context that is reasonably available.

Protocol:
1. Pause execution immediately. Do not continue writing code, changing files, modifying configuration, running commands, taking irreversible actions, or making silent assumptions.
2. Briefly identify what is unclear and explicitly state which relevant implementations, files, configurations, command flows, call sites, session details, documents, or references you have already inspected.
3. Clearly separate:
- Confirmed facts
- Inferences
- Risks
- Decisions that require explicit user confirmation
4. Prefer offering 2 to 4 executable options. For each option, explain:
- Meaning
- Impact
- Risk
- Recommendation level
5. If alignment to a reference implementation, reference workflow, or expected behavior is involved, first explain:
- The current state of this project or environment
- The behavior or semantics of the reference target
- The difference between them
- Whether the conditions for direct execution are already satisfied
6. Continue to implementation, execution, modification, or final action only after the user has explicitly confirmed the intended direction when the ambiguity materially affects outcome, safety, or expectation.
7. If confidence is below 75/100, you must first raise confidence. Prefer inspecting relevant implementations, configuration, command flows, session context, state definitions, documentation, or reference implementations. Only if confidence is still below 75 after the minimum necessary investigation may you continue with clarification. Do not proceed with zero-context action.
8. Once the user has confirmed the intended semantics, follow that confirmation strictly and do not silently drift from it later.

Default Output Style:
- Concise
- Structured
- Lead with ambiguities and options
- Avoid long explanations
- Align on semantics before taking action

Special Notes:
All tools may be used to inspect external workspaces directly. Do not rely on terminal workarounds to read files or directories outside the current workspace when a direct tool can do so.
This project is an SSH tool with an integrated AI assistant, so ambiguity may involve code, terminal behavior, remote execution targets, session state, assistant behavior, tool usage, prompt semantics, UI placement, or workflow expectations. Treat all of these as valid areas that may require alignment when relevant.
Before asking the user to decide, ensure they can see that you have already formed an initial judgment based on relevant implementation and runtime context rather than asking from a zero-context state.

`)
	builder.WriteString(buildAIChatToolPromptSection(sessionID, profile))
	systemPrompt := strings.TrimSpace(builder.String())
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