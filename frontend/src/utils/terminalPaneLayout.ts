export type TerminalPaneCellId = 'tl' | 'tr' | 'bl' | 'br';

export const TERMINAL_PANE_CELL_IDS: TerminalPaneCellId[] = ['tl', 'tr', 'bl', 'br'];

const TERMINAL_PANE_CELL_META: Record<TerminalPaneCellId, { row: number; col: number }> = {
  tl: { row: 0, col: 0 },
  tr: { row: 0, col: 1 },
  bl: { row: 1, col: 0 },
  br: { row: 1, col: 1 },
};

/** 面板在 2x2 网格中占据的矩形 */
export interface TerminalPaneRect {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  width: number;
  height: number;
}

/** 终端面板（布局中的一项） */
export interface TerminalPaneInfo {
  id?: string;
  terminalId: string;
  cells: TerminalPaneCellId[];
  [key: string]: unknown;
}

/** 终端分屏布局 */
export interface TerminalPaneLayout {
  sessionId?: string;
  rootTerminalId?: string;
  panes: TerminalPaneInfo[];
  [key: string]: unknown;
}

/** 拆分方向 */
export type TerminalPaneSplitDirection = 'left' | 'right' | 'up' | 'down';


export function sortTerminalPaneCells(cells: unknown): TerminalPaneCellId[] {
  return TERMINAL_PANE_CELL_IDS.filter((cellId) => Array.isArray(cells) && cells.includes(cellId));
}

export function getTerminalPaneRect(cells: unknown): TerminalPaneRect | null {
  const normalized = sortTerminalPaneCells(cells);
  if (normalized.length === 0) {
    return null;
  }
  const rows = normalized.map((cellId) => TERMINAL_PANE_CELL_META[cellId].row);
  const cols = normalized.map((cellId) => TERMINAL_PANE_CELL_META[cellId].col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  return {
    minRow,
    maxRow,
    minCol,
    maxCol,
    width: maxCol - minCol + 1,
    height: maxRow - minRow + 1,
  };
}

function getTerminalPaneCellsFromRect(rect: TerminalPaneRect | null): TerminalPaneCellId[] {
  if (!rect) {
    return [];
  }
  return TERMINAL_PANE_CELL_IDS.filter((cellId) => {
    const meta = TERMINAL_PANE_CELL_META[cellId];
    return meta.row >= rect.minRow
      && meta.row <= rect.maxRow
      && meta.col >= rect.minCol
      && meta.col <= rect.maxCol;
  });
}

export function getTerminalPaneRemainingCells(panes: Array<{ cells?: unknown }> | null | undefined): TerminalPaneCellId[] {
  const occupied = new Set((panes || []).flatMap((pane) => sortTerminalPaneCells(pane.cells)));
  return TERMINAL_PANE_CELL_IDS.filter((cellId) => !occupied.has(cellId));
}

function getTerminalDockTargetPreferences(target: unknown): { primary: TerminalPaneSplitDirection | null; secondary: TerminalPaneSplitDirection | null } {
  switch (target) {
    case 'top-left':
      return { primary: 'up', secondary: 'left' };
    case 'top-right':
      return { primary: 'right', secondary: 'up' };
    case 'bottom-left':
      return { primary: 'left', secondary: 'down' };
    case 'bottom-right':
      return { primary: 'down', secondary: 'right' };
    default:
      return { primary: null, secondary: null };
  }
}

export function getTerminalDockTargetCellId(target: unknown): TerminalPaneCellId | null {
  switch (target) {
    case 'top-left':
      return 'tl';
    case 'top-right':
      return 'tr';
    case 'bottom-left':
      return 'bl';
    case 'bottom-right':
      return 'br';
    default:
      return null;
  }
}

function getTerminalPaneSplitDirection(rect: TerminalPaneRect | null, target: unknown): TerminalPaneSplitDirection | null {
  if (!rect) {
    return null;
  }
  const { primary, secondary } = getTerminalDockTargetPreferences(target);
  const canSplit = (direction: TerminalPaneSplitDirection) => {
    if (direction === 'left' || direction === 'right') {
      return rect.width >= 2;
    }
    if (direction === 'up' || direction === 'down') {
      return rect.height >= 2;
    }
    return false;
  };
  if (primary && canSplit(primary)) {
    return primary;
  }
  if (secondary && canSplit(secondary)) {
    return secondary;
  }
  return null;
}

export function splitTerminalPaneCells(
  cells: unknown,
  target: unknown,
): { direction: TerminalPaneSplitDirection; newCells: TerminalPaneCellId[]; remainingCells: TerminalPaneCellId[] } | null {
  const rect = getTerminalPaneRect(cells);
  const direction = getTerminalPaneSplitDirection(rect, target);
  if (!rect || !direction) {
    return null;
  }

  if (direction === 'left' || direction === 'right') {
    const leftRect = { ...rect, maxCol: rect.minCol };
    const rightRect = { ...rect, minCol: rect.maxCol };
    const newRect = direction === 'left' ? leftRect : rightRect;
    const remainingRect = direction === 'left' ? rightRect : leftRect;
    return {
      direction,
      newCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(newRect)),
      remainingCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(remainingRect)),
    };
  }

  const topRect = { ...rect, maxRow: rect.minRow };
  const bottomRect = { ...rect, minRow: rect.maxRow };
  const newRect = direction === 'up' ? topRect : bottomRect;
  const remainingRect = direction === 'up' ? bottomRect : topRect;
  return {
    direction,
    newCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(newRect)),
    remainingCells: sortTerminalPaneCells(getTerminalPaneCellsFromRect(remainingRect)),
  };
}


