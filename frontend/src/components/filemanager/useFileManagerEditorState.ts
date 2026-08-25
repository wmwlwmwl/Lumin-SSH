import { useState, useEffect, useRef } from 'react';
import type { FileEditorFile } from '../FileEditor.tsx';
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { FileManagerChmodTarget, FileManagerFileItem } from './fileManagerTypes.ts';

// 内联编辑器状态：重命名项、chmod 目标、已打开编辑文件、编辑器布局偏好
export function useFileManagerEditorState(deps: ReturnType<typeof useFileManagerCore>) {
  const { sessionId } = deps;
  const [renamingItem, setRenamingItem] = useState<FileManagerFileItem | null>(null);
  // 跟踪重命名 input 是否仍挂在 DOM：Virtuoso 把行滚出视口会卸载 input，此时
  // renamingItem 仍残留。F2 入口据此判断是否需要先提交残留的重命名再继续。
  const renamingInputMountedRef = useRef<HTMLInputElement | null>(null);
  const [chmodTarget, setChmodTarget] = useState<FileManagerChmodTarget | null>(null); // { item, path, mode, includeSubdirectories, showIncludeSubdirectories }
  const [openEditFiles, setOpenEditFiles] = useState<FileEditorFile[]>([]);      // [{ path, name, content }]
  const openEditFilesRef = useRef<FileEditorFile[]>([]);
  useEffect(() => { openEditFilesRef.current = openEditFiles; }, [openEditFiles]);
  const [activeEditPath, setActiveEditPath] = useState<string | null>(null);  // 当前激活的文件路径
  useEffect(() => {
    if (!sessionId) return;
    window.__luminEditorStates = window.__luminEditorStates || {};
    window.__luminEditorStates[sessionId] = {
      openFilePaths: openEditFiles.map((file) => file?.path).filter(Boolean),
      activeFilePath: activeEditPath || '',
    };
  }, [activeEditPath, openEditFiles, sessionId]);
  useEffect(() => {
    return () => {
      if (sessionId && window.__luminEditorStates) {
        delete window.__luminEditorStates[sessionId];
      }
    };
  }, [sessionId]);
  const [editorMode, setEditorMode] = useState(() => localStorage.getItem('fileEditorMode') || 'modal');
  const [editorSplitPosition, setEditorSplitPosition] = useState(() => localStorage.getItem('editorSplitPosition') || 'right');
  const [defaultOpenMode, setDefaultOpenMode] = useState(() => {
    const mode = localStorage.getItem('fileManagerDefaultOpenMode') || 'builtin';
    return ['builtin', 'system', 'external'].includes(mode) ? mode : 'builtin';
  });
  const [externalOpening, setExternalOpening] = useState(false);

  useEffect(() => {
    const onMode = (event: Event) => {
      const mode = (event as CustomEvent).detail;
      if (['builtin', 'system', 'external'].includes(mode)) {
        setDefaultOpenMode(mode);
      }
    };
    window.addEventListener('file-manager-default-open-mode-changed', onMode);
    return () => window.removeEventListener('file-manager-default-open-mode-changed', onMode);
  }, []);
  return {
    renamingItem, setRenamingItem, renamingInputMountedRef,
    chmodTarget, setChmodTarget,
    openEditFiles, setOpenEditFiles, openEditFilesRef,
    activeEditPath, setActiveEditPath,
    editorMode, setEditorMode, editorSplitPosition, setEditorSplitPosition,
    defaultOpenMode, setDefaultOpenMode,
    externalOpening, setExternalOpening,
  };
}
