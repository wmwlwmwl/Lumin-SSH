package transfer

import (
	"context"
	"testing"
)

func TestReleaseCompressedUploadSlotRemovesIdleLimiter(t *testing.T) {
	service := NewService(nil, nil)
	sessionID := "slot-leak-test"
	service.compressedSlots.Delete(sessionID)

	limiter, err := service.acquireCompressedUploadSlot(sessionID, 1, context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := service.compressedSlots.Load(sessionID); !ok {
		t.Fatal("limiter should be stored while active")
	}
	service.releaseCompressedUploadSlot(sessionID, limiter)
	if _, ok := service.compressedSlots.Load(sessionID); ok {
		t.Fatal("idle limiter should be deleted from map")
	}
}
