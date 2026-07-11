import { useState, useEffect } from 'react';
import { Database, Upload, Download, FileDown, Eye, EyeOff, X } from 'lucide-react';
import { useTranslation } from '../i18n.js';
import Tiptop from './Tiptop.jsx';
import { Z } from '../constants/zIndex';

/**
 * 数据管理弹窗：导入 / 导出 / 下载模板。
 * 受控组件，由父级条件渲染。
 *
 * props:
 *   onClose          关闭回调
 *   onExport(opts)   导出回调，opts = { useEncryption: bool, password: string }
 *   onImport()       导出回调（内部会处理密码重试）
 *   onDownloadTemplate()  下载模板回调
 *   hasRecoveryPassword bool  本机是否设置了恢复密码（决定是否允许复用恢复密码）
 *   busy             bool  操作进行中（禁用按钮）
 */
export default function ImportExportDialog({ onClose, onExport, onImport, onDownloadTemplate, hasRecoveryPassword, busy }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState('plain');        // 'plain' | 'encrypted'
  const [keyMode, setKeyMode] = useState('recovery');   // 'recovery' | 'password'（仅密文时）
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 切到明文时重置密码相关状态
  useEffect(() => {
    if (format === 'plain') {
      setKeyMode('recovery');
      setPassword('');
    }
  }, [format]);

  // 未设置恢复密码时，密文默认走自定义密码
  useEffect(() => {
    if (format === 'encrypted' && !hasRecoveryPassword) {
      setKeyMode('password');
    }
  }, [format, hasRecoveryPassword]);

  const canExport = () => {
    if (busy) return false;
    if (format === 'encrypted' && keyMode === 'password' && !password.trim()) return false;
    return true;
  };

  const handleExportClick = () => {
    if (!canExport()) return;
    onExport({
      useEncryption: format === 'encrypted',
      password: format === 'encrypted' && keyMode === 'password' ? password : '',
    });
  };

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 12px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)', cursor: 'pointer',
    background: 'var(--surface-secondary)',
    transition: 'border-color 0.15s',
  };
  const activeRowStyle = {
    ...rowStyle,
    borderColor: 'var(--accent)',
    background: 'var(--accent-dim)',
  };
  const radioDot = (active) => (
    <span style={{
      width: 16, height: 16, borderRadius: '50%',
      border: `2px solid ${active ? 'var(--accent)' : 'var(--text-tertiary)'}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
    </span>
  );

  return (
    <div className="modal-overlay" style={{ zIndex: Z.MODAL }}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={18} />
            {t('数据管理')}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="close"><X size={18} /></button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 120px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 导出区 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={14} /> {t('导出全部节点')}
            </div>

            {/* 导出格式选择 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={format === 'plain' ? activeRowStyle : rowStyle} onClick={() => setFormat('plain')} role="radio" aria-checked={format === 'plain'}>
                {radioDot(format === 'plain')}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t('明文')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>.json</div>
                </div>
              </div>
              <div style={format === 'encrypted' ? activeRowStyle : rowStyle} onClick={() => setFormat('encrypted')} role="radio" aria-checked={format === 'encrypted'}>
                {radioDot(format === 'encrypted')}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t('密文')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>.enc</div>
                </div>
              </div>
            </div>

            {/* 加密方式选择（仅密文时显示） */}
            {format === 'encrypted' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('加密方式')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ ...rowStyle, cursor: hasRecoveryPassword ? 'pointer' : 'not-allowed', opacity: hasRecoveryPassword ? 1 : 0.5, padding: '8px 12px' }}
                    onClick={() => hasRecoveryPassword && setKeyMode('recovery')}>
                    {radioDot(keyMode === 'recovery')}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13 }}>{t('复用恢复密码')}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('与同步加密使用同一个恢复密码')}</span>
                    </div>
                    {!hasRecoveryPassword && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{t('未设置')}</span>}
                  </label>
                  <label style={{ ...(keyMode === 'password' ? activeRowStyle : rowStyle), padding: '8px 12px' }} onClick={() => setKeyMode('password')}>
                    {radioDot(keyMode === 'password')}
                    <span style={{ fontSize: 13 }}>{t('自定义密码')}</span>
                  </label>
                </div>

                {keyMode === 'password' && (
                  <div style={{ position: 'relative', marginTop: 2 }}>
                    <input
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={t('请输入导出密码')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                      style={{ width: '100%', paddingRight: 36, height: 34, fontSize: 13 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label="toggle password visibility"
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 2 }}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                )}
                {keyMode === 'recovery' && !hasRecoveryPassword && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', padding: '0 2px' }}>
                    {t('未设置恢复密码，请输入自定义密码或先在同步设置中设置')}
                  </div>
                )}
              </div>
            )}

            <button className="btn btn-primary" onClick={handleExportClick} disabled={!canExport()} style={{ height: 34, fontSize: 13 }}>
              <Download size={14} style={{ marginRight: 6 }} />{t('导出')}
            </button>
          </div>

          {/* 分隔线 */}
          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* 导入区 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Upload size={14} /> {t('从文件导入')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {t('支持明文 JSON 与密文 .enc；密文会优先尝试恢复密码，兼容旧版云同步密钥，失败时提示输入密码')}
            </div>
            <button className="btn btn-secondary" onClick={onImport} disabled={busy} style={{ height: 34, fontSize: 13 }}>
              <Upload size={14} style={{ marginRight: 6 }} />{t('选择文件并导入')}
            </button>
            {/* 模板下载：隶属导入区，明文模板供用户照着填后导入 */}
            <button className="btn btn-ghost" onClick={onDownloadTemplate} disabled={busy} style={{ height: 30, fontSize: 12, justifyContent: 'flex-start', color: 'var(--text-tertiary)' }}>
              <FileDown size={13} style={{ marginRight: 6 }} />{t('下载导入模板')}
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>{t('关闭')}</button>
        </div>
      </div>
    </div>
  );
}
