package main

import (
	_ "embed"
	"runtime"
)

// 资源必须留在根包：go:embed 路径不能跨包引用 build 目录。
// 平台 wrapper 已内联到调用方（main.go / app.go），直接调用 platformruntime.X()。

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
