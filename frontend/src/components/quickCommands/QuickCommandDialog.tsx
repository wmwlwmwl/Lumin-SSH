import { useRef, useState } from 'react';
import { Folder } from 'lucide-react';
import { Z } from '../../constants/zIndex.ts';
import { useTranslation } from '../../i18n.ts';
import { extractQuickCommandParams } from '../../utils/quickCommandParams.ts';
import Tiptop from '../Tiptop.tsx';
import { Button, MenuList, MenuPanel, Modal, type MenuItem } from '../ui';
import {
  collectGroups,
  inputClass,
  resolvePath,
  type QuickCommandDialogState,
  type QuickCommandItem,
} from './quickCommandTypes.ts';

export interface QuickCommandDialogProps {
  dialog: QuickCommandDialogState | null;
  setDialog: (dialog: QuickCommandDialogState | null) => void;
  dlgName: string;
  setDlgName: (name: string) => void;
  dlgCmd: string;
  setDlgCmd: React.Dispatch<React.SetStateAction<string>>;
  dlgAddCR: boolean;
  setDlgAddCR: (addCR: boolean) => void;
  handleDlgSave: () => void;
  commands: QuickCommandItem[];
}

export function QuickCommandDialog({
  dialog,
  setDialog,
  dlgName,
  setDlgName,
  dlgCmd,
  setDlgCmd,
  dlgAddCR,
  setDlgAddCR,
  handleDlgSave,
  commands,
}: QuickCommandDialogProps) {
  const { t } = useTranslation();
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [groupPickerPos, setGroupPickerPos] = useState({ x: 0, y: 0 });
  const groupPickerRef = useRef<HTMLSpanElement>(null);

  if (!dialog) return null;

  const insertParam = (n: number) => {
    const tag = `[p#${n} ${t('参数')}${n}]`;
    setDlgCmd((prev) => prev + tag);
  };

  return (
    <Modal
      open
      zIndex={Z.DIALOG}
      onClose={() => { setShowGroupPicker(false); setDialog(null); }}
      panelClassName="max-w-[480px]"
      title={
        dialog.type === 'addGroup' ? t('添加分组')
          : dialog.type === 'editGroup' ? t('重命名分组')
            : dialog.type === 'add' ? t('添加命令')
              : t('编辑命令')
      }
      footer={(
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setShowGroupPicker(false); setDialog(null); }}
          >
            {t('取消')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleDlgSave}
            disabled={!dlgName.trim() || (dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && !dlgCmd.trim())}
          >
            {t('保存')}
          </Button>
        </>
      )}
    >
      {dialog.type === 'add' && (
        <div className="text-sm text-muted select-none">
          <span className="mr-1.5">{t('添加到:')}</span>
          <span
            ref={groupPickerRef}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setGroupPickerPos({ x: rect.left, y: rect.bottom + 4 });
              setShowGroupPicker((prev) => !prev);
            }}
            className="badge cursor-pointer select-none"
          >
            {dialog.groupName || t('根目录')}
            <span className="text-[8px] opacity-70">▼</span>
          </span>
        </div>
      )}

      <div>
        <label htmlFor="qc-dlg-name" className="block mb-1 text-xs text-secondary">{t('名称')}</label>
        <input
          id="qc-dlg-name"
          name="qc-dlg-name"
          type="text"
          autoComplete="off"
          value={dlgName}
          onChange={(e) => setDlgName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleDlgSave(); } }}
          autoFocus
          className={inputClass}
          placeholder={dialog.type === 'addGroup' || dialog.type === 'editGroup' ? t('如：系统监控') : t('如：查看内存')}
        />
      </div>

      {dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && (
        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor="qc-dlg-cmd" className="block text-xs text-secondary">{t('命令')}</label>
            <div className="flex gap-[3px]">
              {[1, 2, 3, 4, 5].map((n) => (
                <Tiptop key={n} text={t('插入参数 p#') + n}>
                  <button
                    onClick={() => insertParam(n)}
                    aria-label={t('插入参数 p#') + n}
                    className="bg-transparent border border-line rounded-xs text-secondary text-[10px] cursor-pointer px-1.5 py-px font-mono transition-colors duration-100 hover:bg-hover hover:text-primary"
                  >
                    {t('参数')}{n}
                  </button>
                </Tiptop>
              ))}
            </div>
          </div>
          <textarea
            id="qc-dlg-cmd"
            name="qc-dlg-cmd"
            value={dlgCmd}
            onChange={(e) => setDlgCmd(e.target.value)}
            rows={3}
            className={`${inputClass} resize-vertical font-mono leading-normal min-h-[70px]`}
            placeholder={t('如：free -m')}
          />

          {extractQuickCommandParams(dlgCmd).length > 0 && (
            <div className="mt-1 text-xs text-warning">
              {t('含')} {extractQuickCommandParams(dlgCmd).length} {t('个动态参数：')}{extractQuickCommandParams(dlgCmd).map((p) => `[p#${p.num}${p.label ? ' ' + p.label : ''}]`).join(', ')}
            </div>
          )}
        </div>
      )}

      {dialog.type !== 'addGroup' && dialog.type !== 'editGroup' && (
        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-secondary">
          <input
            type="checkbox"
            name="qc-dlg-cr"
            checked={dlgAddCR}
            onChange={(e) => setDlgAddCR(e.target.checked)}
            className="accent-success"
          />
          {t('末尾添加回车符CR')}
        </label>
      )}

      {showGroupPicker && (
        <>
          <div
            onClick={() => setShowGroupPicker(false)}
            style={{ position: 'fixed', inset: 0, zIndex: Z.SUBMENU_BACKDROP, background: 'transparent' }}
          />
          <MenuPanel
            minWidth={160}
            className="fixed max-h-[220px]"
            style={{ left: groupPickerPos.x, top: groupPickerPos.y, zIndex: Z.SUBMENU }}
          >
            <MenuList
              items={[
                {
                  label: t('根目录'),
                  icon: <Folder size={14} />,
                  onSelect: () => {
                    setDialog(dialog ? { ...dialog, targetChildren: dialog.parentList, groupName: '' } : dialog);
                    setShowGroupPicker(false);
                  },
                },
                ...collectGroups(commands).map<MenuItem>((g) => ({
                  label: g.name,
                  icon: <Folder size={14} />,
                  onSelect: () => {
                    const list = structuredClone(dialog?.parentList || commands);
                    const r = resolvePath(list, g.path);
                    if (r?.item?.type === 'group') {
                      if (!r.item.children) r.item.children = [];
                      setDialog(dialog ? { ...dialog, parentList: list, targetChildren: r.item.children, groupName: g.name } : dialog);
                    }
                    setShowGroupPicker(false);
                  },
                })),
              ]}
              onClose={() => setShowGroupPicker(false)}
            />
          </MenuPanel>
        </>
      )}
    </Modal>
  );
}
