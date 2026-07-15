import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Plus, X, Monitor, Key, FolderOpen, SquarePen, KeyRound, Globe } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';
import { getAIGlobalSettings } from './ai/aiGlobalSettingsBridge.js';

const PROXY_NODES_CHANGED_EVENT = 'lumin:proxy-nodes-changed';

const defaultForm = {
  name: '',
  host: '',
  port: '',
  username: 'root',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  terminalInitPath: '',
  fileManagerInitPath: '',
  allowLegacySshRsa: false,
  proxyMode: 'direct',
  proxyNodeId: '',
  proxyType: 'socks5',
  proxyHost: '',
  proxyPort: '1080',
  proxyUsername: '',
  proxyPassword: '',
};

export default function AddServerModal({ server, onSave, onSaveAndConnect, onClose, allGroups = [], credentials = [], onOpenCredentials, inline = false, shiningFields = {} }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [proxyNodes, setProxyNodes] = useState([]);

  const [authMode, setAuthMode] = useState('custom'); // 'custom' | 'credential'
  const [selectedCredId, setSelectedCredId] = useState('');
  const [clearAfterAdd, setClearAfterAdd] = useState(true);

  const isEditing = !!server?.id;
  const suppressSubmitUntilRef = useRef(0);

  const resetInlineForm = () => {
    setAuthMode('custom');
    setSelectedCredId('');
    setForm(defaultForm);
    setShowPassword(false);
    setShowPassphrase(false);
    setShowProxyPassword(false);
  };

  useEffect(() => {
    if (server) {
      const useCred = !!server.credentialId;
      setAuthMode(useCred ? 'credential' : 'custom');
      setSelectedCredId(useCred ? server.credentialId : '');
      setForm({
        ...defaultForm,
        ...server,
        port: server.port ? String(server.port) : '',
        authType: server.authMethod ? (server.authMethod === 'privateKey' ? 'key' : 'password') : (server.authType || 'password'),
        password: '',
        passphrase: server.passphrase || '',
        proxyMode: server.proxyMode || 'direct',
        proxyNodeId: server.proxyNodeId || '',
        proxyType: server.proxyType || 'socks5',
        proxyHost: server.proxyHost || '',
        proxyPort: server.proxyPort ? String(server.proxyPort) : '1080',
        proxyUsername: server.proxyUsername || '',
        proxyPassword: '',
      });
      setShowProxyPassword(false);
    } else {
      resetInlineForm();
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

  useEffect(() => {
    let cancelled = false;
    const loadProxyNodes = () => {
      getAIGlobalSettings()
        .then((settings) => {
          if (cancelled) return;
          setProxyNodes(Array.isArray(settings?.proxyNodes) ? settings.proxyNodes : []);
        })
        .catch(() => {
          if (cancelled) return;
          setProxyNodes([]);
        });
    };
    const handleProxyNodesChanged = (event) => {
      setProxyNodes(Array.isArray(event?.detail) ? event.detail : []);
    };
    loadProxyNodes();
    window.addEventListener(PROXY_NODES_CHANGED_EVENT, handleProxyNodesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(PROXY_NODES_CHANGED_EVENT, handleProxyNodesChanged);
    };
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const inputClass = (key) => `input${shiningFields?.[key] ? ' editor-field-shine' : ''}`;
  const inputShellClass = (key) => `editor-field-shell${shiningFields?.[key] ? ' editor-field-shell-shine' : ''}`;

  const submitForm = async (submitAction = 'save') => {
    if (Date.now() < suppressSubmitUntilRef.current) return;
    if (!form.host.trim()) return window.luminDialog?.alert(t('请填写主机地址'));
    if (authMode === 'custom' && !form.username.trim()) return window.luminDialog?.alert(t('请填写用户名'));
    if (authMode === 'credential' && !selectedCredId) return window.luminDialog?.alert(t('请选择凭据'));
    if (form.proxyMode === 'node' && !form.proxyNodeId) return window.luminDialog?.alert(t('请选择代理节点'));
    if (form.proxyMode === 'custom' && !String(form.proxyHost || '').trim()) return window.luminDialog?.alert(t('请输入代理主机地址'));

    setSaving(true);
    try {
      const data = { ...form };
      data.port = parseInt(data.port, 10) || 22;
      data.terminalInitPath = String(data.terminalInitPath || '').trim();
      data.fileManagerInitPath = String(data.fileManagerInitPath || '').trim();
      data.allowLegacySshRsa = !!form.allowLegacySshRsa;
      data.proxyMode = form.proxyMode || 'direct';
      data.proxyNodeId = String(data.proxyNodeId || '').trim();
      data.proxyType = form.proxyType || 'socks5';
      data.proxyHost = String(data.proxyHost || '').trim();
      data.proxyPort = parseInt(String(data.proxyPort || '').trim(), 10) || 1080;
      data.proxyUsername = String(data.proxyUsername || '').trim();

      if (authMode === 'credential') {
        data.credentialId = selectedCredId;
        delete data.password;
        delete data.privateKey;
        delete data.passphrase;
        delete data.authMethod;
        delete data.authType;
      } else {
        data.authMethod = form.authType === 'key' ? 'privateKey' : 'password';
        data.credentialId = '';
        if (server?.id && !data.password) delete data.password;
        if (!server?.id && server && !data.password && server.password) data.password = server.password;
        if (server?.id && (!data.privateKey || data.privateKey === '[key configured]')) {
          delete data.privateKey;
        }
        if (server?.id && (!data.passphrase || data.passphrase === '****')) {
          delete data.passphrase;
        }
      }

      if (server?.id && data.proxyMode === 'custom' && !data.proxyPassword) {
        delete data.proxyPassword;
      }

      if (server?.id) data.id = server.id;

      if (submitAction === 'connect' && !server?.id && onSaveAndConnect) {
        const result = await onSaveAndConnect(data, clearAfterAdd);
        if (clearAfterAdd && result) resetInlineForm();
      } else {
        const result = await onSave(data, clearAfterAdd);
        if (!server?.id && clearAfterAdd && result) resetInlineForm();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const submitAction = e?.nativeEvent?.submitter?.dataset?.submitAction || 'save';
    await submitForm(submitAction);
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

  const handleCancel = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    suppressSubmitUntilRef.current = Date.now() + 300;
    if (inline && !server) {
      resetInlineForm();
      return;
    }
    if (inline && server) {
      window.setTimeout(() => onClose(), 0);
      return;
    }
    onClose();
  };

  const panel = (
    <>
      <div className={inline ? 'dashboard-server-editor-header' : 'modal-header'} style={{ flexShrink: 0 }}>
        <div className={inline ? 'dashboard-server-editor-title' : 'modal-title'}>
          <span className={inline ? 'dashboard-server-editor-title-icon' : undefined} data-editor-add-target={!isEditing ? 'true' : undefined} style={{ display: 'inline-flex', alignItems: 'center' }}>{isEditing ? <SquarePen size={16} /> : <Plus size={16} />}</span>
          {isEditing ? t('编辑配置') : t('添加')}
        </div>
        {!inline && <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>}
      </div>

      <form onSubmit={handleSubmit} className={inline ? 'dashboard-server-editor-form' : undefined} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div className={inline ? 'dashboard-server-editor-body' : 'modal-body'} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div className="webdav-section server-editor-section">
            <div className="webdav-section-title server-editor-section-title"><span className="server-editor-section-icon"><Monitor size={15} /></span> {t('基本信息')}</div>
            <div className="server-editor-fields">
              <div className="form-group">
                <label className="form-label">{t('服务器别名（选填）')}</label>
                <div className={inputShellClass('name')}>
                  <input
                    className={inputClass('name')}
                    data-editor-field="name"
                    placeholder={t('例如：我的测试服')}
                    value={form.name}
                    onChange={set('name')}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{t('主机地址 *')}</label>
                  <div className={inputShellClass('host')}>
                    <input
                      className={inputClass('host')}
                      data-editor-field="host"
                      placeholder={t('192.168.1.1 或 example.com')}
                      value={form.host}
                      onChange={set('host')}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('端口')}</label>
                  <div className={inputShellClass('port')}>
                    <input
                      className={inputClass('port')}
                      data-editor-field="port"
                      placeholder="22"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={set('port')}
                    />
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{t('用户名')} *</label>
                <div className={inputShellClass('username')}>
                  <input
                    className={inputClass('username')}
                    data-editor-field="username"
                    placeholder="root"
                    value={form.username}
                    onChange={set('username')}
                  />
                </div>
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

          <div className="webdav-section server-editor-section">
            <div className="webdav-section-title server-editor-section-title"><span className="server-editor-section-icon"><Key size={15} /></span> {t('认证方式')}</div>
            <div className="server-editor-fields">
              <div className="server-editor-auth-row">
                <div className="server-editor-segment">
                  <button type="button" className={authMode === 'custom' ? 'active' : ''} onClick={() => setAuthMode('custom')}>
                    {t('自定义')}
                  </button>
                  <button type="button" className={authMode === 'credential' ? 'active' : ''} onClick={() => setAuthMode('credential')}>
                    {t('使用凭据')}
                  </button>
                </div>
                <button type="button" className="server-editor-credential-button" onClick={onOpenCredentials}>
                  <KeyRound size={13} /> {t('凭据管理')}
                </button>
              </div>

              {authMode === 'credential' ? (
                credentials.length === 0 ? (
                  <div className="server-editor-empty">
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
                      <div className="server-editor-credential-summary">
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
                <div className="form-group">
                  <label className="form-label">
                    {isEditing ? t('新密码（留空则不修改）') : t('密码')} *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      type={showPassword ? "text" : "password"}
                      placeholder={t('请输入密码')}
                      value={form.password}
                      onChange={set('password')}
                      style={{ paddingRight: 36 }}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>{t('私钥内容')}</label>
                      <button type="button" className="btn btn-secondary btn-sm server-editor-browse" onClick={handleSelectPrivateKeyFile}>
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
                  <div className="form-group">
                    <label className="form-label">{t('私钥密码短语 (可选)')}</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="input"
                        type={showPassphrase ? "text" : "password"}
                        placeholder={t('私钥密码短语')}
                        value={form.passphrase}
                        onChange={set('passphrase')}
                        style={{ paddingRight: 36 }}
                      />
                      <button type="button" onClick={() => setShowPassphrase(!showPassphrase)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
                        {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </>
              )}
              </>
              )}
            </div>
          </div>

          <div className="webdav-section server-editor-section">
            <div className="webdav-section-title server-editor-section-title"><span className="server-editor-section-icon"><Globe size={15} /></span> {t('代理服务器')}</div>
            <div className="server-editor-fields">
              <div className="form-group">
                <label className="form-label">{t('代理模式')}</label>
                <select className="select" value={form.proxyMode || 'direct'} onChange={set('proxyMode')}>
                  <option value="direct">{t('直连')}</option>
                  <option value="node">{t('选择代理节点')}</option>
                  <option value="custom">{t('自定义代理')}</option>
                </select>
              </div>
              {form.proxyMode === 'node' ? (
                proxyNodes.length === 0 ? (
                  <div className="server-editor-empty">
                    {t('暂无代理节点，请先到设置中创建')}
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">{t('代理节点')} *</label>
                    <select className="select" value={form.proxyNodeId || ''} onChange={set('proxyNodeId')}>
                      <option value="">{t('请选择代理节点')}</option>
                      {proxyNodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {[
                            node.name || t('未命名节点'),
                            node.type === 'http' ? t('HTTP 代理') : t('SOCKS5 代理'),
                            `${node.host}:${node.port}`,
                          ].join(' · ')}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              ) : null}
              {form.proxyMode === 'custom' ? (
                <>
                  <div className="form-group">
                    <label className="form-label">{t('协议类型')}</label>
                    <select className="select" value={form.proxyType || 'socks5'} onChange={set('proxyType')}>
                      <option value="socks5">{t('SOCKS5 代理')}</option>
                      <option value="http">{t('HTTP 代理')}</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{t('代理主机')} *</label>
                      <input
                        className="input"
                        placeholder="127.0.0.1"
                        value={form.proxyHost || ''}
                        onChange={set('proxyHost')}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('代理端口')}</label>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="1080"
                        value={form.proxyPort || ''}
                        onChange={set('proxyPort')}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('代理用户名')}</label>
                    <input
                      className="input"
                      placeholder="user"
                      value={form.proxyUsername || ''}
                      onChange={set('proxyUsername')}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('代理密码')}</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="input"
                        type={showProxyPassword ? "text" : "password"}
                        placeholder={t('代理密码')}
                        value={form.proxyPassword || ''}
                        onChange={set('proxyPassword')}
                        style={{ paddingRight: 36 }}
                      />
                      <button type="button" onClick={() => setShowProxyPassword(!showProxyPassword)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
                        {showProxyPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="webdav-section server-editor-section">
            <div className="webdav-section-title server-editor-section-title"><span className="server-editor-section-icon"><FolderOpen size={15} /></span> {t('高级选项')}</div>
            <div className="server-editor-fields">
              <div className="form-group">
                <label className="form-label">{t('终端默认 cd 目录')}</label>
                <div className={inputShellClass('terminalInitPath')}>
                  <input
                    className={inputClass('terminalInitPath')}
                    data-editor-field="terminalInitPath"
                    placeholder="/root"
                    value={form.terminalInitPath || ''}
                    onChange={set('terminalInitPath')}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{t('文件管理器初始目录')}</label>
                <div className={inputShellClass('fileManagerInitPath')}>
                  <input
                    className={inputClass('fileManagerInitPath')}
                    data-editor-field="fileManagerInitPath"
                    placeholder="/var/www"
                    value={form.fileManagerInitPath || ''}
                    onChange={set('fileManagerInitPath')}
                  />
                </div>
              </div>
              <label className="server-editor-compat-check">
                <input
                  type="checkbox"
                  checked={!!form.allowLegacySshRsa}
                  onChange={(e) => setForm((f) => ({ ...f, allowLegacySshRsa: e.target.checked }))}
                />
                <span>
                  <strong>{t('兼容旧版 ssh-rsa 主机密钥')}</strong>
                  <small>{t('仅当服务器只支持 ssh-rsa 时启用；不支持低于 1024 位的 RSA 主机密钥')}</small>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className={inline ? 'dashboard-server-editor-footer' : 'modal-footer'} style={{ flexShrink: 0 }}>
          {isEditing ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                {t('取消')}
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submitForm('save')}>
                {saving ? t('保存中...') : t('保存配置')}
              </button>
            </>
          ) : (
            <>
              <label className="server-editor-clear-check" title={t('添加成功后清空表单，方便连续添加多台服务器')}>
                <input type="checkbox" checked={clearAfterAdd} onChange={(e) => setClearAfterAdd(e.target.checked)} />
                {t('添加后清空')}
              </label>
              {server && (
                <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                  {t('取消')}
                </button>
              )}
              <button type="button" data-submit-action="save" className="btn btn-primary" disabled={saving} onClick={() => void submitForm('save')}>
                {saving ? t('保存中...') : t('添加')}
              </button>
              <button type="button" data-submit-action="connect" className="btn btn-success" disabled={saving} onClick={() => void submitForm('connect')}>
                {saving ? t('保存中...') : t('添加并链接')}
              </button>
            </>
          )}
        </div>
      </form>
    </>
  );

  if (inline) {
    return (
      <div className="glass-card dashboard-server-editor">
        <div className="dashboard-server-editor-shell">
          {panel}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: 56 }}>
      <div className="modal modal-md" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: 'calc(100vh - 72px)', maxHeight: 'calc(100vh - 72px)' }}>
        {panel}
      </div>
    </div>
  );
}
