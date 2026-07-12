import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleOff, Package } from 'lucide-react'
import { t as $t } from '../../i18n.js'
import { DEFAULT_RUNTIME_ENVIRONMENT_STATUS, getRuntimeEnvironmentStatus, installRuntimeEnvironment } from './runtimeEnvironmentBridge.js'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <h3 style={{ fontSize: 24, color: 'var(--text-primary)', fontWeight: 700, margin: 0 }}>{$t('环境依赖')}</h3>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{$t('1')}</span>
        </div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{$t('管理应用运行所需的二进制工具与运行时依赖。')}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
        <div style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(16, 185, 129, 0.12)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Package size={28} />
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 32, fontWeight: 700, lineHeight: 1 }}>uv</div>
                <div style={{ padding: '2px 10px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12 }}>{$t('内置')}</div>
                <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: ready ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 12 }}>
                  {ready ? <CheckCircle2 size={16} /> : <CircleOff size={16} />}
                  <span>{ready ? $t('已就绪') : $t('未就绪')}</span>
                </div>
                {!ready && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleInstall}
                    disabled={installing}
                    style={{ height: 32, padding: '0 16px' }}
                  >
                    {installing ? $t('安装中...') : $t('安装')}
                  </button>
                )}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7 }}>
                {$t('用于 MCP 服务与依赖安装的 Python 包管理工具。')}
              </div>
            </div>
          </div>
          {ready && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('uv 可执行文件')}</div>
              <input className="input" type="text" value={runtimeEnvironmentStatus.binaryPath || ''} readOnly style={{ width: '100%' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}