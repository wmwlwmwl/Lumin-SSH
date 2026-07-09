package ai

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"luminssh-go/internal/mcpserver"
)

type ToolExecutionAction string

const (
	ToolExecutionActionNone      ToolExecutionAction = ""
	ToolExecutionActionContinue  ToolExecutionAction = "continue"
	ToolExecutionActionTerminate ToolExecutionAction = "terminate"
)

const (
	aiToolExecutionActionNone      = ToolExecutionActionNone
	aiToolExecutionActionContinue  = ToolExecutionActionContinue
	aiToolExecutionActionTerminate = ToolExecutionActionTerminate
)

type aiToolExecutionAction = ToolExecutionAction

type ToolExecutionState struct {
	ExecutionID             string
	RequestID               string
	AssistantMessageID      string
	ToolIndex               int
	ToolMessageID           string
	Tool                    aiParsedToolUse
	Batch                   *aiPendingToolBatch
	TargetSessionID         string
	AllowContinue           bool
	AllowTerminate          bool
	AllowTerminalAssignment bool
	DecisionCh              chan aiToolExecutionAction
	ReassignCh              chan string
	ExecutionCtx            context.Context
	Cancel                  context.CancelFunc
	mu                      sync.Mutex
	terminated              bool
	snapshotOutputValue     string
}

type AIChatCommandTerminalCandidate struct {
	SessionID   string `json:"sessionId"`
	Busy        bool   `json:"busy"`
	Cwd         string `json:"cwd"`
	Current     bool   `json:"current"`
	Recommended bool   `json:"recommended"`
}

type aiToolExecutionState = ToolExecutionState

type aiFollowupXMLPayload struct {
	Suggestions []aiFollowupXMLSuggestion `xml:"suggest"`
}

type aiFollowupXMLSuggestion struct {
	Text string `xml:",chardata"`
}

func parseAIFollowupSuggestions(raw string) ([]string, error) {
	payload := strings.TrimSpace(raw)
	if payload == "" {
		return nil, fmt.Errorf("follow_up 不能为空")
	}
	if !strings.HasPrefix(payload, "<follow_up") {
		payload = "<follow_up>" + payload + "</follow_up>"
	}
	var parsed aiFollowupXMLPayload
	if err := xml.Unmarshal([]byte(payload), &parsed); err != nil {
		return nil, fmt.Errorf("follow_up XML 非法: %w", err)
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
		return nil, fmt.Errorf("follow_up 必须包含 2 到 4 个建议")
	}
	return suggestions, nil
}

func decodeAIFollowupImages(raw string) []string {
	payload := strings.TrimSpace(raw)
	if payload == "" {
		return []string{}
	}
	var images []string
	if err := json.Unmarshal([]byte(payload), &images); err != nil {
		return []string{}
	}
	return normalizeAIStringList(images)
}

func buildAIFollowupMessage(turnID string, requestID string, tool aiParsedToolUse, index int) (map[string]interface{}, error) {
	question := strings.TrimSpace(tool.Params["question"])
	if question == "" {
		return nil, fmt.Errorf("ask_followup_question 缺少 question")
	}
	suggestions, err := parseAIFollowupSuggestions(tool.Params["follow_up"])
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"id":          buildToolMessageID(turnID, index),
		"turnId":      turnID,
		"kind":        "followup",
		"requestId":   requestID,
		"question":    question,
		"suggestions": suggestions,
		"status":      "等待回复",
	}, nil
}

func (e *aiToolExecutionState) setSnapshotOutput(value string) {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.snapshotOutputValue = value
	e.mu.Unlock()
}

