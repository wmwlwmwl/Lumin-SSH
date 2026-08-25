import { useCallback, useEffect, useRef, useState } from 'react';
import { clampPanelWidth } from '../utils/probeFormatting.ts';

const FILE_MANAGER_LEFT_MIN = 180;
const FILE_MANAGER_BOTTOM_MIN = 100;
const PROBE_PANEL_MIN = 280;
const AI_PANEL_MIN = 450;
const COLLAPSE_ARMED_SIZE = 52;

export type FileManagerDockPosition = 'tab' | 'left' | 'right' | 'bottom';
export type PanelResizeDirection = 'tab' | 'left' | 'right' | 'bottom' | 'probe' | 'ai';

/** 停靠预览矩形（视口坐标 + 相对容器样式） */
export interface DockRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  style?: Record<string, string | number>;
}

export interface UseWorkspacePanelDockingOptions {
  bottomSplitHeight: number;
  bottomSplitHeightRef: React.MutableRefObject<number>;
  contentTab: string;
  fileManagerPosition: FileManagerDockPosition;
  leftSplitWidth: number;
  leftSplitWidthRef: React.MutableRefObject<number>;
  aiPanelWidthRef: React.MutableRefObject<number>;
  probePanelPosition: 'left' | 'right';
  probePanelWidthRef: React.MutableRefObject<number>;
  setAIPanelVisibility: (value: unknown) => void;
  setContentTab: (tab: string) => void;
  setProbePanelCollapsedPersistent: (value: unknown) => void;
  showQuickCommandsRef: React.MutableRefObject<boolean>;
  updateAiPanelWidth: (value: unknown) => void;
  updateBottomSplitHeight: (value: unknown) => void;
  updateLeftSplitWidth: (value: unknown) => void;
  updateProbePanelWidth: (value: unknown) => void;
}

export interface UseWorkspacePanelDockingResult {
  collapseDragIntent: PanelResizeDirection | null;
  fileManagerCollapsed: boolean;
  fileManagerDockConfirmTarget: FileManagerDockPosition | null;
  fileManagerDockPreview: PanelResizeDirection | null;
  fileManagerDockTabAnchorRef: React.MutableRefObject<HTMLElement | null>;
  fileManagerPosition: FileManagerDockPosition;
  getFileManagerDockConfirmRect: (target: FileManagerDockPosition) => DockRect | null;
  getFileManagerDockPreviewRect: (target: string) => DockRect | null;
  handleFileManagerLayoutModeChange: (mode: string) => void;
  handleFileManagerSplitPositionChange: (position: string) => void;
  handleFileManagerTabDock: () => void;
  setFileManagerCollapsedPersistent: (next: boolean) => void;
  shouldIgnoreResizerClick: () => boolean;
  startDrag: (event: React.MouseEvent<HTMLElement> | MouseEvent, direction: PanelResizeDirection) => void;
}

