import { useEffect, useState } from 'react';
import { t as $t } from '../../../i18n.ts';
import { deleteProgramFont, getProgramFontAssignmentSnapshot, listProgramFonts, selectAndImportProgramFontFiles, setProgramFontPreference } from '../../../utils/programFonts.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

/** 程序字体管理：字体目录导入/删除/拖拽分配到界面、终端、AI 面板 */
export function useProgramFonts({ addToast }: { addToast: AddToast }) {
  const [programFonts, setProgramFonts] = useState<Array<{ fileName: string; displayName?: string }>>([]);
  const [programFontSearchQuery, setProgramFontSearchQuery] = useState('');
  const [programFontAssignments, setProgramFontAssignments] = useState(() => getProgramFontAssignmentSnapshot());
  const [programFontImporting, setProgramFontImporting] = useState(false);
  const [programFontDeleting, setProgramFontDeleting] = useState(false);
  const [activeProgramFontDropTarget, setActiveProgramFontDropTarget] = useState('');

  useEffect(() => {
    let cancelled = false;
    listProgramFonts()
      .then((fonts) => {
        if (cancelled) return;
        setProgramFonts(Array.isArray(fonts) ? fonts : []);
        setProgramFontAssignments(getProgramFontAssignmentSnapshot());
      })
      .catch(() => {
        if (cancelled) return;
        setProgramFonts([]);
        setProgramFontAssignments(getProgramFontAssignmentSnapshot());
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleProgramFontSettingsChange = () => {
      setProgramFontAssignments(getProgramFontAssignmentSnapshot());
    };
    window.addEventListener('program-font-settings-changed', handleProgramFontSettingsChange);
    return () => window.removeEventListener('program-font-settings-changed', handleProgramFontSettingsChange);
  }, []);

  const refreshProgramFonts = async () => {
    try {
      const fonts = await listProgramFonts();
      setProgramFonts(Array.isArray(fonts) ? fonts : []);
    } catch {
      setProgramFonts([]);
    }
    setProgramFontAssignments(getProgramFontAssignmentSnapshot());
  };

  const handleAddProgramFonts = async () => {
    setProgramFontImporting(true);
    try {
      const importedFonts = await selectAndImportProgramFontFiles();
      await refreshProgramFonts();
      if (Array.isArray(importedFonts) && importedFonts.length > 0) {
        addToast($t('字体已添加到字体目录'), 'success');
      }
    } catch (err) {
      addToast($t('字体导入失败') + ': ' + err, 'error');
    } finally {
      setProgramFontImporting(false);
    }
  };

  const handleDeleteProgramFont = async (fileName: string) => {
    const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : '';
    if (!normalizedFileName || programFontDeleting) {
      return;
    }
    setProgramFontDeleting(true);
    try {
      await deleteProgramFont(normalizedFileName);
      await refreshProgramFonts();
      addToast($t('字体已删除'), 'success');
    } catch (err) {
      addToast($t('字体删除失败') + ': ' + String(err), 'error');
    } finally {
      setProgramFontDeleting(false);
    }
  };

  const handleProgramFontDragStart = (event: React.DragEvent, fileName: string) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', fileName);
  };

  const handleProgramFontDragEnd = () => {
    setActiveProgramFontDropTarget('');
  };

  const handleProgramFontDragEnter = (target: string) => {
    setActiveProgramFontDropTarget(target);
  };

  const handleProgramFontDragLeave = (target: string) => {
    setActiveProgramFontDropTarget((current) => current === target ? '' : current);
  };

  const handleProgramFontDrop = async (target: string, fileName: string) => {
    const normalizedTarget = typeof target === 'string' ? target.trim() : '';
    const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : '';
    setActiveProgramFontDropTarget('');
    if (!normalizedTarget || !normalizedFileName) {
      return;
    }
    try {
      await setProgramFontPreference(normalizedTarget, normalizedFileName);
      setProgramFontAssignments(getProgramFontAssignmentSnapshot());
      addToast($t('字体分配已更新'), 'success');
    } catch (err) {
      addToast($t('字体分配失败') + ': ' + String(err), 'error');
    }
  };

  const handleProgramFontReset = async (target: string) => {
    const normalizedTarget = typeof target === 'string' ? target.trim() : '';
    if (!normalizedTarget) {
      return;
    }
    try {
      await setProgramFontPreference(normalizedTarget, '');
      setProgramFontAssignments(getProgramFontAssignmentSnapshot());
      addToast($t('已恢复默认字体'), 'success');
    } catch (err) {
      addToast($t('恢复默认字体失败') + ': ' + String(err), 'error');
    }
  };

  return {
    programFonts,
    programFontSearchQuery,
    setProgramFontSearchQuery,
    programFontAssignments,
    programFontImporting,
    programFontDeleting,
    activeProgramFontDropTarget,
    handleAddProgramFonts,
    handleDeleteProgramFont,
    handleProgramFontDragStart,
    handleProgramFontDragEnd,
    handleProgramFontDragEnter,
    handleProgramFontDragLeave,
    handleProgramFontDrop,
    handleProgramFontReset,
  };
}
