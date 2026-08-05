/**
 * 抑制"输入框内 mousedown、拖出边界 mouseup"派生的那一次 click。
 *
 * 背景：当文本输入框（如行内重命名）位于可点击的行内时，用户在框内按下鼠标
 * 并拖出行边界再松开，浏览器会向 mouseup 时所在的可点击祖先派发一次 click。
 * 该 click 通常会抢占焦点 / 改变选中状态，导致输入框意外失焦并误提交，
 * 用户的拖拽选区也随之丢失。
 *
 * 思路：mousedown 时在 document 上挂一个 capture 阶段的一次性 click 监听，
 * 吞掉紧接着的那次 click（stopPropagation + preventDefault），随后立即卸载。
 *
 * 为什么 capture 阶段：React 17+ 把合成事件挂在 root container 上监听，
 * capture 阶段的 document 监听先于它执行，因此能阻止 React 的 onClick 触发。
 *
 * 时序要点（关键）：浏览器在 mouseup 之后会同步派发 click，二者在同一事件循环。
 * 因此 mouseup 兜底不能同步移除 click 监听——否则本次 click 漏网，click 照样
 * 冒泡抢焦点。必须用 setTimeout(0) 延迟到下一宏任务清理：既保证同次 mouseup
 * 派生的 click 被吞掉，又能在"无 click 产生"（指针离窗 / 原生拖拽）时兜底卸载，
 * 不残留监听误吞下一次合法点击。
 *
 * 仅响应主键（button === 0），右键 mousedown 不置位，避免干扰原生右键菜单。
 *
 * @param {MouseEvent} event - input 的 mousedown 事件
 */
export function suppressDragOutClick(event) {
  if (event.button !== 0) return;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    document.removeEventListener('click', swallow, true);
    document.removeEventListener('mousedown', handleLaterMousedown, true);
  };
  const swallow = (clickEvent) => {
    clickEvent.stopPropagation();
    clickEvent.preventDefault();
    finish();
  };
  // 孤儿兜底：拖出应用窗口松开时 window 收不到 mouseup，监听会残留。
  // 出现新的 mousedown 说明原拖拽已结束且未派生 click，立即卸载，
  // 避免残留监听吞掉下一次合法点击（“点一下没反应”）。
  // 派生 click（mouseup→click 同任务）之前不会有新 mousedown，故不影响正常吞 click 路径。
  const handleLaterMousedown = (e) => {
    if (e === event) return;
    finish();
  };

  // 正常拖拽：mouseup 后同步派发 click → swallow 吞掉并 finish。
  document.addEventListener('click', swallow, true);
  document.addEventListener('mousedown', handleLaterMousedown, true);
  // 兜底：延迟到下一宏任务清理。若产生了 click，swallow 已先行 finish，此处为 no-op；
  // 若未产生 click（指针离窗等），此处负责回收监听，避免残留。
  window.addEventListener('mouseup', () => setTimeout(finish, 0), { once: true });
}
