import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, ShieldQuestion, KeyRound, Eye, EyeOff, Clipboard } from 'lucide-react';
import { Z } from '../constants/zIndex';
import { getThemeComponentTheme } from '../utils/theme.js';

// 会话内的交互卡片：主机密钥确认 / 认证失败重输密码。
// 与 ConnectingCard 同一挂载点、同一配色，每个会话各自渲染一张，
// 因此批量连接时 N 个会话会得到 N 张卡片，互不干扰。
export default function SessionAuthCard({ prompt, isActive, t, onResolve }) {
  const C = getThemeComponentTheme('connectingCard');
  const isPassword = prompt.kind === 'password';
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef(null);
  // 卡片卸载前可能连收两次回车/双击，onResolve 会调后端，必须只生效一次
  const resolvedRef = useRef(false);

  const buttons = isPassword
    ? [
        { label: t('确定'), value: 'ok', primary: true },
        { label: t('取消'), value: 'cancel' },
      ]
    : [
        { label: t('只接受本次'), value: 1 },
        { label: t('接受并保存'), value: 2, primary: true },
        { label: t('取消'), value: 0 },
      ];

  // 密钥已变更（可能中间人）时默认落在「取消」，避免回车误接受；首次连接落在主按钮
  useEffect(() => {
    if (isPassword) {
      setFocusIdx(0);
      return;
    }
    if (prompt.danger) {
      setFocusIdx(2);
      return;
    }
    setFocusIdx(1);
  }, [isPassword, prompt.danger]);

  useEffect(() => {
    if (!isPassword || !isActive) return undefined;
    // 非活动会话的祖先为 display:none，autoFocus 无效，切回时再聚焦
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isPassword, isActive]);

  const canSubmit = !isPassword || value.length > 0;

  const submit = (btnValue) => {
    if (resolvedRef.current) return;
    if (!isPassword) {
      resolvedRef.current = true;
      onResolve(btnValue);
      return;
    }
    if (btnValue === 'cancel') {
      resolvedRef.current = true;
      onResolve(null);
      return;
    }
    if (!value) return;
    resolvedRef.current = true;
    onResolve({ value, persist: checked });
  };

  useEffect(() => {
    if (!isActive) return undefined;
    const handleKeyDown = (e) => {
      // ponytail: 全局弹窗（GlobalDialog / 各类 Modal）打开时让位，避免 Esc/Enter 被双重处理
      if (document.querySelector('.modal-overlay')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        submit(isPassword ? 'cancel' : 0);
        return;
      }
      if (!isPassword && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setFocusIdx((prev) => {
          const n = buttons.length;
          return e.key === 'ArrowLeft' ? (prev - 1 + n) % n : (prev + 1) % n;
        });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isPassword) {
          submit('ok');
          return;
        }
        const btn = buttons[focusIdx] || buttons[0];
        submit(btn.value);
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isActive, isPassword, focusIdx, value, checked]);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setValue(text);
        return;
      }
    } catch {}
    try {
      const { ClipboardGetText } = await import('../../wailsjs/runtime/runtime.js');
      const text = await ClipboardGetText();
      if (text) setValue(text);
    } catch {}
  };

  const Icon = isPassword ? KeyRound : prompt.danger ? ShieldAlert : ShieldQuestion;
  const iconBg = isPassword || !prompt.danger
    ? 'rgba(var(--warning-rgb), 0.85)'
    : 'rgba(var(--danger-rgb), 0.85)';

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: Z.FULLSCREEN_OVERLAY,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.overlayBg,
    }}>
      <div style={{
        width: 440, maxWidth: 'calc(100% - 32px)', borderRadius: 16, overflow: 'hidden',
        background: C.popupBg,
        border: '1px solid ' + C.btnBorder,
        boxShadow: C.contextShadow,
        padding: '20px 24px 22px',
      }}>
        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
            background: iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon size={22} style={{ color: '#fff' }} /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.inputColor, minWidth: 0 }}>
            {prompt.title}
          </div>
        </div>

        {/* 正文（含指纹 / 错误详情） */}
        <div style={{
          fontSize: 12.5,
          color: C.statusBarColor,
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          userSelect: 'text',
          maxHeight: '38vh',
          overflowY: 'auto',
          marginBottom: 18,
        }}>
          {prompt.message}
        </div>

        {isPassword && (
          <>
            <div style={{ position: 'relative', marginBottom: prompt.checkboxLabel ? 12 : 18 }}>
              <input
                ref={inputRef}
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('请输入密码')}
                style={{ width: '100%', fontSize: 14, padding: '10px 68px 10px 14px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('隐藏密码') : t('显示密码')}
                title={showPassword ? t('隐藏密码') : t('显示密码')}
                style={{
                  position: 'absolute', right: 38, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: C.mutedColor, cursor: 'pointer',
                  padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4,
                }}
              >{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              <button
                type="button"
                onClick={pasteFromClipboard}
                aria-label={t('粘贴')}
                title={t('粘贴')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: C.mutedColor, cursor: 'pointer',
                  padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4,
                }}
              ><Clipboard size={16} /></button>
            </div>
            {prompt.checkboxLabel && (
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18,
                fontSize: 12.5, color: C.statusBarColor, cursor: 'pointer',
              }}>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                {prompt.checkboxLabel}
              </label>
            )}
          </>
        )}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 8 }}>
          {buttons.map((btn, i) => {
            const disabled = btn.value === 'ok' && !canSubmit;
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => submit(btn.value)}
                onMouseEnter={() => setFocusIdx(i)}
                style={{
                  flex: 1, padding: '9px 0', fontSize: 12.5, borderRadius: 8,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                  background: btn.primary ? 'var(--accent)' : C.buttonBg,
                  border: '1px solid ' + (btn.primary ? 'var(--accent)' : C.btnBorder),
                  color: btn.primary ? '#fff' : C.buttonTextColor,
                  outline: focusIdx === i ? '2px solid var(--accent)' : 'none',
                  outlineOffset: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
