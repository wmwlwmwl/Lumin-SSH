package mcpserver

import (
	"encoding/json"
	"fmt"
	"strings"
)

type workPathStateProvider interface {
	GetWorkspaceState() string
}

type GetWorkPathResult struct {
	ActiveSessionID  string `json:"active_session_id,omitempty"`
	ActiveTerminalID string `json:"active_terminal_id,omitempty"`
	SessionID        string `json:"session_id,omitempty"`
	ActiveTabID      string `json:"active_tab_id,omitempty"`
	Path             string `json:"path"`
	Resolution       string `json:"resolution,omitempty"`
}

type workPathStateSnapshot struct {
	ActiveSessionID       string                     `json:"activeSessionId"`
	ActiveTerminalID      string                     `json:"activeTerminalId"`
	Sessions              []workPathStateSession     `json:"sessions"`
	FileManagerWorkspaces map[string]workPathEntry   `json:"fileManagerWorkspaces"`
}

type workPathStateSession struct {
	ID        string                   `json:"id"`
	Terminals []workPathStateTerminal  `json:"terminals"`
}

type workPathStateTerminal struct {
	ID string `json:"id"`
}

type workPathEntry struct {
	ActiveTabID string                `json:"activeTabId"`
	Tabs        []workPathTab         `json:"tabs"`
}

type workPathTab struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

type workPathCandidate struct {
	SessionID  string
	Resolution string
}

func getWorkPathToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name: "get_work_path",
		Description: "Get the authoritative current work path from the active file manager tab. Use this instead of inferring cwd from the terminal prompt or running pwd, unless the user explicitly asks for the terminal's cwd. If session_id is provided, the tool tries that terminal workspace first and then falls back to the globally active workspace. Returns the resolved session_id that owns the work path.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"session_id": map[string]any{
					"type": "string",
					"description": "Optional terminal session identifier. If provided, try that file manager workspace before falling back to the active workspace.",
				},
			},
			"additionalProperties": false,
		},
	}
}

func (c *Catalog) callGetWorkPath(arguments map[string]any) (any, error) {
	if c == nil || c.service == nil {
		return nil, ErrSessionProviderUnavailable
	}
	if err := validateAllowedArguments(arguments, "session_id"); err != nil {
		return nil, err
	}
	provider, ok := any(c.service.sessionProvider).(workPathStateProvider)
	if !ok {
		return nil, fmt.Errorf("workspace state provider unavailable")
	}
	rawState := strings.TrimSpace(provider.GetWorkspaceState())
	if rawState == "" {
		return nil, fmt.Errorf("workspace state unavailable")
	}
	snapshot, err := parseWorkPathState(rawState)
	if err != nil {
		return nil, err
	}
	requestedSessionID, _, err := optionalStringArgument(arguments, "session_id")
	if err != nil {
		return nil, err
	}
	result, ok := resolveWorkPath(snapshot, requestedSessionID)
	if !ok {
		return nil, fmt.Errorf("active file manager tab path unavailable")
	}
	return result, nil
}

func parseWorkPathState(rawState string) (workPathStateSnapshot, error) {
	snapshot := workPathStateSnapshot{}
	if err := json.Unmarshal([]byte(rawState), &snapshot); err != nil {
		return snapshot, fmt.Errorf("invalid workspace state: %w", err)
	}
	if snapshot.FileManagerWorkspaces == nil {
		snapshot.FileManagerWorkspaces = map[string]workPathEntry{}
	}
	return snapshot, nil
}

func resolveWorkPath(snapshot workPathStateSnapshot, requestedSessionID string) (GetWorkPathResult, bool) {
	for _, candidate := range buildWorkPathCandidates(snapshot, requestedSessionID) {
		workspace, ok := snapshot.FileManagerWorkspaces[candidate.SessionID]
		if !ok {
			continue
		}
		path, activeTabID, ok := resolveWorkPathFromWorkspace(workspace)
		if !ok {
			continue
		}
		return GetWorkPathResult{
			ActiveSessionID:  strings.TrimSpace(snapshot.ActiveSessionID),
			ActiveTerminalID: strings.TrimSpace(snapshot.ActiveTerminalID),
			SessionID:        candidate.SessionID,
			ActiveTabID:      activeTabID,
			Path:             path,
			Resolution:       candidate.Resolution,
		}, true
	}
	return GetWorkPathResult{}, false
}

func buildWorkPathCandidates(snapshot workPathStateSnapshot, requestedSessionID string) []workPathCandidate {
	candidates := make([]workPathCandidate, 0, 8)
	seen := map[string]struct{}{}
	addCandidate := func(sessionID string, resolution string) {
		trimmedSessionID := strings.TrimSpace(sessionID)
		if trimmedSessionID == "" {
			return
		}
		if _, ok := seen[trimmedSessionID]; ok {
			return
		}
		seen[trimmedSessionID] = struct{}{}
		candidates = append(candidates, workPathCandidate{
			SessionID:  trimmedSessionID,
			Resolution: resolution,
		})
	}
	addCandidate(requestedSessionID, "requested_session")
	addCandidate(snapshot.ActiveTerminalID, "active_terminal")
	activeSession := findWorkPathSession(snapshot.Sessions, snapshot.ActiveSessionID)
	if activeSession == nil {
		return candidates
	}
	addCandidate(activeSession.ID, "active_session")
	for _, terminal := range activeSession.Terminals {
		resolution := "active_session_terminal"
		if strings.TrimSpace(terminal.ID) == strings.TrimSpace(activeSession.ID) {
			resolution = "active_session_root_terminal"
		}
		addCandidate(terminal.ID, resolution)
	}
	return candidates
}

func findWorkPathSession(sessions []workPathStateSession, sessionID string) *workPathStateSession {
	trimmedSessionID := strings.TrimSpace(sessionID)
	if trimmedSessionID == "" {
		return nil
	}
	for index := range sessions {
		if strings.TrimSpace(sessions[index].ID) == trimmedSessionID {
			return &sessions[index]
		}
	}
	return nil
}

func resolveWorkPathFromWorkspace(workspace workPathEntry) (string, string, bool) {
	activeTabID := strings.TrimSpace(workspace.ActiveTabID)
	if activeTabID != "" {
		for _, tab := range workspace.Tabs {
			if strings.TrimSpace(tab.ID) != activeTabID {
				continue
			}
			return normalizeWorkPath(tab.Path), activeTabID, true
		}
	}
	if len(workspace.Tabs) == 0 {
		return "", "", false
	}
	return normalizeWorkPath(workspace.Tabs[0].Path), strings.TrimSpace(workspace.Tabs[0].ID), true
}

func normalizeWorkPath(path string) string {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return "/"
	}
	return trimmedPath
}