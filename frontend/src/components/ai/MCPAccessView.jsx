import { useTranslation } from '../../i18n.js';

function ToggleSwitch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled || typeof onChange !== 'function'}
      aria-pressed={checked}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: disabled ? 'var(--surface-hover)' : checked ? 'var(--success)' : 'var(--surface-hover)',
        padding: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        transition: 'var(--transition)',
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
        }}
      />
    </button>
  );
}

export default function MCPAccessView({
  mcpInfo,
  configText,
  configRows,
  title,
  titleSize = 14,
  showNotice = false,
  showTools = false,
  mcpEnabled = true,
  mcpAllowBrowserCalls = false,
  onToggleMcpEnabled,
  onToggleMcpAllowBrowserCalls,
}) {
  const { t } = useTranslation();

  const getToolDescription = (tool) => {
    const key = `mcp.tool.${tool.name}`;
    const translated = t(key);
    return translated === key ? (tool.description || '-') : translated;
  };

  return (
    <>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: titleSize, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t(title)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t('可直接粘贴到支持 streamable-http 的 MCP 客户端配置中')}</div>
        {showNotice && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t('该面板可在设置中关闭, 仅影响前端展示层, 不影响 MCP 服务的启动, 监听绑定或生命周期管理.')}</div>}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('启用 MCP 服务')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('控制本地 MCP 服务是否监听本机回环地址并提供工具能力')}</div>
          </div>
          <ToggleSwitch checked={mcpEnabled} onChange={onToggleMcpEnabled} />
        </div>
        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, opacity: mcpEnabled ? 1 : 0.65 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('允许浏览器调用')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('允许带 Origin 的浏览器请求访问本地 MCP 服务。关闭后仅允许无 Origin 的本机客户端调用')}</div>
          </div>
          <ToggleSwitch checked={mcpAllowBrowserCalls} onChange={onToggleMcpAllowBrowserCalls} disabled={!mcpEnabled} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, padding: 14, background: 'var(--surface-base)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('传输方式')}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{mcpInfo.transport || 'streamable-http'}</div>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('MCP 地址')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>{mcpInfo.url || '-'}</div>
        </div>
      </div>
      <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>{t('MCP 配置片段')}</div>
        <textarea
          readOnly
          value={configText}
          rows={configRows}
          spellCheck={false}
          style={{
            width: '100%',
            height: `${configRows * 19 + 18}px`,
            resize: 'none',
            overflowX: 'auto',
            overflowY: 'hidden',
            whiteSpace: 'pre',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            padding: '8px 12px',
            boxSizing: 'border-box',
            fontSize: 12,
            lineHeight: '19px',
            fontFamily: 'var(--font-mono)',
            outline: 'none',
            display: 'block',
          }}
        />
      </div>
      {showTools && (
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface-overlay)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>{t('本机MCP工具和用途')}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {Array.isArray(mcpInfo.tools) && mcpInfo.tools.length > 0 ? mcpInfo.tools.map((tool) => (
              <div key={tool.name} style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-base)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{tool.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, wordBreak: 'break-word' }}>{getToolDescription(tool)}</div>
              </div>
            )) : (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('暂无工具信息')}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}