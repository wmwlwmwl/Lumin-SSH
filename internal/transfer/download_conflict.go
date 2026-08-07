package transfer

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

const (
	DownloadConflictStrategyDiffOverwrite  = "diff_overwrite"
	DownloadConflictStrategyForceOverwrite = "force_overwrite"
	downloadConflictStrategyPrompt         = "prompt"
	DownloadConflictStrategyAutoRename     = "auto_rename"

	downloadRenameSuffixTimestamp = "timestamp"
	downloadRenameSuffixRandom    = "random"
	downloadRenameSuffixSequence  = "sequence"
)

type DownloadConflictOptions struct {
	Strategy         string            `json:"strategy"`
	DiffBySize       bool              `json:"diffBySize"`
	DiffByMtime      bool              `json:"diffByMtime"`
	RenameSuffixMode string            `json:"renameSuffixMode"`
	PathStrategies   map[string]string `json:"pathStrategies"`
}

func ParseDownloadConflictOptions(optionsJSON string) DownloadConflictOptions {
	options := DownloadConflictOptions{
		Strategy:         DownloadConflictStrategyAutoRename,
		DiffBySize:       true,
		DiffByMtime:      true,
		RenameSuffixMode: downloadRenameSuffixSequence,
		PathStrategies:   map[string]string{},
	}
	trimmed := strings.TrimSpace(optionsJSON)
	if trimmed != "" {
		_ = json.Unmarshal([]byte(trimmed), &options)
	}
	options.Strategy = normalizeDownloadConflictStrategy(options.Strategy)
	options.RenameSuffixMode = normalizeDownloadRenameSuffixMode(options.RenameSuffixMode)
	if options.PathStrategies == nil {
		options.PathStrategies = map[string]string{}
	}
	return options
}

func normalizeDownloadConflictStrategy(strategy string) string {
	switch strings.TrimSpace(strategy) {
	case DownloadConflictStrategyDiffOverwrite:
		return DownloadConflictStrategyDiffOverwrite
	case DownloadConflictStrategyForceOverwrite:
		return DownloadConflictStrategyForceOverwrite
	case downloadConflictStrategyPrompt:
		return downloadConflictStrategyPrompt
	case DownloadConflictStrategyAutoRename:
		return DownloadConflictStrategyAutoRename
	default:
		return DownloadConflictStrategyAutoRename
	}
}

func effectiveDownloadConflictStrategy(strategy string) string {
	normalized := normalizeDownloadConflictStrategy(strategy)
	if normalized == downloadConflictStrategyPrompt {
		return DownloadConflictStrategyAutoRename
	}
	return normalized
}

func normalizeDownloadRenameSuffixMode(mode string) string {
	switch strings.TrimSpace(mode) {
	case downloadRenameSuffixTimestamp:
		return downloadRenameSuffixTimestamp
	case downloadRenameSuffixRandom:
		return downloadRenameSuffixRandom
	case downloadRenameSuffixSequence:
		return downloadRenameSuffixSequence
	default:
		return downloadRenameSuffixSequence
	}
}

func (options DownloadConflictOptions) StrategyFor(conflictKey string) string {
	key := strings.TrimSpace(conflictKey)
	if key == "" {
		key = "."
	}
	if strategy, ok := options.PathStrategies[key]; ok {
		return effectiveDownloadConflictStrategy(strategy)
	}
	return effectiveDownloadConflictStrategy(options.Strategy)
}

func sameDownloadModTime(left time.Time, right time.Time) bool {
	return left.UTC().Truncate(time.Second).Equal(right.UTC().Truncate(time.Second))
}

func AreDownloadFilesDifferent(localInfo os.FileInfo, sourceInfo os.FileInfo, options DownloadConflictOptions) bool {
	compared := false
	if options.DiffBySize {
		compared = true
		if localInfo.Size() != sourceInfo.Size() {
			return true
		}
	}
	if options.DiffByMtime {
		compared = true
		if !sameDownloadModTime(localInfo.ModTime(), sourceInfo.ModTime()) {
			return true
		}
	}
	return !compared
}

func generateDownloadTimestampSuffix() string {
	now := time.Now()
	return fmt.Sprintf("%s_%09d", now.Format("20060102_150405"), now.Nanosecond())
}

