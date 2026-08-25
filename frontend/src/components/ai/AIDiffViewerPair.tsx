import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { I18nKey } from '../../i18n.ts';
import {
  DIFF_EDITOR_BASE_OPTIONS,
  ensureMonacoConfigured,
  monaco,
  normalizeText,
  resolveLanguageFromPath,
  buildModelPath,
  resolveMonacoThemeName,
} from './aiDiffViewerMonaco.ts';

ensureMonacoConfigured();

function buildLoadingNode(text: string) {
  return (
    <div className="h-full flex items-center justify-center bg-canvas text-secondary text-sm">
      {text}
    </div>
  );
}

/** AI 审阅返回的差异块（字段来自 AI 响应，可能缺失，访问处均有防御） */
interface ReviewBlock {
  before?: string;
  after?: string;
  startLine?: number;
  matchedStartLine?: number;
  label?: string;
  labelParams?: Record<string, unknown>;
}

/** 变更导航目标（monaco 0.56 goToDiff 支持 next/previous） */
export type DiffNavigateTarget = 'next' | 'previous';

/** 导航函数句柄（可被置空以释放） */
type DiffNavigateHandler = (target: DiffNavigateTarget) => void;

export interface DiffEditorPairProps {
  block?: unknown;
  index?: number;
  path?: string;
  reviewId?: string;
  showBlockBadge?: boolean;
  t: (key: I18nKey, vars?: Record<string, unknown>) => string;
  /** 首个差异块就绪时把导航函数上抛给 Workbench 头部按钮 */
  onNavigateReady?: ((navigate: DiffNavigateHandler | null) => void) | null;
}

