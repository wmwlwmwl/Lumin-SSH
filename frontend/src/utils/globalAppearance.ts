export const GLOBAL_APPEARANCE_CHANGED_EVENT = 'global-appearance-changed'

export interface GlobalAppearanceSettings {
  backgroundImage: string
  backgroundOpacity: number
  iconOpacity: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function getGlobalAppearanceSettings(): GlobalAppearanceSettings {
  const parseStored = (key: string, fallback: number) => {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value = Number.parseFloat(raw)
    return Number.isNaN(value) ? fallback : value
  }
  return {
    backgroundImage: localStorage.getItem('globalBgImage') || '',
    backgroundOpacity: clamp(parseStored('globalBgOpacity', 0.12), 0, 0.5),
    iconOpacity: clamp(parseStored('globalIconOpacity', 1), 0.4, 1),
  }
}

const WALLPAYER_LAYER_ID = 'global-wallpaper-layer'

function ensureWallpaperLayer(): HTMLElement {
  let el = document.getElementById(WALLPAYER_LAYER_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = WALLPAYER_LAYER_ID
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }
  return el
}

function removeWallpaperLayer(): void {
  document.getElementById(WALLPAYER_LAYER_ID)?.remove()
}

export function applyGlobalAppearance(settings = getGlobalAppearanceSettings()): void {
  const root = document.documentElement
  if (settings.backgroundImage) localStorage.removeItem('termBgImage')

  root.classList.toggle('has-global-wallpaper', Boolean(settings.backgroundImage))

  if (settings.backgroundImage) {
    const layer = ensureWallpaperLayer()
    layer.style.cssText =
      'position:fixed;inset:0;z-index:10000;pointer-events:none;' +
      `background-image:url("${settings.backgroundImage}");` +
      'background-position:center;background-repeat:no-repeat;background-size:cover;' +
      `opacity:${settings.backgroundOpacity};`
  } else {
    removeWallpaperLayer()
  }

  root.style.setProperty('--app-icon-opacity', String(settings.iconOpacity))
}

export function notifyGlobalAppearanceChanged(): void {
  applyGlobalAppearance()
  window.dispatchEvent(new CustomEvent(GLOBAL_APPEARANCE_CHANGED_EVENT))
}

export function initializeGlobalAppearance(): () => void {
  const refresh = () => applyGlobalAppearance()
  applyGlobalAppearance()
  window.addEventListener(GLOBAL_APPEARANCE_CHANGED_EVENT, refresh)
  return () => window.removeEventListener(GLOBAL_APPEARANCE_CHANGED_EVENT, refresh)
}
