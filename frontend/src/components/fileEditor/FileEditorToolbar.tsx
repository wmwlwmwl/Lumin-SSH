import { AppWindow, ExternalLink, Save, SquarePen, X } from 'lucide-react';
import type React from 'react';
import { Z } from '../../constants/zIndex.ts';
import { useTranslation } from '../../i18n.ts';
import { cn } from '../../utils/cn.ts';
import Tiptop from '../Tiptop.tsx';
import { Button } from '../ui';
import { preferredExternalAppLabel, type FileEditorFile } from './fileEditorTypes.ts';

export interface FileEditorToolbarProps {
  mode: 'modal' | 'popup' | 'split';
  startPopupDrag?: (e: React.MouseEvent) => void;
  activeFile?: FileEditorFile;
  isModified: boolean;
  ext: string;
  splitPosition: 'left' | 'right' | 'bottom';
  onSplitPositionChange?: (position: string) => void;
  onModeChange?: (mode: string) => void;
  externalOpening: boolean;
  onOpenSystemEditor?: (file: FileEditorFile, content: string) => void;
  onOpenWithEditor?: (file: FileEditorFile, content: string, chooseApp: boolean) => void;
  currentContent: string;
  preferredExternalApp: string;
  setPreferredExternalApp: React.Dispatch<React.SetStateAction<string>>;
  saving: boolean;
  handleSave: () => Promise<void>;
  setMinimized: (min: boolean) => void;
  handleCloseAllEditors: () => Promise<void>;
  filesCount: number;
}

