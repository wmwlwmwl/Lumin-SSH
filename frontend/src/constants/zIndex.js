// Z-index scale — centralized management
// All magic numbers should be defined here for consistency.
// Order: lowest (back) → highest (front)

export const Z = {
  // ── Component-internal layering ──
  BG: 0,
  CONTENT: 1,
  STACK: 2,
  SCROLLBAR: 5,
  PANEL_BUTTON: 10,

  // ── Local overlays (loading states, etc.) ──
  COMPONENT_OVERLAY: 50,

  // ── Popup panels ──
  POPUP_BACKDROP: 99,
  POPUP: 100,

  // ── Nested context menus ──
  MENU_BACKDROP: 199,
  MENU: 200,

  // ── Nested dialogs (QuickCommands confirm, group picker) ──
  DIALOG_BACKDROP: 299,
  DIALOG: 300,
  SUBMENU_BACKDROP: 301,
  SUBMENU: 302,

  // ── Editor toolbars ──
  EDITOR_TOOLBAR: 998,

  // ── System panels (tray, fullscreen overlays) ──
  TRAY_PANEL: 8000,
  FULLSCREEN_OVERLAY: 9000,

  // ── Global modals / context menus ──
  MODAL: 9999,

  // ── Absolute top ──
  SEARCH_PANEL: 10000,
  FLOATING_EDITOR: 10001,
  FLOATING_EDITOR_MENU: 10002,
};
