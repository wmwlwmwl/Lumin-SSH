import { Monitor } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useTranslation } from '../../i18n.ts';
import type { ServerEditorForm } from './serverModalTypes.ts';

export interface AddServerBasicSectionProps {
  form: ServerEditorForm;
  set: (key: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  allGroups?: string[];
  inputClass: (key: string) => string;
  inputShellClass: (key: string) => string;
}

export function AddServerBasicSection({
  form,
  set,
  allGroups = [],
  inputClass,
  inputShellClass,
}: AddServerBasicSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="webdav-section server-editor-section">
      <div className="webdav-section-title server-editor-section-title">
        <span className="server-editor-section-icon"><Monitor size={15} /></span> {t('基本信息')}
      </div>
      <div className="server-editor-fields">
        <div className="form-group">
          <label className="form-label" htmlFor="server-name">{t('服务器别名（选填）')}</label>
          <div className={inputShellClass('name')}>
            <input
              id="server-name"
              name="name"
              autoComplete="off"
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
            <label className="form-label" htmlFor="server-host">{t('主机地址 *')}</label>
            <div className={inputShellClass('host')}>
              <input
                id="server-host"
                name="host"
                className={inputClass('host')}
                data-editor-field="host"
                placeholder={t('192.168.1.1 或 example.com')}
                value={form.host}
                onChange={set('host')}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="server-port">{t('端口')}</label>
            <div className={inputShellClass('port')}>
              <input
                id="server-port"
                name="port"
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
          <label className="form-label" htmlFor="server-username">{t('用户名')} *</label>
          <div className={inputShellClass('username')}>
            <input
              id="server-username"
              name="username"
              autoComplete="username"
              className={inputClass('username')}
              data-editor-field="username"
              placeholder="root"
              value={form.username}
              onChange={set('username')}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="server-group">{t('分组')}</label>
          <input
            id="server-group"
            name="group"
            className="input"
            list="group-options"
            placeholder={t('默认（不填则不分组）')}
            value={form.group || ''}
            onChange={set('group')}
          />
          <datalist id="group-options">
            {allGroups.map((g) => <option key={g} value={g} />)}
          </datalist>
        </div>
      </div>
    </div>
  );
}
