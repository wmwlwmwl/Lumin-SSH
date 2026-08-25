import { useState, useEffect, useId, useRef } from 'react';
import { Eye, EyeOff, Clipboard } from 'lucide-react';
import { useTranslation } from '../../i18n.ts';
import Tiptop from '../Tiptop.tsx';
import { Button } from '../ui';
import { cn } from '../../utils/cn.ts';
import type { QueuedDialog } from './globalDialogTypes.ts';

interface DialogContentProps {
  current: QueuedDialog;
  active: boolean;
  onClose: () => void;
  onConfirm: (val: unknown, checked: boolean) => void;
  onChoice: (val: unknown, checked: boolean) => void;
}

export function DialogContent({ current, active, onClose, onConfirm, onChoice }: DialogContentProps) {
  const { t } = useTranslation();
  const controlId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const wasActiveRef = useRef(false);
  const [inputValue, setInputValue] = useState<string>(current.defaultValue || '');
  const [inputError, setInputError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // confirm: 默认落在「取消」，避免回车误关连接；左右切换后回车确认
  const [focusAction, setFocusAction] = useState<number | 'cancel' | 'confirm'>(() => {
    if (current.type === 'confirm') return 'cancel';
    if (current.type === 'choice') {
      const primaryIdx = current.buttons?.findIndex((btn) => btn.primary);
      return primaryIdx !== undefined && primaryIdx >= 0 ? primaryIdx : 0;
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
      const fallback = dialogRef.current?.querySelector(selector) as HTMLElement | null;
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
      setFocusAction(primaryIdx !== undefined && primaryIdx >= 0 ? primaryIdx : 0);
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
        if (result != null && result !== '') {
          setInputError(String(result));
          return;
        }
        setInputError('');
        onConfirm(inputValue, checked);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setInputError(errMsg || t('操作失败'));
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }

      if (current.type === 'confirm' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 'c' || key === 'y') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (key === 'c') onClose();
          else onConfirm(true, checked);
          return;
        }
      }

      if (current.type === 'choice' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        const btn = current.buttons?.find((candidate) => candidate.shortcut?.toLowerCase() === key);
        if (btn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          onChoice(btn.value, checked);
          return;
        }
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
      const { ClipboardSetText } = await import('../../../wailsjs/runtime/runtime.js');
      await ClipboardSetText(messageText);
    } catch {}
  };

  return (
    <div
      ref={dialogRef}
      onFocusCapture={(event) => { lastFocusedRef.current = event.target as HTMLElement; }}
      className={
        isLongTextAlert
          ? 'modal modal-md p-8 text-left max-w-[min(820px,calc(100vw-32px))]'
          : 'modal modal-sm p-8 text-center'
      }
    >
      <div
        className={`flex items-center gap-3 mb-4 ${showCopyButton ? 'justify-between' : 'justify-center'}`}
      >
        <div className="text-2xl font-bold text-primary min-w-0">
          {current.title}
        </div>
        {showCopyButton ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={handleCopyMessage}
          >
            <Clipboard size={14} />
            {t('复制')}
          </Button>
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
          className="w-full min-h-[220px] max-h-[45vh] mb-7 px-3.5 py-3 resize-y rounded-lg border border-line bg-sunken text-primary text-base leading-[1.6] box-border"
        />
      ) : (
        <div
          className={`text-md text-tertiary mb-7 leading-[1.6] break-words [overflow-wrap:anywhere] whitespace-pre-wrap select-text ${
            current.type === 'choice' || current.type === 'alert' ? 'text-left' : ''
          }`}
        >
          {messageText}
        </div>
      )}
      
      {current.type === 'prompt' && (
        <>
          <div className={`relative ${inputError ? 'mb-2' : (current.checkboxLabel ? 'mb-3' : 'mb-7')}`}>
            <input 
              id={`${controlId}-input`}
              name="global-dialog-input"
              autoComplete="off"
              className="input"
              style={inputError ? { borderColor: 'var(--danger)', boxShadow: '0 0 0 1px var(--danger)' } : undefined}
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
                  className="bg-transparent border-none text-tertiary cursor-pointer p-1 flex items-center justify-center text-[16px] leading-none rounded-xs transition-colors duration-150 hover:bg-accent-dim"
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
                      const { ClipboardGetText } = await import('../../../wailsjs/runtime/runtime.js');
                      const text = await ClipboardGetText();
                      if (text) {
                        setInputValue(text);
                        if (inputError) setInputError('');
                      }
                    } catch {}
                  }
                }}
                aria-label={t('粘贴')}
                className="bg-transparent border-none text-tertiary cursor-pointer p-1 flex items-center justify-center text-[16px] leading-none rounded-xs transition-colors duration-150 hover:bg-accent-dim"
              ><Clipboard size={16} /></button>
            </Tiptop>
          </div>
          {inputError ? (
            <div className={`text-sm text-danger leading-snug text-center ${current.checkboxLabel ? 'mb-3' : 'mb-5'}`}>
              {inputError}
            </div>
          ) : null}
          {current.checkboxLabel && current.checkboxLabel.trim() && (
            <label htmlFor={`${controlId}-prompt-checkbox`} className="flex items-center justify-center gap-2 mb-7 text-base text-tertiary cursor-pointer">
              <input id={`${controlId}-prompt-checkbox`} name="global-dialog-checkbox-prompt" autoComplete="off" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
              {current.checkboxLabel}
            </label>
          )}
        </>
      )}

      {current.type === 'choice' ? (
        <>
        <div className="flex gap-2 justify-center">
          {current.buttons?.map((btn, i) => (
            <Button
              key={i}
              data-dialog-choice={i}
              aria-keyshortcuts={btn.shortcut?.toUpperCase()}
              variant={btn.primary ? 'primary' : 'secondary'}
              onClick={() => onChoice(btn.value, checked)}
              onMouseEnter={() => setFocusAction(i)}
              className={cn(
                'flex-1 py-2.5 justify-center whitespace-nowrap',
                focusAction === i && 'outline outline-2 outline-offset-2 outline-accent',
              )}
            >
              {btn.shortcut ? `${btn.label}(${btn.shortcut.toUpperCase()})` : btn.label}
            </Button>
          ))}
        </div>
        {current.checkboxLabel && (
          <label htmlFor={`${controlId}-choice-checkbox`} className="flex items-center justify-center gap-2 mt-4 text-base text-tertiary cursor-pointer">
            <input id={`${controlId}-choice-checkbox`} name="global-dialog-checkbox-choice" autoComplete="off" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
            {current.checkboxLabel}
          </label>
        )}
        </>
      ) : (
      <>
      {current.type === 'confirm' && current.checkboxLabel && (
        <label htmlFor={`${controlId}-confirm-checkbox`} className="flex items-center justify-center gap-2 mb-5 text-base text-tertiary cursor-pointer">
          <input id={`${controlId}-confirm-checkbox`} name="global-dialog-checkbox-confirm" autoComplete="off" type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
          {current.checkboxLabel}
        </label>
      )}
      <div className="flex gap-3 justify-center">
        {current.type !== 'alert' && (
          <Button
            data-dialog-action="cancel"
            aria-keyshortcuts={current.type === 'confirm' ? 'C Escape' : undefined}
            variant="secondary"
            onClick={onClose}
            onMouseEnter={() => current.type === 'confirm' && setFocusAction('cancel')}
            className={cn(
              'flex-1 py-2.5 justify-center',
              current.type === 'confirm' && focusAction === 'cancel' && 'outline outline-2 outline-offset-2 outline-accent',
            )}
          >
            {current.type === 'confirm' ? `${t('取消')}(C)` : t('取消')}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={current.type === 'prompt' && submitting}
          onClick={() => {
            if (current.type === 'prompt') void submitPrompt();
            else if (current.type === 'confirm') onConfirm(true, checked);
            else onClose();
          }}
          onMouseEnter={() => current.type === 'confirm' && setFocusAction('confirm')}
          className={cn(
            current.type === 'alert' ? 'min-w-[120px] justify-center' : 'flex-1 py-2.5 justify-center',
            current.type === 'confirm' && focusAction === 'confirm' && 'outline outline-2 outline-offset-2 outline-accent',
          )}
        >
          {current.type === 'alert' ? t('我知道了') : (current.type === 'confirm' ? `${t('确定')}(Y)` : t('确定'))}
        </Button>
      </div>
      </>
      )}
    </div>
  );
}
