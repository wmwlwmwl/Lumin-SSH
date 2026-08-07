package terminalstream

import (
	"bytes"
	"encoding/base64"
	"strings"
)

var commandMarkerStart = []byte("\x1fLUMIN_CMD\x1f")
var cwdMarkerStart = []byte("\x1fLUMIN_CWD\x1f")

const markerEnd byte = 0x1e
const markerPayloadMax = 64 * 1024

const (
	markerKindNone byte = iota
	markerKindCommand
	markerKindCWD
)

type TextDecoder func([]byte) string

type CommandHistoryParser struct {
	visibleCarry []byte
	payloadCarry []byte
	inMarker     bool
	markerKind   byte
	lastCommand  string
	decoder      TextDecoder
}

func NewCommandHistoryParser(decoder TextDecoder) *CommandHistoryParser {
	if decoder == nil {
		decoder = func(data []byte) string { return string(data) }
	}
	return &CommandHistoryParser{decoder: decoder}
}

func (p *CommandHistoryParser) resetMarkerState() {
	p.payloadCarry = p.payloadCarry[:0]
	p.inMarker = false
	p.markerKind = markerKindNone
}

func (p *CommandHistoryParser) Process(chunk []byte) ([]byte, []string, string, bool) {
	if len(chunk) == 0 {
		return nil, nil, "", false
	}

	if len(p.visibleCarry) == 0 && !p.inMarker && !bytes.Contains(chunk, commandMarkerStart) && !bytes.Contains(chunk, cwdMarkerStart) && trailingMarkerPrefixLen(chunk, commandMarkerStart, cwdMarkerStart) == 0 {
		return chunk, nil, "", false
	}

	data := append(append([]byte{}, p.visibleCarry...), chunk...)
	p.visibleCarry = p.visibleCarry[:0]

	out := make([]byte, 0, len(data))
	commands := make([]string, 0, 1)
	cwd := ""
	promptSeen := false

	for i := 0; i < len(data); {
		if p.inMarker {
			relEnd := bytes.IndexByte(data[i:], markerEnd)
			if relEnd == -1 {
				remaining := data[i:]
				if len(p.payloadCarry)+len(remaining) > markerPayloadMax {
					p.resetMarkerState()
					out = append(out, remaining...)
					return out, commands, cwd, promptSeen
				}
				p.payloadCarry = append(p.payloadCarry, remaining...)
				return out, commands, cwd, promptSeen
			}

			end := i + relEnd
			if len(p.payloadCarry)+relEnd > markerPayloadMax {
				p.resetMarkerState()
				i = end + 1
				continue
			}
			p.payloadCarry = append(p.payloadCarry, data[i:end]...)
			promptSeen = true
			if p.markerKind == markerKindCommand {
				if command := p.decodeCommand(p.payloadCarry); command != "" && command != p.lastCommand {
					commands = append(commands, command)
					p.lastCommand = command
				}
			} else if p.markerKind == markerKindCWD {
				if nextCWD := p.decodeCWD(p.payloadCarry); nextCWD != "" {
					cwd = nextCWD
				}
			}
			p.resetMarkerState()
			i = end + 1
			continue
		}

		relCommandStart := bytes.Index(data[i:], commandMarkerStart)
		relCWDStart := bytes.Index(data[i:], cwdMarkerStart)
		relStart := -1
		var marker []byte
		markerKind := markerKindNone

		if relCommandStart != -1 {
			relStart = relCommandStart
			marker = commandMarkerStart
			markerKind = markerKindCommand
		}
		if relCWDStart != -1 && (relStart == -1 || relCWDStart < relStart) {
			relStart = relCWDStart
			marker = cwdMarkerStart
			markerKind = markerKindCWD
		}

		if relStart == -1 {
			remaining := data[i:]
			overlap := trailingMarkerPrefixLen(remaining, commandMarkerStart, cwdMarkerStart)
			visibleEnd := len(remaining) - overlap
			if visibleEnd > 0 {
				out = append(out, remaining[:visibleEnd]...)
			}
			if overlap > 0 {
				p.visibleCarry = append(p.visibleCarry, remaining[visibleEnd:]...)
			}
			return out, commands, cwd, promptSeen
		}

		start := i + relStart
		if start > i {
			out = append(out, data[i:start]...)
		}
		i = start + len(marker)
		p.inMarker = true
		p.markerKind = markerKind
	}

	return out, commands, cwd, promptSeen
}

func (p *CommandHistoryParser) decodeCommand(payload []byte) string {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(payload)))
	if err != nil {
		return ""
	}
	command := strings.TrimSpace(p.decoder(decoded))
	if isInteractivePrompt(command) {
		return ""
	}
	return command
}

func (p *CommandHistoryParser) decodeCWD(payload []byte) string {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(payload)))
	if err != nil {
		return ""
	}
	cwd := strings.TrimSpace(p.decoder(decoded))
	if cwd == "" || !strings.HasPrefix(cwd, "/") {
		return ""
	}
	return cwd
}

func isInteractivePrompt(command string) bool {
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
