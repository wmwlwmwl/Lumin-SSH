package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	pathpkg "path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type downloadTransferTask struct {
	id              string
	sessionId       string
	cancel          context.CancelFunc
	mu              sync.Mutex
	localTempDir    string
	localTargetPath string
	remoteArchive   string
}

var downloadTransferTasks sync.Map

func (task *downloadTransferTask) setLocalTempDir(localTempDir string) {
	task.mu.Lock()
	task.localTempDir = localTempDir
	task.mu.Unlock()
}

func (task *downloadTransferTask) clearLocalTempDir() {
	task.mu.Lock()
	task.localTempDir = ""
	task.mu.Unlock()
}

func (task *downloadTransferTask) setLocalTargetPath(localTargetPath string) {
	task.mu.Lock()
	task.localTargetPath = localTargetPath
	task.mu.Unlock()
}

func (task *downloadTransferTask) clearLocalTargetPath() {
	task.mu.Lock()
	task.localTargetPath = ""
	task.mu.Unlock()
}

func (task *downloadTransferTask) setRemoteArchive(remoteArchive string) {
	task.mu.Lock()
	task.remoteArchive = remoteArchive
	task.mu.Unlock()
}

func (task *downloadTransferTask) clearRemoteArchive() {
	task.mu.Lock()
	task.remoteArchive = ""
	task.mu.Unlock()
}

func (task *downloadTransferTask) snapshot() (string, string, string) {
	task.mu.Lock()
	defer task.mu.Unlock()
	return task.localTempDir, task.localTargetPath, task.remoteArchive
}

func (task *downloadTransferTask) cleanup(m *SSHManager) {
	localTempDir, localTargetPath, remoteArchive := task.snapshot()
	if localTempDir != "" {
		_ = os.RemoveAll(localTempDir)
		task.clearLocalTempDir()
	}
	if localTargetPath != "" {
		_ = os.RemoveAll(localTargetPath)
		task.clearLocalTargetPath()
	}
	if remoteArchive != "" {
		_ = m.DeleteItem(task.sessionId, remoteArchive, false)
		task.clearRemoteArchive()
	}
}

func registerDownloadTransferTask(downloadID string, task *downloadTransferTask) error {
	if downloadID == "" {
		return fmt.Errorf("missing download id")
	}
	if _, loaded := downloadTransferTasks.LoadOrStore(downloadID, task); loaded {
		return fmt.Errorf("download transfer already exists")
	}
	return nil
}

func unregisterDownloadTransferTask(downloadID string, task *downloadTransferTask) {
	if current, ok := downloadTransferTasks.Load(downloadID); ok && current == task {
		downloadTransferTasks.Delete(downloadID)
	}
}

func (m *SSHManager) abortDownloadTransferTaskByID(downloadID string, task *downloadTransferTask) {
	if task == nil {
		return
	}
	task.cancel()
	task.cleanup(m)
	if downloadID != "" {
		downloadTransferTasks.Delete(downloadID)
	}
}

func (m *SSHManager) AbortDownloadTransfer(identifier string) error {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return fmt.Errorf("missing download identifier")
	}
	if current, ok := downloadTransferTasks.Load(identifier); ok {
		task, _ := current.(*downloadTransferTask)
		m.abortDownloadTransferTaskByID(identifier, task)
		return nil
	}
	downloadTransferTasks.Range(func(key, value any) bool {
		downloadID, _ := key.(string)
		task, _ := value.(*downloadTransferTask)
		if task != nil && task.sessionId == identifier {
			m.abortDownloadTransferTaskByID(downloadID, task)
		}
		return true
	})
	return nil
}

func (m *SSHManager) emitDownloadTransferProgress(sessionId string, downloadID string, mode string, phase string, status string, progress float64, bytesDone int64, bytesTotal int64, current string, detail string) {
	if m.ctx == nil || strings.TrimSpace(downloadID) == "" {
		return
	}
	runtime.EventsEmit(m.ctx, "download-transfer-progress-"+sessionId, map[string]interface{}{
		"downloadId": downloadID,
		"mode":       mode,
		"phase":      phase,
		"status":     status,
		"progress":   clampPercent(progress),
		"bytesDone":  bytesDone,
		"bytesTotal": bytesTotal,
		"current":    current,
		"detail":     detail,
	})
}

