package platformupdate

import "testing"

func TestIsAllowedDownloadURL(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://github.com/wmwlwmwl/Lumin-SSH/releases/download/v1.2.0.1/Lumin-V1.2.0.1-portable.exe", true},
		{"https://ghproxy.net/https://github.com/wmwlwmwl/Lumin-SSH/releases/download/v1.2.0.1/x.exe", true},
		{"https://github.com/wmwlwmwl/Lumin-SSH/releases/tag/v1.2.0.1", false},
		{"https://github.com/wmwlwmwl/Lumin-SSH/releases/latest", false},
		{"https://github.com/wmwlwmwl/Lumin-SSH/releases/download/v1/x.exe.sha256", false},
		{"http://github.com/wmwlwmwl/Lumin-SSH/releases/download/v1/x.exe", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := IsAllowedDownloadURL(tc.url); got != tc.want {
			t.Fatalf("IsAllowedDownloadURL(%q)=%v want %v", tc.url, got, tc.want)
		}
	}
}

func TestIsAllowedFilename(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"Lumin-V1.2.0.1-portable.exe", true},
		{"Lumin-V1.2.0.1-amd64-installer.exe", true},
		{"pkg.deb", true},
		{"pkg.rpm", true},
		{"pkg.dmg", true},
		{"update.exe", true},
		{"x.exe.sha256", false},
		{"readme.txt", false},
		{"", false},
		{".", false},
		{"..", false},
	}
	for _, tc := range cases {
		if got := IsAllowedFilename(tc.name); got != tc.want {
			t.Fatalf("IsAllowedFilename(%q)=%v want %v", tc.name, got, tc.want)
		}
	}
}
