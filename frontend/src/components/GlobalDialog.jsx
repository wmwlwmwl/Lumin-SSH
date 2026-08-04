import { useState, useEffect, useId, useRef, useCallback } from 'react';
import { Eye, EyeOff, Clipboard } from 'lucide-react';
import { useTranslation, t } from '../i18n.js';
import Tiptop from './Tiptop.jsx';
import { Z } from '../constants/zIndex';

const DIALOG_PRIORITY = {
  default: 0,
  settings: 1,
  system: 2,
};

const getDialogPriority = (options) => DIALOG_PRIORITY[options?.priority] ?? DIALOG_PRIORITY.default;

const insertDialogByPriority = (dialogs, dialog) => {
  const insertAt = dialogs.findIndex((queued) => queued.priority < dialog.priority);
  return insertAt === -1
    ? [...dialogs, dialog]
    : [...dialogs.slice(0, insertAt), dialog, ...dialogs.slice(insertAt)];
};

if (import.meta.env.DEV) {
  const ordered = [0, 2, 1, 1].reduce(
    (dialogs, priority) => insertDialogByPriority(dialogs, { priority }),
    [],
  );
  console.assert(ordered.map(({ priority }) => priority).join(',') === '2,1,1,0', '弹窗优先级排序自检失败');
}

export default function GlobalDialog({ suspendDefault = false }) {
  const [dialogs, setDialogs] = useState([]);
  // ponytail: 队列同时存一份 ref。去重判定必须同步进行——同一 tick 内连续调用时
  // state 尚未更新，只比对 state 会漏判；ref 与 state 始终同步写入，二者不会漂移。
  const dialogsRef = useRef([]);

  // 入队；命中去重返回 false。调用方据此立即 resolve，避免 Promise 永久挂起。
  const pushDialog = useCallback((dialog, isDuplicate) => {
    if (dialogsRef.current.some(isDuplicate)) return false;
    dialogsRef.current = insertDialogByPriority(dialogsRef.current, dialog);
    setDialogs(dialogsRef.current);
    return true;
  }, []);

  const removeDialog = useCallback((id) => {
    dialogsRef.current = dialogsRef.current.filter((dialog) => dialog.id !== id);
    setDialogs(dialogsRef.current);
  }, []);

  useEffect(() => {
    // 注册全局 API
    window.luminDialog = {
      alert: (message, title = t('提示'), options = {}) => {
        const normalizedMessage = typeof message === 'string' ? message : String(message ?? '');
        return new Promise((resolve) => {
          const queued = pushDialog({
            id: Date.now() + Math.random(),
            type: 'alert',
            priority: getDialogPriority(options),
            title,
            message: normalizedMessage,
            copyable: options?.copyable !== false,
            onClose: () => resolve()
          }, d => d.type === 'alert' && d.priority === getDialogPriority(options) && d.message === normalizedMessage && d.title === title);
          if (!queued) resolve();
        });
      },
      confirm: (message, title = t('操作确认'), checkboxLabel = '', options = {}) => {
        return new Promise((resolve) => {
          const queued = pushDialog({
            id: Date.now() + Math.random(),
            type: 'confirm',
            priority: getDialogPriority(options),
            title,
            message,
            checkboxLabel,
            onConfirm: (_, checked) => resolve(checkboxLabel ? { confirmed: true, checked } : true),
            onCancel: () => resolve(checkboxLabel ? { confirmed: false, checked: false } : false)
          }, d => d.type === 'confirm' && d.priority === getDialogPriority(options) && d.message === message);
          // 去重丢弃按「取消」处理：不确认即不执行破坏性操作
          if (!queued) resolve(checkboxLabel ? { confirmed: false, checked: false } : false);
        });
      },
      prompt: (message, defaultValue = '', title = t('输入信息'), checkboxLabel = '', options = {}) => {
        return new Promise((resolve) => {
          const queued = pushDialog({
            id: Date.now() + Math.random(),
            type: 'prompt',
            priority: getDialogPriority(options),
            title,
            message,
            defaultValue,
            checkboxLabel,
            inputType: options?.inputType === 'password' ? 'password' : 'text',
            // validate(value) => null/undefined 通过；返回字符串则保留弹窗并展示错误
            validate: typeof options?.validate === 'function' ? options.validate : null,
            onConfirm: (val, checked) => resolve(checkboxLabel ? { value: val, checked } : val),
            onCancel: () => resolve(null)
          }, d => d.type === 'prompt' && d.priority === getDialogPriority(options) && d.message === message);
          if (!queued) resolve(null);
        });
      },
      choice: (message, title, buttons, checkboxLabel = '', options = {}) => {
        return new Promise((resolve) => {
          const queued = pushDialog({
            id: Date.now() + Math.random(),
            type: 'choice',
            priority: getDialogPriority(options),
            title,
            message,
            buttons,
            checkboxLabel,
            onChoice: (val, checked) => resolve(checkboxLabel ? { value: val, checked } : val),
            onClose: () => resolve(null)
          }, d => d.type === 'choice' && d.priority === getDialogPriority(options) && d.title === title);
          if (!queued) resolve(null);
        });
      }
    };
    return () => {
      delete window.luminDialog;
    };
  }, [pushDialog]);

  if (dialogs.length === 0) return null;

  const current = dialogs[0];
  const currentSuspended = suspendDefault && current.priority === DIALOG_PRIORITY.default;
  const dialogZIndex = current.priority === DIALOG_PRIORITY.system
    ? Z.SYSTEM_DIALOG
    : current.priority === DIALOG_PRIORITY.settings
      ? Z.SETTINGS_DIALOG
      : Z.GLOBAL_DIALOG;

  return (
    <div
      className="modal-overlay"
      data-global-dialog-active={currentSuspended ? undefined : 'true'}
      style={{ zIndex: dialogZIndex, display: currentSuspended ? 'none' : 'flex' }}
    >
      {dialogs.map((dialog, index) => {
        const dialogActive = index === 0 && !(suspendDefault && dialog.priority === DIALOG_PRIORITY.default);
        const handleClose = () => {
          if (dialog.onClose) dialog.onClose();
          if (dialog.onCancel && dialog.type !== 'alert') dialog.onCancel();
          removeDialog(dialog.id);
        };
        const handleConfirm = (val, checked) => {
          if (dialog.onConfirm) dialog.onConfirm(val, checked);
          removeDialog(dialog.id);
        };
        const handleChoice = (val, checked) => {
          if (dialog.onChoice) dialog.onChoice(val, checked);
          removeDialog(dialog.id);
        };
        return (
          <div key={dialog.id} style={{ display: dialogActive ? 'contents' : 'none' }}>
            <DialogContent
              current={dialog}
              active={dialogActive}
              onClose={handleClose}
              onConfirm={handleConfirm}
              onChoice={handleChoice}
            />
          </div>
        );
      })}
    </div>
  );
}

