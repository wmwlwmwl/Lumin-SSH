package main

import (
	"bytes"
	"encoding/base64"
	"strings"
)

var historyMarkerStart = []byte("\x1fLUMIN_CMD\x1f")
var cwdMarkerStart = []byte("\x1fLUMIN_CWD\x1f")

const historyMarkerEnd byte = 0x1e

const (
	markerKindNone byte = iota
	markerKindCommand
	markerKindCwd
)

type commandHistoryStream struct {
	visibleCarry []byte
	payloadCarry []byte
	inMarker     bool
	markerKind   byte
	lastCommand  string
	lastCwd      string
}

func newCommandHistoryStream() *commandHistoryStream {
	return &commandHistoryStream{}
}

func (s *commandHistoryStream) Process(chunk []byte) ([]byte, []string, string) {
	if len(chunk) == 0 {
		return nil, nil, ""
	}

	if len(s.visibleCarry) == 0 && !s.inMarker && !bytes.Contains(chunk, historyMarkerStart) && !bytes.Contains(chunk, cwdMarkerStart) {
		return chunk, nil, ""
	}

	data := append(append([]byte{}, s.visibleCarry...), chunk...)
	s.visibleCarry = s.visibleCarry[:0]

	out := make([]byte, 0, len(data))
	commands := make([]string, 0, 1)
	cwd := ""

	for i := 0; i < len(data); {
		if s.inMarker {
			relEnd := bytes.IndexByte(data[i:], historyMarkerEnd)
			if relEnd == -1 {
				s.payloadCarry = append(s.payloadCarry, data[i:]...)
				return out, commands, cwd
			}

			end := i + relEnd
			s.payloadCarry = append(s.payloadCarry, data[i:end]...)
			if s.markerKind == markerKindCommand {
				if command := decodeHistoryMarkerPayload(s.payloadCarry); command != "" && command != s.lastCommand {
					commands = append(commands, command)
					s.lastCommand = command
				}
			} else if s.markerKind == markerKindCwd {
				// Re-emit cwd on every prompt so waiting command executions can detect idle
				// even when the shell returns to the same directory.
				if nextCwd := decodeCwdMarkerPayload(s.payloadCarry); nextCwd != "" {
					cwd = nextCwd
					s.lastCwd = nextCwd
				}
			}
			s.payloadCarry = s.payloadCarry[:0]
			s.inMarker = false
			s.markerKind = markerKindNone
			i = end + 1
			continue
		}

		relCmdStart := bytes.Index(data[i:], historyMarkerStart)
		relCwdStart := bytes.Index(data[i:], cwdMarkerStart)
		relStart := -1
		marker := []byte(nil)
		markerKind := markerKindNone

		if relCmdStart != -1 {
			relStart = relCmdStart
			marker = historyMarkerStart
			markerKind = markerKindCommand
		}
		if relCwdStart != -1 && (relStart == -1 || relCwdStart < relStart) {
			relStart = relCwdStart
			marker = cwdMarkerStart
			markerKind = markerKindCwd
		}

		if relStart == -1 {
			remaining := data[i:]
			overlap := trailingMarkerPrefixLen(remaining, historyMarkerStart, cwdMarkerStart)
			visibleEnd := len(remaining) - overlap
			if visibleEnd > 0 {
				out = append(out, remaining[:visibleEnd]...)
			}
			if overlap > 0 {
				s.visibleCarry = append(s.visibleCarry, remaining[visibleEnd:]...)
			}
			return out, commands, cwd
		}

		start := i + relStart
		if start > i {
			out = append(out, data[i:start]...)
		}
		i = start + len(marker)
		s.inMarker = true
		s.markerKind = markerKind
	}

	return out, commands, cwd
}

func isInteractiveHistoryPrompt(command string) bool {
	text := strings.TrimSpace(command)
	lower := strings.ToLower(text)
	if text == "" {
		return true
	}
	for _, prefix := range []string{"choose ", "select ", "enter ", "input ", "please enter ", "press enter ", "would you like ", "do you have ", "port to use "} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	if !strings.HasSuffix(text, ":") && !strings.HasSuffix(text, "?") {
		return false
	}
	for _, marker := range []string{"default", "leave empty", "skip", "y/n", "yes/no", "option", "selection"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func decodeHistoryMarkerPayload(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(payload)))
	if err != nil {
		return ""
	}

	command := strings.TrimSpace(string(decoded))
	if isInteractiveHistoryPrompt(command) {
		return ""
	}
	return command
}

func decodeCwdMarkerPayload(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(payload)))
	if err != nil {
		return ""
	}

	cwd := strings.TrimSpace(string(decoded))
	if cwd == "" || !strings.HasPrefix(cwd, "/") {
		return ""
	}
	return cwd
}

func trailingMarkerPrefixLen(data []byte, markers ...[]byte) int {
	best := 0
	for _, marker := range markers {
		limit := len(marker)
		if len(data) < limit {
			limit = len(data)
		}

		for size := limit; size > best; size-- {
			if bytes.Equal(data[len(data)-size:], marker[:size]) {
				best = size
				break
			}
		}
	}
	return best
}
