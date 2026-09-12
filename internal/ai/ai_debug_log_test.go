package ai

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// useTempAIDebugLog 把包级日志器指向临时目录,并缩小轮转限额,结束后恢复。
func useTempAIDebugLog(t *testing.T, maxSize int64, maxBackups int) string {
	t.Helper()
	dir := t.TempDir()
	previousLogger := currentAIDebugLogger()
	previousMaxSize := aiDebugLogMaxSize
	previousMaxBackups := aiDebugLogMaxBackups

	aiDebugLogMaxSize = maxSize
	aiDebugLogMaxBackups = maxBackups
	logger := newAIDebugLogger(dir)
	if logger == nil {
		t.Fatalf("无法在临时目录创建日志器")
	}
	aiDebugLogState.mu.Lock()
	aiDebugLogState.logger = logger
	aiDebugLogState.mu.Unlock()

	t.Cleanup(func() {
		_ = logger.Close()
		aiDebugLogMaxSize = previousMaxSize
		aiDebugLogMaxBackups = previousMaxBackups
		aiDebugLogState.mu.Lock()
		aiDebugLogState.logger = previousLogger
		aiDebugLogState.mu.Unlock()
	})
	return filepath.Join(dir, aiDebugLogFileName)
}

func readAIDebugLogFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取日志失败: %v", err)
	}
	return string(data)
}

func TestAIDebugLogWritesRoundHeaderBodyAndStream(t *testing.T) {
	logPath := useTempAIDebugLog(t, 10<<20, 3)

	meta := aiDebugRoundMeta{
		RequestID:         "req-1",
		ConversationID:    "conv-1",
		Protocol:          "Compatible",
		Model:             "test-model",
		Endpoint:          "https://example.invalid/v1/chat/completions",
		MessageCount:      3,
		SystemPromptChars: 42,
		APIKey:            "sk-secretsecretsecret",
	}
	request, err := http.NewRequest(http.MethodPost, meta.Endpoint, strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("构造请求失败: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Authorization", "Bearer sk-secretsecretsecret")
	request.Header.Set("X-Custom-Secret", "do-not-log-this-value")

	body := []byte(`{"model":"test-model","messages":[{"role":"user","content":"你好"}]}`)

	// 直接调用写入路径(避免真实网络):模拟 helper 的三段写入。
	logger := currentAIDebugLogger()
	header := logger.prepareRoundHeader(meta, aiDebugRequestSummary(request, meta, body), body)
	logger.Write([]byte(header))
	logger.Write([]byte("-------------- response stream (raw, HTTP 200) --------------\n"))
	logger.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n"))
	logger.Write([]byte("-------------- stream end: HTTP 200, 0.1s --------------\n\n"))
	logger.Flush()
	aiDebugLogRoundResult("conv-1", "req-1", 0, 1, AIProviderProfile{Provider: "Compatible", Model: "test-model"},
		time.Second, aiChatRoundResult{Text: "<execute_command>\n<command>ls</command>\n</execute_command>", InputTokens: 11, OutputTokens: 22}, nil)

	content := readAIDebugLogFile(t, logPath)
	for _, want := range []string{
		"round start",
		"request  id=req-1 conv=conv-1",
		"protocol=Compatible model=test-model",
		"request-body sha256=",
		`"content":"你好"`,
		"response stream",
		"data: {\"choices\"",
		"stream end: HTTP 200",
		"result   conv=conv-1",
		"tools=[execute_command]",
		"===== round end =====",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("日志缺少 %q\n----\n%s", want, content)
		}
	}
	// 敏感信息绝不落盘(注:日志里出现 "Authorization 不记录" 这句说明文字是预期行为)。
	for _, forbidden := range []string{"sk-secretsecretsecret", "do-not-log-this-value", "Bearer "} {
		if strings.Contains(content, forbidden) {
			t.Errorf("日志泄漏了敏感内容 %q", forbidden)
		}
	}
	// 自定义头只记名字,不记值。
	if !strings.Contains(content, "X-Custom-Secret") {
		t.Errorf("自定义头名字应被记录以便排查")
	}
}

