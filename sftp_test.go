package main

import (
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func testSFTPHostKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ssh.NewPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestSFTPPasswordChallengeAnswersEveryPrompt(t *testing.T) {
	answers, err := sftpPasswordChallenge("secret")("user", "", []string{"Password:", "Verification:"}, []bool{false, false})
	if err != nil {
		t.Fatal(err)
	}
	if len(answers) != 2 || answers[0] != "secret" || answers[1] != "secret" {
		t.Fatalf("unexpected keyboard-interactive answers: %#v", answers)
	}
}

func TestBuildSFTPPasswordConfigOffersInteractiveAndPassword(t *testing.T) {
	config, err := buildSSHConfigWithHostKeyCallback("user", "secret", "password", "", "", ssh.InsecureIgnoreHostKey())
	if err != nil {
		t.Fatal(err)
	}
	if len(config.Auth) != 2 {
		t.Fatalf("password authentication should offer keyboard-interactive and password, got %d methods", len(config.Auth))
	}
	if strings.Join(config.HostKeyAlgorithms, ",") != strings.Join(sshHostKeyAlgorithms, ",") {
		t.Fatalf("SFTP and normal SSH must use the same host-key algorithm order: %#v", config.HostKeyAlgorithms)
	}
}

func TestSFTPHostKeyCallbackTOFUAndMismatch(t *testing.T) {
	knownHostsPath := filepath.Join(t.TempDir(), "known_hosts")
	keyA := testSFTPHostKey(t)
	keyB := testSFTPHostKey(t)
	hostname := "[example.com]:2222"
	remote := &net.TCPAddr{}

	if err := sftpHostKeyCallbackForPath(knownHostsPath, "", nil)(hostname, remote, keyA); err != nil {
		t.Fatalf("first-use key should be accepted: %v", err)
	}
	data, err := os.ReadFile(knownHostsPath)
	if err != nil {
		t.Fatal(err)
	}
	if count := strings.Count(string(data), "\n"); count != 1 {
		t.Fatalf("first-use key should be appended once, got %d lines", count)
	}
	if err := sftpHostKeyCallbackForPath(knownHostsPath, "", nil)(hostname, remote, keyA); err != nil {
		t.Fatalf("stored key should be accepted: %v", err)
	}

	observation := &sftpHostKeyObservation{}
	mismatchErr := sftpHostKeyCallbackForPath(knownHostsPath, "", observation)(hostname, remote, keyB)
	if mismatchErr == nil {
		t.Fatal("changed key should be rejected before approval")
	}
	if reason, ok := syncTrustFailureReason(mismatchErr); !ok || reason != "sftp_host_key_changed" {
		t.Fatalf("changed key should be classified as a trust failure: %v", mismatchErr)
	}
	var keyErr *knownhosts.KeyError
	if !errors.As(mismatchErr, &keyErr) {
		t.Fatal("trust wrapper should preserve the knownhosts error")
	}
	if observation.key == nil || ssh.FingerprintSHA256(observation.key) != ssh.FingerprintSHA256(keyB) {
		t.Fatal("changed key should be captured for confirmation")
	}
	after, err := os.ReadFile(knownHostsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(data) {
		t.Fatal("mismatch detection must not modify known_hosts")
	}
}

func TestSFTPApprovedFingerprintIsPinned(t *testing.T) {
	knownHostsPath := filepath.Join(t.TempDir(), "known_hosts")
	keyA := testSFTPHostKey(t)
	keyB := testSFTPHostKey(t)
	keyC := testSFTPHostKey(t)
	hostname := "example.com:22"
	remote := &net.TCPAddr{}

	if err := os.WriteFile(knownHostsPath, []byte(knownhosts.Line([]string{knownhosts.Normalize(hostname)}, keyA)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	approved := ssh.FingerprintSHA256(keyB)
	if err := sftpHostKeyCallbackForPath(knownHostsPath, approved, &sftpHostKeyObservation{})(hostname, remote, keyB); err != nil {
		t.Fatalf("approved exact key should be accepted for retry: %v", err)
	}
	if err := sftpHostKeyCallbackForPath(knownHostsPath, approved, &sftpHostKeyObservation{})(hostname, remote, keyC); err == nil {
		t.Fatal("a different key must not inherit approval")
	}
}

func TestReplaceSFTPKnownHostKeyPreservesUnrelatedEntries(t *testing.T) {
	knownHostsPath := filepath.Join(t.TempDir(), "known_hosts")
	keyA := testSFTPHostKey(t)
	keyB := testSFTPHostKey(t)
	otherKey := testSFTPHostKey(t)
	hostname := "example.com:22"
	otherHostname := "other.example.com:22"
	original := "# keep this comment\n" +
		knownhosts.Line([]string{knownhosts.Normalize(hostname)}, keyA) + "\n" +
		knownhosts.Line([]string{knownhosts.Normalize(otherHostname)}, otherKey) + "\n"
	if err := os.WriteFile(knownHostsPath, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}

	observation := &sftpHostKeyObservation{}
	if err := sftpHostKeyCallbackForPath(knownHostsPath, "", observation)(hostname, &net.TCPAddr{}, keyB); err == nil {
		t.Fatal("changed key should require approval")
	}
	if err := replaceSFTPKnownHostKey(knownHostsPath, observation); err != nil {
		t.Fatalf("replace approved host key: %v", err)
	}

	data, err := os.ReadFile(knownHostsPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "# keep this comment") || !strings.Contains(text, knownhosts.Line([]string{knownhosts.Normalize(otherHostname)}, otherKey)) {
		t.Fatal("unrelated known_hosts content was not preserved")
	}
	cb, err := knownhosts.New(knownHostsPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := cb(hostname, &net.TCPAddr{}, keyB); err != nil {
		t.Fatalf("replacement key should be trusted: %v", err)
	}
	if err := cb(hostname, &net.TCPAddr{}, keyA); err == nil {
		t.Fatal("old key should no longer be trusted for replaced host")
	}
}

func TestReplaceSFTPKnownHostKeyRejectsMultiHostLine(t *testing.T) {
	knownHostsPath := filepath.Join(t.TempDir(), "known_hosts")
	keyA := testSFTPHostKey(t)
	keyB := testSFTPHostKey(t)
	hostname := "example.com:22"
	line := knownhosts.Line([]string{knownhosts.Normalize(hostname), "alias.example.com"}, keyA) + "\n"
	if err := os.WriteFile(knownHostsPath, []byte(line), 0600); err != nil {
		t.Fatal(err)
	}
	observation := &sftpHostKeyObservation{}
	if err := sftpHostKeyCallbackForPath(knownHostsPath, "", observation)(hostname, &net.TCPAddr{}, keyB); err == nil {
		t.Fatal("changed key should require approval")
	}
	if err := replaceSFTPKnownHostKey(knownHostsPath, observation); err == nil {
		t.Fatal("multi-host entries should require manual remediation")
	}
	data, err := os.ReadFile(knownHostsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != line {
		t.Fatal("unsafe entry must remain unchanged")
	}
}