func copyReaderWithProgressContext(ctx context.Context, dst io.Writer, src io.Reader, totalSize int64, onProgress func(int64, int64)) error {
	buf := make([]byte, 2*1024*1024)
	var copied int64
	lastEmit := time.Time{}
	for {
		if err := ensureContextActive(ctx); err != nil {
			return err
		}
		n, readErr := src.Read(buf)
		if n > 0 {
			written, writeErr := dst.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			copied += int64(written)
			now := time.Now()
			if onProgress != nil && (now.Sub(lastEmit) > 200*time.Millisecond || copied >= totalSize) {
				onProgress(copied, totalSize)
				lastEmit = now
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if onProgress != nil {
		onProgress(copied, totalSize)
	}
	return ensureContextActive(ctx)
}

func normalizeRemoteDownloadPath(remotePath string) string {
	normalized := filepath.ToSlash(strings.TrimSpace(remotePath))
	if normalized == "" {
		return ""
	}
	if normalized == "/" {
		return "/"
	}
	return strings.TrimRight(normalized, "/")
}

func sanitizeDownloadArchiveName(name string) string {
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
		" ", "_",
	)
	cleaned := replacer.Replace(strings.TrimSpace(name))
	if cleaned == "" {
		return "download"
	}
	return cleaned
}

func remoteDownloadBaseName(remotePath string) string {
	normalized := normalizeRemoteDownloadPath(remotePath)
	if normalized == "" || normalized == "/" {
		return "download"
	}
	baseName := pathpkg.Base(normalized)
	if baseName == "." || baseName == "/" || baseName == "" {
		return "download"
	}
	return baseName
}

func collectRemoteDownloadStats(sftpClient *sftp.Client, remotePath string) (int64, int64, error) {
	var totalBytes int64
	var fileCount int64
	walker := sftpClient.Walk(remotePath)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			return 0, 0, err
		}
		stat := walker.Stat()
		if stat == nil || stat.IsDir() {
			continue
		}
		totalBytes += stat.Size()
		fileCount++
	}
	return totalBytes, fileCount, nil
}

func ensureLocalDirectoryAvailable(localDir string) error {
	cleaned := strings.TrimSpace(localDir)
	if cleaned == "" {
		return fmt.Errorf("missing local directory")
	}
	return os.MkdirAll(cleaned, 0o755)
}

