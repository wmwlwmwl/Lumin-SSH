import { useRef } from 'react';
import type * as React from 'react';
import type { Terminal as XTerm, IBufferRange } from '@xterm/xterm';
import { findTerminalHttpLinksOnLine, getTerminalInputStartLine } from '../../utils/terminalHelpers.ts';

// 常驻 HTTP 链接下划线覆盖层：可见区扫描缓存（下划线与 provider 共用，避免双扫）。
// 从 Terminal.tsx 原样搬移，闭包变量同名传入。
export function useTerminalLinkUnderlines(deps: {
  termRef: React.RefObject<XTerm | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { termRef, containerRef } = deps;
  const linkUnderlineLayerRef = useRef<HTMLDivElement | null>(null);
  const linkUnderlineSyncRAFRef = useRef<number | null>(null);
  const viewportLinkCacheRef = useRef({ key: '', byLine: new Map<number, Array<{ text: string; range: IBufferRange }>>() });

  function getViewportLinkCache(term: XTerm) {
    const buf = term.buffer.active;
    const rows = term.rows || 0;
    const viewportY = buf.viewportY;
    // 简单 key：视口位置 + 行数 + 输入行起点（输入行变化时失效）
    const inputStart = getTerminalInputStartLine(term);
    const key = `${viewportY}|${rows}|${inputStart}|${buf.baseY}|${buf.cursorY}`;
    const cache = viewportLinkCacheRef.current;
    if (cache.key === key) return cache.byLine;
    const byLine: Map<number, Array<{ text: string; range: IBufferRange }>> = new Map();
    for (let row = 0; row < rows; row += 1) {
      const bufferLineNumber = viewportY + row + 1;
      const links = findTerminalHttpLinksOnLine(term, bufferLineNumber);
      if (links.length) byLine.set(bufferLineNumber, links);
    }
    viewportLinkCacheRef.current = { key, byLine };
    return byLine;
  }

  function invalidateViewportLinkCache() {
    viewportLinkCacheRef.current = { key: '', byLine: new Map() };
  }

  function scheduleLinkUnderlineSync() {
    if (linkUnderlineSyncRAFRef.current !== null) return;
    linkUnderlineSyncRAFRef.current = requestAnimationFrame(() => {
      linkUnderlineSyncRAFRef.current = null;
      invalidateViewportLinkCache();
      syncLinkUnderlines();
    });
  }

  function syncLinkUnderlines() {
    const layer = linkUnderlineLayerRef.current;
    const term = termRef.current;
    const container = containerRef.current;
    if (!layer) return;
    if (!term?.buffer?.active || !container) {
      layer.innerHTML = '';
      return;
    }
    const screen = container.querySelector('.xterm-screen');
    const rowsEl = container.querySelector('.xterm-rows');
    if (!screen || !rowsEl) {
      layer.innerHTML = '';
      return;
    }
    const cols = term.cols || 1;
    const rows = term.rows || 1;
    const screenRect = screen.getBoundingClientRect();
    const cellWidth = screenRect.width / cols;
    const cellHeight = screenRect.height / rows;
    const rowsRect = rowsEl.getBoundingClientRect();
    const offsetX = rowsRect.left - screenRect.left;
    const offsetY = rowsRect.top - screenRect.top;
    const byLine = getViewportLinkCache(term);
    const parts: string[] = [];
    const seen = new Set();
    const viewportY = term.buffer.active.viewportY;
    byLine.forEach((links) => {
      for (const link of links) {
        const id = `${link.range.start.y}:${link.range.start.x}-${link.range.end.y}:${link.range.end.x}:${link.text}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const y0 = link.range.start.y;
        const y1 = link.range.end.y;
        for (let by = y0; by <= y1; by += 1) {
          const row = by - 1 - viewportY;
          if (row < 0 || row >= rows) continue;
          const startCol = by === y0 ? Math.max(0, link.range.start.x - 1) : 0;
          const endCol = by === y1 ? Math.max(startCol + 1, link.range.end.x) : cols;
          const left = offsetX + startCol * cellWidth;
          const width = Math.max(cellWidth, (endCol - startCol) * cellWidth);
          const top = offsetY + (row + 1) * cellHeight - 2;
          parts.push(
            `<div style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:0;border-bottom:1px solid var(--accent, #4d9eff);pointer-events:none;"></div>`,
          );
        }
      }
    });
    layer.innerHTML = parts.join('');
  }

  return { linkUnderlineLayerRef, linkUnderlineSyncRAFRef, getViewportLinkCache, scheduleLinkUnderlineSync };
}
