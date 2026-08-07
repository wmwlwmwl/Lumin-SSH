//go:build linux || darwin

package platformruntime

import (
	"net"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestHandleSingletonConnReadsFragmentedFrame(t *testing.T) {
	server, client := net.Pipe()
	var calls atomic.Int32
	done := make(chan struct{})
	go func() {
		handleSingletonConn(server, func() { calls.Add(1) })
		close(done)
	}()

	if _, err := client.Write([]byte("sh")); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Write([]byte("ow\n")); err != nil {
		t.Fatal(err)
	}
	_ = client.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("读取单实例指令超时")
	}
	if calls.Load() != 1 {
		t.Fatalf("回调次数 = %d，期望 1", calls.Load())
	}
}

func TestHandleSingletonConnRejectsUnknownFrame(t *testing.T) {
	server, client := net.Pipe()
	var calls atomic.Int32
	done := make(chan struct{})
	go func() {
		handleSingletonConn(server, func() { calls.Add(1) })
		close(done)
	}()
	_, _ = client.Write([]byte("hide\n"))
	_ = client.Close()
	<-done
	if calls.Load() != 0 {
		t.Fatalf("未知指令触发了 %d 次回调", calls.Load())
	}
}

func TestStartSingletonServerWakeupAndCleanup(t *testing.T) {
	runDir := t.TempDir()
	t.Setenv("XDG_RUNTIME_DIR", runDir)
	var calls atomic.Int32
	StartSingletonServer(func() { calls.Add(1) })
	defer StopSingletonServer()

	path := singleInstanceSocketPath()
	conn, err := net.DialTimeout("unix", path, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte("show\n")); err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
	deadline := time.Now().Add(time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if calls.Load() != 1 {
		t.Fatalf("唤醒回调次数 = %d，期望 1", calls.Load())
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0077 != 0 {
		t.Fatalf("socket 权限过宽：%o", info.Mode().Perm())
	}
	StopSingletonServer()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("停止后 socket 仍存在：%v", err)
	}
}

func TestAcquireMainLivenessLockRelease(t *testing.T) {
	path := filepath.Join(t.TempDir(), "main.lock")
	release, err := AcquireMainLivenessLock(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AcquireMainLivenessLock(path); err == nil {
		t.Fatal("重复获取存活锁应失败")
	}
	release()
	release()

	releaseAgain, err := AcquireMainLivenessLock(path)
	if err != nil {
		t.Fatalf("释放后重新获取失败：%v", err)
	}
	releaseAgain()
}