export function getTerminalPaneAbsolutePlacement(cells: unknown): Record<string, string> {
  const rect = getTerminalPaneRect(cells);
  if (!rect) {
    return {};
  }
  return {
    left: `${rect.minCol * 50}%`,
    top: `${rect.minRow * 50}%`,
    width: `${rect.width * 50}%`,
    height: `${rect.height * 50}%`,
  };
}

export function remapTerminalPaneLayouts(
  layouts: Record<string, TerminalPaneLayout> | null | undefined,
  idMap: Record<string, string>,
  sessionId: string,
): Record<string, TerminalPaneLayout> {
  const next: Record<string, TerminalPaneLayout> = {};
  Object.entries(layouts || {}).forEach(([layoutId, layout]) => {
    if (layout?.sessionId !== sessionId) {
      next[layoutId] = layout;
      return;
    }
    const mappedLayoutId = idMap[layoutId] || layoutId;
    const mappedRootTerminalId = idMap[layout.rootTerminalId || layoutId] || layout.rootTerminalId || layoutId;
    next[mappedLayoutId] = {
      ...layout,
      sessionId,
      rootTerminalId: mappedRootTerminalId,
      panes: (layout.panes || []).map((pane) => ({
        ...pane,
        terminalId: idMap[pane.terminalId] || pane.terminalId,
        cells: sortTerminalPaneCells(pane.cells),
      })),
    };
  });
  return next;
}

export function isTerminalPaneRectangular(cells: unknown): boolean {
  const normalized = sortTerminalPaneCells(cells);
  const rect = getTerminalPaneRect(normalized);
  if (!rect) {
    return false;
  }
  return sortTerminalPaneCells(getTerminalPaneCellsFromRect(rect)).join(',') === normalized.join(',');
}

function getTerminalPaneCellsForOrientation(
  anchorCellId: unknown,
  orientation: unknown,
): TerminalPaneCellId[] | null {
  const meta = anchorCellId === 'tl' || anchorCellId === 'tr' || anchorCellId === 'bl' || anchorCellId === 'br'
    ? TERMINAL_PANE_CELL_META[anchorCellId]
    : null;
  if (!meta) {
    return null;
  }
  if (orientation === 'rows') {
    return sortTerminalPaneCells(TERMINAL_PANE_CELL_IDS.filter((cellId) => TERMINAL_PANE_CELL_META[cellId].row === meta.row));
  }
  if (orientation === 'cols') {
    return sortTerminalPaneCells(TERMINAL_PANE_CELL_IDS.filter((cellId) => TERMINAL_PANE_CELL_META[cellId].col === meta.col));
  }
  return null;
}

