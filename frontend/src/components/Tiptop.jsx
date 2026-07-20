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
    setPosition({
      left: rect.left + rect.width / 2,
      top: placement === 'bottom' ? rect.bottom + 6 : rect.top - 6,
    })
  }, [placement])

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

  const show = useCallback(() => {
    if (!hasText) {
      return
    }
    updatePosition()
    setVisible(true)
  }, [hasText, updatePosition])

  const hide = useCallback(() => {
    setVisible(false)
  }, [])

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
