package ai

import (
	"strings"
	"testing"
)

func TestParseAssistantToolUses_AcceptsProseAndToolCallWrapper(t *testing.T) {
	raw := strings.TrimSpace(`
先检查当前服务里邮件/API 相关配置与实现，再按你给的接口格式接入。
<tool_call>
execute_command>
<command>docker ps</command>
<cwd>/root</cwd>
<is_mutating>0</is_mutating>
<purpose>list containers</purpose>
<session_id>session_1</session_id>
<shellType>zsh</shellType>
</execute_command>
<list_files>
<path>/root</path>
<session_id>session_1</session_id>
<recursive>false</recursive>
</list_files>
</tool_call>

</assistant><|eos|>
`)
	tools, err := parseAssistantToolUses(raw)
	if err != nil {
		t.Fatalf("expected parse success, got %v", err)
	}
	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %d (%v)", len(tools), toolNames(tools))
	}
	if tools[0].Name != "execute_command" || tools[0].Params["command"] != "docker ps" {
		t.Fatalf("unexpected first tool: %+v", tools[0])
	}
	if tools[1].Name != "list_files" {
		t.Fatalf("unexpected second tool: %+v", tools[1])
	}
}

func TestParseAssistantToolUses_AcceptsTrailingStreamJunk(t *testing.T) {
	raw := `<execute_command>
<command>echo ok</command>
<cwd>/root</cwd>
<is_mutating>0</is_mutating>
<purpose>ping</purpose>
<session_id>session_1</session_id>
<shellType>zsh</shellType>
</execute_command>
</tool_call>

</assistant><|eos|><|eos|>`
	tools, err := parseAssistantToolUses(raw)
	if err != nil {
		t.Fatalf("expected parse success, got %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "execute_command" {
		t.Fatalf("unexpected tools: %+v", tools)
	}
}

func TestParseAssistantToolUses_BareAttemptCompletionWithProse(t *testing.T) {
	raw := `先前排查邮箱接口时反复读代码导致循环，现按你的“结束”指令停止。
<tool_call>
attempt_completion>
<result>已结束</result>
</attempt_completion>`
	tools, err := parseAssistantToolUses(raw)
	if err != nil {
		t.Fatalf("expected parse success, got %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "attempt_completion" {
		t.Fatalf("unexpected tools: %+v", tools)
	}
	if tools[0].Params["result"] != "已结束" {
		t.Fatalf("unexpected result param: %q", tools[0].Params["result"])
	}
}

func TestParseAssistantToolUses_StillRejectsStandaloneToolMixedBatch(t *testing.T) {
	// attempt_completion must be alone; leftover recognized tool must not be ignored.
	raw := `<list_files>
<path>/root</path>
<session_id>session_1</session_id>
<recursive>false</recursive>
</list_files>
<attempt_completion>
<result>done</result>
</attempt_completion>`
	_, err := parseAssistantToolUses(raw)
	if err == nil {
		t.Fatal("expected standalone-only batch validation error")
	}
}

func TestParseAssistantToolUses_StillRejectsUnparsedRecognizedToolResidue(t *testing.T) {
	// Orphan recognized closing tag after a valid tool — not prose, not a full second call.
	raw := `<list_files>
<path>/root</path>
<session_id>session_1</session_id>
<recursive>false</recursive>
</list_files>
</execute_command>`
	_, err := parseAssistantToolUses(raw)
	if err == nil {
		t.Fatal("expected protocol error for unparsed recognized tool residue")
	}
}

func TestSanitizeAIAssistantToolProtocolText_IdempotentOnCleanXML(t *testing.T) {
	clean := `<attempt_completion>
<result>done</result>
</attempt_completion>`
	if got := sanitizeAIAssistantToolProtocolText(clean); got != clean {
		t.Fatalf("clean XML changed:\n%s\n---\n%s", clean, got)
	}
}

func TestPurgeAIProtocolRetryNoiseFromMessages(t *testing.T) {
	messages := []AIChatRequestMessage{
		{Role: "user", Content: "<user_message>\n部署\n</user_message>"},
		{Role: "assistant", Content: "说明\n<tool_call>\nexecute_command>\n<command>echo 1</command>\n<cwd>/root</cwd>\n<is_mutating>0</is_mutating>\n<purpose>p</purpose>\n<session_id>s</session_id>\n<shellType>zsh</shellType>\n</execute_command>\n</tool_call>"},
		{Role: "user", Content: "[ERROR] Invalid tool protocol in your previous response: x\n\nYour next reply must be a minimal valid tool reply."},
		{Role: "user", Content: "<user_message>\n继续\n</user_message>"},
	}
	cleaned := purgeAIProtocolRetryNoiseFromMessages(messages)
	if len(cleaned) != 3 {
		t.Fatalf("expected 3 messages after purge, got %d", len(cleaned))
	}
	if isAIProtocolRetryUserMessage(cleaned[1].Content) {
		t.Fatal("protocol retry user message was not purged")
	}
	if !strings.HasPrefix(strings.TrimSpace(cleaned[1].Content), "<execute_command>") {
		t.Fatalf("assistant history not rewritten to clean tool XML: %q", cleaned[1].Content)
	}
	if cleaned[2].Content != "<user_message>\n继续\n</user_message>" {
		t.Fatalf("latest user message changed: %q", cleaned[2].Content)
	}
}

func TestSanitizeAIAssistantToolProtocolText_DoesNotRewriteBareNameInsideCommand(t *testing.T) {
	raw := `<execute_command>
<command>echo execute_command> /tmp/x</command>
<cwd>/root</cwd>
<is_mutating>0</is_mutating>
<purpose>write marker</purpose>
<session_id>session_1</session_id>
<shellType>zsh</shellType>
</execute_command>`
	tools, err := parseAssistantToolUses(raw)
	if err != nil {
		t.Fatalf("expected parse success, got %v", err)
	}
	if tools[0].Params["command"] != "echo execute_command> /tmp/x" {
		t.Fatalf("command param rewritten: %q", tools[0].Params["command"])
	}
}

func toolNames(tools []aiParsedToolUse) []string {
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	return names
}
