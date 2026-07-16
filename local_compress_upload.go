package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

type localArchiveStats struct {
	TotalBytes int64
	FileCount  int64
	DirCount   int64
}

type compressedUploadArchiveEntry struct {
	ArchivePath string
	LocalPath   string
	IsDir       bool
}

type compressedUploadPreflightIssue struct {
	Kind        string
	RemotePath  string
	ArchivePath string
	LocalPath   string
	Detail      string
	Suggestion  string
}

type compressedUploadPreflightReport struct {
	RemoteDir    string
	Issues       []compressedUploadPreflightIssue
	OmittedCount int
}

type compressedUploadRepairSnapshot struct {
	RemotePath   string
	IsDir        bool
	Existed      bool
	OriginalMode os.FileMode
	HadImmutable bool
}

type compressedUploadRepairState struct {
	sessionId string
	order     []string
	items     map[string]compressedUploadRepairSnapshot
}

func newCompressedUploadRepairState(sessionId string) *compressedUploadRepairState {
	return &compressedUploadRepairState{
		sessionId: sessionId,
		order:     make([]string, 0),
		items:     make(map[string]compressedUploadRepairSnapshot),
	}
}

func (state *compressedUploadRepairState) remember(snapshot compressedUploadRepairSnapshot) {
	if state == nil {
		return
	}
	if _, exists := state.items[snapshot.RemotePath]; exists {
		return
	}
	state.order = append(state.order, snapshot.RemotePath)
	state.items[snapshot.RemotePath] = snapshot
}

func (state *compressedUploadRepairState) restore(m *SSHManager) {
	if state == nil || m == nil || state.sessionId == "" {
		return
	}
	sftpClient, err := m.getSFTPClient(state.sessionId)
	if err != nil {
		return
	}
	for index := len(state.order) - 1; index >= 0; index-- {
		remotePath := state.order[index]
		snapshot, ok := state.items[remotePath]
		if !ok || !snapshot.Existed {
			continue
		}
		info, err := sftpClient.Stat(remotePath)
		if err != nil || info == nil || info.IsDir() != snapshot.IsDir {
			continue
		}
		_ = m.clearRemoteImmutableAttribute(state.sessionId, remotePath)
		_ = sftpClient.Chmod(remotePath, snapshot.OriginalMode)
		if snapshot.HadImmutable {
			_ = m.setRemoteImmutableAttribute(state.sessionId, remotePath, true)
		}
	}
}

func (report *compressedUploadPreflightReport) Error() string {
	if report == nil {
		return "compressed upload preflight failed"
	}
	var builder strings.Builder
	builder.WriteString("compressed upload preflight failed\n")
	if report.RemoteDir != "" {
		builder.WriteString("remote target: ")
		builder.WriteString(report.RemoteDir)
		builder.WriteByte('\n')
	}
	builder.WriteString("the remote server is unlikely to extract the uploaded archive successfully.\n")
	for index, issue := range report.Issues {
		fmt.Fprintf(&builder, "%d. [%s] %s\n", index+1, issue.Kind, issue.RemotePath)
		if issue.ArchivePath != "" {
			fmt.Fprintf(&builder, "   archive entry: %s\n", issue.ArchivePath)
		}
		if issue.LocalPath != "" {
			fmt.Fprintf(&builder, "   local source: %s\n", issue.LocalPath)
		}
		if issue.Detail != "" {
			fmt.Fprintf(&builder, "   reason: %s\n", issue.Detail)
		}
		if issue.Suggestion != "" {
			fmt.Fprintf(&builder, "   suggestion: %s\n", issue.Suggestion)
		}
	}
	if report.OmittedCount > 0 {
		fmt.Fprintf(&builder, "%d more issue(s) omitted.\n", report.OmittedCount)
	}
	return strings.TrimSpace(builder.String())
}

type compressedUploadTask struct {
	id        string
	sessionId string
	cancel    context.CancelFunc

	mu            sync.Mutex
	tempDir       string
	remoteArchive string
}

type compressedUploadSessionLimiter struct {
	mu     sync.Mutex
	active int
}

var compressedUploadTasks sync.Map // uploadId -> *compressedUploadTask
var compressedUploadSlots sync.Map // sessionId -> *compressedUploadSessionLimiter


