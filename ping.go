package main

import (
	"context"
	"net"
	"time"
)

// isLocalOrPrivateIP checks if the host string points to a local loopback or private subnet
func isLocalOrPrivateIP(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

// measureLatency measures the one-way RTT to the SSH server.
//
// Strategy:
//  1. Record time before Dial (start).
//  2. Wait for Dial to return (connectedAt).
//  3. Wait for the SSH banner to arrive (bannerAt).
//
// With a direct connection: dialMs ≈ real RTT (TCP handshake = 1 RTT).
// With a TUN-mode proxy:   dialMs ≈ 0ms (local TUN accepts immediately),
//
//	bannerMs (connectedAt→bannerAt) ≈ real RTT (proxy→server→back).
//
// In both cases we pick whichever sub-interval best represents the true RTT.
func measureLatency(connConfig Connection) (int64, bool) {
	target := dialAddr(connConfig.Host, connConfig.Port)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	start := time.Now()
	conn, err := dialConnectionTargetContext(ctx, connConfig, target, 4*time.Second)
	if err != nil {
		return 0, false
	}
	connectedAt := time.Now()
	dialMs := connectedAt.Sub(start).Milliseconds()
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(3 * time.Second))

	usesProxy := connectionUsesProxy(connConfig)
	isTUN := !usesProxy && dialMs < 50 && !isLocalOrPrivateIP(connConfig.Host)

	// 仅在使用了代理或检测为 TUN 模式时，才写入客户端 Banner 以激活延迟连接，直连模式下发送 0 字节以节省流量
	var writeErr error
	if usesProxy || isTUN {
		_, writeErr = conn.Write([]byte("SSH-2.0-LuminPing\r\n"))
	}

	buf := make([]byte, 64)
	n, err := conn.Read(buf)
	bannerMs := time.Since(connectedAt).Milliseconds()

	// 如果写入错误、读取错误或读入字节为0，代表 SSH 服务不可用，直接判定为离线
	if writeErr != nil || err != nil || n == 0 {
		return 0, false
	}

	if usesProxy || isTUN {
		return bannerMs, true
	}
	return dialMs, true
}

// PingServer returns the latency to the SSH port.
func PingServer(connConfig Connection) map[string]interface{} {
	const samples = 2
	var best int64 = -1
	var anyOnline bool

	for i := 0; i < samples; i++ {
		rtt, online := measureLatency(connConfig)
		if !online {
			continue
		}
		anyOnline = true
		if best < 0 || rtt < best {
			best = rtt
		}
	}

	if !anyOnline {
		return map[string]interface{}{
			"online":  false,
			"latency": 0,
		}
	}

	return map[string]interface{}{
		"online":  true,
		"latency": best,
	}
}
