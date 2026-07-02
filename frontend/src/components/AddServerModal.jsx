import { useState, useEffect } from 'react';
import { Eye, EyeOff, Pencil, Plus, X, Monitor, Key, FolderOpen, SquarePen, KeyRound } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';

const defaultForm = {
  name: '',
  host: '',
  port: '',
  username: 'root',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
};

export default function AddServerModal({ server, onSave, onClose, allGroups = [], credentials = [], onOpenCredentials }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const [authMode, setAuthMode] = useState('custom'); // 'custom' | 'credential'
  const [selectedCredId, setSelectedCredId] = useState('');

  useEffect(() => {
    if (server) {
      const useCred = !!server.credentialId;
      setAuthMode(useCred ? 'credential' : 'custom');
      setSelectedCredId(useCred ? server.credentialId : '');
      setForm({
        ...defaultForm,
        ...server,
        authType: server.authMethod ? (server.authMethod === 'privateKey' ? 'key' : 'password') : (server.authType || 'password'),
        password: '',       // 编辑时不回填密码，留空则不修改
        passphrase: server.passphrase || '',
      });
    } else {
      setAuthMode('custom');
      setSelectedCredId('');
      setForm(defaultForm);
    }
  }, [server]);

  // Esc 关闭模态框
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.host.trim()) return window.luminDialog?.alert(t('请填写主机地址'));
    if (authMode === 'custom' && !form.username.trim()) return window.luminDialog?.alert(t('请填写用户名'));
    if (authMode === 'credential' && !selectedCredId) return window.luminDialog?.alert(t('请选择凭据'));

    setSaving(true);
    try {
      const data = { ...form };
      data.port = parseInt(data.port, 10) || 22;

      if (authMode === 'credential') {
        data.credentialId = selectedCredId;
        // 使用凭据时清除内联认证字段
        delete data.password;
        delete data.privateKey;
        delete data.passphrase;
        delete data.authMethod;
        delete data.authType;
      } else {
        data.authMethod = form.authType === 'key' ? 'privateKey' : 'password';
        data.credentialId = ''; // 清除凭据引用
        if (server?.id && !data.password) delete data.password;
        if (server?.id && (!data.privateKey || data.privateKey === '[key configured]')) {
          delete data.privateKey;
        }
        if (server?.id && (!data.passphrase || data.passphrase === '****')) {
          delete data.passphrase;
        }
      }

      if (server?.id) data.id = server.id;
      await onSave(data);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPrivateKeyFile = async () => {
    try {
      const content = await AppGo.ReadPrivateKeyFile();
      if (content) {
        setForm(f => ({ ...f, privateKey: content }));
      }
    } catch (e) {
      if (e) window.luminDialog?.alert(`${t('读取私钥文件失败')}: ${e}`, t('错误'));
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-md">
        <div className="modal-header">
          <div className="modal-title">
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>{server ? <SquarePen size={16} /> : <Plus size={16} />}</span>
            {server ? t('编辑配置') : t('添加')}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="webdav-section">
              <div className="webdav-section-title"><span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 4 }}><Monitor size={16} /></span> {t('基本信息')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">{t('服务器别名（选填）')}</label>
                  <input
                    className="input"
                    placeholder={t('例如：我的测试服')}
                    value={form.name}
                    onChange={set('name')}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">{t('主机地址 *')}</label>
                    <input
                      className="input"
                      placeholder={t('192.168.1.1 或 example.com')}
                      value={form.host}
                      onChange={set('host')}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('端口')}</label>
                    <input
                      className="input"
                      placeholder="22"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={set('port')}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('用户名')} *</label>
                  <input
                    className="input"
                    placeholder="root"
                    value={form.username}
                    onChange={set('username')}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('分组')}</label>
                  <input
                    className="input"
                    list="group-options"
                    placeholder={t('默认（不填则不分组）')}
                    value={form.group || ''}
                    onChange={set('group')}
                  />
                  <datalist id="group-options">
                    {allGroups.map(g => <option key={g} value={g} />)}
                  </datalist>
                </div>
              </div>
            </div>

            <div className="webdav-section">
              <div className="webdav-section-title"><span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 4 }}><Key size={16} /></span> {t('认证方式')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 自定义/使用凭据 切换 */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" className={`btn ${authMode === 'custom' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAuthMode('custom')} style={{ fontSize: 12, padding: '4px 12px', ...(authMode !== 'custom' ? { border: '1px solid var(--border)', color: 'var(--text-secondary)' } : {}) }}>
                    {t('自定义')}
                  </button>
                  <button type="button" className={`btn ${authMode === 'credential' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAuthMode('credential')} style={{ fontSize: 12, padding: '4px 12px', ...(authMode !== 'credential' ? { border: '1px solid var(--border)', color: 'var(--text-secondary)' } : {}) }}>
                    {t('使用凭据')}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={onOpenCredentials} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                    <KeyRound size={13} /> {t('凭据管理')}
                  </button>
                </div>

                {authMode === 'credential' ? (
                  credentials.length === 0 ? (
                    <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      {t('暂无凭据，请先创建')}
                    </div>
                  ) : (
                  <>
                    <div className="form-group">
                      <label className="form-label">{t('选择凭据')} *</label>
                      <select className="select" value={selectedCredId} onChange={(e) => setSelectedCredId(e.target.value)}>
                        <option value="">{t('请选择凭据')}</option>
                        {credentials.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} ({c.username})</option>
                        ))}
                      </select>
                    </div>
                    {selectedCredId && (() => {
                      const sel = credentials.find((c) => c.id === selectedCredId);
                      if (!sel) return null;
                      return (
                        <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--surface-secondary)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
                          {sel.authMethod === 'privateKey' ? t('私钥认证') : t('密码认证')} · {sel.username}
                        </div>
                      );
                    })()}
                  </>
                  )
                ) : (
                  <>
                <div className="form-group">
                  <label className="form-label">{t('认证方式')}</label>
                  <select className="select" value={form.authType} onChange={set('authType')}>
                    <option value="password">{t('密码认证')}</option>
                    <option value="key">{t('私钥认证')}</option>
                  </select>
                </div>

                {form.authType === 'password' ? (
                  <div className="form-group" style={{ position: 'relative' }}>
                    <label className="form-label">
                      {server ? t('新密码（留空则不修改）') : t('密码')} *
                    </label>
                    <input
                      className="input"
                      type={showPassword ? "text" : "password"}
                      placeholder={t('请输入密码')}
                      value={form.password}
                      onChange={set('password')}
                      style={{ paddingRight: 36 }}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 12, bottom: 10, background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>{t('私钥内容')}</label>
                        <button type="button" className="btn-secondary btn-sm" onClick={handleSelectPrivateKeyFile} style={{ padding: '2px 8px', fontSize: 11 }}>
                          <FolderOpen size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> {t('浏览')}
                        </button>
                      </div>
                      <textarea
                        className="input"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          resize: 'vertical',
                          minHeight: 100,
                        }}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                        value={form.privateKey}
                        onChange={set('privateKey')}
                      />
                    </div>
                    <div className="form-group" style={{ position: 'relative' }}>
                      <label className="form-label">{t('私钥密码短语 (可选)')}</label>
                      <input
                        className="input"
                        type={showPassphrase ? "text" : "password"}
                        placeholder={t('私钥密码短语')}
                        value={form.passphrase}
                        onChange={set('passphrase')}
                        style={{ paddingRight: 36 }}
                      />
                      <button type="button" onClick={() => setShowPassphrase(!showPassphrase)} style={{ position: 'absolute', right: 12, bottom: 10, background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                        {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </>
                )}
                </>
                )}


              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('取消')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('保存中...') : server ? t('保存配置') : t('添加')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
