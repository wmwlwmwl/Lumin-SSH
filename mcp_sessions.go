package main

import (
	"strings"

	"luminssh-go/internal/mcpserver"
)

type mcpSessionProvider struct {
	app *App
}

func (p mcpSessionProvider) ListConnectedSessions() ([]mcpserver.SessionDescriptor, error) {
	if p.app == nil || p.app.sshManager == nil {
		return []mcpserver.SessionDescriptor{}, nil
	}
	p.app.sshManager.mu.RLock()
	sessionMap := make(map[string]*SessionData, len(p.app.sshManager.sessions))
	for sessionID, sessionData := range p.app.sshManager.sessions {
		sessionMap[sessionID] = sessionData
	}
	clientMap := make(map[string]*sshClientEntry, len(p.app.sshManager.clients))
	for connectionRef, clientEntry := range p.app.sshManager.clients {
		clientMap[connectionRef] = clientEntry
	}
	p.app.sshManager.mu.RUnlock()
	connectionMap := make(map[string]Connection)
	if p.app.configManager != nil {
		for _, connection := range p.app.configManager.GetConnections() {
			if connection.ID != "" {
				connectionMap[connection.ID] = connection
			}
			connectionMap[connection.Username+"@"+dialAddr(connection.Host, connection.Port)] = connection
		}
	}
	result := make([]mcpserver.SessionDescriptor, 0, len(sessionMap))
	for sessionID, sessionData := range sessionMap {
		if sessionData == nil {
			continue
		}
		descriptor := mcpserver.SessionDescriptor{
			SessionID: sessionID,
			GroupSessionID: sessionData.GroupSessionId,
			ConnectionRef: sessionData.ConnKey,
			ConnectionID: sessionData.ConnKey,
		}
		if clientEntry, ok := clientMap[sessionData.ConnKey]; ok && clientEntry != nil && clientEntry.SFTP != nil {
			descriptor.SFTPAvailable = true
		}
		if connection, ok := connectionMap[sessionData.ConnKey]; ok {
			descriptor.ConnectionID = connection.ID
			descriptor.Tags = buildMCPSessionTags(connection)
		}
		result = append(result, descriptor)
	}
	return result, nil
}

func buildMCPSessionTags(connection Connection) []string {
	tags := make([]string, 0, 3)
	if name := strings.TrimSpace(connection.Name); name != "" {
		tags = append(tags, name)
	}
	if group := strings.TrimSpace(connection.Group); group != "" && !containsMCPSessionTag(tags, group) {
		tags = append(tags, group)
	}
	if osName := strings.TrimSpace(connection.Os); osName != "" && !containsMCPSessionTag(tags, osName) {
		tags = append(tags, osName)
	}
	return tags
}

func containsMCPSessionTag(tags []string, value string) bool {
	for _, tag := range tags {
		if tag == value {
			return true
		}
	}
	return false
}

func (a *App) ListConnectedSessions() ([]mcpserver.ConnectedSession, error) {
	return mcpserver.NewService(mcpSessionProvider{app: a}).ListConnectedSessions()
}