func (e *aiToolExecutionState) snapshotOutput() string {
	if e == nil {
		return ""
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.snapshotOutputValue
}

func (e *aiToolExecutionState) setTargetSessionID(value string) {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.TargetSessionID = strings.TrimSpace(value)
	e.mu.Unlock()
}

func (e *aiToolExecutionState) targetSessionID() string {
	if e == nil {
		return ""
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return strings.TrimSpace(e.TargetSessionID)
}

func (e *aiToolExecutionState) setAllowTerminalAssignment(enabled bool) {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.AllowTerminalAssignment = enabled
	e.mu.Unlock()
}

func (e *aiToolExecutionState) allowTerminalAssignment() bool {
	if e == nil {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.AllowTerminalAssignment
}

func (e *aiToolExecutionState) requestTerminalAssignment(sessionID string) bool {
	if e == nil {
		return false
	}
	trimmedSessionID := strings.TrimSpace(sessionID)
	if trimmedSessionID == "" {
		return false
	}
	e.setTargetSessionID(trimmedSessionID)
	if e.ReassignCh == nil {
		return false
	}
	for {
		select {
		case <-e.ReassignCh:
		default:
			select {
			case e.ReassignCh <- trimmedSessionID:
				return true
			default:
				return false
			}
		}
	}
}

func (e *aiToolExecutionState) markTerminated() bool {
	if e == nil {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.terminated {
		return false
	}
	e.terminated = true
	return true
}

func (e *aiToolExecutionState) isTerminated() bool {
	if e == nil {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.terminated
}

func (a *App) setAIChatToolExecution(requestID string, execution *aiToolExecutionState) {
	if a == nil || strings.TrimSpace(requestID) == "" || execution == nil {
		return
	}
	a.aiToolExecMu.Lock()
	a.aiToolExecutions[strings.TrimSpace(requestID)] = execution
	a.aiToolExecMu.Unlock()
}

func (a *App) getAIChatToolExecution(requestID string) *aiToolExecutionState {
	if a == nil || strings.TrimSpace(requestID) == "" {
		return nil
	}
	a.aiToolExecMu.Lock()
	defer a.aiToolExecMu.Unlock()
	return a.aiToolExecutions[strings.TrimSpace(requestID)]
}

func (a *App) popAIChatToolExecution(requestID string) *aiToolExecutionState {
	if a == nil || strings.TrimSpace(requestID) == "" {
		return nil
	}
	a.aiToolExecMu.Lock()
	defer a.aiToolExecMu.Unlock()
	execution := a.aiToolExecutions[strings.TrimSpace(requestID)]
	delete(a.aiToolExecutions, strings.TrimSpace(requestID))
	return execution
}

func (a *App) popAIChatToolExecutionIfMatches(requestID string, executionID string) *aiToolExecutionState {
	if a == nil || strings.TrimSpace(requestID) == "" || strings.TrimSpace(executionID) == "" {
		return nil
	}
	a.aiToolExecMu.Lock()
	defer a.aiToolExecMu.Unlock()
	execution := a.aiToolExecutions[strings.TrimSpace(requestID)]
	if execution == nil || execution.ExecutionID != strings.TrimSpace(executionID) {
		return nil
	}
	delete(a.aiToolExecutions, strings.TrimSpace(requestID))
	return execution
}

func (a *App) isAIChatToolExecutionCurrent(requestID string, executionID string) bool {
	if a == nil || strings.TrimSpace(requestID) == "" || strings.TrimSpace(executionID) == "" {
		return false
	}
	a.aiToolExecMu.Lock()
	defer a.aiToolExecMu.Unlock()
	execution := a.aiToolExecutions[strings.TrimSpace(requestID)]
	return execution != nil && execution.ExecutionID == strings.TrimSpace(executionID)
}

func (a *App) ListAIChatCommandTerminalCandidates(requestID string) ([]AIChatCommandTerminalCandidate, error) {
	trimmedRequestID := strings.TrimSpace(requestID)
	if a == nil || trimmedRequestID == "" {
		return nil, fmt.Errorf("没有可指派的命令实例")
	}
	if a.sshManager == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	execution := a.getAIChatToolExecution(trimmedRequestID)
	if execution == nil || execution.Batch == nil {
		return nil, fmt.Errorf("没有可指派的命令实例")
	}
	if strings.TrimSpace(execution.Tool.Name) != "execute_command" {
		return nil, fmt.Errorf("当前工具不支持指派终端")
	}
	targetSessionID := execution.targetSessionID()
	if targetSessionID == "" {
		targetSessionID = strings.TrimSpace(execution.Batch.Payload.SessionID)
	}
	if targetSessionID == "" {
		return nil, fmt.Errorf("当前工具缺少目标终端")
	}
	return a.sshManager.ListSiblingTerminalCandidates(targetSessionID)
}

func (a *App) AssignAIChatToolTerminal(requestID string, targetSessionID string) error {
	trimmedRequestID := strings.TrimSpace(requestID)
	trimmedTargetSessionID := strings.TrimSpace(targetSessionID)
	if a == nil || trimmedRequestID == "" {
		return fmt.Errorf("没有可指派的命令实例")
	}
	if trimmedTargetSessionID == "" {
		return fmt.Errorf("目标终端不能为空")
	}
	if a.sshManager == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	execution := a.getAIChatToolExecution(trimmedRequestID)
	if execution == nil || execution.Batch == nil {
		return fmt.Errorf("没有可指派的命令实例")
	}
	if strings.TrimSpace(execution.Tool.Name) != "execute_command" {
		return fmt.Errorf("当前工具不支持指派终端")
	}
	if !execution.allowTerminalAssignment() {
		return fmt.Errorf("当前工具未处于可指派状态")
	}
	currentTargetSessionID := execution.targetSessionID()
	if currentTargetSessionID == "" {
		currentTargetSessionID = strings.TrimSpace(execution.Batch.Payload.SessionID)
	}
	candidates, err := a.sshManager.ListSiblingTerminalCandidates(currentTargetSessionID)
	if err != nil {
		return err
	}
	targetCwd := ""
	allowed := false
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.SessionID) != trimmedTargetSessionID {
			continue
		}
		targetCwd = strings.TrimSpace(candidate.Cwd)
		allowed = true
		break
	}
	if !allowed {
		return fmt.Errorf("目标终端不可用")
	}
	if !execution.requestTerminalAssignment(trimmedTargetSessionID) {
		return fmt.Errorf("当前工具无法切换目标终端")
	}
	a.emitAIChatToolExecutionTerminalAssignmentRequired(
		trimmedRequestID,
		execution,
		buildAIChatCommandToolMessage(
			execution,
			execution.Tool.Params["purpose"],
			execution.Tool.Params["command"],
			"",
			"排队中, 等待终端空闲",
			buildAIChatCommandMessageExtra(trimmedTargetSessionID, targetCwd),
		),
	)
	return nil
}

func getAIToolRemainingFileEdits(tool aiParsedToolUse) int {
	parsedValue, err := strconv.Atoi(strings.TrimSpace(tool.Params["remaining_file_edits"]))
	if err != nil || parsedValue < 1 {
		return 0
	}
	return parsedValue
}

func buildToolPreviewMessage(turnID string, tool aiParsedToolUse, index int) map[string]interface{} {
	if tool.Name == "execute_command" {
		return map[string]interface{}{
			"id":      buildToolMessageID(turnID, index),
			"turnId":  turnID,
			"kind":    "command",
			"purpose": tool.Params["purpose"],
			"command": tool.Params["command"],
			"output":  "等待批准后执行",
			"status":  "待批准",
		}
	}
	if tool.Name == "ask_followup_question" {
		message, err := buildAIFollowupMessage(turnID, "", tool, index)
		if err == nil {
			return message
		}
	}
	if tool.Name == "attempt_completion" {
		return map[string]interface{}{
			"id":      buildToolMessageID(turnID, index),
			"turnId":  turnID,
			"kind":    "completion",
			"title":   titleForParsedToolUse(tool),
			"summary": "",
			"result":  strings.TrimSpace(tool.Params["result"]),
			"status":  "待完成",
		}
	}
	return map[string]interface{}{
		"id":                 buildToolMessageID(turnID, index),
		"turnId":             turnID,
		"kind":               "tool",
		"actionLabel":        tool.Name,
		"title":              titleForParsedToolUse(tool),
		"summary":            summarizeParsedToolUse(tool),
		"code":               tool.RawXML,
		"status":             "待批准",
		"remainingFileEdits": getAIToolRemainingFileEdits(tool),
	}
}

func isChangeReviewTool(tool aiParsedToolUse) bool {
	switch strings.TrimSpace(tool.Name) {
	case "apply_diff", "write_to_file", "search_replace", "edit_file":
		return true
	default:
		return false
	}
}

func formatChangeReviewFailure(failure *mcpserver.EditMatchFailure, startLine int) string {
	if failure == nil {
		return "无法生成变更审阅预览"
	}
	var builder strings.Builder
	builder.WriteString(strings.TrimSpace(failure.Reason))
	if startLine > 0 {
		builder.WriteString(fmt.Sprintf("\n起始行: %d", startLine))
	}
	if failure.Occurrences > 0 {
		builder.WriteString(fmt.Sprintf("\n匹配次数: %d", failure.Occurrences))
	}
	if failure.Similarity > 0 || failure.RequiredSimilarity > 0 {
		builder.WriteString(fmt.Sprintf("\n相似度: %.0f%% / 需要 %.0f%%", failure.Similarity*100, failure.RequiredSimilarity*100))
	}
	if strings.TrimSpace(failure.BestMatch) != "" {
		builder.WriteString("\n\n最佳匹配片段:\n")
		builder.WriteString(strings.TrimSpace(failure.BestMatch))
	}
	return builder.String()
}

func buildChangeReviewMessage(turnID string, tool aiParsedToolUse, index int) map[string]interface{} {
	message := buildToolPreviewMessage(turnID, tool, index)
	message["status"] = "待审阅"
	message["result"] = "等待在变更审阅台中批准后写入"
	return message
}

func buildChangeReviewEnvelope(turnID string, index int, sessionID string, remotePath string, tool aiParsedToolUse, rawPayload string, blocks []map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"reviewId":      buildToolMessageID(turnID, index),
		"title":         "变更审阅台",
		"requestId":     "",
		"toolMessageId": buildToolMessageID(turnID, index),
		"sessionId":     sessionID,
		"path":          remotePath,
		"toolName":      strings.TrimSpace(tool.Name),
		"summary":       summarizeParsedToolUse(tool),
		"rawDiff":       rawPayload,
		"blocks":        blocks,
	}
}

func (a *App) buildApplyDiffChangeReview(tool aiParsedToolUse, payload AIChatRequestPayload, turnID string, index int) (map[string]interface{}, map[string]interface{}, error) {
	if a == nil {
		return nil, nil, fmt.Errorf("app unavailable")
	}
	sessionID := strings.TrimSpace(payload.SessionID)
	if sessionID == "" {
		return nil, nil, fmt.Errorf("apply_diff 缺少 session_id")
	}
	remotePath := strings.TrimSpace(tool.Params["path"])
	if remotePath == "" {
		return nil, nil, fmt.Errorf("apply_diff 缺少 path")
	}
	diffPayload := tool.Params["diff"]
	if strings.TrimSpace(diffPayload) == "" {
		return nil, nil, fmt.Errorf("apply_diff 缺少 diff")
	}
	fileProvider := mcpFileProvider{app: a}
	originalContent, err := fileProvider.ReadTextFileContext(context.Background(), sessionID, remotePath)
	if err != nil {
		return nil, nil, err
	}
	preview, err := mcpserver.BuildApplyDiffPreview(remotePath, originalContent, diffPayload)
	if err != nil {
		return nil, nil, err
	}
	if preview.Failure != nil {
		return nil, nil, errors.New(formatChangeReviewFailure(preview.Failure, preview.FailureBlockStartLine))
	}

	reviewBlocks := make([]map[string]interface{}, 0, len(preview.Blocks))
	for _, block := range preview.Blocks {
		reviewBlocks = append(reviewBlocks, map[string]interface{}{
			"index":            block.Index,
			"label":            fmt.Sprintf("SEARCH/REPLACE #%d", block.Index+1),
			"startLine":        block.StartLine,
			"matchedStartLine": block.MatchedStartLine,
			"before":           block.MatchedSearch,
			"after":            block.Replace,
		})
	}

	return buildChangeReviewMessage(turnID, tool, index), buildChangeReviewEnvelope(turnID, index, sessionID, remotePath, tool, diffPayload, reviewBlocks), nil
}

func (a *App) buildWriteToFileChangeReview(tool aiParsedToolUse, payload AIChatRequestPayload, turnID string, index int) (map[string]interface{}, map[string]interface{}, error) {
	if a == nil {
		return nil, nil, fmt.Errorf("app unavailable")
	}
	sessionID := strings.TrimSpace(payload.SessionID)
	if sessionID == "" {
		return nil, nil, fmt.Errorf("write_to_file 缺少 session_id")
	}
	remotePath := strings.TrimSpace(tool.Params["path"])
	if remotePath == "" {
		return nil, nil, fmt.Errorf("write_to_file 缺少 path")
	}
	finalContent := tool.Params["content"]
	fileProvider := mcpFileProvider{app: a}
	originalContent, readErr := fileProvider.ReadTextFileContext(context.Background(), sessionID, remotePath)
	isNewFile := false
	if readErr != nil {
		originalContent = ""
		isNewFile = true
	}
	label := "整文件覆盖"
	if isNewFile {
		label = "创建文件"
	}
	blocks := []map[string]interface{}{
		{
			"index":  0,
			"label":  label,
			"before": originalContent,
			"after":  finalContent,
		},
	}
	return buildChangeReviewMessage(turnID, tool, index), buildChangeReviewEnvelope(turnID, index, sessionID, remotePath, tool, finalContent, blocks), nil
}

func parseSearchReplaceOperations(raw string) ([]mcpserver.SearchReplaceOperation, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, fmt.Errorf("search_replace 缺少 operations")
	}
	var operations []mcpserver.SearchReplaceOperation
	if err := json.Unmarshal([]byte(trimmed), &operations); err != nil {
		return nil, fmt.Errorf("search_replace operations 不是合法 JSON: %w", err)
	}
	if len(operations) == 0 {
		return nil, fmt.Errorf("search_replace operations 不能为空")
	}
	return operations, nil
}

func (a *App) buildSearchReplaceChangeReview(tool aiParsedToolUse, payload AIChatRequestPayload, turnID string, index int) (map[string]interface{}, map[string]interface{}, error) {
	if a == nil {
		return nil, nil, fmt.Errorf("app unavailable")
	}
	sessionID := strings.TrimSpace(payload.SessionID)
	if sessionID == "" {
		return nil, nil, fmt.Errorf("search_replace 缺少 session_id")
	}
	remotePath := strings.TrimSpace(tool.Params["path"])
	if remotePath == "" {
		return nil, nil, fmt.Errorf("search_replace 缺少 path")
	}
	operationsRaw := tool.Params["operations"]
	operations, err := parseSearchReplaceOperations(operationsRaw)
	if err != nil {
		return nil, nil, err
	}
	fileProvider := mcpFileProvider{app: a}
	originalContent, err := fileProvider.ReadTextFileContext(context.Background(), sessionID, remotePath)
	if err != nil {
		return nil, nil, err
	}
	preview, err := mcpserver.BuildSearchReplaceReviewPreview(remotePath, originalContent, operations)
	if err != nil {
		return nil, nil, err
	}
	if preview.Failure != nil {
		return nil, nil, errors.New(formatChangeReviewFailure(preview.Failure, 0))
	}
	label := fmt.Sprintf("整文件预览（%d 个 Search/Replace）", len(preview.Operations))
	if len(preview.Operations) == 1 {
		label = "整文件预览（1 个 Search/Replace）"
	}
	blocks := []map[string]interface{}{
		{
			"index":  0,
			"label":  label,
			"before": preview.OriginalContent,
			"after":  preview.PreviewContent,
		},
	}
	return buildChangeReviewMessage(turnID, tool, index), buildChangeReviewEnvelope(turnID, index, sessionID, remotePath, tool, operationsRaw, blocks), nil
}

func (a *App) buildEditFileChangeReview(tool aiParsedToolUse, payload AIChatRequestPayload, turnID string, index int) (map[string]interface{}, map[string]interface{}, error) {
	if a == nil {
		return nil, nil, fmt.Errorf("app unavailable")
	}
	sessionID := strings.TrimSpace(payload.SessionID)
	if sessionID == "" {
		return nil, nil, fmt.Errorf("edit_file 缺少 session_id")
	}
	remotePath := strings.TrimSpace(tool.Params["path"])
	if remotePath == "" {
		return nil, nil, fmt.Errorf("edit_file 缺少 path")
	}
	expectedReplacements := 1
	if rawExpected := strings.TrimSpace(tool.Params["expected_replacements"]); rawExpected != "" {
		parsedExpected, err := strconv.Atoi(rawExpected)
		if err != nil || parsedExpected < 1 {
			return nil, nil, fmt.Errorf("edit_file expected_replacements 非法")
		}
		expectedReplacements = parsedExpected
	}
	fileProvider := mcpFileProvider{app: a}
	originalContent, err := fileProvider.ReadTextFileContext(context.Background(), sessionID, remotePath)
	if err != nil {
		return nil, nil, err
	}
	preview, err := mcpserver.BuildEditFileReviewPreview(remotePath, originalContent, tool.Params["old_string"], tool.Params["new_string"], expectedReplacements)
	if err != nil {
		return nil, nil, err
	}
	if preview.Failure != nil {
		return nil, nil, errors.New(formatChangeReviewFailure(preview.Failure, 0))
	}
	label := "精确替换"
	beforeText := preview.Search
	afterText := preview.Replace
	if preview.ExpectedReplacements > 1 || preview.Occurrences > 1 {
		label = fmt.Sprintf("整文件预览（共 %d 处替换）", preview.Occurrences)
		beforeText = preview.OriginalContent
		afterText = preview.PreviewContent
	}
	blocks := []map[string]interface{}{
		{
			"index":  0,
			"label":  label,
			"before": beforeText,
			"after":  afterText,
		},
	}
	rawPayload := fmt.Sprintf("{\"old_string\":%q,\"new_string\":%q,\"expected_replacements\":%d}", preview.Search, preview.Replace, preview.ExpectedReplacements)
	return buildChangeReviewMessage(turnID, tool, index), buildChangeReviewEnvelope(turnID, index, sessionID, remotePath, tool, rawPayload, blocks), nil
}

func (a *App) buildToolChangeReview(tool aiParsedToolUse, payload AIChatRequestPayload, turnID string, index int) (map[string]interface{}, map[string]interface{}, error) {
	switch strings.TrimSpace(tool.Name) {
	case "apply_diff":
		return a.buildApplyDiffChangeReview(tool, payload, turnID, index)
	case "write_to_file":
		return a.buildWriteToFileChangeReview(tool, payload, turnID, index)
	case "search_replace":
		return a.buildSearchReplaceChangeReview(tool, payload, turnID, index)
	case "edit_file":
		return a.buildEditFileChangeReview(tool, payload, turnID, index)
	default:
		return nil, nil, fmt.Errorf("该工具当前不支持变更审阅台")
	}
}

func (a *App) failAIChatToolPreview(requestID string, batch *aiPendingToolBatch, tool aiParsedToolUse, resultText string) {
	if a == nil || batch == nil {
		return
	}
	message := buildToolPreviewMessage(batch.AssistantMessageID, tool, batch.NextToolIndex)
	message["status"] = "错误"
	if tool.Name == "execute_command" {
		message["output"] = resultText
	} else {
		message["result"] = resultText
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "upsert_message",
		"requestId": requestID,
		"message":   message,
	})
	execution := &aiToolExecutionState{
		RequestID:          requestID,
		AssistantMessageID: batch.AssistantMessageID,
		ToolIndex:          batch.NextToolIndex,
		ToolMessageID:      buildToolMessageID(batch.AssistantMessageID, batch.NextToolIndex),
		Tool:               tool,
		Batch:              batch,
	}
	a.emitAIChatToolResultMessage(requestID, execution, resultText)
	a.emitAIChatToolExecutionPersistRequested(requestID)
	batch.NextToolIndex = len(batch.ParsedTools)
	a.resumeAIChatAfterToolBatch(requestID, batch)
}

