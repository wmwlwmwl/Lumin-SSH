import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleOff, Package } from 'lucide-react'
import { t as $t } from '../../i18n.js'
import { DEFAULT_RUNTIME_ENVIRONMENT_STATUS, getRuntimeEnvironmentStatus, installRuntimeEnvironment } from './runtimeEnvironmentBridge.js'
import { SettingsPanel, SettingsSectionTitle, SettingsTabRoot } from './SharedComponents'

export default function RuntimeEnvironmentTab() {
  const [runtimeEnvironmentStatus, setRuntimeEnvironmentStatus] = useState(DEFAULT_RUNTIME_ENVIRONMENT_STATUS)
  const [installing, setInstalling] = useState(false)

  const refreshRuntimeEnvironmentStatus = useCallback(async () => {
    const status = await getRuntimeEnvironmentStatus()
    setRuntimeEnvironmentStatus(status)
    return status
  }, [])

  useEffect(() => {
    let cancelled = false
    refreshRuntimeEnvironmentStatus()
      .then((status) => {
        if (!cancelled && status) {
          setRuntimeEnvironmentStatus(status)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshRuntimeEnvironmentStatus])

  const handleInstall = useCallback(async () => {
    if (installing) {
      return
    }
    setInstalling(true)
    try {
      const status = await installRuntimeEnvironment()
      setRuntimeEnvironmentStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '')
      if (message.trim()) {
        window.alert(message)
      }
      await refreshRuntimeEnvironmentStatus()
    } finally {
      setInstalling(false)
    }
  }, [installing, refreshRuntimeEnvironmentStatus])

  const ready = runtimeEnvironmentStatus.ready === true

  return (
    <SettingsTabRoot>
      <div>
        <SettingsSectionTitle>{$t('环境依赖')}</SettingsSectionTitle>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 10 }}>{$t('管理应用运行所需的二进制工具与运行时依赖。')}</div>
        <SettingsPanel style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(16, 185, 129, 0.12)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Package size={24} />
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 26, fontWeight: 700, lineHeight: 1 }}>uv</div>
                <div style={{ padding: '2px 10px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12 }}>{$t('内置')}</div>
                <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: ready ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 12 }}>
                  {ready ? <CheckCircle2 size={16} /> : <CircleOff size={16} />}
                  <span>{ready ? $t('已就绪') : $t('未就绪')}</span>
                </div>
                {!ready ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleInstall}
                    disabled={installing}
                    style={{ height: 30, padding: '0 14px' }}
                  >
                    {installing ? $t('安装中...') : $t('安装')}
                  </button>
                ) : null}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
                {$t('用于 MCP 服务与依赖安装的 Python 包管理工具。')}
              </div>
            </div>
          </div>
          {ready ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('uv 可执行文件')}</div>
              <input className="input" type="text" value={runtimeEnvironmentStatus.binaryPath || ''} readOnly style={{ width: '100%' }} />
            </div>
          ) : null}
        </SettingsPanel>
      </div>
    </SettingsTabRoot>
  )
}