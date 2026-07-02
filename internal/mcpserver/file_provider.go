package mcpserver

import "context"

type DirectoryEntry struct {
	Name string `json:"name"`
	IsDirectory bool `json:"is_directory"`
	Size int64 `json:"size"`
	ModifyTime string `json:"modify_time,omitempty"`
	Permission string `json:"permission,omitempty"`
	Mode string `json:"mode,omitempty"`
	UID string `json:"uid,omitempty"`
	GID string `json:"gid,omitempty"`
}

type FileProvider interface {
	ListDirectory(sessionID string, remotePath string) ([]DirectoryEntry, error)
	ReadTextFile(sessionID string, remotePath string) (string, error)
	WriteTextFile(sessionID string, remotePath string, content string) error
	DeleteFile(sessionID string, remotePath string) error
}

type CancelableFileProvider interface {
	ListDirectoryContext(ctx context.Context, sessionID string, remotePath string) ([]DirectoryEntry, error)
	ReadTextFileContext(ctx context.Context, sessionID string, remotePath string) (string, error)
	WriteTextFileContext(ctx context.Context, sessionID string, remotePath string, content string) error
	DeleteFileContext(ctx context.Context, sessionID string, remotePath string) error
}

func listDirectoryWithContext(provider FileProvider, ctx context.Context, sessionID string, remotePath string) ([]DirectoryEntry, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if cancelableProvider, ok := provider.(CancelableFileProvider); ok {
		return cancelableProvider.ListDirectoryContext(ctx, sessionID, remotePath)
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
		return provider.ListDirectory(sessionID, remotePath)
	}
}

func readTextFileWithContext(provider FileProvider, ctx context.Context, sessionID string, remotePath string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if cancelableProvider, ok := provider.(CancelableFileProvider); ok {
		return cancelableProvider.ReadTextFileContext(ctx, sessionID, remotePath)
	}
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
		return provider.ReadTextFile(sessionID, remotePath)
	}
}

func writeTextFileWithContext(provider FileProvider, ctx context.Context, sessionID string, remotePath string, content string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if cancelableProvider, ok := provider.(CancelableFileProvider); ok {
		return cancelableProvider.WriteTextFileContext(ctx, sessionID, remotePath, content)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return provider.WriteTextFile(sessionID, remotePath, content)
	}
}

func deleteFileWithContext(provider FileProvider, ctx context.Context, sessionID string, remotePath string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if cancelableProvider, ok := provider.(CancelableFileProvider); ok {
		return cancelableProvider.DeleteFileContext(ctx, sessionID, remotePath)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return provider.DeleteFile(sessionID, remotePath)
	}
}