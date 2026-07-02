package mcpserver

import (
	"errors"
	"sort"
	"strings"
)

var ErrSessionProviderUnavailable = errors.New("session provider unavailable")
var ErrSessionNotFound = errors.New("session not found")

type Service struct {
	sessionProvider SessionProvider
}

func NewService(sessionProvider SessionProvider) *Service {
	return &Service{sessionProvider: sessionProvider}
}

func (s *Service) ListConnectedSessions() ([]ConnectedSession, error) {
	if s == nil || s.sessionProvider == nil {
		return nil, ErrSessionProviderUnavailable
	}
	descriptors, err := s.sessionProvider.ListConnectedSessions()
	if err != nil {
		return nil, err
	}
	result := make([]ConnectedSession, 0, len(descriptors))
	for _, descriptor := range descriptors {
		groupSessionID := descriptor.GroupSessionID
		if groupSessionID == "" {
			groupSessionID = descriptor.SessionID
		}
		result = append(result, ConnectedSession{
			SessionID: descriptor.SessionID,
			GroupSessionID: groupSessionID,
			ConnectionRef: descriptor.ConnectionRef,
			ConnectionID: descriptor.ConnectionID,
			Tags: append([]string(nil), descriptor.Tags...),
			SFTPAvailable: descriptor.SFTPAvailable,
			IsChildTerminal: descriptor.GroupSessionID != "",
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ConnectionRef != result[j].ConnectionRef {
			return result[i].ConnectionRef < result[j].ConnectionRef
		}
		if result[i].GroupSessionID != result[j].GroupSessionID {
			return result[i].GroupSessionID < result[j].GroupSessionID
		}
		return result[i].SessionID < result[j].SessionID
	})
	return result, nil
}

func (s *Service) GetConnectedSession(sessionID string) (ConnectedSession, error) {
	sessions, err := s.ListConnectedSessions()
	if err != nil {
		return ConnectedSession{}, err
	}
	trimmedSessionID := strings.TrimSpace(sessionID)
	for _, session := range sessions {
		if session.SessionID == trimmedSessionID {
			return session, nil
		}
	}
	return ConnectedSession{}, ErrSessionNotFound
}