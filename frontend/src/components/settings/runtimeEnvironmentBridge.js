import * as AppGo from '../../../wailsjs/go/main/App.js'

export const DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS = {
  environmentType: 'uv',
  targetPathTemplate: '${APP_DIR}\\envs\\uv',
  modulePath: 'module/runtimeenv/runtime_env.go',
}

export const DEFAULT_RUNTIME_ENVIRONMENT_STATUS = {
  environmentType: 'uv',
  ready: false,
  binaryPath: '',
}

function normalizeEnvironmentType(value) {
  return String(value || '').trim().toLowerCase() === 'uv' ? 'uv' : 'uv'
}

export function normalizeRuntimeEnvironmentSettings(settings) {
  return {
    ...DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS,
    ...settings,
    environmentType: normalizeEnvironmentType(settings?.environmentType),
    targetPathTemplate: typeof settings?.targetPathTemplate === 'string' && settings.targetPathTemplate.trim()
      ? settings.targetPathTemplate.trim()
      : DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS.targetPathTemplate,
    modulePath: typeof settings?.modulePath === 'string' && settings.modulePath.trim()
      ? settings.modulePath.trim()
      : DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS.modulePath,
  }
}

export function normalizeRuntimeEnvironmentStatus(status) {
  return {
    ...DEFAULT_RUNTIME_ENVIRONMENT_STATUS,
    ...status,
    environmentType: normalizeEnvironmentType(status?.environmentType),
    ready: Boolean(status?.ready),
    binaryPath: typeof status?.binaryPath === 'string' ? status.binaryPath.trim() : '',
  }
}

export function resolveRuntimeEnvironmentPathPreview(template, programDirectory) {
  const baseDir = String(programDirectory || '').trim()
  const rawTemplate = String(template || '').trim() || DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS.targetPathTemplate
  const separator = baseDir.includes('\\') ? '\\' : '/'
  const replaced = rawTemplate
    .replaceAll('${APP_DIR}', baseDir)
    .replaceAll('%APP_DIR%', baseDir)
    .replace(/[\\/]+/g, separator)
  if (!replaced) {
    return ''
  }
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(replaced) || !baseDir) {
    return replaced
  }
  return `${baseDir}${baseDir.endsWith('\\') || baseDir.endsWith('/') ? '' : separator}${replaced}`
}

export async function getRuntimeEnvironmentSettings() {
  try {
    return normalizeRuntimeEnvironmentSettings(await AppGo.GetRuntimeEnvironmentSettings())
  } catch {
    return DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS
  }
}

export async function saveRuntimeEnvironmentSettings(settings) {
  const normalized = normalizeRuntimeEnvironmentSettings(settings)
  if (!AppGo.SaveRuntimeEnvironmentSettings) {
    return normalized
  }
  await AppGo.SaveRuntimeEnvironmentSettings(JSON.stringify({
    environmentType: normalized.environmentType,
    targetPathTemplate: normalized.targetPathTemplate,
  }))
  return normalized
}

export async function getRuntimeEnvironmentStatus() {
  try {
    return normalizeRuntimeEnvironmentStatus(await window?.go?.main?.App?.GetRuntimeEnvironmentStatus?.())
  } catch {
    return DEFAULT_RUNTIME_ENVIRONMENT_STATUS
  }
}

export async function installRuntimeEnvironment() {
  return normalizeRuntimeEnvironmentStatus(await AppGo.InstallRuntimeEnvironment())
}