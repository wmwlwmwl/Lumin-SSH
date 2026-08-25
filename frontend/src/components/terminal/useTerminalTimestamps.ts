import { useRef } from 'react';
import type * as React from 'react';
import type { IMarker, Terminal as XTerm } from '@xterm/xterm';
import { formatTerminalTimestamp } from '../../utils/terminalHelpers.ts';

// Ring buffer 时间戳：用 xterm marker 跟随 scrollback 裁剪，避免 buffer 行号复用后错位。
// 从 Terminal.tsx 原样搬移，闭包变量同名传入。
export function useTerminalTimestamps(deps: {
  timestampsEnabledRef: React.RefObject<boolean>;
}) {
  const { timestampsEnabledRef } = deps;
  const TS_POOL = 6000;
  // null! 惰性初始化惯用法：下方 if 守卫保证首次渲染即完成填充，后续恒非空
  const tsRingRef = useRef<{ entries: Array<{ marker: IMarker; val: string } | null>; next: number }>(null!);
  if (!tsRingRef.current) {
    tsRingRef.current = { entries: new Array(TS_POOL), next: 0 };
  }
  const tsSet = (marker: IMarker | undefined, val: string) => {
    if (!marker) return;
    const r = tsRingRef.current;
    // 同 line 只保留最新戳（执行命令时要盖掉空提示符上的旧时间）
    const line = marker.line;
    if (typeof line === 'number' && line >= 0) {
      for (let j = 0; j < r.entries.length; j += 1) {
        const entry = r.entries[j];
        if (entry?.marker?.line === line) {
          entry.marker.dispose?.();
          r.entries[j] = null;
        }
      }
    }
    const i = r.next;
    r.entries[i]?.marker?.dispose?.();
    r.entries[i] = { marker, val };
    r.next = (i + 1) % TS_POOL;
  };
  const tsEnsureLine = (term: XTerm, line: number, timestampsByLine: Map<number, string>) => {
    if (term.buffer.active.type !== 'normal') return '';
    const existing = timestampsByLine.get(line);
    if (existing) return existing;
    const currentLine = term.buffer.active.baseY + term.buffer.active.cursorY;
    const ts = formatTerminalTimestamp();
    const marker = term.registerMarker(line - currentLine);
    tsSet(marker, ts);
    if (marker) timestampsByLine.set(line, ts);
    return marker ? ts : '';
  };
  const tsClearLine = (line: number) => {
    const entries = tsRingRef.current.entries;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry?.marker?.line === line) {
        entry.marker.dispose?.();
        entries[i] = null;
      }
    }
  };
  const tsClear = () => {
    tsRingRef.current.entries.forEach((entry) => entry?.marker?.dispose?.());
    tsRingRef.current.entries.fill(null);
    tsRingRef.current.next = 0;
  };
  // 按 buffer 行号快照时间戳（收起/展开改写 buffer 后要还原，不能重新 now()）
  // 与 syncGutter 一致：ring 从旧到新扫，后写覆盖，保留「执行时刻」而非提示符出现时刻
  const tsSnapshotByLine = (term: XTerm, lineCount: number) => {
    const total = typeof lineCount === 'number' ? lineCount : (term?.buffer?.active?.length || 0);
    const byLine = new Array(Math.max(0, total)).fill('');
    const ring = tsRingRef.current;
    for (let offset = 0; offset < ring.entries.length; offset += 1) {
      const index = (ring.next + offset) % ring.entries.length;
      const entry = ring.entries[index];
      const line = entry?.marker?.line;
      if (!entry || entry.marker?.isDisposed || typeof line !== 'number' || line < 0 || line >= byLine.length) continue;
      byLine[line] = entry.val;
    }
    return byLine;
  };
  const tsRemountFromList = (term: XTerm, tsList: string[]) => {
    tsClear();
    if (!term?.buffer?.active || !Array.isArray(tsList) || !timestampsEnabledRef.current) return;
    const bufLen = term.buffer.active.length;
    const cursorLine = term.buffer.active.baseY + term.buffer.active.cursorY;
    const limit = Math.min(tsList.length, bufLen);
    for (let line = 0; line < limit; line += 1) {
      const val = tsList[line];
      if (!val) continue;
      try {
        const marker = term.registerMarker(line - cursorLine);
        if (marker) tsSet(marker, val);
      } catch (_) {}
    }
  };
  return { tsRingRef, tsSet, tsEnsureLine, tsClearLine, tsClear, tsSnapshotByLine, tsRemountFromList };
}
