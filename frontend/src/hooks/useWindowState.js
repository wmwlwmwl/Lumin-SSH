import { useCallback, useEffect } from 'react';
import {
  WindowGetSize,
  WindowIsMaximised,
  WindowMaximise,
  WindowSetSize,
  WindowToggleMaximise,
} from '../../wailsjs/runtime/runtime.js';

function shouldRememberWindowSize() {
  return typeof localStorage !== 'undefined'
    && localStorage.getItem('rememberWindowSize') !== 'false';
}

function readSavedWindowSize() {
  try {
    const saved = JSON.parse(localStorage.getItem('windowSize') || 'null');
    return saved?.w > 100 && saved?.h > 100 ? saved : null;
  } catch {
    return null;
  }
}

export default function useWindowState() {
  useEffect(() => {
    if (!shouldRememberWindowSize()) return undefined;
    const saved = readSavedWindowSize();
    if (!saved) return undefined;
    const frame = window.requestAnimationFrame(async () => {
      try {
        await WindowSetSize(saved.w, saved.h);
        if (saved.maximized) await WindowMaximise();
      } catch { }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!shouldRememberWindowSize()) return undefined;
    const saved = readSavedWindowSize();
    let lastW = saved?.w > 100 ? saved.w : 0;
    let lastH = saved?.h > 100 ? saved.h : 0;
    let lastMaximized = null;
    let debounceTimer = 0;

    const persist = async () => {
      try {
        const [size, maximized] = await Promise.all([WindowGetSize(), WindowIsMaximised()]);
        if (maximized) {
          if (lastMaximized === true) return;
          lastMaximized = true;
          const w = lastW > 100 ? lastW : size?.w;
          const h = lastH > 100 ? lastH : size?.h;
          if (w > 100 && h > 100) {
            localStorage.setItem('windowSize', JSON.stringify({ w, h, maximized: true }));
          }
          return;
        }
        if (size?.w > 100 && size?.h > 100
          && (size.w !== lastW || size.h !== lastH || lastMaximized !== false)) {
          lastW = size.w;
          lastH = size.h;
          lastMaximized = false;
          localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h, maximized: false }));
        }
      } catch { }
    };

    const onResize = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(persist, 150);
    };
    window.addEventListener('resize', onResize);
    const interval = window.setInterval(persist, 2000);
    return () => {
      window.clearTimeout(debounceTimer);
      window.removeEventListener('resize', onResize);
      window.clearInterval(interval);
    };
  }, []);

  return useCallback(async () => {
    try {
      if (shouldRememberWindowSize()) {
        const [size, maximized] = await Promise.all([WindowGetSize(), WindowIsMaximised()]);
        if (!maximized && size?.w > 100 && size?.h > 100) {
          localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h, maximized: true }));
        }
      }
    } catch { }
    WindowToggleMaximise();
  }, []);
}
