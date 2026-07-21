import * as AppGo from '../../wailsjs/go/main/App.js'

export const PROGRAM_FONT_STORAGE_KEYS = {
  ui: 'programFont.ui.fileName',
  terminal: 'programFont.terminal.fileName',
  ai: 'programFont.ai.fileName',
}

export const DEFAULT_PROGRAM_FONT_STACKS = {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  terminal: "'JetBrains Mono', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Fira Code', monospace",
  ai: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

const loadedProgramFontFamilies = new Map()

let cachedProgramFontPreferences = {
  uiFileName: '',
  terminalFileName: '',
  aiFileName: '',
  uiFontFamily: DEFAULT_PROGRAM_FONT_STACKS.ui,
  terminalFontFamily: DEFAULT_PROGRAM_FONT_STACKS.terminal,
  aiFontFamily: DEFAULT_PROGRAM_FONT_STACKS.ai,
}

function getProgramFontStorageKey(target) {
  if (target === 'ui' || target === 'terminal' || target === 'ai') {
    return PROGRAM_FONT_STORAGE_KEYS[target]
  }
  return ''
}

function createProgramFontFaceFamily(fileName) {
  const normalizedName = String(fileName || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `LuminProgramFont_${normalizedName || 'Custom'}_${Date.now().toString(36)}`
}

function getStoredProgramFontFileName(target) {
  const storageKey = getProgramFontStorageKey(target)
  if (!storageKey) {
    return ''
  }
  const storedValue = localStorage.getItem(storageKey)
  return typeof storedValue === 'string' ? storedValue.trim() : ''
}

function setStoredProgramFontFileName(target, fileName) {
  const storageKey = getProgramFontStorageKey(target)
  if (!storageKey) {
    return
  }
  const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : ''
  if (normalizedFileName) {
    localStorage.setItem(storageKey, normalizedFileName)
    return
  }
  localStorage.removeItem(storageKey)
}

function invalidateLoadedProgramFont(fileName) {
  const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : ''
  if (!normalizedFileName) {
    return
  }
  loadedProgramFontFamilies.delete(normalizedFileName)
}

async function ensureProgramFontLoaded(fileName) {
  const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : ''
  if (!normalizedFileName) {
    return ''
  }
  const existingFamily = loadedProgramFontFamilies.get(normalizedFileName)
  if (existingFamily) {
    return existingFamily
  }
  const dataUrl = await AppGo.GetProgramFontDataURL(normalizedFileName)
  if (!dataUrl || typeof dataUrl !== 'string') {
    return ''
  }
  const familyName = createProgramFontFaceFamily(normalizedFileName)
  const fontFace = new FontFace(familyName, `url("${dataUrl}")`)
  const loadedFontFace = await fontFace.load()
  document.fonts.add(loadedFontFace)
  loadedProgramFontFamilies.set(normalizedFileName, familyName)
  return familyName
}

function buildResolvedProgramFontFamily(fileName, fallbackFontFamily) {
  const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : ''
  const fallback = typeof fallbackFontFamily === 'string' && fallbackFontFamily.trim() ? fallbackFontFamily : 'sans-serif'
  const familyName = normalizedFileName ? loadedProgramFontFamilies.get(normalizedFileName) || '' : ''
  if (!familyName) {
    return fallback
  }
  return `"${familyName}", ${fallback}`
}

function normalizeProgramFontAssignments(preferences = {}) {
  return {
    uiFileName: typeof preferences.uiFileName === 'string' ? preferences.uiFileName.trim() : '',
    terminalFileName: typeof preferences.terminalFileName === 'string' ? preferences.terminalFileName.trim() : '',
    aiFileName: typeof preferences.aiFileName === 'string' ? preferences.aiFileName.trim() : '',
  }
}

export function getResolvedProgramFontPreferences() {
  return { ...cachedProgramFontPreferences }
}

export async function applyProgramFontPreferences() {
  const uiFileName = getStoredProgramFontFileName('ui')
  const terminalFileName = getStoredProgramFontFileName('terminal')
  const aiFileName = getStoredProgramFontFileName('ai')
  const targetFileNames = [uiFileName, terminalFileName, aiFileName].filter(Boolean)
  await Promise.all(targetFileNames.map((fileName) => ensureProgramFontLoaded(fileName).catch(() => '')))
  const uiFontFamily = buildResolvedProgramFontFamily(uiFileName, DEFAULT_PROGRAM_FONT_STACKS.ui)
  const terminalFontFamily = buildResolvedProgramFontFamily(terminalFileName, DEFAULT_PROGRAM_FONT_STACKS.terminal)
  const aiFontFamily = buildResolvedProgramFontFamily(aiFileName, DEFAULT_PROGRAM_FONT_STACKS.ai)
  document.documentElement.style.setProperty('--font-ui', uiFontFamily)
  document.documentElement.style.setProperty('--font-terminal', terminalFontFamily)
  document.documentElement.style.setProperty('--font-ai-panel', aiFontFamily)
  cachedProgramFontPreferences = {
    uiFileName,
    terminalFileName,
    aiFileName,
    uiFontFamily,
    terminalFontFamily,
    aiFontFamily,
  }
  window.dispatchEvent(new CustomEvent('program-font-settings-changed', {
    detail: { ...cachedProgramFontPreferences },
  }))
  return getResolvedProgramFontPreferences()
}

export async function setProgramFontPreference(target, fileName) {
  setStoredProgramFontFileName(target, fileName)
  return applyProgramFontPreferences()
}

export function getProgramFontPreference(target) {
  return getStoredProgramFontFileName(target)
}

export async function listProgramFonts() {
  const fonts = await AppGo.ListProgramFonts()
  return Array.isArray(fonts) ? fonts : []
}

export async function importProgramFontFiles(filePaths) {
  const normalizedPaths = Array.isArray(filePaths)
    ? filePaths.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
  if (normalizedPaths.length === 0) {
    return []
  }
  const importedFonts = await AppGo.ImportProgramFontFiles(normalizedPaths)
  const resolvedFonts = Array.isArray(importedFonts) ? importedFonts : []
  resolvedFonts.forEach((font) => invalidateLoadedProgramFont(font?.fileName))
  await applyProgramFontPreferences().catch(() => {})
  return resolvedFonts
}

export async function selectAndImportProgramFontFiles() {
  const selectedPaths = await AppGo.SelectProgramFontFiles()
  return importProgramFontFiles(selectedPaths)
}

export async function deleteProgramFont(fileName) {
  const normalizedFileName = typeof fileName === 'string' ? fileName.trim() : ''
  if (!normalizedFileName) {
    return getProgramFontAssignmentSnapshot()
  }
  await AppGo.DeleteProgramFont(normalizedFileName)
  invalidateLoadedProgramFont(normalizedFileName)
  const targets = ['ui', 'terminal', 'ai']
  for (const target of targets) {
    if (getStoredProgramFontFileName(target) === normalizedFileName) {
      setStoredProgramFontFileName(target, '')
    }
  }
  await applyProgramFontPreferences().catch(() => {})
  return getProgramFontAssignmentSnapshot()
}

export function getProgramFontAssignmentSnapshot() {
  return normalizeProgramFontAssignments(getResolvedProgramFontPreferences())
}