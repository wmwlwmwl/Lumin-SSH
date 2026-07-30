//go:build !windows
// +build !windows

package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

// getLocalShells lists detected shells on UNIX-like systems.
func (a *App) getLocalShells() ([]string, error) {
	shells := []string{}
	if sh := os.Getenv("SHELL"); sh != "" {
		shells = append(shells, sh)
	}
	// Fallback/standard shells
	for _, path := range []string{"/bin/zsh", "/bin/bash", "/bin/sh"} {
		if _, err := os.Stat(path); err == nil {
			exists := false
			for _, s := range shells {
				if s == path {
					exists = true
					break
				}
			}
			if !exists {
				shells = append(shells, path)
			}
		}
	}
	if len(shells) == 0 {
		shells = append(shells, "/bin/sh")
	}
	return shells, nil
}

// connectLocal spawns a local process using creack/pty.
func (a *App) connectLocal(sessionId string, name string, shellPath string, cwd string) error {
	workDir := cwd
	if workDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			workDir = home
		}
	}

	cmd := exec.Command(shellPath)
	cmd.Dir = workDir
	cmd.Env = os.Environ()

	ptyFile, err := pty.Start(cmd)
	if err != nil {
		return fmt.Errorf("pty start error: %w", err)
	}

	sd := &SessionData{
		IsLocal:      true,
		LocalPTYUnix: ptyFile,
		Stdin:        ptyFile,
		Cmd:          cmd,
		ShellPath:    shellPath,
		PromptReady:  true,
	}

	a.sshManager.mu.Lock()
	a.sshManager.sessions[sessionId] = sd
	a.sshManager.mu.Unlock()

	// Start an embedded SFTP server so the file manager can work for this session.
	connKey := "local://" + sessionId
	mapPath := unixPathMapper("/")
	if sftpSrv, entry, err := startLocalSFTPServer(mapPath, nil); err != nil {
		log.Printf("[connectLocal] embedded SFTP server failed (file manager unavailable): %v", err)
	} else {
		a.sshManager.mu.Lock()
		a.sshManager.clients[connKey] = entry
		sd.ConnKey = connKey
		sd.LocalSFTPSrv = sftpSrv
		a.sshManager.mu.Unlock()
	}

	// Start background CWD polling monitor for file manager sync
	a.sshManager.StartLocalCwdMonitor(sessionId)

	// Wait and notify exit
	go func() {
		_ = cmd.Wait()
		a.sshManager.disconnectAndNotify(sessionId)
	}()

	// Pipe output from local pty file to WebSocket. Reuses pipeLocalOutput (the
	// same path as Windows) so the per-session output taps stay fed (AI command
	// execution captures output via these taps) and teardown is guarded against
	// a trailing read after Disconnect. Unix sessions set no OSCCwdParser, so the
	// parser branch is skipped and this behaves as a plain passthrough.
	a.sshManager.pipeLocalOutput(sessionId, ptyFile, nil)

	return nil
}

// ResizeLocal handles resizing on UNIX platforms.
func (m *SSHManager) ResizeLocal(s *SessionData, cols, rows int) {
	if s.LocalPTYUnix != nil {
		_ = pty.Setsize(s.LocalPTYUnix, &pty.Winsize{
			Cols: uint16(cols),
			Rows: uint16(rows),
		})
	}
}

// CloseLocal closes the UNIX PTY handle and kills the process.
func (m *SSHManager) CloseLocal(s *SessionData) {
	if s.LocalPTYUnix != nil {
		_ = s.LocalPTYUnix.Close()
		s.LocalPTYUnix = nil
	}
	if s.Cmd != nil && s.Cmd.Process != nil {
		_ = s.Cmd.Process.Kill()
		s.Cmd = nil
	}
}