func buildAIChatToolResultMessage(toolName string, resultText string) AIChatRequestMessage {
	return AIChatRequestMessage{
		Role:    "user",
		Content: fmt.Sprintf("[%s] Result:\n%s", toolName, resultText),
	}
}

func shouldSuppressAIChatToolResultUserMessage(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "ask_followup_question", "attempt_completion":
		return true
	default:
		return false
	}
}

func (a *App) emitAIChatToolResultMessage(requestID string, execution *aiToolExecutionState, resultText string) {
	if a == nil || execution == nil || execution.Batch == nil {
		return
	}
	if shouldSuppressAIChatToolResultUserMessage(execution.Tool.Name) {
		return
	}
	execution.Batch.RequestMessages = append(execution.Batch.RequestMessages, buildAIChatToolResultMessage(execution.Tool.Name, resultText))
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "api_message_append",
		"requestId": requestID,
		"message": map[string]interface{}{
			"messageId":    fmt.Sprintf("api-tool-result-%d", time.Now().UnixNano()),
			"role":         "user",
			"content":      fmt.Sprintf("[%s] Result:\n%s", execution.Tool.Name, resultText),
			"uiMessageIds": []string{execution.ToolMessageID},
			"ts":           time.Now().UnixMilli(),
		},
	})
}