func clampPercent(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func (task *compressedUploadTask) setTempDir(tempDir string) {
	task.mu.Lock()
	task.tempDir = tempDir
	task.mu.Unlock()
}

func (task *compressedUploadTask) clearTempDir() {
	task.mu.Lock()
	task.tempDir = ""
	task.mu.Unlock()
}

func (task *compressedUploadTask) setRemoteArchive(remoteArchive string) {
	task.mu.Lock()
	task.remoteArchive = remoteArchive
	task.mu.Unlock()
}

func (task *compressedUploadTask) clearRemoteArchive() {
	task.mu.Lock()
	task.remoteArchive = ""
	task.mu.Unlock()
}

func (task *compressedUploadTask) snapshot() (string, string) {
	task.mu.Lock()
	defer task.mu.Unlock()
	return task.tempDir, task.remoteArchive
}

func (task *compressedUploadTask) cleanup(m *SSHManager) {
	tempDir, remoteArchive := task.snapshot()
	if tempDir != "" {
		_ = os.RemoveAll(tempDir)
		task.clearTempDir()
	}
	if remoteArchive != "" {
		_ = m.DeleteItem(task.sessionId, remoteArchive, false)
		task.clearRemoteArchive()
	}
}

func getCompressedUploadSessionLimiter(sessionId string) *compressedUploadSessionLimiter {
	limiter, _ := compressedUploadSlots.LoadOrStore(sessionId, &compressedUploadSessionLimiter{})
	if typed, ok := limiter.(*compressedUploadSessionLimiter); ok && typed != nil {
		return typed
	}
	fallback := &compressedUploadSessionLimiter{}
	compressedUploadSlots.Store(sessionId, fallback)
	return fallback
}

func acquireCompressedUploadSlot(sessionId string, limit int, ctx context.Context) (*compressedUploadSessionLimiter, error) {
	if limit < 1 {
		limit = 1
	}
	limiter := getCompressedUploadSessionLimiter(sessionId)
	for {
		limiter.mu.Lock()
		if limiter.active < limit {
			limiter.active++
			limiter.mu.Unlock()
			return limiter, nil
		}
		limiter.mu.Unlock()

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
}

func releaseCompressedUploadSlot(limiter *compressedUploadSessionLimiter) {
	if limiter == nil {
		return
	}
	limiter.mu.Lock()
	if limiter.active > 0 {
		limiter.active--
	}
	limiter.mu.Unlock()
}

func registerCompressedUploadTask(uploadID string, task *compressedUploadTask) error {
	if uploadID == "" {
		return fmt.Errorf("missing upload id")
	}
	if _, loaded := compressedUploadTasks.LoadOrStore(uploadID, task); loaded {
		return fmt.Errorf("compressed upload already exists")
	}
	return nil
}

func unregisterCompressedUploadTask(uploadID string, task *compressedUploadTask) {
	if current, ok := compressedUploadTasks.Load(uploadID); ok && current == task {
		compressedUploadTasks.Delete(uploadID)
	}
}

func (m *SSHManager) abortCompressedUploadTaskByID(uploadID string, task *compressedUploadTask) {
	if task == nil {
		return
	}
	task.cancel()
	task.cleanup(m)
	if uploadID != "" {
		compressedUploadTasks.Delete(uploadID)
	}
}

func (m *SSHManager) AbortCompressedUpload(identifier string) error {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return fmt.Errorf("missing upload identifier")
	}

	if current, ok := compressedUploadTasks.Load(identifier); ok {
		task, _ := current.(*compressedUploadTask)
		m.abortCompressedUploadTaskByID(identifier, task)
		return nil
	}

	compressedUploadTasks.Range(func(key, value any) bool {
		uploadID, _ := key.(string)
		task, _ := value.(*compressedUploadTask)
		if task != nil && task.sessionId == identifier {
			m.abortCompressedUploadTaskByID(uploadID, task)
		}
		return true
	})
	return nil
}

func (m *SSHManager) emitCompressedUploadProgress(sessionId string, uploadID string, phase string, progress float64, phaseProgress float64, bytesDone int64, bytesTotal int64, current string, detail string) {
	updateMCPTransferFromCompressedUploadEvent(sessionId, uploadID, phase, progress, phaseProgress, bytesDone, bytesTotal, current, detail)
	if m.ctx == nil {
		return
	}
	runtime.EventsEmit(m.ctx, "compressed-upload-progress-"+sessionId, map[string]interface{}{
		"uploadId":      uploadID,
		"phase":         phase,
		"progress":      clampPercent(progress),
		"phaseProgress": clampPercent(phaseProgress),
		"bytesDone":     bytesDone,
		"bytesTotal":    bytesTotal,
		"current":       current,
		"detail":        detail,
	})
}

func collectLocalArchiveStats(localPaths []string) (localArchiveStats, error) {
	var stats localArchiveStats
	for _, localPath := range localPaths {
		cleanPath := strings.TrimSpace(localPath)
		if cleanPath == "" {
			continue
		}
		absPath, rootRealPath, info, err := resolveArchiveSourcePath(cleanPath)
		if err != nil {
			return stats, err
		}
		if err := collectLocalArchiveStatsForPath(absPath, rootRealPath, make(map[string]struct{}), &stats); err != nil {
			return stats, err
		}
		if !info.IsDir() {
			continue
		}
	}
	return stats, nil
}

func collectLocalArchiveEntries(localPaths []string) ([]compressedUploadArchiveEntry, error) {
	entries := make([]compressedUploadArchiveEntry, 0)
	for _, localPath := range localPaths {
		cleanPath := strings.TrimSpace(localPath)
		if cleanPath == "" {
			continue
		}
		absPath, rootRealPath, _, err := resolveArchiveSourcePath(cleanPath)
		if err != nil {
			return nil, err
		}
		if err := collectLocalArchiveEntriesForPath(absPath, filepath.Base(filepath.Clean(cleanPath)), rootRealPath, make(map[string]struct{}), &entries); err != nil {
			return nil, err
		}
	}
	return entries, nil
}

func collectLocalArchiveEntriesForPath(localPath string, archiveRoot string, rootRealPath string, stack map[string]struct{}, entries *[]compressedUploadArchiveEntry) error {
	_, realPath, info, err := resolveArchiveSourcePath(localPath)
	if err != nil {
		return err
	}
	if !isPathWithinRoot(rootRealPath, realPath) {
		return fmt.Errorf("link target escapes selected root: %s -> %s", localPath, realPath)
	}

	archiveRoot = cleanArchiveName(archiveRoot)
	if info.IsDir() {
		if _, exists := stack[realPath]; exists {
			return fmt.Errorf("cyclic link detected: %s -> %s", localPath, realPath)
		}
		stack[realPath] = struct{}{}
		defer delete(stack, realPath)

		*entries = append(*entries, compressedUploadArchiveEntry{
			ArchivePath: archiveRoot,
			LocalPath:   realPath,
			IsDir:       true,
		})

		dirEntries, err := os.ReadDir(realPath)
		if err != nil {
			return err
		}
		for _, dirEntry := range dirEntries {
			childPath := filepath.Join(realPath, dirEntry.Name())
			childArchiveName := filepath.ToSlash(filepath.Join(archiveRoot, dirEntry.Name()))
			if err := collectLocalArchiveEntriesForPath(childPath, childArchiveName, rootRealPath, stack, entries); err != nil {
				return err
			}
		}
		return nil
	}

	*entries = append(*entries, compressedUploadArchiveEntry{
		ArchivePath: archiveRoot,
		LocalPath:   realPath,
		IsDir:       false,
	})
	return nil
}

func cleanArchiveName(name string) string {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Trim(name, "/")
	if name == "" || name == "." || name == ".." {
		return "upload"
	}
	parts := strings.Split(name, "/")
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			continue
		}
		cleaned = append(cleaned, part)
	}
	if len(cleaned) == 0 {
		return "upload"
	}
	return strings.Join(cleaned, "/")
}

