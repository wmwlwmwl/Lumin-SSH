package mcpserver

import "errors"

const (
	EditHandlerFileProviderFallback = "file_provider_fallback"
	EditHandlerPython3AtomicPatch = "python3_atomic_patch"
)

var ErrRemoteEditUnsupported = errors.New("remote edit executor unsupported")

type RemoteEditCapabilities struct {
	Python3 bool `json:"python3"`
	Perl bool `json:"perl"`
	Patch bool `json:"patch"`
	Flock bool `json:"flock"`
}

type RemoteEditExecutor interface {
	GetCapabilities(sessionID string) (RemoteEditCapabilities, error)
	ApplyPatchAtomic(sessionID string, operations []ApplyPatchFileOperation) (ApplyPatchResult, error)
}

func getRemoteEditCapabilities(executor RemoteEditExecutor, sessionID string) RemoteEditCapabilities {
	if executor == nil {
		return RemoteEditCapabilities{}
	}
	capabilities, err := executor.GetCapabilities(sessionID)
	if err != nil {
		return RemoteEditCapabilities{}
	}
	return capabilities
}