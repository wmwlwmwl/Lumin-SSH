package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"

	"luminssh-go/internal/mcpserver"
)

var luminExitCodePattern = regexp.MustCompile(`\[Lumin_EXIT_CODE_(\d+)\]`)

func (m *SSHManager) ExecuteCommandInTerminal(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (mcpserver.CommandExecutionResult, error) {
	result := mcpserver.CommandExecutionResult{
		SessionID: sessionID,
		Command: command,
		Purpose: purpose,
		IsMutating: isMutating,
		CWD: cwd,
		ShellType: shellType,
	}
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}
	m.mu.RLock()
	sessionData, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok || sessionData == nil || sessionData.Stdin == nil {
		return result, fmt.Errorf("session not found")
	}
	startMarker := "[Lumin_START_" + newCommandExecutionToken() + "]"
	endMarker := "[Lumin_END_" + newCommandExecutionToken() + "]"
	wrappedCommand, err := buildInteractiveCommandWrapper(command, cwd, shellType, startMarker, endMarker)
	if err != nil {
		return result, err
	}
	_, outputChannel, cancel := m.registerSessionOutputTap(sessionID)
	defer cancel()
	if !strings.HasSuffix(wrappedCommand, "\n") {
		wrappedCommand += "\n"
	}
	m.WriteBytes(sessionID, []byte(wrappedCommand))
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	var captured strings.Builder
	for {
		select {
		case chunk, ok := <-outputChannel:
			raw := captured.String()
			if ok {
				captured.Write(chunk)
				raw = captured.String()
			}
			if strings.Contains(raw, endMarker) || !ok {
				exitCode, hasExitCode := extractInteractiveExitCode(raw)
				if hasExitCode {
					result.ExitCode = &exitCode
				}
				result.Output = sanitizeInteractiveCommandOutput(raw, startMarker, endMarker)
				return result, nil
			}
		case <-deadline.C:
			raw := captured.String()
			exitCode, hasExitCode := extractInteractiveExitCode(raw)
			if hasExitCode {
				result.ExitCode = &exitCode
			}
			result.TimedOut = true
			result.Output = sanitizeInteractiveCommandOutput(raw, startMarker, endMarker)
			return result, nil
		}
	}
}

func buildInteractiveCommandWrapper(command string, cwd string, shellType string, startMarker string, endMarker string) (string, error) {
	normalizedShellType := strings.TrimSpace(shellType)
	if normalizedShellType == "" {
		normalizedShellType = "zsh"
	}
	switch normalizedShellType {
	case "zsh":
		return buildUnixInteractiveCommandWrapper(command, cwd, startMarker, endMarker), nil
	case "powershell":
		return buildPowerShellInteractiveCommandWrapper(command, cwd, startMarker, endMarker), nil
	case "cmd":
		return buildCmdInteractiveCommandWrapper(command, cwd, startMarker, endMarker), nil
	default:
		return "", fmt.Errorf("unsupported shellType: %s", normalizedShellType)
	}
}

func buildUnixInteractiveCommandWrapper(command string, cwd string, startMarker string, endMarker string) string {
	token := newCommandExecutionToken()
	scriptPath := "/tmp/lumin_mcp_" + token + ".sh"
	scriptLines := []string{
		"#!/bin/sh",
		"cleanup() {",
		"  lumin_mcp_exit=$?",
		"  rm -f " + quotePOSIX(scriptPath),
		`  printf '%s\n' "[Lumin_EXIT_CODE_${lumin_mcp_exit}]"`,
		"  printf '%s\\n' " + quotePOSIX(endMarker),
		"  exit 0",
		"}",
		"trap cleanup EXIT",
	}
	if strings.TrimSpace(cwd) != "" {
		scriptLines = append(scriptLines, "cd "+quotePOSIX(cwd))
	}
	scriptLines = append(scriptLines, "printf '%s\\n' "+quotePOSIX(startMarker))
	scriptLines = append(scriptLines, command)
	encodedScript := base64.StdEncoding.EncodeToString([]byte(strings.Join(scriptLines, "\n")))
	return strings.Join([]string{
		"cat <<'__LUMIN_MCP_B64__' | base64 -d > " + quotePOSIX(scriptPath),
		encodedScript,
		"__LUMIN_MCP_B64__",
		"chmod +x " + quotePOSIX(scriptPath),
		"sh " + quotePOSIX(scriptPath),
	}, "\n")
}

