package mcp

import (
	"context"
	"os"
	"time"

	"luminssh-go/internal/mcpserver"
)

type Host interface {
	RegistryKey() any
	ListSessionDescriptors() ([]mcpserver.SessionDescriptor, error)
	ExecuteCommandInTerminalControlled(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (mcpserver.CommandExecutionResult, error)
	ListDirectoryContext(ctx context.Context, sessionID string, remotePath string) ([]map[string]interface{}, error)
	ReadTextFileContext(ctx context.Context, sessionID string, remotePath string) (string, error)
	WriteTextFileContext(ctx context.Context, sessionID string, remotePath string, content string) error
	DeleteItemContext(ctx context.Context, sessionID string, remotePath string, isDir bool) error
	MkdirContext(ctx context.Context, sessionID string, remotePath string) error
	RunCommandContext(ctx context.Context, sessionID string, command string) (string, error)
	UploadTempTextContext(ctx context.Context, sessionID string, suffix string, content string, mode os.FileMode) (string, error)
	RemoveFile(sessionID string, remotePath string)
}