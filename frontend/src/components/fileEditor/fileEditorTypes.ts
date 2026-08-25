export const EXTERNAL_PREFERRED_APP_KEY = 'fileEditorPreferredApp';

/** 文件编辑器条目（FileManager 打开的文件） */
export interface FileEditorFile {
  path: string;
  name: string;
  content: string;
}

export interface FileEditorProps {
  files: FileEditorFile[];
  activePath?: string;
  onSave: (path: string, content: string) => Promise<void> | void;
  onCloseFile: (path: string) => void;
  onCloseAll: () => void;
  onActivate: (path: string) => void;
  mode?: 'modal' | 'popup' | 'split';
  onModeChange?: (mode: string) => void;
  splitPosition?: 'left' | 'right' | 'bottom';
  onSplitPositionChange?: (position: string) => void;
  isActive?: boolean;
  workbenchSessionId?: string;
  workbenchOwnerId?: string;
  onOpenSystemEditor?: (file: FileEditorFile, content: string) => void;
  onOpenWithEditor?: (file: FileEditorFile, content: string, chooseApp: boolean) => void;
  externalOpening?: boolean;
}

export function readPreferredExternalApp() {
  return (localStorage.getItem(EXTERNAL_PREFERRED_APP_KEY) || '').trim();
}

export function preferredExternalAppLabel(path: string) {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const base = normalized.split('/').pop() || path;
  return base.replace(/\.exe$/i, '').replace(/\.app$/i, '');
}

export const POPUP_RESIZE_HANDLES: Array<{ dir: string; pos: Record<string, number>; cursor: string }> = [
  { dir: 'n',  pos: { top: 0, left: 0, right: 0, height: 6 }, cursor: 'n-resize' },
  { dir: 's',  pos: { bottom: 0, left: 0, right: 0, height: 6 }, cursor: 's-resize' },
  { dir: 'e',  pos: { right: 0, top: 0, bottom: 0, width: 6 }, cursor: 'e-resize' },
  { dir: 'w',  pos: { left: 0, top: 0, bottom: 0, width: 6 }, cursor: 'w-resize' },
  { dir: 'ne', pos: { top: 0, right: 0, width: 14, height: 14 }, cursor: 'ne-resize' },
  { dir: 'nw', pos: { top: 0, left: 0, width: 14, height: 14 }, cursor: 'nw-resize' },
  { dir: 'se', pos: { bottom: 0, right: 0, width: 14, height: 14 }, cursor: 'se-resize' },
  { dir: 'sw', pos: { bottom: 0, left: 0, width: 14, height: 14 }, cursor: 'sw-resize' },
];
