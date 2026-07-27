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

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	shell32                      = syscall.NewLazyDLL("shell32.dll")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowTextW           = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW     = user32.NewProc("GetWindowTextLengthW")
	procGetClassNameW            = user32.NewProc("GetClassNameW")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procGetWindow                = user32.NewProc("GetWindow")
	procIsIconic                 = user32.NewProc("IsIconic")
	procShowWindow               = user32.NewProc("ShowWindow")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procBringWindowToTop         = user32.NewProc("BringWindowToTop")
	procSetFocus                 = user32.NewProc("SetFocus")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procAttachThreadInput        = user32.NewProc("AttachThreadInput")
	procGetCurrentThreadId       = kernel32.NewProc("GetCurrentThreadId")
	procGetCurrentProcessId      = kernel32.NewProc("GetCurrentProcessId")
	procShellNotifyIconW         = shell32.NewProc("Shell_NotifyIconW")
)

const (
	swShow          = 5
	swRestore       = 9
	gwOwner         = 4
	hwndTopmost     = ^uintptr(0) // -1
	hwndNotopmost   = ^uintptr(1) // -2
	swpNosize       = 0x0001
	swpNomove       = 0x0002
	swpShowWindow   = 0x0040
	nimDelete       = 0x00000002
	// energye/systray 固定 uID=100；NIM_DELETE 靠 hWnd+uID 定位图标
	systrayIconID   = 100
	mainWindowTitle = "Lumin"
	wailsFormClass  = "winc_Form"
	systrayClass    = "SystrayClass"
)

// trayNotifyIconData 对齐官方 NOTIFYICONDATA（uTimeout/uVersion 为 union，占 4 字节）。
// 仅用于退出时同步 NIM_DELETE；定位图标只靠 hWnd + uID。
type trayNotifyIconData struct {
	Size            uint32
	Wnd             uintptr
	ID              uint32
	Flags           uint32
	CallbackMessage uint32
	Icon            uintptr
	Tip             [128]uint16
	State           uint32
	StateMask       uint32
	Info            [256]uint16
	Timeout         uint32
	InfoTitle       [64]uint16
	InfoFlags       uint32
	GuidItem        [16]byte
	BalloonIcon     uintptr
}

// findSystrayHWND 找本进程 energye 托盘隐藏窗（class=SystrayClass）
func findSystrayHWND(matchPID uint32) syscall.Handle {
	var found syscall.Handle
	callback := syscall.NewCallback(func(hwnd syscall.Handle, lParam uintptr) uintptr {
		if windowClass(hwnd) != systrayClass {
			return 1
		}
		if matchPID != 0 {
			var pid uint32
			procGetWindowThreadProcessId.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&pid)))
			if pid != matchPID {
				return 1
			}
		}
		found = hwnd
		return 0
	})
	procEnumWindows.Call(callback, 0)
	return found
}

// removeTrayIconSync 退出前同步删托盘图标。
// energye 的 systray.Quit 只 PostMessage(WM_CLOSE)，NIM_DELETE 异步；
// 进程若先退出，Shell 会留下幽灵图标，鼠标扫过托盘才消失。
func removeTrayIconSync() {
	pid, _, _ := procGetCurrentProcessId.Call()
	hwnd := findSystrayHWND(uint32(pid))
	if hwnd == 0 {
		return
	}
	nid := trayNotifyIconData{
		Wnd: uintptr(hwnd),
		ID:  systrayIconID,
	}
	nid.Size = uint32(unsafe.Sizeof(nid))
	_, _, _ = procShellNotifyIconW.Call(uintptr(nimDelete), uintptr(unsafe.Pointer(&nid)))
}

func windowText(hwnd syscall.Handle) string {
	textLen, _, _ := procGetWindowTextLengthW.Call(uintptr(hwnd))
	if textLen == 0 {
		return ""
	}
	buf := make([]uint16, textLen+1)
	procGetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), uintptr(textLen+1))
	return syscall.UTF16ToString(buf)
}

func windowClass(hwnd syscall.Handle) string {
	buf := make([]uint16, 256)
	n, _, _ := procGetClassNameW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:n])
}

func isTopLevelWindow(hwnd syscall.Handle) bool {
	owner, _, _ := procGetWindow.Call(uintptr(hwnd), uintptr(gwOwner))
	return owner == 0
}

