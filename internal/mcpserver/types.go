package mcpserver

type SessionDescriptor struct {
	SessionID string
	GroupSessionID string
	ConnectionRef string
	ConnectionID string
	// Address 是 user@host:port 形式的服务器地址，用于区分同名服务器。
	Address string
	Tags []string
	SFTPAvailable bool
}

type ConnectedSession struct {
	SessionID string `json:"session_id"`
	GroupSessionID string `json:"group_session_id,omitempty"`
	ConnectionRef string `json:"connection_ref"`
	ConnectionID string `json:"connection_id,omitempty"`
	// Address 是 user@host:port 形式的服务器地址，用于区分同名服务器。
	Address string `json:"address,omitempty"`
	Tags []string `json:"tags,omitempty"`
	SFTPAvailable bool `json:"sftp_available"`
	IsChildTerminal bool `json:"is_child_terminal"`
}

type SessionProvider interface {
	ListConnectedSessions() ([]SessionDescriptor, error)
}