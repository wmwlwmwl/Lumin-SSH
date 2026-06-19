import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';

const defaultForm = {
  name: '',
  host: '',
  port: '22',
  username: 'root',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
};

export default function AddServerModal({ server, onSave, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  useEffect(() => {
    if (server) {
      setForm({
        ...defaultForm,
        ...server,
        authType: server.authMethod ? (server.authMethod === 'privateKey' ? 'key' : 'password') : (server.authType || 'password'),
        password: '',       // 编辑时不回填密码，留空则不修改
        passphrase: server.passphrase || '',
      });
    } else {
      setForm(defaultForm);
    }
  }, [server]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.host.trim()) return window.luminDialog?.alert(t('请填写主机地址'));
    if (!form.username.trim()) return window.luminDialog?.alert(t('请填写用户名'));

    setSaving(true);
    try {
      const data = { ...form };
      data.port = parseInt(data.port, 10) || 22;
      data.authMethod = form.authType === 'key' ? 'privateKey' : 'password';
      if (server?.id) data.id = server.id;
      if (server?.id && !data.password) delete data.password;
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
            <span>{server ? '✏️' : '➕'}</span>
            {server ? t('编辑配置') : t('添加')}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="webdav-section">
              <div className="webdav-section-title">🖥 {t('基本信息')}</div>
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
                    <label className="form-label">Port</label>
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
              </div>
            </div>

            <div className="webdav-section">
              <div className="webdav-section-title">🔑 {t('认证方式')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 12, bottom: 10, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>{t('私钥内容')}</label>
                        <button type="button" className="btn-secondary btn-sm" onClick={handleSelectPrivateKeyFile} style={{ padding: '2px 8px', fontSize: 11 }}>
                          📁 {t('浏览')}
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
                        placeholder="Passphrase"
                        value={form.passphrase}
                        onChange={set('passphrase')}
                        style={{ paddingRight: 36 }}
                      />
                      <button type="button" onClick={() => setShowPassphrase(!showPassphrase)} style={{ position: 'absolute', right: 12, bottom: 10, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                        {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
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