func buildPowerShellInteractiveCommandWrapper(command string, cwd string, startMarker string, endMarker string) string {
	token := newCommandExecutionToken()
	scriptLines := []string{
		`$ErrorActionPreference = "Continue"`,
		`try {`,
	}
	if strings.TrimSpace(cwd) != "" {
		scriptLines = append(scriptLines, "Set-Location -LiteralPath '"+escapePowerShellSingleQuoted(cwd)+"'")
	}
	scriptLines = append(scriptLines, "Write-Output '"+escapePowerShellSingleQuoted(startMarker)+"'")
	scriptLines = append(scriptLines, command)
	scriptLines = append(scriptLines,
		`} finally {`,
		`  $lumin_mcp_exit = $LASTEXITCODE`,
		`  if ($lumin_mcp_exit -eq $null) { $lumin_mcp_exit = if ($?) { 0 } else { 1 } }`,
		`  Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue`,
		`  Write-Output ("[Lumin_EXIT_CODE_" + $lumin_mcp_exit + "]")`,
		`  Write-Output '`+escapePowerShellSingleQuoted(endMarker)+`'`,
		`  exit 0`,
		`}`,
	)
	encodedScript := base64.StdEncoding.EncodeToString([]byte(strings.Join(scriptLines, "\r\n")))
	return strings.Join([]string{
		"$__lumin_path = Join-Path $env:TEMP 'lumin_mcp_" + token + ".ps1'",
		"$__lumin_bytes = [System.Convert]::FromBase64String('" + encodedScript + "')",
		"[System.IO.File]::WriteAllBytes($__lumin_path, $__lumin_bytes)",
		"& $__lumin_path",
	}, "\r\n")
}

func buildCmdInteractiveCommandWrapper(command string, cwd string, startMarker string, endMarker string) string {
	token := newCommandExecutionToken()
	scriptLines := []string{
		"@echo off",
	}
	if strings.TrimSpace(cwd) != "" {
		scriptLines = append(scriptLines, `cd /d "`+escapeCmdQuoted(cwd)+`"`)
	}
	scriptLines = append(scriptLines,
		"echo "+startMarker,
		command,
		`set "__LUMIN_EXIT=%ERRORLEVEL%"`,
		`echo [Lumin_EXIT_CODE_%__LUMIN_EXIT%]`,
		"echo "+endMarker,
		`(goto) 2>nul & del "%~f0"`,
		`exit /b 0`,
	)
	encodedScript := base64.StdEncoding.EncodeToString([]byte(strings.Join(scriptLines, "\r\n")))
	return strings.Join([]string{
		`powershell -NoProfile -Command "$p = Join-Path $env:TEMP 'lumin_mcp_` + token + `.cmd'; [System.IO.File]::WriteAllBytes($p, [System.Convert]::FromBase64String('` + encodedScript + `'))"`,
		`call "%TEMP%\lumin_mcp_` + token + `.cmd"`,
	}, "\r\n")
}

func sanitizeInteractiveCommandOutput(output string, startMarker string, endMarker string) string {
	if startIndex := strings.Index(output, startMarker); startIndex >= 0 {
		output = output[startIndex+len(startMarker):]
	}
	if endIndex := strings.Index(output, endMarker); endIndex >= 0 {
		output = output[:endIndex]
	}
	output = luminExitCodePattern.ReplaceAllString(output, "")
	output = strings.ReplaceAll(output, "\r\n", "\n")
	output = strings.Trim(output, "\n\r\t ")
	if output == "" {
		return ""
	}
	return compressTerminalOutput(output, currentTerminalOutputLineLimit(), currentTerminalOutputCharacterLimit())
}

func extractInteractiveExitCode(output string) (int, bool) {
	match := luminExitCodePattern.FindStringSubmatch(output)
	if len(match) != 2 {
		return 0, false
	}
	exitCode := 0
	for _, ch := range match[1] {
		exitCode = exitCode*10 + int(ch-'0')
	}
	return exitCode, true
}

func quotePOSIX(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func escapePowerShellSingleQuoted(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func escapeCmdQuoted(value string) string {
	return strings.ReplaceAll(value, `"`, `""`)
}

func newCommandExecutionToken() string {
	buffer := make([]byte, 8)
	if _, err := rand.Read(buffer); err != nil {
		return hex.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	return hex.EncodeToString(buffer)
}