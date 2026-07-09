//go:build linux

package main

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"github.com/wailsapp/wails/v2/pkg/options"
)

//go:embed build/appicon.png
var icon []byte

// singletonLock holds the lock file descriptor to prevent GC from closing it
var singletonLock *os.File

// findAndShowWindow 在 Linux 上为空实现
func findAndShowWindow() {}

// ensureSingleInstance 使用 flock 检查是否已有实例运行
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

// applyPlatformOptions 在 Linux 上无额外选项
func applyPlatformOptions(opts *options.App, configManager *ConfigManager) {}
