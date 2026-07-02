package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"luminssh-go/internal/mcpserver"
)

const remotePatchPythonScript = `#!/usr/bin/env python3
import json
import os
import shutil
import sys
import tempfile

def ensure_parent(target_path):
    parent = os.path.dirname(target_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

def acquire_lock(target_path):
    ensure_parent(target_path)
    lock_path = target_path + ".lumin.lock"
    os.mkdir(lock_path)
    return lock_path

def release_lock(lock_path):
    if not lock_path:
        return
    try:
        os.rmdir(lock_path)
    except OSError:
        shutil.rmtree(lock_path, ignore_errors=True)

def atomic_write(target_path, content):
    ensure_parent(target_path)
    parent = os.path.dirname(target_path) or "."
    temp_path = ""
    fd, temp_path = tempfile.mkstemp(prefix=".lumin_patch_", dir=parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, target_path)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

def apply_update(target_path, hunks):
    with open(target_path, "r", encoding="utf-8", newline="") as handle:
        content = handle.read()
    for hunk in hunks:
        search = hunk.get("Search") or hunk.get("search") or ""
        replace = hunk.get("Replace") or hunk.get("replace") or ""
        occurrences = content.count(search) if search else 0
        if occurrences != 1:
            return None, occurrences
        content = content.replace(search, replace, 1)
    atomic_write(target_path, content)
    return True, None

def main():
    payload_path = sys.argv[1]
    with open(payload_path, "r", encoding="utf-8") as handle:
        operations = json.load(handle)
    result = {
        "session_id": "",
        "files_changed": 0,
        "applied": False,
        "changes": []
    }
    for operation in operations:
        action = operation.get("Action") or operation.get("action") or ""
        target_path = operation.get("Path") or operation.get("path") or ""
        content = operation.get("Content") or operation.get("content") or ""
        hunks = operation.get("Hunks") or operation.get("hunks") or []
        change = {
            "action": action,
            "path": target_path,
            "hunks": len(hunks),
            "applied": False
        }
        lock_path = ""
        try:
            lock_path = acquire_lock(target_path)
            if action == "add":
                atomic_write(target_path, content)
                change["applied"] = True
                result["files_changed"] += 1
            elif action == "delete":
                os.remove(target_path)
                change["applied"] = True
                result["files_changed"] += 1
            elif action == "update":
                applied, occurrences = apply_update(target_path, hunks)
                if not applied:
                    failure = {
                        "reason": "patch hunk matched zero or multiple locations",
                        "occurrences": occurrences
                    }
                    change["failure"] = failure
                    result["changes"].append(change)
                    result["failure"] = failure
                    print(json.dumps(result, ensure_ascii=False))
                    return 0
                change["applied"] = True
                result["files_changed"] += 1
            else:
                failure = {"reason": "unsupported patch action: " + action}
                change["failure"] = failure
                result["changes"].append(change)
                result["failure"] = failure
                print(json.dumps(result, ensure_ascii=False))
                return 0
        except Exception as exc:
            failure = {"reason": str(exc)}
            change["failure"] = failure
            result["changes"].append(change)
            result["failure"] = failure
            print(json.dumps(result, ensure_ascii=False))
            return 0
        finally:
            release_lock(lock_path)
        result["changes"].append(change)
    result["applied"] = True
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    sys.exit(main())
`

type mcpRemoteEditExecutor struct {
	app *App
}

func (e mcpRemoteEditExecutor) GetCapabilities(sessionID string) (mcpserver.RemoteEditCapabilities, error) {
	capabilities := mcpserver.RemoteEditCapabilities{}
	output, err := e.runCommand(sessionID, "sh -lc 'command -v python3 >/dev/null 2>&1 && echo python3=1 || echo python3=0; command -v perl >/dev/null 2>&1 && echo perl=1 || echo perl=0; command -v patch >/dev/null 2>&1 && echo patch=1 || echo patch=0; command -v flock >/dev/null 2>&1 && echo flock=1 || echo flock=0'")
	if err != nil {
		return capabilities, err
	}
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	for _, line := range lines {
		switch strings.TrimSpace(line) {
		case "python3=1":
			capabilities.Python3 = true
		case "perl=1":
			capabilities.Perl = true
		case "patch=1":
			capabilities.Patch = true
		case "flock=1":
			capabilities.Flock = true
		}
	}
	return capabilities, nil
}

func (e mcpRemoteEditExecutor) ApplyPatchAtomic(sessionID string, operations []mcpserver.ApplyPatchFileOperation) (mcpserver.ApplyPatchResult, error) {
	result := mcpserver.ApplyPatchResult{SessionID: sessionID}
	capabilities, err := e.GetCapabilities(sessionID)
	if err != nil {
		return result, err
	}
	result.Capabilities = capabilities
	if !capabilities.Python3 {
		return result, mcpserver.ErrRemoteEditUnsupported
	}
	result.Handler = mcpserver.EditHandlerPython3AtomicPatch
	payload, err := json.Marshal(operations)
	if err != nil {
		return result, err
	}
	scriptPath, err := e.uploadTempText(sessionID, ".py", remotePatchPythonScript, 0700)
	if err != nil {
		return result, err
	}
	defer e.removeTempFile(sessionID, scriptPath)
	payloadPath, err := e.uploadTempText(sessionID, ".json", string(payload), 0600)
	if err != nil {
		return result, err
	}
	defer e.removeTempFile(sessionID, payloadPath)
	output, err := e.runCommand(sessionID, "python3 "+quotePOSIX(scriptPath)+" "+quotePOSIX(payloadPath)+" 2>&1")
	if err != nil {
		return result, err
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &result); err != nil {
		return result, fmt.Errorf("invalid remote patch result: %w", err)
	}
	if result.SessionID == "" {
		result.SessionID = sessionID
	}
	result.Handler = mcpserver.EditHandlerPython3AtomicPatch
	result.Capabilities = capabilities
	return result, nil
}

func (e mcpRemoteEditExecutor) runCommand(sessionID string, command string) (string, error) {
	if e.app == nil || e.app.sshManager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	client, _, err := e.app.sshManager.getClientEntry(sessionID)
	if err != nil {
		return "", err
	}
	return e.app.sshManager.executeCmdWithClient(client, command)
}

func (e mcpRemoteEditExecutor) uploadTempText(sessionID string, suffix string, content string, mode os.FileMode) (string, error) {
	if e.app == nil || e.app.sshManager == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	sftpClient, err := e.app.sshManager.getSFTPClient(sessionID)
	if err != nil {
		return "", err
	}
	path := "/tmp/lumin_mcp_" + newCommandExecutionToken() + suffix
	file, err := sftpClient.Create(path)
	if err != nil {
		return "", err
	}
	if _, err := file.Write([]byte(content)); err != nil {
		file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if err := sftpClient.Chmod(path, mode); err != nil {
		return "", err
	}
	return path, nil
}

func (e mcpRemoteEditExecutor) removeTempFile(sessionID string, path string) {
	if e.app == nil || e.app.sshManager == nil || strings.TrimSpace(path) == "" {
		return
	}
	sftpClient, err := e.app.sshManager.getSFTPClient(sessionID)
	if err != nil {
		return
	}
	_ = sftpClient.Remove(path)
}