import { useEffect, useState } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';

export default function AIPanel({ width, side }) {
  const { t } = useTranslation();
  const [mcpInfo, setMcpInfo] = useState({ url: '', transport: 'streamable-http', endpoint: '/mcp', instructions: '', logs: '', tools: [] });

  useEffect(() => {
    let cancelled = false;
    AppGo.GetMCPServerInfo()
      .then((info) => {
        if (!cancelled && info) {
          setMcpInfo({
            url: info.url || '',
            transport: info.transport || 'streamable-http',
            endpoint: info.endpoint || '/mcp',
            instructions: info.instructions || '',
            logs: info.logs || '',
            tools: Array.isArray(info.tools) ? info.tools : [],
          });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const configText = `"lumin-ssh": {
  "type": "${mcpInfo.transport || 'streamable-http'}",
  "url": "${mcpInfo.url || ''}",
  "oauth": false,
  "alwaysAllow": [],
  "disabled": false,
  "timeout": 0,
  "disabledForPrompts": false
}`;
  const configRows = Math.max(configText.split('\n').length, 1);

  const getToolDescription = (tool) => {
    const key = `mcp.tool.${tool.name}`;
    const translated = t(key);
    return translated === key ? (tool.description || '-') : translated;
  };

  return (
    <div
      style={{
        width,
        minWidth: width,
        height: '100%',
        minHeight: 0,
        background: 'var(--surface-raised)',
        flexShrink: 0,
        borderRight: side === 'right' ? '1px solid var(--border)' : 'none',
        borderLeft: side === 'left' ? '1px solid var(--border)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        boxSizing: 'border-box',
        gap: 12,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('AI 面板接入方式')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t('可直接粘贴到支持 streamable-http 的 MCP 客户端配置中')}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{t('该面板可在设置中关闭, 仅影响前端展示层, 不影响 MCP 服务的启动, 监听绑定或生命周期管理.')}</div>
      </div>
      <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface-overlay)', border: '1px solid var(--border)' }}>
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
            overflow: 'hidden',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface-base)',
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
      <div style={{ flex: 1, minHeight: 0, padding: 12, borderRadius: 10, background: 'var(--surface-overlay)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>{t('所有工具和用途')}</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'grid', gap: 8, paddingRight: 4 }}>
          {mcpInfo.tools.length > 0 ? mcpInfo.tools.map((tool) => (
            <div key={tool.name} style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-base)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{tool.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, wordBreak: 'break-word' }}>{getToolDescription(tool)}</div>
            </div>
          )) : (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('暂无工具信息')}</div>
          )}
        </div>
      </div>
    </div>
  );
}