import { useRef, useEffect, useCallback } from 'react';
import { suppressDragOutClick } from '../../utils/dragOutClickGuard.ts';
import type { RenameInputProps } from './fileManagerTypes.ts';

// 行内重命名输入框。
//
// 设计要点：
//   - 非受控（defaultValue + ref 读值），避免受控渲染竞态丢字符。
//   - suppressDragOutClick 抑制"框内 mousedown 拖出 mouseup"派生的 click，
//     防止冒泡到行级 onClick 抢焦点、触发 onBlur 误提交。
//   - committedRef 保证 onBlur / Enter / 外部取消 三条提交路径只生效一次。
//   - 虚拟化卸载（Virtuoso 把该行滚出视口）时 React 不触发 onBlur，renamingItem
//     会残留——卸载后 cleanup 故意保留已脱离 DOM 的元素引用，
//     由 F2 入口（handleFileListKeyDown）与行级点击路径检测“input 已脱离 DOM”
//     并读取 .value 兜底提交。之所以不用 useEffect cleanup 提交：
//     StrictMode 下会 mount→unmount→remount，cleanup 会在用户什么都没做时就误触发提交。
export default function RenameInput({ initialValue, isDirectory, onConfirm, onCancel, mountedRef }: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  const commit = useCallback((refocus: boolean) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const el = inputRef.current;
    const value = el ? el.value : '';
    onConfirm(value, refocus);
  }, [onConfirm]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (mountedRef) mountedRef.current = el; // 登记：供残留检测路径判断 input 是否还在 DOM
    const name = el.value;
    const extensionIndex = isDirectory ? -1 : name.lastIndexOf('.');
    const selectionEnd = extensionIndex > 0 && extensionIndex < name.length - 1 ? extensionIndex : name.length;
    el.setSelectionRange(0, selectionEnd);
    // 卸载时不清空 mountedRef：保留已脱离 DOM 的元素引用，
    // 让残留清理路径（F2 / 行级点击）能读到 .value 提交用户最后输入；
    // 读取方都必须先做 document.body.contains 判断。绝不在 cleanup 做业务提交。
  }, [isDirectory, mountedRef]);

  return (
    <input
      ref={inputRef}
      id="fm-rename-input"
      name="fm-rename-input"
      className="rename-input"
      autoComplete="off"
      defaultValue={initialValue}
      onMouseDown={(event) => suppressDragOutClick(event.nativeEvent)}
      onBlur={() => commit(false)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') commit(true);
        if (event.key === 'Escape') {
          if (committedRef.current) return;
          committedRef.current = true;
          onCancel();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      autoFocus
    />
  );
}
