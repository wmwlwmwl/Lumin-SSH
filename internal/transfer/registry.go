package transfer

import (
	"context"
	"fmt"
	"sync"
	"time"
)

const defaultHistoryLimit = 100

type taskState struct {
	id        string
	sessionID string
	kind      string
	cancel    context.CancelFunc
	startedAt time.Time
	finished  bool
}

type taskRecord struct {
	ID         string
	SessionID  string
	Kind       string
	StartedAt  time.Time
	FinishedAt time.Time
}

type taskRegistry struct {
	mu           sync.Mutex
	active       map[string]*taskState
	history      []taskRecord
	historyLimit int
}

func newTaskRegistry(historyLimit int) *taskRegistry {
	if historyLimit <= 0 {
		historyLimit = defaultHistoryLimit
	}
	return &taskRegistry{
		active:       make(map[string]*taskState),
		historyLimit: historyLimit,
	}
}

func (r *taskRegistry) register(id, sessionID, kind string, cancel context.CancelFunc) error {
	if id == "" {
		return fmt.Errorf("transfer task id is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.active[id]; exists {
		return fmt.Errorf("transfer task already exists: %s", id)
	}
	r.active[id] = &taskState{
		id:        id,
		sessionID: sessionID,
		kind:      kind,
		cancel:    cancel,
		startedAt: time.Now(),
	}
	return nil
}

func (r *taskRegistry) finish(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	task, ok := r.active[id]
	if !ok || task.finished {
		return false
	}
	task.finished = true
	delete(r.active, id)
	r.history = append(r.history, taskRecord{
		ID:         task.id,
		SessionID:  task.sessionID,
		Kind:       task.kind,
		StartedAt:  task.startedAt,
		FinishedAt: time.Now(),
	})
	if overflow := len(r.history) - r.historyLimit; overflow > 0 {
		copy(r.history, r.history[overflow:])
		r.history = r.history[:r.historyLimit]
	}
	return true
}

func (r *taskRegistry) cancelTask(id string) bool {
	r.mu.Lock()
	task, ok := r.active[id]
	if ok {
		delete(r.active, id)
		task.finished = true
		r.history = append(r.history, taskRecord{
			ID:         task.id,
			SessionID:  task.sessionID,
			Kind:       task.kind,
			StartedAt:  task.startedAt,
			FinishedAt: time.Now(),
		})
		if overflow := len(r.history) - r.historyLimit; overflow > 0 {
			copy(r.history, r.history[overflow:])
			r.history = r.history[:r.historyLimit]
		}
	}
	r.mu.Unlock()
	if ok && task.cancel != nil {
		task.cancel()
	}
	return ok
}

func (r *taskRegistry) cancelSession(sessionID string) int {
	r.mu.Lock()
	ids := make([]string, 0)
	for id, task := range r.active {
		if task.sessionID == sessionID {
			ids = append(ids, id)
		}
	}
	r.mu.Unlock()
	for _, id := range ids {
		r.cancelTask(id)
	}
	return len(ids)
}

func (r *taskRegistry) close() {
	r.mu.Lock()
	ids := make([]string, 0, len(r.active))
	for id := range r.active {
		ids = append(ids, id)
	}
	r.mu.Unlock()
	for _, id := range ids {
		r.cancelTask(id)
	}
}
