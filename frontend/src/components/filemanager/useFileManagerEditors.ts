import { useCallback } from 'react';
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js';
import { addOpeningFile, removeOpeningFile } from '../../utils/fileManagerHelpers.tsx';
import type { useFileManagerCore } from './useFileManagerCore.ts';
import type { useFileManagerEditorState } from './useFileManagerEditorState.ts';
import type { useFileManagerTransfers } from './useFileManagerTransfers.ts';
import type { FileManagerFileItem, FileManagerFileLike, FileManagerProps } from './fileManagerTypes.ts';

// 文件打开/编辑：内置编辑器缓冲、系统编辑器与指定外部编辑器打开、保存与关闭
export function useFileManagerEditors(deps: ReturnType<typeof useFileManagerCore> & ReturnType<typeof useFileManagerEditorState> & ReturnType<typeof useFileManagerTransfers> & {
  addToast?: FileManagerProps['addToast']
}) {
  const {
    sessionId, addToast, t, joinPath, currentPath,
    maxEditSizeMB, openingFilesRef,
    setEditorMode, setEditorSplitPosition,
    openEditFiles, setOpenEditFiles, openEditFilesRef, activeEditPath, setActiveEditPath,
    editorMode, defaultOpenMode, setExternalOpening,
  } = deps;
  const rememberExternalEditorPath = useCallback((path: unknown) => {
    const cleaned = String(path || '').trim();
    if (!cleaned) return;
    localStorage.setItem('fileEditorPreferredApp', cleaned);
    let recent: string[] = [];
    try {
      recent = JSON.parse(localStorage.getItem('fileEditorRecentApps') || '[]');
    } catch {
      recent = [];
    }
    if (!Array.isArray(recent)) recent = [];
    recent = [cleaned, ...recent.filter((item) => item !== cleaned)].slice(0, 5);
    localStorage.setItem('fileEditorRecentApps', JSON.stringify(recent));
  }, []);

  const openExternalEditor = useCallback(async (remotePath: string, content: unknown, editorPath = '', readOnly = false, size = 0) => {
    if (!sessionId || !remotePath) return false;
    // 下载前拦截大文件，避免把 GB 级文件读进内存后才报错（后端也会再校验一道）
    if (size && size > maxEditSizeMB * 1024 * 1024) {
      addToast?.(`${t('文件过大')} (${(size / 1024 / 1024).toFixed(1)}MB)，${t('最大支持 {size}MB 编辑', { size: maxEditSizeMB })}`, 'error');
      return false;
    }
    setExternalOpening(true);
    try {
      if (editorPath) {
        await AppGo.OpenRemoteFileWithEditor(sessionId, remotePath, String(content || ''), editorPath, readOnly);
        rememberExternalEditorPath(editorPath);
        addToast?.(t('已用外部编辑器打开'), 'success');
      } else {
        await AppGo.OpenRemoteFileInSystemEditor(sessionId, remotePath, String(content || ''), readOnly);
        addToast?.(t('已用系统编辑器打开'), 'success');
      }
      return true;
    } catch (err) {
      addToast?.(`${t('打开外部编辑器失败')}: ${err}`, 'error');
      return false;
    } finally {
      setExternalOpening(false);
    }
  }, [sessionId, addToast, t, rememberExternalEditorPath, maxEditSizeMB]);

  const handleOpenSystemEditor = useCallback(async (file: FileManagerFileLike, content: unknown, readOnly = false) => {
    const filePath = typeof file?.path === 'string' ? file.path : '';
    const fileContent = typeof file?.content === 'string' ? file.content : '';
    const fileSize = typeof file?.size === 'number' ? file.size : 0;
    if (!filePath) return;
    if (openingFilesRef.current.has(`${sessionId}:${filePath}`)) {
      addToast?.(t('文件正在打开中，请稍候...'), 'warning');
      return;
    }
    try {
      addOpeningFile(sessionId, filePath);
      addToast?.(t('正在打开文件...'), 'info');
      await openExternalEditor(filePath, content ?? fileContent, '', readOnly, fileSize);
    } finally {
      removeOpeningFile(sessionId, filePath);
    }
  }, [sessionId, openExternalEditor, addToast, t]);

  // forcePick=true：始终弹出选择框；false：有记忆路径则直接打开（对齐 electerm）
  const handleOpenWithEditor = useCallback(async (file: FileManagerFileLike, content: unknown, forcePick = false, readOnly = false) => {
    const filePath = typeof file?.path === 'string' ? file.path : '';
    const fileContent = typeof file?.content === 'string' ? file.content : '';
    const fileSize = typeof file?.size === 'number' ? file.size : 0;
    if (!filePath) return;
    if (openingFilesRef.current.has(`${sessionId}:${filePath}`)) {
      addToast?.(t('文件正在打开中，请稍候...'), 'warning');
      return;
    }
    try {
      addOpeningFile(sessionId, file.path);
      addToast?.(t('正在打开文件...'), 'info');
      let editorPath = '';
      if (!forcePick) {
        editorPath = (localStorage.getItem('fileEditorPreferredApp') || '').trim();
      }
      if (!editorPath) {
        editorPath = await AppGo.SelectExternalEditor();
        if (!editorPath) {
          addToast?.(t('未选择编辑器'), 'warning');
          return;
        }
      }
      const ok = await openExternalEditor(filePath, content ?? fileContent, editorPath, readOnly, fileSize);
      // 记忆路径失效时，自动再选一次
      if (!ok && !forcePick && (localStorage.getItem('fileEditorPreferredApp') || '').trim()) {
        localStorage.removeItem('fileEditorPreferredApp');
        const nextPath = await AppGo.SelectExternalEditor();
        if (nextPath) {
          await openExternalEditor(filePath, content ?? fileContent, nextPath, readOnly, fileSize);
        }
      }
    } catch (err) {
      addToast?.(`${t('打开外部编辑器失败')}: ${err}`, 'error');
    } finally {
      removeOpeningFile(sessionId, file.path);
    }
  }, [sessionId, openExternalEditor, addToast, t]);

  // Open file editor / external editor according to settings default.
  const handleEdit = async (item: FileManagerFileItem) => {
    const remotePath = joinPath(currentPath, item.name);

    if (openingFilesRef.current.has(`${sessionId}:${remotePath}`)) {
      addToast?.(t('文件正在打开中，请稍候...'), 'warning');
      return;
    }

    // 文件大小检查，避免加载过大文件导致卡顿
    if (item.size && item.size > maxEditSizeMB * 1024 * 1024) {
      addToast?.(`${t('文件过大')} (${(item.size / 1024 / 1024).toFixed(1)}MB)，${t('最大支持 {size}MB 编辑', { size: maxEditSizeMB })}`, 'error');
      return;
    }

    const openMode = ['builtin', 'system', 'external'].includes(defaultOpenMode) ? defaultOpenMode : 'builtin';
    if (openMode === 'system' || openMode === 'external') {
      try {
        // 不预读 content：传空让后端用原始字节写本地临时文件，避免 ReadFile 把非
        // UTF-8 文件（如 GBK 中文）强解为乱码。编辑器自己做编码检测。
        const file = { path: remotePath, name: item.name };
        if (openMode === 'system') {
          await handleOpenSystemEditor(file, '');
        } else {
          await handleOpenWithEditor(file, '', false);
        }
      } catch (err) {
        addToast?.(`${t('无法打开文件')}: ${err}`, 'error');
      }
      return;
    }

    // 如果文件已在打开列表中，直接激活
    if (openEditFiles.some(f => f.path === remotePath)) {
      setActiveEditPath(null);
      setTimeout(() => setActiveEditPath(remotePath), 0);
      return;
    }

    try {
      addOpeningFile(sessionId, remotePath);
      addToast?.(t('正在下载并打开文件...'), 'info');
      const content = await AppGo.ReadFile(sessionId, remotePath);
      const newFile = { path: remotePath, name: item.name, content };
      setOpenEditFiles(prev => [...prev, newFile]);
      setActiveEditPath(remotePath);
    } catch (err) {
      addToast?.(`${t('无法打开文件')}: ${err}`, 'error');
    } finally {
      removeOpeningFile(sessionId, remotePath);
    }
  };

  // Save file from editor
  const handleSaveFile = async (path: string, content: unknown) => {
    try {
      await AppGo.WriteFile(sessionId, path, String(content ?? ''));
      addToast?.(t('文件保存成功'), 'success');
      // 更新 openEditFiles 中对应文件的内容
      setOpenEditFiles(prev => prev.map(f => f.path === path ? { ...f, content: typeof content === 'string' ? content : String(content ?? '') } : f));
      // 只有弹窗模式才在保存后自动关闭编辑器，popup/split 保持打开
      if (editorMode === 'modal') {
        closeEditFile(path);
      }
    } catch (err) {
      addToast?.(`${t('保存失败')}: ${err}`, 'error');
    }
  };

  // 关闭单个文件
  const closeEditFile = (path: string) => {
    if (sessionId && path) {
      AppGo.StopExternalEdit(sessionId, path).catch(() => {});
    }
    const prev = openEditFilesRef.current;
    const next = prev.filter(f => f.path !== path);
    setOpenEditFiles(next);
    // 如果关闭的是当前激活文件，激活下一个
    if (activeEditPath === path) {
      const idx = prev.findIndex(f => f.path === path);
      const nextActive = next[idx] || next[idx - 1] || next[0] || null;
      setActiveEditPath(nextActive?.path || null);
    }
  };

  // 关闭所有文件
  const closeAllEditFiles = () => {
    const prev = openEditFilesRef.current;
    if (sessionId) {
      prev.forEach((file) => {
        if (file?.path) AppGo.StopExternalEdit(sessionId, file.path).catch(() => {});
      });
    }
    setOpenEditFiles([]);
    setActiveEditPath(null);
  };

  // 激活文件
  const activateEditFile = (path: string | null) => {
    setActiveEditPath(path);
  };

  const handleEditorModeChange = (mode: string) => {
    setEditorMode(mode);
    localStorage.setItem('fileEditorMode', mode);
  };

  const handleEditorSplitPositionChange = (pos: string) => {
    setEditorSplitPosition(pos);
    localStorage.setItem('editorSplitPosition', pos);
  };

  return {
    rememberExternalEditorPath,
    openExternalEditor,
    handleOpenSystemEditor,
    handleOpenWithEditor,
    handleEdit,
    handleSaveFile,
    closeEditFile,
    closeAllEditFiles,
    activateEditFile,
    handleEditorModeChange,
    handleEditorSplitPositionChange,
  };
}
