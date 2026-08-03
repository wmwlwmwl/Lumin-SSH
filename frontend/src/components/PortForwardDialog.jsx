import { useState, useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { useTranslation } from '../i18n.js';

export default function PortForwardDialog({
    sessionId,
    onClose,
    initialMapping = null,
    portListeningEnabled = false,
    onPortListeningEnabledChange,
}) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState(initialMapping ? 'new' : 'list');
    const [portForwards, setPortForwards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [kind, setKind] = useState(initialMapping?.kind || 'local');
    const [localHost, setLocalHost] = useState(initialMapping?.localHost || '127.0.0.1');
    const [localPort, setLocalPort] = useState(initialMapping?.localPort || '');
    const [remoteHost, setRemoteHost] = useState(initialMapping?.remoteHost || '127.0.0.1');
    const [remotePort, setRemotePort] = useState(initialMapping?.remotePort || '');
    const [error, setError] = useState('');

    useEffect(() => {
        void refreshPortForwards();
    }, [sessionId]);

    useEffect(() => {
        if (!initialMapping) return;
        setActiveTab('new');
        setKind(initialMapping.kind || 'local');
        setLocalHost(initialMapping.localHost || '127.0.0.1');
        setLocalPort(initialMapping.localPort || '');
        setRemoteHost(initialMapping.remoteHost || '127.0.0.1');
        setRemotePort(initialMapping.remotePort || '');
    }, [initialMapping]);

    const refreshPortForwards = async () => {
        setLoading(true);
        try {
            const list = await AppGo.ListPortForwards(sessionId);
            setPortForwards(list || []);
        } catch (err) {
            window.luminDialog?.alert(`${t('加载端口映射失败')}: ${String(err)}`);
        } finally {
            setLoading(false);
        }
    };

    const normalizePort = (value) => {
        return value.trim();
    };

    const validatePort = (value) => {
        const port = normalizePort(value);
        if (!/^[0-9]+$/.test(port)) {
            return false;
        }
        const intValue = Number(port);
        return intValue >= 1 && intValue <= 65535;
    };

    const handleCreate = async () => {
        setError('');
        const normalizedLocalPort = normalizePort(localPort);
        const normalizedRemotePort = normalizePort(remotePort);
        if (!validatePort(normalizedLocalPort) || !validatePort(normalizedRemotePort)) {
            setError(t('请输入有效的端口号（1-65535）'));
            return;
        }
        if (!remoteHost.trim()) {
            setError(t('请输入远程主机地址'));
            return;
        }
        if (!localHost.trim()) {
            setError(t('请输入本机主机地址'));
            return;
        }

        const localAddr = `${localHost}:${normalizedLocalPort}`;
        const remoteAddr = `${remoteHost}:${normalizedRemotePort}`;
        setSubmitting(true);

        try {
            if (kind === 'local') {
                await AppGo.StartLocalPortForward(sessionId, localAddr, remoteAddr);
            } else {
                await AppGo.StartRemotePortForward(sessionId, remoteAddr, localAddr);
            }
            await refreshPortForwards();
            setActiveTab('list');
        } catch (err) {
            if (kind === 'local' && String(err).includes('local port already in use')) {
                setError(t('本地端口已占用'));
                return;
            }
            window.luminDialog?.alert(`${kind === 'local' ? t('创建本地端口映射失败') : t('创建远程端口映射失败')}: ${String(err)}`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleStop = async (id) => {
        let confirmed = true;
        if (typeof window.luminDialog?.confirm === 'function') {
            confirmed = await window.luminDialog.confirm(t('确定关闭此端口映射吗？'), t('操作确认'));
        }
        if (!confirmed) {
            return;
        }

        try {
            await AppGo.StopPortForward(id);
            setPortForwards((prev) => prev.filter((info) => info.ID !== id));
            await refreshPortForwards();
        } catch (err) {
            window.luminDialog?.alert(`${t('关闭端口映射失败')}: ${String(err)}`);
        }
    };

    const renderMappingLabel = (info) => {
        if (info.Kind === 'local') {
            return `${t('远端监听')} ${info.RemoteAddr} → ${t('本机目标')} ${info.LocalAddr}`;
        }
        return `${t('本地监听')} ${info.LocalAddr} → ${t('远程目标')} ${info.RemoteAddr}`;
    };

    return (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: 52 }}>
            <div className="modal modal-md" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: 'calc(100vh - 80px)' }}>
                <div className="modal-header">
                    <div>
                        <div className="modal-title" style={{ marginBottom: 4 }}>{t('端口映射')}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                            {t('本地端口映射到远程；远程端口映射到本地。')}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: 'var(--text-tertiary)', fontSize: 13, cursor: 'not-allowed' }}>
                            <input
                                type="checkbox"
                                checked={portListeningEnabled}
                                onChange={(event) => onPortListeningEnabledChange?.(event.target.checked)}
                                disabled
                            />
                            {t('命令后实时检测新增监听端口（暂已关闭）')}
                        </label>
                    </div>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={onClose} aria-label={t('关闭')}>
                        <X size={16} />
                    </button>
                </div>

                <div style={{ display: 'flex', gap: 8, padding: '8px 24px 0' }}>
                    <button
                        type="button"
                        className={`btn btn-ghost btn-sm${activeTab === 'list' ? ' active' : ''}`}
                        onClick={() => setActiveTab('list')}
                    >
                        {t('当前映射')}
                    </button>
                    <button
                        type="button"
                        className={`btn btn-ghost btn-sm${activeTab === 'new' ? ' active' : ''}`}
                        onClick={() => setActiveTab('new')}
                    >
                        {t('新建映射')}
                    </button>
                </div>

                <div style={{ padding: 24, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                    {activeTab === 'list' ? (
                        <div>
                            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontWeight: 500 }}>{t('当前会话端口映射')}</div>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={refreshPortForwards} disabled={loading}>
                                    {t('刷新')}
                                </button>
                            </div>
                            {loading ? (
                                <div>{t('加载中...')}</div>
                            ) : portForwards.length === 0 ? (
                                <div style={{ color: 'var(--text-tertiary)' }}>{t('当前会话没有端口映射。')}</div>
                            ) : (
                                <div style={{ display: 'grid', rowGap: 12 }}>
                                    {portForwards.map((info) => (
                                        <div key={info.ID} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, marginBottom: 6 }}>{renderMappingLabel(info)}</div>
                                                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{info.ID}</div>
                                                {info.Kind === 'local' && info.LocalAddr && (
                                                    <a
                                                        href={`http://${info.LocalAddr}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, color: 'var(--accent)', fontSize: 12 }}
                                                    >
                                                        {t('打开本地地址')} <ExternalLink size={12} />
                                                    </a>
                                                )}
                                            </div>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleStop(info.ID)}>
                                                {t('停止')}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ display: 'grid', rowGap: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <button
                                    type="button"
                                    className={`btn btn-ghost btn-sm${kind === 'local' ? ' active' : ''}`}
                                    onClick={() => setKind('local')}
                                >
                                    {t('远程端口映射到本地')}
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-ghost btn-sm${kind === 'remote' ? ' active' : ''}`}
                                    onClick={() => setKind('remote')}
                                >
                                    {t('本地端口映射到远程')}
                                </button>
                            </div>

                            <div style={{ display: 'grid', rowGap: 12 }}>
                                <div>
                                    <label className="form-label">
                                        {kind === 'local' ? t('本地监听地址') : t('本地目标地址')}
                                    </label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                                        <input
                                            type="text"
                                            value={localHost}
                                            onChange={(event) => setLocalHost(event.target.value)}
                                            placeholder="127.0.0.1"
                                            className="form-control"
                                        />
                                        <input
                                            type="text"
                                            value={localPort}
                                            onChange={(event) => setLocalPort(event.target.value)}
                                            placeholder={t('端口')}
                                            className="form-control"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="form-label">
                                        {kind === 'local' ? t('远程目标地址') : t('远程监听地址')}
                                    </label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                                        <input
                                            type="text"
                                            value={remoteHost}
                                            onChange={(event) => setRemoteHost(event.target.value)}
                                            placeholder="127.0.0.1"
                                            className="form-control"
                                        />
                                        <input
                                            type="text"
                                            value={remotePort}
                                            onChange={(event) => setRemotePort(event.target.value)}
                                            placeholder={t('端口')}
                                            className="form-control"
                                        />
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div style={{ color: 'var(--danger)', marginTop: 4 }}>{error}</div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                                    {t('关闭')}
                                </button>
                                <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={submitting}>
                                    {submitting ? t('创建中...') : t('创建映射')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
