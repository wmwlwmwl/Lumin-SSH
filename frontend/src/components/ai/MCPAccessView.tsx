import { useMemo, useState } from 'react';
import { useTranslation, type I18nKey } from '../../i18n.ts';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function ToggleSwitch({ checked, onChange, disabled = false }: ToggleSwitchProps) {
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

interface MCPToolInfo {
  name: string;
  description?: string;
}

interface MCPAccessViewProps {
  mcpInfo: {
    transport?: string;
    url?: string;
    tools?: MCPToolInfo[];
  };
  configText: string;
  configRows: number;
  title: string;
  titleSize?: number;
  showNotice?: boolean;
  showTools?: boolean;
  mcpEnabled?: boolean;
  mcpAllowBrowserCalls?: boolean;
  mcpRequireApproval?: boolean;
  mcpActivityVisible?: boolean;
  onToggleMcpEnabled: () => void;
  onToggleMcpAllowBrowserCalls: () => void;
  onToggleMcpRequireApproval: () => void;
  onToggleMcpActivityVisible: () => void;
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
  mcpRequireApproval = false,
  mcpActivityVisible = false,
  onToggleMcpEnabled,
  onToggleMcpAllowBrowserCalls,
  onToggleMcpRequireApproval,
  onToggleMcpActivityVisible,
}: MCPAccessViewProps) {
  const { t } = useTranslation();

  // 发给外部 AI Agent 的一键配置话术：URL 跟随实际 MCP 地址
  const agentPromptText = useMemo(() => {
    const url = mcpInfo.url || 'http://127.0.0.1:5779/mcp';
    return `请帮我配置这个MCP "lumin-ssh": {
  "type": "streamable-http",
  "url": "${url}",
  "oauth": false,
  "alwaysAllow": [],
  "disabled": false,
  "timeout": 0,
  "disabledForPrompts": false
}`;
  }, [mcpInfo.url]);
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const copyAgentPrompt = () => {
    navigator.clipboard?.writeText(agentPromptText).then(() => {
      setAgentPromptCopied(true);
      window.setTimeout(() => setAgentPromptCopied(false), 1500);
    }).catch(() => {});
  };

  const getToolDescription = (tool: MCPToolInfo) => {
    // 动态 key：mcp.tool.* 为按工具名拼装的键，命中则翻，否则回退工具描述
    const key = `mcp.tool.${tool.name}`;
    const translated = t(key as I18nKey);
    return translated === key ? (tool.description || '-') : translated;
  };

  return (
    <>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: titleSize, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{/* title 为后端动态描述（可能不在翻译表），t() 内部有兜底 */}{t(title as I18nKey)}</div>
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
        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, opacity: mcpEnabled ? 1 : 0.65 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('外部 MCP 操作弹窗')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('默认关闭。开启后弹出 MCP 活动弹窗，实时显示外部客户端（如 Claude Code）的操作痕迹：服务器、命令、状态、输出')}</div>
          </div>
          <ToggleSwitch checked={mcpActivityVisible} onChange={onToggleMcpActivityVisible} disabled={!mcpEnabled} />
        </div>
        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, opacity: mcpEnabled ? 1 : 0.65 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>{t('外部 MCP 写操作需审批')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('开启后，外部客户端的写操作（is_mutating）需在活动弹窗中手动批准才执行（会同时开启活动弹窗）。关闭则自动执行。')}</div>
          </div>
          <ToggleSwitch checked={mcpRequireApproval} onChange={onToggleMcpRequireApproval} disabled={!mcpEnabled} />
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
          id="mcp-access-config"
          name="mcp-access-config"
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
      <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-base)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', flex: 1, minWidth: 0 }}>{t('您可以将这一句话发送给您的 AI Agent')}</div>
          <button
            type="button"
            onClick={copyAgentPrompt}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: agentPromptCopied ? 'var(--surface-raised)' : 'var(--surface-overlay)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {agentPromptCopied ? t('已复制') : t('复制')}
          </button>
        </div>
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface-raised)',
          padding: '8px 12px',
          fontSize: 12,
          lineHeight: '19px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 160,
          overflowY: 'auto',
        }}>
          {agentPromptText}
        </div>
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
