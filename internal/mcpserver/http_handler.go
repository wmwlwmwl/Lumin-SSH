package mcpserver

import (
	"encoding/json"
	"net/http"
	"strings"
)

type HTTPHandler struct {
	catalog *Catalog
	serverInfo Implementation
	instructions string
	allowedOrigins map[string]struct{}
	logger func(string)
}

func NewHTTPHandler(catalog *Catalog, serverInfo Implementation, instructions string, allowedOrigins []string, logger func(string)) *HTTPHandler {
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		trimmed := strings.TrimSpace(origin)
		if trimmed == "" {
			continue
		}
		originSet[trimmed] = struct{}{}
	}
	return &HTTPHandler{
		catalog: catalog,
		serverInfo: serverInfo,
		instructions: instructions,
		allowedOrigins: originSet,
		logger: logger,
	}
}

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if !h.isOriginAllowed(origin) {
		h.log("forbidden origin: " + origin)
		w.WriteHeader(http.StatusForbidden)
		return
	}
	h.applyCORSHeaders(w, r, origin)
	switch r.Method {
	case http.MethodOptions:
		h.log("request options")
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPost:
		h.handlePost(w, r)
	case http.MethodGet:
		w.Header().Set("Allow", http.MethodOptions+", "+http.MethodPost+", "+http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
	default:
		w.Header().Set("Allow", http.MethodOptions+", "+http.MethodPost+", "+http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h *HTTPHandler) isOriginAllowed(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return true
	}
	if len(h.allowedOrigins) == 0 {
		return true
	}
	_, ok := h.allowedOrigins[origin]
	return ok
}

func (h *HTTPHandler) applyCORSHeaders(w http.ResponseWriter, r *http.Request, origin string) {
	if origin == "" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	requestHeaders := strings.TrimSpace(r.Header.Get("Access-Control-Request-Headers"))
	if requestHeaders == "" {
		requestHeaders = "Content-Type, Accept"
	}
	w.Header().Set("Access-Control-Allow-Headers", requestHeaders)
	w.Header().Set("Access-Control-Expose-Headers", "Content-Type")
}

func (h *HTTPHandler) handlePost(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request JSONRPCRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		h.writeError(w, nil, -32700, "parse error", nil)
		return
	}
	if request.JSONRPC != "2.0" || request.Method == "" {
		h.writeError(w, request.ID, -32600, "invalid request", nil)
		return
	}
	switch request.Method {
	case MethodInitialize:
		h.log("request initialize")
		h.handleInitialize(w, request)
	case MethodInitializedNotification:
		h.log("request notifications/initialized")
		w.WriteHeader(http.StatusAccepted)
	case MethodPing:
		h.log("request ping")
		h.writeResult(w, request.ID, map[string]any{})
	case MethodToolsList:
		h.log("request tools/list")
		h.handleToolsList(w, request)
	case MethodToolsCall:
		h.handleToolsCall(w, request)
	case MethodResourcesList:
		h.log("request resources/list")
		h.writeResult(w, request.ID, ResourcesListResult{Resources: []any{}})
	case MethodResourcesTemplatesList:
		h.log("request resources/templates/list")
		h.writeResult(w, request.ID, ResourceTemplatesListResult{ResourceTemplates: []any{}})
	case MethodPromptsList:
		h.log("request prompts/list")
		h.writeResult(w, request.ID, PromptsListResult{Prompts: []any{}})
	default:
		h.log("request method not found: " + request.Method)
		h.writeError(w, request.ID, -32601, "method not found", nil)
	}
}

func (h *HTTPHandler) handleInitialize(w http.ResponseWriter, request JSONRPCRequest) {
	var params InitializeRequestParams
	if len(request.Params) > 0 {
		if err := json.Unmarshal(request.Params, &params); err != nil {
			h.writeError(w, request.ID, -32602, "invalid params", err.Error())
			return
		}
	}
	result := InitializeResult{
		ProtocolVersion: ProtocolVersion,
		Capabilities: ServerCapabilities{
			Tools: ServerToolsCapability{
				ListChanged: false,
			},
			Resources: ServerResourcesCapability{
				ListChanged: false,
			},
			Prompts: ServerPromptsCapability{
				ListChanged: false,
			},
		},
		ServerInfo: h.serverInfo,
		Instructions: h.instructions,
	}
	h.writeResult(w, request.ID, result)
}

func (h *HTTPHandler) handleToolsList(w http.ResponseWriter, request JSONRPCRequest) {
	if h.catalog == nil {
		h.writeError(w, request.ID, -32603, "catalog unavailable", nil)
		return
	}
	h.writeResult(w, request.ID, ToolsListResult{Tools: h.catalog.List()})
}

