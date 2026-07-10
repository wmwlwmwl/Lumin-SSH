import React, { useEffect, useState } from 'react';
import { t as $t } from '../../i18n.js';
import { Lightbulb } from 'lucide-react';
import { ToggleSwitch } from './SharedComponents';
import { getAIGlobalSettings, saveAIGlobalSettings } from '../ai/aiGlobalSettingsBridge.js';

const PROXY_NODES_CHANGED_EVENT = 'lumin:proxy-nodes-changed';

const defaultProxyForm = {
  name: '',
  type: 'socks5',
  host: '',
  port: '1080',
  username: '',
  password: '',
};

function createProxyId() {
  return `proxy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProxyNode(node) {
  const parsedPort = parseInt(String(node?.port ?? '').trim(), 10);
  return {
    id: String(node?.id || createProxyId()),
    name: String(node?.name || '').trim(),
    type: node?.type === 'http' ? 'http' : 'socks5',
    host: String(node?.host || '').trim(),
    port: Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 1080,
    username: String(node?.username || '').trim(),
    password: String(node?.password || ''),
    updatedAt: Number.isFinite(Number(node?.updatedAt)) && Number(node?.updatedAt) > 0 ? Number(node.updatedAt) : Date.now(),
  };
}

const MOBILE_MEDIA_QUERY = '(max-width: 820px)';

function getIsMobileLayout() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export default function NetworkTab({ pingEnabled, onTogglePingEnabled, probeInterval, onProbeIntervalChange, pingInterval, onPingIntervalChange }) {
  const [proxyNodes, setProxyNodes] = useState([]);
  const [proxyForm, setProxyForm] = useState(defaultProxyForm);
  const [editingProxyId, setEditingProxyId] = useState('');
  const [isMobileLayout, setIsMobileLayout] = useState(() => getIsMobileLayout());
  const [aiGlobalSettings, setAIGlobalSettings] = useState(null);

  const persistProxyNodes = (nextNodes) => {
    setProxyNodes(nextNodes);
    window.dispatchEvent(new CustomEvent(PROXY_NODES_CHANGED_EVENT, { detail: nextNodes }));
    const nextSelectedProxyId = nextNodes.some((item) => item.id === aiGlobalSettings?.aiRequestProxyId)
      ? (aiGlobalSettings?.aiRequestProxyId || '')
      : '';
    const nextSettings = {
      ...(aiGlobalSettings || {}),
      proxyNodes: nextNodes,
      aiRequestProxyId: nextSelectedProxyId,
    };
    setAIGlobalSettings(nextSettings);
    saveAIGlobalSettings(nextSettings).catch(() => {});
  };

  const setProxyField = (key) => (e) => {
    const value = e?.target?.value ?? '';
    setProxyForm((current) => ({ ...current, [key]: value }));
  };

  const resetProxyForm = () => {
    setProxyForm(defaultProxyForm);
    setEditingProxyId('');
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleChange = (event) => setIsMobileLayout(event.matches);
    setIsMobileLayout(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAIGlobalSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        const nextNodes = Array.isArray(settings?.proxyNodes) ? settings.proxyNodes.map(normalizeProxyNode) : [];
        setAIGlobalSettings(settings);
        setProxyNodes(nextNodes);
        window.dispatchEvent(new CustomEvent(PROXY_NODES_CHANGED_EVENT, { detail: nextNodes }));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setProxyNodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showAlert = (message) => {
    if (window?.luminDialog?.alert) {
      window.luminDialog.alert(message);
      return;
    }
    window.alert(message);
  };

  const handleProxySubmit = (e) => {
    e?.preventDefault();
    const host = String(proxyForm.host || '').trim();
    const port = parseInt(String(proxyForm.port || '').trim(), 10);
    if (!host) {
      showAlert($t('请输入代理主机地址'));
      return;
    }
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      showAlert($t('请输入有效端口'));
      return;
    }
    const nextNode = normalizeProxyNode({
      ...proxyForm,
      id: editingProxyId || createProxyId(),
      host,
      port,
      updatedAt: Date.now(),
    });
    const nextNodes = editingProxyId
      ? proxyNodes.map((item) => item.id === editingProxyId ? nextNode : item)
      : [...proxyNodes, nextNode];
    persistProxyNodes(nextNodes);
    resetProxyForm();
  };

  const handleProxyEdit = (node) => {
    setEditingProxyId(node.id);
    setProxyForm({
      name: node.name || '',
      type: node.type || 'socks5',
      host: node.host || '',
      port: String(node.port || 1080),
      username: node.username || '',
      password: node.password || '',
    });
  };

  const handleProxyDelete = (id) => {
    const nextNodes = proxyNodes.filter((item) => item.id !== id);
    persistProxyNodes(nextNodes);
    if (editingProxyId === id) {
      resetProxyForm();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{$t('延迟检测')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{$t('开启或关闭对主页所有服务器的网络可用性及延迟自动探测。')}</div>
        <div className="form-group" style={{ background: 'var(--surface-overlay)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{$t('启用延迟检测')}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{$t('定期向服务器发起轻量级探测，实时了解服务器的在线状态和响应速度')}</div>
            </div>
            <ToggleSwitch checked={pingEnabled} onChange={onTogglePingEnabled} />
          </div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{$t('监控刷新频率')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{$t('设置探针数据和延迟测试的自动刷新间隔。越高的频率越实时，但资源占用越大。')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: isMobileLayout ? 'column' : 'row', alignItems: isMobileLayout ? 'stretch' : 'center', justifyContent: 'space-between', gap: isMobileLayout ? 10 : 0 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{$t('探针刷新间隔')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: isMobileLayout ? 'flex-start' : 'flex-end' }}>
              {[1, 3, 5, 10, 30].map((s) => (
                <button
                  key={s}
                  onClick={() => onProbeIntervalChange(s)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: probeInterval === s ? 'var(--success)' : 'var(--border)',
                    background: probeInterval === s ? 'rgba(34,197,94,0.1)' : 'var(--surface-sunken)',
                    color: probeInterval === s ? 'var(--success)' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >{s}s</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: isMobileLayout ? 'column' : 'row', alignItems: isMobileLayout ? 'stretch' : 'center', justifyContent: 'space-between', gap: isMobileLayout ? 10 : 0 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{$t('延迟检测间隔')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: isMobileLayout ? 'flex-start' : 'flex-end' }}>
              {[2, 5, 10, 30].map((s) => (
                <button
                  key={s}
                  onClick={() => onPingIntervalChange(s)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: pingInterval === s ? 'var(--success)' : 'var(--border)',
                    background: pingInterval === s ? 'rgba(34,197,94,0.1)' : 'var(--surface-sunken)',
                    color: pingInterval === s ? 'var(--success)' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >{s}s</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{$t('代理节点管理')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>{$t('添加并管理本地代理节点，可供 AI 请求与服务器 SSH/SFTP 连接复用。')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobileLayout ? '1fr' : 'minmax(0, 1.1fr) minmax(320px, 0.9fr)', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            {proxyNodes.length === 0 ? (
              <div style={{ padding: '18px 16px', background: 'var(--surface-overlay)', borderRadius: 10, border: '1px dashed var(--border)', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{$t('暂无代理节点')}</div>
                <div style={{ fontSize: 12 }}>{$t('创建第一个代理节点后会显示在这里。')}</div>
              </div>
            ) : proxyNodes.map((node) => (
              <div key={node.id} style={{ padding: 14, background: 'var(--surface-overlay)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: isMobileLayout ? 'column' : 'row', alignItems: isMobileLayout ? 'stretch' : 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: isMobileLayout ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', overflowWrap: 'anywhere' }}>{node.name || $t('未命名节点')}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, whiteSpace: isMobileLayout ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', overflowWrap: 'anywhere', lineHeight: 1.6 }}>
                      {[
                        node.type === 'http' ? $t('HTTP 代理') : $t('SOCKS5 代理'),
                        `${node.host}:${node.port}`,
                        ...(node.username ? [`${$t('用户名')}: ${node.username}`] : []),
                        ...(node.password ? [`${$t('密码')}: ••••••`] : []),
                      ].join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: isMobileLayout ? 'flex-start' : 'flex-end' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleProxyEdit(node)}>{$t('编辑')}</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleProxyDelete(node.id)} style={{ color: 'var(--danger)' }}>{$t('删除')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={handleProxySubmit} style={{ padding: 16, background: 'var(--surface-overlay)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{editingProxyId ? $t('编辑') : $t('添加')}</div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{$t('代理名称（备注）')}</label>
              <input className="input" value={proxyForm.name} onChange={setProxyField('name')} placeholder="HK Relay" />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>{$t('仅用于区分代理节点，不参与连接逻辑')}</div>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{$t('协议类型')}</label>
              <select className="select" value={proxyForm.type} onChange={setProxyField('type')}>
                <option value="socks5">{$t('SOCKS5 代理')}</option>
                <option value="http">{$t('HTTP 代理')}</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{$t('主机地址')}</label>
              <input className="input" value={proxyForm.host} onChange={setProxyField('host')} placeholder="127.0.0.1" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{$t('端口')}</label>
              <input className="input" type="number" min={1} max={65535} value={proxyForm.port} onChange={setProxyField('port')} placeholder="1080" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{$t('用户名')}</label>
              <input className="input" value={proxyForm.username} onChange={setProxyField('username')} placeholder="user" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{$t('密码')}</label>
              <input className="input" type="password" value={proxyForm.password} onChange={setProxyField('password')} placeholder="password" />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
              {editingProxyId ? <button type="button" className="btn btn-secondary" onClick={resetProxyForm}>{$t('取消编辑')}</button> : null}
              <button type="submit" className="btn btn-primary">{editingProxyId ? $t('保存配置') : $t('添加')}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
