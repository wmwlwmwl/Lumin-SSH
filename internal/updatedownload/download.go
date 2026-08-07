package updatedownload

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const maxConcurrency = 8
const minChunkSize int64 = 1 << 20
const readBufferSize = 1 << 20
const rangePartMaxAttempts = 3
const overallTimeout = 10 * time.Minute
const dialTimeout = 15 * time.Second
const headerTimeout = 30 * time.Second

type Progress func(float64)

type Downloader struct {
	Client   *http.Client
	Progress Progress
}

type byteRange struct {
	start int64
	end   int64
}

type progressReporter struct {
	total       int64
	current     atomic.Int64
	progress    Progress
	done        chan struct{}
	finished    chan struct{}
	stopOnce    sync.Once
	emitMu      sync.Mutex
	lastEmitted float64
}

func NewHTTPClient() *http.Client {
	return &http.Client{
		Timeout: overallTimeout,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   dialTimeout,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSNextProto:          map[string]func(authority string, c *tls.Conn) http.RoundTripper{},
			ForceAttemptHTTP2:     false,
			MaxIdleConns:          32,
			MaxIdleConnsPerHost:   16,
			MaxConnsPerHost:       16,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   dialTimeout,
			ResponseHeaderTimeout: headerTimeout,
			ExpectContinueTimeout: time.Second,
		},
	}
}

func (d Downloader) Download(ctx context.Context, downloadURL, targetPath string) error {
	client := d.Client
	if client == nil {
		client = NewHTTPClient()
	}

	source := SourceLabel(downloadURL)
	rangeErr := d.downloadMultiPart(client, ctx, downloadURL, targetPath)
	if rangeErr == nil {
		fmt.Printf("[UpdateApp] %s 多线程下载成功\n", source)
		return nil
	}

	_ = os.Remove(targetPath)
	fmt.Printf("[UpdateApp] %s 多线程失败，改单线程重试: %v\n", source, rangeErr)
	d.emit(0)
	singleErr := d.downloadSingleThread(client, ctx, downloadURL, targetPath)
	if singleErr == nil {
		fmt.Printf("[UpdateApp] %s 单线程下载成功\n", source)
		return nil
	}

	_ = os.Remove(targetPath)
	return fmt.Errorf("%s 多线程与单线程均失败: multi=%v; single=%w", source, rangeErr, singleErr)
}

func SourceLabel(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return raw
	}
	host := strings.ToLower(u.Hostname())
	if host == "github.com" || strings.HasSuffix(host, ".github.com") {
		return "GitHub直连"
	}
	return host
}

func normalizeContext(ctx context.Context) context.Context {
	if ctx != nil {
		return ctx
	}
	return context.Background()
}

func (d Downloader) emit(progress float64) {
	if d.Progress != nil {
		d.Progress(progress)
	}
}

func newProgressReporter(total int64, progress Progress) *progressReporter {
	return &progressReporter{
		total:    total,
		progress: progress,
		done:     make(chan struct{}),
		finished: make(chan struct{}),
	}
}

func (r *progressReporter) Start() {
	go func() {
		defer close(r.finished)
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				r.emit(false)
			case <-r.done:
				return
			}
		}
	}()
}

func (r *progressReporter) Add(n int64) {
	if n != 0 {
		r.current.Add(n)
	}
}

func (r *progressReporter) Stop(forceComplete bool) {
	r.stopOnce.Do(func() {
		close(r.done)
		<-r.finished
		r.emit(forceComplete)
	})
}

func (r *progressReporter) emit(forceComplete bool) {
	if r.progress == nil {
		return
	}
	progress := float64(0)
	if forceComplete {
		progress = 100
	} else if r.total > 0 {
		progress = float64(r.current.Load()) / float64(r.total) * 100
		if progress > 100 {
			progress = 100
		}
	}
	r.emitMu.Lock()
	if progress < r.lastEmitted {
		progress = r.lastEmitted
	} else {
		r.lastEmitted = progress
	}
	r.progress(progress)
	r.emitMu.Unlock()
}

