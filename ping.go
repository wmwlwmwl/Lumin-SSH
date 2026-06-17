package main

import (
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
func measureLatency(host string, port int) (int64, bool) {
	target := dialAddr(host, port)

	start := time.Now()
	conn, err := net.DialTimeout("tcp", target, 4*time.Second)
	if err != nil {
		return 0, false
	}
	connectedAt := time.Now()
	dialMs := connectedAt.Sub(start).Milliseconds()
	defer conn.Close()

	// Try to read the SSH banner — the server sends it immediately after TCP connect.
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 64)
	n, err := conn.Read(buf)
	bannerMs := time.Since(connectedAt).Milliseconds()

	// If dial was instant (< 5 ms) and we're talking to a non-private host,
	// a TUN/proxy intercepted the dial locally.
	// In that case bannerMs = proxy→server round-trip ≈ real network RTT.
	isTUN := dialMs < 5 && !isLocalOrPrivateIP(host)

	if err != nil || n == 0 {
		// Could not read banner (firewall drops it, non-SSH port, etc.)
		if isTUN {
			// TUN mode but no banner — fall back to banner wait time as proxy RTT estimate
			return bannerMs, true
		}
		return dialMs, true
	}

	if isTUN {
		// TUN mode: use the time from connection to banner arrival (1 real RTT)
		return bannerMs, true
	}
	// Direct mode: dial already took 1 RTT; total = dial + a few ms for banner
	return dialMs, true
}

// PingServer returns the latency to the SSH port.
func PingServer(host string, port int) map[string]interface{} {
	const samples = 2
	var best int64 = -1
	var anyOnline bool

	for i := 0; i < samples; i++ {
		rtt, online := measureLatency(host, port)
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
