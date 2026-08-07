package localsftp

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestServerLoopbackFileOperationsAndClose(t *testing.T) {
	root := t.TempDir()
	mapper := func(sftpPath string) string {
		return filepath.Join(root, filepath.FromSlash(sftpPath))
	}
	server, sshClient, client, err := Start(mapper, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sshClient.Close()
	defer client.Close()
	defer server.Close()

	address, ok := server.Addr().(*net.TCPAddr)
	if !ok || !address.IP.IsLoopback() {
		t.Fatalf("listener address = %v, want loopback", server.Addr())
	}
	if err := client.MkdirAll("/nested"); err != nil {
		t.Fatal(err)
	}
	file, err := client.Create("/nested/file.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("content")); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := client.Rename("/nested/file.txt", "/nested/renamed.txt"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(root, "nested", "renamed.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "content" {
		t.Fatalf("content = %q", content)
	}
	if err := server.Close(); err != nil && !isClosedNetworkError(err) {
		t.Fatal(err)
	}
	if err := server.Close(); err != nil && !isClosedNetworkError(err) {
		t.Fatal(err)
	}
}

func isClosedNetworkError(err error) bool {
	return err == net.ErrClosed
}
