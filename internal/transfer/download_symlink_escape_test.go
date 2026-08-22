package transfer

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"
)

// 验证符号链接逃逸被拦截：链接目标指向解压目录外时应报错
func TestExtractTarGzSymlinkEscapeRejected(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "out")
	archive := filepath.Join(dir, "evil.tar.gz")
	if err := writeEscapingSymlinkArchive(archive); err != nil {
		t.Fatalf("make archive: %v", err)
	}
	err := extractTarGzArchive(context.Background(), archive, dest)
	if err == nil {
		t.Fatal("expected error for escaping symlink, got nil")
	}
	// 链接指向目录外，不应被创建
	if _, statErr := os.Lstat(filepath.Join(dest, "link")); statErr == nil {
		t.Fatal("symlink should not have been created")
	}
}

// 写入一个包含逃逸符号链接的 tar.gz：link -> ../evil_outside
func writeEscapingSymlinkArchive(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()
	hdr := &tar.Header{
		Typeflag: tar.TypeSymlink,
		Name:     "link",
		Linkname: "../../evil_outside",
	}
	return tw.WriteHeader(hdr)
}