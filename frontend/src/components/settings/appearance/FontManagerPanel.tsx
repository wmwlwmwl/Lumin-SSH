import React from 'react';
import { t as $t } from '../../../i18n.ts';
import { Trash2 } from 'lucide-react';
import { cn } from '../../../utils/cn.ts';
import { Button } from '../../ui';
import { settings } from '../settingDefinitions';
import type { SettingsDefinitionNode } from '../SharedComponents';

/** 程序字体条目 */
export interface ProgramFont {
  fileName: string;
  displayName?: string;
}

export interface FontManagerPanelProps {
  programFonts: ProgramFont[];
  programFontSearchQuery: string;
  onProgramFontSearchQueryChange: (query: string) => void;
  onAddProgramFonts: () => void;
  programFontImporting: boolean;
  programFontDeleting: string | null;
  onDeleteProgramFont?: (fileName: string) => void;
  programFontAssignments: { uiFileName?: string; terminalFileName?: string; aiFileName?: string };
  onProgramFontDragStart: (event: React.DragEvent, fileName: string) => void;
  onProgramFontDragEnd: () => void;
  onProgramFontDragEnter: (key: string) => void;
  onProgramFontDragLeave: (key: string) => void;
  onProgramFontDrop: (key: string, fileName: string) => void;
  onProgramFontReset: (key: string) => void;
  activeProgramFontDropTarget: string | null;
}

