package programfonts

import "testing"

func TestMimeTypeAndSupport(t *testing.T) {
	cases := []struct {
		name string
		mime string
		ok   bool
	}{
		{"a.ttf", "font/ttf", true},
		{"A.OTF", "font/otf", true},
		{"x.woff2", "font/woff2", true},
		{"font.WOFF", "font/woff", true},
		{"noext", "", false},
		{"a.txt", "", false},
	}
	for _, c := range cases {
		if got := mimeType(c.name); got != c.mime {
			t.Errorf("mimeType(%q) = %q, want %q", c.name, got, c.mime)
		}
		if got := isSupportedFile(c.name); got != c.ok {
			t.Errorf("isSupportedFile(%q) = %v, want %v", c.name, got, c.ok)
		}
	}
}

func TestSanitizeFileName(t *testing.T) {
	// 防路径穿越：仅取末级文件名
	if got := sanitizeFileName("/etc/../pass/evil.ttf"); got != "evil.ttf" {
		t.Errorf("sanitizeFileName = %q, want %q", got, "evil.ttf")
	}
	if got := sanitizeFileName("  a.ttf  "); got != "a.ttf" {
		t.Errorf("sanitizeFileName = %q, want %q", got, "a.ttf")
	}
}
