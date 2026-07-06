package mcpserver

import (
	"encoding/xml"
	"fmt"
	"strings"
)

const maxReadFileRequests = 100

type ReadFileRequest struct {
	Path string
	StartLine int
	EndLine int
	HasLineRange bool
}

type readFileXMLArgs struct {
	Files []readFileXMLFile `xml:"file"`
}

type readFileXMLFile struct {
	Path string `xml:"path"`
	StartLine string `xml:"start_line"`
	EndLine string `xml:"end_line"`
}

func parseReadFileRequests(arguments map[string]any) ([]ReadFileRequest, error) {
	if argsXML, ok, err := optionalStringArgument(arguments, "args"); err != nil {
		return nil, err
	} else if ok && argsXML != "" {
		return parseReadFileRequestsFromXML(argsXML)
	}
	if rawFiles, ok := arguments["files"]; ok {
		return parseReadFileRequestsFromArray(rawFiles)
	}
	path, err := requireStringArgument(arguments, "path")
	if err != nil {
		return nil, fmt.Errorf("missing required argument: provide args, files, or path")
	}
	startLine, hasStart, err := optionalIntArgument(arguments, "start_line")
	if err != nil {
		return nil, err
	}
	endLine, hasEnd, err := optionalIntArgument(arguments, "end_line")
	if err != nil {
		return nil, err
	}
	request, err := newReadFileRequest(path, startLine, endLine, hasStart, hasEnd)
	if err != nil {
		return nil, err
	}
	return []ReadFileRequest{request}, nil
}

func parseReadFileRequestsFromXML(argsXML string) ([]ReadFileRequest, error) {
	payload := strings.TrimSpace(argsXML)
	if payload == "" {
		return nil, fmt.Errorf("argument args must not be empty")
	}
	if !strings.HasPrefix(payload, "<args") {
		payload = "<args>" + payload + "</args>"
	}
	var parsed readFileXMLArgs
	if err := xml.Unmarshal([]byte(payload), &parsed); err != nil {
		return nil, fmt.Errorf("argument args must be valid XML: %w", err)
	}
	if len(parsed.Files) == 0 {
		return nil, fmt.Errorf("argument args does not contain any file entries")
	}
	requests := make([]ReadFileRequest, 0, len(parsed.Files))
	for index, file := range parsed.Files {
		path := strings.TrimSpace(file.Path)
		if path == "" {
			return nil, fmt.Errorf("argument args file[%d] path must not be empty", index)
		}
		startLine, hasStart, err := parseOptionalPositiveIntString(file.StartLine)
		if err != nil {
			return nil, fmt.Errorf("argument args file[%d] start_line %w", index, err)
		}
		endLine, hasEnd, err := parseOptionalPositiveIntString(file.EndLine)
		if err != nil {
			return nil, fmt.Errorf("argument args file[%d] end_line %w", index, err)
		}
		request, err := newReadFileRequest(path, startLine, endLine, hasStart, hasEnd)
		if err != nil {
			return nil, fmt.Errorf("argument args file[%d] %w", index, err)
		}
		requests = append(requests, request)
	}
	if len(requests) > maxReadFileRequests {
		return nil, fmt.Errorf("argument args contains too many files: maximum %d", maxReadFileRequests)
	}
	return requests, nil
}

func parseReadFileRequestsFromArray(rawFiles any) ([]ReadFileRequest, error) {
	items, ok := rawFiles.([]any)
	if !ok {
		return nil, fmt.Errorf("argument files must be an array")
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("argument files must contain at least one file entry")
	}
	if len(items) > maxReadFileRequests {
		return nil, fmt.Errorf("argument files contains too many files: maximum %d", maxReadFileRequests)
	}
	requests := make([]ReadFileRequest, 0, len(items))
	for index, rawItem := range items {
		itemMap, ok := rawItem.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("argument files[%d] must be an object", index)
		}
		if err := validateAllowedArguments(itemMap, "path", "start_line", "end_line"); err != nil {
			return nil, fmt.Errorf("argument files[%d] %s", index, err.Error())
		}
		path, err := requireStringArgument(itemMap, "path")
		if err != nil {
			return nil, fmt.Errorf("argument files[%d] %s", index, err.Error())
		}
		startLine, hasStart, err := optionalIntArgument(itemMap, "start_line")
		if err != nil {
			return nil, fmt.Errorf("argument files[%d] %s", index, err.Error())
		}
		endLine, hasEnd, err := optionalIntArgument(itemMap, "end_line")
		if err != nil {
			return nil, fmt.Errorf("argument files[%d] %s", index, err.Error())
		}
		request, err := newReadFileRequest(path, startLine, endLine, hasStart, hasEnd)
		if err != nil {
			return nil, fmt.Errorf("argument files[%d] %w", index, err)
		}
		requests = append(requests, request)
	}
	return requests, nil
}

func newReadFileRequest(path string, startLine int, endLine int, hasStart bool, hasEnd bool) (ReadFileRequest, error) {
	if hasStart != hasEnd {
		return ReadFileRequest{}, fmt.Errorf("start_line and end_line must be provided together")
	}
	request := ReadFileRequest{Path: path}
	if !hasStart {
		return request, nil
	}
	if startLine < 1 || endLine < 1 {
		return ReadFileRequest{}, fmt.Errorf("start_line and end_line must be greater than or equal to 1")
	}
	if endLine < startLine {
		return ReadFileRequest{}, fmt.Errorf("end_line must be greater than or equal to start_line")
	}
	request.StartLine = startLine
	request.EndLine = endLine
	request.HasLineRange = true
	return request, nil
}

func parseOptionalPositiveIntString(value string) (int, bool, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false, nil
	}
	number := 0
	for _, ch := range trimmed {
		if ch < '0' || ch > '9' {
			return 0, false, fmt.Errorf("must be an integer")
		}
		number = number*10 + int(ch-'0')
	}
	return number, true, nil
}