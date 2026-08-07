package transfer

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDownloadConflictOptionsDefaultsAndPromptFallback(t *testing.T) {
	defaults := ParseDownloadConflictOptions("")
	if defaults.StrategyFor(".") != DownloadConflictStrategyAutoRename {
		t.Fatalf("default strategy = %q", defaults.StrategyFor("."))
	}
	prompt := ParseDownloadConflictOptions(`{"strategy":"prompt"}`)
	if prompt.StrategyFor(".") != DownloadConflictStrategyAutoRename {
		t.Fatalf("prompt fallback = %q", prompt.StrategyFor("."))
	}
	override := ParseDownloadConflictOptions(`{"strategy":"force_overwrite","pathStrategies":{"child.txt":"diff_overwrite"}}`)
	if override.StrategyFor("child.txt") != DownloadConflictStrategyDiffOverwrite {
		t.Fatalf("path strategy = %q", override.StrategyFor("child.txt"))
	}
}

func TestDownloadFilesDifferentUsesSecondPrecision(t *testing.T) {
	dir := t.TempDir()
	leftPath := filepath.Join(dir, "left")
	rightPath := filepath.Join(dir, "right")
	if err := os.WriteFile(leftPath, []byte("same"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rightPath, []byte("same"), 0o600); err != nil {
		t.Fatal(err)
	}
	base := time.Unix(1_700_000_000, 100)
	if err := os.Chtimes(leftPath, base, base); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(rightPath, base.Add(500*time.Millisecond), base.Add(500*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	left, _ := os.Stat(leftPath)
	right, _ := os.Stat(rightPath)
	if AreDownloadFilesDifferent(left, right, ParseDownloadConflictOptions(`{"strategy":"diff_overwrite"}`)) {
		t.Fatal("sub-second mtime difference was treated as a conflict")
	}
}

func TestBuildDownloadRenamedPathSequence(t *testing.T) {
	dir := t.TempDir()
	original := filepath.Join(dir, "report.txt")
	if err := os.WriteFile(filepath.Join(dir, "report_1.txt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := BuildDownloadRenamedPath(original, "sequence", false)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dir, "report_2.txt")
	if got != want {
		t.Fatalf("renamed path = %q, want %q", got, want)
	}
}

func TestApplyDownloadedDirectoryUsesPathStrategy(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source")
	target := filepath.Join(dir, "target")
	if err := os.MkdirAll(filepath.Join(source, "keep"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "keep", "new.txt"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "keep"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	options := ParseDownloadConflictOptions(`{"strategy":"force_overwrite","pathStrategies":{"keep":"auto_rename"}}`)
	if _, err := ApplyDownloadedDirectoryFromSource(source, target, options); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(filepath.Join(target, "keep"))
	if err != nil {
		t.Fatal(err)
	}
	if string(original) != "old" {
		t.Fatalf("original content = %q", original)
	}
	renamed, err := os.ReadFile(filepath.Join(target, "keep_1", "new.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(renamed) != "new" {
		t.Fatalf("renamed content = %q", renamed)
	}
}
