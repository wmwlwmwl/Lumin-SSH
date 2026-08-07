//go:build linux || windows

package platformruntime

import "github.com/energye/systray"

// PrepareSystray returns a cleanup function. The standalone systray event loop
// is started later by StartSystray.
func PrepareSystray(setup func()) func() {
	return func() {
		systray.Quit()
	}
}

// StartSystray runs the standalone systray event loop in a goroutine.
func StartSystray(setup func()) {
	go systray.Run(func() {
		setup()
	}, func() {})
}
