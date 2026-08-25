import { t as translate, type I18nKey } from '../../../i18n.ts';
import {
  commandRegex,
  normalizeAISlashCommands,
} from '../aiSlashCommands.ts';
import {
  mentionRegexGlobal,
} from '../aiMentions.ts';
import { compressImage } from '../aiImageCompression.ts';

export const maxComposerImages = 20;

export interface MentionMenuItem {
  kind: 'terminal' | 'type' | 'empty' | 'result' | 'slash_command';
  title: string;
  description?: string;
  mentionType?: 'file' | 'folder';
  path?: string;
  name?: string;
}

export interface MentionMenuState {
  open: boolean;
  query: string;
  selectedType: 'file' | 'folder' | null;
  items: MentionMenuItem[];
  loading: boolean;
  selectedIndex: number;
}

export interface SlashCommandMenuState {
  open: boolean;
  query: string;
  items: MentionMenuItem[];
  selectedIndex: number;
}

export interface TerminalAssignmentCandidate {
  sessionId: string;
  label: string;
  busy: boolean;
  cwd: string;
  current: boolean;
  recommended: boolean;
}

export const defaultMentionMenuState: MentionMenuState = {
  open: false,
  query: '',
  selectedType: null,
  items: [],
  loading: false,
  selectedIndex: -1,
};

export const defaultSlashCommandMenuState: SlashCommandMenuState = {
  open: false,
  query: '',
  items: [],
  selectedIndex: -1,
};

export function createMentionMenuState(patch: Partial<MentionMenuState> = {}) {
  return {
    ...defaultMentionMenuState,
    ...patch,
  };
}

export function escapeComposerHighlightHTML(value: string) {
  return String(value || '').replace(/[<>&]/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      default:
        return character;
    }
  });
}

export function buildComposerContextHighlightHTML(value: string, slashCommands: unknown) {
  const sourceText = typeof value === 'string' ? value : '';
  let escapedText = escapeComposerHighlightHTML(sourceText.replace(/\n$/u, '\n\n'));
  mentionRegexGlobal.lastIndex = 0;
  escapedText = escapedText.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>');

  const normalizedSlashCommands = normalizeAISlashCommands(slashCommands);
  const slashCommandMatch = sourceText.match(commandRegex);
  if (slashCommandMatch) {
    const visibleCommandToken = slashCommandMatch[2];
    const matchedCommand = normalizedSlashCommands.find((command: { name: string }) => command.name.toLowerCase() === slashCommandMatch[3].toLowerCase());
    if (matchedCommand) {
      escapedText = escapedText.replace(
        commandRegex,
        `${slashCommandMatch[1]}<mark class="mention-context-textarea-highlight">${visibleCommandToken}</mark>`,
      );
    }
  }

  return escapedText;
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error(translate('读取图片失败')));
    reader.readAsDataURL(file);
  });
}

export async function readAndCompressImageFile(file: File) {
  const originalData = await readFileAsDataUrl(file);
  try {
    const result = await compressImage(originalData);
    if (result.compressedSize >= result.originalSize) {
      return originalData;
    }
    return result.data;
  } catch {
    return originalData;
  }
}

export function createTopLevelMentionItems(currentCwd: string) {
  const path = currentCwd || '/';
  return [
    {
      kind: 'terminal',
      title: translate('终端'),
      description: translate('插入当前会话终端输出'),
    },
    {
      kind: 'type',
      mentionType: 'file',
      title: translate('文件'),
      description: translate('搜索 {path} 下的远端文件').replace('{path}', path),
    },
    {
      kind: 'type',
      mentionType: 'folder',
      title: translate('文件夹'),
      description: translate('搜索 {path} 下的远端文件夹').replace('{path}', path),
    },
  ] as MentionMenuItem[];
}

export function filterTopLevelMentionItems(items: MentionMenuItem[], query: string) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }
  return items.filter((item) => {
    const haystacks = [item.title, item.description].filter(Boolean).map((value) => String(value).toLowerCase());
    return haystacks.some((value) => value.includes(normalizedQuery));
  });
}

export function buildEmptyMentionItems(selectedType: 'file' | 'folder' | null): MentionMenuItem[] {
  if (selectedType === 'file') {
    return [{ kind: 'empty', title: translate('未找到文件'), description: translate('尝试其他关键词或输入绝对路径') }];
  }
  if (selectedType === 'folder') {
    return [{ kind: 'empty', title: translate('未找到文件夹'), description: translate('尝试其他关键词或输入绝对路径') }];
  }
  return [{ kind: 'empty', title: translate('未找到结果'), description: translate('尝试其他关键词') }];
}

export function translateTerminalAssignmentError(message: string, t: (key: I18nKey) => string) {
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';
  if (!normalizedMessage) {
    return t('终端指派失败');
  }
  return t(normalizedMessage as I18nKey);
}

export function buildQuotedComposerText(selectedText: string, currentValue: string, selectionStart: number, selectionEnd: number) {
  const normalizedSelectedText = typeof selectedText === 'string' ? selectedText.trim() : '';
  if (!normalizedSelectedText) {
    return null;
  }
  const safeCurrentValue = typeof currentValue === 'string' ? currentValue : '';
  const safeSelectionStart = Number.isFinite(selectionStart) ? selectionStart : safeCurrentValue.length;
  const safeSelectionEnd = Number.isFinite(selectionEnd) ? selectionEnd : safeSelectionStart;
  const prefix = safeCurrentValue.slice(0, safeSelectionStart);
  const suffix = safeCurrentValue.slice(safeSelectionEnd);
  const quoteBody = normalizedSelectedText
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  const separator = '-----';
  const prefixSpacer = prefix && !prefix.endsWith('\n') ? '\n' : '';
  const suffixSpacer = suffix && !suffix.startsWith('\n') ? '\n' : '';
  const insertion = `${prefixSpacer}${quoteBody}\n${separator}\n${suffixSpacer}`;
  return {
    nextValue: `${prefix}${insertion}${suffix}`,
    nextCursorPosition: prefix.length + insertion.length - suffixSpacer.length,
  };
}
