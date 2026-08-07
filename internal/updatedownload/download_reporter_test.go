package updatedownload

import (
	"sync"
	"testing"
	"time"
)

func TestProgressReporterStopsBeforeFinalEmit(t *testing.T) {
	var mu sync.Mutex
	var progress []float64
	reporter := newProgressReporter(100, func(value float64) {
		mu.Lock()
		progress = append(progress, value)
		mu.Unlock()
	})
	reporter.Start()
	reporter.Add(50)
	reporter.Stop(false)

	mu.Lock()
	before := len(progress)
	mu.Unlock()
	time.Sleep(250 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(progress) != before {
		t.Fatalf("progress callback after Stop: before=%d after=%d", before, len(progress))
	}
}
