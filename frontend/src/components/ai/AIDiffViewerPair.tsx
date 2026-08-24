// 瘦身：不再全量引入 'monaco-editor'（editor.main 会带入全部 84 种语言 + LSP features + lsp-client，
// 主包增量约 4MB）。改为 editor.api 核心 + 按需注册 LANGUAGE_BY_EXTENSION 映射所需的语言（26 种全保留）。
// 类型声明见 src/types/monaco-slim.d.ts（复用主包类型，纯声明不进 bundle）。
// 注：monaco-editor 的 exports 为 "./*": "./esm/vs/*.js"，子路径不带 esm/vs 前缀
import * as monaco from 'monaco-editor/editor/editor.api.js'
// 纯 tokenizer 语言（definitions/，无需语言 worker）；cpp 注册文件同时注册 c + cpp
import 'monaco-editor/languages/definitions/bat/register.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/definitions/csharp/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/dockerfile/register.js'
import 'monaco-editor/languages/definitions/go/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/ini/register.js'
import 'monaco-editor/languages/definitions/java/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/kotlin/register.js'
import 'monaco-editor/languages/definitions/less/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import 'monaco-editor/languages/definitions/php/register.js'
import 'monaco-editor/languages/definitions/powershell/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/ruby/register.js'
import 'monaco-editor/languages/definitions/rust/register.js'
import 'monaco-editor/languages/definitions/scss/register.js'
import 'monaco-editor/languages/definitions/shell/register.js'
import 'monaco-editor/languages/definitions/sql/register.js'
import 'monaco-editor/languages/definitions/swift/register.js'
import 'monaco-editor/languages/definitions/xml/register.js'
import 'monaco-editor/languages/definitions/yaml/register.js'
// worker 版语言（features/）：0.56 中 json/typescript 仅此版本，保留对应 worker
import 'monaco-editor/languages/features/json/register.js'
import 'monaco-editor/languages/features/typescript/register.js'
// 补注册精简版缺失的编辑器服务：editor.api 精简版中 contrib 已注册但对应服务未注册，
// 创建编辑器实例化贡献时抛 "depends on UNKNOWN service"（全量版 editor.main 连带加载）。
// 逐个补齐（与 outlineModel 同一模式）：
import 'monaco-editor/editor/contrib/documentSymbols/browser/outlineModel.js'
import 'monaco-editor/editor/contrib/codelens/browser/codeLensCache.js'
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsController.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestMemory.js'
import 'monaco-editor/editor/common/services/treeViewsDndService.js'
import 'monaco-editor/platform/actionWidget/browser/actionWidget.js'
// worker：只保留 editor / json / ts（css/html 用 tokenizer 版后无需语言 worker）
import editorWorker from '../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker'
import jsonWorker from '../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker'
import tsWorker from '../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { I18nKey } from '../../i18n.ts'
import { getAppThemeMode } from '../../utils/theme.ts'

let monacoConfigured = false

// monaco 0.56 将 tabSize 移入 IGlobalEditorOptions（构造 options 类型不再包含），
// 但运行时 DiffEditor 仍读取该属性，故以交叉类型保留缩进宽度配置
const DIFF_EDITOR_BASE_OPTIONS: monaco.editor.IDiffEditorConstructionOptions & { tabSize?: number } = {
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
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
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
}

function createMonacoWorker(kind: 'editor' | 'json' | 'ts'): Worker {
  // dev 模式：esm/vs 的 worker 是 ESM 模块，classic worker（importScripts）无法加载，
  // Monaco 会回退主线程执行语言服务导致 UI 卡顿（打开审阅面板时尤其明显），且 diff 计算
  // （computeDiff）依赖 worker——worker 失败会导致变更行红绿高亮消失。
  // 故 dev 下用 vite 插件（vite.config.ts monacoDevWorkersPlugin）预先打包的 iife worker
  // （esbuild 产物，classic worker 可直接加载，同版本 postMessage 协议兼容），生产用 vite 打包的 iife worker。
  if (import.meta.env.DEV) {
    return new Worker(`/node_modules/.cache/monaco-workers/${kind}.worker.js`)
  }
  if (kind === 'json') {
    return new jsonWorker()
  }
  if (kind === 'ts') {
    return new tsWorker()
  }
  return new editorWorker()
}

function ensureMonacoConfigured() {
  if (monacoConfigured || typeof globalThis === 'undefined') {
    return
  }
  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'json') {
        return createMonacoWorker('json')
      }
      if (label === 'typescript' || label === 'javascript') {
        return createMonacoWorker('ts')
      }
      return createMonacoWorker('editor')
    },
  }
  monacoConfigured = true
}

function normalizeText(value: unknown) {
  return String(value || '').replace(/\r\n/g, '\n')
}

function resolveMonacoThemeName() {
  return getAppThemeMode() === 'light' ? 'vs' : 'vs-dark'
}