export function FileEditorToolbar({
  mode,
  startPopupDrag,
  activeFile,
  isModified,
  ext,
  splitPosition,
  onSplitPositionChange,
  onModeChange,
  externalOpening,
  onOpenSystemEditor,
  onOpenWithEditor,
  currentContent,
  preferredExternalApp,
  setPreferredExternalApp,
  saving,
  handleSave,
  setMinimized,
  handleCloseAllEditors,
  filesCount,
}: FileEditorToolbarProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'relative flex flex-wrap items-center justify-between gap-2 gap-y-1.5 min-w-0',
        mode === 'popup' ? 'cursor-move pt-2 pr-10 pb-1.5 pl-3' : 'pt-4 pr-[72px] pb-2 pl-4',
      )}
      onMouseDown={mode === 'popup' ? startPopupDrag : undefined}
    >
      <div className="flex flex-[1_1_140px] min-w-0 max-w-full items-center gap-2 overflow-hidden text-md font-semibold text-primary">
        <SquarePen size={14} className="shrink-0" />
        <span
          className="font-mono text-base truncate min-w-0"
          title={activeFile ? activeFile.name : t('编辑器')}
        >
          {activeFile ? activeFile.name : t('编辑器')}
        </span>
        {isModified && (
          <span className="text-xs bg-warning-dim text-warning px-2 py-0.5 rounded-sm font-medium shrink-0">
            {t('未保存')}
          </span>
        )}
      </div>
      <div className="flex flex-[1_1_auto] flex-wrap gap-1.5 items-center justify-end min-w-0">
        <span className="text-xs text-tertiary font-mono bg-sunken px-2 py-0.5 rounded-sm shrink-0">
          {ext || 'text'}
        </span>

        {mode === 'split' && (
          <Tiptop text={t('分栏位置')} placement="bottom">
            <select
              id="file-editor-split-position"
              name="file-editor-split-position"
              value={splitPosition}
              onChange={(e) => onSplitPositionChange && onSplitPositionChange(e.target.value)}
              aria-label={t('分栏位置')}
              className="px-1.5 py-1 text-xs cursor-pointer border-none bg-overlay text-primary rounded-md shrink-0 outline-none transition-colors duration-100 hover:bg-hover hover:text-primary"
            >
              <option value="left">{t('左侧分栏')}</option>
              <option value="right">{t('右侧分栏')}</option>
              <option value="bottom">{t('底部分栏')}</option>
            </select>
          </Tiptop>
        )}

        <Tiptop text={t('编辑模式')} placement="bottom">
          <select
            id="file-editor-edit-mode"
            name="file-editor-edit-mode"
            value={mode}
            onChange={(e) => onModeChange && onModeChange(e.target.value)}
            aria-label={t('编辑模式')}
            className="px-1.5 py-1 text-xs cursor-pointer border-none bg-overlay text-primary rounded-md shrink-0 outline-none transition-colors duration-100 hover:bg-hover hover:text-primary"
          >
            <option value="modal">{t('全屏弹窗')}</option>
            <option value="popup">{t('浮动面板')}</option>
            <option value="split">{t('分栏编辑')}</option>
          </select>
        </Tiptop>

        <Tiptop text={t('使用系统编辑器')} placement="bottom">
          <Button
            variant="ghost"
            size="sm"
            disabled={!activeFile || externalOpening || !onOpenSystemEditor}
            onClick={() => {
              if (activeFile) onOpenSystemEditor?.(activeFile, currentContent);
            }}
            aria-label={t('使用系统编辑器')}
            className="gap-1 px-2 py-1 max-w-full"
          >
            <ExternalLink size={13} className="shrink-0" />
            <span className="truncate">
              {t('使用系统编辑器')}
            </span>
          </Button>
        </Tiptop>

        <Tiptop
          text={preferredExternalApp
            ? `${t('用已记住的编辑器打开')} (${preferredExternalAppLabel(preferredExternalApp)})`
            : t('用…编辑')}
          placement="bottom"
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={!activeFile || externalOpening || !onOpenWithEditor}
            onClick={() => {
              if (activeFile) onOpenWithEditor?.(activeFile, currentContent, false);
              setTimeout(() => setPreferredExternalApp(preferredExternalApp), 0);
            }}
            aria-label={preferredExternalApp
              ? `${t('用已记住的编辑器打开')} (${preferredExternalAppLabel(preferredExternalApp)})`
              : t('用…编辑')}
            className="gap-1 px-2 py-1 min-w-0"
            style={{ maxWidth: preferredExternalApp ? 110 : undefined }}
          >
            <AppWindow size={13} className="shrink-0" />
            <span className="truncate min-w-0">
              {preferredExternalApp
                ? `${t('用')} ${preferredExternalAppLabel(preferredExternalApp)}`
                : t('用…编辑')}
            </span>
          </Button>
        </Tiptop>

        {preferredExternalApp && (
          <Tiptop text={t('更换外部编辑器')} placement="bottom">
            <Button
              variant="ghost"
              size="sm"
              disabled={!activeFile || externalOpening || !onOpenWithEditor}
              onClick={() => {
                if (activeFile) onOpenWithEditor?.(activeFile, currentContent, true);
                setTimeout(() => setPreferredExternalApp(preferredExternalApp), 0);
              }}
              aria-label={t('更换外部编辑器')}
              className="px-2 py-1"
            >
              {t('更换…')}
            </Button>
          </Tiptop>
        )}

        <Tiptop text={saving ? t('保存中...') : t('保存')} placement="bottom">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !isModified}
            aria-label={t('保存')}
            className="gap-1 px-2.5 py-1 min-h-7"
          >
            <Save size={13} className="shrink-0" />
            {saving ? t('保存中...') : t('保存')}
          </Button>
        </Tiptop>
      </div>

      {mode !== 'split' && (
        <Tiptop text={t('最小化')} placement="bottom" style={{ position: 'absolute', top: 8, right: 36, zIndex: Z.PANEL_BUTTON }}>
          <Button variant="ghost" size="icon" onClick={() => setMinimized(true)} aria-label={t('最小化')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </Button>
        </Tiptop>
      )}
      <Tiptop text={filesCount > 1 ? t('关闭全部') : t('关闭')} placement="bottom" style={{ position: 'absolute', top: 8, right: 8, zIndex: Z.PANEL_BUTTON }}>
        <Button variant="ghost" size="icon" onClick={() => void handleCloseAllEditors()} aria-label={filesCount > 1 ? t('关闭全部') : t('关闭')}>
          <X size={14} />
        </Button>
      </Tiptop>
    </div>
  );
}
