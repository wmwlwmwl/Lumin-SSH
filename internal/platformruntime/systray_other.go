//go:build linux || windows

package platformruntime

import (
	"log"
	"runtime"

	"github.com/energye/systray"
)

// PrepareSystray returns a cleanup function. The standalone systray event loop
// is started later by StartSystray.
func PrepareSystray(setup func()) func() {
	return func() {
		log.Println("[Systray] systray.Quit called from PrepareSystray cleanup")
		systray.Quit()
	}
}

// StartSystray runs the standalone systray event loop in a goroutine.
func StartSystray(setup func()) {
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		log.Println("[Systray] Starting systray event loop on dedicated locked OS thread")
		systray.Run(func() {
			log.Println("[Systray] systray onReady triggered, invoking setup")
			setup()
		}, func() {
			log.Println("[Systray] systray onExit triggered")
		})
	}()
}
