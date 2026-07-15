package main

import (
	"slices"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestHostKeyAlgorithmsForConnection(t *testing.T) {
	defaultAlgorithms := hostKeyAlgorithmsForConnection(Connection{})
	if slices.Contains(defaultAlgorithms, ssh.KeyAlgoRSA) {
		t.Fatal("默认连接不应启用旧版 ssh-rsa 主机密钥算法")
	}

	legacyAlgorithms := hostKeyAlgorithmsForConnection(Connection{AllowLegacySSHRSA: true})
	if legacyAlgorithms[len(legacyAlgorithms)-1] != ssh.KeyAlgoRSA {
		t.Fatalf("启用兼容选项后应在现代算法之后追加 ssh-rsa，实际为 %#v", legacyAlgorithms)
	}
	if slices.Contains(sshHostKeyAlgorithms, ssh.KeyAlgoRSA) {
		t.Fatal("单服务器兼容选项不应修改全局默认算法")
	}
}
