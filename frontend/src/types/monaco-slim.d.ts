// Monaco 瘦身类型桥：
// 运行时从 editor.api.js 引入（不含 84 语言 / LSP features / lsp-client，主包 -4MB），
// 类型复用主包 monaco-editor.d.ts（仅声明，不产生运行时依赖）。
// 用法限制：仅使用 editor.api 提供的 API 子集（createDiffEditor / goToDiff / 主题等），
// 语言注册一律走 esm/vs/languages/definitions|features 的 register.js 按需导入。
declare module 'monaco-editor/editor/editor.api.js' {
  export * from 'monaco-editor'
}