func generateDownloadRandomSuffix() (string, error) {
	bytes := make([]byte, 4)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func nextSequentialDownloadPath(directory string, name string, ext string) (string, error) {
	entries, err := os.ReadDir(directory)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	pattern := regexp.MustCompile("^" + regexp.QuoteMeta(name) + `_(\d+)` + regexp.QuoteMeta(ext) + `$`)
	maxIndex := 0
	for _, entry := range entries {
		matches := pattern.FindStringSubmatch(entry.Name())
		if len(matches) != 2 {
			continue
		}
		index, err := strconv.Atoi(matches[1])
		if err != nil {
			continue
		}
		if index > maxIndex {
			maxIndex = index
		}
	}
	nextIndex := maxIndex + 1
	for {
		candidate := filepath.Join(directory, fmt.Sprintf("%s_%d%s", name, nextIndex, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		}
		nextIndex++
	}
}

func BuildDownloadRenamedPath(localPath string, renameMode string, isDirectory bool) (string, error) {
	directory := filepath.Dir(localPath)
	baseName := filepath.Base(localPath)
	name := baseName
	ext := ""
	if !isDirectory {
		ext = filepath.Ext(baseName)
		name = strings.TrimSuffix(baseName, ext)
	}
	if directory != "" && directory != "." {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return "", err
		}
	}
	switch normalizeDownloadRenameSuffixMode(renameMode) {
	case downloadRenameSuffixSequence:
		return nextSequentialDownloadPath(directory, name, ext)
	case downloadRenameSuffixRandom:
		for {
			suffix, err := generateDownloadRandomSuffix()
			if err != nil {
				return "", err
			}
			candidate := filepath.Join(directory, fmt.Sprintf("%s_%s%s", name, suffix, ext))
			if _, err := os.Stat(candidate); os.IsNotExist(err) {
				return candidate, nil
			}
		}
	default:
		for {
			candidate := filepath.Join(directory, fmt.Sprintf("%s_%s%s", name, generateDownloadTimestampSuffix(), ext))
			if _, err := os.Stat(candidate); os.IsNotExist(err) {
				return candidate, nil
			}
			time.Sleep(time.Microsecond)
		}
	}
}

func ensureDownloadParentDir(localPath string) error {
	parentDir := filepath.Dir(localPath)
	if parentDir == "" || parentDir == "." {
		return nil
	}
	return os.MkdirAll(parentDir, 0o755)
}

func SyncPathTimestamps(localPath string, modTime time.Time) error {
	if modTime.IsZero() {
		return nil
	}
	return os.Chtimes(localPath, modTime, modTime)
}

func copyLocalFileWithMetadata(sourcePath string, targetPath string) error {
	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return err
	}
	if err := ensureDownloadParentDir(targetPath); err != nil {
		return err
	}
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	targetFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, sourceInfo.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(targetFile, sourceFile); err != nil {
		targetFile.Close()
		return err
	}
	if err := targetFile.Close(); err != nil {
		return err
	}
	return SyncPathTimestamps(targetPath, sourceInfo.ModTime())
}

func copyLocalDirectoryTree(sourceDir string, targetDir string) error {
	sourceInfo, err := os.Stat(sourceDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(targetDir, sourceInfo.Mode().Perm()); err != nil {
		return err
	}
	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		sourcePath := filepath.Join(sourceDir, entry.Name())
		targetPath := filepath.Join(targetDir, entry.Name())
		entryInfo, err := entry.Info()
		if err != nil {
			return err
		}
		if entryInfo.IsDir() {
			if err := copyLocalDirectoryTree(sourcePath, targetPath); err != nil {
				return err
			}
			continue
		}
		if err := copyLocalFileWithMetadata(sourcePath, targetPath); err != nil {
			return err
		}
	}
	return SyncPathTimestamps(targetDir, sourceInfo.ModTime())
}

func combineDownloadConflictKey(baseKey string, name string) string {
	cleanName := filepath.ToSlash(strings.TrimSpace(name))
	if cleanName == "" {
		return baseKey
	}
	if baseKey == "" || baseKey == "." {
		return cleanName
	}
	return filepath.ToSlash(filepath.Join(baseKey, cleanName))
}

func applyDownloadedFileFromSource(sourcePath string, targetPath string, conflictKey string, options DownloadConflictOptions) (string, bool, error) {
	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return "", false, err
	}
	if err := ensureDownloadParentDir(targetPath); err != nil {
		return "", false, err
	}
	targetInfo, err := os.Stat(targetPath)
	if os.IsNotExist(err) {
		if err := copyLocalFileWithMetadata(sourcePath, targetPath); err != nil {
			return "", false, err
		}
		return targetPath, false, nil
	}
	if err != nil {
		return "", false, err
	}

	strategy := options.StrategyFor(conflictKey)
	if targetInfo.IsDir() {
		if strategy == DownloadConflictStrategyAutoRename {
			renamedPath, err := BuildDownloadRenamedPath(targetPath, options.RenameSuffixMode, false)
			if err != nil {
				return "", false, err
			}
			if err := copyLocalFileWithMetadata(sourcePath, renamedPath); err != nil {
				return "", false, err
			}
			return renamedPath, false, nil
		}
		if err := os.RemoveAll(targetPath); err != nil {
			return "", false, err
		}
		if err := copyLocalFileWithMetadata(sourcePath, targetPath); err != nil {
			return "", false, err
		}
		return targetPath, false, nil
	}

	if strategy == DownloadConflictStrategyDiffOverwrite && !AreDownloadFilesDifferent(targetInfo, sourceInfo, options) {
		return targetPath, true, nil
	}

	if err := copyLocalFileWithMetadata(sourcePath, targetPath); err != nil {
		return "", false, err
	}
	return targetPath, false, nil
}