export default function FontManagerPanel({
  programFonts,
  programFontSearchQuery,
  onProgramFontSearchQueryChange,
  onAddProgramFonts,
  programFontImporting,
  programFontDeleting,
  onDeleteProgramFont,
  programFontAssignments,
  onProgramFontDragStart,
  onProgramFontDragEnd,
  onProgramFontDragEnter,
  onProgramFontDragLeave,
  onProgramFontDrop,
  onProgramFontReset,
  activeProgramFontDropTarget,
}: FontManagerPanelProps) {
  const fontMap = new Map((Array.isArray(programFonts) ? programFonts : []).map((font) => [font.fileName, font]));
  const filteredFonts = (Array.isArray(programFonts) ? programFonts : []).filter((font) => {
    const query = String(programFontSearchQuery || '').trim().toLowerCase();
    if (!query) {
      return true;
    }
    return String(font.displayName || '').toLowerCase().includes(query) || String(font.fileName || '').toLowerCase().includes(query);
  });
  const fontAssignments = programFontAssignments || { uiFileName: '', terminalFileName: '', aiFileName: '' };
  // settingDefinitions.ts 已类型化，直接使用 settings 注册表
  const appearanceSettings = settings.appearance;
  const fontTargets = [
    {
      key: 'ui',
      title: $t('界面文本'),
      description: $t('作用于应用界面中的普通文本'),
      defaultText: 'Inter / Segoe UI / sans-serif',
      fileName: fontAssignments.uiFileName || '',
    },
    {
      key: 'terminal',
      title: $t('终端输出'),
      description: $t('只作用于终端输出区域，不影响界面控件'),
      defaultText: 'JetBrains Mono / Fira Code / monospace',
      fileName: fontAssignments.terminalFileName || '',
    },
    {
      key: 'ai',
      title: $t('AI面板'),
      description: $t('作用于 AI 面板普通文本与输入区，代码块保持默认等宽字体'),
      defaultText: 'Inter / Segoe UI / sans-serif',
      fileName: fontAssignments.aiFileName || '',
    },
  ];

  const fontTargetDefinitions: Record<string, SettingsDefinitionNode | undefined> = {
    ui: appearanceSettings.fields.uiFont,
    terminal: appearanceSettings.fields.terminalFont,
    ai: appearanceSettings.fields.aiFont,
  };

  return (
    <div data-settings-field-id={appearanceSettings.fields.fontManager.id} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base text-primary font-semibold">{$t('字体管理器')}</div>
          <div className="text-xs text-tertiary">{$t('从字体目录拖拽字体到右侧区域，为界面文本、终端输出和 AI 面板分别分配字体')}</div>
        </div>
        <Button size="sm" className="text-sm" onClick={onAddProgramFonts} disabled={programFontImporting}>
          {programFontImporting ? $t('导入中...') : $t('添加字体')}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4 items-stretch">
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center min-h-[22px] px-2 rounded-full border border-line bg-raised text-secondary text-xs">
              {$t('来源：字体目录')}
            </span>
            <span className="text-xs text-tertiary">{filteredFonts.length} {$t('个字体')}</span>
          </div>
          <input
            id="appearance-font-search"
            name="appearance-font-search"
            autoComplete="off"
            className="input min-h-[30px] text-sm"
            value={programFontSearchQuery}
            onChange={(event) => onProgramFontSearchQueryChange(event.target.value)}
            placeholder={$t('搜索字体文件名')}
          />
          <div className="min-h-[292px] max-h-[292px] overflow-y-auto rounded-md border border-line bg-canvas p-2 flex flex-col gap-2">
            {filteredFonts.length === 0 ? (
              <div className="flex flex-1 min-h-[120px] items-center justify-center text-center text-tertiary text-sm leading-[1.7]">
                {Array.isArray(programFonts) && programFonts.length > 0 ? $t('没有匹配的字体文件') : $t('字体目录中还没有字体，请先添加字体文件')}
              </div>
            ) : filteredFonts.map((font) => (
              <div
                key={font.fileName}
                draggable={true}
                onDragStart={(event) => onProgramFontDragStart(event, font.fileName)}
                onDragEnd={onProgramFontDragEnd}
                className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-line bg-overlay cursor-grab select-none"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="text-base font-semibold text-primary truncate">{font.displayName}</div>
                  <div className="text-xs text-tertiary truncate">{font.fileName}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={$t('删除字体')}
                  title={$t('删除字体')}
                  disabled={!!programFontDeleting}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDeleteProgramFont?.(font.fileName);
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  className="shrink-0 text-danger"
                  style={{ opacity: programFontDeleting ? 0.5 : 1 }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 min-w-0 self-stretch">
          {fontTargets.map((target) => {
            const assignedFont = target.fileName ? fontMap.get(target.fileName) : null;
            const isHighlighted = activeProgramFontDropTarget === target.key;
            return (
              <div
                key={target.key}
                data-settings-field-id={fontTargetDefinitions[target.key]?.id}
                onDragEnter={() => onProgramFontDragEnter(target.key)}
                onDragLeave={() => onProgramFontDragLeave(target.key)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  onProgramFontDragEnter(target.key);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const nextFileName = event.dataTransfer.getData('text/plain');
                  onProgramFontDrop(target.key, nextFileName);
                }}
                className={cn(
                  'rounded-md border p-3 min-h-[84px] flex-1 flex flex-col justify-between gap-2 min-w-0 transition-colors duration-[80ms]',
                  isHighlighted
                    ? 'border-accent bg-[rgba(var(--accent-rgb),0.08)] shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.18)]'
                    : 'border-line bg-canvas',
                )}
              >
                <div className="flex items-start justify-between gap-2.5 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-primary">{target.title}</div>
                    <div className="text-xs text-tertiary leading-[1.5] break-words">{target.description}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onProgramFontReset(target.key)}
                    disabled={!target.fileName}
                    className="text-sm shrink-0"
                  >
                    {$t('恢复默认')}
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="inline-flex items-center min-h-[22px] px-2 rounded-full border border-line bg-overlay text-primary text-xs font-semibold shrink-0">
                    {assignedFont ? assignedFont.displayName : $t('默认')}
                  </span>
                  <span className="text-xs text-tertiary truncate min-w-0 flex-1">
                    {assignedFont ? assignedFont.fileName : target.defaultText}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
