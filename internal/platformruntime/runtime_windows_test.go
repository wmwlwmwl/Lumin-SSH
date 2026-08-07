//go:build windows

package platformruntime

import (
	"syscall"
	"testing"
)

func TestPickBestCandidate(t *testing.T) {
	tests := []struct {
		name       string
		candidates []windowCandidate
		want       syscall.Handle
	}{
		{name: "empty"},
		{
			name: "visible beats earlier iconic",
			candidates: []windowCandidate{
				{handle: 1, visible: true, iconic: true},
				{handle: 2, visible: true},
			},
			want: 2,
		},
		{
			name: "iconic beats hidden",
			candidates: []windowCandidate{
				{handle: 3},
				{handle: 4, iconic: true},
			},
			want: 4,
		},
		{
			name: "first valid fallback",
			candidates: []windowCandidate{
				{},
				{handle: 5},
				{handle: 6},
			},
			want: 5,
		},
		{
			name: "first visible wins",
			candidates: []windowCandidate{
				{handle: 7, visible: true},
				{handle: 8, visible: true},
			},
			want: 7,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := pickBestCandidate(tt.candidates); got != tt.want {
				t.Fatalf("候选窗口 = %v，期望 %v", got, tt.want)
			}
		})
	}
}
