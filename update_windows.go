//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
)

// launchInstaller 启动安装向导
func launchInstaller(targetPath string) error {
	cmd := exec.Command("cmd.exe", "/C", "start", "", targetPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start setup: %w", err)
	}
	return nil
}

// restartApp 重启应用（隐藏窗口）
func restartApp(exePath string) error {
	cmd := exec.Command(exePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to restart application: %w", err)
	}
	return nil
}

// ponytail: Windows 平台 stubs — Linux 专属的更新路径不会走到
func installDebPackage(_ string) error      { return nil }
func installRpmPackage(_ string) error      { return nil }
func installDmgPackage(_, _ string) error   { return nil }
func applyUpdateElevated(_, _ string) error { return nil }
