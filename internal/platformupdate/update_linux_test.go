//go:build linux

package platformupdate

import "testing"

func TestQuoteShellArg(t *testing.T) {
	got := quoteShellArg("a'b c")
	want := `'a'\''b c'`
	if got != want {
		t.Fatalf("quoteShellArg() = %q, want %q", got, want)
	}
}