func (a *App) emitAIChatToolExecutionStarted(requestID string, execution *aiToolExecutionState, message map[string]interface{}) {
	if a == nil || execution == nil {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":           "tool_execution_started",
		"requestId":      requestID,
		"executionId":    execution.ExecutionID,
		"allowContinue":  execution.AllowContinue,
		"allowTerminate": execution.AllowTerminate,
		"message":        message,
	})
}

func (a *App) emitAIChatToolExecutionActionRequired(requestID string, execution *aiToolExecutionState, message map[string]interface{}) {
	if a == nil || execution == nil {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":           "tool_execution_action_required",
		"requestId":      requestID,
		"executionId":    execution.ExecutionID,
		"allowContinue":  true,
		"allowTerminate": execution.AllowTerminate,
		"message":        message,
	})
}

func (a *App) emitAIChatToolExecutionPersistRequested(requestID string) {
	if a == nil || strings.TrimSpace(requestID) == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "tool_execution_persist_requested",
		"requestId": strings.TrimSpace(requestID),
	})
}

func buildAIChatCommandMessageExtra(targetSessionID string, targetCwd string) map[string]interface{} {
	extra := map[string]interface{}{}
	if trimmedTargetSessionID := strings.TrimSpace(targetSessionID); trimmedTargetSessionID != "" {
		extra["targetSessionId"] = trimmedTargetSessionID
	}
	if trimmedTargetCwd := strings.TrimSpace(targetCwd); trimmedTargetCwd != "" {
		extra["targetCwd"] = trimmedTargetCwd
	}
	return extra
}

