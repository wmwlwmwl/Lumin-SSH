import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { c, cpp, java, csharp } from '@codemirror/legacy-modes/mode/clike';
import { keymap, EditorView, Prec, EditorSelection, showDialog, type Extension } from '@uiw/react-codemirror';

// Debian sources.list 语法高亮
export const debianList = StreamLanguage.define({
  startState: () => ({ inUrl: false }),
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/deb-src\b/)) return 'keyword';
    if (stream.match(/deb\b/)) return 'keyword';
    if (stream.match(/https?:\/\/[^\s]+/)) return 'string';
    if (stream.match(/[a-z-]+=/)) return 'attribute';
    return stream.next() ?? null;
  },
});

// RHEL .repo 文件语法高亮 (INI 风格)
export const rhelRepo = StreamLanguage.define({
  startState: () => ({}),
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match('#') || stream.match(';')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\[.*\]/)) return 'keyword';
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*=/)) return 'attribute';
    if (stream.match(/\$[a-zA-Z_][a-zA-Z0-9_]*/)) return 'string';
    return stream.next() ?? null;
  },
});

const LANG_CACHE: Record<string, Extension | null> = {};

function isNginxConfigPath(fullPath: string, baseName: string) {
  const path = String(fullPath || '').replace(/\\/g, '/').toLowerCase();
  const base = String(baseName || '').toLowerCase();
  if (!base) return false;
  if (base === 'nginx.conf' || base.endsWith('.nginx')) return true;
  if (base.endsWith('.conf') && (path.includes('/nginx/') || path.includes('/nginx-') || path.includes('nginx'))) {
    return true;
  }
  if ((base.endsWith('.conf') || base.endsWith('.vhost')) && /(^|\/)(sites-available|sites-enabled|conf\.d)(\/|$)/.test(path)) {
    return true;
  }
  return false;
}

export function getLanguage(filename: string): Extension | null {
  const raw = String(filename || '');
  const normalized = raw.replace(/\\/g, '/');
  const base = (normalized.split('/').pop() || '').toLowerCase();
  const ext = (base.split('.').pop() || '').toLowerCase();
  const cacheKey = (ext === 'conf' || base === 'nginx.conf' || base.endsWith('.nginx') || base === 'dockerfile' || base.startsWith('dockerfile.') || base === 'cmakelists.txt' || base.endsWith('.cmake'))
    ? normalized.toLowerCase()
    : ext;

  if (Object.prototype.hasOwnProperty.call(LANG_CACHE, cacheKey)) return LANG_CACHE[cacheKey];

  let lang: Extension | null = null;
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    lang = StreamLanguage.define(dockerFile);
  } else if (base === 'cmakelists.txt' || base.endsWith('.cmake')) {
    lang = StreamLanguage.define(cmake);
  } else if (isNginxConfigPath(normalized, base) || ext === 'nginx') {
    lang = StreamLanguage.define(nginx);
  } else {
    switch (ext) {
      case 'js': case 'mjs': case 'cjs': lang = javascript(); break;
      case 'jsx': lang = javascript({ jsx: true }); break;
      case 'ts': lang = javascript({ typescript: true }); break;
      case 'tsx': lang = javascript({ jsx: true, typescript: true }); break;
      case 'py': case 'pyw': case 'pyi': lang = python(); break;
      case 'html': case 'htm': lang = html(); break;
      case 'css': case 'scss': case 'less': lang = css(); break;
      case 'json': case 'jsonc': lang = json(); break;
      case 'xml': case 'svg': case 'xsl': case 'xsd': lang = xml(); break;
      case 'sql': lang = sql(); break;
      case 'sh': case 'bash': case 'zsh': case 'ksh': lang = StreamLanguage.define(shell); break;
      case 'lua': lang = StreamLanguage.define(lua); break;
      case 'go': lang = StreamLanguage.define(go); break;
      case 'rs': lang = StreamLanguage.define(rust); break;
      case 'yml': case 'yaml': lang = StreamLanguage.define(yaml); break;
      case 'toml': lang = StreamLanguage.define(toml); break;
      case 'rb': case 'rake': case 'gemspec': lang = StreamLanguage.define(ruby); break;
      case 'pl': case 'pm': case 't': lang = StreamLanguage.define(perl); break;
      case 'ps1': case 'psm1': case 'psd1': lang = StreamLanguage.define(powerShell); break;
      case 'dockerfile': lang = StreamLanguage.define(dockerFile); break;
      case 'conf': case 'ini': case 'cfg': case 'env': case 'properties':
        lang = StreamLanguage.define(properties); break;
      case 'diff': case 'patch': lang = StreamLanguage.define(diff); break;
      case 'cmake': lang = StreamLanguage.define(cmake); break;
      case 'c': case 'h': lang = StreamLanguage.define(c); break;
      case 'cc': case 'cpp': case 'cxx': case 'hpp': case 'hh': case 'hxx':
        lang = StreamLanguage.define(cpp); break;
      case 'java': lang = StreamLanguage.define(java); break;
      case 'cs': lang = StreamLanguage.define(csharp); break;
      case 'list': case 'sources': lang = debianList; break;
      case 'repo': lang = rhelRepo; break;
      default:
        break;
    }
  }
  LANG_CACHE[cacheKey] = lang;
  return lang;
}

