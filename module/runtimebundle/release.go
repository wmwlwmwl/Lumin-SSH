package runtimebundle

import (
	"io"
	"io/fs"
	"os"
	pathpkg "path"
	"path/filepath"
	"strings"
)

func shouldPreserveEntryName(name string) bool {
	switch strings.TrimSpace(name) {
	case ".venv", "data":
		return true
	default:
		return false
	}
}

func shouldSkipReleasePath(relativePath string) bool {
	trimmed := strings.Trim(strings.ReplaceAll(relativePath, "\\", "/"), "/")
	if trimmed == "" {
		return false
	}
	topLevelName := trimmed
	if slashIndex := strings.Index(trimmed, "/"); slashIndex >= 0 {
		topLevelName = trimmed[:slashIndex]
	}
	return shouldPreserveEntryName(topLevelName)
}

func clearDirectoryExceptPersistentEntries(targetRoot string) error {
	entries, err := os.ReadDir(targetRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if shouldPreserveEntryName(entry.Name()) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(targetRoot, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func ReleaseEmbeddedDirectory(sourceFS fs.FS, sourceRoot string, targetRoot string) error {
	cleanSourceRoot := pathpkg.Clean(strings.TrimSpace(strings.ReplaceAll(sourceRoot, "\\", "/")))
	cleanTargetRoot := filepath.Clean(strings.TrimSpace(targetRoot))
	if cleanSourceRoot == "." || cleanSourceRoot == "" {
		return fs.ErrInvalid
	}
	if cleanTargetRoot == "." || cleanTargetRoot == "" {
		return fs.ErrInvalid
	}
	if _, err := fs.Stat(sourceFS, cleanSourceRoot); err != nil {
		return err
	}
	subFS, err := fs.Sub(sourceFS, cleanSourceRoot)
	if err != nil {
		return err
	}
	if err := clearDirectoryExceptPersistentEntries(cleanTargetRoot); err != nil {
		return err
	}
	return fs.WalkDir(subFS, ".", func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relativePath := pathpkg.Clean(currentPath)
		if relativePath == "." {
			relativePath = ""
		} else {
			relativePath = strings.TrimPrefix(relativePath, "./")
			relativePath = strings.TrimPrefix(relativePath, "/")
		}
		if shouldSkipReleasePath(relativePath) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		targetPath := cleanTargetRoot
		if relativePath != "" {
			targetPath = filepath.Join(cleanTargetRoot, filepath.FromSlash(relativePath))
		}
		if entry.IsDir() {
			return os.MkdirAll(targetPath, 0o755)
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}
		sourceFile, err := subFS.Open(currentPath)
		if err != nil {
			return err
		}
		defer sourceFile.Close()
		fileInfo, err := entry.Info()
		if err != nil {
			return err
		}
		targetFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fileInfo.Mode())
		if err != nil {
			return err
		}
		if _, err := io.Copy(targetFile, sourceFile); err != nil {
			targetFile.Close()
			return err
		}
		return targetFile.Close()
	})
}