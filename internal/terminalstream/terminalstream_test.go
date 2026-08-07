package terminalstream

import (
	"bytes"
	"encoding/base64"
	"strings"
	"sync"
	"testing"
)

func marker(prefix []byte, value string) []byte {
	payload := base64.StdEncoding.EncodeToString([]byte(value))
	result := append([]byte{}, prefix...)
	result = append(result, payload...)
	return append(result, markerEnd)
}

func TestCommandHistoryParserMarkersAcrossChunks(t *testing.T) {
	parser := NewCommandHistoryParser(nil)
	command := marker(commandMarkerStart, "echo hello")
	cwd := marker(cwdMarkerStart, "/srv/app")
	stream := append(append([]byte("before"), command...), cwd...)
	stream = append(stream, []byte("after")...)

	var visible []byte
	var commands []string
	lastCWD := ""
	sawPrompt := false
	for _, chunk := range [][]byte{stream[:9], stream[9:17], stream[17:31], stream[31:]} {
		out, gotCommands, gotCWD, prompt := parser.Process(chunk)
		visible = append(visible, out...)
		commands = append(commands, gotCommands...)
		if gotCWD != "" {
			lastCWD = gotCWD
		}
		if prompt {
			sawPrompt = true
		}
	}

	if string(visible) != "beforeafter" {
		t.Fatalf("visible output = %q", visible)
	}
	if len(commands) != 1 || commands[0] != "echo hello" {
		t.Fatalf("commands = %#v", commands)
	}
	if lastCWD != "/srv/app" {
		t.Fatalf("cwd = %q", lastCWD)
	}
	if !sawPrompt {
		t.Fatal("expected at least one prompt marker")
	}
}

func TestCommandHistoryParserFiltersInvalidAndDuplicateCommands(t *testing.T) {
	parser := NewCommandHistoryParser(nil)
	input := append(marker(commandMarkerStart, "echo hello"), marker(commandMarkerStart, "echo hello")...)
	input = append(input, marker(commandMarkerStart, "Please enter option:")...)
	input = append(input, commandMarkerStart...)
	input = append(input, []byte("not-base64")...)
	input = append(input, markerEnd)

	_, commands, _, _ := parser.Process(input)
	if len(commands) != 1 || commands[0] != "echo hello" {
		t.Fatalf("commands = %#v", commands)
	}
}

func TestCommandHistoryParserUsesDecoder(t *testing.T) {
	parser := NewCommandHistoryParser(func(data []byte) string {
		return "decoded:" + string(data)
	})
	_, commands, _, _ := parser.Process(marker(commandMarkerStart, "raw"))
	if len(commands) != 1 || commands[0] != "decoded:raw" {
		t.Fatalf("commands = %#v", commands)
	}
}

func TestCommandHistoryParserPayloadCapRecovers(t *testing.T) {
	parser := NewCommandHistoryParser(nil)
	if out, _, _, _ := parser.Process(commandMarkerStart); len(out) != 0 {
		t.Fatalf("open marker should be hidden, got %q", out)
	}
	if out, _, _, _ := parser.Process(bytes.Repeat([]byte("A"), markerPayloadMax/2)); len(out) != 0 {
		t.Fatalf("partial payload should be hidden, got %d bytes", len(out))
	}
	overflow := bytes.Repeat([]byte("B"), markerPayloadMax)
	out, commands, _, prompt := parser.Process(overflow)
	if prompt || len(commands) != 0 || !bytes.Equal(out, overflow) {
		t.Fatalf("overflow recovery returned output=%d commands=%v prompt=%v", len(out), commands, prompt)
	}
	out, _, _, _ = parser.Process([]byte("ok"))
	if string(out) != "ok" {
		t.Fatalf("visible output after recovery = %q", out)
	}
}

func TestCommandHistoryParserEmptyChunk(t *testing.T) {
	parser := NewCommandHistoryParser(nil)
	visible, commands, cwd, prompt := parser.Process(nil)
	if visible != nil || commands != nil || cwd != "" || prompt {
		t.Fatalf("unexpected empty result: %v %v %q %v", visible, commands, cwd, prompt)
	}
}

func oscMarker(cwd string, terminator string) []byte {
	payload := base64.StdEncoding.EncodeToString([]byte(cwd))
	return []byte(oscCWDIntro + payload + terminator)
}

func TestOSCCWDParserTerminatorsAndChunks(t *testing.T) {
	for _, terminator := range []string{"\x07", "\x1b\\"} {
		t.Run(base64.StdEncoding.EncodeToString([]byte(terminator)), func(t *testing.T) {
			parser := NewOSCCWDParser()
			input := append([]byte("before"), oscMarker("/home/test", terminator)...)
			input = append(input, []byte("after")...)
			cut := strings.Index(string(input), "]733;") + 3
			first, cwd, prompt := parser.Process(input[:cut])
			if string(first) != "before" || cwd != "" || prompt {
				t.Fatalf("first result = %q %q %v", first, cwd, prompt)
			}
			second, cwd, prompt := parser.Process(input[cut:])
			if string(second) != "after" || cwd != "/home/test" || !prompt {
				t.Fatalf("second result = %q %q %v", second, cwd, prompt)
			}
		})
	}
}

func TestOSCCWDParserPreservesOtherOSCAndRejectsInvalidPayload(t *testing.T) {
	parser := NewOSCCWDParser()
	other := []byte("x\x1b]0;title\x07y")
	visible, cwd, prompt := parser.Process(other)
	if !bytes.Equal(visible, other) || cwd != "" || prompt {
		t.Fatalf("other OSC result = %q %q %v", visible, cwd, prompt)
	}

	visible, cwd, prompt = parser.Process([]byte("a" + oscCWDIntro + "not-base64\x07b"))
	if string(visible) != "ab" || cwd != "" || !prompt {
		t.Fatalf("invalid payload result = %q %q %v", visible, cwd, prompt)
	}
}

func TestOSCCWDParserConcurrentProcess(t *testing.T) {
	parser := NewOSCCWDParser()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			parser.Process([]byte("visible"))
		}()
	}
	wg.Wait()
}
