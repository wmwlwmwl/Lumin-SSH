import { t as $t } from '../../i18n.js';
import { ToggleSwitch } from './SharedComponents';

export default function GeneralTab({
  language, onLanguageChange,
  confirmCloseSession, onToggleConfirmCloseSession,
  confirmCloseAll, onToggleConfirmCloseAll,
  windowCloseAction, onWindowCloseActionChange,
  updateUseProxy, onToggleUpdateUseProxy,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('语言')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('界面语言')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('选择界面显示语言')}</div>
            </div>
            <select className="select" style={{ width: 200 }} value={language} onChange={onLanguageChange}>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('操作确认')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('关闭连接时确认')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('关闭单个 SSH 连接前弹出确认弹窗')}</div>
            </div>
            <ToggleSwitch checked={confirmCloseSession} onChange={onToggleConfirmCloseSession} />
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('关闭全部时确认')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('批量关闭所有连接前弹出确认弹窗')}</div>
            </div>
            <ToggleSwitch checked={confirmCloseAll} onChange={onToggleConfirmCloseAll} />
          </div>
          <div className="divider" style={{ margin: '12px 0', borderTop: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('关闭窗口时')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('选择关闭窗口时的默认行为')}</div>
            </div>
            <select className="select" style={{ width: 160 }} value={windowCloseAction} onChange={e => onWindowCloseActionChange(e.target.value)}>
              <option value="ask">{$t('每次询问')}</option>
              <option value="quit">{$t('直接退出')}</option>
              <option value="tray">{$t('最小化到托盘')}</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 600 }}>{$t('更新下载')}</h3>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('优先使用代理下载')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('通过多个代理加速 GitHub 更新下载，失败自动回退直连')}</div>
            </div>
            <ToggleSwitch checked={updateUseProxy} onChange={onToggleUpdateUseProxy} />
          </div>
        </div>
      </div>
    </div>
  );
}
