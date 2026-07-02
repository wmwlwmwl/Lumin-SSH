package mcpserver

type EditMatchFailure struct {
	Reason             string  `json:"reason"`
	Occurrences        int     `json:"occurrences,omitempty"`
	BestMatch          string  `json:"best_match,omitempty"`
	Similarity         float64 `json:"similarity,omitempty"`
	RequiredSimilarity float64 `json:"required_similarity,omitempty"`
}

type SearchReplaceResult struct {
	SessionID string `json:"session_id"`
	Path string `json:"path"`
	Handler string `json:"handler"`
	Capabilities RemoteEditCapabilities `json:"capabilities"`
	Occurrences int `json:"occurrences"`
	BytesWritten int `json:"bytes_written,omitempty"`
	Applied bool `json:"applied"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}

type EditFileResult struct {
	SessionID string `json:"session_id"`
	Path string `json:"path"`
	Handler string `json:"handler"`
	Capabilities RemoteEditCapabilities `json:"capabilities"`
	ExpectedReplacements int `json:"expected_replacements"`
	Occurrences int `json:"occurrences"`
	BytesWritten int `json:"bytes_written,omitempty"`
	Applied bool `json:"applied"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}

type SearchReplaceOperation struct {
	Search string `json:"search"`
	Replace string `json:"replace"`
}

type SearchReplaceOperationResult struct {
	Index int `json:"index"`
	Occurrences int `json:"occurrences"`
	Applied bool `json:"applied"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}

type SearchAndReplaceResult struct {
	SessionID string `json:"session_id"`
	Path string `json:"path"`
	Handler string `json:"handler"`
	Capabilities RemoteEditCapabilities `json:"capabilities"`
	BytesWritten int `json:"bytes_written,omitempty"`
	Applied bool `json:"applied"`
	OperationResults []SearchReplaceOperationResult `json:"operation_results"`
	Failure *EditMatchFailure `json:"failure,omitempty"`
}