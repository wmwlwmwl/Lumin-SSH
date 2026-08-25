import { useEffect, useState } from 'react';
import * as AppGo from '../../../../wailsjs/go/wailsapp/App.js';
import { t as $t } from '../../../i18n.ts';
import { settingsChoice } from '../settingsDialogs.ts';

type AddToast = (message: string | Error, type?: string, duration?: number, actions?: unknown[]) => number;

interface UseRecoveryPasswordOptions {
  addToast: AddToast;
  refreshSyncMeta: () => Promise<void>;
  recoveryPasswordInput: string;
  setRecoveryPasswordEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setRecoveryPasswordInput: React.Dispatch<React.SetStateAction<string>>;
}

/** 恢复密码（云端备份加密）：设置/清除/强制重置 */
export function useRecoveryPassword({ addToast, refreshSyncMeta, recoveryPasswordInput, setRecoveryPasswordEditing, setRecoveryPasswordInput }: UseRecoveryPasswordOptions) {
  const [hasRecoveryPassword, setHasRecoveryPassword] = useState(false);
  const [recoveryPasswordChanging, setRecoveryPasswordChanging] = useState(false);

  // Load recovery password status without exposing plaintext to React.
  useEffect(() => {
    let cancelled = false;
    AppGo.HasRecoveryPassword()
      .then((configured) => { if (!cancelled) setHasRecoveryPassword(!!configured); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const changeRecoveryPassword = async (password: string) => {
    setRecoveryPasswordChanging(true);
    try {
      try {
        await AppGo.ChangeRecoveryPassword(password);
      } catch (e) {
        if (!String(e).includes('RECOVERY_PASSWORD_RESET_REQUIRED')) throw e;
        const action = await settingsChoice(
          $t('旧密码和新密码都无法解密云端备份。继续将不读取或合并云端数据，而是以本机当前数据覆盖所有已配置的云端同步目标。旧备份会保留，但其他设备尚未同步到本机的数据可能丢失。'),
          $t('确认强制重置恢复密码'),
          [
            { label: $t('以本机数据覆盖云端'), value: 'reset', primary: true },
            { label: $t('取消'), value: 'cancel', secondary: true },
          ]
        );
        if (action !== 'reset') return;
        await AppGo.ResetRecoveryPassword(password);
      }
      await refreshSyncMeta();
      setHasRecoveryPassword(!!password.trim());
      setRecoveryPasswordEditing(false);
      setRecoveryPasswordInput('');
      addToast(password.trim() ? $t('恢复密码已保存') : $t('恢复密码已清除'), 'success');
    } catch (e) {
      addToast((password.trim() ? $t('保存恢复密码失败') : $t('清除恢复密码失败')) + ': ' + e, 'error');
    } finally {
      setRecoveryPasswordChanging(false);
    }
  };
  const handleSaveRecoveryPassword = () => changeRecoveryPassword(recoveryPasswordInput);
  const handleClearRecoveryPassword = () => changeRecoveryPassword('');

  return {
    hasRecoveryPassword,
    recoveryPasswordChanging,
    handleSaveRecoveryPassword,
    handleClearRecoveryPassword,
  };
}
