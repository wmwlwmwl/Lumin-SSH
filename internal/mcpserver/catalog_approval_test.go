package mcpserver

import (
	"context"
	"sync"
	"testing"
)

// mockReporter 记录所有事件,并可控地返回审批结果。
// 注意:真实 reporter(RequestApproval 实现)内部会发 approval_required 事件,
// mock 不发,只记录 ReportActivity 调用和 RequestApproval 调用。
type mockReporter struct {
	mu             sync.Mutex
	events         []ActivityEvent
	approve        bool
	approvalCalled bool
	approvalEvent  ActivityEvent
}

func newMockReporter(approve bool) *mockReporter {
	return &mockReporter{approve: approve}
}

func (m *mockReporter) ReportActivity(event ActivityEvent) {
	m.mu.Lock()
	m.events = append(m.events, event)
	m.mu.Unlock()
}

func (m *mockReporter) RequestApproval(event ActivityEvent) (bool, error) {
	m.mu.Lock()
	m.approvalCalled = true
	m.approvalEvent = event
	m.mu.Unlock()
	return m.approve, nil
}

func (m *mockReporter) getEvents() []ActivityEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]ActivityEvent, len(m.events))
	copy(cp, m.events)
	return cp
}

func TestIsMutatingTool(t *testing.T) {
	mutating := []string{"write_to_file", "search_replace", "apply_diff", "edit_file", "apply_patch", "transfer_batch"}
	for _, name := range mutating {
		if !isMutatingTool(name) {
			t.Errorf("isMutatingTool(%q) = false, want true", name)
		}
	}
	nonMutating := []string{"list_connected_sessions", "get_work_path", "list_files", "read_file", "transfer_list", "attempt_completion", "execute_command", "unknown_tool"}
	for _, name := range nonMutating {
		if isMutatingTool(name) {
			t.Errorf("isMutatingTool(%q) = true, want false", name)
		}
	}
}

func TestExtractToolTarget(t *testing.T) {
	got := extractToolTarget("write_to_file", map[string]any{"path": "/etc/hosts"})
	if got != "/etc/hosts" {
		t.Errorf("extractToolTarget write_to_file = %q, want /etc/hosts", got)
	}
	got = extractToolTarget("transfer_batch", map[string]any{"operation": "upload", "remote_parent": "/tmp"})
	if got != "upload → /tmp" {
		t.Errorf("extractToolTarget transfer_batch = %q, want 'upload → /tmp'", got)
	}
	got = extractToolTarget("write_to_file", nil)
	if got != "" {
		t.Errorf("extractToolTarget nil args = %q, want empty", got)
	}
}

func TestApprovalGateApproved(t *testing.T) {
	reporter := newMockReporter(true)
	catalog := &Catalog{
		reporter: reporter,
		callCtx:  context.Background(),
	}
	// write_to_file 会触发审批(通过),然后 dispatchTool 因 service nil 返回 error
	_, _ = catalog.CallWithContext(context.Background(), "write_to_file", map[string]any{
		"session_id": "fake-session",
		"path":       "/tmp/test",
	})
	if !reporter.approvalCalled {
		t.Error("RequestApproval was not called for mutating tool")
	}
	if reporter.approvalEvent.Status != ActivityStatusApprovalRequired {
		t.Errorf("approval event status = %q, want approval_required", reporter.approvalEvent.Status)
	}
	if reporter.approvalEvent.IsMutating != true {
		t.Error("approval event IsMutating should be true")
	}
	if reporter.approvalEvent.Command != "/tmp/test" {
		t.Errorf("approval event Command = %q, want /tmp/test", reporter.approvalEvent.Command)
	}
	// 应该有 started 和 approved 事件
	events := reporter.getEvents()
	hasStarted, hasApproved := false, false
	for _, e := range events {
		switch e.Status {
		case ActivityStatusStarted:
			hasStarted = true
		case ActivityStatusApproved:
			hasApproved = true
		}
	}
	if !hasStarted {
		t.Error("missing started event")
	}
	if !hasApproved {
		t.Error("missing approved event")
	}
}

func TestApprovalGateRejected(t *testing.T) {
	reporter := newMockReporter(false)
	catalog := &Catalog{
		reporter: reporter,
		callCtx:  context.Background(),
	}
	_, err := catalog.CallWithContext(context.Background(), "write_to_file", map[string]any{
		"session_id": "fake-session",
		"path":       "/tmp/test",
	})
	if err == nil {
		t.Fatal("expected error on rejected approval, got nil")
	}
	expected := "write_to_file rejected by user"
	if err.Error() != expected {
		t.Errorf("error = %q, want %q", err.Error(), expected)
	}
	if !reporter.approvalCalled {
		t.Error("RequestApproval was not called for mutating tool")
	}
	events := reporter.getEvents()
	hasRejected := false
	for _, e := range events {
		if e.Status == ActivityStatusRejected {
			hasRejected = true
		}
	}
	if !hasRejected {
		t.Error("missing rejected event")
	}
}

func TestApprovalGateSkippedForReadonly(t *testing.T) {
	reporter := newMockReporter(false)
	catalog := &Catalog{
		reporter: reporter,
		callCtx:  context.Background(),
	}
	_, _ = catalog.CallWithContext(context.Background(), "list_connected_sessions", map[string]any{
		"session_id": "fake-session",
	})
	if reporter.approvalCalled {
		t.Error("RequestApproval should not be called for read-only tools")
	}
}

func TestNoopReporterAutoApproves(t *testing.T) {
	r := NoopReporter()
	approved, err := r.RequestApproval(ActivityEvent{})
	if err != nil || !approved {
		t.Error("NoopReporter should auto-approve with nil error")
	}
	r.ReportActivity(ActivityEvent{})
}

func TestExtractSessionID(t *testing.T) {
	if got := extractSessionID(map[string]any{"session_id": "abc"}); got != "abc" {
		t.Errorf("extractSessionID = %q, want abc", got)
	}
	if got := extractSessionID(nil); got != "" {
		t.Errorf("extractSessionID(nil) = %q, want empty", got)
	}
}

func TestParseClientName(t *testing.T) {
	cases := []struct {
		ua   string
		want string
	}{
		{"claude-cli/0.1", "claude-code"},
		{"codex/1.0", "codex"},
		{"", "unknown"},
		{"  ", "unknown"},
		{"Mozilla/5.0", "mozilla/5.0"},
	}
	for _, c := range cases {
		got := ParseClientName(c.ua)
		if got != c.want {
			t.Errorf("ParseClientName(%q) = %q, want %q", c.ua, got, c.want)
		}
	}
}
