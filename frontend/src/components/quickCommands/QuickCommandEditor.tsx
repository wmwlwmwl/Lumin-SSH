import { useRef } from 'react';
import type React from 'react';
import { Rocket } from 'lucide-react';
import { useTranslation } from '../../i18n.ts';
import { Button } from '../ui';
import { inputClass } from './quickCommandTypes.ts';

export interface QuickCommandEditorProps {
  cmdEditorText: string;
  setCmdEditorText: (text: string) => void;
  cmdEditorAddCR: boolean;
  setCmdEditorAddCR: (addCR: boolean) => void;
  cmdEditorClearAfterSend: boolean;
  setCmdEditorClearAfterSend: (clear: boolean) => void;
  cmdEditorShowOpts: boolean;
  setCmdEditorShowOpts: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCmdEditor: (show: boolean) => void;
  sendEditorCommand: () => void;
  sendTarget: 'current' | 'all';
  setSendTarget: (target: 'current' | 'all') => void;
  connectedSessions: Array<{ id: string }>;
}

export function QuickCommandEditor({
  cmdEditorText,
  setCmdEditorText,
  cmdEditorAddCR,
  setCmdEditorAddCR,
  cmdEditorClearAfterSend,
  setCmdEditorClearAfterSend,
  cmdEditorShowOpts,
  setCmdEditorShowOpts,
  setShowCmdEditor,
  sendEditorCommand,
  sendTarget,
  setSendTarget,
  connectedSessions,
}: QuickCommandEditorProps) {
  const { t } = useTranslation();
  const cmdEditorOptsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="p-3 flex-1 min-h-0 flex">
        <textarea
          id="qc-cmd-editor"
          name="qc-cmd-editor"
          value={cmdEditorText}
          onChange={(e) => setCmdEditorText(e.target.value)}
          autoFocus
          spellCheck={false}
          placeholder={t('在此输入要发送的命令…')}
          className={`${inputClass} flex-1 min-h-0 resize-none font-mono text-base leading-[1.55]`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setShowCmdEditor(false);
              setCmdEditorShowOpts(false);
              return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              sendEditorCommand();
            }
          }}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-t border-line-subtle shrink-0 relative">
        <div className="relative" ref={cmdEditorOptsRef}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCmdEditorShowOpts((v) => !v)}
          >
            {t('选项')}
          </Button>
          {cmdEditorShowOpts && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute left-0 bottom-[calc(100%+6px)] z-[2] min-w-[190px] px-2.5 py-2 bg-overlay border border-line rounded-md shadow-md flex flex-col gap-2"
            >
              <div className="text-xs text-muted select-none">
                {t('按Ctrl+Enter发送')}
              </div>
              <label className="flex items-center gap-1.5 text-sm text-primary cursor-pointer">
                <input
                  type="checkbox"
                  name="qc-clear-after-send"
                  checked={cmdEditorClearAfterSend}
                  onChange={(e) => setCmdEditorClearAfterSend(e.target.checked)}
                  className="accent-success"
                />
                {t('发送后清空')}
              </label>
              <label className="flex items-center gap-1.5 text-sm text-primary cursor-pointer">
                <input
                  type="checkbox"
                  name="qc-add-cr-editor"
                  checked={cmdEditorAddCR}
                  onChange={(e) => setCmdEditorAddCR(e.target.checked)}
                  className="accent-success"
                />
                {t('末尾添加回车符CR')}
              </label>
            </div>
          )}
        </div>
        <div className="flex-1" />
        <span className="text-xs text-muted">{t('发送到')}</span>
        <select
          id="qc-send-target-editor"
          name="qc-send-target-editor"
          value={sendTarget}
          onChange={(e) => setSendTarget(e.target.value as 'current' | 'all')}
          className="text-xs px-2 py-[3px] rounded-xs bg-sunken border border-line text-primary outline-none cursor-pointer"
        >
          <option value="current">{t('当前会话')}</option>
          {connectedSessions.length > 1 && (
            <option value="all">{t('全部会话')} ({connectedSessions.length})</option>
          )}
        </select>
        <Button
          variant="primary"
          size="sm"
          onClick={sendEditorCommand}
          disabled={!cmdEditorText.trim()}
        >
          <Rocket size={14} /> {t('发送')}
        </Button>
      </div>
    </div>
  );
}