function getTerminalPaneDiffCount(sourceCells: unknown, targetCells: unknown): number {
  const source = new Set(sortTerminalPaneCells(sourceCells));
  const target = new Set(sortTerminalPaneCells(targetCells));
  return TERMINAL_PANE_CELL_IDS.reduce((count, cellId) => (
    count + (source.has(cellId) === target.has(cellId) ? 0 : 1)
  ), 0);
}

export interface NormalizedTwoPaneLayout {
  orientation: 'rows' | 'cols';
  paneCells: TerminalPaneCellId[];
  rootCells: TerminalPaneCellId[];
  preferredRank: number;
  diff: number;
}

export function normalizeTwoTerminalPaneLayout(
  rootCells: unknown,
  pane: { cells?: unknown } | null | undefined,
  preferredOrientation: 'rows' | 'cols' | null = null,
): NormalizedTwoPaneLayout | null {
  const anchorCellId = sortTerminalPaneCells(pane?.cells)[0];
  if (!anchorCellId) {
    return null;
  }

  const orientations: Array<'rows' | 'cols'> = preferredOrientation === 'rows' || preferredOrientation === 'cols'
    ? [preferredOrientation, preferredOrientation === 'rows' ? 'cols' : 'rows']
    : ['rows', 'cols'];

  const candidates = orientations.map((orientation, index) => {
    const paneCells = getTerminalPaneCellsForOrientation(anchorCellId, orientation);
    if (!paneCells) {
      return null;
    }
    const nextRootCells = getTerminalPaneRemainingCells([{ cells: paneCells }]);
    return {
      orientation,
      paneCells,
      rootCells: nextRootCells,
      preferredRank: index,
      diff: getTerminalPaneDiffCount(rootCells, nextRootCells) + getTerminalPaneDiffCount(pane?.cells, paneCells),
    };
  }).filter((candidate): candidate is NormalizedTwoPaneLayout => candidate !== null);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (left.diff !== right.diff) {
      return left.diff - right.diff;
    }
    if (left.preferredRank !== right.preferredRank) {
      return left.preferredRank - right.preferredRank;
    }
    return left.orientation === 'rows' ? -1 : 1;
  });

  return candidates[0];
}

function runTerminalPaneLayoutSelfCheck(): void {
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(`终端布局自检失败：${message}`);
  };
  const assertPartition = (leftCells: unknown, rightCells: unknown, message: string) => {
    const left = sortTerminalPaneCells(leftCells);
    const right = sortTerminalPaneCells(rightCells);
    assert(isTerminalPaneRectangular(left) && isTerminalPaneRectangular(right), `${message}必须保持矩形`);
    assert(left.every((cellId) => !right.includes(cellId)), `${message}不能重叠`);
    assert(sortTerminalPaneCells([...left, ...right]).length === TERMINAL_PANE_CELL_IDS.length, `${message}必须覆盖全部单元格`);
  };

  const split = splitTerminalPaneCells(TERMINAL_PANE_CELL_IDS, 'top-right');
  assert(split, '完整面板必须可拆分');
  assertPartition(split!.newCells, split!.remainingCells, '拆分结果');

  const normalized = normalizeTwoTerminalPaneLayout(['tl'], { cells: ['br'] });
  assert(normalized, '双面板布局必须可规范化');
  assertPartition(normalized!.rootCells, normalized!.paneCells, '规范化结果');

  const remapped = remapTerminalPaneLayouts({
    root: {
      sessionId: 'session',
      rootTerminalId: 'root',
      panes: [
        { id: 'left', terminalId: 'root', cells: ['tl', 'bl'] },
        { id: 'right', terminalId: 'child', cells: ['tr', 'br'] },
      ],
    },
  }, { root: 'root-next', child: 'child-next' }, 'session');
  assert(remapped['root-next']?.panes?.length === 2, '终端 ID 映射不能丢失面板');
  assert(remapped['root-next']!.panes[1].terminalId === 'child-next', '终端 ID 映射必须更新子终端');
}

if (import.meta.env.DEV) runTerminalPaneLayoutSelfCheck();
