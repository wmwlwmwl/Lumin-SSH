package mcpserver

type SessionDescriptor struct {
	SessionID string
	GroupSessionID string
	ConnectionRef string
	ConnectionID string
	Tags []string
	SFTPAvailable bool
}

type ConnectedSession struct {
	SessionID string `json:"session_id"`
	GroupSessionID string `json:"group_session_id,omitempty"`
	ConnectionRef string `json:"connection_ref"`
	ConnectionID string `json:"connection_id,omitempty"`
	Tags []string `json:"tags,omitempty"`
	SFTPAvailable bool `json:"sftp_available"`
	IsChildTerminal bool `json:"is_child_terminal"`
}

type SessionProvider interface {
	ListConnectedSessions() ([]SessionDescriptor, error)
}