import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Key, Lock, Eye, EyeOff, X } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';

const defaultCredForm = {
  name: '',
  authMethod: 'password',
  username: 'root',
  password: '',
  privateKey: '',
  passphrase: '',
};

export default function CredentialsModal({ onClose, onChange, addToast }) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultCredForm);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const loadCredentials = async () => {
    try {
      const list = await AppGo.GetCredentials();
      setCredentials(list || []);
    } catch (e) {
      console.error('Failed to load credentials:', e);
    }
  };

  useEffect(() => { loadCredentials(); }, []);

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const startCreate = () => {
    setEditing(null);
    setShowForm(true);
    setForm(defaultCredForm);
    setShowPassword(false);
    setShowPassphrase(false);
  };

  const startEdit = (cred) => {
    setEditing(cred.id);
    setShowForm(true);
    setForm({
      name: cred.name || '',
      authMethod: cred.authMethod || 'password',
      username: cred.username || 'root',
      password: '',
      privateKey: '',
      passphrase: '',
    });
    setShowPassword(false);
    setShowPassphrase(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return window.luminDialog?.alert(t('凭据名称'));
    try {
      const data = { ...form };
      if (editing) data.id = editing;
      await AppGo.SaveCredential(data);
      await loadCredentials();
      addToast(t('凭据已保存'), 'success');
      if (editing) {
        setEditing(null);
        setShowForm(false);
      }
      setForm(defaultCredForm);
      onChange?.();
    } catch (e) {
      window.luminDialog?.alert(String(e));
    }
  };

  const handleDelete = async (cred) => {
    const ok = await window.luminDialog?.confirm(t('确定删除此凭据？'));
    if (!ok) return;
    try {
      await AppGo.DeleteCredential(cred.id);
      await loadCredentials();
      addToast(t('凭据已删除'), 'success');
      if (editing === cred.id) {
        setEditing(null);
        setShowForm(false);
        setForm(defaultCredForm);
      }
      onChange?.();
    } catch (e) {
      window.luminDialog?.alert(String(e));
    }
  };

  const isEditing = editing !== null;

  return (
    <div className="modal-overlay">
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{t('凭据管理')}</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 120px)' }}>
          {credentials.length === 0 && !showForm && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-tertiary)', fontSize: 14 }}>
              {t('暂无凭据')}
            </div>
          )}

          {credentials.map((cred) => (
            <div key={cred.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
              background: editing === cred.id ? 'var(--accent-dim)' : 'var(--surface-secondary)',
            }}>
              <div style={{ color: cred.authMethod === 'privateKey' ? 'var(--warning)' : 'var(--accent)', flexShrink: 0 }}>
                {cred.authMethod === 'privateKey' ? <Key size={16} /> : <Lock size={16} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{cred.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {cred.username} · {cred.authMethod === 'privateKey' ? t('私钥认证') : t('密码认证')}
                </div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => startEdit(cred)} title={t('编辑凭据')}>
                <Pencil size={14} />
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(cred)} title={t('删除凭据')} style={{ color: 'var(--danger)' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {showForm || credentials.length === 0 ? (
            <form onSubmit={handleSave} style={{
              display: 'flex', flexDirection: 'column', gap: 12, padding: 16,
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
              background: 'var(--surface-secondary)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {isEditing ? t('编辑凭据') : t('新增凭据')}
              </div>

              <div className="form-group">
                <label className="form-label">{t('凭据名称')} *</label>
                <input className="input" value={form.name} onChange={set('name')} placeholder={t('凭据名称')} required />
              </div>

              <div className="form-group">
                <label className="form-label">{t('认证方式')}</label>
                <select className="select" value={form.authMethod} onChange={(e) => setForm((f) => ({ ...f, authMethod: e.target.value, password: '', privateKey: '', passphrase: '' }))}>
                  <option value="password">{t('密码认证')}</option>
                  <option value="privateKey">{t('私钥认证')}</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">{t('用户名')} *</label>
                <input className="input" value={form.username} onChange={set('username')} placeholder="root" required />
              </div>

              {form.authMethod === 'password' ? (
                <div className="form-group">
                  <label className="form-label">{t('密码')}</label>
                  <div style={{ position: 'relative' }}>
                    <input className="input" type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} placeholder={isEditing ? t('留空不修改') : t('密码')} style={{ paddingRight: 36 }} />
                    <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}>
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">{t('私钥')}</label>
                    <textarea className="input" rows={4} value={form.privateKey} onChange={set('privateKey')} placeholder={isEditing ? t('留空不修改') : '-----BEGIN RSA PRIVATE KEY-----...'} style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('私钥密码短语')}</label>
                    <div style={{ position: 'relative' }}>
                      <input className="input" type={showPassphrase ? 'text' : 'password'} value={form.passphrase} onChange={set('passphrase')} placeholder={isEditing ? t('留空不修改') : t('私钥密码短语')} style={{ paddingRight: 36 }} />
                      <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowPassphrase(!showPassphrase)} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}>
                        {showPassphrase ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {isEditing && (
                  <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setShowForm(false); setForm(defaultCredForm); }} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    {t('取消')}
                  </button>
                )}
                <button type="submit" className="btn btn-primary">
                  {isEditing ? t('保存') : t('新增凭据')}
                </button>
              </div>
            </form>
          ) : (
            <button className="btn btn-ghost" onClick={startCreate} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', width: '100%' }}>
              <Plus size={16} /> {t('新增凭据')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
