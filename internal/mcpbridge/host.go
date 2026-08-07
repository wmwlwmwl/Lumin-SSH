package mcpbridge

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"luminssh-go/internal/config"
	mcp "luminssh-go/internal/mcp"
	"luminssh-go/internal/mcpserver"
	"luminssh-go/internal/sshmanager"

	"golang.org/x/crypto/ssh"
)

// Host bridges SSHManager / ConfigManager to the mcp.Host interface.
// ponytail: 从 package main 的 mcp_bridge.go 迁移而来。
// 原始 mcpHost 直接持有 *App；此处改为持有具体依赖，由 package main 通过 NewHost 注入。
// 升级路径：逐步让 App 直接引用 mcpbridge.Host，最终删除 mcp_bridge.go 中的 newMCPHost。
var _ mcp.Host = Host{}

type Host struct {
	sshMgr      *sshmanager.SSHManager
	configMgr   *config.ConfigManager
	workspaceFn func() string
	regKey      any
}

func NewHost(sshMgr *sshmanager.SSHManager, configMgr *config.ConfigManager, workspaceFn func() string, regKey any) Host {
	return Host{
		sshMgr:      sshMgr,
		configMgr:   configMgr,
		workspaceFn: workspaceFn,
		regKey:      regKey,
	}
}

func (h Host) RegistryKey() any {
	return h.regKey
}

func (h Host) GetWorkspaceState() string {
	if h.workspaceFn == nil {
		return ""
	}
	return h.workspaceFn()
}

func (h Host) ListSessionDescriptors() ([]mcpserver.SessionDescriptor, error) {
	if h.sshMgr == nil {
		return []mcpserver.SessionDescriptor{}, nil
	}
	sessionMap, sftpAvail := h.sshMgr.SnapshotSessionsAndSftpAvailability()

	connectionMap := make(map[string]config.Connection)
	if h.configMgr != nil {
		for _, connection := range h.configMgr.GetConnections() {
			if connection.ID != "" {
				connectionMap[connection.ID] = connection
			}
			connectionMap[connection.Username+"@"+sshmanager.DialAddr(connection.Host, connection.Port)] = connection
		}
	}

	result := make([]mcpserver.SessionDescriptor, 0, len(sessionMap))
	for sessionID, sessionData := range sessionMap {
		if sessionData == nil {
			continue
		}
		descriptor := mcpserver.SessionDescriptor{
			SessionID:      sessionID,
			GroupSessionID: sessionData.GroupSessionId,
			ConnectionRef:  sessionData.ConnKey,
			ConnectionID:   sessionData.ConnKey,
		}
		if sftpAvail[sessionData.ConnKey] {
			descriptor.SFTPAvailable = true
		}
		if connection, ok := connectionMap[sessionData.ConnKey]; ok {
			descriptor.ConnectionID = connection.ID
			descriptor.Tags = buildSessionTags(connection)
		}
		result = append(result, descriptor)
	}
	return result, nil
}

func (h Host) ExecuteCommandInTerminalControlled(sessionID string, command string, purpose string, isMutating bool, cwd string, shellType string, timeout time.Duration) (mcpserver.CommandExecutionResult, error) {
	if h.sshMgr == nil {
		return mcpserver.CommandExecutionResult{}, fmt.Errorf("ssh manager unavailable")
	}
	result, _, err := h.sshMgr.ExecuteCommandInTerminalControlled(sessionID, command, purpose, isMutating, cwd, shellType, timeout, nil, nil, nil, nil, nil)
	return result, err
}

func (h Host) ListDirectoryContext(ctx context.Context, sessionID string, remotePath string) ([]map[string]interface{}, error) {
	if h.sshMgr == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	if client, _, err := h.sshMgr.GetClientEntry(sessionID); err == nil && client != nil {
		return h.shellListDirectory(ctx, client, remotePath)
	}
	return h.sshMgr.ListDirContext(ctx, sessionID, remotePath)
}

