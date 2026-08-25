import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/bat/register.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/csharp/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/dockerfile/register.js';
import 'monaco-editor/languages/definitions/go/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/kotlin/register.js';
import 'monaco-editor/languages/definitions/less/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/php/register.js';
import 'monaco-editor/languages/definitions/powershell/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/ruby/register.js';
import 'monaco-editor/languages/definitions/rust/register.js';
import 'monaco-editor/languages/definitions/scss/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/swift/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/features/json/register.js';
import 'monaco-editor/languages/features/typescript/register.js';
import 'monaco-editor/editor/contrib/documentSymbols/browser/outlineModel.js';
import 'monaco-editor/editor/contrib/codelens/browser/codeLensCache.js';
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsController.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestMemory.js';
import 'monaco-editor/editor/common/services/treeViewsDndService.js';
import 'monaco-editor/platform/actionWidget/browser/actionWidget.js';

import editorWorker from '../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker';
import jsonWorker from '../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker';
import tsWorker from '../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';
import { getAppThemeMode } from '../../utils/theme.ts';

let monacoConfigured = false;

export const DIFF_EDITOR_BASE_OPTIONS: monaco.editor.IDiffEditorConstructionOptions & { tabSize?: number } = {
  automaticLayout: true,
  readOnly: true,
  domReadOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: false,
  enableSplitViewResizing: true,
  renderIndicators: true,
  renderOverviewRuler: true,
  renderMarginRevertIcon: false,
  diffAlgorithm: 'advanced',
  ignoreTrimWhitespace: false,
  minimap: { enabled: false },
  glyphMargin: false,
  folding: false,
  lineNumbers: 'on',
  lineNumbersMinChars: 4,
  lineDecorationsWidth: 10,
  scrollBeyondLastLine: false,
  roundedSelection: false,
  overviewRulerBorder: false,
  wordWrap: 'off',
  renderWhitespace: 'selection',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 20,
  tabSize: 2,
  padding: { top: 8, bottom: 8 },
  smoothScrolling: true,
  stickyScroll: { enabled: false },
  guides: { indentation: false, bracketPairs: false },
  bracketPairColorization: { enabled: false },
  hideUnchangedRegions: {
    enabled: false,
    contextLineCount: 4,
    minimumLineCount: 2,
    revealLineCount: 4,
  },
};

export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bat: 'bat',
  c: 'c',
  cc: 'cpp',
  conf: 'plaintext',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cxx: 'cpp',
  dockerfile: 'dockerfile',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
};

function createMonacoWorker(kind: 'editor' | 'json' | 'ts'): Worker {
  if (import.meta.env.DEV) {
    return new Worker(`/node_modules/.cache/monaco-workers/${kind}.worker.js`);
  }
  if (kind === 'json') {
    return new jsonWorker();
  }
  if (kind === 'ts') {
    return new tsWorker();
  }
  return new editorWorker();
}

export function ensureMonacoConfigured() {
  if (monacoConfigured || typeof globalThis === 'undefined') {
    return;
  }
  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'json') {
        return createMonacoWorker('json');
      }
      if (label === 'typescript' || label === 'javascript') {
        return createMonacoWorker('ts');
      }
      return createMonacoWorker('editor');
    },
  };
  monacoConfigured = true;
}

export function normalizeText(value: unknown) {
  return String(value || '').replace(/\r\n/g, '\n');
}

export function resolveMonacoThemeName() {
  return getAppThemeMode() === 'light' ? 'vs' : 'vs-dark';
}

export function resolveLanguageFromPath(path: unknown) {
  const normalizedPath = String(path || '').trim().replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').pop() || '';
  const lowerFileName = fileName.toLowerCase();
  if (!lowerFileName) {
    return 'plaintext';
  }
  if (lowerFileName === 'dockerfile') {
    return 'dockerfile';
  }
  if (lowerFileName.endsWith('.d.ts')) {
    return 'typescript';
  }
  const matched = lowerFileName.match(/\.([a-z0-9_-]+)$/);
  if (!matched) {
    return 'plaintext';
  }
  return LANGUAGE_BY_EXTENSION[matched[1]] || 'plaintext';
}

export function buildModelPath(path: string, reviewId: string, index: number, side: string) {
  const normalizedPath = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const fallbackPath = `review-${reviewId || 'current'}-${index || 0}.txt`;
  const relativePath = normalizedPath || fallbackPath;
  const encodedPath = relativePath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/');
  return `file:///ai-change-review/${encodeURIComponent(String(reviewId || 'current'))}/${index || 0}/${side}/${encodedPath}`;
}

export { monaco };
