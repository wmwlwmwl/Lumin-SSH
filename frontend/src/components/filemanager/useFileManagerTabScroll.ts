import { useEffect, useCallback } from 'react';
import type { useFileManagerCore } from './useFileManagerCore.ts';

// 标签栏横向滚动：溢出检测、惯性滚动动画与滚轮/滚动事件处理
export function useFileManagerTabScroll(deps: ReturnType<typeof useFileManagerCore>) {
  const {
    fileManagerWorkspace,
    fileManagerTabScrollRef, fileManagerTabScrollTargetRef, fileManagerTabScrollFrameRef,
    setFileManagerTabOverflow, setFileManagerTabCanScrollLeft, setFileManagerTabCanScrollRight,
    fileManagerTabOverflow, fileManagerTabCanScrollLeft, fileManagerTabCanScrollRight,
  } = deps;
  const syncFileManagerTabOverflowState = useCallback(() => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      setFileManagerTabOverflow(false);
      setFileManagerTabCanScrollLeft(false);
      setFileManagerTabCanScrollRight(false);
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const currentLeft = el.scrollLeft;
    const hasOverflow = maxLeft > 1;
    setFileManagerTabOverflow(hasOverflow);
    setFileManagerTabCanScrollLeft(hasOverflow && currentLeft > 1);
    setFileManagerTabCanScrollRight(hasOverflow && currentLeft < maxLeft - 1);
    if (!hasOverflow) {
      fileManagerTabScrollTargetRef.current = 0;
    }
  }, []);
  const stopFileManagerTabScrollAnimation = useCallback(() => {
    if (!fileManagerTabScrollFrameRef.current) {
      return;
    }
    cancelAnimationFrame(fileManagerTabScrollFrameRef.current);
    fileManagerTabScrollFrameRef.current = 0;
  }, []);
  const stepFileManagerTabScroll = useCallback(() => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      fileManagerTabScrollFrameRef.current = 0;
      return;
    }
    const currentLeft = el.scrollLeft;
    const targetLeft = fileManagerTabScrollTargetRef.current;
    const deltaLeft = targetLeft - currentLeft;
    if (Math.abs(deltaLeft) < 0.5) {
      el.scrollLeft = targetLeft;
      fileManagerTabScrollFrameRef.current = 0;
      syncFileManagerTabOverflowState();
      return;
    }
    const nextStep = Math.abs(deltaLeft) < 10
      ? Math.sign(deltaLeft) * Math.max(0.8, Math.abs(deltaLeft) * 0.45)
      : deltaLeft * 0.18;
    el.scrollLeft = currentLeft + nextStep;
    fileManagerTabScrollFrameRef.current = requestAnimationFrame(stepFileManagerTabScroll);
  }, [syncFileManagerTabOverflowState]);
  const setFileManagerTabScrollTarget = useCallback((nextLeft: number) => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const clampedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    fileManagerTabScrollTargetRef.current = clampedLeft;
    if (!fileManagerTabScrollFrameRef.current) {
      fileManagerTabScrollFrameRef.current = requestAnimationFrame(stepFileManagerTabScroll);
    }
  }, [stepFileManagerTabScroll]);
  const scrollFileManagerTabs = useCallback((direction: number) => {
    const el = fileManagerTabScrollRef.current;
    if (!el) {
      return;
    }
    const step = Math.max(96, Math.round(el.clientWidth * 0.45));
    const baseLeft = fileManagerTabScrollFrameRef.current ? fileManagerTabScrollTargetRef.current : el.scrollLeft;
    setFileManagerTabScrollTarget(baseLeft + step * direction);
  }, [setFileManagerTabScrollTarget]);
  const handleFileManagerTabScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!fileManagerTabScrollFrameRef.current) {
      fileManagerTabScrollTargetRef.current = event.currentTarget.scrollLeft;
    }
    syncFileManagerTabOverflowState();
  }, [syncFileManagerTabOverflowState]);
  const handleFileManagerTabWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const el = fileManagerTabScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const baseLeft = fileManagerTabScrollFrameRef.current ? fileManagerTabScrollTargetRef.current : el.scrollLeft;
    setFileManagerTabScrollTarget(baseLeft + delta);
    event.preventDefault();
  }, [setFileManagerTabScrollTarget]);
  useEffect(() => () => stopFileManagerTabScrollAnimation(), [stopFileManagerTabScrollAnimation]);
  useEffect(() => {
    const el = fileManagerTabScrollRef.current;
    if (!el) return undefined;
    const handleResize = () => syncFileManagerTabOverflowState();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(handleResize) : null;
    observer?.observe(el);
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [syncFileManagerTabOverflowState]);
  useEffect(() => {
    const frame = requestAnimationFrame(syncFileManagerTabOverflowState);
    return () => cancelAnimationFrame(frame);
  }, [fileManagerWorkspace, syncFileManagerTabOverflowState]);
  return {
    fileManagerTabScrollRef,
    fileManagerTabOverflow,
    fileManagerTabCanScrollLeft,
    fileManagerTabCanScrollRight,
    syncFileManagerTabOverflowState,
    stopFileManagerTabScrollAnimation,
    stepFileManagerTabScroll,
    setFileManagerTabScrollTarget,
    scrollFileManagerTabs,
    handleFileManagerTabScroll,
    handleFileManagerTabWheel,
  };
}
