//go:build darwin

package main

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed build/appicon.png
var icon []byte

// singletonLock holds the lock file descriptor to prevent GC from closing it
var singletonLock *os.File

// findAndShowWindow 在 macOS 上为空实现
func findAndShowWindow() {}

// ensureSingleInstance 使用 flock 检查是否已有实例运行（macOS 支持 flock）
func ensureSingleInstance() {
	lockFile := filepath.Join(os.TempDir(), "lumin-ssh.lock")
	f, err := os.OpenFile(lockFile, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return
	}
	err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != nil {
		fmt.Println("Lumin is already running.")
		findAndShowWindow()
		os.Exit(0)
	}
	singletonLock = f
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
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, nil
}

// applyPlatformOptions 设置 macOS 特定窗口选项
func applyPlatformOptions(opts *options.App, configManager *ConfigManager) {
	opts.Mac = &mac.Options{
		TitleBar:             mac.TitleBarHiddenInset(), // 隐藏标题栏但保留红绿灯按钮
		Appearance:           mac.DefaultAppearance,
		WebviewIsTransparent: false,
		WindowIsTranslucent:  false,
		About: &mac.AboutInfo{
			Title:   "Lumin",
			Message: "Lightweight SSH Client",
		},
	}
}
