import { useState, useEffect } from 'react';
import { Eye, EyeOff, Clipboard } from 'lucide-react';
import { useTranslation, t } from '../i18n.js';
import Tiptop from './Tiptop.jsx';
import { Z } from '../constants/zIndex';

export default function GlobalDialog() {
  const [dialogs, setDialogs] = useState([]);

  useEffect(() => {
    // 注册全局 API
    window.luminDialog = {
      alert: (message, title = t('提示'), options = {}) => {
        const normalizedMessage = typeof message === 'string' ? message : String(message ?? '');
        return new Promise((resolve) => {
          setDialogs(prev => {
            if (prev.some(d => d.type === 'alert' && d.message === normalizedMessage && d.title === title)) return prev;
            return [...prev, {
              id: Date.now() + Math.random(),
              type: 'alert',
              title,
              message: normalizedMessage,
              copyable: options?.copyable !== false,
              onClose: () => resolve()
            }];
          });
        });
      },
      confirm: (message, title = t('操作确认'), checkboxLabel = '') => {
        return new Promise((resolve) => {
          setDialogs(prev => {
            // 防止重复弹窗
            if (prev.some(d => d.type === 'confirm' && d.message === message)) return prev;
            return [...prev, {
              id: Date.now() + Math.random(),
              type: 'confirm',
              title,
              message,
              checkboxLabel,
              onConfirm: (_, checked) => resolve(checkboxLabel ? { confirmed: true, checked } : true),
              onCancel: () => resolve(checkboxLabel ? { confirmed: false, checked: false } : false)
            }];
          });
        });
      },
      prompt: (message, defaultValue = '', title = t('输入信息'), checkboxLabel = '', options = {}) => {
        return new Promise((resolve) => {
          setDialogs(prev => {
            if (prev.some(d => d.type === 'prompt' && d.message === message)) return prev;
            return [...prev, {
              id: Date.now() + Math.random(),
              type: 'prompt',
              title,
              message,
              defaultValue,
              checkboxLabel,
              inputType: options?.inputType === 'password' ? 'password' : 'text',
              onConfirm: (val, checked) => resolve(checkboxLabel ? { value: val, checked } : val),
              onCancel: () => resolve(null)
            }];
          });
        });
      },
      choice: (message, title, buttons, checkboxLabel = '') => {
        return new Promise((resolve) => {
          setDialogs(prev => {
            // 防止重复弹窗
            if (prev.some(d => d.type === 'choice' && d.title === title)) return prev;
            return [...prev, {
              id: Date.now() + Math.random(),
              type: 'choice',
              title,
              message,
              buttons,
              checkboxLabel,
              onChoice: (val, checked) => resolve(checkboxLabel ? { value: val, checked } : val),
              onClose: () => resolve(null)
            }];
          });
        });
      }
    };
    return () => {
      delete window.luminDialog;
    };
  }, []);

  if (dialogs.length === 0) return null;

  const current = dialogs[0]; // 每次只显示队首的弹窗

  const handleClose = () => {
    if (current.onClose) current.onClose();
    if (current.onCancel && current.type !== 'alert') current.onCancel();
    setDialogs(prev => prev.slice(1));
  };

  const handleConfirm = (val, checked) => {
    if (current.onConfirm) current.onConfirm(val, checked);
    setDialogs(prev => prev.slice(1));
  };

  const handleChoice = (val, checked) => {
    if (current.onChoice) current.onChoice(val, checked);
    setDialogs(prev => prev.slice(1));
  };

  return (
    <div className="modal-overlay" style={{ zIndex: Z.MODAL }}>
      <DialogContent key={current.id} current={current} onClose={handleClose} onConfirm={handleConfirm} onChoice={handleChoice} />
    </div>
  );
}

