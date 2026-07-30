//go:build windows

package main

import (
	_ "embed"
	"os"
	"path/filepath"
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
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procShowWindow               = user32.NewProc("ShowWindow")
	procShowWindowAsync          = user32.NewProc("ShowWindowAsync")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procBringWindowToTop         = user32.NewProc("BringWindowToTop")
	procSetFocus                 = user32.NewProc("SetFocus")
	procSetActiveWindow          = user32.NewProc("SetActiveWindow")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procAttachThreadInput        = user32.NewProc("AttachThreadInput")
	procAllowSetForegroundWindow = user32.NewProc("AllowSetForegroundWindow")
	procLockSetForegroundWindow  = user32.NewProc("LockSetForegroundWindow")
	procRedrawWindow             = user32.NewProc("RedrawWindow")
	procUpdateWindow             = user32.NewProc("UpdateWindow")
	procGetCurrentThreadId       = kernel32.NewProc("GetCurrentThreadId")
	procGetCurrentProcessId      = kernel32.NewProc("GetCurrentProcessId")
	procShellNotifyIconW         = shell32.NewProc("Shell_NotifyIconW")
)

const (
	swHide          = 0
	swShowNormal    = 1
	swShow          = 5
	swMinimize      = 6
	swRestore       = 9
	swShowDefault   = 10
	gwOwner         = 4
	hwndTopmost     = ^uintptr(0) // -1
	hwndNotopmost   = ^uintptr(1) // -2
	swpNosize       = 0x0001
	swpNomove       = 0x0002
	swpNozorder     = 0x0004
	swpNoactivate   = 0x0010
	swpShowWindow   = 0x0040
	swpFramechanged = 0x0020
	// RedrawWindow
	rdwInvalidate = 0x0001
	rdwErase      = 0x0004
	rdwFrame      = 0x0400
	rdwAllChildren = 0x0080
	rdwUpdatenow  = 0x0100
	// LockSetForegroundWindow
	lsfwUnlock = 2
	// AllowSetForegroundWindow(-1) = ASFW_ANY
	asfwAny = ^uint32(0)
	nimDelete = 0x00000002
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

// activateHWND 久置后强拉主窗到前台。
// Windows 最小化/托盘隐藏久了，纯 SetForegroundWindow 常被拒；
// 再叠加透明 WebView，可能出现「任务栏有项但点了空白/无响应」。
func activateHWND(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}

	// 放宽前台锁，降低久置后 SetForeground 被拒概率
	_, _, _ = procLockSetForegroundWindow.Call(uintptr(lsfwUnlock))
	_, _, _ = procAllowSetForegroundWindow.Call(uintptr(asfwAny))

	iconic, _, _ := procIsIconic.Call(uintptr(hwnd))
	visible, _, _ := procIsWindowVisible.Call(uintptr(hwnd))
	if iconic != 0 {
		// 任务栏最小化：先异步再同步 restore，覆盖部分 WebView 卡住场景
		procShowWindowAsync.Call(uintptr(hwnd), uintptr(swRestore))
		procShowWindow.Call(uintptr(hwnd), uintptr(swRestore))
	} else if visible == 0 {
		// 托盘 SW_HIDE：restore + show
		procShowWindowAsync.Call(uintptr(hwnd), uintptr(swRestore))
		procShowWindow.Call(uintptr(hwnd), uintptr(swRestore))
		procShowWindow.Call(uintptr(hwnd), uintptr(swShow))
		procShowWindow.Call(uintptr(hwnd), uintptr(swShowNormal))
	} else {
		// 已显示但无前台/内容空白：仍走 restore/show 刷新
		procShowWindow.Call(uintptr(hwnd), uintptr(swRestore))
		procShowWindow.Call(uintptr(hwnd), uintptr(swShow))
	}

	flags := uintptr(swpNomove | swpNosize | swpShowWindow | swpFramechanged)
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
	procSetActiveWindow.Call(uintptr(hwnd))
	procSetFocus.Call(uintptr(hwnd))
	// 强制重绘，缓解透明 WebView 久置后「窗在但内容不刷」
	rdwFlags := uintptr(rdwInvalidate | rdwErase | rdwFrame | rdwAllChildren | rdwUpdatenow)
	procRedrawWindow.Call(uintptr(hwnd), 0, 0, rdwFlags)
	procUpdateWindow.Call(uintptr(hwnd))

	if attachedTarget {
		procAttachThreadInput.Call(curThread, targetThread, 0)
	}
	if attachedFG {
		procAttachThreadInput.Call(curThread, fgThread, 0)
	}
}

