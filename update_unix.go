//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
)

// launchInstaller 启动安装向导（Unix 下直接执行）
func launchInstaller(targetPath string) error {
	cmd := exec.Command(targetPath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start setup: %w", err)
	}
	return nil
}

// restartApp 重启应用
func restartApp(exePath string) error {
	cmd := exec.Command(exePath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to restart application: %w", err)
	}
	return nil
}

// installDebPackage 以提权方式安装 .deb 包。
// 通过 pkexec（优先）或 sudo 执行 dpkg -i。
func installDebPackage(debPath string) error {
	// 优先使用 pkexec（显示友好的图形鉴权对话框）
	cmd := exec.Command("pkexec", "dpkg", "-i", debPath)
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		// pkexec 不可用时回退到 sudo（终端内输入密码）
		cmd = exec.Command("sudo", "dpkg", "-i", debPath)
		cmd.Stderr = os.Stderr
		cmd.Stdout = os.Stdout
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to install deb package: neither pkexec nor sudo is available, or user cancelled: %w", err)
		}
	}
	return nil
}

// installRpmPackage 以提权方式安装 .rpm 包。
// 通过 pkexec（优先）或 sudo 执行 rpm -Uvh。
func installRpmPackage(rpmPath string) error {
	cmd := exec.Command("pkexec", "rpm", "-Uvh", rpmPath)
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		cmd = exec.Command("sudo", "rpm", "-Uvh", rpmPath)
		cmd.Stderr = os.Stderr
		cmd.Stdout = os.Stdout
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to install rpm package: neither pkexec nor sudo is available, or user cancelled: %w", err)
		}
	}
	return nil
}

func installDmgPackage(_, _ string) error {
	return fmt.Errorf("dmg packages are not supported on Linux")
}

// applyUpdateElevated 以提权方式执行便携版热替换。
// 当 Lumin 安装在 /usr/bin/ 等系统目录时，普通用户无写入权限，
// 需要借助 pkexec（优先）或 sudo 执行替换操作。
//
// 注意：pkexec 的安全策略禁止直接执行 shell 脚本，因此通过
// "pkexec sh -c 'cmd'" 让 pkexec 执行受信任的 /bin/sh 二进制。
// 同时，只提权做文件替换，新程序以普通用户权限启动（更安全）。
func applyUpdateElevated(targetPath, exePath string) error {
	// 文件替换命令：先备份原文件，再移入新文件
	cmdStr := fmt.Sprintf(`mv -f "%s" "%s.old" && mv -f "%s" "%s"`,
		exePath, exePath, targetPath, exePath)

	// 优先使用 pkexec（显示友好的图形鉴权对话框）
	cmd := exec.Command("pkexec", "sh", "-c", cmdStr)
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		// pkexec 不可用时回退到 sudo（终端内输入密码）
		cmd = exec.Command("sudo", "sh", "-c", cmdStr)
		cmd.Stderr = os.Stderr
		cmd.Stdout = os.Stdout
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("elevated update failed: neither pkexec nor sudo is available, or user cancelled: %w", err)
		}
	}

	// 替换成功，以普通用户权限重启应用
	if err := restartApp(exePath); err != nil {
		return fmt.Errorf("elevated update succeeded but failed to restart: %w", err)
	}
	return nil
}