func ensureCompressedUploadContext(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func resolveArchiveSourcePath(localPath string) (string, string, os.FileInfo, error) {
	cleanPath := strings.TrimSpace(localPath)
	if cleanPath == "" {
		return "", "", nil, fmt.Errorf("empty local path")
	}

	absPath, err := filepath.Abs(cleanPath)
	if err != nil {
		return "", "", nil, err
	}

	realPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to resolve link target for %s: %w", absPath, err)
	}
	realPath, err = filepath.Abs(realPath)
	if err != nil {
		return "", "", nil, err
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return "", "", nil, err
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return "", "", nil, fmt.Errorf("unsupported file type: %s (%s)", absPath, info.Mode().String())
	}
	return absPath, realPath, info, nil
}

func isPathWithinRoot(rootRealPath string, targetRealPath string) bool {
	rel, err := filepath.Rel(rootRealPath, targetRealPath)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func collectLocalArchiveStatsForPath(localPath string, rootRealPath string, stack map[string]struct{}, stats *localArchiveStats) error {
	_, realPath, info, err := resolveArchiveSourcePath(localPath)
	if err != nil {
		return err
	}
	if !isPathWithinRoot(rootRealPath, realPath) {
		return fmt.Errorf("link target escapes selected root: %s -> %s", localPath, realPath)
	}

	if info.IsDir() {
		if _, exists := stack[realPath]; exists {
			return fmt.Errorf("cyclic link detected: %s -> %s", localPath, realPath)
		}
		stack[realPath] = struct{}{}
		defer delete(stack, realPath)

		stats.DirCount++
		entries, err := os.ReadDir(realPath)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := collectLocalArchiveStatsForPath(filepath.Join(realPath, entry.Name()), rootRealPath, stack, stats); err != nil {
				return err
			}
		}
		return nil
	}

	stats.FileCount++
	stats.TotalBytes += info.Size()
	return nil
}

func writeArchiveHeader(tw *tar.Writer, archiveName string, info os.FileInfo) error {
	header, err := tar.FileInfoHeader(info, "")
	if err != nil {
		return err
	}
	header.Name = cleanArchiveName(archiveName)
	if info.IsDir() && !strings.HasSuffix(header.Name, "/") {
		header.Name += "/"
	}
	return tw.WriteHeader(header)
}

