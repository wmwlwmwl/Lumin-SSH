import React, { useMemo } from 'react';
import { t as $t } from '../../i18n.js';
import { Sun, Monitor, Moon, Trash2 } from 'lucide-react';
import { ToggleSwitch } from './SharedComponents';

export default function AppearanceTab({
  programFonts,
  programFontSearchQuery,
  onProgramFontSearchQueryChange,
  onAddProgramFonts,
  programFontImporting,
  programFontDeleting,
  onDeleteProgramFont,
  programFontAssignments,
  onProgramFontDragStart,
  onProgramFontDragEnd,
  onProgramFontDragEnter,
  onProgramFontDragLeave,
  onProgramFontDrop,
  onProgramFontReset,
  activeProgramFontDropTarget,
  terminalFontSize, onTerminalFontSizeChange,
  terminalLocalEcho, onTerminalLocalEchoChange,
  terminalTimestamps, onTerminalTimestampsChange,
  terminalCommandBlocks, onTerminalCommandBlocksChange,
  themePackages,
  themePackageSettings,
  themeMode, onThemeChange,
  onSelectLightThemePackage,
  onSelectDarkThemePackage,
  onReloadThemePackages,
  onOpenThemePackagesDirectory,
  onImportThemePackages,
  onTuneActiveThemeWithAI,
  onDeleteThemePackage,
  themePackageBusy,
  showThemeQuickEntry, onToggleThemeQuickEntry,
  probePanelPosition, onProbePanelPositionChange,
  termBgImage, onTermBgUpload, onTermBgReset,
  termBgOpacity, onTermBgOpacityChange,
  rememberWindowSize, onToggleRememberWindowSize, onResetWindowSize,
}) {
  const fontMap = new Map((Array.isArray(programFonts) ? programFonts : []).map((font) => [font.fileName, font]));
  const filteredFonts = (Array.isArray(programFonts) ? programFonts : []).filter((font) => {
    const query = String(programFontSearchQuery || '').trim().toLowerCase();
    if (!query) {
      return true;
    }
    return String(font.displayName || '').toLowerCase().includes(query) || String(font.fileName || '').toLowerCase().includes(query);
  });
  const fontAssignments = programFontAssignments || { uiFileName: '', terminalFileName: '', aiFileName: '' };
  const fontTargets = [
    {
      key: 'ui',
      title: $t('界面文本'),
      description: $t('作用于应用界面中的普通文本'),
      defaultText: 'Inter / Segoe UI / sans-serif',
      fileName: fontAssignments.uiFileName || '',
    },
    {
      key: 'terminal',
      title: $t('终端输出'),
      description: $t('只作用于终端输出区域，不影响界面控件'),
      defaultText: 'JetBrains Mono / Fira Code / monospace',
      fileName: fontAssignments.terminalFileName || '',
    },
    {
      key: 'ai',
      title: $t('AI面板'),
      description: $t('作用于 AI 面板普通文本与输入区，代码块保持默认等宽字体'),
      defaultText: 'Inter / Segoe UI / sans-serif',
      fileName: fontAssignments.aiFileName || '',
    },
  ];

  const normalizedThemePackages = Array.isArray(themePackages) ? themePackages : [];
  const lightThemePackages = normalizedThemePackages.filter((themePackage) => themePackage?.modeHint === 'light');
  const darkThemePackages = normalizedThemePackages.filter((themePackage) => themePackage?.modeHint !== 'light');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 10, fontWeight: 600 }}>{$t('终端显示')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{$t('字体管理器')}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('从字体目录拖拽字体到右侧区域，为界面文本、终端输出和 AI 面板分别分配字体')}</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={onAddProgramFonts} disabled={programFontImporting} style={{ fontSize: 12, borderRadius: 'var(--radius-sm)' }}>
                {programFontImporting ? $t('导入中...') : $t('添加字体')}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 22, padding: '0 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-secondary)', fontSize: 11 }}>
                    {$t('来源：字体目录')}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{filteredFonts.length} {$t('个字体')}</span>
                </div>
                <input
                  className="input"
                  value={programFontSearchQuery}
                  onChange={(event) => onProgramFontSearchQueryChange(event.target.value)}
                  placeholder={$t('搜索字体文件名')}
                  style={{ minHeight: 30, fontSize: 12 }}
                />
                <div style={{ minHeight: 292, maxHeight: 292, overflowY: 'auto', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--surface-base)', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filteredFonts.length === 0 ? (
                    <div style={{ display: 'flex', flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.7 }}>
                      {Array.isArray(programFonts) && programFonts.length > 0 ? $t('没有匹配的字体文件') : $t('字体目录中还没有字体，请先添加字体文件')}
                    </div>
                  ) : filteredFonts.map((font) => (
                    <div
                      key={font.fileName}
                      draggable={true}
                      onDragStart={(event) => onProgramFontDragStart(event, font.fileName)}
                      onDragEnd={onProgramFontDragEnd}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border)',
                        background: 'var(--surface-overlay)',
                        cursor: 'grab',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{font.displayName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{font.fileName}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        aria-label={$t('删除字体')}
                        title={$t('删除字体')}
                        disabled={!!programFontDeleting}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDeleteProgramFont?.(font.fileName);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{ flexShrink: 0, color: 'var(--danger)', opacity: programFontDeleting ? 0.5 : 1 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, alignSelf: 'stretch' }}>
                {fontTargets.map((target) => {
                  const assignedFont = target.fileName ? fontMap.get(target.fileName) : null;
                  const isHighlighted = activeProgramFontDropTarget === target.key;
                  return (
                    <div
                      key={target.key}
                      onDragEnter={() => onProgramFontDragEnter(target.key)}
                      onDragLeave={() => onProgramFontDragLeave(target.key)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                        onProgramFontDragEnter(target.key);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const nextFileName = event.dataTransfer.getData('text/plain');
                        onProgramFontDrop(target.key, nextFileName);
                      }}
                      style={{
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${isHighlighted ? 'var(--accent)' : 'var(--border)'}`,
                        background: isHighlighted ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--surface-base)',
                        boxShadow: isHighlighted ? '0 0 0 1px rgba(var(--accent-rgb), 0.18) inset' : 'none',
                        padding: 14,
                        minHeight: 88,
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 10,
                        transition: 'var(--transition-fast)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{target.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{target.description}</div>
                        </div>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => onProgramFontReset(target.key)}
                          disabled={!target.fileName}
                          style={{ fontSize: 12, borderRadius: 'var(--radius-sm)', flexShrink: 0 }}
                        >
                          {$t('恢复默认')}
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-overlay)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
                          {assignedFont ? assignedFont.displayName : $t('默认')}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {assignedFont ? assignedFont.fileName : target.defaultText}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="divider" style={{ margin: '16px 0 12px', borderTop: '1px solid var(--border)' }} />
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
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('命令块边框')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('左侧显示可折叠命令块，点击收起输出')}</div>
            </div>
            <ToggleSwitch checked={terminalCommandBlocks} onChange={() => onTerminalCommandBlocksChange(!terminalCommandBlocks)} />
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('主题包')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('主题')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('浅色、深色和系统模式分别决定当前应用哪一套主题包')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onToggleThemeQuickEntry}
                aria-pressed={showThemeQuickEntry}
                aria-label={$t('快捷入口')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 34,
                  padding: '0 12px',
                  borderRadius: 999,
                  border: `1px solid ${showThemeQuickEntry ? 'rgba(var(--accent-rgb), 0.28)' : 'var(--border)'}`,
                  background: showThemeQuickEntry ? 'rgba(var(--accent-rgb), 0.1)' : 'var(--surface-raised)',
                  color: showThemeQuickEntry ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'var(--transition-fast)',
                  boxShadow: showThemeQuickEntry ? '0 0 0 1px rgba(var(--accent-rgb), 0.12) inset' : 'none',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>{$t('快捷入口')}</span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 999,
                    background: showThemeQuickEntry ? 'var(--accent)' : 'var(--surface-hover)',
                    border: '1px solid var(--border)',
                    position: 'relative',
                    transition: 'var(--transition-fast)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 1,
                      left: showThemeQuickEntry ? 17 : 1,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#fff',
                      boxShadow: 'var(--shadow-xs)',
                      transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                </span>
              </button>
              <div style={{ display: 'flex', background: 'var(--surface-raised)', borderRadius: 'var(--radius-xl)', padding: 4, border: '1px solid var(--border)' }}>
                <button className={`btn btn-sm ${themeMode === 'light' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onThemeChange('light')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'light' ? 'var(--surface-sunken)' : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sun size={14} />{$t('浅色')}</button>
                <button className={`btn btn-sm ${themeMode === 'system' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onThemeChange('system')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'system' ? 'var(--surface-sunken)' : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Monitor size={14} />{$t('系统')}</button>
                <button className={`btn btn-sm ${themeMode === 'dark' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onThemeChange('dark')} style={{ borderRadius: 'var(--radius-xl)', background: themeMode === 'dark' ? 'var(--surface-sunken)' : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Moon size={14} />{$t('深色')}</button>
              </div>
            </div>
          </div>

          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={onReloadThemePackages} disabled={themePackageBusy}>{$t('重新扫描')}</button>
              <button className="btn btn-secondary btn-sm" onClick={onOpenThemePackagesDirectory} disabled={themePackageBusy}>{$t('打开目录')}</button>
              <button className="btn btn-secondary btn-sm" onClick={onImportThemePackages} disabled={themePackageBusy}>{$t('导入JSON')}</button>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={onTuneActiveThemeWithAI} disabled={themePackageBusy}>{$t('AI调色')}</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
            <ThemePackagePalette
              title={$t('浅色主题包')}
              description={$t('当主题为浅色或系统切换到浅色时使用')}
              packages={lightThemePackages}
              selectedThemePackageId={themePackageSettings?.lightThemePackageId}
              onSelectThemePackage={onSelectLightThemePackage}
              onDeleteThemePackage={onDeleteThemePackage}
              themePackageBusy={themePackageBusy}
            />
            <ThemePackagePalette
              title={$t('深色主题包')}
              description={$t('当主题为深色或系统切换到深色时使用')}
              packages={darkThemePackages}
              selectedThemePackageId={themePackageSettings?.darkThemePackageId}
              onSelectThemePackage={onSelectDarkThemePackage}
              onDeleteThemePackage={onDeleteThemePackage}
              themePackageBusy={themePackageBusy}
            />
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

function ThemePackagePalette({
  title,
  description,
  packages,
  selectedThemePackageId,
  onSelectThemePackage,
  onDeleteThemePackage,
  themePackageBusy,
}) {
  const normalizedPackages = Array.isArray(packages) ? packages : [];
  const palettePackages = useMemo(() => normalizedPackages.map((themePackage) => ({
    ...themePackage,
    preview: themePackage?.preview || {},
  })), [normalizedPackages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{description}</div>
      </div>
      {palettePackages.length === 0 ? (
        <div style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', color: 'var(--text-tertiary)', fontSize: 12 }}>
          {$t('当前没有可用的主题包')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {palettePackages.map((themePackage) => {
            const isActive = selectedThemePackageId === themePackage.id;
            const canDelete = themePackage.source === 'user';
            return (
              <div
                key={themePackage.id}
                onClick={() => onSelectThemePackage(themePackage.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--surface-base)',
                  boxShadow: isActive ? '0 0 0 1px rgba(var(--accent-rgb), 0.18) inset' : 'none',
                  cursor: 'pointer',
                  minWidth: 0,
                  transition: 'var(--transition-fast)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {$t(themePackage.name)}
                  </div>
                  {themePackage.description ? (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {$t(themePackage.description)}
                    </div>
                  ) : null}
                </div>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  {themePackage.source === 'builtin' ? $t('内置') : $t('用户')}
                </span>
                {canDelete ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={$t('删除主题包')}
                    title={$t('删除主题包')}
                    disabled={themePackageBusy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteThemePackage?.(themePackage);
                    }}
                    style={{ width: 24, height: 24, color: 'var(--danger)', flexShrink: 0 }}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}