export function DiffEditorPair({ block, index = 0, path = '', reviewId = '', showBlockBadge = false, t, onNavigateReady = null }: DiffEditorPairProps) {
  const [themeName, setThemeName] = useState(resolveMonacoThemeName());
  const [editorReady, setEditorReady] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);
  const diffUpdateDisposableRef = useRef<monaco.IDisposable | null>(null);
  const firstDiffRevealedRef = useRef(false);
  const createdRef = useRef(false);
  const rawBlock = block as ReviewBlock | null | undefined;
  const original = typeof rawBlock?.before === 'string' ? normalizeText(rawBlock.before) : '';
  const modified = typeof rawBlock?.after === 'string' ? normalizeText(rawBlock.after) : '';
  const declaredStartLine = Number(rawBlock?.startLine);
  const matchedStartLine = Number(rawBlock?.matchedStartLine);
  const labelKey = typeof rawBlock?.label === 'string' && rawBlock.label.trim() ? rawBlock.label.trim() : '变更块 #{count}';
  const labelParams = rawBlock?.labelParams && typeof rawBlock.labelParams === 'object'
    ? rawBlock.labelParams
    : { count: index + 1 };
  const label = t(labelKey as I18nKey, labelParams);
  const language = useMemo(() => resolveLanguageFromPath(path), [path]);
  const originalModelPath = useMemo(() => buildModelPath(path, reviewId, index, 'original'), [index, path, reviewId]);
  const modifiedModelPath = useMemo(() => buildModelPath(path, reviewId, index, 'modified'), [index, path, reviewId]);
  const focusLine = Number.isFinite(matchedStartLine) && matchedStartLine > 0
    ? matchedStartLine
    : (Number.isFinite(declaredStartLine) && declaredStartLine > 0
      ? declaredStartLine
      : 1);
  const showMetaBar = showBlockBadge || (Number.isFinite(matchedStartLine) && matchedStartLine > 0);
  const editorOptions = useMemo(() => ({
    ...DIFF_EDITOR_BASE_OPTIONS,
    ariaLabel: String(path || label || 'diff editor'),
  }), [label, path]);
  const goToDiff = useCallback((target: DiffNavigateTarget) => {
    editorRef.current?.goToDiff(target);
  }, []);
  const revealFirstDiff = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || firstDiffRevealedRef.current) {
      return;
    }
    const lineChanges = editor.getLineChanges();
    if (!Array.isArray(lineChanges) || lineChanges.length === 0) {
      return;
    }
    firstDiffRevealedRef.current = true;
    editor.goToDiff('next');
  }, []);

  useEffect(() => {
    if (!createdRef.current) {
      const host = hostRef.current;
      if (!host) {
        return undefined;
      }
      const editor = monaco.editor.createDiffEditor(host, editorOptions);
      editorRef.current = editor;
      const models = {
        original: monaco.editor.createModel(original, language, monaco.Uri.parse(originalModelPath)),
        modified: monaco.editor.createModel(modified, language, monaco.Uri.parse(modifiedModelPath)),
      };
      modelsRef.current = models;
      editor.setModel(models);
      diffUpdateDisposableRef.current?.dispose();
      diffUpdateDisposableRef.current = editor.onDidUpdateDiff(revealFirstDiff);
      revealFirstDiff();
      if (focusLine > 0 && !firstDiffRevealedRef.current) {
        editor.revealLineInCenter(focusLine);
      }
      createdRef.current = true;
      setEditorReady(true);
      return undefined;
    }
    const editor = editorRef.current;
    if (!editor) {
      return undefined;
    }
    const oldModels = modelsRef.current;
    oldModels?.original.dispose();
    oldModels?.modified.dispose();
    const next = {
      original: monaco.editor.createModel(original, language, monaco.Uri.parse(originalModelPath)),
      modified: monaco.editor.createModel(modified, language, monaco.Uri.parse(modifiedModelPath)),
    };
    modelsRef.current = next;
    editor.setModel(next);
    firstDiffRevealedRef.current = false;
    return undefined;
  }, [original, modified, language, originalModelPath, modifiedModelPath, editorOptions, revealFirstDiff, focusLine]);

  useEffect(() => () => {
    diffUpdateDisposableRef.current?.dispose();
    diffUpdateDisposableRef.current = null;
    const oldModels = modelsRef.current;
    modelsRef.current = null;
    const editor = editorRef.current;
    editorRef.current = null;
    createdRef.current = false;
    editor?.dispose();
    oldModels?.original.dispose();
    oldModels?.modified.dispose();
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions(editorOptions);
  }, [editorOptions]);

  useEffect(() => {
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  useEffect(() => {
    if (typeof onNavigateReady !== 'function') {
      return undefined;
    }
    onNavigateReady(goToDiff);
    return () => onNavigateReady(null);
  }, [goToDiff, onNavigateReady]);

  useEffect(() => {
    const refreshTheme = () => setThemeName(resolveMonacoThemeName());
    refreshTheme();
    window.addEventListener('theme-mode-changed', refreshTheme);
    window.addEventListener('theme-package-changed', refreshTheme);
    window.addEventListener('theme-preview-changed', refreshTheme);
    window.addEventListener('terminal-theme-changed', refreshTheme);
    return () => {
      window.removeEventListener('theme-mode-changed', refreshTheme);
      window.removeEventListener('theme-package-changed', refreshTheme);
      window.removeEventListener('theme-preview-changed', refreshTheme);
      window.removeEventListener('terminal-theme-changed', refreshTheme);
    };
  }, []);

  return (
    <div
      className={`grid ${showMetaBar ? 'grid-rows-[34px_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'} min-h-0 border border-line rounded-lg overflow-hidden bg-canvas`}>
      {showMetaBar ? (
        <div className="min-w-0 flex items-center justify-between gap-3 px-2.5 border-b border-line-subtle bg-raised">
          <div className="min-w-0 text-secondary text-sm font-semibold truncate">
            {label}
          </div>
          {Number.isFinite(matchedStartLine) && matchedStartLine > 0 ? (
            <div className="shrink-0 text-tertiary text-xs font-mono">
              {`L${matchedStartLine}`}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 relative">
        {!editorReady ? (
          <div className="absolute inset-0 z-[1]">{buildLoadingNode(t('加载中...'))}</div>
        ) : null}
        <div ref={hostRef} className="h-full min-h-0" />
      </div>
    </div>
  );
}
