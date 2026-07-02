import React from 'react';
import { t as $t } from '../../i18n.js';
import { ToggleSwitch } from './SharedComponents';

export default function AITab({
  showAIPanel,
  onToggleShowAIPanel,
  aiTerminalIsolation,
  onToggleAiTerminalIsolation,
  terminalOutputLineLimit,
  onTerminalOutputLineLimitChange,
  terminalOutputCharacterLimit,
  onTerminalOutputCharacterLimitChange,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('AI 集成')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('显示 AI 代理面板')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('控制会话页是否显示 AI 代理面板')}</div>
            </div>
            <ToggleSwitch checked={showAIPanel} onChange={onToggleShowAIPanel} />
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('终端隔离')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('为每个终端创建独立的 AI 面板与运行期会话。修改后将在下次启动应用时生效。')}</div>
            </div>
            <ToggleSwitch checked={aiTerminalIsolation} onChange={onToggleAiTerminalIsolation} />
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('终端输出行数上限')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('控制 MCP 终端输出保留的最大行数')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min="10"
                max="5000"
                step="10"
                value={terminalOutputLineLimit}
                onChange={onTerminalOutputLineLimitChange}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, width: 56, textAlign: 'right', color: 'var(--text-primary)' }}>{terminalOutputLineLimit}</span>
            </div>
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('终端输出字符上限')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('控制 MCP 终端输出保留的最大字符数')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min="1000"
                max="500000"
                step="1000"
                value={terminalOutputCharacterLimit}
                onChange={onTerminalOutputCharacterLimitChange}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, width: 72, textAlign: 'right', color: 'var(--text-primary)' }}>{terminalOutputCharacterLimit}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}