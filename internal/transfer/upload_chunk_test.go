package transfer

import (
	"testing"
	"time"
)

func TestSanitizeUploadRelativePath(t *testing.T) {
	valid, err := sanitizeUploadRelativePath("nested/file.txt")
	if err != nil || valid != "nested/file.txt" {
		t.Fatalf("valid path = %q, error = %v", valid, err)
	}
	for _, invalid := range []string{"", "/absolute", "../escape", "nested/../escape", "nested//file"} {
		if _, err := sanitizeUploadRelativePath(invalid); err == nil {
			t.Fatalf("invalid path %q was accepted", invalid)
		}
	}
}

func TestSFTPUploadPoolCloseWakesWaiter(t *testing.T) {
	pool := newSFTPUploadPool(nil, 1, DefaultTuning())
	pool.mu.Lock()
	pool.created = 1
	pool.mu.Unlock()

	result := make(chan error, 1)
	go func() {
		_, err := pool.Acquire()
		result <- err
	}()
	time.Sleep(20 * time.Millisecond)
	pool.Close()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("waiting acquire succeeded after close")
		}
	case <-time.After(time.Second):
		t.Fatal("waiting acquire was not woken by close")
	}
}
