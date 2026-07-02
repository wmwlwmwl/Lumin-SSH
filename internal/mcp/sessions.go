package mcp

import "luminssh-go/internal/mcpserver"

type SessionProvider struct {
	host Host
}

func NewSessionProvider(host Host) SessionProvider {
	return SessionProvider{host: host}
}

func (p SessionProvider) ListConnectedSessions() ([]mcpserver.SessionDescriptor, error) {
	if p.host == nil {
		return []mcpserver.SessionDescriptor{}, nil
	}
	return p.host.ListSessionDescriptors()
}