import { X } from 'lucide-react';
import type { FileEditorFile } from './fileEditorTypes.ts';

export interface FileEditorTabsProps {
  files: FileEditorFile[];
  activeFile?: FileEditorFile;
  editedContents: Record<string, string>;
  onActivate: (path: string) => void;
  closeFileWithConfirm: (path: string) => Promise<void>;
}

export function FileEditorTabs({
  files,
  activeFile,
  editedContents,
  onActivate,
  closeFileWithConfirm,
}: FileEditorTabsProps) {
  if (files.length <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 px-2 pt-1 border-b border-line bg-overlay overflow-x-auto shrink-0">
      {files.map((f) => {
        const isActive = f.path === activeFile?.path;
        const fEdited = editedContents[f.path];
        const fModified = fEdited !== undefined && fEdited !== f.content;
        return (
          <div
            key={f.path}
            className={`terminal-sub-tab font-mono py-[5px] px-3 ${isActive ? 'active' : ''}`}
            onClick={() => onActivate(f.path)}
          >
            <span>{f.name}{fModified ? ' ●' : ''}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                void closeFileWithConfirm(f.path);
              }}
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-xs cursor-pointer text-[10px] opacity-50 hover:opacity-100"
            >
              <X size={10} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