function DialogContent({ current, onClose, onConfirm, onChoice }) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(current.defaultValue || '');
  const [checked, setChecked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const messageText = typeof current.message === 'string' ? current.message : String(current.message ?? '');
  const showCopyButton = current.copyable === true && !!messageText;
  const isPasswordInput = current.inputType === 'password' || !!current.checkboxLabel;
  const isLongTextAlert = current.type === 'alert' && (messageText.includes('\n') || messageText.length > 160);

  const handleCopyMessage = async () => {
    if (!messageText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(messageText);
      return;
    } catch {}
    try {
      const { ClipboardSetText } = await import('../../wailsjs/runtime/runtime.js');
      await ClipboardSetText(messageText);
    } catch {}
  };

  return (
    <div
      className={isLongTextAlert ? 'modal modal-md' : 'modal modal-sm'}
      style={{
        padding: 32,
        textAlign: isLongTextAlert ? 'left' : 'center',
        maxWidth: isLongTextAlert ? 'min(820px, calc(100vw - 32px))' : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: showCopyButton ? 'space-between' : 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>
          {current.title}
        </div>
        {showCopyButton ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleCopyMessage}
            style={{ flexShrink: 0 }}
          >
            <Clipboard size={14} />
            {t('复制')}
          </button>
        ) : null}
      </div>
      {isLongTextAlert ? (
        <textarea
          readOnly
          value={messageText}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          style={{
            width: '100%',
            minHeight: 220,
            maxHeight: '45vh',
            marginBottom: 28,
            padding: '12px 14px',
            resize: 'vertical',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface-sunken)',
            color: 'var(--text-primary)',
            fontSize: 13,
            lineHeight: 1.6,
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div
          style={{
            fontSize: 14,
            color: 'var(--text-tertiary)',
            marginBottom: 28,
            lineHeight: 1.6,
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
            textAlign: current.type === 'choice' || current.type === 'alert' ? 'left' : undefined,
            userSelect: 'text',
          }}
        >
          {messageText}
        </div>
      )}
      
      {current.type === 'prompt' && (
        <>
          <div style={{ position: 'relative', marginBottom: current.checkboxLabel ? 12 : 28 }}>
            <input 
              autoFocus
              className="input" 
              style={{ width: '100%', textAlign: 'center', fontSize: 16, padding: current.checkboxLabel ? '12px 68px 12px 16px' : '12px 36px 12px 16px' }}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              type={isPasswordInput && !showPassword ? 'password' : 'text'}
              onKeyDown={e => {
                if (e.key === 'Enter') onConfirm(inputValue, checked);
                if (e.key === 'Escape') onClose();
              }}
            />
            {isPasswordInput && (
              <Tiptop
                text={showPassword ? t('隐藏密码') : t('显示密码')}
                style={{
                  position: 'absolute', right: 42, top: '50%', transform: 'translateY(-50%)',
                  zIndex: 2,
                }}
              >
                <button
                  type="button"
                  aria-label={showPassword ? t('隐藏密码') : t('显示密码')}
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                    padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, lineHeight: 1, borderRadius: 4, transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.12)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </Tiptop>
            )}
            <Tiptop
              text={t('粘贴')}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                zIndex: 2,
              }}
            >
              <button
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text) setInputValue(text);
                  } catch {
                    try {
                      const { ClipboardGetText } = await import('../../wailsjs/runtime/runtime.js');
                      const text = await ClipboardGetText();
                      if (text) setInputValue(text);
                    } catch {}
                  }
                }}
                aria-label={t('粘贴')}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                  padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, lineHeight: 1, borderRadius: 4, transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              ><Clipboard size={16} /></button>
            </Tiptop>
          </div>
          {current.checkboxLabel && current.checkboxLabel.trim() && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28, fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
              {current.checkboxLabel}
            </label>
          )}
        </>
      )}

      {current.type === 'choice' ? (
        <>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {current.buttons.map((btn, i) => (
            <button
              key={i}
              className={btn.primary ? 'btn btn-primary' : btn.secondary ? 'btn btn-secondary' : 'btn btn-secondary'}
              onClick={() => onChoice(btn.value, checked)}
              style={{ flex: 1, padding: '10px 0', justifyContent: 'center', whiteSpace: 'nowrap' }}
            >
              {btn.label}
            </button>
          ))}
        </div>
        {current.checkboxLabel && (
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
            {current.checkboxLabel}
          </label>
        )}
        </>
      ) : (
      <>
      {current.type === 'confirm' && current.checkboxLabel && (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20, fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
          {current.checkboxLabel}
        </label>
      )}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        {current.type !== 'alert' && (
          <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1, padding: '10px 0', justifyContent: 'center' }}>{t('取消')}</button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => {
            if (current.type === 'prompt') onConfirm(inputValue, checked);
            else if (current.type === 'confirm') onConfirm(true, checked);
            else onClose();
          }}
          style={current.type === 'alert' ? { minWidth: 120, justifyContent: 'center' } : { flex: 1, padding: '10px 0', justifyContent: 'center' }}
        >
          {current.type === 'alert' ? t('我知道了') : t('确定')}
        </button>
      </div>
      </>
      )}
    </div>
  );
}
