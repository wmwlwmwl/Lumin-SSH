package mcpserver

func firstPatchFailure(result ApplyPatchResult) *EditMatchFailure {
	if result.Failure != nil {
		return result.Failure
	}
	for _, change := range result.Changes {
		if change.Failure != nil {
			return change.Failure
		}
	}
	return &EditMatchFailure{Reason: "remote patch failed"}
}