func mergeDownloadedDirectoryContents(sourceDir string, targetDir string, baseKey string, options DownloadConflictOptions) error {
	sourceEntries, err := os.ReadDir(sourceDir)
	if err != nil {
		return err
	}
	for _, sourceEntry := range sourceEntries {
		sourcePath := filepath.Join(sourceDir, sourceEntry.Name())
		targetPath := filepath.Join(targetDir, sourceEntry.Name())
		conflictKey := combineDownloadConflictKey(baseKey, sourceEntry.Name())
		sourceInfo, err := sourceEntry.Info()
		if err != nil {
			return err
		}
		targetInfo, statErr := os.Stat(targetPath)
		if os.IsNotExist(statErr) {
			if sourceInfo.IsDir() {
				if err := copyLocalDirectoryTree(sourcePath, targetPath); err != nil {
					return err
				}
				continue
			}
			if _, _, err := applyDownloadedFileFromSource(sourcePath, targetPath, conflictKey, options); err != nil {
				return err
			}
			continue
		}
		if statErr != nil {
			return statErr
		}

		strategy := options.StrategyFor(conflictKey)
		if sourceInfo.IsDir() {
			if targetInfo.IsDir() {
				if err := mergeDownloadedDirectoryContents(sourcePath, targetPath, conflictKey, options); err != nil {
					return err
				}
				if err := SyncPathTimestamps(targetPath, sourceInfo.ModTime()); err != nil {
					return err
				}
				continue
			}
			if strategy == DownloadConflictStrategyAutoRename {
				renamedPath, err := BuildDownloadRenamedPath(targetPath, options.RenameSuffixMode, true)
				if err != nil {
					return err
				}
				if err := copyLocalDirectoryTree(sourcePath, renamedPath); err != nil {
					return err
				}
				continue
			}
			if err := os.RemoveAll(targetPath); err != nil {
				return err
			}
			if err := copyLocalDirectoryTree(sourcePath, targetPath); err != nil {
				return err
			}
			continue
		}

		if targetInfo.IsDir() && strategy != DownloadConflictStrategyAutoRename {
			if err := os.RemoveAll(targetPath); err != nil {
				return err
			}
		}
		if _, _, err := applyDownloadedFileFromSource(sourcePath, targetPath, conflictKey, options); err != nil {
			return err
		}
	}
	return nil
}

func ApplyDownloadedDirectoryFromSource(sourceRoot string, targetRoot string, options DownloadConflictOptions) (string, error) {
	sourceInfo, err := os.Stat(sourceRoot)
	if err != nil {
		return "", err
	}
	if !sourceInfo.IsDir() {
		return "", fmt.Errorf("source root is not a directory")
	}
	if err := ensureDownloadParentDir(targetRoot); err != nil {
		return "", err
	}

	targetInfo, err := os.Stat(targetRoot)
	if os.IsNotExist(err) {
		if err := copyLocalDirectoryTree(sourceRoot, targetRoot); err != nil {
			return "", err
		}
		return targetRoot, nil
	}
	if err != nil {
		return "", err
	}

	rootStrategy := options.StrategyFor(".")
	if !targetInfo.IsDir() {
		if rootStrategy == DownloadConflictStrategyAutoRename {
			renamedPath, err := BuildDownloadRenamedPath(targetRoot, options.RenameSuffixMode, true)
			if err != nil {
				return "", err
			}
			if err := copyLocalDirectoryTree(sourceRoot, renamedPath); err != nil {
				return "", err
			}
			return renamedPath, nil
		}
		if err := os.RemoveAll(targetRoot); err != nil {
			return "", err
		}
		if err := copyLocalDirectoryTree(sourceRoot, targetRoot); err != nil {
			return "", err
		}
		return targetRoot, nil
	}

	if rootStrategy == DownloadConflictStrategyAutoRename {
		renamedPath, err := BuildDownloadRenamedPath(targetRoot, options.RenameSuffixMode, true)
		if err != nil {
			return "", err
		}
		if err := copyLocalDirectoryTree(sourceRoot, renamedPath); err != nil {
			return "", err
		}
		return renamedPath, nil
	}

	if err := mergeDownloadedDirectoryContents(sourceRoot, targetRoot, ".", options); err != nil {
		return "", err
	}
	return targetRoot, SyncPathTimestamps(targetRoot, sourceInfo.ModTime())
}

