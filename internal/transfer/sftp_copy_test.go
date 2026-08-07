package transfer

import "testing"

func TestSFTPRelPath(t *testing.T) {
	tests := []struct {
		name    string
		root    string
		full    string
		want    string
		wantErr bool
	}{
		{name: "root", root: "/home/user", full: "/home/user", want: ""},
		{name: "child", root: "/home/user/", full: "/home/user/docs/file.txt", want: "docs/file.txt"},
		{name: "sibling prefix", root: "/home/user", full: "/home/username/file.txt", wantErr: true},
		{name: "parent", root: "/home/user", full: "/home", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := sftpRelPath(test.root, test.full)
			if (err != nil) != test.wantErr {
				t.Fatalf("sftpRelPath() error = %v, wantErr %v", err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("sftpRelPath() = %q, want %q", got, test.want)
			}
		})
	}
}
