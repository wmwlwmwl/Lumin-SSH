package main

import (
	"context"
	"io"
	"time"

	"luminssh-go/internal/sshmanager"

	"golang.org/x/crypto/ssh"
)

// ─── type alias：ssh 簇导出类型 ───────────────────────────
// ponytail: ssh 簇迁移到 internal/sshmanager 后，用 type alias 让 package main
// 零修改引用所有类型。alias 是同一类型，方法 receiver 自动穿透。
// 升级路径：逐步将各文件改为直接引用 sshmanager.XxxType，最终删除本文件。

type (
	SSHManager              = sshmanager.SSHManager
	SessionData             = sshmanager.SessionData
	PendingHostKey          = sshmanager.PendingHostKey
	OwnershipCandidates     = sshmanager.OwnershipCandidates
	OwnershipCandidateEntry = sshmanager.OwnershipCandidateEntry
	PathOwnershipInfo       = sshmanager.PathOwnershipInfo
	PortForwardInfo         = sshmanager.PortForwardInfo
)

// ─── 变量别名 ──────────────────────────────────────────

var (
	ErrHostKeyChanged = sshmanager.ErrHostKeyChanged
	ErrAuthFailed     = sshmanager.ErrAuthFailed
)

// ─── 构造函数 ────────────────────────────────────────────

func NewSSHManager() *SSHManager {
	return sshmanager.NewSSHManager()
}

// ─── 自由函数 wrapper ─────────────────────────────────────

func dialAddr(host string, port int) string {
	return sshmanager.DialAddr(host, port)
}

func shellQuotePath(path string) string {
	return sshmanager.ShellQuotePath(path)
}

func newCommandExecutionToken() string {
	return sshmanager.NewCommandExecutionToken()
}

func writeStringChunksWithContext(ctx context.Context, writer io.Writer, content string) error {
	return sshmanager.WriteStringChunksWithContext(ctx, writer, content)
}

func ensureContextActive(ctx context.Context) error {
	return sshmanager.EnsureContextActive(ctx)
}

func runCommandWithSessionContext(ctx context.Context, session *ssh.Session, cmd string, timeout time.Duration) (string, error) {
	return sshmanager.RunCommandWithSessionContext(ctx, session, cmd, timeout)
}

var remoteCmdLongTimeout = sshmanager.RemoteCmdLongTimeout