func addRegularFileToTar(ctx context.Context, tw *tar.Writer, realPath string, archiveName string, info os.FileInfo, onProgress func(int64, string)) error {
	if err := ensureCompressedUploadContext(ctx); err != nil {
		return err
	}
	if err := writeArchiveHeader(tw, archiveName, info); err != nil {
		return err
	}

	file, err := os.Open(realPath)
	if err != nil {
		return err
	}
	defer file.Close()

	buf := make([]byte, 1024*1024)
	for {
		if err := ensureCompressedUploadContext(ctx); err != nil {
			return err
		}
		n, readErr := file.Read(buf)
		if n > 0 {
			if _, err := tw.Write(buf[:n]); err != nil {
				return err
			}
			if onProgress != nil {
				onProgress(int64(n), realPath)
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func addPathToTar(ctx context.Context, tw *tar.Writer, localPath string, archiveRoot string, rootRealPath string, stack map[string]struct{}, onProgress func(int64, string)) error {
	if err := ensureCompressedUploadContext(ctx); err != nil {
		return err
	}

	_, realPath, info, err := resolveArchiveSourcePath(localPath)
	if err != nil {
		return err
	}
	if !isPathWithinRoot(rootRealPath, realPath) {
		return fmt.Errorf("link target escapes selected root: %s -> %s", localPath, realPath)
	}

	archiveRoot = cleanArchiveName(archiveRoot)
	if info.IsDir() {
		if _, exists := stack[realPath]; exists {
			return fmt.Errorf("cyclic link detected: %s -> %s", localPath, realPath)
		}
		stack[realPath] = struct{}{}
		defer delete(stack, realPath)

		if err := writeArchiveHeader(tw, archiveRoot, info); err != nil {
			return err
		}

		entries, err := os.ReadDir(realPath)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			childPath := filepath.Join(realPath, entry.Name())
			childArchiveName := filepath.ToSlash(filepath.Join(archiveRoot, entry.Name()))
			if err := addPathToTar(ctx, tw, childPath, childArchiveName, rootRealPath, stack, onProgress); err != nil {
				return err
			}
		}
		return nil
	}

	return addRegularFileToTar(ctx, tw, realPath, archiveRoot, info, onProgress)
}

func createLocalTarGz(ctx context.Context, localPaths []string, stats localArchiveStats, onProgress func(int64, int64, string)) (string, string, error) {
	if len(localPaths) == 0 {
		return "", "", fmt.Errorf("no local paths")
	}
	tempDir, err := os.MkdirTemp("", "lumin-upload-*")
	if err != nil {
		return "", "", err
	}
	archiveName := fmt.Sprintf("lumin_upload_%d.tar.gz", time.Now().UnixNano())
	archivePath := filepath.Join(tempDir, archiveName)
	file, err := os.Create(archivePath)
	if err != nil {
		_ = os.RemoveAll(tempDir)
		return "", "", err
	}

	var processedBytes int64
	lastEmit := time.Time{}
	emit := func(current string, force bool) {
		if onProgress == nil {
			return
		}
		now := time.Now()
		if force || now.Sub(lastEmit) > 200*time.Millisecond || processedBytes >= stats.TotalBytes {
			onProgress(processedBytes, stats.TotalBytes, current)
			lastEmit = now
		}
	}
	onBytes := func(n int64, current string) {
		processedBytes += n
		if stats.TotalBytes > 0 && processedBytes > stats.TotalBytes {
			processedBytes = stats.TotalBytes
		}
		emit(current, false)
	}

	gw := gzip.NewWriter(file)
	tw := tar.NewWriter(gw)
	emit("", true)
	for _, localPath := range localPaths {
		if err := ensureCompressedUploadContext(ctx); err != nil {
			_ = tw.Close()
			_ = gw.Close()
			_ = file.Close()
			_ = os.RemoveAll(tempDir)
			return "", "", err
		}
		cleanPath := strings.TrimSpace(localPath)
		if cleanPath == "" {
			continue
		}
		absPath, rootRealPath, _, err := resolveArchiveSourcePath(cleanPath)
		if err != nil {
			_ = tw.Close()
			_ = gw.Close()
			_ = file.Close()
			_ = os.RemoveAll(tempDir)
			return "", "", err
		}
		if err := addPathToTar(ctx, tw, absPath, filepath.Base(filepath.Clean(cleanPath)), rootRealPath, make(map[string]struct{}), onBytes); err != nil {
			_ = tw.Close()
			_ = gw.Close()
			_ = file.Close()
			_ = os.RemoveAll(tempDir)
			return "", "", err
		}
		emit(cleanPath, true)
	}
	if stats.TotalBytes == 0 {
		emit("", true)
	}
	if err := tw.Close(); err != nil {
		_ = gw.Close()
		_ = file.Close()
		_ = os.RemoveAll(tempDir)
		return "", "", err
	}
	if err := gw.Close(); err != nil {
		_ = file.Close()
		_ = os.RemoveAll(tempDir)
		return "", "", err
	}
	if err := file.Close(); err != nil {
		_ = os.RemoveAll(tempDir)
		return "", "", err
	}
	if onProgress != nil {
		onProgress(stats.TotalBytes, stats.TotalBytes, "")
	}
	return archivePath, tempDir, nil
}

func normalizeRemotePathForCompare(remotePath string) string {
	normalized := filepath.ToSlash(filepath.Clean(strings.ReplaceAll(strings.TrimSpace(remotePath), "\\", "/")))
	if normalized == "." {
		return "/"
	}
	if strings.HasPrefix(strings.TrimSpace(remotePath), "/") && !strings.HasPrefix(normalized, "/") {
		return "/" + strings.TrimPrefix(normalized, "/")
	}
	return normalized
}

func joinRemoteUploadPath(remoteDir string, archivePath string) string {
	base := strings.ReplaceAll(strings.TrimSpace(remoteDir), "\\", "/")
	if base == "" {
		base = "/"
	}
	joined := filepath.ToSlash(filepath.Clean(filepath.Join(base, filepath.FromSlash(cleanArchiveName(archivePath)))))
	if strings.HasPrefix(base, "/") && !strings.HasPrefix(joined, "/") {
		return "/" + strings.TrimPrefix(joined, "/")
	}
	return joined
}

func hasFailedRemoteAncestor(failedDirs map[string]struct{}, remotePath string) bool {
	normalizedPath := normalizeRemotePathForCompare(remotePath)
	for dirPath := range failedDirs {
		if normalizedPath == dirPath || strings.HasPrefix(normalizedPath, dirPath+"/") {
			return true
		}
	}
	return false
}

func isRemotePathNotExist(err error) bool {
	if err == nil {
		return false
	}
	if os.IsNotExist(err) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such file") || strings.Contains(message, "does not exist") || strings.Contains(message, "not found")
}

func bestEffortRemoteChmod(sftpClient *sftp.Client, remotePath string, mode os.FileMode) {
	if sftpClient == nil {
		return
	}
	_ = sftpClient.Chmod(remotePath, mode)
}

func probeRemoteDirectoryWritable(sftpClient *sftp.Client, remotePath string) error {
	probeName := fmt.Sprintf(".lumin_write_probe_%d", time.Now().UnixNano())
	probePath := joinRemoteUploadPath(remotePath, probeName)
	probeFile, err := sftpClient.Create(probePath)
	if err != nil {
		return err
	}
	if err := probeFile.Close(); err != nil {
		_ = sftpClient.Remove(probePath)
		return err
	}
	return sftpClient.Remove(probePath)
}

func probeRemoteFileOverwriteable(sftpClient *sftp.Client, remotePath string) error {
	probeFile, err := sftpClient.OpenFile(remotePath, os.O_WRONLY)
	if err != nil {
		return err
	}
	return probeFile.Close()
}

func (m *SSHManager) readRemoteAttrOutput(sessionId string, remotePath string) string {
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return ""
	}
	output, err := m.executeCmdWithClient(client, "lsattr -d -- "+shellQuotePath(remotePath)+" 2>/dev/null || true")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(output)
}

func remoteAttrOutputHasImmutable(output string) bool {
	fields := strings.Fields(strings.TrimSpace(output))
	return len(fields) > 0 && strings.Contains(fields[0], "i")
}

func (m *SSHManager) bestEffortDescribeRemoteMutationFailure(sessionId string, remotePath string) string {
	output := m.readRemoteAttrOutput(sessionId, remotePath)
	if output == "" {
		return ""
	}
	if remoteAttrOutputHasImmutable(output) {
		return "immutable attribute detected: " + output
	}
	return "remote attributes: " + output
}

func (m *SSHManager) setRemoteImmutableAttribute(sessionId string, remotePath string, immutable bool) error {
	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	flag := "-i"
	if immutable {
		flag = "+i"
	}
	_, err = m.executeCmdWithClient(client, "chattr "+flag+" -- "+shellQuotePath(remotePath))
	return err
}

func (m *SSHManager) clearRemoteImmutableAttribute(sessionId string, remotePath string) error {
	return m.setRemoteImmutableAttribute(sessionId, remotePath, false)
}

func (m *SSHManager) snapshotCompressedUploadRepairState(sessionId string, sftpClient *sftp.Client, remotePath string, isDir bool) compressedUploadRepairSnapshot {
	snapshot := compressedUploadRepairSnapshot{
		RemotePath:   remotePath,
		IsDir:        isDir,
		Existed:      false,
		OriginalMode: 0,
		HadImmutable: remoteAttrOutputHasImmutable(m.readRemoteAttrOutput(sessionId, remotePath)),
	}
	info, err := sftpClient.Stat(remotePath)
	if err == nil && info != nil && info.IsDir() == isDir {
		snapshot.Existed = true
		snapshot.OriginalMode = info.Mode()
	}
	return snapshot
}

func (m *SSHManager) bestEffortRepairRemoteDirectory(sessionId string, sftpClient *sftp.Client, remotePath string) {
	normalizedPath := normalizeRemotePathForCompare(remotePath)
	if normalizedPath == "" {
		return
	}
	info, err := sftpClient.Stat(normalizedPath)
	if err != nil && isRemotePathNotExist(err) {
		parentPath := normalizeRemotePathForCompare(filepath.Dir(normalizedPath))
		if parentPath != "" && parentPath != "." && parentPath != normalizedPath {
			_ = m.clearRemoteImmutableAttribute(sessionId, parentPath)
			bestEffortRemoteChmod(sftpClient, parentPath, 0o755)
		}
		_ = sftpClient.MkdirAll(normalizedPath)
		info, err = sftpClient.Stat(normalizedPath)
	}
	if err != nil || info == nil || !info.IsDir() {
		return
	}
	_ = m.clearRemoteImmutableAttribute(sessionId, normalizedPath)
	bestEffortRemoteChmod(sftpClient, normalizedPath, 0o755)
	_ = probeRemoteDirectoryWritable(sftpClient, normalizedPath)
}

func (m *SSHManager) bestEffortRepairRemoteFile(sessionId string, sftpClient *sftp.Client, remotePath string) {
	normalizedPath := normalizeRemotePathForCompare(remotePath)
	if normalizedPath == "" {
		return
	}
	info, err := sftpClient.Stat(normalizedPath)
	if err != nil || info == nil || info.IsDir() {
		return
	}
	_ = m.clearRemoteImmutableAttribute(sessionId, normalizedPath)
	bestEffortRemoteChmod(sftpClient, normalizedPath, 0o644)
	_ = probeRemoteFileOverwriteable(sftpClient, normalizedPath)
}

func (m *SSHManager) autoRepairCompressedUploadTargets(sessionId string, remoteDir string, entries []compressedUploadArchiveEntry) (*compressedUploadRepairState, error) {
	if len(entries) == 0 {
		return nil, nil
	}
	sftpClient, err := m.getSFTPClient(sessionId)
	if err != nil {
		return nil, err
	}

	repairState := newCompressedUploadRepairState(sessionId)
	checkedPaths := make(map[string]struct{})
	for _, entry := range entries {
		remotePath := joinRemoteUploadPath(remoteDir, entry.ArchivePath)
		if _, exists := checkedPaths[remotePath]; exists {
			continue
		}
		checkedPaths[remotePath] = struct{}{}
		repairState.remember(m.snapshotCompressedUploadRepairState(sessionId, sftpClient, remotePath, entry.IsDir))
		if entry.IsDir {
			m.bestEffortRepairRemoteDirectory(sessionId, sftpClient, remotePath)
			continue
		}
		m.bestEffortRepairRemoteFile(sessionId, sftpClient, remotePath)
	}

	ctx := context.WithValue(context.Background(), "compressedUploadSessionId", sessionId)
	if err := m.preflightCompressedUploadTargets(ctx, sessionId, remoteDir, entries, nil); err != nil {
		repairState.restore(m)
		return nil, err
	}
	return repairState, nil
}

func (m *SSHManager) AutoRepairCompressedUploadTargets(sessionId string, localPaths []string, remoteDir string) error {
	paths := make([]string, 0, len(localPaths))
	for _, localPath := range localPaths {
		localPath = strings.TrimSpace(localPath)
		if localPath != "" {
			paths = append(paths, localPath)
		}
	}
	if len(paths) == 0 {
		return fmt.Errorf("no local paths")
	}

	entries, err := collectLocalArchiveEntries(paths)
	if err != nil {
		return err
	}
	repairState, err := m.autoRepairCompressedUploadTargets(sessionId, remoteDir, entries)
	if repairState != nil {
		repairState.restore(m)
	}
	return err
}

func (m *SSHManager) preflightCompressedUploadTargets(ctx context.Context, sessionId string, remoteDir string, entries []compressedUploadArchiveEntry, onProgress func(int, int, string, string)) error {
	if len(entries) == 0 {
		return nil
	}
	sftpClient, err := m.getSFTPClient(sessionId)
	if err != nil {
		return err
	}

	report := &compressedUploadPreflightReport{
		RemoteDir: normalizeRemotePathForCompare(remoteDir),
	}
	const maxIssues = 25
	failedDirs := make(map[string]struct{})
	checkedPaths := make(map[string]struct{})
	addIssue := func(entry compressedUploadArchiveEntry, remotePath string, kind string, cause error, suggestion string) {
		detail := ""
		if cause != nil {
			detail = cause.Error()
		}
		if diagnosis := m.bestEffortDescribeRemoteMutationFailure(sessionId, remotePath); diagnosis != "" {
			if detail != "" {
				detail += "; "
			}
			detail += diagnosis
		}
		issue := compressedUploadPreflightIssue{
			Kind:        kind,
			RemotePath:  remotePath,
			ArchivePath: cleanArchiveName(entry.ArchivePath),
			LocalPath:   entry.LocalPath,
			Detail:      detail,
			Suggestion:  suggestion,
		}
		if len(report.Issues) < maxIssues {
			report.Issues = append(report.Issues, issue)
			return
		}
		report.OmittedCount++
	}

	totalEntries := len(entries)
	for index, entry := range entries {
		if err := ensureCompressedUploadContext(ctx); err != nil {
			return err
		}
		remotePath := joinRemoteUploadPath(remoteDir, entry.ArchivePath)
		if _, exists := checkedPaths[remotePath]; exists {
			continue
		}
		checkedPaths[remotePath] = struct{}{}
		if hasFailedRemoteAncestor(failedDirs, remotePath) {
			continue
		}

		progressDetail := "checking directory writability"
		if !entry.IsDir {
			progressDetail = "checking existing file overwriteability"
		}
		if onProgress != nil {
			onProgress(index, totalEntries, remotePath, progressDetail)
		}

		if entry.IsDir {
			info, statErr := sftpClient.Stat(remotePath)
			if statErr != nil {
				if isRemotePathNotExist(statErr) {
					if mkdirErr := sftpClient.MkdirAll(remotePath); mkdirErr != nil {
						addIssue(entry, remotePath, "directory-create", mkdirErr, "ensure the current SSH user can create this directory before retrying.")
						failedDirs[remotePath] = struct{}{}
						continue
					}
					info, statErr = sftpClient.Stat(remotePath)
				}
				if statErr != nil {
					addIssue(entry, remotePath, "directory-stat", statErr, "check whether the directory exists and is accessible to the current SSH user.")
					failedDirs[remotePath] = struct{}{}
					continue
				}
			}
			if !info.IsDir() {
				addIssue(entry, remotePath, "directory-type-conflict", fmt.Errorf("remote path already exists as a file"), "rename or remove the conflicting remote file before retrying.")
				failedDirs[remotePath] = struct{}{}
				continue
			}
			bestEffortRemoteChmod(sftpClient, remotePath, 0o755)
			if probeErr := probeRemoteDirectoryWritable(sftpClient, remotePath); probeErr != nil {
				addIssue(entry, remotePath, "directory-write-probe", probeErr, "ensure the current SSH user can create and remove files in this directory, and remove immutable or readonly protection if present.")
				failedDirs[remotePath] = struct{}{}
			}
			continue
		}

		parentDir := normalizeRemotePathForCompare(filepath.Dir(remotePath))
		if hasFailedRemoteAncestor(failedDirs, parentDir) {
			continue
		}

		info, statErr := sftpClient.Stat(remotePath)
		if statErr != nil {
			if isRemotePathNotExist(statErr) {
				continue
			}
			addIssue(entry, remotePath, "file-stat", statErr, "check whether the existing remote file is accessible to the current SSH user.")
			continue
		}
		if info.IsDir() {
			addIssue(entry, remotePath, "file-type-conflict", fmt.Errorf("remote path already exists as a directory"), "rename or remove the conflicting remote directory before retrying.")
			continue
		}
		bestEffortRemoteChmod(sftpClient, remotePath, 0o644)
		if probeErr := probeRemoteFileOverwriteable(sftpClient, remotePath); probeErr != nil {
			addIssue(entry, remotePath, "file-overwrite-probe", probeErr, "ensure the current SSH user can reopen and overwrite this file, and remove immutable or readonly protection if present.")
		}
	}

	if onProgress != nil {
		onProgress(totalEntries, totalEntries, "", "remote preflight completed")
	}
	if len(report.Issues) > 0 {
		return report
	}
	return nil
}

func (m *SSHManager) uploadLocalFileWithContext(ctx context.Context, sshClient *ssh.Client, maxConcurrent int, localPath string, remoteDir string, onProgress func(int64, int64)) error {
	src, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer src.Close()

	var totalSize int64
	if stat, statErr := src.Stat(); statErr == nil {
		totalSize = stat.Size()
	}

	destPath := filepath.ToSlash(filepath.Join(remoteDir, filepath.Base(localPath)))
	tempPath := destPath + ".luminpart." + newUploadObjectID("upload_file")

	pool := newSFTPUploadPool(sshClient, maxConcurrent)
	defer pool.Close()

	// Pre-create remote temp file
	{
		client, err := pool.Acquire()
		if err != nil {
			return err
		}
		handle, openErr := client.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC)
		pool.Release(client)
		if openErr != nil {
			return openErr
		}
		_ = handle.Close()
	}

	removeTemp := true
	defer func() {
		if !removeTemp {
			return
		}
		if client, err := pool.Acquire(); err == nil {
			_ = client.Remove(tempPath)
			pool.Release(client)
		}
	}()

	chunkSize := int64(256 * 1024) // 256KB chunks (matches frontend UI chunk size for smooth progress updates)
	totalChunks := int64(0)
	if totalSize > 0 {
		totalChunks = (totalSize + chunkSize - 1) / chunkSize
	}

	workerCount := maxConcurrent
	if workerCount < 1 {
		workerCount = 1
	}
	if totalChunks > 0 && workerCount > int(totalChunks) {
		workerCount = int(totalChunks)
	}

	type chunkJob struct {
		offset int64
		length int64
	}

	jobs := make(chan chunkJob, totalChunks)
	for i := int64(0); i < totalChunks; i++ {
		offset := i * chunkSize
		length := chunkSize
		if offset+length > totalSize {
			length = totalSize - offset
		}
		jobs <- chunkJob{offset: offset, length: length}
	}
	close(jobs)

	var uploaded int64
	var firstErr error
	var errMu sync.Mutex
	setErr := func(e error) {
		if e == nil {
			return
		}
		errMu.Lock()
		if firstErr == nil {
			firstErr = e
		}
		errMu.Unlock()
	}

	var wg sync.WaitGroup
	workerCtx, workerCancel := context.WithCancel(ctx)
	defer workerCancel()

	lastEmit := time.Now()
	var emitMu sync.Mutex
	maybeEmit := func(done int64, force bool) {
		if onProgress == nil {
			return
		}
		emitMu.Lock()
		defer emitMu.Unlock()
		now := time.Now()
		if force || now.Sub(lastEmit) > 200*time.Millisecond || done >= totalSize {
			lastEmit = now
			onProgress(done, totalSize)
		}
	}

	for w := 0; w < workerCount; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			client, err := pool.Acquire()
			if err != nil {
				setErr(err)
				workerCancel()
				return
			}
			defer pool.Release(client)

			handle, openErr := client.OpenFile(tempPath, os.O_WRONLY)
			if openErr != nil {
				setErr(openErr)
				workerCancel()
				return
			}
			defer handle.Close()

			buf := make([]byte, chunkSize)
			for {
				select {
				case <-workerCtx.Done():
					return
				case job, ok := <-jobs:
					if !ok {
						return
					}
					// Check error
					errMu.Lock()
					hasErr := firstErr != nil
					errMu.Unlock()
					if hasErr {
						return
					}

					// Read chunk
					n, readErr := src.ReadAt(buf[:job.length], job.offset)
					if readErr != nil && readErr != io.EOF {
						setErr(readErr)
						workerCancel()
						return
					}
					if n != int(job.length) {
						setErr(fmt.Errorf("short read at offset %d: %d/%d", job.offset, n, job.length))
						workerCancel()
						return
					}

					// Write chunk using worker's persistent file handle
					written, writeErr := handle.WriteAt(buf[:job.length], job.offset)
					if writeErr != nil {
						setErr(writeErr)
						workerCancel()
						return
					}
					if written != int(job.length) {
						setErr(io.ErrShortWrite)
						workerCancel()
						return
					}

					newUploaded := atomic.AddInt64(&uploaded, job.length)
					maybeEmit(newUploaded, false)
				}
			}
		}()
	}

	wg.Wait()

	if firstErr != nil {
		return firstErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	maybeEmit(totalSize, true)

	// Complete by truncating and renaming
	{
		client, err := pool.Acquire()
		if err != nil {
			return err
		}
		finishErr := func() error {
			handle, openErr := client.OpenFile(tempPath, os.O_WRONLY)
			if openErr != nil {
				return openErr
			}
			truncateErr := handle.Truncate(totalSize)
			closeErr := handle.Close()
			if truncateErr != nil {
				return truncateErr
			}
			if closeErr != nil {
				return closeErr
			}
			if err := client.PosixRename(tempPath, destPath); err != nil {
				return client.Rename(tempPath, destPath)
			}
			return nil
		}()
		pool.Release(client)
		if finishErr != nil {
			return finishErr
		}
	}

	removeTemp = false
	return nil
}

