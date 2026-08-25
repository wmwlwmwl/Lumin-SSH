import { Eye, EyeOff, Globe } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useTranslation } from '../../i18n.ts';
import type { ProxyNode, ServerEditorForm } from './serverModalTypes.ts';

export interface AddServerProxySectionProps {
  form: ServerEditorForm;
  set: (key: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  proxyNodes: ProxyNode[];
  showProxyPassword: boolean;
  setShowProxyPassword: (show: boolean) => void;
}

export function AddServerProxySection({
  form,
  set,
  proxyNodes,
  showProxyPassword,
  setShowProxyPassword,
}: AddServerProxySectionProps) {
  const { t } = useTranslation();

  return (
    <div className="webdav-section server-editor-section">
      <div className="webdav-section-title server-editor-section-title">
        <span className="server-editor-section-icon"><Globe size={15} /></span> {t('代理服务器')}
      </div>
      <div className="server-editor-fields">
        <div className="form-group">
          <label className="form-label" htmlFor="server-proxy-mode">{t('代理模式')}</label>
          <select id="server-proxy-mode" name="proxyMode" className="select" value={form.proxyMode || 'direct'} onChange={set('proxyMode')}>
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
              <label className="form-label" htmlFor="server-proxy-node">{t('代理节点')} *</label>
              <select id="server-proxy-node" name="proxyNodeId" className="select" value={form.proxyNodeId || ''} onChange={set('proxyNodeId')}>
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
              <label className="form-label" htmlFor="server-proxy-type">{t('协议类型')}</label>
              <select id="server-proxy-type" name="proxyType" className="select" value={form.proxyType || 'socks5'} onChange={set('proxyType')}>
                <option value="socks5">{t('SOCKS5 代理')}</option>
                <option value="http">{t('HTTP 代理')}</option>
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="server-proxy-host">{t('代理主机')} *</label>
                <input
                  id="server-proxy-host"
                  name="proxyHost"
                  className="input"
                  placeholder="127.0.0.1"
                  value={form.proxyHost || ''}
                  onChange={set('proxyHost')}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="server-proxy-port">{t('代理端口')}</label>
                <input
                  id="server-proxy-port"
                  name="proxyPort"
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
              <label className="form-label" htmlFor="server-proxy-username">{t('代理用户名')}</label>
              <input
                id="server-proxy-username"
                name="proxyUsername"
                className="input"
                placeholder="user"
                value={form.proxyUsername || ''}
                onChange={set('proxyUsername')}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="server-proxy-password">{t('代理密码')}</label>
              <div className="relative">
                <input
                  id="server-proxy-password"
                  name="proxyPassword"
                  className="input"
                  type={showProxyPassword ? 'text' : 'password'}
                  placeholder={t('代理密码')}
                  value={form.proxyPassword || ''}
                  onChange={set('proxyPassword')}
                  style={{ paddingRight: 36 }}
                />
                <button type="button" onClick={() => setShowProxyPassword(!showProxyPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-0 text-tertiary cursor-pointer p-1 flex items-center">
                  {showProxyPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