func ensureLocalTargetDoesNotExist(localPath string) error {
	_, err := os.Stat(localPath)
	if err == nil {
		return fmt.Errorf("local target already exists: %s", localPath)
	}
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func extractTarGzArchive(ctx context.Context, archivePath string, destinationDir string) error {
	if err := ensureLocalDirectoryAvailable(destinationDir); err != nil {
		return err
	}
	archiveFile, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer archiveFile.Close()

	gzipReader, err := gzip.NewReader(archiveFile)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	cleanDestination := filepath.Clean(destinationDir)
	for {
		if err := ensureContextActive(ctx); err != nil {
			return err
		}
		header, err := tarReader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		targetPath := filepath.Join(cleanDestination, filepath.FromSlash(header.Name))
		cleanTargetPath := filepath.Clean(targetPath)
		if cleanTargetPath != cleanDestination && !strings.HasPrefix(cleanTargetPath, cleanDestination+string(os.PathSeparator)) {
			return fmt.Errorf("archive entry escapes destination: %s", header.Name)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(cleanTargetPath, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(cleanTargetPath), 0o755); err != nil {
				return err
			}
			targetFile, err := os.OpenFile(cleanTargetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			if err := copyReaderWithProgressContext(ctx, targetFile, tarReader, header.Size, nil); err != nil {
				targetFile.Close()
				return err
			}
			if err := targetFile.Close(); err != nil {
				return err
			}
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(cleanTargetPath), 0o755); err != nil {
				return err
			}
			if err := os.Symlink(header.Linkname, cleanTargetPath); err != nil && !os.IsExist(err) {
				return err
			}
		default:
			return fmt.Errorf("unsupported archive entry type: %s", header.Name)
		}
	}
}

func (m *SSHManager) DownloadFileToLocal(sessionId string, downloadID string, remotePath string, localPath string, optionsJSON string) error {
	options := parseDownloadConflictOptions(optionsJSON)
	localPath = filepath.Clean(strings.TrimSpace(localPath))
	if localPath == "" {
		return fmt.Errorf("missing local path")
	}
	localTargetExisted := false
	if _, err := os.Stat(localPath); err == nil {
		localTargetExisted = true
		if options.strategyFor(".") == downloadConflictStrategyAutoRename {
			renamedPath, renameErr := buildDownloadRenamedPath(localPath, options.RenameSuffixMode, false)
			if renameErr != nil {
				return renameErr
			}
			localPath = renamedPath
			localTargetExisted = false
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &downloadTransferTask{
		id:        downloadID,
		sessionId: sessionId,
		cancel:    cancel,
	}
	if err := registerDownloadTransferTask(downloadID, task); err != nil {
		cancel()
		return err
	}
	defer func() {
		cancel()
		task.cleanup(m)
		unregisterDownloadTransferTask(downloadID, task)
	}()
	if !localTargetExisted {
		task.setLocalTargetPath(localPath)
	}
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return err
	}
	sftpClient, err := m.getSFTPClient(sessionId)
	if err != nil {
		return err
	}
	src, err := sftpClient.Open(remotePath)
	if err != nil {
		return err
	}
	defer src.Close()

	remoteInfo, err := src.Stat()
	if err != nil {
		return err
	}
	totalSize := remoteInfo.Size()

	if existingInfo, err := os.Stat(localPath); err == nil {
		if existingInfo.IsDir() {
			if err := os.RemoveAll(localPath); err != nil {
				return err
			}
		} else if options.strategyFor(".") == downloadConflictStrategyDiffOverwrite && !areDownloadFilesDifferent(existingInfo, remoteInfo, options) {
			task.clearLocalTargetPath()
			m.emitDownloadTransferProgress(sessionId, downloadID, "download-file", "completed", "completed", 100, totalSize, totalSize, filepath.Base(remotePath), "skipped")
			return nil
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	dst, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	fileName := filepath.Base(remotePath)
	m.emitDownloadTransferProgress(sessionId, downloadID, "download-file", "downloading", "uploading", 0, 0, totalSize, fileName, "")
	if err := copyReaderWithProgressContext(ctx, dst, src, totalSize, func(done int64, total int64) {
		progress := float64(100)
		if total > 0 {
			progress = float64(done) / float64(total) * 100
		}
		m.emitDownloadTransferProgress(sessionId, downloadID, "download-file", "downloading", "uploading", progress, done, total, fileName, "")
	}); err != nil {
		return err
	}
	if err := syncPathTimestamps(localPath, remoteInfo.ModTime()); err != nil {
		return err
	}
	task.clearLocalTargetPath()
	m.emitDownloadTransferProgress(sessionId, downloadID, "download-file", "completed", "completed", 100, totalSize, totalSize, fileName, "")
	return nil
}

func (m *SSHManager) DownloadDirectoryToLocal(sessionId string, downloadID string, remotePath string, localRoot string, optionsJSON string) error {
	options := parseDownloadConflictOptions(optionsJSON)
	normalizedRemotePath := normalizeRemoteDownloadPath(remotePath)
	if normalizedRemotePath == "" || normalizedRemotePath == "/" {
		return fmt.Errorf("invalid remote directory")
	}
	localRoot = filepath.Clean(strings.TrimSpace(localRoot))
	if localRoot == "" {
		return fmt.Errorf("missing local directory")
	}
	localTargetExisted := false
	if _, err := os.Stat(localRoot); err == nil {
		localTargetExisted = true
		if options.strategyFor(".") == downloadConflictStrategyAutoRename {
			renamedPath, renameErr := buildDownloadRenamedPath(localRoot, options.RenameSuffixMode, true)
			if renameErr != nil {
				return renameErr
			}
			localRoot = renamedPath
			localTargetExisted = false
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := ensureLocalDirectoryAvailable(filepath.Dir(localRoot)); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	task := &downloadTransferTask{
		id:        downloadID,
		sessionId: sessionId,
		cancel:    cancel,
	}
	if err := registerDownloadTransferTask(downloadID, task); err != nil {
		cancel()
		return err
	}
	defer func() {
		cancel()
		task.cleanup(m)
		unregisterDownloadTransferTask(downloadID, task)
	}()

	if !localTargetExisted {
		task.setLocalTargetPath(localRoot)
	}
	tempDir, err := os.MkdirTemp("", "lumin-download-dir-*")
	if err != nil {
		return err
	}
	task.setLocalTempDir(tempDir)

	sftpClient, err := m.getSFTPClient(sessionId)
	if err != nil {
		return err
	}
	totalBytes, fileCount, err := collectRemoteDownloadStats(sftpClient, normalizedRemotePath)
	if err != nil {
		return err
	}
	m.emitDownloadTransferProgress(sessionId, downloadID, "download-directory", "downloading", "uploading", 0, 0, totalBytes, "", fmt.Sprintf("%d files", fileCount))

	tempRoot := filepath.Join(tempDir, remoteDownloadBaseName(normalizedRemotePath))
	walker := sftpClient.Walk(normalizedRemotePath)
	var downloaded int64
	for walker.Step() {
		if err := ensureContextActive(ctx); err != nil {
			return err
		}
		if err := walker.Err(); err != nil {
			return err
		}
		currentRemotePath := filepath.ToSlash(walker.Path())
		stat := walker.Stat()
		if stat == nil {
			continue
		}
		relativePath := strings.TrimPrefix(currentRemotePath, normalizedRemotePath)
		relativePath = strings.TrimPrefix(relativePath, "/")
		localPath := tempRoot
		if relativePath != "" {
			localPath = filepath.Join(tempRoot, filepath.FromSlash(relativePath))
		}
		if stat.IsDir() {
			if err := os.MkdirAll(localPath, 0o755); err != nil {
				return err
			}
			if err := syncPathTimestamps(localPath, stat.ModTime()); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
			return err
		}
		src, err := sftpClient.Open(currentRemotePath)
		if err != nil {
			return err
		}
		dst, err := os.Create(localPath)
		if err != nil {
			src.Close()
			return err
		}
		totalSize := stat.Size()
		copyErr := copyReaderWithProgressContext(ctx, dst, src, totalSize, func(done int64, total int64) {
			progress := float64(100)
			if totalBytes > 0 {
				progress = float64(downloaded+done) / float64(totalBytes) * 100
			}
			m.emitDownloadTransferProgress(sessionId, downloadID, "download-directory", "downloading", "uploading", progress, downloaded+done, totalBytes, currentRemotePath, "")
		})
		closeDstErr := dst.Close()
		closeSrcErr := src.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeDstErr != nil {
			return closeDstErr
		}
		if closeSrcErr != nil {
			return closeSrcErr
		}
		if err := syncPathTimestamps(localPath, stat.ModTime()); err != nil {
			return err
		}
		downloaded += totalSize
	}
	finalPath, err := applyDownloadedDirectoryFromSource(tempRoot, localRoot, options)
	if err != nil {
		return err
	}
	localRoot = finalPath
	task.clearLocalTargetPath()
	m.emitDownloadTransferProgress(sessionId, downloadID, "download-directory", "completed", "completed", 100, totalBytes, totalBytes, localRoot, fmt.Sprintf("%d files", fileCount))
	return nil
}

func (m *SSHManager) DownloadDirectoryCompressed(sessionId string, downloadID string, remotePath string, localRoot string, optionsJSON string) error {
	options := parseDownloadConflictOptions(optionsJSON)
	normalizedRemotePath := normalizeRemoteDownloadPath(remotePath)
	if normalizedRemotePath == "" || normalizedRemotePath == "/" {
		return fmt.Errorf("invalid remote directory")
	}
	localRoot = filepath.Clean(strings.TrimSpace(localRoot))
	if localRoot == "" {
		return fmt.Errorf("missing local directory")
	}
	localTargetExisted := false
	if _, err := os.Stat(localRoot); err == nil {
		localTargetExisted = true
		if options.strategyFor(".") == downloadConflictStrategyAutoRename {
			renamedPath, renameErr := buildDownloadRenamedPath(localRoot, options.RenameSuffixMode, true)
			if renameErr != nil {
				return renameErr
			}
			localRoot = renamedPath
			localTargetExisted = false
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := ensureLocalDirectoryAvailable(filepath.Dir(localRoot)); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	task := &downloadTransferTask{
		id:        downloadID,
		sessionId: sessionId,
		cancel:    cancel,
	}
	if err := registerDownloadTransferTask(downloadID, task); err != nil {
		cancel()
		return err
	}
	defer func() {
		cancel()
		task.cleanup(m)
		unregisterDownloadTransferTask(downloadID, task)
	}()

	if !localTargetExisted {
		task.setLocalTargetPath(localRoot)
	}
	tempDir, err := os.MkdirTemp("", "lumin-download-*")
	if err != nil {
		return err
	}
	task.setLocalTempDir(tempDir)

	client, _, err := m.getClientEntry(sessionId)
	if err != nil {
		return err
	}
	sftpClient, err := m.getSFTPClient(sessionId)
	if err != nil {
		return err
	}

	remoteParentDir := pathpkg.Dir(normalizedRemotePath)
	remoteBaseName := pathpkg.Base(normalizedRemotePath)
	remoteArchiveName := fmt.Sprintf(".lumin_download_%d_%s.tar.gz", time.Now().UnixNano(), sanitizeDownloadArchiveName(remoteBaseName))
	remoteArchivePath := pathpkg.Join(remoteParentDir, remoteArchiveName)
	localArchivePath := filepath.Join(tempDir, remoteArchiveName)
	task.setRemoteArchive(remoteArchivePath)

	m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "preparing", "uploading", 0, 0, 0, "", "")
	m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "compressing", "uploading", 0, 0, 0, remoteBaseName, "")
	compressCommand := fmt.Sprintf("cd %s && tar -czf %s %s", shellQuotePath(remoteParentDir), shellQuotePath(remoteArchiveName), shellQuotePath(remoteBaseName))
	if _, err := m.executeCmdWithClientContext(ctx, client, compressCommand); err != nil {
		return err
	}

	remoteArchiveFile, err := sftpClient.Open(remoteArchivePath)
	if err != nil {
		return err
	}
	defer remoteArchiveFile.Close()

	archiveStat, err := remoteArchiveFile.Stat()
	if err != nil {
		return err
	}
	archiveSize := archiveStat.Size()

	localArchiveFile, err := os.Create(localArchivePath)
	if err != nil {
		return err
	}
	defer localArchiveFile.Close()

	m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "downloading", "uploading", 0, 0, archiveSize, remoteArchiveName, "")
	if err := copyReaderWithProgressContext(ctx, localArchiveFile, remoteArchiveFile, archiveSize, func(done int64, total int64) {
		progress := float64(100)
		if total > 0 {
			progress = float64(done) / float64(total) * 100
		}
		m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "downloading", "uploading", progress, done, total, remoteArchiveName, "")
	}); err != nil {
		return err
	}

	m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "extracting", "uploading", 99, 0, 0, remoteArchiveName, "")
	extractBaseDir := filepath.Join(tempDir, "extract")
	if err := os.MkdirAll(extractBaseDir, 0o755); err != nil {
		return err
	}
	if err := extractTarGzArchive(ctx, localArchivePath, extractBaseDir); err != nil {
		return err
	}
	extractedRoot := filepath.Join(extractBaseDir, remoteBaseName)
	if _, err := os.Stat(extractedRoot); err != nil {
		return err
	}
	finalPath, err := applyDownloadedDirectoryFromSource(extractedRoot, localRoot, options)
	if err != nil {
		return err
	}
	localRoot = finalPath
	task.clearLocalTargetPath()

	m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "cleanup-local", "uploading", 99, 0, 0, remoteArchiveName, "")
	_ = os.RemoveAll(tempDir)
	task.clearLocalTempDir()

	m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "cleanup-remote", "uploading", 99, 0, 0, remoteArchiveName, "")
	if err := m.DeleteItem(sessionId, remoteArchivePath, false); err != nil {
		return err
	}
	task.clearRemoteArchive()

	m.emitDownloadTransferProgress(sessionId, downloadID, "download-compressed", "completed", "completed", 100, archiveSize, archiveSize, localRoot, "")
	return nil
}