func (h Host) ReadTextFileContext(ctx context.Context, sessionID string, remotePath string) (string, error) {
	if h.sshMgr == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	if client, _, err := h.sshMgr.GetClientEntry(sessionID); err == nil && client != nil {
		return h.runShellCommandLong(ctx, client, "cat -- "+sshmanager.ShellQuotePath(remotePath))
	}
	return h.sshMgr.ReadFileContext(ctx, sessionID, remotePath)
}

func (h Host) WriteTextFileContext(ctx context.Context, sessionID string, remotePath string, content string) error {
	if h.sshMgr == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.sshMgr.WriteFileContext(ctx, sessionID, remotePath, content)
}

func (h Host) DeleteItemContext(ctx context.Context, sessionID string, remotePath string, isDir bool) error {
	if h.sshMgr == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.sshMgr.DeleteItemContext(ctx, sessionID, remotePath, isDir)
}

func (h Host) CopyItemContext(ctx context.Context, sessionID string, srcPath string, dstPath string) error {
	if h.sshMgr == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.sshMgr.CopyItemContext(ctx, sessionID, srcPath, dstPath)
}

func (h Host) MoveItemContext(ctx context.Context, sessionID string, srcPath string, dstPath string) error {
	if h.sshMgr == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.sshMgr.MoveItemContext(ctx, sessionID, srcPath, dstPath)
}

func (h Host) MkdirContext(ctx context.Context, sessionID string, remotePath string) error {
	if h.sshMgr == nil {
		return fmt.Errorf("ssh manager unavailable")
	}
	return h.sshMgr.MkdirContext(ctx, sessionID, remotePath)
}

func (h Host) TransferFileContext(ctx context.Context, sessionID string, request mcpserver.TransferFileRequest) (mcpserver.TransferTaskSnapshot, error) {
	if h.sshMgr == nil {
		return mcpserver.TransferTaskSnapshot{}, fmt.Errorf("ssh manager unavailable")
	}
	return h.sshMgr.TransferFileContext(ctx, sessionID, request)
}

func (h Host) ListTransfersContext(ctx context.Context, sessionID string) ([]mcpserver.TransferTaskSnapshot, error) {
	if h.sshMgr == nil {
		return nil, fmt.Errorf("ssh manager unavailable")
	}
	return h.sshMgr.ListTransfersContext(ctx, sessionID)
}

func (h Host) RunCommandContext(ctx context.Context, sessionID string, command string) (string, error) {
	if h.sshMgr == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	client, _, err := h.sshMgr.GetClientEntry(sessionID)
	if err != nil {
		return "", err
	}
	return h.sshMgr.ExecuteCmdWithClientContext(ctx, client, command)
}

func (h Host) UploadTempTextContext(ctx context.Context, sessionID string, suffix string, content string, mode os.FileMode) (string, error) {
	if h.sshMgr == nil {
		return "", fmt.Errorf("ssh manager unavailable")
	}
	sftpClient, err := h.sshMgr.GetSFTPClient(sessionID)
	if err != nil {
		return "", err
	}
	path := "/tmp/lumin_mcp_" + sshmanager.NewCommandExecutionToken() + suffix
	file, err := sftpClient.Create(path)
	if err != nil {
		return "", err
	}
	if err := sshmanager.WriteStringChunksWithContext(ctx, file, content); err != nil {
		file.Close()
		_ = sftpClient.Remove(path)
		return "", err
	}
	if err := file.Close(); err != nil {
		_ = sftpClient.Remove(path)
		return "", err
	}
	if err := sshmanager.EnsureContextActive(ctx); err != nil {
		_ = sftpClient.Remove(path)
		return "", err
	}
	if err := sftpClient.Chmod(path, mode); err != nil {
		_ = sftpClient.Remove(path)
		return "", err
	}
	return path, nil
}

func (h Host) RemoveFile(sessionID string, remotePath string) {
	if h.sshMgr == nil || strings.TrimSpace(remotePath) == "" {
		return
	}
	sftpClient, err := h.sshMgr.GetSFTPClient(sessionID)
	if err != nil {
		return
	}
	_ = sftpClient.Remove(remotePath)
}

// ─── helpers ───────────────────────────────────────────