export default function useWorkspacePanelDocking({
  bottomSplitHeight: _bottomSplitHeight,
  bottomSplitHeightRef,
  contentTab,
  fileManagerPosition: initialPosition,
  leftSplitWidth: _leftSplitWidth,
  leftSplitWidthRef,
  aiPanelWidthRef,
  probePanelPosition,
  probePanelWidthRef,
  setAIPanelVisibility,
  setContentTab,
  setProbePanelCollapsedPersistent,
  showQuickCommandsRef,
  updateAiPanelWidth,
  updateBottomSplitHeight,
  updateLeftSplitWidth,
  updateProbePanelWidth,
}: UseWorkspacePanelDockingOptions): UseWorkspacePanelDockingResult {
  const [fileManagerPosition, setFileManagerPosition] = useState<FileManagerDockPosition>(() => {
    const saved = localStorage.getItem('fileManagerPosition') || initialPosition || 'tab';
    return saved === 'tab' || saved === 'left' || saved === 'right' || saved === 'bottom' ? saved : 'tab';
  });
  const [fileManagerSplitPosition, setFileManagerSplitPosition] = useState<FileManagerDockPosition>(() => {
    const savedPosition = localStorage.getItem('fileManagerPosition');
    const savedSplitPosition = localStorage.getItem('fileManagerSplitPosition');
    if (savedPosition === 'left' || savedPosition === 'right' || savedPosition === 'bottom') return savedPosition;
    return savedSplitPosition === 'left' || savedSplitPosition === 'right' || savedSplitPosition === 'bottom' ? savedSplitPosition : 'bottom';
  });
  const [fileManagerCollapsed, setFileManagerCollapsed] = useState(() => localStorage.getItem('fileManagerCollapsed') === 'true');
  const [collapseDragIntent, setCollapseDragIntent] = useState<PanelResizeDirection | null>(null);
  const collapseDragIntentRef = useRef<PanelResizeDirection | null>(null);
  const [fileManagerDockPreview, setFileManagerDockPreview] = useState<PanelResizeDirection | null>(null);
  const fileManagerDockPreviewRef = useRef<PanelResizeDirection | null>(null);
  const [fileManagerDockConfirmTarget, setFileManagerDockConfirmTarget] = useState<FileManagerDockPosition | null>(null);
  const fileManagerDockConfirmTargetRef = useRef<FileManagerDockPosition | null>(null);
  const fileManagerDockTabAnchorRef = useRef<HTMLElement | null>(null);
  const resizerClickSuppressUntilRef = useRef(0);

  const updateCollapseDragIntent = useCallback((next: PanelResizeDirection | null) => {
    if (collapseDragIntentRef.current === next) return;
    collapseDragIntentRef.current = next;
    setCollapseDragIntent(next);
  }, []);
  const updateFileManagerDockPreview = useCallback((next: PanelResizeDirection | null) => {
    if (fileManagerDockPreviewRef.current === next) return;
    fileManagerDockPreviewRef.current = next;
    setFileManagerDockPreview(next);
  }, []);
  const updateFileManagerDockConfirmTarget = useCallback((next: FileManagerDockPosition | null) => {
    if (fileManagerDockConfirmTargetRef.current === next) return;
    fileManagerDockConfirmTargetRef.current = next;
    setFileManagerDockConfirmTarget(next);
  }, []);
  const setFileManagerCollapsedPersistent = useCallback((next: boolean) => {
    setFileManagerCollapsed(next);
    localStorage.setItem('fileManagerCollapsed', String(next));
  }, []);

  const getFileManagerDockPreviewRect = useCallback((target: string): DockRect | null => {
    if (!['left', 'right', 'bottom'].includes(target)) return null;
    const container = document.getElementById('session-editor-container');
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const previewInset = 10;
    const sideWidth = Math.max(FILE_MANAGER_LEFT_MIN, Math.min(800, leftSplitWidthRef.current));
    const bottomInset = fileManagerPosition === 'bottom' && !fileManagerCollapsed ? bottomSplitHeightRef.current + previewInset : previewInset;
    const leftInset = fileManagerPosition === 'left' && !fileManagerCollapsed ? leftSplitWidthRef.current + previewInset : previewInset;
    const rightInset = fileManagerPosition === 'right' && !fileManagerCollapsed ? leftSplitWidthRef.current + previewInset : previewInset;
    if (target === 'left') {
      const left = rect.left + previewInset; const top = rect.top + previewInset; const right = left + sideWidth; const bottom = rect.bottom - bottomInset;
      return right > left && bottom > top ? { left, top, right, bottom, style: { left: previewInset, top: previewInset, bottom: bottomInset, width: `${sideWidth}px` } } : null;
    }
    if (target === 'right') {
      const right = rect.right - previewInset; const left = right - sideWidth; const top = rect.top + previewInset; const bottom = rect.bottom - bottomInset;
      return right > left && bottom > top ? { left, top, right, bottom, style: { right: previewInset, top: previewInset, bottom: bottomInset, width: `${sideWidth}px` } } : null;
    }
    const height = Math.max(FILE_MANAGER_BOTTOM_MIN, Math.min(600, bottomSplitHeightRef.current));
    const left = rect.left + leftInset; const right = rect.right - rightInset; const bottom = rect.bottom - previewInset; const top = bottom - height;
    return right > left && bottom > top ? { left, top, right, bottom, style: { left: leftInset, right: rightInset, bottom: previewInset, height: `${height}px` } } : null;
  }, [bottomSplitHeightRef, fileManagerCollapsed, fileManagerPosition, leftSplitWidthRef]);

  const getFileManagerDockConfirmRect = useCallback((target: FileManagerDockPosition): DockRect | null => {
    if (target === 'tab') {
      const rect = fileManagerDockTabAnchorRef.current?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
    }
    const previewRect = getFileManagerDockPreviewRect(target);
    if (!previewRect) return null;
    const containerRect = document.getElementById('session-editor-container')?.getBoundingClientRect();
    const edgeInset = 12;
    if (target === 'left' || target === 'right') {
      const previewWidth = previewRect.right - previewRect.left;
      const top = previewRect.top + edgeInset;
      const bottom = fileManagerPosition === 'bottom' && !fileManagerCollapsed && containerRect ? containerRect.bottom - edgeInset : previewRect.bottom - edgeInset;
      if (target === 'left') {
        const left = previewRect.left + edgeInset; const right = Math.min(previewRect.right - edgeInset, left + Math.min(80, Math.max(46, previewWidth * 0.34)));
        return right > left && bottom > top ? { left, top, right, bottom } : null;
      }
      const right = previewRect.right - edgeInset; const left = Math.max(previewRect.left + edgeInset, right - Math.min(80, Math.max(46, previewWidth * 0.34)));
      return right > left && bottom > top ? { left, top, right, bottom } : null;
    }
    const previewHeight = previewRect.bottom - previewRect.top;
    let left = previewRect.left + edgeInset; let right = previewRect.right - edgeInset;
    if (fileManagerPosition === 'left' && !fileManagerCollapsed && containerRect) left = containerRect.left + edgeInset;
    if (fileManagerPosition === 'right' && !fileManagerCollapsed && containerRect) right = containerRect.right - edgeInset;
    const bottom = previewRect.bottom - edgeInset; const top = Math.max(previewRect.top + edgeInset, bottom - Math.min(80, Math.max(46, previewHeight * 0.38)));
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }, [fileManagerCollapsed, fileManagerPosition, getFileManagerDockPreviewRect]);

  useEffect(() => {
    if (['left', 'right', 'bottom'].includes(fileManagerPosition)) {
      setFileManagerSplitPosition((prev) => prev === fileManagerPosition ? prev : fileManagerPosition);
      localStorage.setItem('fileManagerSplitPosition', fileManagerPosition);
    }
  }, [fileManagerPosition]);

  const handleFileManagerLayoutModeChange = useCallback((mode: string) => {
    if (mode === 'tab') {
      setFileManagerPosition('tab');
      localStorage.setItem('fileManagerPosition', 'tab');
      return;
    }
    const isSplitPos = (value: string): value is FileManagerDockPosition => ['left', 'right', 'bottom'].includes(value);
    const nextSplitPosition = isSplitPos(fileManagerPosition) ? fileManagerPosition : (isSplitPos(fileManagerSplitPosition) ? fileManagerSplitPosition : 'bottom');
    setFileManagerSplitPosition(nextSplitPosition);
    setFileManagerPosition(nextSplitPosition);
    localStorage.setItem('fileManagerSplitPosition', nextSplitPosition);
    localStorage.setItem('fileManagerPosition', nextSplitPosition);
    if (contentTab === 'files') setContentTab('terminal');
  }, [contentTab, fileManagerPosition, fileManagerSplitPosition, setContentTab]);
  const handleFileManagerSplitPositionChange = useCallback((position: string) => {
    if (!['left', 'right', 'bottom'].includes(position)) return;
    const next = position as FileManagerDockPosition;
    setFileManagerSplitPosition(next); setFileManagerPosition(next);
    localStorage.setItem('fileManagerSplitPosition', next); localStorage.setItem('fileManagerPosition', next);
    if (contentTab === 'files') setContentTab('terminal');
  }, [contentTab, setContentTab]);
  const handleFileManagerTabDock = useCallback(() => {
    setFileManagerPosition('tab'); localStorage.setItem('fileManagerPosition', 'tab'); setContentTab('files');
  }, [setContentTab]);

  const shouldIgnoreResizerClick = useCallback(() => Date.now() < resizerClickSuppressUntilRef.current, []);
  const startDrag = useCallback((event: React.MouseEvent<HTMLElement> | MouseEvent, direction: PanelResizeDirection) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = leftSplitWidthRef.current;
    const startHeight = bottomSplitHeightRef.current;
    const startProbeWidth = probePanelWidthRef.current;
    const startAiWidth = aiPanelWidthRef.current;
    const dockTargets: FileManagerDockPosition[] = direction === 'tab'
      ? ['left', 'right', 'bottom']
      : direction === 'left'
        ? ['right', 'bottom', 'tab']
        : direction === 'right'
          ? ['left', 'bottom', 'tab']
          : direction === 'bottom'
            ? ['left', 'right', 'tab']
            : [];
    const isFileManagerDockDrag = dockTargets.length > 0;
    let moved = false;
    const resizer = (event as React.MouseEvent<HTMLElement>).currentTarget ?? event.target;
    (resizer as HTMLElement | null)?.classList?.add('dragging');
    updateCollapseDragIntent(null);
    updateFileManagerDockPreview(isFileManagerDockDrag ? direction : null);
    updateFileManagerDockConfirmTarget(null);
    document.body.style.cursor = direction === 'bottom' ? 'row-resize' : (direction === 'tab' ? 'grabbing' : 'col-resize');
    document.body.style.userSelect = 'none';

    const getSnapshot = (clientX: number, clientY: number): { clampedSize: number; armed: boolean } => {
      if (direction === 'left' || direction === 'right') {
        const rawSize = startWidth + (direction === 'left' ? clientX - startX : startX - clientX);
        return { clampedSize: Math.max(FILE_MANAGER_LEFT_MIN, Math.min(800, rawSize)), armed: rawSize <= FILE_MANAGER_LEFT_MIN - COLLAPSE_ARMED_SIZE };
      }
      if (direction === 'probe') {
        const rawSize = startProbeWidth + (probePanelPosition === 'left' ? clientX - startX : startX - clientX);
        return { clampedSize: clampPanelWidth(rawSize, PROBE_PANEL_MIN), armed: rawSize <= PROBE_PANEL_MIN - COLLAPSE_ARMED_SIZE };
      }
      if (direction === 'ai') {
        const rawSize = startAiWidth + (probePanelPosition === 'left' ? startX - clientX : clientX - startX);
        return { clampedSize: clampPanelWidth(rawSize, AI_PANEL_MIN), armed: rawSize <= AI_PANEL_MIN - COLLAPSE_ARMED_SIZE };
      }
      if (direction === 'bottom') {
        const rawSize = startHeight + (startY - clientY);
        return { clampedSize: Math.max(FILE_MANAGER_BOTTOM_MIN, Math.min(600, rawSize)), armed: rawSize <= FILE_MANAGER_BOTTOM_MIN - COLLAPSE_ARMED_SIZE };
      }
      return { clampedSize: 0, armed: false };
    };
    const getActiveDockTarget = (clientX: number, clientY: number): FileManagerDockPosition | null => {
      if (!isFileManagerDockDrag) return null;
      return dockTargets.find((target) => {
        const rect = getFileManagerDockConfirmRect(target);
        return rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      }) || null;
    };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const activeDockTarget = getActiveDockTarget(moveEvent.clientX, moveEvent.clientY);
      const snapshot = getSnapshot(moveEvent.clientX, moveEvent.clientY);
      if (!moved) moved = Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3;
      updateFileManagerDockPreview(isFileManagerDockDrag ? direction : null);
      updateFileManagerDockConfirmTarget(activeDockTarget);
      if (activeDockTarget) {
        updateCollapseDragIntent(null);
        return;
      }
      if (direction === 'left' || direction === 'right') updateLeftSplitWidth(snapshot.clampedSize);
      else if (direction === 'probe') updateProbePanelWidth(snapshot.clampedSize);
      else if (direction === 'ai') updateAiPanelWidth(snapshot.clampedSize);
      else if (direction === 'bottom') updateBottomSplitHeight(snapshot.clampedSize);
      updateCollapseDragIntent(['left', 'right', 'bottom', 'probe', 'ai'].includes(direction) && snapshot.armed ? direction : null);
    };
    const handleMouseUp = (upEvent: MouseEvent) => {
      try {
        const activeDockTarget = getActiveDockTarget(upEvent.clientX, upEvent.clientY);
        const snapshot = getSnapshot(upEvent.clientX, upEvent.clientY);
        if (moved) resizerClickSuppressUntilRef.current = Date.now() + 160;
        (resizer as HTMLElement | null)?.classList?.remove('dragging');
        updateCollapseDragIntent(null);
        updateFileManagerDockPreview(null);
        updateFileManagerDockConfirmTarget(null);
        if (activeDockTarget) {
          if (direction === 'left' || direction === 'right') { updateLeftSplitWidth(startWidth); localStorage.setItem('leftSplitWidth', String(startWidth)); }
          else if (direction === 'bottom') { updateBottomSplitHeight(startHeight); localStorage.setItem('bottomSplitHeight', String(startHeight)); }
          setFileManagerCollapsedPersistent(false);
          if (activeDockTarget === 'tab') handleFileManagerTabDock();
          else handleFileManagerSplitPositionChange(activeDockTarget);
        } else if (direction === 'left' || direction === 'right') {
          if (snapshot.armed) { updateLeftSplitWidth(startWidth); setFileManagerCollapsedPersistent(true); }
          else localStorage.setItem('leftSplitWidth', String(leftSplitWidthRef.current));
        } else if (direction === 'probe') {
          if (snapshot.armed) { updateProbePanelWidth(startProbeWidth); setProbePanelCollapsedPersistent(true); }
          else localStorage.setItem('probePanelWidth', String(probePanelWidthRef.current));
        } else if (direction === 'ai') {
          if (snapshot.armed) { updateAiPanelWidth(startAiWidth); setAIPanelVisibility(false); }
          else localStorage.setItem('aiPanelWidth', String(aiPanelWidthRef.current));
        } else if (direction === 'bottom') {
          if (snapshot.armed) {
            updateBottomSplitHeight(startHeight);
            if (!showQuickCommandsRef.current) setFileManagerCollapsedPersistent(true);
          } else localStorage.setItem('bottomSplitHeight', String(bottomSplitHeightRef.current));
        }
        window.setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      } finally {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [aiPanelWidthRef, bottomSplitHeightRef, getFileManagerDockConfirmRect, handleFileManagerSplitPositionChange, handleFileManagerTabDock, leftSplitWidthRef, probePanelPosition, probePanelWidthRef, setAIPanelVisibility, setFileManagerCollapsedPersistent, setProbePanelCollapsedPersistent, showQuickCommandsRef, updateAiPanelWidth, updateBottomSplitHeight, updateCollapseDragIntent, updateFileManagerDockConfirmTarget, updateFileManagerDockPreview, updateLeftSplitWidth, updateProbePanelWidth]);

  return { collapseDragIntent, fileManagerCollapsed, fileManagerDockConfirmTarget, fileManagerDockPreview, fileManagerDockTabAnchorRef, fileManagerPosition, getFileManagerDockConfirmRect, getFileManagerDockPreviewRect, handleFileManagerLayoutModeChange, handleFileManagerSplitPositionChange, handleFileManagerTabDock, setFileManagerCollapsedPersistent, shouldIgnoreResizerClick, startDrag };
}
