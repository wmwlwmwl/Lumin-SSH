import { FolderOpen } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { TERMINAL_ENCODING_GROUPS } from '../../constants/terminalEncodings.ts';
import { useTranslation, type I18nKey } from '../../i18n.ts';
import SearchableGroupedSelect from '../SearchableGroupedSelect.tsx';
import type { ServerEditorForm } from './serverModalTypes.ts';

export interface AddServerAdvancedSectionProps {
  form: ServerEditorForm;
  set: (key: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  setForm: React.Dispatch<React.SetStateAction<ServerEditorForm>>;
  inputClass: (key: string) => string;
  inputShellClass: (key: string) => string;
}

export function AddServerAdvancedSection({
  form,
  set,
  setForm,
  inputClass,
  inputShellClass,
}: AddServerAdvancedSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="webdav-section server-editor-section">
      <div className="webdav-section-title server-editor-section-title">
        <span className="server-editor-section-icon"><FolderOpen size={15} /></span> {t('高级选项')}
      </div>
      <div className="server-editor-fields">
        <div className="form-group">
          <label className="form-label" htmlFor="server-terminal-init-path">{t('终端默认 cd 目录')}</label>
          <div className={inputShellClass('terminalInitPath')}>
            <input
              id="server-terminal-init-path"
              name="terminalInitPath"
              className={inputClass('terminalInitPath')}
              data-editor-field="terminalInitPath"
              placeholder="/root"
              value={form.terminalInitPath || ''}
              onChange={set('terminalInitPath')}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="server-file-manager-init-path">{t('文件管理器初始目录')}</label>
          <div className={inputShellClass('fileManagerInitPath')}>
            <input
              id="server-file-manager-init-path"
              name="fileManagerInitPath"
              className={inputClass('fileManagerInitPath')}
              data-editor-field="fileManagerInitPath"
              placeholder="/var/www"
              value={form.fileManagerInitPath || ''}
              onChange={set('fileManagerInitPath')}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="server-terminal-encoding">{t('终端字符编码')}</label>
          <SearchableGroupedSelect
            id="server-terminal-encoding"
            value={form.terminalEncoding || 'utf-8'}
            onChange={(nextValue) => setForm((f) => ({ ...f, terminalEncoding: nextValue }))}
            groups={TERMINAL_ENCODING_GROUPS.map((group) => ({ ...group, label: t(group.label as I18nKey) }))}
            placeholder={t('终端字符编码')}
            searchPlaceholder={t('输入关键字过滤字符编码')}
            emptyText={t('未找到匹配的字符编码')}
            renderOptionLabel={(item) => (
              item.value === 'utf-8'
                ? 'UTF-8'
                : (item.value === 'gb18030'
                  ? t('GB18030(兼容 GBK/GB2312)')
                  : (item.label || ''))
            )}
          />
          <div className="text-tertiary text-xs mt-1.5">
            {t('设置该连接的终端输入与输出编码')}
          </div>
        </div>
        <label className="server-editor-compat-check" htmlFor="server-legacy-ssh-rsa">
          <input
            id="server-legacy-ssh-rsa"
            name="allowLegacySshRsa"
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
  );
}