// findMainWindowCandidates 枚举本进程/跨进程可能的 Lumin 主窗。
// 久置+多次点击时任务栏可能出现多个条目，唤醒时优先可见/未最小化的 winc_Form。
func findMainWindowCandidates(matchPID uint32) []syscall.Handle {
	found := make([]syscall.Handle, 0, 4)
	seen := map[syscall.Handle]struct{}{}
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
		hit := false
		if matchPID != 0 && class == wailsFormClass {
			hit = true
		}
		if title == mainWindowTitle {
			hit = true
		}
		// 跨进程二次启动：只认标题，避免误激活其他 Wails 应用
		if matchPID == 0 {
			hit = title == mainWindowTitle
		}
		if !hit {
			return 1
		}
		if _, ok := seen[hwnd]; ok {
			return 1
		}
		seen[hwnd] = struct{}{}
		found = append(found, hwnd)
		return 1
	})
	procEnumWindows.Call(callback, 0)
	return found
}

// pickBestMainWindow 多窗口时选最该激活的那个：可见且非最小化 > 仅最小化 > 其它。
func pickBestMainWindow(windows []syscall.Handle) syscall.Handle {
	if len(windows) == 0 {
		return 0
	}
	var bestVisible, bestIconic, bestAny syscall.Handle
	for _, hwnd := range windows {
		if hwnd == 0 {
			continue
		}
		if bestAny == 0 {
			bestAny = hwnd
		}
		iconic, _, _ := procIsIconic.Call(uintptr(hwnd))
		visible, _, _ := procIsWindowVisible.Call(uintptr(hwnd))
		if visible != 0 && iconic == 0 && bestVisible == 0 {
			bestVisible = hwnd
		}
		if iconic != 0 && bestIconic == 0 {
			bestIconic = hwnd
		}
	}
	if bestVisible != 0 {
		return bestVisible
	}
	if bestIconic != 0 {
		return bestIconic
	}
	return bestAny
}

// findMainWindowHWND 枚举顶层窗找 Lumin 主窗。
// matchPID!=0：限本进程；matchPID==0：跨进程二次启动，只认标题。
func findMainWindowHWND(matchPID uint32) syscall.Handle {
	return pickBestMainWindow(findMainWindowCandidates(matchPID))
}

// findAndShowWindow 二次启动时唤醒已有实例窗口（按标题，跨进程）
func findAndShowWindow() {
	cands := findMainWindowCandidates(0)
	if hwnd := pickBestMainWindow(cands); hwnd != 0 {
		activateHWND(hwnd)
	}
}

// platformPrepareTrayMenu 托盘右键菜单弹出前调用。
// energye ShowMenu 内部会对托盘隐藏窗 SetForegroundWindow 再 TrackPopupMenu；
// 久置后前台被拒时菜单直接不显示。这里先解锁前台并激活托盘窗。
func platformPrepareTrayMenu() {
	_, _, _ = procLockSetForegroundWindow.Call(uintptr(lsfwUnlock))
	_, _, _ = procAllowSetForegroundWindow.Call(uintptr(asfwAny))
	pid, _, _ := procGetCurrentProcessId.Call()
	hwnd := findSystrayHWND(uint32(pid))
	if hwnd == 0 {
		return
	}
	procSetForegroundWindow.Call(uintptr(hwnd))
	procBringWindowToTop.Call(uintptr(hwnd))
}

// platformForceShowWindow 托盘/任务栏久置后唤醒：激活本进程主窗，并尽量恢复其它最小化副本。
func platformForceShowWindow() {
	pid, _, _ := procGetCurrentProcessId.Call()
	cands := findMainWindowCandidates(uint32(pid))
	if len(cands) == 0 {
		return
	}
	best := pickBestMainWindow(cands)
	activateHWND(best)
	// 多次点击可能留下多个最小化条目：一并 restore，减少「点了没反应/点到空白副本」
	for _, hwnd := range cands {
		if hwnd == 0 || hwnd == best {
			continue
		}
		iconic, _, _ := procIsIconic.Call(uintptr(hwnd))
		visible, _, _ := procIsWindowVisible.Call(uintptr(hwnd))
		if iconic != 0 || visible == 0 {
			procShowWindowAsync.Call(uintptr(hwnd), uintptr(swRestore))
			procShowWindow.Call(uintptr(hwnd), uintptr(swRestore))
		}
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

	// 固定 WebView2 用户数据根目录为 %AppData%\Lumin，避免便携包改名后按 exe 名多出
	// Lumin-x.y.z-portable.exe/EBWebView。引擎会在其下自建 EBWebView，与 config 同级。
	webviewUserDataPath := ""
	if appData, err := os.UserConfigDir(); err == nil {
		webviewUserDataPath = filepath.Join(appData, "Lumin")
		_ = os.MkdirAll(webviewUserDataPath, 0700)
	}

	opts.Windows = &windows.Options{
		WebviewIsTransparent:              true,
		WindowIsTranslucent:               true,
		DisableWindowIcon:                 false,
		DisableFramelessWindowDecorations: false,
		WebviewUserDataPath:               webviewUserDataPath,
		ZoomFactor:                        1.0,
		WebviewGpuIsDisabled:              webviewGpuDisabled,
		Theme:                             windows.Dark,
	}
}