func buildAIChatCommandToolMessage(execution *aiToolExecutionState, purpose string, command string, output string, status string, extra map[string]interface{}) map[string]interface{} {
	if execution == nil {
		return map[string]interface{}{}
	}
	message := map[string]interface{}{
		"id":      execution.ToolMessageID,
		"turnId":  execution.AssistantMessageID,
		"kind":    "command",
		"purpose": purpose,
		"command": command,
		"output":  output,
		"status":  status,
	}
	if len(extra) > 0 {
		message["extra"] = extra
	}
	return message
}

func (a *App) emitAIChatCommandToolMessage(requestID string, execution *aiToolExecutionState, purpose string, command string, output string, status string, extra map[string]interface{}) {
	if a == nil || execution == nil || strings.TrimSpace(requestID) == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "upsert_message",
		"requestId": strings.TrimSpace(requestID),
		"message":   buildAIChatCommandToolMessage(execution, purpose, command, output, status, extra),
	})
}

func (a *App) emitAIChatToolExecutionTerminalAssignmentRequired(requestID string, execution *aiToolExecutionState, message map[string]interface{}) {
	if a == nil || execution == nil || strings.TrimSpace(requestID) == "" {
		return
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":           "tool_execution_terminal_assignment_required",
		"requestId":      strings.TrimSpace(requestID),
		"executionId":    execution.ExecutionID,
		"allowTerminate": execution.AllowTerminate,
		"message":        message,
	})
}

func (a *App) skipCompatibleAIChatAfterResolvedTools(requestID string) {
	if a == nil || strings.TrimSpace(requestID) == "" {
		return
	}
	a.emitAIChatRuntimePhase(requestID, "ready")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "automatic_request_skipped",
		"requestId": strings.TrimSpace(requestID),
	})
	a.finishAIChatRequest(strings.TrimSpace(requestID))
}

func (a *App) continueCompatibleAIChatAfterResolvedTools(ctx context.Context, requestID string, batch *aiPendingToolBatch) {
	if a == nil || batch == nil {
		return
	}
	if a.consumeAIChatSkipNextAutomaticRequest(requestID) {
		a.skipCompatibleAIChatAfterResolvedTools(requestID)
		return
	}
	nextAssistantMessageID := fmt.Sprintf("%s-cont-%d", requestID, time.Now().UnixNano())
	a.emitAIChatRuntimePhase(requestID, "api_request")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "assistant_continue",
		"requestId": requestID,
		"messageId": nextAssistantMessageID,
	})
	a.runCompatibleAIChatLoop(ctx, requestID, batch.Payload, batch.Profile, append([]AIChatRequestMessage{}, batch.RequestMessages...), batch.AutoApprovalSettings, nextAssistantMessageID)
}

func (a *App) resumeAIChatAfterToolBatch(requestID string, batch *aiPendingToolBatch) {
	if a == nil || batch == nil {
		return
	}
	a.emitAIChatRuntimePhase(requestID, "between_tool_and_next_api")
	ctx, cancel := context.WithCancel(context.Background())
	a.setAIChatRequestCancel(requestID, cancel)
	go a.continueCompatibleAIChatAfterResolvedTools(ctx, requestID, batch)
}

func (a *App) advanceAIChatToolBatch(requestID string, batch *aiPendingToolBatch) {
	if a == nil || batch == nil {
		return
	}
	if batch.NextToolIndex >= len(batch.ParsedTools) {
		a.resumeAIChatAfterToolBatch(requestID, batch)
		return
	}

	a.emitAIChatRuntimePhase(requestID, "tool_session")
	tool := batch.ParsedTools[batch.NextToolIndex]
	if tool.Name == "ask_followup_question" {
		a.startAIChatFollowup(requestID, batch)
		return
	}
	if tool.Name == "attempt_completion" {
		a.startAIChatToolExecution(requestID, batch)
		return
	}
	decision := getAIParsedToolUseDecision(batch.AutoApprovalSettings, tool)

	if decision == aiApprovalDecisionAutoDeny {
		message := buildToolPreviewMessage(batch.AssistantMessageID, tool, batch.NextToolIndex)
		if tool.Name == "execute_command" {
			message["status"] = "已拒绝"
			message["output"] = "命令匹配拒绝规则，已自动拒绝执行工具调用"
		} else {
			message["status"] = "已拒绝"
			message["result"] = "命令匹配拒绝规则，已自动拒绝执行工具调用"
		}
		a.emitAIChatEvent(map[string]interface{}{
			"kind":      "upsert_message",
			"requestId": requestID,
			"message":   message,
		})
		execution := &aiToolExecutionState{
			RequestID:          requestID,
			AssistantMessageID: batch.AssistantMessageID,
			ToolIndex:          batch.NextToolIndex,
			ToolMessageID:      buildToolMessageID(batch.AssistantMessageID, batch.NextToolIndex),
			Tool:               tool,
			Batch:              batch,
		}
		a.emitAIChatToolResultMessage(requestID, execution, "命令匹配拒绝规则，已自动拒绝执行工具调用")
		a.emitAIChatToolExecutionPersistRequested(requestID)
		batch.NextToolIndex++
		a.advanceAIChatToolBatch(requestID, batch)
		return
	}

	if decision == aiApprovalDecisionAskUser {
		if isChangeReviewTool(tool) {
			message, review, err := a.buildToolChangeReview(tool, batch.Payload, batch.AssistantMessageID, batch.NextToolIndex)
			if err != nil {
				a.failAIChatToolPreview(requestID, batch, tool, err.Error())
				return
			}
			review["requestId"] = requestID
			a.setAIChatPendingToolBatch(requestID, batch)
			a.emitAIChatEvent(map[string]interface{}{
				"kind":         "tool_approval_required",
				"requestId":    requestID,
				"approvalMode": "change_review",
				"messages":     []map[string]interface{}{message},
			})
			a.emitAIChatEvent(map[string]interface{}{
				"kind":      "change_review_required",
				"requestId": requestID,
				"review":    review,
			})
			return
		}
		a.setAIChatPendingToolBatch(requestID, batch)
		a.emitAIChatEvent(map[string]interface{}{
			"kind":         "tool_approval_required",
			"requestId":    requestID,
			"approvalMode": "inline",
			"messages":     []map[string]interface{}{buildToolPreviewMessage(batch.AssistantMessageID, tool, batch.NextToolIndex)},
		})
		return
	}

	a.startAIChatToolExecution(requestID, batch)
}

func (a *App) startAIChatFollowup(requestID string, batch *aiPendingToolBatch) {
	if a == nil || batch == nil || batch.NextToolIndex >= len(batch.ParsedTools) {
		return
	}
	tool := batch.ParsedTools[batch.NextToolIndex]
	message, err := buildAIFollowupMessage(batch.AssistantMessageID, requestID, tool, batch.NextToolIndex)
	if err != nil {
		a.failAIChatToolPreview(requestID, batch, tool, err.Error())
		return
	}
	a.emitAIChatRuntimePhase(requestID, "ready")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "followup_required",
		"requestId": requestID,
		"message":   message,
	})
	a.finishAIChatRequest(requestID)
}