func (m *SSHManager) uploadLocalFileChunkedWithContext(ctx context.Context, sessionId string, localPath string, remoteDir string, maxConcurrent int, onProgress func(int64, int64)) error {
	src, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer src.Close()

	info, err := src.Stat()
	if err != nil {
		return err
	}

	totalSize := info.Size()
	chunkSize := int64(256 * 1024)
	totalChunks := 0
	if totalSize > 0 {
		totalChunks = int((totalSize + chunkSize - 1) / chunkSize)
	}

	parallel := maxConcurrent
	if parallel < 1 {
		parallel = 1
	}
	if totalChunks > 0 && parallel > totalChunks {
		parallel = totalChunks
	}

	taskID, err := m.BeginChunkedUploadTask(sessionId, remoteDir, parallel)
	if err != nil {
		return err
	}

	completed := false
	defer func() {
		if completed {
			_ = m.FinishChunkedUploadTask(taskID)
			return
		}
		_ = m.AbortChunkedUploadTask(taskID)
	}()

	fileID, err := m.BeginChunkedUploadFile(taskID, filepath.Base(localPath), totalSize, totalChunks)
	if err != nil {
		return err
	}

	if totalChunks == 0 {
		if err := ensureCompressedUploadContext(ctx); err != nil {
			return err
		}
		if onProgress != nil {
			onProgress(0, 0)
		}
		if err := m.CompleteChunkedUploadFile(taskID, fileID); err != nil {
			return err
		}
		completed = true
		return nil
	}

	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	type chunkJob struct {
		index int
		start int64
		end   int64
	}

	jobs := make(chan chunkJob)
	var wg sync.WaitGroup
	var uploaded int64
	var uploadedMu sync.Mutex
	var errMu sync.Mutex
	var firstErr error

	setErr := func(err error) {
		if err == nil {
			return
		}
		errMu.Lock()
		if firstErr == nil {
			firstErr = err
			cancel()
		}
		errMu.Unlock()
	}

	for workerIndex := 0; workerIndex < parallel; workerIndex++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-workerCtx.Done():
					return
				case job, ok := <-jobs:
					if !ok {
						return
					}
					if err := ensureCompressedUploadContext(workerCtx); err != nil {
						setErr(err)
						return
					}
					buf := make([]byte, int(job.end-job.start))
					n, readErr := src.ReadAt(buf, job.start)
					if readErr != nil && readErr != io.EOF {
						setErr(readErr)
						return
					}
					if int64(n) != job.end-job.start {
						setErr(io.ErrUnexpectedEOF)
						return
					}
					if err := ensureCompressedUploadContext(workerCtx); err != nil {
						setErr(err)
						return
					}
					if err := m.UploadChunkBase64(taskID, fileID, job.index, job.start, base64.StdEncoding.EncodeToString(buf[:n])); err != nil {
						setErr(err)
						return
					}
					uploadedMu.Lock()
					uploaded += int64(n)
					currentUploaded := uploaded
					uploadedMu.Unlock()
					if onProgress != nil {
						onProgress(currentUploaded, totalSize)
					}
				}
			}
		}()
	}

