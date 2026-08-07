package sshmanager

import (
	"fmt"
	"path"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

func detectRemoteShell(client *ssh.Client) string {
	if client == nil {
		return ""
	}

	session, err := client.NewSession()
	if err != nil {
		return ""
	}
	defer session.Close()

	const cmd = `getent passwd "$(id -un 2>/dev/null || printf '%s' "$USER")" 2>/dev/null | cut -d: -f7 | head -n1 || true; printf '%s\n' "${SHELL:-}"`

	stdout, err := runCommandWithSession(session, cmd, 10*time.Second)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(stdout, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func buildShellLaunchCommand(shellPath string, initialPath string) (string, bool) {
	trimmedShellPath := strings.TrimSpace(shellPath)
	trimmedInitialPath := strings.TrimSpace(initialPath)
	prefix := ""
	if trimmedInitialPath != "" {
		prefix = fmt.Sprintf("cd %s 2>/dev/null || true; ", shellQuotePath(trimmedInitialPath))
	}

	if !isBashShell(trimmedShellPath) {
		if prefix == "" {
			return "", false
		}
		if trimmedShellPath == "" {
			return prefix + `exec "${SHELL:-/bin/sh}" -il`, false
		}
		return prefix + "exec " + shellQuotePath(trimmedShellPath) + " -il", false
	}

	hook := `[ -t 0 ] && stty echo 2>/dev/null; if [ -n "${LUMIN_PROMPT_SEEN:-}" ]; then LUMIN_LAST="$(fc -ln -1 2>/dev/null)"; LUMIN_LAST="${LUMIN_LAST#"${LUMIN_LAST%%[![:space:]]*}"}"; if [ -n "$LUMIN_LAST" ]; then LUMIN_ENCODED="$(printf '%s' "$LUMIN_LAST" | base64 | tr -d '\r\n')"; printf '\037LUMIN_CMD\037%s\036' "$LUMIN_ENCODED"; fi; fi; LUMIN_PROMPT_SEEN=1; LUMIN_CWD="$(pwd 2>/dev/null | base64 | tr -d '\r\n')"; if [ -n "$LUMIN_CWD" ]; then printf '\037LUMIN_CWD\037%s\036' "$LUMIN_CWD"; fi; if [ -n "${LUMIN_OLD_PROMPT_COMMAND:-}" ]; then eval "$LUMIN_OLD_PROMPT_COMMAND"; fi`

	command := fmt.Sprintf(
		"%sexport HISTCONTROL=; export HISTIGNORE=; export LUMIN_OLD_PROMPT_COMMAND=\"$PROMPT_COMMAND\"; export PROMPT_COMMAND=%s; exec %s -il",
		prefix,
		shellQuotePath(hook),
		shellQuotePath(trimmedShellPath),
	)

	return command, true
}

func isBashShell(shellPath string) bool {
	return strings.EqualFold(path.Base(strings.TrimSpace(shellPath)), "bash")
}