func (a *App) startAIChatToolExecution(requestID string, batch *aiPendingToolBatch) {
	if a == nil || batch == nil || batch.NextToolIndex >= len(batch.ParsedTools) {
		return
	}
	tool := batch.ParsedTools[batch.NextToolIndex]
	executionID := fmt.Sprintf("%s-tool-exec-%d-%d", requestID, batch.NextToolIndex, time.Now().UnixNano())
	executionCtx, cancel := context.WithCancel(context.Background())
	execution := &aiToolExecutionState{
		ExecutionID:             executionID,
		RequestID:               requestID,
		AssistantMessageID:      batch.AssistantMessageID,
		ToolIndex:               batch.NextToolIndex,
		ToolMessageID:           buildToolMessageID(batch.AssistantMessageID, batch.NextToolIndex),
		Tool:                    tool,
		Batch:                   batch,
		TargetSessionID:         strings.TrimSpace(batch.Payload.SessionID),
		AllowContinue:           false,
		AllowTerminate:          true,
		AllowTerminalAssignment: false,
		DecisionCh:              make(chan aiToolExecutionAction, 1),
		ReassignCh:              make(chan string, 1),
		ExecutionCtx:            executionCtx,
		Cancel:                  cancel,
	}
	a.setAIChatToolExecution(requestID, execution)
	message := buildToolPreviewMessage(batch.AssistantMessageID, tool, batch.NextToolIndex)
	message["status"] = "执行中"
	if tool.Name == "execute_command" {
		message = buildAIChatCommandToolMessage(
			execution,
			tool.Params["purpose"],
			tool.Params["command"],
			"",
			"执行中",
			buildAIChatCommandMessageExtra(execution.TargetSessionID, ""),
		)
	}
	a.emitAIChatToolExecutionStarted(requestID, execution, message)

	if tool.Name == "attempt_completion" {
		go a.runAIChatAttemptCompletionExecution(execution)
		return
	}
	if tool.Name == "execute_command" {
		go a.runAIChatCommandToolExecution(execution)
		return
	}
	if tool.Name == "live_search" {
		go a.runAIChatLiveSearchToolExecution(execution)
		return
	}
	go a.runAIChatGenericToolExecution(execution)
}

func (a *App) runAIChatAttemptCompletionExecution(execution *aiToolExecutionState) {
	if a == nil || execution == nil || execution.Batch == nil {
		return
	}
	if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
		return
	}
	a.popAIChatToolExecutionIfMatches(execution.RequestID, execution.ExecutionID)
	if execution.Cancel != nil {
		execution.Cancel()
	}
	resultText := sanitizeAIToolResultText(strings.TrimSpace(execution.Tool.Params["result"]))
	statusText := "已完成"
	toolResultText := "Done"
	if resultText == "" {
		resultText = "任务已完成"
	}
	if execution.isTerminated() {
		statusText = "已终止"
		resultText = "工具已终止"
		toolResultText = "工具已终止"
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "upsert_message",
		"requestId": execution.RequestID,
		"message": map[string]interface{}{
			"id":      execution.ToolMessageID,
			"turnId":  execution.AssistantMessageID,
			"kind":    "completion",
			"title":   titleForParsedToolUse(execution.Tool),
			"summary": "",
			"result":  resultText,
			"status":  statusText,
		},
	})
	a.emitAIChatToolResultMessage(execution.RequestID, execution, toolResultText)
	a.emitAIChatToolExecutionPersistRequested(execution.RequestID)
	a.emitAIChatRuntimePhase(execution.RequestID, "ready")
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "automatic_request_skipped",
		"requestId": execution.RequestID,
	})
	a.finishAIChatRequest(execution.RequestID)
}

func (a *App) runAIChatGenericToolExecution(execution *aiToolExecutionState) {
	if a == nil || execution == nil || execution.Batch == nil {
		return
	}
	service := mcpserver.NewService(mcpSessionProvider{app: a})
	catalog := mcpserver.NewCatalog(service, mcpFileProvider{app: a}, mcpCommandProvider{app: a}, mcpRemoteEditExecutor{app: a})
	arguments := convertToolArguments(execution.Tool, execution.Batch.Payload.SessionID)
	callResult, callErr := catalog.CallWithContext(execution.ExecutionCtx, execution.Tool.Name, arguments)

	if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
		return
	}

	a.popAIChatToolExecutionIfMatches(execution.RequestID, execution.ExecutionID)
	if execution.Cancel != nil {
		execution.Cancel()
	}

	statusText := "已执行"
	uiResultText := ""
	rawResultText := ""
	stopAfterThisTool := false

	if callErr != nil {
		if execution.isTerminated() || errors.Is(callErr, context.Canceled) {
			statusText = "已终止"
			uiResultText = execution.snapshotOutput()
			rawResultText = execution.snapshotOutput()
			if strings.TrimSpace(uiResultText) == "" {
				uiResultText = "工具已终止"
			}
			if strings.TrimSpace(rawResultText) == "" {
				rawResultText = "工具已终止"
			}
		} else {
			statusText = "错误"
			uiResultText = callErr.Error()
			rawResultText = callErr.Error()
		}
		stopAfterThisTool = true
	} else {
		uiResultText = formatToolResultContent(callResult)
		rawResultText = formatAIRawToolResultContent(callResult)
	}
	uiResultText = sanitizeAIToolResultText(uiResultText)

	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "upsert_message",
		"requestId": execution.RequestID,
		"message": map[string]interface{}{
			"id":                 execution.ToolMessageID,
			"turnId":             execution.AssistantMessageID,
			"kind":               "tool",
			"actionLabel":        execution.Tool.Name,
			"title":              titleForParsedToolUse(execution.Tool),
			"summary":            summarizeParsedToolUse(execution.Tool),
			"code":               execution.Tool.RawXML,
			"status":             statusText,
			"result":             uiResultText,
			"remainingFileEdits": getAIToolRemainingFileEdits(execution.Tool),
		},
	})

	if execution.isTerminated() {
		if strings.TrimSpace(uiResultText) == "" {
			uiResultText = "工具已终止"
		}
		if strings.TrimSpace(rawResultText) == "" {
			rawResultText = "工具已终止"
		}
		stopAfterThisTool = true
	}

	a.emitAIChatToolResultMessage(execution.RequestID, execution, rawResultText)
	a.emitAIChatToolExecutionPersistRequested(execution.RequestID)

	if stopAfterThisTool {
		execution.Batch.NextToolIndex = len(execution.Batch.ParsedTools)
		a.resumeAIChatAfterToolBatch(execution.RequestID, execution.Batch)
		return
	}

	execution.Batch.NextToolIndex++
	a.advanceAIChatToolBatch(execution.RequestID, execution.Batch)
}