sendLoop:
	for chunkIndex := 0; chunkIndex < totalChunks; chunkIndex++ {
		start := int64(chunkIndex) * chunkSize
		end := start + chunkSize
		if end > totalSize {
			end = totalSize
		}
		select {
		case <-workerCtx.Done():
			break sendLoop
		case jobs <- chunkJob{index: chunkIndex, start: start, end: end}:
		}
	}

	close(jobs)
	wg.Wait()

	errMu.Lock()
	finalErr := firstErr
	errMu.Unlock()
	if finalErr != nil {
		return finalErr
	}
	if err := ensureCompressedUploadContext(workerCtx); err != nil {
		return err
	}
	if onProgress != nil {
		onProgress(totalSize, totalSize)
	}
	if err := m.CompleteChunkedUploadFile(taskID, fileID); err != nil {
		return err
	}
	completed = true
	return nil
}

func (m *SSHManager) getSFTPClientFromRemoteDirSession(ctx context.Context, remoteDir string) (*sftp.Client, error) {
	sessionID, ok := ctx.Value("compressedUploadSessionId").(string)
	if !ok || sessionID == "" {
		return nil, fmt.Errorf("compressed upload session missing")
	}
	return m.getSFTPClient(sessionID)
}
func (m *SSHManager) UploadLocalPathsCompressed(sessionId string, uploadID string, maxConcurrent int, localPaths []string, remoteDir string) error {
	paths := make([]string, 0, len(localPaths))
	for _, localPath := range localPaths {
		localPath = strings.TrimSpace(localPath)
		if localPath != "" {
			paths = append(paths, localPath)
		}
	}
	if len(paths) == 0 {
		return fmt.Errorf("no local paths")
	}

	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), "compressedUploadSessionId", sessionId))
	task := &compressedUploadTask{
		id:        uploadID,
		sessionId: sessionId,
		cancel:    cancel,
	}
	var repairState *compressedUploadRepairState
	if err := registerCompressedUploadTask(uploadID, task); err != nil {
		cancel()
		return err
	}
	defer func() {
		cancel()
		task.cleanup(m)
		if repairState != nil {
			repairState.restore(m)
		}
		unregisterCompressedUploadTask(uploadID, task)
	}()

	limiter, err := acquireCompressedUploadSlot(sessionId, maxConcurrent, ctx)
	if err != nil {
		return err
	}
	defer releaseCompressedUploadSlot(limiter)

	sshClient, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}

	m.emitCompressedUploadProgress(sessionId, uploadID, "preparing", 0, 0, 0, 0, "", fmt.Sprintf("%d paths", len(paths)))

	if len(paths) == 1 {
		info, err := os.Stat(paths[0])
		if err != nil {
			return err
		}
		if !info.IsDir() {
			fileName := filepath.Base(paths[0])
			m.emitCompressedUploadProgress(sessionId, uploadID, "uploading-file", 0, 0, 0, info.Size(), fileName, "")
			if err := m.uploadLocalFileWithContext(ctx, sshClient, maxConcurrent, paths[0], remoteDir, func(done int64, total int64) {
				phaseProgress := float64(100)
				if total > 0 {
					phaseProgress = float64(done) / float64(total) * 100
				}
				m.emitCompressedUploadProgress(sessionId, uploadID, "uploading-file", phaseProgress, phaseProgress, done, total, fileName, "")
			}); err != nil {
				return err
			}
			m.emitCompressedUploadProgress(sessionId, uploadID, "completed", 100, 100, info.Size(), info.Size(), fileName, "")
			return nil
		}
	}

	stats, err := collectLocalArchiveStats(paths)
	if err != nil {
		return err
	}
	archiveEntries, err := collectLocalArchiveEntries(paths)
	if err != nil {
		return err
	}
	m.emitCompressedUploadProgress(
		sessionId,
		uploadID,
		"scanning",
		0,
		100,
		0,
		stats.TotalBytes,
		"",
		fmt.Sprintf("%d files, %d directories", stats.FileCount, stats.DirCount),
	)

	archivePath, tempDir, err := createLocalTarGz(ctx, paths, stats, func(done int64, total int64, current string) {
		phaseProgress := float64(100)
		if total > 0 {
			phaseProgress = float64(done) / float64(total) * 100
		}
		m.emitCompressedUploadProgress(sessionId, uploadID, "compressing", phaseProgress*0.5, phaseProgress, done, total, current, "creating local tar.gz")
	})
	if err != nil {
		return err
	}
	task.setTempDir(tempDir)

	archiveSize := int64(0)
	if archiveInfo, statErr := os.Stat(archivePath); statErr == nil {
		archiveSize = archiveInfo.Size()
	}

	fileName := filepath.Base(archivePath)
	m.emitCompressedUploadProgress(sessionId, uploadID, "uploading", 50, 0, 0, archiveSize, fileName, "uploading local tar.gz")
	remoteArchive := filepath.ToSlash(filepath.Join(remoteDir, fileName))
	task.setRemoteArchive(remoteArchive)
	if err := m.uploadLocalFileWithContext(ctx, sshClient, maxConcurrent, archivePath, remoteDir, func(done int64, total int64) {
		phaseProgress := float64(100)
		if total > 0 {
			phaseProgress = float64(done) / float64(total) * 100
		}
		overall := 50 + phaseProgress*0.49
		m.emitCompressedUploadProgress(sessionId, uploadID, "uploading", overall, phaseProgress, done, total, fileName, "uploading local tar.gz")
	}); err != nil {
		return err
	}

	m.emitCompressedUploadProgress(sessionId, uploadID, "cleanup-local", 99, 0, 0, 0, fileName, "removing local temporary archive")
	_ = os.RemoveAll(tempDir)
	task.clearTempDir()

	if err := ensureCompressedUploadContext(ctx); err != nil {
		return err
	}
	m.emitCompressedUploadProgress(sessionId, uploadID, "verifying", 99, 0, 0, 0, "", "checking remote directories and existing files before extract")
	if err := m.preflightCompressedUploadTargets(ctx, sessionId, remoteDir, archiveEntries, func(done int, total int, current string, detail string) {
		phaseProgress := float64(0)
		if total > 0 {
			phaseProgress = float64(done) / float64(total) * 100
		}
		m.emitCompressedUploadProgress(sessionId, uploadID, "verifying", 99, phaseProgress, 0, 0, current, detail)
	}); err != nil {
		m.emitCompressedUploadProgress(sessionId, uploadID, "verifying", 99, 0, 0, 0, "", "preflight blocked extract, attempting automatic remote repair")
		repairedState, repairErr := m.autoRepairCompressedUploadTargets(sessionId, remoteDir, archiveEntries)
		if repairErr != nil {
			return fmt.Errorf("automatic remote repair failed\n%w", repairErr)
		}
		repairState = repairedState
		m.emitCompressedUploadProgress(sessionId, uploadID, "verifying", 99, 100, 0, 0, "", "automatic remote repair completed, continuing extract")
	}
	m.emitCompressedUploadProgress(sessionId, uploadID, "extracting", 99, 0, 0, 0, fileName, "extracting archive on remote server")
	if err := m.UncompressItem(sessionId, remoteArchive); err != nil {
		_ = m.DeleteItem(sessionId, remoteArchive, false)
		task.clearRemoteArchive()
		return fmt.Errorf("remote extract failed after automatic repair\narchive: %s\nremote target: %s\nreason: %w", remoteArchive, remoteDir, err)
	}

	if err := ensureCompressedUploadContext(ctx); err != nil {
		return err
	}
	m.emitCompressedUploadProgress(sessionId, uploadID, "cleanup-remote", 99, 0, 0, 0, fileName, "removing remote archive")
	if err := m.DeleteItem(sessionId, remoteArchive, false); err != nil {
		return err
	}
	task.clearRemoteArchive()
	m.emitCompressedUploadProgress(sessionId, uploadID, "completed", 100, 100, 0, 0, "", "completed")
	return nil
}