func buildByteRanges(totalSize int64, concurrencyLimit int) []byteRange {
	if totalSize <= 0 {
		return nil
	}
	concurrency := concurrencyLimit
	if concurrency < 1 {
		concurrency = 1
	}
	if totalSize < int64(concurrency)*minChunkSize {
		concurrency = int((totalSize + minChunkSize - 1) / minChunkSize)
		if concurrency < 1 {
			concurrency = 1
		}
		if concurrency > concurrencyLimit {
			concurrency = concurrencyLimit
		}
	}
	if totalSize < int64(concurrency) {
		concurrency = int(totalSize)
		if concurrency < 1 {
			concurrency = 1
		}
	}

	ranges := make([]byteRange, 0, concurrency)
	baseSize := totalSize / int64(concurrency)
	remainder := totalSize % int64(concurrency)
	start := int64(0)
	for i := 0; i < concurrency; i++ {
		size := baseSize
		if int64(i) < remainder {
			size++
		}
		if size <= 0 {
			continue
		}
		end := start + size - 1
		ranges = append(ranges, byteRange{start: start, end: end})
		start = end + 1
	}
	return ranges
}

func parseContentRange(header string, expectedStart, expectedEnd int64) (int64, error) {
	header = strings.TrimSpace(header)
	if len(header) < 6 || strings.ToLower(header[:6]) != "bytes " {
		return 0, fmt.Errorf("invalid content-range header: %q", header)
	}
	rangeParts := strings.SplitN(strings.TrimSpace(header[6:]), "/", 2)
	if len(rangeParts) != 2 || rangeParts[1] == "" || rangeParts[1] == "*" {
		return 0, fmt.Errorf("invalid content-range header: %q", header)
	}
	totalSize, err := strconv.ParseInt(rangeParts[1], 10, 64)
	if err != nil || totalSize <= 0 {
		return 0, fmt.Errorf("invalid content-range total: %q", header)
	}
	bounds := strings.SplitN(strings.TrimSpace(rangeParts[0]), "-", 2)
	if len(bounds) != 2 {
		return 0, fmt.Errorf("invalid content-range bounds: %q", header)
	}
	start, err := strconv.ParseInt(bounds[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid content-range start: %q", header)
	}
	end, err := strconv.ParseInt(bounds[1], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid content-range end: %q", header)
	}
	if start != expectedStart || end != expectedEnd {
		return 0, fmt.Errorf("unexpected content-range %d-%d for expected %d-%d", start, end, expectedStart, expectedEnd)
	}
	if end < start || end >= totalSize {
		return 0, fmt.Errorf("invalid content-range bounds: %q", header)
	}
	return totalSize, nil
}

func probeRangeDownload(client *http.Client, ctx context.Context, downloadURL string) (int64, error) {
	req, err := http.NewRequestWithContext(normalizeContext(ctx), http.MethodGet, downloadURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Range", "bytes=0-0")
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		return 0, fmt.Errorf("range request unsupported: status %d", resp.StatusCode)
	}
	return parseContentRange(resp.Header.Get("Content-Range"), 0, 0)
}

func downloadRangePart(ctx context.Context, client *http.Client, downloadURL string, file *os.File, totalSize int64, chunk byteRange, reporter *progressReporter) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", chunk.start, chunk.end))
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		return 0, fmt.Errorf("unexpected range status %d", resp.StatusCode)
	}
	reportedTotal, err := parseContentRange(resp.Header.Get("Content-Range"), chunk.start, chunk.end)
	if err != nil {
		return 0, err
	}
	if reportedTotal != totalSize {
		return 0, fmt.Errorf("unexpected content-range total %d", reportedTotal)
	}

	writeOffset := chunk.start
	remaining := chunk.end - chunk.start + 1
	var writtenTotal int64
	buf := make([]byte, readBufferSize)
	for remaining > 0 {
		if err := ctx.Err(); err != nil {
			return writtenTotal, err
		}
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if int64(n) > remaining {
				return writtenTotal, fmt.Errorf("range overflow: expected %d remaining, got %d", remaining, n)
			}
			written, writeErr := file.WriteAt(buf[:n], writeOffset)
			if writeErr != nil {
				return writtenTotal, writeErr
			}
			if written != n {
				return writtenTotal, io.ErrShortWrite
			}
			writeOffset += int64(n)
			remaining -= int64(n)
			writtenTotal += int64(n)
			reporter.Add(int64(n))
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return writtenTotal, readErr
		}
	}
	if remaining != 0 {
		return writtenTotal, fmt.Errorf("incomplete range download: %d bytes remaining", remaining)
	}
	return writtenTotal, nil
}