func (a *App) runAIChatLiveSearchToolExecution(execution *aiToolExecutionState) {
	if a == nil || execution == nil || execution.Batch == nil {
		return
	}

	query := strings.TrimSpace(execution.Tool.Params["query"])
	statusText := "已执行"
	uiResultText := ""
	rawResultText := ""
	stopAfterThisTool := false

	if query == "" {
		statusText = "错误"
		uiResultText = "缺少联网搜索 query"
		rawResultText = uiResultText
		stopAfterThisTool = true
	} else {
		resultText, err := a.searchAIProviderWeb(execution.ExecutionCtx, execution.Batch.Profile, query, func(content string) {
			if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
				return
			}
			safeContent := sanitizeAIToolResultText(content)
			if strings.TrimSpace(safeContent) == "" {
				return
			}
			execution.setSnapshotOutput(safeContent)
			a.emitAIChatEvent(map[string]interface{}{
				"kind":      "upsert_message",
				"requestId": execution.RequestID,
				"message": map[string]interface{}{
					"id":                 execution.ToolMessageID,
					"turnId":             execution.AssistantMessageID,
					"kind":               "tool",
					"actionLabel":        execution.Tool.Name,
					"title":              titleForParsedToolUse(execution.Tool),
					"summary":            summarizeParsedToolUse(execution.Tool),
					"code":               execution.Tool.RawXML,
					"status":             "执行中",
					"result":             safeContent,
					"remainingFileEdits": getAIToolRemainingFileEdits(execution.Tool),
				},
			})
		})
		if err != nil {
			if execution.isTerminated() || errors.Is(err, context.Canceled) {
				statusText = "已终止"
				uiResultText = execution.snapshotOutput()
				if strings.TrimSpace(uiResultText) == "" {
					uiResultText = "联网搜索已终止"
				}
				rawResultText = uiResultText
			} else {
				statusText = "错误"
				uiResultText = err.Error()
				rawResultText = err.Error()
			}
			stopAfterThisTool = true
		} else {
			uiResultText = sanitizeAIToolResultText(resultText)
			rawResultText = resultText
			if strings.TrimSpace(uiResultText) == "" {
				uiResultText = "未返回内容"
				rawResultText = uiResultText
			}
		}
	}

	if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
		return
	}

	a.popAIChatToolExecutionIfMatches(execution.RequestID, execution.ExecutionID)
	if execution.Cancel != nil {
		execution.Cancel()
	}

	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "upsert_message",
		"requestId": execution.RequestID,
		"message": map[string]interface{}{
			"id":                 execution.ToolMessageID,
			"turnId":             execution.AssistantMessageID,
			"kind":               "tool",
			"actionLabel":        execution.Tool.Name,
			"title":              titleForParsedToolUse(execution.Tool),
			"summary":            summarizeParsedToolUse(execution.Tool),
			"code":               execution.Tool.RawXML,
			"status":             statusText,
			"result":             uiResultText,
			"remainingFileEdits": getAIToolRemainingFileEdits(execution.Tool),
		},
	})

	a.emitAIChatToolResultMessage(execution.RequestID, execution, rawResultText)
	a.emitAIChatToolExecutionPersistRequested(execution.RequestID)

	if stopAfterThisTool {
		execution.Batch.NextToolIndex = len(execution.Batch.ParsedTools)
		a.resumeAIChatAfterToolBatch(execution.RequestID, execution.Batch)
		return
	}

	execution.Batch.NextToolIndex++
	a.advanceAIChatToolBatch(execution.RequestID, execution.Batch)
}

func (a *App) runAIChatCommandToolExecution(execution *aiToolExecutionState) {
	if a == nil || execution == nil || execution.Batch == nil || a.sshManager == nil {
		return
	}

	arguments := convertToolArguments(execution.Tool, execution.Batch.Payload.SessionID)
	command, _ := arguments["command"].(string)
	purpose, _ := arguments["purpose"].(string)
	cwd, _ := arguments["cwd"].(string)
	shellType, _ := arguments["shellType"].(string)
	isMutating := false
	switch value := arguments["is_mutating"].(type) {
	case int:
		isMutating = value == 1
	case float64:
		isMutating = int(value) == 1
	}

	result, outcome, execErr := a.sshManager.ExecuteCommandInTerminalControlled(
		execution.targetSessionID(),
		command,
		purpose,
		isMutating,
		cwd,
		shellType,
		5*time.Minute,
		execution.DecisionCh,
		execution.ReassignCh,
		func() {
			execution.setAllowTerminalAssignment(true)
			if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
				return
			}
			a.emitAIChatToolExecutionTerminalAssignmentRequired(
				execution.RequestID,
				execution,
				buildAIChatCommandToolMessage(
					execution,
					purpose,
					command,
					"",
					"排队中, 等待终端空闲",
					buildAIChatCommandMessageExtra(execution.targetSessionID(), ""),
				),
			)
		},
		func() {
			execution.setAllowTerminalAssignment(false)
			if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
				return
			}
			a.emitAIChatToolExecutionStarted(
				execution.RequestID,
				execution,
				buildAIChatCommandToolMessage(
					execution,
					purpose,
					command,
					"",
					"执行中",
					buildAIChatCommandMessageExtra(execution.targetSessionID(), ""),
				),
			)
		},
		func(snapshot string) {
			execution.setAllowTerminalAssignment(false)
			if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
				return
			}
			safeSnapshot := sanitizeAIToolResultText(snapshot)
			execution.setSnapshotOutput(safeSnapshot)
			execution.AllowContinue = true
			a.emitAIChatToolExecutionActionRequired(
				execution.RequestID,
				execution,
				buildAIChatCommandToolMessage(
					execution,
					purpose,
					command,
					safeSnapshot,
					"等待处理",
					buildAIChatCommandMessageExtra(execution.targetSessionID(), ""),
				),
			)
		},
	)

	if !a.isAIChatToolExecutionCurrent(execution.RequestID, execution.ExecutionID) {
		return
	}

	a.popAIChatToolExecutionIfMatches(execution.RequestID, execution.ExecutionID)
	if execution.Cancel != nil {
		execution.Cancel()
	}

	statusText := "已执行"
	rawResultText := result.Output
	uiResultText := sanitizeAIToolResultText(strings.TrimSpace(result.Output))
	stopAfterThisTool := false

	if execErr != nil {
		statusText = "错误"
		rawResultText = execErr.Error()
		uiResultText = execErr.Error()
		stopAfterThisTool = true
	} else if outcome == aiToolExecutionActionContinue {
		statusText = "后台继续"
		stopAfterThisTool = true
	} else if outcome == aiToolExecutionActionTerminate || execution.isTerminated() {
		statusText = "已终止"
		if uiResultText == "" {
			uiResultText = "Command aborted."
		}
		if strings.TrimSpace(rawResultText) == "" {
			rawResultText = "Command aborted."
		}
		stopAfterThisTool = true
	} else if result.ExitCode != nil && *result.ExitCode != 0 {
		statusText = "错误"
		stopAfterThisTool = true
	}

	a.emitAIChatCommandToolMessage(
		execution.RequestID,
		execution,
		purpose,
		command,
		uiResultText,
		statusText,
		buildAIChatCommandMessageExtra(execution.targetSessionID(), ""),
	)

	if strings.TrimSpace(uiResultText) == "" {
		switch statusText {
		case "后台继续":
			uiResultText = "Command continues to run in the background."
		case "已终止":
			uiResultText = "Command aborted."
		default:
			uiResultText = "Command finished without output."
		}
	}
	if strings.TrimSpace(rawResultText) == "" {
		rawResultText = uiResultText
	}

	a.emitAIChatToolResultMessage(execution.RequestID, execution, rawResultText)
	a.emitAIChatToolExecutionPersistRequested(execution.RequestID)

	if stopAfterThisTool {
		execution.Batch.NextToolIndex = len(execution.Batch.ParsedTools)
		a.resumeAIChatAfterToolBatch(execution.RequestID, execution.Batch)
		return
	}

	execution.Batch.NextToolIndex++
	a.advanceAIChatToolBatch(execution.RequestID, execution.Batch)
}

