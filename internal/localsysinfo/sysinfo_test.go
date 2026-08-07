package localsysinfo

import (
	"os"
	"strings"
	"testing"
)

func TestDeployProbeScriptNormalizesLineEndingsAndCleansUp(t *testing.T) {
	path, cleanup, err := deployProbeScript("#!/bin/sh\r\necho ok\r\n")
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "\r") {
		t.Fatalf("script contains CR: %q", content)
	}
	cleanup()
	cleanup()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("script still exists: %v", err)
	}
}

func TestNonEmptyLines(t *testing.T) {
	got := nonEmptyLines("A=1\n\n B=2 \n")
	if len(got) != 2 || got[0] != "A=1" || got[1] != "B=2" {
		t.Fatalf("unexpected lines: %#v", got)
	}
}
