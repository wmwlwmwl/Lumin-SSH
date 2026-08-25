// Track files currently being downloaded/opened
export const globalOpeningFiles = new Set<string>();
export const globalOpeningListeners = new Set<(files: Set<string>) => void>();
// key -> safety-timeout id, so removeOpeningFile can clear pending timers
export const globalOpeningTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function addOpeningFile(sessionId: unknown, path: unknown) {
  if (!sessionId || !path) return;
  const key = `${sessionId}:${path}`;
  globalOpeningFiles.add(key);
  notifyOpeningListeners();

  // 5-minute safety timeout to prevent permanent lock leakage in case of backend hang.
  // Defensive: replace any stale timer for this key before scheduling a new one.
  if (globalOpeningTimers.has(key)) {
    clearTimeout(globalOpeningTimers.get(key));
  }
  const timer = setTimeout(() => {
    globalOpeningTimers.delete(key);
    if (globalOpeningFiles.has(key)) {
      globalOpeningFiles.delete(key);
      notifyOpeningListeners();
    }
  }, 5 * 60 * 1000);
  globalOpeningTimers.set(key, timer);
}

export function removeOpeningFile(sessionId: unknown, path: unknown) {
  if (!sessionId || !path) return;
  const key = `${sessionId}:${path}`;
  // Cancel the pending safety-timeout so normal fast opens leave no dangling timer
  if (globalOpeningTimers.has(key)) {
    clearTimeout(globalOpeningTimers.get(key));
    globalOpeningTimers.delete(key);
  }
  globalOpeningFiles.delete(key);
  notifyOpeningListeners();
}

export function notifyOpeningListeners() {
  const currentSet = new Set(globalOpeningFiles);
  globalOpeningListeners.forEach(listener => listener(currentSet));
}
