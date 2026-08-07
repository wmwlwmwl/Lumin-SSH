package main

import (
	_ "embed"
	"runtime"

	"luminssh-go/internal/platformruntime"

	"github.com/wailsapp/wails/v2/pkg/options"
)

// 资源必须留在根包：go:embed 路径不能跨包引用 build 目录。
//
//go:embed build/appicon.png
var appIcon []byte

//go:embed build/windows/icon.ico
var windowsIcon []byte

var icon = func() []byte {
	if runtime.GOOS == "windows" {
		return windowsIcon
	}
	return appIcon
}()

func ensureSingleInstance() {
	platformruntime.EnsureSingleInstance()
}

func startSingletonServer(showFn func()) {
	platformruntime.StartSingletonServer(showFn)
}

func stopSingletonServer() {
	platformruntime.StopSingletonServer()
}

func acquireMainLivenessLock(path string) (func(), error) {
	return platformruntime.AcquireMainLivenessLock(path)
}

func platformForceShowWindow() {
	platformruntime.ForceShowWindow()
}

func platformPrepareTrayMenu() {
	platformruntime.PrepareTrayMenu()
}

func removeTrayIconSync() {
	platformruntime.RemoveTrayIconSync()
}

func applyPlatformOptions(opts *options.App, configManager *ConfigManager) {
	gpuDisabled := configManager != nil && configManager.GetWebviewGpuDisabled()
	platformruntime.ApplyOptions(opts, gpuDisabled)
}
