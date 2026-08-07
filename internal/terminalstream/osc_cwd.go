package terminalstream

import (
	"encoding/base64"
	"strings"
	"sync"
)

const oscCWDIntro = "\x1b]733;"
const oscBEL byte = 0x07

type OSCCWDParser struct {
	mu    sync.Mutex
	carry []byte
}

func NewOSCCWDParser() *OSCCWDParser {
	return &OSCCWDParser{}
}

func (p *OSCCWDParser) Process(chunk []byte) (visible []byte, cwd string, prompt bool) {
	if len(chunk) == 0 {
		return nil, "", false
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	data := chunk
	if len(p.carry) > 0 {
		data = append(append([]byte{}, p.carry...), chunk...)
		p.carry = p.carry[:0]
	}

	out := make([]byte, 0, len(data))
	for i := 0; i < len(data); {
		rel := strings.IndexByte(string(data[i:]), 0x1b)
		if rel < 0 {
			out = append(out, data[i:]...)
			break
		}
		abs := i + rel
		if abs > i {
			out = append(out, data[i:abs]...)
		}
		if strings.HasPrefix(string(data[abs:]), oscCWDIntro) {
			payloadStart := abs + len(oscCWDIntro)
			end, terminatorLen := findOSCEnd(data[payloadStart:])
			if end < 0 {
				p.carry = append(p.carry, data[abs:]...)
				return out, "", false
			}
			payload := data[payloadStart : payloadStart+end]
			cwd = decodeOSCWD(payload)
			prompt = true
			i = payloadStart + end + terminatorLen
			continue
		}
		out = append(out, data[abs])
		i = abs + 1
	}

	if tail := trailingOSCIntroLen(out); tail > 0 {
		p.carry = append(p.carry, out[len(out)-tail:]...)
		out = out[:len(out)-tail]
	}
	return out, cwd, prompt
}

func findOSCEnd(payload []byte) (int, int) {
	for i := 0; i < len(payload); i++ {
		if payload[i] == oscBEL {
			return i, 1
		}
		if payload[i] == 0x1b && i+1 < len(payload) && payload[i+1] == '\\' {
			return i, 2
		}
	}
	return -1, 0
}

func trailingOSCIntroLen(out []byte) int {
	intro := []byte(oscCWDIntro)
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

func bytesEqual(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func decodeOSCWD(payload []byte) string {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(payload)))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(decoded))
}
