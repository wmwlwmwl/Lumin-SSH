//go:build darwin

package platformruntime

import "github.com/energye/systray"

// PrepareSystray attaches the tray to Wails' AppKit event loop while main is
// still on the macOS main thread. Wails invokes OnStartup from a goroutine.
func PrepareSystray(setup func()) func() {
	start, end := systray.RunWithExternalLoop(func() {
		setup()
	}, func() {})
	start()
	return end
}

// StartSystray is a no-op on macOS: the tray is already started by PrepareSystray.
func StartSystray(setup func()) {}
