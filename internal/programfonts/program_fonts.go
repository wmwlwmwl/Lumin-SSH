package programfonts

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ProgramFontInfo 描述一个已安装的程序内置字体。
type ProgramFontInfo struct {
	FileName    string `json:"fileName"`
	DisplayName string `json:"displayName"`
	Source      string `json:"source"`
	Size        int64  `json:"size"`
	UpdatedAt   int64  `json:"updatedAt"`
	MimeType    string `json:"mimeType"`
}

var supportedFontMimeTypes = map[string]string{
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".ttc":   "font/collection",
	".woff":  "font/woff",
	".woff2": "font/woff2",
}

// fontsDir 返回 programDir 下的 fonts 目录。programDir 为空时返回空串。
func fontsDir(programDir string) string {
	programDir = strings.TrimSpace(programDir)
	if programDir == "" {
		return ""
	}
	return filepath.Join(programDir, "fonts")
}

// EnsureDir 确保字体目录存在并返回其路径。
func EnsureDir(programDir string) (string, error) {
	dir := fontsDir(programDir)
	if dir == "" {
		return "", fmt.Errorf("program directory unavailable")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func sanitizeFileName(fileName string) string {
	return filepath.Base(strings.TrimSpace(fileName))
}

func mimeType(fileName string) string {
	return supportedFontMimeTypes[strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))]
}

func isSupportedFile(fileName string) bool {
	return mimeType(fileName) != ""
}

func buildInfoFromPath(fontPath string) (ProgramFontInfo, error) {
	info, err := os.Stat(fontPath)
	if err != nil {
		return ProgramFontInfo{}, err
	}
	if info.IsDir() {
		return ProgramFontInfo{}, fmt.Errorf("font path is a directory")
	}
	fileName := sanitizeFileName(info.Name())
	mt := mimeType(fileName)
	if fileName == "" || fileName == "." || mt == "" {
		return ProgramFontInfo{}, fmt.Errorf("unsupported font file: %s", fileName)
	}
	displayName := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	return ProgramFontInfo{
		FileName:    fileName,
		DisplayName: displayName,
		Source:      "directory",
		Size:        info.Size(),
		UpdatedAt:   info.ModTime().UnixMilli(),
		MimeType:    mt,
	}, nil
}

// ListFonts 列出字体目录下所有受支持的字体。
func ListFonts(programDir string) ([]ProgramFontInfo, error) {
	dir, err := EnsureDir(programDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	fonts := make([]ProgramFontInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		fileName := sanitizeFileName(entry.Name())
		if !isSupportedFile(fileName) {
			continue
		}
		fontInfo, infoErr := buildInfoFromPath(filepath.Join(dir, fileName))
		if infoErr != nil {
			continue
		}
		fonts = append(fonts, fontInfo)
	}
	sort.SliceStable(fonts, func(left, right int) bool {
		leftName := strings.ToLower(fonts[left].DisplayName)
		rightName := strings.ToLower(fonts[right].DisplayName)
		if leftName == rightName {
			return strings.ToLower(fonts[left].FileName) < strings.ToLower(fonts[right].FileName)
		}
		return leftName < rightName
	})
	return fonts, nil
}

// CopyFile 将源字体文件原子写入 fontsDir，返回字体信息。
func CopyFile(sourcePath, fontsDir string) (ProgramFontInfo, error) {
	cleanedSourcePath := filepath.Clean(strings.TrimSpace(sourcePath))
	if cleanedSourcePath == "" {
		return ProgramFontInfo{}, fmt.Errorf("missing font source path")
	}
	fileName := sanitizeFileName(cleanedSourcePath)
	if !isSupportedFile(fileName) {
		return ProgramFontInfo{}, fmt.Errorf("unsupported font file: %s", fileName)
	}
	fontData, err := os.ReadFile(cleanedSourcePath)
	if err != nil {
		return ProgramFontInfo{}, err
	}
	targetPath := filepath.Join(fontsDir, fileName)
	if err := atomicWriteFile(targetPath, fontData, 0o644); err != nil {
		return ProgramFontInfo{}, err
	}
	return buildInfoFromPath(targetPath)
}

// DeleteFile 按文件名删除字体；文件不存在视作成功。
func DeleteFile(fileName, programDir string) error {
	dir, err := EnsureDir(programDir)
	if err != nil {
		return err
	}
	safeFileName := sanitizeFileName(fileName)
	if safeFileName == "" || safeFileName == "." || !isSupportedFile(safeFileName) {
		return fmt.Errorf("unsupported font file: %s", fileName)
	}
	targetPath := filepath.Join(dir, safeFileName)
	if err := os.Remove(targetPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return nil
}

// DataURL 返回字体的 data: URL，供前端直接嵌入。
func DataURL(fileName, programDir string) (string, error) {
	dir, err := EnsureDir(programDir)
	if err != nil {
		return "", err
	}
	safeFileName := sanitizeFileName(fileName)
	mt := mimeType(safeFileName)
	if safeFileName == "" || safeFileName == "." || mt == "" {
		return "", fmt.Errorf("unsupported font file: %s", fileName)
	}
	fontBytes, err := os.ReadFile(filepath.Join(dir, safeFileName))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("data:%s;base64,%s", mt, base64.StdEncoding.EncodeToString(fontBytes)), nil
}

// atomicWriteFile 原子写文件：先写 .tmp 再 rename，避免半写。
// ponytail: 与 internal/ai、internal/mcp 各自的副本重复；待 config 簇迁移后可下沉到共享 util 包统一。
func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	tmpFile := path + ".tmp"
	f, err := os.OpenFile(tmpFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return fmt.Errorf("open temp file: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return fmt.Errorf("sync temp file: %w", err)
	}
	f.Close()
	if err := os.Rename(tmpFile, path); err != nil {
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
}
