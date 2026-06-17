package main

import (
	"context"
	"embed"
	"os"
	"syscall"
	"time"
	"unsafe"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/windows/icon.ico
var icon []byte

// forceShowWindow 唤醒隐藏到托盘的窗口，带 recover 防止 panic 导致托盘 goroutine 挂死
func forceShowWindow(ctx context.Context) {
	defer func() { recover() }()
	runtime.WindowHide(ctx)
	runtime.WindowShow(ctx)
}

// findAndShowWindow 用 EnumWindows 枚举所有窗口，找到标题为 "Lumin" 的窗口并唤醒
func findAndShowWindow() {
	user32 := syscall.NewLazyDLL("user32.dll")
	procEnumWindows := user32.NewProc("EnumWindows")
	procGetWindowText := user32.NewProc("GetWindowTextW")
	procGetWindowTextLength := user32.NewProc("GetWindowTextLengthW")
	procShowWindow := user32.NewProc("ShowWindow")
	procSetForegroundWindow := user32.NewProc("SetForegroundWindow")

	var targetHwnd syscall.Handle
	callback := syscall.NewCallback(func(hwnd syscall.Handle, lParam uintptr) uintptr {
		textLen, _, _ := procGetWindowTextLength.Call(uintptr(hwnd))
		if textLen == 0 {
			return 1 // continue enumeration
		}
		buf := make([]uint16, textLen+1)
		procGetWindowText.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), uintptr(textLen+1))
		if syscall.UTF16ToString(buf) == "Lumin" {
			targetHwnd = hwnd
			return 0 // stop enumeration
		}
		return 1 // continue enumeration
	})

	procEnumWindows.Call(callback, 0)
	if targetHwnd != 0 {
		const SW_RESTORE = 9
		procShowWindow.Call(uintptr(targetHwnd), SW_RESTORE)
		procSetForegroundWindow.Call(uintptr(targetHwnd))
	}
}

func main() {
	// 创建全局互斥锁，确保程序只能运行一个实例 (单例模式)
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procCreateMutex := kernel32.NewProc("CreateMutexW")
	mutexName, _ := syscall.UTF16PtrFromString("LuminSSH_Global_Single_Instance_Mutex")
	_, _, errMutex := procCreateMutex.Call(0, 1, uintptr(unsafe.Pointer(mutexName)))
	if errMutex == syscall.ERROR_ALREADY_EXISTS {
		findAndShowWindow()
		os.Exit(0)
	}

	// Create an instance of the app structure
	app := NewApp()

	// Setup systray
	onReady := func() {
		systray.SetIcon(icon)
		systray.SetTitle("Lumin")
		systray.SetTooltip("Lumin SSH")

		mShow := systray.AddMenuItem("显示主窗口", "Show Main Window")
		mQuit := systray.AddMenuItem("完全退出", "Quit Lumin")

		// Handle left click on the tray icon to show window
		systray.SetOnClick(func(menu systray.IMenu) {
			if app.ctx != nil {
				forceShowWindow(app.ctx)
			}
		})

		mShow.Click(func() {
			if app.ctx != nil {
				forceShowWindow(app.ctx)
			}
		})

		mQuit.Click(func() {
			systray.Quit()
			os.Exit(0)
		})
	}
	onExit := func() {}

	// Run systray in background
	go systray.Run(onReady, onExit)

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Lumin",
		Width:     1440,
		Height:    900,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 8, G: 12, B: 20, A: 255}, // #080c14
		OnStartup:        app.startup,
		// 拦截窗口关闭：弹出对话框让用户选择退出 / 系统托盘 / 取消
		OnBeforeClose: func(ctx context.Context) bool {
			if app.quitting {
				return false // 用户确认退出，放行
			}
			runtime.EventsEmit(ctx, "close-request")
			// 超时兜底：如果前端 5 秒内没有响应（崩溃/JS 异常），强制允许关闭
			go func() {
				time.Sleep(5 * time.Second)
				if !app.quitting {
					app.quitting = true
					runtime.Quit(ctx)
				}
			}()
			return true // 取消关闭，由前端弹窗决定后续操作
		},
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              true,
			WindowIsTranslucent:               true,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               "",
			ZoomFactor:                        1.0,
			Theme:                             windows.Dark,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
