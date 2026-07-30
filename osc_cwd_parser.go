package main

import (
	"encoding/base64"
	"strings"
	"sync"
)

// oscCwdParser strips and decodes OSC 733 CWD markers (ESC ] 733 ; <base64> BEL)
// from a ConPTY byte stream, returning the visible output with markers removed
// and any CWD value carried by a marker in the processed chunk.
//
// Used for WSL local sessions: the injected PROMPT_COMMAND hook emits one such
// marker on every prompt. Windows ConPTY strips the \x1f/\x1e control bytes that
// remote SSH relies on, so OSC (which ConPTY passes through, like the terminal-
// title OSC 0) is used instead.
//
// The parser is stateful across Process() calls because a marker may be split
// across multiple reads.
type oscCwdParser struct {
	mu    sync.Mutex
	carry []byte // bytes held back because they may be the start of a marker
}

// OSC 733 framing: "\x1b]733;" <payload> "\x07" (BEL) or "\x1b\\" (ST).
const (
	oscCwdIntro = "\x1b]733;"
	oscBel      = 0x07
)

func newOSCCwdParser() *oscCwdParser { return &oscCwdParser{} }

// Process consumes a chunk of terminal output. It returns:
//   - visible: the output with any complete OSC 733 markers removed
//   - cwd:     the decoded CWD if a marker completed in this chunk ("" otherwise)
//   - prompt:  true if a marker completed in this chunk (signals a prompt/prompt-ready)
func (p *oscCwdParser) Process(chunk []byte) (visible []byte, cwd string, prompt bool) {
	if len(chunk) == 0 {
		return nil, "", false
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	// Prepend any carried bytes from the previous call.
	data := chunk
	if len(p.carry) > 0 {
		data = append(append([]byte{}, p.carry...), chunk...)
		p.carry = p.carry[:0]
	}

	out := make([]byte, 0, len(data))
	i := 0
	for i < len(data) {
		// Look for the OSC intro starting at i.
		rel := strings.IndexByte(string(data[i:]), 0x1b)
		if rel < 0 {
			out = append(out, data[i:]...)
			break
		}
		abs := i + rel
		// Emit anything before the ESC.
		if abs > i {
			out = append(out, data[i:abs]...)
		}
		// Is this an OSC 733 intro?
		if strings.HasPrefix(string(data[abs:]), oscCwdIntro) {
			payloadStart := abs + len(oscCwdIntro)
			end, terminatorLen := findOSCEnd(data[payloadStart:])
			if end < 0 {
				// Marker not yet complete: keep from this ESC onward for next call.
				p.carry = append(p.carry, data[abs:]...)
				return out, "", false
			}
			payload := data[payloadStart : payloadStart+end]
			cwd = decodeOSC733Payload(string(payload))
			prompt = true
			i = payloadStart + end + terminatorLen
			continue
		}
		// Not our OSC: emit the ESC and advance one byte (the rest may contain
		// another sequence, e.g. a CSI; we'll re-scan from the next byte).
		out = append(out, data[abs])
		i = abs + 1
	}

	// Hold back a trailing run that could be the start of an OSC intro, so a
	// marker split across reads isn't emitted as visible bytes.
	if tail := trailingIntroLen(out); tail > 0 {
		p.carry = append(p.carry, out[len(out)-tail:]...)
		out = out[:len(out)-tail]
	}
	return out, cwd, prompt
}

// findOSCEnd returns the offset of the terminator (BEL or ST) within payload,
// and the terminator length. Returns -1 if no terminator is present yet.
func findOSCEnd(payload []byte) (int, int) {
	for i := 0; i < len(payload); i++ {
		if payload[i] == oscBel {
			return i, 1
		}
		if payload[i] == 0x1b && i+1 < len(payload) && payload[i+1] == '\\' {
			return i, 2
		}
	}
	return -1, 0
}

// trailingIntroLen returns how many trailing bytes of out form a prefix of the
// OSC intro (so they may be the start of a marker arriving in the next read).
func trailingIntroLen(out []byte) int {
	intro := []byte(oscCwdIntro)
	best := 0
	limit := len(out)
	if len(intro)-1 < limit {
		limit = len(intro) - 1
	}
	for size := limit; size > best; size-- {
		if bytesEqual(out[len(out)-size:], intro[:size]) {
			best = size
			break
		}
	}
	return best
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// decodeOSC733Payload base64-decodes the marker payload and trims any stray
// whitespace introduced by `base64 | tr` in the hook.
func decodeOSC733Payload(payload string) string {
	dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(payload))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(dec))
}
