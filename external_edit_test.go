package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExternalEditKey(t *testing.T) {
	a := externalEditKey("s1", "/tmp/a.txt")
	b := externalEditKey("s1", "/tmp/a.txt")
	c := externalEditKey("s2", "/tmp/a.txt")
	if a != b {
		t.Fatalf("expected same key")
	}
	if a == c {
		t.Fatalf("expected different keys across sessions")
	}
}

func TestHashBytesStable(t *testing.T) {
	h1 := hashBytes([]byte("hello"))
	h2 := hashBytes([]byte("hello"))
	h3 := hashBytes([]byte("world"))
	if h1 != h2 {
		t.Fatalf("hash should be stable")
	}
	if h1 == h3 {
		t.Fatalf("different content should differ")
	}
}

func TestLocalPathForKeepsBasename(t *testing.T) {
	app := NewApp()
	m := NewExternalEditManager(app)
	path, err := m.localPathFor("sess-1", "/var/log/nginx.conf")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "nginx.conf" {
		t.Fatalf("basename = %s", filepath.Base(path))
	}
	if _, err := os.Stat(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	}
}
