package main

import (
	"bytes"
	"context"
	"net"
	"strings"
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

// isLoopbackHost 仅判断本机回环（localhost / 127.x / ::1）。
// 这类目标一定走本机、不经过 TUN，所以 TUN 判定时要把它们排除掉。
func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// isTUNLocalAddr 判断"出站拨号所用的本地地址"是否落在常见 TUN/代理虚拟网卡网段。
// 这是识别 TUN 模式最可靠的信号：TUN 网卡会把出站流量劫持到自己的网段（如 Mihomo 默认 198.18.0.0/16），
// 不受网络抖动影响。配合 dialMs<50 兜底，能覆盖各种 TUN 配置。
func isTUNLocalAddr(local net.Addr) bool {
	if local == nil {
		return false
	}
	host, _, err := net.SplitHostPort(local.String())
	if err != nil {
		return false
	}
	// 常见 TUN/代理软件默认网段：Mihomo/Clash fake-ip 198.18.0.0/16、TUN 模式 172.16/18/19/20.x、
	// WireGuard 10.x、ZeroTier 10.147.0.0/16 等也可能被分流，但这里只判强信号的虚拟网段。
	if strings.HasPrefix(host, "198.18.") || strings.HasPrefix(host, "198.19.") {
		return true
	}
	if strings.HasPrefix(host, "172.19.") || strings.HasPrefix(host, "172.20.") {
		return true
	}
	return false
}

// measureLatency measures the one-way RTT to the SSH server.
//
// Strategy:
//  1. Record time before Dial (start).
//  2. Wait for Dial to return (connectedAt).
//  3. For direct connections: dialMs ≈ real RTT (TCP handshake = 1 RTT), dial 成功即在线。
//  4. For TUN/proxy connections: dialMs ≈ 0 (本地 TUN 立即完成握手)，必须读真实 SSH Banner 才算在线。
//
// IMPORTANT: TUN/代理模式下本地拨号总是瞬间成功，目标不可达时 dialMs 仍是 ~0；此时必须靠 Banner 校验，
// 否则 TUN 黑洞会被误判成在线，前端表现为永远显示 "0毫秒" 而非 "离线"。
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

	usesProxy := connectionUsesProxy(connConfig)
	// TUN 检测优先看"拨号所用的本地地址"是否落在 TUN 虚拟网段（最可靠），
	// 兜底用 dialMs<50（覆盖未知网段的 TUN 配置）。
	// 注意：不能再用 isLocalOrPrivateIP 排除——TUN 下访问 10.x/172.x/192.168.x 等私有网段
	// 同样会被 TUN 劫持（黑洞），只有本机回环（localhost/127.x）才真正不可能走 TUN。
	isTUN := !usesProxy && !isLoopbackHost(connConfig.Host) &&
		(isTUNLocalAddr(conn.LocalAddr()) || dialMs < 50)

	// 直连模式（非代理、非 TUN）：TCP 端口能连上即代表 SSH 端口可达，dialMs 就是真实 RTT。
	if !usesProxy && !isTUN {
		return dialMs, true
	}

	// 代理 / TUN 模式：必须读到真实 SSH Banner 才能确认在线。
	// 主动写客户端 Banner 激活代理链路的延迟探测；纯代理下服务器也会先发 Banner，写不写都行，写了更稳。
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	_, writeErr := conn.Write([]byte("SSH-2.0-LuminPing\r\n"))

	buf := make([]byte, 64)
	n, err := conn.Read(buf)
	bannerMs := time.Since(connectedAt).Milliseconds()

	// 写失败 / 读失败 / 0 字节 / 内容不是 SSH 协议头，都判定为不可达，避免 TUN 黑洞误判为在线。
	if writeErr != nil || err != nil || n == 0 || !bytes.HasPrefix(buf[:n], []byte("SSH-")) {
		return 0, false
	}
	return bannerMs, true
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
