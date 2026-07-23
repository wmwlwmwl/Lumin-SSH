// Text input types whose selection can be programmatically changed via select().
// number/email/etc. throw InvalidStateError on select()/setSelectionRange().
const SELECTABLE_INPUT_TYPES = ['text', 'search', 'url', 'tel', 'password']

/**
 * onMouseLeave handler for text inputs: while the primary button is held down
 * (i.e. the user is drag-selecting), select the whole input content. This keeps
 * drag selection working when the cursor leaves the input/sidebar boundary.
 *
 * Safe to bind on any input: non-drag leaves and non-text inputs are no-ops.
 */
export function handleInputDragSelectAll(event) {
  if (event.buttons !== 1) {
    return
  }
  const input = event.currentTarget
  if (!input || typeof input.select !== 'function') {
    return
  }
  // Guard against types that cannot be selected (e.g. number/email).
  if (input.type && !SELECTABLE_INPUT_TYPES.includes(String(input.type).toLowerCase())) {
    return
  }
  const originalPointerEvents = input.style.pointerEvents
  let restored = false
  const restorePointerEvents = () => {
    if (restored) {
      return
    }
    restored = true
    try {
      input.style.pointerEvents = originalPointerEvents
    } catch {
      // input may have been unmounted; nothing to restore.
    }
    window.removeEventListener('mouseup', restorePointerEvents)
    window.removeEventListener('blur', restorePointerEvents)
  }
  try {
    input.select()
    input.style.pointerEvents = 'none'
    window.addEventListener('mouseup', restorePointerEvents)
    window.addEventListener('blur', restorePointerEvents)
  } catch {
    // select() may throw on some input types despite the guard; restore on
    // failure so we never leave pointerEvents half-applied.
    restorePointerEvents()
  }
}
