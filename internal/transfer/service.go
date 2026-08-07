package transfer

import "sync"

type Service struct {
	backend  SessionBackend
	sink     ProgressSink
	registry *taskRegistry

	tuningMu sync.RWMutex
	tuning   Tuning

	chunkMu    sync.Mutex
	chunkTasks map[string]*chunkedUploadTask

	compressedTasks sync.Map
	compressedSlots sync.Map
	downloadTasks   sync.Map
	mcpStore        *mcpTransferStore
}

func NewService(backend SessionBackend, sink ProgressSink) *Service {
	if sink == nil {
		sink = nopProgressSink{}
	}
	return &Service{
		backend:    backend,
		sink:       sink,
		registry:   newTaskRegistry(defaultHistoryLimit),
		tuning:     DefaultTuning(),
		chunkTasks: make(map[string]*chunkedUploadTask),
		mcpStore:   newMCPTransferStore(),
	}
}

func (s *Service) SetTuning(settings Tuning) {
	if s == nil {
		return
	}
	s.tuningMu.Lock()
	s.tuning = NormalizeTuning(settings)
	s.tuningMu.Unlock()
}

func (s *Service) Tuning() Tuning {
	if s == nil {
		return DefaultTuning()
	}
	s.tuningMu.RLock()
	settings := s.tuning
	s.tuningMu.RUnlock()
	return settings
}

func (s *Service) CancelSession(sessionID string) {
	if s == nil {
		return
	}
	s.registry.cancelSession(sessionID)
	s.chunkMu.Lock()
	taskIDs := make([]string, 0)
	for taskID, task := range s.chunkTasks {
		if task != nil && task.sessionId == sessionID {
			taskIDs = append(taskIDs, taskID)
		}
	}
	s.chunkMu.Unlock()
	for _, taskID := range taskIDs {
		_ = s.AbortChunkedUploadTask(taskID)
	}
	_ = s.AbortDownloadTransfer(sessionID)
	_ = s.AbortCompressedUpload(sessionID)
	s.mcpStore.cancelSession(sessionID)
}

func (s *Service) Close() {
	if s == nil {
		return
	}
	s.registry.close()
	s.chunkMu.Lock()
	taskIDs := make([]string, 0, len(s.chunkTasks))
	for taskID := range s.chunkTasks {
		taskIDs = append(taskIDs, taskID)
	}
	s.chunkMu.Unlock()
	for _, taskID := range taskIDs {
		_ = s.AbortChunkedUploadTask(taskID)
	}
	s.downloadTasks.Range(func(key, value any) bool {
		downloadID, _ := key.(string)
		task, _ := value.(*downloadTransferTask)
		s.abortDownloadTransferTaskByID(downloadID, task)
		return true
	})
	s.compressedTasks.Range(func(key, value any) bool {
		uploadID, _ := key.(string)
		task, _ := value.(*compressedUploadTask)
		s.abortCompressedUploadTaskByID(uploadID, task)
		return true
	})
	s.mcpStore.cancelAll()
}
