package localopen

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenDocumentAndRevealValidatePaths(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "document.txt")
	if err := os.WriteFile(file, []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := cleanExistingPath(file); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"", filepath.Join(dir, "missing")} {
		if _, _, err := cleanExistingPath(path); err == nil {
			t.Fatalf("path %q was accepted", path)
		}
	}
}

func TestRevealDirectoryDetection(t *testing.T) {
	dir := t.TempDir()
	cleaned, info, err := cleanExistingPath(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != filepath.Clean(dir) || !info.IsDir() {
		t.Fatalf("unexpected directory result: %q, %+v", cleaned, info)
	}
}
