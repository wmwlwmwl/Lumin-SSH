import { useState, useEffect } from 'react';
import { Eye, EyeOff, Clipboard } from 'lucide-react';
import { useTranslation, t } from '../i18n.js';
import { Z } from '../constants/zIndex';

export default function GlobalDialog() {
  const [dialogs, setDialogs] = useState([]);

  useEffect(() => {
    // 注册全局 API
    window.luminDialog = {
      alert: (message, title = t('提示')) => {
        return new Promise((resolve) => {
          setDialogs(prev => {
            if (prev.some(d => d.type === 'alert' && d.message === message)) return prev;
            return [...prev, {
              id: Date.now() + Math.random(),
              type: 'alert',
              title,
              message,
              onClose: () => resolve()
            }];
          });
        });
      },
      confirm: (message, title = t('操作确认')) => {
        return new Promise((resolve) => {
          setDialogs(prev => {
            // 防止重复弹窗
            if (prev.some(d => d.type === 'confirm' && d.message === message)) return prev;
            return [...prev, {
              id: Date.now() + Math.random(),
              type: 'confirm',
              title,
              message,
              onConfirm: () => resolve(true),
              onCancel: () => resolve(false)
            }];
          });
        });
      },
      prompt: (message, defaultValue = '', title = t('输入信息'), checkboxLabel = '') => {
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
              onConfirm: (val, checked) => resolve(checkboxLabel ? { value: val, checked } : val),
              onCancel: () => resolve(null)
            }];
          });
        });
      },
      choice: (message, title, buttons) => {
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
              onChoice: (val) => resolve(val),
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

  const handleChoice = (val) => {
    if (current.onChoice) current.onChoice(val);
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

  return (
    <div className="modal modal-sm" style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
        {current.title}
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-tertiary)', marginBottom: 28, lineHeight: 1.6, wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: current.type === 'choice' ? 'pre-wrap' : undefined, textAlign: current.type === 'choice' ? 'left' : undefined }}>
        {current.message}
      </div>
      
      {current.type === 'prompt' && (
        <>
          <div style={{ position: 'relative', marginBottom: current.checkboxLabel ? 12 : 28 }}>
            <input 
              autoFocus
              className="input" 
              style={{ width: '100%', textAlign: 'center', fontSize: 16, padding: '12px 60px 12px 16px' }}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              type={current.checkboxLabel && !showPassword ? 'password' : 'text'}
              onKeyDown={e => {
                if (e.key === 'Enter') onConfirm(inputValue, checked);
                if (e.key === 'Escape') onClose();
              }}
            />
            <button
              type="button"
              title={showPassword ? t('隐藏密码') : t('显示密码')}
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute', right: 42, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, lineHeight: 1, borderRadius: 4, transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
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
              title={t('粘贴')}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, lineHeight: 1, borderRadius: 4, transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            ><Clipboard size={16} /></button>
          </div>
          {current.checkboxLabel && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28, fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
              {current.checkboxLabel}
            </label>
          )}
        </>
      )}

      {current.type === 'choice' ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {current.buttons.map((btn, i) => (
            <button
              key={i}
              className={btn.primary ? 'btn btn-primary' : btn.secondary ? 'btn btn-secondary' : 'btn btn-secondary'}
              onClick={() => onChoice(btn.value)}
              style={{ flex: 1, padding: '10px 0', justifyContent: 'center', whiteSpace: 'nowrap' }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      ) : (
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        {current.type !== 'alert' && (
          <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1, padding: '10px 0', justifyContent: 'center' }}>{t('取消')}</button>
        )}
        <button 
          className="btn btn-primary"
          onClick={() => {
            if (current.type === 'prompt') onConfirm(inputValue, checked);
            else if (current.type === 'confirm') onConfirm(true);
            else onClose();
          }}
          style={current.type === 'alert' ? { minWidth: 120, justifyContent: 'center' } : { flex: 1, padding: '10px 0', justifyContent: 'center' }}
        >
          {current.type === 'alert' ? t('我知道了') : t('确定')}
        </button>
      </div>)}
    </div>
  );
}
