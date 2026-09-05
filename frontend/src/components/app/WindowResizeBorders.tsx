import type React from 'react';
import useIsWindowMaximized from '../../hooks/useIsWindowMaximized.ts';
import { Z } from '../../constants/zIndex.ts';

/**
 * WindowResizeBorders
 * 在非最大化窗口边缘与四角提供顶层无边框调整热区，
 * 解决原生滚动条（AI 面板 / 监控面板 / 文件管理器）以及边缘折叠条遮挡/阻断窗口拖动缩放的问题。
 * 指针悬停原生滚动条时热区会整体让位（让位逻辑见 useWindowState）。
 */

const EDGE_THICKNESS = 5;
const CORNER_SIZE = 8;

interface ResizeZone {
  edge: string;
  cursor: string;
  className: string;
  zIndex: number;
  style: React.CSSProperties;
}

const RESIZE_ZONES: ResizeZone[] = [
  {
    edge: 'e-resize', cursor: 'e-resize', zIndex: Z.WINDOW_RESIZE_BORDER,
    className: 'window-resize-border window-resize-border-right',
    style: { top: 0, right: 0, bottom: 0, width: EDGE_THICKNESS },
  },
  {
    edge: 'w-resize', cursor: 'w-resize', zIndex: Z.WINDOW_RESIZE_BORDER,
    className: 'window-resize-border window-resize-border-left',
    style: { top: 0, left: 0, bottom: 0, width: EDGE_THICKNESS },
  },
  {
    edge: 's-resize', cursor: 's-resize', zIndex: Z.WINDOW_RESIZE_BORDER,
    className: 'window-resize-border window-resize-border-bottom',
    style: { left: 0, right: 0, bottom: 0, height: EDGE_THICKNESS },
  },
  {
    edge: 'n-resize', cursor: 'n-resize', zIndex: Z.WINDOW_RESIZE_BORDER,
    className: 'window-resize-border window-resize-border-top',
    style: { left: 0, right: 0, top: 0, height: EDGE_THICKNESS },
  },
  {
    edge: 'nw-resize', cursor: 'nw-resize', zIndex: Z.WINDOW_RESIZE_CORNER,
    className: 'window-resize-corner window-resize-corner-tl',
    style: { top: 0, left: 0, width: CORNER_SIZE, height: CORNER_SIZE },
  },
  {
    edge: 'ne-resize', cursor: 'ne-resize', zIndex: Z.WINDOW_RESIZE_CORNER,
    className: 'window-resize-corner window-resize-corner-tr',
    style: { top: 0, right: 0, width: CORNER_SIZE, height: CORNER_SIZE },
  },
  {
    edge: 'sw-resize', cursor: 'sw-resize', zIndex: Z.WINDOW_RESIZE_CORNER,
    className: 'window-resize-corner window-resize-corner-bl',
    style: { bottom: 0, left: 0, width: CORNER_SIZE, height: CORNER_SIZE },
  },
  {
    edge: 'se-resize', cursor: 'se-resize', zIndex: Z.WINDOW_RESIZE_CORNER,
    className: 'window-resize-corner window-resize-corner-br',
    style: { bottom: 0, right: 0, width: CORNER_SIZE, height: CORNER_SIZE },
  },
];

export default function WindowResizeBorders() {
  const isMax = useIsWindowMaximized();

  if (isMax) return null;

  // 兜底：触屏/笔输入没有前置 mousemove、flags.resizeEdge 为空时，由热区自身发起缩放
  const startResize = (e: React.MouseEvent, edge: string) => {
    if (e.button !== 0) return; // 仅主键进入缩放，右键/中键不得触发原生缩放循环
    e.preventDefault();
    e.stopPropagation();
    const w = window as unknown as {
      wails?: { flags?: { resizeEdge?: string } };
      WailsInvoke?: (cmd: string) => void;
    };
    if (w.wails?.flags) {
      w.wails.flags.resizeEdge = edge;
    }
    if (w.WailsInvoke) {
      w.WailsInvoke('resize:' + edge);
    }
  };

  return (
    <>
      {RESIZE_ZONES.map((zone) => (
        <div
          key={zone.edge}
          className={zone.className}
          style={{
            position: 'fixed',
            zIndex: zone.zIndex,
            cursor: zone.cursor,
            pointerEvents: 'auto',
            ...zone.style,
          }}
          onMouseDown={(e) => startResize(e, zone.edge)}
        />
      ))}
    </>
  );
}