function resolveLanguageFromPath(path: unknown) {
  const normalizedPath = String(path || '').trim().replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').pop() || ''
  const lowerFileName = fileName.toLowerCase()
  if (!lowerFileName) {
    return 'plaintext'
  }
  if (lowerFileName === 'dockerfile') {
    return 'dockerfile'
  }
  if (lowerFileName.endsWith('.d.ts')) {
    return 'typescript'
  }
  const matched = lowerFileName.match(/\.([a-z0-9_-]+)$/)
  if (!matched) {
    return 'plaintext'
  }
  return LANGUAGE_BY_EXTENSION[matched[1]] || 'plaintext'
}

function buildModelPath(path: string, reviewId: string, index: number, side: string) {
  const normalizedPath = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const fallbackPath = `review-${reviewId || 'current'}-${index || 0}.txt`
  const relativePath = normalizedPath || fallbackPath
  const encodedPath = relativePath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/')
  return `file:///ai-change-review/${encodeURIComponent(String(reviewId || 'current'))}/${index || 0}/${side}/${encodedPath}`
}

function buildLoadingNode(text: string) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-base)',
        color: 'var(--text-secondary)',
        fontSize: 12,
      }}>
      {text}
    </div>
  )
}

ensureMonacoConfigured()

/** AI 审阅返回的差异块（字段来自 AI 响应，可能缺失，访问处均有防御） */
interface ReviewBlock {
  before?: string
  after?: string
  startLine?: number
  matchedStartLine?: number
  label?: string
  labelParams?: Record<string, unknown>
}

/** 变更导航目标（monaco 0.56 goToDiff 支持 next/previous） */
export type DiffNavigateTarget = 'next' | 'previous'

/** 导航函数句柄（可被置空以释放） */
type DiffNavigateHandler = (target: DiffNavigateTarget) => void

export interface DiffEditorPairProps {
  block?: unknown
  index?: number
  path?: string
  reviewId?: string
  showBlockBadge?: boolean
  t: (key: I18nKey, vars?: Record<string, unknown>) => string
  /** 首个差异块就绪时把导航函数上抛给 Workbench 头部按钮 */
  onNavigateReady?: ((navigate: DiffNavigateHandler | null) => void) | null
}

