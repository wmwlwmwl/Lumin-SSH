import { useEffect, useMemo, useState } from 'react';
import type * as React from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { getTerminalTheme, isDarkTerminalSurface, getSolidTerminalBackground } from '../../utils/theme.ts';

// 终端主题与壁纸：主题对象缓存（浅/深色切换时强制重算）、壁纸状态监听、
// xterm 主题与容器 CSS 变量同步。从 Terminal.tsx 原样搬移。
export function useTerminalTheme(deps: {
  termRef: React.RefObject<XTerm | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { termRef, wrapperRef } = deps;
  const [themeToggle, setThemeToggle] = useState(0); // 用于强制重渲染（浅色/深色模式切换）

  // ponytail: getTerminalTheme() 每次渲染调用 30+ 次，缓存为 1 次
  const T = useMemo(() => getTerminalTheme(), [themeToggle]);

  // ── 背景管理与刷新 ─────────────────────────────────────────────────
  const [bgInfo, setBgInfo] = useState({
    image: localStorage.getItem('termBgImage') || '',
    opacity: parseFloat(localStorage.getItem('termBgOpacity') || '0.15'),
    globalActive: Boolean(localStorage.getItem('globalBgImage')),
  });

  useEffect(() => {
    const handleBgChange = () => {
      setBgInfo({
        image: localStorage.getItem('termBgImage') || '',
        opacity: parseFloat(localStorage.getItem('termBgOpacity') || '0.15'),
        globalActive: Boolean(localStorage.getItem('globalBgImage')),
      });
    };
    window.addEventListener('terminal-bg-changed', handleBgChange);
    window.addEventListener('global-appearance-changed', handleBgChange);
    return () => {
      window.removeEventListener('terminal-bg-changed', handleBgChange);
      window.removeEventListener('global-appearance-changed', handleBgChange);
    };
  }, []);

  // 监听终端颜色主题切换，即时更新 xterm 主题
  // 同时监听 App 浅色/深色模式切换
  useEffect(() => {
    const handleThemeChange = () => {
      // setThemeToggle 触发重渲染，让 useMemo 重新计算 T（从 localStorage 读取最新主题）
      setThemeToggle(v => v + 1);
    };
    const handleModeChange = () => {
      // 同上，触发重渲染以更新 xterm 主题 + 容器颜色
      setThemeToggle(v => v + 1);
    };
    window.addEventListener('terminal-theme-changed', handleThemeChange);
    window.addEventListener('theme-mode-changed', handleModeChange);
    return () => {
      window.removeEventListener('terminal-theme-changed', handleThemeChange);
      window.removeEventListener('theme-mode-changed', handleModeChange);
    };
  }, []);

  // T 更新后同步 xterm 主题 + 容器 CSS 变量
  useEffect(() => {
    const term = termRef.current;
    if (term) {
      // xterm 背景用不透明容器底色（反转显示需要真实背景色），壁纸/色调层叠在内容上方
      const xtermTheme = { ...T.xterm };
      xtermTheme.background = getSolidTerminalBackground(T);
      const darkTerm = isDarkTerminalSurface(T);
      // 搜索/选区当前匹配常走 selectionForeground：深色终端强制白字，浅色终端强制深字
      xtermTheme.selectionForeground = darkTerm ? '#ffffff' : '#0f172a';
      term.options.theme = xtermTheme;
      // ponytail: 对比度按终端底算。深色终端也关自动反差——搜索高亮底会参与计算，
      // 否则白字会被压成黑字（浅色 UI + 复制深色终端时尤其明显）
      term.options.minimumContrastRatio = 0;
      // 强制重绘已有缓冲，否则 ANSI 色板切换后旧行不更新
      try {
        const rows = Math.max(0, (term.rows || 1) - 1);
        term.refresh(0, rows);
      } catch (_) {}
    }
    // ponytail: container 颜色走 CSS 变量，JSX 中不再直接引用 T.container
    const el = wrapperRef.current;
    if (el) {
      const c = T.container;
      // 主题包容器字段为可选，缺失时以空串兜底（原 .jsx 传 undefined 会被 setProperty 强转为 "undefined"）
      const cssVar = (value: string | undefined) => value || '';
      el.style.setProperty('--term-container-bg', cssVar(c.containerBg));
      el.style.setProperty('--term-tint', c.tint || 'transparent');
      el.style.setProperty('--term-status-bg', cssVar(c.statusBarBg));
      el.style.setProperty('--term-status-border', cssVar(c.statusBarBorder));
      el.style.setProperty('--term-status-color', cssVar(c.statusBarColor));
      el.style.setProperty('--term-server-color', cssVar(c.serverNameColor));
      el.style.setProperty('--term-input-bar-bg', cssVar(c.inputBarBg));
      el.style.setProperty('--term-input-bar-border', cssVar(c.inputBarBorder));
      el.style.setProperty('--term-input-bg', cssVar(c.inputBg));
      el.style.setProperty('--term-input-color', cssVar(c.inputColor));
      el.style.setProperty('--term-input-placeholder', c.inputPlaceholder || c.mutedColor || '');
      el.style.setProperty('--term-btn-border', cssVar(c.btnBorder));
      el.style.setProperty('--term-separator', cssVar(c.separator));
      el.style.setProperty('--term-muted', cssVar(c.mutedColor));
      el.style.setProperty('--term-context-bg', cssVar(c.contextBg));
      el.style.setProperty('--term-context-border', cssVar(c.contextBorder));
      el.style.setProperty('--term-context-shadow', cssVar(c.contextShadow));
    }
  }, [T]);

  return { T, themeToggle, bgInfo };
}