function DialogContent({ current, active, onClose, onConfirm, onChoice }) {
  const { t } = useTranslation();
  const controlId = useId();
  const dialogRef = useRef(null);
  const lastFocusedRef = useRef(null);
  const wasActiveRef = useRef(false);
  const [inputValue, setInputValue] = useState(current.defaultValue || '');
  const [inputError, setInputError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // confirm: 默认落在「取消」，避免回车误关连接；左右切换后回车确认
  const [focusAction, setFocusAction] = useState(() => {
    if (current.type === 'confirm') return 'cancel';
    if (current.type === 'choice') {
      const primaryIdx = current.buttons?.findIndex((btn) => btn.primary);
      return primaryIdx >= 0 ? primaryIdx : 0;
    }
    return 'confirm';
  });
  const messageText = typeof current.message === 'string' ? current.message : String(current.message ?? '');
  const showCopyButton = current.copyable === true && !!messageText;
  const isPasswordInput = current.inputType === 'password' || !!current.checkboxLabel;
  const isLongTextAlert = current.type === 'alert' && (messageText.includes('\n') || messageText.length > 160);
  const choiceCount = current.type === 'choice' ? (current.buttons?.length || 0) : 0;

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active || wasActive) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const previous = lastFocusedRef.current;
      const selector = current.type === 'prompt'
        ? 'input:not(:disabled)'
        : current.type === 'confirm'
          ? '[data-dialog-action="cancel"]'
          : current.type === 'choice'
            ? `[data-dialog-choice="${focusAction}"]`
            : 'textarea:not(:disabled), button:not(:disabled)';
      const fallback = dialogRef.current?.querySelector(selector);
      const target = previous?.isConnected ? previous : fallback;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (current.type === 'confirm') {
      setFocusAction('cancel');
    } else if (current.type === 'choice') {
      const primaryIdx = current.buttons?.findIndex((btn) => btn.primary);
      setFocusAction(primaryIdx >= 0 ? primaryIdx : 0);
    } else {
      setFocusAction('confirm');
    }
  }, [current.id, current.type]);

  const submitPrompt = async () => {
    if (submitting) return;
    if (typeof current.validate === 'function') {
      setSubmitting(true);
      try {
        const result = await current.validate(inputValue);
        if (result != null && result !== true && result !== '') {
          setInputError(String(result));
          return;
        }
        setInputError('');
        onConfirm(inputValue, checked);
      } catch (err) {
        setInputError(String(err?.message || err || t('操作失败')));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setInputError('');
    onConfirm(inputValue, checked);
  };

  useEffect(() => {
    if (!active) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }

      // confirm / choice：左右选中按钮
      if (current.type === 'confirm' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setFocusAction((prev) => (prev === 'cancel' ? 'confirm' : 'cancel'));
        return;
      }
      if (current.type === 'choice' && choiceCount > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setFocusAction((prev) => {
          const i = typeof prev === 'number' ? prev : 0;
          if (e.key === 'ArrowLeft') return (i - 1 + choiceCount) % choiceCount;
          return (i + 1) % choiceCount;
        });
        return;
      }

      if (e.key === 'Enter') {
        const tagName = document.activeElement?.tagName;
        // prompt 输入框内回车 = 提交；按钮上回车走原生 click
        if (tagName === 'TEXTAREA') {
          return;
        }
        if (tagName === 'BUTTON' && current.type !== 'confirm' && current.type !== 'choice') {
          return;
        }
        e.preventDefault();
        if (current.type === 'prompt') {
          void submitPrompt();
        } else if (current.type === 'confirm') {
          if (focusAction === 'cancel') onClose();
          else onConfirm(true, checked);
        } else if (current.type === 'choice') {
          const idx = typeof focusAction === 'number' ? focusAction : 0;
          const btn = current.buttons?.[idx] || current.buttons?.find((b) => b.primary) || current.buttons?.[0];
          if (btn) onChoice(btn.value, checked);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [active, current, inputValue, checked, focusAction, choiceCount, submitting, onClose, onConfirm, onChoice]);

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
      ref={dialogRef}
      onFocusCapture={(event) => { lastFocusedRef.current = event.target; }}
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
          id={`${controlId}-long-text`}
          name="global-dialog-long-text"
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
          <div style={{ position: 'relative', marginBottom: inputError ? 8 : (current.checkboxLabel ? 12 : 28) }}>
            <input 
              id={`${controlId}-input`}
              name="global-dialog-input"
              autoComplete="off"
              className="input"
              style={{
                width: '100%',
                textAlign: 'center',
                fontSize: 16,
                padding: current.checkboxLabel ? '12px 68px 12px 16px' : '12px 36px 12px 16px',
                borderColor: inputError ? 'var(--danger)' : undefined,
                boxShadow: inputError ? '0 0 0 1px var(--danger)' : undefined,
              }}
              value={inputValue}
              onChange={e => {
                setInputValue(e.target.value);
                if (inputError) setInputError('');
              }}
              type={isPasswordInput && !showPassword ? 'password' : 'text'}
              aria-invalid={!!inputError}
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
                    if (text) {
                      setInputValue(text);
                      if (inputError) setInputError('');
                    }
                  } catch {
                    try {
                      const { ClipboardGetText } = await import('../../wailsjs/runtime/runtime.js');
                      const text = await ClipboardGetText();
                      if (text) {
                        setInputValue(text);
                        if (inputError) setInputError('');
                      }
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
          {inputError ? (
            <div style={{
              marginBottom: current.checkboxLabel ? 12 : 20,
              fontSize: 12,
              color: 'var(--danger)',
              lineHeight: 1.4,
              textAlign: 'center',
            }}>
              {inputError}
            </div>
          ) : null}
          {current.checkboxLabel && current.checkboxLabel.trim() && (
            <label htmlFor={`${controlId}-prompt-checkbox`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28, fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
              <input id={`${controlId}-prompt-checkbox`} name="global-dialog-checkbox-prompt" autoComplete="off" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
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
              data-dialog-choice={i}
              className={btn.primary ? 'btn btn-primary' : btn.secondary ? 'btn btn-secondary' : 'btn btn-secondary'}
              onClick={() => onChoice(btn.value, checked)}
              onMouseEnter={() => setFocusAction(i)}
              style={{
                flex: 1,
                padding: '10px 0',
                justifyContent: 'center',
                whiteSpace: 'nowrap',
                outline: focusAction === i ? '2px solid var(--accent)' : 'none',
                outlineOffset: 2,
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
        {current.checkboxLabel && (
          <label htmlFor={`${controlId}-choice-checkbox`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
            <input id={`${controlId}-choice-checkbox`} name="global-dialog-checkbox-choice" autoComplete="off" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
            {current.checkboxLabel}
          </label>
        )}
        </>
      ) : (
      <>
      {current.type === 'confirm' && current.checkboxLabel && (
        <label htmlFor={`${controlId}-confirm-checkbox`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20, fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
          <input id={`${controlId}-confirm-checkbox`} name="global-dialog-checkbox-confirm" autoComplete="off" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
          {current.checkboxLabel}
        </label>
      )}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        {current.type !== 'alert' && (
          <button
            data-dialog-action="cancel"
            className="btn btn-secondary"
            onClick={onClose}
            onMouseEnter={() => current.type === 'confirm' && setFocusAction('cancel')}
            style={{
              flex: 1,
              padding: '10px 0',
              justifyContent: 'center',
              outline: current.type === 'confirm' && focusAction === 'cancel' ? '2px solid var(--accent)' : 'none',
              outlineOffset: 2,
            }}
          >
            {t('取消')}
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={current.type === 'prompt' && submitting}
          onClick={() => {
            if (current.type === 'prompt') void submitPrompt();
            else if (current.type === 'confirm') onConfirm(true, checked);
            else onClose();
          }}
          onMouseEnter={() => current.type === 'confirm' && setFocusAction('confirm')}
          style={{
            ...(current.type === 'alert'
              ? { minWidth: 120, justifyContent: 'center' }
              : { flex: 1, padding: '10px 0', justifyContent: 'center' }),
            outline: current.type === 'confirm' && focusAction === 'confirm' ? '2px solid var(--accent)' : 'none',
            outlineOffset: 2,
          }}
        >
          {current.type === 'alert' ? t('我知道了') : t('确定')}
        </button>
      </div>
      </>
      )}
    </div>
  );
}
