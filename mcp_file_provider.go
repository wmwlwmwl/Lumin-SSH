package main

import (
	pathpkg "path"

	"luminssh-go/internal/mcpserver"
)

type mcpFileProvider struct {
	app *App
}

func (p mcpFileProvider) ListDirectory(sessionID string, remotePath string) ([]mcpserver.DirectoryEntry, error) {
	if p.app == nil {
		return nil, nil
	}
	items, err := p.app.ListDir(sessionID, remotePath)
	if err != nil {
		return nil, err
	}
	result := make([]mcpserver.DirectoryEntry, 0, len(items))
	for _, item := range items {
		result = append(result, mcpserver.DirectoryEntry{
			Name: readString(item, "name"),
			IsDirectory: readBool(item, "isDirectory"),
			Size: readInt64(item, "size"),
			ModifyTime: readString(item, "modifyTime"),
			Permission: readString(item, "permission"),
			Mode: readString(item, "mode"),
			UID: readString(item, "uid"),
			GID: readString(item, "gid"),
		})
	}
	return result, nil
}

func (p mcpFileProvider) ReadTextFile(sessionID string, remotePath string) (string, error) {
	if p.app == nil {
		return "", nil
	}
	return p.app.ReadFile(sessionID, remotePath)
}

func (p mcpFileProvider) WriteTextFile(sessionID string, remotePath string, content string) error {
	if p.app == nil {
		return nil
	}
	parentDir := pathpkg.Dir(remotePath)
	if parentDir != "" && parentDir != "." && parentDir != "/" {
		if err := p.app.Mkdir(sessionID, parentDir); err != nil {
			return err
		}
	}
	return p.app.WriteFile(sessionID, remotePath, content)
}

func (p mcpFileProvider) DeleteFile(sessionID string, remotePath string) error {
	if p.app == nil {
		return nil
	}
	return p.app.DeleteItem(sessionID, remotePath, false)
}

func readString(item map[string]interface{}, key string) string {
	value, ok := item[key]
	if !ok || value == nil {
		return ""
	}
	str, ok := value.(string)
	if ok {
		return str
	}
	return ""
}

func readBool(item map[string]interface{}, key string) bool {
	value, ok := item[key]
	if !ok || value == nil {
		return false
	}
	flag, ok := value.(bool)
	if ok {
		return flag
	}
	return false
}

func readInt64(item map[string]interface{}, key string) int64 {
	value, ok := item[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	default:
		return 0
	}
}