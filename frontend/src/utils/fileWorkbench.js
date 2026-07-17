const WORKBENCH_STATE_KEY = '__luminFileWorkbenchState';
const UPLOAD_QUEUE_STATE_KEY = '__luminFileUploadQueueState';
const FILE_MANAGER_WORKSPACE_STATE_KEY = '__luminFileManagerWorkspaceState';
const FILE_MANAGER_WORKSPACE_CHANGED_EVENT = 'lumin-file-manager-workspace-changed';

function getRoot() {
  if (typeof window !== 'undefined') return window;
  return globalThis;
}

function normalizeSessionGroupId(sessionGroupId) {
  return String(sessionGroupId || 'default');
}

function workbenchEventName(sessionGroupId) {
  return `lumin-file-workbench:${normalizeSessionGroupId(sessionGroupId)}`;
}

function uploadQueueEventName(sessionGroupId) {
  return `lumin-file-upload-queue:${normalizeSessionGroupId(sessionGroupId)}`;
}

function fileManagerWorkspaceEventName(sessionId) {
  return `lumin-file-manager-workspace:${normalizeSessionGroupId(sessionId)}`;
}

function ensureWorkbenchStore() {
  const root = getRoot();
  if (!root[WORKBENCH_STATE_KEY]) root[WORKBENCH_STATE_KEY] = {};
  return root[WORKBENCH_STATE_KEY];
}

function ensureUploadQueueStore() {
  const root = getRoot();
  if (!root[UPLOAD_QUEUE_STATE_KEY]) root[UPLOAD_QUEUE_STATE_KEY] = {};
  return root[UPLOAD_QUEUE_STATE_KEY];
}

function ensureFileManagerWorkspaceStore() {
  const root = getRoot();
  if (!root[FILE_MANAGER_WORKSPACE_STATE_KEY]) root[FILE_MANAGER_WORKSPACE_STATE_KEY] = {};
  return root[FILE_MANAGER_WORKSPACE_STATE_KEY];
}

function normalizeFileManagerTabPath(path) {
  const trimmed = String(path || '').trim();
  if (!trimmed) return '';
  const normalizedSlashes = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/');
  const parts = [];
  normalizedSlashes.split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') {
      if (parts.length > 0) parts.pop();
      return;
    }
    parts.push(part);
  });
  return parts.length > 0 ? `/${parts.join('/')}` : '/';
}

function normalizeFileManagerWorkspaceState(state) {
  const source = state && typeof state === 'object' ? state : {};
  const tabs = Array.isArray(source.tabs)
    ? source.tabs
      .map((tab) => {
        if (!tab || typeof tab !== 'object') return null;
        const id = String(tab.id || '').trim();
        if (!id) return null;
        return {
          id,
          path: normalizeFileManagerTabPath(tab.path),
          sortField: typeof tab.sortField === 'string' ? tab.sortField : 'name',
          sortDir: tab.sortDir === 'desc' ? 'desc' : 'asc',
          selectedPaths: Array.isArray(tab.selectedPaths) ? tab.selectedPaths.filter((item) => typeof item === 'string') : [],
          scrollTop: Number.isFinite(Number(tab.scrollTop)) ? Number(tab.scrollTop) : 0,
        };
      })
      .filter(Boolean)
    : [];
  const activeTabId = typeof source.activeTabId === 'string' ? source.activeTabId.trim() : '';
  return {
    activeTabId: tabs.some((tab) => tab.id === activeTabId) ? activeTabId : (tabs[0]?.id || ''),
    tabs,
  };
}

export function getSessionWorkbenchState(sessionGroupId) {
  const store = ensureWorkbenchStore();
  const key = normalizeSessionGroupId(sessionGroupId);
  return {
    activeTab: 'upload',
    uploadOpen: false,
    editorSplitOpen: false,
    editorOwnerId: '',
    ...(store[key] || {}),
  };
}

export function setSessionWorkbenchState(sessionGroupId, patch) {
  const root = getRoot();
  const store = ensureWorkbenchStore();
  const key = normalizeSessionGroupId(sessionGroupId);
  const current = getSessionWorkbenchState(key);
  const nextPatch = typeof patch === 'function' ? patch(current) : patch;
  const next = { ...current, ...(nextPatch || {}) };
  store[key] = next;
  root.dispatchEvent(new CustomEvent(workbenchEventName(key), { detail: next }));
  return next;
}

export function subscribeSessionWorkbenchState(sessionGroupId, callback) {
  const root = getRoot();
  const key = normalizeSessionGroupId(sessionGroupId);
  const handler = (event) => callback(event.detail);
  callback(getSessionWorkbenchState(key));
  root.addEventListener(workbenchEventName(key), handler);
  return () => root.removeEventListener(workbenchEventName(key), handler);
}