export const BASIC_SETUP = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  history: true,
  foldGutter: true,
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  rectangularSelection: true,
  crosshairCursor: false,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: true,
  defaultKeymap: true,
  searchKeymap: true,
  historyKeymap: true,
  foldKeymap: true,
  completionKeymap: true,
  lintKeymap: true,
};

const gotoLineTop = (view: EditorView) => {
  const { state } = view;
  const { close, result } = showDialog(view, {
    label: state.phrase('Go to line'),
    input: { type: 'text', name: 'line', value: '' },
    focus: true,
    top: true,
    submitLabel: state.phrase('go'),
  });
  result.then((form) => {
    const lineValue = (form?.elements as unknown as Record<string, { value?: string }> | null)?.['line']?.value || '';
    const match = form && /^([+-])?(\d+)?(:\d+)?(%)?$/.exec(lineValue);
    if (!match) { view.dispatch({ effects: close }); return; }
    const startLine = state.doc.lineAt(state.selection.main.head);
    const [, sign, ln, cl, percent] = match;
    const col = cl ? +cl.slice(1) : 0;
    let lineNum = ln ? +ln : startLine.number;
    if (ln && percent) {
      let pc = lineNum / 100;
      if (sign) pc = pc * (sign === '-' ? -1 : 1) + (startLine.number / state.doc.lines);
      lineNum = Math.round(state.doc.lines * pc);
    } else if (ln && sign) {
      lineNum = lineNum * (sign === '-' ? -1 : 1) + startLine.number;
    }
    const docLine = state.doc.line(Math.max(1, Math.min(state.doc.lines, lineNum)));
    const selection = EditorSelection.cursor(docLine.from + Math.max(0, Math.min(col, docLine.length)));
    view.dispatch({
      effects: [close, EditorView.scrollIntoView(selection.from, { y: 'center' })],
      selection,
    });
  });
  return true;
};

const gotoLineSingle = (view: EditorView) => {
  view.dom.querySelectorAll('.cm-dialog-close').forEach((btn) => (btn as HTMLElement).click());
  return gotoLineTop(view);
};

export const gotoLineKeymap = Prec.highest(keymap.of([{ key: 'Mod-g', run: gotoLineSingle }]));

export const editorActiveLineTheme = EditorView.theme({
  '.cm-activeLineGutter': { backgroundColor: 'rgba(77, 158, 255, 0.22)' },
  '&.cm-focused .cm-activeLineGutter': { backgroundColor: 'rgba(77, 158, 255, 0.30)' },
}, { dark: true });