func TestAIDebugLogSkipsIdenticalRequestBody(t *testing.T) {
	logPath := useTempAIDebugLog(t, 10<<20, 3)
	meta := aiDebugRoundMeta{ConversationID: "conv-dedup", Model: "m"}
	body := []byte(`{"messages":[{"role":"user","content":"same"}]}`)

	for i := 0; i < 2; i++ {
		logger := currentAIDebugLogger()
		logger.Write([]byte(logger.prepareRoundHeader(meta, aiDebugRequestSummary(nil, meta, body), body)))
		logger.Flush()
	}

	content := readAIDebugLogFile(t, logPath)
	if strings.Count(content, "与上一轮相同,已省略") != 1 {
		t.Errorf("第二次相同请求体应被省略一次,实际日志:\n%s", content)
	}
	if strings.Count(content, `"content":"same"`) != 1 {
		t.Errorf("相同请求体只应写一次正文,实际日志:\n%s", content)
	}

	// 换一个会话时不应被误判为重复。
	otherMeta := aiDebugRoundMeta{ConversationID: "conv-other", Model: "m"}
	logger := currentAIDebugLogger()
	logger.Write([]byte(logger.prepareRoundHeader(otherMeta, aiDebugRequestSummary(nil, otherMeta, body), body)))
	logger.Flush()
	if got := strings.Count(readAIDebugLogFile(t, logPath), `"content":"same"`); got != 2 {
		t.Errorf("不同会话应各自记录请求体,实际正文出现 %d 次", got)
	}
}

func TestAIDebugLogRotatesAndKeepsBackups(t *testing.T) {
	logPath := useTempAIDebugLog(t, 1<<10, 3) // 1 KiB 上限,便于触发轮转

	payload := strings.Repeat("x", 400)
	for i := 0; i < 12; i++ {
		logger := currentAIDebugLogger()
		logger.Write([]byte(payload))
		logger.Write([]byte("\n"))
	}
	logger := currentAIDebugLogger()
	logger.Flush()

	if _, err := os.Stat(logPath); err != nil {
		t.Fatalf("当前日志文件应存在: %v", err)
	}
	for index := 1; index <= aiDebugLogMaxBackups; index++ {
		backup := logPath + "." + strconv.Itoa(index)
		if _, err := os.Stat(backup); err != nil {
			t.Errorf("应保留轮转备份 %s: %v", backup, err)
		}
	}
	// 超出保留份数的旧备份不应存在。
	if _, err := os.Stat(logPath + "." + strconv.Itoa(aiDebugLogMaxBackups+1)); err == nil {
		t.Errorf("不应保留第 %d 份备份", aiDebugLogMaxBackups+1)
	}
}

func TestAIDebugLogDisabledSkipsWrites(t *testing.T) {
	logPath := useTempAIDebugLog(t, 10<<20, 3)
	logger := currentAIDebugLogger()

	logger.Write([]byte("before-disable\n"))
	logger.Flush()

	setAIDebugLogEnabled(false)
	if logger.isEnabled() {
		t.Fatalf("关闭后 isEnabled() 应为 false")
	}
	logger.Write([]byte("after-disable\n"))
	aiDebugLogMessage("also-dropped\n")
	aiDebugLogRoundResult("conv", "req", 0, 1, AIProviderProfile{}, time.Millisecond, aiChatRoundResult{Text: "hi"}, nil)
	logger.Flush()

	content := readAIDebugLogFile(t, logPath)
	if !strings.Contains(content, "before-disable") {
		t.Errorf("关闭前的写入应保留:\n%s", content)
	}
	for _, unwanted := range []string{"after-disable", "also-dropped", "result   conv"} {
		if strings.Contains(content, unwanted) {
			t.Errorf("关闭后不应写入 %q:\n%s", unwanted, content)
		}
	}

	setAIDebugLogEnabled(true)
	logger.Write([]byte("re-enabled\n"))
	logger.Flush()
	if !strings.Contains(readAIDebugLogFile(t, logPath), "re-enabled") {
		t.Errorf("重新开启后应恢复写入")
	}
}

func TestAIDebugLogNoopWhenUninitialized(t *testing.T) {
	aiDebugLogState.mu.Lock()
	previous := aiDebugLogState.logger
	aiDebugLogState.logger = nil
	aiDebugLogState.mu.Unlock()
	t.Cleanup(func() {
		aiDebugLogState.mu.Lock()
		aiDebugLogState.logger = previous
		aiDebugLogState.mu.Unlock()
	})

	// 未初始化时以下调用都必须安全(聊天流程不能因日志而失败)。
	aiDebugLogMessage("should be dropped %d\n", 1)
	aiDebugLogRoundResult("conv", "req", 0, 1, AIProviderProfile{}, time.Millisecond, aiChatRoundResult{}, nil)
	if logger := currentAIDebugLogger(); logger != nil {
		t.Fatalf("期望未初始化状态")
	}
	var nilLogger *aiDebugLogger
	nilLogger.Write([]byte("ignored"))
	nilLogger.Flush()
	if err := nilLogger.Close(); err != nil {
		t.Errorf("nil 日志器 Close 应返回 nil,得到 %v", err)
	}
}
