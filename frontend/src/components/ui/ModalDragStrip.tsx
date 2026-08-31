import type { MouseEvent } from 'react';
import { toggleWindowMaximise } from '../../hooks/useWindowState.ts';

// 模态遮罩会盖住顶栏，Wails 的拖动判定取 mousedown 目标元素（即遮罩）的
// 计算样式，导致遮罩打开时窗口无法从顶栏拖动；这条透明热区把拖动能力
// 还给顶栏同高区域。必须是真实 DOM 元素——伪元素不会成为事件 target。
// 双击行为与顶栏一致（切换最大化），保持遮罩打开前后手感相同。
const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
  try { window.getSelection?.()?.removeAllRanges?.(); } catch { }
  event.preventDefault();
  void toggleWindowMaximise();
};

export function ModalDragStrip() {
  return <div className="modal-drag-strip" aria-hidden="true" onDoubleClick={handleDoubleClick} />;
}
