import React from 'react';
import { t as $t } from '../../i18n.js';
import { Sun, Monitor, Moon } from 'lucide-react';
import { ToggleSwitch } from './SharedComponents';

export default function AppearanceTab({
  terminalFontSize, onTerminalFontSizeChange,
  terminalLocalEcho, onTerminalLocalEchoChange,
  terminalTimestamps, onTerminalTimestampsChange,
  terminalColorTheme, onTerminalColorThemeChange,
  themeMode, onThemeChange,
  probePanelPosition, onProbePanelPositionChange,
  themeAccent, onColorChange,
  useCustomAccent, onToggleAccent,
  termBgImage, onTermBgUpload, onTermBgReset,
  termBgOpacity, onTermBgOpacityChange,
  applyBgGlobally, onToggleApplyBgGlobally,
  rememberWindowSize, onToggleRememberWindowSize, onResetWindowSize,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('终端显示')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('终端字体大小')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('调节终端的字符显示大小')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min="10"
                max="28"
                step="1"
                value={terminalFontSize}
                onChange={onTerminalFontSizeChange}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, width: 32, textAlign: 'right', color: 'var(--text-primary)' }}>{terminalFontSize}px</span>
            </div>
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('终端输入回显')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('关闭后输入密码等敏感内容时不会显示字符')}</div>
            </div>
            <ToggleSwitch checked={terminalLocalEcho} onChange={() => onTerminalLocalEchoChange(!terminalLocalEcho)} />
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('每行显示时间')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('在终端每行输出前添加时间戳')}</div>
            </div>
            <ToggleSwitch checked={terminalTimestamps} onChange={() => onTerminalTimestampsChange(!terminalTimestamps)} />
          </div>
        </div>
      </div>

      {/* ── 终端颜色主题 ── */}
      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('终端颜色主题')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginBottom: 12 }}>{$t('选择终端的配色风格，即时生效')}</div>
          <div className="theme-palette-grid">
            {[
              { key: 'lumin',       name: 'Lumin Default', swatches: ['var(--success)', '#58a6ff', '#bc8cff', '#0d1117'] },
              { key: 'tokyo-night', name: 'Tokyo Night',   swatches: ['#7aa2f7', '#bb9af7', '#73daca', '#1a1b26'] },
              { key: 'catppuccin',  name: 'Catppuccin',    swatches: ['#cba6f7', '#89b4fa', '#a6e3a1', '#1e1e2e'] },
              { key: 'dracula',     name: 'Dracula',       swatches: ['#ff79c6', '#bd93f9', '#50fa7b', '#282a36'] },
            ].map(({ key, name, swatches }) => (
              <div
                key={key}
                className={`theme-palette-card${terminalColorTheme === key ? ' active' : ''}`}
                onClick={() => onTerminalColorThemeChange(key)}
              >
                <div className="theme-palette-swatches">
                  {swatches.map((c, i) => (
                    <div key={i} className="theme-palette-swatch" style={{ background: c }} />
                  ))}
                </div>
                <div className="theme-palette-name">{name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('界面主题')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('主题')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('选择浅色、深色或跟随系统设置')}</div>
            </div>
            <div style={{ display: 'flex', background: 'var(--surface-raised)', borderRadius: 'var(--radius-xl)', padding: 4, border: '1px solid var(--border)' }}>
              <button className={`btn btn-sm ${themeMode === 'light' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onThemeChange('light')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'light' ? 'var(--surface-sunken)' : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sun size={14} />{$t('浅色')}</button>
              <button className={`btn btn-sm ${themeMode === 'system' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onThemeChange('system')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'system' ? 'var(--surface-sunken)' : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Monitor size={14} />{$t('系统')}</button>
              <button className={`btn btn-sm ${themeMode === 'dark' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onThemeChange('dark')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'dark' ? 'var(--surface-sunken)' : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Moon size={14} />{$t('深色')}</button>
            </div>
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('监控面板位置')}</div>
            </div>
            <div style={{ display: 'flex', background: 'var(--surface-raised)', borderRadius: 'var(--radius-xl)', padding: 4, border: '1px solid var(--border)' }}>
              <button className={`btn btn-sm ${probePanelPosition === 'left' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onProbePanelPositionChange('left')} style={{ borderRadius: 'var(--radius-xl)', background: probePanelPosition === 'left' ? 'var(--surface-sunken)' : 'transparent' }}>{$t('左侧')}</button>
              <button className={`btn btn-sm ${probePanelPosition === 'right' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onProbePanelPositionChange('right')} style={{ borderRadius: 'var(--radius-xl)', background: probePanelPosition === 'right' ? 'var(--surface-sunken)' : 'transparent' }}>{$t('右侧')}</button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('强调色')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('使用自定义强调色')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('覆盖主题自带的强调色')}</div>
            </div>
            <ToggleSwitch checked={useCustomAccent} onChange={onToggleAccent} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['#3b82f6','#8b5cf6','#d946ef','#f43f5e','#f97316','#eab308','#84cc16','#10b981','#06b6d4','#64748b'].map((color, i) => (
              <div key={i} onClick={() => onColorChange(color)} style={{
                width: 24, height: 24, borderRadius: '50%', background: color, cursor: 'pointer',
                border: themeAccent === color ? '2px solid #fff' : 'none',
                boxShadow: themeAccent === color ? `0 0 0 2px ${color}` : 'none'
              }} />
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('终端背景')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('自定义终端壁纸')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('设置终端底部的自定义背景图片')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {termBgImage && (
                <button className="btn btn-ghost btn-sm" onClick={onTermBgReset} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {$t('恢复默认')}
                </button>
              )}
              <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', fontSize: 12, borderRadius: 'var(--radius-sm)' }}>
                {$t('上传图片')}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onTermBgUpload} />
              </label>
            </div>
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('壁纸可见度')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={termBgOpacity}
                onChange={onTermBgOpacityChange}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, width: 32, textAlign: 'right', color: 'var(--text-primary)' }}>{Math.round(termBgOpacity * 100)}%</span>
            </div>
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('应用到全局背景')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('将终端壁纸同时应用到主窗口背景')}</div>
            </div>
            <ToggleSwitch checked={applyBgGlobally} onChange={onToggleApplyBgGlobally} />
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('窗口大小')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('记住窗口大小')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('下次启动时恢复上次调整的窗口尺寸')}</div>
            </div>
            <ToggleSwitch checked={rememberWindowSize} onChange={onToggleRememberWindowSize} />
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('下次启动时恢复上次调整的窗口尺寸')}</div>
            <button className="btn btn-secondary btn-sm" onClick={onResetWindowSize} style={{ fontSize: 12, borderRadius: 'var(--radius-sm)' }}>
              {$t('恢复默认大小')}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