export function DiffEditorPair({ block, index = 0, path = '', reviewId = '', showBlockBadge = false, t, onNavigateReady = null }: DiffEditorPairProps) {
  const [themeName, setThemeName] = useState(resolveMonacoThemeName())
  const [editorReady, setEditorReady] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null)
  const diffUpdateDisposableRef = useRef<monaco.IDisposable | null>(null)
  const firstDiffRevealedRef = useRef(false)
  const createdRef = useRef(false)
  const rawBlock = block as ReviewBlock | null | undefined
  const original = typeof rawBlock?.before === 'string' ? normalizeText(rawBlock.before) : ''
  const modified = typeof rawBlock?.after === 'string' ? normalizeText(rawBlock.after) : ''
  const declaredStartLine = Number(rawBlock?.startLine)
  const matchedStartLine = Number(rawBlock?.matchedStartLine)
  const labelKey = typeof rawBlock?.label === 'string' && rawBlock.label.trim() ? rawBlock.label.trim() : '变更块 #{count}'
  const labelParams = rawBlock?.labelParams && typeof rawBlock.labelParams === 'object'
    ? rawBlock.labelParams
    : { count: index + 1 }
  // labelKey 为 AI diff 返回的动态键（可能不在翻译表），t() 内部有兜底
  const label = t(labelKey as I18nKey, labelParams)
  const language = useMemo(() => resolveLanguageFromPath(path), [path])
  const originalModelPath = useMemo(() => buildModelPath(path, reviewId, index, 'original'), [index, path, reviewId])
  const modifiedModelPath = useMemo(() => buildModelPath(path, reviewId, index, 'modified'), [index, path, reviewId])
  const focusLine = Number.isFinite(matchedStartLine) && matchedStartLine > 0
    ? matchedStartLine
    : Number.isFinite(declaredStartLine) && declaredStartLine > 0
      ? declaredStartLine
      : 1
  const showMetaBar = showBlockBadge || (Number.isFinite(matchedStartLine) && matchedStartLine > 0)
  const editorOptions = useMemo(() => ({
    ...DIFF_EDITOR_BASE_OPTIONS,
    ariaLabel: String(path || label || 'diff editor'),
  }), [label, path])
  const goToDiff = useCallback((target: DiffNavigateTarget) => {
    editorRef.current?.goToDiff(target)
  }, [])
  const revealFirstDiff = useCallback(() => {
    const editor = editorRef.current
    if (!editor || firstDiffRevealedRef.current) {
      return
    }
    const lineChanges = editor.getLineChanges()
    if (!Array.isArray(lineChanges) || lineChanges.length === 0) {
      return
    }
    firstDiffRevealedRef.current = true
    editor.goToDiff('next')
  }, [])

  // 创建 + 内容更新合并为单一 effect（依赖变化即触发）：
  // - 首次（createdRef=false）：创建 editor + models + diff 更新订阅
  // - 后续（createdRef=true）：先 dispose 旧 models 再 create 新 models（新模型复用同一 URI，必须先释放旧的避免 already exists）
  // 注意：不能拆成两个 effect——挂载时所有 effect 都会执行，拆分会重复 createModel 同一 uri 报 already exists
  useEffect(() => {
    if (!createdRef.current) {
      const host = hostRef.current
      if (!host) {
        return undefined
      }
      const editor = monaco.editor.createDiffEditor(host, editorOptions)
      editorRef.current = editor
      const models = {
        original: monaco.editor.createModel(original, language, monaco.Uri.parse(originalModelPath)),
        modified: monaco.editor.createModel(modified, language, monaco.Uri.parse(modifiedModelPath)),
      }
      modelsRef.current = models
      editor.setModel(models)
      diffUpdateDisposableRef.current?.dispose()
      diffUpdateDisposableRef.current = editor.onDidUpdateDiff(revealFirstDiff)
      revealFirstDiff()
      if (focusLine > 0 && !firstDiffRevealedRef.current) {
        editor.revealLineInCenter(focusLine)
      }
      createdRef.current = true
      setEditorReady(true)
      return undefined
    }
    const editor = editorRef.current
    if (!editor) {
      return undefined
    }
    const oldModels = modelsRef.current
    // 先 dispose 旧模型再 create 新模型：新模型复用同一 URI（path/reviewId/index 不变仅内容变），
    // 若旧模型仍存活，createModel 会抛 "model with uri already exists"（@monaco-editor/react 内部同此顺序）
    oldModels?.original.dispose()
    oldModels?.modified.dispose()
    const next = {
      original: monaco.editor.createModel(original, language, monaco.Uri.parse(originalModelPath)),
      modified: monaco.editor.createModel(modified, language, monaco.Uri.parse(modifiedModelPath)),
    }
    modelsRef.current = next
    editor.setModel(next)
    firstDiffRevealedRef.current = false
    return undefined
  }, [original, modified, language, originalModelPath, modifiedModelPath, editorOptions, revealFirstDiff, focusLine])

  // 卸载：先 dispose editor（widget 先 reset），后 dispose models——
  // 顺序与 @monaco-editor/react 相反，避免 "TextModel got disposed before DiffEditorWidget model got reset"
  useEffect(() => () => {
    diffUpdateDisposableRef.current?.dispose()
    diffUpdateDisposableRef.current = null
    const oldModels = modelsRef.current
    modelsRef.current = null
    const editor = editorRef.current
    editorRef.current = null
    createdRef.current = false
    editor?.dispose()
    oldModels?.original.dispose()
    oldModels?.modified.dispose()
  }, [])

  // 选项变化（ariaLabel 等）时同步
  useEffect(() => {
    editorRef.current?.updateOptions(editorOptions)
  }, [editorOptions])

  // 主题同步（setTheme 为全局调用，Monaco 仅本面板使用，安全）
  useEffect(() => {
    monaco.editor.setTheme(themeName)
  }, [themeName])

  useEffect(() => {
    if (typeof onNavigateReady !== 'function') {
      return undefined
    }
    onNavigateReady(goToDiff)
    return () => onNavigateReady(null)
  }, [goToDiff, onNavigateReady])

  useEffect(() => {
    const refreshTheme = () => setThemeName(resolveMonacoThemeName())
    refreshTheme()
    window.addEventListener('theme-mode-changed', refreshTheme)
    window.addEventListener('theme-package-changed', refreshTheme)
    window.addEventListener('theme-preview-changed', refreshTheme)
    window.addEventListener('terminal-theme-changed', refreshTheme)
    return () => {
      window.removeEventListener('theme-mode-changed', refreshTheme)
      window.removeEventListener('theme-package-changed', refreshTheme)
      window.removeEventListener('theme-preview-changed', refreshTheme)
      window.removeEventListener('terminal-theme-changed', refreshTheme)
    }
  }, [])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: showMetaBar ? '34px minmax(0, 1fr)' : 'minmax(0, 1fr)',
        minHeight: 0,
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--surface-base)',
      }}>
      {showMetaBar ? (
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '0 10px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--surface-raised)',
          }}>
          <div
            style={{
              minWidth: 0,
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {label}
          </div>
          {Number.isFinite(matchedStartLine) && matchedStartLine > 0 ? (
            <div
              style={{
                flexShrink: 0,
                color: 'var(--text-tertiary)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              }}>
              {`L${matchedStartLine}`}
            </div>
          ) : null}
        </div>
      ) : null}
      <div style={{ minHeight: 0, position: 'relative' }}>
        {!editorReady ? (
          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>{buildLoadingNode(t('加载中...'))}</div>
        ) : null}
        <div ref={hostRef} style={{ height: '100%', minHeight: 0 }} />
      </div>
    </div>
  )
}
