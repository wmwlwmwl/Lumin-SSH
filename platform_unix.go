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

// applyPlatformOptions 在 Linux 上无额外选项
func applyPlatformOptions(opts *options.App, configManager *ConfigManager) {}
