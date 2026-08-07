package main

import (
	"context"
	"embed"
	"os"
	goruntime "runtime"
	"sync"
	"time"

	"luminssh-go/internal/mcpbridge"
	"luminssh-go/internal/platformruntime"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed all:module
var embeddedModuleFS embed.FS

//go:embed build/appicon.png
var appIcon []byte

//go:embed build/windows/icon.ico
var windowsIcon []byte

var icon = func() []byte {
	if goruntime.GOOS == "windows" {
		return windowsIcon
	}
	return appIcon
}()

// forceShowWindow 唤醒隐藏到托盘/久置最小化的窗口。
// 不先 Hide 再 Show：久置后 Show 失败会把窗口永久卡在隐藏态。
// 先走 Wails 恢复，再用平台原生激活抢前台（Windows 久置后 SetForeground 常被拒）。
// 原生激活放前后各一次：覆盖「仅最小化」和「托盘隐藏」两种状态。
func forceShowWindow(ctx context.Context) {
	defer func() { recover() }()
	platformruntime.ForceShowWindow()
	if ctx != nil {
		runtime.WindowUnminimise(ctx)
		runtime.WindowShow(ctx)
	}
	platformruntime.ForceShowWindow()
}

var systrayOnce sync.Once

func setupSystray(app *App) {
	systrayOnce.Do(func() {
		systray.SetIcon(icon)
		systray.SetTitle("Lumin")
		systray.SetTooltip("Lumin SSH")

		mShow := systray.AddMenuItem("显示主窗口", "Show Main Window")
		mQuit := systray.AddMenuItem("完全退出", "Quit Lumin")

		showMain := func() {
			forceShowWindow(app.ctx)
		}

		// 左键点击托盘图标：显示窗口
		systray.SetOnClick(func(menu systray.IMenu) {
			showMain()
		})

		// 右键点击托盘图标：显示菜单。
		// Windows 久置后 TrackPopupMenu 常因托盘窗抢不到前台而不弹出；
		// 先解锁前台再 ShowMenu（与主窗久置唤起同源限制）。
		systray.SetOnRClick(func(menu systray.IMenu) {
			platformruntime.PrepareTrayMenu()
			menu.ShowMenu()
		})

		mShow.Click(func() {
			showMain()
		})

		mQuit.Click(func() {
			app.DoQuit()
		})
	})
}

func main() {
	// 单实例检查（平台特定实现）
	platformruntime.EnsureSingleInstance()

	// Create an instance of the app structure
	app := NewApp()

	systrayEnd := platformruntime.PrepareSystray(func() { setupSystray(app) })

	// 退出时先同步删托盘图标，再 systray.Quit。
	// Windows 上纯异步 Quit 常在 NIM_DELETE 前进程已死，留下幽灵图标。
	var trayCleanupOnce sync.Once
	cleanupTray := func() {
		trayCleanupOnce.Do(func() {
			platformruntime.RemoveTrayIconSync()
			systrayEnd()
		})
	}
	app.onBeforeQuit = cleanupTray

	// Create application with options
	opts := &options.App{
		Title:     "Lumin",
		Width:     1440,
		Height:    900,
		Frameless: true,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 8, G: 12, B: 20, A: 255}, // #080c14
		OnStartup: func(ctx context.Context) {
			// 先挂托盘：startup 里 MCP 等可能阻塞，托盘若排后面会出现「窗口已能关到托盘但图标很久才出」。
			app.ctx = ctx
			platformruntime.StartSystray(func() { setupSystray(app) })
			// 启动单实例 socket：二次启动会发 show 指令，经 forceShowWindow 走托盘同一路径唤起主窗口。
			platformruntime.StartSingletonServer(func() {
				forceShowWindow(app.ctx)
			})
			app.startup(ctx)
		},
		OnShutdown: func(ctx context.Context) {
			platformruntime.StopSingletonServer()
			mcpbridge.StopServer(newMCPHost(app))
			cleanupTray()
		},
		// 拦截窗口关闭：弹出对话框让用户选择退出 / 系统托盘 / 取消
		OnBeforeClose: func(ctx context.Context) bool {
			if app.quitting.Load() {
				return false // 用户确认退出，放行
			}
			app.closeAck.Store(false) // 重置，等待本次前端响应
			runtime.EventsEmit(ctx, "close-request")
			// 超时兜底：仅当前端 5 秒内无响应（崩溃/JS 异常）时强制退出；
			// 前端选 tray/cancel 会调 AckClose 置位 closeAck，跳过强制退出
			go func() {
				time.Sleep(5 * time.Second)
				if !app.quitting.Load() && !app.closeAck.Load() {
					app.quitting.Store(true)
					cleanupTray()
					runtime.Quit(ctx)
				}
			}()
			return true // 取消关闭，由前端弹窗决定后续操作
		},
		Bind: []interface{}{
			app,
			NewAIBindings(app),
			NewAIProviderBindings(app.configManager),
		},
	}

	if _, ok := os.LookupEnv("LUMIN_OPEN_DEVTOOLS"); ok {
		opts.Debug.OpenInspectorOnStartup = true
	}

	// 应用平台特定选项（平台特定实现）
	gpuDisabled := app.configManager != nil && app.configManager.GetWebviewGpuDisabled()
	platformruntime.ApplyOptions(opts, gpuDisabled)

	err := wails.Run(opts)

	if err != nil {
		println("Error:", err.Error())
	}
}
