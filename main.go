package main

import (
	"context"
	"embed"
	"os"
	"path/filepath"
	"sync"
	"time"

	runtimebundle "luminssh-go/module/runtimebundle"

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

// forceShowWindow 唤醒隐藏到托盘的窗口，带 recover 防止 panic 导致托盘 goroutine 挂死
func forceShowWindow(ctx context.Context) {
	defer func() { recover() }()
	runtime.WindowHide(ctx)
	runtime.WindowShow(ctx)
}

var systrayOnce sync.Once

func setupSystray(app *App) {
	systrayOnce.Do(func() {
		systray.SetIcon(icon)
		systray.SetTitle("Lumin")
		systray.SetTooltip("Lumin SSH")

		mShow := systray.AddMenuItem("显示主窗口", "Show Main Window")
		mQuit := systray.AddMenuItem("完全退出", "Quit Lumin")

		// 左键点击托盘图标：显示窗口
		systray.SetOnClick(func(menu systray.IMenu) {
			if app.ctx != nil {
				forceShowWindow(app.ctx)
			}
		})

		// 右键点击托盘图标：显示菜单
		systray.SetOnRClick(func(menu systray.IMenu) {
			menu.ShowMenu()
		})

		mShow.Click(func() {
			if app.ctx != nil {
				forceShowWindow(app.ctx)
			}
		})

		mQuit.Click(func() {
			app.DoQuit()
		})
	})
}

func main() {
	// 单实例检查（平台特定实现）
	ensureSingleInstance()

	// Create an instance of the app structure
	app := NewApp()
	app.onBeforeQuit = func() { systray.Quit() }

	systrayEnd := prepareSystray(app)

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
			app.startup(ctx)
			go func() {
				targetRoot := filepath.Join(getProgramDirectory(), "modules", "kimiapi")
				if err := runtimebundle.ReleaseEmbeddedDirectory(embeddedModuleFS, "module/kimiapi", targetRoot); err != nil {
					println("release kimiapi bundle failed:", err.Error())
				}
			}()
			startSystray(app)
		},
		OnShutdown: func(ctx context.Context) {
			stopMCPServer(app)
			systrayEnd()
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
	applyPlatformOptions(opts, app.configManager)

	err := wails.Run(opts)

	if err != nil {
		println("Error:", err.Error())
	}
}
