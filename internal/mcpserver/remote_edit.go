package mcpserver

import (
	"context"
	"errors"
)

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

type CancelableRemoteEditExecutor interface {
	GetCapabilitiesContext(ctx context.Context, sessionID string) (RemoteEditCapabilities, error)
	ApplyPatchAtomicContext(ctx context.Context, sessionID string, operations []ApplyPatchFileOperation) (ApplyPatchResult, error)
}

func getRemoteEditCapabilities(executor RemoteEditExecutor, sessionID string) RemoteEditCapabilities {
	return getRemoteEditCapabilitiesWithContext(executor, context.Background(), sessionID)
}

func getRemoteEditCapabilitiesWithContext(executor RemoteEditExecutor, ctx context.Context, sessionID string) RemoteEditCapabilities {
	if executor == nil {
		return RemoteEditCapabilities{}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var (
		capabilities RemoteEditCapabilities
		err error
	)
	if cancelableExecutor, ok := executor.(CancelableRemoteEditExecutor); ok {
		capabilities, err = cancelableExecutor.GetCapabilitiesContext(ctx, sessionID)
	} else {
		select {
		case <-ctx.Done():
			return RemoteEditCapabilities{}
		default:
			capabilities, err = executor.GetCapabilities(sessionID)
		}
	}
	if err != nil {
		return RemoteEditCapabilities{}
	}
	return capabilities
}

func applyPatchAtomicWithContext(executor RemoteEditExecutor, ctx context.Context, sessionID string, operations []ApplyPatchFileOperation) (ApplyPatchResult, error) {
	if executor == nil {
		return ApplyPatchResult{}, ErrRemoteEditUnsupported
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if cancelableExecutor, ok := executor.(CancelableRemoteEditExecutor); ok {
		return cancelableExecutor.ApplyPatchAtomicContext(ctx, sessionID, operations)
	}
	select {
	case <-ctx.Done():
		return ApplyPatchResult{}, ctx.Err()
	default:
		return executor.ApplyPatchAtomic(sessionID, operations)
	}
}