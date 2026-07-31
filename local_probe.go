package main

// Shared (platform-independent) helpers for running the dynamic probe script
// against a local session. The WSL and Unix getLocalSystemInfoImpl both write
// the script to a temp file and run it via `sh <file> network`, rather than
// `sh -c "<script> network"`:
//   - On WSL the inline form is corrupted by the wsl.exe interop layer.
//   - On every platform `$1` is empty under `sh -c` with no trailing argv, so
//     the "network" flag would never reach the script's `if [ "$1" = network ]`.
// A script file makes the flag positional ($1) and keeps the script body off
// the command line.

import (
	"os"
	"path/filepath"
	"strings"
)

// deployLocalProbeScript writes dynamicProbeScript to a temp .sh file with LF
// line endings and returns its OS-native path plus a cleanup func. LF endings
// matter: the file is read by sh/dash inside the local/WSL environment, which
// treats a lone \r as a literal character.
func deployLocalProbeScript() (scriptPath string, cleanup func(), err error) {
	dir, err := os.MkdirTemp("", "lumin-probe-*")
	if err != nil {
		return "", nil, err
	}
	scriptPath = filepath.Join(dir, "probe.sh")
	script := strings.ReplaceAll(dynamicProbeScript, "\r\n", "\n")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		os.RemoveAll(dir)
		return "", nil, err
	}
	cleanup = func() { os.RemoveAll(dir) }
	return scriptPath, cleanup, nil
}