// activateHWND 用 SW_RESTORE + 短暂 TOPMOST + AttachThreadInput 抢前台。
// 纯 SetForegroundWindow 在托盘久置后常被 Windows 前台限制静默拒绝。
func activateHWND(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}
	iconic, _, _ := procIsIconic.Call(uintptr(hwnd))
	if iconic != 0 {
		procShowWindow.Call(uintptr(hwnd), uintptr(swRestore))
	} else {
		// 隐藏到托盘时窗口是 SW_HIDE，不是最小化；RESTORE/SHOW 都能拉回
		procShowWindow.Call(uintptr(hwnd), uintptr(swRestore))
		procShowWindow.Call(uintptr(hwnd), uintptr(swShow))
	}

	flags := uintptr(swpNomove | swpNosize | swpShowWindow)
	procSetWindowPos.Call(uintptr(hwnd), hwndTopmost, 0, 0, 0, 0, flags)
	procSetWindowPos.Call(uintptr(hwnd), hwndNotopmost, 0, 0, 0, 0, flags)

	fg, _, _ := procGetForegroundWindow.Call()
	curThread, _, _ := procGetCurrentThreadId.Call()
	var fgPid uint32
	fgThread, _, _ := procGetWindowThreadProcessId.Call(fg, uintptr(unsafe.Pointer(&fgPid)))
	var targetPid uint32
	targetThread, _, _ := procGetWindowThreadProcessId.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&targetPid)))

	attachedFG := false
	attachedTarget := false
	if fgThread != 0 && fgThread != curThread {
		r, _, _ := procAttachThreadInput.Call(curThread, fgThread, 1)
		attachedFG = r != 0
	}
	if targetThread != 0 && targetThread != curThread && targetThread != fgThread {
		r, _, _ := procAttachThreadInput.Call(curThread, targetThread, 1)
		attachedTarget = r != 0
	}

	procBringWindowToTop.Call(uintptr(hwnd))
	procSetForegroundWindow.Call(uintptr(hwnd))
	procSetFocus.Call(uintptr(hwnd))

	if attachedTarget {
		procAttachThreadInput.Call(curThread, targetThread, 0)
	}
	if attachedFG {
		procAttachThreadInput.Call(curThread, fgThread, 0)
	}
}

// findMainWindowHWND 枚举顶层窗找 Lumin 主窗。
// matchPID!=0：限本进程，优先 winc_Form，再标题 "Lumin"。
// matchPID==0：跨进程二次启动用，只认标题 "Lumin"（避免误激活其他 Wails 应用）。
func findMainWindowHWND(matchPID uint32) syscall.Handle {
	var (
		byClass syscall.Handle
		byTitle syscall.Handle
	)
	callback := syscall.NewCallback(func(hwnd syscall.Handle, lParam uintptr) uintptr {
		if !isTopLevelWindow(hwnd) {
			return 1
		}
		class := windowClass(hwnd)
		if class == systrayClass {
			return 1
		}
		if matchPID != 0 {
			var pid uint32
			procGetWindowThreadProcessId.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&pid)))
			if pid != matchPID {
				return 1
			}
		}
		title := windowText(hwnd)
		if title == mainWindowTitle && byTitle == 0 {
			byTitle = hwnd
			// 跨进程场景只靠标题即可结束
			if matchPID == 0 {
				return 0
			}
		}
		if matchPID != 0 && class == wailsFormClass && byClass == 0 {
			byClass = hwnd
			// 本进程找到主窗类即可
			if byTitle != 0 {
				return 0
			}
		}
		return 1
	})
	procEnumWindows.Call(callback, 0)
	// 本进程优先类名（隐藏后标题偶发读不到时仍可命中）
	if matchPID != 0 && byClass != 0 {
		return byClass
	}
	return byTitle
}

// findAndShowWindow 二次启动时唤醒已有实例窗口（按标题，跨进程）
func findAndShowWindow() {
	if hwnd := findMainWindowHWND(0); hwnd != 0 {
		activateHWND(hwnd)
	}
}

// platformForceShowWindow 托盘点击/菜单唤醒：按本进程主窗激活
func platformForceShowWindow() {
	pid, _, _ := procGetCurrentProcessId.Call()
	if hwnd := findMainWindowHWND(uint32(pid)); hwnd != 0 {
		activateHWND(hwnd)
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

func acquireMainLivenessLock(path string) (func(), error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := file.Truncate(0); err == nil {
		_, _ = file.Write([]byte("1"))
		_, _ = file.Seek(0, 0)
	}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procLockFileEx := kernel32.NewProc("LockFileEx")
	procUnlockFileEx := kernel32.NewProc("UnlockFileEx")
	const lockfileExclusiveLock = 0x00000002
	var overlapped syscall.Overlapped
	locked, _, lockErr := procLockFileEx.Call(
		file.Fd(),
		uintptr(lockfileExclusiveLock),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if locked == 0 {
		_ = file.Close()
		if lockErr != syscall.Errno(0) {
			return nil, lockErr
		}
		return nil, syscall.EINVAL
	}
	return func() {
		_, _, _ = procUnlockFileEx.Call(
			file.Fd(),
			0,
			1,
			0,
			uintptr(unsafe.Pointer(&overlapped)),
		)
		_ = file.Close()
	}, nil
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
