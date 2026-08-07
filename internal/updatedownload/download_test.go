package updatedownload

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewHTTPClientDisablesHTTP2(t *testing.T) {
	client := NewHTTPClient()
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatal("transport type mismatch")
	}
	if transport.ForceAttemptHTTP2 || transport.TLSNextProto == nil || len(transport.TLSNextProto) != 0 {
		t.Fatal("HTTP/2 should be disabled for parallel range requests")
	}
	if client.Timeout != overallTimeout || transport.ResponseHeaderTimeout != headerTimeout {
		t.Fatal("download timeouts changed")
	}
}

func TestBuildByteRangesRespectsMinimumChunk(t *testing.T) {
	if got := len(buildByteRanges(3<<20, 8)); got != 3 {
		t.Fatalf("3 MiB range count = %d", got)
	}
	if got := len(buildByteRanges(32<<20, 8)); got != 8 {
		t.Fatalf("32 MiB range count = %d", got)
	}
}

func TestParseContentRangeRejectsMismatch(t *testing.T) {
	if _, err := parseContentRange("bytes 0-0/10", 0, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := parseContentRange("bytes 1-2/10", 0, 1); err == nil {
		t.Fatal("expected range mismatch")
	}
	if _, err := parseContentRange("invalid", 0, 0); err == nil {
		t.Fatal("expected invalid header")
	}
}

func TestDownloaderMultiPartAndProgress(t *testing.T) {
	payload := bytes.Repeat([]byte("lumin-range-data-"), 160000)
	server := newRangeServer(t, payload, nil)
	defer server.Close()

	var mu sync.Mutex
	var progress []float64
	downloader := Downloader{
		Client: server.Client(),
		Progress: func(value float64) {
			mu.Lock()
			progress = append(progress, value)
			mu.Unlock()
		},
	}
	target := tempTarget(t)
	if err := downloader.Download(context.Background(), server.URL, target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("downloaded payload size = %d, want %d", len(got), len(payload))
	}

	mu.Lock()
	defer mu.Unlock()
	if len(progress) == 0 || progress[len(progress)-1] != 100 {
		t.Fatalf("progress = %#v", progress)
	}
	for i := 1; i < len(progress); i++ {
		if progress[i] < progress[i-1] {
			t.Fatalf("progress regressed: %#v", progress)
		}
	}
}

func TestDownloaderFallsBackWhenRangeUnsupported(t *testing.T) {
	payload := []byte("single-thread-fallback")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	target := tempTarget(t)
	if err := (Downloader{Client: server.Client()}).Download(context.Background(), server.URL, target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) || requests.Load() < 2 {
		t.Fatalf("fallback requests=%d payload=%q", requests.Load(), got)
	}
}

func TestRangePartRetriesAfterShortBody(t *testing.T) {
	payload := bytes.Repeat([]byte("retry-data"), 120000)
	var failed atomic.Bool
	server := newRangeServer(t, payload, func(start, end int64, w http.ResponseWriter) bool {
		if start == 0 && end > 0 && failed.CompareAndSwap(false, true) {
			shortEnd := start + (end-start)/2
			_, _ = w.Write(payload[start : shortEnd+1])
			return true
		}
		return false
	})
	defer server.Close()

	target := tempTarget(t)
	if err := (Downloader{Client: server.Client()}).downloadMultiPart(server.Client(), context.Background(), server.URL, target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) || !failed.Load() {
		t.Fatal("retry did not recover the complete payload")
	}
}

func TestDownloaderCancellationRemovesPartialFile(t *testing.T) {
	started := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(started) })
		<-r.Context().Done()
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	target := tempTarget(t)
	done := make(chan error, 1)
	go func() {
		done <- (Downloader{Client: server.Client()}).Download(ctx, server.URL, target)
	}()
	select {
	case <-started:
		cancel()
	case <-time.After(2 * time.Second):
		t.Fatal("request did not start")
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected cancellation error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("download did not stop after cancellation")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("partial target still exists: %v", err)
	}
}

func TestSourceLabel(t *testing.T) {
	if got := SourceLabel("https://github.com/org/repo/file"); got != "GitHub直连" {
		t.Fatalf("label = %q", got)
	}
	if got := SourceLabel("https://mirror.example/file"); got != "mirror.example" {
		t.Fatalf("label = %q", got)
	}
}

func tempTarget(t *testing.T) string {
	t.Helper()
	return t.TempDir() + string(os.PathSeparator) + "update.bin"
}

func newRangeServer(t *testing.T, payload []byte, intercept func(start, end int64, w http.ResponseWriter) bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Range")
		if header == "" {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			_, _ = w.Write(payload)
			return
		}
		start, end, err := parseRangeHeader(header, int64(len(payload)))
		if err != nil {
			http.Error(w, err.Error(), http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		if intercept != nil && intercept(start, end, w) {
			return
		}
		_, _ = w.Write(payload[start : end+1])
	}))
}

func parseRangeHeader(header string, total int64) (int64, int64, error) {
	value := strings.TrimPrefix(header, "bytes=")
	parts := strings.SplitN(value, "-", 2)
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid range")
	}
	start, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, 0, err
	}
	end, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, 0, err
	}
	if start < 0 || end < start || end >= total {
		return 0, 0, fmt.Errorf("range out of bounds")
	}
	return start, end, nil
}
