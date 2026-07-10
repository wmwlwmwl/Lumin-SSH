package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

type stdioTransport struct {
	config      ServerConfig
	appendLog   func(string)
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	stdout      io.ReadCloser
	stderr      io.ReadCloser
	started     atomic.Bool
	closed      atomic.Bool
	closeOnce   sync.Once
	nextID      atomic.Int64
	pendingMu   sync.Mutex
	pending     map[string]chan rpcResponse
	processDone chan struct{}
}

func newStdioTransport(config ServerConfig, appendLog func(string)) *stdioTransport {
	return &stdioTransport{
		config:      config,
		appendLog:   appendLog,
		pending:     map[string]chan rpcResponse{},
		processDone: make(chan struct{}),
	}
}

func (t *stdioTransport) Start(ctx context.Context) error {
	if t.started.Load() {
		return nil
	}
	command := strings.TrimSpace(t.config.Command)
	if command == "" {
		return fmt.Errorf("stdio server config requires command")
	}
	cmd := exec.Command(command, t.config.Args...)
	if trimmedCwd := strings.TrimSpace(t.config.Cwd); trimmedCwd != "" {
		cmd.Dir = trimmedCwd
	}
	env := os.Environ()
	for key, value := range t.config.Env {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		env = append(env, trimmedKey+"="+value)
	}
	cmd.Env = env
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	t.cmd = cmd
	t.stdin = stdin
	t.stdout = stdout
	t.stderr = stderr
	t.started.Store(true)
	go t.readLoop()
	go t.readStderrLoop()
	go t.waitLoop()
	return nil
}

func (t *stdioTransport) Close() error {
	var closeErr error
	t.closeOnce.Do(func() {
		t.closed.Store(true)
		if t.stdin != nil {
			_ = t.stdin.Close()
		}
		if t.stdout != nil {
			_ = t.stdout.Close()
		}
		if t.stderr != nil {
			_ = t.stderr.Close()
		}
		if t.cmd != nil && t.cmd.Process != nil {
			_ = t.cmd.Process.Kill()
		}
		closeErr = nil
	})
	return closeErr
}

func (t *stdioTransport) Request(ctx context.Context, method string, params map[string]any, result any) error {
	if !t.started.Load() {
		if err := t.Start(ctx); err != nil {
			return err
		}
	}
	if t.closed.Load() {
		return fmt.Errorf("stdio transport closed")
	}
	id := strconv.FormatInt(t.nextID.Add(1), 10)
	waitCh := make(chan rpcResponse, 1)
	t.pendingMu.Lock()
	t.pending[id] = waitCh
	t.pendingMu.Unlock()
	defer func() {
		t.pendingMu.Lock()
		delete(t.pending, id)
		t.pendingMu.Unlock()
	}()
	payload := rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
	}
	if strings.HasPrefix(method, "notifications/") {
		payload.ID = nil
	}
	if params != nil {
		payload.Params = params
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	frame := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(data))
	if _, err := io.WriteString(t.stdin, frame); err != nil {
		return err
	}
	if _, err := t.stdin.Write(data); err != nil {
		return err
	}
	if strings.HasPrefix(method, "notifications/") {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.processDone:
		return fmt.Errorf("stdio transport closed")
	case response := <-waitCh:
		if response.Error != nil {
			return fmt.Errorf("%s", response.Error.Message)
		}
		if result != nil && len(response.Result) > 0 {
			if err := json.Unmarshal(response.Result, result); err != nil {
				return err
			}
		}
		return nil
	}
}

func (t *stdioTransport) waitLoop() {
	defer close(t.processDone)
	if t.cmd == nil {
		return
	}
	err := t.cmd.Wait()
	if err != nil && !t.closed.Load() {
		t.log("stdio process exited: " + err.Error())
	}
	if t.closed.Load() {
		t.closePending(fmt.Errorf("stdio transport closed"))
		return
	}
	if err != nil {
		t.closePending(err)
		return
	}
	t.closePending(fmt.Errorf("stdio process exited"))
}

func (t *stdioTransport) readLoop() {
	reader := bufio.NewReader(t.stdout)
	for {
		body, err := readContentLengthFrame(reader)
		if err != nil {
			if t.closed.Load() {
				t.closePending(fmt.Errorf("stdio transport closed"))
				return
			}
			if err != io.EOF {
				t.log("stdio read failed: " + err.Error())
			}
			t.closePending(err)
			return
		}
		response := rpcResponse{}
		if err := json.Unmarshal(body, &response); err != nil {
			t.log("stdio json decode failed: " + err.Error())
			continue
		}
		responseID := parseResponseID(response.ID)
		if responseID == "" {
			continue
		}
		t.pendingMu.Lock()
		waitCh := t.pending[responseID]
		t.pendingMu.Unlock()
		if waitCh == nil {
			continue
		}
		select {
		case waitCh <- response:
		default:
		}
	}
}

func (t *stdioTransport) readStderrLoop() {
	scanner := bufio.NewScanner(t.stderr)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		t.log(line)
	}
}

func (t *stdioTransport) closePending(err error) {
	t.pendingMu.Lock()
	defer t.pendingMu.Unlock()
	for id, waitCh := range t.pending {
		select {
		case waitCh <- rpcResponse{Error: &rpcError{Message: err.Error()}}:
		default:
		}
		delete(t.pending, id)
	}
}

func (t *stdioTransport) log(message string) {
	if t.appendLog != nil && strings.TrimSpace(message) != "" {
		t.appendLog(message)
	}
}

func readContentLengthFrame(reader *bufio.Reader) ([]byte, error) {
	contentLength := 0
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(trimmed), "content-length:") {
			value := strings.TrimSpace(trimmed[len("content-length:"):])
			parsedLength, err := strconv.Atoi(value)
			if err != nil {
				return nil, err
			}
			contentLength = parsedLength
		}
	}
	if contentLength <= 0 {
		return nil, fmt.Errorf("missing content-length")
	}
	body := make([]byte, contentLength)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	return body, nil
}

func parseResponseID(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return ""
	}
	if trimmed[0] == '"' {
		value := ""
		if err := json.Unmarshal(trimmed, &value); err == nil {
			return strings.TrimSpace(value)
		}
	}
	return strings.TrimSpace(string(trimmed))
}