package mcpserver

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