func downloadRangePartWithRetry(ctx context.Context, client *http.Client, downloadURL string, file *os.File, totalSize int64, chunk byteRange, reporter *progressReporter) error {
	var lastErr error
	for attempt := 1; attempt <= rangePartMaxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		written, err := downloadRangePart(ctx, client, downloadURL, file, totalSize, chunk, reporter)
		if err == nil {
			return nil
		}
		lastErr = err
		if written > 0 {
			reporter.Add(-written)
		}
		if attempt == rangePartMaxAttempts {
			break
		}
		timer := time.NewTimer(time.Duration(attempt) * 300 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return lastErr
}

func (d Downloader) downloadMultiPart(client *http.Client, ctx context.Context, downloadURL, targetPath string) error {
	totalSize, err := probeRangeDownload(client, ctx, downloadURL)
	if err != nil {
		return err
	}
	ranges := buildByteRanges(totalSize, maxConcurrency)
	if len(ranges) == 0 {
		return fmt.Errorf("invalid multipart ranges")
	}
	d.emit(0)
	file, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	if err := file.Truncate(totalSize); err != nil {
		_ = file.Close()
		_ = os.Remove(targetPath)
		return err
	}

	reporter := newProgressReporter(totalSize, d.Progress)
	reporter.Start()
	rangeCtx, cancel := context.WithCancel(normalizeContext(ctx))
	defer cancel()
	var wg sync.WaitGroup
	var firstErr error
	var firstErrOnce sync.Once
	for _, chunk := range ranges {
		chunk := chunk
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := downloadRangePartWithRetry(rangeCtx, client, downloadURL, file, totalSize, chunk, reporter); err != nil {
				firstErrOnce.Do(func() {
					firstErr = err
					cancel()
				})
			}
		}()
	}
	wg.Wait()
	closeErr := file.Close()
	if firstErr != nil {
		reporter.Stop(false)
		_ = os.Remove(targetPath)
		if closeErr != nil {
			return fmt.Errorf("%w: %v", firstErr, closeErr)
		}
		return firstErr
	}
	if closeErr != nil {
		reporter.Stop(false)
		_ = os.Remove(targetPath)
		return closeErr
	}
	reporter.Stop(true)
	return nil
}

func (d Downloader) downloadSingleThread(client *http.Client, ctx context.Context, downloadURL, targetPath string) error {
	d.emit(0)
	req, err := http.NewRequestWithContext(normalizeContext(ctx), http.MethodGet, downloadURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	out, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	reporter := newProgressReporter(resp.ContentLength, d.Progress)
	reporter.Start()
	reader := &countingReader{Reader: resp.Body, reporter: reporter}
	buf := make([]byte, readBufferSize)
	_, copyErr := io.CopyBuffer(out, reader, buf)
	closeErr := out.Close()
	if copyErr != nil {
		reporter.Stop(false)
		_ = os.Remove(targetPath)
		return copyErr
	}
	if closeErr != nil {
		reporter.Stop(false)
		_ = os.Remove(targetPath)
		return closeErr
	}
	reporter.Stop(true)
	return nil
}

type countingReader struct {
	io.Reader
	reporter *progressReporter
}

func (r *countingReader) Read(data []byte) (int, error) {
	n, err := r.Reader.Read(data)
	if n > 0 {
		r.reporter.Add(int64(n))
	}
	return n, err
}