func buildSessionTags(connection config.Connection) []string {
	tags := make([]string, 0, 3)
	if name := strings.TrimSpace(connection.Name); name != "" {
		tags = append(tags, name)
	}
	if group := strings.TrimSpace(connection.Group); group != "" && !containsSessionTag(tags, group) {
		tags = append(tags, group)
	}
	if osName := strings.TrimSpace(connection.Os); osName != "" && !containsSessionTag(tags, osName) {
		tags = append(tags, osName)
	}
	return tags
}

func containsSessionTag(tags []string, value string) bool {
	for _, tag := range tags {
		if tag == value {
			return true
		}
	}
	return false
}

func (h Host) runShellCommandLong(ctx context.Context, client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	return sshmanager.RunCommandWithSessionContext(ctx, session, command, sshmanager.RemoteCmdLongTimeout)
}

func (h Host) shellListDirectory(ctx context.Context, client *ssh.Client, remotePath string) ([]map[string]interface{}, error) {
	command := "cd " + sshmanager.ShellQuotePath(remotePath) + " && stat -c '%f\t%s\t%u\t%g\t%Y\t%n' -- .* * 2>/dev/null"
	output, err := h.runShellCommandLong(ctx, client, command)
	if err != nil {
		return nil, err
	}
	results := parseShellDirEntries(output)
	sort.Slice(results, func(i, j int) bool {
		iDir := results[i]["isDirectory"].(bool)
		jDir := results[j]["isDirectory"].(bool)
		if iDir != jDir {
			return iDir
		}
		return results[i]["name"].(string) < results[j]["name"].(string)
	})
	return results, nil
}

func parseShellDirEntries(output string) []map[string]interface{} {
	results := make([]map[string]interface{}, 0)
	for _, line := range strings.Split(output, "\n") {
		if line == "" {
			continue
		}
		fields := strings.SplitN(line, "\t", 6)
		if len(fields) < 6 {
			continue
		}
		name := fields[5]
		if name == "." || name == ".." || name == "" {
			continue
		}
		rawMode, parseErr := strconv.ParseUint(strings.TrimSpace(fields[0]), 16, 32)
		if parseErr != nil {
			continue
		}
		fileMode := unixRawModeToFileMode(uint32(rawMode))
		size, _ := strconv.ParseInt(strings.TrimSpace(fields[1]), 10, 64)
		modifyTime := ""
		if epoch, timeErr := strconv.ParseInt(strings.TrimSpace(fields[4]), 10, 64); timeErr == nil {
			modifyTime = time.Unix(epoch, 0).Format(time.RFC3339)
		}
		results = append(results, map[string]interface{}{
			"name":        name,
			"isDirectory": fileMode.IsDir(),
			"size":        size,
			"modifyTime":  modifyTime,
			"permission":  fileMode.String(),
			"mode":        fmt.Sprintf("%o", fileMode.Perm()),
			"uid":         strings.TrimSpace(fields[2]),
			"gid":         strings.TrimSpace(fields[3]),
		})
	}
	return results
}

func unixRawModeToFileMode(raw uint32) os.FileMode {
	const (
		cIFMT   = 0xf000
		cIFSOCK = 0xc000
		cIFLNK  = 0xa000
		cIFREG  = 0x8000
		cIFBLK  = 0x6000
		cIFDIR  = 0x4000
		cIFCHR  = 0x2000
		cIFIFO  = 0x1000
		cISUID  = 0x800
		cISGID  = 0x400
		cISVTX  = 0x200
	)
	mode := os.FileMode(raw & 0777)
	switch raw & cIFMT {
	case cIFBLK:
		mode |= os.ModeDevice
	case cIFCHR:
		mode |= os.ModeDevice | os.ModeCharDevice
	case cIFDIR:
		mode |= os.ModeDir
	case cIFIFO:
		mode |= os.ModeNamedPipe
	case cIFLNK:
		mode |= os.ModeSymlink
	case cIFSOCK:
		mode |= os.ModeSocket
	}
	if raw&cISUID != 0 {
		mode |= os.ModeSetuid
	}
	if raw&cISGID != 0 {
		mode |= os.ModeSetgid
	}
	if raw&cISVTX != 0 {
		mode |= os.ModeSticky
	}
	return mode
}