func (h *HTTPHandler) handleToolsCall(w http.ResponseWriter, request JSONRPCRequest) {
	if h.catalog == nil {
		h.writeError(w, request.ID, -32603, "catalog unavailable", nil)
		return
	}
	var params ToolCallRequestParams
	if len(request.Params) > 0 {
		if err := json.Unmarshal(request.Params, &params); err != nil {
			h.writeError(w, request.ID, -32602, "invalid params", err.Error())
			return
		}
	}
	if strings.TrimSpace(params.Name) == "" {
		h.writeError(w, request.ID, -32602, "invalid params", "missing tool name")
		return
	}
	h.log("request tools/call name=" + strings.TrimSpace(params.Name))
	result, err := h.catalog.Call(params.Name, params.Arguments)
	if err != nil {
		h.log("tool call error name=" + strings.TrimSpace(params.Name) + " error=" + err.Error())
		h.writeResult(w, request.ID, ToolCallResult{
			Content: []TextContent{{Type: "text", Text: err.Error()}},
			IsError: true,
		})
		return
	}
	toolCallResult, formatErr := formatToolCallResult(result)
	if formatErr != nil {
		h.writeError(w, request.ID, -32603, "internal error", formatErr.Error())
		return
	}
	h.writeResult(w, request.ID, toolCallResult)
}

func (h *HTTPHandler) log(message string) {
	if h == nil || h.logger == nil {
		return
	}
	h.logger(message)
}

func formatToolCallResult(value any) (ToolCallResult, error) {
	switch typed := value.(type) {
	case nil:
		return ToolCallResult{Content: []TextContent{{Type: "text", Text: ""}}}, nil
	case string:
		return ToolCallResult{Content: []TextContent{{Type: "text", Text: typed}}}, nil
	case []ConnectedSession:
		structuredContent, err := toStructuredContentMap(map[string]any{"sessions": typed})
		if err != nil {
			return ToolCallResult{}, err
		}
		raw, err := json.MarshalIndent(typed, "", "  ")
		if err != nil {
			return ToolCallResult{}, err
		}
		return ToolCallResult{
			Content: []TextContent{{Type: "text", Text: string(raw)}},
			StructuredContent: structuredContent,
		}, nil
	case ReadFileResult:
		structuredContent, err := toStructuredContentMap(typed)
		if err != nil {
			return ToolCallResult{}, err
		}
		return ToolCallResult{
			Content: []TextContent{{Type: "text", Text: typed.NumberedContent}},
			StructuredContent: structuredContent,
		}, nil
	case ReadFileBatchResult:
		structuredContent, err := toStructuredContentMap(typed)
		if err != nil {
			return ToolCallResult{}, err
		}
		blocks := make([]string, 0, len(typed.Files))
		for _, file := range typed.Files {
			blocks = append(blocks, formatReadFileBlockText(file))
		}
		return ToolCallResult{
			Content: []TextContent{{Type: "text", Text: strings.Join(blocks, "\n\n")}},
			StructuredContent: structuredContent,
		}, nil
	case CommandExecutionResult:
		structuredContent, err := toStructuredContentMap(typed)
		if err != nil {
			return ToolCallResult{}, err
		}
		isError := typed.TimedOut
		if typed.ExitCode != nil && *typed.ExitCode != 0 {
			isError = true
		}
		return ToolCallResult{
			Content: []TextContent{{Type: "text", Text: typed.Output}},
			StructuredContent: structuredContent,
			IsError: isError,
		}, nil
	default:
		raw, err := json.MarshalIndent(typed, "", "  ")
		if err != nil {
			return ToolCallResult{}, err
		}
		return ToolCallResult{
			Content: []TextContent{{Type: "text", Text: string(raw)}},
		}, nil
	}
}

func formatReadFileBlockText(result ReadFileResult) string {
	if result.NumberedContent == "" {
		return result.Path
	}
	return result.Path + "\n" + result.NumberedContent
}

func toStructuredContentMap(value any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (h *HTTPHandler) writeResult(w http.ResponseWriter, id any, result any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(JSONRPCResultResponse{
		JSONRPC: "2.0",
		ID: id,
		Result: result,
	})
}

func (h *HTTPHandler) writeError(w http.ResponseWriter, id any, code int, message string, data any) {
	w.Header().Set("Content-Type", "application/json")
	statusCode := http.StatusBadRequest
	if code == -32601 {
		statusCode = http.StatusNotFound
	}
	if code == -32603 {
		statusCode = http.StatusInternalServerError
	}
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(JSONRPCErrorResponse{
		JSONRPC: "2.0",
		ID: id,
		Error: JSONRPCError{
			Code: code,
			Message: message,
			Data: normalizeErrorData(data),
		},
	})
}

func normalizeErrorData(data any) any {
	if data == nil {
		return nil
	}
	if err := asError(data); err != nil {
		return err.Error()
	}
	return data
}

func asError(data any) error {
	err, ok := data.(error)
	if !ok {
		return nil
	}
	return err
}