import { useCallback, useEffect, useRef } from 'react';
import {
  WindowGetSize,
  WindowIsMaximised,
  WindowMaximise,
  WindowSetSize,
  WindowToggleMaximise,
} from '../../wailsjs/runtime/runtime.js';
import useIsWindowMaximized, { refreshWindowMaximized } from './useIsWindowMaximized.ts';

interface SavedWindowSize {
  w: number;
  h: number;
  maximized: boolean;
}

interface WailsFlags {
  enableResize?: boolean;
  resizeEdge?: string;
  borderThickness?: number;
  defaultCursor?: string | null;
}

const RESIZE_EDGE_ATTR = 'data-wails-resize-edge';
// 边缘缩放抓握带宽度（Wails 默认 6px），缩放优先于贴边滚动条。
// AI 聊天/监控面板的滚动条通过等宽 gutter 内缩错开：[0,8) 缩放、[8,14) 滚动条两不误；
// 其余贴边滚动条区域按缩放处理（滚轮滚动不受影响）
const RESIZE_BORDER_THICKNESS = 8;

function getWailsFlags(): WailsFlags | undefined {
  return (window as unknown as { wails?: { flags?: WailsFlags } })?.wails?.flags;
}

function clearWindowResizeState(): void {
  const flags = getWailsFlags();
  if (flags && 'resizeEdge' in flags) {
    delete flags.resizeEdge;
  }
  const doc = document.documentElement;
  if (doc.hasAttribute(RESIZE_EDGE_ATTR)) {
    doc.removeAttribute(RESIZE_EDGE_ATTR);
  }
  if (doc.style.cursor && doc.style.cursor.includes('resize')) {
    doc.style.cursor = '';
  }
}

/**
 * 指针是否位于窗口边缘缩放带内。clientX/Y 与 innerWidth/innerHeight 同为 CSS
 * 像素坐标系；不复用 wails runtime 基于 outerWidth 的边缘判定，避免高 DPI
 * 缩放下两套坐标错位导致的误判。
 */
function isPointInWindowEdgeBand(e: { clientX: number; clientY: number }, thickness = RESIZE_BORDER_THICKNESS): boolean {
  return e.clientX < thickness || e.clientY < thickness
    || window.innerWidth - e.clientX < thickness
    || window.innerHeight - e.clientY < thickness;
}

/** 指针是否落在元素的原生滚动条像素上（边缘缩放判定带内调用） */
function isOverNativeScrollbar(e: MouseEvent, el: HTMLElement): boolean {
  // 右侧竖向 / 底部横向：Chromium 中滚动条不占用 client 区，命中坐标越过 client 即滚动条
  if (e.offsetX > el.clientWidth || e.offsetY > el.clientHeight) {
    return true;
  }
  // 左侧竖向（rtl 容器，如左停靠的监控面板）：滚动条位于元素左缘
  const rect = el.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right
    || e.clientY < rect.top || e.clientY > rect.bottom) {
    return false;
  }
  if (getComputedStyle(el).direction !== 'rtl') {
    return false;
  }
  // clientLeft 不含左滚动条时，滚动条占位体现为左缘空隙
  const gap = rect.width - el.clientLeft - el.clientWidth;
  if (gap > 1 && e.clientX <= rect.left + el.clientLeft + gap) {
    return true;
  }
  // clientLeft 已包含左滚动条宽度的情形
  return el.clientLeft > 1 && e.clientX <= rect.left + el.clientLeft;
}

/** 双击顶栏/遮罩拖动条切换最大化：记住还原尺寸 → 切换 → 刷新共享最大化状态 */
export async function toggleWindowMaximise(): Promise<void> {
  try {
    if (shouldRememberWindowSize()) {
      const [size, maximized] = await Promise.all([WindowGetSize(), WindowIsMaximised()]);
      if (!maximized && size?.w > 100 && size?.h > 100) {
        localStorage.setItem('windowSize', JSON.stringify({ w: size.w, h: size.h, maximized: true }));
      }
    }
  } catch { }
  WindowToggleMaximise();
  // 切换后稍候刷新共享最大化状态，驱动 enableResize 同步与热区层显隐
  setTimeout(() => refreshWindowMaximized(), 100);
}

