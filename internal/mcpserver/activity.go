package mcpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

type ActivityStatus string

const (
	ActivityStatusStarted          ActivityStatus = "started"
	ActivityStatusQueued           ActivityStatus = "queued"
	ActivityStatusRunning          ActivityStatus = "running"
	ActivityStatusOutput           ActivityStatus = "output"
	ActivityStatusDone             ActivityStatus = "done"
	ActivityStatusError            ActivityStatus = "error"
	ActivityStatusApprovalRequired ActivityStatus = "approval_required"
	ActivityStatusApproved         ActivityStatus = "approved"
	ActivityStatusRejected         ActivityStatus = "rejected"
	ActivityStatusTimedOut         ActivityStatus = "timed_out"
)

const ActivitySourceExternalMCP = "external-mcp"

type ActivityEvent struct {
	RequestID  string         `json:"requestId"`
	Source     string         `json:"source"`
	ClientName string         `json:"clientName"`
	Tool       string         `json:"tool"`
	SessionID  string         `json:"sessionId"`
	ServerName string         `json:"serverName"`
	Command    string         `json:"command,omitempty"`
	Purpose    string         `json:"purpose,omitempty"`
	IsMutating bool           `json:"isMutating"`
	CWD        string         `json:"cwd,omitempty"`
	Status     ActivityStatus `json:"status"`
	Output     string         `json:"output,omitempty"`
	ExitCode   *int           `json:"exitCode,omitempty"`
	Timestamp  int64          `json:"timestamp"`
}

// ActivityReporter is the bridge between the external MCP tool path and the
// application UI. The Go business packages (mcp / mcpserver / mcpbridge) never
// import Wails; instead the application injects a concrete reporter that emits
// Wails events. A nil reporter is always valid and degrades to the legacy
// "fire-and-forget, no visibility" behavior.
type ActivityReporter interface {
	// ReportActivity is fire-and-forget. It must never block or panic.
	ReportActivity(event ActivityEvent)
	// RequestApproval blocks until the user resolves the approval prompt (or a
	// timeout fires). Returns (true, nil) when approved. When approval is not
	// required by settings the implementation returns (true, nil) immediately.
	RequestApproval(event ActivityEvent) (bool, error)
}

// noopReporter is the zero-value fallback. It auto-approves everything and
// emits nothing, preserving the original external-MCP behavior.
type noopReporter struct{}

func (noopReporter) ReportActivity(ActivityEvent)        {}
func (noopReporter) RequestApproval(ActivityEvent) (bool, error) { return true, nil }

// NoopReporter returns a reporter that does nothing and auto-approves.
func NoopReporter() ActivityReporter { return noopReporter{} }

// ActivityReporterCarrier is an optional capability interface. Hosts that can
// supply a reporter implement this; mcp.StartServer type-asserts to inject it.
type ActivityReporterCarrier interface {
	MCPActivityReporter() ActivityReporter
}

// NewRequestID generates a short unique identifier for correlating the lifecycle
// events of a single tool invocation.
func NewRequestID() string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("req-%d", time.Now().UnixNano())
	}
	return "req-" + hex.EncodeToString(buffer) + "-" + time.Now().Format("150405")
}

// ── context plumbing for per-call activity metadata ──

type activityContextKey struct{}

type activityContextValue struct {
	reporter   ActivityReporter
	clientName string
}

// ContextWithActivity attaches the reporter and client name to a context so
// downstream callers (catalog, command provider) can emit events.
func ContextWithActivity(ctx context.Context, reporter ActivityReporter, clientName string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, activityContextKey{}, activityContextValue{
		reporter:   reporter,
		clientName: clientName,
	})
}

// ActivityFromContext extracts the reporter and client name injected by
// ContextWithActivity. Returns NoopReporter + empty string when absent.
func ActivityFromContext(ctx context.Context) (ActivityReporter, string) {
	if ctx == nil {
		return NoopReporter(), ""
	}
	value, ok := ctx.Value(activityContextKey{}).(activityContextValue)
	if !ok || value.reporter == nil {
		return NoopReporter(), ""
	}
	return value.reporter, value.clientName
}

// Now returns the current unix timestamp in milliseconds, for ActivityEvent.Timestamp.
func Now() int64 { return time.Now().UnixMilli() }

// ── client name context (set by HTTP handler, read by catalog) ──

type clientNameContextKey struct{}

// ContextWithClientName attaches the calling client's name (derived from the
// HTTP User-Agent header) to the request context.
func ContextWithClientName(ctx context.Context, name string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, clientNameContextKey{}, name)
}

// ClientNameFromContext extracts the client name set by ContextWithClientName.
func ClientNameFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	name, _ := ctx.Value(clientNameContextKey{}).(string)
	return name
}
