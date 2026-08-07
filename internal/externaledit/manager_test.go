package externaledit

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

type fakeRemoteFiles struct {
	size int64
	data []byte
}

func (f *fakeRemoteFiles) Size(string, string) (int64, error) { return f.size, nil }
func (f *fakeRemoteFiles) Read(string, string) ([]byte, error) {
	return append([]byte(nil), f.data...), nil
}
func (f *fakeRemoteFiles) Write(string, string, []byte) error { return nil }

type fakeEventSink struct {
	mu     sync.Mutex
	events []string
}

func (s *fakeEventSink) Emit(event string, _ map[string]interface{}) {
	s.mu.Lock()
	s.events = append(s.events, event)
	s.mu.Unlock()
}

type fakeOpener struct{ opened string }

func (o *fakeOpener) OpenDefault(path string) error {
	o.opened = path
	return nil
}
func (o *fakeOpener) OpenWith(_ string, path string) error {
	o.opened = path
	return nil
}

func TestExternalEditKeyAndHash(t *testing.T) {
	if externalEditKey("s1", "/tmp/a.txt") != externalEditKey("s1", "/tmp/a.txt") {
		t.Fatal("same session and path produced different key")
	}
	if externalEditKey("s1", "/tmp/a.txt") == externalEditKey("s2", "/tmp/a.txt") {
		t.Fatal("different sessions produced same key")
	}
	if hashBytes([]byte("hello")) != hashBytes([]byte("hello")) || hashBytes([]byte("hello")) == hashBytes([]byte("world")) {
		t.Fatal("hash stability contract failed")
	}
}

func TestLocalPathForKeepsBasename(t *testing.T) {
	manager := NewManager(&fakeRemoteFiles{}, &fakeEventSink{}, &fakeOpener{})
	path, err := manager.localPathFor("sess-1", "/var/log/nginx.conf")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(filepath.Dir(path))
	if filepath.Base(path) != "nginx.conf" {
		t.Fatalf("basename = %s", filepath.Base(path))
	}
}

func TestReadOnlyOpenAndStop(t *testing.T) {
	remote := &fakeRemoteFiles{size: 4, data: []byte("test")}
	opener := &fakeOpener{}
	manager := NewManager(remote, &fakeEventSink{}, opener)
	payload, err := manager.Open("session", "/tmp/file.txt", "", "", true, 1024)
	if err != nil {
		t.Fatal(err)
	}
	localPath, _ := payload["localPath"].(string)
	if opener.opened != localPath {
		t.Fatalf("opened path = %q, want %q", opener.opened, localPath)
	}
	if err := manager.Stop("session", "/tmp/file.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(localPath); !os.IsNotExist(err) {
		t.Fatalf("temporary file still exists: %v", err)
	}
}

func TestOpenRejectsOversizedRemoteFile(t *testing.T) {
	manager := NewManager(&fakeRemoteFiles{size: 2048}, &fakeEventSink{}, &fakeOpener{})
	if _, err := manager.Open("session", "/tmp/file.txt", "", "", false, 1024); err == nil {
		t.Fatal("oversized remote file was accepted")
	}
}
