import { useEffect, useState } from 'react';
import type * as React from 'react';
import { Z } from '../../constants/zIndex';
import defaultTermBg from '../../assets/term_bg.webp';
import { isDarkTerminalSurface, type TerminalTheme } from '../../utils/theme.ts';
import type { I18nKey } from '../../i18n.ts';

type LooseT = (key: I18nKey, vars?: Record<string, unknown>) => string;

// 主题色调层 + 壁纸层（叠在内容上方）。从 Terminal.tsx 原样搬移。
export function TerminalBackground({
  T,
  bgInfo,
}: {
  T: TerminalTheme;
  bgInfo: { image: string; opacity: number; globalActive: boolean };
}) {
  return (
    <>
      {/* 主题色调层：xterm 背景已不透明，叠在内容上方才能生效（弹出层 fixed+zIndex 更高，不受影响） */}
      <div
        className="absolute inset-0 pointer-events-none bg-[var(--term-tint,transparent)]"
        style={{ zIndex: Z.STACK }}
      />
      {/* 壁纸层：叠在内容上方，浅色底下使用 multiply 混合模式，避免亮色/白色壁纸部分遮盖冲淡字色 */}
      {/* 全局背景激活时不渲染默认终端纹理，避免与全局壁纸叠加 */}
      <div
        className="absolute inset-0 pointer-events-none bg-cover bg-center"
        style={{
          zIndex: Z.STACK,
          backgroundImage: `url("${bgInfo.image || (bgInfo.globalActive ? '' : defaultTermBg)}")`,
          opacity: Number.isFinite(bgInfo.opacity) ? bgInfo.opacity : 0.15,
          mixBlendMode: isDarkTerminalSurface(T) ? 'normal' : 'multiply',
        }}
      />
    </>
  );
}

// Session 状态栏：状态指示灯（连接成功涟漪动画）+ 服务器名 + 连接状态/重连。
export function TerminalStatusBar({
  status,
  serverName,
  sessionId,
  t,
}: {
  status: string;
  serverName: string;
  sessionId: string;
  t: LooseT;
}) {
  const isConnected  = status === 'connected';
  const isConnecting = status === 'connecting';
  const isError      = status === 'error';
  const isClosed     = status === 'closed';
  const statusColor  = isConnected ? 'var(--success)' : isConnecting ? 'var(--warning)' : isError ? 'var(--danger)' : 'var(--text-tertiary)';
  const [justConnected, setJustConnected] = useState(false);

  // 连接成功时触发一次性涟漪动画
  useEffect(() => {
    if (isConnected) {
      setJustConnected(true);
      const timer = setTimeout(() => setJustConnected(false), 1400);
      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  return (
    <div className="term-status-bar">
      {/* 状态指示灯 - 使用全局 CSS 类，连接成功时触发涟漪动画 */}
      <div className={[
        'status-dot',
        isConnected  ? (justConnected ? 'just-connected' : 'online') : '',
        isConnecting ? 'connecting' : '',
        isError      ? 'offline' : '',
        !isConnected && !isConnecting && !isError ? 'offline' : '',
      ].filter(Boolean).join(' ')} style={{ flexShrink: 0 }} />
      <span className="font-medium font-mono text-[var(--term-server-color)]">
        {serverName || 'Terminal'}
      </span>

      {/* 右侧极简状态显示 */}
      <div className="ml-auto flex items-center gap-2.5">
        <span className="text-xs font-mono font-bold" style={{ color: statusColor }}>
          {isConnected  ? t('已连接')
           : isConnecting ? t('连接中...')
           : isError      ? t('错误')
           : t('离线')}
        </span>
        {(isError || isClosed) && (
          <button
            className="term-reconnect-btn"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('ssh-reconnect-trigger', { detail: sessionId }));
            }}
          >
            {t('重新连接')}
          </button>
        )}
      </div>
    </div>
  );
}

// xterm 渲染层 + 时间轴 / 命令块边框 + 常驻链接下划线层。
export function TerminalViewport({
  timestampsVisible,
  commandBlocksVisible,
  alternateBufferActive,
  terminalDefaultMouseCursorEnabled,
  handleTerminalMouseDownCapture,
  handleTerminalMouseUpCapture,
  containerRef,
  gutterRef,
  linkUnderlineLayerRef,
}: {
  timestampsVisible: boolean;
  commandBlocksVisible: boolean;
  alternateBufferActive: boolean;
  terminalDefaultMouseCursorEnabled: boolean;
  handleTerminalMouseDownCapture: (event: React.MouseEvent) => void;
  handleTerminalMouseUpCapture: (event: React.MouseEvent) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  gutterRef: React.RefObject<HTMLDivElement | null>;
  linkUnderlineLayerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 min-h-0 flex">
      <div ref={gutterRef} className="shrink-0 pt-0 overflow-hidden box-border" style={{
        display: (timestampsVisible || commandBlocksVisible) && !alternateBufferActive ? 'block' : 'none',
        // 时间戳约 72px；命令块约 16px；两者同时开约 96px
        // 时间戳列 70 + 命令块 14 + padding ≈ 90；仅时间戳 75；仅命令块 22
        width: timestampsVisible && commandBlocksVisible ? 90 : (timestampsVisible ? 75 : 22),
      }} />
      <div
        className={terminalDefaultMouseCursorEnabled ? 'terminal-output-default-mouse-cursor relative flex-1 min-h-0' : 'relative flex-1 min-h-0'}
        onMouseDownCapture={handleTerminalMouseDownCapture}
        onMouseUpCapture={handleTerminalMouseUpCapture}
      >
        <div
          ref={containerRef}
          className="h-full min-h-0 p-0 bg-transparent"
        />
        {/* 常驻链接下划线（pointer-events:none，不挡点击/选区） */}
        <div
          ref={linkUnderlineLayerRef}
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ zIndex: Z.STACK }}
        />
      </div>
    </div>
  );
}
