package main

import (
	"bytes"
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

	var stdout bytes.Buffer
	session.Stdout = &stdout

	const cmd = `getent passwd "$(id -un 2>/dev/null || printf '%s' "$USER")" 2>/dev/null | cut -d: -f7 | head -n1 || true; printf '%s\n' "${SHELL:-}"`

	// 通过 goroutine + select 实现 10 秒超时，防止服务器无响应时永久阻塞
	done := make(chan error, 1)
	go func() {
		done <- session.Run(cmd)
	}()

	select {
	case err := <-done:
		if err != nil {
			return ""
		}
		for _, line := range strings.Split(stdout.String(), "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" {
				return trimmed
			}
		}
		return ""
	case <-time.After(10 * time.Second):
		// 超时后异步关闭 session 以解除阻塞的 Run
		go session.Close()
		return ""
	}
}

func buildShellLaunchCommand(shellPath string) (string, bool) {
	if !isBashShell(shellPath) {
		return "", false
	}

	hook := `if [ -n "${LUMIN_PROMPT_SEEN:-}" ]; then LUMIN_LAST="$(fc -ln -1 2>/dev/null)"; LUMIN_LAST="${LUMIN_LAST#"${LUMIN_LAST%%[![:space:]]*}"}"; if [ -n "$LUMIN_LAST" ]; then LUMIN_ENCODED="$(printf '%s' "$LUMIN_LAST" | base64 | tr -d '\r\n')"; printf '\037LUMIN_CMD\037%s\036' "$LUMIN_ENCODED"; fi; fi; LUMIN_PROMPT_SEEN=1; if [ -n "${LUMIN_OLD_PROMPT_COMMAND:-}" ]; then eval "$LUMIN_OLD_PROMPT_COMMAND"; fi`

	command := fmt.Sprintf(
		"export HISTCONTROL=; export HISTIGNORE=; export LUMIN_OLD_PROMPT_COMMAND=\"$PROMPT_COMMAND\"; export PROMPT_COMMAND=%s; exec %s -il",
		shellQuote(hook),
		shellQuote(shellPath),
	)

	return command, true
}

func isBashShell(shellPath string) bool {
	return strings.EqualFold(path.Base(strings.TrimSpace(shellPath)), "bash")
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}