export function getSessionUploadQueue(sessionGroupId) {
  const store = ensureUploadQueueStore();
  const key = normalizeSessionGroupId(sessionGroupId);
  return Array.isArray(store[key]) ? store[key] : [];
}

export function updateSessionUploadQueue(sessionGroupId, updater) {
  const root = getRoot();
  const store = ensureUploadQueueStore();
  const key = normalizeSessionGroupId(sessionGroupId);
  const current = getSessionUploadQueue(key);
  const next = typeof updater === 'function' ? updater(current) : updater;
  store[key] = Array.isArray(next) ? next : [];
  root.dispatchEvent(new CustomEvent(uploadQueueEventName(key), { detail: store[key] }));
  return store[key];
}

export function subscribeSessionUploadQueue(sessionGroupId, callback) {
  const root = getRoot();
  const key = normalizeSessionGroupId(sessionGroupId);
  const handler = (event) => callback(event.detail);
  callback(getSessionUploadQueue(key));
  root.addEventListener(uploadQueueEventName(key), handler);
  return () => root.removeEventListener(uploadQueueEventName(key), handler);
}

export function getSessionFileManagerWorkspace(sessionId) {
  const store = ensureFileManagerWorkspaceStore();
  const key = normalizeSessionGroupId(sessionId);
  return normalizeFileManagerWorkspaceState(store[key]);
}

export function setSessionFileManagerWorkspace(sessionId, patch) {
  const root = getRoot();
  const store = ensureFileManagerWorkspaceStore();
  const key = normalizeSessionGroupId(sessionId);
  const current = getSessionFileManagerWorkspace(key);
  const nextPatch = typeof patch === 'function' ? patch(current) : patch;
  const next = normalizeFileManagerWorkspaceState(nextPatch);
  store[key] = next;
  root.dispatchEvent(new CustomEvent(fileManagerWorkspaceEventName(key), { detail: next }));
  root.dispatchEvent(new CustomEvent(FILE_MANAGER_WORKSPACE_CHANGED_EVENT, {
    detail: { sessionId: key, workspace: next },
  }));
  return next;
}

export function subscribeSessionFileManagerWorkspace(sessionId, callback) {
  const root = getRoot();
  const key = normalizeSessionGroupId(sessionId);
  const handler = (event) => callback(event.detail);
  callback(getSessionFileManagerWorkspace(key));
  root.addEventListener(fileManagerWorkspaceEventName(key), handler);
  return () => root.removeEventListener(fileManagerWorkspaceEventName(key), handler);
}

export function getAllSessionFileManagerWorkspaces() {
  const store = ensureFileManagerWorkspaceStore();
  return Object.fromEntries(
    Object.entries(store).map(([key, value]) => [key, normalizeFileManagerWorkspaceState(value)]),
  );
}

export function replaceAllSessionFileManagerWorkspaces(nextState) {
  const root = getRoot();
  const currentStore = ensureFileManagerWorkspaceStore();
  const previousKeys = Object.keys(currentStore);
  const normalized = {};
  Object.entries(nextState && typeof nextState === 'object' ? nextState : {}).forEach(([key, value]) => {
    normalized[normalizeSessionGroupId(key)] = normalizeFileManagerWorkspaceState(value);
  });
  root[FILE_MANAGER_WORKSPACE_STATE_KEY] = normalized;
  const changedKeys = new Set([...previousKeys, ...Object.keys(normalized)]);
  changedKeys.forEach((key) => {
    root.dispatchEvent(new CustomEvent(fileManagerWorkspaceEventName(key), {
      detail: getSessionFileManagerWorkspace(key),
    }));
  });
  root.dispatchEvent(new CustomEvent(FILE_MANAGER_WORKSPACE_CHANGED_EVENT, {
    detail: { sessionIds: Array.from(changedKeys), workspaces: normalized },
  }));
  return normalized;
}

export function remapSessionFileManagerWorkspaces(idMap) {
  const sourceMap = idMap && typeof idMap === 'object' ? idMap : {};
  const current = getAllSessionFileManagerWorkspaces();
  const remapped = {};
  Object.entries(current).forEach(([sessionId, state]) => {
    const mappedId = normalizeSessionGroupId(sourceMap[sessionId] || sessionId);
    remapped[mappedId] = normalizeFileManagerWorkspaceState(state);
  });
  return replaceAllSessionFileManagerWorkspaces(remapped);
}