func buildDownloadConflictDescriptor(conflictKey string, relativePath string, localPath string, remoteInfo os.FileInfo, localInfo os.FileInfo) map[string]interface{} {
	remoteKind := "file"
	if remoteInfo != nil && remoteInfo.IsDir() {
		remoteKind = "directory"
	}
	localKind := "missing"
	if localInfo != nil {
		if localInfo.IsDir() {
			localKind = "directory"
		} else {
			localKind = "file"
		}
	}
	result := map[string]interface{}{
		"key":          conflictKey,
		"relativePath": filepath.ToSlash(strings.TrimSpace(relativePath)),
		"localPath":    localPath,
		"remoteKind":   remoteKind,
		"localKind":    localKind,
	}
	if remoteInfo != nil {
		result["remoteSize"] = remoteInfo.Size()
		result["remoteModifyTime"] = remoteInfo.ModTime().UnixMilli()
	}
	if localInfo != nil {
		result["localSize"] = localInfo.Size()
		result["localModifyTime"] = localInfo.ModTime().UnixMilli()
	}
	return result
}

func NormalizeRemoteDownloadPath(remotePath string) string {
	normalized := filepath.ToSlash(strings.TrimSpace(remotePath))
	if normalized == "" {
		return ""
	}
	if normalized == "/" {
		return "/"
	}
	return strings.TrimRight(normalized, "/")
}

func RemoteDownloadBaseName(remotePath string) string {
	normalized := NormalizeRemoteDownloadPath(remotePath)
	if normalized == "" || normalized == "/" {
		return "download"
	}
	baseName := pathpkg.Base(normalized)
	if baseName == "." || baseName == "/" || baseName == "" {
		return "download"
	}
	return baseName
}

func PreviewDownloadConflicts(sftpClient *sftp.Client, remotePath string, localPath string, isDirectory bool) ([]map[string]interface{}, error) {
	localPath = filepath.Clean(strings.TrimSpace(localPath))
	if localPath == "" {
		return nil, fmt.Errorf("missing local path")
	}

	if !isDirectory {
		remoteInfo, err := sftpClient.Stat(remotePath)
		if err != nil {
			return nil, err
		}
		localInfo, err := os.Stat(localPath)
		if os.IsNotExist(err) {
			return []map[string]interface{}{}, nil
		}
		if err != nil {
			return nil, err
		}
		return []map[string]interface{}{
			buildDownloadConflictDescriptor(".", filepath.Base(localPath), localPath, remoteInfo, localInfo),
		}, nil
	}

	normalizedRemotePath := NormalizeRemoteDownloadPath(remotePath)
	if normalizedRemotePath == "" || normalizedRemotePath == "/" {
		return nil, fmt.Errorf("invalid remote directory")
	}

	remoteRootInfo, err := sftpClient.Stat(normalizedRemotePath)
	if err != nil {
		return nil, err
	}

	localRootInfo, err := os.Stat(localPath)
	if os.IsNotExist(err) {
		return []map[string]interface{}{}, nil
	}
	if err != nil {
		return nil, err
	}

	conflicts := []map[string]interface{}{
		buildDownloadConflictDescriptor(".", RemoteDownloadBaseName(normalizedRemotePath), localPath, remoteRootInfo, localRootInfo),
	}

	if !localRootInfo.IsDir() {
		return conflicts, nil
	}

	walker := sftpClient.Walk(normalizedRemotePath)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			return nil, err
		}
		currentRemotePath := filepath.ToSlash(walker.Path())
		if currentRemotePath == normalizedRemotePath {
			continue
		}
		relativePath := strings.TrimPrefix(currentRemotePath, normalizedRemotePath)
		relativePath = strings.TrimPrefix(relativePath, "/")
		if relativePath == "" {
			continue
		}
		localCandidate := filepath.Join(localPath, filepath.FromSlash(relativePath))
		localInfo, err := os.Stat(localCandidate)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		conflicts = append(conflicts, buildDownloadConflictDescriptor(
			filepath.ToSlash(relativePath),
			relativePath,
			localCandidate,
			walker.Stat(),
			localInfo,
		))
	}

	return conflicts, nil
}
