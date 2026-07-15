const PASSWORD_REASONS = new Set([
  'password_required',
  'password_invalid',
  'password_incorrect',
  'missing_recovery_password',
  'invalid_recovery_password',
  'recovery_password_incorrect',
]);

export function isRecoveryPasswordError(error) {
  if (error?.category === 'password' || PASSWORD_REASONS.has(error?.reason)) return true;
  const message = String(error?.message ?? error ?? '');
  return /恢复密码|LUMIN2.*(?:需要密码|解密失败)|密码(?:错误|不正确)/.test(message);
}

export async function syncWithRecoveryPassword({ sync, initialError, retry, prompt, t }) {
  let error = initialError;
  if (!error) {
    try {
      return { result: await sync(), cancelled: false };
    } catch (caught) {
      error = caught;
    }
  }
  if (!isRecoveryPasswordError(error)) throw error;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const password = await prompt(
      attempt === 0 ? t('请输入恢复密码以继续同步') : t('恢复密码不正确，请重新输入'),
      '',
      t('同步需要恢复密码'),
      '',
      { inputType: 'password' },
    );
    if (password === null) return { result: null, cancelled: true };
    try {
      return { result: await retry(password), cancelled: false };
    } catch (caught) {
      if (!isRecoveryPasswordError(caught)) throw caught;
      error = caught;
    }
  }
  throw error;
}
