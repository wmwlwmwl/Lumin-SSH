import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function Tiptop({
  text,
  children,
  placement = 'top',
  className = '',
  style,
  triggerClassName = '',
  forceVisible = false,
  minTop,
}) {
  const triggerRef = useRef(null)
  const bubbleRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState(null)
  const hasText = text !== null && text !== undefined && text !== ''
  const bubbleVisible = hasText && (visible || forceVisible)

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) {
      setPosition(null)
      return
    }
    const resolvedMinTop = typeof minTop === 'function' ? minTop() : minTop;
    const triggerBottom = rect.bottom + 6;
    setPosition({
      left: rect.left + rect.width / 2,
      top: placement === 'bottom' && Number.isFinite(resolvedMinTop)
        ? Math.max(triggerBottom, resolvedMinTop)
        : placement === 'bottom' ? triggerBottom : rect.top - 6,
    })
  }, [minTop, placement])

  const hide = useCallback(() => {
    setVisible(false)
  }, [])

  const show = useCallback(() => {
    if (!hasText) {
      return
    }
    updatePosition()
    setVisible(true)
  }, [hasText, updatePosition])

  useEffect(() => {
    if (!bubbleVisible) {
      return undefined
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [bubbleVisible, updatePosition])

  // 点击后布局变化、指针移出窗口、或 pointer 已不在触发器上时，仅靠 mouseleave 会漏收
  useEffect(() => {
    if (!visible || forceVisible) {
      return undefined
    }
    const isPointerInsideTrigger = (clientX, clientY) => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) {
        return false
      }
      return (
        clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
      )
    }
    const onPointerDown = (e) => {
      // 点任意处（含自身）先收起，避免 click 后 text 变化导致残留
      if (e.pointerType === 'touch' || e.pointerType === 'pen' || e.pointerType === 'mouse') {
        hide()
      }
    }
    const onPointerMove = (e) => {
      if (!isPointerInsideTrigger(e.clientX, e.clientY)) {
        hide()
      }
    }
    const onWindowBlur = () => hide()
    const onVisibility = () => {
      if (document.hidden) hide()
    }
    // capture：即使子元素 stopPropagation 也能收到
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [visible, forceVisible, hide])

  // 文案切换（如「打开/收起 AI」）时若仍显示，刷新位置；不主动 hide，由 pointer 逻辑收
  useEffect(() => {
    if (visible) {
      updatePosition()
    }
  }, [text, visible, updatePosition])

  // ponytail: 用 bubbleRef 实际宽度 clamp，比字符估算准确；useLayoutEffect 绘制前执行不闪烁。
  useLayoutEffect(() => {
    if (!bubbleVisible || !position || !bubbleRef.current) return
    const bubbleWidth = bubbleRef.current.offsetWidth
    if (bubbleWidth === 0) return
    const margin = 8
    const halfWidth = bubbleWidth / 2
    const clampedX = Math.max(
      halfWidth + margin,
      Math.min(position.left, window.innerWidth - halfWidth - margin),
    )
    if (Math.abs(clampedX - position.left) > 0.5) {
      setPosition((prev) => (prev ? { ...prev, left: clampedX } : prev))
    }
  }, [bubbleVisible, position, text])

  const bubbleClassName = `tiptop-bubble${placement === 'bottom' ? ' tiptop-bubble-bottom' : ''}`
  const wrapperClassName = `tiptop ${className}`.trim()
  const tiptopTriggerClassName = `tiptop-trigger ${triggerClassName}`.trim()

  return (
    <>
      <div
        className={wrapperClassName}
        style={style}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <div ref={triggerRef} className={tiptopTriggerClassName}>
          {children}
        </div>
      </div>
      {bubbleVisible && position && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={bubbleRef}
              className={bubbleClassName}
              style={{
                position: 'fixed',
                left: position.left,
                top: position.top,
                bottom: 'auto',
                transform: placement === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
                opacity: 1,
                visibility: 'visible',
                pointerEvents: 'none',
              }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