func (a *App) ResolveAIChatFollowup(requestID string, answer string, imagesJSON string) error {
	trimmedRequestID := strings.TrimSpace(requestID)
	answerText := strings.TrimSpace(answer)
	followupImages := decodeAIFollowupImages(imagesJSON)
	if trimmedRequestID == "" {
		return fmt.Errorf("request id is required")
	}
	if answerText == "" && len(followupImages) == 0 {
		return fmt.Errorf("followup answer is required")
	}
	batch := a.popAIChatPendingFollowupBatch(trimmedRequestID)
	if batch == nil {
		return fmt.Errorf("没有待回复的追问")
	}
	if batch.NextToolIndex >= len(batch.ParsedTools) {
		return fmt.Errorf("追问批次状态无效")
	}
	tool := batch.ParsedTools[batch.NextToolIndex]
	if tool.Name != "ask_followup_question" {
		return fmt.Errorf("当前待处理工具不是 ask_followup_question")
	}
	now := time.Now()
	userMessageID := fmt.Sprintf("%s-followup-answer-%d", buildToolMessageID(batch.AssistantMessageID, batch.NextToolIndex), now.UnixNano())
	followupContent := fmt.Sprintf("<user_message>\n%s\n</user_message>", answerText)
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "append_message",
		"requestId": trimmedRequestID,
		"message": map[string]interface{}{
			"id":     userMessageID,
			"kind":   "user",
			"text":   answerText,
			"time":   now.Format("15:04"),
			"turnId": "",
			"images": followupImages,
		},
	})
	batch.RequestMessages = append(batch.RequestMessages, AIChatRequestMessage{
		Role:    "user",
		Content: followupContent,
		Images:  followupImages,
	})
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "api_message_append",
		"requestId": trimmedRequestID,
		"message": map[string]interface{}{
			"messageId":    fmt.Sprintf("api-user-followup-%d", now.UnixNano()),
			"role":         "user",
			"content":      followupContent,
			"uiMessageIds": []string{userMessageID},
			"images":       followupImages,
			"ts":           now.UnixMilli(),
		},
	})
	a.emitAIChatToolExecutionPersistRequested(trimmedRequestID)
	batch.NextToolIndex++
	a.advanceAIChatToolBatch(trimmedRequestID, batch)
	return nil
}

func (a *App) ContinueAIChatTool(requestID string) error {
	execution := a.getAIChatToolExecution(requestID)
	if execution == nil {
		return fmt.Errorf("没有可继续的工具实例")
	}
	if !execution.AllowContinue {
		return fmt.Errorf("当前工具不支持强制继续")
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "tool_execution_action_resolved",
		"requestId": execution.RequestID,
		"action":    "continue",
	})
	select {
	case execution.DecisionCh <- aiToolExecutionActionContinue:
		return nil
	default:
		return fmt.Errorf("当前工具未处于等待继续状态")
	}
}

func (a *App) terminateAIChatToolExecutionImmediately(execution *aiToolExecutionState, fallbackResult string) error {
	if a == nil || execution == nil || execution.Batch == nil {
		return fmt.Errorf("没有可终止的工具实例")
	}
	if !execution.markTerminated() {
		return nil
	}
	if execution.Cancel != nil {
		execution.Cancel()
	}
	if a.popAIChatToolExecutionIfMatches(execution.RequestID, execution.ExecutionID) == nil {
		return nil
	}

	resultText := sanitizeAIToolResultText(strings.TrimSpace(execution.snapshotOutput()))
	if resultText == "" {
		resultText = sanitizeAIToolResultText(strings.TrimSpace(fallbackResult))
	}
	if resultText == "" {
		resultText = "工具已终止"
	}

	message := buildToolPreviewMessage(execution.AssistantMessageID, execution.Tool, execution.ToolIndex)
	message["status"] = "已终止"
	if execution.Tool.Name == "execute_command" {
		message["output"] = resultText
	} else {
		message["result"] = resultText
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "upsert_message",
		"requestId": execution.RequestID,
		"message":   message,
	})

	a.emitAIChatToolResultMessage(execution.RequestID, execution, resultText)
	a.emitAIChatToolExecutionPersistRequested(execution.RequestID)
	execution.Batch.NextToolIndex = len(execution.Batch.ParsedTools)
	a.resumeAIChatAfterToolBatch(execution.RequestID, execution.Batch)
	return nil
}

func (a *App) TerminateAIChatTool(requestID string) error {
	execution := a.getAIChatToolExecution(requestID)
	if execution == nil {
		return fmt.Errorf("没有可终止的工具实例")
	}
	if !execution.AllowTerminate {
		return fmt.Errorf("当前工具不支持终止")
	}
	a.emitAIChatEvent(map[string]interface{}{
		"kind":      "tool_execution_action_resolved",
		"requestId": execution.RequestID,
		"action":    "terminate",
	})
	if execution.Tool.Name == "execute_command" {
		execution.markTerminated()
		select {
		case execution.DecisionCh <- aiToolExecutionActionTerminate:
			return nil
		default:
			return a.terminateAIChatToolExecutionImmediately(execution, "Command aborted.")
		}
	}
	return a.terminateAIChatToolExecutionImmediately(execution, "工具已终止")
}
