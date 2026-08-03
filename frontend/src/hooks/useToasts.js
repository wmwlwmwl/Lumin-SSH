import { useCallback, useEffect, useRef, useState } from 'react';

const TOAST_EXIT_DURATION = 1080;

export default function useToasts() {
  const [toasts, setToasts] = useState([]);
  const mountedRef = useRef(true);
  const toastIdRef = useRef(0);
  const autoDismissTimersRef = useRef(new Map());
  const exitTimersRef = useRef(new Map());

  const clearTimer = useCallback((timersRef, id) => {
    const timer = timersRef.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const removeToastImmediately = useCallback((id) => {
    clearTimer(autoDismissTimersRef, id);
    clearTimer(exitTimersRef, id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, [clearTimer]);

  const removeToast = useCallback((id) => {
    clearTimer(autoDismissTimersRef, id);
    clearTimer(exitTimersRef, id);
    let shouldAnimate = false;
    setToasts((prev) => prev.map((toast) => {
      if (toast.id !== id || toast.closing) return toast;
      shouldAnimate = true;
      return { ...toast, closing: true };
    }));
    if (!shouldAnimate) return;
    const timer = window.setTimeout(() => {
      if (mountedRef.current) removeToastImmediately(id);
    }, TOAST_EXIT_DURATION);
    exitTimersRef.current.set(id, timer);
  }, [clearTimer, removeToastImmediately]);

  const addToast = useCallback((message, type = 'info', duration = 3000, actions = []) => {
    const id = ++toastIdRef.current;
    const text = message instanceof Error ? message.message : String(message ?? '');
    setToasts((prev) => [...prev, { id, message: text, type, actions, closing: false }]);
    if (duration > 0) {
      const timer = window.setTimeout(() => {
        if (mountedRef.current) removeToast(id);
      }, duration);
      autoDismissTimersRef.current.set(id, timer);
    }
    return id;
  }, [removeToast]);

  const handleToastAction = useCallback((id, action) => {
    removeToastImmediately(id);
    action?.onClick?.();
  }, [removeToastImmediately]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      autoDismissTimersRef.current.forEach(window.clearTimeout);
      autoDismissTimersRef.current.clear();
      exitTimersRef.current.forEach(window.clearTimeout);
      exitTimersRef.current.clear();
    };
  }, []);

  return { toasts, addToast, removeToast, handleToastAction };
}
