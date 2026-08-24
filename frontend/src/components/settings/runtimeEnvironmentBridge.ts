// 桥接模块（自 .js 收编后类型化）：运行环境（uv 二进制）设置与状态
import * as AppGo from '../../../wailsjs/go/wailsapp/App.js'
import { getLanguage } from '../../i18n.ts'

/** 运行环境设置（environmentType 当前仅支持 uv；enabled 为输入透传字段） */
export interface RuntimeEnvironmentSettings {
  environmentType: 'uv'
  targetPathTemplate: string
  modulePath: string
  enabled?: boolean
}

/** 运行环境安装状态 */
export interface RuntimeEnvironmentStatus {
  environmentType: 'uv'
  ready: boolean
  binaryPath: string
  enabled?: boolean
}

export const DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS: RuntimeEnvironmentSettings = {
  environmentType: 'uv',
  targetPathTemplate: '${APP_DIR}\\envs\\uv',
  modulePath: 'module/runtimeenv/runtime_env.go',
}

export const DEFAULT_RUNTIME_ENVIRONMENT_STATUS: RuntimeEnvironmentStatus = {
  environmentType: 'uv',
  ready: false,
  binaryPath: '',
}

function normalizeEnvironmentType(value: unknown): 'uv' {
  return String(value || '').trim().toLowerCase() === 'uv' ? 'uv' : 'uv'
}

function normalizeRuntimeEnvironmentSettings(settings: unknown): RuntimeEnvironmentSettings {
  const s = (settings ?? {}) as Record<string, unknown>
  return {
    ...DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS,
    ...s,
    environmentType: normalizeEnvironmentType(s.environmentType),
    targetPathTemplate: typeof s.targetPathTemplate === 'string' && s.targetPathTemplate.trim()
      ? s.targetPathTemplate.trim()
      : DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS.targetPathTemplate,
    modulePath: typeof s.modulePath === 'string' && s.modulePath.trim()
      ? s.modulePath.trim()
      : DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS.modulePath,
  }
}

function normalizeRuntimeEnvironmentStatus(status: unknown): RuntimeEnvironmentStatus {
  const s = (status ?? {}) as Record<string, unknown>
  return {
    ...DEFAULT_RUNTIME_ENVIRONMENT_STATUS,
    ...s,
    environmentType: normalizeEnvironmentType(s.environmentType),
    ready: Boolean(s.ready),
    binaryPath: typeof s.binaryPath === 'string' ? s.binaryPath.trim() : '',
  }
}

export function resolveRuntimeEnvironmentPathPreview(template: unknown, programDirectory: unknown): string {
  const baseDir = String(programDirectory || '').trim()
  const rawTemplate = String(template || '').trim() || DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS.targetPathTemplate
  const separator = baseDir.includes('\\') ? '\\' : '/'
  const replaced = rawTemplate
    .replace(/\$\{APP_DIR\}/g, baseDir)
    .replace(/%APP_DIR%/g, baseDir)
    .replace(/[\\/]+/g, separator)
  if (!replaced) {
    return ''
  }
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(replaced) || !baseDir) {
    return replaced
  }
  return `${baseDir}${baseDir.endsWith('\\') || baseDir.endsWith('/') ? '' : separator}${replaced}`
}

export async function getRuntimeEnvironmentSettings(): Promise<RuntimeEnvironmentSettings> {
  try {
    return normalizeRuntimeEnvironmentSettings(await AppGo.GetRuntimeEnvironmentSettings())
  } catch {
    return DEFAULT_RUNTIME_ENVIRONMENT_SETTINGS
  }
}

export async function saveRuntimeEnvironmentSettings(settings: unknown): Promise<RuntimeEnvironmentSettings> {
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

export async function getRuntimeEnvironmentStatus(): Promise<RuntimeEnvironmentStatus> {
  try {
    return normalizeRuntimeEnvironmentStatus(await window?.go?.wailsapp?.App?.GetRuntimeEnvironmentStatus?.())
  } catch {
    return DEFAULT_RUNTIME_ENVIRONMENT_STATUS
  }
}

export async function installRuntimeEnvironment(): Promise<RuntimeEnvironmentStatus> {
  const installer = window?.go?.wailsapp?.App?.InstallRuntimeEnvironment
  const language = getLanguage()
  const result = typeof installer === 'function'
    ? await installer(language)
    : await (AppGo.InstallRuntimeEnvironment as (arg1?: string) => Promise<unknown>)()
  return normalizeRuntimeEnvironmentStatus(result)
}