export default function useWindowState(): () => Promise<void> {
  // 最大化状态来自共享单例轮询，避免多处各自 setInterval 调 Wails IPC
  const maximized = useIsWindowMaximized();
  const isMaxRef = useRef(maximized);
  isMaxRef.current = maximized;

  // 保持 Wails 无边框窗口的边缘缩放开关与最大化状态同步
  useEffect(() => {
    const flags = getWailsFlags();
    if (flags) {
      flags.enableResize = !maximized;
      flags.borderThickness = RESIZE_BORDER_THICKNESS;
    }
    if (maximized) {
      clearWindowResizeState();
    }
  }, [maximized]);

  // 边缘缩放的坐标判定与 resize: 调用交给 Wails 自带 runtime 维护；这里只把
  // runtime 维护的 resizeEdge 镜像到 data 属性，驱动 CSS 光标穿透（元素自身
  // cursor 规则不得遮挡边缘缩放光标）
  useEffect(() => {
    const doc = document.documentElement;

    const onMouseMove = (e: MouseEvent) => {
      const flags = getWailsFlags();
      if (!flags) return;
      const resizeActive = !isMaxRef.current && flags.enableResize !== false;
      if (resizeActive && flags.borderThickness !== RESIZE_BORDER_THICKNESS) {
        flags.borderThickness = RESIZE_BORDER_THICKNESS;
      }

      const edge = flags.resizeEdge;
      if (edge && resizeActive && isPointInWindowEdgeBand(e)) {
        if (doc.getAttribute(RESIZE_EDGE_ATTR) !== edge) {
          doc.setAttribute(RESIZE_EDGE_ATTR, edge);
        }
        return;
      }
      // flags.resizeEdge 只在 mousemove 事件流里被 wails runtime 维护：原生缩放
      // 模态循环吃掉后续鼠标事件、触屏/笔输入没有前置 mousemove、指针离开窗口、
      // 最大化/禁用缩放期间两侧 mousemove 都提前返回——这些空洞都会让边缘状态
      // 残留。残留时 data 属性会让全局 cursor:inherit 生效（光标异常），mousedown
      // 还会把普通点击误判成边缘缩放（点击无法聚焦、键盘快捷键失效）。
      // 这里按坐标现场复核：指针不在边缘带内即为陈旧状态，兜底清理。
      if (edge || doc.hasAttribute(RESIZE_EDGE_ATTR)) {
        clearWindowResizeState();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (isMaxRef.current) return;
      const flags = getWailsFlags();
      if (!flags?.resizeEdge) return;
      // 按下瞬间复核指针真的在边缘带内且为主键：resizeEdge 可能是事件流空洞
      // 留下的陈旧值，不复核时一次普通点击（如点终端获取焦点）会被转成原生
      // 窗口缩放模态循环，吞掉点击与键盘输入
      if (e.button !== 0 || !isPointInWindowEdgeBand(e)) {
        clearWindowResizeState();
        return;
      }
      // 指针落在原生滚动条像素上时，浏览器强制显示箭头光标（CSS 改不了），
      // 此时按住应为滚动而非缩放：命中滚动条就取消边缘状态，让滚动条接管，
      // 保证"显示缩放光标的地方按下才会缩放"，判定与光标始终一致
      const target = e.target;
      if (target instanceof HTMLElement
        && target.clientWidth > 0
        && isOverNativeScrollbar(e, target)) {
        delete flags.resizeEdge;
        return;
      }
      const w = window as unknown as { WailsInvoke?: (cmd: string) => void };
      if (w.WailsInvoke) {
        w.WailsInvoke('resize:' + flags.resizeEdge);
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onLeave = () => clearWindowResizeState();

    // 冒泡阶段注册：晚于 wails runtime 的同名监听执行，镜像的才是当次事件的状态
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
      onLeave();
    };
  }, []);

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
    let lastW = saved && saved.w > 100 ? saved.w : 0;
    let lastH = saved && saved.h > 100 ? saved.h : 0;
    let lastMaximized: boolean | null = null;
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

  return useCallback(() => toggleWindowMaximise(), []);
}

function shouldRememberWindowSize(): boolean {
  return typeof localStorage !== 'undefined'
    && localStorage.getItem('rememberWindowSize') !== 'false';
}

function readSavedWindowSize(): SavedWindowSize | null {
  try {
    const parsed = JSON.parse(localStorage.getItem('windowSize') || 'null') as unknown;
    const saved = parsed as SavedWindowSize | null;
    return saved && saved.w > 100 && saved.h > 100 ? saved : null;
  } catch {
    return null;
  }
}
