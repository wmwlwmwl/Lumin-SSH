package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type ProgramFontInfo struct {
	FileName    string `json:"fileName"`
	DisplayName string `json:"displayName"`
	Source      string `json:"source"`
	Size        int64  `json:"size"`
	UpdatedAt   int64  `json:"updatedAt"`
	MimeType    string `json:"mimeType"`
}

var supportedProgramFontMimeTypes = map[string]string{
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".ttc":   "font/collection",
	".woff":  "font/woff",
	".woff2": "font/woff2",
}

func getProgramFontsDirectory() string {
	programDirectory := strings.TrimSpace(getProgramDirectory())
	if programDirectory == "" {
		return ""
	}
	return filepath.Join(programDirectory, "fonts")
}

func ensureProgramFontsDirectory() (string, error) {
	fontsDirectory := getProgramFontsDirectory()
	if fontsDirectory == "" {
		return "", fmt.Errorf("program directory unavailable")
	}
	if err := os.MkdirAll(fontsDirectory, 0o755); err != nil {
		return "", err
	}
	return fontsDirectory, nil
}

func sanitizeProgramFontFileName(fileName string) string {
	return filepath.Base(strings.TrimSpace(fileName))
}

func getProgramFontMimeType(fileName string) string {
	return supportedProgramFontMimeTypes[strings.ToLower(filepath.Ext(strings.TrimSpace(fileName)))]
}

func isSupportedProgramFontFile(fileName string) bool {
	return getProgramFontMimeType(fileName) != ""
}

func buildProgramFontInfoFromPath(fontPath string) (ProgramFontInfo, error) {
	info, err := os.Stat(fontPath)
	if err != nil {
		return ProgramFontInfo{}, err
	}
	if info.IsDir() {
		return ProgramFontInfo{}, fmt.Errorf("font path is a directory")
	}
	fileName := sanitizeProgramFontFileName(info.Name())
	mimeType := getProgramFontMimeType(fileName)
	if fileName == "" || fileName == "." || mimeType == "" {
		return ProgramFontInfo{}, fmt.Errorf("unsupported font file: %s", fileName)
	}
	displayName := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	return ProgramFontInfo{
		FileName:    fileName,
		DisplayName: displayName,
		Source:      "directory",
		Size:        info.Size(),
		UpdatedAt:   info.ModTime().UnixMilli(),
		MimeType:    mimeType,
	}, nil
}

func listProgramFontsFromDirectory() ([]ProgramFontInfo, error) {
	fontsDirectory, err := ensureProgramFontsDirectory()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(fontsDirectory)
	if err != nil {
		return nil, err
	}
	fonts := make([]ProgramFontInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		fileName := sanitizeProgramFontFileName(entry.Name())
		if !isSupportedProgramFontFile(fileName) {
			continue
		}
		fontInfo, infoErr := buildProgramFontInfoFromPath(filepath.Join(fontsDirectory, fileName))
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

func copyProgramFontFile(sourcePath string, fontsDirectory string) (ProgramFontInfo, error) {
	cleanedSourcePath := filepath.Clean(strings.TrimSpace(sourcePath))
	if cleanedSourcePath == "" {
		return ProgramFontInfo{}, fmt.Errorf("missing font source path")
	}
	fileName := sanitizeProgramFontFileName(cleanedSourcePath)
	if !isSupportedProgramFontFile(fileName) {
		return ProgramFontInfo{}, fmt.Errorf("unsupported font file: %s", fileName)
	}
	fontData, err := os.ReadFile(cleanedSourcePath)
	if err != nil {
		return ProgramFontInfo{}, err
	}
	targetPath := filepath.Join(fontsDirectory, fileName)
	if err := atomicWriteFile(targetPath, fontData, 0o644); err != nil {
		return ProgramFontInfo{}, err
	}
	return buildProgramFontInfoFromPath(targetPath)
}

func deleteProgramFontFile(fileName string) error {
	fontsDirectory, err := ensureProgramFontsDirectory()
	if err != nil {
		return err
	}
	safeFileName := sanitizeProgramFontFileName(fileName)
	if safeFileName == "" || safeFileName == "." || !isSupportedProgramFontFile(safeFileName) {
		return fmt.Errorf("unsupported font file: %s", fileName)
	}
	targetPath := filepath.Join(fontsDirectory, safeFileName)
	if err := os.Remove(targetPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return nil
}

func buildProgramFontDataURL(fileName string) (string, error) {
	fontsDirectory, err := ensureProgramFontsDirectory()
	if err != nil {
		return "", err
	}
	safeFileName := sanitizeProgramFontFileName(fileName)
	mimeType := getProgramFontMimeType(safeFileName)
	if safeFileName == "" || safeFileName == "." || mimeType == "" {
		return "", fmt.Errorf("unsupported font file: %s", fileName)
	}
	fontBytes, err := os.ReadFile(filepath.Join(fontsDirectory, safeFileName))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(fontBytes)), nil
}