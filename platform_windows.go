//go:build windows

package main

import (
	_ "embed"
	"os"
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed build/windows/icon.ico
var icon []byte

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
			return 1
		}
		buf := make([]uint16, textLen+1)
		procGetWindowText.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), uintptr(textLen+1))
		if syscall.UTF16ToString(buf) == "Lumin" {
			targetHwnd = hwnd
			return 0
		}
		return 1
	})

	procEnumWindows.Call(callback, 0)
	if targetHwnd != 0 {
		const SW_RESTORE = 9
		procShowWindow.Call(uintptr(targetHwnd), SW_RESTORE)
		procSetForegroundWindow.Call(uintptr(targetHwnd))
	}
}

// ensureSingleInstance 检查是否已有实例运行，如果是则唤醒已有窗口并退出
func ensureSingleInstance() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procCreateMutex := kernel32.NewProc("CreateMutexW")
	mutexName, _ := syscall.UTF16PtrFromString("LuminSSH_Global_Single_Instance_Mutex")
	_, _, errMutex := procCreateMutex.Call(0, 1, uintptr(unsafe.Pointer(mutexName)))
	if errMutex == syscall.ERROR_ALREADY_EXISTS {
		findAndShowWindow()
		os.Exit(0)
	}
}

// getScreenSize 用 Windows API 获取主显示器可用逻辑像素（已扣除 DPI 缩放）
func getScreenSize() (int, int) {
	user32 := syscall.NewLazyDLL("user32.dll")
	// 获取系统 DPI（Per-Monitor DPI Aware 下 GetSystemMetrics 返回物理像素，需除以缩放比）
	getDpi := user32.NewProc("GetDpiForSystem")
	dpi, _, _ := getDpi.Call()
	if dpi == 0 {
		dpi = 96
	}
	scale := float64(dpi) / 96.0

	smCx := user32.NewProc("GetSystemMetrics")
	const SM_CXSCREEN = 0
	const SM_CYSCREEN = 1
	cx, _, _ := smCx.Call(SM_CXSCREEN)
	cy, _, _ := smCx.Call(SM_CYSCREEN)
	return int(float64(cx) / scale), int(float64(cy) / scale)
}

// applyPlatformOptions 设置 Windows 特定的 Wails 选项，并根据屏幕大小自适应窗口尺寸
func applyPlatformOptions(opts *options.App, configManager *ConfigManager) {
	// ponytail: 根据屏幕分辨率自适应窗口大小，上限 1440x900，留 10% 边距
	sw, sh := getScreenSize()
	targetW := int(float64(sw) * 0.9)
	targetH := int(float64(sh) * 0.9)
	if opts.Width > targetW {
		opts.Width = targetW
	}
	if opts.Height > targetH {
		opts.Height = targetH
	}

	webviewGpuDisabled := false
	if configManager != nil {
		webviewGpuDisabled = configManager.GetWebviewGpuDisabled()
	}

	opts.Windows = &windows.Options{
		WebviewIsTransparent:              true,
		WindowIsTranslucent:               true,
		DisableWindowIcon:                 false,
		DisableFramelessWindowDecorations: false,
		WebviewUserDataPath:               "",
		ZoomFactor:                        1.0,
		WebviewGpuIsDisabled:              webviewGpuDisabled,
		Theme:                             windows.Dark,
	}
}
